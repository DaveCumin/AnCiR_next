// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	tourState,
	startTour,
	nextStep,
	prevStep,
	stopTour,
	finishTour,
	openPicker,
	closePicker,
	completedSet
} from './tourRunner.svelte.js';

const demoTour = {
	id: 'demo',
	name: 'Demo',
	steps: [
		{ title: 'a', advance: { on: 'next' } },
		{ title: 'b', advance: { on: 'next' } },
		{ title: 'c', advance: { on: 'next' } }
	]
};

beforeEach(() => {
	stopTour();
	closePicker();
	try {
		localStorage.removeItem('ancir.tours.completed');
	} catch {
		/* ignore */
	}
});

describe('tourRunner', () => {
	it('starts a tour at step 0', () => {
		startTour(demoTour);
		// $state deep-proxies the assigned object, so compare by id, not reference.
		expect(tourState.activeTour?.id).toBe('demo');
		expect(tourState.index).toBe(0);
	});

	it('advances and goes back, clamped to the ends', () => {
		startTour(demoTour);
		nextStep();
		expect(tourState.index).toBe(1);
		prevStep();
		expect(tourState.index).toBe(0);
		prevStep(); // clamp at 0
		expect(tourState.index).toBe(0);
	});

	it('finishes (and records completion) when advancing past the last step', () => {
		startTour(demoTour);
		nextStep(); // 1
		nextStep(); // 2 (last)
		expect(tourState.index).toBe(2);
		nextStep(); // past end → finish
		expect(tourState.activeTour).toBe(null);
		expect(tourState.index).toBe(-1);
		expect(completedSet().has('demo')).toBe(true);
	});

	it('stopTour does NOT mark complete (skip)', () => {
		startTour(demoTour);
		stopTour();
		expect(tourState.activeTour).toBe(null);
		expect(completedSet().has('demo')).toBe(false);
	});

	it('finishTour marks complete', () => {
		startTour(demoTour);
		finishTour();
		expect(completedSet().has('demo')).toBe(true);
	});

	it('ignores empty/invalid tours', () => {
		startTour({ id: 'x', steps: [] });
		expect(tourState.activeTour).toBe(null);
		startTour(null);
		expect(tourState.activeTour).toBe(null);
	});

	it('picker open/close toggles state and starting a tour closes it', () => {
		openPicker();
		expect(tourState.pickerOpen).toBe(true);
		closePicker();
		expect(tourState.pickerOpen).toBe(false);
		openPicker();
		startTour(demoTour);
		expect(tourState.pickerOpen).toBe(false);
	});
});
