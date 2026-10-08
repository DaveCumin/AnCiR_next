// The Navbar's New session button: it sits with Load and Save, names its shortcut, and calls
// back into +page (which owns the start screen). The confirm and reset themselves are tested in
// core/newSession.svelte.test.js.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('$lib/utils/nlSession.js', () => ({
	NL_CONFIGURED: false,
	checkNlHealth: vi.fn(async () => false)
}));

import Navbar from './Navbar.svelte';

afterEach(() => cleanup());

describe('Navbar New session', () => {
	it('calls onNewSession when clicked', async () => {
		const onNewSession = vi.fn();
		render(Navbar, { props: { onNewSession } });
		await fireEvent.click(screen.getByRole('button', { name: 'New session' }));
		expect(onNewSession).toHaveBeenCalledTimes(1);
	});

	it('sits immediately before Load and Save, and announces its shortcut', () => {
		render(Navbar, { props: { onNewSession: () => {} } });
		const btn = screen.getByTestId('nav-new-session');
		expect(btn.nextElementSibling?.getAttribute('data-testid')).toBe('nav-load-session');
		expect(btn.getAttribute('aria-keyshortcuts')).toMatch(/^(Meta|Control)\+Alt\+N$/);
	});

	it('is not offered without a handler', () => {
		render(Navbar);
		expect(screen.queryByTestId('nav-new-session')).toBeNull();
	});
});
