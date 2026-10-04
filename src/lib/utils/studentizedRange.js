// @ts-check
/**
 * The studentized range distribution: the distribution of Q = (max - min of k
 * independent N(mu, sigma^2) variables) / S, where nu * S^2 / sigma^2 ~ chi2(nu)
 * independently. It gives the p-values and critical values of Tukey's HSD and
 * the Tukey-Kramer test for unequal group sizes.
 *
 * Definition (the double integral scipy.stats.studentized_range evaluates):
 *
 *   P(Q <= q) = integral over s > 0 of g_nu(s) * W_k(q s) ds
 *   W_k(w)    = k * integral over z of phi(z) * [Phi(z) - Phi(z - w)]^(k-1) dz
 *
 * where W_k is the CDF of the range of k standard normals (the largest is z, the
 * other k - 1 lie in (z - w, z]) and g_nu is the density of S = sqrt(chi2_nu / nu):
 *
 *   g_nu(s) = nu^(nu/2) s^(nu-1) exp(-nu s^2 / 2) / (Gamma(nu/2) 2^(nu/2 - 1)).
 *
 * The UPPER tail is what a test needs, and 1 - P(Q <= q) cancels to nothing once
 * the p-value drops below about 1e-15 (scipy's own sf is 1 - cdf with an absolute
 * tolerance of 1e-11). Here it is integrated directly. Because
 * k * integral of phi(z) Phi(z)^(k-1) dz = 1, and a^m - b^m = (a - b) * sum of
 * a^i b^(m-1-i), with a = Phi(z), b = Phi(z) - Phi(z - w), a - b = Phi(z - w):
 *
 *   1 - W_k(w) = k * integral of phi(z) Phi(z - w) * sum_{i=0}^{k-2} a^i b^(k-2-i) dz
 *
 * Every term is non-negative, so small tails keep their relative accuracy.
 * Both integrals use adaptive Gauss-Kronrod (7-15) quadrature.
 *
 * Checks (studentizedRange.test.js): scipy.stats.studentized_range.sf and .ppf
 * where scipy is accurate, and for any p the exact identity for k = 2,
 * P(Q > q) = 2 * P(T_nu > q / sqrt(2)).
 */
import gammaln from '@stdlib/math-base-special-gammaln';
import erfc from '@stdlib/math-base-special-erfc';

const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

/**
 * The normal tail P(Z > |x|) = erfc(|x| / sqrt 2) / 2, accurate in the far tail.
 * The inner integral calls this a few hundred thousand times per post-hoc, so it
 * uses stdlib's erfc (a rational approximation good to about 1 ulp) rather than
 * the incomplete-gamma series in chisqSf, which gives the same value about ten
 * times more slowly.
 */
function halfTail(x) {
	return 0.5 * erfc(Math.abs(x) * Math.SQRT1_2);
}

// Gauss-Kronrod 7-15 nodes and weights (the QUADPACK QK15 rule), as doubles.
// Checked in studentizedRange.test.js: the 7 Gauss points match
// numpy.polynomial.legendre.leggauss(7), and the 15-point rule is exact for
// polynomials up to degree 22.
export const XGK = [
	0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945,
	0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0
];
export const WGK = [
	0.022935322010529224, 0.06309209262997856, 0.10479001032225019, 0.14065325971552592,
	0.1690047266392679, 0.19035057806478542, 0.20443294007529889, 0.20948214108472782
];
export const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

/**
 * One GK15 panel on [a, b]: { value, error }. The error estimate is QUADPACK's
 * (QK15): |K - G| scaled as resasc * min(1, (200 |K - G| / resasc)^1.5), where
 * resasc measures the integrand's variation over the panel. Plain |K - G| bounds
 * the 7-point Gauss value, not the far more accurate 15-point Kronrod one, and
 * kept subdividing panels that had already converged.
 */
function gk15(f, a, b) {
	const c = 0.5 * (a + b);
	const h = 0.5 * (b - a);
	const fc = f(c);
	const f1 = new Array(7);
	const f2 = new Array(7);
	let kron = fc * WGK[7];
	let gauss = fc * WG[3];
	for (let j = 0; j < 7; j++) {
		const dx = h * XGK[j];
		f1[j] = f(c - dx);
		f2[j] = f(c + dx);
		const s = f1[j] + f2[j];
		kron += WGK[j] * s;
		if (j % 2 === 1) gauss += WG[(j - 1) / 2] * s;
	}
	const mean = 0.5 * kron;
	let asc = WGK[7] * Math.abs(fc - mean);
	for (let j = 0; j < 7; j++) asc += WGK[j] * (Math.abs(f1[j] - mean) + Math.abs(f2[j] - mean));
	const resasc = asc * Math.abs(h);
	let error = Math.abs((kron - gauss) * h);
	if (resasc !== 0 && error !== 0) error = resasc * Math.min(1, ((200 * error) / resasc) ** 1.5);
	return { value: kron * h, error };
}

/**
 * Adaptive GK15 over consecutive panels [pts[0], pts[1]], ..., bisecting the
 * panel with the largest error estimate until the total error is within
 * relTol of the total (or maxPanels is reached). The estimate is conservative on
 * these smooth integrands: at relTol = 1e-7 the tails agree with the references
 * in the tests to better than 1e-9 relative (2e-13 against the exact k = 2 t tail).
 */
function integrate(f, pts, relTol = 1e-7, maxPanels = 400) {
	const panels = [];
	for (let i = 0; i + 1 < pts.length; i++) {
		if (pts[i + 1] > pts[i])
			panels.push({ a: pts[i], b: pts[i + 1], ...gk15(f, pts[i], pts[i + 1]) });
	}
	for (;;) {
		let total = 0;
		let err = 0;
		let worst = 0;
		for (let i = 0; i < panels.length; i++) {
			total += panels[i].value;
			err += panels[i].error;
			if (panels[i].error > panels[worst].error) worst = i;
		}
		if (err <= relTol * Math.abs(total) || err === 0 || panels.length >= maxPanels) return total;
		const { a, b } = panels[worst];
		const m = 0.5 * (a + b);
		panels.splice(worst, 1, { a, b: m, ...gk15(f, a, m) }, { a: m, b, ...gk15(f, m, b) });
	}
}

/** 1 - W_k(w): the upper tail of the range of k standard normals. */
function rangeSf(w, k) {
	if (!(w > 0)) return 1;
	const m = k - 2;
	const integrand = (z) => {
		const lphi = -0.5 * z * z - LN_SQRT_2PI;
		if (lphi < -745) return 0;
		// Each tail comes from one halfTail call, so Phi(z), Phi(z - w) and their
		// difference are all formed without subtracting two numbers near 1.
		const u = z - w;
		const hz = halfTail(z);
		const hu = halfTail(u);
		const tail = u >= 0 ? 1 - hu : hu; // Phi(z - w)
		if (tail === 0) return 0;
		const a = z >= 0 ? 1 - hz : hz; // Phi(z)
		const b = u >= 0 ? hu - hz : z <= 0 ? hz - hu : 1 - hz - hu; // Phi(z) - Phi(z - w)
		// sum_{i=0}^{m} a^i b^(m-i), built up as S_(j+1) = b S_j + a^(j+1).
		let sum = 1;
		let ap = 1;
		for (let i = 0; i < m; i++) {
			ap *= a;
			sum = sum * b + ap;
		}
		return Math.exp(lphi) * tail * sum;
	};
	// Where the integrand lives: phi(z) carries it for small w (|z| < 8.5 keeps all
	// but 1e-16 of it), and for large w phi(z) Phi(z - w) is a bump of variance 1/2
	// at z = w/2 (6.5 either side keeps all but about e^-40 of it). Start from
	// panels about 2 wide, on which GK15 is already accurate for these shapes.
	const c = w / 2;
	const lo = Math.min(-8.5, c - 6.5);
	const hi = Math.max(8.5, c + 6.5);
	const nPanels = Math.ceil((hi - lo) / 2);
	const pts = [];
	for (let i = 0; i <= nPanels; i++) pts.push(lo + ((hi - lo) * i) / nPanels);
	return Math.min(1, k * integrate(integrand, pts));
}

/**
 * Upper tail P(Q > q) of the studentized range with k means and df degrees of
 * freedom (df = Infinity gives the range of k standard normals). Matches
 * scipy.stats.studentized_range.sf(q, k, df) and R's
 * ptukey(q, k, df, lower.tail = FALSE), and stays accurate for tiny p.
 * @param {number} q
 * @param {number} k Number of means (> 1).
 * @param {number} df Error degrees of freedom (> 0).
 * @returns {number}
 */
export function studentizedRangeSf(q, k, df) {
	if (!Number.isFinite(k) || k < 2 || !(df > 0) || Number.isNaN(q)) return NaN;
	if (q <= 0) return 1;
	if (q === Infinity) return 0;
	// The same post-hoc is asked for by the Group Comparison node and by a box
	// plot's significance table, and again on every rerun with unchanged data, so
	// remember recent exact (q, k, df) answers rather than redo the double integral.
	const key = `${q}|${k}|${df}`;
	const hit = sfCache.get(key);
	if (hit !== undefined) return hit;
	const p = df === Infinity ? rangeSf(q, k) : finiteDfSf(q, k, df);
	if (sfCache.size >= SF_CACHE_SIZE) sfCache.delete(sfCache.keys().next().value);
	sfCache.set(key, p);
	return p;
}

const SF_CACHE_SIZE = 2048;
const sfCache = new Map();

function finiteDfSf(q, k, df) {
	const nu = df;
	const logConst = (nu / 2) * Math.log(nu) - gammaln(nu / 2) - (nu / 2 - 1) * Math.LN2;
	const logG = (s) => logConst + (nu - 1) * Math.log(s) - (nu * s * s) / 2;
	const integrand = (s) => {
		if (s <= 0) return nu === 1 ? Math.exp(logConst) : 0;
		const lg = logG(s);
		if (lg < -745) return 0;
		return Math.exp(lg) * rangeSf(q * s, k);
	};
	// g_nu peaks at mode = sqrt((nu - 1) / nu) with spread about 1 / sqrt(2 nu).
	// Integrate to where it has fallen by e^-60 from the peak; small-p mass
	// comes from small s, which the panels from 0 up to the mode cover.
	const mode = nu > 1 ? Math.sqrt((nu - 1) / nu) : 0;
	const sigma = 1 / Math.sqrt(2 * nu);
	const logPeak = nu > 1 ? logG(mode) : logConst;
	let hi = Math.max(mode, 1) + sigma;
	while (logG(hi) - logPeak > -60) hi += sigma;
	const pts = [0, mode / 4, mode / 2, mode, mode + 2 * sigma, mode + 5 * sigma, hi].filter(
		(x) => x <= hi
	);
	const sorted = [...new Set(pts)].sort((x, y) => x - y);
	return Math.min(1, Math.max(0, integrate(integrand, sorted)));
}

/**
 * Brent's root finder (bracketing with inverse quadratic interpolation and
 * secant steps, falling back to bisection) for f on [a, b] with f(a), f(b) of
 * opposite sign.
 */
function brentRoot(f, a, b, fa, fb, xtol) {
	let c = a;
	let fc = fa;
	let d = b - a;
	let e = d;
	for (let iter = 0; iter < 100; iter++) {
		if (fb * fc > 0) {
			c = a;
			fc = fa;
			d = e = b - a;
		}
		if (Math.abs(fc) < Math.abs(fb)) {
			a = b;
			b = c;
			c = a;
			fa = fb;
			fb = fc;
			fc = fa;
		}
		const tol = 2 * Number.EPSILON * Math.abs(b) + 0.5 * xtol;
		const m = 0.5 * (c - b);
		if (Math.abs(m) <= tol || fb === 0) return b;
		if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
			let p;
			let q;
			const s = fb / fa;
			if (a === c) {
				p = 2 * m * s;
				q = 1 - s;
			} else {
				const qq = fa / fc;
				const r = fb / fc;
				p = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
				q = (qq - 1) * (r - 1) * (s - 1);
			}
			if (p > 0) q = -q;
			else p = -p;
			if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) {
				e = d;
				d = p / q;
			} else {
				d = m;
				e = d;
			}
		} else {
			d = m;
			e = d;
		}
		a = b;
		fa = fb;
		b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
		fb = f(b);
	}
	return b;
}

/**
 * Quantile of the studentized range: the q with P(Q <= q) = p (scipy's ppf,
 * R's qtukey). Solved on the log of the upper tail, so the critical value for a
 * small alpha is as accurate as the tail itself.
 * @param {number} p Lower-tail probability in (0, 1).
 * @param {number} k
 * @param {number} df
 * @returns {number}
 */
export function studentizedRangeQuantile(p, k, df) {
	if (!(p > 0 && p < 1) || !Number.isFinite(k) || k < 2 || !(df > 0)) return NaN;
	// A post-hoc needs the same critical value for every pair and every rerun, and
	// each costs a root-find, so keep the few a session uses.
	const key = `${p}|${k}|${df}`;
	const hit = quantileCache.get(key);
	if (hit !== undefined) return hit;
	const q = solveQuantile(p, k, df);
	if (quantileCache.size >= 64) quantileCache.clear();
	quantileCache.set(key, q);
	return q;
}

const quantileCache = new Map();

function solveQuantile(p, k, df) {
	const logTarget = Math.log1p(-p);
	const f = (q) => Math.log(studentizedRangeSf(q, k, df)) - logTarget;
	let lo = 0;
	let flo = -logTarget; // log(1) - logTarget > 0
	let hi = 4;
	let fhi = f(hi);
	while (fhi > 0) {
		lo = hi;
		flo = fhi;
		hi *= 2;
		if (hi > 1e6) return Infinity;
		fhi = f(hi);
	}
	return brentRoot(f, lo, hi, flo, fhi, 1e-13 * hi);
}
