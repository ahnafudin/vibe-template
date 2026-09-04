// Tests for scripts/lib/util.mjs — small helpers, but two of them are
// load-bearing: the managed-block editor (regenerating must never eat a user's
// hand-written lines) and the dubious-ownership detector (whose whole purpose is
// to stop a misleading "not a git repository → run git init" suggestion).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  dubiousOwnership,
  hasShellMetachars,
  isUnrenamedTemplate,
  NEEDS_SHELL,
  PLACEHOLDER_NAME,
  norm,
  parseFlags,
  runTool,
  safeDirectoryHint,
  tryRun,
  upsertManagedBlock,
} from "../lib/util.mjs";
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

describe("tryRun", () => {
  const node = process.execPath;

  it("surfaces stderr even on SUCCESS", () => {
    // The whole point: our scripts report progress on stderr, and a runner that
    // only returned stdout reduced every step of `npm run setup` to "done".
    const r = tryRun(node, ["-e", "process.stderr.write('progress here')"]);
    assert.equal(r.ok, true);
    assert.equal(r.err, "progress here");
  });

  it("keeps stdout clean, so a caller can read a value out of it", () => {
    const r = tryRun(node, ["-e", "process.stderr.write('noise'); process.stdout.write('https://example.com/x.git')"]);
    assert.equal(r.out, "https://example.com/x.git", "stderr must not leak into a value");
  });

  it("reports a non-zero exit with both streams in `out`", () => {
    const r = tryRun(node, ["-e", "process.stderr.write('boom'); process.exit(3)"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /boom/);
  });

  it("does not throw when the command does not exist", () => {
    const r = tryRun("definitely-not-a-real-binary-xyz", []);
    assert.equal(r.ok, false);
    assert.ok(r.out.length > 0);
  });
});

describe("hasShellMetachars / runTool", () => {
  it("flags what a shell would reinterpret and allows a normal URL", () => {
    for (const bad of ['a"b', "a`b", "a$b", "a&b", "a|b", "a;b", "a>b", "a\nb", "a(b)"]) {
      assert.equal(hasShellMetachars(bad), true, `should flag ${JSON.stringify(bad)}`);
    }
    assert.equal(hasShellMetachars("https://github.com/owner/repo.git"), false);
    assert.equal(hasShellMetachars("git@github.com:owner/repo.git"), false);
  });

  it("refuses a dangerous argument rather than quoting and hoping (Windows only)", (t) => {
    if (!NEEDS_SHELL) return t.skip("no shell is involved on this platform");
    const r = runTool("bd", ["dolt", "remote", "add", "origin", "https://x/y$(whoami)"]);
    assert.equal(r.ok, false);
    assert.match(r.out, /refusing to pass this through a Windows shell/);
  });

  it("still runs an ordinary command with plain arguments", () => {
    // Deliberately simple args: the guard is strict by design, and a `-e` script
    // full of quotes and parens is exactly what it is supposed to refuse. Every
    // real caller (`bd version`, `bd dolt remote list`, …) passes plain tokens.
    const r = runTool(process.execPath, ["--version"]);
    assert.equal(r.ok, true, r.out);
    assert.match(r.out, /^v\d+\./);
  });
});

describe("isUnrenamedTemplate", () => {
  const dirs = [];
  after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const withName = (name) => {
    const dir = mkdtempSync(join(tmpdir(), "vibe-name-"));
    dirs.push(dir);
    if (name !== null) writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.1.0" }));
    return dir;
  };

  it("is true while package.json still carries the placeholder", () => {
    assert.equal(isUnrenamedTemplate(withName(PLACEHOLDER_NAME)), true);
  });

  it("is false once the project has a real name", () => {
    assert.equal(isUnrenamedTemplate(withName("acme-invoices")), false);
  });

  it("is false when there is no package.json to read", () => {
    // Never block a non-JS project that has not created the tooling manifest yet.
    assert.equal(isUnrenamedTemplate(withName(null)), false);
  });

  it("guards THIS repo — the template must never ship a beads identity", (t) => {
    // Only meaningful in the template. A project made FROM it has a real name,
    // and this suite travels with the project — asserting unconditionally made
    // every derived project's very first `npm run gate` red.
    if (!isUnrenamedTemplate()) return t.skip("not the template — this project has been renamed");
    assert.equal(isUnrenamedTemplate(), true, "package.json here must keep the placeholder name");
  });
});

describe("parseFlags", () => {
  // Every CLI here used to test flags with `argv.includes("--check")`, which
  // ignores a typo and falls through to the DEFAULT branch. When the flag exists
  // to make a command do less, that is a hazard rather than an annoyance:
  // `sync-agents.mjs --chek` turned "verify, write nothing" into a full rewrite
  // that exited 0, so the lint gate calling it could never have failed.
  it("separates positional arguments from flags", () => {
    const r = parseFlags(["dir", "id", "--run"], { known: ["--run"] });
    assert.deepEqual(r.positional, ["dir", "id"]);
    assert.equal(r.flags.get("--run"), true);
    assert.deepEqual(r.problems, []);
  });

  it("refuses a flag it was not told about", () => {
    const r = parseFlags(["--chek"], { known: ["--check"] });
    assert.deepEqual(r.problems, ["unknown flag: --chek"]);
    assert.equal(r.flags.has("--check"), false, "a typo must never satisfy the real flag");
  });

  it("takes a value as --f=v or --f v", () => {
    for (const argv of [["--only=lint,test"], ["--only", "lint,test"]]) {
      assert.equal(parseFlags(argv, { valued: ["--only"] }).flags.get("--only"), "lint,test");
    }
  });

  it("does not swallow a following flag as a value", () => {
    // `--only --run` is a missing value, not a gate called "--run".
    const r = parseFlags(["--only", "--run"], { known: ["--run"], valued: ["--only"] });
    assert.deepEqual(r.problems, ["--only needs a value"]);
  });

  it("reports a value flag left empty", () => {
    assert.deepEqual(parseFlags(["--only="], { valued: ["--only"] }).problems, ["--only needs a value"]);
    assert.deepEqual(parseFlags(["--only"], { valued: ["--only"] }).problems, ["--only needs a value"]);
  });

  it("collects every problem, so one run reports them all", () => {
    const r = parseFlags(["--a", "--b"], { known: [] });
    assert.deepEqual(r.problems, ["unknown flag: --a", "unknown flag: --b"]);
  });
});
