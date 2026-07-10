// Radial placement of individual phase observations for the Circular phase
// plot. Returns [{ value, r01 }] pairs the plot projects through polar.js.
//   'rim'   — pin every value to the circumference (density reads by overlap)
//   'stack' — dodge coincident values outward at their exact angle (dot plot)
//   'bin'   — snap to user-set bins and pile radially (circular dot-histogram)

/**
 * @param {number[]} values
 * @param {{placement:'stack'|'bin'|'rim', period:number, binWidth?:number,
 *          dotRadius?:number, plotRadius:number, baseRim?:number, quant?:number}} opts
 * @returns {Array<{value:number, r01:number}>}
 */
export function placeCircularPoints(values, opts) {
	const {
		placement = 'stack',
		period,
		binWidth = 1,
		dotRadius = 3.4,
		plotRadius,
		baseRim = 0.9,
		quant = 0.5
	} = opts;
	const vals = (values ?? []).filter((v) => Number.isFinite(v));

	if (placement === 'rim') {
		return vals.map((v) => ({ value: v, r01: 1 }));
	}

	const step = (dotRadius * 2 + 1.4) / plotRadius;

	if (placement === 'bin') {
		const nb = Math.max(1, Math.round(period / binWidth));
		const bw = period / nb;
		const bins = new Map();
		for (const v of vals) {
			const m = ((v % period) + period) % period;
			const bi = Math.floor(m / bw) % nb;
			if (!bins.has(bi)) bins.set(bi, []);
			bins.get(bi).push(v);
		}
		const out = [];
		for (const [bi, arr] of bins) {
			const center = (bi + 0.5) * bw;
			arr.forEach((_, k) => out.push({ value: center, r01: baseRim + k * step }));
		}
		return out;
	}

	// 'stack': quantise to group coincident values, dodge each group outward.
	const bins = new Map();
	for (const v of vals) {
		const k = Math.round(v / quant);
		if (!bins.has(k)) bins.set(k, []);
		bins.get(k).push(v);
	}
	const out = [];
	for (const arr of bins.values()) {
		arr.forEach((v, k) => out.push({ value: v, r01: baseRim + k * step }));
	}
	return out;
}
