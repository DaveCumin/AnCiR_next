#!/usr/bin/env node
// Manifest curation check (reporting only).
//
// The handbook now lives in the AnCiR workspace and imports AnCiR's node
// manifest and session index DIRECTLY (via the $ancir alias) — there is no
// longer any file to copy. What still needs a human is the hand-authored
// prose in src/lib/nodeReference.json, which the machine cannot write. This
// script flags where that prose has drifted from the live manifest:
//
//   • palette nodes with no nodeReference entry    (need curated prose)
//   • nodeReference entries for nodes that are gone (stale, should be removed)
//   • sessions that showcase an unknown node id     (bad reference)
//
// Usage:  node scripts/sync-manifests.mjs   (alias: pnpm --filter handbook check:manifest)
// Exits 1 if any problem is found (so it can gate CI), else 0.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ANCIR = resolve(HERE, "..", ".."); // workspace root (AnCiR app)
const HANDBOOK_LIB = resolve(HERE, "..", "src", "lib");

const c = { red: "\x1b[31m", yel: "\x1b[33m", grn: "\x1b[32m", cyan: "\x1b[36m", rst: "\x1b[0m" };
const log = (...a) => console.log(...a);
const warn = (...a) => console.log(c.yel + "⚠ " + a.join(" ") + c.rst);
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

const srcNodes = resolve(ANCIR, "static/nodes.json");
const srcSessions = resolve(ANCIR, "static/sessions/demos/index.json");

if (!existsSync(srcNodes) || !existsSync(srcSessions)) {
  warn(`AnCiR manifest not found under ${ANCIR}/static — is the handbook still inside the AnCiR workspace?`);
  process.exit(1);
}

const nodes = readJSON(srcNodes);
const idx = readJSON(srcSessions);
const sessions = (Array.isArray(idx) ? idx : idx.sessions ?? idx.demos ?? []).filter((s) => s.kind !== "dataset");
const ref = readJSON(resolve(HANDBOOK_LIB, "nodeReference.json"));

log(`${c.cyan}AnCiR:${c.rst}    ${ANCIR}  (nodes ${nodes.generatedFromVersion}, ${nodes.nodes.length} nodes, ${sessions.length} sessions)`);
log(`${c.cyan}Handbook:${c.rst} ${HANDBOOK_LIB}`);
log("");

const paletteIds = new Set(nodes.nodes.filter((n) => !n.hideFromPalette).map((n) => n.id));
const refIds = new Set(Object.keys(ref));

const missingRef = [...paletteIds].filter((id) => !refIds.has(id)).sort();
const orphanRef = [...refIds].filter((id) => !nodes.nodes.some((n) => n.id === id)).sort();
const unknownShowcase = [...new Set(sessions.flatMap((s) => s.showcases ?? []))]
  .filter((id) => !nodes.nodes.some((n) => n.id === id))
  .sort();

let problems = 0;
if (missingRef.length) {
  problems++;
  warn(`${missingRef.length} palette node(s) have NO nodeReference.json entry — add curated prose for:`);
  log(`    ${missingRef.join(", ")}`);
}
if (orphanRef.length) {
  problems++;
  warn(`${orphanRef.length} nodeReference entr(y/ies) reference a node that no longer exists:`);
  log(`    ${orphanRef.join(", ")}`);
}
if (unknownShowcase.length) {
  problems++;
  warn(`Session showcases reference unknown node ids: ${unknownShowcase.join(", ")}`);
}

log("");
if (problems) {
  warn("Curation needed — see above.");
  process.exit(1);
}
log(`${c.grn}✓ nodeReference.json covers every palette node; no orphans; all showcases resolve.${c.rst}`);
