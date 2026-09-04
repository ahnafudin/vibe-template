#!/usr/bin/env node
// scripts/verify-stack.mjs — settle the question `verified` asks: are this
// entry's markers and gate commands actually right for the real framework?
//
//   node scripts/verify-stack.mjs <dir> <expected-id> [--run] [--only lint,test]
//
// Point it at a project scaffolded by the framework's OWN creator (npm init
// adonisjs, composer create-project, dotnet new, wails init …). It asserts that
// detection returns the expected entry, prints the gates the registry resolves
// for it, and with `--run` executes them in that directory — the same runner
// `npm run gate` uses, so a pass here means a pass there.
//
// A fixture written by hand proves nothing: it would only echo back whatever the
// registry already claims. The scaffold has to come from upstream.
//
// This is what .github/workflows/verify-stacks.yml drives, so the toolchains
// live on GitHub's runners instead of anybody's laptop.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runGates } from "./gate.mjs";
import { parseFlags } from "./lib/util.mjs";
import { detectResolved, loadRegistry, mergeGates } from "./stacks.mjs";

const note = (msg) => process.stderr.write(`${msg}\n`);

export function verifyStack(dir, expected, { run = false, only = [] } = {}) {
  const root = resolve(dir);
  if (!existsSync(root)) return { ok: false, reason: `no such directory: ${root}` };

  const stacks = loadRegistry();
  const found = detectResolved(root, stacks);
  const id = found.primary?.id ?? null;
  const ranked = found.ranked.map((m) => `${m.id}(${m.score})`).join(", ");

  if (id !== expected) {
    return {
      ok: false,
      id,
      ranked,
      reason:
        `detection returned ${id ?? "nothing"}, expected ${expected}. ` +
        `Ranking: ${ranked || "(no match)"}. ` +
        "If a framework this one is built on won the tie, give this entry more signals — " +
        "see the `detect` notes in scripts/stacks.schema.json.",
    };
  }

  const gates = mergeGates(found.primary, found.secondary);
  if (!run) return { ok: true, id, ranked, gates, ran: false };

  const result = runGates(gates, { cwd: root, only });
  if (!result.ok) {
    return {
      ok: false,
      id,
      ranked,
      gates,
      ran: true,
      // `failed` is null when the run was REFUSED rather than failed — an
      // --only naming no real gate. Blaming `gate \`null\`` for that hid what
      // had actually gone wrong, which was the request, not the project.
      reason:
        (result.failed ? `gate \`${result.failed}\` failed (exit ${result.code})` : result.reason) +
        (result.failed && result.reason ? ` — ${result.reason}` : "") +
        (result.passed.length ? `. Passed first: ${result.passed.join(", ")}` : ""),
    };
  }
  return { ok: true, id, ranked, gates, ran: true, passed: result.passed };
}

const USAGE = "usage: verify-stack.mjs <dir> <expected-id> [--run] [--only lint,test]";

/**
 * Both `--only=lint,test` and `--only lint,test` — the space form is the one
 * this file's own usage line documents, and it used to be dropped on the floor:
 * `"--only".split("=")[1]` is undefined, so the flag became an empty selection
 * (every gate ran), and `lint` fell through into the positional arguments.
 * Silently doing something other than what was asked is worse than refusing.
 */
export function parseArgs(argv) {
  const { positional, flags, problems } = parseFlags(argv, { known: ["--run"], valued: ["--only"] });
  return {
    positional,
    only: (flags.get("--only") ?? "").split(",").filter(Boolean),
    run: flags.has("--run"),
    error: problems[0] ?? null,
  };
}

function main(argv) {
  const { positional, only, run, error } = parseArgs(argv);
  const [dir, expected] = positional;
  if (error) {
    note(`[verify] ${error}`);
    note(USAGE);
    return 2;
  }
  if (!dir || !expected) {
    note(USAGE);
    return 2;
  }

  const r = verifyStack(dir, expected, { run, only });

  note(`[verify] entry    : ${expected}`);
  note(`[verify] detected : ${r.id ?? "(none)"}`);
  if (r.ranked) note(`[verify] ranking  : ${r.ranked}`);
  if (r.gates) {
    note("[verify] gates    :");
    for (const [k, v] of Object.entries(r.gates)) {
      if (!v) continue;
      for (const c of [].concat(v)) note(`           ${k.padEnd(10)} ${c}`);
    }
  }
  if (!r.ok) {
    note(`[verify] FAILED   : ${r.reason}`);
    return 1;
  }
  note(r.ran ? `[verify] PASSED   : ${r.passed.join(" → ")}` : "[verify] detection OK (gates not run; pass --run)");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
