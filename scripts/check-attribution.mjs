#!/usr/bin/env node
// scripts/check-attribution.mjs — fail when a commit carries AI-agent attribution.
//
//   node scripts/check-attribution.mjs [--range A..B] [--quiet]
//
// The commit-msg hook already strips this. This exists because a hook only
// protects commits made AFTER it was installed, in a clone where it IS
// installed — and neither is guaranteed:
//
//   * `core.hooksPath` cannot be committed (git forbids it, for good reasons),
//     so a fresh clone has no hooks until `npm install` or `npm run setup` runs.
//   * `npm install --ignore-scripts` skips postinstall entirely.
//   * A non-JS project may never run npm at all.
//
// Every one of those leaves a window where an agent can commit unattributed-to
// nobody, and the cost of that window is permanent: a bot in the repository's
// GitHub contributor list, removable only by rewriting published history.
//
// So this runs in CI, where none of the local setup matters. It catches the
// first push — while a rewrite is still cheap, because nobody else has cloned.
//
// The bot list is NOT duplicated here. It is read out of .githooks/commit-msg,
// which stays the single source of truth: a list that can drift between the
// thing that prevents and the thing that detects is worse than one list.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { at, note as write, parseFlags } from "./lib/util.mjs";

const note = (msg) => write(msg, "[attribution] ");

/**
 * Pull the bot-address alternation out of the hook.
 *
 * Deliberately loud on failure: a check that cannot find its own pattern must
 * not quietly pass, or it becomes a green light that means "I did not look".
 */
export function botPattern(hookSource) {
  const m = /^BOTS='([^']+)'/m.exec(hookSource);
  if (!m) throw new Error("cannot find the BOTS='…' line in .githooks/commit-msg");
  return m[1];
}

/** The same rule the hook applies, anchored the same way. */
export function attributionRe(bots) {
  return new RegExp(
    `^[ \\t]*(Co-authored-by:[ \\t]*.*(${bots})` +
      `|(Claude|Cursor|Codex|Copilot)-(Code-)?Session:` +
      `|(\u{1F916}[ \\t]*)?Generated with[ \\t]*\\[?(Claude Code|Cursor|Copilot|Codex|opencode))`,
    "iu",
  );
}

/** Offending lines in one message, empty when it is clean. */
export function offendingLines(message, re) {
  return message.split("\n").filter((line) => re.test(line));
}

// One `git log` for the whole history, not two calls per commit: a derived
// project can grow to thousands of commits, and this runs on every push.
// \x1e separates fields, \x1f separates records — neither can occur in a
// commit message, unlike any newline-based framing.
function commits(range) {
  let out;
  try {
    out = execFileSync("git", ["log", "--format=%H%x1e%s%x1e%B%x1f", ...(range ? [range] : [])], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    // No repository, a bad --range, an empty history: say which, plainly. A
    // stack trace in a CI log makes a solvable problem look like a broken tool.
    const reason = (err.stderr ?? "").toString().trim().split("\n")[0] || err.message;
    throw new Error(`git log failed: ${reason}`);
  }
  return out
    .split("\x1f")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, message] = record.split("\x1e");
      return { sha, subject, message: message ?? "" };
    });
}

function main(argv) {
  const { flags, problems } = parseFlags(argv, { known: ["--quiet"], valued: ["--range"] });
  if (problems.length) {
    note(problems.join("; "));
    note("usage: check-attribution.mjs [--range A..B] [--quiet]");
    return 2;
  }

  let re;
  try {
    re = attributionRe(botPattern(readFileSync(at(".githooks", "commit-msg"), "utf8")));
  } catch (err) {
    note(`cannot read the rule: ${err.message}`);
    return 2;
  }

  // A brand-new branch pushes with a null "before" SHA; a range built from it is
  // meaningless, so the caller passes nothing and every commit is checked.
  let all;
  try {
    all = commits(flags.get("--range"));
  } catch (err) {
    note(err.message);
    return 2;
  }
  const bad = all
    .map((c) => ({ ...c, lines: offendingLines(c.message, re) }))
    .filter((c) => c.lines.length);

  if (bad.length) {
    note(`${bad.length} of ${all.length} commit(s) carry AI-agent attribution:`);
    for (const { sha, subject, lines } of bad) {
      note(`  ${sha.slice(0, 8)} ${subject}`);
      for (const line of lines) note(`      ${line.trim()}`);
    }
    note("");
    note("These put a bot in this repository's GitHub contributor list.");
    note("Install the hook so it cannot happen again:  npm run hooks:install");
    note("Then rewrite the messages before anyone clones — while it is still cheap:");
    note("  git rebase -i --root   (or git filter-repo --message-callback …)");
    return 1;
  }

  if (!flags.has("--quiet")) note(`clean: no AI attribution in ${all.length} commit(s)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
