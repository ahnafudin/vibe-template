// The rule that keeps other accounts out of the contributor list.
//
// It is enforced in two places — the commit-msg hook (prevents) and
// check-attribution.mjs in CI (detects) — because neither covers the other's
// blind spot: the hook cannot run before it is installed, and CI cannot stop a
// commit being written. Two enforcers means one risk: they drift, and the
// detector stops recognising what the preventer stopped stripping.
//
// So the rule is not copied. check-attribution.mjs reads the hook's actual
// PATTERN line, and these tests pin that the extraction works and that both
// agree — by running the real hook, not a description of it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { attributionRe, hookRule, offendingLines } from "../check-attribution.mjs";
import { at } from "../lib/util.mjs";

const HOOK = readFileSync(at(".githooks", "commit-msg"), "utf8");
const RE = attributionRe(hookRule(HOOK));

const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Every one of these goes. The co-author lines are the point: this project's
// commits have exactly one author, so an agent's trailer and a person's are
// removed alike. Telling them apart was tried twice and failed twice — by name
// ("Amp" matches inside "example.com", which deleted a real person) and by bot
// address (a list that must grow with every new agent, where one missed entry
// is permanent).
const STRIPPED = [
  "Co-authored-by: Some Agent <noreply@anthropic.com>",
  "Co-Authored-By: Another Agent <agent@cursor.com>",
  "Co-authored-by: A Person <person@example.test>",
  "co-authored-by: lower case <x@y.test>",
  "  Co-authored-by: Indented <z@y.test>",
  "Claude-Session: https://claude.ai/code/session_01ABC",
  "Claude-Code-Session: https://claude.ai/code/session_01ABC",
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "Generated with [Cursor]",
];

// And these stay: they are not attribution trailers at all.
const KEPT = [
  "fix: a real change",
  "Reviewed-by: A Reviewer <review@example.test>",
  "Signed-off-by: The Author <author@example.test>",
  "Refs: #123",
];

describe("the attribution rule", () => {
  it("is extracted from the hook, which stays the single source", () => {
    const rule = hookRule(HOOK);
    assert.match(rule, /Co-authored-by:/i, "the extraction found something, but not the rule");
    assert.match(rule, /Session:/);
  });

  it("refuses to guess when the hook does not contain the rule", () => {
    // Loud, not silent: a detector that cannot find its own pattern must never
    // fall back to matching nothing, which reads exactly like "all clean".
    assert.throws(() => hookRule("#!/bin/sh\necho hello\n"), /cannot find the PATTERN/);
  });

  it("matches every trailer that must not survive", () => {
    for (const line of STRIPPED) assert.ok(RE.test(line), `missed: ${line}`);
  });

  it("leaves other trailers and ordinary lines alone", () => {
    for (const line of KEPT) assert.ok(!RE.test(line), `wrongly matched: ${line}`);
  });

  it("only matches at the start of a line", () => {
    // This repo's own commit messages DISCUSS attribution at length. Prose that
    // mentions a trailer must not be treated as carrying one.
    const prose = 'Explains how a Co-authored-by: line and "Generated with Claude Code" appear.';
    assert.deepEqual(offendingLines(prose, RE), []);
  });
});

describe("hook and CI check agree", () => {
  // The one that matters: run the REAL hook over a message and assert it removed
  // exactly the lines the CI rule flags. If either side is edited alone this
  // fails, rather than letting a trailer slip past the detector or a good line
  // get eaten by the stripper.
  it("strip and detect are the same set of lines", (t) => {
    const sh = spawnSync("sh", ["--version"], { encoding: "utf8" });
    if (sh.error) return t.skip("no POSIX sh here — the hook cannot be executed");

    const dir = mkdtempSync(join(tmpdir(), "vibe-attr-"));
    trash.push(dir);
    const file = join(dir, "COMMIT_EDITMSG");
    const message = ["feat: something", "", ...KEPT.slice(1), ...STRIPPED, ""].join("\n");
    writeFileSync(file, message);

    const r = spawnSync("sh", [at(".githooks", "commit-msg"), file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);

    const result = readFileSync(file, "utf8").split("\n");
    const removed = message.split("\n").filter((line) => line && !result.includes(line));
    const flagged = offendingLines(message, RE);

    assert.deepEqual(
      [...removed].sort(),
      [...flagged].sort(),
      "the hook removes a different set of lines than the CI check flags — they have drifted",
    );
    for (const keep of KEPT.slice(1)) {
      assert.ok(result.includes(keep), `the hook removed a line it should not: ${keep}`);
    }
  });

  it("never blanks a message that is nothing but trailers", (t) => {
    // Fail-soft: losing what somebody wrote is worse than keeping a trailer,
    // and an empty commit message aborts the commit outright.
    const sh = spawnSync("sh", ["--version"], { encoding: "utf8" });
    if (sh.error) return t.skip("no POSIX sh here");
    const dir = mkdtempSync(join(tmpdir(), "vibe-attr-"));
    trash.push(dir);
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, `${STRIPPED.join("\n")}\n`);
    const r = spawnSync("sh", [at(".githooks", "commit-msg"), file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(readFileSync(file, "utf8").trim().length > 0, "the hook emptied the message");
  });
});
