// @ts-nocheck
// Actogram MARKER RULES (plan docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md).
//
// A rule is ONE plot-level definition of a marker block (onset/offset detection or a
// hand-placed line, its template, its line locks, its day range, its style) that is
// PROJECTED onto every series of the actogram as a computed block, the rule INSTANCE.
// The per-series facts (which days that series ticks, its hand-placed points) stay per
// series, in `datum.ruleData[ruleId]`. Editing an instance's settings DETACHES that series
// (it gets its own block, carrying `fromRule`); "Reattach to rule" reverses it; "Make this
// a rule for all series" PROMOTES an own block into a rule.
//
// Vocabulary and where it lives:
//   rule        MarkerRule in `actogram.markerRules`            persisted, stable id 'r<n>'
//   instance    RuleInstance in `datum.ruleInstances`           computed, never persisted
//   own block   PhaseMarkerClass in `datum.phaseMarkers`        persisted, as before
//   rule data   `datum.ruleData[ruleId] = {selectedPeriods, manualMarkers}`   persisted
//   detachment  ruleId in `datum.detachedRules`                 persisted
//
// Instances are materialised by ONE function, `reconcileRuleInstances`, called
// synchronously from the few places that change the rule list or a detachment set
// (fromJSON, addData, and the actions below). Never from an $effect or a $derived:
// RuleInstance has $derived fields, and ones created under an active reaction go inert when
// it re-runs (the derived_inert rule). A rule SETTING edit changes no array: every
// instance reads the rule through its `cfg` adapter, so only that rule's instances
// recompute, in place, and nothing remounts.
//
// The computation itself (detection, day selection, the constrained fits, the phase) is in
// the pure modules onsetUnwrap.js, markerSelection.js and lineFit.js; nothing here computes.

import { PhaseMarkerClass } from './PhaseMarker.svelte';

/** The settings a rule owns, i.e. what `setMarkerRule` may patch (never `id`). */
export const RULE_SETTING_KEYS = Object.freeze([
	'name',
	'type',
	'templateHrsBefore',
	'templateHrsAfter',
	'centileThreshold',
	'lockTau',
	'lockTheta',
	'fixedTau',
	'fixedTheta',
	'phaseRefDay',
	'lineMinDay',
	'lineMaxDay',
	'colour',
	'lineWidth',
	'markerSize',
	'showLine'
]);

const RULE_TYPES = ['onset', 'offset', 'manual'];
const RULE_ID = /^r(\d+)$/;

const finiteOr = (v, d) => (Number.isFinite(v) ? v : d);
const positiveOr = (v, d) => (Number.isFinite(v) && v > 0 ? v : d);
const dayOrNull = (v) => (Number.isFinite(v) && v >= 1 ? Math.round(v) : null);
const numOrNull = (v) => (Number.isFinite(v) ? v : null);
const lockOr = (v, d) => (v === 'fit' || v === 'fixed' ? v : d);

export class MarkerRule {
	/** Stable, persisted, never reused within the plot. Not $state: it never changes. */
	id;
	name = $state('');
	type = $state('onset');
	templateHrsBefore = $state(3);
	templateHrsAfter = $state(3);
	centileThreshold = $state(50);
	lockTau = $state('fit');
	lockTheta = $state('fit');
	// The two numbers the user fixed, in hours: tau, and theta = the hour after the row
	// start at the reference day. Read only while the matching lock is 'fixed'.
	fixedTau = $state(null);
	fixedTheta = $state(null);
	// 1-indexed; null = the range's first day (lineMinDay), else day 1.
	phaseRefDay = $state(null);
	// 1-indexed inclusive day range. For a rule it scopes the FIT and the drawn line
	// (Decision 1a); null = unbounded on that side.
	lineMinDay = $state(null);
	lineMaxDay = $state(null);
	// null = each series draws in its own colour.
	colour = $state(null);
	lineWidth = $state(1);
	markerSize = $state(5);
	showLine = $state(true);

	constructor(json = {}) {
		this.id = json.id;
		this.name = typeof json.name === 'string' ? json.name : '';
		this.type = RULE_TYPES.includes(json.type) ? json.type : 'onset';
		this.templateHrsBefore = finiteOr(json.templateHrsBefore, 3);
		this.templateHrsAfter = finiteOr(json.templateHrsAfter, 3);
		this.centileThreshold = finiteOr(json.centileThreshold, 50);
		this.lockTau = lockOr(json.lockTau, 'fit');
		this.lockTheta = lockOr(json.lockTheta, 'fit');
		this.fixedTau = positiveOr(json.fixedTau, null);
		this.fixedTheta = numOrNull(json.fixedTheta);
		this.phaseRefDay = dayOrNull(json.phaseRefDay);
		this.lineMinDay = dayOrNull(json.lineMinDay);
		this.lineMaxDay = dayOrNull(json.lineMaxDay);
		this.colour = typeof json.colour === 'string' && json.colour ? json.colour : null;
		this.lineWidth = positiveOr(json.lineWidth, 1);
		this.markerSize = positiveOr(json.markerSize, 5);
		this.showLine = json.showLine !== false;
	}

	toJSON() {
		const out = { id: this.id };
		for (const k of RULE_SETTING_KEYS) out[k] = this[k];
		return out;
	}

	/** A rule from saved JSON, or null when the shape cannot be a rule. */
	static fromJSON(json) {
		if (json == null || typeof json !== 'object' || Array.isArray(json)) return null;
		if (typeof json.id !== 'string' || !RULE_ID.test(json.id)) return null;
		return new MarkerRule(json);
	}
}

/** Numeric suffix of a rule id ('r12' -> 12), or 0. */
export function ruleIdNumber(id) {
	const m = typeof id === 'string' ? RULE_ID.exec(id) : null;
	return m ? Number(m[1]) : 0;
}

/**
 * Parse a saved `markerRules` list with a shape guard per rule: a non-object, a missing
 * or malformed id, or a duplicate id is dropped and reported.
 * @returns {{ rules: MarkerRule[], dropped: number }}
 */
export function rulesFromJSON(list) {
	if (!Array.isArray(list)) return { rules: [], dropped: 0 };
	const rules = [];
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, built and read inside this call; never reactive
	const seen = new Set();
	let dropped = 0;
	for (const j of list) {
		const r = MarkerRule.fromJSON(j);
		if (!r || seen.has(r.id)) {
			dropped++;
			continue;
		}
		seen.add(r.id);
		rules.push(r);
	}
	return { rules, dropped };
}

/** `name`, or `name (2)`, `name (3)`, ... so rule names are unique within the plot. */
export function uniqueRuleName(plot, base, exceptId = null) {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, built and read inside this call; never reactive
	const taken = new Set(
		(plot?.markerRules ?? []).filter((r) => r.id !== exceptId).map((r) => r.name)
	);
	const stem = (typeof base === 'string' && base.trim()) || 'Rule';
	if (!taken.has(stem)) return stem;
	for (let n = 2; ; n++) {
		const candidate = `${stem} (${n})`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Whether `name` is free for rule `ruleId` (renaming to a taken name is refused). */
export function isRuleNameFree(plot, name, ruleId) {
	return !(plot?.markerRules ?? []).some((r) => r.id !== ruleId && r.name === name);
}

/** Mint the next rule id ('r' + nextRuleId++). */
export function mintRuleId(plot) {
	const id = 'r' + plot.nextRuleId;
	plot.nextRuleId = plot.nextRuleId + 1;
	return id;
}

// ---------------------------------------------------------------------------
// The instance
// ---------------------------------------------------------------------------

const EMPTY_STORE = Object.freeze({
	selectedPeriods: Object.freeze([]),
	manualMarkers: Object.freeze([])
});

/** The series' rule data for `ruleId`, created on first WRITE (never from a derived). */
export function ensureRuleData(datum, ruleId) {
	if (!datum.ruleData[ruleId]) {
		datum.ruleData[ruleId] = { selectedPeriods: [], manualMarkers: [] };
	}
	return datum.ruleData[ruleId];
}

// The line fields a drag previews on an instance before it detaches (see `local`).
const LINE_KEYS = ['fitSlope', 'fitIntercept', 'lockTau', 'lockTheta'];

/**
 * The `cfg` of an instance: every setting a getter onto the rule. The fixed line is stored
 * on the rule as (fixedTau, fixedTheta); the block's computation reads the storage encoding
 * (fitSlope, fitIntercept) with intercept = theta - (tau - P) * refDay, so the adapter
 * encodes it on read (tau defaults to P when only theta is fixed, which decodes back to
 * exactly theta). `local` holds a drag's in-flight line so the finger's line moves on THIS
 * series only; pointerup rewinds it and detaches with the final values.
 */
function ruleCfg(inst) {
	const rule = inst.rule;
	const loc = (k) => inst.local != null && k in inst.local;
	const setLocal = (k, v) => {
		inst.local = { ...(inst.local ?? {}), [k]: v };
	};
	const P = () => inst.parentData.parentPlot.periodHrs;
	const cfg = {
		get name() {
			return rule.name;
		},
		get type() {
			return rule.type;
		},
		get templateHrsBefore() {
			return rule.templateHrsBefore;
		},
		get templateHrsAfter() {
			return rule.templateHrsAfter;
		},
		get centileThreshold() {
			return rule.centileThreshold;
		},
		get colour() {
			return rule.colour ?? inst.parentData.colour ?? 'black';
		},
		get showLine() {
			return rule.showLine;
		},
		get lineWidth() {
			return rule.lineWidth;
		},
		get markerSize() {
			return rule.markerSize;
		},
		get lineMinDay() {
			return rule.lineMinDay;
		},
		get lineMaxDay() {
			return rule.lineMaxDay;
		},
		get phaseRefDay() {
			return rule.phaseRefDay;
		},
		// Decision 1a: a rule's range scopes the fit.
		get fitWithinRange() {
			return true;
		},
		get fitSlope() {
			if (loc('fitSlope')) return inst.local.fitSlope;
			if (rule.fixedTau != null) return rule.fixedTau;
			return rule.fixedTheta != null ? P() : null;
		},
		get fitIntercept() {
			if (loc('fitIntercept')) return inst.local.fitIntercept;
			if (rule.fixedTheta == null) return null;
			const slope = rule.fixedTau ?? P();
			return rule.fixedTheta - (slope - P()) * inst.fitRefDay;
		},
		get lockTau() {
			return loc('lockTau') ? inst.local.lockTau : rule.lockTau;
		},
		get lockTheta() {
			return loc('lockTheta') ? inst.local.lockTheta : rule.lockTheta;
		}
	};
	// Only the drag's line fields are writable (into `local`); any other settings write on
	// an instance is a bug (it must detach first) and throws rather than vanishing.
	for (const k of LINE_KEYS) {
		const d = Object.getOwnPropertyDescriptor(cfg, k);
		Object.defineProperty(cfg, k, {
			get: d.get,
			set: (v) => {
				setLocal(k, v);
			},
			enumerable: true
		});
	}
	return cfg;
}

export class RuleInstance extends PhaseMarkerClass {
	/** @type {MarkerRule} */
	rule;
	ruleId;
	// A drag's in-flight line on this instance only (never persisted); see ruleCfg.
	local = $state(null);
	#cfg;

	constructor(datum, rule) {
		super(datum);
		this.rule = rule;
		this.ruleId = rule.id;
		this.#cfg = ruleCfg(this);
	}

	get isInstance() {
		return true;
	}
	// Settings are read through `cfg` (the rule), never through the base class's own
	// $state fields, which an instance leaves at their defaults. Composition, not accessor
	// overriding (plan 1.3): only these plain getters are overridden.
	get cfg() {
		return this.#cfg;
	}
	get store() {
		return this.parentData.ruleData?.[this.ruleId] ?? EMPTY_STORE;
	}
	writableStore() {
		return ensureRuleData(this.parentData, this.ruleId);
	}

	/** Give this series its own copy of the rule (see `detachInstance`). */
	detach() {
		return detachInstance(this);
	}
}

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

/**
 * Make every series' `ruleInstances` match `markerRules` minus its `detachedRules`, in rule
 * order. An instance whose rule object is unchanged is KEPT (same object), so a reconcile
 * that changes nothing for a series leaves its array untouched and nothing remounts.
 */
export function reconcileRuleInstances(plot) {
	const rules = plot?.markerRules ?? [];
	for (const datum of plot?.data ?? []) {
		if (!Array.isArray(datum.ruleInstances)) continue;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, built and read inside this call; never reactive
		const detached = new Set(datum.detachedRules ?? []);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, built and read inside this call; never reactive
		const byId = new Map(datum.ruleInstances.map((i) => [i.ruleId, i]));
		const next = [];
		for (const r of rules) {
			if (detached.has(r.id)) continue;
			const kept = byId.get(r.id);
			next.push(kept && kept.rule === r ? kept : new RuleInstance(datum, r));
		}
		const same =
			next.length === datum.ruleInstances.length &&
			next.every((x, i) => x === datum.ruleInstances[i]);
		if (!same) datum.ruleInstances = next;
	}
}

// ---------------------------------------------------------------------------
// Actions. Each mutates the inner in place and reconciles; the UI records it as ONE undo
// step with recordInnerEdit (a list change) or setMarkerRule (a setting).
// ---------------------------------------------------------------------------

/** Add a new onset rule with default settings; returns it. */
export function addRule(plot, init = {}) {
	const name = uniqueRuleName(plot, init.name ?? `Rule ${plot.nextRuleId}`);
	const rule = new MarkerRule({ ...init, id: mintRuleId(plot), name });
	plot.markerRules = [...plot.markerRules, rule];
	reconcileRuleInstances(plot);
	return rule;
}

/** Remove a rule, its instances and its id from every detachment set. */
export function removeRule(plot, ruleId) {
	plot.markerRules = plot.markerRules.filter((r) => r.id !== ruleId);
	for (const d of plot.data) {
		if (d.detachedRules.includes(ruleId)) {
			d.detachedRules = d.detachedRules.filter((id) => id !== ruleId);
		}
	}
	reconcileRuleInstances(plot);
}

/** The own-block JSON a detached instance becomes: the rule's settings, the series' data. */
function blockJsonFromInstance(inst) {
	const cfg = inst.cfg;
	const store = inst.store;
	return {
		name: cfg.name,
		type: cfg.type,
		centileThreshold: cfg.centileThreshold,
		templateHrsBefore: cfg.templateHrsBefore,
		templateHrsAfter: cfg.templateHrsAfter,
		colour: cfg.colour,
		showLine: cfg.showLine,
		showMarkers: true,
		lineWidth: cfg.lineWidth,
		markerSize: cfg.markerSize,
		lineMinDay: cfg.lineMinDay,
		lineMaxDay: cfg.lineMaxDay,
		phaseRefDay: cfg.phaseRefDay,
		selectedPeriods: [...(store.selectedPeriods ?? [])],
		manualMarkers: [...(store.manualMarkers ?? [])],
		fitSlope: cfg.fitSlope,
		fitIntercept: cfg.fitIntercept,
		lockTau: cfg.lockTau,
		lockTheta: cfg.lockTheta,
		fitWithinRange: true,
		fromRule: inst.ruleId
	};
}

/**
 * Detach one series from a rule: an own block built from the instance (every setting from
 * the rule, the series' ticks and points, `fitWithinRange` so it computes what the instance
 * did, `fromRule`), inserted at the head of the series' blocks. `ruleData` is kept, so a
 * reattach or an undo finds the per-day choices where they were.
 * @returns {PhaseMarkerClass} the new own block
 */
export function detachInstance(inst) {
	const datum = inst.parentData;
	const plot = datum.parentPlot;
	const block = PhaseMarkerClass.fromJSON(blockJsonFromInstance(inst), datum);
	datum.phaseMarkers = [block, ...datum.phaseMarkers];
	if (!datum.detachedRules.includes(inst.ruleId)) {
		datum.detachedRules = [...datum.detachedRules, inst.ruleId];
	}
	reconcileRuleInstances(plot);
	return block;
}

/** Whether `block` can be reattached: it came from a rule that still exists. */
export function canReattach(block) {
	const plot = block?.parentData?.parentPlot;
	return !!block?.fromRule && !!plot?.markerRules?.some((r) => r.id === block.fromRule);
}

/**
 * Reattach a detached block to its rule: its per-day ticks (and, on a line-only rule, its
 * hand-placed points) go back into the series' ruleData; its settings are discarded.
 * @returns {boolean} false when the rule is gone
 */
export function reattachBlock(block) {
	if (!canReattach(block)) return false;
	const datum = block.parentData;
	const plot = datum.parentPlot;
	const rule = plot.markerRules.find((r) => r.id === block.fromRule);
	datum.ruleData[rule.id] = {
		selectedPeriods: [...block.selectedPeriods],
		manualMarkers: rule.type === 'manual' ? [...block.manualMarkers] : []
	};
	datum.phaseMarkers = datum.phaseMarkers.filter((m) => m !== block);
	datum.detachedRules = datum.detachedRules.filter((id) => id !== rule.id);
	reconcileRuleInstances(plot);
	return true;
}

/** The settings of an own block that a rule carries (for promote and for matching). */
function ruleSettingsFromBlock(block) {
	return {
		type: block.type,
		templateHrsBefore: block.templateHrsBefore,
		templateHrsAfter: block.templateHrsAfter,
		centileThreshold: block.centileThreshold,
		lockTau: block.lockTau,
		lockTheta: block.lockTheta,
		fixedTau: block.lockTau === 'fixed' ? block.tauValue : null,
		fixedTheta: block.lockTheta === 'fixed' ? block.thetaValue : null,
		phaseRefDay: block.phaseRefDay,
		lineMinDay: block.lineMinDay,
		lineMaxDay: block.lineMaxDay,
		lineWidth: block.lineWidth,
		markerSize: block.markerSize,
		showLine: block.showLine
	};
}

// Settings compared when looking for "the same block" on other series (data ignored).
const MATCH_KEYS = [
	'type',
	'templateHrsBefore',
	'templateHrsAfter',
	'centileThreshold',
	'lockTau',
	'lockTheta',
	'phaseRefDay',
	'lineMinDay',
	'lineMaxDay'
];

/** Own blocks on OTHER series whose settings equal `block`'s (plan 5.1). */
export function matchingBlocks(block) {
	const plot = block.parentData.parentPlot;
	const out = [];
	for (const d of plot.data) {
		if (d === block.parentData) continue;
		for (const m of d.phaseMarkers) {
			if (m.fromRule) continue;
			if (!MATCH_KEYS.every((k) => m[k] === block[k])) continue;
			if (block.lockTau === 'fixed' && m.tauValue !== block.tauValue) continue;
			if (block.lockTheta === 'fixed' && m.thetaValue !== block.thetaValue) continue;
			out.push(m);
			break;
		}
	}
	return out;
}

/**
 * Promote an own block into a rule for every series. The block's settings become the rule
 * (its colour only if the user changed it from the series colour; otherwise each series
 * keeps its own), its per-day data becomes the series' ruleData, and the block is removed.
 * `alsoReplace` (blocks from `matchingBlocks`) are removed too, seeding their series'
 * ruleData from them. Returns the rule.
 */
export function promoteBlock(block, { alsoReplace = [] } = {}) {
	const datum = block.parentData;
	const plot = datum.parentPlot;
	const settings = ruleSettingsFromBlock(block);
	const colour = block.colour && block.colour !== datum.colour ? block.colour : null;
	const rule = new MarkerRule({
		...settings,
		colour,
		id: mintRuleId(plot),
		name: uniqueRuleName(plot, block.name)
	});
	plot.markerRules = [...plot.markerRules, rule];
	for (const b of [block, ...alsoReplace]) {
		const d = b.parentData;
		d.ruleData[rule.id] = {
			selectedPeriods: [...b.selectedPeriods],
			manualMarkers: rule.type === 'manual' ? [...b.manualMarkers] : []
		};
		d.phaseMarkers = d.phaseMarkers.filter((m) => m !== b);
	}
	reconcileRuleInstances(plot);
	return rule;
}

/** Median of the finite values, or null. */
export function medianOf(values) {
	const v = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (v.length === 0) return null;
	const m = Math.floor(v.length / 2);
	return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** The instances of rule `ruleId` across the plot's series, in series order. */
export function instancesOf(plot, ruleId) {
	const out = [];
	for (const d of plot?.data ?? []) {
		const inst = d.ruleInstances?.find((i) => i.ruleId === ruleId);
		if (inst) out.push(inst);
	}
	return out;
}

/**
 * The value to seed when a rule lock flips to Fixed (plan Q4): the MEDIAN of the drawn
 * values over its instances (a rule has no single line to pin; the median is robust to
 * one bad animal), falling back to P for tau and P / 2 for theta.
 */
export function seedFixedValue(plot, rule, key) {
	const P = plot.periodHrs;
	const vals = instancesOf(plot, rule.id).map((inst) => {
		const reg = inst.linearRegression;
		if (!reg || typeof reg !== 'object') return NaN;
		return key === 'tau' ? reg.slope : (reg.slope - P) * inst.fitRefDay + reg.intercept;
	});
	return medianOf(vals) ?? (key === 'tau' ? P : P / 2);
}

/**
 * The line as drawn: its fitted slope (`tau` here is the SLOPE, not the port's τ; the
 * rule's τ output is the harmonic check's pick, see tauReadout.js), the phase, the fit
 * statistics and n. Reads the regression and the phase only, never the harmonic check or
 * the warnings periodogram (plan section 8).
 */
export function instanceSummary(inst) {
	const reg = inst.linearRegression;
	const ok = reg && typeof reg === 'object';
	return {
		tau: ok && Number.isFinite(reg.slope) ? reg.slope : NaN,
		phi: inst.estimatedPhase?.phase ?? NaN,
		r2: ok ? (reg.rSquared ?? NaN) : NaN,
		rmse: ok ? (reg.rmse ?? NaN) : NaN,
		n: inst.fitPoints.xs.length
	};
}
