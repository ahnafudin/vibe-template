#!/usr/bin/env node
// scripts/gate.mjs — the ONE command every agent needs to know, whatever the
// language: `npm run gate`. It runs the quality gates declared in package.json
// under `vibe.gates`, in a fixed order, stopping at the first failure.
//
//   npm run gate              lint → typecheck → test → build (skipping empties)
//   npm run gate test         just one gate
//   npm run gate:list         show what is configured, run nothing
//
// Note the dedicated `gate:list` script: `npm run gate --list` would NOT work,
// because npm swallows a leading flag instead of forwarding it — you would get a
// full gate run instead of a listing. Non-flag args (`npm run gate test`) do pass
// through. Calling this file directly (`node scripts/gate.mjs --list`) is fine.
//
// A gate value is a shell line, an ordered list of them (a polyglot repo such as
// Tauri runs the web AND the Rust side), or ""/null meaning "this project has no
// such gate" — declared absence is skipped quietly, it is not a failure.
//
// With no `vibe.gates` configured, the stack registry is consulted on the fly so
// `npm run gate` still does something useful before `npm run setup` has ever run.

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { at, readJson } from "./lib/util.mjs";
import { detectResolved, mergeGates } from "./stacks.mjs";

const ORDER = ["lint", "typecheck", "test", "build"];
// 127 = POSIX "command not found"; 9009 = the cmd.exe equivalent on Windows.
const NOT_FOUND = new Set([127, 9009]);

function asList(v) {
  if (v === null || v === undefined || v === "") return [];
  return [].concat(v).filter((c) => typeof c === "string" && c.trim() !== "");
}

/** Gate order: the canonical four first, then any extras in declaration order. */
export function gateOrder(gates) {
  const extra = Object.keys(gates).filter((k) => !ORDER.includes(k));
  return [...ORDER, ...extra].filter((k) => asList(gates[k]).length > 0);
}

/** Configured gates, falling back to on-the-fly stack detection. */
export function loadGates() {
  const pkg = readJson(at("package.json"));
  const configured = pkg?.vibe?.gates;
  if (configured && Object.keys(configured).length > 0) return { gates: configured, source: "package.json" };
  const found = detectResolved();
  if (!found.primary) return { gates: {}, source: "none" };
  return { gates: mergeGates(found.primary, found.secondary), source: `detected:${found.primary.id}` };
}

function run(cmd) {
  process.stderr.write(`\n\x1b[36m$ ${cmd}\x1b[0m\n`);
  const r = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: at() });
  if (r.error) return { ok: false, code: 1, reason: r.error.message };
  const code = r.status ?? 1;
  return { ok: code === 0, code, reason: NOT_FOUND.has(code) ? "command not found" : "" };
}

function main(argv) {
  const list = argv.includes("--list");
  const only = argv.filter((a) => !a.startsWith("-"));
  const { gates, source } = loadGates();
  const keys = gateOrder(gates);

  if (keys.length === 0) {
    process.stderr.write(
      "[gate] no gates configured yet.\n" +
        "       Run `npm run stack:apply` to fill them in from the framework registry,\n" +
        "       or write `vibe.gates` in package.json yourself. See docs/STACK.md.\n",
    );
    return 0;
  }

  if (list) {
    process.stderr.write(`[gate] source: ${source}\n`);
    for (const k of keys) for (const c of asList(gates[k])) process.stderr.write(`  ${k.padEnd(10)} ${c}\n`);
    return 0;
  }

  const selected = only.length ? keys.filter((k) => only.includes(k)) : keys;
  if (only.length && selected.length === 0) {
    process.stderr.write(`[gate] unknown gate: ${only.join(", ")} — available: ${keys.join(", ")}\n`);
    return 1;
  }

  const done = [];
  for (const key of selected) {
    for (const cmd of asList(gates[key])) {
      const r = run(cmd);
      if (!r.ok) {
        process.stderr.write(
          `\n\x1b[31m[gate] FAILED at \`${key}\` (exit ${r.code})${r.reason ? ` — ${r.reason}` : ""}\x1b[0m\n`,
        );
        if (r.reason === "command not found") {
          process.stderr.write(
            "       This command came from the framework registry and may be unverified.\n" +
              "       Correct it in package.json → `vibe.gates`; see docs/STACK.md.\n",
          );
        }
        if (done.length) process.stderr.write(`       Already passed: ${done.join(", ")}\n`);
        return 1;
      }
    }
    done.push(key);
  }
  process.stderr.write(`\n\x1b[32m[gate] PASSED: ${done.join(" → ")}\x1b[0m\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
