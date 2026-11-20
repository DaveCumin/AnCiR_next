// A list of rich rows as ONE Tab stop (a roving tabindex), for the data panel's reorderable
// lists. The container is a treegrid (WAI-ARIA APG Treegrid pattern): its rows are
// role="row" elements marked `data-roving-row`, each holding gridcells with the row's own
// controls (a name editor, buttons, the column's settings).
//
//   Tab               into the list lands on the last row used (the first, at the start).
//   Up / Down         the previous / next visible row.
//   Home / End        the first / last visible row.
//   Right             on a closed parent row (aria-expanded="false") opens it; on an open one
//                     goes to its first child row.
//   Left              on an open parent row closes it; on a child row goes to its parent.
//   Tab from a row    the controls in THAT row, then out of the list (the APG treegrid
//                     example's model). The other rows' controls are taken out of the Tab
//                     order, which is what makes the list one stop rather than one per button.
//
// Alt+Arrow (move the row) and Enter / Space (activate it) stay with each row's own handler,
// which runs first (the row is the event target) and stops the event when it acts.
//
// Rows are found by DOM, not by props, because the list is re-rendered freely (a reorder
// re-inserts rows, a search filters them, a group opens): the active row is remembered by its
// `data-reorder-key` and every change re-applies the tabindex values (a MutationObserver).

const FOCUSABLE =
	'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';
// The tabindex an inner control had before it was taken out of the Tab order ('' = none).
const SAVED = 'data-roving-tabindex';

/**
 * @param {{ rowSelector?: string, onExpand?: (row: HTMLElement, open: boolean) => void }} [opts]
 *   onExpand opens (`open` true) or closes a parent row; it is the list's own state to change.
 * @returns {(container: HTMLElement) => () => void} a Svelte attachment
 */
export function rovingRows({ rowSelector = '[data-roving-row]', onExpand = null } = {}) {
	return (container) => {
		let activeKey = null;
		let lastIndex = 0;

		const allRows = () =>
			/** @type {HTMLElement[]} */ ([...container.querySelectorAll(rowSelector)]);
		// A row inside a closed group (or a filtered-away section) is not a stop.
		const visible = (row) => !row.closest('[hidden]');
		const rows = () => allRows().filter(visible);
		const keyOf = (row) => row.dataset.reorderKey ?? null;

		function activeRow(list = rows()) {
			if (!list.length) return null;
			const byKey = activeKey != null ? list.find((r) => keyOf(r) === activeKey) : null;
			if (byKey) return byKey;
			// The active row went away (moved into a closed group, filtered, deleted): the
			// row now nearest to where it was.
			return list[Math.min(lastIndex, list.length - 1)];
		}

		function setControlsTabbable(row, tabbable) {
			for (const el of row.querySelectorAll(FOCUSABLE)) {
				if (el.matches(rowSelector)) continue;
				if (tabbable) {
					if (el.hasAttribute(SAVED)) {
						const was = el.getAttribute(SAVED);
						el.removeAttribute(SAVED);
						if (was === '') el.removeAttribute('tabindex');
						else el.setAttribute('tabindex', was);
					}
				} else if (el.getAttribute('tabindex') !== '-1') {
					el.setAttribute(SAVED, el.getAttribute('tabindex') ?? '');
					el.setAttribute('tabindex', '-1');
				}
			}
		}

		function sync() {
			const list = rows();
			const active = activeRow(list);
			if (active) lastIndex = list.indexOf(active);
			for (const row of allRows()) {
				const on = row === active;
				const want = on ? '0' : '-1';
				if (row.getAttribute('tabindex') !== want) row.setAttribute('tabindex', want);
				setControlsTabbable(row, on);
			}
		}

		function focusRow(row) {
			if (!row) return;
			activeKey = keyOf(row);
			sync();
			row.focus();
			row.scrollIntoView?.({ block: 'nearest' });
		}

		function onFocusIn(e) {
			const row = /** @type {HTMLElement} */ (e.target).closest?.(rowSelector);
			if (!row || !container.contains(row)) return;
			if (keyOf(row) === activeKey) return;
			activeKey = keyOf(row);
			sync();
		}

		function onKeydown(e) {
			const row = /** @type {HTMLElement} */ (e.target);
			// Only on a row itself: keys in its name editor or on its buttons are theirs.
			if (!row.matches?.(rowSelector) || !container.contains(row)) return;
			if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
			const list = rows();
			const i = list.indexOf(row);
			if (i < 0) return;
			const level = Number(row.getAttribute('aria-level') ?? 1);
			const expanded = row.getAttribute('aria-expanded');
			let target = null;
			switch (e.key) {
				case 'ArrowDown':
					target = list[i + 1] ?? null;
					break;
				case 'ArrowUp':
					target = list[i - 1] ?? null;
					break;
				case 'Home':
					target = list[0];
					break;
				case 'End':
					target = list[list.length - 1];
					break;
				case 'ArrowRight':
					if (expanded === 'false' && onExpand) {
						e.preventDefault();
						onExpand(row, true);
						return;
					}
					if (expanded === 'true') {
						const next = list[i + 1];
						if (next && Number(next.getAttribute('aria-level') ?? 1) > level) target = next;
					}
					break;
				case 'ArrowLeft':
					if (expanded === 'true' && onExpand) {
						e.preventDefault();
						onExpand(row, false);
						return;
					}
					if (level > 1) {
						for (let j = i - 1; j >= 0; j--) {
							if (Number(list[j].getAttribute('aria-level') ?? 1) < level) {
								target = list[j];
								break;
							}
						}
					}
					break;
				default:
					return;
			}
			// An arrow at the end of the list still belongs to the list (no page scroll).
			e.preventDefault();
			if (target && target !== row) focusRow(target);
		}

		// Re-apply after any re-render; coalesced to one pass per task.
		let queued = false;
		const observer = new MutationObserver(() => {
			if (queued) return;
			queued = true;
			queueMicrotask(() => {
				queued = false;
				sync();
			});
		});
		observer.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['hidden', 'tabindex']
		});
		container.addEventListener('focusin', onFocusIn);
		container.addEventListener('keydown', onKeydown);
		sync();

		return () => {
			observer.disconnect();
			container.removeEventListener('focusin', onFocusIn);
			container.removeEventListener('keydown', onKeydown);
		};
	};
}
