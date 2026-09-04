// Tests for scripts/verify-stack.mjs — the tool CI drives to settle whether an
// entry's markers and gates match the real framework. Its failure message is the
// product here: when a run goes red, that text is all anyone sees.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { parseArgs, verifyStack } from "../verify-stack.mjs";

const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-verify-"));
  trash.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

describe("verifyStack", () => {
  it("confirms a matching entry and reports the gates it would run", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ name: "fx", dependencies: { express: "4.19.0" } }),
    });
    const r = verifyStack(dir, "express");
    assert.equal(r.ok, true);
    assert.equal(r.id, "express");
    assert.ok(r.gates, "the caller needs to see what would run");
    assert.equal(r.ran, false, "detection only unless --run is passed");
  });

  it("explains a mismatch with the ranking AND what to do about it", () => {
    // This message is the entire output of a failed CI job. It has to name the
    // entry that won and point at the fix, because "detection failed" alone
    // sends someone hunting through 70 entries.
    const dir = fixture({
      "package.json": JSON.stringify({ name: "fx", dependencies: { express: "4.19.0" } }),
    });
    const r = verifyStack(dir, "fastify");
    assert.equal(r.ok, false);
    assert.equal(r.id, "express");
    assert.match(r.reason, /returned express, expected fastify/);
    assert.match(r.reason, /express\(1\)/, "the ranking must be in the message");
    assert.match(r.reason, /more signals/, "and the remedy for the common cause");
  });

  it("fails cleanly on a directory that is not there", () => {
    const r = verifyStack(join(tmpdir(), "definitely-not-here-xyz"), "node");
    assert.equal(r.ok, false);
    assert.match(r.reason, /no such directory/);
  });

  it("reports nothing detected rather than crashing on an empty repo", () => {
    const r = verifyStack(fixture({ "README.md": "hi" }), "node");
    assert.equal(r.ok, false);
    assert.equal(r.id, null);
    assert.match(r.reason, /returned nothing/);
  });
});

describe("argument parsing", () => {
  it("accepts --only in both the = form and the space form", () => {
    // The space form is the one this script's OWN usage line documents, and it
    // was being dropped: `"--only".split("=")[1]` is undefined, so every gate
    // ran and `lint` fell through into the positional arguments as a third
    // argument nobody reads. It looked like it had honoured the request.
    const equals = parseArgs(["fx", "express", "--run", "--only=lint,test"]);
    const spaced = parseArgs(["fx", "express", "--run", "--only", "lint,test"]);
    for (const parsed of [equals, spaced]) {
      assert.deepEqual(parsed.only, ["lint", "test"]);
      assert.deepEqual(parsed.positional, ["fx", "express"]);
      assert.equal(parsed.run, true);
      assert.equal(parsed.error, null);
    }
  });

  it("refuses a mistyped flag rather than ignoring it", () => {
    const r = parseArgs(["fx", "express", "--run", "--onyl=lint"]);
    assert.match(r.error, /unknown flag: --onyl=lint/);
  });

  it("refuses --only with no gate named", () => {
    assert.match(parseArgs(["fx", "express", "--only"]).error, /at least one gate name/);
    assert.match(parseArgs(["fx", "express", "--only="]).error, /at least one gate name/);
  });
});

describe("an --only that names no real gate", () => {
  it("refuses instead of reporting a pass having run nothing", () => {
    // This is the shape that matters: CI marks an entry verified on the strength
    // of this exit code, so an empty selection must never read as success.
    const dir = fixture({
      "package.json": JSON.stringify({ name: "fx", dependencies: { express: "4.19.0" } }),
    });
    const r = verifyStack(dir, "express", { run: true, only: ["linting"] });
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown gate: linting/);
    // and it must not be blamed on a gate, because no gate ran
    assert.doesNotMatch(r.reason, /gate `null`/);
  });
});
