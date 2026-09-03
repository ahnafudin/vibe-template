#!/usr/bin/env node
// scripts/install-hooks.mjs — make sure every hook this template ships is the
// one git actually runs. Idempotent and fail-soft: a non-git checkout, or a
// machine without git, simply skips. Run by `postinstall` and exposed as
// `npm run hooks:install`.
//
// Hooks shipped in .githooks/:
//   post-commit  folds a conventional-commit version bump into that commit
//   commit-msg   strips AI-agent attribution trailers, whichever agent wrote them
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
//   - beads: `bd init` moves core.hooksPath to `.beads/hooks` and chains the
//     hooks that existed at the time by COPYING them. That copy is what git then
//     runs, so it goes stale the moment .githooks/ is edited — and a hook added
//     LATER never arrives there at all. Both are handled below.
//   - never overwrite a hook there that is not ours: bd writes its own
//     pre-commit, post-merge, pre-push and prepare-commit-msg.

import { chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { at, git, norm, note as write, ROOT, safeDirectoryHint, writeIfChanged } from "./lib/util.mjs";

const HOOK_DIR = at(".githooks");
/** Present in every hook this template owns, so a foreign one is never clobbered. */
const MARKER = "vibe:hook";

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

if (!existsSync(HOOK_DIR)) {
  note(".githooks/ missing — nothing to install");
  process.exit(0);
}

const ours = readdirSync(HOOK_DIR).filter((f) => !f.startsWith("."));
if (ours.length === 0) {
  note(".githooks/ is empty — nothing to install");
  process.exit(0);
}

const current = git(["config", "--get", "core.hooksPath"]);
const hooksPath = current.ok ? current.out : "";

/** Copy our hooks into the directory git actually reads, when that is not ours. */
function syncInto(dir, label) {
  const added = [];
  const refreshed = [];
  const foreign = [];
  for (const name of ours) {
    const source = readFileSync(join(HOOK_DIR, name), "utf8");
    const target = join(dir, name);
    const existing = existsSync(target) ? readFileSync(target, "utf8") : null;
    // `version.mjs` recognises the copy bd made of our post-commit BEFORE the
    // marker existed, so an already-set-up repo migrates instead of stalling.
    const isOurs = existing === null || existing.includes(MARKER) || existing.includes("version.mjs");
    if (!isOurs) {
      foreign.push(name); // somebody else's hook of the same name — leave it alone
      continue;
    }
    if (writeIfChanged(target, source)) (existing === null ? added : refreshed).push(name);
  }
  if (added.length) note(`${label}: installed ${added.join(", ")}`);
  if (refreshed.length) note(`${label}: refreshed a stale copy of ${refreshed.join(", ")}`);
  if (foreign.length) {
    note(`WARNING: ${label} already has a different ${foreign.join(", ")} — left untouched.`);
    note(`Merge .githooks/${foreign[0]} into it by hand if you want both to run.`);
  }
  if (!added.length && !refreshed.length && !foreign.length) note(`${label}: all hooks current`);
}

if (hooksPath === ".githooks") {
  note(`already installed (core.hooksPath=.githooks; ${ours.join(", ")})`);
} else if (hooksPath.endsWith(".beads/hooks") || hooksPath.endsWith(".beads\\hooks")) {
  syncInto(at(".beads", "hooks"), `beads owns the chain (${hooksPath})`);
} else if (hooksPath) {
  note(`core.hooksPath is already "${hooksPath}" (another hook manager?) — not overwriting.`);
  note("to enable this template's hooks manually: git config core.hooksPath .githooks");
} else {
  const set = git(["config", "core.hooksPath", ".githooks"]);
  note(set.ok ? `installed: core.hooksPath → .githooks (${ours.join(", ")})` : `install skipped: ${set.out}`);
}

// Best-effort exec bit (required on POSIX; a no-op on Windows).
for (const name of ours) {
  try {
    chmodSync(join(HOOK_DIR, name), 0o755);
  } catch {
    /* ignore — Windows / restricted FS */
  }
}
