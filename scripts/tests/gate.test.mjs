// Tests for the shared gate runner.
//
// `runGates` is the single place gates actually execute: `npm run gate` calls
// it, and so does verify-stack.mjs, which is what CI trusts when it marks a
// registry entry verified. That makes one of its failure modes worse than a
// crash — selecting NO gates and returning ok. A green that means "I did not
// look" is indistinguishable from a green that means "I checked", and the
// second caller had no CLI validation to catch it.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runGates } from "../gate.mjs";

// `node --version` is the one command guaranteed present wherever these tests
// run: this is about gate SELECTION, not about what a gate does.
const OK = "node --version";

describe("runGates selection", () => {
  it("runs every configured gate when nothing is singled out", () => {
    const r = runGates({ lint: OK, test: OK }, { only: [] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.passed, ["lint", "test"]);
  });

  it("runs only the gate named", () => {
    const r = runGates({ lint: OK, test: OK }, { only: ["lint"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.passed, ["lint"]);
  });

  it("refuses a name that is not a gate, instead of passing having run nothing", () => {
    const r = runGates({ lint: OK, test: OK }, { only: ["linting"] });
    assert.equal(r.ok, false, "a typo must not be reported as a pass");
    assert.deepEqual(r.passed, []);
    assert.match(r.reason, /unknown gate: linting/);
    // The available names belong in the message: the caller mistyped, and
    // guessing again is the only alternative to being told.
    assert.match(r.reason, /available: lint, test/);
  });

  it("refuses a gate that exists in config but has no command", () => {
    // `typecheck: null` is how the registry says "this stack has none". Asking
    // for it should say so, not quietly succeed at running zero commands.
    const r = runGates({ lint: OK, typecheck: null }, { only: ["typecheck"] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown gate: typecheck/);
  });

  it("still reports which gates passed before one failed", () => {
    const r = runGates({ lint: OK, test: "node --this-flag-does-not-exist" }, {});
    assert.equal(r.ok, false);
    assert.equal(r.failed, "test");
    assert.deepEqual(r.passed, ["lint"], "a failure must not erase the work that succeeded");
  });
});
