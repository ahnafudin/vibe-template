// scripts/lib/glob.mjs — the tiny path expander both the registry and the
// version syncer need.
//
// `*` is allowed in ANY segment but never crosses a `/`. That matters: the Ktor
// entry matched nothing at all in a real Gradle project because the pattern
// could only look at the repository root, while `gradle init` puts the build
// file in `app/`. Detection and version syncing had separate expanders, one of
// which handled a middle-segment wildcard and one of which did not — so they are
// one function now.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".git", "target", "vendor", "dist", "build", ".venv"]);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function segmentMatcher(segment) {
  return new RegExp(`^${segment.split("*").map(escapeRe).join("[^/]*")}$`, "i");
}

/** Every existing path under `base` matching the `/`-split `segments`. */
export function expandSegments(base, segments) {
  if (segments.length === 0) return [base];
  const [head, ...rest] = segments;
  if (!head.includes("*")) {
    const next = join(base, head);
    return existsSync(next) ? expandSegments(next, rest) : [];
  }
  const re = segmentMatcher(head);
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return []; // unreadable directory — nothing to match there
  }
  const out = [];
  for (const e of entries) {
    if (!re.test(e.name) || SKIP.has(e.name)) continue;
    const next = join(base, e.name);
    if (rest.length === 0) out.push(next);
    else if (e.isDirectory()) out.push(...expandSegments(next, rest));
  }
  return out;
}

/** Existing paths under `root` matching one repo-relative glob pattern. */
export function expandGlob(root, pattern) {
  return expandSegments(root, pattern.split("/"));
}

export function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
