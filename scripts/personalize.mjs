#!/usr/bin/env node
// scripts/personalize.mjs — turn a pristine copy of the template into THIS
// project. Runs once, early in `npm run setup`.
//
// Every bug found by generating real apps from this template had the same
// shape: template scaffolding surviving into the project that was made from it.
// The beads identity. The gates. The npm `test` script. And the two this file
// fixes — the version and the README.
//
//   version   a new project starts at 0.1.0, not at whatever release the
//             template itself had reached (0.2.x, and climbing)
//   README    the template's README describes the TEMPLATE. Left in place, an
//             agent opening the project reads "a project boilerplate … 70-entry
//             framework registry" and concludes the project IS the template.
//             It moves to docs/TEMPLATE.md — still needed, since it documents
//             the tooling — and a project README takes its place.
//
// Two conditions, both required, so this can never fire on a real project:
//   - package.json no longer carries the placeholder name (someone renamed it)
//   - `vibe.ownedByTemplate` is still set (nothing has personalised it yet)
// `scripts/stacks.mjs` clears that flag immediately afterwards in setup, when it
// swaps the template's gates for the detected framework's.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isUnrenamedTemplate, note as write, parseFlags, readJson, ROOT, writeIfChanged } from "./lib/util.mjs";

/** Marks a README as still being the template's own, and therefore replaceable. */
export const TEMPLATE_README_MARKER = "<!-- vibe:template-readme -->";
export const FRESH_VERSION = "0.1.0";
const KEPT_AS = join("docs", "TEMPLATE.md");

const note = (msg) => write(msg, "[personalize] ");

function projectReadme(pkg) {
  const name = pkg?.name ?? "this project";
  const description = pkg?.description?.startsWith("TODO:fill") ? "" : (pkg?.description ?? "");
  return [
    `# ${name}`,
    "",
    description || "<!-- TODO:fill — one paragraph on what this project is and who it is for. -->",
    "",
    "## Getting started",
    "",
    "```bash",
    "npm install",
    "npm run setup     # git hooks, framework detection, agent docs, issue tracker",
    "npm run gate      # lint → typecheck → test → build, whatever the language",
    "```",
    "",
    "## Where things are",
    "",
    "| For | Read |",
    "|---|---|",
    "| Rules every AI coding agent follows here | [`AGENTS.md`](AGENTS.md) |",
    "| The detected framework, where logic belongs, the gate commands | [`docs/STACK.md`](docs/STACK.md) |",
    "| Product scope and guardrails | [`docs/PRD.md`](docs/PRD.md) |",
    "| Architecture and key decisions | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |",
    "| What is being built next | [`docs/TASKS.md`](docs/TASKS.md) |",
    "| How the tooling in `scripts/` works | [`docs/TEMPLATE.md`](docs/TEMPLATE.md) |",
    "",
  ].join("\n");
}

/**
 * De-template a fresh copy. Returns `{ skipped, changed }`; `changed` lists the
 * files rewritten. Safe to call repeatedly — it does nothing once the project
 * has been personalised, and nothing at all in the template itself.
 */
export function personalize({ root = ROOT } = {}) {
  const changed = [];
  if (isUnrenamedTemplate(root)) {
    return { skipped: "this IS the template (package.json still has the placeholder name)", changed };
  }
  const pkgPath = join(root, "package.json");
  const raw = existsSync(pkgPath) ? readFileSync(pkgPath, "utf8") : null;
  const pkg = raw ? readJson(pkgPath) : null;
  if (!pkg?.vibe?.ownedByTemplate) {
    return { skipped: "already personalised", changed };
  }

  // 1. Start this project's version history at 0.1.0. Targeted replacement, so
  //    package.json keeps its formatting exactly as `version.mjs` would leave it.
  if (pkg.version !== FRESH_VERSION) {
    const next = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${FRESH_VERSION}"`);
    if (writeIfChanged(pkgPath, next)) changed.push(`package.json (version → ${FRESH_VERSION})`);
  }

  // 2. Keep the template's README as tooling documentation, and give the project
  //    a README about itself. Guarded by the marker: a README someone has
  //    already written is never touched.
  const readmePath = join(root, "README.md");
  const readme = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
  if (readme.includes(TEMPLATE_README_MARKER)) {
    const keptPath = join(root, KEPT_AS);
    mkdirSync(dirname(keptPath), { recursive: true });
    if (writeIfChanged(keptPath, readme)) changed.push(`${KEPT_AS.split("\\").join("/")} (template docs kept here)`);
    if (writeIfChanged(readmePath, projectReadme(pkg))) changed.push("README.md (now describes this project)");
  }

  return { skipped: null, changed };
}

function main(argv = []) {
  // It took no arguments at all, so anything typed at it disappeared without
  // comment — including a `--force` somebody might reasonably expect to exist.
  const { problems } = parseFlags(argv, { known: [] });
  if (problems.length) {
    write(`${problems.join("; ")} — personalize takes no flags`);
    return 2;
  }
  const { skipped, changed } = personalize();
  if (skipped) {
    note(`nothing to do — ${skipped}.`);
    return 0;
  }
  if (!changed.length) {
    note("already personalised.");
    return 0;
  }
  for (const c of changed) note(`updated ${c}`);
  note(`the template's own README is now ${KEPT_AS.split("\\").join("/")} — it documents scripts/.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
