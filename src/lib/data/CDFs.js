// @ts-nocheck
//========================================================================
// Adapted from https://github.com/ytliu0/p-value_calculators/blob/master/statFunctions.js
//
// This js file contains functions to compute
//  * the standard normal distribution CDF: pnorm()
//  * the chi-square distribution CDF: pchisq()
//  * the t-ditribution CDF: pt()
//  * the F-distribution CDF: pf()
//  * the inverse of the above CDFs: qnorm(), qchisq(), qt(), qf()
//
// Several auxiliary functions are needed (n, m are positive integers)
//  * bisection(): find the root of f(x)=0 using the method of bisection
//                   (used to calculate the inverse of the CDFs)
//  * ln(Gamma(n/2)):  gamnln()
//  * incomplete gamma function P(n/2,x): gammp()
//  * incomplete gamma function Q(n/2,x): gammq()
//  * incomplete beta function I_x(n/2,m/2): betai()
//========================================================================

// Find the root of f(x)=0 using the method of bisection.
// f: function with one argument.
// x1 and x2 are real numbers such that x1 < x2 and f(x1)*f(x2) < 0.
// Warning: won't check if conditions about x1 and x2 are satisfied.
// They bracket the root, and are updated inside the function.
// releps sets the relative accuracy of the root: the relative accuracy
//         condition is satisfied if (x2-x1) < releps*|x|
// abseps sets the absolute accuracy of the root: the absolute accuracy condition
//         is satisfied if (x2-x1) < abseps or |f(x)| < abseps
// The function returns x when the relative accuracy condition OR the absolute
//         accuracy condition is satisfied.

import BigNumber from 'bignumber.js';

// Configure BigNumber for high precision
BigNumber.config({
	DECIMAL_PLACES: 50,
	ROUNDING_MODE: BigNumber.ROUND_HALF_UP
});

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

// p-value for normal distribution: equivalent to R's pnorm(-z):
// pnorm(z) = 1-F_{normal}(z), where F_{normal} is the cdf of the
//   normal distribution.
// This function calculates the p-value with a relative error < 1.2e-7
export function pnorm(z) {
	const zBN = new BigNumber(z);
	const x = new BigNumber(Math.SQRT1_2).times(BigNumber.abs(zBN));

	// compute erfc(x) using an approximation formula (max rel error = 1.2e-7)
	// see https://en.wikipedia.org/wiki/Error_function#Numerical_approximation
	const t = new BigNumber(1).dividedBy(new BigNumber(1).plus(new BigNumber(0.5).times(x)));
	const t2 = t.times(t);
	const t3 = t2.times(t);
	const t4 = t2.times(t2);
	const t5 = t2.times(t3);
	const t6 = t3.times(t3);
	const t7 = t3.times(t4);
	const t8 = t4.times(t4);
	const t9 = t4.times(t5);

	const tau = x
		.times(x)
		.negated()
		.minus(1.26551223)
		.plus(new BigNumber(1.00002368).times(t))
		.plus(new BigNumber(0.37409196).times(t2))
		.plus(new BigNumber(0.09678418).times(t3))
		.minus(new BigNumber(0.18628806).times(t4))
		.plus(new BigNumber(0.27886807).times(t5))
		.minus(new BigNumber(1.13520398).times(t6))
		.plus(new BigNumber(1.48851587).times(t7))
		.minus(new BigNumber(0.82215223).times(t8))
		.plus(new BigNumber(0.17087277).times(t9));

	const p = new BigNumber(0.5).times(t).times(BigNumber.exp(tau.toNumber()));

	if (zBN.isLessThan(0)) {
		return new BigNumber(1).minus(p).toNumber();
	}

	return p.toNumber();
}

// inverse of pnorm
// z from right-tail p: same as R's qnorm(p, lower.tail=FALSE)
// Use bisection to find z.
// Relative accuracy are set by the parameter eps
export function qnorm(p) {
	const pBN = new BigNumber(p);

	if (pBN.isEqualTo(0.5)) {
		return 0;
	}

	if (pBN.isLessThan(1e-300) || pBN.isGreaterThan(new BigNumber(1).minus(3e-16))) {
		return 1 / 0;
	}

	// Set relative accuracy parameter
	var eps = 1e-6;

	var pval = p;
	if (pBN.isGreaterThan(0.5)) {
		pval = new BigNumber(1).minus(pBN).toNumber();
	}

	// Start bisection search...
	const sqrt_2pioe = new BigNumber(1.520346901066281);
	const min_arg = new BigNumber(2).times(pval).times(sqrt_2pioe);
	var minz = 0.0;
	if (min_arg.isLessThan(1.0)) {
		minz = new BigNumber(0.99).times(BigNumber.sqrt(min_arg.negated().ln().toNumber())).toNumber();
	}
	const maxz = new BigNumber(1.01)
		.times(
			BigNumber.sqrt(new BigNumber(-2).times(BigNumber.ln(new BigNumber(2).times(pval))).toNumber())
		)
		.toNumber();

	var fun = function (z) {
		return pnorm(z) - pval;
	};
	var z = bisection(fun, minz, maxz, eps, 0);
	if (pBN.isGreaterThan(0.5)) {
		z = -z;
	}
	return z;
}

// Returns ln(Gamma(n/2)) for n=1,2,...
// Warning: won't check the argument
function gamnln(n) {
	// Tabulated values of ln(Gamma(n/2)) for n<201
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

	// For n>200, use the approx. formula given by numerical recipe
	// relative error < 2e-10
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

// Returns the incomplete gamma function P(n/2,x) evaluated by
// series representation. Algorithm from numerical recipe.
// Assume that n is a positive integer and x>0, won't check arguments.
// Relative error controlled by the eps parameter
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

// Returns the incomplete gamma function Q(n/2,x) evaluated by
// its continued fraction representation. Algorithm from numerical recipe.
// Assume that n is a postive integer and x>0, won't check arguments.
// Relative error controlled by the eps parameter
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

// Returns the incomplete Gamma function P(n/2,x)
// Assume n is a positive integer, x>0 , won't check arguments
function gammp(n, x) {
	if (x < 0.5 * n + 1) {
		return gser(n, x);
	} else {
		return 1 - gcf(n, x);
	}
}

// Returns the incomplete Gamma function Q(n/2,x)
// Assume n is a positive integer, x>0 , won't check arguments
function gammq(n, x) {
	if (x < 0.5 * n + 1) {
		return 1 - gser(n, x);
	} else {
		return gcf(n, x);
	}
}

// Evaluates incomplete beta function by modified Lentz's method
// Algorithm from numerical recipe
function betacf(a, b, x) {
	const maxit = 100000000;
	const aBN = new BigNumber(a);
	const bBN = new BigNumber(b);
	const xBN = new BigNumber(x);
	const qab = aBN.plus(bBN);
	const qap = aBN.plus(1.0);
	const qam = aBN.minus(1.0);
	var c = new BigNumber(1.0);
	var d = new BigNumber(1).minus(qab.times(xBN).dividedBy(qap));
	const fpmin = new BigNumber(1e-300);
	const eps = new BigNumber(1e-8);

	if (BigNumber.abs(d).isLessThan(fpmin)) {
		d = fpmin;
	}
	d = new BigNumber(1.0).dividedBy(d);
	var h = d;

	for (var m = 1; m < maxit; m++) {
		const m2 = 2 * m;
		var aa = new BigNumber(m)
			.times(bBN.minus(m))
			.times(xBN)
			.dividedBy(qam.plus(m2).times(aBN.plus(m2)));
		d = new BigNumber(1).plus(aa.times(d));
		if (BigNumber.abs(d).isLessThan(fpmin)) {
			d = fpmin;
		}
		c = new BigNumber(1).plus(aa.dividedBy(c));
		if (BigNumber.abs(c).isLessThan(fpmin)) {
			c = fpmin;
		}
		d = new BigNumber(1.0).dividedBy(d);
		h = h.times(d).times(c);

		aa = aBN
			.plus(m)
			.negated()
			.times(qab.plus(m))
			.times(xBN)
			.dividedBy(aBN.plus(m2).times(qap.plus(m2)));
		d = new BigNumber(1).plus(aa.times(d));
		if (BigNumber.abs(d).isLessThan(fpmin)) {
			d = fpmin;
		}
		c = new BigNumber(1).plus(aa.dividedBy(c));
		if (BigNumber.abs(c).isLessThan(fpmin)) {
			c = fpmin;
		}
		d = new BigNumber(1.0).dividedBy(d);
		const del = d.times(c);
		h = h.times(del);
		if (BigNumber.abs(del.minus(1.0)).isLessThan(eps)) {
			break;
		}
	}
	return h.toNumber();
}

// Returns the incomplete beta function I_x(n/2,m/2) for positive integers n and m
//     and 0<=x<=1
// Warning: won't check arguments
// Algorithm from numerical recipe
function betai(n, m, x) {
	const aBN = new BigNumber(n).times(0.5);
	const bBN = new BigNumber(m).times(0.5);
	const xBN = new BigNumber(x);

	var bt;
	if (xBN.isEqualTo(0) || xBN.isEqualTo(1)) {
		bt = new BigNumber(0);
	} else {
		const gln_sum = gamnln(m + n);
		const gln_n = gamnln(n);
		const gln_m = gamnln(m);
		bt = BigNumber.exp(
			gln_sum
				.minus(gln_n)
				.minus(gln_m)
				.plus(aBN.times(BigNumber.ln(xBN)))
				.plus(bBN.times(BigNumber.ln(new BigNumber(1).minus(xBN))))
				.toNumber()
		);
	}

	var beti;
	if (xBN.isLessThan(aBN.plus(1.0).dividedBy(aBN.plus(bBN).plus(2)))) {
		// use continued fraction directly
		beti = new BigNumber(bt).times(betacf(aBN.toNumber(), bBN.toNumber(), x)).dividedBy(aBN);
	} else {
		// use continued fraction after making the symmetry transformation
		beti = new BigNumber(1).minus(
			new BigNumber(bt)
				.times(betacf(bBN.toNumber(), aBN.toNumber(), new BigNumber(1).minus(xBN).toNumber()))
				.dividedBy(bBN)
		);
	}
	return beti.toNumber();
}

// p-value for chi^2 distribution
// When ptype=1: returns 1-F_{chi^2}(chi2; n)
// When ptype=2: returns the cdf F_{chi^2}(chi2; n)
// same as R's function pchisq(chi2,n,lower.tail=FALSE) for ptype = 1
// same as R's function pchisq(chi2,n) for ptype = 2
export function pchisq(chi2, n, ptype = 1) {
	const chi2BN = new BigNumber(chi2);
	if (ptype == 1) {
		return gammq(n, chi2BN.times(0.5).toNumber());
	} else {
		return gammp(n, chi2BN.times(0.5).toNumber());
	}
}

// inverse of pchisq
// same as R's function qchisq(p,n,lower.tail=FALSE) for ptype = 1
// same as R's function qchisq(p,n) for ptype = 2
// Assume that 0 <= p <= 1 and n is positive integer.
// Won't check arguments.
// Find root using bisection, relative accuracy set by eps
export function qchisq(p, n, ptype = 1) {
	const pBN = new BigNumber(p);

	// Special cases
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

	// bracket the root
	var min = 0;
	const sd = BigNumber.sqrt(new BigNumber(2.0).times(n).toNumber());
	var max = sd.times(2).toNumber();
	var s = 1;
	if (ptype == 2) {
		s = -1;
	}
	// pchisq is decreasing for ptype=1, increasing for ptype=2
	while (s * pchisq(max, n, ptype) > p * s) {
		min = max;
		max = new BigNumber(max).plus(sd.times(2)).toNumber();
	}

	var fun = function (x) {
		return pchisq(x, n, ptype) - p;
	};

	return bisection(fun, min, max, eps, 0);
}

// ptype = 0: calculate P(<t) = F_t(t;n)
// ptype = 1: calculate P(>t) = 1 - F_t(t;n)
// ptype = 2: calculate P(>|t|) = 2[1-F_t(|t|;n)]
// ptype = 3: calculate P(<|t|) = 1 - 2[1-F_t(|t|;n)]
function pt(t, n, ptype) {
	const tBN = new BigNumber(t);
	const nBN = new BigNumber(n);
	const x = nBN.dividedBy(tBN.times(tBN).plus(nBN));
	var p = betai(n, 1, x.toNumber());

	if (ptype == 0) {
		if (tBN.isGreaterThan(0)) {
			p = 1 - 0.5 * p;
		} else {
			p = 0.5 * p;
		}
	} else if (ptype == 1) {
		if (tBN.isGreaterThan(0)) {
			p = 0.5 * p;
		} else {
			p = 1 - 0.5 * p;
		}
	} else if (ptype == 3) {
		p = 1 - p;
	}
	return p;
}

// inverse of pt
// ptype = 0: Calculate t so that P(<t) = p
// ptype = 1: Calculate t so that P(>t) = p
// ptype = 2: Calculate t so that P(>|t|) = p
// ptype = 3: Calculate t so that P(<|t|) = p
// Relative accuracy set by eps
function qt(p, n, ptype) {
	const pBN = new BigNumber(p);

	if (pBN.isEqualTo(0)) {
		if (ptype == 1 || ptype == 2) {
			return 1 / 0;
		} else if (ptype == 0) {
			return -1 / 0;
		} else {
			return 0;
		}
	}
	if (pBN.isEqualTo(1)) {
		if (ptype == 0 || ptype == 3) {
			return 1 / 0;
		} else if (ptype == 1) {
			return -1 / 0;
		} else {
			return 0;
		}
	}

	var eps = 1e-6;

	// Want to find t for which pt(t,n,ptype) = p. Turn it into the equation
	// pt(|t|,n,1) = p1.
	var p1 = p;
	if (ptype == 0 && pBN.isGreaterThan(0.5)) {
		p1 = new BigNumber(1).minus(pBN).toNumber();
	} else if (ptype == 1 && pBN.isGreaterThan(0.5)) {
		p1 = new BigNumber(1).minus(pBN).toNumber();
	} else if (ptype == 2) {
		p1 = new BigNumber(0.5).times(pBN).toNumber();
	} else if (ptype == 3) {
		p1 = new BigNumber(0.5).times(new BigNumber(1).minus(pBN)).toNumber();
	}

	// Find tmax and tmin to bracket t with pt(t,n,1) = p1
	const nBN = new BigNumber(n);
	var tmp = gamnln(n + 1)
		.minus(gamnln(n))
		.dividedBy(nBN)
		.plus(new BigNumber(0.5).minus(new BigNumber(1).dividedBy(nBN)).times(BigNumber.ln(nBN)));
	tmp = tmp
		.minus(BigNumber.ln(p1).dividedBy(nBN))
		.minus(new BigNumber(0.5).times(BigNumber.ln(Math.PI)).dividedBy(nBN));
	var tmax = BigNumber.exp(tmp.toNumber());
	var tmin = BigNumber.exp(
		tmp
			.minus(new BigNumber(0.5).plus(new BigNumber(0.5).dividedBy(nBN)).times(BigNumber.ln(2.0)))
			.toNumber()
	);

	if (tmin.times(tmin).isLessThan(nBN)) {
		tmp = BigNumber.exp(
			gamnln(n)
				.minus(gamnln(n + 1))
				.plus(new BigNumber(0.5).times(nBN.plus(1)).times(BigNumber.ln(2.0)))
				.toNumber()
		);
		tmp = tmp.times(p1).times(BigNumber.sqrt(nBN.times(Math.PI).toNumber()));
		tmin = BigNumber.sqrt(nBN.toNumber())
			.plus(BigNumber.sqrt(new BigNumber(1).dividedBy(nBN).toNumber()))
			.minus(tmp);
		tmin = BigNumber.max(tmin, 0);
	}

	if (pt(tmin.toNumber(), n, 1) < p1) {
		tmin = tmin.times(0.5);
		while (pt(tmin.toNumber(), n, 1) < p1) {
			tmin = tmin.times(0.5);
		}
	}
	if (pt(tmax.toNumber(), n, 1) > p1) {
		tmax = tmax.times(2);
		while (pt(tmax.toNumber(), n, 1) > p1) {
			tmax = tmax.times(2);
		}
	}

	// Find t using the bisection method
	var fun = function (x) {
		return pt(x, n, 1) - p1;
	};
	var t = bisection(fun, tmin.toNumber(), tmax.toNumber(), eps, 0);

	if ((ptype == 0 && pBN.isLessThan(0.5)) || (ptype == 1 && pBN.isGreaterThan(0.5))) {
		t = -t;
	}

	return t;
}

// ptype=1: compute P(>F, df1, df2) = 1-F_F(F; df1,df2)
// ptype=2: compute P(<F, df1,df2) = F_F(F; df1,df2)
// Assume df1 and df2 are positive integers, and F>=0 (won't check arguments)
function pf(F, df1, df2, ptype) {
	const FBN = new BigNumber(F);

	if (FBN.isEqualTo(0)) {
		if (ptype == 1) {
			return 1;
		} else {
			return 0;
		}
	}

	if (ptype == 1) {
		const x = new BigNumber(df2).dividedBy(new BigNumber(df1).times(FBN).plus(df2));
		return betai(df2, df1, x.toNumber());
	} else {
		const x = new BigNumber(df1).times(FBN).dividedBy(new BigNumber(df1).times(FBN).plus(df2));
		return betai(df1, df2, x.toNumber());
	}
}

// inverse of pf
// ptype=1: compute F s.t. P(>F, df1, df2) = p
// ptype=2: compute F s.t. P(<F, df1,df2) = p
// Assume df1 and df2 are positive integers, and 0<= p <=1 (won't change arguments)
// relative accuracy set by eps
function qf(p, d1, d2, ptype) {
	const pBN = new BigNumber(p);

	if (pBN.isEqualTo(0)) {
		if (ptype == 1) {
			return 1 / 0;
		} else {
			return 0;
		}
	}

	if (pBN.isEqualTo(1)) {
		if (ptype == 1) {
			return 0;
		} else {
			return 1 / 0;
		}
	}

	var eps = 1e-6;

	// Find lower and upper values to bracket the root for bisection search
	var Fmax;
	var Fmin;
	var s = 3 - 2 * ptype; // 1 or -1: p decreases or increases with F
	var f21 = new BigNumber(1.0);
	var p21 = pf(f21.toNumber(), d1, d2, ptype);

	if (s * pf(f21.toNumber(), d1, d2, ptype) > s * p) {
		Fmin = f21;
		Fmax = f21.times(2);
		while (s * pf(Fmax.toNumber(), d1, d2, ptype) > s * p) {
			Fmin = Fmax;
			Fmax = Fmax.times(2);
		}
	} else {
		Fmax = f21;
		Fmin = f21.times(0.5);
		while (s * pf(Fmin.toNumber(), d1, d2, ptype) <= s * p) {
			Fmax = Fmin;
			Fmin = Fmin.times(0.5);
		}
	}

	var fun = function (x) {
		return pf(x, d1, d2, ptype) - p;
	};

	return bisection(fun, Fmin.toNumber(), Fmax.toNumber(), eps, 0);
}
