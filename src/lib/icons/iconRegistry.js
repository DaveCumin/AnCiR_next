// iconRegistry.js — single source of truth for the inline SVG icon set.
//
// Every icon ships as a raw SVG under this folder and is inlined at build time
// via import.meta.glob (eager). Icon.svelte renders these as a component; other
// contexts that can't mount a component — notably tour bodies, which render via
// {@html} — get the markup as a string through `iconHtml()`. Keeping the glob
// here (and importing it from Icon.svelte) means ONE copy of the icons in the
// bundle and ONE place that knows how they're normalised.
const RAW_ICONS = import.meta.glob('./*.svg', {
	query: '?raw',
	import: 'default',
	eager: true
});

const iconCache = new Map();
for (const path in RAW_ICONS) {
	const key = path.split('/').pop().replace(/\.svg$/, '');
	const raw = RAW_ICONS[path] ?? '';
	// Recolour fills to currentColor (but keep fill="none" outlines) so an icon
	// inherits its surrounding text colour wherever it's used.
	const normalized = raw.replace(/fill="[^"]*"/g, (match) =>
		match.includes('none') ? match : 'fill="currentColor"'
	);
	iconCache.set(key, normalized);
}

/** Raw (currentColor-normalised) SVG markup for an icon, or '' if unknown. */
export function getIconRaw(name) {
	return iconCache.get(name) ?? '';
}

/** Whether an icon by this name exists. */
export function hasIcon(name) {
	return iconCache.has(name);
}

/**
 * Inline icon markup for {@html} contexts (e.g. tour bodies). Sizes the icon to
 * sit on the text baseline and inherit text colour (currentColor); returns '' for
 * unknown names so callers can interpolate it safely. The sizing/style is injected
 * onto the <svg> itself because scoped CSS doesn't reach {@html} content.
 */
export function iconHtml(name, { size = '1em', valign = '-0.15em' } = {}) {
	const raw = getIconRaw(name);
	if (!raw) return '';
	return raw.replace(
		/<svg\b/,
		`<svg aria-hidden="true" style="width:${size};height:${size};vertical-align:${valign};display:inline-block"`
	);
}
