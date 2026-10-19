// @ts-nocheck
// Settings > Data appearance: every edit applies, saves, counts as edited and undoes.
//
// REPORTED (vault TODO "Follow-ups from v82.21 to v82.23"): the editor passed `onChange` to
// ColourPicker, which only ever supported `bind:value`, so a colour picked for a row changed
// the swatch and nothing else: the session's appearance map (what every figure draws from, and
// what is saved) never heard of it. The shape, dash and Reset edits did write the map, but as
// plain writes outside the history: Cmd+Z did nothing and the session did not count as edited.
// Reproduced end to end first (batch1/app/s2.mjs): the map stayed `{slot: 0}` after a pick.
// Also found then: inside the Settings dialog (a modal <dialog>, in the browser's top layer)
// the picker's window was appended to <body>, BEHIND the dialog, so it could not be used at all.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { core, appState } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { history } from '$lib/core/opHistory.svelte.js';
import {
	initUnsavedChanges,
	markSessionSaved,
	hasUnsavedChanges
} from '$lib/core/unsavedChanges.svelte.js';
import AppearanceMapEditor from './AppearanceMapEditor.svelte';
import ColourPicker from './ColourPicker.svelte';

beforeAll(() => {
	history.init();
	initUnsavedChanges();
});

let colId;
beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
	const c = new Column({ type: 'number', data: -1 });
	c.customName = 'activity';
	core.rawData.set(c.id, [1, 2, 3]);
	c.data = c.id;
	core.data.push(c);
	colId = c.id;
	core.seriesAppearance = { [colId]: { colour: { slot: 0 }, shape: 'circle', dash: 'solid' } };
	appState.showColourPicker = false;
	history.clear();
	markSessionSaved();
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
});

const record = () => JSON.parse(JSON.stringify(core.seriesAppearance[colId] ?? null));

async function pickPaletteColour(container, index) {
	await fireEvent.click(container.querySelector('button.cp-preview'));
	await tick();
	await tick();
	const swatch = document.getElementById(`palette-${index}`);
	expect(swatch).not.toBeNull();
	await fireEvent.click(swatch);
	await tick();
}

describe('AppearanceMapEditor', () => {
	it('a colour picked for a row is written to the appearance map as an edited hex', async () => {
		const { container } = render(AppearanceMapEditor);
		await tick();
		const target = appState.appColours[3];
		await pickPaletteColour(container, 3);
		expect(record()).toEqual({
			colour: { hex: target },
			shape: 'circle',
			dash: 'solid',
			edited: true
		});
	});

	it('the colour edit is one undo step, counts as edited, and undo/redo restore it exactly', async () => {
		const { container } = render(AppearanceMapEditor);
		await tick();
		const before = record();
		const steps = history.undoCount;
		await pickPaletteColour(container, 2);
		expect(history.undoCount).toBe(steps + 1);
		expect(hasUnsavedChanges()).toBe(true);
		const after = record();
		history.undo();
		expect(record()).toEqual(before);
		history.redo();
		expect(record()).toEqual(after);
	});

	it('shape and dash edits are recorded and undo', async () => {
		const { container } = render(AppearanceMapEditor);
		await tick();
		const [shapeSel, dashSel] = container.querySelectorAll('select');
		const steps = history.undoCount;
		shapeSel.value = 'square';
		await fireEvent.change(shapeSel);
		expect(record().shape).toBe('square');
		expect(record().edited).toBe(true);
		expect(history.undoCount).toBe(steps + 1);
		expect(hasUnsavedChanges()).toBe(true);
		dashSel.value = '5, 5';
		await fireEvent.change(dashSel);
		expect(record().dash).toBe('5, 5');
		expect(history.undoCount).toBe(steps + 2);
		history.undo();
		expect(record().dash).toBe('solid');
		history.undo();
		expect(record()).toEqual({ colour: { slot: 0 }, shape: 'circle', dash: 'solid' });
	});

	it('Reset is recorded and undo brings the edited record back', async () => {
		core.seriesAppearance[colId] = {
			colour: { hex: '#123456' },
			shape: 'square',
			dash: 'solid',
			edited: true
		};
		const { container } = render(AppearanceMapEditor);
		await tick();
		const steps = history.undoCount;
		await fireEvent.click(container.querySelector('button.reset'));
		expect(record()).toBeNull();
		expect(history.undoCount).toBe(steps + 1);
		history.undo();
		expect(record()).toEqual({
			colour: { hex: '#123456' },
			shape: 'square',
			dash: 'solid',
			edited: true
		});
	});
});

describe('ColourPicker', () => {
	it('reports a user-picked colour through onChange', async () => {
		const seen = [];
		const { container } = render(ColourPicker, {
			props: { value: '#000000', onChange: (hex) => seen.push(hex) }
		});
		await tick();
		expect(seen).toEqual([]); // mounting is not an edit
		await pickPaletteColour(container, 1);
		expect(seen).toEqual([appState.appColours[1]]);
	});

	it('a hue-slider edit keeps the colour opaque (alpha starts at 100%, not 1%)', async () => {
		// rgbToHsv returned alpha on a 0..1 scale while the slider and hsvToRgb use 0..100, so
		// the first HSV slider move turned an opaque colour into an 8-digit hex at 1% alpha.
		const seen = [];
		const { container } = render(ColourPicker, {
			props: { value: '#336699', onChange: (hex) => seen.push(hex) }
		});
		await tick();
		await fireEvent.click(container.querySelector('button.cp-preview'));
		await tick();
		await tick();
		const alpha = document.querySelector('input[type="range"][id$="-alpha"]');
		expect(Number(alpha.value)).toBe(100);
		const more = [...document.querySelectorAll('button')].find((b) =>
			/More Options|More options/.test(b.textContent)
		);
		await fireEvent.click(more);
		await tick();
		const hue = document.querySelector('input[type="range"][id$="-hue"]');
		hue.value = '30';
		await fireEvent.input(hue);
		await tick();
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.at(-1)).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('opened inside a modal dialog, floats inside that dialog (not behind it on <body>)', async () => {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		document.body.append(dialog);
		const { container } = render(ColourPicker, { target: dialog, props: { value: '#000000' } });
		await tick();
		await fireEvent.click(container.querySelector('button.cp-preview'));
		await tick();
		await tick();
		const picker = document.querySelector('.colour-picker');
		expect(picker).not.toBeNull();
		expect(dialog.contains(picker)).toBe(true);
	});
});
