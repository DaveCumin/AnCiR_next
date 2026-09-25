// The per-node note popover must NOT render inside the node/plot box that hosts
// the badge. In the workspace (plots) view a plot box is `overflow: hidden` and
// the badge sits on its LEFT edge, so an inline popover was clipped to a sliver
// (regression: "issue with the notes showing in workspace view"). The popover
// is portalled to <body> instead; this test pins that, plus open/close.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import NodeNoteButton from './NodeNoteButton.svelte';
import { core } from '$lib/core/core.svelte.js';

afterEach(() => cleanup());
beforeEach(() => {
	for (const k of Object.keys(core.nodeNotes)) delete core.nodeNotes[k];
});

function mountInClippedBox() {
	// Emulate a Draggable plot box: overflow hidden, badge at the left edge.
	const box = document.createElement('section');
	box.className = 'draggable';
	box.style.overflow = 'hidden';
	document.body.appendChild(box);
	const result = render(NodeNoteButton, { props: { nodeId: 'plot_1' }, target: box });
	return { box, ...result };
}

async function open(result) {
	await fireEvent.click(result.getByLabelText('Add note'));
	await tick();
	return document.querySelector('.node-note-popover');
}

describe('NodeNoteButton popover', () => {
	it('opens on badge click and is portalled to <body>, outside the overflow:hidden box', async () => {
		const r = mountInClippedBox();
		expect(document.querySelector('.node-note-popover')).toBeNull();
		const pop = await open(r);
		expect(pop).not.toBeNull();
		expect(pop.parentElement).toBe(document.body);
		expect(r.box.contains(pop)).toBe(false);
		expect(pop.closest('.draggable')).toBeNull();
		// Placed by inline viewport coordinates (position: fixed lives in the
		// component CSS, which happy-dom does not compute).
		expect(pop.style.top).toMatch(/px$/);
		expect(pop.style.left).toMatch(/px$/);
		r.box.remove();
	});

	it('closes on Escape and removes the portalled element', async () => {
		const r = mountInClippedBox();
		await open(r);
		await fireEvent.keyDown(window, { key: 'Escape' });
		await tick();
		expect(document.querySelector('.node-note-popover')).toBeNull();
		r.box.remove();
	});

	it('closes on a pointerdown outside the badge and popover', async () => {
		const r = mountInClippedBox();
		const pop = await open(r);
		// Inside the popover: stays open.
		await fireEvent.pointerDown(pop.querySelector('.node-note-textarea'));
		await tick();
		expect(document.querySelector('.node-note-popover')).not.toBeNull();
		// Outside (a canvas click that stops bubbling propagation still reaches
		// the capture-phase window listener).
		const outside = document.createElement('div');
		document.body.appendChild(outside);
		outside.addEventListener('pointerdown', (e) => e.stopPropagation());
		await fireEvent.pointerDown(outside);
		await tick();
		expect(document.querySelector('.node-note-popover')).toBeNull();
		outside.remove();
		r.box.remove();
	});

	it('saves the note into core.nodeNotes and marks the badge', async () => {
		const r = mountInClippedBox();
		const pop = await open(r);
		await fireEvent.input(pop.querySelector('.node-note-textarea'), {
			target: { value: '  remember this  ' }
		});
		// Queries on `r` are scoped to the box; the popover is on <body>.
		await fireEvent.click(
			[...pop.querySelectorAll('button')].find((b) => b.textContent === 'Save')
		);
		await tick();
		expect(core.nodeNotes.plot_1).toBe('remember this');
		expect(document.querySelector('.node-note-popover')).toBeNull();
		expect(r.getByLabelText('View or edit note').classList.contains('has-note')).toBe(true);
		r.box.remove();
	});
});
