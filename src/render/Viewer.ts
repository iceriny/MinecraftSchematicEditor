/**
 * The three.js side of the app: scene, camera modes, chunked geometry, and
 * hit-testing. React never touches three objects directly — it calls methods
 * here and reads back through the callbacks.
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Build } from "../core/model";
import type { BrushShape } from "../core/brush";
import { mirrorImages, planePosition, type MirrorConfig } from "../core/mirror";
import { meshRegion, type MeshData } from "./mesher";
import type { BakedPalette } from "./bake";

// Colours here mirror the CSS tokens in styles.css.
const AXIS_COLOR = { x: 0xe0655f, y: 0x74cf62, z: 0x5f9ce0 };
const FRAME_COLOR = 0x46566b;
const GRID_COLOR = 0x232c38;
const GRID_ACCENT = 0x33445a;
const HOVER_COLOR = 0x8fd0ff;
const SELECT_COLOR = 0x4c7ff0;
const GHOST_COLOR = 0x74cf62;
const GHOST_BAD_COLOR = 0xe0655f;
/** Preview tints for the three kinds of cell a stair plan lays down. */
const STAIR_COLOR = { step: 0x74cf62, tread: 0x8fd0ff, support: 0x5f7690 };

const CHUNK = 32;
/** Milliseconds of meshing allowed per frame, so the camera never stutters. */
const MESH_BUDGET_MS = 10;

export type CameraMode = "orbit" | "fly";

/** An inclusive block range, as the overlays want it. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

/** What a through-selection found: the box round it, and how many blocks. */
export interface ThroughSelection extends Box {
  count: number;
}

/** One cell of a stair plan, as much of it as the preview needs. */
export interface StairPreviewCell {
  x: number;
  y: number;
  z: number;
  kind: "step" | "tread" | "support";
}

export interface BlockHit {
  index: number;
  x: number;
  y: number;
  z: number;
  /** Face normal of the hit, for placing blocks against a surface. */
  normal: THREE.Vector3;
  /**
   * The empty cell against the hit face, where a placed block goes. Null when
   * that cell would fall outside the build.
   */
  place: { x: number; y: number; z: number; index: number } | null;
  /** Min corner for stamping the current clip against this face. */
  clipOrigin: [number, number, number] | null;
  /** True when the hit came from the construction plane, not from geometry. */
  onPlane: boolean;
}

interface Chunk {
  cx: number; cy: number; cz: number;
  /** One mesh per render layer: opaque, cutout, blended. */
  meshes: (THREE.Mesh | null)[];
  dirty: boolean;
  /** Whether this chunk is currently in the rebuild queue. */
  queued: boolean;
}

/** Enables the UV varyings the block shader reads; never sampled itself. */
function uvEnablerTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Block material sampling a 2D texture array by a per-vertex layer index.
 * Patching MeshBasicMaterial rather than writing a ShaderMaterial keeps fog,
 * alpha testing and the rest of three's plumbing.
 */
function blockMaterial(
  kind: 0 | 1 | 2,
  enabler: THREE.Texture,
  textureUniform: { value: THREE.Texture | null },
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    map: enabler,
    transparent: kind === 2,
    opacity: kind === 2 ? 0.82 : 1,
    depthWrite: kind !== 2,
    alphaTest: kind === 1 ? 0.5 : 0,
  });

  material.onBeforeCompile = (shader) => {
    // Shared by reference so the texture can be swapped before or after the
    // material has ever been compiled.
    shader.uniforms.blockTextures = textureUniform;
    shader.vertexShader =
      "attribute float layer;\nvarying float vLayer;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvLayer = layer;");
    shader.fragmentShader =
      "precision highp sampler2DArray;\nuniform sampler2DArray blockTextures;\nvarying float vLayer;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        "diffuseColor *= texture( blockTextures, vec3( vMapUv, vLayer ) );",
      );
  };
  material.customProgramCacheKey = () => `block-array-${kind}`;
  return material;
}

function label(text: string, className: string): CSS2DObject {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return new CSS2DObject(el);
}

/** A closed circle of `radius` in the XY plane, for the push brush's rings. */
function ringGeometry(radius: number, segments = 48): THREE.BufferGeometry {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return new THREE.BufferGeometry().setFromPoints(points);
}

export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: OrbitControls;
  private container: HTMLElement;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frameHandle = 0;
  private resizeObserver: ResizeObserver;

  private build: Build | null = null;
  private baked: BakedPalette | null = null;
  private chunks: Chunk[] = [];
  private dirtyQueue: Chunk[] = [];
  private chunkCounts = { x: 0, y: 0, z: 0 };
  private yLimit = Infinity;

  private buildGroup = new THREE.Group();
  private frameGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  /** Ruler and centre lines: rebuilt whole rather than tweaked in place. */
  private guideGroup = new THREE.Group();
  private grid: THREE.Object3D | null = null;

  private textureUniform: { value: THREE.Texture | null } = { value: null };
  private materials: THREE.MeshBasicMaterial[];
  private hoverBox: THREE.LineSegments;
  private selectionBox: THREE.Mesh;
  private selectionEdges: THREE.LineSegments;
  private ghostBox: THREE.Mesh;
  private ghostEdges: THREE.LineSegments;
  /** The rectangle the floor tool would lay, and its figure. */
  private floorQuad: THREE.Mesh;
  private floorEdges: THREE.LineSegments;
  private floorLabel: CSS2DObject;
  private planeQuad: THREE.Mesh;
  private highlight: THREE.InstancedMesh | null = null;
  /** Ghosted cells of the stair flight the next click would lay down. */
  private stairPreview: THREE.InstancedMesh | null = null;
  private stairAnchor: THREE.LineSegments;
  /** Symmetry planes, and the reflected cursors that go with them. */
  private mirror: MirrorConfig | null = null;
  private mirrorGroup = new THREE.Group();
  /** Outlines for the cells a mirrored stroke would also touch. */
  private mirrorCursors: THREE.LineSegments[] = [];

  /** The push brush's cursor: a ball or a box of cells, drawn round the pointer. */
  private pushBrush: { size: number; shape: BrushShape } | null = null;
  private pushCursor: THREE.Group | null = null;

  /**
   * Takes hit-testing off the geometry for the length of a drag and puts it on
   * a plane. Both the floor and the push brush need a target that keeps up with
   * the pointer over empty space, and that doesn't wander as the blocks under
   * it move.
   */
  private dragPick: { plane: THREE.Plane; level: number | null } | null = null;

  /** Screen rectangle of a through-selection, while one is being dragged. */
  private marquee = false;
  private marqueeEl: HTMLDivElement;
  private marqueeStart: { x: number; y: number } | null = null;
  private marqueeAdditive = false;

  /** Placement tools can target empty space, so they get the build plane too. */
  private placing = false;
  /** Draw straight onto the layer plane instead of against the geometry. */
  private planeLock = false;
  /** Fall back to the layer plane when the ray misses every block. */
  private planeFallback = false;
  /** Footprint of the clip the clone tool would stamp, or null. */
  private clipSize: [number, number, number] | null = null;
  /** Anchor the stamp on the hit block itself instead of the face beside it. */
  private clipThrough = false;
  /**
   * Blocks the stamp rides above the face the pointer found. The pointer can
   * only ever anchor against a surface, so a copy that belongs in mid-air —
   * a second storey, a floating roof — had no way to get there without parking
   * the ghost and giving up the pointer. This keeps the aim in the mouse and
   * puts only the height in the keyboard.
   */
  private clipLift = 0;

  private mode: CameraMode = "orbit";
  private keys = new Set<string>();
  private flySpeed = 12;
  private lastFrame = performance.now();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");

  /** Fired on every pointer move over the build. */
  onHover: (hit: BlockHit | null) => void = () => {};
  /** Fired when a through-selection rectangle is released; null found nothing. */
  onMarquee: (found: ThroughSelection | null, additive: boolean) => void = () => {};
  /** Fired on click and on drag-paint. */
  onPick: (hit: BlockHit, event: PointerEvent) => void = () => {};
  /** Brackets a drag so a whole stroke undoes in one step. */
  onStrokeStart: () => void = () => {};
  onStrokeEnd: () => void = () => {};
  onProgress: (remaining: number) => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;

    // Colour management off: vertex colours are authored as final sRGB values
    // and the shading model is Minecraft's, not a physical one.
    THREE.ColorManagement.enabled = false;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x0d1117, 1);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "viewer-labels";
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    this.camera.position.set(24, 20, 34);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.maxDistance = 2000;

    this.scene.fog = new THREE.Fog(0x0d1117, 220, 900);
    this.scene.add(
      this.buildGroup, this.frameGroup, this.overlayGroup,
      this.guideGroup, this.mirrorGroup,
    );

    const enabler = uvEnablerTexture();
    this.materials = [
      blockMaterial(0, enabler, this.textureUniform),
      blockMaterial(1, enabler, this.textureUniform),
      blockMaterial(2, enabler, this.textureUniform),
    ];

    const unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.hoverBox = new THREE.LineSegments(
      unitEdges,
      new THREE.LineBasicMaterial({ color: HOVER_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.hoverBox.renderOrder = 10;
    this.hoverBox.visible = false;
    this.overlayGroup.add(this.hoverBox);

    this.selectionBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: SELECT_COLOR, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    this.selectionEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: SELECT_COLOR }),
    );
    this.selectionBox.visible = false;
    this.selectionEdges.visible = false;
    this.overlayGroup.add(this.selectionBox, this.selectionEdges);

    this.ghostBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.ghostEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: GHOST_COLOR, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.ghostEdges.renderOrder = 11;
    this.ghostBox.visible = false;
    this.ghostEdges.visible = false;
    this.overlayGroup.add(this.ghostBox, this.ghostEdges);

    // The floor being dragged out. It is a slab one block thick, so a flat quad
    // would z-fight whatever it is being laid over; a box of the right height
    // sits round the cells instead.
    this.floorQuad = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.floorEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: GHOST_COLOR, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    this.floorEdges.renderOrder = 11;
    this.floorQuad.visible = false;
    this.floorEdges.visible = false;
    this.floorLabel = label("", "dim-label dim-rule");
    this.floorLabel.visible = false;
    this.overlayGroup.add(this.floorQuad, this.floorEdges, this.floorLabel);

    // The height the layer slider sits at, drawn only while a placement tool is
    // active so there is something to build on over empty ground.
    this.planeQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: SELECT_COLOR, transparent: true, opacity: 0.12,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    this.planeQuad.visible = false;
    this.overlayGroup.add(this.planeQuad);

    // Marks the step the flight was started from while the second point is
    // still being aimed at.
    this.stairAnchor = new THREE.LineSegments(
      unitEdges,
      new THREE.LineBasicMaterial({ color: GHOST_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.stairAnchor.renderOrder = 12;
    this.stairAnchor.visible = false;
    this.overlayGroup.add(this.stairAnchor);

    // The through-selection rectangle is a screen shape, not a world one, so it
    // is drawn in the DOM over the canvas rather than in the scene.
    this.marqueeEl = document.createElement("div");
    this.marqueeEl.className = "marquee";
    container.appendChild(this.marqueeEl);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.attachInput();
    this.loop();

    if (import.meta.env.DEV) {
      (window as unknown as { viewer: Viewer }).viewer = this;
    }
  }

  /** Dev-only handles for poking at the scene from the console. */
  get debug() {
    return { chunks: this.chunks, materials: this.materials, baked: this.baked, renderer: this.renderer };
  }

  /* ------------------------------------------------------------- lifecycle */

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
  }

  dispose() {
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.detachInput();
    this.clearBuild();
    this.disposePushCursor();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    this.marqueeEl.remove();
  }

  /* ----------------------------------------------------------------- build */

  private clearBuild() {
    for (const chunk of this.chunks) {
      for (const mesh of chunk.meshes) {
        if (!mesh) continue;
        this.buildGroup.remove(mesh);
        mesh.geometry.dispose();
      }
    }
    this.chunks = [];
    this.dirtyQueue = [];
    this.frameGroup.clear();
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid = null;
    }
    this.setHighlight(null);
    this.setGhost(null);
    this.setStairPreview(null, null);
    this.setFloorPreview(null);
    this.setMeasure(null, null);
    this.setCentreGuides(null);
    this.showMirrorCursors(null);
    this.movePushCursor(null);
    this.endDragPick();
    this.planeQuad.visible = false;
  }

  setBuild(build: Build | null) {
    this.clearBuild();
    this.build = build;
    // A float is a height in the box being replaced; the new one has its own
    // ceiling, so the stamp comes back down to the face it points at.
    this.clipLift = 0;
    if (!build) return;

    this.yLimit = build.height - 1;
    this.chunkCounts = {
      x: Math.ceil(build.width / CHUNK),
      y: Math.ceil(build.height / CHUNK),
      z: Math.ceil(build.length / CHUNK),
    };
    for (let cy = 0; cy < this.chunkCounts.y; cy++) {
      for (let cz = 0; cz < this.chunkCounts.z; cz++) {
        for (let cx = 0; cx < this.chunkCounts.x; cx++) {
          this.chunks.push({ cx, cy, cz, meshes: [null, null, null], dirty: true, queued: true });
        }
      }
    }
    this.dirtyQueue = [...this.chunks];
    this.buildGrid();
    this.frameBuild();

    // Fog should only matter on builds big enough to have a horizon.
    const radius = Math.max(build.width, build.height, build.length);
    this.scene.fog = new THREE.Fog(0x0b0e13, radius * 3, radius * 12 + 400);

    this.frameCorner = -1;
    this.updateFrameCorner();
    this.updatePlane();
  }

  /**
   * Installs freshly baked block models. Baking is async because it decodes
   * textures, so the store owns it and hands the result over here.
   */
  setBaked(baked: BakedPalette) {
    const previous = this.textureUniform.value;
    this.baked = baked;
    this.textureUniform.value = baked.texture;
    if (previous && previous !== baked.texture) previous.dispose();
    this.invalidateAll();
  }

  private chunkAt(cx: number, cy: number, cz: number): Chunk | undefined {
    if (cx < 0 || cy < 0 || cz < 0) return undefined;
    const { x, y, z } = this.chunkCounts;
    if (cx >= x || cy >= y || cz >= z) return undefined;
    return this.chunks[(cy * z + cz) * x + cx];
  }

  private markChunkDirty(chunk: Chunk | undefined) {
    if (!chunk) return;
    chunk.dirty = true;
    // `dirty` and `queued` are tracked separately: a chunk can be pulled off
    // the queue and left dirty (no baked models yet), and it still has to come
    // back when something invalidates it again.
    if (chunk.queued) return;
    chunk.queued = true;
    this.dirtyQueue.push(chunk);
  }

  /** Queues a rebuild for the chunks covering these block indices. */
  invalidateBlocks(indices: Iterable<number>) {
    if (!this.build) return;
    const seen = new Set<number>();
    for (const index of indices) {
      const [x, y, z] = this.build.positionOf(index);
      const cx = (x / CHUNK) | 0, cy = (y / CHUNK) | 0, cz = (z / CHUNK) | 0;
      // Neighbour chunks too: a removed block reveals faces across the seam.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const key = ((cy + dy) * 1024 + (cz + dz)) * 1024 + (cx + dx);
            if (seen.has(key)) continue;
            seen.add(key);
            this.markChunkDirty(this.chunkAt(cx + dx, cy + dy, cz + dz));
          }
        }
      }
    }
  }

  invalidateAll() {
    for (const chunk of this.chunks) this.markChunkDirty(chunk);
  }

  setLayerLimit(y: number) {
    if (!this.build) return;
    const next = Math.max(0, Math.min(this.build.height - 1, y));
    if (next === this.yLimit) return;
    const low = Math.min(next, this.yLimit);
    const high = Math.max(next, this.yLimit);
    this.yLimit = next;
    // Only chunks in the band between the old and new limit change.
    for (const chunk of this.chunks) {
      const top = chunk.cy * CHUNK + CHUNK - 1;
      const bottom = chunk.cy * CHUNK;
      if (top >= low && bottom <= high + 1) this.markChunkDirty(chunk);
    }
    this.buildFrame();
    this.updatePlane();
  }

  /** True when the baked palette has an entry for every block the build uses. */
  private bakeCoversBuild(): boolean {
    return !!this.build && !!this.baked && this.baked.blocks.length >= this.build.palette.length;
  }

  private meshChunk(chunk: Chunk) {
    if (!this.bakeCoversBuild() || !this.build || !this.baked) return;
    const result = meshRegion(
      this.build, this.baked,
      chunk.cx * CHUNK, chunk.cy * CHUNK, chunk.cz * CHUNK,
      CHUNK, CHUNK, CHUNK,
      this.yLimit,
    );
    for (let layer = 0; layer < 3; layer++) {
      chunk.meshes[layer] = this.applyMesh(chunk.meshes[layer], result.layers[layer], layer);
    }
    chunk.dirty = false;
  }

  private applyMesh(existing: THREE.Mesh | null, data: MeshData | null, layer: number): THREE.Mesh | null {
    if (!data) {
      if (existing) {
        this.buildGroup.remove(existing);
        existing.geometry.dispose();
      }
      return null;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
    geometry.setAttribute("layer", new THREE.BufferAttribute(data.layers, 1));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geometry.computeBoundingSphere();

    const mesh = existing ?? new THREE.Mesh(geometry, this.materials[layer]);
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geometry;
    } else {
      mesh.renderOrder = layer;
      this.buildGroup.add(mesh);
    }
    mesh.userData.quadBlocks = data.quadBlocks;
    return mesh;
  }

  /* ------------------------------------------------------ frame and ground */

  /** Which of the four vertical edges the dimension lines hang off. */
  private frameCorner = -1;

  /** Keeps the dimension annotation on the corner nearest the camera. */
  private updateFrameCorner() {
    const build = this.build;
    if (!build) return;
    const sx = this.camera.position.x > build.width / 2 ? 1 : 0;
    const sz = this.camera.position.z > build.length / 2 ? 1 : 0;
    const corner = sx * 2 + sz;
    if (corner === this.frameCorner) return;
    this.frameCorner = corner;
    this.buildFrame();
  }

  /**
   * The drafting-style dimension annotation: one measured line per axis, with
   * terminating ticks and witness lines back to the build's corners.
   */
  private buildFrame() {
    this.frameGroup.clear();
    const build = this.build;
    if (!build) return;

    const w = build.width;
    const h = Math.min(build.height, this.yLimit + 1);
    const l = build.length;
    const off = Math.max(1.2, Math.max(w, h, l) * 0.045);
    const tick = off * 0.32;

    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, l)),
      new THREE.LineBasicMaterial({ color: FRAME_COLOR, transparent: true, opacity: 0.55 }),
    );
    box.position.set(w / 2, h / 2, l / 2);
    this.frameGroup.add(box);

    // Hang the lines off whichever vertical edge faces the camera.
    const nearX = this.frameCorner >= 2;
    const nearZ = this.frameCorner % 2 === 1;
    const ox = nearX ? w + off : -off;
    const oz = nearZ ? l + off : -off;
    const outX = nearX ? 1 : -1;
    const outZ = nearZ ? 1 : -1;

    const points: number[] = [];
    const colors: number[] = [];
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const push = (a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color) => {
      points.push(a.x, a.y, a.z, b.x, b.y, b.z);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    };

    const axes = [
      {
        key: "x" as const, span: w,
        line: (t: number) => v(t, -off, oz),
        tick: v(0, -1, 0),
        anchor: (t: number) => v(t, 0, nearZ ? l : 0),
      },
      {
        key: "z" as const, span: l,
        line: (t: number) => v(ox, -off, t),
        tick: v(0, -1, 0),
        anchor: (t: number) => v(nearX ? w : 0, 0, t),
      },
      {
        key: "y" as const, span: h,
        line: (t: number) => v(ox, t, oz),
        tick: v(outX, 0, outZ).normalize(),
        anchor: (t: number) => v(nearX ? w : 0, t, nearZ ? l : 0),
      },
    ];

    for (const axis of axes) {
      const color = new THREE.Color(AXIS_COLOR[axis.key]);
      const faint = color.clone().multiplyScalar(0.4);
      push(axis.line(0), axis.line(axis.span), color);
      for (const t of [0, axis.span]) {
        const at = axis.line(t);
        push(at.clone().addScaledVector(axis.tick, -tick), at.clone().addScaledVector(axis.tick, tick), color);
        push(at, axis.anchor(t), faint);
      }

      const text = label("", `dim-frame-label dim-frame-${axis.key}`);
      const badge = document.createElement("span");
      badge.className = `dim-label dim-${axis.key}`;
      badge.textContent = `${axis.span}`;
      text.element.appendChild(badge);
      // Anchor to the line itself; CSS keeps a constant gap as the camera zooms.
      text.position.copy(axis.line(axis.span / 2));
      this.frameGroup.add(text);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    this.frameGroup.add(
      new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })),
    );
  }

  private buildGrid() {
    const build = this.build;
    if (!build) return;
    const extent = Math.max(build.width, build.length) * 2 + 32;
    const size = Math.ceil(extent / 16) * 16;
    const grid = new THREE.GridHelper(size, size / 16, GRID_ACCENT, GRID_COLOR);
    grid.position.set(build.width / 2, -0.01, build.length / 2);
    const material = grid.material as THREE.Material;
    material.transparent = true;
    material.opacity = 0.5;
    this.grid = grid;
    this.scene.add(grid);
  }

  /** Draws a soft box over every block using this palette entry. */
  setHighlight(paletteIndex: number | null, limit = 30000) {
    if (this.highlight) {
      this.overlayGroup.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    const build = this.build;
    if (!build || paletteIndex === null || paletteIndex === 0) return;

    const positions: number[] = [];
    for (let i = 0; i < build.data.length && positions.length < limit * 3; i++) {
      if (build.data[i] !== paletteIndex) continue;
      const [x, y, z] = build.positionOf(i);
      if (y > this.yLimit) continue;
      positions.push(x + 0.5, y + 0.5, z + 0.5);
    }
    if (positions.length === 0) return;

    const count = positions.length / 3;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.06, 1.06, 1.06),
      new THREE.MeshBasicMaterial({
        color: HOVER_COLOR,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      count,
    );
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      matrix.setPosition(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 5;
    this.highlight = mesh;
    this.overlayGroup.add(mesh);
  }

  setSelection(box: { min: [number, number, number]; max: [number, number, number] } | null) {
    if (!box) {
      this.selectionBox.visible = false;
      this.selectionEdges.visible = false;
      return;
    }
    const size = [0, 1, 2].map((a) => box.max[a] - box.min[a] + 1) as [number, number, number];
    const center = [0, 1, 2].map((a) => box.min[a] + size[a] / 2) as [number, number, number];
    for (const object of [this.selectionBox, this.selectionEdges]) {
      object.scale.set(size[0], size[1], size[2]);
      object.position.set(center[0], center[1], center[2]);
      object.visible = true;
    }
  }

  /* ---------------------------------------------------------------- stairs */

  /**
   * Ghosts the flight the next click would lay down. Cells are drawn at three
   * sizes so the reading is immediate: full boxes for the cut steps, slightly
   * inset for the landings between them, small for whatever holds it up.
   */
  setStairPreview(
    cells: StairPreviewCell[] | null,
    anchor: [number, number, number] | null,
  ) {
    if (this.stairPreview) {
      this.overlayGroup.remove(this.stairPreview);
      this.stairPreview.geometry.dispose();
      (this.stairPreview.material as THREE.Material).dispose();
      this.stairPreview = null;
    }

    if (anchor) {
      this.stairAnchor.position.set(anchor[0] + 0.5, anchor[1] + 0.5, anchor[2] + 0.5);
      this.stairAnchor.visible = true;
    } else {
      this.stairAnchor.visible = false;
    }

    if (!cells || cells.length === 0) return;

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.42, depthWrite: false }),
      cells.length,
    );
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const color = new THREE.Color();
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const size = cell.kind === "step" ? 1 : cell.kind === "tread" ? 0.9 : 0.66;
      scale.setScalar(size);
      position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.setHex(STAIR_COLOR[cell.kind]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.renderOrder = 6;
    this.stairPreview = mesh;
    this.overlayGroup.add(mesh);
  }

  /* ----------------------------------------------------------------- floor */

  /** The slab the floor tool would lay, with its footprint written on it. */
  setFloorPreview(box: Box | null) {
    if (!box) {
      this.floorQuad.visible = false;
      this.floorEdges.visible = false;
      this.floorLabel.visible = false;
      return;
    }
    const size = [0, 1, 2].map((a) => box.max[a] - box.min[a] + 1) as [number, number, number];
    const centre = [0, 1, 2].map((a) => box.min[a] + size[a] / 2) as [number, number, number];
    for (const object of [this.floorQuad, this.floorEdges]) {
      object.scale.set(size[0], size[1], size[2]);
      object.position.set(centre[0], centre[1], centre[2]);
      object.visible = true;
    }
    this.floorLabel.element.textContent = `${size[0]} × ${size[2]}`;
    this.floorLabel.position.set(centre[0], box.max[1] + 1.2, centre[2]);
    this.floorLabel.visible = true;
  }

  /* ------------------------------------------------------------------ push */

  /**
   * Sets the push brush's cursor, or clears it with null. The shape is the
   * whole point of the tool — what it covers is what moves — so it is drawn as
   * the solid it is rather than as a single outlined cell.
   */
  setPushBrush(brush: { size: number; shape: BrushShape } | null) {
    const unchanged =
      brush && this.pushBrush &&
      brush.size === this.pushBrush.size && brush.shape === this.pushBrush.shape;
    this.pushBrush = brush;
    if (unchanged) return;

    this.disposePushCursor();
    if (brush) {
      const group = new THREE.Group();
      const shell = new THREE.MeshBasicMaterial({
        color: HOVER_COLOR, transparent: true, opacity: 0.1,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const line = new THREE.LineBasicMaterial({
        color: HOVER_COLOR, depthTest: false, transparent: true, opacity: 0.7,
      });
      if (brush.shape === "sphere") {
        const radius = brush.size / 2;
        group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), shell));
        // Three great circles rather than a wireframe: a full mesh of a sphere
        // this size is a smear, and the rings read as a ball from any angle.
        for (const turn of [null, "x", "y"] as const) {
          const ring = new THREE.Line(ringGeometry(radius), line);
          if (turn === "x") ring.rotation.x = Math.PI / 2;
          if (turn === "y") ring.rotation.y = Math.PI / 2;
          group.add(ring);
        }
      } else {
        const box = new THREE.BoxGeometry(brush.size, brush.size, brush.size);
        group.add(new THREE.Mesh(box, shell));
        group.add(new THREE.LineSegments(new THREE.EdgesGeometry(box), line));
      }
      group.renderOrder = 11;
      group.visible = false;
      this.pushCursor = group;
      this.overlayGroup.add(group);
    }
    // The pointer has not moved, so put the new cursor where the old one was.
    this.showHover(this.lastHit);
  }

  private disposePushCursor() {
    if (!this.pushCursor) return;
    this.overlayGroup.remove(this.pushCursor);
    for (const child of this.pushCursor.children) {
      const object = child as THREE.Mesh | THREE.Line;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
    this.pushCursor = null;
  }

  private movePushCursor(cell: { x: number; y: number; z: number } | null) {
    if (!this.pushCursor) return;
    if (!cell) {
      this.pushCursor.visible = false;
      return;
    }
    this.pushCursor.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.pushCursor.visible = true;
  }

  /* ------------------------------------------------------- through-select */

  /** Turns the drag-a-rectangle gesture on for the through-selection tool. */
  setMarquee(on: boolean) {
    this.marquee = on;
    if (!on) this.cancelMarquee();
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private drawMarquee(a: { x: number; y: number }, b: { x: number; y: number }) {
    const style = this.marqueeEl.style;
    style.left = `${Math.min(a.x, b.x)}px`;
    style.top = `${Math.min(a.y, b.y)}px`;
    style.width = `${Math.abs(b.x - a.x)}px`;
    style.height = `${Math.abs(b.y - a.y)}px`;
    style.display = "block";
  }

  private cancelMarquee() {
    this.marqueeStart = null;
    this.marqueeEl.style.display = "none";
  }

  private finishMarquee(end: { x: number; y: number }) {
    const start = this.marqueeStart;
    this.cancelMarquee();
    if (!start) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // A click with no drag still means "whatever is under this pixel", so the
    // rectangle is opened out far enough to catch something.
    const pad = Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3 ? 3 : 0;
    const left = Math.min(start.x, end.x) - pad;
    const right = Math.max(start.x, end.x) + pad;
    const top = Math.min(start.y, end.y) - pad;
    const bottom = Math.max(start.y, end.y) + pad;

    // Screen pixels to normalised device coordinates; y runs the other way.
    const min = new THREE.Vector2(
      (left / rect.width) * 2 - 1,
      -(bottom / rect.height) * 2 + 1,
    );
    const max = new THREE.Vector2(
      (right / rect.width) * 2 - 1,
      -(top / rect.height) * 2 + 1,
    );
    this.onMarquee(this.blocksInRect(min, max), this.marqueeAdditive);
  }

  /**
   * Every block whose centre falls inside a screen rectangle, whatever stands
   * in front of it, as the box round them.
   *
   * Occlusion is exactly the problem here: the inside of a tree cannot be
   * clicked because its own leaves are in the way. So this ignores the geometry
   * and walks the grid, projecting each block itself. Blocks above the layer
   * limit are left out — what is not drawn should not be caught.
   */
  private blocksInRect(min: THREE.Vector2, max: THREE.Vector2): ThroughSelection | null {
    const build = this.build;
    if (!build) return null;
    this.camera.updateMatrixWorld();
    const e = new THREE.Matrix4()
      .multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse)
      .elements;

    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let count = 0;
    const top = Math.min(this.yLimit, build.height - 1);

    for (let y = 0; y <= top; y++) {
      const cy = y + 0.5;
      for (let z = 0; z < build.length; z++) {
        const cz = z + 0.5;
        const row = (y * build.length + z) * build.width;
        // Everything but the x term of the projection is fixed along a row.
        const bx = e[4] * cy + e[8] * cz + e[12];
        const by = e[5] * cy + e[9] * cz + e[13];
        const bw = e[7] * cy + e[11] * cz + e[15];
        for (let x = 0; x < build.width; x++) {
          if (build.data[row + x] === 0) continue;
          const cx = x + 0.5;
          const w = bw + e[3] * cx;
          if (w <= 0) continue; // behind the camera
          const sx = (bx + e[0] * cx) / w;
          if (sx < min.x || sx > max.x) continue;
          const sy = (by + e[1] * cx) / w;
          if (sy < min.y || sy > max.y) continue;
          if (x < lo[0]) lo[0] = x;
          if (x > hi[0]) hi[0] = x;
          if (y < lo[1]) lo[1] = y;
          if (y > hi[1]) hi[1] = y;
          if (z < lo[2]) lo[2] = z;
          if (z > hi[2]) hi[2] = z;
          count++;
        }
      }
    }
    return count === 0 ? null : { min: lo, max: hi, count };
  }

  /* ---------------------------------------------------------------- mirror */

  /**
   * Sets the symmetry planes, or clears them with null. The planes are drawn
   * where the reflection actually happens — on a block boundary for an odd
   * pivot, down the middle of a column for an even one — because a plane drawn
   * half a block off is worse than no plane at all.
   */
  setMirror(config: MirrorConfig | null) {
    this.mirror = config;
    this.drawMirrorPlanes();
    this.showHover(this.lastHit);
  }

  private drawMirrorPlanes() {
    for (const child of this.mirrorGroup.children) {
      const object = child as THREE.Mesh;
      object.geometry?.dispose();
      (object.material as THREE.Material | undefined)?.dispose();
    }
    this.mirrorGroup.clear();

    const build = this.build;
    const config = this.mirror;
    if (!build || !config) return;

    const size = [build.width, build.height, build.length];
    const colors = [AXIS_COLOR.x, AXIS_COLOR.y, AXIS_COLOR.z];
    // Enough overhang that the plane reads as a plane rather than a lid, and
    // stays visible when the reflection sits outside the build.
    const pad = Math.max(2, Math.max(...size) * 0.08);

    for (let axis = 0; axis < 3; axis++) {
      if (!config.axes[axis]) continue;
      const at = planePosition(config.pivot[axis]);
      // The two axes the plane spans, and how big it is across them.
      const spans = [0, 1, 2].filter((a) => a !== axis);
      const geometry = new THREE.PlaneGeometry(
        size[spans[0]] + pad * 2,
        size[spans[1]] + pad * 2,
      );
      // PlaneGeometry faces +Z; turn it to face the mirrored axis.
      if (axis === 0) geometry.rotateY(Math.PI / 2);
      else if (axis === 1) geometry.rotateX(-Math.PI / 2);

      const centre = [size[0] / 2, size[1] / 2, size[2] / 2];
      centre[axis] = at;

      const material = new THREE.MeshBasicMaterial({
        color: colors[axis],
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const quad = new THREE.Mesh(geometry, material);
      quad.position.set(centre[0], centre[1], centre[2]);
      quad.renderOrder = 4;
      this.mirrorGroup.add(quad);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color: colors[axis], transparent: true, opacity: 0.5,
        }),
      );
      edges.position.copy(quad.position);
      this.mirrorGroup.add(edges);
    }
  }

  /** Outlines the cells the current stroke would also reach, mirrored. */
  private showMirrorCursors(cell: { x: number; y: number; z: number } | null) {
    const config = this.mirror;
    const images = config && cell
      ? mirrorImages(config, [cell.x, cell.y, cell.z])
      : [];

    for (let i = 0; i < images.length; i++) {
      let box = this.mirrorCursors[i];
      if (!box) {
        box = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
          new THREE.LineBasicMaterial({
            color: HOVER_COLOR, depthTest: false, transparent: true, opacity: 0.55,
          }),
        );
        box.renderOrder = 10;
        this.mirrorCursors.push(box);
        this.overlayGroup.add(box);
      }
      const [x, y, z] = images[i].position;
      box.position.set(x + 0.5, y + 0.5, z + 0.5);
      box.visible = !!this.build?.inBounds(x, y, z);
    }
    for (let i = images.length; i < this.mirrorCursors.length; i++) {
      this.mirrorCursors[i].visible = false;
    }
  }

  /* ----------------------------------------------------------- ruler lines */

  private measureA: [number, number, number] | null = null;
  private measureB: [number, number, number] | null = null;
  private centreBox: { min: [number, number, number]; max: [number, number, number] } | null = null;

  /**
   * The ruler: a straight line between the two marks, plus the three axis legs
   * that get you there, which is how a drawing dimensions a diagonal.
   */
  setMeasure(a: [number, number, number] | null, b: [number, number, number] | null) {
    this.measureA = a;
    this.measureB = b;
    this.rebuildGuides();
  }

  /** Draws the centre lines of a box, or clears them when given null. */
  setCentreGuides(box: { min: [number, number, number]; max: [number, number, number] } | null) {
    this.centreBox = box;
    this.rebuildGuides();
  }

  private clearGuides() {
    for (const child of this.guideGroup.children) {
      const object = child as THREE.Mesh | THREE.LineSegments;
      object.geometry?.dispose();
      const material = object.material as THREE.Material | undefined;
      material?.dispose();
    }
    this.guideGroup.clear();
  }

  private rebuildGuides() {
    this.clearGuides();
    this.drawMeasure();
    this.drawCentre();
  }

  /** Adds one coloured line to the guide group. */
  private guideLine(points: THREE.Vector3[], color: number, opacity = 1, onTop = true) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: opacity < 1 || onTop,
        opacity,
        depthTest: !onTop,
      }),
    );
    line.renderOrder = 14;
    this.guideGroup.add(line);
    return line;
  }

  private guideLabel(text: string, at: THREE.Vector3, className: string) {
    const object = label(text, className);
    object.position.copy(at);
    this.guideGroup.add(object);
  }

  /** A wireframe box over an inclusive block range, for marking cells. */
  private guideBox(
    min: [number, number, number],
    max: [number, number, number],
    color: number,
    opacity = 0.9,
  ) {
    const size = [0, 1, 2].map((a) => max[a] - min[a] + 1);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(size[0], size[1], size[2])),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }),
    );
    edges.position.set(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2);
    edges.renderOrder = 15;
    this.guideGroup.add(edges);
  }

  private drawMeasure() {
    const a = this.measureA;
    if (!a) return;
    const centre = (p: [number, number, number]) =>
      new THREE.Vector3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);

    this.guideBox(a, a, SELECT_COLOR);
    const b = this.measureB;
    if (!b) return;
    this.guideBox(b, b, SELECT_COLOR);

    const from = centre(a);
    const to = centre(b);
    this.guideLine([from, to], HOVER_COLOR, 0.95);

    // The staircase of axis legs, each drawn in its own axis colour so the
    // per-axis figures on the panel have something to point at.
    const legs: [THREE.Vector3, THREE.Vector3, number, string, number][] = [];
    const corner1 = new THREE.Vector3(to.x, from.y, from.z);
    const corner2 = new THREE.Vector3(to.x, to.y, from.z);
    legs.push([from, corner1, AXIS_COLOR.x, "dim-x", Math.abs(b[0] - a[0]) + 1]);
    legs.push([corner1, corner2, AXIS_COLOR.y, "dim-y", Math.abs(b[1] - a[1]) + 1]);
    legs.push([corner2, to, AXIS_COLOR.z, "dim-z", Math.abs(b[2] - a[2]) + 1]);

    for (const [start, end, color, className, span] of legs) {
      if (start.distanceToSquared(end) === 0) continue;
      this.guideLine([start, end], color, 0.75);
      this.guideLabel(
        `${span}`,
        start.clone().lerp(end, 0.5),
        `dim-label ${className}`,
      );
    }

    const straight = Math.sqrt(
      (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2,
    );
    this.guideLabel(
      straight.toFixed(2),
      from.clone().lerp(to, 0.5),
      "dim-label dim-rule",
    );
  }

  /**
   * Centre lines for a box. Blocks are cells, so an even span has its centre on
   * the seam between two of them — the lines land on the true centre and the
   * marked cells show which blocks straddle it.
   */
  private drawCentre() {
    const box = this.centreBox;
    if (!box) return;
    const size = [0, 1, 2].map((a) => box.max[a] - box.min[a] + 1);
    const centre = [0, 1, 2].map((a) => box.min[a] + size[a] / 2);
    const lo = box.min;
    const hi = [0, 1, 2].map((a) => box.max[a] + 1);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // The two ground lines and the mast where they cross: everything you need
    // to line a feature up on the middle of the build.
    this.guideLine([v(lo[0], lo[1], centre[2]), v(hi[0], lo[1], centre[2])], AXIS_COLOR.x, 0.85);
    this.guideLine([v(centre[0], lo[1], lo[2]), v(centre[0], lo[1], hi[2])], AXIS_COLOR.z, 0.85);
    this.guideLine([v(centre[0], lo[1], centre[2]), v(centre[0], hi[1], centre[2])], AXIS_COLOR.y, 0.85);

    // Half height, drawn as a ring around the box rather than a line, since the
    // vertical middle is a level rather than a direction.
    this.guideLine(
      [
        v(lo[0], centre[1], lo[2]), v(hi[0], centre[1], lo[2]),
        v(hi[0], centre[1], hi[2]), v(lo[0], centre[1], hi[2]),
        v(lo[0], centre[1], lo[2]),
      ],
      AXIS_COLOR.y,
      0.4,
    );

    const cells = (axis: 0 | 1 | 2) =>
      size[axis] % 2 === 0
        ? [box.min[axis] + size[axis] / 2 - 1, box.min[axis] + size[axis] / 2]
        : [box.min[axis] + (size[axis] - 1) / 2];
    const cx = cells(0);
    const cz = cells(2);
    this.guideBox([cx[0], box.min[1], cz[0]], [cx[cx.length - 1], box.min[1], cz[cz.length - 1]], SELECT_COLOR);

    const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
    this.guideLabel(`X ${fmt(centre[0])}`, v(centre[0], lo[1], hi[2]), "dim-label dim-x");
    this.guideLabel(`Z ${fmt(centre[2])}`, v(hi[0], lo[1], centre[2]), "dim-label dim-z");
    this.guideLabel(`Y ${fmt(centre[1])}`, v(centre[0], centre[1], hi[2]), "dim-label dim-y");
  }

  /* ----------------------------------------------------------------- input */

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (this.mode === "fly" && document.pointerLockElement === this.renderer.domElement) {
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= event.movementX * 0.0022;
      this.euler.x -= event.movementY * 0.0022;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
      return;
    }
    if (this.marqueeStart) {
      this.drawMarquee(this.marqueeStart, this.localPoint(event));
      return;
    }
    const hit = this.pick();
    this.showHover(this.editing ? hit : null);
    this.onHover(hit);
    if (this.painting && hit) this.onPick(hit, event);
  };

  private painting = false;

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (this.mode === "fly") {
      // Denied pointer lock is fine — WASD still works, only mouse-look stops.
      Promise.resolve(this.renderer.domElement.requestPointerLock()).catch(() => {});
      return;
    }
    if (this.marquee) {
      this.marqueeStart = this.localPoint(event);
      this.marqueeAdditive = event.shiftKey;
      this.drawMarquee(this.marqueeStart, this.marqueeStart);
      // Captured so the rectangle keeps growing when the drag leaves the canvas
      // — half of what you want to select is usually against an edge. Losing
      // the capture only costs that; the drag still works inside the canvas.
      try {
        this.renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        /* no such pointer: synthetic events, and some pen hardware */
      }
      return;
    }
    const hit = this.pick();
    if (!hit) return;
    this.painting = true;
    this.onStrokeStart();
    this.onPick(hit, event);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (this.marqueeStart) {
      this.finishMarquee(this.localPoint(event));
      return;
    }
    if (!this.painting) return;
    this.painting = false;
    this.onStrokeEnd();
  };

  private onPointerLeave = () => {
    // A captured marquee drag is meant to run past the edge.
    if (this.marqueeStart) return;
    if (this.painting) {
      this.painting = false;
      this.onStrokeEnd();
    }
    this.showHover(null);
    this.onHover(null);
  };

  private onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (this.mode === "fly" && ["Space", "ShiftLeft"].includes(event.code)) event.preventDefault();
  };
  private onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
  private onBlur = () => this.keys.clear();

  private attachInput() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private detachInput() {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  /**
   * Raycasts the pointer against the built geometry. With the layer plane
   * locked the plane takes the hit instead, which is what makes drawing a
   * whole flat course possible — otherwise every block would land on whatever
   * happened to be underneath it.
   */
  pick(): BlockHit | null {
    if (!this.build) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // A drag in progress owns the pointer: the tool decided where its plane is
    // when the button went down and nothing under the cursor may move it since.
    if (this.dragPick) return this.pickDrag();
    if (this.placing && this.planeLock) {
      const onPlane = this.pickPlane();
      if (onPlane) return onPlane;
    }
    const meshes: THREE.Mesh[] = [];
    for (const chunk of this.chunks) {
      for (const mesh of chunk.meshes) if (mesh) meshes.push(mesh);
    }
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const quadBlocks = hit.object.userData.quadBlocks as Uint32Array | undefined;
      if (!quadBlocks || hit.faceIndex == null) continue;
      const index = quadBlocks[hit.faceIndex >> 1];
      if (index === undefined) continue;
      const [x, y, z] = this.build.positionOf(index);
      const normal = hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
      return this.describeHit(index, x, y, z, normal, false);
    }
    // Nothing to hit. A floor has to be startable over open ground, so it falls
    // to the ground itself — the layer plane defaults to the top of the build,
    // which is the last place anybody means when they point at thin air. The
    // layer plane is still there for the asking, under the plane lock.
    return this.planeFallback ? this.pickPlane(0) : null;
  }

  /**
   * Fixes hit-testing to a plane for the length of a drag. `level` keeps the
   * floor on the course it started on however the pointer wanders; `screen`
   * hangs a plane in front of the camera through the block that was grabbed, so
   * the push brush follows the mouse in the two directions the screen has.
   */
  beginDragPick(kind: "level" | "screen", at: [number, number, number]) {
    const point = new THREE.Vector3(at[0] + 0.5, at[1] + 0.5, at[2] + 0.5);
    const normal = kind === "level"
      ? new THREE.Vector3(0, 1, 0)
      : this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPick = {
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point),
      level: kind === "level" ? at[1] : null,
    };
  }

  endDragPick() {
    this.dragPick = null;
  }

  /** Where the ray crosses the drag plane, clamped into the build. */
  private pickDrag(): BlockHit | null {
    const build = this.build;
    const drag = this.dragPick;
    if (!build || !drag) return null;
    const point = this.raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
    if (!point) return null;
    // Clamped rather than dropped: a drag that runs off the side should stop at
    // the wall, not stop reporting.
    const clamp = (value: number, span: number) =>
      Math.max(0, Math.min(span - 1, Math.floor(value)));
    const x = clamp(point.x, build.width);
    const y = drag.level ?? clamp(point.y, build.height);
    const z = clamp(point.z, build.length);
    return this.describeHit(build.index(x, y, z), x, y, z, new THREE.Vector3(0, 1, 0), true);
  }

  /** Where the ray crosses a horizontal plane; the current layer by default. */
  private pickPlane(level?: number): BlockHit | null {
    const build = this.build;
    if (!build) return null;
    const y = Math.min(level ?? this.yLimit, build.height - 1);
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    if (Math.abs(direction.y) < 1e-6) return null;
    const t = (y - origin.y) / direction.y;
    if (t <= 0) return null;
    const x = Math.floor(origin.x + direction.x * t);
    const z = Math.floor(origin.z + direction.z * t);
    if (!build.inBounds(x, y, z)) return null;
    // The plane cell is the target itself, so the normal only steers the clip.
    return this.describeHit(build.index(x, y, z), x, y, z, new THREE.Vector3(0, 1, 0), true);
  }

  private describeHit(
    index: number, x: number, y: number, z: number,
    normal: THREE.Vector3, onPlane: boolean,
  ): BlockHit {
    const build = this.build!;
    const nx = onPlane ? 0 : Math.round(normal.x);
    const ny = onPlane ? 0 : Math.round(normal.y);
    const nz = onPlane ? 0 : Math.round(normal.z);
    const px = x + nx, py = y + ny, pz = z + nz;
    const place = build.inBounds(px, py, pz)
      ? { x: px, y: py, z: pz, index: build.index(px, py, pz) }
      : null;

    let clipOrigin: [number, number, number] | null = null;
    if (this.clipSize) {
      // A clip grows away from the face it was dropped against, so stamping on
      // a west-facing wall hangs it off that wall instead of inside it.
      // Stamping through anchors on the hit block instead, so the clip can land
      // where blocks already sit and paint over them.
      const [w, h, l] = this.clipSize;
      const ax = this.clipThrough ? x : px;
      const ay = this.clipThrough ? y : py;
      const az = this.clipThrough ? z : pz;
      clipOrigin = [
        ax - (nx < 0 ? w - 1 : 0),
        ay - (ny < 0 ? h - 1 : 0) + this.clipLift,
        az - (nz < 0 ? l - 1 : 0),
      ];
    }
    return { index, x, y, z, normal, place, clipOrigin, onPlane };
  }

  /** The hit the cursor was last drawn from, so overlays can be redrawn. */
  private lastHit: BlockHit | null = null;

  private showHover(hit: BlockHit | null) {
    this.lastHit = hit;
    if (!hit) {
      this.hoverBox.visible = false;
      this.showMirrorCursors(null);
      this.movePushCursor(null);
      return;
    }
    // Placement tools outline the cell that would be filled, not the one under
    // the pointer — otherwise the cursor sits one block off what it writes.
    const cell = this.placing && !this.clipSize && hit.place ? hit.place : hit;
    if (this.placing && !this.clipSize && !hit.place) {
      this.hoverBox.visible = false;
      this.showMirrorCursors(null);
      this.movePushCursor(null);
      return;
    }
    // The clip ghost and the push brush are cursors in their own right; a cell
    // outline underneath either of them is noise.
    const plain = !this.clipSize && !this.pushCursor;
    this.hoverBox.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.hoverBox.visible = plain;
    this.showMirrorCursors(plain ? cell : null);
    this.movePushCursor(cell);
  }

  /** Marks the tool as one that writes into empty space. */
  setPlacing(placing: boolean) {
    this.placing = placing;
    this.updatePlane();
    if (!placing) this.setGhost(null);
  }

  /** Locks placement to the plane at the current layer height. */
  setPlaneLock(locked: boolean) {
    this.planeLock = locked;
    this.updatePlane();
  }

  /** Lets a tool start on the layer plane where the ray hits no blocks at all. */
  setPlaneFallback(on: boolean) {
    this.planeFallback = on;
  }

  /** Tells the viewer how big the clone tool's stamp is, or null when idle. */
  setClipSize(size: [number, number, number] | null) {
    this.clipSize = size;
    if (!size) this.setGhost(null);
  }

  /** Stamp on the block under the pointer rather than against its face. */
  setClipThrough(through: boolean) {
    this.clipThrough = through;
  }

  /** Height the pointer-driven stamp floats at, in blocks above the face. */
  setClipLift(lift: number) {
    if (lift === this.clipLift) return;
    this.clipLift = lift;
    // The ghost has to jump right away: the hand raising it is on the keyboard,
    // so there is no pointer move coming to redraw it.
    this.refreshHover();
  }

  /**
   * The world axes that "right" and "away" mean from where the camera stands,
   * snapped to the grid — so nudging a stamp with the arrow keys moves it the
   * way the screen says rather than the way the axes happen to lie.
   */
  screenAxes(): { right: [number, number, number]; forward: [number, number, number] } {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const snap = (x: number, z: number): [number, number, number] =>
      Math.abs(x) >= Math.abs(z)
        ? [Math.sign(x) || 1, 0, 0]
        : [0, 0, Math.sign(z) || 1];
    const away = snap(forward.x, forward.z);
    // Right is the away vector turned a quarter clockwise about Y.
    return { right: [-away[2], 0, away[0]], forward: away };
  }

  /**
   * Re-picks from the pointer where it already is, for option changes that
   * move the stamp without the mouse moving.
   */
  refreshHover() {
    const hit = this.pick();
    this.showHover(this.editing ? hit : null);
    this.onHover(hit);
  }

  /** Preview box for the clone tool's next stamp. */
  setGhost(origin: [number, number, number] | null, fits = true) {
    if (!origin || !this.clipSize) {
      this.ghostBox.visible = false;
      this.ghostEdges.visible = false;
      return;
    }
    const [w, h, l] = this.clipSize;
    const color = fits ? GHOST_COLOR : GHOST_BAD_COLOR;
    for (const object of [this.ghostBox, this.ghostEdges]) {
      object.scale.set(w, h, l);
      object.position.set(origin[0] + w / 2, origin[1] + h / 2, origin[2] + l / 2);
      object.visible = true;
      (object.material as THREE.MeshBasicMaterial | THREE.LineBasicMaterial).color.setHex(color);
    }
  }

  private updatePlane() {
    const build = this.build;
    if (!build || !this.placing || !this.planeLock) {
      this.planeQuad.visible = false;
      return;
    }
    const y = Math.min(this.yLimit, build.height - 1);
    this.planeQuad.scale.set(build.width, 1, build.length);
    this.planeQuad.position.set(build.width / 2, y + 0.002, build.length / 2);
    this.planeQuad.visible = true;
  }

  /**
   * With an edit tool active, left-drag belongs to the tool, so orbiting moves
   * to the right button and panning to the middle one.
   */
  setEditing(editing: boolean) {
    this.editing = editing;
    this.controls.mouseButtons = editing
      ? { LEFT: undefined, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    if (!editing) {
      this.hoverBox.visible = false;
      this.showMirrorCursors(null);
      this.movePushCursor(null);
    }
  }

  private editing = false;

  /* ---------------------------------------------------------------- camera */

  setCameraMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    if (mode === "orbit") {
      document.exitPointerLock?.();
      this.controls.target.copy(
        this.camera.position.clone().add(this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(16)),
      );
      this.controls.update();
    }
    this.hoverBox.visible = false;
    this.movePushCursor(null);
  }

  /** Points the camera at the whole build from a three-quarter angle. */
  frameBuild() {
    const build = this.build;
    if (!build) return;
    const center = new THREE.Vector3(build.width / 2, build.height / 2, build.length / 2);
    const radius = Math.max(build.width, build.height, build.length);
    const distance = radius * 1.25 + 6;
    this.camera.position.set(
      center.x + distance * 0.75,
      center.y + distance * 0.55,
      center.z + distance * 0.85,
    );
    this.controls.target.copy(center);
    this.camera.lookAt(center);
    this.controls.update();
    this.flySpeed = Math.max(8, radius / 4);
  }

  private updateFly(dt: number) {
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has("KeyW")) move.add(forward);
    if (this.keys.has("KeyS")) move.sub(forward);
    if (this.keys.has("KeyD")) move.add(right);
    if (this.keys.has("KeyA")) move.sub(right);
    if (this.keys.has("Space")) move.y += 1;
    if (this.keys.has("ShiftLeft") || this.keys.has("ControlLeft")) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const speed = this.flySpeed * (this.keys.has("KeyR") ? 3 : 1);
    this.camera.position.addScaledVector(move.normalize(), speed * dt);
  }

  private loop = () => {
    this.frameHandle = requestAnimationFrame(this.loop);
    const now = performance.now();
    // Capped so a backgrounded tab doesn't teleport the camera on return.
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    if (this.mode === "fly") this.updateFly(dt);
    else this.controls.update();
    this.updateFrameCorner();

    // Nothing can be meshed before the palette has been baked, and an edit that
    // grew the palette leaves the old bake short until the new one lands. In
    // both cases leave the queue alone rather than draining it into nothing.
    if (this.dirtyQueue.length && this.bakeCoversBuild()) {
      const deadline = performance.now() + MESH_BUDGET_MS;
      while (this.dirtyQueue.length && performance.now() < deadline) {
        const chunk = this.dirtyQueue.shift()!;
        chunk.queued = false;
        if (chunk.dirty) this.meshChunk(chunk);
      }
      this.onProgress(this.dirtyQueue.length);
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
}
