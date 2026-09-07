// The first-run coach mark and the Help menu's "Welcome screen" entry, at the level
// the navbar owns them: the halo/callout render from helpHint state, engagement ends
// the affordance, and the welcome item calls back into +page.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

// The AI health probe would otherwise fetch on mount; the handbook HEAD probe fires
// on the ? click. Neither is under test.
vi.mock('$lib/utils/nlSession.js', () => ({
	NL_CONFIGURED: false,
	checkNlHealth: vi.fn(async () => false)
}));

import Navbar from './Navbar.svelte';
import { helpHint, _resetHelpHintForTests } from '$lib/core/helpHint.svelte.js';
import { ENGAGED_KEY } from '$lib/utils/firstRun.js';
import { tourState } from '$lib/core/tourRunner.svelte.js';

// happy-dom has no fetch failure tolerance for the handbook HEAD probe; stub it.
beforeEach(() => {
	window.localStorage.clear();
	_resetHelpHintForTests();
	tourState.pickerOpen = false;
	vi.spyOn(window, 'fetch').mockResolvedValue({ ok: false });
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	window.localStorage.clear();
	_resetHelpHintForTests();
});

describe('first-run coach mark', () => {
	it('renders nothing when the hint is not active', () => {
		render(Navbar);
		expect(screen.queryByTestId('help-callout')).toBeNull();
		expect(screen.getByTestId('nav-help').classList.contains('hint-halo')).toBe(false);
	});

	it('shows the halo and callout with the agreed copy when active', async () => {
		render(Navbar);
		helpHint.visible = true;
		await vi.waitFor(() => expect(screen.getByTestId('help-callout')).toBeTruthy());
		expect(screen.getByText('New here?')).toBeTruthy();
		expect(screen.getByText('Take a tour, or find help and examples here any time.')).toBeTruthy();
		expect(screen.getByTestId('nav-help').classList.contains('hint-halo')).toBe(true);
	});

	it('dismisses permanently from the X', async () => {
		render(Navbar);
		helpHint.visible = true;
		await vi.waitFor(() => expect(screen.getByTestId('help-callout')).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(screen.queryByTestId('help-callout')).toBeNull();
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});

	it('"Take a tour" opens the tour picker and ends the affordance', async () => {
		render(Navbar);
		helpHint.visible = true;
		await vi.waitFor(() => expect(screen.getByTestId('help-callout-tour')).toBeTruthy());
		await fireEvent.click(screen.getByTestId('help-callout-tour'));
		expect(tourState.pickerOpen).toBe(true);
		expect(screen.queryByTestId('help-callout')).toBeNull();
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});

	it('opening the Help menu itself also ends the affordance', async () => {
		render(Navbar);
		helpHint.visible = true;
		await vi.waitFor(() => expect(screen.getByTestId('help-callout')).toBeTruthy());
		await fireEvent.click(screen.getByTestId('nav-help'));
		expect(screen.queryByTestId('help-callout')).toBeNull();
		expect(window.localStorage.getItem(ENGAGED_KEY)).toBe('1');
	});
});

describe('Help → Welcome screen', () => {
	it('offers the welcome screen when wired, and calls back on click', async () => {
		const onShowWelcome = vi.fn();
		render(Navbar, { props: { onShowWelcome } });
		await fireEvent.click(screen.getByTestId('nav-help'));
		const item = screen.getByTestId('help-welcome');
		expect(item.textContent).toBe('Welcome screen');
		await fireEvent.click(item);
		expect(onShowWelcome).toHaveBeenCalledOnce();
		// The menu closes with the choice.
		expect(screen.queryByTestId('help-welcome')).toBeNull();
	});

	it('hides the entry when no callback is wired (e.g. embedded uses)', async () => {
		render(Navbar);
		await fireEvent.click(screen.getByTestId('nav-help'));
		expect(screen.queryByTestId('help-welcome')).toBeNull();
	});
});
