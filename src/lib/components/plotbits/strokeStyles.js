/**
 * The dash vocabulary, and the only one. `stroke` is written straight into
 * `stroke-dasharray`, so these are real dasharray values ('solid' is not one, which is
 * why the browser renders it as an unbroken line).
 *
 * A plain module (no component) so BOTH its readers can import it without a cycle:
 * Line.svelte (where the user picks from it; it re-exports this) and
 * plots/appearanceIdentity.js (the identity map's dash order). While it lived in
 * Line.svelte the two imported each other, which only held together while
 * appearanceIdentity happened to be evaluated first; the moment something in core's
 * import graph reached Line.svelte first (the scatterplot Overlay component), the
 * identity map saw `STROKE_STYLES` as undefined.
 *
 * The appearance system used to carry its OWN list ('', '6 3', '2 2', …) that shared not
 * one entry with this select, so turning on "vary marker shape" wrote a dash no option
 * matched and the Style dropdown went blank — a control that shows nothing and appears
 * to reject what you choose.
 */
export const STROKE_STYLES = ['solid', '5, 5', '2, 2', '5, 2'];
