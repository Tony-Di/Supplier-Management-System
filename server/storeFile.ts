import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Reads the store file. Returns undefined when it has never been written.
 *
 * A file that exists but cannot be parsed throws: the records are still in
 * there, and starting from an empty store would overwrite them on the next
 * save.
 */
export function readStoreFile(path: string): unknown {
  if (!existsSync(path)) return undefined;

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read the store file at ${path}: ${(error as Error).message}. ` +
        "Fix or move the file before starting the API — starting fresh would overwrite it.",
    );
  }
}

/**
 * Writes the store to a temporary file first and renames it into place, so an
 * interrupted write cannot leave a half-written store behind.
 */
export function writeStoreFile(path: string, store: unknown) {
  const contents = `${JSON.stringify(store, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, "utf8");
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}
