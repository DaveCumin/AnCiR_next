// @ts-nocheck
// The plot control panel's undo recorder: every gesture in the panel is ONE undo step.
//
// The panel's controls (each plot type's own, and the shared plotbits they render) mostly
// write straight onto the plot (`bind:value`, `onInput={(v) => (theData.x = v)}`). This
// attachment, on the element that holds them, turns each finished gesture into one recorded
// operation through plots/plotEdits.js, so no control has to know about the history:
//
//   start   pointerdown, keydown, beforeinput or focusin inside the panel: the plot's editable
//           state is serialised (the baseline). Not re-taken while a typed edit is still
//           pending, so text typed and then committed by a click elsewhere is still one step.
//   finish  `change` (a text or number box on Enter or blur, a checkbox, a select, a spinner
//           click, a slider release) or the end of a click or drag (a button, the colour
//           picker's drag): whatever changed since the baseline is recorded.
//   cancel  Escape in a text or number box puts the plot back to the baseline; nothing is
//           recorded.
//
// What is typed previews on the plot as it is typed (the controls' own writes) and records
// nothing until it is committed. Spinner clicks on one box within half a second are one step
// (the coalesceKey), like the axis tick-count spinner.
//
// A control that records its own operation (the axis controls, a series delete, the FFT's
// period switch) is left alone: any operation applied during the gesture drops the baseline,
// so the change is not recorded twice.
//
// Floating parts of a control (the colour picker's window and a column menu are moved to
// <body>) are part of the panel when their anchor is: see components/reusables/editScopePopup.js.
import { addStateChangeHook } from '$lib/core/operations.js';
import { history } from '$lib/core/opHistory.svelte.js';
import { plotEditState, recordPlotGesture, opsSince, isSessionPlot } from './plotEdits.js';
import { popupAnchor } from '$lib/components/reusables/editScopePopup.js';

const TYPED = new Set(['text', 'number', 'search', 'url', 'email', 'tel', 'password', '']);
const isTyped = (el) =>
	el?.isContentEditable ||
	el?.tagName === 'TEXTAREA' ||
	(el?.tagName === 'INPUT' && TYPED.has((el.getAttribute('type') ?? '').toLowerCase()));

/**
 * Attachment for the element holding a plot's controls ({@attach plotEditScope(() => plot)}).
 * `getPlot` returns the Plot wrapper the controls edit (read at event time).
 *
 * @param {() => any} getPlot
 */
export function plotEditScope(getPlot) {
	return (node) => {
		const doc = node.ownerDocument ?? document;
		let baseline = null; // plotEditState before the open gesture
		let baselinePlot = null;
		let armed = false; // a gesture started in the panel and has not finished
		let pointerActive = false; // that gesture's pointer is still down
		let typedPending = false; // a typed edit not yet committed
		let recording = false; // our own operation is being applied
		let timer = null;

		const inScope = (target) => {
			if (!(target instanceof Node)) return false;
			if (node.contains(target)) return true;
			const anchor = popupAnchor(target);
			return !!anchor && node.contains(anchor);
		};

		function start(e) {
			if (!inScope(e.target)) return;
			const plot = getPlot();
			if (!isSessionPlot(plot)) return;
			if (e.type === 'pointerdown') pointerActive = true;
			armed = true;
			if (baseline && baselinePlot === plot && typedPending) return;
			baseline = plotEditState(plot);
			baselinePlot = plot;
		}

		function finish(coalesceKey) {
			clearTimeout(timer);
			timer = null;
			const plot = getPlot();
			if (!armed || !baseline || baselinePlot !== plot) return;
			if (history.isRestoring || history.isLoading) return;
			recording = true;
			try {
				recordPlotGesture(plot, baseline, { coalesceKey });
			} finally {
				recording = false;
			}
			typedPending = false;
			if (pointerActive || isTyped(doc.activeElement)) {
				// Still in a gesture: a typed value committed by the blur of a press that is still
				// going on (a click on a button after typing), whose own edit is the next step; or
				// the focus is in a box, where typing may follow. Either starts from here.
				baseline = plotEditState(plot);
			} else {
				baseline = null;
				armed = false;
			}
		}

		function onInput(e) {
			if (inScope(e.target) && isTyped(e.target)) typedPending = true;
		}

		function onChange(e) {
			if (!inScope(e.target)) return;
			const t = e.target;
			// A number box's spinner sends one change per click: a quick run is one step.
			const key =
				t?.tagName === 'INPUT' && ['number', 'range'].includes(t.type)
					? `panel:${getPlot()?.id}:${controlKey(t)}`
					: undefined;
			queueMicrotask(() => finish(key));
		}

		// The end of a click or a drag: after the click's own handlers (and a checkbox's
		// change) have run.
		// Only the end of a press that STARTED in the panel (a drag may end anywhere), or a click
		// on the panel itself (a button pressed with the keyboard): never a click elsewhere.
		function onRelease(e) {
			if (e.type === 'pointerup') {
				if (!pointerActive) return;
				pointerActive = false;
			} else if (!inScope(e.target)) return;
			if (!armed) return;
			clearTimeout(timer);
			timer = setTimeout(() => finish(), 0);
		}

		function onKeydown(e) {
			if (e.key === 'Escape' && inScope(e.target) && isTyped(e.target) && baseline) {
				const plot = getPlot();
				if (plot === baselinePlot) opsSince(plot, baseline); // back to the baseline
				typedPending = false;
				baseline = null;
				armed = false;
				return;
			}
			start(e);
		}

		// Any operation applied meanwhile (a control that records its own, an undo) means the
		// baseline no longer describes "before this gesture".
		const unhook = addStateChangeHook(() => {
			if (recording) return;
			baseline = null;
			armed = false;
			typedPending = false;
		});

		const opts = { capture: true };
		doc.addEventListener('pointerdown', start, opts);
		doc.addEventListener('focusin', start, opts);
		// Before a box's value changes by any means (typing, paste, drop, an IME): the preview
		// write that follows must be measured from before it.
		doc.addEventListener('beforeinput', start, opts);
		// Bubbling, so an editor that handles Escape itself (and stops it) is left alone.
		doc.addEventListener('keydown', onKeydown);
		doc.addEventListener('input', onInput);
		doc.addEventListener('change', onChange);
		doc.addEventListener('pointerup', onRelease);
		doc.addEventListener('click', onRelease);
		return () => {
			clearTimeout(timer);
			unhook();
			doc.removeEventListener('pointerdown', start, opts);
			doc.removeEventListener('focusin', start, opts);
			doc.removeEventListener('beforeinput', start, opts);
			doc.removeEventListener('keydown', onKeydown);
			doc.removeEventListener('input', onInput);
			doc.removeEventListener('change', onChange);
			doc.removeEventListener('pointerup', onRelease);
			doc.removeEventListener('click', onRelease);
		};
	};
}

/** A stable name for a control, for merging its spinner clicks. */
function controlKey(el) {
	const parent = el.parentNode;
	const index = parent ? [...parent.children].indexOf(el) : 0;
	return (
		el.getAttribute('aria-label') ??
		el.closest('label')?.textContent?.trim() ??
		`${el.tagName}:${index}`
	);
}
