// The registry facts the MCP tool descriptions quote (which plots carry overlays and in which
// forms; which plots colour / size by a column, with the modes and colormaps), read from the
// GENERATED catalogue (src/emit/session-schema.generated.json) instead of the live registry.
//
// Why: the server answers `tools/list` before the engine has loaded (see warmup.js), so the
// tool text cannot wait for the registry. The catalogue is generated from the same registry
// (gen-schema.js, run by every build), and test/toolFacts.test.js pins these values to the
// live ones (engine/overlays.js overlayFormsSummary, engine/encodings.js encodingHostsSummary).
// If they still differ at run time (an unregenerated catalogue during development), the server
// switches the tools to the live text once warm and notifies the client (tools/list_changed).
//
// Pure: no engine imports.

/** Same shape as the live facts (see liveToolFacts in server.js). */
export function staticToolFacts(catalogue) {
	const plots = catalogue?.plots ?? {};
	const ids = Object.keys(plots).sort();
	const overlayIds = ids.filter((id) => plots[id].overlays);
	const overlayForms = overlayIds
		.map((id) => {
			const kinds = ['line', 'band']
				.map((kind) => [kind, Object.keys(plots[id].overlays[kind] ?? {})])
				.filter(([, forms]) => forms.length)
				.map(([kind, forms]) => `${kind} ${forms.join(' | ')}`);
			return `${id}: ${kinds.join(', ')}`;
		})
		.join('; ');
	const enc = catalogue?.encodings ?? {};
	const maps = Object.entries(enc.colormaps ?? {});
	const mapsOf = (cyclic) =>
		maps
			.filter(([, k]) => (k === 'cyclic') === cyclic)
			.map(([m]) => m)
			.join('|');
	return {
		overlayHosts: overlayIds.join(', '),
		overlayForms,
		enc: {
			colourHosts: ids.filter((id) => plots[id].encodings?.colour),
			sizeHosts: ids.filter((id) => plots[id].encodings?.size),
			modes: enc.modes ?? [],
			sizeModes: enc.sizeModes ?? [],
			cyclicModes: enc.cyclicModes ?? [],
			sequentialMaps: mapsOf(false),
			cyclicMaps: mapsOf(true)
		}
	};
}
