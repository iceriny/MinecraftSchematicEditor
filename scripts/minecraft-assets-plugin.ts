/**
 * Dev-server plugin that lets the app find the user's own Minecraft install.
 *
 * Nothing is copied into the project and nothing is redistributed — the jar is
 * read from where the launcher already put it and served over localhost to the
 * page that asked for it. Dev only; a built copy falls back to the file picker
 * or to whatever it previously cached.
 *
 * Only jars discovered by the scan can be served, and only under the exact id
 * the scan reported, so a crafted request can't reach an arbitrary path.
 */

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import type { ServerResponse } from "node:http";

interface FoundVersion {
  id: string;
  path: string;
  size: number;
  modified: number;
}

/**
 * Standard launcher locations, plus an override for everyone else. Each is a
 * directory holding a `versions/<id>/<id>.jar` tree.
 *
 * Third-party launchers are here because that is where a modded profile's
 * Minecraft actually lives: the vanilla jar the mods were built against is the
 * one in the launcher's own install folder, not whichever version the official
 * launcher last downloaded.
 */
function minecraftDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.MINECRAFT_DIR) dirs.push(process.env.MINECRAFT_DIR);
  if (process.platform === "win32") {
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, ".minecraft"));
    dirs.push(join(homedir(), "curseforge", "minecraft", "Install"));
  } else if (process.platform === "darwin") {
    dirs.push(join(homedir(), "Library", "Application Support", "minecraft"));
    dirs.push(join(homedir(), "curseforge", "minecraft", "Install"));
  } else {
    dirs.push(join(homedir(), ".minecraft"));
    dirs.push(join(homedir(), "curseforge", "minecraft", "Install"));
  }
  return dirs;
}

/** Directories whose immediate children are modded instances. */
function instanceRoots(): string[] {
  const roots: string[] = [];
  if (process.env.MINECRAFT_INSTANCES) roots.push(process.env.MINECRAFT_INSTANCES);
  roots.push(join(homedir(), "curseforge", "minecraft", "Instances"));
  if (process.platform === "win32") {
    if (process.env.APPDATA) {
      roots.push(join(process.env.APPDATA, "PrismLauncher", "instances"));
      roots.push(join(process.env.APPDATA, "ModrinthApp", "profiles"));
    }
  } else if (process.platform === "darwin") {
    const support = join(homedir(), "Library", "Application Support");
    roots.push(join(support, "PrismLauncher", "instances"));
    roots.push(join(support, "ModrinthApp", "profiles"));
  } else {
    roots.push(join(homedir(), ".local", "share", "PrismLauncher", "instances"));
    roots.push(join(homedir(), ".local", "share", "ModrinthApp", "profiles"));
  }
  return roots;
}

/** `1.21.11` -> [1, 21, 11]; anything else has no key and sorts last. */
function versionKey(id: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(id);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function compareVersions(a: FoundVersion, b: FoundVersion): number {
  // Plain version directories first — a modded profile's jar may be patched.
  const ka = versionKey(a.id);
  const kb = versionKey(b.id);
  if (ka && !kb) return -1;
  if (!ka && kb) return 1;
  if (ka && kb) {
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
  }
  return b.modified - a.modified;
}

/** A jar has to be big enough to plausibly hold the asset tree. */
const MIN_JAR_BYTES = 2 * 1024 * 1024;

async function scan(): Promise<FoundVersion[]> {
  const found: FoundVersion[] = [];
  for (const root of minecraftDirs()) {
    const versions = join(root, "versions");
    let entries;
    try {
      entries = await readdir(versions, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(versions, entry.name, `${entry.name}.jar`);
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size < MIN_JAR_BYTES) continue;
        found.push({ id: entry.name, path, size: info.size, modified: info.mtimeMs });
      } catch {
        // No jar for this profile; skip it.
      }
    }
  }
  found.sort(compareVersions);
  // Two launchers can hold the same version; the menu should list it once.
  // Post-sort, so the copy that survives is the one the ordering preferred.
  const byId = new Map<string, FoundVersion>();
  for (const version of found) if (!byId.has(version.id)) byId.set(version.id, version);
  return [...byId.values()];
}

/* -------------------------------------------------------------- instances */

interface FoundInstance {
  id: string;
  name: string;
  modsPath: string;
  mods: { file: string; size: number }[];
}

/** Where a launcher puts an instance's `mods` folder, in the order to try. */
const MODS_SUBPATHS = ["mods", join(".minecraft", "mods"), join("minecraft", "mods")];

async function findModsDir(instanceDir: string): Promise<string | null> {
  for (const sub of MODS_SUBPATHS) {
    const path = join(instanceDir, sub);
    try {
      if ((await stat(path)).isDirectory()) return path;
    } catch {
      // Not this layout; try the next.
    }
  }
  return null;
}

/**
 * Modded profiles with at least one jar in them. The instance folder's own name
 * is the id, which is unique in practice — a launcher can't hold two instances
 * with the same folder name either.
 */
async function scanInstances(): Promise<FoundInstance[]> {
  const found: FoundInstance[] = [];
  const seen = new Set<string>();
  for (const root of instanceRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || seen.has(entry.name)) continue;
      const modsPath = await findModsDir(join(root, entry.name));
      if (!modsPath) continue;

      let files;
      try {
        files = await readdir(modsPath, { withFileTypes: true });
      } catch {
        continue;
      }
      const mods: { file: string; size: number }[] = [];
      for (const file of files) {
        if (!file.isFile() || !file.name.toLowerCase().endsWith(".jar")) continue;
        try {
          mods.push({ file: file.name, size: (await stat(join(modsPath, file.name))).size });
        } catch {
          // Vanished between the listing and the stat.
        }
      }
      if (mods.length === 0) continue;
      mods.sort((a, b) => a.file.localeCompare(b.file));
      seen.add(entry.name);
      found.push({ id: entry.name, name: entry.name, modsPath, mods });
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function minecraftAssets(): Plugin {
  return {
    name: "minecraft-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__mc/versions", async (_req, res) => {
        try {
          const versions = await scan();
          sendJson(res, 200, {
            versions: versions.map(({ id, size, modified }) => ({ id, size, modified })),
          });
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      });

      server.middlewares.use("/__mc/jar", async (req, res) => {
        const id = new URL(req.url ?? "", "http://localhost").searchParams.get("id");
        if (!id) return sendJson(res, 400, { error: "Missing ?id=" });

        const match = (await scan()).find((version) => version.id === id);
        if (!match) return sendJson(res, 404, { error: `No installed version named ${id}` });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/java-archive");
        res.setHeader("Content-Length", String(match.size));
        res.setHeader("Cache-Control", "no-store");
        createReadStream(match.path)
          .on("error", () => res.destroy())
          .pipe(res);
      });

      server.middlewares.use("/__mc/instances", async (_req, res) => {
        try {
          const instances = await scanInstances();
          sendJson(res, 200, {
            instances: instances.map(({ id, name, mods }) => ({ id, name, mods })),
          });
        } catch (error) {
          sendJson(res, 500, { error: String(error) });
        }
      });

      // As with the version jars: only a file the scan itself reported can be
      // served, and only under the exact name it reported, so neither parameter
      // can be steered at a path of the caller's choosing.
      server.middlewares.use("/__mc/mod", async (req, res) => {
        const query = new URL(req.url ?? "", "http://localhost").searchParams;
        const instanceId = query.get("instance");
        const file = query.get("file");
        if (!instanceId || !file) return sendJson(res, 400, { error: "Missing ?instance= or ?file=" });

        const instance = (await scanInstances()).find((entry) => entry.id === instanceId);
        if (!instance) return sendJson(res, 404, { error: `No instance named ${instanceId}` });
        const mod = instance.mods.find((entry) => entry.file === file);
        if (!mod) return sendJson(res, 404, { error: `${instanceId} has no mod named ${file}` });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/java-archive");
        res.setHeader("Content-Length", String(mod.size));
        res.setHeader("Cache-Control", "no-store");
        createReadStream(join(instance.modsPath, mod.file))
          .on("error", () => res.destroy())
          .pipe(res);
      });
    },
  };
}
