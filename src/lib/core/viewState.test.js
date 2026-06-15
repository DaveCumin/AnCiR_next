// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { appState } from './core.svelte.js';

describe('appState.view', () => {
	it('defaults to canvas', () => {
		expect(appState.view).toBe('canvas');
	});

	it('accepts plots as the alternate value', () => {
		appState.view = 'plots';
		expect(appState.view).toBe('plots');
		appState.view = 'canvas'; // reset for other tests
	});
});
