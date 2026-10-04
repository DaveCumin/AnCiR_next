/**
 * The "Are you sure?" dialog must not put the keyboard on its destructive choice: showModal()
 * focuses the first button, which was "Replace session" (or "Delete"), so a stray Enter
 * confirmed it. The safe choice (Cancel / No) takes focus instead.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import AreYouSure from './AreYouSure.svelte';

afterEach(() => cleanup());

async function open(props) {
	render(AreYouSure, { props: { showModal: true, callback: () => {}, ...props } });
	await tick();
	await tick();
}

describe('AreYouSure focus', () => {
	it('focuses Cancel, not "Replace session"', async () => {
		await open({
			text: 'Open "x.json"? Unsaved changes will be discarded.',
			options: ['Replace session', 'Cancel']
		});
		expect(document.activeElement?.textContent?.trim()).toBe('Cancel');
	});

	it('focuses the No choice (shown as Cancel) of a destructive Yes/No question', async () => {
		await open({ text: 'Delete this column?', options: ['Yes', 'No'] });
		const active = document.activeElement;
		expect(active?.textContent?.trim()).toBe('Cancel');
		expect(screen.getByRole('button', { name: 'Delete' })).not.toBe(active);
	});
});
