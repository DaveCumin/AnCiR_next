// DEPRECATED — kept for reference only; no longer imported by the server.
//
// The capability catalogue is now derived *live* from the engine registry by
// `describeCapabilities()` in `engine/session.js`, so every AnCiR table process
// appears automatically (inputs, params + defaults, output keys, status) with no
// hand-maintained list. This file previously hard-coded a single `cosinor` entry;
// it is retained only as a record of the original shape. Safe to remove.

export const capabilities = {
	analyses: [
		{
			id: 'cosinor',
			displayName: 'Cosinor',
			status: 'available',
			summary:
				'Fit a cosine model (fixed or free period, multiple harmonics) to recover MESOR, amplitude, acrophase, period, R² and RMSE.'
		}
	],
	plots: [{ id: 'actogram', status: 'planned' }]
};
