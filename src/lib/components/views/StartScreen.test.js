import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

// The screen's collaborators all reach outside it (network, session loader, import modal). Stub
// them: what is under test is the screen's HIERARCHY and the decisions it makes, not the loading.
const openExample = vi.fn(async () => {});
const openSessionFile = vi.fn(async () => {});
const pickSessionFile = vi.fn(async () => ({ status: 'unsupported' }));
const simulateData = vi.fn();
const loadExampleManifest = vi.fn(async () => [
	['Rhythm & circadian', [{ id: 'rest-activity', name: 'Rest–activity', summary: 'A rhythm run.' }]],
	['General statistics', [{ id: 'stats-anova', name: 'One-way ANOVA', summary: 'Three groups.' }]]
]);
vi.mock('$lib/start/startActions.js', () => ({
	openExample: (...a) => openExample(...a),
	// Pure formatting; the real one is unit-tested in startActions.test.js.
	displayName: (n) => (n ?? '').replace(/^Workflow\s*—\s*/, ''),
	openSessionFile: (...a) => openSessionFile(...a),
	pickSessionFile: (...a) => pickSessionFile(...a),
	simulateData: (...a) => simulateData(...a),
	loadExampleManifest: (...a) => loadExampleManifest(...a),
	notifyFailure: vi.fn()
}));
const openImportData = vi.fn();
const openImportDataFiles = vi.fn();
vi.mock('$lib/core/dataSourceActions.js', () => ({
	openImportData: (...a) => openImportData(...a),
	openImportDataFiles: (...a) => openImportDataFiles(...a)
}));
vi.mock('$lib/core/tourRunner.svelte.js', () => ({ openPicker: vi.fn() }));

import StartScreen from './StartScreen.svelte';
import { recordRecent, loadRecents } from '$lib/start/recentSessions.svelte.js';

// jsdom has no Web Animations API; Modal's open transition calls element.animate().
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

afterEach(() => cleanup());
beforeEach(() => {
	window.localStorage.clear();
	loadRecents();
	vi.clearAllMocks();
	pickSessionFile.mockResolvedValue({ status: 'unsupported' });
});

describe('hierarchy', () => {
	it('offers import and load as the two primary actions', async () => {
		render(StartScreen);
		expect(screen.getByRole('button', { name: /import data/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /load session/i })).toBeTruthy();
	});

	it('keeps simulate and AI as quieter secondary actions, not primary cards', () => {
		const { container } = render(StartScreen);
		const primaries = container.querySelectorAll('.primary-card');
		expect(primaries).toHaveLength(2); // exactly two things carry primary weight
		expect(container.querySelector('.secondary-row')).toBeTruthy();
	});

	it('groups the examples, rhythm before statistics', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.group-label').length).toBe(2));
		const titles = [...container.querySelectorAll('.group-label')].map((h) => h.textContent);
		expect(titles).toEqual(['Rhythm & circadian', 'General statistics']);
	});

	it('gives each example exactly one action, with no nested buttons', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-card')).toBeTruthy());
		const card = container.querySelector('.example-card');
		expect(card.querySelector('.card-overlay')).toBeTruthy();
		// A button inside a button is invalid HTML and breaks keyboard order.
		expect(card.querySelector('button button')).toBeNull();
		expect(card.querySelectorAll('button')).toHaveLength(1);
	});
});

describe('recents', () => {
	it('promotes the tour into the Recent slot when there is no history', async () => {
		const { container } = render(StartScreen);
		// A first-time visitor should not be shown a section about a list they haven't got yet.
		expect(screen.queryByText(/^Recent$/)).toBeNull();
		expect(screen.queryByRole('button', { name: /clear list/i })).toBeNull();
		// ...and the tour sits high, above the example library, rather than at the bottom.
		const labels = [...container.querySelectorAll('.section-label')].map((n) => n.textContent);
		expect(labels[0]).toBe('New here?');
		expect(labels.indexOf('New here?')).toBeLessThan(labels.indexOf('Example sessions'));
	});

	it('demotes the tour below the examples once there is history', async () => {
		await recordRecent({ id: 'file::a.json', name: 'Cohort A' });
		const { container } = render(StartScreen);
		await waitFor(() => expect(screen.getByText('Cohort A')).toBeTruthy());
		const labels = [...container.querySelectorAll('.section-label')].map((n) => n.textContent);
		expect(labels[0]).toBe('Recent');
		expect(labels.indexOf('New here?')).toBeGreaterThan(labels.indexOf('Example sessions'));
	});

	it('lists a recorded session', async () => {
		await recordRecent({ id: 'file::a.json', name: 'Cohort A', meta: '4 columns · 1 plot' });
		render(StartScreen);
		await waitFor(() => expect(screen.getByText('Cohort A')).toBeTruthy());
		expect(screen.getByText(/4 columns/)).toBeTruthy();
	});

	it('reopens an example row by url without going near a file picker', async () => {
		await recordRecent({ id: 'example::stats-anova', name: 'One-way ANOVA', url: 'demos/a.json' });
		render(StartScreen);
		await waitFor(() => expect(screen.getByText('One-way ANOVA')).toBeTruthy());
		await fireEvent.click(screen.getByText('One-way ANOVA'));
		await waitFor(() => expect(openExample).toHaveBeenCalled());
		expect(pickSessionFile).not.toHaveBeenCalled();
	});

	it('requires confirmation before clearing the list', async () => {
		await recordRecent({ id: 'file::a.json', name: 'Cohort A' });
		render(StartScreen);
		await waitFor(() => expect(screen.getByText('Cohort A')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: /clear list/i }));
		expect(loadRecents()).toHaveLength(1); // nothing destroyed on the first click
		expect(screen.getByText(/Clear recent sessions\?/i)).toBeTruthy();
	});
});

describe('dismissing', () => {
	it('offers a blank canvas as an explicit way out', async () => {
		const onDismiss = vi.fn();
		render(StartScreen, { props: { onDismiss } });
		await fireEvent.click(screen.getByRole('button', { name: /blank canvas/i }));
		expect(onDismiss).toHaveBeenCalled();
	});

	it('dismisses on Escape', async () => {
		const onDismiss = vi.fn();
		render(StartScreen, { props: { onDismiss } });
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onDismiss).toHaveBeenCalled();
	});

	it('does not dismiss on Escape while a child dialog is open', async () => {
		const onDismiss = vi.fn();
		render(StartScreen, { props: { onDismiss } });
		await fireEvent.click(screen.getByRole('button', { name: /build a workload with ai/i }));
		await fireEvent.keyDown(window, { key: 'Escape' });
		// The AI dialog owns that Escape; closing it must not also close the start screen.
		expect(onDismiss).not.toHaveBeenCalled();
	});
});

describe('load session', () => {
	it('falls back to the file-input modal when the browser has no handle picker', async () => {
		render(StartScreen);
		await fireEvent.click(screen.getByRole('button', { name: /load session/i }));
		await waitFor(() => expect(pickSessionFile).toHaveBeenCalled());
		expect(openSessionFile).not.toHaveBeenCalled();
	});

	it('loads directly, with the handle, when the picker is available', async () => {
		const handle = {};
		pickSessionFile.mockResolvedValue({ status: 'ok', file: { name: 's.json' }, handle });
		render(StartScreen);
		await fireEvent.click(screen.getByRole('button', { name: /load session/i }));
		await waitFor(() => expect(openSessionFile).toHaveBeenCalledWith({ name: 's.json' }, handle));
	});

	it('does nothing at all when the user dismisses the picker', async () => {
		pickSessionFile.mockResolvedValue({ status: 'cancelled' });
		render(StartScreen);
		await fireEvent.click(screen.getByRole('button', { name: /load session/i }));
		await waitFor(() => expect(pickSessionFile).toHaveBeenCalled());
		expect(openSessionFile).not.toHaveBeenCalled();
	});
});
