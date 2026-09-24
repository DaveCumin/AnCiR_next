// @ts-nocheck
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	fetchAppAsset,
	isOfflineFile,
	describeAssetError,
	AppAssetUnavailableError,
	EXAMPLES_UNAVAILABLE_MESSAGE,
	OFFLINE_FILE_NOTE
} from './offline.js';

afterEach(() => vi.unstubAllGlobals());

const asFile = () => vi.stubGlobal('location', { protocol: 'file:' });
const asHttp = () => vi.stubGlobal('location', { protocol: 'https:' });

describe('fetchAppAsset', () => {
	it('does not even try a relative fetch from the offline file (file://)', async () => {
		asFile();
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		expect(isOfflineFile()).toBe(true);
		const err = await fetchAppAsset('./sessions/demos/index.json').catch((e) => e);
		expect(err).toBeInstanceOf(AppAssetUnavailableError);
		expect(err.message).toBe(`${EXAMPLES_UNAVAILABLE_MESSAGE} ${OFFLINE_FILE_NOTE}`);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('still fetches absolute http(s) URLs from file://', async () => {
		asFile();
		const ok = { ok: true, json: async () => ({}) };
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ok)
		);
		await expect(fetchAppAsset('https://example.org/s.json')).resolves.toBe(ok);
	});

	it('turns a network failure into the friendly message', async () => {
		asHttp();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
		);
		const err = await fetchAppAsset('/sessions/demos/index.json').catch((e) => e);
		expect(err).toBeInstanceOf(AppAssetUnavailableError);
		expect(err.message).toBe(EXAMPLES_UNAVAILABLE_MESSAGE);
	});

	it('reports an HTTP error status as a plain error', async () => {
		asHttp();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404 }))
		);
		const err = await fetchAppAsset('/missing.json').catch((e) => e);
		expect(err).not.toBeInstanceOf(AppAssetUnavailableError);
		expect(describeAssetError(err)).toBe('Could not load the example library (HTTP 404).');
	});
});
