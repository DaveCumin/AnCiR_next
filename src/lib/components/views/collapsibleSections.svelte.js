// @ts-nocheck
// Collapsible control-panel sections, without touching a hundred markup sites.
//
// Every section in the panel is already the same shape — `.control-component` wrapping a
// `.control-component-title` and then its contents — and those classes are styled globally in
// routes/+page.svelte. So the collapse is applied by DELEGATION from the panel container rather
// than by converting ~100 sections across 19 files into a wrapper component. One listener, one
// observer, and a section added tomorrow is collapsible for free.
//
// WHY NOT A COMPONENT
//
// A `<CollapsibleSection>` would be the textbook answer and is a better shape in the abstract.
// It is also a 19-file sweep through markup that varies (some titles carry icon buttons, colour
// swatches, per-section actions), and two scripted sweeps in this area have already introduced
// bugs. This gets the same behaviour everywhere at a fraction of the risk. If the panel is ever
// rebuilt, prefer the component.
//
// STATE LIVES HERE, NOT IN THE DOM
//
// The panel re-renders whenever the selection or the tab changes, so a `data-` attribute alone
// would forget itself. Collapsed sections are keyed by their TITLE TEXT, which survives a
// re-render and means the same section stays shut as you move between plots of the same type.
import { SvelteSet } from 'svelte/reactivity';

/** Sections that start shut. The figure style is long, and rarely what you came to change. */
const DEFAULT_COLLAPSED = ['Figure'];

/** Titles of the sections currently collapsed. */
export const collapsedSections = new SvelteSet(DEFAULT_COLLAPSED);

/**
 * Clicks inside a title that are NOT a request to collapse it.
 *
 * Titles carry real controls: auto-scale buttons, colour swatches, delete. Toggling the section
 * because someone pressed one of those would be maddening, and it is the same defence
 * GroupNode uses for its own draggable header.
 */
const INTERACTIVE = 'button, input, select, textarea, label, a, [role="button"]';

/**
 * A stable key for a section: the text of its title.
 *
 * The title's own `<p>` when it has one, NOT the whole title's textContent — titles carry
 * buttons, and their labels would end up in the key ("Padding" vs "Paddingx"), which changes
 * the moment a section gains an action.
 */
function keyFor(titleEl) {
	if (!titleEl) return '';
	const label = titleEl.querySelector('p');
	return (label?.textContent ?? titleEl.textContent ?? '').trim();
}

export function isCollapsed(title) {
	return collapsedSections.has(title);
}

export function toggleSection(title) {
	if (!title) return;
	if (collapsedSections.has(title)) collapsedSections.delete(title);
	else collapsedSections.add(title);
}

/**
 * Apply the current collapsed set to every section under `root`.
 *
 * Writes a `data-collapsed` attribute; the CSS in +page.svelte does the hiding. Idempotent, so
 * it can be called from both the observer and the state effect without thrashing.
 */
export function syncCollapsedState(root) {
	if (!root) return;
	for (const section of root.querySelectorAll('.control-component')) {
		// The section's OWN title, by walking its children. `:scope >` would say this more
		// briefly but is not reliable everywhere the panel renders, and a nested section's
		// title must not be mistaken for its parent's.
		const title = [...section.children].find((el) =>
			el.classList?.contains('control-component-title')
		);
		if (!title) continue;
		const collapsed = collapsedSections.has(keyFor(title));
		const want = collapsed ? 'true' : 'false';
		// Written on every section, including expanded ones, so the DOM always states the
		// section's state rather than leaving it implied by an absent attribute. Skipped when
		// it already matches: a no-op write still invalidates style and, under the
		// MutationObserver below, would re-trigger this function forever.
		if (section.getAttribute('data-collapsed') !== want) {
			section.setAttribute('data-collapsed', want);
		}
		if (title.getAttribute('role') !== 'button') {
			title.setAttribute('role', 'button');
			title.setAttribute('tabindex', '0');
		}
		const label = collapsed ? 'false' : 'true';
		if (title.getAttribute('aria-expanded') !== label) title.setAttribute('aria-expanded', label);
	}
}

/**
 * Svelte action for the control-panel container.
 *
 * Attaches ONE click and ONE keydown listener, plus a MutationObserver so sections that appear
 * later (a tab switch, a different plot) come back in the state the user left them. All three
 * are torn down on destroy — this codebase has already paid for listeners that outlive their
 * component.
 */
export function collapsibleSections(node) {
	function activate(target) {
		const title = target.closest?.('.control-component-title');
		if (!title || !node.contains(title)) return false;
		// A control INSIDE the title is not a request to collapse. Deliberately excludes the
		// title itself: `syncCollapsedState` marks it `role="button"` for screen readers, which
		// made it match INTERACTIVE and swallowed every click — the feature was entirely dead
		// until a test caught it.
		const control = target.closest?.(INTERACTIVE);
		if (control && control !== title && title.contains(control)) return false;
		toggleSection(keyFor(title));
		syncCollapsedState(node);
		return true;
	}

	function onClick(e) {
		activate(e.target);
	}

	function onKeydown(e) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		// Only swallow the key when it actually hit a section title, so typing a space into a
		// control inside the panel still works.
		if (activate(e.target)) e.preventDefault();
	}

	node.addEventListener('click', onClick);
	node.addEventListener('keydown', onKeydown);

	// The panel rebuilds its contents on selection and tab changes, which drops the attributes.
	const observer = new MutationObserver(() => syncCollapsedState(node));
	observer.observe(node, { childList: true, subtree: true });
	syncCollapsedState(node);

	return {
		destroy() {
			node.removeEventListener('click', onClick);
			node.removeEventListener('keydown', onKeydown);
			observer.disconnect();
		}
	};
}
