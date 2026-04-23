// @ts-nocheck
import { mean } from '$lib/components/plotbits/helpers/wrangleData.js';

/**
 * Compute the autocorrelation function of a 1-D signal sampled at `times`.
 *
 * Uses a fast index-based path when sampling is approximately uniform (within
 * 10% of the median dt) and a slower time-pair path otherwise.
 *
 * @param {number[]} times      - Sample times (hours).
 * @param {number[]} values     - Signal values aligned to `times`.
 * @param {number|null} binSize - Lag bin width (hours); null = derive from data spacing.
 * @param {number|null} maxLag  - Maximum lag (hours); null = (timespan)/2.
 * @returns {{ lags: number[], correlations: number[], dt: number }}
 */
export function computeAutocorrelation(times, values, binSize = null, maxLag = null) {
	if (
		!times ||
		!values ||
		times.length < 2 ||
		values.length < 2 ||
		times.length !== values.length
	) {
		return { lags: [], correlations: [], dt: 1 };
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);

	if (validIndices.length < 2) {
		return { lags: [], correlations: [], dt: 1 };
	}

	const t = validIndices.map((i) => times[i]).filter((val) => val != null);
	const y = validIndices.map((i) => values[i]).filter((val) => val != null);

	const n = y.length;

	let dt;
	if (binSize != null) {
		dt = binSize;
	} else {
		const diffs = [];
		for (let i = 1; i < t.length; i++) diffs.push(t[i] - t[i - 1]);
		diffs.sort((a, b) => a - b);
		dt = diffs[Math.floor(diffs.length / 2)];
	}

	const maxLagTime = maxLag ? maxLag : (t[t.length - 1] - t[0]) / 2;

	const nLags = Math.min(Math.floor(maxLagTime / dt), Math.floor(n / 2));

	const yMean = mean(y);
	const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / n;

	if (yVariance === 0) {
		return { lags: [], correlations: [], dt };
	}

	const lags = [];
	const correlations = [];

	const isUniform = (diffs) => {
		if (!diffs || diffs.length === 0) return false;
		const median = diffs[Math.floor(diffs.length / 2)];
		const maxDev = diffs.reduce((m, d) => Math.max(m, Math.abs(d - median)), 0);
		return maxDev < median * 0.1;
	};

	const timeDiffs = [];
	for (let i = 1; i < t.length; i++) timeDiffs.push(t[i] - t[i - 1]);
	timeDiffs.sort((a, b) => a - b);

	if (isUniform(timeDiffs)) {
		for (let lag = 0; lag <= nLags; lag++) {
			let sum = 0;
			let count = 0;
			for (let i = 0; i < n - lag; i++) {
				if (!isNaN(y[i]) && !isNaN(y[i + lag])) {
					sum += (y[i] - yMean) * (y[i + lag] - yMean);
					count++;
				}
			}
			const correlation = count > 0 ? sum / (count * yVariance) : 0;
			lags.push(lag * dt);
			correlations.push(correlation);
		}
	} else {
		for (let lagIdx = 0; lagIdx <= nLags; lagIdx++) {
			const targetLag = lagIdx * dt;
			let sum = 0;
			let count = 0;
			const tolerance = dt / 2;

			for (let i = 0; i < n; i++) {
				for (let j = i + 1; j < n; j++) {
					const timeDiff = t[j] - t[i];
					if (Math.abs(timeDiff - targetLag) <= tolerance) {
						if (!isNaN(y[i]) && !isNaN(y[j])) {
							sum += (y[i] - yMean) * (y[j] - yMean);
							count++;
						}
					}
					if (timeDiff > targetLag + tolerance) break;
				}
			}
			const correlation = count > 0 ? sum / (count * yVariance) : 0;
			lags.push(targetLag);
			correlations.push(correlation);
		}
	}

	return { lags, correlations, dt };
}
