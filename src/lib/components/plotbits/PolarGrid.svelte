<script>
	let {
		projection: P,
		gridColour = 'var(--color-lightness-80)',
		gridSoftColour = 'var(--color-lightness-90)',
		labelColour = 'var(--color-lightness-50)',
		showRLabels = true,
		hint = ''
	} = $props();

	const fmtNum = (x) => (Number.isInteger(x) ? String(x) : x < 10 ? x.toFixed(1) : x.toFixed(0));
	const rings = [0.25, 0.5, 0.75, 1];
	let spokes = $derived(Array.from({ length: 8 }, (_, k) => (P.period * k) / 8));
	let majors = $derived([0, 0.25, 0.5, 0.75].map((f) => ({ v: P.period * f, f })));
</script>

<g class="polar-grid">
	{#each rings as f, i (f)}
		<circle
			cx={P.cx}
			cy={P.cy}
			r={P.radius * f}
			fill="none"
			stroke={i === 3 ? gridColour : gridSoftColour}
			stroke-width={i === 3 ? 1.4 : 1}
		/>
	{/each}
	{#if showRLabels}
		{#each [0.5, 1] as f (f)}
			<text x={P.cx + 3} y={P.cy - P.radius * f + 4} font-size="9" fill={labelColour}>R={f}</text>
		{/each}
	{/if}
	{#each spokes as v (v)}
		{@const [x, y] = P.toXY(v, 1)}
		<line x1={P.cx} y1={P.cy} x2={x} y2={y} stroke={gridSoftColour} stroke-width="1" />
	{/each}
	{#each majors as m (m.v)}
		{@const [lx, ly] = P.toXY(m.v, 1 + 16 / P.radius)}
		<text
			x={lx}
			y={ly + 3.5}
			text-anchor="middle"
			font-size="11"
			font-weight="600"
			fill={labelColour}
		>
			{m.f === 0 ? `${fmtNum(P.period)} / 0` : fmtNum(m.v)}
		</text>
	{/each}
	{#if hint}
		<text
			x={P.cx}
			y={P.cy + P.radius + 34}
			text-anchor="middle"
			font-size="10.5"
			fill={labelColour}>{hint}</text
		>
	{/if}
</g>
