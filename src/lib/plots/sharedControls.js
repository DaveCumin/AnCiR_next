// Reflection-driven schema for the multi-select control panel.
//
// `getSharedSchema(plot)` walks the keys returned by `plot.plot.toJSON()` and
// emits a flat list of FieldDescriptor objects (path/label/input/group/...).
// Each plot class supplies a tiny `static descriptors` override map for the
// UI metadata reflection can't infer (custom labels, groupings, option lists,
// step sizes). Descriptors can also `skip: true` a field that shouldn't appear.

export const WRAPPER_FIELDS = [
	{ path: 'width', label: 'Width', input: 'number', group: 'Dimension' },
	{ path: 'height', label: 'Height', input: 'number', group: 'Dimension' }
];

// Top-level keys that always belong to other UIs and never appear in shared props.
const TOP_LEVEL_SKIP = new Set(['data', 'annotations', 'parentBox']);

function titleCase(key) {
	const stripped = String(key).endsWith('IN') ? String(key).slice(0, -2) : String(key);
	const spaced = stripped.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
	return spaced.trim();
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
	const group = merged.group ?? defaultGroup;
	if (group) out.group = group;
	if (merged.step != null) out.step = merged.step;
	return out;
}

function fieldsForKey(key, value, descriptors, pathPrefix) {
	const desc = descriptors?.[key] ?? {};
	if (desc.skip) return [];

	const parentLabel = desc.label ?? titleCase(key);
	const parentGroup = desc.group;

	if (isClassInstance(value)) {
		// By default a sub-class instance (an Axis, a Column, …) is opaque. But a
		// descriptor can opt a *style* sub-object in with `descend: true` (e.g. a
		// data point's line/points, or a plot's axes), so its scalar leaves —
		// colour, marker shape, gridlines, … — surface in the shared-options UI.
		if (!desc.descend) return [];
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
				`${parentLabel} ${cdLabel ?? titleCase(leafKey)}`,
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
				titleCase(leafKey),
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
		const out = [];
		value.forEach((leafVal, i) => {
			const field = buildScalarField(
				`${pathPrefix}${key}[${i}]`,
				leafVal,
				`${parentLabel} [${i}]`,
				groupForChildren,
				{},
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
