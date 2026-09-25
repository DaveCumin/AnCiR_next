// `LegendClass.withDefaults` is how a plot chooses a different default for `show`.
//
// WHY IT EXISTS
//
// Six plots have always drawn a legend and default it ON. Five more (Periodogram,
// FFT, Correlogram, Actogram, PairsPlot) gained one later, and those must default
// it OFF: every saved session already contains those plots, so a legend that
// switched itself on at load would silently change a figure the user had already
// finished. The constructor cannot express that, because its `show` fallback is a
// hardcoded `?? true`.
//
// The subtle part is the difference between this helper and the obvious one-liner
// `new LegendClass({ show: false, ...json })`. A spread puts the key back even
// when the saved value is `undefined` (a hand-written inner, or a tool that drops
// falsy fields), and `undefined ?? true` is `true`, so the OFF default would leak
// back to ON for exactly the sessions it was meant to protect. Resolving `show`
// once, before construction, is what closes that.
import { describe, it, expect } from 'vitest';
import { LegendClass } from './Legend.svelte';

describe('LegendClass.withDefaults', () => {
	it('defaults show to true when no default is given, matching the constructor', () => {
		expect(LegendClass.withDefaults(null).show).toBe(true);
		expect(LegendClass.withDefaults(undefined).show).toBe(true);
	});

	it('honours an OFF default for a plot that never had a legend', () => {
		// The old-session case: no `legend` key at all.
		expect(LegendClass.withDefaults(undefined, { show: false }).show).toBe(false);
		expect(LegendClass.withDefaults(null, { show: false }).show).toBe(false);
	});

	it('a saved show=true beats an OFF default', () => {
		// The user turned it on and saved; loading must not turn it back off.
		expect(LegendClass.withDefaults({ show: true }, { show: false }).show).toBe(true);
	});

	it('a saved show=false beats an ON default', () => {
		// The mirror case, and the one a naive `json.show || default` would break.
		expect(LegendClass.withDefaults({ show: false }, { show: true }).show).toBe(false);
	});

	it('an explicit undefined show falls back to the DEFAULT, not to true', () => {
		// The specific hole a `{ show: false, ...json }` spread leaves open. Written
		// as a real object with the key present, which is what a round trip through a
		// tool that drops falsy values produces.
		const saved = { position: 'topleft', show: undefined };
		expect('show' in saved).toBe(true);
		expect(LegendClass.withDefaults(saved, { show: false }).show).toBe(false);
	});

	it('carries every other saved field through untouched', () => {
		const legend = LegendClass.withDefaults(
			{ position: 'bottomleft', orientation: 'horizontal', padding: 3, customX: 0.4 },
			{ show: false }
		);
		expect(legend.position).toBe('bottomleft');
		expect(legend.orientation).toBe('horizontal');
		expect(legend.padding).toBe(3);
		expect(legend.customX).toBe(0.4);
		expect(legend.show).toBe(false);
	});

	it('still applies the border migration, so an OFF-by-default legend is not left pale', () => {
		// withDefaults must not become a second construction path that skips the
		// migrations the constructor performs (see legendBorderDefault tests).
		const legend = LegendClass.withDefaults(
			{ borderColor: 'var(--color-lightness-80)' },
			{ show: false }
		);
		expect(legend.borderColor).toBe('var(--color-lightness-25)');
	});

	it('round trips: toJSON then withDefaults preserves show in both directions', () => {
		const off = LegendClass.withDefaults(undefined, { show: false });
		expect(LegendClass.withDefaults(off.toJSON(), { show: false }).show).toBe(false);
		off.show = true;
		expect(LegendClass.withDefaults(off.toJSON(), { show: false }).show).toBe(true);
	});
});
