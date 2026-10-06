// The resize step rings a control inside the control panel's "Figure" section. That section
// starts collapsed and once moved under it from its own "Dimension" section, which left the step
// ringing a generic fallback (UI-8). So this renders the REAL FigureStyleControls inside a panel
// wired with the real collapse action, and checks the step lands on the Width and Height row.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import FigureStyleControls from '$lib/components/inputs/FigureStyleControls.svelte';
import {
	collapsibleSections,
	collapsedSections,
	isCollapsed
} from '$lib/components/views/collapsibleSections.svelte.js';
import { newFigureStyle } from '$lib/plots/figureStyle.js';
import { tour } from './gettingStarted.js';

const resizeStep = tour.steps.find((s) => /resize/i.test(s.title));
const figureSection = (root) =>
	[...root.querySelectorAll('.control-component')].find(
		(c) => c.querySelector('.control-component-title p')?.textContent.trim() === 'Figure'
	);

let root;
let handle;
beforeEach(() => {
	// The app default: Figure starts shut.
	collapsedSections.clear();
	collapsedSections.add('Figure');
});
afterEach(() => {
	cleanup();
	handle?.destroy();
	root?.remove();
});

/** A control panel showing one plot's Figure section, as ControlDisplay renders it. */
function mountPanel({ withPlot = true } = {}) {
	root = document.createElement('div');
	root.className = 'control-display';
	document.body.appendChild(root);
	render(FigureStyleControls, {
		target: root,
		props: {
			style: newFigureStyle(),
			plot: withPlot ? { width: 400, height: 300 } : null,
			title: 'Figure'
		}
	});
	handle = collapsibleSections(root);
	return root;
}

describe('getting-started tour: the resize step', () => {
	it('exists', () => {
		expect(resizeStep).toBeTruthy();
	});

	it('opens the collapsed Figure section before it shows', () => {
		const panel = mountPanel();
		expect(figureSection(panel).getAttribute('data-collapsed')).toBe('true');
		resizeStep.beforeShow();
		expect(isCollapsed('Figure')).toBe(false);
		// Synced into the live panel at once, not on its next re-render.
		expect(figureSection(panel).getAttribute('data-collapsed')).toBe('false');
	});

	it('rings the Width and Height row inside Figure, not the section or a fallback', () => {
		const panel = mountPanel();
		resizeStep.beforeShow();
		const el = resizeStep.target();
		expect(el).toBeTruthy();
		const labels = [...el.querySelectorAll('.ci-label')].map((l) => l.textContent.trim());
		expect(labels).toEqual(['Width (px)', 'Height (px)']);
		expect(figureSection(panel).contains(el)).toBe(true);
		expect(el).not.toBe(figureSection(panel));
	});

	it('rings nothing when no figure is showing, rather than some unrelated section', () => {
		mountPanel({ withPlot: false });
		expect(resizeStep.target()).toBeNull();
	});

	it('names the controls the user will actually see', () => {
		expect(resizeStep.body).toMatch(/Figure/);
		expect(resizeStep.body).toMatch(/Width \(px\)/);
		expect(resizeStep.body).not.toMatch(/Dimension/);
	});
});

describe('getting-started tour: the closing step', () => {
	it('describes what the tour had the user do (load an example, not simulate)', () => {
		const last = tour.steps[tour.steps.length - 1];
		expect(last.body).not.toMatch(/simulated/i);
		expect(last.body).toMatch(/example/i);
	});
});
