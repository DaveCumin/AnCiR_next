import { describe, it, expect } from 'vitest';
import { appState, loadAppState, outputCoreAsJson } from '$lib/core/core.svelte.js';

// Both canvas viewports live in appState so they ride the session save/load:
// workspace = canvasOffset + canvasScale, workflow = workflowViewport. The
// viewportEpoch is a live adoption signal and must NOT be restored from a session.

describe('canvas viewport persistence in the session', () => {
	it('serialises both viewports into the exported session', () => {
		appState.canvasOffset = { x: 120, y: -40 };
		appState.canvasScale = 1.75;
		appState.workflowViewport = { x: 300, y: 55, z: 0.6 };

		const json = JSON.parse(outputCoreAsJson());
		expect(json.appState.canvasOffset).toEqual({ x: 120, y: -40 });
		expect(json.appState.canvasScale).toBe(1.75);
		expect(json.appState.workflowViewport).toEqual({ x: 300, y: 55, z: 0.6 });
	});

	it('restores both viewports from a loaded session', () => {
		loadAppState({
			canvasOffset: { x: 5, y: 6 },
			canvasScale: 2,
			workflowViewport: { x: 7, y: 8, z: 0.9 }
		});
		expect(appState.canvasOffset).toEqual({ x: 5, y: 6 });
		expect(appState.canvasScale).toBe(2);
		expect(appState.workflowViewport).toEqual({ x: 7, y: 8, z: 0.9 });
	});

	it('never restores viewportEpoch from a session (it is a live signal)', () => {
		appState.viewportEpoch = 3;
		loadAppState({ viewportEpoch: 999 });
		expect(appState.viewportEpoch).toBe(3);
	});
});
