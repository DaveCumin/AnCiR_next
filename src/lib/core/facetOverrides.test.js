// @ts-nocheck
// Phase 1 override map (plan 2026-09-26-facets-as-views, section 1.6): the per-type
// axis-limit path set, apply / isOverridden, and the shape guard `Plot.fromJSON`
// and `plotFromJSONRobustness` use.
import { describe, it, expect } from 'vitest';
import {
	OVERRIDABLE_PHASE1,
	overridePathRoot,
	isOverridablePath,
	applyOverride,
	isOverridden,
	isValidOverrideMap,
	sanitiseOverrides
} from '$lib/core/facetOverrides.js';

describe('OVERRIDABLE_PHASE1: the axis-limit key group per plot type', () => {
	it('lists exactly the limit fields each type reads (zoom adapters + limit fields)', () => {
		expect(OVERRIDABLE_PHASE1).toEqual({
			scatterplot: ['xlimsIN', 'ylimsLeftIN', 'ylimsRightIN'],
			histogram: ['xlimsIN', 'ylimsIN'],
			actogram: ['ylimsIN'],
			correlogram: ['laglimsIN', 'ylimsIN'],
			periodogram: ['periodlimsIN', 'ylimsIN'],
			fft: ['xlimsIN', 'ylimsIN', 'phaseYlimsIN']
		});
	});

	it('overridePathRoot strips the index / leaf', () => {
		expect(overridePathRoot('xlimsIN[0]')).toBe('xlimsIN');
		expect(overridePathRoot('paddingIN.top')).toBe('paddingIN');
		expect(overridePathRoot('xlimsIN')).toBe('xlimsIN');
		expect(overridePathRoot('')).toBe('');
	});

	it('isOverridablePath answers per type, whole-array and leaf alike', () => {
		expect(isOverridablePath('scatterplot', 'ylimsLeftIN[1]')).toBe(true);
		expect(isOverridablePath('scatterplot', 'ylimsLeftIN')).toBe(true);
		expect(isOverridablePath('scatterplot', 'padding.top')).toBe(false);
		expect(isOverridablePath('scatterplot', 'ylimsIN[0]')).toBe(false);
		expect(isOverridablePath('histogram', 'ylimsIN[0]')).toBe(true);
		expect(isOverridablePath('fft', 'phaseYlimsIN[0]')).toBe(true);
		expect(isOverridablePath('boxplot', 'ylimsIN[0]')).toBe(false);
		expect(isOverridablePath(undefined, 'xlimsIN[0]')).toBe(false);
	});
});

describe('applyOverride', () => {
	it('writes leaf and whole-array paths onto the projected JSON and returns what it wrote', () => {
		const json = { xlimsIN: [null, null], ylimsLeftIN: [null, null], padding: { top: 15 } };
		const written = applyOverride(json, { 'xlimsIN[1]': 10, ylimsLeftIN: [0, 5] });
		expect(json.xlimsIN).toEqual([null, 10]);
		expect(json.ylimsLeftIN).toEqual([0, 5]);
		expect(written).toEqual(['xlimsIN[1]', 'ylimsLeftIN']);
	});

	it('is a no-op for a missing, empty or malformed override', () => {
		const json = { xlimsIN: [1, 2] };
		expect(applyOverride(json, undefined)).toEqual([]);
		expect(applyOverride(json, null)).toEqual([]);
		expect(applyOverride(json, {})).toEqual([]);
		expect(applyOverride(json, 'xlimsIN')).toEqual([]);
		expect(applyOverride(json, { xlimsIN: { nested: 1 } })).toEqual([]);
		expect(json.xlimsIN).toEqual([1, 2]);
	});

	it('does not copy the override array by reference', () => {
		const lims = [0, 5];
		const json = { ylimsIN: [null, null] };
		applyOverride(json, { ylimsIN: lims });
		lims[0] = 99;
		expect(json.ylimsIN).toEqual([0, 5]);
	});
});

describe('isOverridden', () => {
	const ov = { 'xlimsIN[0]': 3, ylimsLeftIN: [0, 5] };
	it('matches an exact path', () => {
		expect(isOverridden(ov, 'xlimsIN[0]')).toBe(true);
		expect(isOverridden(ov, 'xlimsIN[1]')).toBe(false);
	});
	it('a whole-array override covers every leaf under it', () => {
		expect(isOverridden(ov, 'ylimsLeftIN[0]')).toBe(true);
		expect(isOverridden(ov, 'ylimsLeftIN[1]')).toBe(true);
		expect(isOverridden(ov, 'ylimsLeftIN')).toBe(true);
	});
	it('a leaf override marks its root as (partly) overridden', () => {
		expect(isOverridden(ov, 'xlimsIN')).toBe(true);
	});
	it('answers false for a missing map or unrelated path', () => {
		expect(isOverridden(undefined, 'xlimsIN[0]')).toBe(false);
		expect(isOverridden(null, 'xlimsIN[0]')).toBe(false);
		expect(isOverridden(ov, 'padding.top')).toBe(false);
		expect(isOverridden(ov, '')).toBe(false);
	});
});

describe('sanitiseOverrides / isValidOverrideMap', () => {
	it('passes a well-formed map through untouched (a copy, not the same object)', () => {
		const good = { 'y112#0': { 'xlimsIN[0]': 1, ylimsLeftIN: [0, null], label: 'x', on: true } };
		const { overrides, reason } = sanitiseOverrides(good);
		expect(overrides).toEqual(good);
		expect(overrides).not.toBe(good);
		expect(reason).toBeNull();
		expect(isValidOverrideMap(good)).toBe(true);
	});

	it('an absent map is an empty map with no reason', () => {
		expect(sanitiseOverrides(undefined)).toEqual({ overrides: {}, reason: null });
		expect(sanitiseOverrides({})).toEqual({ overrides: {}, reason: null });
	});

	it.each([
		['null', null],
		['an array', [1, 2]],
		['a string', 'xlimsIN'],
		['a number', 7],
		['a boolean', true]
	])('rejects %s at the top level', (_label, value) => {
		const { overrides, reason } = sanitiseOverrides(value);
		expect(overrides).toEqual({});
		expect(typeof reason).toBe('string');
		expect(reason.length).toBeGreaterThan(0);
		expect(isValidOverrideMap(value)).toBe(false);
	});

	it.each([
		['a non-object entry', { 'y1#0': 3 }],
		['an array entry', { 'y1#0': [1] }],
		['a null entry', { 'y1#0': null }],
		['a nested object value', { 'y1#0': { padding: { top: 1 } } }],
		['an array with an object inside', { 'y1#0': { xlimsIN: [{}, 1] } }],
		['a function value', { 'y1#0': { xlimsIN: () => 1 } }],
		['an empty path', { 'y1#0': { '': 1 } }]
	])('rejects %s and names the offending key', (_label, value) => {
		const { overrides, reason } = sanitiseOverrides(value);
		expect(overrides).toEqual({});
		expect(reason).toContain('y1#0');
		expect(isValidOverrideMap(value)).toBe(false);
	});
});
