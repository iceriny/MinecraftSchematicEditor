/** Triangles and quads from a NeoForge OBJ model, in block units and texture-space UVs. */
export interface MeshFace {
  positions: number[][];
  uv: number[][];
  texture: string;
}

function index(value: string, length: number): number {
  const n = Number(value);
  return n < 0 ? length + n : n - 1;
}

export function readObj(files: Map<string, string>, path: string, flipV: boolean): MeshFace[] {
  const source = files.get(path);
  if (!source) return [];
  const positions: number[][] = [], uvs: number[][] = [], faces: MeshFace[] = [];
  const textures = new Map<string, string>();
  let material = "";
  for (const line of source.split(/\r?\n/)) {
    const [op, ...args] = line.trim().split(/\s+/);
    if (op === "v") positions.push(args.slice(0, 3).map(Number));
    if (op === "vt") uvs.push([Number(args[0]), flipV ? 1 - Number(args[1]) : Number(args[1])]);
    if (op === "mtllib") {
      const library = files.get(path.slice(0, path.lastIndexOf("/") + 1) + args[0]);
      let name = "";
      for (const entry of (library ?? "").split(/\r?\n/)) {
        const [directive, value] = entry.trim().split(/\s+/);
        if (directive === "newmtl") name = value;
        if (directive === "map_Kd") textures.set(name, value);
      }
    }
    if (op === "usemtl") material = args[0];
    if (op !== "f" || args.length < 3) continue;
    const corners = args.map(ref => {
      const [v, vt] = ref.split("/");
      return {pos: positions[index(v, positions.length)], uv: uvs[index(vt, uvs.length)]};
    });
    if (corners.some(c => !c.pos || !c.uv)) continue;
    for (let i = 1; i + 1 < corners.length; i++) {
      // The mesher consumes quads. Repeating the final vertex yields one triangle.
      const quad = [corners[0], corners[i], corners[i + 1], corners[i + 1]];
      faces.push({positions: quad.map(c => c.pos), uv: quad.map(c => c.uv), texture: textures.get(material) ?? ""});
    }
  }
  return faces;
}
