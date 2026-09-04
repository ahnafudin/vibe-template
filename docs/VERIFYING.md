# Verifying a registry entry

`verified` in `scripts/stacks.json` claims two things about an entry:

1. these **detection markers** identify the real framework, and
2. these **gate commands** actually run in a real project of that framework.

Neither can be settled from inside this repo. A fixture written by hand only
echoes back what the registry already says — it has to be a project the
framework's own scaffolder produced.

## The procedure

```bash
# 1. scaffold with the framework's OWN creator, in a throwaway directory
composer create-project slim/slim-skeleton /tmp/fx --no-interaction

# 2. detection must name the entry, and the gates must pass in that project
node scripts/verify-stack.mjs /tmp/fx slim --run
```

`verify-stack.mjs` prints the ranking, prints the gates the registry resolves,
and runs them with the same runner `npm run gate` uses — so a pass there means a
pass in a real project.

**When something fails, fix the entry, not the fixture.** That is the whole
point. Then add the case to `scripts/tests/stacks.test.mjs` so the detection can
never regress, flip `verified`, and commit that entry on its own so a bad one can
be reverted alone.

## Where it runs

`.github/workflows/verify-stacks.yml` does all of the above on GitHub's runners,
which already ship PHP, Composer, a JDK, Maven, Gradle, the .NET SDK, Ruby, Node,
Go, Python and Rust. Nothing is installed on anybody's machine.

It runs on demand, on any change to `stacks.json`, and **monthly** — because
`verified` rots. Angular's test gate was verified once and then broke silently
when Angular moved from Karma to Vitest. Only running it again caught that, and
only a schedule catches the next one.

## What this has actually caught

Every one of these was invisible to the unit tests and was found by running the
real thing:

| Entry | Failure |
|---|---|
| `cpp` | `cmake --build build` assumed a configured build directory; `ctest` needed `-C` under multi-config generators |
| `wails` | detected as **Echo** — Wails vendors labstack/echo as an indirect dependency; and `go vet`/`build`/`test` all failed on a fresh clone because `go:embed` needs a gitignored `frontend/dist` |
| `ionic` | detected as **Angular** |
| `leptos` | detected as **Axum** |
| `angular` | already marked verified, but its Karma-era `--browsers=ChromeHeadless` had stopped working |

Three of those share one cause, and it is now a rule: **a framework built on
another must carry more detection signals than the one it is built on**, because
ties break alphabetically. See the `detect` notes in `scripts/stacks.schema.json`.

## Entries that cannot be verified here

`unity` needs a licence and a ~10GB editor, and `godot`'s build is an editor
export, so neither is built here. But **neither entry declares any gates**, so
detection is the only thing that can be wrong about them — and that is checkable
without either editor. Both run in the matrix as `detectOnly`, which is an honest
`verified: true`: it says the markers are right, and there is nothing else the
entry claims.

The distinction matters. "Cannot be verified" would have left two permanent
unknowns in a registry whose whole value is that its claims are checked. What was
actually unverifiable was a build path neither entry promises.
