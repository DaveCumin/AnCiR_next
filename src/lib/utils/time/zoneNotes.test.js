// The mixed-zone sentences, shared by the app's panels (JoinData.svelte, Actogram.svelte,
// Scatterplot.svelte) and the MCP's check_draft (mcp/src/emit/timeColumns.js), and the pure
// zone-name module the MCP Worker loads instead of zones.js (per-column time zone, phase 4).
import { describe, it, expect } from 'vitest';
import { joinZoneNotes, actogramMixedZonesNote, axisMixedZonesNote } from './zoneNotes.js';
import { joinZoneNotes as fromJoinData } from '../joinData.js';
import * as names from './zoneNames.js';
import * as zones from './zones.js';

const NZ = 'Pacific/Auckland';
const clock = (named, wall = false) => ({ named, wall, legacy: false });

describe('zoneNotes', () => {
	it('joinData.js re-exports the one joinZoneNotes', () => {
		expect(fromJoinData).toBe(joinZoneNotes);
	});

	it('Join Data: summary and warnings', () => {
		expect(joinZoneNotes(clock('utc', true), clock('utc', true))).toEqual({
			summary: '',
			warning: null
		});
		expect(joinZoneNotes(clock(NZ), clock(NZ))).toEqual({
			summary: "Joined times are in A's zone (Pacific/Auckland).",
			warning: null
		});
		expect(joinZoneNotes(clock(NZ), clock('utc', true)).warning).toBe(
			"B's times have no zone, so they are read as UTC. If they were recorded in Pacific/Auckland time, set B's zone (in its column's Properties) and the two line up."
		);
		expect(joinZoneNotes(clock(NZ), clock('+05:30'), 7).warning).toBe(
			"A's times are in Pacific/Auckland and B's in UTC+05:30 (fixed); each is read in its own zone, so they already line up and the zones account for the difference: check the 7 h shift."
		);
		expect(joinZoneNotes({ ...clock(NZ), legacy: true }, clock('utc'))).toEqual({
			summary: '',
			warning: null
		});
	});

	it('plots', () => {
		expect(actogramMixedZonesNote(NZ)).toBe(
			"The series' times are in different zones; the rows follow Pacific/Auckland, the first series' zone."
		);
		expect(actogramMixedZonesNote('+05:30')).toBe(
			"The series' times are in different zones; the rows follow UTC+05:30 (fixed), the first series' zone."
		);
		expect(axisMixedZonesNote('UTC')).toBe(
			"The series' times are in different zones; the x axis shows UTC, the first series' zone."
		);
	});
});

describe('zoneNames (pure) is what zones.js exports', () => {
	it('the same functions', () => {
		for (const k of [
			'UTC_ZONE',
			'isFixedOffset',
			'fixedOffsetMinutes',
			'formatFixedOffset',
			'normalizeZone',
			'zoneLabel'
		]) {
			expect(zones[k], k).toBe(names[k]);
		}
	});

	it('normalises and refuses zones', () => {
		expect(names.normalizeZone('GMT')).toBe('utc');
		expect(names.normalizeZone('+0530')).toBe('+05:30');
		expect(names.normalizeZone('-00:00')).toBe('utc');
		expect(names.normalizeZone('+15:00')).toBe(null);
		expect(names.normalizeZone(NZ)).toBe(NZ);
		expect(names.normalizeZone('Mars/Olympus')).toBe(null);
		expect(names.isIanaZone('Europe/London')).toBe(true);
		expect(names.zoneLabel('+12:45')).toBe('UTC+12:45 (fixed)');
	});
});
