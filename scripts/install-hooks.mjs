#!/usr/bin/env node
// scripts/install-hooks.mjs — point git at the committed `.githooks/` folder so
// the auto-version hook (post-commit) runs on every commit. Idempotent and
// fail-soft: a non-git checkout / a machine without git simply skips. Run by
// `postinstall` and exposed as `npm run hooks:install`.
//
// Safety guards (each closes a real, reproduced failure):
//   - toplevel check: when this folder sits INSIDE another repository (zip/degit
//     copy into a monorepo without its own .git), a naive install would write
//     core.hooksPath into the PARENT repo and silently disable all of its hooks.
//   - foreign hooksPath: never clobber an existing hook manager (husky, lefthook…).
//   - beads: `bd init` moves core.hooksPath to `.beads/hooks` and CHAINS this
//     hook — expected; leave it alone, but warn if the chain lost our hook.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_DIR = join(ROOT, ".githooks");
const HOOK = "post-commit";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function note(message) {
  process.stderr.write(`[hooks] ${message}\n`);
}

/** Normalized for comparison: git prints forward-slash paths on Windows, and
 *  drive-letter case can differ. */
function norm(p) {
  const r = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

let toplevel;
try {
  toplevel = git(["rev-parse", "--show-toplevel"]);
} catch {
  note("not a git work tree — skipping hook install");
  process.exit(0);
}

if (norm(toplevel) !== norm(ROOT)) {
  note(`this folder sits inside another repository (${toplevel}) — skipping hook install`);
  note("run `git init` here first if this is meant to be its own repo, then `npm run setup`.");
  process.exit(0);
}

if (!existsSync(join(HOOK_DIR, HOOK))) {
  note(`.githooks/${HOOK} missing — skipping`);
  process.exit(0);
}

try {
  let current = "";
  try {
    current = git(["config", "--get", "core.hooksPath"]);
  } catch {
    current = "";
  }
  if (current === ".githooks") {
    note("already installed (core.hooksPath=.githooks)");
  } else if (current.endsWith(".beads/hooks") || current.endsWith(".beads\\hooks")) {
    // beads owns the chain — verify our hook actually survived inside it.
    const chained = join(ROOT, ".beads", "hooks", HOOK);
    if (existsSync(chained) && readFileSync(chained, "utf8").includes("version.mjs")) {
      note(`beads owns the hook chain (${current}) — version hook is chained, leaving as is`);
    } else {
      note(`WARNING: beads owns the hook chain (${current}) but the auto-version ${HOOK} hook`);
      note(`is NOT chained there. Re-run \`bd init\` on a clean tree, or copy .githooks/${HOOK}`);
      note("into .beads/hooks/ (bd chains pre-existing hooks only when they exist at init time).");
    }
  } else if (current) {
    note(`core.hooksPath is already "${current}" (another hook manager?) — not overwriting.`);
    note(`to enable the auto-version hook manually: git config core.hooksPath .githooks`);
  } else {
    git(["config", "core.hooksPath", ".githooks"]);
    note("installed: core.hooksPath → .githooks");
  }
  // Best-effort exec bit (required on POSIX; a no-op on Windows).
  try {
    chmodSync(join(HOOK_DIR, HOOK), 0o755);
  } catch {
    /* ignore — Windows / restricted FS */
  }
} catch (e) {
  note(`install skipped: ${e instanceof Error ? e.message : String(e)}`);
}
