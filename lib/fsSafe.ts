import { resolve, join, sep } from "node:path";
import { realpathSync } from "node:fs";

export class PathTraversalError extends Error {
  constructor(userPath: string) {
    super(`Path escapes root: ${userPath}`);
    this.name = "PathTraversalError";
  }
}

export function resolveSafe(rootDir: string, userPath: string): string {
  const root = resolve(rootDir);
  const candidate = resolve(join(root, userPath));

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new PathTraversalError(userPath);
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    realRoot = root;
  }

  let checkPath = candidate;
  while (true) {
    try {
      const real = realpathSync(checkPath);
      const suffix = candidate.slice(checkPath.length);
      const realCandidate = suffix ? join(real, suffix) : real;
      if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
        throw new PathTraversalError(userPath);
      }
      break;
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      const parent = resolve(checkPath, "..");
      if (parent === checkPath) break;
      checkPath = parent;
    }
  }

  return candidate;
}
