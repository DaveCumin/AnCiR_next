// Dev-only: the app's OWN instances of the modules the e2e specs (and a person at the browser
// console) read or drive, published as `window.__modules` by src/routes/+page.svelte under its
// `import.meta.env.DEV` guard, next to `window.__core` and friends.
//
// Why not `await import('/src/lib/core/facetPanels.svelte.js')` from the page? Once Vite has
// hot-updated a module, it serves every importer that module's URL with `?t=<timestamp>`, for
// the rest of the dev server's life and on every fresh page load. A bare `/src/...` import then
// loads a SECOND copy, with its own empty state (no panels projected, nothing selected, no
// notifications), and a spec reading it sees an app that is not the one on screen. Reading
// through this object always reaches the instance the app is running: it is imported by the
// page itself, so its URLs carry the same timestamps, and a hot update of any module below
// bubbles to +page.svelte, which re-runs and re-publishes it.
//
// Production: +page.svelte only references this object inside the DEV branch, which Vite
// replaces with `false`, so the assignment is dropped and nothing here is reachable from the
// shipped page. tests/e2e/dev-hooks.spec.js checks that against a built copy.
import * as core from '$lib/core/core.svelte.js';
import * as Column from '$lib/core/Column.svelte';
import * as Plot from '$lib/core/Plot.svelte';
import * as facetPanels from '$lib/core/facetPanels.svelte.js';
import * as notifications from '$lib/core/notifications.svelte.js';
import * as plotRefs from '$lib/core/plotRefs.js';
import * as ProcessNode from '$lib/core/ProcessNode.svelte.js';
import * as markerRules from '$lib/plots/Actogram/markerRules.svelte.js';
import * as plotMetricOutputs from '$lib/plots/plotMetricOutputs.svelte.js';

/** Module namespaces keyed by file basename (without extension). */
export const devModules = {
	core,
	Column,
	Plot,
	facetPanels,
	notifications,
	plotRefs,
	ProcessNode,
	markerRules,
	plotMetricOutputs
};
