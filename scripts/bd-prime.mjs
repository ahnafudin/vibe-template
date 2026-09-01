#!/usr/bin/env node
// scripts/bd-prime.mjs — a guarded `bd prime` for the Claude Code SessionStart /
// PreCompact hooks.
//
// Why this wrapper exists: a hook's output lands directly in the agent's
// context. Calling `bd prime` unguarded means every session on a machine that
// has not installed beads opens with a "command not found" error — noise the
// agent then has to reason about, on a template whose whole point is that bd is
// OPTIONAL. So: forward the priming text when bd is there, exit 0 silently when
// it is not, and speak up only for a genuine bd failure.
//
// Node (not `command -v` / `where`) because this must behave identically in
// PowerShell, cmd.exe and POSIX shells.

import { spawnSync } from "node:child_process";
import { NEEDS_SHELL } from "./lib/util.mjs";

// 127 = POSIX "command not found"; 9009 = the cmd.exe equivalent.
const MISSING = new Set([127, 9009]);

const r = spawnSync("bd", ["prime"], {
  encoding: "utf8",
  shell: NEEDS_SHELL, // resolves the bd.cmd / shell shim npm installs on PATH
});

if (r.error || MISSING.has(r.status ?? 0)) {
  process.exit(0); // bd not installed — that is a supported configuration
}

if (r.status === 0) {
  if (r.stdout) process.stdout.write(r.stdout);
  process.exit(0);
}

// bd IS installed but failed: worth one quiet line, never a crash.
process.stderr.write(`[bd-prime] bd prime exited ${r.status} — skipping priming for this session.\n`);
process.exit(0);
