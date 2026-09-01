// Tests for scripts/version.mjs — the riskiest code in the template: it
// rewrites manifests and the post-commit hook then amends the commit around it.
// Zero dependencies: `node --test`, which every Node ≥18 already has.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { __test, currentVersion, inferBump, manifests, nextVersion, parseSemver, writeAll } from "../version.mjs";

const P = __test.planners;
const V = "9.9.9";
const plan = (fn, raw, name = "fixture") => fn(name, raw, V);

describe("parseSemver / nextVersion", () => {
  it("parses a strict X.Y.Z", () => {
    assert.deepEqual(parseSemver("1.2.3"), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseSemver("  10.0.4 "), { major: 10, minor: 0, patch: 4 });
  });

  it("rejects anything that is not X.Y.Z", () => {
    for (const bad of ["1.2", "1.2.3.4", "v1.2.3", "1.2.3-rc1", "", "abc"]) {
      assert.throws(() => parseSemver(bad), /invalid semver/, `should reject ${JSON.stringify(bad)}`);
    }
  });

  it("bumps each level and resets the ones below it", () => {
    assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
    assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
    assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
    assert.throws(() => nextVersion("1.2.3", "sideways"), /unknown bump/);
  });
});

describe("inferBump", () => {
  const cases = [
    ["feat: add thing", "minor"],
    ["feat(scope): add thing", "minor"],
    ["fix: repair", "patch"],
    ["perf: faster", "patch"],
    ["refactor(core): tidy", "patch"],
    ["FEAT: uppercase still counts", "minor"],
    ["feat!: breaking", "major"],
    ["fix(api)!: breaking", "major"],
    ["feat: x\n\nBREAKING CHANGE: gone", "major"],
    ["docs: readme", null],
    ["chore: deps", null],
    ["test: more", null],
    ["ci: pipeline", null],
    ["just some words", null],
    ["", null],
    [null, null],
  ];
  for (const [msg, want] of cases) {
    it(`${JSON.stringify(msg)} → ${want}`, () => assert.equal(inferBump(msg), want));
  }

  it("ignores git's comment lines when finding the header", () => {
    assert.equal(inferBump("# Please enter the commit message\nfeat: real header"), "minor");
  });

  it("does NOT bump a non-conventional message that merely mentions breaking change", () => {
    // The footer token requires the colon AND a conventional header; a prose
    // mention must never silently ship a major release.
    assert.equal(inferBump("rewrote everything, this is a BREAKING CHANGE for users"), null);
    assert.equal(inferBump("BREAKING CHANGE: no conventional header"), null);
  });
});

describe("planner: JSON manifests", () => {
  const pkg = '{\n  "name": "x",\n  "version": "0.1.0",\n  "private": true\n}\n';

  it("rewrites the first top-level version and preserves formatting", () => {
    const next = plan(P.jsonVersion({ required: true }), pkg, "package.json");
    assert.equal(next, '{\n  "name": "x",\n  "version": "9.9.9",\n  "private": true\n}\n');
  });

  it("throws for a required manifest with no version key", () => {
    assert.throws(() => plan(P.jsonVersion({ required: true }), '{"name":"x"}', "package.json"), /no "version" key/);
  });

  it("skips an optional manifest with no version key (Packagist omits it)", () => {
    assert.equal(plan(P.jsonVersion(), '{"name":"vendor/pkg"}', "composer.json"), null);
  });

  it("is not fooled by camelCase keys that end in Version", () => {
    const raw = '{\n  "sdkVersion": "51.0.0",\n  "version": "0.1.0"\n}\n';
    assert.match(plan(P.jsonVersion(), raw), /"sdkVersion": "51\.0\.0"/);
    assert.match(plan(P.jsonVersion(), raw), /"version": "9\.9\.9"/);
  });

  it("only touches app.json when it is actually an Expo manifest", () => {
    const bare = '{\n  "name": "MyApp",\n  "displayName": "MyApp",\n  "version": "0.1.0"\n}\n';
    const expo = '{\n  "expo": {\n    "name": "MyApp",\n    "version": "0.1.0"\n  }\n}\n';
    const planner = P.jsonVersion({ guard: '"expo"' });
    assert.equal(plan(planner, bare, "app.json"), null);
    assert.match(plan(planner, expo, "app.json"), /"version": "9\.9\.9"/);
  });
});

describe("planner: Cargo", () => {
  const cargo = [
    "[package]",
    'name = "my-app"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'serde = { version = "1.0.200", features = ["derive"] }',
    'tokio = "1.38.0"',
    "",
  ].join("\n");

  it("rewrites the [package] version and leaves dependency versions alone", () => {
    const next = plan(P.planCargoToml, cargo, "Cargo.toml");
    assert.match(next, /\[package\][\s\S]*version = "9\.9\.9"/);
    assert.match(next, /serde = \{ version = "1\.0\.200"/, "dependency version must be untouched");
    assert.match(next, /tokio = "1\.38\.0"/);
  });

  it("skips a workspace-inherited version", () => {
    const inherited = '[package]\nname = "app"\nversion.workspace = true\n\n[dependencies]\n';
    assert.equal(plan(P.planCargoToml, inherited, "Cargo.toml"), null);
    const braced = '[package]\nname = "app"\nversion = { workspace = true }\n';
    assert.equal(plan(P.planCargoToml, braced, "Cargo.toml"), null);
  });

  it("throws when there is no [package] section at all", () => {
    assert.throws(() => plan(P.planCargoToml, '[workspace]\nmembers = ["a"]\n'), /no \[package\] section/);
  });
});

describe("planner: pyproject.toml", () => {
  it("rewrites a PEP 621 [project] version", () => {
    const raw = '[project]\nname = "app"\nversion = "0.1.0"\n\n[tool.ruff]\nline-length = 100\n';
    assert.match(plan(P.planPyproject, raw), /\[project\][\s\S]*version = "9\.9\.9"/);
    assert.match(plan(P.planPyproject, raw), /line-length = 100/);
  });

  it("rewrites a [tool.poetry] version", () => {
    const raw = '[tool.poetry]\nname = "app"\nversion = "0.1.0"\n';
    assert.match(plan(P.planPyproject, raw), /version = "9\.9\.9"/);
  });

  it("skips a dynamic version (a build backend owns it)", () => {
    const raw = '[project]\nname = "app"\ndynamic = ["version"]\n';
    assert.equal(plan(P.planPyproject, raw), null);
  });
});

describe("planner: pubspec.yaml (Flutter)", () => {
  it("rewrites the semver and PRESERVES the +build number", () => {
    const raw = "name: my_app\nversion: 1.2.3+45\n\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n";
    assert.match(plan(P.planPubspec, raw), /^version: 9\.9\.9\+45$/m);
  });

  it("works without a build number", () => {
    assert.match(plan(P.planPubspec, "name: app\nversion: 1.2.3\n"), /^version: 9\.9\.9$/m);
  });

  it("skips a pubspec with no version line", () => {
    assert.equal(plan(P.planPubspec, "name: app\ndescription: x\n"), null);
  });
});

describe("planner: Gradle", () => {
  it("rewrites gradle.properties version and keeps other keys", () => {
    const raw = "org.gradle.jvmargs=-Xmx2g\nversion=1.0.0\nkotlin.code.style=official\n";
    const next = plan(P.planGradleProperties, raw);
    assert.match(next, /^version=9\.9\.9$/m);
    assert.match(next, /kotlin\.code\.style=official/);
  });

  it("rewrites versionName in both Groovy and Kotlin DSL, never versionCode", () => {
    const groovy = 'android {\n  defaultConfig {\n    versionCode 12\n    versionName "1.0.0"\n  }\n}\n';
    const kts = 'android {\n  defaultConfig {\n    versionCode = 12\n    versionName = "1.0.0"\n  }\n}\n';
    for (const raw of [groovy, kts]) {
      const next = plan(P.planGradleBuild, raw);
      assert.match(next, /versionName\s*=?\s*"9\.9\.9"/);
      assert.match(next, /versionCode\s*=?\s*12/, "versionCode is a release counter, not the semver");
    }
  });
});

describe("planner: MSBuild", () => {
  it("rewrites <Version>", () => {
    const raw = "<Project Sdk=\"Microsoft.NET.Sdk.Web\">\n  <PropertyGroup>\n    <Version>1.0.0</Version>\n  </PropertyGroup>\n</Project>\n";
    assert.match(plan(P.planMsBuild, raw), /<Version>9\.9\.9<\/Version>/);
  });

  it("falls back to <VersionPrefix>", () => {
    const raw = "<Project>\n  <PropertyGroup>\n    <VersionPrefix>1.0.0</VersionPrefix>\n  </PropertyGroup>\n</Project>\n";
    assert.match(plan(P.planMsBuild, raw), /<VersionPrefix>9\.9\.9<\/VersionPrefix>/);
  });

  it("skips a project that declares no version", () => {
    assert.equal(plan(P.planMsBuild, "<Project>\n  <PropertyGroup />\n</Project>\n"), null);
  });
});

describe("planner: pom.xml", () => {
  it("rewrites the project version, NOT the parent's and NOT a dependency's", () => {
    const raw = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "  <modelVersion>4.0.0</modelVersion>",
      "  <parent>",
      "    <groupId>org.springframework.boot</groupId>",
      "    <artifactId>spring-boot-starter-parent</artifactId>",
      "    <version>3.3.0</version>",
      "  </parent>",
      "  <groupId>com.example</groupId>",
      "  <artifactId>demo</artifactId>",
      "  <version>1.0.0</version>",
      "  <dependencies>",
      "    <dependency>",
      "      <groupId>org.x</groupId>",
      "      <artifactId>y</artifactId>",
      "      <version>2.5.1</version>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n");
    const next = plan(P.planPom, raw, "pom.xml");
    assert.match(next, /<artifactId>demo<\/artifactId>\s*\n\s*<version>9\.9\.9<\/version>/);
    assert.match(next, /spring-boot-starter-parent<\/artifactId>\s*\n\s*<version>3\.3\.0<\/version>/, "parent untouched");
    assert.match(next, /<version>2\.5\.1<\/version>/, "dependency untouched");
    assert.equal(next.match(/9\.9\.9/g).length, 1, "exactly one version replaced");
  });

  it("skips a module that inherits its version from the parent", () => {
    const raw = [
      "<project>",
      "  <parent>",
      "    <groupId>com.example</groupId>",
      "    <artifactId>root</artifactId>",
      "    <version>1.0.0</version>",
      "  </parent>",
      "  <artifactId>child</artifactId>",
      "  <dependencies></dependencies>",
      "</project>",
      "",
    ].join("\n");
    assert.equal(plan(P.planPom, raw, "pom.xml"), null);
  });
});

describe("planner: mix.exs / Chart.yaml / Ruby / WordPress / VERSION", () => {
  it("rewrites the Elixir project version", () => {
    const raw = 'defmodule App.MixProject do\n  def project do\n    [app: :app, version: "0.1.0", elixir: "~> 1.15"]\n  end\nend\n';
    const next = plan(P.planMixExs, raw);
    assert.match(next, /version: "9\.9\.9"/);
    assert.match(next, /elixir: "~> 1\.15"/);
  });

  it("rewrites both version and appVersion in a Helm chart, preserving quotes", () => {
    const raw = "apiVersion: v2\nname: my-chart\nversion: 0.1.0\nappVersion: \"1.16.0\"\n";
    const next = plan(P.planChartYaml, raw);
    assert.match(next, /^version: 9\.9\.9$/m);
    assert.match(next, /^appVersion: "9\.9\.9"$/m);
    assert.match(next, /^apiVersion: v2$/m, "apiVersion is not a version to bump");
  });

  it("rewrites a Ruby VERSION constant", () => {
    const raw = 'module App\n  VERSION = "0.1.0"\nend\n';
    assert.match(plan(P.planRubyVersion, raw, "lib/app/version.rb"), /VERSION = "9\.9\.9"/);
  });

  it("rewrites a WordPress header only when the file declares one", () => {
    const plugin = "<?php\n/**\n * Plugin Name: My Plugin\n * Version: 1.0.0\n */\n";
    assert.match(plan(P.planWpHeader, plugin, "my-plugin.php"), /\* Version: 9\.9\.9/);
    const plain = "<?php\n// Version: 1.0.0\n";
    assert.equal(plan(P.planWpHeader, plain, "index.php"), null, "no Plugin/Theme Name header → not ours");
  });

  it("writes a bare VERSION file with a trailing newline", () => {
    assert.equal(plan(P.planVersionFile, "0.1.0\n", "VERSION"), "9.9.9\n");
  });
});

describe("glob expansion", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-glob-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("matches a wildcard in a MIDDLE segment (src/*/*.csproj)", () => {
    mkdirSync(join(dir, "src", "Api"), { recursive: true });
    mkdirSync(join(dir, "src", "Core"), { recursive: true });
    writeFileSync(join(dir, "src", "Api", "Api.csproj"), "<Project />");
    writeFileSync(join(dir, "src", "Core", "Core.csproj"), "<Project />");
    writeFileSync(join(dir, "src", "Core", "notes.md"), "x");
    const hits = __test.expandGlob(dir, ["src", "*", "*.csproj"]);
    assert.equal(hits.length, 2);
    assert.ok(hits.every((p) => p.endsWith(".csproj")));
  });

  it("returns nothing for a path that does not exist", () => {
    assert.deepEqual(__test.expandGlob(dir, ["nope", "*.txt"]), []);
  });
});

describe("Cargo.lock planner (reads its sibling Cargo.toml)", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-cargo-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("rewrites only the crate's own lock entry", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "my-app"\nversion = "0.1.0"\n');
    const lock = [
      "[[package]]",
      'name = "serde"',
      'version = "1.0.200"',
      "",
      "[[package]]",
      'name = "my-app"',
      'version = "0.1.0"',
      "",
    ].join("\n");
    const next = P.planCargoLock(join(dir, "Cargo.lock"), lock, V);
    assert.match(next, /name = "my-app"\nversion = "9\.9\.9"/);
    assert.match(next, /name = "serde"\nversion = "1\.0\.200"/, "other crates untouched");
  });
});

describe("writeAll is two-phase", () => {
  it("validates before touching disk — an invalid version writes nothing", () => {
    const pkgPath = new URL("../../package.json", import.meta.url);
    const before = readFileSync(pkgPath, "utf8");
    assert.throws(() => writeAll("not-a-version"), /invalid semver/);
    assert.equal(readFileSync(pkgPath, "utf8"), before, "package.json must be byte-identical after a failed bump");
  });
});

describe("manifests()", () => {
  it("lists package.json, which the post-commit hook then checks for local edits", () => {
    const list = manifests();
    assert.ok(list.includes("package.json"), `expected package.json in ${JSON.stringify(list)}`);
    assert.ok(list.every((p) => !p.includes("\\")), "paths must be repo-relative with forward slashes");
  });

  it("agrees with the version the hook would be bumping from", () => {
    assert.match(currentVersion(), /^\d+\.\d+\.\d+$/);
  });
});
