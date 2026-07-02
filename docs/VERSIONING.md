# Versioning

Semantic versioning (MAJOR.MINOR.PATCH). **`package.json` is the single source of truth**;
`scripts/version.mjs` propagates it to any optional sync targets that exist (Tauri config,
Cargo manifests — extend `writeAll()` in the script for other stacks). Never hand-edit the
version in just one file. Writes are two-phase (validate everything, then flush), so a
failure can never leave the manifests half-synced.

## Auto-bump on commit

`.githooks/post-commit` (activated by `npm run setup` / `npm install` → postinstall →
`hooks:install`, which sets `core.hooksPath`) reads the conventional-commit type of the
commit that just landed, bumps the manifests, and **folds the bump into that same commit
with a guarded `git commit --amend`**:

| Commit | Bump |
|---|---|
| `feat:` | MINOR |
| `fix:` / `perf:` / `refactor:` | PATCH |
| `type!:` or a `BREAKING CHANGE:` footer (colon required, conventional header required) | MAJOR |
| `docs:` `chore:` `test:` `ci:` `style:` `build:` / non-conventional | none |

> Why post-commit + amend? Git snapshots the index BEFORE `prepare-commit-msg` runs, so a
> bump staged there lands one commit late (shipping the previous version) and leaves a
> permanently dirty index that breaks the next rebase/cherry-pick — verified empirically.
> post-commit is the only hook that can put the bump in the same commit.

Built-in guards (all fail-soft):

- **Recursion:** the amend re-triggers post-commit; a `VIBE_VERSION_AMEND` env guard stops it.
- **Sequences:** the hook skips entirely during rebase / merge / cherry-pick / revert / bisect —
  amending mid-sequence is the classic double-bump corruption.
- **Dirty manifests:** if a version manifest already has local edits, the hook skips (with a
  stderr note) instead of silently sweeping your changes into the commit — bump manually then.

⚠️ The amend rewrites the just-created commit's SHA. That is safe locally (it happens
immediately, before any push), but never re-run history-rewriting tools between commit and
push expecting the pre-amend SHA.

## Manual control

```bash
npm run version:get
npm run version:patch   # or :minor / :major
node scripts/version.mjs set 1.2.3
npm run version:sync    # re-propagate package.json to the sync targets
```

## Notes for Rust/Cargo projects

- The Cargo rewrite is scoped to the `[package]` section, so dependency `version = "…"` lines
  are never touched. A workspace-inherited version (`version.workspace = true`) is skipped
  with a note — the workspace root owns the version in that layout.
- `Cargo.lock` is updated best-effort; cargo reconciles it on the next build anyway.
