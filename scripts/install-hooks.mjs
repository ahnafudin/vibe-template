#!/usr/bin/env node
// scripts/install-hooks.mjs — point git at the committed `.githooks/` folder so
// the auto-version hook (prepare-commit-msg) runs on every commit. Idempotent and
// fail-soft: a non-git checkout / a machine without git simply skips. Run by
// `postinstall` and exposed as `npm run hooks:install`.
//
// NOTE: if beads is initialized later, `bd init` moves core.hooksPath to
// `.beads/hooks` and CHAINS this hook — that is expected and fine. This script
// therefore leaves a `.beads/hooks` hooksPath alone instead of fighting it.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK_DIR = join(ROOT, ".githooks");

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function note(message) {
  process.stderr.write(`[hooks] ${message}\n`);
}

try {
  git(["rev-parse", "--is-inside-work-tree"]);
} catch {
  note("not a git work tree — skipping hook install");
  process.exit(0);
}

if (!existsSync(join(HOOK_DIR, "prepare-commit-msg"))) {
  note(".githooks/prepare-commit-msg missing — skipping");
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
    note(`beads owns the hook chain (${current}) — leaving as is`);
  } else {
    git(["config", "core.hooksPath", ".githooks"]);
    note("installed: core.hooksPath → .githooks");
  }
  // Best-effort exec bit (required on POSIX; a no-op on Windows).
  try {
    chmodSync(join(HOOK_DIR, "prepare-commit-msg"), 0o755);
  } catch {
    /* ignore — Windows / restricted FS */
  }
} catch (e) {
  note(`install skipped: ${e instanceof Error ? e.message : String(e)}`);
}
