// Facet type sets, shared by the panel engine (facetPanels.svelte.js) and the session
// migration (facetMigration.js).
//
// The single definition: `Plot.svelte` imports both sets from here (and re-exports
// `FACETABLE_PLOT_TYPES` for its existing importers). They live in a pure module because the
// migration must stay free of `core` (it runs on parsed session JSON before any Plot exists).

// Plot types that support faceting (small multiples). The boxplot and the mean/SEM plot
// are deliberately absent: a box already IS one group's summary, and faceting it takes the
// comparison away.
export const FACETABLE_PLOT_TYPES = new Set([
	'scatterplot',
	'actogram',
	'correlogram',
	'periodogram',
	'fft',
	'histogram'
]);

// Plot types whose series are a flat list of single columns (no x/y pairing). One facet
// unit per wired column.
export const COLUMN_BASED_FACET_TYPES = new Set(['histogram']);
