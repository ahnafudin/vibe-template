# vibe-template

A project boilerplate for **AI-assisted ("vibe") coding with Claude Code** — structure and
contracts only, no stack lock-in. Copy it, fill the placeholders, and every coding session
starts with the right rules, the right docs, and a working issue tracker: you type only the task.

## What you get

| Piece | What it does |
|---|---|
| `CLAUDE.md` skeleton | Auto-loaded every session. Ships the **Session working rules** (docs-by-route, read-before-write, finish-100%, no dead code/duplication, one-question rule, multi-agent worktrees, completion report) + placeholder sections to fill per project. |
| `docs/` skeletons | `PRD` · `ARCHITECTURE` · `FEATURES` · `TASKS` · `ROADMAP` · `VERSIONING` — thin frames, not content. |
| **Archive contract** | `docs/archive/STATUS_ARCHIVE.md` + `TASKS_ARCHIVE.md`: when work merges, its full story moves here and `CLAUDE.md` keeps ≤ 1 bullet per domain — the always-loaded context never bloats. |
| **Beads issue tracker** | `bd` wiring (Claude Code `bd prime` hooks in `.claude/settings.json`) with rules reconciled for this workflow: bd = cross-session issues, `docs/TASKS.md` = roadmap checklist, no auto-push. |
| **Auto-versioning** | Conventional-commit hook bumps semver in `package.json` (+ optional sync targets) inside the same commit. |
| `scripts/setup.mjs` | One-shot, idempotent, ordered bootstrap (order matters — see below). |

## Language support

The template is **language-agnostic by design** — the rules, docs structure, archive
contract, and beads wiring don't care what the app is written in. Node is only the
*tooling* runtime (`npm run setup`, the version script): non-JS projects simply keep the
small `package.json` as their tooling manifest next to the real one.

| App language | Works? | Version auto-sync |
|---|---|---|
| JavaScript / TypeScript | native | `package.json` (the source of truth) |
| Rust / Tauri | native | `src-tauri/tauri.conf.json` + `Cargo.toml` + `Cargo.lock` |
| PHP | yes | `composer.json` (only if it declares `"version"`) |
| Python | yes | `pyproject.toml` (`[project]` / `[tool.poetry]`) |
| Go (or anything else) | yes | root `VERSION` file (`go:embed` / `-ldflags`) |

Fill `CLAUDE.md`'s Stack/Conventions/Core-first placeholders with your language's rules —
that is the only per-language work.

## Quick start

```bash
# 1. copy the template (GitHub: "Use this template", or)
gh repo create my-project --template <owner>/vibe-template --private --clone
cd my-project

# 2. bootstrap (safe to re-run any time)
npm install          # activates the version hook via postinstall
npm run setup        # git hooks → beads init → Claude Code hooks → dolt sync remote

# 3. fill the <!-- TODO:fill --> sections in CLAUDE.md and docs/ (checklist: SETUP.md)
```

Then open Claude Code and just type your task — the rules ride along automatically.

## Why the setup order matters

`scripts/setup.mjs` runs: **git hooks first → beads init → Claude hooks → dolt remote**, because:

- `bd init` moves `core.hooksPath` to `.beads/hooks` and **chains whatever hook is already
  installed** — install the version hook first or it gets orphaned.
- `bd init` **auto-commits everything staged** — the script refuses to run it on a dirty index.
- The Dolt sync remote lives in the local DB, not in git — it must be added per machine.

## Two machines?

See `SETUP.md` → "Second machine" for the exact checklist (what git carries for you,
what is per-machine, and how to sync beads issue data with `bd dolt push` / `bd dolt pull`).

## Layout

```
CLAUDE.md              auto-loaded session rules + project summary (placeholders)
SETUP.md               fill-in checklist · second-machine checklist
docs/
  PRD.md  ARCHITECTURE.md  FEATURES.md  TASKS.md  ROADMAP.md  VERSIONING.md
  archive/             STATUS_ARCHIVE.md · TASKS_ARCHIVE.md  (the anti-bloat contract)
.claude/settings.json  Claude Code hooks (bd prime on SessionStart/PreCompact)
.githooks/             conventional-commit auto-version hook
scripts/               setup.mjs · version.mjs · install-hooks.mjs
```
