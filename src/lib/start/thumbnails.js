// @ts-nocheck
// Monochrome SVG thumbnails for the start screen.
//
// These do more explanatory work than any label: a free-running actogram drifting against the
// 24 h grid says "this is the tau workflow" faster than the title does. They are wayfinding, not
// figures — no axes, no labels, no colour. Everything is drawn in `currentColor` at varying
// opacity so the caller controls the ink.
//
// Two producers:
//   • thumbnailForWorkflow(id) — deterministic + procedural, seeded by the workflow id, so the
//     example library always has a stable image with zero runtime data cost. (Brief's approach 3,
//     which is also the fallback for anything we can't draw from real data.)
//   • thumbnailFromSeries(values, opts) — drawn from a session's OWN data, for recents, so a
//     recent shows what it actually contains. (Brief's approach 1.)
//
// Output is a plain SVG string: cheap to inline, and small enough to sit in the localStorage
// recents index (~0.6-1.2 kB each; the index caps at 8 entries).

const W = 120;
const H = 80;

/** Deterministic PRNG so a given id always yields the same picture. */
function mulberry32(seed) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Stable 32-bit hash of a string, so ids seed the PRNG reproducibly. */
function hashSeed(str) {
	let h = 2166136261;
	for (let i = 0; i < String(str).length; i++) {
		h ^= String(str).charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

const r1 = (n) => Math.round(n * 10) / 10; // keep the markup small

/** Contiguous true-runs of a boolean array, as [startIndex, length] pairs. */
function runsOf(flags) {
	const runs = [];
	let start = -1;
	for (let i = 0; i <= flags.length; i++) {
		if (flags[i]) {
			if (start === -1) start = i;
		} else if (start !== -1) {
			runs.push([start, i - start]);
			start = -1;
		}
	}
	return runs;
}

function svg(inner) {
	return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">${inner}</svg>`;
}

// --- shapes -----------------------------------------------------------------

/**
 * A double-plotted actogram: every row spans 48 h — day d on the left half, day d+1 on the right.
 * That doubling is what makes a drifting rhythm read as a diagonal band instead of a wrapped mess,
 * and it's the view a chronobiologist recognises instantly.
 *
 * @param {'entrained'|'freerun'|'phaseshift'|'fragmented'} variant
 */
function actogram(rng, variant = 'entrained') {
	const ROWS = 7;
	const rowH = H / ROWS;
	const barH = rowH - 1.6;
	const hourW = W / 48; // 48 h across the full width

	// Each variant depicts its OWN phenomenon rather than a reseeded version of the same one:
	// a returning user should be able to tell the cards apart at 120 px without reading them.
	// Returns the day's activity bands as [onsetHour, durationHours] pairs.
	const bandsFor = (day) => {
		switch (variant) {
			case 'freerun': // tau well over 24 h → steady rightward drift
				return [[7 + day * 1.6, 10]];
			case 'freerun-slow': // non-24 in a human: the same drift, much shallower
				return [[7 + day * 0.55, 9]];
			case 'phaseshift': // an abrupt re-entrainment, no transients
				return [[day < 3 ? 8 : 14, 10]];
			case 'transients': // the slow diagonal crawl into the new phase
				return [[day < 2 ? 8 : Math.min(14, 8 + (day - 1) * 1.6), 10]];
			case 'masking': // follows the light, then snaps back on release
				return [[day >= 2 && day < 5 ? 14 : 8, 10]];
			case 'split': {
				// One band bifurcating into two that stabilise ~12 h apart.
				const sep = Math.min(11, day * 1.7);
				return [
					[8 - sep / 2, 6],
					[8 + sep / 2, 6]
				];
			}
			case 'tidal': // two bouts a day at 12.4 h, drifting against the 24 h grid
				return [
					[(day * 0.9) % 24, 5],
					[(day * 0.9 + 12.4) % 24, 5]
				];
			default:
				return [[8, 10]];
		}
	};

	let out = '';
	for (let row = 0; row < ROWS; row++) {
		// Alternating row wash so the 48 h rows stay legible at this size.
		if (row % 2 === 1)
			out += `<rect x="0" y="${r1(row * rowH)}" width="${W}" height="${r1(rowH)}" fill="currentColor" opacity="0.04"/>`;
		for (let half = 0; half < 2; half++) {
			const day = row + half;
			// Mark the active hours, then emit ONE rect per contiguous run. Drawing a rect per
			// hour is visually identical but ~10x the markup, which matters because recents live
			// in localStorage.
			const active = new Array(24).fill(false);
			for (const [onset, duration] of bandsFor(day)) {
				const start = ((onset % 24) + 24) % 24;
				for (let h = 0; h < 24; h++) {
					const within = h >= start && h < start + duration;
					const wrapped = start + duration > 24 && h < (start + duration) % 24;
					if (within || wrapped) active[h] = true;
				}
			}
			if (variant === 'fragmented') {
				// Fragment in 2 h blocks rather than per hour: chunkier gaps are far more legible
				// at 120 px wide, and they halve the number of runs (and so the markup size).
				const BLOCK = 2;
				for (let b = 0; b < 24; b += BLOCK) {
					if (rng() < 0.34) for (let k = b; k < b + BLOCK; k++) active[k] = false; // holes
				}
				for (let b = 0; b < 24; b += BLOCK) {
					if (rng() < 0.1) for (let k = b; k < b + BLOCK; k++) active[k] = true; // night bouts
				}
			}
			for (const [start, len] of runsOf(active)) {
				const x = half * 24 * hourW + start * hourW;
				out += `<rect x="${r1(x)}" y="${r1(row * rowH + 0.8)}" width="${r1(len * hourW - hourW * 0.1)}" height="${r1(barH)}" fill="currentColor" opacity="0.75"/>`;
			}
		}
	}
	// Midline marking the day/day boundary of the double plot.
	out += `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="currentColor" stroke-width="0.6" opacity="0.25"/>`;
	return svg(out);
}
function actogramFromSeries(values, perDay) {
	const days = Math.min(7, Math.floor(values.length / perDay));
	const rowH = H / days;
	const barH = Math.max(1.2, rowH - 1.6);
	const cellW = W / (perDay * 2);
	const max = Math.max(...values) || 1;
	const min = Math.min(...values);
	const span = max - min || 1;
	let out = '';
	for (let row = 0; row < days; row++) {
		if (row % 2 === 1)
			out += `<rect x="0" y="${r1(row * rowH)}" width="${W}" height="${r1(rowH)}" fill="currentColor" opacity="0.04"/>`;
		for (let half = 0; half < 2; half++) {
			const day = row + half;
			// Threshold to "active", then emit one rect per contiguous run (opacity = run mean).
			// Per-sample rects would be ~300 elements per image — far too big for localStorage.
			const active = new Array(perDay).fill(false);
			const norms = new Array(perDay).fill(0);
			for (let s = 0; s < perDay; s++) {
				const v = values[day * perDay + s];
				if (v == null) continue;
				const norm = (v - min) / span;
				norms[s] = norm;
				if (norm >= 0.12) active[s] = true; // suppress baseline so the active band stands out
			}
			for (const [start, len] of runsOf(active)) {
				let mean = 0;
				for (let k = start; k < start + len; k++) mean += norms[k];
				mean /= len;
				const x = half * perDay * cellW + start * cellW;
				out += `<rect x="${r1(x)}" y="${r1(row * rowH + 0.8)}" width="${r1(len * cellW - cellW * 0.1)}" height="${r1(barH)}" fill="currentColor" opacity="${r1(0.15 + mean * 0.7)}"/>`;
			}
		}
	}
	out += `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="currentColor" stroke-width="0.6" opacity="0.25"/>`;
	return svg(out);
}
function boxplots(rng, n = 2) {
	const pad = 12;
	const slot2 = (W - pad * 2) / n;
	let out = '';
	for (let i = 0; i < n; i++) {
		const cx = pad + slot2 * (i + 0.5);
		const bw = Math.min(slot2 * 0.5, 16);
		const centre = 46 - i * (10 / Math.max(1, n - 1 || 1)) + (rng() - 0.5) * 6;
		const q = 9 + rng() * 4;
		out += `<line x1="${r1(cx)}" y1="${r1(centre - q * 2)}" x2="${r1(cx)}" y2="${r1(centre + q * 2)}" stroke="currentColor" stroke-width="1" opacity="0.5"/>`;
		out += `<rect x="${r1(cx - bw / 2)}" y="${r1(centre - q)}" width="${r1(bw)}" height="${r1(q * 2)}" fill="currentColor" opacity="0.16" stroke="currentColor" stroke-width="1" stroke-opacity="0.7"/>`;
		out += `<line x1="${r1(cx - bw / 2)}" y1="${r1(centre)}" x2="${r1(cx + bw / 2)}" y2="${r1(centre)}" stroke="currentColor" stroke-width="1.4" opacity="0.9"/>`;
	}
	out += baseline();
	return svg(out);
}
function scatterFit(rng) {
	const pad = 10;
	let out = '';
	for (let i = 0; i < 26; i++) {
		const x = pad + (W - pad * 2) * (i / 25);
		const y = H - pad - (H - pad * 2) * (i / 25) + (rng() - 0.5) * 16;
		out += `<circle cx="${r1(x)}" cy="${r1(Math.max(4, Math.min(H - 4, y)))}" r="1.7" fill="currentColor" opacity="0.55"/>`;
	}
	out += `<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${pad}" stroke="currentColor" stroke-width="1.6" opacity="0.9"/>`;
	return svg(out);
}
function logisticCurve(rng) {
	const pad = 10;
	const x0 = pad;
	const x1 = W - pad;
	const yTop = pad + 2;
	const yBot = H - pad - 2;
	let d = '';
	for (let i = 0; i <= 30; i++) {
		const t = i / 30;
		const x = x0 + (x1 - x0) * t;
		const p = 1 / (1 + Math.exp(-(t * 12 - 6)));
		const y = yBot - (yBot - yTop) * p;
		d += `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`;
	}
	let out = `<path d="${d}" stroke="currentColor" stroke-width="1.6" opacity="0.9"/>`;
	for (let i = 0; i < 14; i++) {
		const t = rng();
		const x = x0 + (x1 - x0) * t;
		const p = 1 / (1 + Math.exp(-(t * 12 - 6)));
		const y = rng() < p ? yTop : yBot;
		out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="1.6" fill="currentColor" opacity="0.45"/>`;
	}
	return svg(out);
}
function heatmap(rng, n = 5) {
	const pad = 10;
	const cell = (W - pad * 2) / n;
	const top = (H - cell * n) / 2;
	let out = '';
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			const v = i === j ? 1 : Math.max(0.06, 1 - Math.abs(i - j) / n - rng() * 0.25);
			out += `<rect x="${r1(pad + j * cell)}" y="${r1(top + i * cell)}" width="${r1(cell - 1)}" height="${r1(cell - 1)}" fill="currentColor" opacity="${r1(0.08 + v * 0.72)}"/>`;
		}
	}
	return svg(out);
}
function contingency(rng) {
	const cols = 3;
	const rows = 2;
	const pad = 12;
	const cw = (W - pad * 2) / cols;
	const ch = (H - pad * 2) / rows;
	let out = '';
	for (let i = 0; i < rows; i++) {
		for (let j = 0; j < cols; j++) {
			out += `<rect x="${r1(pad + j * cw)}" y="${r1(pad + i * ch)}" width="${r1(cw - 2)}" height="${r1(ch - 2)}" fill="currentColor" opacity="${r1(0.1 + rng() * 0.55)}" stroke="currentColor" stroke-width="0.6" stroke-opacity="0.4"/>`;
		}
	}
	return svg(out);
}
function circular(rng) {
	const cx = W / 2;
	const cy = H / 2;
	const R = Math.min(W, H) / 2 - 8;
	let out = `<circle cx="${cx}" cy="${cy}" r="${r1(R)}" stroke="currentColor" stroke-width="1" opacity="0.35"/>`;
	const mean = -Math.PI / 3;
	for (let i = 0; i < 16; i++) {
		const a = mean + (rng() - 0.5) * 1.1;
		out += `<circle cx="${r1(cx + Math.cos(a) * R * 0.82)}" cy="${r1(cy + Math.sin(a) * R * 0.82)}" r="1.7" fill="currentColor" opacity="0.6"/>`;
	}
	out += `<line x1="${cx}" y1="${cy}" x2="${r1(cx + Math.cos(mean) * R * 0.7)}" y2="${r1(cy + Math.sin(mean) * R * 0.7)}" stroke="currentColor" stroke-width="1.8" opacity="0.95"/>`;
	return svg(out);
}
function miniHistograms(rng) {
	let out = '';
	const panels = [
		[6, 6],
		[64, 6],
		[6, 44],
		[64, 44]
	];
	for (const [px, py] of panels) {
		const pw = 50;
		const ph = 30;
		const bars = 7;
		const bw = pw / bars;
		for (let b = 0; b < bars; b++) {
			const t = (b + 0.5) / bars;
			const hgt = ph * (Math.exp(-Math.pow((t - 0.5) * 3, 2)) * (0.7 + rng() * 0.5));
			out += `<rect x="${r1(px + b * bw)}" y="${r1(py + ph - hgt)}" width="${r1(bw - 1)}" height="${r1(Math.max(1, hgt))}" fill="currentColor" opacity="0.6"/>`;
		}
		out += `<line x1="${px}" y1="${r1(py + ph)}" x2="${r1(px + pw)}" y2="${r1(py + ph)}" stroke="currentColor" stroke-width="0.8" opacity="0.4"/>`;
	}
	return svg(out);
}
function baseline() {
	return `<line x1="8" y1="${H - 10}" x2="${W - 8}" y2="${H - 10}" stroke="currentColor" stroke-width="0.8" opacity="0.35"/>`;
}
function sparkline(values) {
	const pad = 8;
	const nums = (values ?? []).map(Number).filter(Number.isFinite);
	if (nums.length < 2) return svg(baseline());
	const step = Math.max(1, Math.floor(nums.length / 60));
	const pts = nums.filter((_, i) => i % step === 0).slice(0, 60);
	const min2 = Math.min(...pts);
	const max = Math.max(...pts);
	const span = max - min2 || 1;
	let d = '';
	pts.forEach((v, i) => {
		const x = pad + ((W - pad * 2) * i) / Math.max(1, pts.length - 1);
		const y = H - pad - ((H - pad * 2) * (v - min2)) / span;
		d += `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`;
	});
	return svg(`<path d="${d}" stroke="currentColor" stroke-width="1.4" opacity="0.85"/>`);
}
const WORKFLOW_SHAPE = {
	'workflow-rest-activity': ['actogram', 'fragmented'],
	'workflow-free-running': ['actogram', 'freerun'],
	'workflow-phase-groups': ['actogram', 'phaseshift'],
	'workflow-stats-eda': ['histograms'],
	'workflow-stats-two-group': ['boxplots', 2],
	'workflow-stats-anova': ['boxplots', 4],
	'workflow-stats-correlation': ['heatmap'],
	'workflow-stats-regression': ['scatterfit'],
	'workflow-stats-logistic': ['logistic'],
	'workflow-stats-chi-square': ['contingency'],
	// Tier A rhythm examples. Each gets a variant depicting its own phenomenon, so no two cards
	// in the gallery show the same picture.
	'workflow-non24-blind': ['actogram', 'freerun-slow'],
	'workflow-arrhythmic': ['actogram', 'fragmented'],
	'workflow-circatidal': ['actogram', 'tidal'],
	'workflow-reentrainment': ['actogram', 'transients'],
	'workflow-split-rhythm': ['actogram', 'split'],
	'workflow-noise-peak': ['histograms'],
	'workflow-aliasing': ['sparkline'],
	'workflow-crepuscular': ['circular'],
	'workflow-masking': ['actogram', 'masking']
};
export function thumbnailForWorkflow(id) {
	const rng = mulberry32(hashSeed(id ?? 'unknown'));
	const [shape, arg] = WORKFLOW_SHAPE[id] ?? [];
	switch (shape) {
		case 'actogram':
			return actogram(rng, arg);
		case 'boxplots':
			return boxplots(rng, arg);
		case 'scatterfit':
			return scatterFit(rng);
		case 'logistic':
			return logisticCurve(rng);
		case 'heatmap':
			return heatmap(rng);
		case 'contingency':
			return contingency(rng);
		case 'histograms':
			return miniHistograms(rng);
		case 'circular':
			return circular(rng);
		case 'sparkline':
			return sparkline(Array.from({ length: 40 }, (_, i) => Math.sin(i / 3) + rng() * 0.4));
		default:
			return sparkline(Array.from({ length: 40 }, (_, i) => Math.sin(i / 4) + rng() * 0.6));
	}
}
const recents = { items: [] };
const hasWindow = () => typeof window !== 'undefined';

/**
 * Thumbnail derived from REAL data (used when saving a recent), rather than from a workflow id.
 * A multi-day record reads best as a double-plotted actogram; anything shorter has no daily
 * structure to show, so it falls back to a sparkline. Unusable input falls back to the procedural
 * shape so a row always has a picture.
 */
export function thumbnailFromSeries(values, opts = {}) {
	const perDay = opts.samplesPerDay ?? 24;
	const clean = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
	if (clean.length === 0) {
		const rng = mulberry32(hashSeed(opts.seed ?? 'series'));
		return sparkline(Array.from({ length: 40 }, (_, i) => Math.sin(i / 4) + rng() * 0.6));
	}
	// Two full days is the minimum that makes a double plot meaningful.
	if (clean.length >= perDay * 2) return actogramFromSeries(clean, perDay);
	return sparkline(clean);
}
