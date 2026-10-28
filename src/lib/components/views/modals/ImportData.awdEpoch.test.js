// @ts-nocheck
/**
 * STAT-U1 (2026-10-03 review, "possible issue, not confirmed"): the AWD importer read the
 * header's interval code as code x 15 s. Verdict: PARTLY CONFIRMED. No manufacturer
 * specification was found; pyActigraphy's table (utils/awdInterval.js) agrees with x 15 s for
 * codes 1, 2, 4, 8 and 20 and disagrees for 81 (2 s, read as 1,215 s), C1 (5 s) and C2 (10 s)
 * (both read as 60 s). Fixed to follow the table; an unlisted code keeps the old reading and
 * the user is warned. End to end through the import modal, as a user would load a file.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openImportModalWithFiles, _importTestActions } from './ImportData.svelte';
import { core } from '$lib/core/core.svelte';
import { getColumnById } from '$lib/core/Column.svelte';
import { notifications } from '$lib/core/notifications.svelte.js';
import { awdEpochSeconds, isAwdIntervalCode } from '$lib/utils/awdInterval.js';
import { sniffFileType } from '$lib/utils/fileTypeSniff.js';

const awd = (code) =>
	[
		'participant',
		'13-Jul-2026',
		'12:00',
		code,
		'30',
		'P01',
		'F',
		'10 , 1',
		'20 , 2',
		'30 , 3'
	].join('\n');

async function importedStepSeconds(code) {
	core.data = [];
	await openImportModalWithFiles([new File([awd(code)], 'watch.awd', { type: 'text/plain' })]);
	await _importTestActions().confirmImport();
	const t = getColumnById(core.data.find((c) => c.name === 'DateTime')?.id);
	const ms = Array.from(t.getData());
	return (ms[1] - ms[0]) / 1000;
}

beforeEach(() => {
	notifications.list.length = 0;
});

describe('STAT-U1: AWD epoch-length code', () => {
	it('the table: pyActigraphy frequency_code, case-insensitive', () => {
		expect(awdEpochSeconds('1')).toEqual({ seconds: 15, known: true, code: '1' });
		expect(awdEpochSeconds(' 4 ').seconds).toBe(60);
		expect(awdEpochSeconds(8).seconds).toBe(120);
		expect(awdEpochSeconds('20').seconds).toBe(300);
		expect(awdEpochSeconds('81').seconds).toBe(2);
		expect(awdEpochSeconds('c1').seconds).toBe(5);
		expect(awdEpochSeconds('C2').seconds).toBe(10);
		expect(awdEpochSeconds('3')).toEqual({ seconds: 45, known: false, code: '3' });
		expect(awdEpochSeconds('')).toEqual({ seconds: 60, known: false, code: '' });
		expect(awdEpochSeconds('zz').seconds).toBe(60);
		expect(isAwdIntervalCode('C1')).toBe(true);
		expect(isAwdIntervalCode('zz')).toBe(false);
		expect(isAwdIntervalCode('0')).toBe(false);
	});

	it.each([
		['4', 60],
		['1', 15],
		['20', 300],
		['81', 2],
		['C1', 5],
		['C2', 10]
	])('code %s imports with %i s between rows, and no warning', async (code, seconds) => {
		expect(await importedStepSeconds(code)).toBe(seconds);
		expect(notifications.list.some((n) => /epoch code/.test(JSON.stringify(n)))).toBe(false);
	});

	it('an unlisted code keeps code x 15 s and warns the user', async () => {
		expect(await importedStepSeconds('3')).toBe(45);
		const msgs = notifications.list.map((n) => JSON.stringify(n));
		expect(msgs.some((m) => /epoch code \\"3\\" is not one AnCiR knows/.test(m))).toBe(true);
	});

	it('the content sniffer recognises a C1 header as AWD', () => {
		expect(sniffFileType('watch.txt', awd('C1')).kind).toBe('awd');
	});
});
