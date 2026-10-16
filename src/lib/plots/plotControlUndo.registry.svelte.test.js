// @ts-nocheck
/**
 * Every control in every plot type's control panel is ONE undo step that undoes exactly.
 *
 * REPORTED (vault TODO "Follow-ups from v82.11 to v82.12"; reproduced 2026-10-17 in headless
 * Chromium on demo-scatter-rhythm): typing a Y min, a shift+wheel zoom and a multi-select
 * width edit all changed the plot, and Cmd+Z did nothing. A probe of the whole registry found
 * the same for almost every panel control (padding, series styles, log scales, method
 * settings): only the axis controls (v82.12) were recorded.
 *
 * The panel now records each finished gesture through plots/plotEditScope.js. This drives the
 * REAL panel (ControlDisplay, with the plot selected) for every plot type and every tab, and
 * for each enabled input, select and text box: performs the gesture a user would (press,
 * focus, type or pick, commit), then checks that the plot changed by exactly ONE undo step,
 * that the session counts as edited, that undo gives back the plot's JSON exactly and that
 * redo gives back the edit. A typed edit is also cancelled with Escape: the plot comes back
 * and nothing is recorded.
 *
 * EXCLUSIONS is the list of controls that do not meet this, each with its reason. It only
 * shrinks (the guard below fails on a stale entry as well as on a new failure).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { core, appConsts, appState } from '$lib/core/core.svelte.js';
import { Plot } from '$lib/core/Plot.svelte';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import { clearProcessNodeGraphCache } from '$lib/core/ProcessNode.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import { loadPlots } from '$test/plotRegistry.js';
import ControlDisplay from '$lib/components/views/ControlDisplay.svelte';

const PLOTS = await loadPlots();
const PLOT_TYPES = [...PLOTS.keys()];

// `<type> | <tab> | <control>` -> why it is not (yet) one exact undo step.
const EXCLUSIONS = {};

// Controls whose gesture here changes nothing saved, each with the reason. A NEW one fails:
// that is how this test found the actogram's "Space Between", which was edited but never
// saved (fixed: now in toJSON).
const NO_SAVED_CHANGE = {
	'actogram | properties | Start time (date)':
		'a view override of a value derived from the data (Actogram startTime is $derived), not saved',
	'actogram | properties | Start time (time)':
		'a view override of a value derived from the data (Actogram startTime is $derived), not saved',
	'tableplot | properties and data | Columns':
		'the radio of the source already shown; choosing it again changes nothing'
};

beforeAll(() => {
	// happy-dom does not match `:checked` on an <option>, which is how Svelte's bind:value
	// reads a <select>; answer it from selectedOptions, as a browser does.
	const qs = HTMLSelectElement.prototype.querySelector;
	HTMLSelectElement.prototype.querySelector = function (sel) {
		return sel === ':checked' ? (this.selectedOptions?.[0] ?? null) : qs.call(this, sel);
	};
	appConsts.plotMap = PLOTS;
	history.init();
	initUnsavedChanges();
});
function resetSession() {
	core.data = [];
	core.plots = [];
	core.rawData = new Map();
	core.tableProcesses = [];
	core.seriesAppearance = {};
	appState.view = 'plots';
	appState.gridSize = 15;
	history.clear();
	clearProcessNodeGraphCache();
}
beforeEach(resetSession);
afterEach(() => cleanup());

const N = 48;
function mkCol(name, values) {
	const c = new Column({ type: 'number', data: -1 });
	c.customName = name;
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A selected plot of `type` with one wired series, in the session. */
function sessionPlot(type) {
	const t = mkCol(
		't',
		Array.from({ length: N }, (_, i) => i)
	);
	const v = mkCol(
		'v',
		Array.from({ length: N }, (_, i) => 50 + 30 * Math.cos((2 * Math.PI * i) / 24))
	);
	const entry = appConsts.plotMap.get(type);
	const inputs = entry.defaultInputs ?? [];
	const inner =
		type === 'tableplot'
			? { columnRefs: [t, v] }
			: inputs.length === 1 && inputs[0] === 'column'
				? { data: [{ column: { refId: v } }] }
				: { data: [{ x: { refId: t }, y: { refId: v } }] };
	const plot = new Plot({ type, name: type, width: 500, height: 300, plot: inner });
	plot.selected = true;
	core.plots.push(plot);
	return core.plots[core.plots.length - 1];
}

/** The plot's JSON, minus what the panel never edits and a selection flag. */
const live = (id) => core.plots.find((p) => p.id === id);
const json = (id) => JSON.stringify(live(id));

async function settle() {
	await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	await tick();
}

const panelControls = (root) =>
	[
		...root.querySelectorAll(
			'[role="tabpanel"] input, [role="tabpanel"] select, [role="tabpanel"] textarea'
		)
	].filter((el) => !el.disabled && el.type !== 'hidden' && el.type !== 'file');

function labelOf(el) {
	const aria = el.getAttribute('aria-label');
	if (aria) return aria;
	const lab = el.closest('label');
	const ci = lab?.querySelector('.ci-label')?.textContent?.trim();
	if (ci) return ci;
	const text = lab?.textContent?.replace(/\s+/g, ' ').trim();
	if (text) return text.slice(0, 50);
	const p = el.closest('.control-input')?.querySelector('p')?.textContent?.trim();
	if (p) return p;
	return `${el.tagName.toLowerCase()}:${el.type}`;
}

/** Keys for each control, numbered when a label repeats within a tab. */
function controlKeys(type, tab, els) {
	const seen = {};
	return els.map((el) => {
		const base = `${type} | ${tab} | ${labelOf(el)}`;
		seen[base] = (seen[base] ?? 0) + 1;
		return seen[base] > 1 ? `${base} #${seen[base]}` : base;
	});
}

const fire = (el, type, Ctor = Event, init = {}) =>
	el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
const TYPED = new Set(['text', 'number', 'search', '']);
const isTyped = (el) =>
	el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TYPED.has(el.getAttribute('type') ?? ''));

/** A new value for a control, or null when it has no other value to take. */
function nextValue(el) {
	if (el.tagName === 'SELECT') {
		const next = [...el.options].find((o) => !o.disabled && o.value !== el.value);
		return next ? next.value : null;
	}
	if (el.type === 'color') return el.value === '#123456' ? '#654321' : '#123456';
	if (el.type === 'number' || el.type === 'range') {
		const cur = Number(el.value);
		const step = Number(el.step) > 0 ? Number(el.step) : 1;
		let next = Number.isFinite(cur) ? cur + 2 * step : 3;
		if (el.max !== '' && Number(el.max) < next) next = Number.isFinite(cur) ? cur - step : 0;
		return String(next);
	}
	return `${el.value ?? ''}x`;
}

/** What a user does to change `el`: press, focus, then pick, toggle or type and commit. */
async function userEdit(el) {
	fire(el, 'pointerdown', PointerEvent);
	el.focus();
	fire(el, 'focusin', FocusEvent);
	if (el.type === 'checkbox' || el.type === 'radio') {
		fire(el, 'pointerup', PointerEvent);
		el.click();
	} else if (isTyped(el)) {
		fire(el, 'pointerup', PointerEvent);
		fire(el, 'click', MouseEvent);
		const target = nextValue(el);
		for (let i = 1; i <= target.length; i++) {
			fire(el, 'keydown', KeyboardEvent, { key: target[i - 1] });
			el.value = target.slice(0, i);
			fire(el, 'input', InputEvent);
		}
		fire(el, 'keydown', KeyboardEvent, { key: 'Enter' });
		fire(el, 'change');
		el.blur();
		fire(el, 'focusout', FocusEvent);
	} else {
		const v = nextValue(el);
		if (v == null) return false;
		el.value = v;
		// A select bound with bind:value reads the :checked option, so pick it as a user does.
		if (el.tagName === 'SELECT') for (const o of el.options) o.selected = o.value === v;
		fire(el, 'input', InputEvent);
		fire(el, 'change');
		fire(el, 'pointerup', PointerEvent);
		fire(el, 'click', MouseEvent);
	}
	await settle();
	return true;
}

/** Type into `el` without committing, then press Escape. */
async function typeThenEscape(el) {
	fire(el, 'pointerdown', PointerEvent);
	el.focus();
	fire(el, 'focusin', FocusEvent);
	fire(el, 'pointerup', PointerEvent);
	fire(el, 'click', MouseEvent);
	const target = nextValue(el);
	for (let i = 1; i <= target.length; i++) {
		fire(el, 'keydown', KeyboardEvent, { key: target[i - 1] });
		el.value = target.slice(0, i);
		fire(el, 'input', InputEvent);
	}
	fire(el, 'keydown', KeyboardEvent, { key: 'Escape' });
	el.blur();
	fire(el, 'focusout', FocusEvent);
	await settle();
}

async function mountPanel(type, tab) {
	resetSession();
	cleanup();
	const plot = sessionPlot(type);
	appState.currentControlTab = tab;
	const r = render(ControlDisplay);
	await settle();
	return { plot, container: r.container };
}

/** Run every control of every tab of `type`; returns { key: outcome }. */
async function auditType(type) {
	const out = {};
	const headers = appConsts.plotMap.get(type).controlHeaders ?? ['Properties'];
	for (const header of headers) {
		const tab = header.toLowerCase();
		const first = await mountPanel(type, tab);
		const keys = controlKeys(type, tab, panelControls(first.container));
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const { plot, container } = await mountPanel(type, tab);
			const el = panelControls(container)[i];
			if (!el) {
				out[key] = 'gone';
				continue;
			}
			const id = plot.id;
			history.clear();
			markSessionSaved();
			const before = json(id);
			if (!(await userEdit(el))) {
				out[key] = 'no other value';
				continue;
			}
			const after = json(id);
			if (after === before) {
				out[key] = history.undoCount ? 'step without a change' : 'no change';
				continue;
			}
			if (history.undoCount !== 1) {
				out[key] = history.undoCount === 0 ? 'NOT RECORDED' : `${history.undoCount} steps`;
				continue;
			}
			if (!hasUnsavedChanges()) {
				out[key] = 'not an unsaved change';
				continue;
			}
			history.undo();
			await settle();
			if (json(id) !== before) {
				out[key] = 'UNDO DIFFERS';
				continue;
			}
			history.redo();
			await settle();
			out[key] = json(id) === after ? 'ok' : 'REDO DIFFERS';
			if (out[key] !== 'ok' || !isTyped(el)) continue;

			// Escape cancels a typed edit.
			const again = await mountPanel(type, tab);
			const box = panelControls(again.container)[i];
			history.clear();
			const start = json(again.plot.id);
			await typeThenEscape(box);
			if (json(again.plot.id) !== start || history.undoCount !== 0)
				out[key] = 'ESCAPE KEPT THE EDIT';
		}
	}
	return out;
}

const RESULTS = {};
describe('every plot control panel edit is one exact undo step', () => {
	it.each(PLOT_TYPES)(
		'%s',
		async (type) => {
			const results = await auditType(type);
			RESULTS[type] = results;
			const failures = Object.fromEntries(
				Object.entries(results).filter(
					([k, v]) => v !== 'ok' && !(k in EXCLUSIONS) && !(k in NO_SAVED_CHANGE)
				)
			);
			expect(failures).toEqual({});
		},
		120000
	);

	it('records something for every plot type (guards a harness that edits nothing)', () => {
		for (const type of PLOT_TYPES) {
			const ok = Object.values(RESULTS[type] ?? {}).filter((v) => v === 'ok').length;
			expect(ok, type).toBeGreaterThanOrEqual(3);
		}
	});

	it('EXCLUSIONS and NO_SAVED_CHANGE only shrink: every entry still applies', () => {
		const result = (k) => RESULTS[k.split(' | ')[0]]?.[k];
		const stale = [
			...Object.keys(EXCLUSIONS).filter((k) => [undefined, 'ok', 'no change'].includes(result(k))),
			...Object.keys(NO_SAVED_CHANGE).filter((k) => result(k) !== 'no change')
		];
		expect(stale).toEqual([]);
	});
});
