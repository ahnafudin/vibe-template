#!/usr/bin/env node
// scripts/stacks.mjs — the framework registry: load, resolve `extends`, detect
// what THIS repo is, and project the answer onto three places:
//
//   package.json → `vibe.gates`   (what `npm run gate` runs)
//   .gitignore   → managed block  (framework build artefacts)
//   docs/STACK.md                 (the generated brief every agent reads)
//
//   node scripts/stacks.mjs detect [dir]  rank the stacks that match a repo
//   node scripts/stacks.mjs list          every registry entry
//   node scripts/stacks.mjs show <id>     one entry, with `extends` resolved
//   node scripts/stacks.mjs doc           print docs/STACK.md to stdout
//   node scripts/stacks.mjs apply [--force]   write all three targets
//
// Detection is DATA-driven: adding a framework is a row in stacks.json and must
// never require touching this file. `scripts/version.mjs` deliberately does NOT
// read the registry — versioning must keep working even if a stack entry is wrong.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { expandGlob, isDir, isFile } from "./lib/glob.mjs";
import { validate } from "./lib/jsonschema.mjs";
import { at, isUnrenamedTemplate, readJson, ROOT, upsertManagedBlock, writeIfChanged } from "./lib/util.mjs";

const REGISTRY = at("scripts", "stacks.json");
const MAX_SCAN_BYTES = 1024 * 1024; // never slurp a huge file just to grep it
const GATE_ORDER = ["lint", "typecheck", "test", "build"];

// --- registry ---

let cache = null;
export function loadRegistry(path = REGISTRY) {
  if (cache && cache.path === path) return cache.data;
  const data = readJson(path);
  if (!data || !Array.isArray(data.stacks)) throw new Error(`cannot read stack registry: ${path}`);
  cache = { path, data: data.stacks };
  return cache.data;
}

export function byId(stacks, id) {
  return stacks.find((s) => s.id === id) ?? null;
}

/**
 * Structural check against stacks.schema.json plus the invariants a schema
 * cannot express: unique ids, resolvable/acyclic `extends`, and at least one
 * detection signal (an entry that can never match is dead weight that reads as
 * support the template does not actually have).
 */
export function validateRegistry(path = REGISTRY, schemaPath = at("scripts", "stacks.schema.json")) {
  const doc = readJson(path);
  if (!doc) return [`cannot parse ${path}`];
  const schema = readJson(schemaPath);
  const errors = schema ? validate(doc, schema).map((e) => `schema ${e}`) : ["cannot parse stacks.schema.json"];
  const stacks = doc.stacks ?? [];
  const seen = new Set();
  for (const s of stacks) {
    if (seen.has(s.id)) errors.push(`duplicate id "${s.id}"`);
    seen.add(s.id);
    if (!(s.detect?.any?.length || s.detect?.all?.length)) errors.push(`"${s.id}" has no detection signal`);
  }
  for (const s of stacks) {
    try {
      resolve(stacks, s.id);
    } catch (e) {
      errors.push(`"${s.id}": ${e.message}`);
    }
  }
  return errors;
}

function uniq(list) {
  return [...new Set(list.filter((v) => v !== undefined && v !== null && v !== ""))];
}

/** `extends` chain, bases first, deduped; throws on a cycle or a dangling id. */
function chainOf(stacks, id, seen = new Set()) {
  if (seen.has(id)) throw new Error(`circular extends at "${id}"`);
  const entry = byId(stacks, id);
  if (!entry) throw new Error(`unknown stack id "${id}"`);
  seen.add(id);
  const parents = entry.extends == null ? [] : [].concat(entry.extends);
  const out = [];
  for (const p of parents) out.push(...chainOf(stacks, p, new Set(seen)));
  out.push(entry);
  return out.filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
}

/** One entry with its bases folded in: child gates win per key, lists concat. */
export function resolve(stacks, id) {
  const chain = chainOf(stacks, id);
  const own = chain[chain.length - 1];
  const gates = {};
  const ignore = [];
  const conventions = [];
  const versionTargets = [];
  let coreLayer = "";
  for (const e of chain) {
    for (const [k, v] of Object.entries(e.gates ?? {})) gates[k] = v;
    ignore.push(...(e.ignore ?? []));
    conventions.push(...(e.conventions ?? []));
    versionTargets.push(...(e.versionTargets ?? []));
    if (e.coreLayer) coreLayer = e.coreLayer;
  }
  return {
    id: own.id,
    label: own.label,
    tier: own.tier,
    verified: own.verified !== false,
    bases: chain.slice(0, -1).map((e) => e.id),
    gates,
    ignore: uniq(ignore),
    conventions: uniq(conventions),
    versionTargets: uniq(versionTargets),
    coreLayer,
  };
}

// --- detection ---

/** Existing paths matching a repo-relative glob (any segment may use `*`). */
function expand(pattern, root) {
  return expandGlob(root, pattern);
}

function grep(path, needle) {
  try {
    if (statSync(path).size > MAX_SCAN_BYTES) return false;
    return readFileSync(path, "utf8").includes(needle);
  } catch {
    return false;
  }
}

function depSet(root) {
  const pkg = readJson(join(root, "package.json"));
  if (!pkg) return new Set();
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
}

function signalHits(signal, ctx) {
  if (signal.file) return expand(signal.file, ctx.root).some(isFile);
  if (signal.dir) return expand(signal.dir, ctx.root).some(isDir);
  if (signal.dep) return ctx.deps.has(signal.dep);
  if (signal.content) {
    const [path, needle] = signal.content;
    return expand(path, ctx.root).some((f) => isFile(f) && grep(f, needle));
  }
  return false;
}

/**
 * Rank every entry whose markers are present. `all` signals must ALL hit (this
 * is what stops `react-vite` from claiming every React-based framework); `any`
 * needs one. Score = number of satisfied signals, so the more specific entry —
 * Next.js matching both `next.config.*` and the `next` dep — outranks the
 * looser one without any hand-tuned priority table.
 */
export function detect(root = ROOT, stacks = loadRegistry()) {
  const ctx = { root, deps: depSet(root) };
  const matches = [];
  for (const s of stacks) {
    const any = s.detect?.any ?? [];
    const all = s.detect?.all ?? [];
    if (any.length === 0 && all.length === 0) continue;
    if (all.length && !all.every((sig) => signalHits(sig, ctx))) continue;
    const hitAny = any.filter((sig) => signalHits(sig, ctx));
    if (any.length && hitAny.length === 0) continue;
    matches.push({ id: s.id, tier: s.tier, score: hitAny.length + all.length + (s.weight ?? 0) });
  }
  matches.sort(
    (a, b) =>
      (a.tier === b.tier ? 0 : a.tier === "framework" ? -1 : 1) ||
      b.score - a.score ||
      a.id.localeCompare(b.id),
  );
  return matches;
}

/**
 * Detection turned into a decision: the winner, plus any OTHER framework that
 * matched and is not already part of the winner's `extends` chain (a monorepo
 * with a Next.js front end and a FastAPI service legitimately has two).
 */
export function detectResolved(root = ROOT, stacks = loadRegistry()) {
  const ranked = detect(root, stacks);
  if (ranked.length === 0) return { primary: null, secondary: [], ranked };
  const primary = resolve(stacks, ranked[0].id);
  const covered = new Set([primary.id, ...primary.bases]);
  const secondary = ranked
    .slice(1)
    .filter((m) => m.tier === "framework" && !covered.has(m.id))
    .map((m) => resolve(stacks, m.id))
    .filter((s) => !s.bases.includes(primary.id));
  return { primary, secondary, ranked };
}

// --- projection ---

function asList(v) {
  if (v === null || v === undefined || v === "") return [];
  return [].concat(v).filter(Boolean);
}

/** Merge gates across the primary and any co-resident frameworks, preserving
 *  order and dropping exact duplicate commands. */
export function mergeGates(primary, secondary = []) {
  const all = [primary, ...secondary].filter(Boolean);
  const keys = uniq([...GATE_ORDER, ...all.flatMap((s) => Object.keys(s.gates ?? {}))]);
  const out = {};
  for (const key of keys) {
    const cmds = uniq(all.flatMap((s) => asList(s.gates?.[key])));
    if (!cmds.length) continue;
    out[key] = cmds.length === 1 ? cmds[0] : cmds;
  }
  return out;
}

export function mergeIgnore(primary, secondary = []) {
  return uniq([primary, ...secondary].filter(Boolean).flatMap((s) => s.ignore ?? []));
}

function fence(cmd) {
  return asList(cmd)
    .map((c) => `\`${c}\``)
    .join(" · ");
}

/** The generated docs/STACK.md — the per-project brief agents read. */
export function renderDoc({ primary, secondary }, gates) {
  const GENERATED =
    "<!-- GENERATED by `npm run stack:apply` — do not hand-edit. Change scripts/stacks.json and re-run. -->";
  if (!primary) {
    return [
      "# Stack — not detected yet",
      "",
      GENERATED,
      "",
      "No framework markers found in this repo yet (it is still an empty template).",
      "Once the first manifest exists (`package.json`, `composer.json`, `go.mod`, `Cargo.toml`, …),",
      "run `npm run stack:apply` and this file fills itself in.",
      "",
    ].join("\n");
  }
  const stacks = [primary, ...secondary];
  const unverified = stacks.filter((s) => !s.verified);
  const lines = [
    `# Stack — ${primary.label}`,
    "",
    GENERATED,
    "",
    `**Detected:** ${primary.label} (\`${primary.id}\`)` +
      (primary.bases.length ? ` · extends ${primary.bases.map((b) => `\`${b}\``).join(", ")}` : ""),
  ];
  if (secondary.length) {
    lines.push(
      "",
      `**Also in this repo:** ${secondary.map((s) => `${s.label} (\`${s.id}\`)`).join(" · ")} — ` +
        "their gates are merged into `vibe.gates`; delete whatever does not apply.",
    );
  }
  if (unverified.length) {
    lines.push(
      "",
      `> ⚠️ **Unverified commands** for ${unverified.map((s) => `\`${s.id}\``).join(", ")}. ` +
        "These registry entries are best-effort: run them once and correct them in `package.json` → " +
        "`vibe.gates` before trusting them. Do NOT conclude the build is broken from an unverified command.",
    );
  }
  lines.push(
    "",
    "## Core-first — where the heavy logic belongs",
    "",
    primary.coreLayer || "_(not filled in for this stack yet)_",
    "",
    "## Quality gates",
    "",
    "One command, whatever the language: **`npm run gate`** — `npm run gate test` for a single stage,",
    "`npm run gate:list` to see the commands without running them.",
    "",
    "| Gate | Command |",
    "|---|---|",
  );
  for (const key of uniq([...GATE_ORDER, ...Object.keys(gates)])) {
    if (!gates[key]) continue;
    lines.push(`| \`${key}\` | ${fence(gates[key])} |`);
  }
  const conventions = uniq(stacks.flatMap((s) => s.conventions ?? []));
  if (conventions.length) {
    lines.push("", "## Framework conventions", "");
    for (const c of conventions) lines.push(`- ${c}`);
  }
  const targets = uniq(stacks.flatMap((s) => s.versionTargets ?? []));
  if (targets.length) {
    lines.push(
      "",
      "## Version manifests",
      "",
      `Synced automatically when present: ${targets.map((t) => `\`${t}\``).join(", ")}. ` +
        "Details, and what you still have to raise by hand: `docs/VERSIONING.md`.",
    );
  }
  lines.push(
    "",
    "---",
    "",
    "Wrong stack? Fix that entry's `detect` block in `scripts/stacks.json` and re-run `npm run stack:apply`.",
    "Framework missing from the registry? Add one JSON entry — no code change needed.",
    "",
  );
  return lines.join("\n");
}

/** JSON indent used by an existing file, so rewriting keeps its house style. */
function indentOf(raw, fallback = 2) {
  const m = /^[^\n]*\n(\s+)"/.exec(raw ?? "");
  if (!m) return fallback;
  return m[1].includes("\t") ? "\t" : m[1].length;
}

export function apply({ force = false, root = ROOT } = {}) {
  const stacks = loadRegistry();
  const found = detectResolved(root, stacks);
  const detected = found.primary ? mergeGates(found.primary, found.secondary) : {};
  const changed = [];

  // 1. package.json → vibe.stack + vibe.gates (never clobber a hand-tuned block)
  const pkgPath = join(root, "package.json");
  const raw = existsSync(pkgPath) ? readFileSync(pkgPath, "utf8") : null;
  const pkg = raw ? JSON.parse(raw) : null;
  const hadGates = Boolean(pkg?.vibe?.gates && Object.keys(pkg.vibe.gates).length > 0);
  // The template ships gates for maintaining ITSELF (validate the registry, check
  // the generated agent files). Copied into a new project those are nonsense —
  // and because they are non-empty, "never clobber a hand-tuned block" would
  // preserve them forever: an Electron app would report a green gate having
  // never once run its build. `ownedByTemplate` marks them as scaffolding, to be
  // replaced the first time a RENAMED project detects its real stack. In the
  // template itself (still named `my-project`) they are kept.
  const templateOwned = Boolean(pkg?.vibe?.ownedByTemplate) && !isUnrenamedTemplate(root);
  const replaceGates = !hadGates || templateOwned || force;
  if (pkg && found.primary && replaceGates) {
    const vibe = { ...pkg.vibe, stack: found.primary.id, gates: detected };
    delete vibe.ownedByTemplate; // one-shot: they are this project's gates now
    pkg.vibe = vibe;
    if (writeIfChanged(pkgPath, JSON.stringify(pkg, null, indentOf(raw)) + "\n")) {
      changed.push(templateOwned ? "package.json (replaced the template's own gates)" : "package.json (vibe.gates)");
    }
  }

  // What `npm run gate` will ACTUALLY run: a hand-tuned block in package.json
  // wins over the registry defaults. The generated doc must show this, not the
  // registry's opinion — otherwise it documents commands nobody runs.
  const gates = replaceGates ? detected : pkg.vibe.gates;

  // 2. .gitignore → managed block of framework artefacts
  const giPath = join(root, ".gitignore");
  const ignore = found.primary ? mergeIgnore(found.primary, found.secondary) : [];
  if (ignore.length) {
    const body = ["# Framework build artefacts — regenerated by `npm run stack:apply`.", ...ignore].join("\n");
    const next = upsertManagedBlock(existsSync(giPath) ? readFileSync(giPath, "utf8") : "", "stack-ignores", body);
    if (writeIfChanged(giPath, next)) changed.push(".gitignore (vibe:stack-ignores)");
  }

  // 3. docs/STACK.md → the generated brief
  const docPath = join(root, "docs", "STACK.md");
  if (writeIfChanged(docPath, renderDoc(found, gates))) changed.push("docs/STACK.md");

  return { ...found, gates, changed };
}

// --- CLI ---

function main(argv) {
  const [cmd, arg] = argv;
  const stacks = loadRegistry();
  switch (cmd) {
    case "validate": {
      const errors = validateRegistry();
      if (errors.length) {
        for (const e of errors) process.stderr.write(`[stack] ${e}\n`);
        process.stderr.write(`[stack] ${errors.length} problem(s) in scripts/stacks.json\n`);
        process.exit(1);
      }
      process.stderr.write(`[stack] registry valid — ${stacks.length} entries\n`);
      return;
    }
    case "list": {
      for (const s of stacks) {
        const flag = s.verified === false ? " (unverified)" : "";
        process.stdout.write(`${s.tier === "framework" ? "▸" : "•"} ${s.id.padEnd(16)} ${s.label}${flag}\n`);
      }
      const frameworks = stacks.filter((s) => s.tier === "framework").length;
      process.stdout.write(`\n${stacks.length} entries — ${frameworks} frameworks, ${stacks.length - frameworks} language bases\n`);
      return;
    }
    case "show": {
      if (!arg) throw new Error("usage: stacks.mjs show <id>");
      process.stdout.write(JSON.stringify(resolve(stacks, arg), null, 2) + "\n");
      return;
    }
    case "detect": {
      // Optional directory: CI scaffolds a real app elsewhere and asks about it.
      const { primary, secondary, ranked } = detectResolved(arg ? resolvePath(arg) : ROOT, stacks);
      if (!primary) {
        process.stdout.write("no stack detected\n");
        return;
      }
      process.stdout.write(`primary:   ${primary.id} — ${primary.label}\n`);
      if (primary.bases.length) process.stdout.write(`extends:   ${primary.bases.join(", ")}\n`);
      if (secondary.length) process.stdout.write(`also here: ${secondary.map((s) => s.id).join(", ")}\n`);
      process.stdout.write(`ranked:    ${ranked.map((m) => `${m.id}(${m.score})`).join(", ")}\n`);
      return;
    }
    case "doc": {
      const found = detectResolved(ROOT, stacks);
      process.stdout.write(renderDoc(found, found.primary ? mergeGates(found.primary, found.secondary) : {}));
      return;
    }
    case "apply": {
      const r = apply({ force: argv.includes("--force") });
      process.stderr.write(
        r.primary
          ? `[stack] ${r.primary.label}${r.secondary.length ? ` (+ ${r.secondary.map((s) => s.id).join(", ")})` : ""}\n`
          : "[stack] nothing detected yet — docs/STACK.md left as a placeholder\n",
      );
      process.stderr.write(
        r.changed.length ? `[stack] updated: ${r.changed.join(", ")}\n` : "[stack] already up to date\n",
      );
      return;
    }
    default:
      process.stderr.write("usage: stacks.mjs <list|show <id>|detect|doc|apply [--force]>\n");
      process.exit(cmd ? 1 : 0);
  }
}

// Run the CLI only when invoked directly, so tests can import the pure helpers.
// `pathToFileURL` (not hand-built `file://` strings) — a Windows argv path like
// `D:\...` would otherwise parse its drive letter as a URL host.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
