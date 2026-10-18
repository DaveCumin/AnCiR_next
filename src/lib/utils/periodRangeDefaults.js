// The period range (h) a NEW free-period fit (Cosinor, Rectangular wave, Double logistic, Fit
// waveform model) starts from on a TIME x: 1 to 30 h since v82.30 (1 to 48 h before).
//
// Its own dependency-free module so the MCP draft normalizer (mcp/src/emit/normalizer.js, also
// bundled into the Worker) can give a new node in a draft the same range as the palette does,
// without pulling in the fitting code. The app reads it through utils/periodUnits.js.
//
// Not cosinor.js FREE_PERIOD_DEFAULTS (1 to 48 h): that is the fallback for a node with no
// stored range at all, which saved sessions were computed with.
export const NEW_NODE_TIME_PERIOD_RANGE = Object.freeze({ minPeriod: 1, maxPeriod: 30 });
