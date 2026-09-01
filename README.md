# vibe-template

A project boilerplate for **AI-assisted ("vibe") coding** — structure and contracts only, no stack
lock-in. Copy it, fill the placeholders, and every coding session starts with the right rules, the
right docs, a working issue tracker and one command that means "is this green?" — **whichever AI
tool and whichever framework you use.** You type only the task.

## The two problems it solves

**1. Every AI tool looks for a different file.** Rules written for one agent are invisible to the
next. Here `AGENTS.md` is canonical, and `npm run agents:sync` generates a pointer for every other
front door — so opening this repo in Cursor, Copilot, Gemini CLI, Windsurf, Cline, Junie or Aider
loads the same contract instead of nothing.

**2. "Run the tests" means something different in every framework.** Here it is always
`npm run gate`. What that expands to comes from a **70-entry framework registry** (55 frameworks,
15 language bases) that detects your stack and writes the real commands into `package.json`.

## What you get

| Piece | What it does |
|---|---|
| `AGENTS.md` | **Canonical rules, read by every agent.** Session working rules (docs-by-route, read-before-write, finish-100%, verify-before-claiming, no dead code, one-question rule, worktree isolation, completion report) + placeholders to fill per project. |
| Per-tool pointers | `CLAUDE.md` (`@AGENTS.md` import + Claude-only extras) plus **generated** stubs for Copilot · Gemini CLI · Cursor · Windsurf · Cline/Roo · Junie · Aider. Each restates the non-negotiables inline, so an agent that ignores file references is still bound by them. |
| **Framework registry** | `scripts/stacks.json` — detection markers, gate commands, `.gitignore` lines, core-layer rule and conventions per framework. Adding one is **a JSON row, no code change**. Schema-validated by the test suite. |
| **`npm run gate`** | One command in every language: lint → typecheck → test → build, stopping at the first failure. Polyglot repos (Tauri, a Next.js + FastAPI monorepo) run both sides. |
| `docs/STACK.md` | **Generated** per project: which framework was detected, where heavy logic belongs, the exact gate commands, framework conventions. The brief a fresh agent reads instead of guessing. |
| `docs/` skeletons | `PRD` · `ARCHITECTURE` · `FEATURES` · `TASKS` · `ROADMAP` · `VERSIONING` — thin frames, not content. |
| **Archive contract** | `docs/archive/STATUS_ARCHIVE.md` + `TASKS_ARCHIVE.md`: when work merges, its full story moves here and `AGENTS.md` keeps ≤ 1 bullet per domain — the always-loaded context never bloats. |
| **Beads issue tracker** | Optional `bd` wiring with rules reconciled for this workflow: bd = cross-session issues, `docs/TASKS.md` = roadmap checklist, no auto-push. Silent when bd is not installed, and refuses to initialise until you rename the project — bd commits an identity, which must not ship from a template. |
| **Auto-versioning** | A conventional-commit hook bumps semver in `package.json` and syncs **every other manifest that exists** — inside the same commit. |
| `scripts/setup.mjs` | One-shot, idempotent, ordered bootstrap (order matters — see below). |

## Framework support

`npm run stack:detect` reads the markers in your repo; `npm run stack:apply` writes the answer into
`package.json` → `vibe.gates`, the `.gitignore` managed block and `docs/STACK.md`.

| Group | Entries |
|---|---|
| **Desktop** | Electron · Tauri · Wails · .NET MAUI · Avalonia |
| **JS frontend** | Next.js · Nuxt · React+Vite · Angular · Vue · SvelteKit · Astro · Remix/RR7 · SolidStart |
| **JS backend** | Express · NestJS · Fastify · Hono · AdonisJS · Elysia |
| **Mobile** | Expo · React Native (bare) · Flutter · Ionic/Capacitor · Android |
| **PHP** | Laravel · Symfony · CodeIgniter 4 · Slim · WordPress |
| **Python** | Django · FastAPI · Flask · Streamlit |
| **Go** | Gin · Echo · Fiber · chi |
| **Rust** | Axum · Actix · Rocket · Leptos |
| **JVM / .NET** | Spring Boot · Ktor · Quarkus · ASP.NET Core · Blazor |
| **Other** | Rails · Sinatra · Phoenix · Unity · Godot · Terraform · Helm · Docker Compose |
| **Language bases** | Node · Deno · Bun · Python · PHP · Go · Rust · Maven · Gradle · .NET · Ruby · Elixir · Dart · Swift · C/C++ |

Frameworks inherit their language base through `extends`, so Laravel gets PHP's rules plus its own,
and Tauri composes Rust **and** Node.

**On honesty:** 49 entries are verified; **21 are marked `"verified": false`** and their generated
`docs/STACK.md` carries a visible "verify these commands before trusting them" banner. A wrong
command an agent believes is worse than one it is told to check.

**Adding your framework** — one entry in `scripts/stacks.json`, then `npm run stack:validate`:

```jsonc
{ "id": "my-framework", "tier": "framework", "extends": "node", "verified": true,
  "detect": { "any": [{ "file": "myfw.config.*" }, { "dep": "my-framework" }] },
  "gates": { "test": "myfw test", "build": "myfw build" },
  "ignore": [".myfw/"],
  "coreLayer": "where heavy logic belongs in this framework",
  "conventions": ["the rule an agent would otherwise get wrong"] }
```

## Language / version-manifest support

`package.json` is the version source of truth (it exists in every copy as the *tooling* manifest,
whatever the app language). `scripts/version.mjs` propagates it to every manifest present:

| Stack | Synced target |
|---|---|
| JS/TS · Deno · Expo | `package.json` (source of truth) · `deno.json` · `app.json` (only when it is an Expo manifest) |
| Rust · Tauri | `Cargo.toml` + `Cargo.lock` — at the **repo root and/or `src-tauri/`** · `src-tauri/tauri.conf.json` |
| PHP | `composer.json` (only when it declares `"version"` — Packagist omits it, and that is respected) |
| Python | `pyproject.toml` (`[project]` or `[tool.poetry]`; skipped when `dynamic`) |
| Dart / Flutter | `pubspec.yaml` (the `+build` number is preserved, never auto-incremented) |
| Java / Kotlin | `pom.xml` (the project's own `<version>`, never `<parent>`'s or a dependency's) · `gradle.properties` · `versionName` in `build.gradle(.kts)` |
| .NET | `*.csproj`, `src/*/*.csproj`, `Directory.Build.props` (`<Version>` / `<VersionPrefix>`) |
| Elixir · Ruby · Helm | `mix.exs` · `*.gemspec` and `lib/**/version.rb` · `Chart.yaml` (`version` **and** `appVersion`) |
| WordPress | the `Version:` header of a plugin/theme file that actually declares one |
| Go / anything else | a root `VERSION` file (`go:embed` / `-ldflags`) |

Deliberately **not** touched, because they are release counters rather than semver: Android
`versionCode`, the Flutter build number, Xcode `MARKETING_VERSION`, Expo `runtimeVersion`.

## Quick start

```bash
# 1. copy the template (GitHub: "Use this template", or)
gh repo create my-project --template <owner>/vibe-template --private --clone
cd my-project

# 2. bootstrap (safe to re-run any time)
npm install          # activates the version hook via postinstall
npm run setup        # hooks → framework detection → agent docs → beads → dolt remote

# 3. check what it detected, then fill the <!-- TODO:fill --> sections
cat docs/STACK.md    # framework, core layer, gate commands
npm run gate         # should already run something sensible
```

Then open any AI coding tool and type your task — the rules ride along automatically.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | One-shot bootstrap. Idempotent; safe to re-run on any machine. |
| **`npm run gate`** | **The one command that means "is this green?"** — lint → typecheck → test → build, stopping at the first failure. |
| `npm run gate test` | A single stage. |
| `npm run gate:list` | What `gate` would run, without running it. |
| `npm run stack:detect` | Which framework matched, its bases, and the full ranking. |
| `npm run stack:list` | All 70 registry entries. |
| `npm run stack:apply` | Refresh `docs/STACK.md`, `vibe.gates` and the `.gitignore` block. |
| `npm run stack:reapply` | Same, but overwrite hand-tuned gates from the registry. |
| `npm run stack:validate` | Check `scripts/stacks.json` against its schema. |
| `npm run agents:sync` | Regenerate the per-tool pointer files from `AGENTS.md`. |
| `npm run agents:check` | Are they stale? (part of `gate`) |
| `npm run version:get` · `:patch` · `:minor` · `:major` · `:sync` | Manual version control. |

> **Why `gate:list` and `stack:reapply` are separate scripts:** `npm run gate --list` does **NOT**
> work — npm swallows a leading flag instead of forwarding it, so you would get a full gate run
> instead of a listing. A bare argument (`npm run gate test`) does pass through. Rather than expect
> every agent to remember `npm run gate -- --list`, the flag-taking forms get their own script — and
> a test fails the build if any doc reintroduces the broken form.

## Why the setup order matters

`scripts/setup.mjs` runs **git hooks → stack detection → agent docs → beads init → Claude hooks →
dolt remote**, because:

- `bd init` moves `core.hooksPath` to `.beads/hooks` and **chains whatever hook is already
  installed** — install the version hook first or it gets orphaned.
- `bd init` **auto-commits everything staged** — the script refuses to run it on a dirty index, and
  the detection/agent steps before it write only *unstaged* changes, so nothing can be swept in.
- bd is optional: when it is missing, steps 4–6 are skipped and the rest still completes.
- The Dolt sync remote lives in the local DB, not in git — it must be added per machine.

## Two machines?

See `SETUP.md` → "Second machine" for the exact checklist (what git carries for you, what is
per-machine, and how to sync beads issue data with `bd dolt push` / `bd dolt pull`).

## Layout

```
AGENTS.md              CANONICAL rules — edit here, then `npm run agents:sync`
CLAUDE.md              @AGENTS.md import + Claude-Code-only extras
GEMINI.md  CONVENTIONS.md  .cursor/  .windsurf/  .clinerules/  .junie/  .github/copilot-instructions.md
                       generated pointers — do not hand-edit
SETUP.md               fill-in checklist · second-machine checklist
docs/
  STACK.md             GENERATED per project: framework, core layer, gate commands
  PRD.md  ARCHITECTURE.md  FEATURES.md  TASKS.md  ROADMAP.md  VERSIONING.md
  archive/             STATUS_ARCHIVE.md · TASKS_ARCHIVE.md  (the anti-bloat contract)
scripts/
  stacks.json          the framework registry (DATA — add frameworks here)
  stacks.schema.json   its schema, enforced by the test suite
  stacks.mjs           detect → package.json / .gitignore / docs/STACK.md
  gate.mjs             `npm run gate`
  version.mjs          semver source of truth + every manifest it syncs
  sync-agents.mjs      AGENTS.md → per-tool pointer files
  setup.mjs  install-hooks.mjs  bd-prime.mjs
  lib/                 shared utils (git, managed blocks, tiny JSON-Schema validator)
  tests/               `node --test`, zero dependencies
.claude/settings.json  Claude Code hooks (guarded `bd prime`)
.githooks/             conventional-commit auto-version hook
.github/workflows/     CI running the same `npm run gate`
```

## Contributing to the template itself

`npm run gate` is the whole contract: it validates the registry against its schema, checks the
generated pointer files are in sync, and runs **105 tests** (`node --test`, zero dependencies)
covering every version-manifest planner, every detection rule, and the documented commands
themselves.

The invariants those tests protect, which are easy to break by accident:

- a bump must never touch a Cargo **dependency** version, a Maven `<parent>` or dependency version,
  an Android `versionCode`, or a Flutter build number;
- `writeAll` must validate **every** manifest before writing **any** of them;
- `react-vite` must not claim every React-based framework (that is what `detect.all` is for);
- a polyglot repo must report **both** stacks, not just the loudest one;
- every pointer file must restate the non-negotiables inline, not merely link to `AGENTS.md`;
- no doc may print an `npm run <script> --flag` form that npm will swallow.
