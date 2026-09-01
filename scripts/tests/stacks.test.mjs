// Tests for scripts/stacks.mjs — the framework registry. Two jobs here:
// keep the DATA honest (schema + invariants, so a bad entry fails `npm run gate`
// instead of mis-detecting someone's project months later), and pin the
// detection rules that are easy to get subtly wrong.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { detect, detectResolved, loadRegistry, mergeGates, mergeIgnore, renderDoc, resolve, validateRegistry } from "../stacks.mjs";

const stacks = loadRegistry();

/** Build a throwaway repo from `{ "relative/path": "contents" }`. */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-stack-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return dir;
}

const trash = [];
after(() => trash.forEach((d) => rmSync(d, { recursive: true, force: true })));
function repo(files) {
  const dir = fixture(files);
  trash.push(dir);
  return dir;
}

const pkg = (o) => JSON.stringify(o, null, 2);

describe("registry integrity", () => {
  it("validates against stacks.schema.json with no invariant violations", () => {
    assert.deepEqual(validateRegistry(), []);
  });

  it("covers the framework families the template advertises", () => {
    const ids = new Set(stacks.map((s) => s.id));
    const promised = [
      "electron", "tauri", "wails",
      "nextjs", "nuxt", "react-vite", "angular", "vue", "sveltekit", "astro", "remix",
      "express", "nestjs", "fastify", "hono",
      "expo", "react-native", "flutter", "android",
      "laravel", "symfony", "codeigniter4", "slim", "wordpress",
      "django", "fastapi", "flask",
      "gin", "echo", "fiber", "axum", "actix",
      "spring-boot", "aspnetcore", "rails", "phoenix",
    ];
    const missing = promised.filter((id) => !ids.has(id));
    assert.deepEqual(missing, [], "README/docs promise these; the registry must actually have them");
  });

  it("gives every entry a usable gate set once `extends` is resolved", () => {
    for (const s of stacks) {
      const r = resolve(stacks, s.id);
      const runnable = Object.values(r.gates).filter((v) => v !== null && v !== "" && v !== undefined);
      assert.ok(
        runnable.length > 0 || s.id === "unity" || s.id === "godot",
        `${s.id} resolves to zero runnable gates — an agent would have nothing to run`,
      );
    }
  });

  it("marks unverified entries so the generated doc can warn about them", () => {
    // The promise in the docs is honesty, not omniscience: entries we could not
    // verify must SAY so rather than look authoritative.
    const unverified = stacks.filter((s) => s.verified === false);
    assert.ok(unverified.length > 0, "if every entry claims to be verified, the flag is not being used");
    for (const s of unverified) assert.equal(typeof s.label, "string");
  });
});

describe("extends resolution", () => {
  it("inherits from the base and lets the framework override per gate", () => {
    const laravel = resolve(stacks, "laravel");
    assert.deepEqual(laravel.bases, ["php"]);
    assert.equal(laravel.gates.test, "php artisan test", "framework wins");
    assert.equal(laravel.gates.lint, "vendor/bin/pint --test");
    assert.ok(laravel.ignore.includes("/vendor/"), "base ignore lines are inherited");
    assert.ok(laravel.ignore.includes("/bootstrap/cache/"), "framework ignore lines are added");
  });

  it("supports multiple bases for a polyglot framework", () => {
    const tauri = resolve(stacks, "tauri");
    assert.deepEqual(tauri.bases, ["rust", "node"]);
    assert.ok(Array.isArray(tauri.gates.test), "Tauri must run BOTH the web and the Rust test suite");
    assert.equal(tauri.gates.test.length, 2);
  });

  it("resolves a two-level chain (android → gradle)", () => {
    const android = resolve(stacks, "android");
    assert.ok(android.bases.includes("gradle"));
    assert.equal(android.gates.build, "./gradlew assembleRelease");
  });

  it("rejects an unknown id", () => {
    assert.throws(() => resolve(stacks, "does-not-exist"), /unknown stack id/);
  });
});

describe("detection", () => {
  it("finds nothing in an empty directory", () => {
    assert.deepEqual(detect(repo({ "README.md": "hi" }), stacks), []);
  });

  it("prefers Next.js over the looser React entry in a Next repo", () => {
    const dir = repo({
      "package.json": pkg({ name: "app", dependencies: { next: "15.0.0", react: "19.0.0" } }),
      "next.config.js": "export default {};",
    });
    const { primary, secondary } = detectResolved(dir, stacks);
    assert.equal(primary.id, "nextjs");
    assert.ok(!secondary.some((s) => s.id === "react-vite"), "react-vite must not claim a Next project");
  });

  it("does not let react-vite match on the react dependency alone", () => {
    // `all` semantics: react-vite needs BOTH the dep and a vite config, else it
    // would claim every React-based framework in the registry.
    const withoutVite = repo({ "package.json": pkg({ dependencies: { react: "19.0.0" } }) });
    assert.ok(!detect(withoutVite, stacks).some((m) => m.id === "react-vite"));
    const withVite = repo({
      "package.json": pkg({ dependencies: { react: "19.0.0" } }),
      "vite.config.ts": "export default {};",
    });
    assert.equal(detectResolved(withVite, stacks).primary.id, "react-vite");
  });

  it("detects Laravel from artisan + composer content, not just PHP", () => {
    const dir = repo({
      artisan: "#!/usr/bin/env php",
      "composer.json": pkg({ require: { "laravel/framework": "^11.0" } }),
    });
    const { primary } = detectResolved(dir, stacks);
    assert.equal(primary.id, "laravel");
    assert.equal(primary.gates.test, "php artisan test");
  });

  it("separates CodeIgniter from Laravel", () => {
    const dir = repo({
      spark: "#!/usr/bin/env php",
      "composer.json": pkg({ require: { "codeigniter4/framework": "^4.5" } }),
    });
    assert.equal(detectResolved(dir, stacks).primary.id, "codeigniter4");
  });

  it("detects Tauri and reports Rust + Node as bases, not as rivals", () => {
    const dir = repo({
      "package.json": pkg({ name: "app", devDependencies: { "@tauri-apps/api": "2.0.0" } }),
      "src-tauri/tauri.conf.json": pkg({ version: "0.1.0" }),
      "src-tauri/Cargo.toml": '[package]\nname = "app"\nversion = "0.1.0"\n',
    });
    const { primary, secondary } = detectResolved(dir, stacks);
    assert.equal(primary.id, "tauri");
    assert.deepEqual(secondary.map((s) => s.id), []);
  });

  it("reports BOTH stacks of a polyglot monorepo", () => {
    const dir = repo({
      "package.json": pkg({ dependencies: { next: "15.0.0" } }),
      "next.config.mjs": "export default {};",
      "pyproject.toml": '[project]\nname = "api"\nversion = "0.1.0"\ndependencies = ["fastapi"]\n',
    });
    const { primary, secondary } = detectResolved(dir, stacks);
    assert.equal(primary.id, "nextjs");
    assert.ok(secondary.some((s) => s.id === "fastapi"), "the Python service must not disappear");
  });

  it("tells Expo apart from a bare React Native app", () => {
    const expo = repo({
      "package.json": pkg({ dependencies: { expo: "51.0.0", "react-native": "0.74.0" } }),
      "app.json": pkg({ expo: { name: "app", version: "1.0.0" } }),
    });
    assert.equal(detectResolved(expo, stacks).primary.id, "expo");

    const bare = repo({
      "package.json": pkg({ dependencies: { "react-native": "0.74.0" } }),
      "metro.config.js": "module.exports = {};",
    });
    assert.equal(detectResolved(bare, stacks).primary.id, "react-native");
  });

  it("detects Flutter from the flutter key rather than any Dart package", () => {
    const flutter = repo({ "pubspec.yaml": "name: app\nversion: 1.0.0+1\nflutter:\n  uses-material-design: true\n" });
    assert.equal(detectResolved(flutter, stacks).primary.id, "flutter");
    const plainDart = repo({ "pubspec.yaml": "name: cli\nversion: 1.0.0\n" });
    assert.equal(detectResolved(plainDart, stacks).primary.id, "dart");
  });

  it("detects a Go framework from go.mod contents", () => {
    const dir = repo({ "go.mod": "module example.com/api\n\nrequire github.com/gin-gonic/gin v1.10.0\n" });
    const { primary } = detectResolved(dir, stacks);
    assert.equal(primary.id, "gin");
    assert.equal(primary.gates.test, "go test ./...", "inherited from the go base");
  });

  it("detects Spring Boot from the POM", () => {
    const dir = repo({ "pom.xml": "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>" });
    assert.equal(detectResolved(dir, stacks).primary.id, "spring-boot");
  });

  it("falls back to the language when no framework matches", () => {
    const dir = repo({ "go.mod": "module example.com/plain\n" });
    assert.equal(detectResolved(dir, stacks).primary.id, "go");
  });
});

describe("gate + ignore merging", () => {
  it("concatenates commands across co-resident stacks and drops duplicates", () => {
    const next = resolve(stacks, "nextjs");
    const fastapi = resolve(stacks, "fastapi");
    const merged = mergeGates(next, [fastapi]);
    assert.ok([].concat(merged.test).includes("pytest -q"));
    assert.ok([].concat(merged.test).includes("npm run test --if-present"));
    const flat = [].concat(merged.lint, merged.typecheck, merged.test, merged.build).filter(Boolean);
    assert.equal(flat.length, new Set(flat).size, "no duplicate commands");
  });

  it("keeps a single command as a string and only arrays when there are several", () => {
    const merged = mergeGates(resolve(stacks, "nextjs"), []);
    assert.equal(typeof merged.build, "string");
    assert.equal(typeof mergeGates(resolve(stacks, "tauri"), []).test, "object");
  });

  it("unions ignore lines without duplicates", () => {
    const lines = mergeIgnore(resolve(stacks, "nextjs"), [resolve(stacks, "django")]);
    assert.ok(lines.includes(".next/"));
    assert.ok(lines.includes("__pycache__/"));
    assert.equal(lines.length, new Set(lines).size);
  });
});

describe("generated docs/STACK.md", () => {
  it("names the stack, its core layer and every gate", () => {
    const primary = resolve(stacks, "laravel");
    const doc = renderDoc({ primary, secondary: [] }, mergeGates(primary, []));
    assert.match(doc, /GENERATED/);
    assert.match(doc, /Laravel/);
    assert.match(doc, /app\/Services/);
    assert.match(doc, /php artisan test/);
    assert.match(doc, /npm run gate/);
  });

  it("warns loudly when a stack's commands are unverified", () => {
    const primary = resolve(stacks, "codeigniter4");
    const doc = renderDoc({ primary, secondary: [] }, mergeGates(primary, []));
    assert.match(doc, /Unverified commands/i);
    assert.doesNotMatch(
      renderDoc({ primary: resolve(stacks, "laravel"), secondary: [] }, {}),
      /Unverified commands/i,
      "a verified stack must not carry the warning",
    );
  });

  it("still renders a useful placeholder when nothing is detected", () => {
    const doc = renderDoc({ primary: null, secondary: [] }, {});
    assert.match(doc, /not detected yet/i);
    assert.match(doc, /stack:apply/);
  });
});
