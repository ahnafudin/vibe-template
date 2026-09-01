// Tests for the documented commands themselves.
//
// These exist because of a real trap: `npm run gate --list` does NOT list —
// npm swallows a leading flag instead of forwarding it, so the agent that types
// it gets a full gate run and no listing. Non-flag args (`npm run gate test`)
// do pass through. Every command printed in a doc or a generated stub must be
// one that actually works when copy-pasted, so that trap is pinned here.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { at, readIfExists, readJson } from "../lib/util.mjs";
import { renderStub, TARGETS } from "../sync-agents.mjs";

const pkg = readJson(at("package.json"));

/** Every markdown file a human or an agent might copy a command out of. */
function docFiles() {
  const roots = [".", "docs"];
  const out = [];
  for (const dir of roots) {
    for (const name of readdirSync(at(dir))) {
      if (name.endsWith(".md") || name.endsWith(".mdc")) out.push(join(dir, name));
    }
  }
  return out;
}

describe("npm script surface", () => {
  it("exposes a flagless alternative for every flag-taking command", () => {
    // The fix for npm's flag swallowing is a dedicated script, not asking
    // everyone to remember `npm run gate -- --list`.
    for (const script of [
      "gate",
      "gate:list",
      "stack:apply",
      "stack:reapply",
      "agents:sync",
      "agents:check",
      "test:template",
    ]) {
      assert.ok(pkg.scripts[script], `package.json is missing the "${script}" script`);
    }
    assert.match(pkg.scripts["gate:list"], /--list/);
    assert.match(pkg.scripts["stack:reapply"], /--force/);
  });

  // Flags that BELONG to npm: it is supposed to consume these, so
  // `npm run test --if-present` is correct usage, not the trap.
  const NPM_OWN_FLAGS = ["--if-present", "--silent", "--workspace", "--workspaces", "--prefix", "--loglevel"];

  /**
   * Lines where a flag meant for OUR script is placed where npm will eat it.
   * A line containing an emphatic uppercase `NOT` is prose WARNING about the
   * trap (in AGENTS.md and gate.mjs) rather than instructing anyone to use it —
   * documenting the pitfall must stay allowed, or the guard bans its own fix.
   */
  function swallowedFlagLines(body) {
    return body.split("\n").filter((line) => {
      if (/\bNOT\b/.test(line)) return false;
      return [...line.matchAll(/npm run [a-z][a-z0-9:]* (--[a-z-]+)/g)].some(
        (m) => !NPM_OWN_FLAGS.includes(m[1]),
      );
    });
  }

  it("never documents an `npm run <script> --ourflag` form", () => {
    for (const file of [...docFiles(), ...TARGETS.map((t) => t.path)]) {
      const body = readIfExists(at(file));
      if (!body) continue;
      assert.deepEqual(
        swallowedFlagLines(body),
        [],
        `${file} prints an \`npm run <script> --flag\` form npm will swallow. Use the dedicated ` +
          `script (gate:list / stack:reapply), or — if you are deliberately WARNING about the trap — ` +
          `write NOT in capitals on that line, which this guard treats as prose.`,
      );
    }
  });

  it("keeps the generated stubs free of that form too", () => {
    for (const target of TARGETS) {
      assert.deepEqual(swallowedFlagLines(renderStub(target)), [], target.path);
    }
  });
});

describe("documented commands exist", () => {
  it("every `npm run X` mentioned in a doc is a real script", () => {
    const known = new Set(Object.keys(pkg.scripts));
    const problems = [];
    for (const file of [...docFiles(), ...TARGETS.map((t) => t.path)]) {
      const body = readIfExists(at(file));
      if (!body) continue;
      // `npm run lint --if-present` is CORRECT when `lint` does not exist —
      // tolerating absence is the entire point of the flag, and the generated
      // docs/STACK.md prints exactly that for a project with no lint step.
      for (const m of body.matchAll(/npm run ([a-z][a-z0-9:]*)(\s+--if-present)?/g)) {
        if (m[2]) continue;
        if (!known.has(m[1])) problems.push(`${file}: npm run ${m[1]}`);
      }
    }
    assert.deepEqual(problems, [], "docs reference npm scripts that do not exist");
  });

  it("every gate command in the registry defaults is a non-empty string", () => {
    for (const [key, value] of Object.entries(pkg.vibe.gates)) {
      for (const cmd of [].concat(value ?? [])) {
        assert.equal(typeof cmd, "string", `vibe.gates.${key} must hold strings`);
        assert.ok(cmd.trim().length > 0, `vibe.gates.${key} has an empty command`);
      }
    }
  });
});
