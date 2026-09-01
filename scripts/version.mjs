// scripts/version.mjs — the SINGLE source of truth for the app semver
// (MAJOR.MINOR.PATCH). `package.json` holds the canonical value; this script
// propagates it to every OPTIONAL manifest that happens to exist in the repo, so
// one script serves a plain web app, Tauri, Laravel, Flutter, Spring Boot, a
// Helm chart or a WordPress plugin without configuration.
//
//   node scripts/version.mjs get                 print the current version
//   node scripts/version.mjs sync                rewrite every manifest to match package.json
//   node scripts/version.mjs patch|minor|major   bump + write all manifests
//   node scripts/version.mjs set 1.2.3           set an explicit version
//   node scripts/version.mjs infer "<msg>"       print the bump a commit msg implies
//   node scripts/version.mjs manifests           list the files a bump would touch
//   node scripts/version.mjs from-commit <msg|file>   infer + bump in one step
//
// `manifests` exists so `.githooks/post-commit` never has to repeat the list —
// one registry, consulted by both. Adding a stack is one TARGETS entry.
//
// Writes are targeted regex replacements (never a JSON/TOML reparse+reformat),
// so a bump touches only the version string and produces a one-line diff.
// `writeAll` is two-phase: every target is read and validated BEFORE any byte is
// written, so a validation failure can never leave the manifests half-synced.
//
// Deliberately independent of scripts/stacks.json: detection here is by file
// existence and content, so versioning keeps working even if a registry entry is
// wrong. Some version fields are NOT touched, on purpose — see docs/VERSIONING.md:
// Xcode MARKETING_VERSION, Android versionCode, Flutter build number, Expo
// runtimeVersion. Those are release-cadence counters, not semver.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "package.json");
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
// Never walk into dependency/build trees while hunting for a version file.
const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "target", "build", "dist", ".venv"]);

// --- pure semver helpers (exported for unit tests) ---

/** Parse a strict `X.Y.Z` string into numeric parts; throws on anything else. */
export function parseSemver(version) {
  const m = SEMVER_RE.exec(String(version).trim());
  if (!m) throw new Error(`invalid semver: "${version}"`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

/** The next version for a `"major" | "minor" | "patch"` bump. */
export function nextVersion(current, bump) {
  const { major, minor, patch } = parseSemver(current);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump: "${bump}" (want major|minor|patch)`);
  }
}

/**
 * Map a conventional-commit message to the semver bump it implies:
 *   feat                       → minor
 *   fix | perf | refactor      → patch
 *   `type!:` or a `BREAKING CHANGE:` footer (conventional header required) → major
 *   docs | test | chore | ci | style | build | (non-conventional) → null
 * Returns `null` when the commit should NOT bump. A non-conventional message
 * NEVER bumps — even if its body mentions "BREAKING CHANGE" (the footer token
 * requires the colon, per the conventional-commits spec).
 */
export function inferBump(message) {
  if (!message) return null;
  // Drop git's editor template/comment lines before reading the header + footer.
  const body = String(message)
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  const header = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!header) return null;
  const m = /^([a-zA-Z]+)(\([^)]*\))?(!)?:/.exec(header);
  if (!m) return null;
  if (m[3] || /(^|\n)BREAKING[ -]CHANGE:/.test(body)) return "major"; // `type!:` / footer
  const type = m[1].toLowerCase();
  if (type === "feat") return "minor";
  if (type === "fix" || type === "perf" || type === "refactor") return "patch";
  return null;
}

// --- path helpers ---

function rel(path) {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1).split("\\").join("/") : path;
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Expand one repo-relative pattern; `*` is allowed in ANY segment (a .NET repo
 *  keeps its projects at `src/<Name>/<Name>.csproj`), but never crosses a `/`. */
function expandGlob(base, segments) {
  if (segments.length === 0) return [base];
  const [head, ...rest] = segments;
  if (!head.includes("*")) {
    const next = join(base, head);
    return existsSync(next) ? expandGlob(next, rest) : [];
  }
  const re = new RegExp(`^${head.split("*").map(escapeRe).join("[^/]*")}$`, "i");
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return []; // unreadable directory — nothing to sync there
  }
  const out = [];
  for (const e of entries) {
    if (!re.test(e.name)) continue;
    const next = join(base, e.name);
    if (rest.length === 0) out.push(next);
    else if (e.isDirectory()) out.push(...expandGlob(next, rest));
  }
  return out;
}

/** Existing files matching any of the given repo-relative glob patterns. */
function find(...patterns) {
  const out = [];
  for (const pattern of patterns) {
    for (const p of expandGlob(ROOT, pattern.split("/"))) if (isFile(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Files with an exact `name`, searched breadth-first under `dir` up to `depth`. */
function findDeep(dir, name, depth = 4) {
  const start = join(ROOT, dir);
  if (!existsSync(start)) return [];
  const out = [];
  const queue = [[start, 0]];
  while (queue.length) {
    const [cur, level] = queue.shift();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) {
        if (level < depth && !SKIP_DIRS.has(e.name)) queue.push([p, level + 1]);
      } else if (e.name === name) {
        out.push(p);
      }
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function note(msg) {
  process.stderr.write(`[version] ${msg}\n`);
}

// --- planners ---
// Each returns the file's NEXT content, or null to skip it. Nothing writes here;
// `writeAll` collects every plan first so a throw leaves the tree untouched.

const JSON_VERSION_RE = /"version"\s*:\s*"[^"]*"/;

/** The first top-level `"version": "x"` in a JSON file. `required` throws when
 *  absent (package.json), otherwise a missing key just means "not versioned
 *  here" — Packagist omits it in composer.json, Tauri v2 may inherit it. */
function jsonVersion({ required = false, guard = null } = {}) {
  return (path, raw, version) => {
    if (guard && !raw.includes(guard)) return null;
    if (!JSON_VERSION_RE.test(raw)) {
      if (required) throw new Error(`no "version" key found in ${rel(path)}`);
      return null;
    }
    return raw.replace(JSON_VERSION_RE, `"version": "${version}"`);
  };
}

/** The `[section]` block of a TOML file: `{ text, start }`, or null. Scoping is
 *  what stops a dependency's `version = "…"` being mistaken for the package's. */
function tomlSection(raw, header) {
  const re = new RegExp(`^\\[${escapeRe(header)}\\][^\\r\\n]*\\r?\\n(?:(?!\\s*\\[)[^\\r\\n]*\\r?\\n?)*`, "m");
  const m = re.exec(raw);
  return m ? { text: m[0], start: m.index } : null;
}

function splice(raw, section, patched) {
  return raw.slice(0, section.start) + patched + raw.slice(section.start + section.text.length);
}

/** Cargo `[package] version`. Skipped when the version is workspace-inherited —
 *  the workspace root owns it in that layout. */
function planCargoToml(path, raw, version) {
  const sec = tomlSection(raw, "package");
  if (!sec) throw new Error(`no [package] section in ${rel(path)}`);
  if (/^version\s*\.\s*workspace\s*=|^version\s*=\s*\{\s*workspace/m.test(sec.text)) {
    note(`${rel(path)} version is workspace-inherited — skipping`);
    return null;
  }
  if (!/^version = "[^"]*"/m.test(sec.text)) throw new Error(`no [package] version in ${rel(path)}`);
  return splice(raw, sec, sec.text.replace(/^version = "[^"]*"/m, `version = "${version}"`));
}

/** The crate's own entry in the sibling Cargo.lock (best-effort — cargo
 *  reconciles the lock on the next build anyway). */
function planCargoLock(path, raw, version) {
  const toml = join(dirname(path), "Cargo.toml");
  if (!isFile(toml)) return null;
  const sec = tomlSection(readFileSync(toml, "utf8"), "package");
  const nameMatch = sec && /^name = "([^"]+)"/m.exec(sec.text);
  if (!nameMatch) return null;
  // `\r?\n` so the multi-line match works on both LF and CRLF (Windows) locks.
  const re = new RegExp(`(\\[\\[package\\]\\]\\r?\\nname = "${escapeRe(nameMatch[1])}"\\r?\\nversion = ")[^"]*(")`);
  return re.test(raw) ? raw.replace(re, `$1${version}$2`) : null;
}

/** pyproject.toml: `[project]` (PEP 621) or `[tool.poetry]`. Skipped when the
 *  version is declared dynamic — a build backend owns it then. */
function planPyproject(path, raw, version) {
  const sec = tomlSection(raw, "project") ?? tomlSection(raw, "tool.poetry");
  if (!sec) return null;
  if (/^dynamic\s*=\s*\[[^\]]*["']version["']/m.test(sec.text)) {
    note("pyproject.toml version is dynamic — skipping");
    return null;
  }
  const m = /^version\s*=\s*(["'])[^"']*\1/m.exec(sec.text);
  if (!m) return null;
  return splice(raw, sec, sec.text.replace(m[0], `version = ${m[1]}${version}${m[1]}`));
}

/** pubspec.yaml (Dart/Flutter). The `+N` build number is PRESERVED, never
 *  auto-incremented: stores require it to rise monotonically per upload, which
 *  is a release decision a commit hook must not make silently. */
function planPubspec(path, raw, version) {
  const re = /^version:[ \t]*([^\s+]+)(\+\S+)?[ \t]*$/m;
  const m = re.exec(raw);
  if (!m) return null;
  return raw.replace(re, `version: ${version}${m[2] ?? ""}`);
}

/** gradle.properties `version=…` (the value only; the separator is preserved). */
function planGradleProperties(path, raw, version) {
  const re = /^(version[ \t]*=[ \t]*).*$/m;
  return re.test(raw) ? raw.replace(re, `$1${version}`) : null;
}

/** Android `versionName` in Groovy or Kotlin DSL. `versionCode` is deliberately
 *  left alone — it is a monotonic upload counter, not the semver. */
function planGradleBuild(path, raw, version) {
  const re = /(versionName[ \t]*=?[ \t]*")[^"]*(")/;
  return re.test(raw) ? raw.replace(re, `$1${version}$2`) : null;
}

/** MSBuild `<Version>` (or `<VersionPrefix>`) in a .csproj / Directory.Build.props. */
function planMsBuild(path, raw, version) {
  for (const tag of ["Version", "VersionPrefix"]) {
    const re = new RegExp(`<${tag}>[^<]*</${tag}>`);
    if (re.test(raw)) return raw.replace(re, `<${tag}>${version}</${tag}>`);
  }
  return null;
}

/**
 * Maven `<version>` — the PROJECT's own, never `<parent>`'s and never a
 * dependency's. The coordinate block is the region before the first structural
 * element, with any `<parent>…</parent>` removed; the first `<version>` left in
 * that region is the project's.
 */
function planPom(path, raw, version) {
  const bodyStart = raw.search(/<project\b/);
  if (bodyStart < 0) return null;
  const stop = /<(dependencies|dependencyManagement|build|properties|modules|profiles|repositories|reporting)\b/;
  const stopAt = raw.slice(bodyStart).search(stop);
  const head = raw.slice(bodyStart, stopAt < 0 ? raw.length : bodyStart + stopAt);
  const parent = /<parent\b[\s\S]*?<\/parent>/.exec(head);
  const searchable = parent ? head.slice(0, parent.index) + head.slice(parent.index + parent[0].length) : head;
  const own = /<version>[^<]*<\/version>/.exec(searchable);
  if (!own) {
    note(`${rel(path)} has no project-level <version> (inherited from <parent>?) — skipping`);
    return null;
  }
  // Map the hit back onto the untouched original: same literal, first occurrence
  // at or after the coordinate block, skipping the parent block if it precedes.
  const from = parent && parent.index < own.index ? bodyStart + parent.index + parent[0].length : bodyStart;
  const idx = raw.indexOf(own[0], from);
  if (idx < 0) return null;
  return raw.slice(0, idx) + `<version>${version}</version>` + raw.slice(idx + own[0].length);
}

/** mix.exs `version: "x"` inside `def project`. */
function planMixExs(path, raw, version) {
  const re = /(version:[ \t]*")[^"]*(")/;
  return re.test(raw) ? raw.replace(re, `$1${version}$2`) : null;
}

/** Helm Chart.yaml: `version` (the chart) and `appVersion` (the app) — both are
 *  driven by the same semver here; quoting style is preserved. */
function planChartYaml(path, raw, version) {
  let next = raw;
  const v = /^version:[ \t]*(["']?)[^"'\s]*\1[ \t]*$/m;
  if (!v.test(next)) return null;
  next = next.replace(v, (_, q) => `version: ${q}${version}${q}`);
  const app = /^appVersion:[ \t]*(["']?)[^"'\s]*\1[ \t]*$/m;
  if (app.test(next)) next = next.replace(app, (_, q) => `appVersion: ${q}${version}${q}`);
  return next;
}

/** Ruby `VERSION = "x"` (a nested `lib/.../version.rb`) or a literal `.version =` in a gemspec.
 *  A gemspec that computes its version from a constant is left alone — the
 *  version.rb it points at is the real target and is handled separately. */
function planRubyVersion(path, raw, version) {
  const constant = /(VERSION[ \t]*=[ \t]*(["']))[^"']*\2/;
  if (constant.test(raw)) return raw.replace(constant, `$1${version}$2`);
  const literal = /(\.version[ \t]*=[ \t]*(["']))[^"']*\2/;
  return literal.test(raw) ? raw.replace(literal, `$1${version}$2`) : null;
}

/** A WordPress plugin/theme header line (`Version: x`) — only in a file that
 *  actually carries a `Plugin Name:` / `Theme Name:` header. */
function planWpHeader(path, raw, version) {
  if (!/^[ \t]*\*?[ \t]*(Plugin|Theme) Name:/m.test(raw)) return null;
  const re = /^([ \t]*\*?[ \t]*Version:[ \t]*)\S+[ \t]*$/m;
  return re.test(raw) ? raw.replace(re, `$1${version}`) : null;
}

/** A bare root VERSION file (Go, C++, or any language: go:embed / -ldflags). */
function planVersionFile(path, raw, version) {
  return `${version}\n`;
}

// --- the registry ---
// One row per manifest family. `find` yields the existing files; `plan` decides
// whether and how to rewrite each. Adding a stack is a row here and nothing else.

const TARGETS = [
  { find: () => find("package.json"), plan: jsonVersion({ required: true }) },
  { find: () => find("src-tauri/tauri.conf.json", "src-tauri/tauri.conf.json5"), plan: jsonVersion() },
  { find: () => find("Cargo.toml", "src-tauri/Cargo.toml"), plan: planCargoToml },
  { find: () => find("Cargo.lock", "src-tauri/Cargo.lock"), plan: planCargoLock },
  { find: () => find("composer.json"), plan: jsonVersion() },
  { find: () => find("deno.json", "deno.jsonc"), plan: jsonVersion() },
  // `app.json` is a generic name (bare React Native uses it for the app's
  // display name); only an Expo manifest carries an "expo" key, so guard on it.
  { find: () => find("app.json"), plan: jsonVersion({ guard: '"expo"' }) },
  { find: () => find("pyproject.toml"), plan: planPyproject },
  { find: () => find("pubspec.yaml"), plan: planPubspec },
  { find: () => find("gradle.properties"), plan: planGradleProperties },
  {
    find: () =>
      find(
        "build.gradle",
        "build.gradle.kts",
        "app/build.gradle",
        "app/build.gradle.kts",
        "android/app/build.gradle",
        "android/app/build.gradle.kts",
      ),
    plan: planGradleBuild,
  },
  { find: () => find("Directory.Build.props", "*.csproj", "src/*/*.csproj"), plan: planMsBuild },
  { find: () => find("pom.xml"), plan: planPom },
  { find: () => find("mix.exs"), plan: planMixExs },
  { find: () => find("Chart.yaml"), plan: planChartYaml },
  { find: () => [...find("*.gemspec"), ...findDeep("lib", "version.rb")], plan: planRubyVersion },
  { find: () => find("style.css", "*.php"), plan: planWpHeader },
  { find: () => find("VERSION"), plan: planVersionFile },
];

/**
 * Plan every rewrite without touching disk. Shared by `writeAll` (which then
 * flushes) and `manifests` (which only needs the file list) — so the hook and
 * the writer can never disagree about which files are in play.
 */
export function planAll(version) {
  parseSemver(version); // validate before reading anything
  const plans = [];
  const seen = new Set();
  for (const target of TARGETS) {
    for (const path of target.find()) {
      if (seen.has(path)) continue; // e.g. root Cargo.toml listed by two patterns
      seen.add(path);
      const next = target.plan(path, readFileSync(path, "utf8"), version);
      if (next != null) plans.push({ path, label: rel(path), next });
    }
  }
  return plans;
}

/** Write `version` into every manifest that exists; returns the changed labels.
 *  Two-phase: all reads/validation first (throws BEFORE any write), then flush. */
export function writeAll(version) {
  const changed = [];
  for (const p of planAll(version)) {
    if (readFileSync(p.path, "utf8") !== p.next) {
      writeFileSync(p.path, p.next);
      changed.push(p.label);
    }
  }
  return changed;
}

/** Repo-relative paths a bump would rewrite — the list `post-commit` checks for
 *  local edits before it dares amend. */
export function manifests() {
  return planAll(currentVersion()).map((p) => p.label);
}

/** The canonical current version (from package.json). */
export function currentVersion() {
  const m = /"version"\s*:\s*"([^"]*)"/.exec(readFileSync(PKG, "utf8"));
  if (!m) throw new Error('no "version" in package.json');
  return m[1];
}

// Exported for scripts/tests/version.test.mjs. Every planner is a pure
// (path, raw, version) → string|null transform, so the manifest rewrites are
// tested directly against fixtures instead of scattering temp repos on disk.
export const __test = { expandGlob, tomlSection, planners: {
  jsonVersion,
  planCargoToml,
  planCargoLock,
  planPyproject,
  planPubspec,
  planGradleProperties,
  planGradleBuild,
  planMsBuild,
  planPom,
  planMixExs,
  planChartYaml,
  planRubyVersion,
  planWpHeader,
  planVersionFile,
} };

// --- CLI ---

function main(argv) {
  const [cmd, arg] = argv;
  switch (cmd) {
    case "get":
      process.stdout.write(currentVersion() + "\n");
      return;
    case "infer":
      process.stdout.write((inferBump(arg) ?? "none") + "\n");
      return;
    case "manifests":
      process.stdout.write(manifests().join("\n") + "\n");
      return;
    case "sync": {
      const v = currentVersion();
      const changed = writeAll(v);
      note(changed.length ? `synced → v${v} (${changed.join(", ")})` : `already in sync at v${v}`);
      return;
    }
    case "set": {
      const changed = writeAll(arg);
      note(`set → v${arg}${changed.length ? ` (${changed.join(", ")})` : " (no change)"}`);
      process.stdout.write(arg + "\n");
      return;
    }
    case "patch":
    case "minor":
    case "major": {
      const next = nextVersion(currentVersion(), cmd);
      writeAll(next);
      note(`v${next}  (${cmd})`);
      process.stdout.write(next + "\n");
      return;
    }
    case "from-commit": {
      const msg = arg && existsSync(arg) ? readFileSync(arg, "utf8") : (arg ?? "");
      const bump = inferBump(msg);
      if (!bump) {
        note("no bump (non-release commit type)");
        return;
      }
      const next = nextVersion(currentVersion(), bump);
      writeAll(next);
      note(`v${next}  (${bump} from commit)`);
      process.stdout.write(next + "\n");
      return;
    }
    default:
      note("usage: version.mjs <get|sync|patch|minor|major|set <v>|infer <msg>|manifests|from-commit <msg|file>>");
      process.exit(cmd ? 1 : 0);
  }
}

// Run the CLI only when invoked directly (so unit tests can import the pure
// helpers without triggering a manifest write).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
