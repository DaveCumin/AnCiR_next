// Preparing an SVG for export.
//
// THE DEFECT THIS EXISTS FOR
//
// Plot output referenced CSS custom properties directly as presentation attributes,
// e.g. fill="var(--color-lightness-25)" in CWT, PairsPlot, Actogram and
// CircularPhase, and stroke="var(--color-lightness-25)" on the legend box. Those
// resolve on screen because the page defines the variables. They resolve in NEITHER
// export path:
//
//   - exportSVG writes the element's outerHTML to a Blob. A standalone SVG file has
//     no stylesheet, so the variable is unresolvable.
//   - convertToImage serialises the SVG and loads it through an <img> data URL. An
//     SVG loaded as an image is an isolated document with no access to the host
//     page's custom properties.
//
// `grep getComputedStyle` returned nothing repo-wide, so nothing inlined them first.
// The result: exported figures had unresolved paint, on screen-correct plots. For a
// feature whose whole purpose is publication output, that mattered more than
// anything else in the design.
//
// WHY A PARALLEL WALK
//
// getComputedStyle only works on elements IN the document. The clone is detached, so
// it cannot be asked. Instead the source tree and the clone are walked together —
// cloneNode preserves order, so querySelectorAll('*') yields corresponding elements
// at the same index — and each resolved value is read from the live element and
// written as a literal onto the clone. The live tree is never modified.
//
// Design spec: docs/superpowers/specs/2026-07-30-figure-style-system-design.md
import { PX_PER_MM } from '$lib/plots/figureStyle.js';

/** Paint attributes that can carry a var() reference. */
const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color', 'flood-color'];

/** True when a value needs resolving. */
function isVarRef(v) {
	return typeof v === 'string' && v.includes('var(');
}

/**
 * The value of a CSS custom property, as seen from `el`.
 *
 * Resolved by looking the PROPERTY up, not by asking for the computed paint. Asking
 * getComputedStyle for `fill` looks simpler but is not dependable: engines differ on
 * whether an SVG presentation attribute appears as a CSS property at all, and jsdom
 * does not substitute var() in them, so the behaviour could not be tested. Reading
 * the custom property works the same way everywhere.
 *
 * Walks inline declarations up the ancestor chain, then falls back to the computed
 * value on the element and finally on the document root, which is where this app's
 * design tokens are defined.
 */
export function resolveCssVar(name, el) {
	for (let node = el; node; node = node.parentElement) {
		const inline = node.style?.getPropertyValue?.(name);
		if (inline) return inline.trim();
	}
	if (typeof getComputedStyle === 'function') {
		if (el) {
			const own = getComputedStyle(el).getPropertyValue(name);
			if (own) return own.trim();
		}
		const root = globalThis.document?.documentElement;
		if (root) {
			const fromRoot = getComputedStyle(root).getPropertyValue(name);
			if (fromRoot) return fromRoot.trim();
		}
	}
	return '';
}

/**
 * Substitute every `var(--name)` / `var(--name, fallback)` in a value.
 *
 * Returns null when nothing could be resolved, so the caller can leave the attribute
 * as it found it rather than writing a broken partial value.
 */
export function substituteVars(value, el) {
	if (!isVarRef(value)) return null;
	let changed = false;
	const out = value.replace(
		/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g,
		(whole, name, fallback) => {
			const resolved = resolveCssVar(name, el) || (fallback ?? '').trim();
			if (!resolved) return whole;
			changed = true;
			return resolved;
		}
	);
	return changed && !isVarRef(out) ? out : null;
}

/**
 * Replace every var() paint on `clone` with the value the live `source` resolves to.
 *
 * @param {Element} source an element IN the document
 * @param {Element} clone  its detached copy
 * @returns {number} how many values were resolved (0 means there was nothing to do)
 */
export function resolveSvgVars(source, clone) {
	if (!source || !clone) return 0;
	const srcEls = [source, ...source.querySelectorAll('*')];
	const cloneEls = [clone, ...clone.querySelectorAll('*')];
	// Defensive: if the trees somehow differ, resolving by index would paint elements
	// with a neighbour's colour. Better to leave the export alone than corrupt it.
	if (srcEls.length !== cloneEls.length) return 0;

	let n = 0;
	for (let i = 0; i < srcEls.length; i++) {
		const src = srcEls[i];
		const dst = cloneEls[i];

		for (const attr of PAINT_ATTRS) {
			const resolved = substituteVars(dst.getAttribute?.(attr), src);
			if (resolved) {
				dst.setAttribute(attr, resolved);
				n++;
			}
		}

		// Inline style="fill: var(--x)" too, which is how d3 sets things.
		const styleAttr = dst.getAttribute?.('style');
		if (isVarRef(styleAttr)) {
			const resolved = substituteVars(styleAttr, src);
			if (resolved) {
				dst.setAttribute('style', resolved);
				n++;
			}
		}
	}
	return n;
}

/**
 * Put an opaque background behind the figure.
 *
 * A `<rect>` rather than a CSS background, because `background` is not an SVG
 * presentation attribute: it works in an HTML context and vanishes the moment the
 * file is standalone, which is exactly the case that matters here.
 *
 * Transparent is the right default on screen and the wrong one for submission (many
 * journals reject transparency in raster figures), so this is what makes the "White"
 * choice mean something in the exported file.
 *
 * @param {SVGElement} clone
 * @param {string} colour
 * @param {number} width
 * @param {number} height
 */
export function addBackgroundRect(clone, colour, width, height) {
	if (!clone || !colour || colour === 'transparent') return false;
	const rect = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
	rect.setAttribute('x', '0');
	rect.setAttribute('y', '0');
	rect.setAttribute('width', String(width));
	rect.setAttribute('height', String(height));
	rect.setAttribute('fill', colour);
	// First child, so it sits behind everything already drawn.
	clone.insertBefore(rect, clone.firstChild);
	return true;
}

/**
 * Declare the figure's real size on an exported SVG.
 *
 * width/height in mm with a px viewBox is what makes the file land at true physical
 * size in Illustrator or InDesign, instead of being interpreted at 96 dpi.
 *
 * @param {SVGElement} clone
 * @param {number} widthPx
 * @param {number} heightPx
 */
export function setPhysicalSize(clone, widthPx, heightPx) {
	if (!clone || !(widthPx > 0) || !(heightPx > 0)) return false;
	clone.setAttribute('viewBox', `0 0 ${widthPx} ${heightPx}`);
	clone.setAttribute('width', `${round2(widthPx / PX_PER_MM)}mm`);
	clone.setAttribute('height', `${round2(heightPx / PX_PER_MM)}mm`);
	return true;
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Title band
//
// The on-canvas plot has no title: its name lives in the box header, which is UI, not
// figure. On export the name is drawn INTO the file as a heading at the top-left, and
// the figure is shifted down to make room, so nothing overlaps an axis or a legend
// that already reaches the top edge. Layout is in multiples of the title font size so
// it scales with the journal type-size presets.
// ---------------------------------------------------------------------------

/** Line height, as a multiple of the font size. */
const TITLE_LINE_HEIGHT = 1.25;
/** Padding around the band, as a multiple of the font size. */
const TITLE_PAD = 0.6;
/** Beyond this the title is ellipsised: a figure heading is not a paragraph. */
const TITLE_MAX_LINES = 2;
/**
 * Average glyph advance for a bold sans face, as a fraction of the font size. An
 * estimate: the clone is detached, so it cannot be measured, and the file is opened
 * in software whose fonts we do not control anyway. Erring wide keeps the text inside
 * the figure.
 */
const TITLE_CHAR_WIDTH = 0.58;

/**
 * Word-wrap `text` to at most `maxChars` per line and `maxLines` lines; the last line
 * is ellipsised when there is more. A single word longer than a line is cut.
 *
 * @param {string} text
 * @param {number} maxChars
 * @param {number} [maxLines]
 * @returns {string[]}
 */
export function wrapTitle(text, maxChars, maxLines = TITLE_MAX_LINES) {
	const words = String(text ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (!words.length) return [];
	const cap = Math.max(1, Math.floor(maxChars));
	const lines = [];
	let line = '';
	for (const word of words) {
		const next = line ? line + ' ' + word : word;
		if (next.length <= cap) {
			line = next;
			continue;
		}
		if (line) lines.push(line);
		line = word.length > cap ? word.slice(0, cap) : word;
		if (lines.length === maxLines) break;
	}
	if (lines.length < maxLines) lines.push(line);
	const overflow =
		lines.length === maxLines && lines.join(' ').replace(/\s+/g, ' ') !== words.join(' ');
	if (overflow) {
		const last = lines[maxLines - 1];
		lines[maxLines - 1] = (last.length >= cap ? last.slice(0, cap - 1) : last).trimEnd() + '\u2026';
	}
	return lines;
}

/**
 * Draw a title (and/or a panel label) above the figure, shifting the content down.
 *
 * Everything already in the clone except top-level `<defs>` is wrapped in
 * `<g class="export-content" transform="translate(0, band)">`; `<defs>` stay where
 * they were so `url(#id)` references keep resolving. The svg's height and viewBox grow
 * by the band.
 *
 * @param {SVGElement} clone a detached copy
 * @param {{text?: string, label?: string, fontFamily: string, fontSize: number,
 *          width: number, height: number}} opts
 * @returns {{width: number, height: number}|null} the new size, or null when nothing was drawn
 */
export function addTitle(clone, { text = '', label = '', fontFamily, fontSize, width, height }) {
	const title = String(text ?? '').trim();
	const panel = String(label ?? '').trim();
	if (!clone || (!title && !panel)) return null;
	if (!(fontSize > 0) || !(width > 0)) return null;

	const pad = fontSize * TITLE_PAD;
	const lineHeight = fontSize * TITLE_LINE_HEIGHT;
	// The label is bold and followed by a space, so budget it out of the first line.
	const labelChars = panel ? panel.length + 1.5 : 0;
	const maxChars = (width - 2 * pad) / (fontSize * TITLE_CHAR_WIDTH) - labelChars;
	const lines = title ? wrapTitle(title, maxChars) : [''];
	const band = Math.round(pad + lines.length * lineHeight + pad / 2);

	const doc = clone.ownerDocument;
	const ns = 'http://www.w3.org/2000/svg';

	const content = doc.createElementNS(ns, 'g');
	content.setAttribute('class', 'export-content');
	content.setAttribute('transform', `translate(0, ${band})`);
	for (const child of Array.from(clone.childNodes)) {
		if (child.nodeType === 1 && child.tagName.toLowerCase() === 'defs') continue;
		content.appendChild(child);
	}
	clone.appendChild(content);

	const textEl = doc.createElementNS(ns, 'text');
	textEl.setAttribute('class', 'export-title');
	textEl.setAttribute('x', String(round2(pad)));
	textEl.setAttribute('y', String(round2(pad + fontSize * 0.9)));
	textEl.setAttribute('font-family', fontFamily);
	textEl.setAttribute('font-size', String(fontSize));
	textEl.setAttribute('font-weight', '600');
	textEl.setAttribute('fill', '#000000');
	lines.forEach((line, i) => {
		const span = doc.createElementNS(ns, 'tspan');
		span.setAttribute('x', String(round2(pad)));
		if (i > 0) span.setAttribute('dy', String(round2(lineHeight)));
		if (i === 0 && panel) {
			const labelSpan = doc.createElementNS(ns, 'tspan');
			labelSpan.setAttribute('class', 'export-panel-label');
			labelSpan.setAttribute('font-weight', '700');
			labelSpan.textContent = panel;
			span.appendChild(labelSpan);
			if (line) span.appendChild(doc.createTextNode('  ' + line));
		} else {
			span.textContent = line;
		}
		textEl.appendChild(span);
	});
	clone.appendChild(textEl);

	const newHeight = height + band;
	clone.setAttribute('width', String(width));
	clone.setAttribute('height', String(newHeight));
	clone.setAttribute('viewBox', `0 0 ${width} ${newHeight}`);
	return { width, height: newHeight };
}

/**
 * A detached, export-ready copy of a plot's SVG, with its final size.
 *
 * Order matters: the title enlarges the figure, so it goes before the background rect
 * (which must cover the band too) and the physical size declaration.
 *
 * @param {SVGElement} svg the live element
 * @param {{width:number, height:number, backgroundColour?:string, physical?:boolean,
 *          title?: {text?: string, label?: string, fontFamily: string, fontSize: number}|null,
 *          fontFamily?: string|null}} opts
 * @returns {{svg: SVGElement, width: number, height: number}|null}
 */
export function prepareExport(
	svg,
	{ width, height, backgroundColour, physical = false, title = null, fontFamily = null }
) {
	if (!svg) return null;
	const clone = svg.cloneNode(true);
	resolveSvgVars(svg, clone);
	setRootFontFamily(clone, fontFamily);
	let w = width;
	let h = height;
	if (title) {
		const grown = addTitle(clone, { ...title, width, height });
		if (grown) {
			w = grown.width;
			h = grown.height;
		}
	}
	addBackgroundRect(clone, backgroundColour, w, h);
	if (physical) setPhysicalSize(clone, w, h);
	return { svg: clone, width: w, height: h };
}

/**
 * Give the exported document a default typeface: the figure's.
 *
 * On screen, an svg <text> with no font-family inherits the page's font through CSS. An
 * exported file has no page, so every such element (actogram row numbers, histogram counts,
 * polar-grid radii, sig-bar stars, heatmap values) fell back to the viewer's default, which
 * is Times in browsers and most editors: a serif scattered through a sans-serif figure.
 * A presentation attribute on the root is inherited by every descendant that does not set
 * its own, so this one line covers them all. An element with its own family is untouched.
 *
 * @param {SVGElement} clone
 * @param {string|null} fontFamily a CSS font stack, e.g. from resolveStyle().fontFamily
 */
export function setRootFontFamily(clone, fontFamily) {
	if (!clone || !fontFamily) return;
	if (clone.getAttribute('font-family')) return;
	clone.setAttribute('font-family', fontFamily);
}

/**
 * `prepareExport` for callers that only want the element.
 *
 * @param {SVGElement} svg the live element
 * @param {{width:number, height:number, backgroundColour?:string, physical?:boolean}} opts
 * @returns {SVGElement|null}
 */
export function prepareSvgForExport(svg, opts) {
	return prepareExport(svg, opts)?.svg ?? null;
}
