// scripts/version.mjs — the SINGLE source of truth for the app semver
// (MAJOR.MINOR.PATCH). `package.json` holds the canonical value; this script
// propagates it to any OPTIONAL sync targets that exist in the repo (Tauri
// config, Cargo manifests — extend `writeAll` for other stacks) so every
// manifest stays in lockstep.
//
//   node scripts/version.mjs get                 print the current version
//   node scripts/version.mjs sync                rewrite the sync targets to match package.json
//   node scripts/version.mjs patch|minor|major   bump + write all manifests
//   node scripts/version.mjs set 1.2.3           set an explicit version
//   node scripts/version.mjs infer "<msg>"       print the bump a commit msg implies
//                                                (the .githooks/post-commit hook path)
//   node scripts/version.mjs from-commit <msg|file>   convenience: infer + bump in one step
//
// Writes are targeted regex replacements (never a JSON reparse/reformat), so a
// bump touches only the version string and produces a clean one-line diff.
// `writeAll` is two-phase: every target is read + validated BEFORE any byte is
// written, so a validation failure can never leave the manifests half-synced.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "package.json");

// Optional sync targets — each is silently skipped when the file is absent,
// so the same script works for a plain web project and a Tauri/Rust one.
const TAURI_CONF = join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML = join(ROOT, "src-tauri", "Cargo.toml");
const CARGO_LOCK = join(ROOT, "src-tauri", "Cargo.lock");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

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
 * Returns `null` when the commit should NOT bump the version. A non-conventional
 * message NEVER bumps — even if its body happens to mention "BREAKING CHANGE"
 * (the footer token requires the colon, per the conventional-commits spec).
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

// --- manifest IO ---
// Each `plan*` function reads + validates a target and returns
// `{ path, label, next }` (or null to skip it) WITHOUT writing, so `writeAll`
// can validate everything first and only then flush — pseudo-transactional.

function writeIfChanged(path, next) {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev === next) return false;
  writeFileSync(path, next);
  return true;
}

/** Replace the FIRST top-level `"version": "x.y.z"` (the package version sits
 *  before any nested object that could carry one) — preserves all formatting. */
function planJsonVersion(path, label, version) {
  const raw = readFileSync(path, "utf8");
  if (!/"version":\s*"[^"]*"/.test(raw)) {
    throw new Error(`no "version" key found in ${path}`);
  }
  return { path, label, next: raw.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`) };
}

/** The `[package]` section of Cargo.toml: `{ text, start }`, or null. Scoped so
 *  a dependency's `version = "…"` (or a `[[bin]]` name) can never be mistaken
 *  for the package's own. */
function cargoPackageSection(raw) {
  const m = /^\[package\][^\r\n]*\r?\n(?:(?!\s*\[)[^\r\n]*\r?\n?)*/m.exec(raw);
  return m ? { text: m[0], start: m.index } : null;
}

/** Plan the `[package]` version rewrite. Returns null (skip, with a note) when
 *  the version is workspace-inherited — the workspace root owns it then. */
function planCargoToml(version) {
  const raw = readFileSync(CARGO_TOML, "utf8");
  const sec = cargoPackageSection(raw);
  if (!sec) throw new Error("no [package] section in src-tauri/Cargo.toml");
  if (/^version\s*\.\s*workspace\s*=|^version\s*=\s*\{\s*workspace/m.test(sec.text)) {
    process.stderr.write("[version] Cargo.toml version is workspace-inherited — skipping\n");
    return null;
  }
  if (!/^version = "[^"]*"/m.test(sec.text)) {
    throw new Error("could not find the [package] version in Cargo.toml");
  }
  const patched = sec.text.replace(/^version = "[^"]*"/m, `version = "${version}"`);
  return {
    path: CARGO_TOML,
    label: "src-tauri/Cargo.toml",
    next: raw.slice(0, sec.start) + patched + raw.slice(sec.start + sec.text.length),
  };
}

/** The crate's `[package] name` (scoped to the [package] section). */
function cargoCrateName() {
  const sec = cargoPackageSection(readFileSync(CARGO_TOML, "utf8"));
  const m = sec && /^name = "([^"]+)"/m.exec(sec.text);
  return m ? m[1] : null;
}

/** Plan the crate's own entry in Cargo.lock (best-effort; the lock is
 *  reconciled by cargo on the next build anyway). */
function planCargoLock(version) {
  if (!existsSync(CARGO_LOCK)) return null;
  const crate = cargoCrateName();
  if (!crate) return null;
  const raw = readFileSync(CARGO_LOCK, "utf8");
  // `\r?\n` so the multi-line match works on both LF and CRLF (Windows) locks.
  const re = new RegExp(
    `(\\[\\[package\\]\\]\\r?\\nname = "${crate}"\\r?\\nversion = ")[^"]*(")`,
  );
  if (!re.test(raw)) return null;
  return { path: CARGO_LOCK, label: "src-tauri/Cargo.lock", next: raw.replace(re, `$1${version}$2`) };
}

/** Write `version` into every manifest that exists; returns the changed files.
 *  Two-phase: all reads/validation first (throws BEFORE any write), then flush. */
export function writeAll(version) {
  parseSemver(version); // validate before touching disk
  const plans = [planJsonVersion(PKG, "package.json", version)];
  if (existsSync(TAURI_CONF)) plans.push(planJsonVersion(TAURI_CONF, "src-tauri/tauri.conf.json", version));
  if (existsSync(CARGO_TOML)) {
    plans.push(planCargoToml(version));
    plans.push(planCargoLock(version));
  }
  const changed = [];
  for (const p of plans) {
    if (p && writeIfChanged(p.path, p.next)) changed.push(p.label);
  }
  return changed;
}

/** The canonical current version (from package.json). */
export function currentVersion() {
  const m = /"version":\s*"([^"]*)"/.exec(readFileSync(PKG, "utf8"));
  if (!m) throw new Error('no "version" in package.json');
  return m[1];
}

// --- CLI ---

function log(message) {
  process.stderr.write(`[version] ${message}\n`);
}

function main(argv) {
  const [cmd, arg] = argv;
  switch (cmd) {
    case "get":
      process.stdout.write(currentVersion() + "\n");
      return;
    case "infer":
      process.stdout.write((inferBump(arg) ?? "none") + "\n");
      return;
    case "sync": {
      const v = currentVersion();
      const changed = writeAll(v);
      log(changed.length ? `synced manifests → v${v} (${changed.join(", ")})` : `already in sync at v${v}`);
      return;
    }
    case "set": {
      const changed = writeAll(arg);
      log(`set → v${arg}${changed.length ? ` (${changed.join(", ")})` : " (no change)"}`);
      process.stdout.write(arg + "\n");
      return;
    }
    case "patch":
    case "minor":
    case "major": {
      const next = nextVersion(currentVersion(), cmd);
      writeAll(next);
      log(`v${next}  (${cmd})`);
      process.stdout.write(next + "\n");
      return;
    }
    case "from-commit": {
      const msg = arg && existsSync(arg) ? readFileSync(arg, "utf8") : (arg ?? "");
      const bump = inferBump(msg);
      if (!bump) {
        log("no bump (non-release commit type)");
        return;
      }
      const next = nextVersion(currentVersion(), bump);
      writeAll(next);
      log(`v${next}  (${bump} from commit)`);
      process.stdout.write(next + "\n");
      return;
    }
    default:
      log("usage: version.mjs <get|sync|patch|minor|major|set <v>|infer <msg>|from-commit <msg|file>>");
      process.exit(cmd ? 1 : 0);
  }
}

// Run the CLI only when invoked directly (so unit tests can import the pure
// helpers without triggering a manifest write).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
