// gen-schema.js — regenerate the normalizer's node schema FROM THE LIVE REGISTRY.
//
//   vite-node src/emit/gen-schema.js
//
// Writes src/emit/session-schema.generated.json: for every table process, the
// structural facts the normalizer needs, read from the source of truth so they can't
// drift:
//   - inputs   : {scalar, array} column-id fields (which args are column references)
//   - params   : default parameter values (to fill omitted params)
//   - fixedOut : the node's fixed output keys, taken verbatim from its `out` template
//                (this is what a hand-authored schema gets wrong — e.g. Cosinor's
//                `cosinorx` was missed, silently breaking the fit; ADR 2026-07-15)
//   - perYPrefix : the per-Y output-key prefix (entry.yOutKeyPrefix), or null — the
//                  normalizer expands it to `${prefix}${yid}` for each selected Y
//
// Semantic validators and generator baking stay in code (schema.js) — they are logic,
// not registry facts. Run this whenever the AnCiR node registry changes.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureDom } from '../engine/bootstrapDom.js';
import { OUTPUT_NOTES } from './dynamicOut.js';
import { USAGE_NOTES } from './generators.js';

await ensureDom();
const { ensureRegistry } = await import('../engine/session.js');
await ensureRegistry();
const { appConsts } = await import('$lib/core/core.svelte.js');
const { getOutputKeys: rhythmicityOutputKeys } = await import(
	'$lib/tableProcesses/RhythmicityAnalysis.svelte'
);

/**
 * Nodes whose per-Y keys are `${yid}_${suffix}` with a suffix set that is a pure function
 * of a few DISCRETE params. We don't re-implement the rule — we call the node's own
 * exported key helper for every combination of the discriminators and bake the result, so
 * the suffixes can't drift. An arg combination we didn't enumerate simply isn't in the
 * table, and the normalizer degrades to a warning rather than emitting wrong keys.
 *
 * Only DISCRETE discriminators can be baked. MovingAnalysis is deliberately absent: its
 * getStatKeys() is parametric (analysis:'cosinor' derives keys from nHarmonics/Ncurves,
 * e.g. H1_amplitude / C2_period), so no finite table can express it — it stays 'runtime'.
 */
const SUFFIX_RULES = {
	RhythmicityAnalysis: {
		helper: rhythmicityOutputKeys,
		// domains per the component's own select options + defaults comments
		domains: {
			analysis: ['periodogram', 'fft', 'correlogram'],
			pgMethod: ['Lomb-Scargle', 'Chi-squared', 'Enright']
		}
	}
};

/** Cartesian product of the discriminator domains → [{analysis, pgMethod}, …]. */
function combos(domains) {
	const keys = Object.keys(domains);
	return keys.reduce(
		(acc, k) => acc.flatMap((base) => domains[k].map((v) => ({ ...base, [k]: v }))),
		[{}]
	);
}

// Arg keys that are wiring/bookkeeping, never user-facing params (mirrors the engine's
// describeCapabilities()). Input-column fields are also excluded from params below.
const STRUCTURAL = new Set([
	'out',
	'valid',
	'forcollected',
	'collectedType',
	'preProcesses',
	'tableProcesses',
	'outColIds',
	'storedValueRefs',
	'aggregates'
]);

const unwrap = (v) => (v && typeof v === 'object' && 'val' in v ? v.val : v);

/**
 * Registry defaults that are "now" or "random" by nature: SimulatedData/Random seed a PRNG from
 * entropy, and SimulatedData/SequenceColumn default their start/end to the current clock.
 *
 * Their VALUE tells the model nothing — it supplies its own, and the normalizer overrides
 * startTime anyway (PARAM_OVERRIDES in schema.js) so an emitted session is reproducible. But a
 * fresh value on every run makes this GENERATED, TRACKED file churn on every `npm run build`,
 * and two people regenerating would conflict over noise. A generated artifact has to be a pure
 * function of its inputs, or nobody can tell a real change from a timestamp.
 *
 * Stabilised to fixed placeholders: the key and its type survive (which is all the catalogue
 * teaches), the entropy doesn't.
 */
const VOLATILE_DEFAULTS = {
	seed: 0, // normalizeSeed maps 0 → a fixed seed; never entropy
	startTime: 0,
	endTime: 0
};

/** Deep-copy a default, replacing volatile leaves with their placeholder. */
function stabilise(value, key) {
	if (key in VOLATILE_DEFAULTS && (typeof value === 'number' || value == null)) {
		return VOLATILE_DEFAULTS[key];
	}
	if (Array.isArray(value)) return value.map((v) => stabilise(v));
	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stabilise(v, k)]));
	}
	return value;
}

// Nodes whose per-Y output keys are NOT a simple `${prefix}${yid}` — they come from the
// engine's synthesizeDynamicOut() (method/segment/category-dependent, e.g. `${yid}_period`
// for RhythmicityAnalysis, per-segment for Split, per-category for LongToWide). Their
// `yOutKeyPrefix` is the collected-mode prefix, which does NOT match the standalone keys,
// so emitting it would create a broken session. Mark them 'runtime' and let the normalizer
// skip dynamic pre-allocation (with a warning) until a code-side rule is ported. Keep this
// list in sync with the switch in src/engine/session.js:synthesizeDynamicOut().
const RUNTIME_DYNAMIC = new Set([
	'RhythmicityAnalysis',
	'MovingAnalysis',
	'Split',
	'CollectColumns',
	'StoredValueGroup',
	'Duplicate',
	'LongToWide'
]);

const schema = {};
for (const [name, entry] of appConsts.tableProcessMap ?? new Map()) {
	const cif = entry.columnIdFields ?? {};
	const scalar = cif.scalar ?? [];
	const array = cif.array ?? [];
	const inputFields = new Set([...scalar, ...array]);

	const params = {};
	for (const [k, v] of entry.defaults ?? new Map()) {
		if (STRUCTURAL.has(k) || inputFields.has(k)) continue;
		params[k] = stabilise(unwrap(v), k);
	}

	// Fixed output keys come straight from the `out` template — the authoritative list.
	const outTemplate = entry.defaults?.get?.('out');
	const fixedOut = outTemplate ? Object.keys(outTemplate) : [];

	// dynamicKind:
	//   'fixed'   — no per-Y outputs
	//   'prefix'  — per-Y `${prefix}${yid}`
	//   'suffix'  — per-Y `${yid}_${suffix}`, suffixes looked up by discrete discriminators
	//   'runtime' — keys depend on data or unbounded params; not statically knowable
	const rule = SUFFIX_RULES[name];
	let dynamicKind, suffixesBy = null, discriminators = null;
	if (rule) {
		dynamicKind = 'suffix';
		discriminators = Object.keys(rule.domains);
		suffixesBy = {};
		for (const combo of combos(rule.domains)) {
			// Call the node's OWN exported helper — never a re-implementation.
			const keys = rule.helper({ ...params, ...combo });
			if (Array.isArray(keys) && keys.length)
				suffixesBy[discriminators.map((d) => combo[d]).join('|')] = keys;
		}
	} else if (RUNTIME_DYNAMIC.has(name)) {
		dynamicKind = 'runtime';
	} else {
		dynamicKind = entry.yOutKeyPrefix ? 'prefix' : 'fixed';
	}

	schema[name] = {
		displayName: entry.displayName ?? name,
		family: entry.family ?? 'Other',
		inputs: { scalar, array },
		params,
		fixedOut,
		dynamicKind,
		// Per-Y prefix for dynamicKind==='prefix' (e.g. cosinory_, binnedy_); null otherwise.
		perYPrefix: dynamicKind === 'prefix' ? entry.yOutKeyPrefix : null,
		// A node that declares BOTH of these produces a fitted curve: `${xOutKey}` is its X
		// grid and `${yOutKeyPrefix}${yid}` the fitted Y. They must be plotted as a PAIR —
		// pairing the fit's X against the raw Y (or vice versa) is a silent mistake. Used to
		// teach the model the canonical "raw points + fit line" plot (worker/draftPrompt.js);
		// it's the same wiring AnCiR's own Quick-Plot uses (plots/canonicalNodeViz.js tpViz).
		//
		// Gated on dynamicKind for the SAME reason perYPrefix is, three lines up: a suffix/
		// runtime node's `yOutKeyPrefix` is its COLLECTED-mode prefix and names nothing that
		// exists standalone. Ungated, this told the model RhythmicityAnalysis had a
		// `rhythmicityx` / `rhythmicityy_<Y>` curve; it has neither, so every plot built on
		// that advice referenced columns that were never created.
		fitOut: dynamicKind === 'prefix' && entry.xOutKey && entry.yOutKeyPrefix
			? { x: entry.xOutKey, yPrefix: entry.yOutKeyPrefix }
			: null,
		// For dynamicKind==='suffix': which args select the suffix set, and the baked table.
		...(discriminators ? { discriminators, suffixesBy } : {}),
		// For dynamicKind==='runtime': the RULE for its output names, since no static list can
		// express them. Stated in the model's vocabulary (see OUTPUT_NOTES); without it these
		// nodes advertise nothing and anything downstream of them is unpromptable.
		...(OUTPUT_NOTES[name] ? { outputNote: OUTPUT_NOTES[name] } : {}),
		// How to DRIVE the node, where its params don't speak for themselves (see USAGE_NOTES).
		// A default value is not a description: printing `distribution:"uniform"` never told a
		// model that "gaussian" exists, so a request needing it was unreachable by prompt.
		...(USAGE_NOTES[name] ? { usageNote: USAGE_NOTES[name] } : {})
	};
}

// Plots: the registry's `defaultInputs` are the series field names per plot type
// (scatterplot → [x,y]; actogram/periodogram → [time,values]; histogram → [column]; …).
// The normalizer emits one series `{ field: { refId } }` per field — the same minimal
// inner shape Quick-Plot uses (plots/canonicalNodeViz.js plotDataFromSpec), which each
// plot class's fromJSON is explicitly tested to accept without clobbering its defaults
// (plots/plotFromJSONRobustness.test.js). tableplot is special-cased (columnRefs/showCol).
const plots = {};
for (const [id, entry] of appConsts.plotMap ?? new Map()) {
	plots[id] = {
		displayName: entry.displayName ?? id,
		inputs: entry.defaultInputs ?? [],
		// Can this plot shade a repeating time-of-day window (a light/dark cycle)? Asked of the
		// class, so a plot that gains bands is advertised without anyone editing a list.
		supportsBands: typeof entry.data?.prototype?.addNightBand === 'function'
	};
}

const out = {
	_comment:
		'AUTO-GENERATED by src/emit/gen-schema.js from the AnCiR registry. Do not hand-edit. ' +
		'Consumed by src/emit/schema.js (which adds code-side validators + generators).',
	generatedFromVersion: appConsts.version ?? 'unknown',
	count: Object.keys(schema).length,
	nodes: schema,
	plots
};

const target = fileURLToPath(new URL('./session-schema.generated.json', import.meta.url));
writeFileSync(target, JSON.stringify(out, null, '\t') + '\n');
console.log(`Wrote ${out.count} node schemas → ${target}`);
// Spot-check the node that motivated this: Cosinor MUST carry cosinorx in fixedOut.
const cos = schema.Cosinor;
if (cos) {
	console.log(
		`Cosinor: fixedOut=[${cos.fixedOut.join(', ')}] perYPrefix=${cos.perYPrefix}`
	);
	if (!cos.fixedOut.includes('cosinorx'))
		console.warn('WARNING: Cosinor.fixedOut is missing cosinorx — the fit will not compute!');
}
