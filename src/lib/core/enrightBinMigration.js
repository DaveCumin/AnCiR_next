// @ts-nocheck
// Legacy Enright bin sizes on Periodogram plot series (v81.0, author's decision on SPEC-8).
//
// Until v81 the Periodogram plot HID the Bin Size control for Enright, so every Enright series
// in a saved session computed at the 0.25 h it was created with (or that fromJSON gave one that
// stored none). That 0.25 h was never the user's choice, and on anything coarser than 15 min
// data it leaves most bins empty. From v81 a new series follows its x (binSizeAuto: the median
// sampling interval, PeriodogramDataclass), so a legacy Enright series is migrated to do the
// same: it loads following its x, and the plot writes the resolved number into binSize.
//
// The rule (identical in tools/ancir_runtime.py migrate_legacy_enright_bins):
//   - the session predates v81: its `version` has a first number below 81, or it has no
//     readable version at all (every session v81 writes carries one);
//   - the series is on a 'periodogram' plot and its method is 'Enright';
//   - the series carries no `binSizeAuto` field (no legacy release wrote one, so a series
//     that has it was saved by a build with the visible control and its bin size stands);
//   - its stored bin size is the old hidden default: 0.25, or absent.
// Such a series gets `binSizeAuto: true`. Chi-squared and Lomb-Scargle series are untouched
// (Chi-squared always showed the control, so its 0.25 may be a choice), and so is an Enright
// series with any other stored bin size.
//
// Only the plot. Rhythmicity Analysis and Moving Analysis always SHOWED their bin size for
// Enright, so their stored pgBinSize may be the user's and is kept.
//
// Pure (JSON in, JSON out, no app state), run by importJson before anything is built. The
// input is not mutated: the migration copies what it changes.

/** The first app version whose new Enright series follow their x. */
export const FIRST_FOLLOWING_MAJOR = 81;

/** The bin size legacy Enright series sat at, with the control hidden. */
export const LEGACY_HIDDEN_BIN = 0.25;

/** The first number of an app version ('β.80.0' -> 80, 'v81.2' -> 81), or null. */
export function versionMajor(version) {
	if (typeof version !== 'string' && typeof version !== 'number') return null;
	const m = String(version).match(/\d+/);
	return m ? parseInt(m[0], 10) : null;
}

/** Whether a session saved by `version` predates the following Enright bin size. */
export function isLegacyBinSession(version) {
	const major = versionMajor(version);
	return major == null || major < FIRST_FOLLOWING_MAJOR;
}

/** Whether one saved Periodogram series is a legacy Enright series at the hidden default. */
export function isLegacyEnrightSeries(series) {
	if (!series || typeof series !== 'object') return false;
	if (series.method !== 'Enright') return false;
	if (Object.prototype.hasOwnProperty.call(series, 'binSizeAuto')) return false;
	return series.binSize == null || series.binSize === LEGACY_HIDDEN_BIN;
}

/**
 * Set every legacy Enright Periodogram series in a pre-v81 session to follow its x.
 * @param {object} json  a parsed session
 * @returns {{ json: object, migrated: number }}  the session (a copy when anything changed)
 */
export function migrateLegacyEnrightBins(json) {
	if (!json || !Array.isArray(json.plots) || !isLegacyBinSession(json.version)) {
		return { json, migrated: 0 };
	}
	let migrated = 0;
	const plots = json.plots.map((plot) => {
		const data = plot?.type === 'periodogram' ? plot.plot?.data : null;
		if (!Array.isArray(data) || !data.some(isLegacyEnrightSeries)) return plot;
		return {
			...plot,
			plot: {
				...plot.plot,
				data: data.map((series) => {
					if (!isLegacyEnrightSeries(series)) return series;
					migrated++;
					return { ...series, binSize: series.binSize ?? LEGACY_HIDDEN_BIN, binSizeAuto: true };
				})
			}
		};
	});
	return migrated ? { json: { ...json, plots }, migrated } : { json, migrated };
}
