# SETUP

## First machine (new project from this template)

```bash
npm install          # activates the auto-version git hook (postinstall)
npm run setup        # hooks → framework detection → agent docs → beads → dolt remote
```

Setup detects your framework and writes three things for you: `package.json` → `vibe.gates`,
the `.gitignore` managed block, and `docs/STACK.md`. **Read `docs/STACK.md` first** — if it named
the wrong framework, or a gate command is wrong, fix it now:

```bash
npm run stack:detect            # what matched, and how strongly
npm run stack:list              # every framework in the registry
npm run stack:reapply           # re-derive vibe.gates from the registry (overwrites hand edits)
npm run gate:list               # exactly what `npm run gate` will run
npm run gate                    # run it
```

If your framework is missing, add one entry to `scripts/stacks.json` (see the example in
`README.md`) and run `npm run stack:validate`. No code change is needed — and please keep
`"verified": false` until you have actually run the commands.

> The template ships `vibe.gates` marked `"ownedByTemplate": true` — those are the commands the
> TEMPLATE uses to maintain itself. The first `npm run stack:apply` in a renamed project replaces
> them with your framework's and drops the marker. After that they are yours: nothing overwrites
> them again unless you ask (`npm run stack:reapply`).

Then fill the placeholders — search for `TODO:fill`:

- [ ] `AGENTS.md` — project name · Project summary · Stack table · Layer responsibilities ·
      Naming conventions · Conventions · Commands · design-token pointer in the
      "Avoid AI-slop design" rule
- [ ] `CLAUDE.md` — project name only (everything else is imported from `AGENTS.md`; **do not copy
      rules here**)
- [ ] `package.json` — **`name` first, before anything else.** While it is still `my-project`,
      `npm run setup` deliberately REFUSES to run `bd init`: bd bakes the name into the issue
      prefix and commits `.beads/` (a project_id and the Dolt sync remote), so initializing an
      unrenamed copy would ship this template's identity to every project made from it.
      Non-JS project? Keep this file anyway — it is the TOOLING
      manifest (setup, gates, versioning); add your language's real manifest beside it
      (`composer.json`, `pyproject.toml`, `go.mod` + a root `VERSION` file — all auto-synced,
      see `docs/VERSIONING.md`)
- [ ] `README.md` — `npm run setup` replaces the template's README with a stub about your project
      (the template's own is kept at `docs/TEMPLATE.md`); fill in the description
- [ ] `.env.example` — every variable the app reads (values stay empty; it is the contract)
- [ ] `.github/workflows/gate.yml` — add your language toolchain step
- [ ] `docs/PRD.md` — problem, goals, scope, risks, guardrails
- [ ] `docs/ARCHITECTURE.md` — layers + first decisions
- [ ] `docs/TASKS.md` — phase 1 checklist
- [ ] A `LICENSE` file — this template deliberately ships none; the choice is yours
- [ ] Delete the TEMPLATE NOTE at the top of `AGENTS.md`

Prerequisites: Node ≥ 18, git, and (optional) **bd** — the official release binary from
<https://github.com/gastownhall/beads> or `brew install beads`. Avoid CGO-less `go install` builds:
embedded Dolt refuses to open with them, and the npm package `@beads/bd` has a broken postinstall.
`npm run setup` completes fine without bd.

## Editing the rules

`AGENTS.md` is canonical. `CLAUDE.md` imports it (`@AGENTS.md`) and adds Claude-Code-only notes;
every other tool file is **generated**:

```bash
npm run agents:sync     # regenerate the pointer files after editing AGENTS.md
npm run agents:check    # CI/gate check: are they stale? (part of `npm run gate`)
```

Never hand-edit `GEMINI.md`, `CONVENTIONS.md`, `.cursor/rules/`, `.windsurf/rules/`, `.clinerules/`,
`.junie/` or `.github/copilot-instructions.md` — your changes are overwritten on the next sync.
Commit the generated files: a fresh clone opened in Cursor must already have them.

## Working on the TEMPLATE itself (not a project made from it)

Leave `package.json`'s `name` as `my-project` and setup will keep skipping `bd init` — which is
what you want: the template must never ship a `.beads/` workspace. If you want issue tracking for
the template repo itself, run `bd init` by hand and keep `.beads/` out of git locally
(`echo '.beads/' >> .git/info/exclude` — `.git/info/exclude` is not committed, so a real project
still commits its own `.beads/config.yaml` for the second-machine flow).

## If git says "dubious ownership"

Every git command fails with exit 128 and setup stops. This is **not** a missing repository — do
not run `git init`. It happens after a drive move, an OS reinstall, or copying a repo between user
accounts. `npm run setup` prints the exact fix; it is:

```bash
git config --global --add safe.directory "/full/path/to/your/repo"
```

## Second machine (same project, e.g. Windows + macOS)

What git already carries: `AGENTS.md` + the generated pointer files, docs + archives,
`.claude/settings.json` hooks, `.beads/` config + git-hooks, `.githooks/`, `package.json` gates.
What is **per-machine**: the beads local DB, the Dolt sync remote, `core.hooksPath`, your SSH
config, and your agent's auto-memory (it does NOT sync — anything cross-machine-critical belongs in
`AGENTS.md`/docs, which is the whole point of this template).

```bash
git clone <origin> && cd <project>
npm install
npm run setup                 # re-applies the per-machine bits: git hooks, Claude hooks, dolt
                              # remote — and runs `bd bootstrap` (NOT `bd init`) when it sees
                              # the committed .beads config without a local DB
bd dolt pull                  # pull existing issue data
npm run gate                  # confirm the toolchain is actually installed here
```

⚠️ If you already ran `bd init` on this machine BEFORE cloning/pulling the canonical setup:
`bd init` may have auto-committed its scaffolding (it commits everything staged). Fix first:

```bash
git log --oneline -3                       # look for "bd init: initialize beads issue tracking"
git reset --soft HEAD~1 && git restore --staged .
rm -rf .beads && git checkout -- .gitignore CLAUDE.md AGENTS.md
git pull
npm run setup && bd dolt pull
```

(`npm run setup` passes `--skip-agents` to `bd init`, so a normal run cannot overwrite `AGENTS.md`.
The cleanup above only matters if you ran `bd init` by hand.)

## Machine-level agent tooling (deliberately NOT in this template)

Token/behavior optimizers — e.g. **rtk** (compresses CLI output before it enters context),
**caveman** (terse response style), **ponytail** (write-less-code bias) — are all **per-machine**
installs (global hooks/plugins in `~/.claude`), not per-project files. They compose with this
template but do not belong in it: a repo must work on a machine that has none of them. Install/skip
them per machine to taste. One warning if you use caveman: never run `/caveman-compress` on
`AGENTS.md` — it rewrites lossily and the contracts there are load-bearing.

## Day-to-day rhythm (any machine)

- Session start: `git pull` + `bd dolt pull`
- Before saying "done": `npm run gate` — and paste the output, do not summarise it
- Session end: update/close bd issues; commit/push **only when you ask for it**
- Never run `bd init` manually — `npm run setup` decides (init on a brand-new project,
  `bd bootstrap` on a fresh clone, skip when the workspace is already active).

Note: `.claude/settings.json` already ships the Claude Code hooks (`node scripts/bd-prime.mjs` on
SessionStart/PreCompact), so setup's `bd setup claude` step is normally a no-op check — it only
self-heals when the hooks are missing. That wrapper stays silent when bd is absent, so a machine
without beads does not start every session with an error in context.
