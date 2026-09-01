// scripts/lib/util.mjs — helpers shared by setup.mjs, install-hooks.mjs,
// stacks.mjs, gate.mjs and sync-agents.mjs. Extracted because the repo rule is
// explicit: anything used from 2+ places becomes a shared util.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at <root>/scripts/lib/). */
export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

/**
 * Run a command, never throw.
 *
 * `out` is stdout ONLY on success — callers such as "read the git remote URL"
 * depend on that being clean. `err` is stderr, kept separately so a caller can
 * SHOW it: most of our own scripts report progress on stderr, and a wrapper that
 * only forwarded stdout would reduce every step of `npm run setup` to "done".
 * On failure `out` carries both streams, because there the message is the point.
 */
export function tryRun(cmd, args = [], opts = {}) {
  // spawnSync, not execFileSync: the latter returns stdout ONLY, discarding
  // stderr on success — which is where our own scripts report everything they
  // did, so `npm run setup` printed a bare "done" for each step.
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
  const out = String(r.stdout ?? "").trim();
  const err = String(r.stderr ?? "").trim();
  if (r.error) return { ok: false, out: err || String(r.error.message), err };
  if (r.status === 0) return { ok: true, out, err };
  const merged = [out, err].filter(Boolean).join("\n").trim();
  return { ok: false, out: merged || `exited with code ${r.status}`, err };
}

/**
 * Windows needs a shell to launch anything that is not a real .exe — npm-installed
 * CLIs (bd among them) are `.cmd`/shell shims, and `execFileSync` without a shell
 * fails them with ENOENT. Without this, a Windows machine with beads installed is
 * told "bd not found" and silently skips the entire issue-tracker setup.
 */
export const NEEDS_SHELL = process.platform === "win32";

/**
 * Characters that stop being literal once a command line goes through a shell.
 * `NEEDS_SHELL` means arguments are concatenated, not escaped (Node's DEP0190),
 * so any argument taken from outside — a git remote URL, say — is checked with
 * this before it is passed along, and refused rather than guessed at.
 */
export function hasShellMetachars(value) {
  return /["'`$&|;<>^%\r\n()]/.test(String(value ?? ""));
}

/**
 * Run an external CLI that may be a Windows shim (see `NEEDS_SHELL`).
 *
 * On POSIX arguments never touch a shell at all.
 * On Windows a shell is unavoidable, and passing an args ARRAY alongside
 * `shell: true` is deprecated (DEP0190) exactly because those arguments are
 * concatenated unescaped. So the command line is built here instead: an
 * argument a shell would reinterpret is REFUSED rather than quoted-and-hoped,
 * and only whitespace is handled by quoting.
 */
export function runTool(cmd, args = []) {
  if (!NEEDS_SHELL) return tryRun(cmd, args);
  const unsafe = args.find(hasShellMetachars);
  if (unsafe !== undefined) {
    return {
      ok: false,
      out: `refusing to pass this through a Windows shell — run it yourself: ${cmd} … ${unsafe}`,
      err: "",
    };
  }
  // The COMMAND needs quoting as much as the arguments do: on Windows a tool
  // routinely lives under `C:\Program Files\…`, and an unquoted path is split at
  // the space ("'C:\Program' is not recognized").
  const quote = (v) => (/\s/.test(v) ? `"${v}"` : v);
  return tryRun([quote(cmd), ...args.map(quote)].join(" "), undefined, { shell: true });
}

/** Normalized path for equality checks: git prints forward slashes on Windows
 *  and drive-letter case can differ between tools. */
export function norm(p) {
  const r = resolve(p).split("\\").join("/");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

/**
 * Git's "dubious ownership" refusal (repo owned by another SID/uid — routine on
 * Windows after a drive move, a reinstall, or a copy between user accounts).
 * It makes EVERY git command exit 128, so a naive caller concludes "not a git
 * repository" and may advise `git init` — which would scaffold a second repo on
 * top of a real one. Detect it and hand back the exact fix instead.
 */
export function dubiousOwnership(out) {
  return /detected dubious ownership/i.test(String(out ?? ""));
}

/** The remedy line to print when `dubiousOwnership` matched. */
export function safeDirectoryHint(root = ROOT) {
  return `git config --global --add safe.directory "${resolve(root).split("\\").join("/")}"`;
}

/**
 * `git <args>` from the repo root. Returns `{ ok, out, dubious }`; `dubious` is
 * true when the failure was the ownership refusal above, so callers can print
 * the real cause rather than a misleading one.
 */
export function git(args) {
  const r = tryRun("git", args);
  return { ...r, dubious: !r.ok && dubiousOwnership(r.out) };
}

/** Repo-root path helper. */
export function at(...parts) {
  return join(ROOT, ...parts);
}

/** Read a UTF-8 file, or `null` when it does not exist. */
export function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Write only when the content actually changed; returns whether it wrote. */
export function writeIfChanged(path, next) {
  if (readIfExists(path) === next) return false;
  writeFileSync(path, next);
  return true;
}

/** Parse a JSON file, or `null` when missing/unparseable. */
export function readJson(path) {
  const raw = readIfExists(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the body of a `>>> vibe:<name>` / `<<< vibe:<name>` managed block,
 * appending the block when absent. Everything outside the markers is preserved
 * verbatim, so regenerating never clobbers hand-written content.
 */
export function upsertManagedBlock(text, name, body, comment = "#") {
  const open = `${comment} >>> vibe:${name}`;
  const close = `${comment} <<< vibe:${name}`;
  const block = [open, String(body).trimEnd(), close].filter(Boolean).join("\n");
  const re = new RegExp(`${escapeRe(open)}[\\s\\S]*?${escapeRe(close)}`, "m");
  const base = text ?? "";
  if (re.test(base)) return base.replace(re, block);
  const sep = base.length === 0 ? "" : base.endsWith("\n\n") ? "" : base.endsWith("\n") ? "\n" : "\n\n";
  return `${base}${sep}${block}\n`;
}

export function note(msg, prefix = "") {
  process.stderr.write(`${prefix}${msg}\n`);
}
