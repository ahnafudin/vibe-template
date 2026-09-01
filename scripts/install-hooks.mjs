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
//   - beads: `bd init` moves core.hooksPath to `.beads/hooks` and chains this
//     hook by COPYING it. Expected — but the copy is what git then runs, so it
//     goes stale the moment .githooks/post-commit is edited. Refresh it, and
//     warn if the chain lost our hook entirely.

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { at, git, norm, note as write, ROOT, safeDirectoryHint, writeIfChanged } from "./lib/util.mjs";

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
  // beads owns the chain. `bd init` chains a pre-existing hook by COPYING it,
  // not by delegating — so the copy silently goes stale the next time
  // .githooks/post-commit is edited, and git runs the old one. Detect that and
  // refresh, keeping .githooks/ the single source of truth.
  const chained = at(".beads", "hooks", HOOK);
  const chainedBody = existsSync(chained) ? readFileSync(chained, "utf8") : "";
  const ours = readFileSync(join(HOOK_DIR, HOOK), "utf8");
  if (chainedBody.includes(`.githooks/${HOOK}`)) {
    note(`beads owns the hook chain (${hooksPath}) — it delegates to .githooks/, nothing to do`);
  } else if (chainedBody.includes("version.mjs")) {
    if (writeIfChanged(chained, ours)) {
      note(`beads owns the hook chain (${hooksPath}); its COPY of the auto-version hook was`);
      note(`stale — refreshed from .githooks/${HOOK}.`);
    } else {
      note(`beads owns the hook chain (${hooksPath}) — chained version hook is current`);
    }
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
