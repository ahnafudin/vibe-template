// The rule that keeps AI agents out of the contributor list.
//
// It is enforced in two places — the commit-msg hook (prevents) and
// check-attribution.mjs in CI (detects) — because neither covers the other's
// blind spot: the hook cannot run before it is installed, and CI cannot stop a
// commit being written. Two enforcers means one risk: they drift, and the
// detector stops recognising what the preventer stopped stripping.
//
// So the bot list is NOT copied. check-attribution.mjs reads it out of the hook,
// and these tests pin that the extraction works and that both agree.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { attributionRe, botPattern, offendingLines } from "../check-attribution.mjs";
import { at } from "../lib/util.mjs";

const HOOK = readFileSync(at(".githooks", "commit-msg"), "utf8");
const RE = attributionRe(botPattern(HOOK));

const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

const BOT_LINES = [
  "Co-authored-by: Claude Opus 5 <noreply@anthropic.com>",
  "Co-Authored-By: Cursor Agent <agent@cursor.com>",
  "Co-authored-by: Copilot <Copilot@users.noreply.github.com>",
  "Claude-Session: https://claude.ai/code/session_01ABC",
  "Claude-Code-Session: https://claude.ai/code/session_01ABC",
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  "Generated with [Cursor]",
];

// The ones a wrong rule eats. "Claude" is a real person's name — Claude Monet
// is in here on purpose — and matching agents by PRODUCT name once deleted a
// human whose address merely contained "amp", from "example.com".
const HUMAN_LINES = [
  "Co-authored-by: Ada Lovelace <ada@example.com>",
  "Co-authored-by: Claude Monet <monet@giverny.example>",
  "Co-authored-by: Amp Ersand <amp@example.org>",
  "Reviewed-by: Claude Shannon <shannon@bell.example>",
];

describe("the attribution rule", () => {
  it("is extracted from the hook, which stays the single source", () => {
    const bots = botPattern(HOOK);
    assert.match(bots, /noreply@anthropic/, "the extraction found something, but not the bot list");
    assert.match(bots, /@cursor/);
  });

  it("refuses to guess when the hook does not contain the rule", () => {
    // Loud, not silent: a detector that cannot find its own pattern must never
    // fall back to matching nothing, which reads exactly like "all clean".
    assert.throws(() => botPattern("#!/bin/sh\necho hello\n"), /cannot find the BOTS/);
  });

  it("matches every agent trailer", () => {
    for (const line of BOT_LINES) assert.ok(RE.test(line), `missed: ${line}`);
  });

  it("leaves human co-authors alone", () => {
    for (const line of HUMAN_LINES) assert.ok(!RE.test(line), `wrongly matched a human: ${line}`);
  });

  it("only matches a trailer at the start of a line", () => {
    // This repo's own commit messages DISCUSS attribution at length. Prose that
    // mentions the trailer must not be treated as carrying it.
    const prose = "The hook strips a Co-authored-by: line naming noreply@anthropic.com from the message.";
    assert.deepEqual(offendingLines(prose, RE), []);
  });
});

describe("hook and CI check agree", () => {
  // The one that matters: run the REAL hook over a message and assert it removed
  // exactly the lines the CI rule flags. If either side is edited alone, this
  // fails rather than letting a bot through the detector or a human through the
  // stripper.
  it("strip and detect are the same set of lines", (t) => {
    const sh = spawnSync("sh", ["--version"], { encoding: "utf8" });
    if (sh.error) return t.skip("no POSIX sh here — the hook cannot be executed");

    const dir = mkdtempSync(join(tmpdir(), "vibe-attr-"));
    trash.push(dir);
    const file = join(dir, "COMMIT_EDITMSG");
    const message = ["feat: something", "", ...HUMAN_LINES, ...BOT_LINES, ""].join("\n");
    writeFileSync(file, message);

    const r = spawnSync("sh", [at(".githooks", "commit-msg"), file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);

    const after = readFileSync(file, "utf8").split("\n");
    const removed = message.split("\n").filter((line) => line && !after.includes(line));
    const flagged = offendingLines(message, RE);

    assert.deepEqual(
      [...removed].sort(),
      [...flagged].sort(),
      "the hook removes a different set of lines than the CI check flags — they have drifted",
    );
    for (const human of HUMAN_LINES) {
      assert.ok(after.includes(human), `the hook deleted a human co-author: ${human}`);
    }
  });
});
