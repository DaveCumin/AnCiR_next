// The Save dialog: one popup with a live preview and the export options, replacing the
// nested PNG/SVG submenus.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { core } from '$lib/core/core.svelte';
import { history } from '$lib/core/opHistory.svelte.js';

vi.mock('$lib/components/plotbits/helpers/save.svelte.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		saveExport: vi.fn(async () => 1),
		saveDataAsCSV: vi.fn(),
		showDataAsTable: vi.fn()
	};
});

import { saveExport, EXPORT_OPTIONS_KEY } from '$lib/components/plotbits/helpers/save.svelte.js';
import SavePlot from './SavePlot.svelte';

Element.prototype.animate ??= () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });

const SVG_NS = 'http://www.w3.org/2000/svg';
let hosts = [];
/**
 * A plot whose live svg follows its width/height, as a real plot component's does.
 * Accessors rather than runes (this is a plain .test.js), and synchronous, which is
 * what the dialog's re-render-at-size relies on (see withPlotSize).
 */
function mountPlot(id, name = 'Plot ' + id, x = 0, { style = null, w = 200, h = 100 } = {}) {
	const host = document.createElement('div');
	host.innerHTML = `<svg xmlns="${SVG_NS}" id="plot${id}" width="${w}" height="${h}"><circle r="5" /></svg>`;
	document.body.appendChild(host);
	hosts.push(host);
	const live = host.querySelector('svg');
	const box = { w, h };
	const plot = {
		id,
		name,
		x,
		y: 0,
		get width() {
			return box.w;
		},
		set width(v) {
			box.w = v;
			live.setAttribute('width', String(v));
		},
		get height() {
			return box.h;
		},
		set height(v) {
			box.h = v;
			live.setAttribute('height', String(v));
		},
		style,
		plot: { getDownloadData: () => ({ headers: ['a'], rows: [[1]] }) }
	};
	core.plots.push(plot);
	// core.plots is $state, so the entry is a proxy; reads must go through it.
	return core.plots[core.plots.length - 1];
}

const caption = () => document.querySelector('.preview-caption')?.textContent ?? '';
const field = (name) => document.querySelector(`input[name="${name}"]`);
// Typing: the fields react on `input`, not on change/blur.
const setField = async (name, value) => {
	await fireEvent.input(field(name), { target: { value: String(value) } });
};
const button = (re) =>
	[...document.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()));
const pagerButton = (label) => document.querySelector(`button[aria-label="${label} plot"]`);
const saveButton = () => button(/^Save/);

beforeEach(() => {
	hosts = [];
	history.init();
	history.clear();
	try {
		localStorage.removeItem(EXPORT_OPTIONS_KEY);
	} catch {
		/* no storage */
	}
});
afterEach(() => {
	cleanup();
	for (const h of hosts) h.remove();
	core.plots.length = 0;
	vi.clearAllMocks();
});

const byLabel = (text) =>
	[...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(text))
		?.control ??
	[...document.querySelectorAll('label')]
		.find((l) => l.textContent.trim().startsWith(text))
		?.querySelector('input');

describe('SavePlot dialog', () => {
	it('renders the options with their defaults and a preview of the export', async () => {
		mountPlot(1, 'Activity');
		render(SavePlot, { props: { open: true, Id: 'plot1' } });
		await waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
		expect(byLabel('PNG').checked).toBe(true);
		expect(byLabel('SVG').checked).toBe(false);
		expect(byLabel('Include title').checked).toBe(true);
		// Single plot: no layout or panel-label choices.
		expect(byLabel('Combined')).toBeUndefined();
		expect(byLabel('Panel labels')).toBeUndefined();
		// The preview is the export itself, so the title is in it.
		await waitFor(() => {
			const img = document.querySelector('img.export-preview');
			expect(img).not.toBeNull();
			expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
			expect(atob(img.getAttribute('src').split(',')[1])).toContain('Activity');
		});
		// Secondary data actions are reachable from the dialog.
		expect(document.querySelector('button.link-btn')).not.toBeNull();
	});

	it('updates the preview and caption when the format changes', async () => {
		mountPlot(1, 'Activity');
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() =>
			expect(document.querySelector('.preview-caption')?.textContent).toMatch(/px/)
		);
		await fireEvent.click(byLabel('SVG'));
		await waitFor(() =>
			expect(document.querySelector('.preview-caption')?.textContent).toMatch(/mm/)
		);
		// And the title toggle reaches the preview.
		await fireEvent.click(byLabel('Include title'));
		await waitFor(() => {
			const img = document.querySelector('img.export-preview');
			expect(atob(img.getAttribute('src').split(',')[1])).not.toContain('export-title');
		});
	});

	it('offers layout and panel labels for several plots and passes them to the save', async () => {
		mountPlot(1, 'One', 0);
		mountPlot(2, 'Two', 300);
		render(SavePlot, { props: { open: true, Id: [1, 2] } });
		await waitFor(() => expect(byLabel('Combined')).toBeDefined());
		expect(byLabel('Combined').checked).toBe(true);
		await fireEvent.click(byLabel('Panel labels'));
		await fireEvent.click(byLabel('SVG'));
		const save = [...document.querySelectorAll('button')].find((b) =>
			/^Save/.test(b.textContent.trim())
		);
		await fireEvent.click(save);
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(saveExport.mock.calls[0][0]).toEqual([1, 2]);
		expect(saveExport.mock.calls[0][1]).toMatchObject({
			format: 'svg',
			includeTitle: true,
			panelLabels: true,
			combined: true
		});
		// Remembered for next time.
		expect(JSON.parse(localStorage.getItem(EXPORT_OPTIONS_KEY))).toMatchObject({
			format: 'svg',
			panelLabels: true
		});
	});

	it('closes on Escape and on Cancel without saving', async () => {
		mountPlot(1);
		const { component } = render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(document.querySelector('dialog')).not.toBeNull());
		await fireEvent.keyDown(document.querySelector('.save-dialog'), { key: 'Escape' });
		await tick();
		// The dialog element may linger for its fade-out; what matters is that it is closed.
		await waitFor(() => expect(document.querySelector('dialog')?.open).toBeFalsy());
		expect(saveExport).not.toHaveBeenCalled();
		void component;
	});
});

describe('SavePlot dialog: resolution', () => {
	it('shows the dpi field for PNG only, prefilled from the figure style, and updates the pixel caption', async () => {
		mountPlot(1, 'Activity', 0, { style: { exportDpi: 150 }, w: 400, h: 200 });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('dpi')).not.toBeNull());
		expect(field('dpi').value).toBe('150');
		// 400 px at 150 dpi is 625 px; the title band adds to the height, so check the width.
		await waitFor(() => expect(caption()).toMatch(/PNG, 625 × \d+ px at 150 dpi/));
		await fireEvent.click(button(/^300$/));
		expect(field('dpi').value).toBe('300');
		await waitFor(() => expect(caption()).toMatch(/PNG, 1250 × \d+ px at 300 dpi/));
		await setField('dpi', 96);
		await waitFor(() => expect(caption()).toMatch(/PNG, 400 × \d+ px at 96 dpi/));
		// SVG has no resolution.
		await fireEvent.click(byLabel('SVG'));
		await waitFor(() => expect(field('dpi')).toBeNull());
		expect(button(/^300$/)).toBeUndefined();
	});

	it('clamps a typed dpi to the bounds', async () => {
		mountPlot(1, 'Activity', 0, { style: { exportDpi: 300 } });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('dpi')).not.toBeNull());
		await setField('dpi', 5000);
		await fireEvent.blur(field('dpi'));
		await waitFor(() => expect(field('dpi').value).toBe('1200'));
		await setField('dpi', 2);
		await fireEvent.blur(field('dpi'));
		await waitFor(() => expect(field('dpi').value).toBe('30'));
	});
});

describe('SavePlot dialog: dimensions', () => {
	it('offers width and height for a single plot, prefilled, with the physical size and an aspect lock', async () => {
		mountPlot(1, 'Activity', 0, { w: 500, h: 250 });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		expect(field('width').value).toBe('500');
		expect(field('height').value).toBe('250');
		expect(byLabel('Lock aspect').checked).toBe(true);
		// 500 px is 132 mm at 96 px per inch, whatever the dpi.
		expect(document.querySelector('.physical-size').textContent).toMatch(/132 × 66 mm/);
		// Locked: the height follows the width on the plot's own ratio.
		await setField('width', 1000);
		await waitFor(() => expect(field('height').value).toBe('500'));
		await setField('height', 300);
		await waitFor(() => expect(field('width').value).toBe('600'));
		// Unlocked: each field stands alone.
		await fireEvent.click(byLabel('Lock aspect'));
		await setField('width', 800);
		expect(field('height').value).toBe('300');
		// The preview is rendered at the new size (the export's own width, not a scaled copy).
		await waitFor(() => expect(caption()).toMatch(/PNG, 2500 × \d+ px at 300 dpi/));
	});

	it('has no dimension fields for a combined figure, and says why', async () => {
		mountPlot(1, 'One', 0);
		mountPlot(2, 'Two', 300);
		render(SavePlot, { props: { open: true, Id: [1, 2] } });
		await waitFor(() => expect(byLabel('Combined')).toBeDefined());
		expect(field('width')).toBeNull();
		expect(document.querySelector('.dims-note').textContent).toMatch(/as arranged on the canvas/i);
		expect(document.querySelector('.pager')).toBeNull();
		await fireEvent.click(byLabel('Individual files'));
		await waitFor(() => expect(field('width')).not.toBeNull());
		expect(document.querySelector('.dims-note')).toBeNull();
	});
});

describe('SavePlot dialog: panel label style', () => {
	it('offers the style only when labels are on and combined, defaults to a, b, c, and exports it', async () => {
		mountPlot(1, 'One', 0);
		mountPlot(2, 'Two', 300);
		mountPlot(3, 'Three', 600);
		mountPlot(4, 'Four', 900);
		render(SavePlot, { props: { open: true, Id: [1, 2, 3, 4] } });
		await waitFor(() => expect(byLabel('Panel labels')).toBeDefined());
		const styles = () => [...document.querySelectorAll('input[name="save-label-style"]')];
		expect(styles()).toHaveLength(0);
		await fireEvent.click(byLabel('Panel labels'));
		await waitFor(() => expect(styles()).toHaveLength(4));
		expect(styles().map((r) => r.getAttribute('aria-label'))).toEqual([
			'A, B, C',
			'a, b, c',
			'1, 2, 3',
			'i, ii, iii'
		]);
		expect(styles().find((r) => r.checked).value).toBe('lower');
		const exported = () =>
			atob(document.querySelector('img.export-preview').getAttribute('src').split(',')[1]);
		await waitFor(() => expect(exported()).toContain('>d<'));
		await fireEvent.click(styles().find((r) => r.value === 'roman'));
		await waitFor(() => expect(exported()).toContain('>iv<'));
		await fireEvent.click(styles().find((r) => r.value === 'upper'));
		await waitFor(() => expect(exported()).toContain('>D<'));
		await fireEvent.click(styles().find((r) => r.value === 'roman'));
		// Individual files: no labels, so no style either.
		await fireEvent.click(byLabel('Individual files'));
		await waitFor(() => expect(styles()).toHaveLength(0));
		await fireEvent.click(byLabel('Combined'));
		await waitFor(() => expect(styles()).toHaveLength(4));
		expect(styles().find((r) => r.checked).value).toBe('roman');
		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(saveExport.mock.calls[0][1]).toMatchObject({ panelLabels: true, labelStyle: 'roman' });
		expect(JSON.parse(localStorage.getItem(EXPORT_OPTIONS_KEY)).labelStyle).toBe('roman');
	});
});

describe('SavePlot dialog: typing into the size fields', () => {
	it('moves the partner field, the readout and the preview with every keystroke', async () => {
		mountPlot(1, 'Activity', 0, { w: 500, h: 250 });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await waitFor(() => expect(caption()).toMatch(/PNG, 1563 ×/));
		field('width').focus();
		// "1" and "10" are on the way to "1000": below 10 nothing moves, from 10 on the
		// partner follows each keystroke, and nothing has been blurred or changed.
		await setField('width', 1);
		expect(field('height').value).toBe('250');
		await setField('width', 10);
		expect(field('height').value).toBe('5');
		await setField('width', 100);
		expect(field('height').value).toBe('50');
		await setField('width', 1000);
		expect(field('height').value).toBe('500');
		expect(field('width').value).toBe('1000');
		expect(document.querySelector('.physical-size').textContent).toMatch(/265 × 132 mm/);
		await waitFor(() => expect(caption()).toMatch(/PNG, 3125 × \d+ px at 300 dpi/));
		// The typed field is not rewritten mid-edit: "800.4" stays as typed until blur.
		await setField('width', '800.4');
		expect(field('width').value).toBe('800.4');
		expect(field('height').value).toBe('400');
		await fireEvent.blur(field('width'));
		await waitFor(() => expect(field('width').value).toBe('800'));
	});

	it('holds the last valid size while a field is empty or not a number', async () => {
		mountPlot(1, 'Activity', 0, { w: 500, h: 250 });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await setField('width', 800);
		await waitFor(() => expect(caption()).toMatch(/PNG, 2500 ×/));
		await setField('width', '');
		expect(field('height').value).toBe('400');
		expect(document.querySelector('.physical-size').textContent).toMatch(/212 × 106 mm/);
		await new Promise((r) => setTimeout(r, 250));
		expect(caption()).toMatch(/PNG, 2500 ×/);
		expect(caption()).not.toMatch(/NaN/);
		await setField('width', 'abc');
		await new Promise((r) => setTimeout(r, 250));
		expect(caption()).toMatch(/PNG, 2500 ×/);
		// Blur puts the held value back in the field.
		await fireEvent.blur(field('width'));
		await waitFor(() => expect(field('width').value).toBe('800'));
		// The dpi field holds too: an emptied field keeps the preview at the last dpi.
		await setField('dpi', '');
		await new Promise((r) => setTimeout(r, 250));
		expect(caption()).toMatch(/at 300 dpi/);
		await setField('dpi', 150);
		await waitFor(() => expect(caption()).toMatch(/PNG, 1250 × \d+ px at 150 dpi/));
	});
});

describe('SavePlot dialog: pager', () => {
	it("pages through the plots in individual mode and keeps each plot's edited size", async () => {
		mountPlot(1, 'One', 0, { w: 200, h: 100 });
		mountPlot(2, 'Two', 300, { w: 400, h: 100 });
		mountPlot(3, 'Three', 600, { w: 600, h: 100 });
		render(SavePlot, { props: { open: true, Id: [1, 2, 3] } });
		await waitFor(() => expect(byLabel('Individual files')).toBeDefined());
		await fireEvent.click(byLabel('Individual files'));
		await waitFor(() => expect(document.querySelector('.pager')).not.toBeNull());
		const indicator = () => document.querySelector('.pager-label').textContent.trim();
		expect(indicator()).toBe('Plot 1 of 3');
		expect(field('width').value).toBe('200');
		expect(byLabel('Panel labels').disabled).toBe(true);
		// The preview shows the current plot.
		await waitFor(() => expect(caption()).toMatch(/^Plot 1 of 3: PNG, 625 ×/));

		await setField('width', 250);
		await fireEvent.click(pagerButton('Next'));
		expect(indicator()).toBe('Plot 2 of 3');
		expect(field('width').value).toBe('400');
		await waitFor(() => expect(caption()).toMatch(/^Plot 2 of 3: PNG, 1250 ×/));
		await setField('width', 450);

		// Arrow keys page too, but not from inside a text field.
		await fireEvent.keyDown(document, { key: 'ArrowRight' });
		expect(indicator()).toBe('Plot 3 of 3');
		expect(pagerButton('Next').disabled).toBe(true);
		field('width').focus();
		await fireEvent.keyDown(document, { key: 'ArrowLeft' });
		expect(indicator()).toBe('Plot 3 of 3');
		field('width').blur();
		await fireEvent.keyDown(document, { key: 'ArrowLeft' });
		expect(indicator()).toBe('Plot 2 of 3');
		expect(field('width').value).toBe('450');
		await fireEvent.click(pagerButton('Previous'));
		expect(indicator()).toBe('Plot 1 of 3');
		expect(field('width').value).toBe('250');
		expect(pagerButton('Previous').disabled).toBe(true);

		// Save applies every edited size.
		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(core.plots[0].width).toBe(250);
		expect(core.plots[1].width).toBe(450);
		expect(core.plots[2].width).toBe(600);
		expect(saveExport.mock.calls[0][1].sizes).toEqual({
			1: { width: 250, height: 125 },
			2: { width: 450, height: 113 }
		});
	});
});

describe('SavePlot dialog: writing back to the plot', () => {
	it('writes width, height and dpi to the plot on Save as ONE undo step', async () => {
		const plot = mountPlot(1, 'Activity', 0, {
			w: 500,
			h: 250,
			style: { exportDpi: 300, widthPreset: 'custom', widthMm: null }
		});
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await setField('width', 800);
		await fireEvent.click(button(/^150$/));
		expect(history.undoCount).toBe(0);
		// Nothing is written while editing.
		expect(plot.width).toBe(500);
		expect(plot.style.exportDpi).toBe(300);

		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(plot.width).toBe(800);
		expect(plot.height).toBe(400);
		expect(plot.style.exportDpi).toBe(150);
		expect(history.undoCount).toBe(1);
		expect(saveExport.mock.calls[0][1]).toMatchObject({ format: 'png', dpi: 150 });

		history.undo();
		expect(plot.width).toBe(500);
		expect(plot.height).toBe(250);
		expect(plot.style.exportDpi).toBe(300);
		history.redo();
		expect(plot.width).toBe(800);
		expect(plot.style.exportDpi).toBe(150);
		// Remembered: dpi and the lock, never the dimensions.
		const remembered = JSON.parse(localStorage.getItem(EXPORT_OPTIONS_KEY));
		expect(remembered).toMatchObject({ dpi: 150, lockAspect: true });
		expect(remembered.sizes).toBeUndefined();
		expect(remembered.width).toBeUndefined();
	});

	it('records nothing when nothing changed, and does not write dpi for an SVG', async () => {
		const plot = mountPlot(1, 'Activity', 0, { style: { exportDpi: 300 } });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(history.undoCount).toBe(0);
		expect(plot.style.exportDpi).toBe(300);
	});

	it('keeps a style-fixed width honest: the preset becomes custom at the new size', async () => {
		const plot = mountPlot(1, 'Activity', 0, {
			w: 321,
			h: 200,
			style: { exportDpi: 300, widthPreset: 'single', widthMm: null }
		});
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await setField('width', 642);
		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(plot.width).toBe(642);
		expect(plot.style.widthPreset).toBe('custom');
		expect(plot.style.widthMm).toBeCloseTo(642 / (96 / 25.4), 1);
	});

	it('Cancel writes nothing back', async () => {
		const plot = mountPlot(1, 'Activity', 0, { style: { exportDpi: 300 } });
		render(SavePlot, { props: { open: true, Id: [1] } });
		await waitFor(() => expect(field('width')).not.toBeNull());
		await setField('width', 999);
		await fireEvent.click(button(/^600$/));
		await fireEvent.click(button(/^Cancel$/));
		await waitFor(() => expect(document.querySelector('dialog')?.open).toBeFalsy());
		expect(plot.width).toBe(200);
		expect(plot.style.exportDpi).toBe(300);
		expect(history.undoCount).toBe(0);
		expect(saveExport).not.toHaveBeenCalled();
	});

	it('in combined mode the dpi goes to the first panel only', async () => {
		const a = mountPlot(1, 'One', 0, { style: { exportDpi: 300 } });
		const b = mountPlot(2, 'Two', 300, { style: { exportDpi: 300 } });
		render(SavePlot, { props: { open: true, Id: [1, 2] } });
		await waitFor(() => expect(field('dpi')).not.toBeNull());
		await fireEvent.click(button(/^72$/));
		await fireEvent.click(saveButton());
		await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
		expect(a.style.exportDpi).toBe(72);
		expect(b.style.exportDpi).toBe(300);
		expect(history.undoCount).toBe(1);
	});
});

describe('SavePlot dialog with remembered options', () => {
	it('renders the preview and the remembered format on open', async () => {
		localStorage.setItem(
			EXPORT_OPTIONS_KEY,
			JSON.stringify({ format: 'svg', includeTitle: false, panelLabels: false, combined: true })
		);
		mountPlot(1, 'Remembered');
		// Mounted closed and opened later, as every caller does it.
		const { rerender } = render(SavePlot, { props: { open: false, Id: [1] } });
		await tick();
		await rerender({ open: true, Id: [1] });
		await waitFor(() =>
			expect(document.querySelector('.preview-caption')?.textContent).toMatch(/mm/)
		);
		expect(byLabel('SVG').checked).toBe(true);
		expect(byLabel('Include title').checked).toBe(false);
		const svgLabel = [...document.querySelectorAll('.segmented label')].find((l) =>
			l.textContent.includes('SVG')
		);
		expect(svgLabel.classList.contains('active')).toBe(true);
		expect(document.querySelector('img.export-preview')).not.toBeNull();
	});
});
