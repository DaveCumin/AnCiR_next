// The name an analysis INPUT port shows on the canvas (its node card label, its tooltip's first
// words, its accessible name and the keyboard-wiring announcements), apart from its internal
// name. DISPLAY ONLY: the internal name (xIN, yIN, ...) stays the session JSON key, the port id
// the wiring routes by, the MCP param name and the Python/R name.
//
// Convention (decided 2026-11-21): the side panel labels an input "<what it holds> (<port
// letter>)" ("Time (x)", "Values (y)", "Time (x, optional)"); the canvas shows just the letter,
// as a plot's x/y ports already do. A card's input labels share one column with its output
// rows, so a short label leaves the outputs their room. A port the panel names without a letter
// ("Predictors", "Columns to describe") shows a short lowercase noun for what it holds,
// declared as `display` on the node's nodeSpec input (Join Data's "time A" works the same way).
//
// Pure, no imports: ProcessNode, the node manifest builder and tests share it.

/** Canvas names of the shared x / y analysis inputs. */
export const DEFAULT_INPUT_DISPLAY = Object.freeze({ xIN: 'x', yIN: 'y' });

/**
 * The canvas name of a nodeSpec input: its declared `display`, else the default for its
 * internal name, else that name.
 * @param {{ name: string, display?: string } | null | undefined} spec
 * @returns {string}
 */
export function inputPortDisplay(spec) {
	if (!spec) return '';
	if (typeof spec.display === 'string' && spec.display) return spec.display;
	return DEFAULT_INPUT_DISPLAY[spec.name] ?? spec.name;
}
