// @ts-nocheck
// Scroll-edge fade attachment. Use as `{@attach scrollFade()}` on a scroll box.
//
// A capped scroll box cuts whatever sits on its edge in half, and with overlay
// scrollbars (macOS, most touch devices) nothing else says there is more to
// see. This sets `data-more-above` / `-below` / `-left` / `-right` on the box
// while content is hidden past that edge, so CSS can fade the edge out (see
// .process-editor-panel in WorkflowEditor, and .scroll-fade-x in app.css for
// wide result tables). The cut then reads as "more this way" rather than as
// clipped text.
//
// Re-evaluates on scroll, when the box resizes, and when its content changes
// size (a section expanding, a select switching to options with more fields).

/** Which edges of `el` have content hidden past them. */
export function scrollEdges(el) {
	const maxY = el.scrollHeight - el.clientHeight;
	const maxX = el.scrollWidth - el.clientWidth;
	// 1px slack: fractional layouts leave the scroll offset a hair short of max.
	return {
		above: el.scrollTop > 1,
		below: maxY - el.scrollTop > 1,
		left: el.scrollLeft > 1,
		right: maxX - el.scrollLeft > 1
	};
}

const FLAGS = {
	above: 'data-more-above',
	below: 'data-more-below',
	left: 'data-more-left',
	right: 'data-more-right'
};

function setFlag(el, name, on) {
	if (on) el.setAttribute(name, '');
	else el.removeAttribute(name);
}

export function scrollFade() {
	return (el) => {
		const update = () => {
			const edges = scrollEdges(el);
			for (const edge in FLAGS) setFlag(el, FLAGS[edge], edges[edge]);
		};
		update();
		el.addEventListener('scroll', update, { passive: true });

		let ro = null;
		if (typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(update);
			ro.observe(el);
			for (const child of el.children) ro.observe(child);
		}
		// Children come and go (e.g. {#if} blocks inside the editor), so keep the
		// observed set current.
		let mo = null;
		if (typeof MutationObserver !== 'undefined') {
			mo = new MutationObserver(() => {
				if (ro) for (const child of el.children) ro.observe(child);
				update();
			});
			mo.observe(el, { childList: true, subtree: true });
		}

		return () => {
			el.removeEventListener('scroll', update);
			ro?.disconnect();
			mo?.disconnect();
		};
	};
}
