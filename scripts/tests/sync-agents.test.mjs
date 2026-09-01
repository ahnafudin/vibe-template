// Tests for scripts/sync-agents.mjs — the pointer files are the only thing
// standing between a non-AGENTS.md-aware agent and a repo with zero rules
// loaded, so their content is worth pinning.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderStub, sync, TARGETS } from "../sync-agents.mjs";
import { at, readIfExists } from "../lib/util.mjs";

describe("pointer stubs", () => {
  it("covers the tools that do NOT read AGENTS.md on their own", () => {
    const paths = TARGETS.map((t) => t.path);
    for (const expected of [
      ".github/copilot-instructions.md",
      "GEMINI.md",
      ".cursor/rules/00-agents.mdc",
      ".windsurf/rules/agents.md",
      ".clinerules/00-agents.md",
      ".junie/guidelines.md",
      "CONVENTIONS.md",
    ]) {
      assert.ok(paths.includes(expected), `missing front door: ${expected}`);
    }
  });

  it("restates the non-negotiables inline rather than only linking", () => {
    // An agent that ignores file references must still be bound by the rules
    // that matter; a bare "see AGENTS.md" would bind it to nothing.
    for (const target of TARGETS) {
      const stub = renderStub(target);
      assert.match(stub, /AGENTS\.md/, `${target.path} must point at the canonical file`);
      assert.match(stub, /npm run gate/, `${target.path} must carry the gate contract`);
      assert.match(stub, /Read before writing/i, `${target.path} must carry read-before-write`);
      assert.match(stub, /never rewrite pushed history/i, `${target.path} must carry the no-push rule`);
      assert.match(stub, /Verify before claiming/i, `${target.path} must carry verify-before-claiming`);
      assert.match(stub, /docs\/STACK\.md/, `${target.path} must route to the generated stack brief`);
      assert.match(stub, /GENERATED/, `${target.path} must warn that hand-edits are lost`);
    }
  });

  it("puts each tool's frontmatter at the very top, where it is parsed", () => {
    const cursor = renderStub(TARGETS.find((t) => t.path.endsWith(".mdc")));
    assert.ok(cursor.startsWith("---\n"), "Cursor .mdc frontmatter must be the first bytes");
    assert.match(cursor, /^---\n[\s\S]*?alwaysApply: true\n---\n/);

    const windsurf = renderStub(TARGETS.find((t) => t.path.startsWith(".windsurf")));
    assert.ok(windsurf.startsWith("---\n"));
    assert.match(windsurf, /trigger: always_on/);
  });

  it("omits frontmatter for tools that read plain markdown", () => {
    const gemini = renderStub(TARGETS.find((t) => t.path === "GEMINI.md"));
    assert.ok(!gemini.startsWith("---"), "a stray frontmatter block would render as text");
    assert.ok(gemini.startsWith("# Project rules"));
  });

  it("is idempotent — a second render is byte-identical", () => {
    for (const target of TARGETS) assert.equal(renderStub(target), renderStub(target));
  });

  it("is currently in sync with AGENTS.md on disk", () => {
    const { stale } = sync({ check: true });
    assert.deepEqual(stale, [], "run `npm run agents:sync`");
  });
});

describe("canonical file", () => {
  it("exists and carries the rules the stubs promise", () => {
    const agents = readIfExists(at("AGENTS.md"));
    assert.ok(agents, "AGENTS.md is the source of truth — it must exist");
    for (const marker of [
      "Session working rules",
      "npm run gate",
      "docs/STACK.md",
      "Read before writing",
      "Beads Issue Tracker",
      "Commit and push only when the owner asks",
    ]) {
      assert.ok(agents.includes(marker), `AGENTS.md is missing: ${marker}`);
    }
  });

  it("keeps CLAUDE.md a thin pointer, not a second copy of the rules", () => {
    const claude = readIfExists(at("CLAUDE.md"));
    assert.ok(claude, "CLAUDE.md must exist — Claude Code loads it by name");
    assert.match(claude, /@AGENTS\.md/, "it must import the canonical file");
    assert.ok(claude.length < 4000, `CLAUDE.md has grown to ${claude.length} bytes — rules belong in AGENTS.md`);
  });
});
