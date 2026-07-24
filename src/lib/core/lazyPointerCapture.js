/**
 * Lazy pointer capture for canvas roots.
 *
 * A canvas that pans needs `setPointerCapture` so a drag keeps tracking when the pointer leaves the
 * element (the classic "lost drag"). But capturing at `pointerdown` retargets the subsequent
 * `pointerup` to the capturing element, so a button *inside* the canvas never receives its own
 * pointerup and the browser never synthesises a `click` on it. That silently broke every in-canvas
 * button (the "+" node palette, zoom controls, tidy layout).
 *
 * The fix: arm on pointerdown, but only actually capture once the pointer has moved past a few
 * pixels, i.e. once the gesture is genuinely a drag. A tap therefore never captures and click
 * semantics are untouched; a drag captures as soon as it starts moving.
 */

export const DEFAULT_CAPTURE_SLOP = 3;

/**
 * @param {() => (Element|null|undefined)} getElement resolves the element that should hold capture
 * @param {number} [slop] movement in CSS px before capture is taken
 */
export function createLazyPointerCapture(getElement, slop = DEFAULT_CAPTURE_SLOP) {
	/** @type {{ id: number, x: number, y: number } | null} */
	let pending = null;
	/** @type {number | null} */
	let held = null;

	return {
		/** Arm capture for this pointer without taking it yet. */
		arm(e) {
			pending = { id: e.pointerId, x: e.clientX, y: e.clientY };
		},
		/**
		 * Take capture if this pointer is the armed one and has moved past the slop.
		 * @returns {boolean} true when capture was taken by this call
		 */
		maybeTake(e) {
			if (!pending || e.pointerId !== pending.id) return false;
			if (Math.abs(e.clientX - pending.x) < slop && Math.abs(e.clientY - pending.y) < slop) {
				return false;
			}
			const id = pending.id;
			pending = null;
			try {
				getElement()?.setPointerCapture?.(id);
			} catch {
				// Pointer already gone, or capture unsupported — degrade to uncaptured tracking.
				return false;
			}
			held = id;
			return true;
		},
		/** Release any held capture and disarm. */
		release() {
			if (held != null) {
				try {
					getElement()?.releasePointerCapture?.(held);
				} catch {
					// Already released.
				}
			}
			held = null;
			pending = null;
		},
		/** @returns {boolean} whether capture is currently held (test/introspection aid). */
		get isHolding() {
			return held != null;
		},
		/** @returns {number | null} the armed-but-not-yet-captured pointer id. */
		get pendingId() {
			return pending?.id ?? null;
		}
	};
}
