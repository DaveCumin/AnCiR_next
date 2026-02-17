/**
 * Head-to-head comparison: BigNumber (webworker) vs Plain JavaScript
 *
 * Tests the periodogram calculations (Lomb-Scargle, Chi-squared, Enright),
 * CDF functions (pchisq, qchisq), and cosinor fitting with stress-test data
 * designed to expose numerical differences.
 *
 * Usage: node test/compare-bignumber-vs-plainjs.mjs
 */

import BigNumber from 'bignumber.js';

// Configure BigNumber to match production settings
BigNumber.config({
	DECIMAL_PLACES: 50,
	ROUNDING_MODE: BigNumber.ROUND_HALF_UP
});

// Polyfill static methods used by the app code but not present in bignumber.js v9.3.1
// The app code calls BigNumber.ln(x), BigNumber.exp(x), BigNumber.sqrt(x), BigNumber.abs(x)
// These are wrappers around Math.* that return BigNumber instances
BigNumber.ln = function (x) {
	const val = typeof x === 'number' ? x : new BigNumber(x).toNumber();
	return new BigNumber(Math.log(val));
};
BigNumber.exp = function (x) {
	const val = typeof x === 'number' ? x : new BigNumber(x).toNumber();
	return new BigNumber(Math.exp(val));
};
BigNumber.sqrt = function (x) {
	const val = typeof x === 'number' ? x : new BigNumber(x).toNumber();
	return new BigNumber(Math.sqrt(val));
};
BigNumber.abs = function (x) {
	if (x instanceof BigNumber) return x.abs();
	return new BigNumber(Math.abs(x));
};
BigNumber.max = function (a, b) {
	const aBN = a instanceof BigNumber ? a : new BigNumber(a);
	const bBN = b instanceof BigNumber ? b : new BigNumber(b);
	return aBN.isGreaterThan(bBN) ? aBN : bBN;
};
BigNumber.ln.toString = () => '[polyfill]'; // marker for debugging

// ============================================================================
// SHARED HELPERS
// ============================================================================

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

// ============================================================================
// PLAIN JS IMPLEMENTATIONS (from commit 64fdb08, pre-BigNumber)
// ============================================================================

const plain = {};

// --- CDFs (plain JS) ---

plain.bisection = function (f, x1, x2, releps, abseps) {
	var sign = function (z) {
		if (z > 0) return 1;
		else if (z < 0) return -1;
		else return 0;
	};
	var f1 = sign(f(x1));
	var f2 = sign(f(x2));
	var x = 0.5 * (x1 + x2);
	var fx = f(x);
	while (x2 - x1 > abseps && x2 - x1 > releps * Math.abs(x) && Math.abs(fx) > abseps) {
		if (fx * f1 > 0) { x1 = x; f1 = sign(fx); }
		else { x2 = x; f2 = sign(fx); }
		x = 0.5 * (x1 + x2);
		fx = f(x);
	}
	return x;
};

plain.gamnln = function (n) {
	var lg = [
		0.5723649429247001, 0, -0.1207822376352452, 0, 0.2846828704729192,
		0.6931471805599453, 1.200973602347074, 1.791759469228055, 2.453736570842442,
		3.178053830347946, 3.957813967618717, 4.787491742782046, 5.662562059857142,
		6.579251212010101, 7.534364236758733, 8.525161361065415, 9.549267257300997,
		10.60460290274525, 11.68933342079727, 12.80182748008147, 13.94062521940376,
		15.10441257307552, 16.29200047656724, 17.50230784587389, 18.73434751193645,
		19.98721449566188, 21.2600761562447, 22.55216385312342, 23.86276584168909,
		25.19122118273868, 26.53691449111561, 27.89927138384089, 29.27775451504082,
		30.67186010608068, 32.08111489594736, 33.50507345013689, 34.94331577687682,
		36.39544520803305, 37.86108650896109, 39.3398841871995, 40.8315009745308,
		42.33561646075349, 43.85192586067515, 45.3801388984769, 46.91997879580877,
		48.47118135183522, 50.03349410501914, 51.60667556776437, 53.19049452616927,
		54.78472939811231, 56.38916764371993, 58.00360522298051, 59.62784609588432,
		61.26170176100199, 62.9049908288765, 64.55753862700632, 66.21917683354901,
		67.88974313718154, 69.56908092082364, 71.257038967168, 72.9534711841694,
		74.65823634883016, 76.37119786778275, 78.09222355331531, 79.82118541361436,
		81.55795945611503, 83.30242550295004, 85.05446701758153, 86.81397094178108,
		88.58082754219767, 90.35493026581838, 92.13617560368709, 93.92446296229978,
		95.71969454214322, 97.52177522288821, 99.33061245478741, 101.1461161558646,
		102.9681986145138, 104.7967743971583, 106.6317602606435, 108.4730750690654,
		110.3206397147574, 112.1743770431779, 114.0342117814617, 115.9000704704145,
		117.7718813997451, 119.6495745463449, 121.5330815154387, 123.4223354844396,
		125.3172711493569, 127.2178246736118, 129.1239336391272, 131.0355369995686,
		132.9525750356163, 134.8749893121619, 136.8027226373264, 138.7357190232026,
		140.6739236482343, 142.617282821146, 144.5657439463449, 146.5192554907206,
		148.477766951773, 150.4412288270019, 152.4095925844974, 154.3828106346716,
		156.3608363030788, 158.3436238042692, 160.3311282166309, 162.3233054581712,
		164.3201122631952, 166.3215061598404, 168.3274454484277, 170.3378891805928,
		172.3527971391628, 174.3721298187452, 176.3958484069973, 178.4239147665485,
		180.4562914175438, 182.4929415207863, 184.5338288614495, 186.5789178333379,
		188.6281734236716, 190.6815611983747, 192.7390472878449, 194.8005983731871,
		196.86618167289, 198.9357649299295, 201.0093163992815, 203.0868048358281,
		205.1681994826412, 207.2534700596299, 209.3425867525368, 211.435520202271,
		213.5322414945632, 215.6327221499328, 217.7369341139542, 219.8448497478113,
		221.9564418191303, 224.0716834930795, 226.1905483237276, 228.3130102456502,
		230.4390435657769, 232.5686229554685, 234.7017234428182, 236.8383204051684,
		238.9783895618343, 241.121906967029, 243.2688490029827, 245.4191923732478,
		247.5729140961868, 249.7299914986334, 251.8904022097232, 254.0541241548883,
		256.2211355500095, 258.3914148957209, 260.5649409718632, 262.7416928320802,
		264.9216497985528, 267.1047914568685, 269.2910976510198, 271.4805484785288,
		273.6731242856937, 275.8688056629533, 278.0675734403662, 280.2694086832001,
		282.4742926876305, 284.6822069765408, 286.893133295427, 289.1070536083976,
		291.3239500942703, 293.5438051427607, 295.7666013507606, 297.9923215187034,
		300.2209486470141, 302.4524659326413, 304.6868567656687, 306.9241047260048,
		309.1641935801469, 311.4071072780187, 313.652829949879, 315.9013459032995,
		318.1526396202093, 320.4066957540055, 322.6634991267262, 324.9230347262869,
		327.1852877037753, 329.4502433708053, 331.7178871969285, 333.9882048070999,
		336.2611819791985, 338.5368046415996, 340.815058870799, 343.0959308890863,
		345.3794070622669, 347.6654738974312, 349.9541180407703, 352.245326275435,
		354.5390855194408, 356.835382823613, 359.1342053695754
	];
	if (n < 201) return lg[n - 1];
	var coef = [76.18009172947146, -86.50532032941677, 24.01409824083091,
		-1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
	var stp = 2.5066282746310005;
	var x = 0.5 * n;
	var y = x;
	var tmp = x + 5.5;
	tmp = (x + 0.5) * Math.log(tmp) - tmp;
	var ser = 1.000000000190015;
	for (var i = 0; i < 6; i++) { y = y + 1; ser = ser + coef[i] / y; }
	return tmp + Math.log((stp * ser) / x);
};

plain.gser = function (n, x) {
	var maxit = 100000000, eps = 1e-8;
	var gln = plain.gamnln(n);
	var a = 0.5 * n, ap = a, sum = 1.0 / a, del = sum;
	for (var i = 1; i < maxit; i++) {
		ap++; del = (del * x) / ap; sum += del;
		if (del < sum * eps) break;
	}
	return sum * Math.exp(-x + a * Math.log(x) - gln);
};

plain.gcf = function (n, x) {
	var maxit = 100000000, eps = 1e-8;
	var gln = plain.gamnln(n);
	var a = 0.5 * n, b = x + 1 - a, fpmin = 1e-300;
	var c = 1 / fpmin, d = 1 / b, h = d;
	for (var i = 1; i < maxit; i++) {
		var an = -i * (i - a); b += 2; d = an * d + b;
		if (Math.abs(d) < fpmin) d = fpmin;
		c = b + an / c;
		if (Math.abs(c) < fpmin) c = fpmin;
		d = 1 / d; var del = d * c; h = h * del;
		if (Math.abs(del - 1) < eps) break;
	}
	return h * Math.exp(-x + a * Math.log(x) - gln);
};

plain.gammp = function (n, x) {
	return x < 0.5 * n + 1 ? plain.gser(n, x) : 1 - plain.gcf(n, x);
};

plain.gammq = function (n, x) {
	return x < 0.5 * n + 1 ? 1 - plain.gser(n, x) : plain.gcf(n, x);
};

plain.pchisq = function (chi2, n, ptype = 1) {
	return ptype === 1 ? plain.gammq(n, 0.5 * chi2) : plain.gammp(n, 0.5 * chi2);
};

plain.qchisq = function (p, n, ptype = 1) {
	if (ptype === 1) { if (p === 0) return 1 / 0; if (p === 1) return 0; }
	if (ptype === 2) { if (p === 0) return 0; if (p === 1) return 1 / 0; }
	var eps = 1e-6;
	var min = 0, sd = Math.sqrt(2.0 * n), max = 2 * sd;
	var s = ptype === 2 ? -1 : 1;
	while (s * plain.pchisq(max, n, ptype) > p * s) { min = max; max += 2 * sd; }
	var fun = function (x) { return plain.pchisq(x, n, ptype) - p; };
	return plain.bisection(fun, min, max, eps, 0);
};

// --- Periodogram methods (plain JS) ---

plain.lombScargle = function (times, values, frequencies) {
	if (!times || !values || times.length < 2 || values.length < 2 || times.length !== values.length) {
		return new Array(frequencies.length).fill(NaN);
	}
	const validIndices = times.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i)).filter((i) => i !== -1);
	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);
	if (t.length === 0) return new Array(frequencies.length).fill(0);
	const yMean = mean(y);
	const yVariance = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0) / (y.length - 1);
	return frequencies.map((f) => {
		const omega = 2 * Math.PI * f;
		const cosSum = t.reduce((sum, ti) => sum + Math.cos(omega * ti), 0);
		const sinSum = t.reduce((sum, ti) => sum + Math.sin(omega * ti), 0);
		const tau = Math.atan2(sinSum, cosSum) / (2 * omega);
		const cosTerm = y.reduce((sum, yi, i) => sum + (yi - yMean) * Math.cos(omega * (t[i] - tau)), 0);
		const sinTerm = y.reduce((sum, yi, i) => sum + (yi - yMean) * Math.sin(omega * (t[i] - tau)), 0);
		const cosDenom = t.reduce((sum, ti) => sum + Math.cos(omega * (ti - tau)) ** 2, 0);
		const sinDenom = t.reduce((sum, ti) => sum + Math.sin(omega * (ti - tau)) ** 2, 0);
		return (cosTerm ** 2 / cosDenom + sinTerm ** 2 / sinDenom) / (2 * yVariance);
	});
};

plain.enright = function (times, values, periods, binSize) {
	if (!times || !values || times.length < 2 || values.length < 2) {
		return new Array(periods.length).fill(NaN);
	}
	const binnedData = binData(times, values, binSize, 0);
	if (binnedData.bins.length === 0) return new Array(periods.length).fill(0);
	const data = binnedData.y_out;
	const n = data.length;
	const dataMean = mean(data.filter((v) => !isNaN(v)));
	const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));
	return periods.map((period) => {
		const binsPerPeriod = Math.round(period / binSize);
		if (binsPerPeriod < 1 || binsPerPeriod > n) return 0;
		let qp = 0, count = 0;
		for (let k = 1; k * binsPerPeriod < n; k++) {
			const lag = k * binsPerPeriod;
			let correlation = 0, validPairs = 0;
			for (let i = 0; i < n - lag; i++) {
				if (!isNaN(centeredData[i]) && !isNaN(centeredData[i + lag])) {
					correlation += centeredData[i] * centeredData[i + lag];
					validPairs++;
				}
			}
			if (validPairs > 0) { qp += correlation / validPairs; count++; }
		}
		if (count > 0) qp /= count;
		const variance = centeredData.reduce((sum, val) => sum + (isNaN(val) ? 0 : val * val), 0) / n;
		return variance > 0 ? qp / variance : 0;
	});
};

plain.chiSquared = function (data, binSize, period, avgAll, denominator) {
	const colNum = Math.round(period / binSize);
	if (colNum < 1) return NaN;
	const rowNum = Math.ceil(data.length / colNum);
	let colSums = new Array(colNum).fill(0);
	let colCounts = new Array(colNum).fill(0);
	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		if (!isNaN(data[i])) { colSums[col] += data[i]; colCounts[col]++; }
	}
	const avgP = colSums.map((sum, i) => (colCounts[i] > 0 ? sum / colCounts[i] : avgAll));
	let numSum = 0;
	for (let i = 0; i < colNum; i++) numSum += (avgP[i] - avgAll) ** 2;
	const result = (numSum * data.length * rowNum) / denominator;
	return isFinite(result) ? result : NaN;
};

// --- Cosinor (plain JS, pre-BigNumber from commit 64fdb08) ---

plain.evaluateModel = function (t, params, N) {
	let result = params[0];
	for (let i = 0; i < N; i++) {
		result += params[1 + 3 * i] * Math.cos(params[2 + 3 * i] * t + params[3 + 3 * i]);
	}
	result += params[params.length - 1];
	return result;
};

plain.computeResidualsAndJacobian = function (t, x, params, N) {
	const m = t.length, n = params.length;
	const residuals = new Array(m);
	const jacobian = Array.from({ length: m }, () => new Array(n));
	for (let i = 0; i < m; i++) {
		const predicted = plain.evaluateModel(t[i], params, N);
		residuals[i] = x[i] - predicted;
		jacobian[i][0] = -1;
		for (let j = 0; j < N; j++) {
			const B = params[1 + 3 * j], w = params[2 + 3 * j], o = params[3 + 3 * j];
			const cosArg = w * t[i] + o;
			const sinArg = Math.sin(cosArg), cosValue = Math.cos(cosArg);
			jacobian[i][1 + 3 * j] = -cosValue;
			jacobian[i][2 + 3 * j] = B * t[i] * sinArg;
			jacobian[i][3 + 3 * j] = B * sinArg;
		}
		jacobian[i][n - 1] = -1;
	}
	return { residuals, jacobian };
};

plain.transpose = function (matrix) {
	return matrix[0].map((_, i) => matrix.map((row) => row[i]));
};

plain.multiplyMatrices = function (A, B) {
	const result = Array.from({ length: A.length }, () => new Array(B[0].length));
	for (let i = 0; i < A.length; i++) {
		for (let j = 0; j < B[0].length; j++) {
			let sum = 0;
			for (let k = 0; k < A[0].length; k++) sum += A[i][k] * B[k][j];
			result[i][j] = sum;
		}
	}
	return result;
};

plain.multiplyMatrixVector = function (A, b) {
	return A.map((row) => {
		let sum = 0;
		for (let i = 0; i < row.length; i++) sum += row[i] * b[i];
		return sum;
	});
};

plain.solveLinearSystem = function (A, b) {
	const n = A.length;
	const augmented = A.map((row, i) => [...row, b[i]]);
	for (let i = 0; i < n; i++) {
		let maxRow = i;
		for (let k = i + 1; k < n; k++) {
			if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) maxRow = k;
		}
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
		if (Math.abs(augmented[i][i]) < 1e-12) throw new Error('Matrix is singular');
		for (let k = i + 1; k < n; k++) {
			const factor = augmented[k][i] / augmented[i][i];
			for (let j = i; j < n + 1; j++) augmented[k][j] -= factor * augmented[i][j];
		}
	}
	const solution = new Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let sum = augmented[i][n];
		for (let j = i + 1; j < n; j++) sum -= augmented[i][j] * solution[j];
		solution[i] = sum / augmented[i][i];
	}
	return solution;
};

plain.fitCosinor = function (t, x, N, initialParams, maxIterations = 1000, tolerance = 1e-6) {
	let params = [...initialParams];
	let lambda = 0.01;
	let prevError = Infinity;
	for (let iter = 0; iter < maxIterations; iter++) {
		const { residuals, jacobian } = plain.computeResidualsAndJacobian(t, x, params, N);
		let currentError = 0;
		for (let i = 0; i < residuals.length; i++) currentError += residuals[i] * residuals[i];
		if (Math.abs(prevError - currentError) < tolerance) break;
		const JtJ = plain.multiplyMatrices(plain.transpose(jacobian), jacobian);
		const JtR = plain.multiplyMatrixVector(plain.transpose(jacobian), residuals);
		for (let i = 0; i < JtJ.length; i++) JtJ[i][i] += lambda;
		try {
			const delta = plain.solveLinearSystem(JtJ, JtR);
			for (let i = 0; i < params.length; i++) params[i] -= delta[i];
			for (let i = 0; i < N; i++) {
				const freqIdx = 2 + 3 * i;
				params[freqIdx] = Math.max(0.01, Math.min(params[freqIdx], 100));
			}
			if (currentError < prevError) lambda *= 0.9;
			else lambda *= 10;
			prevError = currentError;
		} catch (e) { break; }
	}
	const { residuals } = plain.computeResidualsAndJacobian(t, x, params, N);
	let rss = 0;
	for (let i = 0; i < residuals.length; i++) rss += residuals[i] * residuals[i];
	return { params, rmse: Math.sqrt(rss / t.length), rss, residuals };
};


// ============================================================================
// BIGNUMBER IMPLEMENTATIONS (from current codebase)
// ============================================================================

const bn = {};

// --- CDFs (BigNumber) ---

bn.bisection = function (f, x1, x2, releps, abseps) {
	var sign = function (z) {
		const zBN = new BigNumber(z);
		if (zBN.isGreaterThan(0)) return 1;
		else if (zBN.isLessThan(0)) return -1;
		else return 0;
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
		if (fx * f1 > 0) { x1 = x.toNumber(); f1 = sign(fx); }
		else { x2 = x.toNumber(); f2 = sign(fx); }
		x = new BigNumber(x1).plus(x2).dividedBy(2);
		fx = f(x.toNumber());
	}
	return x.toNumber();
};

bn.gamnln = function (n) {
	var lg = [
		0.5723649429247001, 0, -0.1207822376352452, 0, 0.2846828704729192,
		0.6931471805599453, 1.200973602347074, 1.791759469228055, 2.453736570842442,
		3.178053830347946, 3.957813967618717, 4.787491742782046, 5.662562059857142,
		6.579251212010101, 7.534364236758733, 8.525161361065415, 9.549267257300997,
		10.60460290274525, 11.68933342079727, 12.80182748008147, 13.94062521940376,
		15.10441257307552, 16.29200047656724, 17.50230784587389, 18.73434751193645,
		19.98721449566188, 21.2600761562447, 22.55216385312342, 23.86276584168909,
		25.19122118273868, 26.53691449111561, 27.89927138384089, 29.27775451504082,
		30.67186010608068, 32.08111489594736, 33.50507345013689, 34.94331577687682,
		36.39544520803305, 37.86108650896109, 39.3398841871995, 40.8315009745308,
		42.33561646075349, 43.85192586067515, 45.3801388984769, 46.91997879580877,
		48.47118135183522, 50.03349410501914, 51.60667556776437, 53.19049452616927,
		54.78472939811231, 56.38916764371993, 58.00360522298051, 59.62784609588432,
		61.26170176100199, 62.9049908288765, 64.55753862700632, 66.21917683354901,
		67.88974313718154, 69.56908092082364, 71.257038967168, 72.9534711841694,
		74.65823634883016, 76.37119786778275, 78.09222355331531, 79.82118541361436,
		81.55795945611503, 83.30242550295004, 85.05446701758153, 86.81397094178108,
		88.58082754219767, 90.35493026581838, 92.13617560368709, 93.92446296229978,
		95.71969454214322, 97.52177522288821, 99.33061245478741, 101.1461161558646,
		102.9681986145138, 104.7967743971583, 106.6317602606435, 108.4730750690654,
		110.3206397147574, 112.1743770431779, 114.0342117814617, 115.9000704704145,
		117.7718813997451, 119.6495745463449, 121.5330815154387, 123.4223354844396,
		125.3172711493569, 127.2178246736118, 129.1239336391272, 131.0355369995686,
		132.9525750356163, 134.8749893121619, 136.8027226373264, 138.7357190232026,
		140.6739236482343, 142.617282821146, 144.5657439463449, 146.5192554907206,
		148.477766951773, 150.4412288270019, 152.4095925844974, 154.3828106346716,
		156.3608363030788, 158.3436238042692, 160.3311282166309, 162.3233054581712,
		164.3201122631952, 166.3215061598404, 168.3274454484277, 170.3378891805928,
		172.3527971391628, 174.3721298187452, 176.3958484069973, 178.4239147665485,
		180.4562914175438, 182.4929415207863, 184.5338288614495, 186.5789178333379,
		188.6281734236716, 190.6815611983747, 192.7390472878449, 194.8005983731871,
		196.86618167289, 198.9357649299295, 201.0093163992815, 203.0868048358281,
		205.1681994826412, 207.2534700596299, 209.3425867525368, 211.435520202271,
		213.5322414945632, 215.6327221499328, 217.7369341139542, 219.8448497478113,
		221.9564418191303, 224.0716834930795, 226.1905483237276, 228.3130102456502,
		230.4390435657769, 232.5686229554685, 234.7017234428182, 236.8383204051684,
		238.9783895618343, 241.121906967029, 243.2688490029827, 245.4191923732478,
		247.5729140961868, 249.7299914986334, 251.8904022097232, 254.0541241548883,
		256.2211355500095, 258.3914148957209, 260.5649409718632, 262.7416928320802,
		264.9216497985528, 267.1047914568685, 269.2910976510198, 271.4805484785288,
		273.6731242856937, 275.8688056629533, 278.0675734403662, 280.2694086832001,
		282.4742926876305, 284.6822069765408, 286.893133295427, 289.1070536083976,
		291.3239500942703, 293.5438051427607, 295.7666013507606, 297.9923215187034,
		300.2209486470141, 302.4524659326413, 304.6868567656687, 306.9241047260048,
		309.1641935801469, 311.4071072780187, 313.652829949879, 315.9013459032995,
		318.1526396202093, 320.4066957540055, 322.6634991267262, 324.9230347262869,
		327.1852877037753, 329.4502433708053, 331.7178871969285, 333.9882048070999,
		336.2611819791985, 338.5368046415996, 340.815058870799, 343.0959308890863,
		345.3794070622669, 347.6654738974312, 349.9541180407703, 352.245326275435,
		354.5390855194408, 356.835382823613, 359.1342053695754
	];
	if (n < 201) return new BigNumber(lg[n - 1]);
	var coef = [76.18009172947146, -86.50532032941677, 24.01409824083091,
		-1.231739572450155, 1.208650973866179e-3, -5.395239384953e-6];
	const stp = new BigNumber(2.5066282746310005);
	const x = new BigNumber(n).times(0.5);
	var y = x;
	var tmp = x.plus(5.5);
	tmp = x.plus(0.5).times(BigNumber.ln(tmp)).minus(tmp);
	var ser = new BigNumber(1.000000000190015);
	for (var i = 0; i < 6; i++) { y = y.plus(1); ser = ser.plus(new BigNumber(coef[i]).dividedBy(y)); }
	return tmp.plus(BigNumber.ln(stp.times(ser).dividedBy(x)));
};

bn.gser = function (n, x) {
	const maxit = 100000000, eps = new BigNumber(1e-8);
	const gln = bn.gamnln(n);
	const a = new BigNumber(n).times(0.5);
	var ap = a, sum = new BigNumber(1).dividedBy(a), del = sum;
	const xBN = new BigNumber(x);
	for (var i = 1; i < maxit; i++) {
		ap = ap.plus(1); del = del.times(xBN).dividedBy(ap); sum = sum.plus(del);
		if (del.isLessThan(sum.times(eps))) break;
	}
	return sum.times(BigNumber.exp(xBN.negated().plus(a.times(BigNumber.ln(xBN))).minus(gln).toNumber())).toNumber();
};

bn.gcf = function (n, x) {
	const maxit = 100000000, eps = new BigNumber(1e-8);
	const gln = bn.gamnln(n);
	const a = new BigNumber(n).times(0.5);
	const xBN = new BigNumber(x);
	var b = xBN.plus(1).minus(a);
	const fpmin = new BigNumber(1e-300);
	var c = new BigNumber(1).dividedBy(fpmin), d = new BigNumber(1).dividedBy(b), h = d;
	for (var i = 1; i < maxit; i++) {
		const an = new BigNumber(-i).times(new BigNumber(i).minus(a));
		b = b.plus(2); d = an.times(d).plus(b);
		if (BigNumber.abs(d).isLessThan(fpmin)) d = fpmin;
		c = b.plus(an.dividedBy(c));
		if (BigNumber.abs(c).isLessThan(fpmin)) c = fpmin;
		d = new BigNumber(1).dividedBy(d);
		const del = d.times(c); h = h.times(del);
		if (BigNumber.abs(del.minus(1)).isLessThan(eps)) break;
	}
	return h.times(BigNumber.exp(xBN.negated().plus(a.times(BigNumber.ln(xBN))).minus(gln).toNumber())).toNumber();
};

bn.gammp = function (n, x) {
	return x < 0.5 * n + 1 ? bn.gser(n, x) : 1 - bn.gcf(n, x);
};

bn.gammq = function (n, x) {
	return x < 0.5 * n + 1 ? 1 - bn.gser(n, x) : bn.gcf(n, x);
};

bn.pchisq = function (chi2, n, ptype = 1) {
	const chi2BN = new BigNumber(chi2);
	return ptype === 1 ? bn.gammq(n, chi2BN.times(0.5).toNumber()) : bn.gammp(n, chi2BN.times(0.5).toNumber());
};

bn.qchisq = function (p, n, ptype = 1) {
	const pBN = new BigNumber(p);
	if (ptype === 1) { if (pBN.isEqualTo(0)) return 1 / 0; if (pBN.isEqualTo(1)) return 0; }
	if (ptype === 2) { if (pBN.isEqualTo(0)) return 0; if (pBN.isEqualTo(1)) return 1 / 0; }
	var eps = 1e-6;
	var min = 0;
	const sd = BigNumber.sqrt(new BigNumber(2.0).times(n).toNumber());
	var max = sd.times(2).toNumber();
	var s = ptype === 2 ? -1 : 1;
	while (s * bn.pchisq(max, n, ptype) > p * s) {
		min = max; max = new BigNumber(max).plus(sd.times(2)).toNumber();
	}
	var fun = function (x) { return bn.pchisq(x, n, ptype) - p; };
	return bn.bisection(fun, min, max, eps, 0);
};

// --- Periodogram methods (BigNumber) ---

bn.lombScargle = function (times, values, frequencies) {
	if (!times || !values || times.length < 2 || values.length < 2 || times.length !== values.length) {
		return new Array(frequencies.length).fill(NaN);
	}
	const validIndices = times.map((t, i) => (isNaN(t) || isNaN(values[i]) ? -1 : i)).filter((i) => i !== -1);
	const t = validIndices.map((i) => times[i]);
	const y = validIndices.map((i) => values[i]);
	if (t.length === 0) return new Array(frequencies.length).fill(0);
	const yMean = mean(y);

	let yVarianceBN = new BigNumber(0);
	for (let i = 0; i < y.length; i++) {
		const diff = new BigNumber(y[i]).minus(yMean);
		yVarianceBN = yVarianceBN.plus(diff.times(diff));
	}
	yVarianceBN = yVarianceBN.dividedBy(y.length - 1);

	return frequencies.map((f) => {
		const omega = 2 * Math.PI * f;
		let cosSum = new BigNumber(0), sinSum = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			cosSum = cosSum.plus(Math.cos(omega * t[i]));
			sinSum = sinSum.plus(Math.sin(omega * t[i]));
		}
		const tau = Math.atan2(sinSum.toNumber(), cosSum.toNumber()) / (2 * omega);

		let cosTerm = new BigNumber(0), sinTerm = new BigNumber(0);
		for (let i = 0; i < y.length; i++) {
			const yDiff = new BigNumber(y[i]).minus(yMean);
			cosTerm = cosTerm.plus(yDiff.times(Math.cos(omega * (t[i] - tau))));
			sinTerm = sinTerm.plus(yDiff.times(Math.sin(omega * (t[i] - tau))));
		}

		let cosDenom = new BigNumber(0), sinDenom = new BigNumber(0);
		for (let i = 0; i < t.length; i++) {
			const cosVal = Math.cos(omega * (t[i] - tau));
			const sinVal = Math.sin(omega * (t[i] - tau));
			cosDenom = cosDenom.plus(new BigNumber(cosVal).times(cosVal));
			sinDenom = sinDenom.plus(new BigNumber(sinVal).times(sinVal));
		}

		const term1 = cosTerm.times(cosTerm).dividedBy(cosDenom);
		const term2 = sinTerm.times(sinTerm).dividedBy(sinDenom);
		return term1.plus(term2).dividedBy(yVarianceBN.times(2)).toNumber();
	});
};

bn.enright = function (times, values, periods, binSize) {
	if (!times || !values || times.length < 2 || values.length < 2) {
		return new Array(periods.length).fill(NaN);
	}
	const binnedData = binData(times, values, binSize, 0);
	if (binnedData.bins.length === 0) return new Array(periods.length).fill(0);
	const data = binnedData.y_out;
	const n = data.length;
	const dataMean = mean(data.filter((v) => !isNaN(v)));
	const centeredData = data.map((v) => (isNaN(v) ? 0 : v - dataMean));
	return periods.map((period) => {
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
					correlation = correlation.plus(new BigNumber(centeredData[i]).times(centeredData[i + lag]));
					validPairs++;
				}
			}
			if (validPairs > 0) { qp = qp.plus(correlation.dividedBy(validPairs)); count++; }
		}
		if (count > 0) qp = qp.dividedBy(count);
		let variance = new BigNumber(0);
		for (let i = 0; i < centeredData.length; i++) {
			if (!isNaN(centeredData[i])) variance = variance.plus(new BigNumber(centeredData[i]).times(centeredData[i]));
		}
		variance = variance.dividedBy(n);
		return variance.isGreaterThan(0) ? qp.dividedBy(variance).toNumber() : 0;
	});
};

bn.chiSquared = function (data, binSize, period, avgAll, denominator) {
	const colNum = Math.round(period / binSize);
	if (colNum < 1) return NaN;
	const rowNum = Math.ceil(data.length / colNum);
	let colSums = new Array(colNum).fill(0).map(() => new BigNumber(0));
	let colCounts = new Array(colNum).fill(0);
	for (let i = 0; i < data.length; i++) {
		const col = i % colNum;
		if (!isNaN(data[i])) { colSums[col] = colSums[col].plus(data[i]); colCounts[col]++; }
	}
	const avgAllBN = new BigNumber(avgAll);
	const avgP = colSums.map((sum, i) => colCounts[i] > 0 ? sum.dividedBy(colCounts[i]) : avgAllBN);
	let numSum = new BigNumber(0);
	for (let i = 0; i < colNum; i++) {
		const diff = avgP[i].minus(avgAllBN);
		numSum = numSum.plus(diff.times(diff));
	}
	const result = numSum.times(data.length).times(rowNum).dividedBy(denominator);
	return result.isFinite() ? result.toNumber() : NaN;
};

// --- Cosinor (BigNumber) ---

bn.evaluateModel = function (t, params, N) {
	let result = params[0];
	for (let i = 0; i < N; i++) {
		result += params[1 + 3 * i] * Math.cos(params[2 + 3 * i] * t + params[3 + 3 * i]);
	}
	result += params[params.length - 1];
	return result;
};

bn.computeResidualsAndJacobian = function (t, x, params, N) {
	const m = t.length, n = params.length;
	const residuals = new Array(m);
	const jacobian = Array.from({ length: m }, () => new Array(n));
	for (let i = 0; i < m; i++) {
		const predicted = bn.evaluateModel(t[i], params, N);
		const residual = new BigNumber(x[i]).minus(predicted);
		residuals[i] = residual.toNumber();
		jacobian[i][0] = -1;
		for (let j = 0; j < N; j++) {
			const B = new BigNumber(params[1 + 3 * j]);
			const w = new BigNumber(params[2 + 3 * j]);
			const o = new BigNumber(params[3 + 3 * j]);
			const cosArg = w.times(t[i]).plus(o);
			const sinArg = Math.sin(cosArg.toNumber());
			const cosValue = Math.cos(cosArg.toNumber());
			jacobian[i][1 + 3 * j] = -cosValue;
			jacobian[i][2 + 3 * j] = B.times(t[i]).times(sinArg).toNumber();
			jacobian[i][3 + 3 * j] = B.times(sinArg).toNumber();
		}
		jacobian[i][n - 1] = -1;
	}
	return { residuals, jacobian };
};

bn.transpose = function (matrix) {
	return matrix[0].map((_, i) => matrix.map((row) => row[i]));
};

bn.multiplyMatrices = function (A, B) {
	const result = Array.from({ length: A.length }, () => new Array(B[0].length));
	for (let i = 0; i < A.length; i++) {
		for (let j = 0; j < B[0].length; j++) {
			let sum = new BigNumber(0);
			for (let k = 0; k < A[0].length; k++) sum = sum.plus(new BigNumber(A[i][k]).times(B[k][j]));
			result[i][j] = sum.toNumber();
		}
	}
	return result;
};

bn.multiplyMatrixVector = function (A, b) {
	return A.map((row) => {
		let sum = new BigNumber(0);
		for (let i = 0; i < row.length; i++) sum = sum.plus(new BigNumber(row[i]).times(b[i]));
		return sum.toNumber();
	});
};

bn.solveLinearSystem = function (A, b) {
	const n = A.length;
	const augmented = A.map((row, i) => [...row.map((val) => new BigNumber(val)), new BigNumber(b[i])]);
	for (let i = 0; i < n; i++) {
		let maxRow = i;
		for (let k = i + 1; k < n; k++) {
			if (augmented[k][i].abs().isGreaterThan(augmented[maxRow][i].abs())) maxRow = k;
		}
		[augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
		if (augmented[i][i].abs().isLessThan(1e-12)) throw new Error('Matrix is singular');
		for (let k = i + 1; k < n; k++) {
			const factor = augmented[k][i].dividedBy(augmented[i][i]);
			for (let j = i; j < n + 1; j++) augmented[k][j] = augmented[k][j].minus(factor.times(augmented[i][j]));
		}
	}
	const solution = new Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let sum = augmented[i][n];
		for (let j = i + 1; j < n; j++) sum = sum.minus(augmented[i][j].times(solution[j]));
		solution[i] = sum.dividedBy(augmented[i][i]).toNumber();
	}
	return solution;
};

bn.fitCosinor = function (t, x, N, initialParams, maxIterations = 1000, tolerance = 1e-6) {
	let params = [...initialParams];
	let lambda = 0.01;
	let prevError = new BigNumber(Infinity);
	for (let iter = 0; iter < maxIterations; iter++) {
		const { residuals, jacobian } = bn.computeResidualsAndJacobian(t, x, params, N);
		let currentError = new BigNumber(0);
		for (let i = 0; i < residuals.length; i++) {
			const r = new BigNumber(residuals[i]);
			currentError = currentError.plus(r.times(r));
		}
		const errorDiff = prevError.minus(currentError).abs();
		if (errorDiff.isLessThan(tolerance)) break;
		const JtJ = bn.multiplyMatrices(bn.transpose(jacobian), jacobian);
		const JtR = bn.multiplyMatrixVector(bn.transpose(jacobian), residuals);
		for (let i = 0; i < JtJ.length; i++) JtJ[i][i] += lambda;
		try {
			const delta = bn.solveLinearSystem(JtJ, JtR);
			for (let i = 0; i < params.length; i++) params[i] -= delta[i];
			for (let i = 0; i < N; i++) {
				const freqIdx = 2 + 3 * i;
				params[freqIdx] = Math.max(0.01, Math.min(params[freqIdx], 100));
			}
			if (currentError.isLessThan(prevError)) lambda *= 0.9;
			else lambda *= 10;
			prevError = currentError;
		} catch (e) { break; }
	}
	const { residuals } = bn.computeResidualsAndJacobian(t, x, params, N);
	let rss = new BigNumber(0);
	for (let i = 0; i < residuals.length; i++) {
		const r = new BigNumber(residuals[i]);
		rss = rss.plus(r.times(r));
	}
	return { params, rmse: rss.dividedBy(t.length).sqrt().toNumber(), rss: rss.toNumber(), residuals };
};


// ============================================================================
// STRESS-TEST DATA GENERATORS
// ============================================================================

function seededRandom(seed) {
	let state = seed;
	return function () {
		state = (state * 1103515245 + 12345) % 2 ** 31;
		return state / 2 ** 31;
	};
}

function generateCosineData(n, period, amplitude, offset, noiseLevel, seed = 42) {
	const rng = seededRandom(seed);
	const t = [];
	const x = [];
	const freq = (2 * Math.PI) / period;
	for (let i = 0; i < n; i++) {
		t.push(i * 0.1);  // 0.1 hour steps
		x.push(offset + amplitude * Math.cos(freq * i * 0.1) + noiseLevel * (rng() - 0.5));
	}
	return { t, x };
}

// ============================================================================
// COMPARISON AND REPORTING
// ============================================================================

function compareArrays(a, b) {
	if (a.length !== b.length) return { error: `Length mismatch: ${a.length} vs ${b.length}` };
	let maxAbsDiff = 0, maxRelDiff = 0, sumAbsDiff = 0;
	let maxAbsIdx = -1, maxRelIdx = -1;
	let numDiffs = 0;
	for (let i = 0; i < a.length; i++) {
		if (isNaN(a[i]) && isNaN(b[i])) continue;
		if (isNaN(a[i]) || isNaN(b[i])) { numDiffs++; continue; }
		const absDiff = Math.abs(a[i] - b[i]);
		const denom = Math.max(Math.abs(a[i]), Math.abs(b[i]), 1e-300);
		const relDiff = absDiff / denom;
		sumAbsDiff += absDiff;
		if (absDiff > maxAbsDiff) { maxAbsDiff = absDiff; maxAbsIdx = i; }
		if (relDiff > maxRelDiff) { maxRelDiff = relDiff; maxRelIdx = i; }
		if (absDiff > 1e-15) numDiffs++;
	}
	return {
		maxAbsDiff,
		maxRelDiff,
		meanAbsDiff: sumAbsDiff / a.length,
		numDiffs,
		maxAbsIdx,
		maxRelIdx,
		sampleSize: a.length
	};
}

function compareScalars(a, b, label) {
	if (isNaN(a) && isNaN(b)) return { label, diff: 0, relDiff: 0, plain: a, bn: b };
	const diff = Math.abs(a - b);
	const denom = Math.max(Math.abs(a), Math.abs(b), 1e-300);
	return { label, diff, relDiff: diff / denom, plain: a, bn: b };
}

function formatSci(n) {
	if (n === 0) return '0';
	return n.toExponential(4);
}

function printSectionHeader(title) {
	console.log('\n' + '='.repeat(80));
	console.log(`  ${title}`);
	console.log('='.repeat(80));
}

function printArrayComparison(label, result) {
	if (result.error) {
		console.log(`  ${label}: ERROR - ${result.error}`);
		return;
	}
	const flag = result.maxRelDiff > 1e-10 ? ' <<<' : '';
	console.log(`  ${label}:`);
	console.log(`    Samples: ${result.sampleSize} | Diffs > 1e-15: ${result.numDiffs}`);
	console.log(`    Max abs diff: ${formatSci(result.maxAbsDiff)} (at idx ${result.maxAbsIdx})`);
	console.log(`    Max rel diff: ${formatSci(result.maxRelDiff)} (at idx ${result.maxRelIdx})${flag}`);
	console.log(`    Mean abs diff: ${formatSci(result.meanAbsDiff)}`);
}


// ============================================================================
// TEST CASES
// ============================================================================

function runAllTests() {
	console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
	console.log('║       BigNumber vs Plain JavaScript — Head-to-Head Comparison               ║');
	console.log('╚══════════════════════════════════════════════════════════════════════════════╝');

	const summaryRows = [];

	// -----------------------------------------------------------------------
	// TEST 1: CDF Functions
	// -----------------------------------------------------------------------
	printSectionHeader('TEST 1: Chi-squared CDF functions (pchisq / qchisq)');

	// 1a: Standard chi-squared values
	const chiTestCases = [
		{ chi2: 3.84, n: 2, label: 'typical (3.84, df=2)' },
		{ chi2: 0.001, n: 2, label: 'tiny chi2 (0.001, df=2)' },
		{ chi2: 100, n: 50, label: 'large (100, df=50)' },
		{ chi2: 500, n: 200, label: 'very large (500, df=200)' },
		{ chi2: 0.0001, n: 100, label: 'extreme small (0.0001, df=100)' },
		{ chi2: 1000, n: 400, label: 'extreme large (1000, df=400)' },
		{ chi2: 50, n: 96, label: 'period=24h bins (50, df=96)' },
	];

	console.log('\n  pchisq comparisons:');
	for (const tc of chiTestCases) {
		const p = plain.pchisq(tc.chi2, tc.n);
		const b = bn.pchisq(tc.chi2, tc.n);
		const comp = compareScalars(p, b, tc.label);
		const flag = comp.relDiff > 1e-10 ? ' <<<' : '';
		console.log(`    ${tc.label}: plain=${formatSci(p)} bn=${formatSci(b)} relDiff=${formatSci(comp.relDiff)}${flag}`);
		summaryRows.push({ test: `pchisq ${tc.label}`, relDiff: comp.relDiff });
	}

	// 1b: qchisq inverse
	const qchiTestCases = [
		{ p: 0.05, n: 10, label: 'standard (p=0.05, df=10)' },
		{ p: 0.001, n: 50, label: 'small p (p=0.001, df=50)' },
		{ p: 0.95, n: 96, label: 'large p (p=0.95, df=96)' },
		{ p: 0.0001, n: 200, label: 'extreme (p=0.0001, df=200)' },
	];

	console.log('\n  qchisq comparisons:');
	for (const tc of qchiTestCases) {
		const p = plain.qchisq(tc.p, tc.n);
		const b = bn.qchisq(tc.p, tc.n);
		const comp = compareScalars(p, b, tc.label);
		const flag = comp.relDiff > 1e-10 ? ' <<<' : '';
		console.log(`    ${tc.label}: plain=${formatSci(p)} bn=${formatSci(b)} relDiff=${formatSci(comp.relDiff)}${flag}`);
		summaryRows.push({ test: `qchisq ${tc.label}`, relDiff: comp.relDiff });
	}

	// -----------------------------------------------------------------------
	// TEST 2: Lomb-Scargle Periodogram
	// -----------------------------------------------------------------------
	printSectionHeader('TEST 2: Lomb-Scargle Periodogram');

	const lsTests = [
		{
			label: '2a. Normal signal (100 pts, period=24h)',
			data: generateCosineData(100, 24, 5, 10, 0.5, 42),
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '2b. Large dataset (10000 pts, period=24h)',
			data: generateCosineData(10000, 24, 5, 10, 0.5, 42),
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '2c. Tiny amplitude on huge baseline (catastrophic cancellation)',
			data: generateCosineData(1000, 24, 1e-8, 1e6, 1e-9, 42),
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '2d. High frequency, long span (precision in trig args)',
			data: generateCosineData(5000, 1.5, 3, 0, 0.1, 42),
			periods: makeSeqArray(0.5, 5, 0.1)
		},
		{
			label: '2e. Very noisy signal (SNR << 1)',
			data: generateCosineData(2000, 24, 0.1, 0, 10, 42),
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '2f. Multiple periods superimposed',
			data: (() => {
				const rng = seededRandom(42);
				const t = [], x = [];
				for (let i = 0; i < 3000; i++) {
					t.push(i * 0.1);
					x.push(
						5 * Math.cos(2 * Math.PI / 24 * i * 0.1) +
						2 * Math.cos(2 * Math.PI / 12 * i * 0.1) +
						1 * Math.cos(2 * Math.PI / 8 * i * 0.1) +
						0.5 * (rng() - 0.5)
					);
				}
				return { t, x };
			})(),
			periods: makeSeqArray(1, 48, 0.25)
		}
	];

	for (const test of lsTests) {
		const frequencies = test.periods.map((p) => 1 / p);
		const t0 = performance.now();
		const plainResult = plain.lombScargle(test.data.t, test.data.x, frequencies);
		const t1 = performance.now();
		const bnResult = bn.lombScargle(test.data.t, test.data.x, frequencies);
		const t2 = performance.now();
		const comp = compareArrays(plainResult, bnResult);
		console.log(`\n  ${test.label}`);
		console.log(`    Plain: ${(t1 - t0).toFixed(1)}ms | BigNumber: ${(t2 - t1).toFixed(1)}ms (${((t2 - t1) / (t1 - t0)).toFixed(1)}x slower)`);
		printArrayComparison('Power values', comp);
		summaryRows.push({ test: `LS: ${test.label.split('.')[1]?.trim() || test.label}`, relDiff: comp.maxRelDiff });
	}

	// -----------------------------------------------------------------------
	// TEST 3: Chi-Squared Periodogram
	// -----------------------------------------------------------------------
	printSectionHeader('TEST 3: Chi-Squared Periodogram');

	const chiPeriodTests = [
		{
			label: '3a. Normal signal (500 pts, period=24h)',
			data: generateCosineData(500, 24, 5, 10, 0.5, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.25)
		},
		{
			label: '3b. Large dataset (5000 pts)',
			data: generateCosineData(5000, 24, 5, 10, 0.5, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.25)
		},
		{
			label: '3c. Tiny amplitude, large offset (cancellation stress)',
			data: generateCosineData(2000, 24, 1e-6, 1e4, 1e-7, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.25)
		}
	];

	for (const test of chiPeriodTests) {
		const binnedData = binData(test.data.t, test.data.x, test.binSize, 0);
		const data = binnedData.y_out;
		const avgAll = mean(data);

		// Plain denominator
		let denomPlain = 0;
		for (let i = 0; i < data.length; i++) {
			if (!isNaN(data[i])) denomPlain += (data[i] - avgAll) ** 2;
		}
		// BN denominator
		let denomBN = new BigNumber(0);
		for (let i = 0; i < data.length; i++) {
			if (!isNaN(data[i])) {
				const diff = new BigNumber(data[i]).minus(avgAll);
				denomBN = denomBN.plus(diff.times(diff));
			}
		}

		const plainPowers = test.periods.map((p) => plain.chiSquared(data, test.binSize, p, avgAll, denomPlain));
		const bnPowers = test.periods.map((p) => bn.chiSquared(data, test.binSize, p, avgAll, denomBN.toNumber()));

		const comp = compareArrays(plainPowers, bnPowers);
		console.log(`\n  ${test.label}`);
		printArrayComparison('Chi-sq power values', comp);

		// Also compare thresholds and p-values
		const alpha = 0.05;
		const correctedAlpha = Math.pow(1 - alpha, 1 / test.periods.length);
		const plainThresholds = test.periods.map((p) => plain.qchisq(1 - correctedAlpha, Math.round(p / test.binSize)));
		const bnThresholds = test.periods.map((p) => bn.qchisq(1 - correctedAlpha, Math.round(p / test.binSize)));
		const threshComp = compareArrays(plainThresholds, bnThresholds);
		printArrayComparison('Thresholds (qchisq)', threshComp);

		const plainPvals = plainPowers.map((pow, i) => 1 - plain.pchisq(pow, Math.round(test.periods[i] / test.binSize)));
		const bnPvals = bnPowers.map((pow, i) => 1 - bn.pchisq(pow, Math.round(test.periods[i] / test.binSize)));
		const pvalComp = compareArrays(plainPvals, bnPvals);
		printArrayComparison('P-values', pvalComp);

		summaryRows.push({ test: `ChiSq: ${test.label.split('.')[1]?.trim() || test.label}`, relDiff: comp.maxRelDiff });
	}

	// -----------------------------------------------------------------------
	// TEST 4: Enright Periodogram
	// -----------------------------------------------------------------------
	printSectionHeader('TEST 4: Enright Periodogram');

	const enrightTests = [
		{
			label: '4a. Normal signal (1000 pts, period=24h)',
			data: generateCosineData(1000, 24, 5, 10, 0.5, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '4b. Large dataset (8000 pts)',
			data: generateCosineData(8000, 24, 5, 10, 0.5, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.5)
		},
		{
			label: '4c. Tiny amplitude stress',
			data: generateCosineData(3000, 24, 1e-7, 1e5, 1e-8, 42),
			binSize: 0.25,
			periods: makeSeqArray(1, 48, 0.5)
		}
	];

	for (const test of enrightTests) {
		const t0 = performance.now();
		const plainResult = plain.enright(test.data.t, test.data.x, test.periods, test.binSize);
		const t1 = performance.now();
		const bnResult = bn.enright(test.data.t, test.data.x, test.periods, test.binSize);
		const t2 = performance.now();
		const comp = compareArrays(plainResult, bnResult);
		console.log(`\n  ${test.label}`);
		console.log(`    Plain: ${(t1 - t0).toFixed(1)}ms | BigNumber: ${(t2 - t1).toFixed(1)}ms (${((t2 - t1) / (t1 - t0)).toFixed(1)}x slower)`);
		printArrayComparison('Enright power values', comp);
		summaryRows.push({ test: `Enright: ${test.label.split('.')[1]?.trim() || test.label}`, relDiff: comp.maxRelDiff });
	}

	// -----------------------------------------------------------------------
	// TEST 5: Cosinor Fitting
	// -----------------------------------------------------------------------
	printSectionHeader('TEST 5: Cosinor Fitting (Levenberg-Marquardt)');

	const cosinorTests = [
		{
			label: '5a. Clean single cosine (N=1)',
			data: generateCosineData(200, 24, 5, 10, 0.1, 42),
			N: 1,
			initialParams: [0, 5, 2 * Math.PI / 24, 0, 10]
		},
		{
			label: '5b. Noisy signal (N=1)',
			data: generateCosineData(500, 24, 5, 10, 5, 42),
			N: 1,
			initialParams: [0, 4, 2 * Math.PI / 24, 0.1, 9]
		},
		{
			label: '5c. Large dataset near-degenerate (N=2, similar frequencies)',
			data: (() => {
				const rng = seededRandom(42);
				const t = [], x = [];
				for (let i = 0; i < 1000; i++) {
					t.push(i * 0.1);
					x.push(
						3 * Math.cos(2 * Math.PI / 24 * i * 0.1) +
						2.9 * Math.cos(2 * Math.PI / 23.5 * i * 0.1) +
						10 + 0.5 * (rng() - 0.5)
					);
				}
				return { t, x };
			})(),
			N: 2,
			initialParams: [0, 3, 2 * Math.PI / 24, 0, 3, 2 * Math.PI / 23.5, 0, 10]
		},
		{
			label: '5d. Tiny amplitude on huge baseline (cancellation in residuals)',
			data: generateCosineData(300, 24, 1e-6, 1e6, 1e-7, 42),
			N: 1,
			initialParams: [0, 1e-6, 2 * Math.PI / 24, 0, 1e6]
		}
	];

	for (const test of cosinorTests) {
		const t0 = performance.now();
		const plainResult = plain.fitCosinor(test.data.t, test.data.x, test.N, test.initialParams, 500);
		const t1 = performance.now();
		const bnResult = bn.fitCosinor(test.data.t, test.data.x, test.N, test.initialParams, 500);
		const t2 = performance.now();

		console.log(`\n  ${test.label}`);
		console.log(`    Plain: ${(t1 - t0).toFixed(1)}ms | BigNumber: ${(t2 - t1).toFixed(1)}ms (${((t2 - t1) / (t1 - t0)).toFixed(1)}x slower)`);

		// Compare parameters
		const paramComp = compareArrays(plainResult.params, bnResult.params);
		printArrayComparison('Fitted parameters', paramComp);

		// Compare RMSE
		const rmseComp = compareScalars(plainResult.rmse, bnResult.rmse, 'RMSE');
		const rmseFlag = rmseComp.relDiff > 1e-10 ? ' <<<' : '';
		console.log(`    RMSE: plain=${formatSci(rmseComp.plain)} bn=${formatSci(rmseComp.bn)} relDiff=${formatSci(rmseComp.relDiff)}${rmseFlag}`);

		// Compare residuals
		const resComp = compareArrays(plainResult.residuals, bnResult.residuals);
		printArrayComparison('Residuals', resComp);

		summaryRows.push({ test: `Cosinor: ${test.label.split('.')[1]?.trim() || test.label}`, relDiff: paramComp.maxRelDiff });
	}

	// -----------------------------------------------------------------------
	// SUMMARY
	// -----------------------------------------------------------------------
	printSectionHeader('SUMMARY');
	console.log('\n  Test                                                    Max Rel Diff    Significant?');
	console.log('  ' + '-'.repeat(86));
	for (const row of summaryRows) {
		const sig = row.relDiff > 1e-10 ? 'YES' : (row.relDiff > 1e-15 ? 'marginal' : 'no');
		const name = row.test.padEnd(56);
		console.log(`  ${name} ${formatSci(row.relDiff).padStart(14)}    ${sig}`);
	}

	console.log('\n  Legend: "Significant?" = max relative difference > 1e-10');
	console.log('  "<<<" markers in detailed output highlight individual results > 1e-10\n');
}

// Run all tests
runAllTests();
