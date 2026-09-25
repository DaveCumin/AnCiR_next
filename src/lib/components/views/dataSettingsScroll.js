/**
 * Scroll the control-display panel (the right-hand "data settings" column).
 *
 * This lives in a plain .js module rather than in ControlDisplay.svelte because ten plot
 * components import it. Importing it from the component dragged the whole control-panel
 * subtree (SavePlot, FigureStyleControls, CanvasNodeControls, CategoryColourControls and
 * their inputs) into every plot's module graph, which every test file that calls
 * `loadPlots()` then had to compile and evaluate. The helper touches nothing but the DOM,
 * so it has no business living in a component.
 *
 * @param {'top' | 'bottom' | number} position - where to scroll to; a number is a pixel offset.
 */
export function dataSettingsScrollTo(position = 'bottom') {
	const dataSettings = document.getElementsByClassName('control-display')[0]?.parentElement;
	if (!dataSettings) {
		console.error("Element with ID 'dataSettings' not found");
		return;
	}
	const topPos =
		position == 'bottom' ? dataSettings.scrollHeight : position == 'top' ? 0 : position;
	dataSettings.scrollTo({ top: topPos, left: 0, behavior: 'smooth' });
}
