// Colour by / Size by through the engine's add_plot and the app's AI edit, pinned against a
// session DRAFT (the Worker normalizer): one set of rules (plotbits/encodingSpec.js), so all
// three accept the same syntax, refuse in the same words and save the same fields, and what
// they save loads into the app's real plot classes and saves back unchanged.
import { beforeAll, describe, expect, it } from 'vitest';
import {
	AncirSession,
	ensureRegistry,
	describeCapabilities,
	filterCapabilities
} from '../src/engine/session.js';
import { normalizeSession } from '../src/emit/normalizer.js';
import { appConsts, core } from '$lib/core/core.svelte.js';
import {
	planEdit,
	applyEdit,
	summariseSession,
	registryFacts,
	sessionFacts
} from '$lib/utils/aiEdit.js';
import { validateEdit } from '../app/validation.js';
import { buildEditPrompt } from '../worker/editPrompt.js';

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
	{ name: 'humidity', values: Array.from({ length: N }, (_, i) => 50 + (i % 24)) },
	{
		name: 'colony',
		type: 'category',
		values: Array.from({ length: N }, (_, i) => (i % 2 ? 'A' : 'B'))
	}
];
const ENC = {
	colourBy: { column: 'time', mode: 'hourOfDay', colormap: 'twilight_shifted', colourLine: true },
	sizeBy: { column: 'humidity', minRadius: 1.5, maxRadius: 6, range: [50, null] }
};
const FIELDS = ['colourBy', 'colourEncoding', 'sizeBy', 'sizeEncoding'];
// The app saves a wired column as its whole wrapper; the draft emits the wire alone ({ refId }),
// which is all fromJSON reads back (slimWrapper). The settings must match field for field.
const pick = (s) =>
	Object.fromEntries(
		FIELDS.filter((k) => s?.[k] != null).map((k) => [
			k,
			k.endsWith('By') ? { refId: s[k].refId } : s[k]
		])
	);

/** The draft's series fields for one scatter series of hive against air with `extra`. */
function drafted(extra, name = 'Loop') {
	return normalizeSession({
		columns: COLUMNS,
		plots: [{ type: 'scatterplot', name, series: [{ x: 'air', y: 'hive', ...extra }] }]
	});
}

function freshSession(id) {
	const s = new AncirSession(id);
	s.importColumns(COLUMNS);
	return s;
}

describe('add_plot: colourBy / sizeBy', () => {
	it('saves exactly the fields a draft emits, and they load into the app class unchanged', () => {
		const { session: draft, errors } = drafted(ENC);
		expect(errors).toEqual([]);
		const s = freshSession('enc-add-plot');
		const res = s.addPlot('scatterplot', { x: 'air', y: 'hive' }, undefined, ENC);
		expect(res.encodings).toEqual([
			{
				series: 1,
				channel: 'colour',
				column: 'time',
				mode: 'hourOfDay',
				colormap: 'twilight_shifted',
				colourLine: true
			},
			{
				series: 1,
				channel: 'size',
				column: 'humidity',
				mode: 'auto',
				minRadius: 1.5,
				maxRadius: 6,
				range: [50, null]
			}
		]);
		expect(res.warnings).toBeUndefined();

		const saved = s.exportSessionObject().plots.at(-1).plot.data[0];
		const want = draft.plots[0].plot.data[0];
		expect(JSON.parse(JSON.stringify(pick(saved)))).toEqual(pick(want));
		// Colouring the line draws it, as the draft does.
		expect(saved.line.draw).toBe(true);

		const inner = appConsts.plotMap
			.get('scatterplot')
			.data.fromJSON(null, JSON.parse(JSON.stringify(s.exportSessionObject().plots.at(-1).plot)));
		const dp = inner.data[0];
		expect(dp.colourActive).toBe(true);
		expect(dp.colourMode).toBe('hourOfDay');
		expect(dp.sizeActive).toBe(true);
		expect(JSON.parse(JSON.stringify(pick(dp.encodingsJSON())))).toEqual(pick(want));
	});

	it('a category colour: the map is dropped with the draft warning', () => {
		const s = freshSession('enc-category');
		const res = s.addPlot('scatterplot', { x: 'air', y: 'hive' }, undefined, {
			colourBy: { column: 'colony', colormap: 'viridis' }
		});
		expect(res.warnings).toEqual([
			'add_plot scatterplot: Colour by: categories take their own colours (as in a boxplot), so "colormap" was dropped.'
		]);
		expect(res.encodings[0]).toMatchObject({ column: 'colony', mode: 'auto', colormap: 'auto' });
	});

	it('refuses before adding anything, in the draft words', () => {
		const s = freshSession('enc-refusals');
		const before = core.plots.length;
		const refuse = (type, inputs, enc) => () => s.addPlot(type, inputs, undefined, enc);
		expect(
			refuse(
				'scatterplot',
				{ x: 'air', y: 'hive' },
				{ sizeBy: { column: 'time', mode: 'hourOfDay' } }
			)
		).toThrow(
			/^add_plot scatterplot: Size by: size cannot read "hourOfDay": a cyclic quantity has no larger end .* Nothing was added\.$/
		);
		expect(refuse('scatterplot', { x: 'air', y: 'hive' }, { colourBy: 'nope' })).toThrow(
			'add_plot scatterplot: Colour by: no column named "nope". Available: time, air, hive, humidity, colony. Nothing was added.'
		);
		expect(refuse('histogram', { column: 'hive' }, { colourBy: 'time' })).toThrow(
			/a histogram cannot colour its marks by a column .* Plots that can: .*scatterplot.* Nothing was added\./
		);
		expect(core.plots.length).toBe(before);
	});

	it('list_capabilities says which plots can encode', () => {
		const caps = filterCapabilities(describeCapabilities());
		const scatter = caps.plots.find((p) => p.id === 'scatterplot');
		expect(scatter.encodings).toEqual({ colour: true, size: true, lines: true });
		expect(caps.plots.find((p) => p.id === 'histogram').encodings).toBeUndefined();
	});
});

describe('the AI edit speaks the draft language', () => {
	function plan(spec) {
		return planEdit(spec, {
			summary: summariseSession(),
			facts: registryFacts(),
			local: sessionFacts()
		});
	}

	it('a new plot with encodings saves the fields the draft emits', () => {
		freshSession('enc-ai-new');
		const p = plan({
			plots: [{ type: 'scatterplot', name: 'Loop', series: [{ x: 'air', y: 'hive', ...ENC }] }]
		});
		expect(p.errors).toEqual([]);
		applyEdit(p);
		const live = core.plots.find((q) => q.name === 'Loop');
		const saved = JSON.parse(JSON.stringify(live.plot.toJSON())).data[0];
		const want = drafted(ENC).session.plots[0].plot.data[0];
		expect(pick(saved)).toEqual(pick(want));
		expect(saved.line.draw).toBe(true);
	});

	it('refusals and warnings are word for word the draft ones', () => {
		freshSession('enc-ai-words');
		const extra = {
			colourBy: { column: 'colony', colormap: 'viridis' },
			sizeBy: { column: 'time', mode: 'hourOfDay' }
		};
		const p = plan({
			plots: [{ type: 'scatterplot', name: 'Loop', series: [{ x: 'air', y: 'hive', ...extra }] }]
		});
		const d = drafted(extra);
		expect(p.errors).toEqual(d.errors);
		expect(p.warnings).toEqual(d.warnings);
		expect(p.errors).toHaveLength(1);
		expect(p.warnings).toHaveLength(1);
	});

	it("the app's real summary of encoded plots passes the Worker's /edit schema and reaches the prompt", () => {
		const s = freshSession('enc-ai-schema');
		s.addPlot('scatterplot', { x: 'air', y: 'hive' }, undefined, ENC);
		s.addPlot('boxplot', { x: 'colony', y: 'hive' });
		const summary = summariseSession();
		const v = validateEdit(
			{ prompt: 'colour it by humidity', session: summary },
			{ isPublic: false }
		);
		expect(v.ok, v.error).toBe(true);
		const prompt = buildEditPrompt(summary);
		expect(prompt).toMatch(/COLOUR BY \/ SIZE BY/);
		expect(prompt).toMatch(/"colourBy" \/ "sizeBy" \(as in\s+COLOUR BY below\) switch it on/);
		// An encoding already on is restyled through its own descriptor paths.
		expect(prompt).toMatch(/plot\.data\[0\]\.colourEncoding\.mode="hourOfDay"/);
	});
});
