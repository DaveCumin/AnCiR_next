// @ts-nocheck
/* global $state, $derived, $effect */
import { describe, it, expect } from 'vitest';
import { flushSync, untrack } from 'svelte';
import v8 from 'node:v8';
import vm from 'node:vm';

// ROB-20: every session load kept the previous session's whole node graph alive. The cause
// was a Svelte bug, fixed in svelte 5.57.2 ("prevent untracked derived reads from retaining
// disconnected dependencies", sveltejs/svelte#18829): reading a derived through an untracked,
// unconnected derived while ANY effect was updating marked the inner derived "connected",
// so it subscribed itself to its sources with nothing reading it. A long-lived source
// (`core.data`, the history manager's state) then held it, and through its closures the
// destroyed component, its each-blocks and every DOM node they had rendered.
//
// The app reaches that shape in ordinary code (an `untrack` in an effect over a class with
// chained `$derived` fields, e.g. LegendAutoLayout), so this pins the library behaviour the
// app relies on: once the effect that read it is gone, nothing the app keeps (a module-level
// `$state`) may retain the object behind those deriveds. tests/e2e/session-load-leak.spec.js
// measures the same thing end to end on a real build.

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');

// Long-lived, like `core`: outlives every component and effect.
const longLived = $state({ v: 1 });

class Holder {
	inner = $derived(longLived.v * 2);
	outer = $derived(this.inner + 1);
}

async function collected(ref) {
	for (let i = 0; i < 10 && ref.deref(); i++) {
		await new Promise((r) => setTimeout(r, 0));
		gc();
	}
	return ref.deref() === undefined;
}

describe('a derived read through an untracked derived inside an effect', () => {
	it('is collectable once the effect is destroyed (svelte >= 5.57.2)', async () => {
		let ref;
		const destroy = $effect.root(() => {
			const holder = new Holder();
			ref = new WeakRef(holder);
			$effect(() => {
				untrack(() => holder.outer);
			});
		});
		flushSync();
		destroy();
		flushSync();
		// A write after the teardown: a still-subscribed derived would be marked by it.
		longLived.v++;
		flushSync();
		expect(await collected(ref)).toBe(true);
	});

	it('control: the same holder IS retained while something long-lived reads it', async () => {
		// Proves the WeakRef and gc() above can observe retention at all, so the first test
		// cannot pass vacuously. A tracked read, so this half does not depend on the fix.
		const keep = [];
		let ref;
		const destroy = $effect.root(() => {
			const holder = new Holder();
			ref = new WeakRef(holder);
			keep.push(holder);
			$effect(() => {
				holder.outer;
			});
		});
		flushSync();
		destroy();
		expect(await collected(ref)).toBe(false);
		keep.length = 0;
		expect(await collected(ref)).toBe(true);
	});
});
