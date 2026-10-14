// @ts-nocheck
/**
 * The pure overlay spec (overlays plan 2026-10-15, T2): the channel table, host capabilities
 * (allowed kinds/forms, default and coerced forms), the catalogue description and the spec
 * normaliser's per-host errors. The app, the MCP engine and the Worker's draft normalizer all
 * read this module, so it must stay free of Svelte and of `$lib` imports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	CHANNEL_TABLE,
	FORMS,
	PAIRED_FORMS,
	OVERLAY_POSITION_CAP,
	OVERLAY_KINDS,
	ALL_OVERLAY_FORMS,
	channelsFor,
	allowedForms,
	allowedKinds,
	defaultFormFor,
	coerceForm,
	capabilitiesOf,
	describeOverlayForms,
	normalizeOverlaySpecs,
	overlayColumnIds,
	remapOverlayColumnIds
} from './overlaySpec.js';

// A Boxplot-like host (step 3): horizontal lines and bands only.
const H_ONLY = { line: ['horizontal'], band: ['horizontal'], legend: true, xTime: false };
// A host that offers lines only, bands not at all.
const LINES_ONLY = { line: ['horizontal', 'vertical'], band: [], legend: false, xTime: false };

const byName = { a: 1, b: 2, 'lower limit': 3 };
const resolveCol = (ref) => {
	if (typeof ref === 'number') return ref;
	if (/^\d+$/.test(ref)) return Number(ref);
	if (ref in byName) return byName[ref];
	throw new Error(`no column ${ref}`);
};

describe('the module is pure', () => {
	it('imports nothing (the Worker bundles it without the Svelte toolchain)', () => {
		const src = readFileSync(
			join(process.cwd(), 'src/lib/components/plotbits/overlaySpec.js'),
			'utf8'
		);
		expect(src).not.toMatch(/^\s*import\s/m);
	});
});

describe('the channel table', () => {
	it('FORMS lists every form of the table, per kind, in panel order', () => {
		expect(FORMS).toEqual({
			line: ['vertical', 'horizontal'],
			band: ['ribbon', 'horizontal', 'vertical', 'repeating']
		});
		for (const kind of OVERLAY_KINDS) {
			expect(Object.keys(CHANNEL_TABLE[kind]).sort()).toEqual([...FORMS[kind]].sort());
		}
		expect(OVERLAY_KINDS).toEqual(['line', 'band']);
	});

	it('channelsFor adds the display label and returns copies', () => {
		const list = channelsFor('band', 'vertical');
		expect(list).toEqual([
			{ key: 'start', axis: 'x', dynamic: false, display: 'start (x)' },
			{ key: 'end', axis: 'x', dynamic: false, display: 'end (x)' }
		]);
		list[0].key = 'changed';
		expect(CHANNEL_TABLE.band.vertical[0].key).toBe('start');
		expect(channelsFor('band', 'repeating')).toEqual([]);
		expect(channelsFor('line', 'ribbon')).toEqual([]);
	});

	it('paired forms and the position cap', () => {
		expect(PAIRED_FORMS).toEqual({ vertical: ['start', 'end'], horizontal: ['lower', 'upper'] });
		expect(OVERLAY_POSITION_CAP).toBe(50);
	});
});

describe('capabilities', () => {
	it('no capabilities means every form (the stand-in host of a unit test)', () => {
		expect(allowedForms(undefined, 'line')).toEqual(FORMS.line);
		expect(allowedForms(null, 'band')).toEqual(FORMS.band);
		expect(allowedKinds(null)).toEqual(['line', 'band']);
		expect(defaultFormFor(null, 'band')).toBe('ribbon');
	});

	it('ALL_OVERLAY_FORMS allows everything, with a legend and a time x', () => {
		expect(allowedForms(ALL_OVERLAY_FORMS, 'line')).toEqual(FORMS.line);
		expect(allowedForms(ALL_OVERLAY_FORMS, 'band')).toEqual(FORMS.band);
		expect(ALL_OVERLAY_FORMS.legend).toBe(true);
		expect(ALL_OVERLAY_FORMS.xTime).toBe(true);
		expect(Object.isFrozen(ALL_OVERLAY_FORMS)).toBe(true);
	});

	it("a host's list restricts the forms, keeps the host's order, and drops unknown forms", () => {
		expect(allowedForms(H_ONLY, 'line')).toEqual(['horizontal']);
		expect(allowedForms(LINES_ONLY, 'line')).toEqual(['horizontal', 'vertical']);
		expect(allowedForms({ line: ['diagonal', 'vertical'] }, 'line')).toEqual(['vertical']);
		expect(allowedForms(H_ONLY, 'nope')).toEqual([]);
		expect(allowedForms(null, 'nope')).toEqual([]);
	});

	it('a kind with no allowed form is not allowed', () => {
		expect(allowedKinds(LINES_ONLY)).toEqual(['line']);
		expect(allowedKinds({ legend: true })).toEqual([]);
	});

	it("defaultFormFor is the host's first form of the kind (a horizontal line on a Boxplot)", () => {
		expect(defaultFormFor(H_ONLY, 'line')).toBe('horizontal');
		expect(defaultFormFor(LINES_ONLY, 'line')).toBe('horizontal');
		expect(defaultFormFor(LINES_ONLY, 'band')).toBeNull();
	});

	it('coerceForm keeps an allowed form, else the default, else null', () => {
		expect(coerceForm(H_ONLY, 'band', 'horizontal')).toBe('horizontal');
		expect(coerceForm(H_ONLY, 'band', 'ribbon')).toBe('horizontal');
		expect(coerceForm(H_ONLY, 'line', undefined)).toBe('horizontal');
		expect(coerceForm(LINES_ONLY, 'band', 'ribbon')).toBeNull();
		expect(coerceForm(null, 'line', 'vertical')).toBe('vertical');
	});

	it('capabilitiesOf reads the static on the host class, or null', () => {
		class Host {
			static overlayCapabilities = H_ONLY;
		}
		expect(capabilitiesOf(new Host())).toBe(H_ONLY);
		expect(capabilitiesOf({ overlays: [] })).toBeNull();
		expect(capabilitiesOf(undefined)).toBeNull();
	});
});

describe('describeOverlayForms', () => {
	it('with no capabilities, the whole table without display labels', () => {
		const all = describeOverlayForms();
		expect(Object.keys(all)).toEqual(['line', 'band']);
		expect(Object.keys(all.band)).toEqual(FORMS.band);
		expect(all.band.ribbon).toEqual([
			{ key: 'x', axis: 'x', dynamic: false },
			{ key: 'lower', axis: 'y', dynamic: false },
			{ key: 'upper', axis: 'y', dynamic: false }
		]);
		expect(describeOverlayForms(ALL_OVERLAY_FORMS)).toEqual(all);
		// Byte-identical, not just equal: the generated MCP schema is compared as text.
		expect(JSON.stringify(describeOverlayForms(ALL_OVERLAY_FORMS))).toBe(JSON.stringify(all));
	});

	it('restricted to what a host allows; a kind with no forms is left out', () => {
		expect(describeOverlayForms(H_ONLY)).toEqual({
			line: { horizontal: [{ key: 'at', axis: 'y', dynamic: false }] },
			band: {
				horizontal: [
					{ key: 'lower', axis: 'y', dynamic: false },
					{ key: 'upper', axis: 'y', dynamic: false }
				]
			}
		});
		expect(Object.keys(describeOverlayForms(LINES_ONLY))).toEqual(['line']);
	});
});

describe('normalizeOverlaySpecs', () => {
	it('no capabilities: every kind and form, as before capabilities existed', () => {
		const out = normalizeOverlaySpecs(
			[
				{ kind: 'line', channels: { at: 'a' }, label: 'alert' },
				{ kind: 'band', form: 'repeating', nightDurationHours: 10 }
			],
			resolveCol
		);
		expect(out).toEqual([
			{
				kind: 'line',
				form: 'vertical',
				channels: { at: { columns: [{ refId: 1 }], typed: [] } },
				label: 'alert'
			},
			{ kind: 'band', form: 'repeating', channels: {}, nightDurationHours: 10 }
		]);
	});

	it("an omitted form takes the HOST's default (a horizontal line on an H-only host)", () => {
		const [line] = normalizeOverlaySpecs(
			[{ kind: 'line', channels: { at: 3 } }],
			resolveCol,
			H_ONLY
		);
		expect(line).toEqual({
			kind: 'line',
			form: 'horizontal',
			channels: { at: { columns: [], typed: [3] } }
		});
	});

	it('a form the host does not allow is an error naming the allowed forms', () => {
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'line', form: 'vertical' }], resolveCol, H_ONLY)
		).toThrow('overlays[0].form for a line must be one of horizontal (got "vertical").');
	});

	it('a kind the host does not allow is an error naming the allowed kinds', () => {
		expect(() =>
			normalizeOverlaySpecs(
				[{ kind: 'line', form: 'vertical' }, { kind: 'band' }],
				resolveCol,
				LINES_ONLY
			)
		).toThrow('overlays[1].kind must be one of line (got "band").');
	});

	it('channel errors and the multi-column `at` split are unchanged', () => {
		expect(() =>
			normalizeOverlaySpecs([{ kind: 'band', form: 'horizontal', channels: { x: 1 } }], resolveCol)
		).toThrow('overlays[0].channels.x: a band of form "horizontal" has channels lower, upper.');
		const split = normalizeOverlaySpecs(
			[{ kind: 'line', name: 'Alerts', channels: { at: ['a', 'b'] } }],
			resolveCol
		);
		expect(split.map((o) => [o.name, o.channels.at.columns])).toEqual([
			['Alerts', [{ refId: 1 }]],
			[undefined, [{ refId: 2 }]]
		]);
	});

	it('column bundling helpers', () => {
		const jsons = normalizeOverlaySpecs(
			[{ kind: 'band', form: 'ribbon', channels: { x: 'a', lower: 'b', upper: [4, 5] } }],
			resolveCol
		);
		expect(overlayColumnIds(jsons)).toEqual([1, 2]);
		const remapped = remapOverlayColumnIds(jsons, new Map([[1, 10]]));
		expect(remapped[0].channels.x.columns).toEqual([{ refId: 10 }]);
		expect(remapped[0].channels.lower.columns).toEqual([{ refId: 2 }]);
		expect(remapped[0].channels.upper.typed).toEqual([4, 5]);
	});
});
