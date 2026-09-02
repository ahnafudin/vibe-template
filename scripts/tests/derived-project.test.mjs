// The structural guard.
//
// Six bugs in this template have had one shape: scaffolding that belongs to the
// TEMPLATE surviving into a project made from it. The beads identity. The
// quality gates. The npm `test` script. The version. The README. Each was found
// only by generating a real app (Electron, then Tauri) and running it — never by
// the unit tests, because every one of them is invisible from inside this repo.
//
// So the simulation is automated here. This builds a copy of exactly what "Use
// this template" hands over (the git-tracked files, nothing else), renames it,
// runs the bootstrap steps a new project would run, and then runs THIS ENTIRE
// TEST SUITE inside that copy. Any future leak of the same family fails here
// instead of in somebody's new repo.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { at, ROOT, tryRun } from "../lib/util.mjs";
import { TEMPLATE_README_MARKER } from "../personalize.mjs";

// Set when we recurse into the copy, so the copy's own run of this file skips
// (it would otherwise clone itself forever).
const INSIDE = process.env.VIBE_DERIVED_TEST === "1";
const PROJECT_NAME = "derived-smoke-test";

let dir = null;
let setupFailure = null;

function node(args, cwd, env = {}) {
  // `NODE_TEST_CONTEXT` is inherited by children, and the runner reads it to
  // refuse a nested run ("run() is being called recursively"). Dropping it is
  // what lets the copy execute its own suite as an ordinary child process.
  const clean = { ...process.env, ...env };
  delete clean.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: clean });
}

before(() => {
  if (INSIDE) return;
  // Exactly what a template copy contains: the tracked files. Not node_modules,
  // not .beads, not anything else lying around this working tree.
  const listed = tryRun("git", ["ls-files"]);
  if (!listed.ok) {
    setupFailure = `cannot list tracked files (${listed.out})`;
    return;
  }
  dir = mkdtempSync(join(tmpdir(), "vibe-derived-"));
  for (const rel of listed.out.split(/\r?\n/).filter(Boolean)) {
    const src = at(rel);
    if (!existsSync(src)) continue;
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
  }

  // The one thing a new owner always does.
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = PROJECT_NAME;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // The bootstrap steps `npm run setup` performs that do not need git or bd.
  for (const script of ["personalize.mjs", "stacks.mjs"]) {
    const args = script === "stacks.mjs" ? [join(dir, "scripts", script), "apply"] : [join(dir, "scripts", script)];
    const r = node(args, dir);
    if (r.status !== 0) setupFailure = `${script} exited ${r.status}: ${r.stderr}`;
  }
});

after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("a project made from this template", { skip: INSIDE && "running inside the simulation" }, () => {
  const pkg = () => JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const read = (rel) => readFileSync(join(dir, rel), "utf8");

  it("bootstraps without error", () => {
    assert.equal(setupFailure, null);
    assert.ok(dir, "the copy should exist");
  });

  it("starts its version history at 0.1.0, not at the template's release", () => {
    // Found the hard way: generated apps began life at 0.2.2 and 0.2.3.
    assert.equal(pkg().version, "0.1.0");
  });

  it("gets a README about ITSELF, with the template's kept as tooling docs", () => {
    const readme = read("README.md");
    assert.doesNotMatch(readme, /vibe-template/, "the project README must not describe the template");
    assert.ok(!readme.includes(TEMPLATE_README_MARKER));
    assert.match(readme, new RegExp(`^# ${PROJECT_NAME}`, "m"));
    assert.match(read("docs/TEMPLATE.md"), /vibe-template/, "the template's own README is still available");
  });

  it("runs ITS gates, not the template's maintenance checks", () => {
    const { vibe } = pkg();
    assert.ok(!("ownedByTemplate" in vibe), "the one-shot marker must be consumed");
    const flat = JSON.stringify(vibe.gates);
    assert.doesNotMatch(flat, /sync-agents/, "that is a template-maintenance command");
    assert.doesNotMatch(flat, /stacks\.mjs validate/, "so is that");
  });

  it("leaves the conventional `test` script free for the project", () => {
    // The template's own suite lives at `test:template`; if it held `test`,
    // `npm run test --if-present` would run 120 template tests as the project's.
    const { scripts } = pkg();
    assert.equal(scripts.test, undefined);
    assert.ok(scripts["test:template"], "the tooling suite is still reachable, just renamed");
  });

  it("carries no beads identity", () => {
    assert.equal(existsSync(join(dir, ".beads")), false);
  });

  it("keeps every agent front door", () => {
    for (const f of [
      "AGENTS.md",
      "CLAUDE.md",
      "GEMINI.md",
      "CONVENTIONS.md",
      ".cursor/rules/00-agents.mdc",
      ".windsurf/rules/agents.md",
      ".clinerules/00-agents.md",
      ".junie/guidelines.md",
      ".github/copilot-instructions.md",
    ]) {
      assert.ok(existsSync(join(dir, f)), `missing ${f}`);
    }
  });

  it("passes the whole tooling suite — the check that would have caught all six", () => {
    // Two of these tests once failed by construction in any repo that is not
    // the template, so every generated project opened with a red gate.
    // TAP, not the default reporter: `# pass N` / `# fail N` are stable to
    // assert on, where the spec reporter's output is decorated and colourised.
    // Explicit runner, not a glob: this spawn has no shell, and Node only
    // learned to expand globs itself in v21 — the glob form passed locally and
    // broke CI on Node 20.
    const r = node(
      [join(dir, "scripts", "tests", "run.mjs"), "--test-reporter=tap"],
      dir,
      { VIBE_DERIVED_TEST: "1" },
    );
    const out = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, `the tooling suite must be green in a derived project:\n${out.slice(-2500)}`);
    assert.match(out, /# fail 0/, "no test may fail merely because the repo is not the template");
    assert.match(out, /# pass ([1-9]\d*)/, "the suite must actually have run");
  });
});
