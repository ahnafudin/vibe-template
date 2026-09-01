# CLAUDE.md — <PROJECT_NAME>

**The project's working rules live in [`AGENTS.md`](AGENTS.md) — that file is canonical for every
agent, and Claude Code loads it through the import below.** Do not copy rules into this file: put
them in `AGENTS.md` and run `npm run agents:sync`. What belongs HERE is only what is specific to
Claude Code.

@AGENTS.md

> If that import ever fails to expand, read `AGENTS.md` yourself before doing anything else —
> it carries the docs-routing map, the `npm run gate` contract, the archive contract and the
> no-auto-push rule.

---

## Claude Code specifics

These use Claude Code features other agents do not have. Everything else is in `AGENTS.md`.

- **Worktrees:** `AGENTS.md` requires isolating sizable feature/fix work. In Claude Code use the
  `EnterWorktree` tool (it manages `.claude/worktrees/`, already gitignored) rather than raw
  `git worktree add`. Stay on the main checkout for docs/config/tooling changes and anything that
  must touch the live checkout — git hooks, `.beads/`.
- **Parallel subagents:** run independent subtasks with the Agent tool when the work genuinely
  splits; keep shared-state work in a single agent.
- **Session narration:** Claude Code auto-titles the conversation; ADDITIONALLY mark a chapter
  (`mark_chapter`, when the session tool is available) at every major phase change —
  exploration → implementation → verification → wrap-up — so the transcript's table of contents
  shows what the session is doing at a glance.
- **Memory:** Claude Code's auto-memory does NOT sync between machines. Anything
  cross-machine-critical belongs in `AGENTS.md` or `docs/` — which is the whole point of this
  template.
- **Hooks:** `.claude/settings.json` runs `node scripts/bd-prime.mjs` on SessionStart and
  PreCompact. That wrapper is deliberately silent when `bd` is not installed, so a machine without
  beads does not open every session with an error sitting in context.

<!-- `bd setup claude` may append its own BEGIN/END BEADS INTEGRATION block below this line.
     Leave it alone — but note that the "Beads Issue Tracker" section of AGENTS.md OVERRIDES it
     wherever the two conflict (in particular: never auto-commit, never auto-push). -->
