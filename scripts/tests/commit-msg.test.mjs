// Tests for .githooks/commit-msg — the hook that keeps AI agents out of the
// repository's contributor list.
//
// Settings can only ever cover the agent you configured. Every tool has its own
// switch, new ones appear constantly, and one missed setting puts a bot in the
// GitHub contributor graph permanently. This hook is the tool-agnostic net, so
// what it must NOT delete matters as much as what it must.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { at } from "../lib/util.mjs";

const HOOK = at(".githooks", "commit-msg");
const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Run the hook over a message and return what it left behind. */
function run(message) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-msg-"));
  trash.push(dir);
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const r = spawnSync("sh", [HOOK, file], { encoding: "utf8" });
  return { out: readFileSync(file, "utf8"), status: r.status, error: r.error };
}

describe("commit-msg strips agent attribution", () => {
  it("removes bot co-authors, session trailers and the generated-with line", () => {
    const { out, error } = run(
      [
        "feat: a real change",
        "",
        "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>",
        "Co-authored-by: Cursor Agent <cursoragent@cursor.com>",
        "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>",
        "Claude-Session: https://claude.ai/code/session_abc",
        "",
        "🤖 Generated with [Claude Code](https://claude.com/claude-code)",
        "",
      ].join("\n"),
    );
    if (error) return; // no POSIX shell on this machine
    assert.doesNotMatch(out, /anthropic\.com/);
    assert.doesNotMatch(out, /cursor\.com/);
    assert.doesNotMatch(out, /Copilot@/);
    assert.doesNotMatch(out, /Claude-Session/);
    assert.doesNotMatch(out, /Generated with \[Claude Code\]/);
    assert.match(out, /^feat: a real change/);
  });

  it("KEEPS a human co-author, including one named Claude", () => {
    // Both of these were deleted by the first version of the pattern: matching
    // product names case-insensitively made "Amp" match inside "example.com",
    // and "Claude" is a real person's name.
    const { out, error } = run(
      [
        "fix: something",
        "",
        "Co-authored-by: Ada Lovelace <ada@example.com>",
        "Co-authored-by: Claude Monet <claude.monet@example.org>",
        "",
      ].join("\n"),
    );
    if (error) return;
    assert.match(out, /Ada Lovelace <ada@example\.com>/);
    assert.match(out, /Claude Monet <claude\.monet@example\.org>/);
  });

  it("leaves prose that merely discusses attribution alone", () => {
    // This repository's own commit messages talk about Co-authored-by lines and
    // "Generated with Claude Code" at length; the hook is anchored so a body
    // mentioning them is never silently rewritten.
    const body = 'Explains how "Generated with Claude Code" and Co-authored-by: appear in commits.';
    const { out, error } = run(`docs: explain attribution\n\n${body}\n`);
    if (error) return;
    assert.match(out, /Generated with Claude Code/);
    assert.match(out, /Co-authored-by:/);
  });

  it("never blanks a message, and never fails a commit", () => {
    const only = run("Co-Authored-By: Claude <noreply@anthropic.com>\n");
    if (only.error) return;
    assert.equal(only.status, 0);
    assert.ok(only.out.trim().length > 0, "a message reduced to nothing must be left as it was");

    const missing = spawnSync("sh", [HOOK, join(tmpdir(), "definitely-not-here")], { encoding: "utf8" });
    if (!missing.error) assert.equal(missing.status, 0, "a missing message file must not block a commit");
  });

  it("trims the blank lines the removed trailers leave behind", () => {
    const { out, error } = run(
      ["feat: x", "", "body", "", "Co-Authored-By: Claude <noreply@anthropic.com>", "", ""].join("\n"),
    );
    if (error) return;
    assert.equal(out, "feat: x\n\nbody\n");
  });
});
