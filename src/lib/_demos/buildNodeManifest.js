/**
 * Builds the AnCiR node manifest (static/nodes.json) from the LIVE registry —
 * every table-process, column-process and plot, with its inputs/params/outputs,
 * family, description, demo link, and the app version it was generated from.
 *
 * Shared by two tests so they can never disagree:
 *   • generateNodeManifest.svelte.test.js  — writes the file (GEN_MANIFEST=1)
 *   • nodeManifestFreshness.svelte.test.js — fails if the committed file drifts
 *
 * The handbook (a workspace member) imports the committed static/nodes.json
 * directly for its Node Reference, so keeping it fresh keeps the docs correct.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appConsts } from '$lib/core/core.svelte.js';
import { loadProcesses } from '$lib/processes/processMap.js';
import { loadPlots } from '$lib/plots/plotMap.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

export const MANIFEST_PATH = join(process.cwd(), 'static', 'nodes.json');
const INDEX = join(process.cwd(), 'static', 'sessions', 'demos', 'index.json');

// Default-arg keys that are plumbing, not user-facing parameters.
const INTERNAL_KEYS = new Set([
	'out',
	'valid',
	'forcollected',
	'collectedType',
	'tableProcesses',
	'preProcesses',
	'outColIds',
	'storedValueRefs',
	'aggregates'
]);

// Params whose default is computed at runtime (an RNG seed, or a Date.now()-based
// start/end time) and therefore differs on every generation. Recording them as
// null keeps the manifest DETERMINISTIC — so it doesn't churn on each regen and
// the freshness test can compare byte-exactly. (If a new node adds a volatile
// default under a different name, the freshness test will flag it intermittently
// — add the name here when it does.)
const VOLATILE_DEFAULTS = new Set(['seed', 'startTime', 'endTime']);

function paramsFromDefaults(defaults) {
	const out = [];
	if (!defaults || typeof defaults.entries !== 'function') return out;
	for (const [key, def] of defaults.entries()) {
		if (INTERNAL_KEYS.has(key)) continue;
		let val = def && Object.prototype.hasOwnProperty.call(def, 'val') ? def.val : undefined;
		if (VOLATILE_DEFAULTS.has(key)) val = null;
		out.push({ name: key, default: val });
	}
	return out;
}

function portList(ports) {
	return (ports ?? []).map((p) => ({
		name: p.name,
		kind: p.artifactKind ?? p.kind ?? 'column',
		cardinality: p.dynamic || p.cardinality === 'many' ? 'many' : 'one',
		...(p.metric ? { metric: true } : {}),
		...(p.dynamicPrefix ? { dynamicPrefix: p.dynamicPrefix } : {})
	}));
}

/**
 * Produce the manifest object (does not write it). Deterministic: nodes are
 * sorted by (kind, id), so two runs against the same registry are identical.
 */
export async function buildNodeManifest() {
	appConsts.processMap = await loadProcesses();
	appConsts.plotMap = await loadPlots();
	appConsts.tableProcessMap = await loadTableProcesses();

	// node id -> first showcase demo session url
	const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
	const demoByNode = {};
	for (const s of idx.sessions ?? []) {
		for (const sc of s.showcases ?? []) if (!demoByNode[sc]) demoByNode[sc] = s.url;
	}

	const nodes = [];

	const pushTPorProc = (id, entry, kind) => {
		const spec = entry.nodeSpec ?? entry.definition?.nodeSpec ?? {};
		const inputs = portList(spec.inputs);
		// Params are configuration only — drop keys that are wired input ports.
		const inputNames = new Set(inputs.map((i) => i.name));
		const params = paramsFromDefaults(entry.defaults).filter((p) => !inputNames.has(p.name));
		nodes.push({
			id,
			displayName: entry.displayName ?? id,
			kind,
			family: entry.family ?? 'Other',
			description: entry.description ?? '',
			hideFromPalette: !!entry.hideFromPalette,
			inputs,
			params,
			outputs: portList(spec.outputs),
			demo: demoByNode[id] ?? null
		});
	};

	for (const [id, entry] of appConsts.tableProcessMap.entries())
		pushTPorProc(id, entry, 'tableProcess');
	for (const [id, entry] of appConsts.processMap.entries()) pushTPorProc(id, entry, 'process');

	for (const [id, entry] of appConsts.plotMap.entries()) {
		const def = entry.definition ?? {};
		nodes.push({
			id,
			displayName: entry.displayName ?? def.displayName ?? id,
			kind: 'plot',
			family: entry.family ?? 'Plots',
			description: entry.description ?? '',
			hideFromPalette: !!entry.hideFromPalette,
			inputs: (def.defaultDataInputs ?? entry.defaultInputs ?? []).map((n) => ({
				name: n,
				kind: 'column',
				cardinality: 'many'
			})),
			params: [],
			outputs: [],
			demo: demoByNode[id] ?? null
		});
	}

	nodes.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

	return {
		_comment:
			'Auto-generated from the live registry by generateNodeManifest.svelte.test.js (GEN_MANIFEST=1) / `pnpm manifest:gen`. Do not hand-edit. Consumed by the Chronobiology Handbook Node Reference.',
		generatedFromVersion: appConsts.version ?? null,
		count: nodes.length,
		nodes
	};
}
