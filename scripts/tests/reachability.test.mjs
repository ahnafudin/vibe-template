// Every registry entry must be REACHABLE.
//
// A fixture is built from each entry's own `detect` block, so this deliberately
// does NOT check that the markers are the right ones for that framework — that
// needs ground truth from outside the registry (official docs, a real scaffold),
// and no self-referential test can supply it.
//
// What it does prove is not circular, and is the failure this registry is most
// prone to: an entry whose markers are present and STILL loses, because another
// entry outranks it on the same evidence. `avalonia` and `maui` both key off a
// `.csproj`; `slim` and `laravel` both off `composer.json`; every framework
// competes with its own language base. An entry that can never win is dead
// weight the README advertises as support the template does not actually have.
//
// The counterpart — are these the CORRECT markers — is tracked per entry by the
// `verified` flag and is settled by scaffolding the real thing.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { detect, detectResolved, loadRegistry } from "../stacks.mjs";

const stacks = loadRegistry();
const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A glob marker turned into one concrete filename the pattern would match. */
export function concreteName(pattern) {
  if (pattern.endsWith(".*")) return `${pattern.slice(0, -2)}.js`; // next.config.* → next.config.js
  if (pattern.startsWith("*.")) return `sample${pattern.slice(1)}`; // *.csproj → sample.csproj
  return pattern.replace(/\*/g, ""); // build.gradle* → build.gradle
}

/** Build the smallest repo in which `entry`'s detection should fire. */
function materialise(entry) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-reach-"));
  trash.push(dir);
  const files = new Map(); // path → contents, so two signals on one file merge
  const deps = {};

  const apply = (signal) => {
    if (signal.dir) {
      mkdirSync(join(dir, signal.dir), { recursive: true });
      return;
    }
    if (signal.dep) {
      deps[signal.dep] = "1.0.0";
      return;
    }
    const [path, needle] = signal.content ?? [signal.file, ""];
    const name = concreteName(path);
    files.set(name, `${files.get(name) ?? ""}${needle}\n`);
  };

  for (const s of entry.detect?.all ?? []) apply(s);
  const any = entry.detect?.any ?? [];
  if (any.length) apply(any[0]); // one is enough, by definition of `any`

  if (Object.keys(deps).length) {
    const existing = files.get("package.json");
    // A `dep` signal implies a package.json; don't clobber one a content signal
    // already wrote for this same entry.
    if (!existing) files.set("package.json", JSON.stringify({ name: "fixture", dependencies: deps }, null, 2));
  }
  for (const [rel, body] of files) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

describe("every registry entry is reachable", () => {
  for (const entry of stacks) {
    it(`${entry.id} wins in a repo carrying its own markers`, () => {
      const dir = materialise(entry);
      const ranked = detect(dir, stacks);
      assert.ok(
        ranked.some((m) => m.id === entry.id),
        `${entry.id} did not match a repo built from its own detect block — the markers cannot fire`,
      );
      const { primary } = detectResolved(dir, stacks);
      assert.equal(
        primary.id,
        entry.id,
        `${entry.id} is shadowed by ${primary.id} on identical evidence ` +
          `(ranking: ${ranked.map((m) => `${m.id}(${m.score})`).join(", ")})`,
      );
    });
  }

  it("covers the whole registry, so a new entry cannot skip this", () => {
    assert.equal(stacks.length, 70, "update this count deliberately when adding entries");
  });
});

describe("glob markers become plausible filenames", () => {
  it("expands the three shapes the registry uses", () => {
    assert.equal(concreteName("next.config.*"), "next.config.js");
    assert.equal(concreteName("*.csproj"), "sample.csproj");
    assert.equal(concreteName("build.gradle*"), "build.gradle");
    assert.equal(concreteName("artisan"), "artisan");
  });
});
