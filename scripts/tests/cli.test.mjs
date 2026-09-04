// Every CLI must refuse a flag it does not know.
//
// The unit tests for `parseFlags` prove the parser works; they cannot prove a
// CLI actually calls it. That gap is the whole bug: each script tested its flags
// with `argv.includes("--check")`, which ignores a typo and falls through to the
// DEFAULT branch. Where the flag exists to make a command do LESS, the default
// is the dangerous branch — `sync-agents.mjs --chek` turned "verify and write
// nothing" into a rewrite that exited 0, so the lint gate calling it could not
// have failed. This spawns each one for real.
//
// A bogus flag is safe to run: refusal happens before any work.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));

const CASES = [
  { name: "gate.mjs", argv: ["--lst"] },
  { name: "sync-agents.mjs", argv: ["--chek"] },
  { name: "personalize.mjs", argv: ["--forse"] },
  { name: "stacks.mjs", argv: ["apply", "--forse"] },
  { name: "verify-stack.mjs", argv: [".", "node", "--onyl=lint"] },
];

describe("CLI flag handling", () => {
  for (const { name, argv } of CASES) {
    it(`${name} refuses ${argv.at(-1)}`, () => {
      const r = spawnSync(process.execPath, [script(name), ...argv], { encoding: "utf8" });
      assert.notEqual(r.status, 0, `${name} accepted a flag it does not know:\n${r.stdout}${r.stderr}`);
      assert.match(
        r.stderr,
        /unknown flag/,
        `${name} must SAY which flag it did not understand, not just fail`,
      );
    });
  }

  it("still accepts the flags that are real", () => {
    const r = spawnSync(process.execPath, [script("gate.mjs"), "--list"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /source:/, "--list must still list");
  });
});
