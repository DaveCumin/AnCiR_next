// A plot's PUBLIC PORT names are not the field names it PERSISTS. This test pins that
// contract for every registered plot.
//
// `defaultDataInputs` are what the UI calls each input: Actogram/Periodogram/FFT/Correlogram
// advertise `time`/`values`. But those classes persist each series as generic `x`/`y` — their
// `fromJSON` reads `json.x`/`json.y` and nothing else — because the workflow graph's edge
// detection (`ProcessNode.svelte.js`) hardcodes `dp?.x?.refId` / `dp?.y?.refId` /
// `dp?.column?.refId`, so series fields cannot be arbitrary.
//
// Conflating the two vocabularies is not hypothetical. A session emitter wrote the PORT names
// as storage keys; every input came back `refId: -1`, so an actogram loaded silently unwired
// and then threw "Cannot read properties of undefined (reading 'left')" at render. The rule
// was documented only in a comment inside CircularPhase.svelte, and the only executable guard
// lived in the separate mcp emitter — so the app itself could drift and nothing would notice.
//
// The rule (mirrors `storageField()` in mcp/src/emit/normalizer.js):
//   2 inputs  -> stored positionally as `x`, `y`
//   1 input   -> stored under its own name (histogram: `column`)
//   0 inputs  -> no series at all (tableplot, dataview)
import { describe, it, expect, beforeAll } from 'vitest';
import { loadPlots } from './plotMap.js';

/** The field a plot stores its i-th input under, given its public port names. */
export function storageFieldFor(ports, i) {
	if (ports.length === 2) return i === 0 ? 'x' : 'y';
	return ports[i];
}

let plotMap;
beforeAll(async () => {
	plotMap = await loadPlots();
});

describe('plot port names vs stored field names', () => {
	it('covers the whole registry', () => {
		expect(plotMap.size).toBeGreaterThanOrEqual(10);
	});

	it('every plot reads back a series written with its STORAGE field names', () => {
		const failures = [];
		for (const [key, entry] of plotMap) {
			const ports = entry.defaultInputs ?? [];
			if (ports.length === 0) continue; // tableplot / dataview take a column list

			// Build the inner the way a tool must write it.
			const series = {};
			ports.forEach((_, i) => {
				series[storageFieldFor(ports, i)] = { refId: 100 + i };
			});

			const inst = entry.data.fromJSON(null, { data: [series] });
			const d = inst?.data?.[0];
			if (!d) {
				failures.push(`${key}: fromJSON produced no series at all`);
				continue;
			}
			ports.forEach((_, i) => {
				const field = storageFieldFor(ports, i);
				const got = d[field]?.refId;
				if (got !== 100 + i) {
					failures.push(`${key}.${field}: refId ${got} (expected ${100 + i}) — wiring lost`);
				}
			});
		}
		expect(failures, failures.join('\n')).toEqual([]);
	});

	it('a series written with PORT names ALSO wires (belt and braces)', () => {
		// Storage names are the contract, but writing the port names is the obvious mistake and
		// its failure mode was terrible: a silently unwired plot that crashed at render.
		// CircularPhase already accepted both; the whole family now does, so the mistake is
		// impossible rather than merely detectable.
		const timeValues = [...plotMap].filter(([, e]) => {
			const ports = e.defaultInputs ?? [];
			return ports.length === 2 && ports[0] !== 'x';
		});
		expect(timeValues.length, 'expected some time/values plots to exist').toBeGreaterThan(0);

		const failures = [];
		for (const [key, entry] of timeValues) {
			const ports = entry.defaultInputs;
			const byPortName = { [ports[0]]: { refId: 100 }, [ports[1]]: { refId: 101 } };
			const d = entry.data.fromJSON(null, { data: [byPortName] })?.data?.[0];
			if (d?.x?.refId !== 100 || d?.y?.refId !== 101) {
				failures.push(
					`${key}: port-named series did not wire (x=${d?.x?.refId}, y=${d?.y?.refId}). ` +
						`Check the series fromJSON does not re-map {x: json.x} before the constructor.`
				);
			}
		}
		expect(failures, failures.join('\n')).toEqual([]);
	});

	it('the storage rule itself is what the emitter implements', () => {
		expect(storageFieldFor(['time', 'values'], 0)).toBe('x');
		expect(storageFieldFor(['time', 'values'], 1)).toBe('y');
		expect(storageFieldFor(['x', 'y'], 0)).toBe('x');
		expect(storageFieldFor(['column'], 0)).toBe('column');
	});
});
