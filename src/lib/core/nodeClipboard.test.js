// Cross-tab node copy. The properties worth pinning are the boundaries: what is allowed to
// leave the tab, and what happens to a payload that is not ours or is from another build.
import { describe, it, expect } from 'vitest';
import {
	CLIPBOARD_VERSION,
	ENVELOPE_KIND,
	encodeEnvelope,
	isConfigEntry,
	parseEnvelope,
	partitionEntries
} from './nodeClipboard.js';

const cosinor = { type: 'tableprocess', tpType: 'Cosinor', args: { fixedPeriod: 24 } };
const plot = { type: 'plot', plotData: { type: 'scatterplot' } };
const column = { type: 'data', columnData: { name: 'activity', data: 42 } };

describe('partitionEntries', () => {
	it('separates config nodes from data columns', () => {
		const { config, local } = partitionEntries([cosinor, column, plot]);
		expect(config).toEqual([cosinor, plot]);
		expect(local).toEqual([column]);
	});

	it('treats an unknown type as local rather than letting it out', () => {
		// Fail closed: a type this build does not recognise must not be assumed data-free.
		const { config, local } = partitionEntries([{ type: 'somethingNew' }]);
		expect(config).toHaveLength(0);
		expect(local).toHaveLength(1);
	});
});

describe('groups', () => {
	const emptyGroup = { type: 'group', name: 'G', columns: [] };
	const fullGroup = { type: 'group', name: 'G', columns: [{ name: 'activity', data: 7 }] };

	it('lets an empty group travel — it is pure configuration', () => {
		expect(isConfigEntry(emptyGroup)).toBe(true);
	});

	it('keeps a group holding columns in the tab, like a bare data column', () => {
		expect(isConfigEntry(fullGroup)).toBe(false);
		expect(encodeEnvelope([fullGroup])).toBeNull();
	});

	it('will not accept a data-carrying group smuggled in through an envelope', () => {
		const smuggled = JSON.stringify({
			kind: ENVELOPE_KIND,
			version: CLIPBOARD_VERSION,
			entries: [fullGroup]
		});
		expect(parseEnvelope(smuggled).ok).toBe(false);
	});
});

describe('encodeEnvelope', () => {
	it('carries config nodes and never the data column', () => {
		const text = encodeEnvelope([cosinor, column]);
		const parsed = JSON.parse(text);
		expect(parsed.kind).toBe(ENVELOPE_KIND);
		expect(parsed.version).toBe(CLIPBOARD_VERSION);
		expect(parsed.entries).toEqual([cosinor]);
		// The strongest form of the promise: the column's name is nowhere in the payload.
		expect(text).not.toContain('activity');
	});

	it('returns null when the selection is data only, so nothing is written', () => {
		expect(encodeEnvelope([column])).toBeNull();
		expect(encodeEnvelope([])).toBeNull();
	});
});

describe('parseEnvelope', () => {
	it('round-trips an envelope', () => {
		const res = parseEnvelope(encodeEnvelope([cosinor, plot]));
		expect(res.ok).toBe(true);
		expect(res.entries).toHaveLength(2);
	});

	it('returns null for ordinary text so the caller can fall through', () => {
		// null, NOT an error: most pastes are just text and must not be treated as a failure.
		expect(parseEnvelope('hello')).toBeNull();
		expect(parseEnvelope('{"kind":"something/else"}')).toBeNull();
		expect(parseEnvelope('')).toBeNull();
		expect(parseEnvelope(undefined)).toBeNull();
	});

	it('returns null rather than throwing on malformed JSON that mentions us', () => {
		expect(parseEnvelope(`{"kind":"${ENVELOPE_KIND}"`)).toBeNull();
	});

	it('refuses a payload from another clipboard version, naming both', () => {
		const stale = JSON.stringify({ kind: ENVELOPE_KIND, version: 99, entries: [cosinor] });
		const res = parseEnvelope(stale);
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('99');
		expect(res.reason).toContain(String(CLIPBOARD_VERSION));
	});

	it('refuses an envelope whose entries are all non-config', () => {
		const smuggled = JSON.stringify({
			kind: ENVELOPE_KIND,
			version: CLIPBOARD_VERSION,
			entries: [column]
		});
		const res = parseEnvelope(smuggled);
		expect(res.ok).toBe(false);
	});
});
