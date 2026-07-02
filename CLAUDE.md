# CLAUDE.md

Context and conventions for AI coding agents working on **<PROJECT_NAME>**.

> TEMPLATE NOTE — sections marked `<!-- TODO:fill -->` are placeholders. Fill them during
> project setup (checklist in `SETUP.md`), then delete this note.

---

## Session working rules (standing orders — apply every session, no per-session prompt needed)

This file is loaded automatically at the start of every session; the user sends ONLY the task. Treat the rules below as if they were prepended to every request:

- **Docs are the source of truth — read by ROUTE, not wholesale.** This file is the always-loaded summary; never read the whole `docs/` tree by default. Route by domain: architecture/patterns → `docs/ARCHITECTURE.md` · product strategy + sensitive-feature guardrails → `docs/PRD.md` · per-screen/feature behavior → `docs/FEATURES.md` · build checklist → `docs/TASKS.md` · release/versioning → `docs/VERSIONING.md` · future work → `docs/ROADMAP.md` · a domain's full build history → `docs/archive/` (read `STATUS_ARCHIVE.md` BEFORE deep work on a domain that has history — past forensics prevent re-fighting solved battles). Two exceptions: sweep wider when the task is genuinely cross-cutting, and when the answer is not in the docs read the code itself (the ultimate source of truth), then backfill the doc.
- **Core-first.** Heavy logic, processing, and data belong in the core/backend layer, not the UI. <!-- TODO:fill — name the actual layer, e.g. "the Rust backend" -->
- **Read before writing.** Always read the file(s) you are about to change — never write from memory.
- **Finish 100%.** Complete one task fully (code + tests + gates green) before starting the next. No half-done work.
- **No dead code, no duplication, no orphan files.** Anything used from 2+ places must be extracted into a shared/reusable util.
- **Conventions:** follow the language/framework convention sections below.
- **When unsure, ask ONE most-important question** instead of guessing.
- **Multi-agent by default for sizable work:** isolate feature work in git worktrees and run independent subtasks with parallel subagents. Issues: see "Beads Issue Tracker" below — bd is canonical for cross-session issues; `docs/TASKS.md` stays the roadmap checklist.
- **Avoid AI-slop design:** follow the project's design tokens and original assets; no generic template look. <!-- TODO:fill — point at the design-token file -->
- **On completion:** tick the item in `docs/TASKS.md`, update docs when an architecture decision changed (full build history goes to `docs/archive/STATUS_ARCHIVE.md` — keep this file's "Current state" to one bullet per domain), and report: what was done, which files changed, what remains.

---

## Project summary

<!-- TODO:fill — one paragraph: what the product is, who it's for, the delivery model. -->

**Current state:** nothing shipped yet. Contract for this section: detailed per-feature build history (decisions, review findings, lessons) is archived VERBATIM in `docs/archive/STATUS_ARCHIVE.md`; keep this section to ≤ 1 short bullet per merged domain — when work merges, move its story to the archive instead of growing this file.

---

## Stack

| Layer | Tech |
|---|---|
| <!-- TODO:fill --> | |

---

## Layer responsibilities

<!-- TODO:fill — which layer owns what; the boundaries agents must not blur. -->

---

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Folder | kebab-case | `user-settings/` |
| <!-- TODO:fill the rest per stack --> | | |

---

## Conventions

<!-- TODO:fill — per-language rules. Suggested baseline:
- Errors handled explicitly at every level; user-readable messages at the UI boundary; never silently swallowed.
- Validate all input at system boundaries; never trust external data.
- Formatter + linter clean before any commit.
- No secrets in source; env vars / secret manager only.
-->

---

## Commands

```bash
npm run setup          # one-shot bootstrap: git hooks → beads init → Claude hooks → dolt remote (see SETUP.md)
# TODO:fill — dev / build / test / lint commands
```

---

## Versioning

Semantic versioning; **`package.json` is the single source of truth**, auto-bumped by a conventional-commit git hook (`.githooks/post-commit` → `scripts/version.mjs`, folded into the same commit via a guarded amend): `feat:`→MINOR, `fix:`/`perf:`/`refactor:`→PATCH, `!`/`BREAKING CHANGE:`→MAJOR, everything else → no bump. Full reference + known footguns: `docs/VERSIONING.md`.

---

## When unsure

Read `docs/ARCHITECTURE.md` before inventing a new pattern. Keep changes minimal and consistent with existing structure.

## Beads Issue Tracker — project rules

This project uses **bd (beads)** for cross-session issue tracking. `bd setup claude` (run by
`npm run setup`) may insert its own machine-managed block into this file (BEGIN/END BEADS
INTEGRATION markers) — **the rules in THIS section are the project's contract and OVERRIDE
that block wherever they conflict.** Do not edit inside bd's markers; edit here.

### Quick Reference

```bash
bd ready                # find available work
bd show <id>            # view issue details
bd update <id> --claim  # claim work
bd close <id>           # complete work
```

### Rules

- **bd is the canonical CROSS-SESSION issue tracker** (bugs, follow-ups, discovered work). In-session scratch todos are fine, but anything that must survive the session gets filed: `bd create "…" -t bug -p 1 --deps discovered-from:<id>` → claim with `bd update <id> --claim` → `bd close <id> --reason "…"`.
- `docs/TASKS.md` stays the phase-level ROADMAP checklist (a document, not an issue queue); completed sections move to `docs/archive/TASKS_ARCHIVE.md`. Never double-file one item in both bd and TASKS.md.
- Run `bd prime` for the full command reference. Agent memory (gotchas/lessons) stays in the Claude auto-memory system; `bd remember` may additionally hold project workflow notes that `bd prime` injects.
- **Worktrees:** every git worktree automatically shares the main repo's beads DB (no setup). Embedded Dolt is single-writer — serialized agents are fine; run `bd dolt start` (server mode) only if multiple agents must write in parallel.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export.

## Session completion (project contract)

When ending a work session: file bd issues for any remaining/discovered work, run the quality gates if code changed, update/close bd issue status, and report (what was done · files changed · what remains). **Commit and push only when the owner asks** — never auto-push, and never rewrite pushed history. (These two sentences override any auto-push "Session Completion" protocol a tool inserts elsewhere in this file.)
