// Tests for scripts/verify-stack.mjs — the tool CI drives to settle whether an
// entry's markers and gates match the real framework. Its failure message is the
// product here: when a run goes red, that text is all anyone sees.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { verifyStack } from "../verify-stack.mjs";

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
