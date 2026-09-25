import { describe, it, expect } from 'vitest';
import { placeNotePopover, NOTE_POPOVER_GAP, NOTE_POPOVER_MARGIN } from './notePopoverPlacement.js';

const viewport = { width: 1400, height: 900 };
const size = { width: 260, height: 145 };
const anchorAt = (left, top) => ({ left, top, right: left + 18, bottom: top + 16 });

describe('placeNotePopover', () => {
	it('opens below the badge, left-aligned with it, when there is room', () => {
		const a = anchorAt(700, 68);
		expect(placeNotePopover(a, size, viewport)).toEqual({
			top: a.bottom + NOTE_POPOVER_GAP,
			left: 700,
			placement: 'below'
		});
	});

	it('never extends past the left edge for a badge at the far left', () => {
		const p = placeNotePopover(anchorAt(2, 68), size, viewport);
		expect(p.left).toBe(NOTE_POPOVER_MARGIN);
		expect(p.placement).toBe('below');
	});

	it('shifts left so it stays inside the viewport near the right edge', () => {
		const p = placeNotePopover(anchorAt(1380, 68), size, viewport);
		expect(p.left + size.width).toBe(viewport.width - NOTE_POPOVER_MARGIN);
	});

	it('flips above the badge when there is no room below', () => {
		const a = anchorAt(700, 850);
		const p = placeNotePopover(a, size, viewport);
		expect(p.placement).toBe('above');
		expect(p.top + size.height).toBe(a.top - NOTE_POPOVER_GAP);
	});

	it('clamps to the top margin when it fits neither below nor above', () => {
		const small = { width: 400, height: 150 };
		const p = placeNotePopover(anchorAt(10, 70), size, small);
		expect(p.placement).toBe('below');
		// Nothing fits, so the top margin wins over the bottom one: the label,
		// textarea and Save button stay reachable.
		expect(p.top).toBe(NOTE_POPOVER_MARGIN);
	});

	it('keeps a badge that panned off the top clamped to the top margin', () => {
		const p = placeNotePopover(anchorAt(700, -140), size, viewport);
		expect(p.top).toBe(NOTE_POPOVER_MARGIN);
	});
});
