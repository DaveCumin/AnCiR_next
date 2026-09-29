// @ts-nocheck
// Stored values that came from an actogram marker block (plan
// docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md, section 5.2).
//
// Until Phase B every marker block (and, in Phase A, every rule instance) mounted four
// StoreValueButtons: `tau_<name>`, `phi_<name>`, `marker_r_squared_<name>` and
// `marker_rmse_<name>`, with source `Actogram phase marker (<name>)`. Those buttons are gone;
// a rule's values are now OUTPUT PORTS (`r<id>_tau` ...), one value per series. A saved
// session still carries the old entries, as static snapshots.
//
// Opening a block's controls REGISTERED its four values (nobody pressed anything), so the
// presence of an entry says nothing about whether it was used: the shipped fixture
// facet-actogram-markers.json carries eight, none referenced. The migration therefore keys
// on USE, i.e. on a consumer naming the value: a FormulaColumn `{ type: 'stored', key }`
// token, a BlankColumn `storedValueRefs` value, or a StoredValueGroup `groups[].keys` entry.
//
//   used, and the name belongs to a marker RULE (a rule instance's button used the rule's
//        name; a block detached from a live rule keeps the rule's name): the entry becomes a
//        live plot ref { plotId, outKey: '<ruleId>_<tau|phi|r2|rmse>', index: series }, so
//        the consumer reads the rule's output column. Its saved number stays as the
//        fallback. (Decision 2b: the tau port IS the harmonic pick the old tau_ held, so the
//        value keeps its meaning.)
//   used, anything else (an own block with no rule, i.e. every session saved before rules):
//        kept as its saved number, and reported once per actogram through the warnings
//        channel, with the way to make it live again ("Make rule", then the ports).
//   unused: dropped, with one console line.
//
// Pure (JSON in, JSON out, no app state), run by importJson before anything is built.

/** Legacy name prefix -> the rule output it maps to. Longest first, so matching is exact. */
export const LEGACY_PREFIXES = Object.freeze([
	['marker_r_squared_', 'r2'],
	['marker_rmse_', 'rmse'],
	['tau_', 'tau'],
	['phi_', 'phi']
]);

export const LEGACY_SOURCE_PREFIX = 'Actogram phase marker';

/** The source string a legacy block's buttons wrote for block/rule `name`. */
export function legacySource(name) {
	return `${LEGACY_SOURCE_PREFIX} (${name})`;
}

/** `{ stat, stem }` for a legacy stored-value name ('phi_Onsets' -> phi, 'Onsets'), or null. */
export function parseLegacyName(name) {
	if (typeof name !== 'string') return null;
	for (const [prefix, stat] of LEGACY_PREFIXES) {
		if (name.startsWith(prefix) && name.length > prefix.length) {
			return { stat, stem: name.slice(prefix.length) };
		}
	}
	return null;
}

/** Whether a stored-value entry is a legacy marker-block value (a static snapshot, no ref). */
export function isLegacyMarkerEntry(entry) {
	return (
		entry != null &&
		typeof entry === 'object' &&
		!entry.ref &&
		typeof entry.source === 'string' &&
		entry.source.startsWith(LEGACY_SOURCE_PREFIX)
	);
}

/** Every stored-value name a consumer in `tableProcesses` references. */
export function referencedStoredValueNames(tableProcesses) {
	const used = new Set();
	for (const tp of Array.isArray(tableProcesses) ? tableProcesses : []) {
		const args = tp?.args;
		if (!args || typeof args !== 'object') continue;
		if (Array.isArray(args.tokens)) {
			for (const t of args.tokens)
				if (t?.type === 'stored' && typeof t.key === 'string') used.add(t.key);
		}
		if (args.storedValueRefs && typeof args.storedValueRefs === 'object') {
			for (const key of Object.values(args.storedValueRefs))
				if (typeof key === 'string') used.add(key);
		}
		if (Array.isArray(args.groups)) {
			for (const g of args.groups) {
				for (const key of Array.isArray(g?.keys) ? g.keys : [])
					if (typeof key === 'string') used.add(key);
			}
		}
	}
	return used;
}

/**
 * The rule targets a legacy stem names on one actogram's saved inner: in Data-tab order
 * (series by series; a series' rule instances, then its own blocks), every place a button
 * with that stem was mounted for a LIVE rule. A rule named `stem` projects onto every series
 * not detached from it; a block named `stem` whose `fromRule` is live fills its rule's cell on
 * its series. Returns [{ ruleId, index }].
 */
function ruleTargets(inner, stem) {
	const rules = Array.isArray(inner?.markerRules) ? inner.markerRules : [];
	const live = new Map(rules.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
	const out = [];
	(Array.isArray(inner?.data) ? inner.data : []).forEach((d, index) => {
		const detached = Array.isArray(d?.detachedRules) ? d.detachedRules : [];
		for (const r of rules) {
			if (r?.name === stem && live.has(r.id) && !detached.includes(r.id)) {
				out.push({ ruleId: r.id, index });
			}
		}
		for (const b of Array.isArray(d?.phaseMarkers) ? d.phaseMarkers : []) {
			if (b?.name === stem && live.has(b.fromRule)) out.push({ ruleId: b.fromRule, index });
		}
	});
	return out;
}

/** Whether any series of `inner` carries an own block (no live rule) named `stem`. */
function hasOwnBlockNamed(inner, stem) {
	const live = new Set((inner?.markerRules ?? []).map((r) => r?.id));
	return (Array.isArray(inner?.data) ? inner.data : []).some((d) =>
		(d?.phaseMarkers ?? []).some((b) => b?.name === stem && !live.has(b.fromRule))
	);
}

/**
 * Resolve one used legacy name to a rule cell. StoreValueButton suffixed a colliding name
 * `_2`, `_3`, ... in mount order, and every instance of a rule mounted the SAME default
 * name, so `tau_Onsets` is the first mounted cell, `tau_Onsets_2` the second, and so on, in
 * Data-tab order. An exact stem is tried first, so a rule genuinely named 'Rule_2' wins.
 */
function resolveRuleCell(plots, stat, stem) {
	const tries = [{ stem, k: 1 }];
	const m = /^(.*)_(\d+)$/.exec(stem);
	if (m && Number(m[2]) >= 2) tries.push({ stem: m[1], k: Number(m[2]) });
	for (const t of tries) {
		for (const p of plots) {
			const targets = ruleTargets(p.plot, t.stem);
			const cell = targets[t.k - 1];
			if (cell) return { plotId: p.id, outKey: `${cell.ruleId}_${stat}`, index: cell.index };
		}
	}
	return null;
}

/**
 * @param {object} json a saved session (not mutated)
 * @returns {{ json: object, warnings: string[], mapped: string[], kept: string[], dropped: string[] }}
 */
export function migratePhaseMarkerStoredValues(json) {
	const empty = { json, warnings: [], mapped: [], kept: [], dropped: [] };
	const sv = json?.storedValues;
	if (!sv || typeof sv !== 'object') return empty;
	const legacy = Object.keys(sv).filter(
		(name) => isLegacyMarkerEntry(sv[name]) && parseLegacyName(name)
	);
	if (legacy.length === 0) return empty;

	const used = referencedStoredValueNames(json.tableProcesses);
	const actograms = (Array.isArray(json.plots) ? json.plots : []).filter(
		(p) => p?.type === 'actogram' && p.plot && typeof p.plot === 'object'
	);
	const storedValues = { ...sv };
	const mapped = [];
	const kept = [];
	const dropped = [];
	// Kept names grouped by the actogram whose block they came from (one warning each).
	const keptBy = new Map();

	for (const name of legacy) {
		if (!used.has(name)) {
			delete storedValues[name];
			dropped.push(name);
			continue;
		}
		const { stat, stem } = parseLegacyName(name);
		const ref = resolveRuleCell(actograms, stat, stem);
		if (ref) {
			storedValues[name] = { ...sv[name], ref };
			mapped.push(name);
			continue;
		}
		kept.push(name);
		const owner = actograms.find((p) => hasOwnBlockNamed(p.plot, stem));
		const label = owner ? `actogram "${owner.name ?? owner.id}"` : 'an actogram';
		if (!keptBy.has(label)) keptBy.set(label, []);
		keptBy.get(label).push(name);
	}

	const warnings = [...keptBy].map(
		([label, names]) =>
			`Stored value${names.length === 1 ? '' : 's'} ${names.join(', ')} from ${label} ` +
			`${names.length === 1 ? 'is' : 'are'} now fixed at ${names.length === 1 ? 'its' : 'their'} saved ` +
			`number${names.length === 1 ? '' : 's'}: marker blocks no longer publish stored values. ` +
			`To keep ${names.length === 1 ? 'it' : 'them'} live, use "Make rule" on that block and wire ` +
			`the rule's τ, φ, R² or RMSE output instead.`
	);
	if (dropped.length > 0) {
		console.info(
			`Dropped ${dropped.length} unused actogram marker stored value${dropped.length === 1 ? '' : 's'} ` +
				`(${dropped.join(', ')}); marker rules publish output ports instead.`
		);
	}
	return { json: { ...json, storedValues }, warnings, mapped, kept, dropped };
}

/**
 * The stored-value ops that re-point a PROMOTED block's legacy values at its new rule's
 * output column (plan 5.2 step 3: "Make rule" makes them live again). `blocks` are
 * [{ name, index }] (the promoted block and any matching blocks it replaced), `storedValues`
 * is `core.storedValues`. Only legacy static entries named exactly `<prefix><name>` with the
 * legacy source are re-pointed; their saved number stays as the fallback.
 */
export function promoteStoredValueOps(storedValues, blocks, { plotId, ruleId, ruleName }) {
	const ops = [];
	for (const { name, index } of blocks) {
		for (const [prefix, stat] of LEGACY_PREFIXES) {
			const key = `${prefix}${name}`;
			const entry = storedValues?.[key];
			if (!isLegacyMarkerEntry(entry) || entry.source !== legacySource(name)) continue;
			ops.push({
				kind: 'setStoredValue',
				name: key,
				entry: {
					source: `Actogram marker rule (${ruleName})`,
					ref: { plotId, outKey: `${ruleId}_${stat}`, index },
					...(entry.staticValue !== undefined ? { staticValue: entry.staticValue } : {})
				}
			});
		}
	}
	return ops;
}
