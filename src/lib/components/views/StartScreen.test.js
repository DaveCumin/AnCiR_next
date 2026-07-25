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
			{ id: 'phase-groups', name: 'Group phase comparison', summary: 'Two groups, two peaks.' },
			{ id: 'split-rhythm', name: 'Split rhythm', summary: 'Constant light splits the band.' },
			// Deliberately a 5th, so the four-per-column cap has something to hide.
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

// jsdom has no Web Animations API; Modal's open transition calls element.animate().
Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

afterEach(() => cleanup());
beforeEach(() => {
	window.localStorage.clear();
	vi.clearAllMocks();
	pickSessionFile.mockResolvedValue({ status: 'unsupported' });
});

/** Rows under one column heading, in order. */
const rowsIn = (container, label) => {
	const col = [...container.querySelectorAll('.example-column')].find(
		(c) => c.querySelector('.example-group')?.textContent === label
	);
	return [...(col?.querySelectorAll('.example-name') ?? [])].map((n) => n.textContent);
};

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

	it('lays the examples out as one column per group, headed by the group name', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-column').length).toBe(3));
		const heads = [...container.querySelectorAll('.example-group')].map((n) => n.textContent);
		expect(heads).toEqual(['Rhythm and circadian', 'General statistics', 'Reading the output']);
		// The group rides on the column head, so no row repeats it as a caption.
		expect(container.querySelector('.example-card')).toBeNull();
	});

	it('caps each column at four, and holds the rest behind a per-column count', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-row').length).toBeGreaterThan(0));
		// Rhythm holds five, so one is held back; the other two columns are under the cap.
		expect(rowsIn(container, 'Rhythm and circadian')).toHaveLength(4);
		expect(rowsIn(container, 'General statistics')).toHaveLength(2);
		expect(screen.queryByText('Circatidal rhythm')).toBeNull();
		// The header link names the whole library count, not one column's remainder.
		expect(screen.getByRole('button', { name: /show all 8/i })).toBeTruthy();
	});

	it('expands EVERY column when any "more" is pressed, not just its own', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-row').length).toBeGreaterThan(0));
		// Only Rhythm overflows, so it is the only column with a "more" button — but pressing it
		// reveals all columns in full, since the cap is a property of the view, not the group.
		await fireEvent.click(screen.getByRole('button', { name: /1 more example in rhythm/i }));
		await waitFor(() => expect(screen.getByText('Circatidal rhythm')).toBeTruthy());
		expect(rowsIn(container, 'Rhythm and circadian')).toHaveLength(5);
		// The header toggle now offers the way back, and the per-column count is gone.
		expect(screen.getByRole('button', { name: /show fewer/i })).toBeTruthy();
		expect(screen.queryByRole('button', { name: /more example/i })).toBeNull();
	});

	it('toggles the whole gallery from the header link', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelectorAll('.example-row').length).toBeGreaterThan(0));
		await fireEvent.click(screen.getByRole('button', { name: /show all 8/i }));
		await waitFor(() => expect(container.querySelectorAll('.example-row')).toHaveLength(8));
		await fireEvent.click(screen.getByRole('button', { name: /show fewer/i }));
		// Back to the cap: 4 + 2 + 1 = 7 rows on show.
		await waitFor(() => expect(container.querySelectorAll('.example-row')).toHaveLength(7));
	});

	it('has no ghost card', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		expect(screen.queryByText(/Something else\?/)).toBeNull();
	});

	it('gives each example exactly one action, with no nested buttons', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		const row = container.querySelector('.example-row');
		expect(row.querySelector('.example-open')).toBeTruthy();
		// A button inside a button is invalid HTML and breaks keyboard order.
		expect(row.querySelector('button button')).toBeNull();
		expect(row.querySelectorAll('button')).toHaveLength(1);
	});

	it('opens an example from its row', async () => {
		render(StartScreen);
		await waitFor(() => expect(screen.getByText('Rest–activity')).toBeTruthy());
		await fireEvent.click(screen.getByText('Rest–activity'));
		await waitFor(() => expect(openExample).toHaveBeenCalled());
	});

	it('no longer carries a Recent section', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		expect(screen.queryByText(/^Recent$/)).toBeNull();
		expect(screen.queryByRole('button', { name: /clear list/i })).toBeNull();
		// The tour heads the page now that nothing precedes it.
		const labels = [...container.querySelectorAll('.section-label')].map((n) => n.textContent);
		expect(labels).toEqual(['New here?', 'Example sessions']);
	});
});

describe('search', () => {
	const type = async (value) => {
		const box = screen.getByRole('searchbox', { name: /search example/i });
		await fireEvent.input(box, { target: { value } });
		return box;
	};

	it('filters within the columns, ignoring the four-per-column cap', async () => {
		const { container } = render(StartScreen);
		// Capped view shows 7 (4 + 2 + 1); the 5th rhythm example is hidden.
		await waitFor(() => expect(container.querySelectorAll('.example-row').length).toBe(7));
		expect(screen.queryByText('Circatidal rhythm')).toBeNull();
		// A search surfaces it even though it lives past the cap, and in its own column.
		await type('tidal');
		await waitFor(() => expect(screen.getByText('Circatidal rhythm')).toBeTruthy());
		expect(container.querySelectorAll('.example-row')).toHaveLength(1);
		expect(rowsIn(container, 'Rhythm and circadian')).toEqual(['Circatidal rhythm']);
	});

	it('keeps every column heading while searching, marking the empty ones', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		await type('tidal'); // a rhythm-only hit
		// All three headings stay put, so a hit's column still reads as information.
		await waitFor(() =>
			expect(container.querySelectorAll('.example-group')).toHaveLength(3)
		);
		expect(container.querySelectorAll('.column-empty')).toHaveLength(2);
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
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		expect(container.querySelector('.search-count')).toBeNull(); // silent until searching
		await type('rhythm');
		await waitFor(() => expect(container.querySelector('.search-count')).toBeTruthy());
		expect(container.querySelector('.search-count').textContent).toMatch(/of 8$/);
	});

	it('explains a wholly empty result instead of showing blank columns', async () => {
		const { container } = render(StartScreen);
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		await type('zzzznothing');
		await waitFor(() => expect(container.querySelectorAll('.example-row')).toHaveLength(0));
		expect(screen.getByText(/Nothing matches/)).toBeTruthy();
		// A total miss replaces the columns outright, rather than three "No matches" stubs.
		expect(container.querySelector('.example-columns')).toBeNull();
	});

	it('lets Escape clear the query before it closes the screen', async () => {
		const onDismiss = vi.fn();
		const { container } = render(StartScreen, { props: { onDismiss } });
		await waitFor(() => expect(container.querySelector('.example-row')).toBeTruthy());
		await type('tidal');
		await fireEvent.keyDown(window, { key: 'Escape' });
		// First Escape clears the search; the screen stays open.
		expect(onDismiss).not.toHaveBeenCalled();
		await waitFor(() => expect(container.querySelectorAll('.example-row').length).toBe(7));
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
