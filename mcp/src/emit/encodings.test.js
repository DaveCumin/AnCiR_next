// node --test src/emit/encodings.test.js
//
// Colour by / Size by on a draft series (encodings.js through normalizeSession): the series
// fields the app saves, and the refusals. That the emitted fields load into the app's own
// classes unchanged is pinned in test/emit.encodings.app.test.js (vitest, real app classes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSession } from './normalizer.js';
import { describePlotEncodings, encodingsText } from './encodings.js';
import { ENCODINGS } from './schema.js';

// The generated facts (from the app's encodings.js): lists in messages are read from them, so
// these tests hold whether or not the app offers Category yet.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MODES = ENCODINGS.modes.join(', ');
const SIZE_MODES = ENCODINGS.sizeModes.join(', ');
const HAS_CATEGORY = ENCODINGS.categoryModes?.length > 0;

const HOURS = 6;
const iso = (h) => new Date(Date.UTC(2024, 0, 15, h)).toISOString();
const COLUMNS = [
	{ name: 'time', type: 'time', values: Array.from({ length: HOURS }, (_, h) => iso(h)) },
	{ name: 'air', values: [1, 2, 3, 4, 5, 6] },
	{ name: 'hive', values: [30, 31, 33, 34, 33, 31] },
	{ name: 'humidity', values: [50, 55, 60, 65, 70, 75] },
	{ name: 'colony', type: 'category', values: ['a', 'b', 'a', 'b', 'a', 'b'] }
];

/** One scatter series of hive against air with these extra series keys. */
function scatter(extra, type = 'scatterplot') {
	const inputs =
		type === 'qqplot'
			? { column: 'hive' }
			: type === 'periodogram' || type === 'circularphase'
				? { time: 'time', values: 'hive' }
				: { x: 'air', y: 'hive' };
	return normalizeSession({
		columns: COLUMNS,
		plots: [{ type, name: 'Loop', series: [{ ...inputs, ...extra }] }]
	});
}

const ID = Object.fromEntries(COLUMNS.map((c, i) => [c.name, i]));

test('colour by hour of day (line too) and size by a column: exactly the fields the app saves', () => {
	const { session, errors, warnings } = scatter({
		colourBy: { column: 'time', mode: 'hourOfDay', colormap: 'twilight_shifted', colourLine: true },
		sizeBy: { column: 'humidity', minRadius: 1.5, maxRadius: 6, range: [50, null] }
	});
	assert.deepEqual(errors, []);
	assert.deepEqual(warnings, []);
	const s = session.plots[0].plot.data[0];
	assert.deepEqual(s.colourBy, { refId: ID.time });
	assert.deepEqual(s.colourEncoding, {
		id: 1,
		mode: 'hourOfDay',
		colormap: 'twilight_shifted',
		domainMin: null,
		domainMax: null,
		colourLine: true
	});
	assert.deepEqual(s.sizeBy, { refId: ID.humidity });
	assert.deepEqual(s.sizeEncoding, {
		id: 1,
		mode: 'auto',
		minRadius: 1.5,
		maxRadius: 6,
		domainMin: 50,
		domainMax: null
	});
	// Colouring the line means wanting one: a "points" series draws its line as well.
	assert.equal(s.line.draw, true);
	assert.equal(s.points.draw, true);
});

test('shorthands: a bare column (by name or id), `colorBy`, defaults filled', () => {
	const byName = scatter({ colourBy: 'humidity' }).session.plots[0].plot.data[0];
	assert.deepEqual(byName.colourBy, { refId: ID.humidity });
	assert.deepEqual(byName.colourEncoding, {
		id: 1,
		mode: 'auto',
		colormap: 'auto',
		domainMin: null,
		domainMax: null,
		colourLine: false
	});
	// A plain series keeps its line hidden.
	assert.equal(byName.line.draw, false);
	const byId = scatter({ colorBy: ID.humidity, sizeBy: String(ID.air) }).session.plots[0].plot
		.data[0];
	assert.deepEqual(byId.colourBy, { refId: ID.humidity });
	assert.deepEqual(byId.sizeBy, { refId: ID.air });
	assert.deepEqual(byId.sizeEncoding, {
		id: 1,
		mode: 'auto',
		minRadius: 2,
		maxRadius: 10,
		domainMin: null,
		domainMax: null
	});
});

test('a plain series emits no encoding fields (it saves exactly as before)', () => {
	const s = scatter({}).session.plots[0].plot.data[0];
	for (const k of ['colourBy', 'colourEncoding', 'sizeBy', 'sizeEncoding'])
		assert.equal(k in s, false);
});

test("series k's encodings take id k + 1 on both channels (ports enc<k+1>_colour / _size)", () => {
	const { session, errors } = normalizeSession({
		columns: COLUMNS,
		plots: [
			{
				type: 'scatterplot',
				series: [
					{ x: 'air', y: 'hive', colourBy: 'time' },
					{ x: 'air', y: 'humidity', colourBy: 'time', sizeBy: 'hive' }
				]
			}
		]
	});
	assert.deepEqual(errors, []);
	const [a, b] = session.plots[0].plot.data;
	assert.equal(a.colourEncoding.id, 1);
	assert.equal(b.colourEncoding.id, 2);
	assert.equal(b.sizeEncoding.id, 2);
});

test('every encoding host takes them; colourLine is dropped (warned) where there is no data line', () => {
	for (const type of ['qqplot', 'circularphase']) {
		const { session, errors, warnings } = scatter(
			{ colourBy: { column: 'humidity', colourLine: true }, sizeBy: 'air' },
			type
		);
		assert.deepEqual(errors, [], type);
		const s = session.plots[0].plot.data[0];
		assert.equal(s.colourEncoding.colourLine, false, type);
		assert.deepEqual(s.sizeBy, { refId: ID.air }, type);
		assert.match(warnings.join('\n'), new RegExp(`a ${type} draws no data line`));
	}
	const mean = scatter({ colourBy: { column: 'humidity', colourLine: true } }, 'meansem');
	assert.deepEqual(mean.errors, []);
	assert.equal(mean.session.plots[0].plot.data[0].colourEncoding.colourLine, true);
});

// ---- refusals: the encoding goes, the series and the plot stay ----

/** The draft's errors, and the series as emitted. */
function refused(extra, type) {
	const { session, errors } = scatter(extra, type);
	const s = session.plots[0]?.plot?.data?.[0];
	assert.ok(s, 'the plot and its series are kept');
	return { errors: errors.join('\n'), s };
}

test('a computed plot (periodogram) refuses Colour by and names the plots that can', () => {
	const { errors, s } = refused({ colourBy: 'humidity' }, 'periodogram');
	assert.match(errors, /a periodogram cannot colour its marks by a column/);
	assert.match(errors, /Plots that can: circularphase, meansem, qqplot, scatterplot\./);
	assert.equal('colourBy' in s, false);
	assert.equal('colourEncoding' in s, false);
});

test('an unknown mode is refused with the list of modes', () => {
	const { errors, s } = refused({ colourBy: { column: 'humidity', mode: 'hourOfWeek' } });
	assert.match(errors, new RegExp(esc(`unknown mode "hourOfWeek". Modes: auto, ${MODES}.`)));
	assert.match(MODES, /^value, hourOfDay, dayOfYear, daysSinceStart\b/);
	assert.equal('colourEncoding' in s, false);
});

test('Size by refuses hour of day, and says to colour by it instead', () => {
	const { errors, s } = refused({
		colourBy: 'time',
		sizeBy: { column: 'time', mode: 'hourOfDay' }
	});
	assert.match(
		errors,
		/Size by: size cannot read "hourOfDay": a cyclic quantity has no larger end/
	);
	assert.match(
		errors,
		new RegExp(esc(`Colour by "hourOfDay" instead, or size by one of: ${SIZE_MODES}.`))
	);
	assert.equal(ENCODINGS.sizeModes.includes('hourOfDay'), false);
	assert.equal('sizeBy' in s, false);
	// The colour encoding on the same series is unaffected.
	assert.deepEqual(s.colourBy, { refId: ID.time });
});

test('column type checks: a time column has no "value"; a plain number has no day of year', () => {
	const t = refused({ colourBy: { column: 'time', mode: 'value' } });
	assert.match(
		t.errors,
		/"time" is a time column, which cannot be read as "value"\. It offers: auto, hourOfDay, dayOfYear, daysSinceStart\./
	);
	const n = refused({ sizeBy: { column: 'humidity', mode: 'dayOfYear' } });
	assert.match(
		n.errors,
		/"humidity" is a number column with no clock time, which cannot be read as "dayOfYear"\. It offers: auto, value, daysSinceStart\./
	);
});

test('a category column: Size by refuses it; Colour by reads it as Category once the app has it', () => {
	assert.match(
		refused({ sizeBy: 'colony' }).errors,
		/"colony" is a category column, and a category has no larger end; size by a number or time column\./
	);
	if (HAS_CATEGORY) {
		const { session, errors, warnings } = scatter({
			colourBy: { column: 'colony', colormap: 'viridis', range: [0, 1] }
		});
		assert.deepEqual(errors, []);
		assert.equal(session.plots[0].plot.data[0].colourEncoding.mode, 'auto');
		assert.equal(session.plots[0].plot.data[0].colourEncoding.colormap, 'auto');
		assert.match(warnings.join('\n'), /categories take their own colours/);
		assert.match(warnings.join('\n'), /a category has no range, so the range was dropped/);
		assert.match(
			refused({ colourBy: { column: 'colony', mode: 'value' } }).errors,
			/"colony" is a category column, which cannot be read as "value"\. It offers: auto, category\./
		);
		assert.match(
			refused({ sizeBy: { column: 'humidity', mode: 'category' } }).errors,
			/size cannot read "category": a category has no larger end/
		);
	} else {
		assert.match(
			refused({ colourBy: 'colony' }).errors,
			/"colony" is a category column; Colour by reads numbers or times/
		);
	}
});

test('hour of day of a plain number column is allowed, with the app\'s "wrapped" warning', () => {
	const { session, errors, warnings } = scatter({
		colourBy: { column: 'humidity', mode: 'hourOfDay' }
	});
	assert.deepEqual(errors, []);
	assert.equal(session.plots[0].plot.data[0].colourEncoding.mode, 'hourOfDay');
	assert.match(warnings.join('\n'), /hour of day is its hours since start, wrapped at 24 h/);
});

test('colormaps: unknown refused; a cyclic map needs hour of day and hour of day needs one', () => {
	assert.match(
		refused({ colourBy: { column: 'humidity', colormap: 'jet' } }).errors,
		/unknown colormap "jet"\. Colormaps: auto, viridis, magma, greys, rdbu, twilight_shifted, greysCyclic\./
	);
	assert.match(
		refused({ colourBy: { column: 'humidity', colormap: 'twilight_shifted' } }).errors,
		/"twilight_shifted" is cyclic \(its two ends look alike\), for hour of day only\. For value use: viridis, magma, greys, rdbu\./
	);
	// 'auto' on a time column is hour of day, so a sequential map is refused there too.
	assert.match(
		refused({ colourBy: { column: 'time', colormap: 'viridis' } }).errors,
		/hour of day needs a cyclic colormap \(its ends join at midnight\): twilight_shifted, greysCyclic\./
	);
	// ...and is fine for days since start.
	const ok = scatter({
		colourBy: { column: 'time', mode: 'daysSinceStart', colormap: 'magma' }
	});
	assert.deepEqual(ok.errors, []);
});

test('an unknown column, a bad range, unknown keys and a bad radius are refused', () => {
	assert.match(
		refused({ colourBy: 'pressure' }).errors,
		/Colour by: no column named "pressure"\. Available: time, air, hive, humidity, colony\./
	);
	assert.match(
		refused({ colourBy: { column: 'humidity', range: [1] } }).errors,
		/"range" must be \[min, max\]/
	);
	assert.match(
		refused({ colourBy: { column: 'humidity', range: [1, 'high'] } }).errors,
		/a "range" end must be a number or null/
	);
	assert.match(
		refused({ sizeBy: { column: 'humidity', colour: 'red' } }).errors,
		/unknown key colour \(allowed: column, mode, minRadius, maxRadius, range\)/
	);
	assert.match(
		refused({ sizeBy: { column: 'humidity', maxRadius: 'big' } }).errors,
		/"minRadius" and "maxRadius" must be numbers \(px\)/
	);
	assert.match(refused({ colourBy: {} }).errors, /no "column" given/);
});

test('hour of day always spans 0 to 24 h: a range is dropped with a warning; radius floor', () => {
	const { session, errors, warnings } = scatter({
		colourBy: { column: 'time', range: [6, 18] },
		sizeBy: { column: 'humidity', minRadius: 0.2 }
	});
	assert.deepEqual(errors, []);
	const s = session.plots[0].plot.data[0];
	assert.equal(s.colourEncoding.domainMin, null);
	assert.equal(s.colourEncoding.domainMax, null);
	assert.equal(s.sizeEncoding.minRadius, 1);
	assert.match(warnings.join('\n'), /hour of day always spans 0 to 24 h, so the range was dropped/);
	assert.match(warnings.join('\n'), /"minRadius" 0\.2 px is below the 1 px floor/);
});

test("an analysis output's type is decided on compute, so it is not type-checked here", () => {
	const { session, errors } = normalizeSession({
		columns: COLUMNS.slice(0, 3),
		analyses: [{ name: 'BinnedData', args: { xIN: 'time', yIN: ['air', 'hive'] } }],
		plots: [
			{
				type: 'scatterplot',
				series: [
					{
						x: 'binnedy_air',
						y: 'binnedy_hive',
						colourBy: { column: 'binnedx', mode: 'hourOfDay', colourLine: true }
					}
				]
			}
		]
	});
	assert.deepEqual(errors, []);
	const s = session.plots[0].plot.data[0];
	assert.equal(s.colourEncoding.mode, 'hourOfDay');
	assert.equal(session.data.find((c) => c.id === s.colourBy.refId).name, 'binnedx');
});

test('describePlotEncodings / encodingsText read a saved plot back by column name', () => {
	const { session } = scatter({
		label: 'Hive',
		colourBy: { column: 'time', colourLine: true },
		sizeBy: { column: 'humidity', minRadius: 1.5, maxRadius: 6 }
	});
	const names = new Map(session.data.map((c) => [c.id, c.name]));
	const entries = describePlotEncodings(session.plots[0], (id) => names.get(id));
	assert.deepEqual(entries, [
		{
			series: 'Hive',
			channel: 'colour',
			column: 'time',
			mode: 'auto',
			colormap: 'auto',
			colourLine: true
		},
		{
			series: 'Hive',
			channel: 'size',
			column: 'humidity',
			mode: 'auto',
			minRadius: 1.5,
			maxRadius: 6
		}
	]);
	assert.equal(
		encodingsText(entries),
		'series "Hive" colour by "time" (auto, line too); series "Hive" size by "humidity" (auto, 1.5 to 6 px)'
	);
});
