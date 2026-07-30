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
	const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (whole, name, fallback) => {
		const resolved = resolveCssVar(name, el) || (fallback ?? '').trim();
		if (!resolved) return whole;
		changed = true;
		return resolved;
	});
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

/**
 * A detached, export-ready copy of a plot's SVG.
 *
 * @param {SVGElement} svg the live element
 * @param {{width:number, height:number, backgroundColour?:string, physical?:boolean}} opts
 * @returns {SVGElement|null}
 */
export function prepareSvgForExport(svg, { width, height, backgroundColour, physical = false }) {
	if (!svg) return null;
	const clone = svg.cloneNode(true);
	resolveSvgVars(svg, clone);
	addBackgroundRect(clone, backgroundColour, width, height);
	if (physical) setPhysicalSize(clone, width, height);
	return clone;
}
