// Two WorkflowEditors mounted at once must not fight over core.nodeLayout.
//
// REPORTED AS: "the demo data (cmd-shift-x) doesn't work"; the app froze mid-seed
// with Svelte's effect_update_depth_exceeded.
//
// WHY: +page.svelte rendered the canvas view's <WorkflowEditor inline /> AND, when
// the legacy `appState.showWorkflow` flag was set, a second fullscreen
// <WorkflowEditor />. That flag and its branch have since been deleted as dead
// code, so this test mounts the pair directly: the content guard is what keeps a
// second mount survivable, and it should stay that way. Both own the one global
// layout:
//
//   mirror effect  reads stablePositions → writes core.nodeLayout (a NEW object
//                  every run) and remembers it in `_mirroredLayout`
//   adopt effect   reads core.nodeLayout → if it is not `_mirroredLayout`, writes
//                  stablePositions from it
//
// `_mirroredLayout` is per-instance, so instance A never recognises instance B's
// write as "ours". A adopts B's layout, A's mirror publishes a fresh object, B
// adopts THAT, and the two effects re-trigger each other until Svelte aborts the
// flush. Nothing about the layout is actually changing, only its object identity.
//
// The guard is on content, so this test watches the symptom that matters: how many
// times core.nodeLayout is republished before everything settles. One editor
// publishes once; two should exchange a couple of times and stop. Before the fix
// this ran away (hundreds of writes, then the Svelte error).
/* global $effect */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core } from '$lib/core/core.svelte.js';
import WorkflowEditor from './WorkflowEditor.svelte';

/** Republish count for core.nodeLayout, measured with a root effect. */
function watchLayoutWrites() {
	let count = 0;
	const stop = $effect.root(() => {
		$effect(() => {
			core.nodeLayout;
			count++;
		});
	});
	return {
		get count() {
			return count;
		},
		stop
	};
}

afterEach(() => {
	cleanup();
	core.nodeLayout = {};
	vi.restoreAllMocks();
});

describe('two mounted WorkflowEditors', () => {
	it('settle instead of re-publishing core.nodeLayout forever', async () => {
		// A non-empty layout is the precondition: the adopt effect returns early on an
		// empty one, which is why an EMPTY canvas never showed this.
		core.nodeLayout = { data_1: { x: 10, y: 20 }, plot_2: { x: 300, y: 40, w: 320, h: 240 } };

		const watcher = watchLayoutWrites();
		flushSync();
		const baseline = watcher.count;

		render(WorkflowEditor, { props: { inline: true } });
		render(WorkflowEditor, { props: {} });
		flushSync();
		await tick();
		flushSync();

		const writes = watcher.count - baseline;
		watcher.stop();

		// Generous ceiling: the point is bounded vs unbounded, not an exact number.
		expect(writes).toBeLessThan(15);
	});
});
