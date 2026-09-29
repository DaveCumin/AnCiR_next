// @ts-nocheck
/**
 * The stored-value migration for actogram marker blocks (plan
 * docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md, 5.2), keyed on USE.
 *
 * Driven over src/test/fixtures/facet-actogram-markers.json, captured by the app (open the
 * session, save): it carries all eight legacy entries (tau_, phi_, marker_r_squared_,
 * marker_rmse_ for marker_0 and marker_1), registered by merely opening the blocks, and no
 * consumer of any of them. The "used" cases add a consumer to that captured JSON in the
 * exact shapes the three consumer nodes persist (FormulaColumn tokens, BlankColumn
 * storedValueRefs, StoredValueGroup groups[].keys), so what is migrated is what the app wrote.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateFacetChildren } from './facetMigration.js';
import {
	migratePhaseMarkerStoredValues,
	referencedStoredValueNames,
	parseLegacyName,
	promoteStoredValueOps
} from './phaseMarkerStoredValueMigration.js';

const FIXTURE = join(process.cwd(), 'src', 'test', 'fixtures', 'facet-actogram-markers.json');
const LEGACY = [
	'tau_marker_0',
	'phi_marker_0',
	'marker_r_squared_marker_0',
	'marker_rmse_marker_0',
	'tau_marker_1',
	'phi_marker_1',
	'marker_r_squared_marker_1',
	'marker_rmse_marker_1'
];

/** The fixture as importJson sees it: after the facet migration. */
function loaded() {
	const json = JSON.parse(readFileSync(FIXTURE, 'utf8'));
	return migrateFacetChildren(json).json;
}
const formula = (id, keys) => ({
	id,
	name: 'FormulaColumn',
	args: { tokens: keys.map((key) => ({ type: 'stored', key })), out: {} }
});

describe('parse and scan', () => {
	it('parses the four legacy prefixes, longest first', () => {
		expect(parseLegacyName('marker_r_squared_marker_0')).toEqual({ stat: 'r2', stem: 'marker_0' });
		expect(parseLegacyName('marker_rmse_x')).toEqual({ stat: 'rmse', stem: 'x' });
		expect(parseLegacyName('tau_Onsets')).toEqual({ stat: 'tau', stem: 'Onsets' });
		expect(parseLegacyName('phi_')).toBeNull();
		expect(parseLegacyName('cosinor_amp')).toBeNull();
	});

	it('finds names used by all three consumer shapes', () => {
		const used = referencedStoredValueNames([
			formula(1, ['a']),
			{ id: 2, name: 'BlankColumn', args: { storedValueRefs: { 0: 'b', 3: 'c' } } },
			{ id: 3, name: 'StoredValueGroup', args: { groups: [{ keys: ['d'] }, { keys: null }] } },
			{ id: 4, name: 'X', args: null }
		]);
		expect([...used].sort()).toEqual(['a', 'b', 'c', 'd']);
	});
});

describe('on the captured fixture', () => {
	it('carries eight legacy entries, none used: all dropped, no warning', () => {
		const json = loaded();
		for (const n of LEGACY) expect(json.storedValues[n], n).toBeTruthy();
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const out = migratePhaseMarkerStoredValues(json);
		expect(out.warnings).toEqual([]);
		expect(out.dropped.sort()).toEqual([...LEGACY].sort());
		for (const n of LEGACY) expect(out.json.storedValues[n], n).toBeUndefined();
		// Every other stored value is untouched.
		const others = Object.keys(json.storedValues).filter((n) => !LEGACY.includes(n));
		expect(others.length).toBeGreaterThan(0);
		for (const n of others) expect(out.json.storedValues[n]).toBe(json.storedValues[n]);
		expect(info).toHaveBeenCalledOnce();
		info.mockRestore();
		// Pure: the input is not mutated.
		expect(json.storedValues.tau_marker_0).toBeTruthy();
	});

	it('a USED value from an own block (no rule) is kept as its number and reported verbatim', () => {
		const json = loaded();
		json.tableProcesses = [...json.tableProcesses, formula(9001, ['tau_marker_0', 'phi_marker_0'])];
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const out = migratePhaseMarkerStoredValues(json);
		expect(out.kept.sort()).toEqual(['phi_marker_0', 'tau_marker_0']);
		expect(out.mapped).toEqual([]);
		expect(out.json.storedValues.tau_marker_0).toEqual(json.storedValues.tau_marker_0);
		expect(out.dropped).toHaveLength(6);
		const gen = json.plots.find((p) => p.type === 'actogram' && p.facet);
		expect(out.warnings).toEqual([
			`Stored values tau_marker_0, phi_marker_0 from actogram "${gen.name}" are now fixed at ` +
				`their saved numbers: marker blocks no longer publish stored values. To keep them ` +
				`live, use "Make rule" on that block and wire the rule's τ, φ, R² or RMSE output instead.`
		]);
	});

	it('a USED value whose name is a live RULE becomes a plot ref to its output column', () => {
		const json = loaded();
		const gen = json.plots.find((p) => p.type === 'actogram' && p.facet);
		// A Phase-A-era session: rule r1 "Onsets" on both series, and its buttons' names.
		gen.plot.markerRules = [{ id: 'r1', name: 'Onsets', type: 'onset' }];
		gen.plot.nextRuleId = 2;
		const src = 'Actogram phase marker (Onsets)';
		json.storedValues = {
			...json.storedValues,
			tau_Onsets: { source: src, staticValue: 24.1 },
			phi_Onsets_2: { source: src, staticValue: 6.2 },
			marker_rmse_Onsets: { source: src, staticValue: 0.3 },
			tau_Onsets_7: { source: src, staticValue: 1 }
		};
		json.tableProcesses = [
			...json.tableProcesses,
			formula(9001, ['tau_Onsets', 'phi_Onsets_2', 'tau_Onsets_7']),
			{ id: 9002, name: 'StoredValueGroup', args: { groups: [{ keys: ['marker_rmse_Onsets'] }] } }
		];
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const out = migratePhaseMarkerStoredValues(json);
		const sv = out.json.storedValues;
		// Base name: the first mounted instance (series 0); `_2`: the second (series 1).
		expect(sv.tau_Onsets.ref).toEqual({ plotId: gen.id, outKey: 'r1_tau', index: 0 });
		expect(sv.phi_Onsets_2.ref).toEqual({ plotId: gen.id, outKey: 'r1_phi', index: 1 });
		expect(sv.marker_rmse_Onsets.ref).toEqual({ plotId: gen.id, outKey: 'r1_rmse', index: 0 });
		expect(sv.tau_Onsets.staticValue).toBe(24.1);
		// There is no seventh instance: kept and reported.
		expect(out.kept).toEqual(['tau_Onsets_7']);
		expect(out.warnings).toHaveLength(1);
		expect(out.warnings[0]).toContain('tau_Onsets_7');
	});

	it('a detached block with a live fromRule maps onto its rule at ITS series', () => {
		const json = loaded();
		const gen = json.plots.find((p) => p.type === 'actogram' && p.facet);
		gen.plot.markerRules = [{ id: 'r4', name: 'Offsets', type: 'offset' }];
		// Series 1 detached from r4: its own block carries the rule's name and fromRule.
		gen.plot.data[1].detachedRules = ['r4'];
		gen.plot.data[1].phaseMarkers = [{ name: 'Offsets', type: 'offset', fromRule: 'r4' }];
		json.storedValues = {
			...json.storedValues,
			phi_Offsets: { source: 'Actogram phase marker (Offsets)', staticValue: 3 },
			phi_Offsets_2: { source: 'Actogram phase marker (Offsets)', staticValue: 4 }
		};
		json.tableProcesses = [...json.tableProcesses, formula(9001, ['phi_Offsets', 'phi_Offsets_2'])];
		vi.spyOn(console, 'info').mockImplementation(() => {});
		const out = migratePhaseMarkerStoredValues(json);
		// Data-tab order: series 0's instance, then series 1's detached block.
		expect(out.json.storedValues.phi_Offsets.ref).toEqual({
			plotId: gen.id,
			outKey: 'r4_phi',
			index: 0
		});
		expect(out.json.storedValues.phi_Offsets_2.ref).toEqual({
			plotId: gen.id,
			outKey: 'r4_phi',
			index: 1
		});
	});

	it('leaves a session without legacy values exactly as it was', () => {
		const json = { storedValues: { a: { source: 'NPCRA', staticValue: 1 } }, plots: [] };
		const out = migratePhaseMarkerStoredValues(json);
		expect(out.json).toBe(json);
		expect(out.warnings).toEqual([]);
	});
});

describe('promote ops', () => {
	it("re-points exactly the block's own legacy names, with the source the buttons wrote", () => {
		const sv = {
			tau_marker_3: { source: 'Actogram phase marker (marker_3)', staticValue: 24 },
			phi_marker_3: { source: 'Actogram phase marker (other)', staticValue: 6 },
			marker_r_squared_marker_3: {
				source: 'Actogram phase marker (marker_3)',
				ref: { plotId: 1, outKey: 'r1_r2', index: 0 }
			}
		};
		const ops = promoteStoredValueOps(sv, [{ name: 'marker_3', index: 2 }], {
			plotId: 5,
			ruleId: 'r2',
			ruleName: 'marker_3'
		});
		expect(ops).toEqual([
			{
				kind: 'setStoredValue',
				name: 'tau_marker_3',
				entry: {
					source: 'Actogram marker rule (marker_3)',
					ref: { plotId: 5, outKey: 'r2_tau', index: 2 },
					staticValue: 24
				}
			}
		]);
	});
});
