// The Alt tracker must cost ONE pair of document listeners for the whole app, and
// must let go of a plot when that plot goes away. The second half is the leak: the
// old version captured each plot's reactive state in a closure it had no way to
// remove, so every unmounted plot was retained in full.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { bindAltTooltipToggle, _altSubscriberCount } from './tooltipHelpers.js';

// The install is module-level and one-shot, so the ONLY honest place to count it
// is before the first bind in this module's lifetime. Wrapping at test-file scope
// (not inside a test) means the tally covers every bind in the file regardless of
// which test runs first; the assertion below is therefore order-independent.
// tooltipHelpers.js registers nothing at import time, only on first bind, so
// nothing has been missed by the time this spy is installed.
const altRegistrations = [];
const addSpy = vi
	.spyOn(document, 'addEventListener')
	.mockImplementation(function (type, ...rest) {
		if (type === 'keydown' || type === 'keyup') altRegistrations.push(type);
		return EventTarget.prototype.addEventListener.call(this, type, ...rest);
	});

afterAll(() => {
	addSpy.mockRestore();
});

const alt = (type) => document.dispatchEvent(new KeyboardEvent(type, { key: 'Alt' }));
const visible = { visible: true, x: 1, y: 2, content: 'hi' };

/** Stand in for one plot component: its tooltip state plus the handler it wires up. */
function mountPlot() {
	let tooltip = { visible: false, x: 0, y: 0, content: '' };
	const handle = bindAltTooltipToggle(
		() => tooltip,
		(v) => {
			tooltip = v;
		}
	);
	return {
		handle,
		get tooltip() {
			return tooltip;
		}
	};
}

beforeEach(() => {
	// A test that fails to release what it bound fails the NEXT test loudly here,
	// rather than quietly poisoning the shared subscriber set.
	expect(_altSubscriberCount(), 'a previous test leaked a subscriber').toBe(0);
});

describe('the Alt tracker is shared, not per plot', () => {
	it('installs exactly one pair of document listeners however many plots bind', () => {
		const plots = [mountPlot(), mountPlot(), mountPlot()];
		expect(_altSubscriberCount()).toBe(3);

		// One registration of each type across every bind in this file, not per bind.
		expect(altRegistrations.filter((t) => t === 'keydown')).toHaveLength(1);
		expect(altRegistrations.filter((t) => t === 'keyup')).toHaveLength(1);

		// The observable consequence of sharing: that single pair still reaches every
		// subscriber, so one Alt keydown hides all three tooltips.
		plots.forEach((p) => p.handle({ detail: visible }));
		expect(plots.map((p) => p.tooltip.visible)).toEqual([true, true, true]);
		alt('keydown');
		expect(plots.map((p) => p.tooltip.visible)).toEqual([false, false, false]);
		alt('keyup');
		expect(plots.map((p) => p.tooltip.visible)).toEqual([true, true, true]);

		plots.forEach((p) => p.handle.destroy());
	});

	it('tracks one subscriber per bind and releases it on destroy', () => {
		const a = mountPlot();
		const b = mountPlot();
		expect(_altSubscriberCount()).toBe(2);
		a.handle.destroy();
		expect(_altSubscriberCount()).toBe(1);
		b.handle.destroy();
		expect(_altSubscriberCount()).toBe(0);
	});

	it('a destroyed plot stops receiving Alt while a live one still does', () => {
		const dead = mountPlot();
		const live = mountPlot();
		dead.handle({ detail: visible });
		live.handle({ detail: visible });
		expect(dead.tooltip.visible).toBe(true);
		expect(live.tooltip.visible).toBe(true);

		dead.handle.destroy();
		alt('keydown');
		expect(dead.tooltip.visible).toBe(true); // untouched: it is gone
		expect(live.tooltip.visible).toBe(false); // hidden while Alt is held

		alt('keyup');
		expect(live.tooltip.visible).toBe(true); // restored without mouse movement
		live.handle.destroy();
	});
});

describe('Alt-toggle behaviour is unchanged', () => {
	it('hides on Alt down and restores the stashed tooltip on Alt up', () => {
		const p = mountPlot();
		p.handle({ detail: visible });
		alt('keydown');
		expect(p.tooltip.visible).toBe(false);
		alt('keyup');
		expect(p.tooltip).toEqual(visible);
		p.handle.destroy();
	});

	it('suppresses new tooltips while Alt is held', () => {
		const p = mountPlot();
		alt('keydown');
		p.handle({ detail: visible });
		expect(p.tooltip.visible).toBe(false);
		alt('keyup');
		p.handle.destroy();
	});

	it('a hidden dispatch clears the stash, so Alt-up restores nothing', () => {
		const p = mountPlot();
		p.handle({ detail: visible });
		p.handle({ detail: { visible: false } });
		alt('keydown');
		alt('keyup');
		expect(p.tooltip.visible).toBe(false);
		p.handle.destroy();
	});
});
