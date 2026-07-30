// NumberWithUnits must not turn "not set" into a value just by being rendered.
//
// THE BUG (found in the browser, slice 6)
//
// The component clamped its bound value on mount:
//
//     onMount(() => { value = clamp(value, min, max); });
//
// `value` is $bindable, so that writes back to the parent. Several fields are
// nullable, where null means "inherit" — a legend or significance-bar type size that
// follows the figure. clamp(null, 8, 24) is 8, because null coerces to 0 and the
// lower bound wins. So merely OPENING the control panel converted "follow the
// figure" into a hard 8px override, and the sig-bar size to 1px. Nothing was
// clicked; rendering the control was enough.
//
// This is asserted two ways on purpose. The first test documents the arithmetic that
// makes the bug possible, so the guard below cannot pass for the wrong reason if
// clamp's behaviour ever changes. The second checks the component actually guards.
// (A mounted-component test would be better still, but the repo has no harness for
// mounting Svelte components, and inventing one for this is out of scope here.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), 'NumberWithUnits.svelte'),
	'utf8'
);

/** The component's own clamp, reproduced. */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

describe('why the guard is needed', () => {
	it('clamping a null lands on min, not null', () => {
		expect(clamp(null, 8, 24)).toBe(8);
		expect(clamp(null, 1, 48)).toBe(1);
		expect(clamp(undefined, 8, 24)).toBeNaN();
	});

	it('clamping a real number still works, so the guard must not skip those', () => {
		expect(clamp(100, 8, 24)).toBe(24);
		expect(clamp(2, 8, 24)).toBe(8);
		expect(clamp(12, 8, 24)).toBe(12);
	});
});

describe('NumberWithUnits guards the mount clamp', () => {
	it('only clamps a finite number', () => {
		expect(SRC).toMatch(
			/if \(typeof value === 'number' && Number\.isFinite\(value\)\) value = clamp\(value, min, max\)/
		);
	});

	it('does not clamp unconditionally on mount', () => {
		// The exact line that caused it.
		expect(SRC).not.toMatch(/onMount\(\(\) => \{\s*value = clamp\(value, min, max\);/);
	});
});

describe('nullable size fields are not bound directly to the control', () => {
	// Second line of defence, and the right shape regardless of the clamp: the control
	// edits a local mirror showing the size actually drawn (inherited or overridden),
	// and only a real edit writes an override. Binding the nullable field straight to
	// the input is what made a rendering side effect able to corrupt it.
	const legend = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '..', 'plotbits', 'Legend.svelte'),
		'utf8'
	);
	const boxplot = readFileSync(
		join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plots', 'Boxplot', 'Boxplot.svelte'),
		'utf8'
	);

	it('the legend size control binds to a mirror, not legendData.fontSize', () => {
		expect(legend).not.toMatch(/bind:value=\{legendData\.fontSize\}/);
		expect(legend).toMatch(/bind:value=\{legendSizeInput\}/);
	});

	it('the sig-bar size control binds to a mirror, not sigBarFontSize', () => {
		expect(boxplot).not.toMatch(/bind:value=\{theData\.sigBarFontSize\}/);
		expect(boxplot).toMatch(/bind:value=\{sigBarSizeInput\}/);
	});
});
