# SETUP

## First machine (new project from this template)

```bash
npm install          # activates the auto-version git hook (postinstall)
npm run setup        # git hooks → beads init → Claude Code hooks → dolt sync remote
```

Then fill the placeholders — search for `TODO:fill`:

- [ ] `CLAUDE.md` — project name · Project summary · Stack table · Layer responsibilities ·
      Naming conventions · Conventions · Commands · core-layer name in the "Core-first" rule ·
      design-token pointer in the "Avoid AI-slop design" rule
- [ ] `package.json` — `name` (also drives the beads issue prefix if you init before renaming:
      prefer renaming FIRST). Non-JS project? Keep this file anyway — it is the TOOLING
      manifest (setup + versioning); add your language's real manifest beside it
      (`composer.json`, `pyproject.toml`, `go.mod` + a root `VERSION` file — all auto-synced,
      see `docs/VERSIONING.md`)
- [ ] `docs/PRD.md` — problem, goals, scope, risks, guardrails
- [ ] `docs/ARCHITECTURE.md` — layers + first decisions
- [ ] `docs/TASKS.md` — phase 1 checklist
- [ ] Delete the TEMPLATE NOTE at the top of `CLAUDE.md`

Prerequisites: Node ≥ 18, git, and (optional but recommended) **bd** — the official release
binary from <https://github.com/gastownhall/beads> or `brew install beads`.
Avoid CGO-less `go install` builds: embedded Dolt refuses to open with them, and the npm
package `@beads/bd` has a broken postinstall. `npm run setup` degrades gracefully if bd is absent.

## Second machine (same project, e.g. Windows + macOS)

What git already carries: `CLAUDE.md` rules, docs + archives, `.claude/settings.json` hooks,
`.beads/` config + git-hooks, `.githooks/`. What is **per-machine**: the beads local DB, the
Dolt sync remote, `core.hooksPath`, your SSH config, and Claude Code auto-memory (it does NOT
sync — anything cross-machine-critical belongs in `CLAUDE.md`/docs, which is the whole point
of this template).

```bash
git clone <origin> && cd <project>
npm install
npm run setup                 # re-applies the per-machine bits: git hooks, Claude hooks, dolt
                              # remote — and runs `bd bootstrap` (NOT `bd init`) when it sees
                              # the committed .beads config without a local DB
bd dolt pull                  # pull existing issue data
```

⚠️ If you already ran `bd init` on this machine BEFORE cloning/pulling the canonical setup:
`bd init` may have auto-committed its scaffolding (it commits everything staged). Fix first:

```bash
git log --oneline -3                       # look for "bd init: initialize beads issue tracking"
git reset --soft HEAD~1 && git restore --staged .
rm -rf .beads && git checkout -- .gitignore CLAUDE.md
rm -f AGENTS.md                            # bd's stock instruction file, if it created one
git pull
npm run setup && bd dolt pull
```

## Day-to-day rhythm (any machine)

- Session start: `git pull` + `bd dolt pull`
- Session end: update/close bd issues; commit/push **only when you ask for it**
- Never run `bd init` manually — `npm run setup` decides (init on a brand-new project,
  `bd bootstrap` on a fresh clone, skip when the workspace is already active).

Note: `.claude/settings.json` already ships the Claude Code hooks (`bd prime` on
SessionStart/PreCompact), so setup's `bd setup claude` step is normally a no-op check —
it only self-heals when the hooks are missing.
