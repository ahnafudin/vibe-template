#!/usr/bin/env node
// scripts/tests/run.mjs — run the suite with EXPLICIT file paths.
//
// Not `node --test scripts/tests/*.test.mjs`: that only works where something
// expands the glob. A POSIX shell does it, cmd.exe does not, and Node itself
// only learned to in v21 — so the form that passes locally on Node 24 failed CI
// on Node 20, where the glob reached Node as a literal filename. Enumerating the
// files here works on every version and every platform, with or without a shell.
//
//   node scripts/tests/run.mjs [extra node --test flags]

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => join(HERE, f));

if (files.length === 0) {
  process.stderr.write("[tests] no *.test.mjs found\n");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
