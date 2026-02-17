// Periodogram calculation worker
// This runs in a separate thread to avoid blocking the UI
// BigNumber is prepended to this source at runtime (see Periodogram.svelte initWorker)

// Configure BigNumber for high precision
BigNumber.config({
	DECIMAL_PLACES: 50,
	ROUNDING_MODE: BigNumber.ROUND_HALF_UP
});

// ========== Helper Functions ==========

function mean(data) {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < data.length; i++) {
		if (data[i] !== undefined && !isNaN(data[i])) {
			sum += data[i];
			count++;
		}
	}
	return count > 0 ? sum / count : 0;
}

function makeSeqArray(from, to, step) {
	let out = [];
	for (let i = from; i <= to; i += step) {
		out.push(i);
	}
	return out;
}

function binData(xValues, yValues, binSize, binStart = 0) {
	const n = xValues.length;
	if (n === 0 || n !== yValues.length) return { bins: [], y_out: [] };

	// Pair and sort by x once
	const paired = xValues.map((x, i) => ({ x, y: yValues[i] })).sort((a, b) => a.x - b.x);
	const xs = paired.map((p) => p.x);
	const ys = paired.map((p) => p.y);

	const meanFunc = (arr, start, end) => {
		let sum = 0;
		for (let i = start; i < end; i++) sum += arr[i];
		return sum / (end - start);
	};

	const bins = [];
	const y_out = [];
	let currentStart = binStart;
	const EPSILON = 1e-10;
	let pointer = 0;

	while (true) {
		const binEnd = currentStart + binSize;
		bins.push(currentStart);

		while (pointer < n && xs[pointer] < currentStart - EPSILON) pointer++;

		const startIdx = pointer;
		let endIdx = startIdx;
		while (endIdx < n && xs[endIdx] < binEnd - EPSILON) endIdx++;

		y_out.push(meanFunc(ys, startIdx, endIdx));

		if (currentStart >= xs[n - 1]) break;
		currentStart += binSize;
	}

	return { bins, y_out };
}

// ========== CDF Functions ==========
// Adapted from CDFs.js

function gamnln(n) {
	var lg = [
		0.5723649429247001, 0, -0.1207822376352452, 0, 0.2846828704729192, 0.6931471805599453,
		1.200973602347074, 1.791759469228055, 2.453736570842442, 3.178053830347946, 3.957813967618717,
		4.787491742782046, 5.662562059857142, 6.579251212010101, 7.534364236758733, 8.525161361065415,
		9.549267257300997, 10.60460290274525, 11.68933342079727, 12.80182748008147, 13.94062521940376,
		15.10441257307552, 16.29200047656724, 17.50230784587389, 18.73434751193645, 19.98721449566188,
		21.2600761562447, 22.55216385312342, 23.86276584168909, 25.19122118273868, 26.53691449111561,
		27.89927138384089, 29.27775451504082, 30.67186010608068, 32.08111489594736, 33.50507345013689,
		34.94331577687682, 36.39544520803305, 37.86108650896109, 39.3398841871995, 40.8315009745308,
		42.33561646075349, 43.85192586067515, 45.3801388984769, 46.91997879580877, 48.47118135183522,
		50.03349410501914, 51.60667556776437, 53.19049452616927, 54.78472939811231, 56.38916764371993,
		58.00360522298051, 59.62784609588432, 61.26170176100199, 62.9049908288765, 64.55753862700632,
		66.21917683354901, 67.88974313718154, 69.56908092082364, 71.257038967168, 72.9534711841694,
		74.65823634883016, 76.37119786778275, 78.09222355331531, 79.82118541361436, 81.55795945611503,
		83.30242550295004, 85.05446701758153, 86.81397094178108, 88.58082754219767, 90.35493026581838,
		92.13617560368709, 93.92446296229978, 95.71969454214322, 97.52177522288821, 99.33061245478741,
		101.1461161558646, 102.9681986145138, 104.7967743971583, 106.6317602606435, 108.4730750690654,
		110.3206397147574, 112.1743770431779, 114.0342117814617, 115.9000704704145, 117.7718813997451,
		119.6495745463449, 121.5330815154387, 123.4223354844396, 125.3172711493569, 127.2178246736118,
		129.1239336391272, 131.0355369995686, 132.9525750356163, 134.8749893121619, 136.8027226373264,
		138.7357190232026, 140.6739236482343, 142.617282821146, 144.5657439463449, 146.5192554907206,
		148.477766951773, 150.4412288270019, 152.4095925844974, 154.3828106346716, 156.3608363030788,
		158.3436238042692, 160.3311282166309, 162.3233054581712, 164.3201122631952, 166.3215061598404,
		168.3274454484277, 170.3378891805928, 172.3527971391628, 174.3721298187452, 176.3958484069973,
		178.4239147665485, 180.4562914175438, 182.4929415207863, 184.5338288614495, 186.5789178333379,
		188.6281734236716, 190.6815611983747, 192.7390472878449, 194.8005983731871, 196.86618167289,
		198.9357649299295, 201.0093163992815, 203.0868048358281, 205.1681994826412, 207.2534700596299,
		209.3425867525368, 211.435520202271, 213.5322414945632, 215.6327221499328, 217.7369341139542,
		219.8448497478113, 221.9564418191303, 224.0716834930795, 226.1905483237276, 228.3130102456502,
		230.4390435657769, 232.5686229554685, 234.7017234428182, 236.8383204051684, 238.9783895618343,
		241.121906967029, 243.2688490029827, 245.4191923732478, 247.5729140961868, 249.7299914986334,
		251.8904022097232, 254.0541241548883, 256.2211355500095, 258.3914148957209, 260.5649409718632,
		262.7416928320802, 264.9216497985528, 267.1047914568685, 269.2910976510198, 271.4805484785288,
		273.6731242856937, 275.8688056629533, 278.0675734403662, 280.2694086832001, 282.4742926876305,
		284.6822069765408, 286.893133295427, 289.1070536083976, 291.3239500942703, 293.5438051427607,
		295.7666013507606, 297.9923215187034, 300.2209486470141, 302.4524659326413, 304.6868567656687,
		306.9241047260048, 309.1641935801469, 311.4071072780187, 313.652829949879, 315.9013459032995,
		318.1526396202093, 320.4066957540055, 322.6634991267262, 324.9230347262869, 327.1852877037753,
		329.4502433708053, 331.7178871969285, 333.9882048070999, 336.2611819791985, 338.5368046415996,
		340.815058870799, 343.0959308890863, 345.3794070622669, 347.6654738974312, 349.9541180407703,
		352.245326275435, 354.5390855194408, 356.835382823613, 359.1342053695754
	];

	if (n < 201) {
		return new BigNumber(lg[n - 1]);
	}

	var coef = [
		76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
		1.208650973866179e-3, -5.395239384953e-6
	];
	const stp = new BigNumber(2.5066282746310005);
	const x = new BigNumber(n).times(0.5);
	var y = x;
	var tmp = x.plus(5.5);
	tmp = x.plus(0.5).times(BigNumber.ln(tmp)).minus(tmp);
	var ser = new BigNumber(1.000000000190015);
	for (var i = 0; i < 6; i++) {
		y = y.plus(1);
		ser = ser.plus(new BigNumber(coef[i]).dividedBy(y));
	}
	const gamln = tmp.plus(BigNumber.ln(stp.times(ser).dividedBy(x)));
	return gamln;
}

function gser(n, x) {
	const maxit = 100000000;
	const eps = new BigNumber(1e-8);
	const gln = gamnln(n);
	const a = new BigNumber(n).times(0.5);
	var ap = a;
	var sum = new BigNumber(1).dividedBy(a);
	var del = sum;
	const xBN = new BigNumber(x);

	for (var i = 1; i < maxit; i++) {
		ap = ap.plus(1);
		del = del.times(xBN).dividedBy(ap);
		sum = sum.plus(del);
		if (del.isLessThan(sum.times(eps))) {
			break;
		}
	}
	return sum
		.times(
			BigNumber.exp(
				xBN
					.negated()
					.plus(a.times(BigNumber.ln(xBN)))
					.minus(gln)
					.toNumber()
			)
		)
		.toNumber();
}

function gcf(n, x) {
	const maxit = 100000000;
	const eps = new BigNumber(1e-8);
	const gln = gamnln(n);
	const a = new BigNumber(n).times(0.5);
	const xBN = new BigNumber(x);
	var b = xBN.plus(1).minus(a);
	const fpmin = new BigNumber(1e-300);
	var c = new BigNumber(1).dividedBy(fpmin);
	var d = new BigNumber(1).dividedBy(b);
	var h = d;

	for (var i = 1; i < maxit; i++) {
		const an = new BigNumber(-i).times(new BigNumber(i).minus(a));
		b = b.plus(2);
		d = an.times(d).plus(b);
		if (BigNumber.abs(d).isLessThan(fpmin)) {
			d = fpmin;
		}
		c = b.plus(an.dividedBy(c));
		if (BigNumber.abs(c).isLessThan(fpmin)) {
			c = fpmin;
		}
		d = new BigNumber(1).dividedBy(d);
		const del = d.times(c);
		h = h.times(del);
		if (BigNumber.abs(del.minus(1)).isLessThan(eps)) {
			break;
		}
	}
	return h
		.times(
			BigNumber.exp(
				xBN
					.negated()
					.plus(a.times(BigNumber.ln(xBN)))
					.minus(gln)
					.toNumber()
			)
		)
		.toNumber();
}

function gammq(n, x) {
	if (x < 0.5 * n + 1) {
		return 1 - gser(n, x);
	} else {
		return gcf(n, x);
	}
}

function gammp(n, x) {
	if (x < 0.5 * n + 1) {
		return gser(n, x);
	} else {
		return 1 - gcf(n, x);
	}
}

function bisection(f, x1, x2, releps, abseps) {
	var sign = function (z) {
		const zBN = new BigNumber(z);
		if (zBN.isGreaterThan(0)) {
			return 1;
		} else if (zBN.isLessThan(0)) {
			return -1;
		} else {
			return 0;
		}
	};

	var f1 = sign(f(x1));
	var f2 = sign(f(x2));
	var x = new BigNumber(x1).plus(x2).dividedBy(2);
	var fx = f(x.toNumber());

	const relBN = new BigNumber(releps);
	const absBN = new BigNumber(abseps);

	while (
		new BigNumber(x2).minus(x1).isGreaterThan(absBN) &&
		new BigNumber(x2).minus(x1).isGreaterThan(relBN.times(BigNumber.abs(x))) &&
		BigNumber.abs(fx).isGreaterThan(absBN)
	) {
		if (fx * f1 > 0) {
			x1 = x.toNumber();
			f1 = sign(fx);
		} else {
			x2 = x.toNumber();
			f2 = sign(fx);
		}
		x = new BigNumber(x1).plus(x2).dividedBy(2);
		fx = f(x.toNumber());
	}
	return x.toNumber();
}

function pchisq(chi2, n, ptype = 1) {
	const chi2BN = new BigNumber(chi2);
	if (ptype == 1) {
		return gammq(n, chi2BN.times(0.5).toNumber());
	} else {
		return gammp(n, chi2BN.times(0.5).toNumber());
	}
}

function qchisq(p, n, ptype = 1) {
	const pBN = new BigNumber(p);

	if (ptype == 1) {
		if (pBN.isEqualTo(0)) {
			return 1 / 0;
		}
		if (pBN.isEqualTo(1)) {
			return 0;
		}
	}

	if (ptype == 2) {
		if (pBN.isEqualTo(0)) {
			return 0;
		}
		if (pBN.isEqualTo(1)) {
			return 1 / 0;
		}
	}

	var eps = 1e-6;

	var min = 0;
	const sd = BigNumber.sqrt(new BigNumber(2.0).times(n).toNumber());
	var max = sd.times(2).toNumber();
	var s = 1;
	if (ptype == 2) {
		s = -1;
	}

	while (s * pchisq(max, n, ptype) > p * s) {
		min = max;
		max = new BigNumber(max).plus(sd.times(2)).toNumber();
	}

	var fun = function (x) {
		return pchisq(x, n, ptype) - p;
	};

	return bisection(fun, min, max, eps, 0);
}

// ========== Periodogram Calculation Functions ==========

function calculateLombScarglePower(times, values, frequencies, onProgress) {
	if (!times || !values || times.length < 2 || values.length < 2 || times.length !== values.length) {
		return new Array(frequencies.length).fill(NaN);
	}

	const validIndices = times
		.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i))
		.filter((i) => i !== -1);
	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);

	if (t.length === 0) return new Array(frequencies.length).fill(0);

	const yMean = mean(y);

	// Calculate variance using BigNumber
	let yVarianceBN = new BigNumber(0);
	for (let i = 0; i < y.length; i++) {
		const diff = new BigNumber(y[i]).minus(yMean);
		yVarianceBN = yVarianceBN.plus(diff.times(diff));
	}
	yVarianceBN = yVarianceBN.dividedBy(y.length - 1);

	const powers = frequencies.map((f, freqIndex) => {
		const omega = 2 * Math.PI * f;

		// Calculate cosSum and sinSum using BigNumber
		let cosSum = new BigNumber(0);
		let sinSum = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			cosSum = cosSum.plus(Math.cos(omega * t[i]));
			sinSum = sinSum.plus(Math.sin(omega * t[i]));
		}
		const tau = Math.atan2(sinSum.toNumber(), cosSum.toNumber()) / (2 * omega);

		// Calculate cosTerm and sinTerm using BigNumber
		let cosTerm = new BigNumber(0);
		let sinTerm = new BigNumber(0);
		for (let i = 0; i < y.length; i++) {
			const yDiff = new BigNumber(y[i]).minus(yMean);
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosTerm = cosTerm.plus(yDiff.times(cosVal));
			sinTerm = sinTerm.plus(yDiff.times(sinVal));
		}

		// Calculate denominators using BigNumber
		let cosDenom = new BigNumber(0);
		let sinDenom = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosDenom = cosDenom.plus(new BigNumber(cosVal).times(cosVal));
			sinDenom = sinDenom.plus(new BigNumber(sinVal).times(sinVal));
		}

		// Calculate power using BigNumber
		const term1 = cosTerm.times(cosTerm).dividedBy(cosDenom);
		const term2 = sinTerm.times(sinTerm).dividedBy(sinDenom);
		const power = term1.plus(term2).dividedBy(yVarianceBN.times(2));

		// Send progress update every 10 frequencies
		if (onProgress && freqIndex % 10 === 0) {
			onProgress(freqIndex, frequencies.length);
		}

		return power.toNumber();
	});

	return powers;
}

function calculateEnrightPower(times, values, periods, binSize, onProgress) {
	if (!times || !values || times.length < 2 || values.length < 2) {
		return new Array(periods.length).fill(NaN);
	}

	const binnedData = binData(times, values, binSize, 0);
	if (binnedData.bins.length === 0) {
		return new Array(periods.length).fill(0);
	}

	const data = binnedData.y_out;
	const n = data.length;
	const dataMean = mean(data.filter((v) => !isNaN(v)));
	const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));

	const powers = periods.map((period, periodIndex) => {
		const binsPerPeriod = Math.round(period / binSize);
		if (binsPerPeriod < 1 || binsPerPeriod > n) return 0;

		let qp = new BigNumber(0);
		let count = 0;

		for (let k = 1; k * binsPerPeriod < n; k++) {
			const lag = k * binsPerPeriod;
			let correlation = new BigNumber(0);
			let validPairs = 0;

			for (let i = 0; i < n - lag; i++) {
				if (!isNaN(centeredData[i]) && !isNaN(centeredData[i + lag])) {
					correlation = correlation.plus(
						new BigNumber(centeredData[i]).times(centeredData[i + lag])
					);
					validPairs++;
				}
			}

			if (validPairs > 0) {
				qp = qp.plus(correlation.dividedBy(validPairs));
				count++;
			}
		}

		if (count > 0) {
			qp = qp.dividedBy(count);
		}

		// Calculate variance using BigNumber
		let variance = new BigNumber(0);
		for (let i = 0; i < centeredData.length; i++) {
			const val = centeredData[i];
			if (!isNaN(val)) {
				variance = variance.plus(new BigNumber(val).times(val));
			}
		}
		variance = variance.dividedBy(n);

		// Send progress update every 10 periods
		if (onProgress && periodIndex % 10 === 0) {
			onProgress(periodIndex, periods.length);
		}

		return variance.isGreaterThan(0) ? qp.dividedBy(variance).toNumber() : 0;
	});

	return powers;
}

function calculateChiSquaredPower(data, binSize, period, avgAll, denominator) {
	const colNum = Math.round(period / binSize);
	if (colNum < 1) return NaN;

	const rowNum = Math.ceil(data.length / colNum);

	// Use BigNumber arrays for column sums
	let colSums = new Array(colNum).fill(0).map(() => new BigNumber(0));
	let colCounts = new Array(colNum).fill(0);

	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		const val = data[i];
		if (!isNaN(val)) {
			colSums[col] = colSums[col].plus(val);
			colCounts[col]++;
		}
	}

	// Calculate column averages using BigNumber
	const avgAllBN = new BigNumber(avgAll);
	const avgP = colSums.map((sum, i) =>
		colCounts[i] > 0 ? sum.dividedBy(colCounts[i]) : avgAllBN
	);

	// Calculate numerator sum using BigNumber
	let numSum = new BigNumber(0);
	for (let i = 0; i < colNum; i++) {
		const diff = avgP[i].minus(avgAllBN);
		numSum = numSum.plus(diff.times(diff));
	}

	const numerator = numSum.times(data.length).times(rowNum);
	const result = numerator.dividedBy(denominator);

	return result.isFinite() ? result.toNumber() : NaN;
}

// ========== Main Calculation Function ==========

function runPeriodogramCalculation(params, onProgress) {
	let out = { x: [], y: [], threshold: [], pvalue: [] };
	let binnedData = { bins: [], y_out: [] };

	if (params.method === 'Chi-squared') {
		if (!params.yData) {
			return { x: [], y: [], threshold: [], pvalue: [] };
		}
		binnedData = binData(params.xData, params.yData, params.binSize, 0);
		if (binnedData.bins.length === 0) {
			return { x: [], y: [], threshold: [], pvalue: [] };
		}
	}

	const periods = makeSeqArray(params.periodMin, params.periodMax, params.periodSteps);
	const frequencies = periods.map((p) => 1 / p);

	const correctedAlpha = Math.pow(1 - params.chiSquaredAlpha, 1 / periods.length);
	const power = new Array(periods.length);
	const threshold = new Array(periods.length);
	const pvalue = new Array(periods.length);

	if (params.method === 'Chi-squared') {
		const data = binnedData.y_out;
		const avgAll = mean(data);

		// Calculate denominator using BigNumber for precision
		let denominator = new BigNumber(0);
		for (let i = 0; i < data.length; i++) {
			const val = data[i];
			if (!isNaN(val)) {
				const diff = new BigNumber(val).minus(avgAll);
				denominator = denominator.plus(diff.times(diff));
			}
		}

		for (let p = 0; p < periods.length; p++) {
			power[p] = calculateChiSquaredPower(
				data,
				params.binSize,
				periods[p],
				avgAll,
				denominator.toNumber()
			);
			threshold[p] = qchisq(1 - correctedAlpha, Math.round(periods[p] / params.binSize));
			pvalue[p] = 1 - pchisq(power[p], Math.round(periods[p] / params.binSize));

			// Send progress update every 10 periods
			if (onProgress && p % 10 === 0) {
				onProgress(p, periods.length);
			}
		}
	} else if (params.method === 'Lomb-Scargle') {
		const times = params.xData;
		const values = params.yData;
		const powers = calculateLombScarglePower(times, values, frequencies, onProgress);

		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
		}
	} else if (params.method === 'Enright') {
		const times = params.xData;
		const values = params.yData;
		const powers = calculateEnrightPower(times, values, periods, params.binSize, onProgress);

		for (let p = 0; p < periods.length; p++) {
			power[p] = powers[p];
		}
	}

	// Remove NaN values
	const idxsToRemove = [];
	for (let i = 0; i < power.length; i++) {
		if (isNaN(power[i]) || isNaN(periods[i])) {
			idxsToRemove.push(i);
		}
	}

	out = {
		x: periods.filter((v, i) => !idxsToRemove.includes(i)),
		y: power.filter((v, i) => !idxsToRemove.includes(i)),
		threshold: threshold.filter((v, i) => !idxsToRemove.includes(i)),
		pvalue: pvalue.filter((v, i) => !idxsToRemove.includes(i))
	};

	return out;
}

// ========== Worker Message Handler ==========

let currentCalculation = null;

self.onmessage = function (e) {
	const { type, params, id } = e.data;

	if (type === 'calculate') {
		currentCalculation = id;

		try {
			const result = runPeriodogramCalculation(params, (current, total) => {
				// Send progress update
				if (currentCalculation === id) {
					self.postMessage({
						type: 'progress',
						id,
						current,
						total
					});
				}
			});

			// Send final result if not cancelled
			if (currentCalculation === id) {
				self.postMessage({
					type: 'complete',
					id,
					result
				});
			}
		} catch (error) {
			self.postMessage({
				type: 'error',
				id,
				error: error.message
			});
		}
	} else if (type === 'cancel') {
		// Mark calculation as cancelled
		if (currentCalculation === id) {
			currentCalculation = null;
			self.postMessage({
				type: 'cancelled',
				id
			});
		}
	}
};
