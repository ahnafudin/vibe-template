// Tests for scripts/lib/util.mjs — small helpers, but two of them are
// load-bearing: the managed-block editor (regenerating must never eat a user's
// hand-written lines) and the dubious-ownership detector (whose whole purpose is
// to stop a misleading "not a git repository → run git init" suggestion).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dubiousOwnership, norm, safeDirectoryHint, upsertManagedBlock } from "../lib/util.mjs";
import { validate } from "../lib/jsonschema.mjs";

describe("upsertManagedBlock", () => {
  it("appends a block to a file that has none", () => {
    const out = upsertManagedBlock("keep me\n", "stack-ignores", "dist/\n.next/");
    assert.match(out, /^keep me\n/);
    assert.match(out, /# >>> vibe:stack-ignores\ndist\/\n\.next\/\n# <<< vibe:stack-ignores\n$/);
  });

  it("replaces only the block body and preserves text on both sides", () => {
    const first = upsertManagedBlock("above\n", "stack-ignores", "old/");
    const withTail = first + "below\n";
    const second = upsertManagedBlock(withTail, "stack-ignores", "new/");
    assert.match(second, /above/);
    assert.match(second, /below/);
    assert.match(second, /new\//);
    assert.doesNotMatch(second, /old\//);
    assert.equal(second.match(/>>> vibe:stack-ignores/g).length, 1, "must not duplicate the block");
  });

  it("is idempotent", () => {
    const once = upsertManagedBlock("x\n", "b", "line");
    assert.equal(upsertManagedBlock(once, "b", "line"), once);
  });

  it("keeps blocks with different names independent", () => {
    let out = upsertManagedBlock("", "a", "1");
    out = upsertManagedBlock(out, "b", "2");
    out = upsertManagedBlock(out, "a", "3");
    assert.match(out, /# >>> vibe:a\n3\n# <<< vibe:a/);
    assert.match(out, /# >>> vibe:b\n2\n# <<< vibe:b/);
  });

  it("honours a different comment marker", () => {
    assert.match(upsertManagedBlock("", "x", "y", "//"), /\/\/ >>> vibe:x/);
  });
});

describe("dubiousOwnership", () => {
  it("recognises git's refusal so callers do not blame a missing repo", () => {
    const real = [
      "fatal: detected dubious ownership in repository at 'D:/code/project'",
      "'D:/code/project/.git' is owned by:",
      "\t(inconvertible) (S-1-5-21-1)",
      "but the current user is:",
      "\tHOST/user (S-1-5-21-2)",
    ].join("\n");
    assert.equal(dubiousOwnership(real), true);
  });

  it("does not fire on an ordinary not-a-repo error", () => {
    assert.equal(dubiousOwnership("fatal: not a git repository (or any of the parent directories): .git"), false);
    assert.equal(dubiousOwnership(""), false);
    assert.equal(dubiousOwnership(undefined), false);
  });

  it("hands back a runnable remedy", () => {
    const hint = safeDirectoryHint("/tmp/some project");
    assert.match(hint, /^git config --global --add safe\.directory "/);
    assert.doesNotMatch(hint, /\\/, "the path must use forward slashes — git rejects backslashes here");
  });
});

describe("norm", () => {
  it("normalises separators so path comparisons survive Windows", () => {
    assert.ok(!norm("a/b").includes("\\"));
  });
});

describe("jsonschema (the subset used to police stacks.json)", () => {
  const schema = {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", pattern: "^[a-z-]+$" },
      tier: { enum: ["language", "framework"] },
      gates: { type: "object", additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] } },
      list: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    additionalProperties: false,
  };

  it("accepts a valid object", () => {
    assert.deepEqual(validate({ id: "laravel", tier: "framework", gates: { test: "x", lint: null } }, schema), []);
  });

  it("reports missing required keys, bad enums, patterns and unknown keys", () => {
    const errors = validate({ tier: "nope", oops: 1 }, schema);
    assert.ok(errors.some((e) => /missing required key "id"/.test(e)));
    assert.ok(errors.some((e) => /must be one of/.test(e)));
    assert.ok(errors.some((e) => /unknown key "oops"/.test(e)));
  });

  it("checks nested items and reports the path", () => {
    const errors = validate({ id: "x", list: [1] }, schema);
    assert.ok(errors.some((e) => e.startsWith("list[0]")), errors.join("; "));
  });

  it("resolves local $ref", () => {
    const root = { definitions: { name: { type: "string" } }, properties: { a: { $ref: "#/definitions/name" } } };
    assert.deepEqual(validate({ a: "ok" }, root, root), []);
    assert.equal(validate({ a: 5 }, root, root).length, 1);
  });
});
