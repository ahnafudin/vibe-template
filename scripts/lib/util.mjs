// scripts/lib/util.mjs — helpers shared by setup.mjs, install-hooks.mjs,
// stacks.mjs, gate.mjs and sync-agents.mjs. Extracted because the repo rule is
// explicit: anything used from 2+ places becomes a shared util.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo root (this file lives at <root>/scripts/lib/). */
export const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));

/** Run a command, never throw: `{ ok, out }` with stdout+stderr merged on failure. */
export function tryRun(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    return { ok: true, out: String(out ?? "").trim() };
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
    return { ok: false, out: out || String(e?.message ?? e) };
  }
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
