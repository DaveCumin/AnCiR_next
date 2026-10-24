// Reflection-driven schema for the multi-select control panel.
//
// `getSharedSchema(plot)` walks the keys returned by `plot.plot.toJSON()` and
// emits a flat list of FieldDescriptor objects (path/label/input/group/...).
// Each plot class supplies a tiny `static descriptors` override map for the
// UI metadata reflection can't infer (custom labels, groupings, option lists and
// their labels, step sizes, a lowest allowed value as `min`). Descriptors can also `skip: true` a field that shouldn't appear.

export const WRAPPER_FIELDS = [
	{ path: 'width', label: 'Width', input: 'number', group: 'Dimension' },
	{ path: 'height', label: 'Height', input: 'number', group: 'Dimension' }
];

// Top-level keys that always belong to other UIs and never appear in shared props.
const TOP_LEVEL_SKIP = new Set(['data', 'annotations', 'parentBox']);

/**
 * A field's label from its key, in sentence case: `yLogScaleLeft` -> "Y log scale left",
 * `showCOI` -> "Show COI", `xlimsIN` -> "Xlims". Later words are lower case except a single
 * letter (an axis, X or Y) or an acronym. It used to title-case every word ("Y Log Scale Left").
 */
export function keyLabel(key) {
	const stripped = String(key).endsWith('IN') ? String(key).slice(0, -2) : String(key);
	const words = stripped
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	return words
		.map((w, i) => {
			if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
			return /^[A-Z]+$/.test(w) ? w : w.toLowerCase();
		})
		.join(' ');
}

/**
 * A label as it reads INSIDE a sentence or after another label: its first letter lower case,
 * unless its first word is a single letter or an acronym ("Colour" -> "colour", "X log scale"
 * stays, "DPI" stays).
 */
export function lowerLead(label) {
	const c = String(label ?? '');
	const first = c.split(/\s+/)[0] ?? '';
	const keep = /^[A-Z]$/.test(first) || /^[A-Z][A-Z0-9²]+s?$/.test(first);
	return keep ? c : c.charAt(0).toLowerCase() + c.slice(1);
}

/**
 * A parent label and a child's, read as one sentence-case label: "X axis" + "Colour" ->
 * "X axis colour", "Padding" + "Top" -> "Padding top", "Line" + "X" -> "Line X".
 */
export function joinLabel(parent, child) {
	return `${parent} ${lowerLead(child)}`.trim();
}

function isClassInstance(v) {
	return v != null && typeof v === 'object' && typeof v.toJSON === 'function';
}

function isPlainObjectOfPrimitives(v) {
	if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
	if (isClassInstance(v)) return false;
	return Object.values(v).every((leaf) => leaf == null || typeof leaf !== 'object');
}

function isArrayOfPrimitives(v) {
	return Array.isArray(v) && v.every((leaf) => leaf == null || typeof leaf !== 'object');
}

function inferInput(v) {
	if (typeof v === 'number') return 'number';
	if (typeof v === 'boolean') return 'boolean';
	return 'text';
}

function buildScalarField(path, value, defaultLabel, defaultGroup, parentOverride, childOverride) {
	const merged = { ...parentOverride, ...childOverride };
	if (merged.skip) return null;
	const out = {
		path,
		label: merged.label ?? defaultLabel,
		input: merged.input ?? inferInput(value)
	};
	if (merged.options) out.options = merged.options;
	// Plain words for each option, shown in place of the saved value (same order as `options`).
	if (merged.optionLabels) out.optionLabels = merged.optionLabels;
	const group = merged.group ?? defaultGroup;
	if (group) out.group = group;
	if (merged.step != null) out.step = merged.step;
	if (merged.min != null) out.min = merged.min;
	return out;
}

function fieldsForKey(key, value, descriptors, pathPrefix) {
	const desc = descriptors?.[key] ?? {};
	if (desc.skip) return [];

	const parentLabel = desc.label ?? keyLabel(key);
	const parentGroup = desc.group;

	if (isClassInstance(value)) {
		// By default a sub-class instance (an Axis, a Column, …) is opaque. Two ways to opt a
		// *style* sub-object in, so its scalar leaves — colour, marker shape, gridlines — surface
		// in the shared-options UI (and to the AI editor, which reads the same schema):
		//   1. the PARENT descriptor says `descend: true` (e.g. a plot's axes, addressed once);
		//   2. the CLASS itself declares `static sharedStyle = true`.
		// (2) is for style objects reused across many plots — LineClass, PointsClass. Marking the
		// class once means EVERY plot that uses it (and every future one) exposes its colour,
		// instead of each plot's data descriptor having to remember `line: {descend:true}`. Only
		// Scatterplot ever remembered, so a periodogram/FFT/correlogram/meansem series offered NO
		// colour at all — the panel couldn't change it and the AI, shown nothing settable, guessed
		// `plot.data[0].colour` and was rejected. Column (x/y wiring) sets no flag and stays opaque.
		if (!desc.descend && !value.constructor?.sharedStyle) return [];
		const snapshot = typeof value.toJSON === 'function' ? value.toJSON() : {};
		const childDescriptors = desc._children ?? value.constructor?.descriptors ?? {};
		const groupForChildren = parentGroup ?? parentLabel;
		const out = [];
		for (const leafKey of Object.keys(snapshot)) {
			const leafVal = value[leafKey];
			// Only scalar leaves; don't recurse further into nested objects, arrays
			// or class instances (keeps the descent to a single, predictable level).
			if (leafVal != null && typeof leafVal === 'object') continue;
			const { label: cdLabel, ...cdRest } = childDescriptors[leafKey] ?? {};
			if (cdRest.skip) continue;
			const field = buildScalarField(
				`${pathPrefix}${key}.${leafKey}`,
				leafVal,
				joinLabel(parentLabel, cdLabel ?? keyLabel(leafKey)),
				cdRest.group ?? groupForChildren,
				{},
				cdRest
			);
			if (field) out.push(field);
		}
		return out;
	}
	if (value === null || value === undefined) return [];

	if (isPlainObjectOfPrimitives(value)) {
		const groupForChildren = parentGroup ?? parentLabel;
		const children = desc._children ?? {};
		const out = [];
		for (const [leafKey, leafVal] of Object.entries(value)) {
			const field = buildScalarField(
				`${pathPrefix}${key}.${leafKey}`,
				leafVal,
				keyLabel(leafKey),
				groupForChildren,
				{},
				children[leafKey] ?? {}
			);
			if (field) out.push(field);
		}
		return out;
	}

	if (isArrayOfPrimitives(value)) {
		const groupForChildren = parentGroup ?? parentLabel;
		const children = desc._children ?? {};
		// An axis limit pair (xlimsIN, ylimsLeftIN, periodlimsIN, ...) holds numbers, but an
		// automatic limit is null, and a null infers a TEXT box, which then wrote the typed
		// "7" as a string. Name the input for every element.
		const elementInput = /limsIN$/.test(key) ? { input: 'number' } : {};
		const out = [];
		value.forEach((leafVal, i) => {
			const field = buildScalarField(
				`${pathPrefix}${key}[${i}]`,
				leafVal,
				`${parentLabel} [${i}]`,
				groupForChildren,
				elementInput,
				children[i] ?? {}
			);
			if (field) out.push(field);
		});
		return out;
	}

	if (Array.isArray(value)) {
		// array of objects — these are per-row data, not shared properties.
		return [];
	}

	const scalar = buildScalarField(`${pathPrefix}${key}`, value, parentLabel, undefined, desc, {});
	return scalar ? [scalar] : [];
}

function walkToJSON(source, descriptors, pathPrefix, topLevelSkip) {
	if (source == null || typeof source.toJSON !== 'function') return [];
	const snapshot = source.toJSON();
	const out = [];
	// Use toJSON() keys as the writable allowlist, but check the live source[key]
	// for type — toJSON often serialises sub-classes to plain objects (e.g.
	// xAxis: this.xAxis.toJSON()), which would otherwise be mis-classified as
	// "plain object of primitives" and incorrectly expanded.
	for (const key of Object.keys(snapshot)) {
		if (topLevelSkip?.has(key)) continue;
		const liveValue = source[key];
		out.push(...fieldsForKey(key, liveValue, descriptors, pathPrefix));
	}
	return out;
}

export function getSharedSchema(plotWrapper) {
	if (!plotWrapper?.plot) return [...WRAPPER_FIELDS];
	const descriptors = plotWrapper.plot.constructor?.descriptors ?? {};
	const inner = walkToJSON(plotWrapper.plot, descriptors, 'plot.', TOP_LEVEL_SKIP);
	return [...WRAPPER_FIELDS, ...inner];
}

export function getSharedDataSchema(plotWrapper) {
	const row = plotWrapper?.plot?.data?.[0];
	if (!row) return [];
	const descriptors = row.constructor?.descriptors ?? {};
	return walkToJSON(row, descriptors, '', null);
}
