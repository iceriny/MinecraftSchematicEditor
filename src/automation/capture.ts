import * as THREE from "three";
import type { Viewer } from "../render/Viewer";
import type { MeshData } from "../render/mesher";
import { captureMeshes, captureRegion } from "./capture-region";
import { useStore } from "../store";
import { captureAngles, type CaptureAngle, type CaptureOptions, type Vec3 } from "./protocol";

const viewpoints: Record<CaptureAngle, Vec3> = {
  south: [0, .12, 1], north: [0, .12, -1], east: [1, .12, 0], west: [-1, .12, 0],
  southeast: [1, .52, 1], southwest: [-1, .52, 1], northeast: [1, .52, -1],
  northwest: [-1, .52, -1], top: [0, 1, 0],
};

function chunkGeometry(data: MeshData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute("layer", new THREE.BufferAttribute(data.layers, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  return geometry;
}

function cameraFor(angle: CaptureAngle, bounds: THREE.Box3, focus: THREE.Vector3, span?: number) {
  const distance = bounds.getSize(new THREE.Vector3()).length() + focus.distanceTo(bounds.getCenter(new THREE.Vector3())) + 10;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, distance * 2 + 10);
  camera.position.copy(focus).addScaledVector(new THREE.Vector3(...viewpoints[angle]).normalize(), distance);
  if (angle === "top") camera.up.set(0, 0, -1);
  camera.lookAt(focus);
  camera.updateMatrixWorld(true);
  let half = span ? span / 2 : 1;
  if (!span) {
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const p = camera.worldToLocal(new THREE.Vector3(x, y, z));
        half = Math.max(half, Math.abs(p.x) * 1.07, Math.abs(p.y) * 1.07);
      }
    }
  }
  camera.left = camera.bottom = -half;
  camera.right = camera.top = half;
  camera.updateProjectionMatrix();
  return camera;
}

/** An offscreen camera per tile, using the live viewer's baked meshes and GPU materials. */
export async function captureBrowser(options: CaptureOptions) {
  const { angles, tileSize, center, span } = options;
  if (!Array.isArray(angles) || !angles.length || angles.length > 4 || !angles.every(a => captureAngles.includes(a))
      || !Number.isInteger(tileSize) || tileSize < 256 || tileSize > 1024
      || (span !== undefined && !(Number.isFinite(span) && span >= 1 && span <= 100000))
      || (center !== undefined && (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)))) {
    throw new Error("Invalid capture angles, tile size, focus or span.");
  }
  const initial = useStore.getState();
  if (!initial.build) throw new Error("Open a schematic before capturing a preview.");
  const deadline = performance.now() + 12000;
  while (useStore.getState().baking) {
    if (performance.now() > deadline) throw new Error("Textures are still baking. Retry capture after loading finishes.");
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  const state = useStore.getState(), build = state.build;
  if (!build || build !== initial.build || state.revision !== initial.revision) throw new Error("Document changed during capture. Retry for the current revision.");
  const viewer = (window as unknown as { viewer?: Viewer }).viewer;
  if (!viewer) throw new Error("The 3D viewer is not ready.");
  const { materials, renderer, baked } = viewer.debug;
  if (!baked || baked.blocks.length < build.palette.length) throw new Error("Render palette is not ready.");
  const region = captureRegion(build, state.layerLimit, options.box);
  const scene = new THREE.Scene();
  const temporary: THREE.BufferGeometry[] = [];
  // Read the same color attachment we draw to. MSAA targets use a separate
  // resolve framebuffer, which can still contain the previous camera's view.
  const target = new THREE.WebGLRenderTarget(tileSize, tileSize, { samples: 0 });
  target.texture.colorSpace = renderer.outputColorSpace;
  const previous = renderer.getRenderTarget();
  try {
    for (const chunk of captureMeshes(build, baked, region)) {
      for (let layer = 0; layer < 3; layer++) {
        const data = chunk.layers[layer];
        if (!data) continue;
        const geometry = chunkGeometry(data);
        temporary.push(geometry);
        const mesh = new THREE.Mesh(geometry, materials[layer]);
        mesh.renderOrder = layer;
        scene.add(mesh);
      }
    }
    const bounds = new THREE.Box3().setFromObject(scene);
    if (bounds.isEmpty()) throw new Error("There are no visible blocks inside the capture region.");
    const focus = center ? new THREE.Vector3(...center) : bounds.getCenter(new THREE.Vector3());
    const sheet = document.createElement("canvas"), cols = Math.min(2, angles.length);
    const labelHeight = 26;
    sheet.width = tileSize * cols;
    sheet.height = (tileSize + labelHeight) * Math.ceil(angles.length / cols);
    const ctx = sheet.getContext("2d");
    if (!ctx) throw new Error("Cannot create PNG canvas.");
    ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.font = "15px monospace"; ctx.fillStyle = "#ccd6dc";
    const pixels = new Uint8Array(tileSize * tileSize * 4);
    const tile = ctx.createImageData(tileSize, tileSize);
    for (const [index, angle] of angles.entries()) {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, cameraFor(angle, bounds, focus, span));
      renderer.readRenderTargetPixels(target, 0, 0, tileSize, tileSize, pixels);
      renderer.setRenderTarget(previous);
      const stride = tileSize * 4;
      for (let y = 0; y < tileSize; y++) {
        tile.data.set(pixels.subarray(y*stride, (y+1)*stride), (tileSize-y-1)*stride);
      }
      const left = (index % cols) * tileSize, top = Math.floor(index / cols) * (tileSize + labelHeight);
      ctx.putImageData(tile, left, top);
      ctx.fillText(angle.toUpperCase(), left + 12, top + tileSize + 18);
    }
    return { mimeType: "image/png", data: sheet.toDataURL("image/png").split(",")[1],
      width: sheet.width, height: sheet.height, angles, box: region, revision: state.revision, activeDoc: state.activeDoc };
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    for (const geometry of temporary) geometry.dispose();
  }
}
