// Colour by / Size by from a session DRAFT (the Worker normalizer, src/emit/encodings.js),
// pinned against the app's own classes: the generated encoding facts cannot drift from
// plotbits/encodings.js, colormaps.js and each plot's encodingCapabilities, and the series
// fields a draft emits load into the real plot classes as an encoded series and save back
// unchanged (the "exactly the shape the app saves" contract).
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry } from '../src/engine/session.js';
import { normalizeSession } from '../src/emit/normalizer.js';
import { ENCODINGS, PLOTS } from '../src/emit/schema.js';
import { appConsts } from '$lib/core/core.svelte.js';
import * as lib from '$lib/components/plotbits/encodings.js';
import { COLORMAP_META } from '$lib/components/plotbits/colormaps.js';

beforeAll(async () => {
	await ensureRegistry();
});

const N = 48;
const T0 = Date.UTC(2024, 0, 15);
const COLUMNS = [
	{ name: 'time', type: 'time', values: Array.from({ length: N }, (_, i) => T0 + i * 3600000) },
	{
		name: 'air',
		values: Array.from({ length: N }, (_, i) => 10 + 5 * Math.sin((i * Math.PI) / 12))
	},
	{
		name: 'hive',
		values: Array.from({ length: N }, (_, i) => 33 + Math.sin((i * Math.PI) / 12 - 1))
	},
	{ name: 'humidity', values: Array.from({ length: N }, (_, i) => 50 + (i % 24)) }
];

describe('the generated encoding facts match the app', () => {
	it('modes, the modes each kind of column offers, colormaps and size defaults', () => {
		const { ENCODING_MODES, isCyclicMode } = lib;
		const isCategoryMode = lib.isCategoryMode ?? (() => false);
		expect(ENCODINGS.modes).toEqual([...ENCODING_MODES]);
		expect(ENCODINGS.sizeModes).toEqual([
			...(lib.SIZE_ENCODING_MODES ?? ENCODING_MODES.filter((m) => !isCyclicMode(m)))
		]);
		expect(ENCODINGS.cyclicModes).toEqual(ENCODING_MODES.filter(isCyclicMode));
		expect(ENCODINGS.categoryModes).toEqual(ENCODING_MODES.filter(isCategoryMode));
		const strip = (list) =>
			list.map((m) => ({ mode: m.mode, ...(m.warning ? { warning: m.warning } : {}) }));
		const kinds = {
			time: { type: 'time' },
			number: { type: 'number' },
			numberWithOrigin: { type: 'number', originTime_ms: 0 },
			category: { type: 'category' },
			text: { type: 'text' }
		};
		const per = (fn) =>
			Object.fromEntries(Object.entries(kinds).map(([k, col]) => [k, strip(fn(col))]));
		expect(ENCODINGS.modesFor).toEqual(per(lib.encodingModesFor));
		expect(ENCODINGS.sizeModesFor).toEqual(per(lib.sizeModesFor));
		expect(ENCODINGS.colormaps).toEqual(
			Object.fromEntries(Object.entries(COLORMAP_META).map(([k, m]) => [k, m.kind]))
		);
		expect(ENCODINGS.radius).toEqual({
			min: lib.DEFAULT_MIN_RADIUS,
			max: lib.DEFAULT_MAX_RADIUS,
			floor: lib.MIN_RADIUS_FLOOR
		});
	});

	it("every plot's encodings entry is its class's encodingCapabilities", () => {
		for (const [type, entry] of appConsts.plotMap) {
			const caps = entry.data?.encodingCapabilities;
			expect(PLOTS[type]?.encodings ?? null, type).toEqual(
				caps ? { colour: !!caps.colour, size: !!caps.size, lines: !!caps.lines } : null
			);
		}
	});
});

describe('a drafted Colour by / Size by loads into the app classes and saves back unchanged', () => {
	/** Columns in the app with the same ids the normalizer gave them (both count from 0). */
	function sessionWithDraftColumns(name, session) {
		const s = new AncirSession(name);
		const added = s.importColumns(COLUMNS);
		expect(added.map((c) => c.id)).toEqual(session.data.map((c) => c.id));
		return s;
	}

	const DRAFT = (type, inputs, extra = {}) => ({
		columns: COLUMNS,
		plots: [
			{
				type,
				name: 'Loop',
				series: [
					{
						...inputs,
						label: 'Hive',
						colourBy: { column: 'time', mode: 'hourOfDay', colourLine: true },
						sizeBy: { column: 'humidity', minRadius: 1.5, maxRadius: 6 },
						...extra
					}
				]
			}
		]
	});

	const HOSTS = [
		['scatterplot', { x: 'air', y: 'hive' }],
		['meansem', { x: 'air', y: 'hive' }],
		['qqplot', { column: 'hive' }],
		['circularphase', { time: 'time', values: 'hive' }]
	];

	for (const [type, inputs] of HOSTS) {
		it(`${type}: colour by hour of day and size by humidity`, () => {
			const { session, errors } = normalizeSession(DRAFT(type, inputs));
			expect(errors).toEqual([]);
			sessionWithDraftColumns(`enc-${type}`, session);
			const emitted = JSON.parse(JSON.stringify(session.plots[0].plot));
			const inner = appConsts.plotMap.get(type).data.fromJSON(null, emitted);
			const dp = inner.data[0];

			// Switched on, wired to the drafted columns, read the drafted way.
			expect(dp.colourActive).toBe(true);
			expect(dp.sizeActive).toBe(true);
			expect(dp.colourBy.refId).toBe(emitted.data[0].colourBy.refId);
			expect(dp.sizeBy.refId).toBe(emitted.data[0].sizeBy.refId);
			expect(dp.colourMode).toBe('hourOfDay');
			expect(dp.sizeMode).toBe('value');

			// The settings the app saves are exactly the ones drafted.
			const saved = JSON.parse(JSON.stringify(dp.encodingsJSON()));
			expect(saved.colourEncoding).toEqual(emitted.data[0].colourEncoding);
			expect(saved.sizeEncoding).toEqual(emitted.data[0].sizeEncoding);
			expect(saved.colourBy.refId).toBe(emitted.data[0].colourBy.refId);
			expect(saved.sizeBy.refId).toBe(emitted.data[0].sizeBy.refId);
		});
	}

	it('the app would have quietly drawn a refused mode as "auto"; the draft refuses it instead', () => {
		const { session, errors } = normalizeSession(
			DRAFT(
				'scatterplot',
				{ x: 'air', y: 'hive' },
				{ sizeBy: { column: 'time', mode: 'hourOfDay' } }
			)
		);
		expect(errors.join('\n')).toMatch(/size cannot read "hourOfDay"/);
		sessionWithDraftColumns('enc-refused', session);
		const inner = appConsts.plotMap
			.get('scatterplot')
			.data.fromJSON(null, JSON.parse(JSON.stringify(session.plots[0].plot)));
		expect(inner.data[0].colourActive).toBe(true);
		expect(inner.data[0].sizeActive).toBe(false);
	});
});
