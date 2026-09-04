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
| `slim` | detected as **docker-compose** — slim-skeleton ships a compose file, and any repo with one would have been mis-detected the same way |
| `ktor` | matched nothing: the pattern could only see the repository root, while `gradle init` writes `app/build.gradle.kts` |
| `blazor` | detected as **ASP.NET Core** |
| `bun` | inherited npm's `--if-present` from the node base; bun has no such flag, so the gate failed on every Bun project |
| `dotnet` | `dotnet format --verify-no-changes` fails on the output of `dotnet new` itself, making every new .NET project start red |
| `swift` | lint gate was `swiftlint`, which is a separate install and exits 127 on a stock machine |
| `wordpress` | `phpcs --standard=WordPress` named a standard and no target, so it exited 3 with "You must supply at least one file or directory" |

Four of those share one cause, and it is now a rule: **a framework built on
another must carry more detection signals than the one it is built on**, because
ties break alphabetically. See the `detect` notes in `scripts/stacks.schema.json`.
A fifth — `slim` losing to `docker-compose` — is the same shape without the
inheritance: infrastructure entries now carry a negative weight, because a
compose file, a chart or some `.tf` usually sits ALONGSIDE an application rather
than being the project.

A separate lesson runs through the gate failures: **a green test gate means
different things in different languages.** `pytest`, `bun test` and `swift test`
all exit non-zero with no tests; `cargo test`, `go test` and `node ace test` pass
vacuously. Each is recorded as a convention on its language base, so nobody has
to rediscover it per project.

## Verify what the entry actually claims

Three entries cannot have every gate run on a CI runner, and each is scoped to
the part that is genuinely its own — not waved through, and not left unknown.

| Entry | Scoped to | Why the rest is not run here |
|---|---|---|
| `unity` | detection | needs a licence and a ~10GB editor |
| `godot` | detection | its build is an editor export |
| `wordpress` | `lint` | a real WP suite needs the WP test harness and a database |

`unity` and `godot` **declare no gates at all**, so detection is the only thing
that can be wrong about them, and that is checkable without either editor. They
run as `detectOnly`, which is an honest `verified: true`: the markers are right,
and the entry claims nothing else.

`wordpress` is the sharper case. It declares a `test` gate — but that gate is
`vendor/bin/phpunit`, inherited unchanged from the `php` base and already
verified by `codeigniter4` and `slim`. What is specific to WordPress is its
detection marker and its `phpcs --standard=WordPress` lint gate, and both of
those run. Pointing bare phpunit at a bare theme would only have proved that
phpunit prints its own help — which is exactly what it did, and is not a fact
about the registry. The matrix scopes that job with `only: lint`.

The distinction matters. "Cannot be verified" would have left three permanent
unknowns in a registry whose whole value is that its claims are checked. What was
actually unverifiable was a build path, an editor export, and a database — none
of which these entries promise.

## The verifier itself

`verify-stack.mjs` is what CI trusts when it marks an entry verified, so a bug in
it is worse than a bug in an entry: it is a wrong answer that looks like a right
one. Two were found by running it against its own edge cases rather than against
a framework.

**`--only=<typo>` reported a pass having run nothing.** The runner filtered the
gate list down to the names given; a name matching none left an empty selection,
the loop never ran, and it returned green with `PASSED :` and an empty list. The
guard now lives in `runGates`, the shared runner — not in `gate.mjs`'s argument
parsing, which is where it was, and which is precisely why the other caller
skipped it.

**`--only lint` ran every gate.** The space-separated form is the one this
script's own usage line documents, and it was parsed as `"--only".split("=")[1]`
— undefined. So the flag selected nothing (meaning: run everything) and `lint`
fell through into the positional arguments. Both forms now work, and a mistyped
flag is refused rather than ignored.

Looking for the same shape elsewhere found it in the one command that writes
files. **`stacks.mjs apply ../my-app` configured this template instead.** The
`apply()` function had always taken a root; the CLI simply never passed the
directory it was given. `detect` did accept one, which is what made the pair look
symmetrical and the omission invisible — and every test fixture manufactured a
`docs/` directory, so the ENOENT a real fresh project hits was invisible too.

The shape is the same in all three, and it is the shape worth remembering: **a
check that silently does less than it was asked to is indistinguishable from one
that passed.** Anything that narrows what gets verified — a flag, a filter, an
argument quietly dropped — has to fail loudly when the narrowing makes no sense.
