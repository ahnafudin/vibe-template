# Versioning

Semantic versioning (MAJOR.MINOR.PATCH). **`package.json` is the single source of truth**;
`scripts/version.mjs` propagates it to any optional sync targets that exist (Tauri config,
Cargo manifests — extend `writeAll()` in the script for other stacks). Never hand-edit the
version in just one file.

## Auto-bump on commit

`.githooks/prepare-commit-msg` (activated by `npm run setup` / `npm install` → postinstall →
`hooks:install`, which sets `core.hooksPath`) reads the conventional-commit type:

| Commit | Bump |
|---|---|
| `feat:` | MINOR |
| `fix:` / `perf:` / `refactor:` | PATCH |
| `type!:` or a `BREAKING CHANGE` footer | MAJOR |
| `docs:` `chore:` `test:` `ci:` `style:` `build:` / non-conventional | none |

The bump is staged INTO the same commit. Merges, squashes, and amends never bump.

## Manual control

```bash
npm run version:get
npm run version:patch   # or :minor / :major
node scripts/version.mjs set 1.2.3
npm run version:sync    # re-propagate package.json to the sync targets
```

## Known footguns (learned the hard way)

- **A plain `git commit` can leave the bump out** of the commit in some clients — fix with
  `git commit --amend --no-edit`.
- **`git rebase` can DOUBLE-bump** (the hook re-fires on every replayed `feat`/`fix` commit).
  If it happens: `git checkout HEAD -- package.json <sync targets>` before continuing.
  Prefer plain `git pull` (merge) over `git pull --rebase` on shared branches.
- If beads is used, `bd init` moves `core.hooksPath` to `.beads/hooks` and CHAINS this hook —
  `npm run setup` runs hooks-first-then-bd precisely so the chain is preserved.
