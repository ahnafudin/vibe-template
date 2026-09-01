#!/usr/bin/env node
// scripts/install-hooks.mjs — point git at the committed `.githooks/` folder so
// the auto-version hook (post-commit) runs on every commit. Idempotent and
// fail-soft: a non-git checkout / a machine without git simply skips. Run by
// `postinstall` and exposed as `npm run hooks:install`.
//
// Safety guards (each closes a real, reproduced failure):
//   - dubious ownership: git refuses EVERY command with exit 128 when the repo
//     is owned by another user/SID (common on Windows after a drive move or a
//     reinstall). Reporting that as "not a git work tree" would send someone to
//     `git init` on top of an existing repo — so name the real cause instead.
//   - toplevel check: when this folder sits INSIDE another repository (zip/degit
//     copy into a monorepo without its own .git), a naive install would write
//     core.hooksPath into the PARENT repo and silently disable all of its hooks.
//   - foreign hooksPath: never clobber an existing hook manager (husky, lefthook…).
//   - beads: `bd init` moves core.hooksPath to `.beads/hooks` and CHAINS this
//     hook — expected; leave it alone, but warn if the chain lost our hook.

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { at, git, norm, note as write, ROOT, safeDirectoryHint } from "./lib/util.mjs";

const HOOK_DIR = at(".githooks");
const HOOK = "post-commit";

const note = (msg) => write(msg, "[hooks] ");

const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    note("git refuses to read this repository: it is owned by a different user account.");
    note("This is NOT a missing repo — do not run `git init`. Fix the ownership exception:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    note("not a git work tree — skipping hook install");
  }
  process.exit(0);
}

if (norm(toplevel.out) !== norm(ROOT)) {
  note(`this folder sits inside another repository (${toplevel.out}) — skipping hook install`);
  note("run `git init` here first if this is meant to be its own repo, then `npm run setup`.");
  process.exit(0);
}

if (!existsSync(join(HOOK_DIR, HOOK))) {
  note(`.githooks/${HOOK} missing — skipping`);
  process.exit(0);
}

const current = git(["config", "--get", "core.hooksPath"]);
const hooksPath = current.ok ? current.out : "";

if (hooksPath === ".githooks") {
  note("already installed (core.hooksPath=.githooks)");
} else if (hooksPath.endsWith(".beads/hooks") || hooksPath.endsWith(".beads\\hooks")) {
  // beads owns the chain — verify our hook actually survived inside it (either
  // the full hook text, or a delegator pointing at .githooks/).
  const chained = at(".beads", "hooks", HOOK);
  const chainedBody = existsSync(chained) ? readFileSync(chained, "utf8") : "";
  if (chainedBody.includes("version.mjs") || chainedBody.includes(`.githooks/${HOOK}`)) {
    note(`beads owns the hook chain (${hooksPath}) — version hook is chained, leaving as is`);
  } else {
    note(`WARNING: beads owns the hook chain (${hooksPath}) but the auto-version ${HOOK} hook`);
    note(`is NOT chained there. Re-run \`bd init\` on a clean tree, or copy .githooks/${HOOK}`);
    note("into .beads/hooks/ (bd chains pre-existing hooks only when they exist at init time).");
  }
} else if (hooksPath) {
  note(`core.hooksPath is already "${hooksPath}" (another hook manager?) — not overwriting.`);
  note("to enable the auto-version hook manually: git config core.hooksPath .githooks");
} else {
  const set = git(["config", "core.hooksPath", ".githooks"]);
  note(set.ok ? "installed: core.hooksPath → .githooks" : `install skipped: ${set.out}`);
}

// Best-effort exec bit (required on POSIX; a no-op on Windows).
try {
  chmodSync(join(HOOK_DIR, HOOK), 0o755);
} catch {
  /* ignore — Windows / restricted FS */
}
