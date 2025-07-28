<script>
	//TODO: add a way to display a tooltip on hover
	import { quadtree } from 'd3-quadtree';

	let { x, y, xscale, yscale, radius, fillCol, yoffset, xoffset, tooltip = false } = $props();

	let beforeIdx = $derived.by(() => {
		//find the x point before the limit
		let xlims = xscale.domain();
		for (let i = 1; i < x.length; i++) {
			if (x[i] >= Math.min(xlims[0], xlims[1])) {
				return i - 1;
			}
		}
		return 0;
	});

	let afterIdx = $derived.by(() => {
		//find the x point after the limit
		let xlims = xscale.domain();
		for (let i = x.length - 2; i >= 0; i--) {
			if (x[i] <= Math.max(xlims[0], xlims[1])) {
				return i + 1;
			}
		}
		return x.length - 1;
	});

	//MAKE THE POINTS PATH
	let points = $derived.by(() => {
		let out = '';
		for (let p = beforeIdx; p <= afterIdx; p++) {
			//only include the point if it's within the y limits
			if (y[p] >= yscale.domain()[0] && y[p] <= yscale.domain()[1]) {
				out += `M${xscale(x[p])} ${yscale(y[p])} m-${radius} 0 a${radius} ${radius} 0 1 0 ${2 * radius} 0 a${radius} ${radius} 0 1 0 -${2 * radius} 0 `;
			}
		}

		return out;
	});

	let qt = $derived.by(() => {
		if (!tooltip) return null;
		const tree = quadtree()
			.x((d) => xscale(d.x) + xoffset)
			.y((d) => yscale(d.y) + yoffset)
			.addAll(
				x
					.map((xVal, i) => ({
						x: xVal,
						y: y[i],
						index: i
					}))
					.filter(
						(d) =>
							d.index >= beforeIdx &&
							d.index <= afterIdx &&
							d.y >= yscale.domain()[0] &&
							d.y <= yscale.domain()[1]
					)
			);
		return tree;
	});
	function handleHover(e) {
		if (!tooltip) return;
		const mouseX = e.offsetX;
		const mouseY = e.offsetY;
		const closest = qt.find(mouseX, mouseY, radius * 2);
		if (closest && closest.index >= 0) {
			const event = new CustomEvent('tooltip', {
				detail: {
					visible: true,
					x: mouseX + 10, // Offset to avoid cursor overlap
					y: mouseY + 10,
					content: `(${x[closest.index].toFixed(2)}, ${y[closest.index].toFixed(2)})`
				},
				bubbles: true
			});
			e.target.dispatchEvent(event);
		} else {
			e.target.dispatchEvent(
				new CustomEvent('tooltip', {
					detail: { visible: false },
					bubbles: true
				})
			);
		}
	}

	function handleMouseLeave(e) {
		if (!tooltip) return;
		e.target.dispatchEvent(
			new CustomEvent('tooltip', {
				detail: { visible: false },
				bubbles: true
			})
		);
	}
</script>

<path
	d={points}
	fill={fillCol}
	stroke="none"
	style={`transform: translate( ${xoffset}px, ${yoffset}px );`}
	onmousemove={(e) => {
		handleHover(e);
	}}
	onmouseleave={handleMouseLeave}
/>
