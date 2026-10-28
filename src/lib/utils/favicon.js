// The browser-tab icon follows the app palette (its gradient runs between the palette's first
// two colours). Set wherever the palette changes: Settings, and the setAppColours operation, so
// an undo or redo of a palette change takes the icon with it (it used to keep the new icon).

/** `#A6ACD5` / `#fbe67280` -> `A6ACD5`: the six hex digits of a colour. */
const hex = (c) =>
	String(c ?? '')
		.replace(/^#/, '')
		.slice(0, 6);

/** The icon as a data URI for a palette (its first two colours). */
export function faviconHref(colours) {
	return `data:image/svg+xml, %3Csvg data-v-6805eed4='' version='1.0' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='100%25' height='100%25' viewBox='0 0 70.000000 70.000000' preserveAspectRatio='xMidYMid meet' color-interpolation-filters='sRGB' style='margin: auto;'%3E%3Cg data-v-6805eed4='' fill='%23333' class='icon-text-wrapper icon-svg-group iconsvg' transform='translate(71.40499877929688,97.81155776977539)'%3E%3Cg class='iconsvg-imagesvg' transform='matrix(1,0,0,1,0,0)' opacity='1'%3E%3Cg%3E%3Crect fill='%23333' fill-opacity='0' stroke-width='2' x='0' y='0' width='60' height='54.37688619824' class='image-rect'%3E%3C/rect%3E%3Csvg x='-120' y='-95' width='160' height='54.37688619824' filtersec='colorsb2791788449' class='image-svg-svg primary' style='overflow: visible;'%3E%3Csvg xmlns='http://www.w3.org/2000/svg' xlink='http://www.w3.org/1999/xlink' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='ae8194c03-b976-4110-a715-bc6a7dcd8efe' x1='127.09' y1='100.34' x2='11.24' y2='19.22' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0' stop-color='%23${hex(colours[0])}'%3E%3C/stop%3E%3Cstop offset='1' stop-color='%23${hex(colours[1])}'%3E%3C/stop%3E%3C/linearGradient%3E%3ClinearGradient id='b74247629-084e-4695-a572-5323a7fe49da' x1='12.79' y1='-21.54' x2='83.81' y2='101.47' href='%23ae8194c03-b976-4110-a715-bc6a7dcd8efe'%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M108.13 58.27L88.82 91.72A16.56 16.56 0 0 1 74.49 100H35.86a16.54 16.54 0 0 1-8.72-2.49C86.56 97.51 82.65 50 82.65 50a8.59 8.59 0 0 0-2.52-6.09L61.26 25a8.62 8.62 0 0 0-12.18 0L30.22 43.91a8.51 8.51 0 0 0-2.41 4.69c-.06-8.11 2.5-46 55.56-46a16.43 16.43 0 0 1 5.43 5.68l19.31 33.45a16.51 16.51 0 0 1 .02 16.54z' fill='url(%23ae8194c03-b976-4110-a715-bc6a7dcd8efe)'%3E%3C/path%3E%3Cpath d='M27.81 48.6a8.61 8.61 0 0 0 2.41 7.49L49.08 75a8.62 8.62 0 0 0 12.18 0l18.87-18.91A8.59 8.59 0 0 0 82.65 50s3.91 47.51-55.51 47.51a16.48 16.48 0 0 1-5.61-5.79L2.22 58.27a16.51 16.51 0 0 1 0-16.54L21.53 8.28A16.56 16.56 0 0 1 35.86 0h38.63a16.54 16.54 0 0 1 8.9 2.6c-53.08 0-55.64 37.89-55.58 46z' fill='url(%23b74247629-084e-4695-a572-5323a7fe49da)'%3E%3C/path%3E%3C/svg%3E%3C/svg%3E%3C!----%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cdefs v-gra='od'%3E%3C/defs%3E%3C/svg%3E`;
}

// The icon the page was served with and the palette it stood for (captured on the first
// change), so going back to that palette restores the shipped icon exactly.
let shipped = null;

/**
 * Point the page's icon at the palette `colours`.
 * @param {string[]} colours the palette now in use
 * @param {string[]} [previous] the palette before this change
 * @param {Document} [doc]
 */
export function syncFavicon(colours, previous, doc = globalThis.document) {
	const link = doc?.querySelector?.('link[rel="icon"]');
	if (!link || !Array.isArray(colours) || colours.length < 2) return;
	if (!shipped && Array.isArray(previous)) {
		shipped = { key: JSON.stringify(previous), href: link.getAttribute('href') };
	}
	const next =
		shipped && JSON.stringify(colours) === shipped.key ? shipped.href : faviconHref(colours);
	if (link.getAttribute('href') !== next) link.setAttribute('href', next);
}

/** Test helper: forget the captured shipped icon. */
export function resetFaviconForTest() {
	shipped = null;
}
