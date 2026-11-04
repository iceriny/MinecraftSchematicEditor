import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, link, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Publish complete bytes; replacing a file never truncates the existing destination. */
export async function publishFile(path: string, bytes: Uint8Array, overwrite = false): Promise<void> {
  const staged = join(dirname(path), `.schematic-${randomUUID()}.tmp`);
  const file = await open(staged, "wx");
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    if (overwrite) {
      await rename(staged, path);
      return;
    }
    try {
      await link(staged, path);
    } catch (cause) {
      // FAT/exFAT and some network volumes do not implement hard links.
      const code = (cause as NodeJS.ErrnoException).code ?? "";
      if (!["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EPERM", "EINVAL"].includes(code)) throw cause;
      await copyFile(staged, path, constants.COPYFILE_EXCL);
    }
  } finally {
    // A successful rename already consumed the staging name.
    await unlink(staged).catch(() => {});
  }
}
