// Colour by / Size by in a session DRAFT (colour-by plan 2026-10-20, section 3.9: "MCP").
//
// A draft series may carry
//
//   "colourBy": "time"                                   (shorthand: just the column)
//   "colourBy": { "column": "time", "mode": "hourOfDay", "colormap": "twilight_shifted",
//                 "range": [lo, hi], "colourLine": true }
//   "sizeBy":   { "column": "humidity", "mode": "value", "minRadius": 1.5, "maxRadius": 6,
//                 "range": [lo, hi] }
//
// (`colorBy` is read as `colourBy`.) This turns them into EXACTLY the series fields the app
// saves (plotbits/colourBySeries.svelte.js EncodingChannel.toJSON, Encoding.svelte toJSON):
//
//   colourBy: { refId }   colourEncoding: { id, mode, colormap, domainMin, domainMax, colourLine }
//   sizeBy:   { refId }   sizeEncoding:   { id, mode, minRadius, maxRadius, domainMin, domainMax }
//
// The app LOADS anything (an unknown mode or map silently becomes 'auto'), so a draft that asks
// for something the app would not draw is refused here, with a message the model can act on,
// rather than loading as something else. A bad encoding costs only itself: the series and the
// plot are kept (the overlay rule).
//
// Pure and dependency-free (Worker-safe). The facts it checks against (modes, the modes a kind
// of column offers, colormaps, size defaults) come from the generated catalogue (`ENCODINGS`,
// read from the app's plotbits/encodings.js and colormaps.js by gen-schema.js).

const AUTO = 'auto';

/** The draft keys of each channel, and the series fields it emits. */
const CHANNELS = {
	colour: {
		draftKeys: ['colourBy', 'colorBy'],
		column: 'colourBy',
		encoding: 'colourEncoding',
		word: 'Colour by'
	},
	size: { draftKeys: ['sizeBy'], column: 'sizeBy', encoding: 'sizeEncoding', word: 'Size by' }
};

const COLOUR_KEYS = new Set([
	'column',
	'mode',
	'colormap',
	'colourmap',
	'colorMap',
	'range',
	'domainMin',
	'domainMax',
	'colourLine',
	'colorLine',
	'line'
]);
const SIZE_KEYS = new Set([
	'column',
	'mode',
	'minRadius',
	'maxRadius',
	'range',
	'domainMin',
	'domainMax'
]);

/** The draft value of a channel on a series spec (undefined when absent). */
function draftValue(spec, channel) {
	for (const k of CHANNELS[channel].draftKeys) if (spec?.[k] != null) return spec[k];
	return undefined;
}

/** True when a draft series asks for any encoding (so a plot without them can say so). */
export function draftAsksForEncoding(spec) {
	return Object.keys(CHANNELS).some((ch) => draftValue(spec, ch) !== undefined);
}

/** The plot types that can encode `channel`, sorted. */
function hostsOf(plotSchemas, channel) {
	return Object.entries(plotSchemas)
		.filter(([, s]) => s?.encodings?.[channel])
		.map(([t]) => t)
		.sort();
}

/**
 * The kind of a column as far as encodings are concerned, or null when it is not known yet.
 * A column's type is known when it holds data now (a literal column, a baked generator output);
 * an analysis output is typed when the app computes it (BinnedData's x of a time column becomes
 * a time column), so it is not checked here and the app's automatic choice covers it.
 */
function columnKind(col, rawData) {
	if (!col || !(rawData?.[col.id]?.length > 0)) return null;
	if (col.type === 'time') return 'time';
	if (col.type === 'category' || col.type === 'text') return col.type;
	return Number.isFinite(col.originTime_ms) ? 'numberWithOrigin' : 'number';
}

/** A finite number, null (an automatic end), or undefined when the value is not usable. */
function rangeEnd(v) {
	if (v == null || v === '') return null;
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
	return Number.isFinite(n) ? n : undefined;
}

/**
 * One channel of one draft series as the app's series fields, or null (with an error) when it
 * is refused. `warnings` gets what the app would also say (a wrapped hour of day) and settings
 * that cannot apply and were dropped.
 *
 * @param {object} o
 * @param {'colour'|'size'} o.channel
 * @param {any} o.value         the draft's colourBy / sizeBy value
 * @param {string} o.plotType
 * @param {object} o.plotSchemas generated plots table (plots[type].encodings)
 * @param {object} o.encodings   generated ENCODINGS facts
 * @param {(ref:any)=>number|null} o.resolveRef
 * @param {object[]} o.data      column descriptors so far
 * @param {object} o.rawData
 * @param {number} o.id          the encoding id (names the port enc<id>_<channel>)
 * @param {string} o.where       how messages name the series
 * @param {string[]} o.errors
 * @param {string[]} o.warnings
 * @returns {object|null} `{ colourBy, colourEncoding }` or `{ sizeBy, sizeEncoding }`
 */
export function draftEncoding({
	channel,
	value,
	plotType,
	plotSchemas,
	encodings,
	resolveRef,
	data,
	rawData,
	id,
	where,
	errors,
	warnings
}) {
	const ch = CHANNELS[channel];
	const fail = (msg) => {
		errors.push(`${where} ${ch.word}: ${msg} ${ch.word} dropped; the series is kept.`);
		return null;
	};

	if (!encodings) return fail('this catalogue has no encoding facts (regenerate the schema).');
	if (!plotSchemas[plotType]?.encodings?.[channel]) {
		const hosts = hostsOf(plotSchemas, channel);
		return fail(
			`a ${plotType} cannot ${channel === 'colour' ? 'colour' : 'size'} its marks by a column ` +
				`(its marks are computed or summarised, not rows of data). Plots that can: ${hosts.join(', ') || '(none)'}.`
		);
	}

	// Shorthand: the column alone.
	const spec = typeof value === 'string' || typeof value === 'number' ? { column: value } : value;
	if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
		return fail('give a column name, or an object { "column": "<col>", ... }.');
	}
	const allowed = channel === 'colour' ? COLOUR_KEYS : SIZE_KEYS;
	const unknown = Object.keys(spec).filter((k) => !allowed.has(k));
	if (unknown.length) {
		const keys =
			channel === 'colour'
				? 'column, mode, colormap, range, colourLine'
				: 'column, mode, minRadius, maxRadius, range';
		return fail(
			`unknown key${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} (allowed: ${keys}).`
		);
	}

	// ---- column ----
	if (spec.column == null || spec.column === '') return fail('no "column" given.');
	const colId = resolveRef(spec.column);
	const col = colId == null ? null : data.find((c) => c.id === colId);
	if (!col) {
		return fail(
			`no column named ${JSON.stringify(String(spec.column))}. Available: ${
				data
					.map((c) => c.name)
					.filter(Boolean)
					.join(', ') || '(none)'
			}.`
		);
	}
	const kind = columnKind(col, rawData);
	const cyclic = new Set(encodings.cyclicModes ?? []);
	const categorical = new Set(encodings.categoryModes ?? []);
	// The modes this channel can store, and the ones this column offers (null: not known yet).
	const allModes = channel === 'colour' ? (encodings.modes ?? []) : (encodings.sizeModes ?? []);
	const offeredFor = channel === 'colour' ? encodings.modesFor : encodings.sizeModesFor;
	const offered = kind ? (offeredFor?.[kind] ?? []) : null;
	// A label column is read by a category mode only; Size by has none (a label has no "bigger").
	if ((kind === 'category' || kind === 'text') && !offered.some((m) => categorical.has(m.mode))) {
		return fail(
			channel === 'size'
				? `"${col.name}" is a ${kind} column, and a category has no larger end; size by a number or time column.`
				: `"${col.name}" is a ${kind} column; ${ch.word} reads numbers or times here (colouring by category is not available).`
		);
	}

	// ---- mode ----
	const mode = spec.mode == null || spec.mode === '' ? AUTO : String(spec.mode);
	if (mode !== AUTO) {
		if (channel === 'size' && (cyclic.has(mode) || categorical.has(mode))) {
			return fail(
				cyclic.has(mode)
					? `size cannot read "${mode}": a cyclic quantity has no larger end (23:59 would be drawn largest beside a smallest 00:00). ` +
							`Colour by "${mode}" instead, or size by one of: ${allModes.join(', ')}.`
					: `size cannot read "${mode}": a category has no larger end. Colour by "${mode}" instead, or size by one of: ${allModes.join(', ')}.`
			);
		}
		if (!allModes.includes(mode)) {
			return fail(`unknown mode "${mode}". Modes: auto, ${allModes.join(', ')}.`);
		}
		if (offered) {
			const hit = offered.find((m) => m.mode === mode);
			if (!hit) {
				const what =
					kind === 'time'
						? 'a time column'
						: kind === 'numberWithOrigin'
							? 'a number column'
							: kind === 'number'
								? 'a number column with no clock time'
								: `a ${kind} column`;
				return fail(
					`"${col.name}" is ${what}, which cannot be read as "${mode}". It offers: auto, ${offered
						.map((m) => m.mode)
						.join(', ')}.`
				);
			}
			if (hit.warning) warnings.push(`${where} ${ch.word} "${col.name}": ${hit.warning}`);
		}
	}
	// The mode the app will draw with, where it can be known now (encodingHost.js
	// effectiveColourMode / effectiveSizeMode: 'auto' on a time column is hour of day for colour,
	// days since start for size; otherwise the column's first offered mode).
	const drawnMode =
		mode !== AUTO
			? mode
			: kind === 'time'
				? channel === 'colour'
					? (encodings.cyclicModes?.[0] ?? null)
					: 'daysSinceStart'
				: (offered?.[0]?.mode ?? null);
	const drawnCyclic = drawnMode != null && cyclic.has(drawnMode);

	// ---- range (both channels): [lo, hi], either end null for the data's own ----
	let domainMin = rangeEnd(spec.domainMin);
	let domainMax = rangeEnd(spec.domainMax);
	if (spec.range != null) {
		if (!Array.isArray(spec.range) || spec.range.length !== 2) {
			return fail('"range" must be [min, max] (null for an automatic end).');
		}
		domainMin = rangeEnd(spec.range[0]);
		domainMax = rangeEnd(spec.range[1]);
	}
	if (domainMin === undefined || domainMax === undefined) {
		return fail('a "range" end must be a number or null.');
	}
	const drawnCategory = drawnMode != null && categorical.has(drawnMode);
	if ((drawnCyclic || drawnCategory) && (domainMin != null || domainMax != null)) {
		warnings.push(
			drawnCyclic
				? `${where} ${ch.word}: hour of day always spans 0 to 24 h, so the range was dropped.`
				: `${where} ${ch.word}: a category has no range, so the range was dropped.`
		);
		domainMin = null;
		domainMax = null;
	}

	const column = { refId: colId };

	if (channel === 'colour') {
		// ---- colormap ----
		const maps = encodings.colormaps ?? {};
		const rawMap = spec.colormap ?? spec.colourmap ?? spec.colorMap;
		let colormap = rawMap == null || rawMap === '' ? AUTO : String(rawMap);
		if (colormap !== AUTO && drawnCategory) {
			// Each category takes its own colour, the one the Boxplot gives that label.
			warnings.push(
				`${where} Colour by: categories take their own colours (as in a boxplot), so "colormap" was dropped.`
			);
			colormap = AUTO;
		}
		if (colormap !== AUTO) {
			if (!maps[colormap]) {
				return fail(
					`unknown colormap "${colormap}". Colormaps: auto, ${Object.keys(maps).join(', ')}.`
				);
			}
			const mapCyclic = maps[colormap] === 'cyclic';
			if (drawnMode != null && mapCyclic !== drawnCyclic) {
				const fit = Object.keys(maps).filter((m) => (maps[m] === 'cyclic') === drawnCyclic);
				return fail(
					drawnCyclic
						? `hour of day needs a cyclic colormap (its ends join at midnight): ${fit.join(', ')}.`
						: `"${colormap}" is cyclic (its two ends look alike), for hour of day only. For ${drawnMode} use: ${fit.join(', ')}.`
				);
			}
		}
		// ---- coloured line ----
		const rawLine = spec.colourLine ?? spec.colorLine ?? spec.line;
		if (rawLine != null && typeof rawLine !== 'boolean') {
			return fail('"colourLine" must be true or false.');
		}
		let colourLine = rawLine === true;
		if (colourLine && !plotSchemas[plotType].encodings.lines) {
			warnings.push(
				`${where} Colour by: a ${plotType} draws no data line, so "colourLine" was dropped.`
			);
			colourLine = false;
		}
		return {
			[ch.column]: column,
			[ch.encoding]: { id, mode, colormap, domainMin, domainMax, colourLine }
		};
	}

	// ---- size: smallest and largest point radius, px ----
	const radius = encodings.radius ?? { min: 2, max: 10, floor: 1 };
	const px = (v, fallback, name) => {
		if (v == null || v === '') return fallback;
		const n = typeof v === 'number' ? v : Number(v);
		if (!Number.isFinite(n)) return undefined;
		if (n < radius.floor) {
			warnings.push(
				`${where} Size by: "${name}" ${n} px is below the ${radius.floor} px floor, so ${radius.floor} px is used.`
			);
			return radius.floor;
		}
		return n;
	};
	const minRadius = px(spec.minRadius, radius.min, 'minRadius');
	const maxRadius = px(spec.maxRadius, radius.max, 'maxRadius');
	if (minRadius === undefined || maxRadius === undefined) {
		return fail('"minRadius" and "maxRadius" must be numbers (px).');
	}
	return {
		[ch.column]: column,
		[ch.encoding]: { id, mode, minRadius, maxRadius, domainMin, domainMax }
	};
}

/**
 * Every encoding a draft series asks for, as series fields to merge in (`{}` when none, or when
 * each was refused). `index` is the series' place in the plot: series k's encodings take id
 * k + 1 on both channels, the pairing the app's nextEncodingId gives a series whose colour and
 * size are switched on in turn (ports `enc<k+1>_colour`, `enc<k+1>_size`).
 */
export function draftSeriesEncodings(spec, index, ctx) {
	const out = {};
	for (const channel of Object.keys(CHANNELS)) {
		const value = draftValue(spec, channel);
		if (value === undefined) continue;
		const fields = draftEncoding({ ...ctx, channel, value, id: index + 1 });
		if (fields) Object.assign(out, fields);
	}
	return out;
}

/**
 * The encodings of one saved plot, for describing a session: one entry per encoded series and
 * channel, `{ series, channel, column, mode, ... }`, the column by name.
 */
export function describePlotEncodings(plot, columnName) {
	const out = [];
	(plot?.plot?.data ?? []).forEach((s, i) => {
		for (const [channel, f] of Object.entries(CHANNELS)) {
			const enc = s?.[f.encoding];
			const col = s?.[f.column];
			if (!enc || !col) continue;
			const entry = {
				series: s.label ?? i + 1,
				channel,
				column: columnName(col.refId) ?? `#${col.refId}`,
				mode: enc.mode ?? AUTO
			};
			if (channel === 'colour') {
				entry.colormap = enc.colormap ?? AUTO;
				if (enc.colourLine) entry.colourLine = true;
			} else {
				entry.minRadius = enc.minRadius;
				entry.maxRadius = enc.maxRadius;
			}
			if (enc.domainMin != null || enc.domainMax != null) {
				entry.range = [enc.domainMin ?? null, enc.domainMax ?? null];
			}
			out.push(entry);
		}
	});
	return out;
}

/** One line of text for describePlotEncodings entries ('' when there are none). */
export function encodingsText(entries) {
	return entries
		.map((e) => {
			const bits = [e.mode];
			if (e.channel === 'colour') {
				if (e.colormap !== AUTO) bits.push(e.colormap);
				if (e.colourLine) bits.push('line too');
			} else bits.push(`${e.minRadius} to ${e.maxRadius} px`);
			if (e.range) bits.push(`range ${e.range.map((v) => v ?? 'auto').join(' to ')}`);
			return `series ${JSON.stringify(e.series)} ${e.channel} by "${e.column}" (${bits.join(', ')})`;
		})
		.join('; ');
}
