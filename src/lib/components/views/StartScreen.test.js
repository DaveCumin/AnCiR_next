import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

// The screen's collaborators all reach outside it (network, session loader, import modal). Stub
// them: what is under test is the screen's HIERARCHY and the decisions it makes, not the loading.
const openExample = vi.fn(async () => {});
const openSessionFile = vi.fn(async () => {});
const pickSessionFile = vi.fn(async () => ({ status: 'unsupported' }));
const loadExampleManifest = vi.fn(async () => [
	[
		'Rhythm & circadian',
		[
			{ id: 'rest-activity', name: 'Rest–activity', summary: 'A rhythm run.' },
			{ id: 'free-running', name: 'Free-running period', summary: 'Measure tau with no zeitgeber.' },
			{ id: 'circatidal', name: 'Circatidal rhythm', summary: 'A tidal rhythm, not circadian.' }
		]
	],
	[
		'General statistics',
		[
			{ id: 'stats-anova', name: 'One-way ANOVA', summary: 'Three groups.' },
			{ id: 'stats-chi', name: 'Chi-square', summary: 'Categorical association.' }
		]
	],
	['Reading the output', [{ id: 'arrhythmic', name: 'Arrhythmic record', summary: 'The negative control.' }]]
]);
vi.mock('$lib/start/startActions.js', () => ({
	openExample: (...a) => openExample(...a),
	// Pure formatting; the real one is unit-tested in startActions.test.js.
	displayName: (n) => (n ?? '').replace(/^Workflow\s*—\s*/, ''),
	openSessionFile: (...a) => openSessionFile(...a),
	pickSessionFile: (...a) => pickSessionFile(...a),
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

	it('gives all four actions equal weight and keeps no leftover chip row', () => {
		const { container } = render(StartScreen);
		expect(container.querySelectorAll('.primary-card')).toHaveLength(4);
		// Simulate was removed to buy back vertical space; it stays reachable from the node palette.
		expect(screen.queryByRole('button', { name: /simulate/i })).toBeNull();
	});

	it('shows one mixed row: two examples from each group, each labelled with its group', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-card').length).toBeGreaterThan(0));
		// Interleaved (one from each group, then the second from each) rather than three adjacent
		// pairs — and a group holding only one example contributes only one card, so the row is
		// built from the groups rather than sliced off a flat list.
		const caps = [...container.querySelectorAll('.example-group')].map((n) => n.textContent);
		expect(caps).toEqual(['Rhythm', 'Statistics', 'Reading output', 'Rhythm', 'Statistics']);
		expect(container.querySelectorAll('.example-card')).toHaveLength(5);
		expect(container.querySelector('.group-label')).toBeNull(); // no group heading rows any more
	});

	it('has no ghost card', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-card')).toBeTruthy());
		expect(screen.queryByText(/Something else\?/)).toBeNull();
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
	it('hides the Recent section entirely when there is no history', async () => {
		const { container } = render(StartScreen);
		expect(screen.queryByText(/^Recent$/)).toBeNull();
		expect(screen.queryByRole('button', { name: /clear list/i })).toBeNull();
		// The tour takes that space and stays above the gallery, so the CTA is above the fold.
		const labels = [...container.querySelectorAll('.section-label')].map((n) => n.textContent);
		expect(labels[0]).toBe('New here?');
		expect(labels.indexOf('New here?')).toBeLessThan(labels.indexOf('Example sessions'));
	});

	it('keeps the tour above the gallery even once there is history', async () => {
		await recordRecent({ id: 'file::a.json', name: 'Cohort A' });
		const { container } = render(StartScreen);
		await waitFor(() => expect(screen.getByText('Cohort A')).toBeTruthy());
		const labels = [...container.querySelectorAll('.section-label')].map((n) => n.textContent);
		expect(labels).toEqual(['Recent', 'New here?', 'Example sessions']);
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

describe('search', () => {
	const type = async (value) => {
		const box = screen.getByRole('searchbox', { name: /search example/i });
		await fireEvent.input(box, { target: { value } });
		return box;
	};

	it('filters across ALL examples, not just the six on show', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-card').length).toBe(5));
		// "Chi-square" is not in the featured row (it is the 2nd of its group, so it is — use the
		// 3rd rhythm example instead, which the mixed row never shows).
		expect(screen.queryByText('Circatidal rhythm')).toBeNull();
		await type('tidal');
		await waitFor(() => expect(screen.getByText('Circatidal rhythm')).toBeTruthy());
		expect(container.querySelectorAll('.example-card')).toHaveLength(1);
	});

	it('matches on the summary and on the group name, not just the title', async () => {
		render(StartScreen);
		await waitFor(() => expect(screen.getByText('Rest–activity')).toBeTruthy());
		await type('zeitgeber'); // summary only
		await waitFor(() => expect(screen.getByText('Free-running period')).toBeTruthy());
		await type('reading'); // group only
		await waitFor(() => expect(screen.getByText('Arrhythmic record')).toBeTruthy());
	});

	it('reports how many of the full library matched', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-card')).toBeTruthy());
		expect(container.querySelector('.search-count')).toBeNull(); // silent until searching
		await type('rhythm');
		await waitFor(() => expect(container.querySelector('.search-count')).toBeTruthy());
		expect(container.querySelector('.search-count').textContent).toMatch(/of 6$/);
	});

	it('explains an empty result instead of showing a blank area', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-card')).toBeTruthy());
		await type('zzzznothing');
		await waitFor(() => expect(container.querySelectorAll('.example-card')).toHaveLength(0));
		expect(screen.getByText(/Nothing matches/)).toBeTruthy();
	});

	it('lets Escape clear the query before it closes the screen', async () => {
		const onDismiss = vi.fn();
		const { container } = render(StartScreen, { props: { onDismiss } });
		await waitFor(() => expect(container.querySelector('.example-card')).toBeTruthy());
		await type('tidal');
		await fireEvent.keyDown(window, { key: 'Escape' });
		// First Escape clears the search; the screen stays open.
		expect(onDismiss).not.toHaveBeenCalled();
		await waitFor(() => expect(container.querySelectorAll('.example-card').length).toBe(5));
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onDismiss).toHaveBeenCalled(); // second one dismisses
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
		await fireEvent.click(screen.getByRole('button', { name: /build a session with ai/i }));
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
