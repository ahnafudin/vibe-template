#!/usr/bin/env node
// scripts/setup.mjs — one-shot project bootstrap. Idempotent (safe to re-run)
// and fail-soft, but the ORDER is deliberate:
//
//   1. git hooks first (core.hooksPath=.githooks) — so a later `bd init`
//      CHAINS the auto-version hook instead of orphaning it
//   2. beads workspace — `bd bootstrap` when a committed .beads config exists
//      (second machine / fresh clone), `bd init` only on a brand-new project,
//      and NEVER on a dirty index (`bd init` auto-commits every staged file —
//      a real data-loss footgun)
//   3. Claude Code hooks — the template already ships them in
//      .claude/settings.json, so `bd setup claude` normally reports
//      "already installed"; it runs only as a self-heal when they are missing
//   4. Dolt sync remote = the git origin (lives in the LOCAL beads DB, not in
//      git, so this step repeats on every new machine)

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function tryRun(cmd, args) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, out: String(out).trim() };
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    return { ok: false, out: out || String(e.message ?? e) };
  }
}

function step(msg) {
  process.stderr.write(`\n[setup] ${msg}\n`);
}
function note(msg) {
  process.stderr.write(`  ${msg}\n`);
}

/** Normalized path for equality checks (git prints forward slashes on Windows;
 *  drive-letter case can vary). */
function norm(p) {
  const r = resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

// 0. must be a git work tree, and THIS folder must be its toplevel — otherwise
// every following step (hooksPath, bd init, dolt remote) would act on a PARENT
// repository (zip/degit copies nested in a monorepo hit this).
const toplevel = tryRun("git", ["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  step("not a git repository — run `git init` first, then re-run `npm run setup`.");
  process.exit(1);
}
if (norm(toplevel.out) !== norm(ROOT)) {
  step(`this folder sits inside another repository (${toplevel.out}).`);
  note("run `git init` here first if this is meant to be its own repo, then re-run `npm run setup`.");
  process.exit(1);
}

// 1. git hooks (auto-version)
step("1/4 git hooks (auto-version)");
const hooks = tryRun(process.execPath, [join(ROOT, "scripts", "install-hooks.mjs")]);
note(hooks.out || "done");

// 2. beads workspace
step("2/4 beads (bd) issue tracker");
const bdVersion = tryRun("bd", ["version"]);
if (!bdVersion.ok) {
  note("bd not found — skipping beads/Claude-hook setup (everything else is ready).");
  note("install the OFFICIAL release binary: https://github.com/gastownhall/beads");
  note("(brew install beads on macOS/Linux; avoid CGO-less `go install` builds — embedded");
  note(" Dolt refuses to open with them). Then re-run `npm run setup`.");
  process.exit(0);
}
note(bdVersion.out);

// `bd where` walks UP ancestor directories, so a parent workspace would match a
// naive check and silently hijack this project's issues — require the reported
// workspace to be exactly OURS before skipping init.
const where = tryRun("bd", ["where"]);
const reportedWs = where.ok ? (where.out.split(/\r?\n/)[0] ?? "").trim() : "";
const ownWs = join(ROOT, ".beads");
const isOwnWorkspace = where.ok && reportedWs && norm(reportedWs) === norm(ownWs);

if (isOwnWorkspace) {
  note("workspace already active — skipping `bd init`.");
} else {
  if (where.ok && reportedWs) {
    note(`note: an ANCESTOR beads workspace exists at ${reportedWs} — this project still gets its own.`);
  }
  if (existsSync(join(ownWs, "config.yaml"))) {
    // Second machine / fresh clone: the config is committed, only the local DB
    // is missing — bootstrap it, never re-init.
    const boot = tryRun("bd", ["bootstrap"]);
    if (!boot.ok) {
      note(`bd bootstrap failed:\n${boot.out}`);
      note("fix the error above and re-run `npm run setup` (do NOT run `bd init` — the");
      note("workspace config is already committed).");
      process.exit(1);
    }
    note("bootstrapped the local DB from the committed .beads config.");
  } else {
    // Brand-new project. GUARD: `bd init` auto-commits everything staged.
    if (!tryRun("git", ["diff", "--cached", "--quiet"]).ok) {
      note("ABORT: you have STAGED changes, and `bd init` auto-commits everything staged.");
      note("Commit or unstage them first, then re-run `npm run setup`.");
      process.exit(1);
    }
    const init = tryRun("bd", ["init", "--quiet", "--skip-agents"]);
    if (!init.ok) {
      note(`bd init failed:\n${init.out}`);
      note("If the error mentions CGO: this bd build lacks embedded Dolt — install the");
      note("official release binary (or use `bd init --proxied-server`).");
      process.exit(1);
    }
    note("initialized (embedded Dolt; no AGENTS.md — CLAUDE.md already carries the rules).");
  }
}

// 3. Claude Code hooks (normally a no-op: .claude/settings.json ships them)
step("3/4 Claude Code integration");
const check = tryRun("bd", ["setup", "claude", "--check"]);
if (check.ok && !/✗|not installed|No hooks/i.test(check.out)) {
  note("already installed (shipped in .claude/settings.json).");
} else {
  const setup = tryRun("bd", ["setup", "claude"]);
  note(setup.ok ? "installed (SessionStart/PreCompact → bd prime)." : `skipped: ${setup.out}`);
  note("NOTE: `bd setup claude` may insert its own managed block into CLAUDE.md; the");
  note('"Beads Issue Tracker — project rules" section OVERRIDES it wherever they conflict.');
}

// 4. Dolt sync remote (per machine — it lives in the local DB, not in git)
step("4/4 beads sync remote");
const origin = tryRun("git", ["remote", "get-url", "origin"]);
if (!origin.ok) {
  note("no git `origin` yet — after you add one, run:");
  note('  bd dolt remote add origin "$(git remote get-url origin)"');
} else {
  const remotes = tryRun("bd", ["dolt", "remote", "list"]);
  if (remotes.ok && /(^|\s)origin(\s|$)/m.test(remotes.out)) {
    note("dolt remote `origin` already configured.");
  } else {
    const add = tryRun("bd", ["dolt", "remote", "add", "origin", origin.out]);
    note(add.ok ? `dolt remote → ${origin.out}` : `skipped: ${add.out}`);
  }
}

step("done. Next: fill the TODO:fill sections (checklist in SETUP.md).");
