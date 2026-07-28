// Every parameter that changes a node's result must appear in its `getHash`.
//
// WHY THIS EXISTS
//
// Each node memoises on a string hash of its inputs and recomputes when that
// string changes. A parameter left out of the hash is therefore an edit the node
// silently ignores.
//
// This was survivable by accident. `lastHash` used to be a plain component-local
// `let`, so it died whenever the component did, and switching between the
// workflow and workspace views destroys and rebuilds the whole tree. Any missed
// edit was picked up on the next view switch. The v69.2 compute memo made the
// hash outlive the component — which is the point, it is what stops the pipeline
// recomputing for nothing — and in doing so turned "stale until you switch views"
// into "stale forever".
//
// The audit that found the first batch (TrendFit ignoring `model` and
// `polyDegree`, ColumnFunctions ignoring `func`, Cosinor ignoring `fixedPeriod`)
// initially reported a clean bill of health because its extractor matched none of
// the 37 files. So this guard asserts it actually found something before it
// draws any conclusion, and treats an unrecognised parameter as a failure rather
// than skipping it — a check whose failure mode is "ignore what I don't
// understand" degrades to green silently, which is the whole reason the gap
// survived this long.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Parameters that legitimately never belong in a hash, each with its reason.
 * Anything not listed here and not in the hash is a failure.
 */
const NOT_INPUTS = {
	out: 'output column ids — written BY the compute; hashing them would re-trigger it',
	valid: 'a result flag, set by the compute',
	_fitHash: 'the memo bookkeeping itself',
	forcollected: 'layout only — whether the node renders inside CollectColumns',
	collectedType: 'layout only',
	preProcesses: 'hashed via the resolved process objects, not the raw arg',
	tableProcesses: 'child node list, not data',
	nodeLabel: 'display name',
	setRefs: 'Column Set wiring; materialised into the *IN ports, which are hashed'
};

/**
 * Parameters reachable through something else the hash already reads, with the
 * expression that covers them. Kept explicit so each is a decision on record.
 */
const COVERED_ELSEWHERE = {
	'Cosinor.outputX': 'outputX_col?.getDataHash',
	'TrendFit.outputX': 'outputX_col?.getDataHash',
	'FitFunction.outputX': 'outputX_col?.getDataHash',
	'DoubleLogistic.outputX': 'outputX_col?.getDataHash',
	'RectangularWave.outputX': 'outputX_col?.getDataHash',
	'CollectColumns.outColIds': 'the hash walks the resolved output columns',
	'WideToLong.valueColIds': 'the hash walks `valueCols`, the resolved columns',
	'ColumnFunctions.data': 'the operand columns are hashed via xIN_cols'
};

function nodeFiles() {
	return readdirSync(here)
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => ({ name: f.slice(0, -7), src: readFileSync(join(here, f), 'utf8') }));
}

function hashBody(src) {
	return src.match(/let getHash = \$derived(?:\.by)?\(\(\) => \{[\s\S]*?\n\t\}\);/)?.[0] ?? null;
}

/** Declared params look like `['name', { val: … }]` in the node's metadata. */
function declaredParams(src) {
	return [...new Set([...src.matchAll(/\[\s*'(\w+)'\s*,\s*\{/g)].map((m) => m[1]))];
}

const nodes = nodeFiles()
	.map((n) => ({ ...n, hash: hashBody(n.src), params: declaredParams(n.src) }))
	.filter((n) => n.hash && n.params.length);

describe('every node parameter is part of its memo hash', () => {
	it('the extractor actually found nodes to check', () => {
		// The first version of this audit silently matched nothing and reported a
		// clean result. Never again: if this number collapses, the guard is blind
		// and every test below it is vacuous.
		expect(nodes.length).toBeGreaterThan(20);
	});

	for (const { name, hash, params } of nodes) {
		it(`${name}: no parameter is missing from getHash`, () => {
			const missing = params.filter((p) => {
				if (NOT_INPUTS[p]) return false;
				if (COVERED_ELSEWHERE[`${name}.${p}`]) return false;
				if (p.endsWith('IN')) return false; // input ports, hashed as column data
				return !new RegExp(`p\\.args\\.${p}\\b`).test(hash);
			});
			expect(
				missing,
				`${name} declares ${JSON.stringify(missing)} but never reads them in getHash. ` +
					`Editing one would be silently ignored — the memo now outlives the component, ` +
					`so nothing will pick the change up later. Add it to getHash, or record it in ` +
					`NOT_INPUTS / COVERED_ELSEWHERE with the reason.`
			).toEqual([]);
		});
	}

	it('every exemption still refers to something real', () => {
		// An exemption for a parameter that no longer exists is dead weight that
		// would silently excuse a future parameter of the same name.
		const all = new Set(nodes.flatMap((n) => n.params.map((p) => `${n.name}.${p}`)));
		const stale = Object.keys(COVERED_ELSEWHERE).filter((k) => !all.has(k));
		expect(stale, `these exemptions name parameters that no longer exist: ${stale}`).toEqual([]);
	});
});
