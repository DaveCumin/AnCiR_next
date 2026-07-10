<script>
	import { binData } from '$lib/components/plotbits/helpers/wrangleData.js';
	let { projection: P, values, binWidth = 2, colour, opacity = 0.28 } = $props();

	let wedges = $derived.by(() => {
		const vals = (values ?? [])
			.filter((v) => Number.isFinite(v))
			.map((v) => ((v % P.period) + P.period) % P.period);
		if (vals.length === 0) return [];
		const nb = Math.max(1, Math.round(P.period / binWidth));
		const bw = P.period / nb;
		const cuts = Array.from({ length: nb + 1 }, (_, i) => i * bw);
		const b = binData(vals, vals, bw, 0, bw, 'count', cuts);
		const counts = b.y_out ?? [];
		const maxC = Math.max(1, ...counts);
		return counts
			.map((c, i) => ({ c, r01: 0.92 * (c / maxC), a0: i * bw, a1: (i + 1) * bw }))
			.filter((w) => w.c > 0);
	});
</script>

<g class="rose-wedges">
	{#each wedges as w (w.a0)}
		{@const [x0, y0] = P.toXY(w.a0, w.r01)}
		{@const [x1, y1] = P.toXY(w.a1, w.r01)}
		{@const r = w.r01 * P.radius}
		<path
			d={`M ${P.cx} ${P.cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`}
			fill={colour}
			fill-opacity={opacity}
			stroke={colour}
			stroke-width="1.2"
			stroke-opacity="0.75"
		/>
	{/each}
</g>
