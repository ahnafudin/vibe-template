#!/usr/bin/env node
// scripts/setup.mjs — one-shot project bootstrap. Idempotent (safe to re-run)
// and fail-soft, but the ORDER is deliberate:
//
//   1. git hooks first (core.hooksPath=.githooks) — so a later `bd init`
//      CHAINS the auto-version hook instead of orphaning it
//   2. stack detection — read the framework markers, fill package.json's
//      `vibe.gates`, the .gitignore managed block and docs/STACK.md
//   3. agent doc pointers — regenerate the per-tool stubs from AGENTS.md
//   4. beads workspace — `bd bootstrap` when a committed .beads config exists
//      (second machine / fresh clone), `bd init` only on a brand-new project,
//      and NEVER on a dirty index (`bd init` auto-commits every staged file —
//      a real data-loss footgun)
//   5. Claude Code hooks — the template already ships them in
//      .claude/settings.json, so `bd setup claude` normally reports
//      "already installed"; it runs only as a self-heal when they are missing
//   6. Dolt sync remote = the git origin (lives in the LOCAL beads DB, not in
//      git, so this step repeats on every new machine)
//
// Steps 2 and 3 write only unstaged changes, so they cannot be swept into
// `bd init`'s auto-commit; and a missing `bd` skips 4–6 without skipping them.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { at, git, norm, note as write, ROOT, safeDirectoryHint, tryRun } from "./lib/util.mjs";

function step(msg) {
  process.stderr.write(`\n[setup] ${msg}\n`);
}
const note = (msg) => write(msg, "  ");

// 0. must be a git work tree, and THIS folder must be its toplevel — otherwise
// every following step (hooksPath, bd init, dolt remote) would act on a PARENT
// repository (zip/degit copies nested in a monorepo hit this).
const toplevel = git(["rev-parse", "--show-toplevel"]);
if (!toplevel.ok) {
  if (toplevel.dubious) {
    // Do NOT say "not a git repository" here: the repo exists, git is just
    // refusing to touch it because it is owned by another account. Someone who
    // followed a `git init` suggestion would scaffold a second repo over a real
    // one — so print the actual remedy.
    step("git refuses to read this repository: it is owned by a different user account.");
    note("The repo is fine — this is an ownership check, not a missing .git. Run:");
    note(`  ${safeDirectoryHint()}`);
    note("then re-run `npm run setup`.");
  } else {
    step("not a git repository — run `git init` first, then re-run `npm run setup`.");
  }
  process.exit(1);
}
if (norm(toplevel.out) !== norm(ROOT)) {
  step(`this folder sits inside another repository (${toplevel.out}).`);
  note("run `git init` here first if this is meant to be its own repo, then re-run `npm run setup`.");
  process.exit(1);
}

// 1. git hooks (auto-version)
step("1/6 git hooks (auto-version)");
const hooks = tryRun(process.execPath, [at("scripts", "install-hooks.mjs")]);
note(hooks.out || "done");

// 2. stack detection → vibe.gates + .gitignore block + docs/STACK.md
step("2/6 framework detection");
const stack = tryRun(process.execPath, [at("scripts", "stacks.mjs"), "apply"]);
note(stack.out || "done");
note("re-run any time with `npm run stack:apply` (add `--force` to overwrite hand-tuned gates).");

// 3. agent instruction pointers (AGENTS.md → per-tool stubs)
step("3/6 agent instruction files");
const agents = tryRun(process.execPath, [at("scripts", "sync-agents.mjs")]);
note(agents.out || "done");

// 4. beads workspace
step("4/6 beads (bd) issue tracker");
const bdVersion = tryRun("bd", ["version"]);
if (!bdVersion.ok) {
  note("bd not found — skipping the beads steps (everything above is already done).");
  note("bd is OPTIONAL. To add it later, install the official release binary:");
  note("  https://github.com/gastownhall/beads  (or `brew install beads`)");
  note("Avoid CGO-less `go install` builds — embedded Dolt refuses to open with them.");
  note("Then re-run `npm run setup`.");
  finish();
}
note(bdVersion.out);

// `bd where` walks UP ancestor directories, so a parent workspace would match a
// naive check and silently hijack this project's issues — require the reported
// workspace to be exactly OURS before skipping init.
const where = tryRun("bd", ["where"]);
const reportedWs = where.ok ? (where.out.split(/\r?\n/)[0] ?? "").trim() : "";
const ownWs = at(".beads");
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
    note("initialized (embedded Dolt; --skip-agents so it cannot overwrite AGENTS.md).");
  }
}

// 5. Claude Code hooks (normally a no-op: .claude/settings.json ships them)
step("5/6 Claude Code integration");
const check = tryRun("bd", ["setup", "claude", "--check"]);
if (check.ok && !/✗|not installed|No hooks/i.test(check.out)) {
  note("already installed (shipped in .claude/settings.json).");
} else {
  const setup = tryRun("bd", ["setup", "claude"]);
  note(setup.ok ? "installed (SessionStart/PreCompact → bd prime)." : `skipped: ${setup.out}`);
  note("NOTE: `bd setup claude` may insert its own managed block into CLAUDE.md; the");
  note('"Beads Issue Tracker" section of AGENTS.md OVERRIDES it wherever they conflict.');
}

// 6. Dolt sync remote (per machine — it lives in the local DB, not in git)
step("6/6 beads sync remote");
const origin = git(["remote", "get-url", "origin"]);
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

finish();

function finish() {
  step("done.");
  note("Next: fill the TODO:fill sections in AGENTS.md and docs/ (checklist in SETUP.md).");
  note("Check the detected stack in docs/STACK.md, then verify with `npm run gate`.");
  process.exit(0);
}
