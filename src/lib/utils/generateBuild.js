import fs from 'fs';
import { execSync } from 'child_process';

const buildNumber = execSync('git rev-parse --short HEAD').toString().trim();

fs.writeFileSync(
	'./src/lib/utils/build-info.js',
	`export const buildInfo = { buildNumber: "${buildNumber}" };`
);

// ── Version propagation ──────────────────────────────────────────────────────
// appConsts.version in core.svelte.js is the single hand-edited source of truth.
// It already reaches nodes.json and the MCP schema via their generators; this
// carries it the rest of the way to the files a citation depends on, so a bumped
// version cannot silently disagree with the DOI record.
//
// core.svelte.js uses runes, so it cannot be imported from plain node. Read it.

const CORE = './src/lib/core/core.svelte.js';
const core = fs.readFileSync(CORE, 'utf8');
const match = core.match(/appConsts\s*=\s*\$state\(\{[\s\S]*?version:\s*'([^']+)'/);

if (!match) {
	throw new Error(
		`generateBuild: could not read appConsts.version from ${CORE}. ` +
			`If the shape of that declaration changed, update this regex — do not ignore this.`
	);
}

const appVersion = match[1]; // e.g. "β.70.4"
// CITATION.cff and package.json want a plain semver-ish string matching the git
// tag (v70.4), not the display form, so drop any leading non-numeric prefix.
const plainVersion = appVersion.replace(/^[^0-9]*/, '');

if (!/^\d+(\.\d+)*$/.test(plainVersion)) {
	throw new Error(
		`generateBuild: appConsts.version "${appVersion}" does not reduce to a numeric ` +
			`version (got "${plainVersion}").`
	);
}

/** Rewrite a file only when the content actually changes, to avoid build churn. */
function writeIfChanged(path, next, label) {
	const prev = fs.readFileSync(path, 'utf8');
	if (prev === next) return;
	fs.writeFileSync(path, next);
	console.log(`  version → ${plainVersion} in ${label}`);
}

// package.json
const pkgPath = './package.json';
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkgNext = pkgRaw.replace(/("version":\s*")[^"]*(")/, `$1${plainVersion}$2`);
writeIfChanged(pkgPath, pkgNext, 'package.json');

// CITATION.cff — top-level `version:` key only (never one nested under authors
// or references), so anchor the match to the start of a line.
const cffPath = './CITATION.cff';
if (fs.existsSync(cffPath)) {
	const cffRaw = fs.readFileSync(cffPath, 'utf8');
	if (!/^version:\s*/m.test(cffRaw)) {
		throw new Error(`generateBuild: no top-level "version:" key in ${cffPath}.`);
	}
	const cffNext = cffRaw.replace(/^version:.*$/m, `version: "${plainVersion}"`);
	writeIfChanged(cffPath, cffNext, 'CITATION.cff');
}
