"""
AnCiR Python runtime.

Direct ports of the JavaScript utility modules and process implementations
used by the AnCiR app. Used by ancir_to_python.py to produce stand-alone
analysis scripts from session.json files.

Numerical conventions follow the JS implementations exactly (Kahan
summation, multi-start LM with parameter clamping, Halberg cosinor OLS,
Lomb-Scargle / Chi-squared / Enright periodograms, radix-2 FFT, etc.).
"""

from __future__ import annotations

import functools
import math
import re
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy import optimize as sp_optimize
from scipy import stats as sp_stats


# ----------------------------------------------------------------------
# Numerics
# ----------------------------------------------------------------------

class KahanSum:
    def __init__(self):
        self.sum = 0.0
        self.c = 0.0

    def add(self, value):
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return
        y = value - self.c
        t = self.sum + y
        self.c = (t - self.sum) - y
        self.sum = t

    def value(self):
        return self.sum


def kahan_mean(data):
    s = KahanSum()
    n = 0
    for v in data:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        s.add(v)
        n += 1
    return s.value() / n if n > 0 else float('nan')


def make_seq_array(start, end, step):
    if step <= 0 or end < start:
        return []
    n = int(math.floor((end - start) / step + 1e-9)) + 1
    return [start + i * step for i in range(n)]


# ----------------------------------------------------------------------
# Stats helpers
# ----------------------------------------------------------------------

def _to_float_arr(seq):
    return np.array([np.nan if v is None else v for v in seq], dtype=float)


def mean_(data):
    arr = _to_float_arr(data)
    arr = arr[~np.isnan(arr)]
    return float(arr.mean()) if arr.size else float('nan')


def linear_regression(x, y):
    xa = _to_float_arr(x)
    ya = _to_float_arr(y)
    mask = ~(np.isnan(xa) | np.isnan(ya))
    xa, ya = xa[mask], ya[mask]
    n = xa.size
    if n < 2:
        return {'slope': 0.0, 'intercept': 0.0, 'rSquared': 0.0, 'rmse': 0.0}
    xmean, ymean = xa.mean(), ya.mean()
    sxx = ((xa - xmean) ** 2).sum()
    sxy = ((xa - xmean) * (ya - ymean)).sum()
    slope = sxy / sxx if sxx else 0.0
    intercept = ymean - slope * xmean
    fitted = slope * xa + intercept
    ss_tot = ((ya - ymean) ** 2).sum()
    ss_res = ((ya - fitted) ** 2).sum()
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    rmse = math.sqrt(ss_res / n)
    return {'slope': float(slope), 'intercept': float(intercept),
            'rSquared': float(r2), 'rmse': float(rmse)}


_BIN_EPSILON = 1e-10


def _bin_finite(v):
    """A usable binning value: a finite number. None, NaN and +/-inf are dropped.

    Matches the app's wrangleData.js binData, which drops missing values by the house rule
    (validPairs / isInvalidValue) and then non-finite ones. It used to filter with the GLOBAL
    `isFinite`, which coerces, so a null x or y read as 0 and was binned; that app bug was
    never copied here and is now fixed there (fixtures tp-binneddata-missing-*)."""
    if v is None or isinstance(v, bool):
        return False
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return math.isfinite(f)


def _bin_agg(agg_func, ys, start, end):
    """The app's per-bin aggregates (binData's aggFunctions), over ys[start:end] of the
    x-sorted values. An unknown name is the mean, as in the app."""
    k = end - start
    if agg_func == 'count':
        return k
    if agg_func in ('min', 'max'):
        if k == 0:
            return None  # the app's null for an empty bin
        return min(ys[start:end]) if agg_func == 'min' else max(ys[start:end])
    if agg_func == 'median':
        if k == 0:
            return float('nan')
        sl = sorted(ys[start:end])
        mid = k // 2
        return (sl[mid - 1] + sl[mid]) / 2 if k % 2 == 0 else sl[mid]
    if agg_func == 'stddev':
        if k < 2:
            return float('nan')  # sample SD undefined below two points (R sd() gives NA)
        mean = _bin_agg('mean', ys, start, end)
        sum_sq = 0.0
        for i in range(start, end):
            d = ys[i] - mean
            sum_sq += d * d
        return math.sqrt(sum_sq / (k - 1))  # SAMPLE standard deviation, as the app
    # mean (and any unknown name): a plain left-to-right sum, as the app's loop.
    if k == 0:
        return float('nan')
    tot = 0.0
    for i in range(start, end):
        tot += ys[i]
    return tot / k


def bin_data(x_values, y_values, bin_size, bin_start=0.0, step_size=None,
             agg_func='mean', cuts=None):
    """Port of plotbits/helpers/wrangleData.js::binData, both modes.

    Returns {'bins', 'bin_ends', 'y_out', 'dropped_count'} like the app's
    {bins, binEnds, y_out, droppedCount}. Pairs with a non-finite x or y are dropped and
    the rest sorted by x (stable, as the app's sort). Bin membership uses the app's 1e-10
    edge tolerance: a value within 1e-10 BELOW an edge belongs to the next bin.

    Uniform mode (cuts None or fewer than two edges): bins [start, start + bin_size) at
    start = bin_start + i * step (step = step_size when positive, else bin_size), and the
    loop pushes a bin THEN stops once its start reaches the last x, so there is one bin at
    or past the last datum.

    Cuts mode (`cuts`, strictly ascending; the caller sorts and dedupes): one bin per
    consecutive pair of edges, each [a, b) except the LAST, which is [a, b]. Values below
    the first edge or above the last are dropped (counted in dropped_count). A cuts list
    that is not strictly ascending gives no bins, as in the app."""
    empty = {'bins': [], 'bin_ends': [], 'y_out': [], 'dropped_count': 0}
    use_cuts = cuts is not None and len(cuts) >= 2
    x_values = list(x_values) if x_values is not None else []
    if not x_values:
        return empty
    if use_cuts:
        for i in range(1, len(cuts)):
            if not cuts[i] > cuts[i - 1]:
                return empty
    else:
        step = step_size if step_size is not None and step_size > 0 else bin_size
        if step is None or not step > 0 or not math.isfinite(step):
            return empty
    y_values = list(y_values) if y_values is not None else []
    paired = [(float(x), float(y_values[i])) for i, x in enumerate(x_values)
              if i < len(y_values) and _bin_finite(x) and _bin_finite(y_values[i])]
    paired.sort(key=lambda p: p[0])
    n = len(paired)
    if n == 0:
        return empty
    xs = [p[0] for p in paired]
    ys = [p[1] for p in paired]
    eps = _BIN_EPSILON

    if use_cuts:
        num_bins = len(cuts) - 1
        bins, bin_ends, y_out = [], [], []
        dropped = 0
        pointer = 0
        while pointer < n and xs[pointer] < cuts[0] - eps:
            pointer += 1
            dropped += 1
        for i in range(num_bins):
            bins.append(cuts[i])
            bin_ends.append(cuts[i + 1])
            start_idx = pointer
            end_idx = start_idx
            if i == num_bins - 1:
                while end_idx < n and xs[end_idx] <= cuts[i + 1] + eps:
                    end_idx += 1
            else:
                while end_idx < n and xs[end_idx] < cuts[i + 1] - eps:
                    end_idx += 1
            y_out.append(_bin_agg(agg_func, ys, start_idx, end_idx))
            pointer = end_idx
        dropped += n - pointer
        return {'bins': bins, 'bin_ends': bin_ends, 'y_out': y_out, 'dropped_count': dropped}

    bins, bin_ends, y_out = [], [], []
    dropped = 0
    current = bin_start
    bin_index = 0
    pointer = 0
    while pointer < n and xs[pointer] < current - eps:
        pointer += 1
        dropped += 1
    while True:
        b_end = current + bin_size
        bins.append(current)
        bin_ends.append(b_end)
        while pointer < n and xs[pointer] < current - eps:
            pointer += 1
        start_idx = pointer
        end_idx = start_idx
        while end_idx < n and xs[end_idx] < b_end - eps:
            end_idx += 1
        y_out.append(_bin_agg(agg_func, ys, start_idx, end_idx))
        if current >= xs[n - 1]:
            break
        bin_index += 1
        # From bin_start each time, not by accumulation, so the edges do not drift.
        current = bin_start + bin_index * step
    return {'bins': bins, 'bin_ends': bin_ends, 'y_out': y_out, 'dropped_count': dropped}


# ----------------------------------------------------------------------
# Cosinor (Halberg fixed-period + free multi-cosine LM)
# ----------------------------------------------------------------------

def acrophase_ci_determined(p_overall, p_harmonic, alpha, tcrit, se, period):
    """FIT-7, cosinor.js acrophaseCIDetermined: an acrophase CI only when the zero-amplitude
    test (the model's and the harmonic's own) is significant and 2 * t * SE is narrower than
    the harmonic's period. Bingham, Arbogast, Guillaume, Lee and Halberg (1982),
    Chronobiologia 9:397-439; Cornelissen (2014), Theor Biol Med Model 11:16."""
    if not (p_overall < alpha) or not (p_harmonic < alpha):
        return False
    return 2 * tcrit * se < period


def fit_cosinor_fixed(t, y, period=24.0, n_harmonics=1, alpha=0.05):
    t = _to_float_arr(t)
    y = _to_float_arr(y)
    mask = ~(np.isnan(t) | np.isnan(y))
    t, y = t[mask], y[mask]
    n = t.size
    if n < 2 * n_harmonics + 2:
        return None
    omega = 2 * math.pi / period
    cols = [np.ones(n)]
    for k in range(1, n_harmonics + 1):
        cols.append(np.cos(k * omega * t))
        cols.append(np.sin(k * omega * t))
    X = np.column_stack(cols)
    try:
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    except np.linalg.LinAlgError:
        return None
    fitted = X @ beta
    residuals = y - fitted
    p = X.shape[1]
    df_resid = n - p
    if df_resid <= 0:
        return None
    rss = float((residuals ** 2).sum())
    mse = rss / df_resid
    # sqrt(MSE), i.e. divided by the residual DF — matching the JS
    # (cosinor.js: `const RMSE = Math.sqrt(MSE)` with MSE = SSres/df_res), which
    # is the parity source of truth. Dividing by n instead gave a ~0.9% low RMSE
    # on a 168-point window; no fixture compared rmse until the rolling-cosinor
    # one, so the divergence had gone unnoticed.
    rmse = math.sqrt(mse)
    ss_tot = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0

    try:
        cov = mse * np.linalg.inv(X.T @ X)
    except np.linalg.LinAlgError:
        cov = np.zeros((p, p))

    M = float(beta[0])
    SE_M = math.sqrt(max(cov[0, 0], 0.0))
    tcrit = float(sp_stats.t.ppf(1 - alpha / 2, df_resid))
    CI_M = [M - tcrit * SE_M, M + tcrit * SE_M]

    # F-stat: H0 = mean only
    ss_null = float(((y - y.mean()) ** 2).sum())
    df1 = p - 1
    F_stat = ((ss_null - rss) / df1) / (rss / df_resid) if rss > 0 else float('inf')
    # Upper tail computed directly (fdist.js pUpperFromF): 1 - cdf rounds a tiny p to 0. The
    # p is taken at max(0, F), so a rounding-negative F gives p = 1; an infinite F gives 0.
    pF = (float(sp_stats.f.sf(max(0.0, F_stat), df1, df_resid)) if math.isfinite(F_stat)
          else (0.0 if F_stat == math.inf else float('nan')))

    harmonics = []
    for k in range(1, n_harmonics + 1):
        idx_b = 1 + 2 * (k - 1)
        idx_g = idx_b + 1
        b, g = float(beta[idx_b]), float(beta[idx_g])
        amp = math.hypot(b, g)
        phi = math.atan2(-g, b)  # JS: atan2(-gamma, beta)
        # Time of peak of harmonic k (h after t = 0) in [0, period/k): the one
        # acrophase convention (cosinor.js fitCosinorFixed).
        acro_hrs = (-phi / (k * omega)) % (period / k)
        var_b = max(cov[idx_b, idx_b], 0.0)
        var_g = max(cov[idx_g, idx_g], 0.0)
        cov_bg = cov[idx_b, idx_g]
        # delta-method SE for amplitude
        if amp > 0:
            SE_A = math.sqrt(max((b * b * var_b + g * g * var_g
                                  + 2 * b * g * cov_bg) / (amp * amp), 0.0))
        else:
            SE_A = 0.0
        denom = (b * b + g * g)
        if denom > 0:
            var_phi = (g * g * var_b + b * b * var_g
                       - 2 * b * g * cov_bg) / (denom * denom)
            SE_phi = math.sqrt(max(var_phi, 0.0))
        else:
            SE_phi = 0.0
        SE_acro_hrs = SE_phi / (k * omega)
        # This harmonic's own zero-amplitude test (beta_k = gamma_k = 0), the Wald F
        # b' V^-1 b / 2 on (2, df_resid); with one harmonic it is pF (cosinor.js).
        det_v = var_b * var_g - cov_bg ** 2
        F_k = ((b * b * var_g - 2 * b * g * cov_bg + g * g * var_b) / det_v / 2
               if det_v > 0 else float('nan'))
        pF_k = (float(sp_stats.f.sf(max(0.0, F_k), 2, df_resid)) if math.isfinite(F_k)
                else float('nan'))
        # FIT-7: no acrophase CI when the rhythm is not detectable or the interval spans a
        # full cycle (Bingham et al. 1982; Cornelissen 2014). cosinor.js acrophaseCIDetermined.
        if acrophase_ci_determined(pF, pF_k, alpha, tcrit, SE_acro_hrs, period / k):
            ci_acro = [acro_hrs - tcrit * SE_acro_hrs, acro_hrs + tcrit * SE_acro_hrs]
        else:
            ci_acro = [float('nan'), float('nan')]
        harmonics.append({
            'k': k, 'beta': b, 'gamma': g,
            'amplitude': amp, 'acrophase_hrs': acro_hrs,
            'phi_rad': phi, 'SE_A': SE_A, 'SE_acrophase_hrs': SE_acro_hrs,
            # Lower end clamped at 0 (an amplitude is non-negative), as in the JS.
            'CI_A': [max(0.0, amp - tcrit * SE_A), amp + tcrit * SE_A],
            'CI_acrophase': ci_acro,
            'pF': pF_k,
        })

    return {
        'M': M, 'SE_M': SE_M, 'CI_M': CI_M,
        'harmonics': harmonics, 'F_stat': float(F_stat),
        'df': [df1, df_resid], 'pF': pF,
        'R2': float(r2), 'RMSE': rmse,
        'fitted': fitted.tolist(), 'n': n,
        'period': period, 'nHarmonics': n_harmonics, 'alpha': alpha,
    }


# Free-period cosinor: bounded period range, periodogram-seeded starts.
# Mirrors src/lib/utils/cosinor.js (FREE_PERIOD_DEFAULTS, resolvePeriodRange,
# scanPeriodogram, buildStarts, fitCosineCurves). Without a bound the fit used to
# follow a trend out to its internal frequency clamp (6,283 h in the JS, 1,000 h
# here) on real activity data, silently.
FREE_PERIOD_DEFAULTS = {'minPeriod': 1.0, 'maxPeriod': 48.0}
_SCAN_OVERSAMPLE = 4
_SCAN_MIN_FREQS = 64
_SCAN_MAX_FREQS = 5000
_SCAN_MAX_POINTS = 10000
_SCAN_PEAKS = 3
_BOUND_RTOL = 1e-6


def resolve_period_range(t, min_period=None, max_period=None):
    """[min, max] period the free fit may use (t units). Missing ends fall back to
    the Nyquist period (2 x median spacing) and the record span; the short end is
    never below Nyquist. None when the range is empty. Mirrors resolvePeriodRange."""
    ts = np.sort(np.asarray([v for v in _to_float_arr(t) if math.isfinite(v)], dtype=float))
    if ts.size < 2:
        return None
    span = float(ts[-1] - ts[0])
    diffs = np.diff(ts)
    diffs = diffs[diffs > 0]
    if not span > 0 or diffs.size == 0:
        return None
    nyquist = 2 * float(np.median(diffs))
    try:
        umin = float(min_period) if min_period is not None else float('nan')
    except (TypeError, ValueError):
        umin = float('nan')
    try:
        umax = float(max_period) if max_period is not None else float('nan')
    except (TypeError, ValueError):
        umax = float('nan')
    lo = max(umin, nyquist) if (math.isfinite(umin) and umin > 0) else nyquist
    hi = umax if (math.isfinite(umax) and umax > 0) else span
    if not hi > lo:
        return None
    return {'minPeriod': lo, 'maxPeriod': hi, 'nyquist': nyquist, 'span': span}


def scan_periodogram(t, x, min_period, max_period, n_peaks=_SCAN_PEAKS):
    """Floating-mean least-squares periodogram on a uniform frequency grid inside
    [min_period, max_period]; returns up to n_peaks local maxima (range ends
    included), strongest first, as cycles-per-unit frequencies. Mirrors
    scanPeriodogram (same grid, same scan-only binning of long records)."""
    t = _to_float_arr(t)
    x = _to_float_arr(x)
    m = np.isfinite(t) & np.isfinite(x)
    t, x = t[m], x[m]
    if t.size < 3:
        return []
    t_min, t_max = float(t.min()), float(t.max())
    span = t_max - t_min
    if not span > 0:
        return []
    if t.size > _SCAN_MAX_POINTS:
        w = min(span / _SCAN_MAX_POINTS, min_period / 8)
        nb = int(math.floor(span / w)) + 1
        b = np.minimum(nb - 1, np.floor((t - t_min) / w).astype(int))
        cnt = np.bincount(b, minlength=nb).astype(float)
        st = np.bincount(b, weights=t, minlength=nb)
        sx = np.bincount(b, weights=x, minlength=nb)
        keep = cnt > 0
        t = st[keep] / cnt[keep]
        x = sx[keep] / cnt[keep]
    n = t.size
    y = x - x.mean()
    tau = t - t_min
    f_lo, f_hi = 1.0 / max_period, 1.0 / min_period
    nf = min(_SCAN_MAX_FREQS,
             max(_SCAN_MIN_FREQS, int(math.ceil(_SCAN_OVERSAMPLE * span * (f_hi - f_lo))) + 1))
    freqs = f_lo + (f_hi - f_lo) * np.arange(nf) / (nf - 1)
    power = np.zeros(nf)
    chunk = max(1, 2_000_000 // max(n, 1))
    for a in range(0, nf, chunk):
        fr = freqs[a:a + chunk]
        arg = 2 * math.pi * np.outer(fr, tau)
        c = np.cos(arg)
        s_ = np.sin(arg)
        C = c.sum(1) / n
        S = s_.sum(1) / n
        CC = (c * c).sum(1) / n - C * C
        SS = (s_ * s_).sum(1) / n - S * S
        CS = (c * s_).sum(1) / n - C * S
        YC = (c @ y) / n
        YS = (s_ @ y) / n
        D = CC * SS - CS * CS
        with np.errstate(divide='ignore', invalid='ignore'):
            pw = (SS * YC * YC + CC * YS * YS - 2 * CS * YC * YS) / D
        power[a:a + chunk] = np.where(D > 1e-12, pw, 0.0)
    peaks = []
    for k in range(nf):
        left = -np.inf if k == 0 else power[k - 1]
        right = -np.inf if k == nf - 1 else power[k + 1]
        if power[k] >= left and power[k] > right:
            peaks.append(k)
    peaks.sort(key=lambda k: (-power[k], k))
    return [float(freqs[k]) for k in peaks[:n_peaks]]


def _cos_linear_init(t, x, freqs):
    """OLS amplitude/phase/offset at fixed frequencies (cycles/unit):
    a*cos + b*sin = B*cos(2*pi*w*t + o), B = hypot(a, b), o = atan2(-b, a)."""
    cols = [np.ones(t.size)]
    for w in freqs:
        th = 2 * math.pi * w * t
        cols += [np.cos(th), np.sin(th)]
    X = np.column_stack(cols)
    try:
        coef = np.linalg.solve(X.T @ X, X.T @ x)
    except np.linalg.LinAlgError:
        coef = None
    p0 = []
    for j, w in enumerate(freqs):
        if coef is not None:
            a, b = coef[2 * j + 1], coef[2 * j + 2]
            p0 += [float(math.hypot(a, b)), w, float(math.atan2(-b, a))]
        else:
            p0 += [0.0, w, 0.0]
    p0.append(float(coef[0]) if coef is not None else float(np.mean(x)))
    return p0


def fit_cosine_curves(t, x, n_curves, options=None):
    """Multi-cosine fit (free periods/phases). Param layout: [B0,w0,o0,...,O],
    w in cycles per t unit, every period 1/w kept inside the resolved range.

    scipy.optimize.least_squares (Trust Region Reflective, box bounds on w) from
    the same periodogram-peak starts as the JS Levenberg-Marquardt; the lowest
    cost wins. Returns `diagnostics` (converged, atBound, periodRange) like the JS.
    """
    options = options or {}
    t = _to_float_arr(t)
    x = _to_float_arr(x)
    mask = ~(np.isnan(t) | np.isnan(x))
    t, x = t[mask], x[mask]
    if t.size < 4 * n_curves:
        return None
    rng = resolve_period_range(t, options.get('minPeriod'), options.get('maxPeriod'))
    if rng is None:
        return None
    f_lo, f_hi = 1.0 / rng['maxPeriod'], 1.0 / rng['minPeriod']

    def residuals(p, t_, x_):
        m = (len(p) - 1) // 3
        y = np.full_like(t_, p[-1])
        for i in range(m):
            B = p[3 * i]
            w = p[3 * i + 1]
            o = p[3 * i + 2]
            y = y + B * np.cos(2 * math.pi * w * t_ + o)
        return y - x_

    def jacobian(p, t_, _x):
        """Analytic Jacobian of `residuals` (accuracy and speed: the differenced
        frequency column, -B*2*pi*t*sin(...), is poorest exactly where the fit
        relies on it)."""
        m = (len(p) - 1) // 3
        j = np.zeros((t_.size, len(p)))
        for i in range(m):
            B = p[3 * i]
            w = p[3 * i + 1]
            o = p[3 * i + 2]
            th = 2 * math.pi * w * t_ + o
            j[:, 3 * i] = np.cos(th)
            j[:, 3 * i + 1] = -B * 2 * math.pi * t_ * np.sin(th)
            j[:, 3 * i + 2] = -B * np.sin(th)
        j[:, -1] = 1.0
        return j

    def clamp(w):
        return min(f_hi, max(f_lo, w))

    peaks = scan_periodogram(t, x, rng['minPeriod'], rng['maxPeriod'],
                             max(_SCAN_PEAKS, n_curves))
    top = peaks if peaks else [clamp(1.0 / 24.0)]
    # Starts mirror cosinor.js buildStarts. Amplitude and phase are SOLVED for at
    # the seed frequencies rather than started at sd(x) and phase 0: a phase-0
    # seed can be anti-correlated with the data, and the trust-region step then
    # shrinks the amplitude instead of rotating the phase (a collapse to
    # amplitude 3.3 against a true 38 before this seeding).
    if n_curves == 1:
        sets = [[w] for w in top]
    else:
        by_peaks = [top[i] if i < len(top) else clamp(top[0] * (i + 1)) for i in range(n_curves)]
        harmonics = [clamp(top[0] * (i + 1)) for i in range(n_curves)]
        sets = [by_peaks, harmonics]
    lb, ub = [], []
    for _ in range(n_curves):
        lb += [-np.inf, f_lo, -np.inf]
        ub += [np.inf, f_hi, np.inf]
    lb.append(-np.inf)
    ub.append(np.inf)
    best = None
    for fs in sets:
        p0 = _cos_linear_init(t, x, fs)
        # least_squares needs a strictly feasible start
        for i in range(n_curves):
            p0[3 * i + 1] = min(f_hi * (1 - 1e-12), max(f_lo * (1 + 1e-12), p0[3 * i + 1]))
        try:
            res = sp_optimize.least_squares(residuals, p0, jac=jacobian, args=(t, x),
                                            bounds=(lb, ub), max_nfev=2000,
                                            ftol=1e-12, xtol=1e-12, gtol=1e-12)
        except Exception:
            continue
        if best is None or res.cost < best.cost:
            best = res
    if best is None:
        return None
    p = np.array(best.x, dtype=float)
    # Canonical form: B >= 0, phase in (-pi, pi] (B*cos(th) = -B*cos(th + pi)).
    for i in range(n_curves):
        if p[3 * i] < 0:
            p[3 * i] = -p[3 * i]
            p[3 * i + 2] += math.pi
        ph = math.fmod(p[3 * i + 2], 2 * math.pi)
        if ph <= -math.pi:
            ph += 2 * math.pi
        elif ph > math.pi:
            ph -= 2 * math.pi
        p[3 * i + 2] = ph
    pred = residuals(p, t, x) + x
    rss = float(((x - pred) ** 2).sum())
    rmse = math.sqrt(rss / t.size)
    ss_tot = float(((x - x.mean()) ** 2).sum())
    r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
    cosines = []
    at_bound = []
    for i in range(n_curves):
        B = float(p[3 * i])
        w = float(p[3 * i + 1])
        o = float(p[3 * i + 2])
        cosines.append({'amplitude': B, 'frequency': w, 'phase': o})
        if abs(w - f_lo) <= _BOUND_RTOL * f_lo:
            at_bound.append('max')
        elif abs(w - f_hi) <= _BOUND_RTOL * f_hi:
            at_bound.append('min')
        else:
            at_bound.append(None)
    return {
        'parameters': {'A': 0.0, 'cosines': cosines, 'O': float(p[-1])},
        'fitted': pred.tolist(),
        'residuals': (x - pred).tolist(),
        'rmse': rmse, 'rSquared': float(r2), 'rss': rss,
        'diagnostics': {'converged': bool(best.status > 0), 'atBound': at_bound,
                        'periodRange': [rng['minPeriod'], rng['maxPeriod']]},
    }


def evaluate_cosinor_at_points(parameters, x_points):
    """Evaluate fixed-period or free cosinor fit at given t-points."""
    x_points = np.asarray(x_points, dtype=float)
    if 'harmonics' in parameters:
        period = parameters['period']
        omega = 2 * math.pi / period
        y = np.full_like(x_points, parameters['M'])
        for h in parameters['harmonics']:
            k = h['k']
            y = y + h['beta'] * np.cos(k * omega * x_points)
            y = y + h['gamma'] * np.sin(k * omega * x_points)
        return y.tolist()
    # free cosines
    O = parameters.get('O', 0.0)
    y = np.full_like(x_points, O)
    for c in parameters.get('cosines', []):
        y = y + c['amplitude'] * np.cos(2 * math.pi * c['frequency'] * x_points
                                        + c['phase'])
    return y.tolist()


# ----------------------------------------------------------------------
# Periodograms
# ----------------------------------------------------------------------

def is_flat_series(values):
    """periodogram.js isFlatSeries (ROB-13): every usable value (house rule) EXACTLY equal, or
    fewer than two of them. Flat data has no rhythm: zero power everywhere and no peak."""
    first = None
    seen = 0
    for v in values or []:
        if _js_invalid(v):
            continue
        x = _js_number(v)
        if seen == 0:
            first = x
        elif x != first:
            return False
        seen += 1
    return True


def bin_origin(xs, bin_size):
    """periodogram.js binOrigin: floor(min(x) / binSize) * binSize, one binSize lower if that
    rounds above min(x). The binned methods used to start at t = 0 whatever the data, which
    dropped every sample before 0 and walked ~1e8 empty bins for epoch-sized times."""
    mn = math.inf
    for v in xs or []:
        if _js_invalid(v):
            continue
        x = _js_number(v)
        if x < mn:
            mn = x
    if not math.isfinite(mn) or not (bin_size > 0) or not math.isfinite(bin_size):
        return 0.0
    origin = math.floor(mn / bin_size) * bin_size
    if origin > mn:
        origin -= bin_size
    return origin


def _pgram_pairs(t, y):
    idx = _js_valid_pairs(t, y)
    return [_js_number(t[i]) for i in idx], [_js_number(y[i]) for i in idx]


def _lomb_scargle(t, y, periods):
    if t is None or y is None or len(t) < 2 or len(y) < 2 or len(t) != len(y):
        return [float('nan')] * len(periods)
    t, y = _pgram_pairs(t, y)
    if not t or is_flat_series(y):
        return [0.0] * len(periods)
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    y = y - y.mean()
    omegas = 2 * math.pi / np.asarray(periods, dtype=float)
    powers = np.empty_like(omegas)
    # SAMPLE variance (ddof=1), matching periodogram.js:38. numpy's y.var() default is the
    # POPULATION variance, which was used here until 2026-07-28 and inflated every power by
    # n/(n-1): 0.4% at n = 240 but 2% at n = 50. Periodogram power is read against a
    # significance threshold, so that bias pushed toward declaring a rhythm — and pushed
    # hardest on short records, where the call is already marginal.
    var = float(y.var(ddof=1)) or 1.0
    for k, w in enumerate(omegas):
        # tau, the offset that makes the cosine and sine bases orthogonal on unevenly
        # sampled data. Lomb (1976, Ap&SS 39:447) and Scargle (1982, ApJ 263:835):
        #
        #     tan(2*w*tau) = sum(sin(2*w*t)) / sum(cos(2*w*t))
        two_w = 2 * w
        s2 = float(np.sin(two_w * t).sum())
        c2 = float(np.cos(two_w * t).sum())
        tau = math.atan2(s2, c2) / two_w if w != 0 else 0.0
        cwt = np.cos(w * (t - tau))
        swt = np.sin(w * (t - tau))
        num1 = float((y * cwt).sum()) ** 2
        den1 = float((cwt ** 2).sum())
        num2 = float((y * swt).sum()) ** 2
        den2 = float((swt ** 2).sum())
        powers[k] = (num1 / den1 + num2 / den2) / (2 * var) if den1 > 0 and den2 > 0 else 0.0
    return powers.tolist()


def _chi_squared_pgram(t, y, periods, dt, alpha=0.05):
    """Folding chi-squared (Sokolove-Bushell 1978) periodogram, the periodogram.js pipeline
    step for step: valid pairs, bin at dt from binOrigin (the first sample's bin on the dt
    grid, not 0), then fold the BIN MEANS at colNum = round(P / dt) columns (bin i in column
    i % colNum). Occupancy-weighted over non-empty columns:
    Qp = N_eff * sum_h K_h (M_h - M)^2 / sum_i (x_i - M)^2, df = occupied columns - 1.
    Flat data: Qp 0 with its real df (p 1, the threshold still drawn). Per-fold p is the
    chi-square UPPER tail (chi2.sf, SPEC-14) and the threshold the Sidak-corrected upper
    quantile over the M folds with a statistic.

    (This used to fold the raw samples by (t / dt).astype(int) % nbins, which truncated
    negative times toward 0 and differed from the app whenever a bin held several points.)"""
    nan = float('nan')
    tt, yy = _pgram_pairs(t, y)
    flat = is_flat_series(yy)
    binned = bin_data(tt, yy, dt, bin_origin(tt, dt))
    data = [nan if v is None else float(v) for v in binned['y_out']]
    if not data:
        return [nan] * len(periods), [nan] * len(periods), [nan] * len(periods), \
            [nan] * len(periods)
    present = [v for v in data if v == v]
    avg_all = kahan_mean(present)
    den = KahanSum()
    for v in present:
        den.add((v - avg_all) ** 2)
    denominator = den.value()
    powers, dfs, pvals = [], [], []
    for P in periods:
        col_num = _js_round(P / dt)
        if not math.isfinite(col_num) or col_num < 1 or col_num > len(data):
            powers.append(nan); dfs.append(nan); pvals.append(nan)
            continue
        sums = [KahanSum() for _ in range(col_num)]
        counts = [0] * col_num
        for i, v in enumerate(data):
            if v == v:
                sums[i % col_num].add(v)
                counts[i % col_num] += 1
        num = KahanSum()
        cols = bins_ne = 0
        for h in range(col_num):
            if counts[h] == 0:
                continue
            cols += 1
            bins_ne += counts[h]
            d = sums[h].value() / counts[h] - avg_all
            num.add(counts[h] * d * d)
        df = cols - 1
        if df < 1:
            powers.append(nan); dfs.append(nan); pvals.append(nan)
            continue
        qp = 0.0 if flat else (num.value() * bins_ne) / denominator if denominator else nan
        if not math.isfinite(qp):
            powers.append(nan); dfs.append(nan); pvals.append(nan)
            continue
        powers.append(qp)
        dfs.append(df)
        pvals.append(float(sp_stats.chi2.sf(qp, df)))
    m = sum(1 for d in dfs if d == d and d >= 1)
    corrected = (1.0 - alpha) ** (1.0 / m) if m else nan
    thresholds = [float(sp_stats.chi2.ppf(corrected, d)) if (d == d and d >= 1) else nan
                  for d in dfs]
    return powers, dfs, thresholds, pvals


def _enright_amplitude(data, nb):
    """periodogram.js enrightAmplitude: Enright's (1965) A_p for one fold of nb bins. The
    binned series is folded into a Buys-Ballot table of nb columns; each column mean uses
    only its occupied bins (an empty bin is missing, never 0), empty columns are left out,
    and A_p = sqrt(mean over occupied columns of (M_h - Mbar)^2) with Mbar the plain mean of
    the column means (Legendre & Legendre, Numerical Ecology, 1998, eq. 12.12-12.13). NaN when the
    fold is longer than the binned record or fewer than two columns are occupied."""
    n = data.size
    if nb < 1 or nb > n:
        return float('nan')
    cols = np.arange(n) % nb
    valid = ~np.isnan(data)
    sums = np.bincount(cols[valid], weights=data[valid], minlength=nb)
    counts = np.bincount(cols[valid], minlength=nb)
    occ = counts > 0
    if int(occ.sum()) < 2:
        return float('nan')
    means = sums[occ] / counts[occ]
    grand = float(means.mean())
    return math.sqrt(float(((means - grand) ** 2).sum()) / means.size)


def _enright_pgram(t, y, periods, dt):
    """Port of periodogram.js calculateEnrightPower (Enright 1965): valid pairs, bin at dt
    from binOrigin, then Enright's A_p (_enright_amplitude) at each fold of
    nb = round(P / dt) bins. Flat data: 0 at every fold that has a statistic."""
    if t is None or y is None or len(t) < 2 or len(y) < 2:
        return [float('nan')] * len(periods)
    tt, yy = _pgram_pairs(t, y)
    flat = is_flat_series(yy)
    data = np.asarray([np.nan if v is None else v
                       for v in bin_data(tt, yy, dt, bin_origin(tt, dt))['y_out']],
                      dtype=float)
    if data.size == 0:
        return [float('nan')] * len(periods)
    powers = []
    for P in periods:
        ap = _enright_amplitude(data, _js_round(P / dt))
        powers.append(ap if ap != ap else (0.0 if flat else ap))
    return powers


def _fold_grid(periods, dt, p_min, p_max):
    # Distinct fold periods for the binned methods, matching periodogram.js
    # foldGrid. Chi-squared and Enright depend on a trial period only through
    # nbins = round(P / dt), so trial periods within one bin width are the same
    # test; reporting them separately tied their power and argmax took the first
    # (a -dt/2 bias on the peak). Each distinct fold is returned once, at the
    # period it actually tests (nbins * dt); folds that round outside
    # [p_min, p_max] are dropped. The grid ascends, so equal folds are adjacent.
    out = []
    if not (dt > 0) or not math.isfinite(dt):
        return out
    eps = 1e-9 * max(1.0, abs(p_min), abs(p_max))
    last = None
    for P in periods:
        n = _js_round(P / dt)
        if n < 1 or n == last:
            continue
        last = n
        fold = n * dt
        if fold < p_min - eps or fold > p_max + eps:
            continue
        out.append(fold)
    return out


def run_periodogram_calculation(params, on_progress=None):
    """params keys: t, y, method ('Lomb-Scargle'|'Chi-squared'|'Enright'),
    minPeriod, maxPeriod, stepSize, dt"""
    t = list(params['t'])
    y = list(params['y'])
    method = params.get('method', 'Lomb-Scargle')
    p_min = float(params.get('minPeriod', 1.0))
    p_max = float(params.get('maxPeriod', 48.0))
    step = float(params.get('stepSize', 0.1))
    periods = make_seq_array(p_min, p_max, step)
    dt = float(params.get('dt', None) or _median_dt(t))
    if method != 'Lomb-Scargle':
        periods = _fold_grid(periods, dt, p_min, p_max)
    pvals = None
    if method == 'Lomb-Scargle':
        powers = _lomb_scargle(t, y, periods)
        threshold = None
        dfs = None
    elif method == 'Chi-squared':
        alpha = float(params.get('alpha', params.get('chiSquaredAlpha', 0.05)))
        powers, dfs, threshold, pvals = _chi_squared_pgram(t, y, periods, dt, alpha)
    else:
        powers = _enright_pgram(t, y, periods, dt)
        threshold = None
        dfs = None
    # periodogram.js drops the periods whose power is NaN (a fold with < 2 occupied columns).
    keep = [i for i, v in enumerate(powers) if v == v and periods[i] == periods[i]]
    pick = (lambda a: None if a is None else [a[i] for i in keep])
    return {'x': pick(periods), 'y': pick(powers), 'threshold': pick(threshold),
            'df': pick(dfs), 'pvalue': pick(pvals)}


def chi_squared_periodogram(t, y, opts):
    """Pure-util parity surface for the chi-squared (Sokolove-Bushell)
    periodogram. `period`, `power`, `df` and `threshold` are all
    parity-compared: with binSize at or below the sampling interval every bin
    holds at most one point, so this mod-binning port and the JS
    binData-then-fold pipeline are the SAME fold and must agree exactly —
    including on grids where most bins are empty, the regime whose
    empty-bin handling this pins. (With several points per bin the two
    pipelines still differ — that regime stays unpinned.)"""
    res = run_periodogram_calculation({
        't': t, 'y': y, 'method': 'Chi-squared',
        'minPeriod': opts.get('periodMin', 1.0),
        'maxPeriod': opts.get('periodMax', 48.0),
        'stepSize': opts.get('periodStep', 0.1),
        'dt': opts.get('binSize', 0.25),
        'alpha': opts.get('alpha', 0.05),
    })
    return {'period': res['x'], 'power': res['y'], 'df': res['df'],
            'threshold': res['threshold'], 'pvalue': res['pvalue']}


def lomb_scargle_periodogram(t, y, opts):
    """Pure-util parity surface for Lomb-Scargle through run_periodogram_calculation."""
    res = run_periodogram_calculation({
        't': t, 'y': y, 'method': 'Lomb-Scargle',
        'minPeriod': opts.get('periodMin', 1.0), 'maxPeriod': opts.get('periodMax', 48.0),
        'stepSize': opts.get('periodStep', 0.1)})
    return {'period': res['x'], 'power': res['y']}


def enright_periodogram(t, y, opts):
    """Pure-util parity surface for the Enright periodogram: the distinct-fold
    period axis and the power at each fold, matching periodogram.js."""
    res = run_periodogram_calculation({
        't': t, 'y': y, 'method': 'Enright',
        'minPeriod': opts.get('periodMin', 1.0),
        'maxPeriod': opts.get('periodMax', 48.0),
        'stepSize': opts.get('periodStep', 0.1),
        'dt': opts.get('binSize', 0.25),
    })
    return {'period': res['x'], 'power': res['y']}


def _median_dt(t):
    t = np.asarray(t, dtype=float)
    if t.size < 2:
        return 1.0
    diffs = np.diff(t)
    diffs = diffs[diffs > 0]
    return float(np.median(diffs)) if diffs.size else 1.0


# ----------------------------------------------------------------------
# FFT
# ----------------------------------------------------------------------

# Gap rule shared by every FFT caller (fft.js FFT_GAP_RULE): a run of up to 3 missing grid
# slots is filled linearly, provided at most 10% of the grid is filled; anything more is
# refused with a reason. A sample further than a quarter step from its slot is off-grid.
FFT_GAP_RULE = {'maxGapSamples': 3, 'maxMissingFraction': 0.1}
_FFT_ALIGN_TOLERANCE = 0.25
_MAX_FFT_N = 1 << 24


def _fmt_h(h):
    """fft.js fmtH: hours for a message."""
    if abs(h) >= 10:
        return f'{h:.0f}'
    return _js_string(float(f'{h:.3g}'))


def regrid_uniform(times, values, max_gap_samples=None, max_missing_fraction=None):
    """fft.js regridUniform: put a series on its own uniform grid. Step = the LOWER median
    of the positive intervals between consecutive valid samples (sorted[floor((n-1)/2)]);
    slot = round((t - t0) / dt); refused when a sample is more than a quarter step off its
    slot or two share one, when a run of missing slots is longer than 3, or when more than
    10% of the slots are missing. Short runs are filled by linear interpolation."""
    mg = FFT_GAP_RULE['maxGapSamples'] if max_gap_samples is None else max_gap_samples
    mf = (FFT_GAP_RULE['maxMissingFraction'] if max_missing_fraction is None
          else max_missing_fraction)
    nan = float('nan')

    def fail(reason, **extra):
        out = {'ok': False, 'reason': reason, 't0': nan, 'dt': nan, 'y': [], 'nObserved': 0,
               'nFilled': 0, 'longestGap': 0}
        out.update(extra)
        return out
    if times is None or values is None:
        return fail('no data')
    idx = _js_valid_pairs(times, values)
    if len(idx) < 2:
        return fail('need at least 2 samples with both a time and a value')
    t = [_js_number(times[i]) for i in idx]
    y = [_js_number(values[i]) for i in idx]
    diffs = []
    for i in range(1, len(t)):
        d = t[i] - t[i - 1]
        if not (d > 0) or not math.isfinite(d):
            return fail('the time axis is not increasing')
        diffs.append(d)
    dt = sorted(diffs)[(len(diffs) - 1) // 2]
    if not (dt > 0) or not math.isfinite(dt):
        return fail('the time axis is not increasing')
    t0 = t[0]
    slots = []
    for i, ti in enumerate(t):
        pos = (ti - t0) / dt
        slot = int(_formula_round(pos))  # JS Math.round
        if abs(pos - slot) > _FFT_ALIGN_TOLERANCE or (i > 0 and slot == slots[-1]):
            return fail(f'the samples do not sit on a regular grid (typical interval '
                        f'{_fmt_h(dt)} h). Bin the data to a fixed interval first, or use '
                        'the Lomb-Scargle periodogram.', dt=dt)
        slots.append(slot)
    n_grid = slots[-1] + 1
    if not (n_grid <= _MAX_FFT_N):
        return fail('the record is too long for the transform', dt=dt)
    longest = 0
    for i in range(1, len(slots)):
        longest = max(longest, slots[i] - slots[i - 1] - 1)
    n_missing = n_grid - len(t)
    if longest > mg:
        return fail(f'the record has a gap of {_fmt_h(longest * dt)} h ({longest} missing '
                    f'samples at the {_fmt_h(dt)} h interval). The FFT needs evenly spaced '
                    f'samples and fills at most {mg} in a row. Use the Lomb-Scargle '
                    'periodogram, which handles gaps, or analyse the segments either side '
                    'separately.', dt=dt, longestGap=longest, nObserved=len(t))
    if n_missing > mf * n_grid:
        return fail(f'{n_missing} of {n_grid} samples ({100 * n_missing / n_grid:.0f}%) are '
                    f'missing at the {_fmt_h(dt)} h interval, more than the {100 * mf:.0f}% '
                    'the FFT will interpolate. Use the Lomb-Scargle periodogram, which '
                    'handles missing samples.', dt=dt, longestGap=longest, nObserved=len(t))
    out = [0.0] * n_grid
    for i, sl in enumerate(slots):
        out[sl] = y[i]
        if i > 0:
            gap = sl - slots[i - 1]
            for g in range(1, gap):
                out[slots[i - 1] + g] = y[i - 1] + ((y[i] - y[i - 1]) * g) / gap
    return {'ok': True, 'reason': '', 't0': t0, 'dt': dt, 'y': out, 'nObserved': len(t),
            'nFilled': n_missing, 'longestGap': longest}


def _empty_spectrum(reason=''):
    return {'frequencies': [], 'magnitudes': [], 'phases': [], 'samplingRate': 0.0,
            'nyquistFreq': 0.0, 'minPeriod': 0.0, 'resolution': 0.0, 'nSamples': 0,
            'nTransform': 0, 'nFilled': 0, 'grid': None, 'flat': False, 'warnings': [],
            'reason': reason}


def compute_fft(times, values, freq_step=None):
    """Port of fft.js computeFFT. The series is put on its own grid (regrid_uniform; short
    gaps filled, long ones refused with `reason`), the mean removed (no linear detrend), and
    the DFT taken at the record's own length N, or at M = ceil(rate / freqStep) when a finer
    frequency step is asked for (zero padding). Bins k = 1 .. below M/2 at k * rate / M;
    magnitude 2|X_k| / N (N samples, not the padded length); phase atan2(Im, Re). A series
    with no variation at all has magnitude exactly 0 everywhere (`flat`).

    numpy's FFT handles any length directly (the JS uses Bluestein for non-powers of two):
    the same transform, equal to rounding."""
    if (times is None or values is None or len(times) < 2 or len(values) < 2
            or len(times) != len(values)):
        return _empty_spectrum()
    g = regrid_uniform(times, values)
    if not g['ok']:
        return _empty_spectrum(g['reason'])
    n = len(g['y'])
    if n < 4:
        return _empty_spectrum('need at least 4 samples')
    dt = g['dt']
    rate = 1.0 / dt
    m = n
    if freq_step and freq_step > 0:
        want = math.ceil(rate / freq_step)
        if math.isfinite(want) and want > n:
            m = int(want)
    if m > _MAX_FFT_N:
        return _empty_spectrum('the requested frequency step is too fine')
    y_mean = kahan_mean(g['y'])
    yc = [v - y_mean for v in g['y']]
    flat = all(v == g['y'][0] for v in g['y'])
    buf = np.zeros(m)
    buf[:n] = yc
    spec = np.fft.fft(buf)
    freqs, mags, phases = [], [], []
    k = 1
    while 2 * k < m:
        freqs.append(k * rate / m)
        mags.append(0.0 if flat else 2 * math.hypot(spec[k].real, spec[k].imag) / n)
        phases.append(math.atan2(spec[k].imag, spec[k].real))
        k += 1
    warnings = []
    if g['nFilled'] > 0:
        nf = g['nFilled']
        warnings.append(f"{nf} missing sample{' was' if nf == 1 else 's were'} filled by "
                        f"linear interpolation on the {_fmt_h(dt)} h grid (longest run "
                        f"{g['longestGap']}).")
    return {'frequencies': freqs, 'magnitudes': mags, 'phases': phases, 'samplingRate': rate,
            'nyquistFreq': rate / 2, 'minPeriod': 2 * dt, 'resolution': rate / n,
            'nSamples': n, 'nTransform': m, 'nFilled': g['nFilled'],
            'grid': {'t0': g['t0'], 'dt': dt, 'y': yc}, 'flat': flat, 'warnings': warnings,
            'reason': ''}


def _fft_magnitude_at(y, dt, f):
    """fft.js magnitudeAt: least-squares sinusoid at frequency f with CENTRED cos/sin
    regressors (its own constant). Returns (amplitude, phase, explained sum of squares)."""
    w = 2 * math.pi * f * dt
    n = len(y)
    cs = [math.cos(w * j) for j in range(n)]
    sn = [math.sin(w * j) for j in range(n)]
    mc = sum(cs) / n
    ms = sum(sn) / n
    scc = sss = scs = syc = sys_ = 0.0
    for j in range(n):
        c = cs[j] - mc
        s_ = sn[j] - ms
        scc += c * c
        sss += s_ * s_
        scs += c * s_
        syc += y[j] * c
        sys_ += y[j] * s_
    det = scc * sss - scs * scs
    if not (abs(det) > 1e-12 * scc * sss):
        mag = 2 * math.hypot(syc, sys_) / n
        return mag, math.atan2(-sys_, syc), mag * mag * n / 2
    a = (syc * sss - sys_ * scs) / det
    b = (sys_ * scc - syc * scs) / det
    return math.hypot(a, b), math.atan2(-b, a), a * syc + b * sys_


def fft_peak(spec, period_min=None, period_max=None, indices=None):
    """Port of fft.js fftPeak: the largest bin (within [period_min, period_max] hours, or
    among `indices`), refined by golden-section search between its neighbouring bins on the
    variance a least-squares sinusoid explains; the bin is kept if the search finds nothing
    better. None for a flat spectrum or no positive magnitude."""
    f = (spec or {}).get('frequencies') or []
    m = (spec or {}).get('magnitudes') or []
    if not f or spec.get('flat'):
        return None
    cand = indices
    if cand is None:
        lo = 0 if period_min is None else period_min
        hi = math.inf if period_max is None else period_max
        cand = [i for i in range(len(f)) if lo <= 1 / f[i] <= hi]
    best = -1
    for i in cand:
        if _finite(m[i]) and (best < 0 or m[i] > m[best]):
            best = i
    if best < 0 or not (m[best] > 0):
        return None
    freq, mag = f[best], m[best]
    phase = (spec.get('phases') or [float('nan')] * len(f))[best]
    grid = spec.get('grid')
    if grid and grid.get('y'):
        gy, gdt = grid['y'], grid['dt']
        a = f[best - 1] if best > 0 else f[best]
        b = f[best + 1] if best < len(f) - 1 else f[best]
        if period_max is not None and math.isfinite(period_max):
            a = max(a, 1 / period_max)
        if period_min is not None and period_min > 0:
            b = min(b, 1 / period_min)
        if b > a:
            gr = (math.sqrt(5) - 1) / 2
            c = b - gr * (b - a)
            d = a + gr * (b - a)
            fc = _fft_magnitude_at(gy, gdt, c)[2]
            fd = _fft_magnitude_at(gy, gdt, d)[2]
            it = 0
            while it < 60 and b - a > 1e-12 * f[best]:
                if fc > fd:
                    b, d, fd = d, c, fc
                    c = b - gr * (b - a)
                    fc = _fft_magnitude_at(gy, gdt, c)[2]
                else:
                    a, c, fc = c, d, fd
                    d = a + gr * (b - a)
                    fd = _fft_magnitude_at(gy, gdt, d)[2]
                it += 1
            fr = (a + b) / 2
            at = _fft_magnitude_at(gy, gdt, fr)
            if at[2] >= _fft_magnitude_at(gy, gdt, f[best])[2]:
                freq, mag, phase = fr, at[0], at[1]
    return {'frequency': freq, 'period': 1 / freq, 'magnitude': mag, 'phase': phase,
            'index': best}


def fft_peak_of(times, values, freq_step=None, period_min=None, period_max=None):
    """Parity surface: fft_peak over compute_fft as scalars, NaN throughout for no peak."""
    pk = fft_peak(compute_fft(times, values, freq_step), period_min, period_max)
    nan = float('nan')
    if pk is None:
        return {'frequency': nan, 'period': nan, 'magnitude': nan, 'phase': nan}
    return {k: pk[k] for k in ('frequency', 'period', 'magnitude', 'phase')}


def regrid_uniform_summary(times, values):
    """Parity surface for regrid_uniform: ok (1/0), dt, nFilled, longestGap and the grid y."""
    g = regrid_uniform(times, values)
    return {'ok': 1 if g['ok'] else 0, 'dt': g['dt'], 'nFilled': g['nFilled'],
            'longestGap': g['longestGap'], 'y': g['y']}


# ----------------------------------------------------------------------
# Correlogram (with minLag)
# ----------------------------------------------------------------------

# Two lags whose correlation differs by less than this are a TIE, not a ranking:
# a perfectly periodic series lands on its repeat value to within a few ulps, so a
# raw `>` lets floating-point noise decide which repeat is reported.
_ACF_PEAK_TIE = 1e-12


def find_autocorrelation_peak(lags, correlations):
    """The peak of an autocorrelogram: the DOMINANT PERIOD of the series.

    Deliberately NOT the cross-correlogram's convention (largest |r|, see
    cross_correlation). Lag 0 is exactly 1 by definition, so a sign-blind maximum
    always answers 0; a rhythm is anti-correlated with itself at half a period, so
    the largest |r| away from 0 is typically r = -1 at P/2, which is the same rhythm
    in antiphase rather than a second finding; and a rhythm repeats at every MULTIPLE
    of its period, with this estimator normalising each lag by its own overlap count,
    so the long lags are computed from fewer pairs and drift ABOVE the fundamental
    (values over 1 are routine at lag 3P). A plain maximum over non-zero lags
    therefore reports 2P, 3P or the last lag in the window.

    So: drop lag 0 and non-finite values; find where the correlogram first goes
    negative and then returns to non-negative, and take the largest correlation in
    that first positive lobe, ties within 1e-12 going to the smaller lag. If there is
    no lobe (no dip, or no recovery after one), fall back to the largest correlation
    over the non-zero lags. This is the standard reading of a circadian
    autocorrelogram (Levine et al. 2002, BMC Neuroscience 3:1).

    Mirrors findAutocorrelationPeak in src/lib/utils/correlogram.js.
    Returns (lag, correlation), or (nan, nan) when there is nothing to read.
    """
    cand = [i for i in range(min(len(lags), len(correlations)))
            if lags[i] > 0 and math.isfinite(correlations[i])]
    if not cand:
        return float('nan'), float('nan')
    window = cand
    dip = next((k for k in range(len(cand)) if correlations[cand[k]] < 0), None)
    if dip is not None:
        start = next((k for k in range(dip + 1, len(cand))
                      if correlations[cand[k]] >= 0), None)
        if start is not None:
            end = start
            while end + 1 < len(cand) and correlations[cand[end + 1]] >= 0:
                end += 1
            window = cand[start:end + 1]
    best = window[0]
    for i in window:
        if correlations[i] > correlations[best] + _ACF_PEAK_TIE:
            best = i
    return lags[best], correlations[best]


def _js_upper_median(diffs):
    """correlogram.js's median spacing: the diffs sorted ascending and the element at
    floor(len / 2), i.e. the UPPER median for an even count (not the mean of the middle
    two, as np.median). Every diff counts, including zero and negative ones."""
    d = sorted(diffs)
    return d[len(d) // 2]


def compute_autocorrelation(times, values, bin_size=None, max_lag=None,
                            min_lag=0.0):
    """Port of utils/correlogram.js computeAutocorrelation.

    `bin_size` None estimates the lag step as the UPPER median of the successive spacings
    of the valid times (in their given order); a non-finite or non-positive step, or times
    and values of different lengths, give no lags, as in the app. Sampling within 10% of
    that median takes the index-shift path, anything else is the slotted estimator (Edelson
    and Krolik 1988; Rehfeld et al. 2011, Nonlin. Processes Geophys. 18:389, Eqs. 10-11):
    each product of two mean-removed samples goes to the lag slot its separation falls in.
    As in the app (see the rules in utils/correlogram.js): lag 0 is exactly 1 on both paths;
    slots are half-open, lag k takes (k - 1/2) dt <= d < (k + 1/2) dt, so a pair on a
    boundary counts once (in the upper lag); distinct pairs closer than half a step are not
    used at any lag; the default lag window is half the recording span in hours."""
    def empty(dt):
        return {'lags': [], 'correlations': [], 'dt': dt,
                'peakLag': float('nan'), 'peakCorrelation': float('nan')}

    times = list(times) if times is not None else None
    values = list(values) if values is not None else None
    if (not times or not values or len(times) < 2 or len(values) < 2
            or len(times) != len(values)):
        return empty(1.0)
    idx = [i for i in range(len(times))
           if not _js_invalid(times[i]) and not _js_invalid(values[i])]
    if len(idx) < 2:
        return empty(1.0)
    t = np.array([float(times[i]) for i in idx], dtype=float)
    y = np.array([float(values[i]) for i in idx], dtype=float)
    n = y.size
    diffs = np.diff(t).tolist()
    dt = float(bin_size) if bin_size is not None else _js_upper_median(diffs)
    if not math.isfinite(dt) or dt <= 0:
        return empty(1.0)
    # `maxLag ? maxLag : span / 2`: JS truthiness, so 0, null and NaN mean "auto".
    # The lag window is set by TIME, not by the sample count (correlogram.js rule 5): the
    # default is half the recording span in hours, since the spacing may be uneven (Chatfield,
    # The Analysis of Time Series: lags up to about N/4 to N/2). A user max lag wins, up to
    # the span; on the index-shift path also below n shifts.
    span = float(t[-1] - t[0])
    ml = None if max_lag is None else float(max_lag)
    max_lag_t = ml if (ml is not None and ml != 0 and not math.isnan(ml)) \
        else span / 2.0
    mn = None if min_lag is None else float(min_lag)
    min_lag_t = mn if (mn is not None and math.isfinite(mn) and mn > 0) else 0.0
    if min_lag_t >= max_lag_t:
        return empty(dt)
    n_lags = min(math.floor(max_lag_t / dt), math.floor(span / dt))
    start_idx = math.ceil(min_lag_t / dt)
    ymean = float(y.mean())
    yvar = float(((y - ymean) ** 2).sum() / n)
    if yvar == 0:
        return empty(dt)
    median = _js_upper_median(diffs)
    is_uniform = max(abs(d - median) for d in diffs) < median * 0.1
    lags, corrs = [], []
    if is_uniform:
        # A shift of n samples or more has no pairs.
        n_lags = min(n_lags, n - 1)
        ydem = y - ymean
        for lag in range(start_idx, n_lags + 1):
            if lag == 0:
                # Lag 0 is 1 by definition, not sum / (n * var) with its rounding.
                corrs.append(1.0)
                lags.append(0.0)
                continue
            a = ydem[:n - lag]
            b = ydem[lag:]
            count = a.size
            # A lag with no pairs is missing (NaN), not r = 0 (correlogram.js rule 4).
            corrs.append(float((a * b).sum() / (count * yvar)) if count > 0 else float('nan'))
            lags.append(lag * dt)
    else:
        for li in range(start_idx, n_lags + 1):
            target = li * dt
            if li == 0:
                corrs.append(1.0)
                lags.append(target)
                continue
            # The half-open slot [(k - 1/2) dt, (k + 1/2) dt).
            lo = (li - 0.5) * dt
            hi = (li + 0.5) * dt
            sum_, count = 0.0, 0
            for i in range(n):
                for j in range(i + 1, n):
                    td = t[j] - t[i]
                    if lo <= td < hi:
                        sum_ += (y[i] - ymean) * (y[j] - ymean)
                        count += 1
                    if td >= hi:
                        break
            # An empty slot is missing (NaN), not r = 0: the slotted estimator is a ratio over
            # the slot's pairs (Rehfeld et al. 2011, NPG 18:389, Eq. 10), undefined with none.
            corrs.append(sum_ / (count * yvar) if count > 0 else float('nan'))
            lags.append(target)
    peak_lag, peak_r = find_autocorrelation_peak(lags, corrs)
    return {'lags': lags, 'correlations': corrs, 'dt': dt,
            'peakLag': peak_lag, 'peakCorrelation': peak_r}


def correlogram_series_acf(series, columns_index):
    """One correlogram series as the app computes it (CorrelogramDataclass.acfData), or
    None when a column is missing. Shared by the PNG renderer and the plot-data export so
    the two always agree.

    - times are the x column's hoursSinceStart for EVERY column type (a number or bin x
      counts from its own minimum; the autocorrelation is shift-invariant, so this changes
      no number, but it is the app's input);
    - the lag step is the x column's binWidth when it has one (a BinnedData output, an
      imported bin column), else None, so compute_autocorrelation takes the MEDIAN
      interval of the valid times, as the Rhythmicity node's correlogram does (SPEC-10).
      The mean spacing it used before, (last - first) / (count - 1), is stretched by a
      recording gap (fixture correlogram-data-gap);
    - maxLag / minLag are PER SERIES (the saved series' `maxLag`, `minLag`)."""
    x_col = _resolve_plot_col(series.get('x'), columns_index)
    y_col = _resolve_plot_col(series.get('y'), columns_index)
    if x_col is None or y_col is None:
        return None
    times = [None if v is None or (isinstance(v, float) and math.isnan(v)) else v
             for v in (x_col.hours_since_start or [])]
    values = y_col.get_data() or []
    bw = x_col.eff_bin_width
    bin_size = float(bw) if bw else None
    return compute_autocorrelation(times, values, bin_size,
                                   series.get('maxLag'), series.get('minLag') or 0)


# ----------------------------------------------------------------------
# Rectangular wave
# ----------------------------------------------------------------------

def _solve_linear_js(A, b):
    """rectwave.js / doublelogistic.js solveLinearSystem: Gaussian elimination with partial
    pivoting; raises ValueError('Singular matrix') on a pivot below 1e-12."""
    n = len(A)
    aug = [list(row) + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        mx = i
        for k in range(i + 1, n):
            if abs(aug[k][i]) > abs(aug[mx][i]):
                mx = k
        aug[i], aug[mx] = aug[mx], aug[i]
        if abs(aug[i][i]) < 1e-12:
            raise ValueError('Singular matrix')
        for k in range(i + 1, n):
            f = aug[k][i] / aug[i][i]
            for j in range(i, n + 1):
                aug[k][j] -= f * aug[i][j]
    sol = [0.0] * n
    for i in range(n - 1, -1, -1):
        acc = aug[i][n]
        for j in range(i + 1, n):
            acc -= aug[i][j] * sol[j]
        sol[i] = acc / aug[i][i]
    return sol


def _rw_eval(t, p):
    M, A, k, w, phi, d = p
    return M + A * math.tanh(k * (math.sin(w * t + phi) - math.cos(math.pi * d)))


def _rw_normal_eqs(t, x, p, free):
    nf = len(free)
    JtJ = [[0.0] * nf for _ in range(nf)]
    JtR = [0.0] * nf
    rss = 0.0
    _, A, k, w, phi, d = p
    cpd, spd = math.cos(math.pi * d), math.sin(math.pi * d)
    for ti, xi in zip(t, x):
        r = xi - _rw_eval(ti, p)
        rss += r * r
        arg = w * ti + phi
        ca, sa = math.cos(arg), math.sin(arg)
        s_ = sa - cpd
        th = math.tanh(k * s_)
        sech2 = 1 - th * th
        jf = (-1.0, -th, -A * s_ * sech2, -A * k * ti * ca * sech2, -A * k * ca * sech2,
              -A * k * math.pi * spd * sech2)
        row = [jf[i] for i in free]
        for j in range(nf):
            JtR[j] += row[j] * r
            for m in range(j, nf):
                JtJ[j][m] += row[j] * row[m]
    for j in range(nf):
        for m in range(j + 1, nf):
            JtJ[m][j] = JtJ[j][m]
    return JtJ, JtR, rss


def _rw_fit_lm(t, x, params, free, max_iter, tol, w_lo, w_hi):
    """rectwave.js fitWithLM, step for step: omega clamped to [w_lo, w_hi] and frozen for a
    step when it sits on a bound and the descent points outward; converged = stopped on the
    tolerance or damping reached 1e12; canonical A >= 0 form; at-bound within 1e-6."""
    p = list(params)
    p[3] = min(w_hi, max(w_lo, p[3]))
    lam = 0.01
    JtJ, JtR, rss_cur = _rw_normal_eqs(t, x, p, free)
    converged = False
    iterations = 0
    w_pos = free.index(3) if 3 in free else -1
    for it in range(max_iter):
        iterations = it + 1
        frozen = w_pos >= 0 and ((p[3] <= w_lo and JtR[w_pos] > 0)
                                 or (p[3] >= w_hi and JtR[w_pos] < 0))
        JtJ_d = []
        for i, row in enumerate(JtJ):
            if frozen and i == w_pos:
                JtJ_d.append([1.0 if k_ == i else 0.0 for k_ in range(len(row))])
                continue
            r_ = [0.0 if (frozen and k_ == w_pos) else v for k_, v in enumerate(row)]
            r_[i] += lam * (row[i] if row[i] > 0 else 1)
            JtJ_d.append(r_)
        rhs = [0.0 if (frozen and i == w_pos) else v for i, v in enumerate(JtR)]
        try:
            delta = _solve_linear_js(JtJ_d, rhs)
        except ValueError:
            lam = min(lam * 10, 1e12)
            if lam >= 1e12:
                converged = True
                break
            continue
        new_p = list(p)
        for j, idx in enumerate(free):
            new_p[idx] = p[idx] - delta[j]
        new_p[2] = max(0.01, new_p[2])
        new_p[3] = max(w_lo, min(new_p[3], w_hi))
        new_p[5] = max(0.01, min(new_p[5], 0.99))
        nJtJ, nJtR, rss_new = _rw_normal_eqs(t, x, new_p, free)
        if rss_new < rss_cur:
            rel = (rss_cur - rss_new) / (rss_cur + 1e-10)
            p, JtJ, JtR, rss_cur = new_p, nJtJ, nJtR, rss_new
            lam = max(lam / 3, 1e-10)
            if rel < tol:
                converged = True
                break
        else:
            lam = min(lam * 10, 1e12)
            if lam >= 1e12:
                converged = True
                break
    n = len(t)
    fitted = [_rw_eval(ti, p) for ti in t]
    km = KahanSum()
    for v in x:
        km.add(v)
    xm = km.value() / n
    kt = KahanSum()
    for v in x:
        kt.add((v - xm) ** 2)
    r2 = 1 - rss_cur / kt.value() if kt.value() > 0 else 0.0
    rmse = math.sqrt(rss_cur / n)
    if p[1] < 0:
        p = list(p)
        p[1] = -p[1]
        p[4] += math.pi
        p[5] = 1 - p[5]
    p[4] = math.atan2(math.sin(p[4]), math.cos(p[4]))
    M, A, k, w, phi, d = p
    period = 2 * math.pi / w
    acro = (math.pi / 2 - phi) / w
    acro = math.fmod(math.fmod(acro, period) + period, period)
    side = None
    if w_pos >= 0:
        if abs(w - w_lo) <= _BOUND_RTOL * w_lo:
            side = 'max'
        elif abs(w - w_hi) <= _BOUND_RTOL * w_hi:
            side = 'min'
    all_finite = all(math.isfinite(v) for v in p) and math.isfinite(rss_cur)
    return {'parameters': {'M': M, 'A': A, 'kappa': k, 'omega': w, 'phi': phi,
                           'dutyCycle': d},
            'period': period, 'acrophase': acro, 'fitted': fitted, 'rmse': rmse,
            'rSquared': r2, 'rss': rss_cur,
            'diagnostics': {'converged': converged and all_finite, 'iterations': iterations,
                            'atBound': [side]}}


def fit_rectangular_wave(t, x, options=None):
    """Port of utils/rectwave.js fitRectangularWave (FIT-1): f(t) = M + A tanh(kappa
    (sin(omega t + phi) - cos(pi d))), the JS multi-start Levenberg-Marquardt step for step.
    A free period is bounded to [minPeriod, maxPeriod] (default 1-48 h, resolve_period_range);
    start s seeds omega from the s-th peak of the least-squares periodogram in that range
    (2 pi / 24 with none) and phi = pi/2 - atan2(S, C). Returns None for an empty range or
    when every start fails. Callers pass the valid (t, x) pairs.

    This replaced a scipy least_squares fit with 4 fixed period seeds and an unbounded
    period, which agreed with the app only approximately (~1e-3 on the parity fixture)."""
    o = options or {}
    t = [float(v) for v in t]
    x = [float(v) for v in x]
    if len(t) != len(x):
        raise ValueError('Arrays t and x must have the same length')
    fix_kappa = bool(o.get('fixKappa', False))
    fix_omega = bool(o.get('fixOmega', False))
    fix_d = bool(o.get('fixDutyCycle', o.get('fixD', False)))
    fixed_kappa = o.get('fixedKappa', 5) if o.get('fixedKappa') is not None else 5
    fixed_omega = o.get('fixedOmega')
    fixed_d = o.get('fixedDutyCycle', 0.5) if o.get('fixedDutyCycle') is not None else 0.5
    max_iter = int(o.get('maxIterations') or 10000)
    tol = o.get('tolerance') or 1e-6
    n_starts = int(o.get('numStarts') or 5)
    min_p = o.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod'])
    max_p = o.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod'])
    if fix_omega and not (_finite(fixed_omega) and fixed_omega > 0):
        raise ValueError('fit_rectangular_wave: fixOmega needs a positive finite fixedOmega')
    w_lo, w_hi = 0.001, 100.0
    rng = None
    peaks = None
    if not fix_omega:
        rng = resolve_period_range(t, min_p, max_p)
        if not rng:
            return None
        w_lo = 2 * math.pi / rng['maxPeriod']
        w_hi = 2 * math.pi / rng['minPeriod']
        peaks = [2 * math.pi * f for f in
                 scan_periodogram(t, x, rng['minPeriod'], rng['maxPeriod'], n_starts)]
    free = [0, 1, 4]
    if not fix_kappa:
        free.append(2)
    if not fix_omega:
        free.append(3)
    if not fix_d:
        free.append(5)
    free.sort()
    n = len(x)
    if n == 0:
        return None
    mean = sum(x) / n
    half = (max(x) - min(x)) / 2
    d_seeds = [0.5, 0.3, 0.7, 0.4, 0.6]
    k_seeds = [5, 2, 10, 3, 8]
    best, best_rmse = None, math.inf
    for st in range(n_starts):
        if fix_omega and fixed_omega is not None:
            w = fixed_omega
        else:
            seeds = peaks or []
            w = seeds[min(st, len(seeds) - 1)] if seeds else 2 * math.pi / 24
            w = min(w_hi, max(w_lo, w))
        kap = fixed_kappa if fix_kappa else k_seeds[st % len(k_seeds)]
        d = fixed_d if fix_d else d_seeds[st % len(d_seeds)]
        cs = sum((xi - mean) * math.cos(w * ti) for ti, xi in zip(t, x))
        sn = sum((xi - mean) * math.sin(w * ti) for ti, xi in zip(t, x))
        params = [mean, half if half > 0 else 1, kap, w, math.pi / 2 - math.atan2(sn, cs), d]
        try:
            res = _rw_fit_lm(t, x, params, free, max_iter, tol, w_lo, w_hi)
        except (ValueError, ZeroDivisionError, OverflowError):
            continue
        if res['rmse'] < best_rmse:
            best_rmse, best = res['rmse'], res
    if best is not None:
        best['diagnostics']['periodRange'] = ([rng['minPeriod'], rng['maxPeriod']]
                                              if rng else None)
        if fix_omega:
            best['diagnostics']['atBound'] = [None]
    return best


def evaluate_rectwave_at_points(parameters, x_points):
    M = parameters['M']
    A = parameters['A']
    k = parameters['kappa']
    w = parameters['omega']
    phi = parameters['phi']
    d = parameters['dutyCycle']
    xa = np.asarray(x_points, dtype=float)
    return (M + A * np.tanh(k * (np.sin(w * xa + phi) - math.cos(math.pi * d)))).tolist()


# ----------------------------------------------------------------------
# Double logistic
# ----------------------------------------------------------------------

def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-np.clip(z, -50, 50)))


def _sig_js(z):
    """doublelogistic.js sigmoid 1 / (1 + exp(-z)), with JS overflow semantics (exp(-z)
    = Infinity gives 0)."""
    try:
        return 1.0 / (1.0 + math.exp(-z))
    except OverflowError:
        return 0.0


_DL_U_LIMIT = 30


def _dl_jrange(t_arr, t1, t2, T):
    return (math.floor((min(t_arr) - max(t1, t2)) / T) - 1,
            math.ceil((max(t_arr) - min(t1, t2)) / T) + 1)


def _dl_eval_np(t, p):
    M, A, k1, t1, k2, t2 = p[:6]
    return M + A * (_sig_js(k1 * (t - t1)) - _sig_js(k2 * (t - t2)))


def _dl_eval_p(t, p, jr):
    M, A, k1, t1, k2, t2, T = p
    out = M
    for j in range(jr[0], jr[1] + 1):
        out += A * (_sig_js(k1 * (t - t1 - j * T)) - _sig_js(k2 * (t - t2 - j * T)))
    return out


def _dl_to_model(q):
    return [q[0], q[1], q[2], q[3], q[4], q[3] + q[6] * _sig_js(q[5]), q[6]]


def canonical_periodic_params(m):
    """doublelogistic.js canonicalPeriodicParams: the A >= 0 form of a periodic vector."""
    if not (m[1] < 0):
        return m
    M, A, k1, t1, k2, t2, T = m
    return [M + A, -A, k2, t2, k1, t1 + T, T]


def _dl_ne_np(t, x, p, free):
    nf = len(free)
    JtJ = [[0.0] * nf for _ in range(nf)]
    JtR = [0.0] * nf
    rss = 0.0
    _, A, k1, t1, k2, t2 = p[:6]
    for ti, xi in zip(t, x):
        r = xi - _dl_eval_np(ti, p)
        rss += r * r
        s1 = _sig_js(k1 * (ti - t1))
        s2 = _sig_js(k2 * (ti - t2))
        s1p, s2p = s1 * (1 - s1), s2 * (1 - s2)
        jf = (-1.0, -(s1 - s2), -A * s1p * (ti - t1), A * k1 * s1p, A * s2p * (ti - t2),
              -A * k2 * s2p)
        row = [jf[i] for i in free]
        for a_ in range(nf):
            JtR[a_] += row[a_] * r
            for b_ in range(a_, nf):
                JtJ[a_][b_] += row[a_] * row[b_]
    for a_ in range(nf):
        for b_ in range(a_ + 1, nf):
            JtJ[b_][a_] = JtJ[a_][b_]
    return JtJ, JtR, rss


def _dl_ne_pu(t, x, q, free):
    """Periodic normal equations in the optimiser's (t1, u, T) coordinates."""
    m = _dl_to_model(q)
    nf = len(free)
    JtJ = [[0.0] * nf for _ in range(nf)]
    JtR = [0.0] * nf
    rss = 0.0
    _, A, k1, t1, k2, t2, T = m
    sg = _sig_js(q[5])
    jr = _dl_jrange(t, t1, t2, T)
    for ti, xi in zip(t, x):
        a1 = b1 = c1 = d1 = e1 = f1 = g1 = 0.0
        for j in range(jr[0], jr[1] + 1):
            s1 = _sig_js(k1 * (ti - t1 - j * T))
            s2 = _sig_js(k2 * (ti - t2 - j * T))
            s1p, s2p = s1 * (1 - s1), s2 * (1 - s2)
            a1 += s1 - s2
            b1 += s1p * (ti - t1 - j * T)
            c1 += s1p
            d1 += s2p * (ti - t2 - j * T)
            e1 += s2p
            f1 += j * k1 * s1p
            g1 += j * k2 * s2p
        r = xi - (m[0] + A * a1)
        rss += r * r
        dT1 = A * k1 * c1
        dT2 = -A * k2 * e1
        dT = A * (f1 - g1)
        jf = (-1.0, -a1, -A * b1, dT1 + dT2, A * d1, dT2 * T * sg * (1 - sg), dT + dT2 * sg)
        row = [jf[i] for i in free]
        for a_ in range(nf):
            JtR[a_] += row[a_] * r
            for b_ in range(a_, nf):
                JtJ[a_][b_] += row[a_] * row[b_]
    for a_ in range(nf):
        for b_ in range(a_ + 1, nf):
            JtJ[b_][a_] = JtJ[a_][b_]
    return JtJ, JtR, rss


def _dl_fit_lm(t, x, params, free, periodic, max_iter, tol, t_lo=0.1, t_hi=math.inf):
    """doublelogistic.js fitWithLM, step for step."""
    p = list(params)
    if periodic:
        p[6] = min(t_hi, max(t_lo, p[6]))
        frac = min(0.98, max(0.02, (params[5] - params[3]) / p[6]))
        p[5] = math.log(frac / (1 - frac))
    ne = (lambda pp: _dl_ne_pu(t, x, pp, free)) if periodic else \
        (lambda pp: _dl_ne_np(t, x, pp, free))
    t_pos = free.index(6) if (periodic and 6 in free) else -1
    lam = 0.01
    JtJ, JtR, rss_cur = ne(p)
    converged = False
    iterations = 0
    for it in range(max_iter):
        iterations = it + 1
        frozen = t_pos >= 0 and ((p[6] <= t_lo and JtR[t_pos] > 0)
                                 or (p[6] >= t_hi and JtR[t_pos] < 0))
        JtJ_d = []
        for i, row in enumerate(JtJ):
            if frozen and i == t_pos:
                JtJ_d.append([1.0 if k_ == i else 0.0 for k_ in range(len(row))])
                continue
            r_ = [0.0 if (frozen and k_ == t_pos) else v for k_, v in enumerate(row)]
            r_[i] += lam * (row[i] if row[i] > 0 else 1)
            JtJ_d.append(r_)
        rhs = [0.0 if (frozen and i == t_pos) else v for i, v in enumerate(JtR)]
        try:
            delta = _solve_linear_js(JtJ_d, rhs)
        except ValueError:
            lam = min(lam * 10, 1e12)
            if lam >= 1e12:
                converged = True
                break
            continue
        new_p = list(p)
        for j, idx in enumerate(free):
            new_p[idx] = p[idx] - delta[j]
        new_p[2] = max(1e-4, new_p[2])
        new_p[4] = max(1e-4, new_p[4])
        if periodic:
            new_p[6] = min(t_hi, max(t_lo, new_p[6]))
            new_p[5] = min(_DL_U_LIMIT, max(-_DL_U_LIMIT, new_p[5]))
        elif new_p[5] <= new_p[3]:
            new_p[5] = new_p[3] + 0.01
        nJtJ, nJtR, rss_new = ne(new_p)
        if rss_new < rss_cur:
            rel = (rss_cur - rss_new) / (rss_cur + 1e-10)
            p, JtJ, JtR, rss_cur = new_p, nJtJ, nJtR, rss_new
            lam = max(lam / 3, 1e-10)
            if rel < tol:
                converged = True
                break
        else:
            lam = min(lam * 10, 1e12)
            if lam >= 1e12:
                converged = True
                break
    n = len(t)
    side = None
    if t_pos >= 0:
        if abs(p[6] - t_hi) <= _BOUND_RTOL * t_hi:
            side = 'max'
        elif abs(p[6] - t_lo) <= _BOUND_RTOL * t_lo:
            side = 'min'
    all_finite = all(math.isfinite(v) for v in p) and math.isfinite(rss_cur)
    m = canonical_periodic_params(_dl_to_model(p)) if periodic else p
    if periodic:
        jr = _dl_jrange(t, m[3], m[5], m[6])
        fitted = [_dl_eval_p(ti, m, jr) for ti in t]
    else:
        fitted = [_dl_eval_np(ti, m) for ti in t]
    km = KahanSum()
    for v in x:
        km.add(v)
    xm = km.value() / n
    kt, kr = KahanSum(), KahanSum()
    for v in x:
        kt.add((v - xm) ** 2)
    for i in range(n):
        kr.add((x[i] - fitted[i]) ** 2)
    rss = kr.value()
    r2 = 1 - rss / kt.value() if kt.value() > 0 else 0.0
    M, A, k1, t1, k2, t2 = m[:6]
    T = m[6] if periodic else None
    dur = t2 - t1
    return {'parameters': {'M': M, 'A': A, 'k1': k1, 't1': t1, 'k2': k2, 't2': t2, 'T': T},
            'duration': dur,
            'onsetPhase': math.fmod(math.fmod(t1, T) + T, T) if periodic else None,
            'offsetPhase': math.fmod(math.fmod(t2, T) + T, T) if periodic else None,
            'dutyCycle': dur / T if periodic else None,
            'fitted': fitted, 'rmse': math.sqrt(rss / n), 'rSquared': r2, 'rss': rss,
            'diagnostics': {'converged': converged and all_finite, 'iterations': iterations,
                            'atBound': [side]}}


def _dl_guess_np(t, x, seed, fix_k1, fix_k2, fk1, fk2):
    n = len(x)
    t_min, t_max = min(t), max(t)
    tr = t_max - t_min
    mean = sum(x) / n
    x_min = min(x)
    A = (max(x) - x_min) * (1 + 0.1 * seed)
    above = [ti for ti, xi in zip(t, x) if xi > mean]
    t1e, t2e = t_min + tr * 0.25, t_min + tr * 0.75
    if len(above) > 2:
        t1e, t2e = above[0], above[-1]
    offs = [0, -0.15, 0.15, -0.3, 0.3]
    shift = tr * offs[seed % len(offs)]
    t1 = t1e + shift
    t2 = max(t1 + 0.01, t2e + shift)
    ks = [0.5, 0.2, 1.0, 0.3, 0.8]
    return [x_min, A, fk1 if fix_k1 else ks[seed % 5], t1, fk2 if fix_k2 else ks[seed % 5], t2]


def _dl_guess_p(t, x, seed, fix_k1, fix_k2, fix_p, fk1, fk2, fp, peaks, t_lo, t_hi):
    n = len(x)
    mean = sum(x) / n
    x_min = min(x)
    A = max(x) - x_min
    if fix_p:
        T = fp
    else:
        seeds = peaks or []
        T = seeds[min(seed, len(seeds) - 1)] if seeds else 24
        T = min(math.inf if t_hi is None else t_hi, max(0 if t_lo is None else t_lo, T))
    ks = [0.5, 0.2, 1.0, 0.3, 0.8]
    k1 = fk1 if fix_k1 else ks[seed % 5]
    k2 = fk2 if fix_k2 else ks[seed % 5]
    t_min = min(t)
    dc = [0.5, 0.3, 0.7, 0.4, 0.6][seed % 5]
    above = sorted(math.fmod(math.fmod(ti - t_min, T) + T, T)
                   for ti, xi in zip(t, x) if xi > mean)
    onset = T * (0.5 - dc / 2)
    dur = T * dc
    if len(above) > 2:
        gap = above[0] + T - above[-1]
        after = 0
        for i in range(1, len(above)):
            g = above[i] - above[i - 1]
            if g > gap:
                gap, after = g, i
        onset = above[after]
        dur = min(0.98 * T, max(0.02 * T, T - gap))
    t1 = t_min + onset
    return [x_min, A, k1, t1, k2, t1 + dur, T]


def fit_double_logistic(t, x, options=None):
    """Port of utils/doublelogistic.js fitDoubleLogistic (FIT-1, FIT-2), the JS multi-start
    Levenberg-Marquardt step for step. Periodic mode optimises [M, A, k1, t1, k2, u, T] with
    t2 = t1 + T sigmoid(u) (|u| <= 30) so tiles never overlap, keeps a free T inside
    [minPeriod, maxPeriod] (default 1-48 h) with periodogram-peak starts, and reports the
    canonical A >= 0 form with duration t2 - t1 and dutyCycle = duration / T. Callers pass
    the valid (t, x) pairs. None for an empty range or when every start fails.

    This replaced a scipy least_squares fit (record-span period init, t1/t2 free) that only
    matched the app's fit quality approximately."""
    o = options or {}
    t = [float(v) for v in t]
    x = [float(v) for v in x]
    if len(t) != len(x):
        raise ValueError('Arrays t and x must have the same length')
    if not t:
        return None

    def g(k, d):
        v = o.get(k)
        return d if v is None else v
    periodic = bool(g('periodic', False))
    fix_k1, fix_k2 = bool(g('fixK1', False)), bool(g('fixK2', False))
    fix_p = bool(g('fixPeriod', o.get('fixT', False)))
    fk1, fk2 = g('fixedK1', 0.5), g('fixedK2', 0.5)
    fp = g('fixedPeriod', o.get('T', 24))
    max_iter, tol, n_starts = int(g('maxIterations', 10000)), g('tolerance', 1e-6), \
        int(g('numStarts', 5))
    rng = None
    peaks = None
    t_lo, t_hi = 0.1, math.inf
    if periodic and not fix_p:
        rng = resolve_period_range(t, g('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
                                   g('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod']))
        if not rng:
            return None
        t_lo, t_hi = rng['minPeriod'], rng['maxPeriod']
        peaks = [1.0 / f for f in scan_periodogram(t, x, t_lo, t_hi, n_starts)]
    free = [0, 1, 3, 5]
    if not fix_k1:
        free.append(2)
    if not fix_k2:
        free.append(4)
    if periodic and not fix_p:
        free.append(6)
    free.sort()
    best, best_rmse = None, math.inf
    for st in range(n_starts):
        params = (_dl_guess_p(t, x, st, fix_k1, fix_k2, fix_p, fk1, fk2, fp, peaks, t_lo, t_hi)
                  if periodic else _dl_guess_np(t, x, st, fix_k1, fix_k2, fk1, fk2))
        if fix_k1:
            params[2] = fk1
        if fix_k2:
            params[4] = fk2
        if periodic and fix_p:
            params[6] = fp
        try:
            res = _dl_fit_lm(t, x, params, free, periodic, max_iter, tol, t_lo, t_hi)
        except (ValueError, ZeroDivisionError, OverflowError):
            continue
        if res['rmse'] < best_rmse:
            best_rmse, best = res['rmse'], res
    if best is not None:
        best['diagnostics']['periodRange'] = ([rng['minPeriod'], rng['maxPeriod']]
                                              if rng else None)
    return best


def evaluate_dl_at_points(parameters, x_points, periodic=False):
    """doublelogistic.js evaluateDoubleLogisticAtPoints (tile range from computeJRange)."""
    pts = [float(v) for v in x_points]
    pr = parameters
    if periodic:
        m = [pr['M'], pr['A'], pr['k1'], pr['t1'], pr['k2'], pr['t2'], pr['T']]
        if not pts:
            return []
        jr = _dl_jrange(pts, m[3], m[5], m[6])
        return [_dl_eval_p(v, m, jr) for v in pts]
    m = [pr['M'], pr['A'], pr['k1'], pr['t1'], pr['k2'], pr['t2']]
    return [_dl_eval_np(v, m) for v in pts]


# ----------------------------------------------------------------------
# Smoothing
# ----------------------------------------------------------------------

def whittaker_eilers(y, lam=100.0, order=2):
    y = _to_float_arr(y)
    n = y.size
    if n < 3 or n <= order:  # smoothing.js whittakerEilers returns y unchanged here
        return y.tolist()
    # Build difference matrix D of order `order`
    D = np.eye(n)
    for _ in range(order):
        D = np.diff(D, axis=0)
    W = np.eye(n)
    A = W + lam * D.T @ D
    z = np.linalg.solve(A, y)
    return z.tolist()


def savitzky_golay(y, window_size=5, poly_order=2):
    """smoothing.js savitzkyGolay: the least-squares polynomial's centre weights applied to
    every FULL window; the first and last floor(window/2) points are left as they are (the
    JS does not shrink the window at the ends, and a window longer than the series leaves it
    untouched). An even window grows by one."""
    y = [float(v) for v in y]
    n = len(y)
    window_size = int(window_size)
    if window_size % 2 == 0:
        window_size += 1
    half = window_size // 2
    out = list(y)
    if n - half <= half:
        return out
    A = np.array([[float(i) ** j for j in range(int(poly_order) + 1)]
                  for i in range(-half, half + 1)])
    try:
        coeffs = (np.linalg.inv(A.T @ A) @ A.T)[0]
    except np.linalg.LinAlgError:
        coeffs = np.full(window_size, np.nan)  # the JS inversion divides by a zero pivot
    for i in range(half, n - half):
        acc = 0.0
        for j in range(-half, half + 1):
            acc += coeffs[j + half] * y[i + j]
        out[i] = float(acc)
    return out


def loess(x, y, bandwidth=0.3):
    """smoothing.js loess, step for step: h = max(floor(bandwidth * n), 1) nearest points
    (ties in index order, a stable sort), tricube weights on distance / max distance, a
    weighted straight line, or the weighted mean when the line is degenerate."""
    xs = [float(v) for v in x]
    ys = [float(v) for v in y]
    n = len(xs)
    h = max(int(math.floor(bandwidth * n)), 1)
    out = [0.0] * n
    for i in range(n):
        xi = xs[i]
        nb = sorted(range(n), key=lambda j: abs(xi - xs[j]))[:h]
        max_d = abs(xi - xs[nb[-1]])
        sw = swx = swy = swxx = swxy = 0.0
        for j in nb:
            u = abs(xi - xs[j]) / (max_d or 1)
            w = 0.0 if u >= 1 else (1 - u ** 3) ** 3
            sw += w
            swx += w * xs[j]
            swy += w * ys[j]
            swxx += w * xs[j] * xs[j]
            swxy += w * xs[j] * ys[j]
        denom = sw * swxx - swx * swx
        if abs(denom) < 1e-10:
            out[i] = swy / sw if sw != 0 else float('nan')
        else:
            slope = (sw * swxy - swx * swy) / denom
            out[i] = slope * xi + (swy - slope * swx) / sw
    return out


def moving_average(y, window_size=5, kind='simple'):
    """smoothing.js movingAverage, exactly: a centred window of floor(windowSize / 2) each
    side, clipped at the ends. Missing values (house rule) are skipped. 'weighted' weights a
    neighbour max(0, windowSize - distance); 'exponential' weights it
    exp(-distance / (windowSize / 3)). A window with nothing usable keeps the input value.
    (The port used to run a one-sided EMA and 1..k ramp weights, which are different filters.)"""
    y = list(y)
    n = len(y)
    out = list(y)
    half = int(math.floor(window_size / 2))
    for i in range(n):
        total = 0.0
        count = 0
        weight_sum = 0.0
        for j in range(max(0, i - half), min(n - 1, i + half) + 1):
            if _js_invalid(y[j]):
                continue
            yj = _js_number(y[j])
            d = abs(i - j)
            if kind == 'simple':
                total += yj
                count += 1
            elif kind == 'weighted':
                w = max(0, window_size - d)
                total += yj * w
                weight_sum += w
            elif kind == 'exponential':
                w = math.exp(-d / (window_size / 3))
                total += yj * w
                weight_sum += w
        if kind == 'simple':
            out[i] = total / count if count > 0 else y[i]
        else:
            out[i] = total / weight_sum if weight_sum > 0 else y[i]
    return out


def smooth_arrays(x_vals, y_vals, smoother_type, options=None):
    """smoothing.js smoothArrays: (x, smoothed y) for pre-filtered, x-sorted arrays. Options
    use the JS names (whittakerLambda, savitzkyWindowSize, loessBandwidth, movingAvgType, ...);
    an unknown smoother type is the moving average."""
    return list(x_vals), _smooth_dispatch(list(x_vals), list(y_vals), smoother_type,
                                          options or {})


# ----------------------------------------------------------------------
# Trend fit
# ----------------------------------------------------------------------

def fit_trend(x, y, model='linear', poly_degree=2):
    xa = _to_float_arr(x); ya = _to_float_arr(y)
    if model == 'linear':
        reg = linear_regression(xa, ya)
        fitted = (reg['slope'] * xa + reg['intercept']).tolist()
        return {'parameters': {'slope': reg['slope'], 'intercept': reg['intercept']},
                'fitted': fitted, 'rmse': reg['rmse'], 'rSquared': reg['rSquared']}
    if model == 'exponential':
        reg = linear_regression(xa, np.log(ya))
        a = math.exp(reg['intercept']); b = reg['slope']
        fitted = (a * np.exp(b * xa)).tolist()
        rss = float(((ya - np.array(fitted)) ** 2).sum())
        ss_tot = float(((ya - ya.mean()) ** 2).sum())
        r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
        return {'parameters': {'a': a, 'b': b}, 'fitted': fitted,
                'rmse': math.sqrt(rss / xa.size), 'rSquared': r2}
    if model == 'logarithmic':
        reg = linear_regression(np.log(xa), ya)
        a = reg['intercept']; b = reg['slope']
        fitted = (a + b * np.log(xa)).tolist()
        rss = float(((ya - np.array(fitted)) ** 2).sum())
        ss_tot = float(((ya - ya.mean()) ** 2).sum())
        r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
        return {'parameters': {'a': a, 'b': b}, 'fitted': fitted,
                'rmse': math.sqrt(rss / xa.size), 'rSquared': r2}
    if model == 'polynomial':
        coeffs = np.polyfit(xa, ya, poly_degree)[::-1]  # ascending
        fitted = np.polyval(coeffs[::-1], xa).tolist()
        rss = float(((ya - np.array(fitted)) ** 2).sum())
        ss_tot = float(((ya - ya.mean()) ** 2).sum())
        r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
        return {'parameters': {'coeffs': coeffs.tolist()}, 'fitted': fitted,
                'rmse': math.sqrt(rss / xa.size), 'rSquared': r2}
    return None


def evaluate_trend_at_points(parameters, model, x_points):
    xa = np.asarray(x_points, dtype=float)
    if model == 'linear':
        return (parameters['slope'] * xa + parameters['intercept']).tolist()
    if model == 'exponential':
        return (parameters['a'] * np.exp(parameters['b'] * xa)).tolist()
    if model == 'logarithmic':
        return (parameters['a'] + parameters['b'] * np.log(xa)).tolist()
    if model == 'polynomial':
        coeffs = parameters['coeffs']  # ascending
        return np.polyval(list(reversed(coeffs)), xa).tolist()
    return [float('nan')] * xa.size


# ----------------------------------------------------------------------
# Column model
# ----------------------------------------------------------------------

# dayjs token -> strptime directive. Longest first: MMMM must not be eaten by MM.
_DAYJS_TO_STRPTIME = [
    ('YYYY', '%Y'), ('YY', '%y'),
    ('MMMM', '%B'), ('MMM', '%b'), ('MM', '%m'), ('M', '%m'),
    ('DD', '%d'), ('D', '%d'),
    ('HH', '%H'), ('H', '%H'),
    ('hh', '%I'), ('h', '%I'),
    ('mm', '%M'), ('m', '%M'),
    ('ss', '%S'), ('s', '%S'),
    # %f reads 1-6 digits zero-padded on the RIGHT, so ".500" is 500000us = 500ms.
    ('SSS', '%f'),
    ('A', '%p'), ('a', '%p'),
    ('ZZ', '%z'), ('Z', '%z'),
]


def strptime_from_dayjs(fmt):
    """Translate the session's stored dayjs format into a strptime format.

    The app stores a dayjs format string (normalizeTimeFormat in TimeUtils.js) and
    parses STRICTLY against it. Both ports used to ignore it and auto-detect, which
    is fine for unambiguous ISO-8601 and wrong for anything else: the app's own
    format guesser returns BOTH candidates for an ambiguous day/month pair and asks
    the user to choose, so a session can legitimately carry DD/MM/YYYY. Re-guessing
    in the export then disagrees with the app by two months, silently, on data the
    user already disambiguated.

    Returns None when there is no format (epoch-ms columns, and older sessions),
    which leaves the caller on the auto-detect path it used before.
    """
    if not fmt or not isinstance(fmt, str):
        return None
    out, i = [], 0
    while i < len(fmt):
        ch = fmt[i]
        # [literal] — dayjs's escape. Emit verbatim, and protect any % inside it.
        if ch == '[':
            end = fmt.find(']', i)
            if end == -1:
                out.append(ch.replace('%', '%%'))
                i += 1
                continue
            out.append(fmt[i + 1:end].replace('%', '%%'))
            i = end + 1
            continue
        for token, directive in _DAYJS_TO_STRPTIME:
            if fmt.startswith(token, i):
                out.append(directive)
                i += len(token)
                break
        else:
            out.append('%%' if ch == '%' else ch)
            i += 1
    return ''.join(out)


# Digit width each numeric dayjs token accepts in the JS engine. strptime's %H, %M,
# %S, %d and %m read one OR two digits, but the app parses with dayjs strict mode,
# where a double-width token (HH mm ss DD MM hh) needs exactly two digits and a
# single-width one (H m s D M h) takes one or two (parseTimeStrict in TimeUtils.js).
# Without this gate the ports read "9:30:00" under HH:mm:ss, which the app leaves
# blank. Tokens not listed (month names, meridiem, offsets) are not width-checked.
_DAYJS_WIDTHS = {
    'YYYY': r'\d{4}', 'YY': r'\d{2}',
    'MM': r'\d{2}', 'M': r'\d{1,2}',
    'DD': r'\d{2}', 'D': r'\d{1,2}',
    'HH': r'\d{2}', 'H': r'\d{1,2}',
    'hh': r'\d{2}', 'h': r'\d{1,2}',
    'mm': r'\d{2}', 'm': r'\d{1,2}',
    'ss': r'\d{2}', 's': r'\d{1,2}',
    'SSS': r'\d{3}',
}


def dayjs_width_pattern(fmt):
    """Compiled regex a value must fully match to have the digit widths `fmt` allows.

    Mirrors the JS engine's strictness on numeric token widths (see _DAYJS_WIDTHS).
    Returns None when there is no format.
    """
    if not fmt or not isinstance(fmt, str):
        return None
    out, i = [], 0
    while i < len(fmt):
        ch = fmt[i]
        if ch == '[':
            end = fmt.find(']', i)
            if end != -1:
                out.append(re.escape(fmt[i + 1:end]))
                i = end + 1
                continue
        for token, _ in _DAYJS_TO_STRPTIME:
            if fmt.startswith(token, i):
                out.append(_DAYJS_WIDTHS.get(token, '.+?'))
                i += len(token)
                break
        else:
            out.append(re.escape(ch))
            i += 1
    return re.compile(''.join(out))


@dataclass
class Column:
    id: int
    name: str
    type: str = 'number'  # 'time'|'number'|'category'|'bin'
    data: Any = None  # raw payload key into RAW_DATA, or list, or {start,step,length}
    raw_data: dict = field(default_factory=dict)
    time_format: str | None = None
    # Column.binWidth: set only on columns that carry bins (a 'bin' column, and the x
    # outputs of BinnedData and MovingAnalysis); None everywhere else, as in the app, where
    # plots test it for truthiness (the actogram's bar width, the correlogram's step).
    bin_width: float | None = None
    compression: str | None = None
    ref_id: int | None = None  # if this column is referencial
    group_label: str | None = None  # per-column group/replicate label (metadata; not used in compute)
    columns_index: dict = field(default_factory=dict)  # {id: Column}
    processes: list = field(default_factory=list)  # [(funcname, args)]
    # Column.originTime_ms: the epoch ms a binned/analysis x output counts its hours from
    # (BinnedData on a time input, an imported bin column such as the Enspire wells).
    origin_time_ms: float | None = None
    # Column.cutsList: the edges of a BinnedData x output in cuts mode. Such a column has
    # binWidth null in the app, so its getData adds null / 2 = 0 and reads the bin starts.
    cuts_list: list | None = None

    def is_referencial(self):
        return self.ref_id is not None

    def _ref(self):
        return self.columns_index.get(self.ref_id) if self.is_referencial() else None

    @property
    def eff_bin_width(self):
        """Column.binWidth: a referencial column reads its source's."""
        if self.is_referencial():
            ref = self._ref()
            return ref.eff_bin_width if ref else None
        return self.bin_width

    @property
    def eff_origin_time_ms(self):
        """Column.originTime_ms: a referencial column reads its source's."""
        if self.is_referencial():
            ref = self._ref()
            return ref.eff_origin_time_ms if ref else None
        return self.origin_time_ms

    @property
    def raw_first(self):
        """The first STORED value (for a 'bin' column, the raw first bin start, before
        getData centres it), 0 when there is none: the actogram's
        `core.rawData.get(x.data ?? x.refColumn.data)?.[0] ?? 0`."""
        key = self.data
        if key is None and self.is_referencial():
            ref = self._ref()
            key = ref.data if ref else None
        raw = self.raw_data.get(key) if key is not None else None
        if isinstance(raw, (list, tuple)) and raw and raw[0] is not None:
            return raw[0]
        return 0

    def _decompress(self, raw):
        if self.compression == 'awd' and isinstance(raw, dict):
            start = raw['start']; step = raw['step']; length = raw['length']
            return [start + i * step for i in range(int(length))]
        return list(raw)

    def get_data(self):
        if self.is_referencial():
            ref = self.columns_index.get(self.ref_id)
            return ref.get_data() if ref else []
        raw = self.raw_data.get(self.data, [])
        data = self._decompress(raw)
        if self.type == 'time' and self.compression != 'awd':
            # Already-numeric (UNIX ms, e.g. written by SimulatedData TP): leave alone.
            # Judged on the first PRESENT value: judging on data[0] sent an epoch-ms column
            # whose first time is missing through pd.to_datetime, which reads integers as
            # NANOseconds, so every time shrank a millionfold (fixture
            # correlogram-data-missing-ends).
            first = next((v for v in data if v is not None and v != ''), None)
            if first is not None and not isinstance(first, (int, float)):
                fmt = strptime_from_dayjs(self.time_format)
                parsed = None
                widths = dayjs_width_pattern(self.time_format)
                if widths is not None:
                    # Values the app's strict parse rejects on digit width are gaps.
                    data = [v if isinstance(v, str) and widths.fullmatch(v) else None
                            for v in data]
                if fmt:
                    # Honour the session's OWN format when there is one. Auto-detection
                    # is not a safe substitute: "01/03/2026" under DD/MM/YYYY is 1 March
                    # and under MM/DD/YYYY is 3 January, and the app deliberately asks
                    # the user which they meant (guessTimeFormat returns both candidates
                    # for an ambiguous pair). Guessing again here can silently disagree
                    # with the app by two months on data the user already disambiguated.
                    try:
                        parsed = pd.to_datetime(data, format=fmt, errors='coerce', utc=True)
                        # A format that matches nothing means the translation was wrong,
                        # not that the data is bad — fall back rather than return all-NaT.
                        if parsed.isna().all() and any(
                                v not in (None, '') for v in data):
                            parsed = None
                    except Exception:
                        parsed = None
                if parsed is None:
                    try:
                        parsed = pd.to_datetime(data, errors='coerce', utc=True)
                    except Exception:
                        parsed = None
                if parsed is not None:
                    # Epoch MS, tz-safe and resolution-independent (pandas >=2
                    # datetime resolution varies, so a fixed //10**6 from ns and
                    # a tz-aware datetime64[ms] cast are both unreliable).
                    epoch = pd.Timestamp('1970-01-01', tz='UTC')
                    data = ((parsed - epoch) // pd.Timedelta('1ms')).tolist()
        if self.type == 'bin':
            # getData reports bin CENTRES: start + binWidth / 2. A uniform bin column always
            # carries binWidth in the app; 1.0 stands in for one saved without it (the ports'
            # old default). A cuts column's binWidth is null, which the app's arithmetic
            # reads as 0, so it reports its starts.
            if self.cuts_list is not None:
                half = 0.0
            else:
                half = (self.bin_width if self.bin_width is not None else 1.0) / 2
            data = [v + half if isinstance(v, (int, float)) and math.isfinite(v) else v
                    for v in data]
        # Apply column processes (entries are dicts with funcname/name + args)
        for entry in self.processes:
            funcname = entry.get('funcname') or entry.get('name')
            args = entry.get('args', {})
            if funcname:
                key = funcname.lower().replace(' ', '')
                data = run_column_process(key, data, args, self.columns_index)
        return data

    @property
    def hours_since_start(self):
        d = self.get_data()
        if not d:
            return []
        arr = np.array([np.nan if v is None else v for v in d], dtype=float)
        baseline = float(np.nanmin(arr))
        if self.type == 'time':
            return ((arr - baseline) / 3600000.0).tolist()
        return (arr - baseline).tolist()


# ----------------------------------------------------------------------
# Column processes (8)
# ----------------------------------------------------------------------

def _proc_add(x, args, _cols):
    # Add.svelte: missing in (house rule: None, blank, whitespace, text, NaN) -> None out;
    # numeric text is its value. value = Number(args.value), so an absent value is NaN.
    v = _js_number(args['value']) if 'value' in args else float('nan')
    return [None if _js_invalid(xi) else _js_number(xi) + v for xi in x]


def _sub_as_number(v):
    """Sub.svelte asNumber: a number, or a non-blank numeric string, as a number; else None.
    Booleans are not numbers here."""
    if isinstance(v, (bool, np.bool_)):
        return None
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    if isinstance(v, str) and v.strip(_JS_WS) != '' and not math.isnan(_js_number(v)):
        return _js_number(v)
    return None


def sub_matches(v, find):
    """Sub.svelte subMatches: None matches only None; numeric compare when both sides are
    numbers or non-blank numeric strings ('2' is 2; NaN matches nothing); otherwise String()
    equality (so true does not match 1, and '' does not match 0)."""
    if find is None:
        return v is None
    if v is None:
        return False
    a, b = _sub_as_number(v), _sub_as_number(find)
    if a is not None and b is not None:
        return a == b
    return _js_string(v) == _js_string(find)


def _proc_substitute(x, args, _cols):
    find = args.get('find')
    replace = args.get('replace')
    return [replace if sub_matches(xi, find) else xi for xi in x]


def _proc_multiply(x, args, _cols):
    # Multiply.svelte: missing in -> None out, as Add.
    v = _js_number(args['value']) if 'value' in args else float('nan')
    return [None if _js_invalid(xi) else _js_number(xi) * v for xi in x]


def _proc_editvalue(x, args, _cols):
    out = list(x)
    for edit in args.get('edits', []):
        pos = int(edit['position']) - 1
        if 0 <= pos < len(out):
            out[pos] = edit['value']
    return out


def _proc_normalize(x, args, _cols):
    """Normalize.svelte (registry key 'normalize'): present values by the house rule (Number()); missing cells stay as
    they are, including in the degenerate cases (zero SD / range / MAD / magnitude, where every
    PRESENT value becomes 0, or customMin for min-max). Type from `normalizationType`
    (default z-score, population SD); min-max scales to [customMin, customMax] (default 0, 1);
    robust is (v - median) / MAD; unit-vector divides by the Euclidean norm."""
    typ = args.get('normalizationType') or args.get('method') or 'z-score'

    def num_or(v, d):
        # JS numArg: the default only when absent, blank or not finite; a 0 is kept (STAT-21)
        n = float('nan') if v is None or v == '' else _js_number(v)
        return n if math.isfinite(n) else d
    cmin = num_or(args.get('customMin'), 0.0)
    cmax = num_or(args.get('customMax'), 1.0)
    vals = [_js_number(v) for v in x if not _js_invalid(v)]
    if not vals:
        return list(x)

    def map_present(f):
        return [v if _js_invalid(v) else f(_js_number(v)) for v in x]

    def med(arr):
        a_ = sorted(arr)
        n = len(a_)
        return (a_[n // 2 - 1] + a_[n // 2]) / 2 if n % 2 == 0 else a_[n // 2]
    if typ == 'z-score':
        m = kahan_mean(vals)
        acc = KahanSum()
        for v in vals:
            acc.add((v - m) ** 2)
        sd = math.sqrt(acc.value() / len(vals))
        return map_present(lambda v: 0.0) if sd == 0 else map_present(lambda v: (v - m) / sd)
    if typ == 'min-max':
        lo, hi = min(vals), max(vals)
        rng = hi - lo
        if rng == 0:
            return map_present(lambda v: cmin)
        return map_present(lambda v: ((v - lo) / rng) * (cmax - cmin) + cmin)
    if typ == 'robust':
        md = med(vals)
        mad = med([abs(v - md) for v in vals])
        return map_present(lambda v: 0.0) if mad == 0 else map_present(lambda v: (v - md) / mad)
    if typ == 'unit-vector':
        acc = KahanSum()
        for v in vals:
            acc.add(v * v)
        mag = math.sqrt(acc.value())
        return map_present(lambda v: 0.0) if mag == 0 else map_present(lambda v: v / mag)
    return list(x)


def _proc_filterbyothercol(x, args, cols):
    # Mirrors JS filterbyothercol: a running all-True mask is AND-ed with each
    # condition, then values are KEPT where the mask is true (null otherwise).
    conditions = args.get('conditions', [])
    if not conditions:
        return list(x)
    n = len(x)
    mask = [True] * n
    parent = args.get('parentColId')
    for cond in conditions:
        by_id = cond.get('byColId', -1)
        if by_id == -1:
            continue
        if by_id == parent:
            by = x  # condition references the column itself
        else:
            by_col = cols.get(by_id)
            if by_col is None:
                continue
            by = by_col.get_data()
        if not by:
            continue
        op = cond.get('isOperator', '==')
        val = cond.get('byColValue')
        for i in range(n):
            b = by[i] if i < len(by) else None
            try:
                fb, fval = float(b), float(val)
                cmp = {'==': fb == fval, '!=': fb != fval,
                       '<': fb < fval, '>': fb > fval,
                       '<=': fb <= fval, '>=': fb >= fval}.get(op, False)
            except (TypeError, ValueError):
                sb, sv = str(b), str(val)
                cmp = {'==': sb == sv, '!=': sb != sv,
                       'contains': sv in sb, '!contains': sv not in sb}.get(op, False)
            mask[i] = mask[i] and cmp
    return [x[i] if mask[i] else None for i in range(n)]


def _quantile_type7(arr, q):
    """sampleStats.js quantileType7 (R type 7, numpy 'linear')."""
    n = len(arr)
    if not n:
        return float('nan')
    qq = min(1.0, max(0.0, q))
    srt = sorted(arr)
    if n == 1:
        return srt[0]
    pos = qq * (n - 1)
    lo = int(math.floor(pos))
    return srt[lo] + (srt[min(lo + 1, n - 1)] - srt[lo]) * (pos - lo)


def _proc_outlierremoval(x, args, _cols):
    """OutlierRemoval.svelte: present values by the house rule (Number()), fewer than 4 ->
    unchanged. 'zscore' flags |z| > zThreshold (population SD; no flags when the SD is 0);
    anything else is the IQR rule on TYPE-7 quartiles (Tukey fences q1 - k IQR, q3 + k IQR,
    k = iqrMultiplier). A flagged value becomes None; missing cells are left as they are."""
    method = args.get('method')
    idx = [i for i, v in enumerate(x) if not _js_invalid(v)]
    vals = [_js_number(x[i]) for i in idx]
    if len(vals) < 4:
        return list(x)
    if method == 'zscore':
        thr = args.get('zThreshold')
        thr = 3 if thr is None else thr
        mu = kahan_mean(vals)
        acc = KahanSum()
        for v in vals:
            acc.add((v - mu) * (v - mu))
        sd = math.sqrt(acc.value() / len(vals))
        mask = [False] * len(vals) if sd == 0 else [abs((v - mu) / sd) > thr for v in vals]
    else:
        k = args.get('iqrMultiplier')
        k = 1.5 if k is None else k
        q1 = _quantile_type7(vals, 0.25)
        q3 = _quantile_type7(vals, 0.75)
        lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
        mask = [v < lo or v > hi for v in vals]
    out = list(x)
    for j, i in enumerate(idx):
        if mask[j]:
            out[i] = None
    return out


def _trend_domain_refused(tt, yy, model, degree):
    """Mirrors utils/fitDomain.js checkTrendFitDomain + shouldRefuse for the
    RemoveTrend column process: a fit outside its model's domain is REFUSED and
    the input passes through unchanged (never a silent all-NaN column).
    tt/yy are the already-paired, already-finite (t, y) values."""
    if model == 'logarithmic' and any(v <= 0 for v in tt):
        return True
    if model == 'exponential' and any(v <= 0 for v in yy):
        return True
    if model == 'polynomial' and len(tt) <= degree:
        return True
    # Constant x: the slope is estimated against the spread of x, so it is
    # undefined whatever the model.
    if len(tt) >= 2 and all(v == tt[0] for v in tt):
        return True
    return False


def _proc_removetrend(x, args, cols):
    x_col_id = args.get('xColId', -1)
    x_col = cols.get(x_col_id) if x_col_id != -1 else None
    if x_col is not None:
        t = x_col.hours_since_start if x_col.type == 'time' else x_col.get_data()
    else:
        t = list(range(len(x)))
    # The house rule on BOTH sides (validPairs), then Number(): a None or '' x or y is not
    # a row (it used to crash on '' and fit a None x as 0).
    valid = _js_valid_pairs(t, x)
    if len(valid) < 2:
        return list(x)
    tt = [_js_number(t[i]) for i in valid]
    yy = [_js_number(x[i]) for i in valid]
    model = args.get('model', 'linear')
    degree = int(args.get('polyDegree', 2))
    if _trend_domain_refused(tt, yy, model, degree):
        return list(x)
    fit = fit_trend(tt, yy, model, degree)
    detrended = [yy[k] - fit['fitted'][k] for k in range(len(yy))]
    ws = args.get('windowSize')
    if args.get('slidingWindow') and _finite(ws) and ws > 1:
        # RemoveTrend.svelte slidingStandardisation, formula for formula: one-pass
        # sqrt(E[x^2] - mean^2), and `|| 1` turns a zero or NaN spread into 1.
        half = int(math.floor(ws / 2))
        new = []
        n_d = len(detrended)
        for i in range(n_d):
            lo = max(0, i - half)
            hi = min(n_d - 1, i + half)
            total = sq = 0.0
            for j in range(lo, hi + 1):
                total += detrended[j]
                sq += detrended[j] * detrended[j]
            count = hi - lo + 1
            m = total / count
            var = sq / count - m * m
            sd = math.sqrt(var) if var > 0 else 0.0
            new.append((detrended[i] - m) / (sd or 1.0))
        detrended = new
    out = list(x)
    for k, i in enumerate(valid):
        out[i] = detrended[k]
    return out


def _proc_sort(x, args, _cols):
    # Mirrors JS Sort.svelte: sort present values asc/desc (numeric or string),
    # missing values (None/NaN) pushed to the end.
    direction = (args or {}).get('direction', 'asc')

    def is_missing(v):
        return v is None or (isinstance(v, float) and math.isnan(v))

    present = [v for v in x if not is_missing(v)]
    missing = [v for v in x if is_missing(v)]
    rev = direction == 'desc'
    if present and isinstance(present[0], (int, float)):
        present.sort(reverse=rev)
    else:
        present.sort(key=str, reverse=rev)
    return present + missing


# --- FrequencyFilter (FFT-domain low/high/band-pass) ---
# Port of src/lib/utils/filters.js fftFilter + FrequencyFilter.svelte. Cutoffs
# are normalized frequency (fraction of Nyquist, 0..1). The series mean is
# subtracted before transforming and re-added only when DC is in the passband;
# missing entries are mean-substituted for the transform then re-emitted as None.

def _is_finite_num(v):
    if v is None:
        return False
    try:
        return math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _next_pow2(n):
    if n <= 1:
        return 1
    p = 1
    while p < n:
        p <<= 1
    return p


def _dc_in_band(type_, low, high):
    if type_ == 'high':
        return 0 >= low
    if type_ == 'band':
        return 0 >= low and 0 <= high
    return 0 <= high  # 'low'


def fft_filter(y, type_='low', low=0.0, high=1.0):
    n = len(y)
    if n == 0:
        return []
    valid = [_is_finite_num(v) for v in y]
    valid_vals = [float(y[i]) for i in range(n) if valid[i]]
    if len(valid_vals) < 2:
        return [float(v) if _is_finite_num(v) else None for v in y]
    mean = sum(valid_vals) / len(valid_vals)
    M = _next_pow2(n)
    re = np.zeros(M)
    for i in range(n):
        re[i] = (float(y[i]) if valid[i] else mean) - mean
    spec = np.fft.fft(re)
    for k in range(M):
        kk = min(k, M - k)
        norm_freq = (2.0 * kk) / M
        if type_ == 'high':
            keep = norm_freq >= low
        elif type_ == 'band':
            keep = norm_freq >= low and norm_freq <= high
        else:  # 'low'
            keep = norm_freq <= high
        if not keep:
            spec[k] = 0
    inv = np.fft.ifft(spec).real
    add_back = mean if _dc_in_band(type_, low, high) else 0.0
    out = [None] * n
    for i in range(n):
        if valid[i]:
            out[i] = float(inv[i] + add_back)
    return out


def _proc_frequencyfilter(x, args, _cols):
    a = args or {}
    type_ = a.get('type', 'low')
    low = float(a.get('low', 0) if a.get('low', 0) is not None else 0)
    high = float(a.get('high', 1) if a.get('high', 1) is not None else 1)
    return fft_filter(x, type_, low, high)


COLUMN_PROCESS_MAP = {
    'add': _proc_add,
    'frequencyfilter': _proc_frequencyfilter,
    'sub': _proc_substitute,
    'substitute': _proc_substitute,
    'sort': _proc_sort,
    'multiply': _proc_multiply,
    'editvalue': _proc_editvalue,
    'normalize': _proc_normalize,
    'filterbyothercol': _proc_filterbyothercol,
    'outlierremoval': _proc_outlierremoval,
    'removetrend': _proc_removetrend,
}


class UnsupportedProcessError(RuntimeError):
    """Raised when a session references a process the runtime cannot run.

    Silently skipping an unknown process produces *wrong* output with no
    warning, so by default the runtime fails loudly. Set the module flag
    ``STRICT_PROCESSES = False`` to downgrade this to a prominent stderr
    warning + an entry in ``UNSUPPORTED_PROCESSES`` (output will be WRONG).
    """


# When True (default) an unknown column/table process raises. When False the
# runtime prints a loud warning to stderr and records the name here so the
# generated script can surface a summary at the end.
STRICT_PROCESSES = True
UNSUPPORTED_PROCESSES = []  # list of (kind, name) tuples recorded in non-strict mode


def _handle_unsupported(kind, name, known):
    """Either raise (strict) or warn loudly + record (non-strict)."""
    msg = (f"unsupported {kind} process {name!r} — the runtime has no "
           f"implementation for it, so the output would be WRONG. "
           f"Known {kind} processes: {sorted(known)}")
    if STRICT_PROCESSES:
        raise UnsupportedProcessError(msg)
    print(f"ERROR: {msg}", file=sys.stderr)
    UNSUPPORTED_PROCESSES.append((kind, name))


def run_column_process(funcname, x, args, cols_index):
    fn = COLUMN_PROCESS_MAP.get(funcname)
    if fn is None:
        _handle_unsupported('column', funcname, COLUMN_PROCESS_MAP.keys())
        return list(x)
    return fn(x, args, cols_index)


# ----------------------------------------------------------------------
# Table-process helpers
# ----------------------------------------------------------------------

def _x_for_y(y_col, x_col):
    """Return the X array suitable for fitting alongside y_col.
    Time columns are converted to hours-since-start; bin/number passthrough."""
    if x_col is None:
        return list(range(len(y_col.get_data())))
    if x_col.type == 'time':
        return x_col.hours_since_start
    return x_col.get_data()


# ----------------------------------------------------------------------
# Table processes (AnCiR-convention)
#
# Each TP reads its arguments directly from `args` (the AnCiR session-JSON
# arg dict, with keys like `xIN`, `yIN`, `out`, plus TP-specific options).
#
# Outputs are written into `raw_data` under the column-id values found in
# `args['out']`, exactly mirroring the JS `core.rawData.set(outId, ...)`
# pattern. When a TP changes a column's type (e.g. SimulatedData turning
# its time output into 'time'), the column metadata is mutated in place so
# subsequent TPs see the right type.
#
# Signature: tp_<name>(args, columns_index, raw_data, stored_values) -> bool
# Return value is the per-AnCiR `valid` flag (true if the TP produced data).
# ----------------------------------------------------------------------


def _id_list(yIN):
    """Normalize yIN: scalar → [scalar], None/-1 → [], list → list."""
    if yIN is None:
        return []
    if isinstance(yIN, list):
        return [y for y in yIN if y is not None and y != -1]
    if yIN == -1:
        return []
    return [yIN]


def _t_for_col(col):
    """Hours-since-start for time cols, raw data otherwise."""
    if col is None:
        return []
    return col.hours_since_start if col.type == 'time' else col.get_data()


def _set_col(raw_data, cols, out_id, data, type_=None, time_format=None):
    """Write `data` into raw_data[out_id] and optionally update col meta."""
    if out_id is None or out_id == -1:
        return
    raw_data[out_id] = list(data)
    col = cols.get(out_id)
    if col is not None:
        col.data = out_id
        col.compression = None
        if type_ is not None:
            col.type = type_
        if time_format is not None:
            col.time_format = time_format


def _out_id(args, key):
    """Pull out['key'] handling old {val: id} form too."""
    out = args.get('out') or {}
    v = out.get(key, -1)
    if isinstance(v, dict):
        v = v.get('val', -1)
    return v


# --- SimulatedData ---

def _sim_active_fraction(alpha):
    """SimulatedData.svelte activeFraction: the active share of each cycle. Missing, blank or
    non-numeric is the old fixed 0.5; otherwise clamped to [0.01, 0.99]."""
    if alpha is None or alpha == '':
        return 0.5
    try:
        a = float(alpha)
    except (TypeError, ValueError):
        return 0.5
    if not math.isfinite(a):
        return 0.5
    return min(0.99, max(0.01, a))


def tp_simulateddata(args, cols, raw_data, _sv):
    # startTime may be epoch ms OR an ISO string (JS does new Date(startTime)).
    _st = args.get('startTime', 0)
    try:
        start_time = float(_st)
    except (TypeError, ValueError):
        start_time = float(pd.to_datetime(_st, utc=True).value // 10**6)
    sections = args.get('sections', [])
    sp = float(args.get('samplingPeriod_hours', 1.0))
    time_out = _out_id(args, 'time')
    values_out = _out_id(args, 'values')

    sim_time, sim_vals = [], []
    current_time = 0.0
    rng = np.random.default_rng()
    for sec in sections:
        duration = float(sec.get('duration_hours', 0))
        period = float(sec.get('rhythmPeriod_hours', 24))
        phase = float(sec.get('rhythmPhase_hours', 0) or 0)
        amp = float(sec.get('rhythmAmplitude', 1))
        noise_enabled = sec.get('noiseEnabled', True)
        noise_mode = sec.get('noiseMode', 'multiply')
        noise_amp = float(sec.get('noiseAmplitude', 1))
        # Active for the first `alphaFraction` of each cycle (default 0.5 = period / 2).
        active_until = period * _sim_active_fraction(sec.get('alphaFraction'))
        i = 0.0
        while i < duration:
            ms = start_time + (current_time + i) * 3600000
            sim_time.append(ms)
            shifted = i + phase
            # math.fmod, not %: JS `%` keeps the DIVIDEND's sign, Python's `%` the divisor's, so
            # a negative phase shift (the UI allows down to -50 h) put Python's samples in the
            # wrong half of the cycle. No floor (v81.11): the active phase ends exactly at
            # period * alphaFraction, not at the next whole hour.
            cur_amp = amp if (math.fmod(shifted, period) < active_until) else 1.0
            if noise_enabled:
                nz = float(rng.random()) * noise_amp
                v = nz * cur_amp if noise_mode == 'multiply' else cur_amp + nz
            else:
                v = cur_amp
            sim_vals.append(v)
            i += sp
        current_time += duration

    _set_col(raw_data, cols, time_out, sim_time, type_='time', time_format=None)
    _set_col(raw_data, cols, values_out, sim_vals, type_='number')
    return len(sim_time) > 0


# --- Duplicate ---

def tp_duplicate(args, cols, raw_data, _sv):
    src_id = args.get('xIN', -1)
    if src_id == -1 or src_id not in cols:
        return False
    src = cols[src_id]
    data = src.get_data()
    out_id = _out_id(args, 'result')
    _set_col(raw_data, cols, out_id, data, type_=src.type,
             time_format=src.time_format)
    return len(data) > 0


# --- Cosinor ---

_COSINOR_METRIC_KEYS = ('period', 'mesor', 'amplitude', 'amplitude_ciLow', 'amplitude_ciHigh',
                        'acrophase_ciLow', 'acrophase_ciHigh', 'acrophase', 'rsquared',
                        'pvalue', 'perm_pvalue', 'bathyphase', 'phase_angle', 'amplitude_h1',
                        'acrophase_h1', 'bathyphase_h1')


def cosinor_metrics(fixed_res, free_res, args, phase_ref):
    """Cosinor.svelte cosinorMetrics: every scalar metric of one y series, in the node's
    phase reference. With a fixed period and nHarmonics > 1, amplitude / acrophase /
    bathyphase are the OVERALL waveform's (multi_component_waveform; phase_angle from its
    orthophase) and the *_h1 keys harmonic 1's; otherwise both families are harmonic 1
    (free period: curve 1). perm_pvalue is NaN (the permutation test is not ported)."""
    use_fixed = bool(args.get('useFixedPeriod', False))
    fixed_period = args.get('fixedPeriod', 24)
    reference_hrs = args.get('referenceHrs', 0)
    nan = _NAN
    period = mesor = amplitude = rsq = acrophase = nan
    overall = None
    h1 = None
    if use_fixed and fixed_res is not None:
        period = float(fixed_period)
        mesor = fixed_res.get('M', nan)
        hs = fixed_res.get('harmonics') or []
        h1 = hs[0] if hs else None
        amplitude = h1['amplitude'] if h1 else nan
        acrophase = h1['acrophase_hrs'] if h1 else nan
        rsq = fixed_res.get('R2', nan)
        if len(hs) > 1:
            overall = multi_component_waveform(mesor, hs, period)
    elif free_res is not None:
        cs = free_res['parameters'].get('cosines') or []
        c = cs[0] if cs else None
        w = c['frequency'] if c else 0  # cycles per unit in this port
        period = (1.0 / w) if w else nan
        mesor = free_res['parameters'].get('O', nan)
        amplitude = c['amplitude'] if c else nan
        if c and w:
            acrophase = -c['phase'] / (2 * math.pi * w)
        rsq = free_res.get('rSquared', nan)

    def ref(h):
        return apply_phase_reference(h, phase_ref, period)
    acro_h1 = ref(wrap_to_period(acrophase, period))
    bathy_h1 = ref(bathyphase(acrophase, period))
    peak = overall['orthophase'] if overall else acrophase
    peak_ref = peak + phase_ref['offsetHours'] if (phase_ref and phase_ref.get('clock')) \
        else peak
    ci_a = (h1 or {}).get('CI_A') if use_fixed else None
    ci_p = (h1 or {}).get('CI_acrophase') if use_fixed else None
    return {
        'period': period, 'mesor': mesor,
        'amplitude': overall['amplitude'] if overall else amplitude,
        'acrophase': ref(overall['orthophase']) if overall else acro_h1,
        'bathyphase': ref(overall['bathyphase']) if overall else bathy_h1,
        'phase_angle': phase_angle_of_entrainment(peak_ref, reference_hrs, period),
        'amplitude_h1': amplitude, 'acrophase_h1': acro_h1, 'bathyphase_h1': bathy_h1,
        'amplitude_ciLow': ci_a[0] if ci_a else nan,
        'amplitude_ciHigh': ci_a[1] if ci_a else nan,
        'acrophase_ciLow': ref(wrap_to_period(ci_p[0], period)) if ci_p else nan,
        'acrophase_ciHigh': ref(wrap_to_period(ci_p[1], period)) if ci_p else nan,
        'rsquared': rsq,
        'pvalue': (fixed_res or {}).get('pF', nan) if use_fixed else nan,
        'perm_pvalue': nan,
    }


def tp_cosinor(args, cols, raw_data, _sv):
    """Port of Cosinor.svelte cosinor + writeCosinorOutputs. The output x is the input's
    hour frame turned back into timestamps from its MINIMUM valid time (fit_time_frame,
    STAT-19); every scalar metric comes from cosinor_metrics (phase reference FIT-9,
    multi-harmonic overall waveform FIT-13)."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    n_curves = int(args.get('Ncurves', 0) or 0)
    use_fixed = bool(args.get('useFixedPeriod', False))
    fixed_period = float(args.get('fixedPeriod', 24))
    # Free-period range (h); sessions saved before it existed use the defaults.
    period_range = {'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
                    'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod'])}
    n_h = int(args.get('nHarmonics', 1))
    alpha = float(args.get('alpha', 0.05))
    output_x_id = args.get('outputX', -1)
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    out_col = cols.get(output_x_id) if (output_x_id is not None and output_x_id != -1) else None
    origin_ms, output_x_data = fit_time_frame(x_col, out_col)
    phase_ref = node_phase_reference(args, x_col)

    metrics_by_y = {}
    any_valid = False
    first_x_out = None
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        if not tt:
            continue
        fixed_res = free_res = None
        if use_fixed:
            fixed_res = fit_cosinor_fixed(tt, yy, fixed_period, n_h, alpha)
            if fixed_res is None:
                continue
            xs = output_x_data if output_x_data is not None else tt
            ys = (evaluate_cosinor_at_points({**fixed_res, 'period': fixed_period}, xs)
                  if output_x_data is not None else fixed_res['fitted'])
        else:
            free_res = fit_cosine_curves(tt, yy, n_curves, period_range)
            if free_res is None:
                continue
            xs = output_x_data if output_x_data is not None else tt
            ys = (evaluate_cosinor_at_points(free_res['parameters'], xs)
                  if output_x_data is not None else free_res['fitted'])
        metrics_by_y[y_id] = cosinor_metrics(fixed_res, free_res, args, phase_ref)
        if first_x_out is None:
            first_x_out = xs
            x_out_ms = ([origin_ms + h * 3600000 for h in xs]
                        if origin_ms is not None else xs)
            _set_col(raw_data, cols, _out_id(args, 'cosinorx'), x_out_ms,
                     type_='time' if origin_ms is not None else 'number', time_format=None)
        y_out_id = _out_id(args, f'cosinory_{y_id}')
        if y_out_id == -1:
            y_out_id = _out_id(args, 'cosinory')
        _set_col(raw_data, cols, y_out_id, ys, type_='number')
        any_valid = True

    if any_valid:
        empty = cosinor_metrics(None, None, args, phase_ref)
        for key in _COSINOR_METRIC_KEYS:
            _set_col(raw_data, cols, _out_id(args, key),
                     [metrics_by_y.get(y, empty)[key] for y in y_ins], type_='number')
    return any_valid


# --- BinnedData ---

def _binned_cuts(raw):
    """BinnedData's cuts at the node boundary: the finite edges, deduplicated and sorted."""
    out = set()
    for c in raw if isinstance(raw, (list, tuple)) else []:
        if _bin_finite(c):
            out.add(float(c))
    return sorted(out)


def tp_binneddata(args, cols, raw_data, _sv):
    """Port of BinnedData.svelte `binneddata(args)`: uniform bins (binSize / binStart /
    effectiveStep) or custom edges (binMode 'cuts'). Returns the node's validity; like the
    app it writes NOTHING when invalid."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in is None or x_in == -1 or x_in not in cols or not y_ins:
        return False
    bin_mode = 'cuts' if args.get('binMode') == 'cuts' else 'uniform'
    bin_size = args.get('binSize', 1.0)
    bin_start = args.get('binStart', 0.0)
    # As the app's effectiveStep(args) (one rule for its panel and headless paths): stepSize
    # (saved with a 0.25 default) is the step only when diffStep is ticked and it is a usable
    # positive number, otherwise binSize.
    try:
        step_arg = float(args.get('stepSize'))
    except (TypeError, ValueError):
        step_arg = float('nan')
    step = step_arg if args.get('diffStep') and step_arg > 0 else bin_size
    agg = args.get('aggFunction') or 'mean'
    cuts = _binned_cuts(args.get('cuts'))
    x_col = cols[x_in]

    if bin_mode == 'cuts':
        # The app refuses custom edges on a time x (BinnedData.svelte) and needs at least
        # two distinct edges.
        if x_col.type == 'time' or len(cuts) < 2:
            return False
    elif bin_size is None or bin_start is None or not float(bin_size) > 0:
        return False
    if bin_mode == 'uniform':
        bin_size, bin_start, step = float(bin_size), float(bin_start), float(step)

    x_data = _t_for_col(x_col)
    cuts_arg = cuts if bin_mode == 'cuts' else None
    bins_x = None
    y_results = {}
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        b = bin_data(x_data, cols[y_id].get_data(), bin_size, bin_start, step, agg, cuts_arg)
        if b['bins']:
            if bins_x is None:
                bins_x = b['bins']  # the first valid y's bins are the shared x output
            y_results[y_id] = b['y_out']
    x_out = _out_id(args, 'binnedx')
    if bins_x is None:
        return False
    if x_out == -1:
        return True  # valid, but the app writes nothing without an x output
    # As BinnedData.svelte writes it: the x output stores bin STARTS. A time input gives a
    # time column of epoch ms (origin + start hours, origin = the input's earliest sample,
    # the baseline hoursSinceStart used); anything else gives a 'bin' column, whose getData
    # then adds half the bin width. Uniform bins carry binWidth = binSize (the actogram
    # draws its bars with it); cut bins carry binWidth null and the edge list, so a cuts
    # column reads back its starts unchanged.
    if x_col.type == 'time':
        origin = _js_min(x_col.get_data())
        base = origin if origin is not None else 0
        _set_col(raw_data, cols, x_out, [base + h * 3600000 for h in bins_x], type_='time')
        meta = {'time_format': None, 'origin_time_ms': origin}
    else:
        _set_col(raw_data, cols, x_out, bins_x, type_='bin')
        meta = {'origin_time_ms': None}
    out_col = cols.get(x_out)
    if out_col is not None:
        if bin_mode == 'cuts':
            meta.update(bin_width=None, cuts_list=list(cuts))
        else:
            meta.update(bin_width=bin_size, cuts_list=None)
        for k, v in meta.items():
            setattr(out_col, k, v)
    for y_id, y_vals in y_results.items():
        y_out = _out_id(args, f'binnedy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'binnedy')
        _set_col(raw_data, cols, y_out, y_vals, type_='number')
    return True


# --- NonparametricRA (NPCRA) ---

def _js_round(v):
    """Match JS Math.round (round half toward +inf), unlike Python's banker's round."""
    return int(math.floor(v + 0.5))


def compute_npcra(t, y, epoch_hours=1.0, period=24.0, m_window=10.0, l_window=5.0):
    """Port of src/lib/utils/npcra.js — IS, IV, RA, M10/L5 + onsets on the
    average 24 h profile. Van Someren et al. 1999, Chronobiol Int 16(4):505-518."""
    if not (epoch_hours > 0) or not (period > 0):
        return None
    pairs = []
    n = min(len(t), len(y))
    for i in range(n):
        try:
            tf = float(t[i])
        except (TypeError, ValueError):
            continue
        if math.isnan(tf) or math.isinf(tf):
            continue
        try:
            yf = float(y[i])
        except (TypeError, ValueError):
            yf = float('nan')
        pairs.append((tf, yf))
    if not pairs:
        return None
    pairs.sort(key=lambda p: p[0])
    t0 = pairs[0][0]
    t_end = pairs[-1][0]
    e = epoch_hours
    n_epochs = max(1, math.ceil((t_end - t0) / e + 1e-9))
    ssum = [0.0] * n_epochs
    cnt = [0] * n_epochs
    for (ti, yi) in pairs:
        if math.isnan(yi):
            continue
        k = int(math.floor((ti - t0) / e + 1e-9))  # snap to the epoch grid (non-integer e)
        if k < 0:
            k = 0
        elif k >= n_epochs:
            k = n_epochs - 1
        ssum[k] += yi
        cnt[k] += 1
    x = [(ssum[k] / cnt[k]) if cnt[k] > 0 else float('nan') for k in range(n_epochs)]

    valid = [v for v in x if not math.isnan(v)]
    nn = len(valid)
    if nn == 0:
        return None
    xbar = sum(valid) / nn
    overall_ss = sum((v - xbar) ** 2 for v in valid)

    p = max(1, _js_round(period / e))
    p_sum = [0.0] * p
    p_cnt = [0] * p
    for k in range(n_epochs):
        if math.isnan(x[k]):
            continue
        h = ((k % p) + p) % p  # epoch k -> bin k mod p; avoids float error for non-integer e
        p_sum[h] += x[k]
        p_cnt[h] += 1
    profile = [(p_sum[h] / p_cnt[h]) if p_cnt[h] > 0 else float('nan') for h in range(p)]

    prof_ss = sum((profile[h] - xbar) ** 2 for h in range(p) if not math.isnan(profile[h]))
    IS = (nn * prof_ss) / (p * overall_ss) if overall_ss > 0 else float('nan')

    # IV: mean squared successive difference over the valid successive pairs, over the
    # variance (Witting et al. 1990); with no gaps n_pairs = nn - 1, the textbook formula.
    # Dividing by nn - 1 regardless biased IV low with missing epochs (FIT-8, npcra.js).
    diff_ss = 0.0
    n_pairs = 0
    for k in range(1, n_epochs):
        if not math.isnan(x[k]) and not math.isnan(x[k - 1]):
            diff_ss += (x[k] - x[k - 1]) ** 2
            n_pairs += 1
    IV = (diff_ss / n_pairs / (overall_ss / nn)
          if (overall_ss > 0 and n_pairs > 0) else float('nan'))

    def roll(width_hours, better):
        w = min(p, max(1, _js_round(width_hours / e)))
        best_val = None
        best_start = 0
        for s in range(p):
            ws = 0.0
            wc = 0
            for j in range(w):
                v = profile[(s + j) % p]
                if not math.isnan(v):
                    ws += v
                    wc += 1
            if wc == 0:
                continue
            m = ws / wc
            if best_val is None or better(m, best_val):
                best_val = m
                best_start = s
        return best_val, best_start * e

    M10, m_onset = roll(m_window, lambda m, b: m > b)
    L5, l_onset = roll(l_window, lambda m, b: m < b)
    if M10 is None:
        M10 = float('nan')
    if L5 is None:
        L5 = float('nan')
    denom = M10 + L5
    RA = ((M10 - L5) / denom
          if (not math.isnan(M10) and not math.isnan(L5) and denom != 0) else float('nan'))
    bin_centres = [h * e + e / 2 for h in range(p)]
    return {
        'IS': IS, 'IV': IV, 'RA': RA, 'M10': M10, 'L5': L5,
        'M10onset': m_onset, 'L5onset': l_onset,
        'profile': profile, 'bin_centres': bin_centres, 'n': nn, 'p': p, 'n_epochs': n_epochs,
        'missingEpochFraction': (n_epochs - nn) / n_epochs,
        't0': t0,
    }


def tp_npcra(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    epoch = float(args.get('epochHours', 1))
    period = float(args.get('period', 24))
    m_window = float(args.get('mWindow', 10))
    l_window = float(args.get('lWindow', 5))
    x_data = _t_for_col(cols[x_in])
    phase_ref = node_phase_reference(args, cols[x_in])

    scalar_keys = ['IS', 'IV', 'RA', 'M10', 'L5', 'M10onset', 'L5onset']
    per_y = {}
    bin_centres = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        res = compute_npcra(x_data, cols[y_id].get_data(), epoch, period, m_window, l_window)
        if res is None:
            continue
        if phase_ref['clock']:
            # Clock time (FIT-9): onsets and bin times are hours after the series' first
            # sample t0; add t0 plus the origin's clock hour and wrap to the period.
            ref = {'clock': True, 'offsetHours': phase_ref['offsetHours'] + res['t0']}
            res['M10onset'] = apply_phase_reference(res['M10onset'], ref, period)
            res['L5onset'] = apply_phase_reference(res['L5onset'], ref, period)
            bt, (res['profile'],) = relabel_folded_profile(res['bin_centres'],
                                                           [res['profile']], ref, period)
            res['bin_centres'] = bt
        per_y[y_id] = res
        if bin_centres is None:
            bin_centres = res['bin_centres']
            _set_col(raw_data, cols, _out_id(args, 'npcrax'), bin_centres, type_='number')
        y_out = _out_id(args, f'npcray_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'npcray')
        _set_col(raw_data, cols, y_out, res['profile'], type_='number')
        any_valid = True
    if not any_valid:
        return False
    for key in scalar_keys:
        oid = _out_id(args, key)
        if oid == -1:
            continue
        arr = [per_y[y][key] if y in per_y else float('nan') for y in y_ins]
        _set_col(raw_data, cols, oid, arr, type_='number')
    return any_valid


# --- BlankColumn ---

def tp_blankcolumn(args, cols, raw_data, sv):
    n = int(args.get('N', args.get('rows', args.get('length', 0))))
    # An empty blank cell reads back as None in the JS engine (a category
    # column's get_data maps '' -> null), so default the fill to None to match.
    # An explicit fillValue is still honoured.
    fill = args.get('fillValue', None)
    out_id = _out_id(args, 'result')
    _set_col(raw_data, cols, out_id, [fill] * n, type_='category')
    return n > 0


# --- CollectColumns ---

def tp_collectcolumns(args, cols, raw_data, _sv):
    """Port of CollectColumns.svelte collectcolumns: copy each input column (after the
    node's preProcesses) to its `col_<id>` output, then write each row-wise aggregate
    (mean / min / max / sum over the included columns, `excludedColIds` left out) to its
    outColId. A row's values follow the house rule (Number(); blank and text are missing),
    and a row with nothing present is None for every method."""
    ids = args.get('colIds', _id_list(args.get('yIN'))) or []
    if not ids:
        return False
    if any(cid not in cols for cid in ids):
        return False
    result = {cid: list(cols[cid].get_data() or []) for cid in ids}
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        for cid in ids:
            result[cid] = list(run_column_process(name.lower().replace(' ', ''), result[cid],
                                                  pp.get('processArgs') or {}, cols))
    out = args.get('out') or {}
    for cid in ids:
        out_id = out.get(f'col_{cid}')
        if isinstance(out_id, dict):
            out_id = out_id.get('val', -1)
        if out_id is not None and out_id != -1:
            _set_col(raw_data, cols, out_id, result[cid], type_=cols[cid].type)
    for agg in args.get('aggregates') or []:
        method = agg.get('method')
        out_col = agg.get('outColId')
        if out_col is None or _js_number(out_col) < 0:
            continue
        excluded = agg.get('excludedColIds') or []
        inc = [cid for cid in ids if cid not in excluded]
        if not inc:
            continue
        n_rows = len(result[inc[0]])
        vals_out = []
        for i in range(n_rows):
            row = [result[cid][i] for cid in inc if i < len(result[cid])]
            row = [_js_number(v) for v in row if not _js_invalid(v)]
            if not row:
                vals_out.append(None)
            elif method == 'mean':
                vals_out.append(sum(row) / len(row))
            elif method == 'min':
                vals_out.append(min(row))
            elif method == 'max':
                vals_out.append(max(row))
            elif method == 'sum':
                vals_out.append(sum(row))
            else:
                vals_out.append(None)  # JS leaves aggVal undefined
        _set_col(raw_data, cols, out_col, vals_out, type_='number')
    return True


# --- ColumnFunctions ---

def tp_columnfunctions(args, cols, raw_data, _sv):
    """Element-wise combination of several columns. Mirrors ColumnFunctions.svelte:20-85.

    Rewritten 2026-07-28 after a fixture showed the port disagreeing with the JS in four
    ways at once, all silent:

      - it read args['operation']; the node writes args['func'], so EVERY export used the
        default 'add' no matter what the user picked,
      - it read args['colIds']/args['yIN']; the node reads args['xsIN'],
      - 'sd' divided by n; the JS uses the SAMPLE sd (n-1), and returns 0 for a single column,
      - it skipped missing values per row, so 'average' divided by the count PRESENT while the
        JS divides by the column count.

    'add' also concatenates with a space when either operand column is categorical, which is
    how the node builds compound labels.
    """
    func = args.get('func', args.get('operation', 'add'))
    ids = args.get('xsIN')
    if ids is None:
        ids = args.get('colIds', _id_list(args.get('yIN')))
    ids = [i for i in _id_list(ids) if i in cols]
    if not ids:
        return False
    columns = [cols[i].get_data() for i in ids]
    types = [cols[i].type for i in ids]
    n = len(columns[0])
    n_cols = len(columns)

    def _num(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return float('nan')

    if func == 'add':
        result = list(columns[0])
        for i in range(1, n_cols):
            cat = types[0] == 'category' or types[i] == 'category'
            result = [(f"{result[j]} {columns[i][j]}" if cat
                       else _num(result[j]) + _num(columns[i][j]))
                      for j in range(n)]
    elif func == 'average':
        result = [sum(_num(c[j]) for c in columns) / n_cols for j in range(n)]
    elif func == 'min':
        result = [min(_num(c[j]) for c in columns) for j in range(n)]
    elif func == 'max':
        result = [max(_num(c[j]) for c in columns) for j in range(n)]
    elif func == 'sd':
        result = []
        for j in range(n):
            if n_cols < 2:
                result.append(0)
                continue
            vals = [_num(c[j]) for c in columns]
            mean = sum(vals) / n_cols
            var = sum((v - mean) ** 2 for v in vals) / (n_cols - 1)
            result.append(math.sqrt(var))
    elif func == 'percentile':
        # Row-wise type-7 percentile across the columns; numpy IS the reference
        # (method='linear' = type 7). Unlike the other branches this one drops
        # missing values per row (the JS filters with isInvalidValue), so a
        # blank cell shrinks the row's sample instead of poisoning it.
        pct = _num(args.get('percentile', 50))
        pct = min(100.0, max(0.0, pct)) if math.isfinite(pct) else 50.0

        def _row_pct(j):
            vals = [_num(c[j]) for c in columns]
            vals = [v for v in vals if math.isfinite(v)]
            if not vals:
                return float('nan')
            return float(np.percentile(vals, pct, method='linear'))

        result = [_row_pct(j) for j in range(n)]
    else:
        return False

    _set_col(raw_data, cols, _out_id(args, 'result'), result, type_='number')
    return len(result) > 0


def tp_threshold(args, cols, raw_data, _sv):
    # Binarise xIN at `threshold` by `comparison`; missing/non-numeric stay None.
    # Mirrors Threshold.svelte thresholddata exactly.
    x_in = args.get('xIN', -1)
    if x_in == -1 or x_in not in cols:
        return False
    data = cols[x_in].get_data() or []
    t = float(args.get('threshold', 0))
    comp = args.get('comparison', '>=')

    def _cmp(v):
        if comp == '>':
            return v > t
        if comp == '<':
            return v < t
        if comp == '<=':
            return v <= t
        return v >= t  # '>=' and any unknown value fall back to >=

    out = []
    for v in data:
        if v is None or v == '' or (isinstance(v, float) and math.isnan(v)):
            out.append(None)
            continue
        try:
            out.append(1 if _cmp(float(v)) else 0)
        except (TypeError, ValueError):
            out.append(None)
    _set_col(raw_data, cols, _out_id(args, 'binary'), out, type_='number')
    return len(out) > 0


# --- Crossing ---

def tp_crossing(args, cols, raw_data, _sv):
    # Rule-based crossing detection; mirrors Crossing.svelte crossingdata exactly.
    # OR of AND-groups of conditions over yIN series (or x); persistence in x
    # units when xIN wired, else samples; re-arm only after the rule goes false.
    def _missing(v):
        if v is None or v == '':
            return True
        try:
            return math.isnan(float(v))
        except (TypeError, ValueError):
            return True

    y_ins = [i for i in (args.get('yIN') or []) if i is not None and i != -1]
    th_ins = [i for i in (args.get('thresholdIN') or []) if i is not None and i != -1]
    groups = [g for g in (args.get('groups') or []) if isinstance(g, list) and len(g) > 0]
    if not groups:
        return False

    x_in = args.get('xIN', -1)
    x_wired = x_in is not None and x_in != -1
    if x_wired and x_in not in cols:
        return False
    x_data = (cols[x_in].get_data() or []) if x_wired else None
    # Persistence and the gap rule are measured on hours since the start for a TIME x (its
    # raw data is epoch ms, which made a persistence of 6 round to one sample: FIT-3).
    x_is_time = x_wired and cols[x_in].type == 'time'
    x_axis = (cols[x_in].hours_since_start if x_is_time else x_data) if x_wired else None

    comparators = {
        '>': lambda v, t: v > t,
        '>=': lambda v, t: v >= t,
        '<': lambda v, t: v < t,
        '<=': lambda v, t: v <= t,
    }

    n = len(x_data) if x_data is not None else -1
    resolved = []
    for g in groups:
        rg = []
        for c in g:
            cmp_ = comparators.get(c.get('isOperator'))
            if cmp_ is None:
                return False
            target = c.get('target')
            if target == 'x':
                if x_data is None:
                    return False
                series = x_data
            else:
                if target not in y_ins or target not in cols:
                    return False
                series = cols[target].get_data() or []
            source = c.get('source', -1)
            if source is not None and source != -1:
                if source not in th_ins or source not in cols:
                    return False
                t = None
                for v in (cols[source].get_data() or []):
                    if not _missing(v):
                        t = float(v)
                        break
                if t is None:
                    return False
            else:
                try:
                    t = float(c.get('value'))
                except (TypeError, ValueError):
                    return False
                if math.isnan(t):
                    return False
            if n == -1:
                n = len(series)
            if len(series) != n:
                return False
            rg.append((series, cmp_, t))
        resolved.append(rg)
    if n <= 0:
        return False

    required = 1
    dx = None
    if x_axis is not None:
        diffs = []
        for i in range(1, len(x_axis)):
            a, b = x_axis[i - 1], x_axis[i]
            if not _missing(a) and not _missing(b) and float(b) > float(a):
                diffs.append(float(b) - float(a))
        if diffs:
            diffs.sort()
            dx = diffs[len(diffs) // 2]
    persistence = _js_number(args.get('persistence') or 0)
    persistence = persistence if math.isfinite(persistence) else 0
    if persistence > 0:
        if x_axis is not None:
            if dx is None:
                return False
            required = max(1, _js_round(persistence / dx))
        else:
            required = max(1, _js_round(persistence))

    def gap_before(i):
        # Rows further apart than 1.5 x the median spacing are a gap: it resets a run like
        # a missing value (and, like one, does not re-arm).
        return (dx is not None and i > 0 and not _missing(x_axis[i])
                and not _missing(x_axis[i - 1])
                and float(x_axis[i]) - float(x_axis[i - 1]) > 1.5 * dx)

    breach = []
    for i in range(n):
        missing = any(_missing(series[i]) for g in resolved for (series, _c, _t) in g)
        if missing:
            breach.append(None)
            continue
        any_group = False
        for g in resolved:
            if all(cmp_(float(series[i]), t) for (series, cmp_, t) in g):
                any_group = True
                break
        breach.append(1 if any_group else 0)

    crossings = []
    run = 0
    armed = True
    for i in range(n):
        b = breach[i]
        if gap_before(i):
            run = 0
        if b is None:
            run = 0
        elif b == 1:
            run += 1
            if armed and run >= required:
                crossings.append(x_data[i] if x_data is not None else i)
                armed = False
        else:
            run = 0
            armed = True

    _set_col(raw_data, cols, _out_id(args, 'breach'), breach, type_='number')
    _set_col(raw_data, cols, _out_id(args, 'crossing'), crossings,
             type_='time' if x_is_time else 'number')
    _set_col(raw_data, cols, _out_id(args, 'count'), [len(crossings)], type_='number')
    return True


# --- FDRCorrection ---

def tp_fdrcorrection(args, cols, raw_data, _sv):
    """Adjust a column of p-values for multiple comparisons.

    Mirrors FDRCorrection.svelte fdrcorrection. The adjustment itself is
    delegated to p_adjust (statsmodels-backed), so this is a real reference for
    the JS rather than a second copy of it.
    """
    x_in = args.get('xIN', -1)
    if x_in == -1 or x_in not in cols:
        return False
    data = cols[x_in].get_data() or []
    if not data:
        return False

    method = args.get('method', 'benjamini-hochberg')
    if method not in ('none', 'bonferroni', 'holm',
                      'benjamini-hochberg', 'benjamini-yekutieli'):
        method = 'benjamini-hochberg'
    try:
        alpha = float(args.get('alpha', 0.05))
    except (TypeError, ValueError):
        alpha = 0.05
    if not math.isfinite(alpha):
        alpha = 0.05

    padj = p_adjust(data, method)['adjusted']
    reject = [None if not math.isfinite(v) else (1 if v < alpha else 0) for v in padj]
    n_tested = sum(1 for v in padj if math.isfinite(v))

    _set_col(raw_data, cols, _out_id(args, 'padj'), padj, type_='number')
    _set_col(raw_data, cols, _out_id(args, 'reject'), reject, type_='number')
    return n_tested > 0


# --- ColumnSet ---

def tp_columnset(_args, _cols, _raw_data, _sv):
    """ColumnSet.svelte `columnset`: a recognised NO-OP, valid, writing nothing.

    A Column Set curates a subset of its candidate columns and emits NO columns of its own;
    the app materialises its selection into each consumer's real inputs (syncTPSets /
    syncPlotSets) while the session is edited, so the saved consumers already hold concrete
    column ids and there is nothing left to compute here. The node itself is still in the
    saved `tableProcesses`, though, and the strict dispatcher used to abort on it as an
    unknown process, which killed every exported script of a session containing one."""
    return True


# --- SurrogateTest ---

# --- Seeded PRNG: @stdlib minstd-shuffle, as permutationTest.js createSeededRNG -----------
#
# The app's Monte Carlo tests draw from @stdlib/random-base-minstd-shuffle seeded by
# createSeededRNG. The generator is tiny and exactly reproducible (Park-Miller minstd,
# a = 16807, m = 2^31 - 1, behind a 32-entry Bays-Durham shuffle table with 8 warm-up
# draws), so the ports reproduce the app's draw sequence bit for bit, and with it its
# surrogate p-values.

_MINSTD_INT32_MAX = 2147483647
_MINSTD_MAX = 2147483646


def _normalize_seed(seed):
    """permutationTest.js normalizeSeed: into [1, 2147483646]; a non-numeric seed is 1."""
    v = _js_number(seed) if not isinstance(seed, (int, float)) else float(seed)
    if not math.isfinite(v):
        return 1
    v = int(math.trunc(v))
    return ((((v - 1) % _MINSTD_MAX) + _MINSTD_MAX) % _MINSTD_MAX) + 1


class SeededRNG:
    """createSeededRNG(seed): call it for the next normalized draw in [0, 1)."""

    def __init__(self, seed):
        self.state = _normalize_seed(seed)
        for _ in range(8):
            self._minstd()
        self.table = [0] * 32
        for i in range(31, -1, -1):
            self.table[i] = self._minstd()
        self.shuffle = self.table[0]

    def _minstd(self):
        self.state = (16807 * self.state) % _MINSTD_INT32_MAX
        return self.state

    def __call__(self):
        i = int(math.floor(32 * (self.shuffle / _MINSTD_INT32_MAX)))
        s_ = self.table[i]
        self.shuffle = s_
        self.table[i] = self._minstd()
        return (s_ - 1) / _MINSTD_MAX


def seeded_sequence(_unused, n, seed):
    """Parity surface: the first n draws of createSeededRNG(seed) (first argument unused)."""
    rng = SeededRNG(seed)
    return {'values': [rng() for _ in range(int(n))]}


# --- Surrogates (utils/surrogates.js) ---------------------------------------------------

SURROGATE_METHODS = ('phase', 'aaft', 'block', 'ar1', 'shuffle')
SURROGATE_NODE_METHODS = ('block', 'ar1', 'shuffle')
_SURROGATE_TIE = 1e-9


def _sur_gaussian(rng):
    u = 0.0
    while u == 0:
        u = rng()
    v = rng()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


def _sur_clean(values):
    """surrogates.js cleanValues: not null, not '', and Number(v) finite."""
    return [_js_number(v) for v in (values or [])
            if v is not None and v != '' and math.isfinite(_js_number(v))]


def phase_randomise(values, rng):
    """surrogates.js phaseRandomise: at the series' own length, bins 1 .. below n/2 get a
    random phase (2 pi rng()) with their magnitude kept, mirrored to n - k; DC and an even
    n's Nyquist bin stay real."""
    y = _sur_clean(values)
    n = len(y)
    if n < 4:
        return list(y)
    mu = kahan_mean(y)
    X = np.fft.fft(np.asarray(y) - mu)
    re, im = X.real.copy(), X.imag.copy()
    k = 1
    while 2 * k < n:
        phi = 2 * math.pi * rng()
        mag = math.hypot(re[k], im[k])
        re[k], im[k] = mag * math.cos(phi), mag * math.sin(phi)
        re[n - k], im[n - k] = re[k], -im[k]
        k += 1
    im[0] = 0
    if n % 2 == 0:
        im[n // 2] = 0
    out = np.fft.ifft(re + 1j * im).real
    return [float(v) + mu for v in out]


def aaft_surrogate(values, rng):
    y = _sur_clean(values)
    n = len(y)
    if n < 4:
        return list(y)
    gauss = sorted(_sur_gaussian(rng) for _ in range(n))
    order_v = sorted(range(n), key=lambda i: y[i])
    g = [0.0] * n
    for rank, i in enumerate(order_v):
        g[i] = gauss[rank]
    rnd = phase_randomise(g, rng)
    so = sorted(y)
    order_s = sorted(range(n), key=lambda i: rnd[i])
    out = [0.0] * n
    for rank, i in enumerate(order_s):
        out[i] = so[rank]
    return out


def block_bootstrap(values, rng, block_length):
    y = _sur_clean(values)
    n = len(y)
    if n < 4:
        return list(y)
    bl = math.floor(block_length) if _finite(block_length) else 0
    L = max(1, min(n, bl or 1))
    max_start = n - L
    out = []
    while len(out) < n:
        start = int(math.floor(rng() * (max_start + 1)))
        i = 0
        while i < L and len(out) < n:
            out.append(y[start + i])
            i += 1
    return out


def ar1_surrogate(values, rng):
    y = _sur_clean(values)
    n = len(y)
    if n < 4:
        return list(y)
    mu = kahan_mean(y)
    dev = [v - mu for v in y]
    num = sum(dev[i] * dev[i - 1] for i in range(1, n))
    den = 0.0
    for d in dev:
        den += d * d
    alpha = max(-0.999, min(0.999, num / den)) if den > 0 else 0.0
    var = den / n
    isd = math.sqrt(max(0.0, var * (1 - alpha * alpha)))
    prev = math.sqrt(var) * _sur_gaussian(rng)
    out = [0.0] * n
    for i in range(n):
        prev = alpha * prev + isd * _sur_gaussian(rng)
        out[i] = prev + mu
    return out


def shuffle_surrogate(values, rng):
    out = _sur_clean(values)
    for i in range(len(out) - 1, 0, -1):
        j = int(math.floor(rng() * (i + 1)))
        out[i], out[j] = out[j], out[i]
    return out


def make_surrogate(values, method, rng, block_length=24):
    if method == 'phase':
        return phase_randomise(values, rng)
    if method == 'aaft':
        return aaft_surrogate(values, rng)
    if method == 'block':
        return block_bootstrap(values, rng, block_length)
    if method == 'ar1':
        return ar1_surrogate(values, rng)
    if method == 'shuffle':
        return shuffle_surrogate(values, rng)
    raise ValueError(f'make_surrogate: unknown method "{method}"')


def surrogate_test(values, stat_fn, method='block', n_surrogates=999, seed=12345,
                   block_length=24, lower_tail=False):
    """surrogates.js surrogateTest: p = (extreme + 1) / (n + 1), a surrogate counting as
    at least as extreme when s >= observed - 1e-9 max(|observed|, |s|)."""
    y = _sur_clean(values)
    nan = float('nan')

    def fail(reason):
        return {'pValue': nan, 'observed': nan, 'surrogateStats': [], 'nSurrogates': 0,
                'valid': False, 'reason': reason}
    if len(y) < 8:
        return fail('need at least 8 finite samples')
    if method not in SURROGATE_METHODS:
        return fail(f'unknown method "{method}"')
    try:
        observed = float(stat_fn(y))
    except Exception:  # noqa: BLE001
        return fail('the statistic threw on the observed series')
    if not math.isfinite(observed):
        return fail('the statistic is not finite on the observed series')
    rng = SeededRNG(seed)
    stats = []
    for _ in range(int(n_surrogates)):
        try:
            v = float(stat_fn(make_surrogate(y, method, rng, block_length)))
        except Exception:  # noqa: BLE001
            continue
        if math.isfinite(v):
            stats.append(v)
    if not stats:
        return fail('every surrogate failed')

    def tol(v):
        return _SURROGATE_TIE * max(abs(observed), abs(v))
    extreme = sum(1 for v in stats
                  if (v <= observed + tol(v) if lower_tail else v >= observed - tol(v)))
    p = (extreme + 1) / (len(stats) + 1)
    return {'pValue': p, 'observed': observed, 'surrogateStats': stats,
            'nSurrogates': len(stats), 'valid': True, 'reason': ''}


def tp_surrogatetest(args, cols, raw_data, _sv):
    """Port of SurrogateTest.svelte surrogatetest: regrid first (refused with a reason when
    the record is not on a regular grid or has a long gap); block length = round(hours /
    grid step); statistic = the largest FFT bin magnitude in [periodMin, periodMax] (no
    peak refinement); phase and AAFT surrogates are refused (they keep the spectrum, rhythm
    included). The p-value now matches the app: the seeded minstd-shuffle draws are
    reproduced exactly (SeededRNG)."""
    nan = float('nan')
    x_in = args.get('xIN', -1)
    y_in = args.get('yIN', -1)
    if isinstance(y_in, list):
        y_in = y_in[0] if y_in else -1
    if x_in is None or x_in == -1 or y_in is None or y_in == -1 \
            or x_in not in cols or y_in not in cols:
        return False
    times = _t_for_col(cols[x_in]) or []
    values = cols[y_in].get_data() or []
    if len(times) < 8 or len(values) < 8:
        return False

    def refuse():
        _set_col(raw_data, cols, _out_id(args, 'pvalue'), [nan], type_='number')
        _set_col(raw_data, cols, _out_id(args, 'observed'), [nan], type_='number')
        return False
    method = args.get('method') or 'block'
    if method not in SURROGATE_NODE_METHODS:
        return refuse()
    g = regrid_uniform(times, values)
    if not g['ok']:
        return refuse()
    vals = g['y']
    grid_t = [g['t0'] + i * g['dt'] for i in range(len(vals))]
    dt = g['dt']
    bl_h = _js_number(args.get('blockLengthHours'))
    bl_h = bl_h if (math.isfinite(bl_h) and bl_h != 0) else 24
    block = max(1, _js_round(bl_h / dt)) if (math.isfinite(dt) and dt > 0) else 24

    def num_or(v, d):
        x = _js_number(v)
        return x if (math.isfinite(x) and x != 0) else d
    pmin = num_or(args.get('periodMin'), 20)
    pmax = num_or(args.get('periodMax'), 28)

    def stat(y):
        spec = compute_fft(grid_t, y)
        best = 0.0
        for f, m in zip(spec['frequencies'], spec['magnitudes']):
            per = 1 / f
            if pmin <= per <= pmax and m > best:
                best = m
        return best
    res = surrogate_test(vals, stat, method=method,
                         n_surrogates=max(9, int(math.floor(num_or(args.get('nSurrogates'),
                                                                   199)))),
                         seed=num_or(args.get('seed'), 12345), block_length=block)
    _set_col(raw_data, cols, _out_id(args, 'pvalue'), [res['pValue']], type_='number')
    _set_col(raw_data, cols, _out_id(args, 'observed'), [res['observed']], type_='number')
    return res['valid']


# --- DoubleLogistic ---

def tp_doublelogistic(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    # The node always fits the PERIODIC model (DoubleLogistic.svelte passes periodic: true).
    periodic = True
    opts = {
        'periodic': True,
        'fixK1': args.get('fixK1', False), 'fixedK1': args.get('fixedK1', 0.5),
        'fixK2': args.get('fixK2', False), 'fixedK2': args.get('fixedK2', 0.5),
        'fixPeriod': bool(args.get('fixPeriod', args.get('fixT', False))),
        'fixedPeriod': args.get('fixedPeriod', args.get('T', 24)),
        'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
        'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod']),
    }
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    output_x_id = args.get('outputX', -1)
    out_col = cols.get(output_x_id) if (output_x_id is not None and output_x_id != -1) else None
    origin_ms, output_x_data = fit_time_frame(x_col, out_col)
    first_xs = None
    any_valid = False
    stats_by_y = {}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        if len(idx) < 4:
            continue
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        if first_xs is None:
            first_xs = output_x_data if output_x_data is not None else tt
        res = fit_double_logistic(tt, yy, opts)
        if res is None:
            continue
        ys = (evaluate_dl_at_points(res['parameters'], output_x_data, True)
              if output_x_data is not None else res['fitted'])
        y_out = _out_id(args, f'dlogy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'dlogy')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        stats_by_y[y_id] = res
        any_valid = True
    if any_valid:
        x_vals = ([origin_ms + h * 3600000 for h in first_xs] if origin_ms is not None
                  else first_xs)
        _set_col(raw_data, cols, _out_id(args, 'dlogx'), x_vals,
                 type_='time' if origin_ms is not None else 'number')
    if any_valid:
        nan = float('nan')
        # Declared ports that had no writer until 2026-07-28: a session wiring r2 or rmse
        # downstream got an EMPTY column from the export. `perm_pvalue` (renamed from the
        # bare `pvalue` in JS v72.25 — it is the optional permutation test's p, the ONLY p
        # this node emits) belongs to a Monte Carlo test this port does not run, so it
        # stays NaN — "not computed", not "not significant".
        for key, getter in (('r2', lambda r: r.get('rSquared', nan)),
                            ('rmse', lambda r: r.get('rmse', nan)),
                            ('perm_pvalue', lambda r: nan)):
            _set_col(raw_data, cols, _out_id(args, key),
                     [getter(stats_by_y[y]) if y in stats_by_y else nan for y in y_ins],
                     type_='number')
    return any_valid


# --- FormulaColumn ---
#
# Port of src/lib/utils/formulaExpression.js (grammar in its header comment) and the module
# `formulacolumn` in src/lib/tableProcesses/FormulaColumn.svelte.
#
# SECURITY (review SEC-2). This node used to glue its tokens into a Python expression and
# hand it to eval() with empty builtins. Empty builtins are not a sandbox: a text token such
# as `().__class__.__base__.__subclasses__()` walks from a tuple to every loaded class and on
# to os.system, so a session file could run any command when its exported script ran. The
# formula path below never evaluates, executes or compiles source text and never reads an
# attribute named by the formula: the tokens are lexed against a fixed grammar, parsed into a
# small tree, flattened to a postfix program and that program is run on a value stack. A
# function name is only ever a key into the fixed _FORMULA_FUNCTIONS table. Anything outside
# the grammar is refused (the node is invalid and writes nothing), never turned into a number.

class FormulaError(Exception):
    """A formula outside the FormulaColumn grammar (JS FormulaError)."""


def _formula_zero_sign(r, a):
    """A rounding result of zero carries the sign of its argument, as in JS (Math.ceil(-0.5),
    Math.trunc(-0.5) and Math.round(-0.4) are all -0). Python's int-returning math.floor/ceil/
    trunc lose it."""
    return math.copysign(0.0, a) if r == 0 else float(r)


def _formula_round(a):
    # JS Math.round: halves go toward +infinity (round(2.5) = 3, round(-2.5) = -2), exactly,
    # including 0.49999999999999994 -> 0 (floor(x + 0.5) would give 1 there).
    r = math.floor(a)
    return _formula_zero_sign(r + 1 if a - r >= 0.5 else r, a)


def _formula_sign(a):
    # JS Math.sign: -1, 1, or the zero itself (sign(-0) = -0). Python has no sign().
    return 1.0 if a > 0 else (-1.0 if a < 0 else a)


def _formula_cbrt(a):
    # JS Math.cbrt: the REAL cube root, negative for a negative (a ** (1/3) is complex or
    # wrong there). math.cbrt exists from Python 3.11; older Pythons get a power estimate
    # polished by one Newton step.
    cbrt = getattr(math, 'cbrt', None)
    if cbrt is not None:
        return cbrt(a)
    if a == 0:
        return a
    r = math.copysign(abs(a) ** (1.0 / 3.0), a)
    return r - (r * r * r - a) / (3.0 * r * r)


def _formula_uint32(a):
    """JS ToUint32 for a finite double: truncate toward zero, then wrap modulo 2^32 (exact on
    Python ints, so 1e20 and -1 wrap exactly as in JS)."""
    return int(math.trunc(a)) % 4294967296


def _formula_clz32(a):
    # JS Math.clz32: leading zero bits of ToUint32(a); clz32(0) = 32, clz32(-1) = 0.
    return float(32 - _formula_uint32(a).bit_length())


def _formula_imul(a, b):
    # JS Math.imul: the low 32 bits of ToInt32(a) * ToInt32(b), read as a signed int32.
    r = (_formula_uint32(a) * _formula_uint32(b)) % 4294967296
    return float(r - 4294967296 if r >= 2147483648 else r)


def _formula_fround(a):
    # JS Math.fround: the nearest float32 (ties to even, subnormals kept); past the float32
    # range it is +-Infinity, which the evaluator turns into missing.
    with np.errstate(over='ignore'):
        return float(np.float32(a))


# name -> (min args, max args or None for unbounded, function). JS FUNCTIONS table: every
# function of the JS Math object, with its spec arity. `random` has no function here: it
# draws from the seeded generator evaluate_formula is given.
_FORMULA_FUNCTIONS = {
    'abs': (1, 1, lambda a: abs(a)),
    'acos': (1, 1, math.acos),
    'acosh': (1, 1, math.acosh),
    'asin': (1, 1, math.asin),
    'asinh': (1, 1, math.asinh),
    'atan': (1, 1, math.atan),
    'atan2': (2, 2, math.atan2),  # atan2(y, x), the JS order
    'atanh': (1, 1, math.atanh),
    'cbrt': (1, 1, _formula_cbrt),
    'ceil': (1, 1, lambda a: _formula_zero_sign(math.ceil(a), a)),
    'clz32': (1, 1, _formula_clz32),
    'cos': (1, 1, math.cos),
    'cosh': (1, 1, math.cosh),
    'exp': (1, 1, math.exp),
    'expm1': (1, 1, math.expm1),
    'floor': (1, 1, lambda a: _formula_zero_sign(math.floor(a), a)),
    'fround': (1, 1, _formula_fround),
    'hypot': (1, None, math.hypot),
    'imul': (2, 2, _formula_imul),
    'log': (1, 1, math.log),
    'log10': (1, 1, math.log10),
    'log1p': (1, 1, math.log1p),
    'log2': (1, 1, math.log2),
    'max': (1, None, lambda *v: max(v)),
    'min': (1, None, lambda *v: min(v)),
    'pow': (2, 2, math.pow),
    'random': (0, 0, None),
    'round': (1, 1, _formula_round),
    'sign': (1, 1, _formula_sign),
    'sin': (1, 1, math.sin),
    'sinh': (1, 1, math.sinh),
    'sqrt': (1, 1, math.sqrt),
    'tan': (1, 1, math.tan),
    'tanh': (1, 1, math.tanh),
    'trunc': (1, 1, lambda a: _formula_zero_sign(math.trunc(a), a)),
}
# The JS Math constants as the exact doubles JS holds (accepted bare and after `Math.`), and
# the bare lower-case pi and e the grammar always had.
_FORMULA_MATH_CONSTANTS = {
    'E': 2.718281828459045,
    'LN10': 2.302585092994046,
    'LN2': 0.6931471805599453,
    'LOG10E': 0.4342944819032518,
    'LOG2E': 1.4426950408889634,
    'PI': 3.141592653589793,
    'SQRT1_2': 0.7071067811865476,
    'SQRT2': 1.4142135623730951,
}
_FORMULA_CONSTANTS = {'pi': math.pi, 'e': math.e, **_FORMULA_MATH_CONSTANTS}
_FORMULA_DEFAULT_SEED = 12345

_FORMULA_MAX_LEXEMES = 2000
_FORMULA_MAX_DEPTH = 200
# ASCII classes only: Python's \d also matches non-ASCII digits, which JS's \d does not.
_FORMULA_NUMBER_RE = re.compile(r'(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
_FORMULA_NAME_RE = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
_FORMULA_OPS = '+-*/%^(),'


def _formula_show(s):
    t = ''.join('?' if (c < ' ' or c == '\x7f') else c for c in str(s))
    if len(t) > 20:
        t = t[:20] + '...'
    return f"'{t}'" if ('"' in t and "'" not in t) else f'"{t}"'


def _formula_lex(tokens):
    """JS lex(): FormulaColumn token list -> flat list of lexemes (tuples)."""
    out = []
    for tok in tokens or []:
        if not isinstance(tok, dict):
            raise FormulaError('Malformed formula token.')
        ttype = tok.get('type')
        if ttype == 'col':
            out.append(('col', tok.get('id', tok.get('colId'))))
            continue
        if ttype == 'stored':
            out.append(('stored', tok.get('key', tok.get('name'))))
            continue
        if ttype != 'text':
            raise FormulaError(f'Unknown formula token type {_formula_show(ttype)}.')
        src = tok.get('value')
        if src is None:
            src = ''
        if not isinstance(src, str):
            raise FormulaError('Formula text must be a string.')
        i = 0
        while i < len(src):
            ch = src[i]
            if ch in ' \t\n\r':
                i += 1
                continue
            m = _FORMULA_NUMBER_RE.match(src, i)
            if m:
                glued = _FORMULA_NAME_RE.match(src, m.end())
                if glued:
                    raise FormulaError(
                        f'Cannot read {_formula_show(m.group(0) + glued.group(0))}: '
                        'put an operator between a number and a name.')
                out.append(('num', float(m.group(0))))  # '1e999' -> inf, missing at eval
                i = m.end()
                continue
            m = _FORMULA_NAME_RE.match(src, i)
            if m:
                name = m.group(0)
                end = m.end()
                is_math = False
                if name == 'Math' and src[end:end + 1] == '.':
                    m2 = _FORMULA_NAME_RE.match(src, end + 1)
                    if not m2:
                        raise FormulaError('Expected a function name after "Math.".')
                    name = m2.group(0)
                    end = m2.end()
                    is_math = True
                if src[end:end + 1] == '.':
                    raise FormulaError(
                        f'{_formula_show(src[i:end + 1])} is not allowed: a formula cannot '
                        'reach into names with ".".')
                out.append(('name', name, is_math, src[i:end]))
                i = end
                continue
            if ch in _FORMULA_OPS:
                out.append(('op', ch))
                i += 1
                continue
            raise FormulaError(
                f'Unexpected character {_formula_show(ch)}. A formula can use numbers, columns '
                '($), stored values (#), + - * / % ^ ( ) and the functions '
                f"{', '.join(_FORMULA_FUNCTIONS)}.")
    return out


def _formula_describe(lx):
    if lx is None:
        return 'the end of the formula'
    kind = lx[0]
    if kind == 'num':
        return f'the number {lx[1]}'
    if kind == 'name':
        return _formula_show(lx[3])
    if kind == 'col':
        return 'a column'
    if kind == 'stored':
        return 'a stored value'
    return _formula_show(lx[1])


def parse_formula(tokens):
    """JS parseFormula(): token list -> expression tree (nested tuples). Raises FormulaError.

    Tree nodes: ('num', v) ('col', id) ('stored', key) ('neg', a) ('bin', op, a, b)
    ('call', fn_name, [args]). Recursion is bounded by the 200-level nesting limit, which
    costs at most five Python frames a level, so the interpreter limit is raised for the
    duration of the parse only when it is below what that needs.
    """
    lx = _formula_lex(tokens)
    if not lx:
        raise FormulaError('The formula is empty.')
    if len(lx) > _FORMULA_MAX_LEXEMES:
        raise FormulaError(f'The formula is too long (over {_FORMULA_MAX_LEXEMES} parts).')
    st = {'pos': 0, 'depth': 0}

    def peek():
        p = st['pos']
        return lx[p] if p < len(lx) else None

    def is_op(v):
        t = peek()
        return t is not None and t[0] == 'op' and t[1] == v

    def expect_op(v):
        if not is_op(v):
            raise FormulaError(f'Expected {_formula_show(v)} but found {_formula_describe(peek())}.')
        st['pos'] += 1

    def enter():
        st['depth'] += 1
        if st['depth'] > _FORMULA_MAX_DEPTH:
            raise FormulaError('The formula is nested too deeply.')

    def expr():
        enter()
        node = term()
        while is_op('+') or is_op('-'):
            op = peek()[1]
            st['pos'] += 1
            node = ('bin', op, node, term())
        st['depth'] -= 1
        return node

    def term():
        node = unary()
        while is_op('*') or is_op('/') or is_op('%'):
            op = peek()[1]
            st['pos'] += 1
            node = ('bin', op, node, unary())
        return node

    def unary():
        if is_op('-') or is_op('+'):
            op = peek()[1]
            st['pos'] += 1
            enter()
            a = unary()
            st['depth'] -= 1
            return ('neg', a) if op == '-' else a
        return power()

    def power():
        base = primary()
        if is_op('^'):
            st['pos'] += 1
            enter()
            b = unary()
            st['depth'] -= 1
            return ('bin', '^', base, b)
        return base

    def primary():
        tok = peek()
        if tok is None:
            raise FormulaError('The formula ends where a value was expected.')
        kind = tok[0]
        if kind == 'num':
            st['pos'] += 1
            return ('num', tok[1])
        if kind == 'col':
            st['pos'] += 1
            return ('col', tok[1])
        if kind == 'stored':
            st['pos'] += 1
            return ('stored', tok[1])
        if kind == 'name':
            _, name, is_math, text = tok
            st['pos'] += 1
            const_table = _FORMULA_MATH_CONSTANTS if is_math else _FORMULA_CONSTANTS
            if is_op('('):
                if name not in _FORMULA_FUNCTIONS:
                    raise FormulaError(
                        f'Unknown function {_formula_show(text)}. Allowed: '
                        f"{', '.join(_FORMULA_FUNCTIONS)}.")
                st['pos'] += 1
                args = []
                if not is_op(')'):
                    args.append(expr())
                    while is_op(','):
                        st['pos'] += 1
                        args.append(expr())
                expect_op(')')
                lo, hi, _fn = _FORMULA_FUNCTIONS[name]
                if len(args) < lo or (hi is not None and len(args) > hi):
                    want = str(lo) if lo == hi else (f'at least {lo}' if hi is None
                                                     else f'{lo} to {hi}')
                    one = want in ('1', 'at least 1')
                    raise FormulaError(
                        f"{name}() takes {want} argument{'' if one else 's'}, "
                        f'not {len(args)}.')
                return ('call', name, args)
            if name in const_table:
                return ('num', const_table[name])
            if name in _FORMULA_FUNCTIONS:
                raise FormulaError(f'{_formula_show(text)} is a function: write {text}(...).')
            raise FormulaError(
                f'Unknown name {_formula_show(text)}. Use $ to insert a column and # for a '
                'stored value.')
        if is_op('('):
            st['pos'] += 1
            inner = expr()
            expect_op(')')
            return inner
        raise FormulaError(f'Expected a value but found {_formula_describe(tok)}.')

    old_limit = sys.getrecursionlimit()
    sys.setrecursionlimit(old_limit + 5 * _FORMULA_MAX_DEPTH + 100)
    try:
        tree = expr()
    finally:
        sys.setrecursionlimit(old_limit)
    if st['pos'] < len(lx):
        tok = peek()
        if tok[0] == 'op' and tok[1] == ')':
            raise FormulaError('Unbalanced ")" in the formula.')
        raise FormulaError(f'Unexpected {_formula_describe(tok)}: an operator is missing.')
    return tree


def _formula_postfix(tree):
    """Flatten a parse tree into a postfix program, iteratively (a 2000-lexeme left chain is
    about 1000 levels deep, past Python's default recursion limit)."""
    prog = []
    stack = [(tree, False)]
    while stack:
        node, done = stack.pop()
        kind = node[0]
        if kind in ('num', 'col', 'stored'):
            prog.append(node)
        elif done:
            if kind == 'neg':
                prog.append(('neg',))
            elif kind == 'bin':
                prog.append(('bin', node[1]))
            else:  # call
                prog.append(('call', node[1], len(node[2])))
        else:
            stack.append((node, True))
            children = [node[1]] if kind == 'neg' else (
                [node[2], node[3]] if kind == 'bin' else list(node[2]))
            for child in reversed(children):
                stack.append((child, False))
    return prog


# JS String.prototype.trim whitespace (WhiteSpace + LineTerminator), not Python's isspace.
_JS_WS = ('\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007'
          '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')
_JS_DECIMAL_RE = re.compile(r'[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
_JS_RADIX_RE = re.compile(r'0([xXoObB])([0-9A-Za-z]+)')


def _js_number_from_string(s):
    """JS Number(string) for a non-blank string: a float, or None when JS gives NaN or
    +-Infinity (both missing to a formula)."""
    t = s.strip(_JS_WS)
    if t == '':
        return None
    if _JS_DECIMAL_RE.fullmatch(t):
        v = float(t)
        return v if math.isfinite(v) else None
    m = _JS_RADIX_RE.fullmatch(t)
    if m:
        base = {'x': 16, 'o': 8, 'b': 2}[m.group(1).lower()]
        try:
            v = float(int(m.group(2), base))
        except (ValueError, OverflowError):
            return None
        return v if math.isfinite(v) else None
    return None  # 'Infinity', 'NaN', '1_000', 'inf', '0x' ... are not finite numbers


def formula_cell(v):
    """JS formulaCell(): a finite float, or None when the cell is missing."""
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float, np.integer, np.floating)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, str):
        return _js_number_from_string(v)
    return None


def _formula_apply(op, a, b):
    if op == '+':
        return a + b
    if op == '-':
        return a - b
    if op == '*':
        return a * b
    if op == '/':
        return a / b
    if op == '%':
        return math.fmod(a, b)  # sign of the DIVIDEND, like JS %; not Python's %
    if op == '^':
        return math.pow(a, b)
    raise FormulaError(f'Unknown operator {_formula_show(op)}.')


def _formula_finite(v):
    return v if (v is not None and math.isfinite(v)) else None


def formula_seed(v):
    """JS formulaSeed(): the seed random() draws with. A finite non-zero number (or numeric
    string, JS Number() syntax) as given; anything else (absent, None, '', 0, NaN, +-inf, a
    bool) is the default 12345."""
    n = None
    if isinstance(v, (int, float, np.integer, np.floating)) and not isinstance(v, (bool, np.bool_)):
        n = float(v)
    elif isinstance(v, str) and v.strip(_JS_WS) != '':
        n = _js_number_from_string(v)
    return n if (n is not None and math.isfinite(n) and n != 0) else _FORMULA_DEFAULT_SEED


def evaluate_formula(tree, column, stored, n, rng=None):
    """JS evaluateFormula(): run the parsed formula for rows 0..n-1. `column(id)` returns a
    column's data, `stored(key)` a stored value. Returns a list of floats or None (missing).

    `rng` is the seeded generator random() draws from (SeededRNG(seed), the exact port of the
    app's createSeededRNG). The postfix program runs every instruction once per row, so each
    random() draws once per row, left to right, even in a row that ends up missing, exactly as
    the JS tree walk does. A formula that calls random() without a generator is refused.

    Every step whose value is not finite is missing from that step on. Python raises where
    JS returns Infinity or NaN (1/0, log(0), sqrt(-1), (-8)^(1/3), exp(1000)); both mean
    missing here, so the exceptions are caught per step."""
    prog = _formula_postfix(tree)
    if rng is None and any(ins[0] == 'call' and ins[1] == 'random' for ins in prog):
        raise FormulaError('random() needs a seeded generator.')
    col_cache, stored_cache = {}, {}
    for ins in prog:
        if ins[0] == 'col' and ins[1] not in col_cache:
            data = column(ins[1])
            col_cache[ins[1]] = list(data) if data is not None else []
        elif ins[0] == 'stored' and ins[1] not in stored_cache:
            stored_cache[ins[1]] = formula_cell(stored(ins[1]))
    out = [None] * n
    for i in range(n):
        stack = []
        push = stack.append
        for ins in prog:
            kind = ins[0]
            if kind == 'num':
                push(_formula_finite(ins[1]))
            elif kind == 'col':
                data = col_cache[ins[1]]
                push(formula_cell(data[i]) if i < len(data) else None)
            elif kind == 'stored':
                push(stored_cache[ins[1]])
            elif kind == 'neg':
                a = stack.pop()
                push(None if a is None else -a)
            elif kind == 'bin':
                b = stack.pop()
                a = stack.pop()
                if a is None or b is None:
                    push(None)
                    continue
                try:
                    push(_formula_finite(_formula_apply(ins[1], a, b)))
                except (ZeroDivisionError, ValueError, OverflowError):
                    push(None)
            else:  # call
                if ins[1] == 'random':
                    push(rng())
                    continue
                k = ins[2]
                vals = stack[len(stack) - k:]
                del stack[len(stack) - k:]
                if any(v is None for v in vals):
                    push(None)
                    continue
                try:
                    push(_formula_finite(_FORMULA_FUNCTIONS[ins[1]][2](*vals)))
                except (ZeroDivisionError, ValueError, OverflowError):
                    push(None)
        out[i] = stack[0]
    return out


def validate_formula_tokens(tokens):
    """JS validateFormulaTokens(): an error message, or None when the formula is valid."""
    if not isinstance(tokens, list):
        return 'tokens must be an array'
    for t in tokens:
        if not isinstance(t, dict):
            return 'every token must be an object'
        tt = t.get('type')
        if tt == 'col':
            cid = t.get('id')
            if not (isinstance(cid, int) and not isinstance(cid, bool)):
                return 'a column token needs an integer column id'
        elif tt == 'stored':
            if not isinstance(t.get('key'), str) or not t.get('key'):
                return 'a stored-value token needs a key'
        elif tt == 'text':
            if t.get('value') is not None and not isinstance(t.get('value'), str):
                return 'text token value must be a string'
        else:
            return f'unknown token type {_formula_show(tt)}'
    try:
        parse_formula(tokens)
        return None
    except FormulaError as e:
        return str(e)


def _stored_value_of(entry):
    """JS getStoredValue for a saved entry: {staticValue} (or a bare value)."""
    if isinstance(entry, dict):
        return entry.get('staticValue')
    return entry


def tp_formulacolumn(args, cols, raw_data, sv):
    """JS formulacolumn (FormulaColumn.svelte). Returns validity; a refused formula writes
    nothing, so the output column stays empty (never zeros)."""
    tokens = args.get('tokens') or []
    if not isinstance(tokens, list):
        return False

    def _tok_col(t):  # JS FormulaColumn tokens key the column as 'id'
        return t.get('id', t.get('colId'))

    def _is_num_id(cid):
        return isinstance(cid, (int, float)) and not isinstance(cid, bool)

    col_tokens = [t for t in tokens if isinstance(t, dict) and t.get('type') == 'col'
                  and _is_num_id(_tok_col(t)) and _tok_col(t) >= 0]
    if not col_tokens:
        return False
    for t in tokens:
        # Every column token must name a real column (JS: the first filter above, then a
        # token with a negative id throws on evaluation, which the node also reports invalid).
        if isinstance(t, dict) and t.get('type') == 'col' and _tok_col(t) not in cols:
            return False
    sv = sv or {}
    for t in tokens:
        if isinstance(t, dict) and t.get('type') == 'stored' \
                and t.get('key', t.get('name')) not in sv:
            return False
    try:
        tree = parse_formula(tokens)
    except FormulaError:
        return False
    first = cols[_tok_col(col_tokens[0])].get_data()
    n = len(first) if first is not None else 0
    if n == 0:
        return False
    result = evaluate_formula(tree, lambda cid: cols[cid].get_data(),
                              lambda key: _stored_value_of(sv.get(key)), n,
                              rng=SeededRNG(formula_seed(args.get('seed'))))
    _set_col(raw_data, cols, _out_id(args, 'result'), result, type_='number')
    return len(result) > 0


# --- LongToWide ---

def tp_longtowide(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    cat_in = args.get('categoryColId', args.get('catIN', -1))
    val_in = args.get('valueColId', args.get('valIN', -1))
    if x_in == -1 or cat_in == -1 or val_in == -1:
        return False
    df = pd.DataFrame({
        'x': cols[x_in].get_data(),
        'cat': cols[cat_in].get_data(),
        'val': cols[val_in].get_data(),
    }).pivot_table(index='x', columns='cat', values='val', aggfunc='mean')
    out = args.get('out') or {}
    t_id = out.get('time') if not isinstance(out.get('time'), dict) \
        else out['time'].get('val', -1)
    _set_col(raw_data, cols, t_id, df.index.tolist(),
             type_=cols[x_in].type, time_format=cols[x_in].time_format)
    for c in df.columns:
        v_id = out.get(f'value_{c}')
        if isinstance(v_id, dict):
            v_id = v_id.get('val', -1)
        if v_id and v_id != -1:
            _set_col(raw_data, cols, v_id, df[c].tolist(), type_='number')
    return True


# --- WideToLong ---

def tp_widetolong(args, cols, raw_data, _sv):
    x_in = args.get('timeIN', args.get('xIN', -1))
    y_ins = _id_list(args.get('valueColIds', args.get('yIN')))
    if not y_ins:
        return False

    def _missing(v):
        return v is None or v == '' or (isinstance(v, float) and math.isnan(v))

    times, cats, vals = [], [], []
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y_col = cols[y_id]
        xd = cols[x_in].get_data() if x_in != -1 and x_in in cols \
            else list(range(len(y_col.get_data())))
        for xi, yi in zip(xd, y_col.get_data()):
            if _missing(xi) or _missing(yi):
                continue
            times.append(xi); cats.append(y_col.name); vals.append(yi)
    out = args.get('out') or {}
    t_id = out.get('time') if not isinstance(out.get('time'), dict) \
        else out['time'].get('val', -1)
    c_id = out.get('category') if not isinstance(out.get('category'), dict) \
        else out['category'].get('val', -1)
    v_id = out.get('value') if not isinstance(out.get('value'), dict) \
        else out['value'].get('val', -1)
    _set_col(raw_data, cols, t_id, times,
             type_=cols[x_in].type if x_in in cols else 'number',
             time_format=cols[x_in].time_format if x_in in cols else None)
    _set_col(raw_data, cols, c_id, cats, type_='category')
    _set_col(raw_data, cols, v_id, vals, type_='number')
    return True


# --- MovingAnalysis ---

def tp_movinganalysis(args, cols, raw_data, _sv):
    """Port of MovingAnalysis.svelte movinganalysis over compute_moving_windows (the same
    core as the moving_windows parity surface): windows from the minimum valid x, s += step
    while s <= max - size; a skipped window is NaN in every stat; the x output (start, centre
    or end) is written back from the minimum time for a time x; phases use the record start
    and the node's phase reference (FIT-9)."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    win = _js_number(args.get('windowSize'))
    step = _js_number(args.get('stepSize'))
    if x_in is None or x_in == -1 or x_in not in cols or not y_ins or not (win > 0) \
            or not (step > 0):
        return False
    x_col = cols[x_in]
    is_time = x_col.type == 'time'
    t_all = _t_for_col(x_col)
    origin_ms = time_origin_ms(x_col) if is_time else None
    valid_x = [_js_number(v) for v in t_all if not _js_invalid(v)]
    if len(valid_x) < 3:
        return False
    x_min, x_max = min(valid_x), max(valid_x)
    if x_max - x_min < win:
        return False
    starts = []
    s_ = x_min
    while s_ <= x_max - win + 1e-9:
        starts.append(s_)
        s_ += step
    if not starts:
        return False
    label = args.get('binLabel') or 'center'
    off = 0 if label == 'start' else (win if label == 'end' else win / 2)
    bins = [v + off for v in starts]
    keys = moving_stat_keys(args)
    entries = [(y, cols[y].get_data()) for y in y_ins if y is not None and y != -1 and y in cols]
    if not entries:
        return False
    phase = {'recordStart': x_min, 'ref': node_phase_reference(args, x_col)}
    per_y = compute_moving_windows(t_all, [e[1] for e in entries], starts, win, keys, args,
                                   phase)
    results = {e[0]: per_y[i] for i, e in enumerate(entries)}
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        for y in results:
            for k in keys:
                results[y][k] = list(run_column_process(name.lower().replace(' ', ''),
                                                        results[y][k],
                                                        pp.get('processArgs') or {}, cols))
    mx_id = _out_id(args, 'movex')
    if mx_id is not None and mx_id != -1:
        if origin_ms is not None:
            _set_col(raw_data, cols, mx_id, [origin_ms + h * 3600000 for h in bins],
                     type_='time')
        else:
            _set_col(raw_data, cols, mx_id, bins, type_='number')
        if mx_id in cols:
            cols[mx_id].bin_width = win
        for y, per in results.items():
            for k in keys:
                _set_col(raw_data, cols, _out_id(args, f'{y}_{k}'), per[k], type_='number')
    return True


def _spectral_peak_index(values, candidates=None):
    """peakFinder.js spectralPeakIndex: index of the largest finite POSITIVE value, -1 when
    there is none (flat or all-zero data is no peak)."""
    best = -1
    for i in (range(len(values or [])) if candidates is None else candidates):
        v = values[i]
        if _finite(v) and v > 0 and (best < 0 or v > values[best]):
            best = i
    return best


def _moving_fft_stats(tw, yw, args):
    """movinganalysis.js FFT window stats: a window that fails the grid check (regridUniform)
    is skipped (NaN); otherwise computeFFT (fftFreqStep when > 0) and the refined fftPeak.
    Flat data has no peak (NaN)."""
    if not regrid_uniform(tw, yw)['ok']:
        return {}
    fs = args.get('fftFreqStep')
    r = compute_fft(tw, yw, fs if (_finite(fs) and fs > 0) else None)
    if not r['frequencies']:
        return {}
    pk = fft_peak(r)
    if pk is None:
        return {}
    return {'peak_frequency': pk['frequency'],
            'peak_period': pk['period'] if pk['frequency'] != 0 else float('nan'),
            'peak_magnitude': pk['magnitude']}


# --- Random ---

def tp_random(args, cols, raw_data, _sv):
    n = int(args.get('N', args.get('rows', 100)))
    offset = float(args.get('offset', 0.0))
    mult = float(args.get('multiply', 1.0))
    dist = args.get('distribution', 'uniform')
    # NOTE: JS Random uses a seeded @stdlib minstd PRNG; this port uses an
    # unseeded RNG, so output is NOT bit-identical. demo-tp-random is excluded
    # from session parity as non-deterministic (see test_session_parity.py).
    rng = np.random.default_rng()
    if dist == 'bernoulli':
        p = min(1.0, max(0.0, float(args.get('probability', 0.5))))
        vals = (rng.random(n) < p).astype(float).tolist()
    else:
        vals = (offset + rng.random(n) * mult).tolist()
    _set_col(raw_data, cols, _out_id(args, 'result'), vals, type_='number')
    return n > 0


# --- RectangularWave ---

def tp_rectangularwave(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    fix_omega = bool(args.get('fixOmega', False))
    fixed_period = args.get('fixedPeriod', 24)
    opts = {
        'fixKappa': args.get('fixKappa', False),
        'fixedKappa': args.get('fixedKappa', 5),
        'fixOmega': fix_omega,
        'fixedOmega': (2 * math.pi / _js_number(fixed_period)) if fix_omega else None,
        'fixDutyCycle': args.get('fixDutyCycle', False),
        'fixedDutyCycle': args.get('fixedDutyCycle', 0.5),
        'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
        'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod']),
    }
    output_x_id = args.get('outputX', -1)
    out_col = cols.get(output_x_id) if (output_x_id is not None and output_x_id != -1) else None
    origin_ms, output_x_data = fit_time_frame(x_col, out_col)
    first_xs = None
    any_valid = False
    stats_by_y = {}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        if len(idx) < 4:
            continue
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        res = fit_rectangular_wave(tt, yy, opts)
        if res is None:
            continue
        xs_out = output_x_data if output_x_data is not None else tt
        ys = (evaluate_rectwave_at_points(res['parameters'], output_x_data)
              if output_x_data is not None else res['fitted'])
        if first_xs is None:
            first_xs = xs_out
            if origin_ms is not None:
                _set_col(raw_data, cols, _out_id(args, 'rectwavex'),
                         [origin_ms + h * 3600000 for h in first_xs], type_='time')
            else:
                _set_col(raw_data, cols, _out_id(args, 'rectwavex'), first_xs,
                         type_='number')
        y_out = _out_id(args, f'rectwavey_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'rectwavey')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        stats_by_y[y_id] = res
        any_valid = True
    if any_valid:
        nan = float('nan')
        # Declared ports that had no writer until 2026-07-28: a session wiring r2 or rmse
        # downstream got an EMPTY column from the export. `perm_pvalue` (renamed from the
        # bare `pvalue` in JS v72.25 — it is the optional permutation test's p, the ONLY p
        # this node emits) belongs to a Monte Carlo test this port does not run, so it
        # stays NaN — "not computed", not "not significant".
        for key, getter in (('r2', lambda r: r.get('rSquared', nan)),
                            ('rmse', lambda r: r.get('rmse', nan)),
                            ('perm_pvalue', lambda r: nan)):
            _set_col(raw_data, cols, _out_id(args, key),
                     [getter(stats_by_y[y]) if y in stats_by_y else nan for y in y_ins],
                     type_='number')
    return any_valid


# --- RhythmicityAnalysis ---

def tp_rhythmicityanalysis(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    analysis = args.get('analysis', 'periodogram')
    hide_inputs = bool(args.get('hideInputs', False))
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    shared_x = None
    any_valid = False
    stats_by_y = {}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        if analysis == 'periodogram':
            pg = run_periodogram_calculation({
                't': t, 'y': y,
                'method': args.get('pgMethod', args.get('method', 'Lomb-Scargle')),
                'minPeriod': args.get('periodMin', args.get('minPeriod', 1.0)),
                'maxPeriod': args.get('periodMax', args.get('maxPeriod', 48.0)),
                'stepSize': args.get('periodStep', args.get('stepSize', 0.1)),
                # JS RhythmicityAnalysis passes binSize = pgBinSize ?? 0.25 and
                # chiSquaredAlpha = pgAlpha ?? 0.05 (RhythmicityAnalysis.svelte:142).
                'dt': args.get('pgBinSize', 0.25),
                'alpha': args.get('pgAlpha', 0.05),
            })
            xs, ys = pg['x'], pg['y']
            if hide_inputs:
                if shared_x is None:
                    shared_x = xs
                    _set_col(raw_data, cols, _out_id(args, 'rhythmicityx'),
                             xs, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'rhythmicityy_{y_id}'),
                         ys, type_='number')
            else:
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_period'),
                         xs, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_power'),
                         ys, type_='number')
                if pg.get('threshold') is not None:
                    _set_col(raw_data, cols,
                             _out_id(args, f'{y_id}_threshold'),
                             list(pg['threshold']), type_='number')
        elif analysis == 'fft':
            # RhythmicityAnalysis pairs t and y row by row (over t's length) before the
            # transform; computeFFT then grids them (a long gap is refused, not joined).
            idx = _js_valid_pairs(t, y)
            fs = args.get('fftFreqStep')
            fft = compute_fft([t[i] for i in idx], [y[i] for i in idx],
                              fs if (_finite(fs) and fs > 0) else None)
            xs = fft['frequencies']
            ys = fft['magnitudes']
            periods = [1.0 / f if f else float('nan') for f in xs]
            if hide_inputs:
                if shared_x is None:
                    shared_x = periods
                    _set_col(raw_data, cols, _out_id(args, 'rhythmicityx'),
                             periods, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'rhythmicityy_{y_id}'),
                         ys, type_='number')
            else:
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_frequency'),
                         xs, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_period'),
                         periods, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_magnitude'),
                         ys, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_phase'),
                         fft['phases'], type_='number')
        elif analysis == 'correlogram':
            ac = compute_autocorrelation(
                t, y,
                min_lag=float(args.get('corrMinLag', 0.0)),
                max_lag=args.get('corrMaxLag') or None)
            xs, ys = ac['lags'], ac['correlations']
            if hide_inputs:
                if shared_x is None:
                    shared_x = xs
                    _set_col(raw_data, cols, _out_id(args, 'rhythmicityx'),
                             xs, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'rhythmicityy_{y_id}'),
                         ys, type_='number')
            else:
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_lag'),
                         xs, type_='number')
                _set_col(raw_data, cols, _out_id(args, f'{y_id}_correlation'),
                         ys, type_='number')
        # The scalar stats (the `stat_<key>` metric ports): the peak by the app's rules.
        st = {}
        if analysis == 'periodogram':
            i_ = _spectral_peak_index(pg['y'])  # no positive power is no peak (ROB-13)
            if i_ >= 0:
                st = {'peak_period': pg['x'][i_], 'peak_power': pg['y'][i_]}
        elif analysis == 'fft':
            pk = fft_peak(fft) if fft['frequencies'] else None
            if pk:
                st = {'peak_frequency': pk['frequency'],
                      'peak_period': pk['period'] if pk['frequency'] != 0 else float('nan'),
                      'peak_magnitude': pk['magnitude']}
        elif analysis == 'correlogram' and ac['lags']:
            lag, r_ = find_autocorrelation_peak(ac['lags'], ac['correlations'])
            if not math.isnan(lag):
                st = {'peak_lag': lag, 'peak_correlation': r_}
        stats_by_y[y_id] = st
        any_valid = True
    if any_valid:
        keys = {'periodogram': ['peak_period', 'peak_power'],
                'fft': ['peak_period', 'peak_frequency', 'peak_magnitude'],
                'correlogram': ['peak_lag', 'peak_correlation']}.get(analysis, [])
        for k in keys:
            _set_col(raw_data, cols, _out_id(args, f'stat_{k}'),
                     [stats_by_y.get(y, {}).get(k, float('nan')) for y in y_ins],
                     type_='number')
    return any_valid


# --- SequenceColumn ---

def tp_sequencecolumn(args, cols, raw_data, _sv):
    kind = args.get('seqType', args.get('kind', 'number'))
    n = int(args.get('count', args.get('rows', 100)))
    start = float(args.get('start', 0.0))
    step = float(args.get('step', args.get('stepHours', 1.0)))
    out_id = _out_id(args, 'result')
    if kind == 'time':
        base_ms = float(args.get('startTime', args.get('startMs', 0.0)))
        step_hours = float(args.get('stepHours', args.get('step', 1.0)))
        data = [base_ms + i * step_hours * 3600000 for i in range(n)]
        _set_col(raw_data, cols, out_id, data, type_='time', time_format=None)
    else:
        data = [start + i * step for i in range(n)]
        _set_col(raw_data, cols, out_id, data, type_='number')
    return n > 0


# --- SmoothedData ---

def _js_valid_pairs(t, y):
    """validPairs.js: indices where both values pass the house rule, to the shorter length."""
    t = list(t or [])
    y = list(y or [])
    n = min(len(t), len(y))
    return [i for i in range(n) if not _js_invalid(t[i]) and not _js_invalid(y[i])]


def _residual_column(predicted, y_full, x_full):
    """residualSupport.js residualColumn: raw - predicted, NaN where either side is missing."""
    out = []
    for i, v in enumerate(y_full):
        p_i = predicted[i] if i < len(predicted) else None
        bad = (_js_invalid(v) or (x_full is not None and _js_invalid(x_full[i]))
               or not _finite(p_i))
        out.append(float('nan') if bad else _js_number(v) - p_i)
    return out


def tp_smootheddata(args, cols, raw_data, _sv):
    """Port of SmoothedData.svelte smootheddata. Per y: rows kept by the house rule on x and
    y (validPairs), converted with Number(), fewer than 3 -> skipped, then stably sorted by x.
    The x output is the FIRST valid y's sorted x (a time input is written back as epoch ms
    from the first time). Smoother options use the JS names and defaults; an unknown smoother
    type is the moving average, as in smoothArrays."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in is None or x_in == -1 or x_in not in cols or not y_ins:
        return False
    smoother = args.get('smootherType')
    x_col = cols[x_in]
    is_time = x_col.type == 'time'
    x_data = _t_for_col(x_col)
    origin_ms = time_origin_ms(x_col) if is_time else None
    options = {k: args.get(k) for k in (
        'whittakerLambda', 'whittakerOrder', 'savitzkyWindowSize', 'savitzkyPolyOrder',
        'loessBandwidth', 'movingAvgWindowSize', 'movingAvgType')}
    x_out = []
    y_results, raw_by_y = {}, {}
    any_valid = False
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y_data = cols[y_id].get_data()
        idx = _js_valid_pairs(x_data, y_data)
        rows = [(_js_number(x_data[i]), _js_number(y_data[i])) for i in idx]
        if len(rows) < 3:
            continue
        rows.sort(key=lambda r: r[0])  # stable, like Array.prototype.sort
        xs = [r[0] for r in rows]
        ys = [r[1] for r in rows]
        try:
            sy = _smooth_dispatch(xs, ys, smoother, options)
        except Exception:  # noqa: BLE001  JS: console.warn and skip this column
            continue
        if sy is None:
            continue
        if not x_out:
            x_out = xs
        y_results[y_id] = list(sy)
        raw_by_y[y_id] = ys
        any_valid = True
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        for y_id in list(y_results):
            y_results[y_id] = list(run_column_process(name.lower().replace(' ', ''),
                                                      y_results[y_id],
                                                      pp.get('processArgs') or {}, {}))
    x_out_id = _out_id(args, 'smoothedx')
    if any_valid and x_out_id != -1:
        if is_time and origin_ms is not None:
            _set_col(raw_data, cols, x_out_id, [origin_ms + h * 3600000 for h in x_out],
                     type_='time')
        else:
            _set_col(raw_data, cols, x_out_id, x_out, type_='number')
        for y_id in y_ins:
            if y_id not in y_results:
                continue
            _set_col(raw_data, cols, _out_id(args, f'smoothedy_{y_id}'), y_results[y_id],
                     type_='number')
            resid_id = _out_id(args, f'resid_{y_id}')
            if resid_id != -1:
                _set_col(raw_data, cols, resid_id,
                         _residual_column(y_results[y_id], raw_by_y[y_id], x_out),
                         type_='number')
    return any_valid


def _smooth_dispatch(xs, ys, smoother, o):
    """smoothing.js smoothArrays with the JS option names and defaults (`?? default`)."""
    def opt(k, d):
        v = o.get(k)
        return d if v is None else v
    if smoother == 'whittaker':
        return whittaker_eilers(ys, opt('whittakerLambda', 100), opt('whittakerOrder', 2))
    if smoother == 'savitzky':
        return savitzky_golay(ys, opt('savitzkyWindowSize', 5), opt('savitzkyPolyOrder', 2))
    if smoother == 'loess':
        return loess(xs, ys, opt('loessBandwidth', 0.3))
    return moving_average(ys, opt('movingAvgWindowSize', 5), opt('movingAvgType', 'simple'))


# --- Split ---

def tp_split(args, cols, raw_data, _sv):
    y_ins = _id_list(args.get('yIN'))
    if not y_ins:
        return False
    splits = sorted(float(s) for s in args.get('splitTimes', []))
    x_in = args.get('xIN', -1)
    x_data = _t_for_col(cols[x_in]) if x_in in cols else None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y_col = cols[y_id]
        x = x_data if x_data is not None else list(range(len(y_col.get_data())))
        y = y_col.get_data()
        # JS Split emits FULL-LENGTH segments: each output keeps the array length
        # and writes null outside its [bound_k, bound_{k+1}) time window.
        bounds = [float('-inf')] + splits + [float('inf')]
        for k in range(len(splits) + 1):
            lo, hi = bounds[k], bounds[k + 1]
            seg = []
            for xi, yi in zip(x, y):
                try:
                    xv = float(xi)
                except (TypeError, ValueError):
                    seg.append(None)
                    continue
                seg.append(yi if (lo <= xv < hi) else None)
            out_id = _out_id(args, f'{y_id}_{k + 1}')
            if out_id != -1:
                _set_col(raw_data, cols, out_id, seg, type_='number')
                any_valid = True
    return any_valid


# --- Sort ---
# Port of src/lib/tableProcesses/Sort.svelte (module `sortdata`). One
# multi-column input (`yIN`); one of those columns is the sort key (`sortOnId`,
# default = first input). All inputs are reordered together by the key's order
# so rows stay aligned, each writing a `sortedy_<id>` output column. Sort rules
# mirror src/lib/utils/sortRows.js::sortPermutation: missing values (None/NaN)
# always sort LAST regardless of direction (stable among themselves); present
# values compare numerically, or lexicographically if either side is a
# non-numeric string; ties keep original order (stable sort).

def _sort_permutation(key_values, direction='asc'):
    """Mirror sortRows.js::sortPermutation — return indices that sort the key."""
    dir_ = -1 if direction == 'desc' else 1

    decorated = []
    for i, v in enumerate(key_values):
        if v is None or (isinstance(v, float) and math.isnan(v)):
            decorated.append((i, True, None))
            continue
        try:
            num = float(v)
            key = str(v) if math.isnan(num) else num
        except (TypeError, ValueError):
            key = str(v)
        decorated.append((i, False, key))

    def _cmp(a, b):
        ai, am, ak = a
        bi, bm, bk = b
        # Missing always last, regardless of direction; stable among themselves.
        if am and bm:
            return ai - bi
        if am:
            return 1
        if bm:
            return -1
        if isinstance(ak, str) or isinstance(bk, str):
            sa, sb = str(ak), str(bk)
            c = (sa > sb) - (sa < sb)
        else:
            c = (ak > bk) - (ak < bk)
        if c != 0:
            return dir_ * c
        return ai - bi  # stable tie-break

    decorated.sort(key=functools.cmp_to_key(_cmp))
    return [d[0] for d in decorated]


def tp_sort(args, cols, raw_data, _sv):
    y_ins = _id_list(args.get('yIN'))
    if not y_ins:
        return False
    direction = 'desc' if args.get('direction') == 'desc' else 'asc'

    # Resolve the key column: the chosen sortOnId if it's among the inputs,
    # otherwise the first input (matches JS resolveSortOn).
    sort_on = args.get('sortOnId')
    if sort_on is None or sort_on == -1 or sort_on not in y_ins:
        sort_on = y_ins[0]

    key_col = cols.get(sort_on)
    if key_col is None:
        return False
    key_data = key_col.get_data()
    n = len(key_data)
    if n == 0:
        return False

    order = _sort_permutation(key_data, direction)

    any_written = False
    for y_id in y_ins:
        y_col = cols.get(y_id)
        if y_col is None:
            continue
        out_id = _out_id(args, f'sortedy_{y_id}')
        if out_id is None or out_id == -1:
            continue
        y_data = y_col.get_data()
        # Only reorder columns row-aligned with the key; others pass through.
        reordered = ([y_data[i] for i in order]
                     if len(y_data) == n else list(y_data))
        _set_col(raw_data, cols, out_id, reordered,
                 type_=y_col.type, time_format=y_col.time_format)
        any_written = True

    return any_written


# --- TrendFit ---

def tp_trendfit(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    model = args.get('model', 'linear')
    deg = int(args.get('polyDegree', 2))
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    output_x_id = args.get('outputX', -1)
    out_col = cols.get(output_x_id) if (output_x_id is not None and output_x_id != -1) else None
    # The output grid in the fit's hour frame and the origin (the input's minimum valid
    # time) that turns it back into timestamps (fit_time_frame, STAT-19).
    origin_ms, output_x_data = fit_time_frame(x_col, out_col)
    xs = None
    any_valid = False
    stats_by_y = {}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        if not tt or _trend_domain_refused(tt, yy, model, deg):
            continue
        res = fit_trend(tt, yy, model, deg)
        if res is None:
            continue
        if xs is None:
            # The app evaluates the fit at the first valid y's input t, not a dense grid.
            xs = output_x_data if output_x_data is not None else tt
            _set_col(raw_data, cols, _out_id(args, 'trendx'),
                     [origin_ms + h * 3600000 for h in xs] if origin_ms is not None else xs,
                     type_='time' if origin_ms is not None else 'number')
        # Fit-quality ports, previously declared but never written.
        stats_by_y[y_id] = res
        ys = evaluate_trend_at_points(res['parameters'], model, xs)
        y_out = _out_id(args, f'trendy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'trendy')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        any_valid = True
    if any_valid:
        nan = float('nan')
        def _pick(getter):
            return [getter(stats_by_y[y]) if y in stats_by_y else nan for y in y_ins]
        _set_col(raw_data, cols, _out_id(args, 'r2'),
                 _pick(lambda r: r.get('rSquared', nan)), type_='number')
        _set_col(raw_data, cols, _out_id(args, 'rmse'),
                 _pick(lambda r: r.get('rmse', nan)), type_='number')
        # Slope/intercept only exist for the linear model; other models leave them NaN
        # rather than reporting a coefficient that does not mean what the name says.
        _set_col(raw_data, cols, _out_id(args, 'coef_slope'),
                 _pick(lambda r: r['parameters'].get('slope', nan)), type_='number')
        _set_col(raw_data, cols, _out_id(args, 'coef_intercept'),
                 _pick(lambda r: r['parameters'].get('intercept', nan)), type_='number')
    return any_valid


# --- StoredValueGroup ---
# Port of src/lib/tableProcesses/StoredValueGroup.svelte (module `func`,
# JS lines 16-69). Buckets selected stored values into named groups and writes
# each group's finite values into its `group_<id>` output column.

def _svg_safe_group_name(group, idx):
    # JS safeGroupName (StoredValueGroup.svelte:11-14)
    raw = str(group.get('name') if group and group.get('name') is not None
              else '').strip()
    return raw or f"Group {idx + 1}"


def tp_storedvaluegroup(args, cols, raw_data, stored_values):
    # JS storedvaluegroup (StoredValueGroup.svelte:16-69)
    groups = args.get('groups')
    if not isinstance(groups, list):
        groups = []
    result_groups = {}          # JS result.groups
    any_valid = False           # JS anyValid

    for i, group in enumerate(groups):
        group = group or {}
        group_id = group.get('id', f"idx_{i}")          # JS groupId
        group_name = _svg_safe_group_name(group, i)      # JS groupName
        keys = group.get('keys')
        if not isinstance(keys, list):
            keys = []
        vals = []
        for key in keys:
            # JS: if (!(key in core.storedValues)) continue; v = getStoredValue(key)
            if key not in (stored_values or {}):
                continue
            v = stored_values[key]
            # JS getStoredValue unwraps the {source, staticValue} entry shape.
            if isinstance(v, dict):
                v = v.get('staticValue')
            # JS: if (Number.isFinite(v)) vals.push(v)
            if isinstance(v, (int, float)) and not isinstance(v, bool) \
                    and math.isfinite(v):
                vals.append(float(v))
        result_groups[group_id] = {'name': group_name,
                                   'keys': list(keys), 'values': vals}
        if len(vals) > 0:
            any_valid = True

    # JS: write per-group output columns when any out['group_*'] >= 0
    out = args.get('out') or {}
    has_any_out = any(str(k).startswith('group_') and _as_id(v) >= 0
                      for k, v in out.items())
    if has_any_out:
        for group in groups:
            group_id = (group or {}).get('id')
            if not group_id:
                continue
            out_id = _as_id(out.get(f"group_{group_id}", -1))
            if out_id < 0 or out_id not in cols:
                continue
            vals = result_groups.get(group_id, {}).get('values', [])
            _set_col(raw_data, cols, out_id, vals, type_='number')

    return any_valid


def _as_id(v):
    """Coerce an out-column id (possibly {'val': id} or string) to int, -1 on fail."""
    if isinstance(v, dict):
        v = v.get('val', -1)
    try:
        return int(v)
    except (TypeError, ValueError):
        return -1


# --- GroupComparison ---
# Faithful port of src/lib/tableProcesses/GroupComparison.svelte (module
# script). The JS uses @stdlib F/chi-square CDFs and the t-quantile; here we
# use scipy (sp_stats) for the same distributions. Algorithm and JS source
# lines are cited inline.

def _gc_mean(arr):                                       # JS mean (:36-39)
    if not arr:
        return float('nan')
    return sum(arr) / len(arr)


def _gc_sample_variance(arr):                            # JS sampleVariance (:41-47)
    if len(arr) < 2:
        return float('nan')
    m = _gc_mean(arr)
    ss = 0.0
    for x in arr:
        ss += (x - m) ** 2
    return ss / (len(arr) - 1)


def _gc_sample_std(arr):                                 # JS sampleStd (:49-52)
    v = _gc_sample_variance(arr)
    return math.sqrt(v) if math.isfinite(v) else float('nan')


def _gc_p_upper_from_f(f_value, df1, df2):               # JS safePUpperFromF (:61-65)
    # fdist.js pUpperFromF: the upper tail computed directly; F = Infinity gives 0.
    if f_value != f_value or not (math.isfinite(df1) and math.isfinite(df2)):
        return float('nan')
    if df1 <= 0 or df2 <= 0 or f_value < 0:
        return float('nan')
    return 0.0 if f_value == math.inf else float(sp_stats.f.sf(f_value, df1, df2))


def _gc_p_upper_from_chisq(x_value, df):                 # JS safePUpperFromChiSq (:67-71)
    if not (math.isfinite(x_value) and math.isfinite(df)):
        return float('nan')
    if x_value < 0 or df <= 0:
        return float('nan')
    return float(sp_stats.chi2.sf(x_value, df))  # chisqSf: the upper tail directly


def _gc_t_quantile(p, df):
    # JS uses @stdlib tQuantile(1 - alpha/2, df); scipy ppf is the equivalent.
    return float(sp_stats.t.ppf(p, df))


def _gc_build_groups(group_data, y_data):                # JS buildGroups (:73-89)
    buckets = {}
    order = []
    n = len(y_data)
    for i in range(n):
        g_raw = group_data[i] if i < len(group_data) else None
        y_raw = y_data[i]
        # A missing label (None, '', NaN or 'NaN') is not a group, and a missing value (the
        # house rule: None, blank, whitespace-only, non-numeric text) is not a zero: both rows
        # are dropped (JS isMissingCategory / isInvalidValue).
        if _is_missing_category(g_raw) or _js_invalid(y_raw):
            continue
        g = _js_string(g_raw)
        if g not in buckets:
            buckets[g] = []
            order.append(g)
        buckets[g].append(_js_number(y_raw))
    out = []
    for name in order:                                   # preserve insertion order (JS Map)
        values = buckets[name]
        out.append({
            'name': name, 'values': values, 'n': len(values),
            'mean': _gc_mean(values), 'sd': _gc_sample_std(values),
        })
    return out


def _gc_build_groups_from_y_columns(y_ins, cols):        # JS buildGroupsFromYColumns (:91-110)
    groups = []
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y_col = cols[y_id]
        values = _gc_present_numbers(y_col.get_data())
        if not values:
            continue
        groups.append({
            'name': y_col.name or str(y_id), 'values': values,
            'n': len(values), 'mean': _gc_mean(values),
            'sd': _gc_sample_std(values),
        })
    return groups


def _gc_present_numbers(values):
    """JS presentNumbers: the house rule drops missing cells, then Number() converts."""
    return [_js_number(v) for v in (values or []) if not _js_invalid(v)]


# JS NON_FINITE_REASON: a NaN statistic is reported as not computable, never as p = 0.
_GC_NON_FINITE_REASON = ('The test statistic could not be computed: a group contains a '
                         'non-finite value.')


def _gc_rank_with_ties(values):                          # JS rankWithTies (:112-129)
    indexed = sorted([(v, i) for i, v in enumerate(values)], key=lambda p: p[0])
    ranks = [0.0] * len(values)
    tie_counts = []
    pos = 1
    i = 0
    while i < len(indexed):
        j = i + 1
        while j < len(indexed) and indexed[j][0] == indexed[i][0]:
            j += 1
        count = j - i
        avg_rank = (2 * pos + count - 1) / 2
        for k in range(i, j):
            ranks[indexed[k][1]] = avg_rank
        if count > 1:
            tie_counts.append(count)
        pos += count
        i = j
    return ranks, tie_counts


def _gc_holm_adjust(pairs):                              # JS holmAdjust (:131-144)
    n = len(pairs)
    indexed = [dict(p, _idx=idx) for idx, p in enumerate(pairs)]
    indexed.sort(key=lambda p: (p.get('pValue')
                                if p.get('pValue') is not None
                                and math.isfinite(p.get('pValue'))
                                else float('inf')))
    running = 0.0
    for i in range(len(indexed)):
        raw = indexed[i].get('pValue')
        raw = raw if (raw is not None and math.isfinite(raw)) else 1.0
        adj = min(1.0, raw * (n - i))
        running = max(running, adj)
        indexed[i]['pAdjusted'] = running
    indexed.sort(key=lambda p: p['_idx'])
    return [{k: v for k, v in p.items() if k != '_idx'} for p in indexed]


def _gc_welch_t_test(group_a, group_b, alpha=0.05):     # JS welchTTest (:249-294)
    n1, n2 = group_a['n'], group_b['n']
    if n1 < 2 or n2 < 2:
        return {'valid': False, 'reason':
                'Each group needs at least 2 valid values for a t-test.'}
    m1, m2 = group_a['mean'], group_b['mean']
    if not (math.isfinite(m1) and math.isfinite(m2)):
        return {'valid': False, 't': float('nan'), 'pValue': float('nan'),
                'reason': _GC_NON_FINITE_REASON}
    v1 = _gc_sample_variance(group_a['values'])
    v2 = _gc_sample_variance(group_b['values'])
    a = v1 / n1
    b = v2 / n2
    se = math.sqrt(a + b)
    diff = m1 - m2
    if not math.isfinite(se) or se < 0:
        return {'valid': False, 'reason':
                'Unable to compute standard error for t-test.'}
    if se == 0:
        t = 0.0 if diff == 0 else float('inf')
    else:
        t = diff / se
    df_num = (a + b) ** 2
    df_den = (a * a) / (n1 - 1) + (b * b) / (n2 - 1)
    df = (n1 + n2 - 2) if df_den == 0 else df_num / df_den
    p_value = _gc_p_upper_from_f(t * t, 1, df) if math.isfinite(t) else 0.0
    t_crit = _gc_t_quantile(1 - alpha / 2, df) if math.isfinite(df) else float('nan')
    ci_half = (t_crit * se) if (math.isfinite(t_crit) and math.isfinite(se)) else float('nan')
    ci_low = (diff - ci_half) if math.isfinite(ci_half) else float('nan')
    ci_high = (diff + ci_half) if math.isfinite(ci_half) else float('nan')
    pooled_den = n1 + n2 - 2
    pooled_var = (((n1 - 1) * v1 + (n2 - 1) * v2) / pooled_den
                  if pooled_den > 0 else float('nan'))
    cohen_d = (diff / math.sqrt(pooled_var)
               if (math.isfinite(pooled_var) and pooled_var > 0) else float('nan'))
    return {'valid': True, 't': t, 'df': df, 'pValue': p_value,
            'difference': diff, 'ciLow': ci_low, 'ciHigh': ci_high,
            'cohenD': cohen_d}


def _gc_one_way_anova(groups):                           # JS oneWayAnova (:296-339)
    usable = [g for g in groups if g['n'] > 0]
    if len(usable) < 2:
        return {'valid': False, 'reason': 'ANOVA needs at least 2 non-empty groups.'}
    n_total = sum(g['n'] for g in usable)
    k = len(usable)
    if n_total <= k:
        return {'valid': False, 'reason':
                'ANOVA needs at least one group with more than 1 value.'}
    grand_mean = sum(g['mean'] * g['n'] for g in usable) / n_total
    ss_between = 0.0
    ss_within = 0.0
    for g in usable:
        ss_between += g['n'] * (g['mean'] - grand_mean) ** 2
        for v in g['values']:
            ss_within += (v - g['mean']) ** 2
    df_between = k - 1
    df_within = n_total - k
    ms_between = ss_between / df_between
    ms_within = ss_within / df_within
    if ms_within == 0:
        f = 0.0 if ms_between == 0 else float('inf')
    else:
        f = ms_between / ms_within
    if math.isnan(f):
        return {'valid': False, 'f': float('nan'), 'pValue': float('nan'),
                'reason': _GC_NON_FINITE_REASON}
    # f = inf only when ms_within == 0 and the means differ: p = 0 is its limit.
    p_value = _gc_p_upper_from_f(f, df_between, df_within) if math.isfinite(f) else 0.0
    eta_squared = (ss_between / (ss_between + ss_within)
                   if (ss_between + ss_within) > 0 else float('nan'))
    return {'valid': True, 'f': f, 'dfBetween': df_between,
            'dfWithin': df_within, 'msWithin': ms_within, 'pValue': p_value,
            'ssBetween': ss_between, 'ssWithin': ss_within,
            'etaSquared': eta_squared}


# --- Studentized range (utils/studentizedRange.js) --------------------------------------
#
# The upper tail is integrated DIRECTLY, as the JS does: scipy's studentized_range.sf is
# 1 - cdf with an absolute tolerance of 1e-11, so it loses tiny p-values. Same adaptive
# Gauss-Kronrod (7-15) panels, QUADPACK error estimate, panel layout and tolerances, so the
# port agrees with the app to quadrature precision.

_SR_LN_SQRT_2PI = 0.5 * math.log(2 * math.pi)
_SR_XGK = (0.9914553711208126, 0.9491079123427585, 0.8648644233597691, 0.7415311855993945,
           0.5860872354676911, 0.4058451513773972, 0.20778495500789848, 0.0)
_SR_WGK = (0.022935322010529224, 0.06309209262997856, 0.10479001032225019,
           0.14065325971552592, 0.1690047266392679, 0.19035057806478542,
           0.20443294007529889, 0.20948214108472782)
_SR_WG = (0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694)


def _sr_half_tail(x):
    return 0.5 * math.erfc(abs(x) * math.sqrt(0.5))


def _sr_gk15(f, a, b):
    c = 0.5 * (a + b)
    h = 0.5 * (b - a)
    fc = f(c)
    f1, f2 = [0.0] * 7, [0.0] * 7
    kron = fc * _SR_WGK[7]
    gauss = fc * _SR_WG[3]
    for j in range(7):
        dx = h * _SR_XGK[j]
        f1[j] = f(c - dx)
        f2[j] = f(c + dx)
        s_ = f1[j] + f2[j]
        kron += _SR_WGK[j] * s_
        if j % 2 == 1:
            gauss += _SR_WG[(j - 1) // 2] * s_
    mean = 0.5 * kron
    asc = _SR_WGK[7] * abs(fc - mean)
    for j in range(7):
        asc += _SR_WGK[j] * (abs(f1[j] - mean) + abs(f2[j] - mean))
    resasc = asc * abs(h)
    err = abs((kron - gauss) * h)
    if resasc != 0 and err != 0:
        err = resasc * min(1.0, ((200 * err) / resasc) ** 1.5)
    return kron * h, err


def _sr_integrate(f, pts, rel_tol=1e-7, max_panels=400):
    panels = []
    for i in range(len(pts) - 1):
        if pts[i + 1] > pts[i]:
            v, e = _sr_gk15(f, pts[i], pts[i + 1])
            panels.append([pts[i], pts[i + 1], v, e])
    while True:
        total = err = 0.0
        worst = 0
        for i, pn in enumerate(panels):
            total += pn[2]
            err += pn[3]
            if pn[3] > panels[worst][3]:
                worst = i
        if err <= rel_tol * abs(total) or err == 0 or len(panels) >= max_panels:
            return total
        a_, b_ = panels[worst][0], panels[worst][1]
        m = 0.5 * (a_ + b_)
        v1, e1 = _sr_gk15(f, a_, m)
        v2, e2 = _sr_gk15(f, m, b_)
        panels[worst:worst + 1] = [[a_, m, v1, e1], [m, b_, v2, e2]]


def _sr_range_sf(w, k):
    """1 - W_k(w): the upper tail of the range of k standard normals."""
    if not (w > 0):
        return 1.0
    mm = k - 2

    def integrand(z):
        lphi = -0.5 * z * z - _SR_LN_SQRT_2PI
        if lphi < -745:
            return 0.0
        u = z - w
        hz = _sr_half_tail(z)
        hu = _sr_half_tail(u)
        tail = 1 - hu if u >= 0 else hu
        if tail == 0:
            return 0.0
        a_ = 1 - hz if z >= 0 else hz
        b_ = hu - hz if u >= 0 else (hz - hu if z <= 0 else 1 - hz - hu)
        sm, ap = 1.0, 1.0
        for _ in range(mm):
            ap *= a_
            sm = sm * b_ + ap
        return math.exp(lphi) * tail * sm
    c = w / 2
    lo = min(-8.5, c - 6.5)
    hi = max(8.5, c + 6.5)
    n_p = math.ceil((hi - lo) / 2)
    pts = [lo + (hi - lo) * i / n_p for i in range(n_p + 1)]
    return min(1.0, k * _sr_integrate(integrand, pts))


def studentized_range_sf(q, k, df):
    """studentizedRange.js studentizedRangeSf: P(Q > q), k means, df error degrees of
    freedom (df = inf is the range of k standard normals). Accurate for tiny p."""
    if not (isinstance(k, (int, float)) and math.isfinite(k)) or k < 2 or not (df > 0) \
            or q != q:
        return float('nan')
    if q <= 0:
        return 1.0
    if q == math.inf:
        return 0.0
    if df == math.inf:
        return _sr_range_sf(q, k)
    nu = float(df)
    log_c = (nu / 2) * math.log(nu) - math.lgamma(nu / 2) - (nu / 2 - 1) * math.log(2)

    def log_g(s_):
        return log_c + (nu - 1) * math.log(s_) - (nu * s_ * s_) / 2

    def integrand(s_):
        if s_ <= 0:
            return math.exp(log_c) if nu == 1 else 0.0
        lg = log_g(s_)
        if lg < -745:
            return 0.0
        return math.exp(lg) * _sr_range_sf(q * s_, k)
    mode = math.sqrt((nu - 1) / nu) if nu > 1 else 0.0
    sigma = 1 / math.sqrt(2 * nu)
    log_peak = log_g(mode) if nu > 1 else log_c
    hi = max(mode, 1) + sigma
    while log_g(hi) - log_peak > -60:
        hi += sigma
    pts = sorted({x for x in (0.0, mode / 4, mode / 2, mode, mode + 2 * sigma,
                              mode + 5 * sigma, hi) if x <= hi})
    return min(1.0, max(0.0, _sr_integrate(integrand, pts)))


def _sr_brent(f, a, b, fa, fb, xtol):
    """studentizedRange.js brentRoot, step for step."""
    c, fc = a, fa
    d = e = b - a
    eps = 2.220446049250313e-16
    for _ in range(100):
        if fb * fc > 0:
            c, fc = a, fa
            d = e = b - a
        if abs(fc) < abs(fb):
            a, b, c = b, c, b
            fa, fb, fc = fb, fc, fb
        tol = 2 * eps * abs(b) + 0.5 * xtol
        m = 0.5 * (c - b)
        if abs(m) <= tol or fb == 0:
            return b
        if abs(e) >= tol and abs(fa) > abs(fb):
            s_ = fb / fa
            if a == c:
                p_ = 2 * m * s_
                q_ = 1 - s_
            else:
                qq = fa / fc
                r_ = fb / fc
                p_ = s_ * (2 * m * qq * (qq - r_) - (b - a) * (r_ - 1))
                q_ = (qq - 1) * (r_ - 1) * (s_ - 1)
            if p_ > 0:
                q_ = -q_
            else:
                p_ = -p_
            if 2 * p_ < min(3 * m * q_ - abs(tol * q_), abs(e * q_)):
                e = d
                d = p_ / q_
            else:
                d = m
                e = d
        else:
            d = m
            e = d
        a, fa = b, fb
        b += d if abs(d) > tol else (tol if m > 0 else -tol)
        fb = f(b)
    return b


_SR_QCACHE = {}


def studentized_range_quantile(p, k, df):
    """studentizedRange.js studentizedRangeQuantile: q with P(Q <= q) = p, solved on the log
    of the upper tail."""
    if not (0 < p < 1) or not math.isfinite(k) or k < 2 or not (df > 0):
        return float('nan')
    key = (p, k, df)
    if key in _SR_QCACHE:
        return _SR_QCACHE[key]
    log_t = math.log1p(-p)

    def f(q):
        sf = studentized_range_sf(q, k, df)
        return (math.log(sf) if sf > 0 else -math.inf) - log_t
    lo, flo = 0.0, -log_t
    hi = 4.0
    fhi = f(hi)
    res = None
    while fhi > 0:
        lo, flo = hi, fhi
        hi *= 2
        if hi > 1e6:
            res = math.inf
            break
        fhi = f(hi)
    if res is None:
        res = _sr_brent(f, lo, hi, flo, fhi, 1e-13 * hi)
    if len(_SR_QCACHE) >= 64:
        _SR_QCACHE.clear()
    _SR_QCACHE[key] = res
    return res


def _gc_tukey_kramer_post_hoc(groups, ms_within, df_within, alpha=0.05):
    """GroupComparison.svelte tukeyKramerPostHoc (STAT-10): Tukey-Kramer, as scipy.stats
    .tukey_hsd. q = |diff| / sqrt(MSE/2 (1/n_a + 1/n_b)) against the studentized range with
    k = non-empty groups and df = N - k; pAdjusted is that tail (it already controls the
    familywise error; no Holm step), pValue the per-comparison F(1, df) tail of q^2/2, and
    ciLow/ciHigh the simultaneous (1 - alpha) interval diff -/+ qcrit se."""
    if not (_finite(ms_within) and _finite(df_within)) or df_within <= 0:
        return []
    k = sum(1 for g in groups if g['n'] > 0)
    if k < 2:
        return []
    q_crit = studentized_range_quantile(1 - alpha, k, df_within)
    pairs = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            a, b = groups[i], groups[j]
            if a['n'] == 0 or b['n'] == 0:
                continue
            diff = a['mean'] - b['mean']
            se = math.sqrt((ms_within / 2) * (1 / a['n'] + 1 / b['n']))
            if not math.isfinite(diff):
                q = float('nan')
            elif se == 0:
                q = 0.0 if diff == 0 else math.inf
            else:
                q = abs(diff) / se
            if q != q:
                pv = pa = float('nan')
            else:
                pv = _gc_p_upper_from_f(q * q / 2, 1, df_within) if math.isfinite(q) else 0.0
                pa = studentized_range_sf(q, k, df_within)
            half = q_crit * se
            pairs.append({'groupA': a['name'], 'groupB': b['name'], 'diff': diff,
                          'statistic': q, 'pValue': pv, 'pAdjusted': pa,
                          'ciLow': diff - half, 'ciHigh': diff + half,
                          'significant': pa < alpha})
    return pairs


def studentized_range(v):
    """Parity surface: v = [q, k, df, p] -> the upper tail at q and the quantile at p."""
    return {'sf': studentized_range_sf(v[0], v[1], v[2]),
            'quantile': studentized_range_quantile(v[3], v[1], v[2])}


def tukey_kramer_of(*args):
    """Parity surface: one-way ANOVA then the Tukey-Kramer post hoc on groups given as value
    arrays (named g1, g2, ...); the last argument is alpha."""
    *arrays, alpha = args
    groups = []
    for i, arr in enumerate(arrays):
        vals = _gc_present_numbers(arr)
        groups.append({'name': f'g{i + 1}', 'values': vals, 'n': len(vals),
                       'mean': _gc_mean(vals), 'sd': _gc_sample_std(vals)})
    an = _gc_one_way_anova(groups)
    if not an.get('valid'):
        return []
    return _gc_tukey_kramer_post_hoc(groups, an['msWithin'], an['dfWithin'], alpha)


def _gc_mann_whitney_two_groups(group_a, group_b):       # JS mannWhitneyTwoGroups (:367-405)
    n1, n2 = group_a['n'], group_b['n']
    if n1 < 1 or n2 < 1:
        return {'valid': False, 'reason': 'Mann-Whitney needs data in both groups.'}
    tagged = [(v, 'A') for v in group_a['values']] + \
             [(v, 'B') for v in group_b['values']]
    ranks, tie_counts = _gc_rank_with_ties([x[0] for x in tagged])
    rank_sum_a = 0.0
    for i in range(len(tagged)):
        if tagged[i][1] == 'A':
            rank_sum_a += ranks[i]
    u1 = rank_sum_a - (n1 * (n1 + 1)) / 2
    u2 = n1 * n2 - u1
    u = min(u1, u2)
    n = n1 + n2
    tie_term = 0.0
    for t in tie_counts:
        tie_term += t ** 3 - t
    sigma_sq = (n1 * n2 * (n + 1 - tie_term / (n * (n - 1)))) / 12
    sigma = math.sqrt(max(0.0, sigma_sq))
    mean_u = (n1 * n2) / 2
    cc = 0.5 if u > mean_u else -0.5
    z = (u - mean_u - cc) / sigma if sigma > 0 else 0.0
    p_value = _gc_p_upper_from_chisq(z * z, 1)
    r_effect = abs(z) / math.sqrt(n)
    return {'valid': True, 'u': u, 'z': z, 'pValue': p_value,
            'rEffect': r_effect, 'n1': n1, 'n2': n2}


def _gc_kruskal_wallis(groups):                          # JS kruskalWallis (:408-459)
    usable = [g for g in groups if g['n'] > 0]
    if len(usable) < 2:
        return {'valid': False, 'reason':
                'Kruskal-Wallis needs at least 2 non-empty groups.'}
    tagged = []
    for g in usable:
        for v in g['values']:
            tagged.append((v, g['name']))
    n = len(tagged)
    if n <= len(usable):
        return {'valid': False, 'reason':
                'Kruskal-Wallis needs at least one group with more than one value.'}
    ranks, tie_counts = _gc_rank_with_ties([x[0] for x in tagged])
    rank_sums = {}
    for i in range(len(tagged)):
        key = tagged[i][1]
        rank_sums[key] = rank_sums.get(key, 0.0) + ranks[i]
    h = 0.0
    for g in usable:
        rg = rank_sums.get(g['name'], 0.0)
        h += (rg * rg) / g['n']
    h = (12 / (n * (n + 1))) * h - 3 * (n + 1)
    tie_correction = 1.0
    if n > 1:
        tie_term = 0.0
        for t in tie_counts:
            tie_term += t ** 3 - t
        tie_correction = 1 - tie_term / (n ** 3 - n)
    if tie_correction <= 0:
        tie_correction = 1.0
    h_corrected = h / tie_correction
    df = len(usable) - 1
    p_value = _gc_p_upper_from_chisq(h_corrected, df)
    # Tomczak and Tomczak (2014) epsilon-squared, H / (n - 1), as rcompanion::epsilonSquared.
    epsilon_squared = h_corrected / (n - 1)
    return {'valid': True, 'h': h_corrected, 'df': df, 'pValue': p_value,
            'epsilonSquared': epsilon_squared, 'nTotal': n}


def _gc_pairwise_mann_whitney(groups, alpha=0.05):       # JS pairwiseMannWhitney (:462-479)
    pairs = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            a = groups[i]
            b = groups[j]
            m = _gc_mann_whitney_two_groups(a, b)
            if not m['valid']:
                continue
            pairs.append({'groupA': a['name'], 'groupB': b['name'],
                          'statistic': m['u'], 'pValue': m['pValue'],
                          'effect': m['rEffect']})
    adjusted = _gc_holm_adjust(pairs)
    for p in adjusted:
        p['significant'] = p['pAdjusted'] < alpha
    return adjusted


def _gc_resolve_method(requested, groups_count):         # JS resolveMethod (:482-488)
    if requested == 'ttest':
        return 'ttest' if groups_count == 2 else None
    if requested == 'anova':
        return 'anova' if groups_count >= 2 else None
    if requested == 'mannwhitney':
        return 'mannwhitney' if groups_count == 2 else None
    if requested == 'kruskal':
        return 'kruskal' if groups_count >= 2 else None
    return 'ttest' if groups_count == 2 else ('anova' if groups_count > 2 else None)


def _gc_run_selected(groups, chosen, alpha, post_hoc_enabled):
    # JS runSelectedComparison (:490-563) — used by the multi-Y fallback.
    if not chosen:
        return {'valid': False, 'groups': groups, 'warnings': [],
                'reason': 'Need at least 2 groups with data for comparison.'}
    warnings = []   # getComparisonWarnings is UI-only; result.warnings unused in Python
    if chosen == 'ttest':
        t_res = _gc_welch_t_test(groups[0], groups[1], alpha)
        return {'valid': t_res['valid'], 'test': 'Welch t-test',
                'groupCount': len(groups), 'nTotal': groups[0]['n'] + groups[1]['n'],
                'groups': groups, 'warnings': warnings, **t_res}
    if chosen == 'anova':
        a_res = _gc_one_way_anova(groups)
        post_hoc = (_gc_tukey_kramer_post_hoc(groups, a_res.get('msWithin'),
                                              a_res.get('dfWithin'), alpha)
                    if (post_hoc_enabled and a_res['valid'] and len(groups) > 2) else [])
        return {'valid': a_res['valid'], 'test': 'One-way ANOVA',
                'groupCount': len(groups),
                'nTotal': sum(g['n'] for g in groups), 'groups': groups,
                'warnings': warnings, 'postHoc': post_hoc, **a_res}
    if chosen == 'mannwhitney':
        m_res = _gc_mann_whitney_two_groups(groups[0], groups[1])
        return {'valid': m_res['valid'], 'test': 'Mann-Whitney U',
                'groupCount': len(groups), 'nTotal': groups[0]['n'] + groups[1]['n'],
                'groups': groups, 'warnings': warnings, **m_res}
    k_res = _gc_kruskal_wallis(groups)
    post_hoc = (_gc_pairwise_mann_whitney(groups, alpha)
                if (post_hoc_enabled and k_res['valid'] and len(groups) > 2) else [])
    return {'valid': k_res['valid'], 'test': 'Kruskal-Wallis',
            'groupCount': len(groups), 'nTotal': sum(g['n'] for g in groups),
            'groups': groups, 'warnings': warnings, 'postHoc': post_hoc, **k_res}


def tp_groupcomparison(args, cols, raw_data, _sv):
    """Port of GroupComparison.svelte `groupcomparison` (:565-603).

    GroupComparison produces a result object consumed by the UI; it does not
    write output columns (nodeSpec.outputs is empty). The Python pipeline
    only needs the `anyValid` flag (and computes the stats so the algorithm
    is exercised/tested), so we mirror the JS control flow and return the
    boolean. Detailed per-comparison numbers are available via
    `compute_group_comparison` for tests.
    """
    result, any_valid = compute_group_comparison(args, cols)
    return any_valid


def compute_group_comparison(args, cols):
    """Returns (result, anyValid) mirroring JS groupcomparison return."""
    x_in = args.get('xIN')
    y_ins = args.get('yIN')
    if not isinstance(y_ins, list):
        y_ins = [y_ins] if (y_ins is not None and y_ins != -1) else []

    result = {'comparisons': {}, 'warnings': []}
    any_valid = False

    group_col = cols.get(x_in) if (x_in is not None and x_in != -1) else None
    mode = args.get('method', 'auto')
    alpha_raw = args.get('alpha', 0.05)
    alpha = alpha_raw if isinstance(alpha_raw, (int, float)) \
        and math.isfinite(alpha_raw) else 0.05
    post_hoc_enabled = args.get('postHocEnabled') is not False

    # Boxplot-like fallback: multiple Y columns, no group column (JS :582-593)
    if (x_in is None or x_in == -1 or group_col is None) and len(y_ins) > 1:
        groups = _gc_build_groups_from_y_columns(y_ins, cols)
        chosen = _gc_resolve_method(mode, len(groups))
        comp = _gc_run_selected(groups, chosen, alpha, post_hoc_enabled)
        result['comparisons']['multiY'] = {'columnName': 'Selected Y columns', **comp}
        return result, bool(comp['valid'])

    if x_in is None or x_in == -1 or group_col is None or len(y_ins) == 0:
        return result, False

    group_data = group_col.get_data()

    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y_col = cols[y_id]
        y_data = y_col.get_data()
        groups = [g for g in _gc_build_groups(group_data, y_data) if g['n'] > 0]
        chosen = _gc_resolve_method(mode, len(groups))
        if not chosen:
            result['comparisons'][y_id] = {
                'valid': False, 'columnName': y_col.name, 'groups': groups,
                'reason': ('Selected test requires exactly 2 groups with data.'
                           if mode in ('ttest', 'mannwhitney')
                           else 'Need at least 2 groups with data for comparison.')}
            continue
        if chosen == 'ttest':
            t_res = _gc_welch_t_test(groups[0], groups[1], alpha)
            result['comparisons'][y_id] = {
                'valid': t_res['valid'], 'test': 'Welch t-test',
                'columnName': y_col.name, 'groupCount': len(groups),
                'nTotal': groups[0]['n'] + groups[1]['n'], 'groups': groups, **t_res}
            if t_res['valid']:
                any_valid = True
            continue
        if chosen == 'anova':
            a_res = _gc_one_way_anova(groups)
            post_hoc = (_gc_tukey_kramer_post_hoc(groups, a_res.get('msWithin'),
                                                  a_res.get('dfWithin'), alpha)
                        if (post_hoc_enabled and a_res['valid'] and len(groups) > 2) else [])
            result['comparisons'][y_id] = {
                'valid': a_res['valid'], 'test': 'One-way ANOVA',
                'columnName': y_col.name, 'groupCount': len(groups),
                'nTotal': sum(g['n'] for g in groups), 'groups': groups,
                'postHoc': post_hoc, **a_res}
            if a_res['valid']:
                any_valid = True
            continue
        if chosen == 'mannwhitney':
            m_res = _gc_mann_whitney_two_groups(groups[0], groups[1])
            result['comparisons'][y_id] = {
                'valid': m_res['valid'], 'test': 'Mann-Whitney U',
                'columnName': y_col.name, 'groupCount': len(groups),
                'nTotal': groups[0]['n'] + groups[1]['n'], 'groups': groups, **m_res}
            if m_res['valid']:
                any_valid = True
            continue
        k_res = _gc_kruskal_wallis(groups)
        post_hoc = (_gc_pairwise_mann_whitney(groups, alpha)
                    if (post_hoc_enabled and k_res['valid'] and len(groups) > 2) else [])
        result['comparisons'][y_id] = {
            'valid': k_res['valid'], 'test': 'Kruskal-Wallis',
            'columnName': y_col.name, 'groupCount': len(groups),
            'nTotal': sum(g['n'] for g in groups), 'groups': groups,
            'postHoc': post_hoc, **k_res}
        if k_res['valid']:
            any_valid = True

    return result, any_valid


# --- FitFunction ---
# Port of src/lib/tableProcesses/FitFunction.svelte. FitFunction is a generic
# wrapper that dispatches to the cosinor / rectangular / double-logistic fits
# (already ported above as fit_cosinor_fixed / fit_cosine_curves /
# fit_rectangular_wave / fit_double_logistic and their evaluate_* helpers,
# mirroring src/lib/utils/fitFunction.js fitCurveModel + evaluateCurveModelAtPoints).
# preProcesses (post-fit transforms) and permutation tests are UI/runtime-only
# extensions not present in the column-process runtime, so they are not applied.

def _ff_fit_curve_model(tt, yy, model, args):
    # JS fitFunction.js fitCurveModel + per-model option plumbing (:8-113)
    if model == 'cosinor':
        # FitFunction.svelte getModelOptions: useFixedPeriod ?? true.
        use_fixed = args.get('useFixedPeriod', True)
        if use_fixed is None:
            use_fixed = True
        if use_fixed:
            fixed_period = float(args.get('fixedPeriod', 24))
            n_harmonics = max(1, int(args.get('nHarmonics', 1)))
            alpha = float(args.get('alpha', 0.05))
            res = fit_cosinor_fixed(tt, yy, fixed_period, n_harmonics, alpha)
            if res is None:
                return None
            return {'model': 'cosinor', 'mode': 'fixed',
                    'parameters': {'mode': 'fixed', 'period': fixed_period,
                                   'M': res['M'], 'harmonics': res['harmonics']},
                    'fixedStats': res, 'fitted': res['fitted'],
                    'rSquared': res.get('R2', _NAN), 'rmse': res.get('RMSE', _NAN)}
        n_curves = max(1, int(args.get('Ncurves', 1)))
        res = fit_cosine_curves(tt, yy, n_curves, {
            'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
            'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod'])})
        if res is None:
            return None
        return {'model': 'cosinor', 'mode': 'free',
                'parameters': {'mode': 'free', **res['parameters']},
                'fitted': res['fitted'], 'rSquared': res.get('rSquared', _NAN),
                'rmse': res.get('rmse', _NAN)}
    if model == 'rectangular':
        opts = {
            'fixKappa': args.get('fixKappa', False),
            'fixedKappa': args.get('fixedKappa', 5),
            'fixOmega': args.get('fixOmega', False),
            'fixedPeriod': args.get('fixedPeriod', 24),
            'fixDutyCycle': args.get('fixDutyCycle', False),
            'fixedDutyCycle': args.get('fixedDutyCycle', 0.5),
            # rectwave.js pins omega, not the period: fitFunction.js derives it from
            # fixedPeriod when the period is fixed.
            'fixedOmega': (2 * math.pi / _js_number(args.get('fixedPeriod', 24))
                           if args.get('fixOmega') else None),
            'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
            'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod']),
        }
        res = fit_rectangular_wave(tt, yy, opts)
        if res is None:
            return None
        return {'model': 'rectangular', 'parameters': res['parameters'],
                'fitted': res['fitted'], 'rSquared': res['rSquared'], 'rmse': res['rmse'],
                'period': res['period'], 'acrophase': res['acrophase']}
    if model == 'doublelogistic':
        periodic = args.get('periodic', True)
        opts = {
            'periodic': periodic,
            'fixK1': args.get('fixK1', False), 'fixedK1': args.get('fixedK1', 0.5),
            'fixK2': args.get('fixK2', False), 'fixedK2': args.get('fixedK2', 0.5),
            'fixPeriod': args.get('fixPeriod', False),
            'fixedPeriod': args.get('fixedPeriod', 24),
            'minPeriod': args.get('minPeriod', FREE_PERIOD_DEFAULTS['minPeriod']),
            'maxPeriod': args.get('maxPeriod', FREE_PERIOD_DEFAULTS['maxPeriod']),
        }
        res = fit_double_logistic(tt, yy, opts)
        if res is None:
            return None
        return {'model': 'doublelogistic', 'periodic': periodic,
                'parameters': res['parameters'], 'fitted': res['fitted'],
                'rSquared': res['rSquared'], 'rmse': res['rmse'],
                'onsetPhase': res.get('onsetPhase'), 'offsetPhase': res.get('offsetPhase'),
                'dutyCycle': res.get('dutyCycle')}
    return None


def _ff_evaluate_at_points(fit_result, model, t_points):
    # JS fitFunction.js evaluateCurveModelAtPoints (:115-151)
    if fit_result is None or fit_result.get('parameters') is None:
        return [float('nan')] * len(t_points)
    if model == 'cosinor':
        if fit_result.get('mode') == 'fixed':
            params = fit_result['parameters']
            period = params['period']
            M = params['M']
            harmonics = params.get('harmonics') or []
            omega = (2 * math.pi) / period
            out = []
            for t in t_points:
                val = M
                for k in range(len(harmonics)):
                    h = harmonics[k]
                    harmonic_index = h.get('k', k + 1)
                    val += (h['beta'] * math.cos(harmonic_index * omega * t)
                            + h['gamma'] * math.sin(harmonic_index * omega * t))
                out.append(val)
            return out
        return evaluate_cosinor_at_points(fit_result['parameters'], t_points)
    if model == 'rectangular':
        return evaluate_rectwave_at_points(fit_result['parameters'], t_points)
    if model == 'doublelogistic':
        return evaluate_dl_at_points(fit_result['parameters'],
                                     t_points, fit_result.get('periodic', True))
    return [float('nan')] * len(t_points)


def ff_metric_keys(args):
    """FitFunction.svelte getFitMetricKeys."""
    shared = ['r2', 'rmse', 'perm_pvalue']
    model = args.get('model') or 'cosinor'
    if model == 'cosinor':
        return shared + ['period', 'mesor', 'amplitude', 'acrophase', 'amplitude_h1',
                         'acrophase_h1']
    if model == 'rectangular':
        return shared + ['period', 'mesor', 'amplitude', 'acrophase', 'duty_cycle', 'kappa']
    if model == 'doublelogistic':
        return shared + ['period', 'mesor', 'amplitude', 'onset', 'offset', 'k1', 'k2',
                         'duty_cycle']
    return shared


def _ff_raw_metric(key, model, fr):
    """FitFunction.svelte rawFitMetricValue."""
    nan = _NAN
    if not fr:
        return nan
    if key == 'r2':
        return fr.get('rSquared', nan)
    if key == 'rmse':
        return fr.get('rmse', nan)
    if key == 'perm_pvalue':
        return nan  # the permutation test is not ported
    p_ = fr.get('parameters') or {}
    if model == 'cosinor':
        if fr.get('mode') == 'fixed':
            period = p_.get('period', nan)
            if key == 'period':
                return period
            if key == 'mesor':
                return (fr.get('fixedStats') or {}).get('M', p_.get('M', nan))
            hs = (fr.get('fixedStats') or {}).get('harmonics') or []
            if len(hs) > 1 and key in ('amplitude', 'acrophase'):
                w = multi_component_waveform((fr.get('fixedStats') or {}).get('M'), hs, period)
                return w['amplitude'] if key == 'amplitude' else w['orthophase']
            if key in ('amplitude', 'amplitude_h1'):
                return hs[0]['amplitude'] if hs else nan
            if key in ('acrophase', 'acrophase_h1'):
                return hs[0]['acrophase_hrs'] if hs else nan
        else:
            cs = p_.get('cosines') or []
            c = cs[0] if cs else None
            w = c['frequency'] if c else 0  # cycles per unit in this port
            period = 1.0 / w if w else nan
            if key == 'period':
                return period
            if key == 'mesor':
                return p_.get('O', nan)
            if key in ('amplitude', 'amplitude_h1'):
                return c['amplitude'] if c else nan
            if key in ('acrophase', 'acrophase_h1'):
                return wrap_to_period(-c['phase'] / (2 * math.pi * w), period) if w else nan
        return nan
    if model == 'rectangular':
        return {'period': fr.get('period', nan), 'acrophase': fr.get('acrophase', nan),
                'mesor': p_.get('M', nan), 'amplitude': p_.get('A', nan),
                'duty_cycle': p_.get('dutyCycle', nan),
                'kappa': p_.get('kappa', nan)}.get(key, nan)
    if model == 'doublelogistic':
        def first(*vals):
            for v in vals:
                if v is not None:
                    return v
            return nan
        return {'period': first(p_.get('T')), 'mesor': first(p_.get('M')),
                'amplitude': first(p_.get('A')),
                'onset': first(fr.get('onsetPhase'), p_.get('t1')),
                'offset': first(fr.get('offsetPhase'), p_.get('t2')),
                'k1': first(p_.get('k1')), 'k2': first(p_.get('k2')),
                'duty_cycle': first(fr.get('dutyCycle'))}.get(key, nan)
    return nan


_FF_PHASE_KEYS = ('acrophase', 'acrophase_h1', 'onset', 'offset')


def ff_metric_value(key, model, fr, phase_ref):
    """FitFunction.svelte fitMetricValue: phase keys expressed in the phase reference, wrapped
    to the cosinor period, the rectangular wave's period, or the double logistic's T (24 when
    non-periodic)."""
    v = _ff_raw_metric(key, model, fr)
    if not (phase_ref and phase_ref.get('clock')) or key not in _FF_PHASE_KEYS:
        return v
    if model == 'cosinor':
        per = _ff_raw_metric('period', model, fr)
    elif model == 'rectangular':
        per = (fr or {}).get('period', _NAN)
    elif model == 'doublelogistic':
        T = ((fr or {}).get('parameters') or {}).get('T')
        per = 24 if T is None else T
    else:
        per = _NAN
    return apply_phase_reference(v, phase_ref, per)


def tp_fitfunction(args, cols, raw_data, _sv):
    """Port of FitFunction.svelte: the fit, the output curve (output x from the input's
    minimum time, STAT-19) and the scalar metric ports (phase reference FIT-9; overall
    multi-harmonic waveform FIT-13)."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    output_x_id = args.get('outputX', -1)
    x_out = _out_id(args, 'fitx')
    model = args.get('model', 'cosinor')

    if x_in == -1 or x_in not in cols or not y_ins:
        return False

    t_col = cols[x_in]
    t = _t_for_col(t_col)
    out_col = cols.get(output_x_id) if (output_x_id is not None and output_x_id != -1) else None
    origin_ms, output_x_data = fit_time_frame(t_col, out_col)
    phase_ref = node_phase_reference(args, t_col)

    y_results = {}     # JS result.y_results
    any_valid = False
    t_ref = []

    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        if not tt:
            continue
        fit_result = _ff_fit_curve_model(tt, yy, model, args)   # JS computeSingleFit
        if fit_result is None:
            continue
        predicted = (_ff_evaluate_at_points(fit_result, model, output_x_data)
                     if output_x_data is not None else None)
        y_out_data = predicted if predicted is not None else fit_result['fitted']
        x_out_data = output_x_data if output_x_data is not None else tt
        y_results[y_id] = {'fitResult': fit_result, 'xOutData': x_out_data,
                           'yOutData': y_out_data, 't': tt}
        if not t_ref:
            t_ref = tt
        if fit_result.get('fitted'):
            any_valid = True

    if any_valid and x_out != -1:
        first = y_results[next(iter(y_results))]
        x_out_data = first['xOutData'] or output_x_data or first['t']
        x_out_ms = ([origin_ms + h * 3600000 for h in x_out_data]
                    if origin_ms is not None else x_out_data)
        _set_col(raw_data, cols, x_out, x_out_ms,
                 type_='time' if origin_ms is not None else 'number', time_format=None)
        for y_id in y_ins:
            y_out = _out_id(args, f"fity_{y_id}")
            yr = y_results.get(y_id)
            if y_out is not None and y_out != -1 and yr:
                _set_col(raw_data, cols, y_out, yr['yOutData'], type_='number')
    if any_valid:
        for key in ff_metric_keys(args):
            _set_col(raw_data, cols, _out_id(args, key),
                     [ff_metric_value(key, model, (y_results.get(y) or {}).get('fitResult'),
                                      phase_ref) for y in y_ins], type_='number')
    return any_valid


def _isnan(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


# ----------------------------------------------------------------------
# Display-name → tp-key mapping (matches AnCiR's `displayName` strings)
#
# The DISPLAY_TO_TP block below is GENERATED from the JS sources by
# tools/check_tp_coverage.py (scanning src/lib/tableProcesses/*.svelte for the
# filename key and `const displayName`). Do not edit by hand: run
#     python3 tools/check_tp_coverage.py
# to refresh it (and to verify coverage against the JS registry).
# ----------------------------------------------------------------------

# >>> AUTO-GENERATED DISPLAY_TO_TP (do not edit by hand) >>>
DISPLAY_TO_TP = {
    'Average Profile': 'averageprofile',
    'AverageProfile': 'averageprofile',
    'Bin Data': 'binneddata',
    'Binned Data': 'binneddata',
    'BinnedData': 'binneddata',
    'Blank Column': 'blankcolumn',
    'BlankColumn': 'blankcolumn',
    'Categorical tests': 'chisquared',
    'ChiSquared': 'chisquared',
    'Circadian Function Index': 'circadianfunctionindex',
    'CircadianFunctionIndex': 'circadianfunctionindex',
    'Collect Columns': 'collectcolumns',
    'CollectColumns': 'collectcolumns',
    'Column Function': 'columnfunctions',
    'Column Functions': 'columnfunctions',
    'Column Set': 'columnset',
    'ColumnFunctions': 'columnfunctions',
    'ColumnSet': 'columnset',
    'Compare groups (stats)': 'groupcomparison',
    'Correlation': 'correlation',
    'Cosinor': 'cosinor',
    'Cross-correlation': 'crosscorrelation',
    'CrossCorrelation': 'crosscorrelation',
    'Describe Data': 'describedata',
    'DescribeData': 'describedata',
    'Double Logistic': 'doublelogistic',
    'DoubleLogistic': 'doublelogistic',
    'Enter Data': 'blankcolumn',
    'FDR Correction': 'fdrcorrection',
    'FDRCorrection': 'fdrcorrection',
    'Fit Function': 'fitfunction',
    'Fit Trend Curves': 'trendfit',
    'Fit trend': 'trendfit',
    'Fit waveform model': 'fitfunction',
    'FitFunction': 'fitfunction',
    'Formula Column': 'formulacolumn',
    'FormulaColumn': 'formulacolumn',
    'GroupComparison': 'groupcomparison',
    'Interpolate': 'interpolate',
    'Logistic regression': 'logisticregression',
    'LogisticRegression': 'logisticregression',
    'Long To Wide': 'longtowide',
    'Long to Wide': 'longtowide',
    'LongToWide': 'longtowide',
    'Moving Analysis': 'movinganalysis',
    'MovingAnalysis': 'movinganalysis',
    'Nonparametric RA': 'nonparametricra',
    'NonparametricRA': 'nonparametricra',
    'Normality Test': 'normalitytest',
    'NormalityTest': 'normalitytest',
    'Random': 'random',
    'Rayleigh test': 'rayleightest',
    'RayleighTest': 'rayleightest',
    'Rectangular Wave': 'rectangularwave',
    'RectangularWave': 'rectangularwave',
    'Rhythmicity Analysis': 'rhythmicityanalysis',
    'RhythmicityAnalysis': 'rhythmicityanalysis',
    'Sequence Column': 'sequencecolumn',
    'SequenceColumn': 'sequencecolumn',
    'Simulate Data': 'simulateddata',
    'SimulateData': 'simulateddata',
    'SimulatedData': 'simulateddata',
    'Smooth Data': 'smootheddata',
    'Smoothed Data': 'smootheddata',
    'SmoothedData': 'smootheddata',
    'Sort': 'sort',
    'Split': 'split',
    'Split data': 'split',
    'Stored Value Group': 'storedvaluegroup',
    'StoredValueGroup': 'storedvaluegroup',
    'Surrogate Test': 'surrogatetest',
    'SurrogateTest': 'surrogatetest',
    'Crossing': 'crossing',
    'Threshold': 'threshold',
    'Trend Fit': 'trendfit',
    'TrendFit': 'trendfit',
    'Wide To Long': 'widetolong',
    'Wide to Long': 'widetolong',
    'WideToLong': 'widetolong',
}
# <<< AUTO-GENERATED DISPLAY_TO_TP <<<


# ----------------------------------------------------------------------
# Roadmap-node pure utils + table processes (JS↔Python parity)
#
# Direct ports of the src/lib/utils/*.js utilities added for the solo-roadmap
# nodes. The pure utils (kde, meansem, circular stats, cosinor add-ons) are dispatched by name via getattr in the parity harness;
# the table-process wrappers (tp_averageprofile / tp_rayleightest /
# tp_circadianfunctionindex) run via
# TABLE_PROCESS_MAP, exactly mirroring the matching .svelte node funcs.
# ----------------------------------------------------------------------

_NAN = float('nan')


def _is_nanf(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


# --- C: Gaussian KDE (src/lib/utils/kde.js) ---

def kde(values, bandwidth=None, grid_size=128):
    """Gaussian kernel density estimation. Mirrors src/lib/utils/kde.js
    gaussianKDE header-for-header. null/None and NaN/+-inf values are ignored
    (None skipped explicitly so it is not coerced to 0.0). Silverman rule uses
    the SAMPLE std (ddof=1). Returns {'x': [...], 'density': [...]}."""
    grid_size = max(2, int(grid_size))
    cleaned = []
    for v in values:
        if v is None:
            continue
        try:
            num = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(num):
            cleaned.append(num)
    n = len(cleaned)
    if n == 0:
        return {'x': [], 'density': []}
    if bandwidth is not None and math.isfinite(bandwidth) and bandwidth > 0:
        h = float(bandwidth)
    else:
        if n < 2:
            return {'x': [], 'density': []}
        mean = sum(cleaned) / n
        var = sum((x - mean) ** 2 for x in cleaned) / (n - 1)
        sigma = math.sqrt(var)
        if not math.isfinite(sigma) or sigma <= 0:
            return {'x': [], 'density': []}
        h = 1.06 * sigma * (n ** (-1.0 / 5.0))
    if not math.isfinite(h) or h <= 0:
        return {'x': [], 'density': []}
    lo = min(cleaned) - 3.0 * h
    hi = max(cleaned) + 3.0 * h
    step = (hi - lo) / (grid_size - 1)
    norm = 1.0 / (n * h)
    inv_sqrt_2pi = 1.0 / math.sqrt(2.0 * math.pi)
    xs = []
    density = []
    for j in range(grid_size):
        xj = lo + j * step
        xs.append(xj)
        s = 0.0
        for vi in cleaned:
            u = (xj - vi) / h
            s += inv_sqrt_2pi * math.exp(-0.5 * u * u)
        density.append(norm * s)
    return {'x': xs, 'density': density}


# --- H: Mean ± SEM by group (src/lib/utils/meanSem.js) ---

def _meansem_is_valid_key(v):
    if v is None:
        return False
    if isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        return math.isfinite(v)
    return True


def _meansem_is_valid_value(v):
    return (v is not None and isinstance(v, (int, float))
            and not isinstance(v, bool) and not math.isnan(v))


def _meansem_sort_key(x):
    s = str(x)
    try:
        return (0, float(s), '')
    except (ValueError, TypeError):
        return (1, 0.0, s)


def meansem(xs, ys):
    """Group paired (x, y) by x; per group mean, SEM (sample sd / sqrt(n)),
    sd (divisor n-1) and n. Singleton groups report sd = sem = NaN. Mirrors
    src/lib/utils/meanSem.js meanSemByGroup. Returns list of {x,mean,sem,sd,n}."""
    xs = xs or []
    ys = ys or []
    n = min(len(xs), len(ys))
    groups = {}
    order = []
    for i in range(n):
        xv = xs[i]
        yv = ys[i]
        if not _meansem_is_valid_key(xv) or not _meansem_is_valid_value(yv):
            continue
        key = str(xv)
        if key not in groups:
            groups[key] = {'x': xv, 'values': []}
            order.append(key)
        groups[key]['values'].append(float(yv))
    out = []
    for key in order:
        vals = groups[key]['values']
        m = len(vals)
        mean = sum(vals) / m
        if m > 1:
            ss = sum((v - mean) ** 2 for v in vals)
            sd = math.sqrt(ss / (m - 1))
            sem = sd / math.sqrt(m)
        else:
            sd = float('nan')  # sample SD undefined at n = 1 (R sd() gives NA)
            sem = float('nan')
        out.append({'x': groups[key]['x'], 'mean': mean, 'sem': sem, 'sd': sd, 'n': m})
    out.sort(key=lambda r: _meansem_sort_key(r['x']))
    return out


# --- E: Average daily profile (src/lib/utils/averageProfile.js) ---

def compute_average_profile(t, y, period=24.0, n_bins=24):
    """Fold a series onto one period; per-bin mean (± SEM). Mirrors
    src/lib/utils/averageProfile.js averageDailyProfile."""
    n_bins = int(n_bins)
    if not (period > 0) or not (n_bins >= 1):
        return {'bin_centres': [], 'profile': [], 'sem': [], 'n': [], 'nSamples': [],
                't0': _NAN}
    bin_width = period / n_bins
    bin_centres = [b * bin_width + bin_width / 2 for b in range(n_bins)]
    length = min(len(t), len(y))
    t0 = float('inf')
    pairs = []
    for i in range(length):
        ti_raw = t[i]
        yi_raw = y[i]
        if ti_raw is None or ti_raw == '' or yi_raw is None or yi_raw == '':
            continue
        try:
            ti = float(ti_raw)
            yi = float(yi_raw)
        except (TypeError, ValueError):
            continue
        if math.isnan(ti) or math.isinf(ti) or math.isnan(yi) or math.isinf(yi):
            continue
        pairs.append((ti, yi))
        if ti < t0:
            t0 = ti
    profile = [_NAN] * n_bins
    sem = [_NAN] * n_bins
    n = [0] * n_bins
    n_samples = [0] * n_bins
    if not pairs:
        return {'bin_centres': bin_centres, 'profile': profile, 'sem': sem, 'n': n,
                'nSamples': n_samples, 't0': _NAN}
    # FIT-12: the SEM is across DAYS. Each day's samples in a bin are averaged first (the
    # samples of one day are repeated measures, not replicates; Hurlbert 1984), then the
    # profile is the mean of the day means and the SEM their SD / sqrt(days); n = days.
    # Python's % is not JS's, but on (ti - t0) >= 0 the double modulo agrees.
    buckets = [{} for _ in range(n_bins)]
    for (ti, yi) in pairs:
        tod = ((ti - t0) % period + period) % period
        day = _js_round((ti - t0 - tod) / period)
        b = int(math.floor(tod / bin_width))
        if b < 0:
            b = 0
        elif b >= n_bins:
            b = n_bins - 1
        buckets[b].setdefault(day, []).append(yi)
        n_samples[b] += 1
    for b in range(n_bins):
        day_means = [kahan_mean(vals) for vals in buckets[b].values()]
        cnt = len(day_means)
        n[b] = cnt
        if cnt == 0:
            continue
        m = kahan_mean(day_means)
        profile[b] = m
        if cnt >= 2:
            ss = sum((v - m) ** 2 for v in day_means)
            variance = ss / (cnt - 1)
            sem[b] = math.sqrt(variance) / math.sqrt(cnt)
    return {'bin_centres': bin_centres, 'profile': profile, 'sem': sem, 'n': n,
            'nSamples': n_samples, 't0': t0}


def tp_averageprofile(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    period = float(args.get('period', 24))
    n_bins = int(args.get('nBins', 24))
    x_data = _t_for_col(cols[x_in])
    phase_ref = node_phase_reference(args, cols[x_in])

    bin_centres = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        res = compute_average_profile(x_data, cols[y_id].get_data(), period, n_bins)
        if res is None or not res['bin_centres']:
            continue
        if phase_ref['clock'] and math.isfinite(res['t0']):
            # Clock time (FIT-9): bin times are hours after the series' first valid sample,
            # so add t0 plus the origin's clock hour, wrap, and reorder every bin array.
            ref = {'clock': True, 'offsetHours': phase_ref['offsetHours'] + res['t0']}
            bt, (res['profile'], res['sem'], res['n']) = relabel_folded_profile(
                res['bin_centres'], [res['profile'], res['sem'], res['n']], ref, period)
            res['bin_centres'] = bt
        if bin_centres is None:
            bin_centres = res['bin_centres']
            _set_col(raw_data, cols, _out_id(args, 'avgprofx'), bin_centres, type_='number')
        y_out = _out_id(args, f'avgprof_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'avgprof')
        _set_col(raw_data, cols, y_out, res['profile'], type_='number')
        sem_out = _out_id(args, f'avgprofsem_{y_id}')
        if sem_out == -1:
            sem_out = _out_id(args, 'avgprofsem')
        if sem_out != -1:
            _set_col(raw_data, cols, sem_out, res['sem'], type_='number')
        if any(c > 0 for c in res['n']):
            any_valid = True
    return any_valid


# --- J: Circular (directional) statistics (src/lib/utils/circular.js) ---

def to_radians(v, unit='radians', period=24):
    try:
        vv = float(v)
    except (TypeError, ValueError):
        return _NAN
    if not math.isfinite(vv):
        return _NAN
    if unit == 'degrees':
        return vv * math.pi / 180
    if unit == 'hours':
        p = period if (isinstance(period, (int, float)) and math.isfinite(period)
                       and period > 0) else 24
        return (vv / p) * 2 * math.pi
    return vv


def _clean_angles(angles_rad):
    out = []
    for a in angles_rad or []:
        if a is None or a == '':
            continue
        try:
            v = float(a)
        except (TypeError, ValueError):
            continue
        if math.isfinite(v):
            out.append(v)
    return out


def circular_mean(angles_rad):
    a = _clean_angles(angles_rad)
    n = len(a)
    if n == 0:
        return {'meanAngle': _NAN, 'R': _NAN, 'n': 0, 'C': _NAN, 'S': _NAN}
    C = kahan_mean([math.cos(x) for x in a])
    S = kahan_mean([math.sin(x) for x in a])
    R = math.sqrt(C * C + S * S)
    mean_angle = math.atan2(S, C)
    if mean_angle < 0:
        mean_angle += 2 * math.pi
    return {'meanAngle': mean_angle, 'R': R, 'n': n, 'C': C, 'S': S}


def rayleigh_test(angles_rad):
    cm = circular_mean(angles_rad)
    n = cm['n']
    if n == 0:
        return {'n': 0, 'R': _NAN, 'meanAngle': _NAN, 'z': _NAN, 'pValue': _NAN}
    R = cm['R']
    z = n * R * R
    inner = (1 + (2 * z - z * z) / (4 * n)
             - (24 * z - 132 * z * z + 76 * z ** 3 - 9 * z ** 4) / (288 * n * n))
    p = math.exp(-z) * inner
    if not math.isfinite(p):
        p = math.exp(-z)
    p = min(1.0, max(0.0, p))
    return {'n': n, 'R': R, 'meanAngle': cm['meanAngle'], 'z': z, 'pValue': p}


def weighted_circular_mean(angles_rad, weights):
    C = 0.0; S = 0.0; W = 0.0; n = 0
    for a, w in zip(angles_rad, weights):
        if a is None or w is None: continue
        try:
            a = float(a); w = float(w)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(a) and math.isfinite(w)): continue
        C += w * math.cos(a); S += w * math.sin(a); W += w; n += 1
    if n == 0 or W <= 0:
        return {'meanAngle': _NAN, 'R': _NAN, 'n': n,
                'W': (_NAN if n == 0 else W), 'C': _NAN, 'S': _NAN}
    R = math.sqrt(C * C + S * S) / W
    mean = math.atan2(S, C)
    if mean < 0: mean += 2 * math.pi
    return {'meanAngle': mean, 'R': R, 'n': n, 'W': W, 'C': C, 'S': S}


def weighted_rayleigh(angles_rad, weights):
    cm = weighted_circular_mean(angles_rad, weights)
    n = cm['n']; R = cm['R']; W = cm['W']
    sum_sq = 0.0
    for a, w in zip(angles_rad, weights):
        if a is None or w is None: continue
        try:
            a = float(a); w = float(w)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(a) and math.isfinite(w)): continue
        sum_sq += w * w
    if n == 0 or not (isinstance(W, float) and W > 0) or sum_sq <= 0 or not math.isfinite(R):
        return {'n': n, 'nEff': _NAN, 'R': _NAN, 'meanAngle': _NAN, 'z': _NAN, 'pValue': _NAN,
                'W': (W if isinstance(W, float) and math.isfinite(W) else _NAN)}
    n_eff = (W * W) / sum_sq
    z = n_eff * R * R
    inner = (1 + (2 * z - z * z) / (4 * n_eff)
             - (24 * z - 132 * z * z + 76 * z ** 3 - 9 * z ** 4) / (288 * n_eff * n_eff))
    p = math.exp(-z) * inner
    if not math.isfinite(p): p = math.exp(-z)
    p = min(1.0, max(0.0, p))
    return {'n': n, 'nEff': n_eff, 'R': R, 'meanAngle': cm['meanAngle'], 'z': z, 'pValue': p, 'W': W}


def kappa_from_rbar(r_bar):
    if not (isinstance(r_bar, (int, float)) and math.isfinite(r_bar)) or r_bar <= 0:
        return 0.0
    if r_bar >= 1:
        return float('inf')
    if r_bar < 0.53:
        return 2 * r_bar + r_bar ** 3 + (5 * r_bar ** 5) / 6
    if r_bar < 0.85:
        return -0.4 + 1.39 * r_bar + 0.43 / (1 - r_bar)
    return 1 / (r_bar ** 3 - 4 * r_bar ** 2 + 3 * r_bar)


def _resultant(angles_rad):
    a = _clean_angles(angles_rad)
    n = len(a)
    C = sum(math.cos(x) for x in a)
    S = sum(math.sin(x) for x in a)
    r = math.sqrt(C * C + S * S)
    return {'n': n, 'C': C, 'S': S, 'r': r, 'rBar': (r / n) if n > 0 else _NAN}


def _p_upper_from_f(F, df1, df2):
    # fdist.js pUpperFromF: the upper tail computed directly; F = Infinity gives 0.
    if F != F or not (math.isfinite(df1) and math.isfinite(df2)):
        return _NAN
    if df1 <= 0 or df2 <= 0 or F < 0:
        return _NAN
    return 0.0 if F == math.inf else float(sp_stats.f.sf(F, df1, df2))


def watson_williams(groups_of_angles, p_from_f=_p_upper_from_f):
    groups = [g for g in (_resultant(gr) for gr in (groups_of_angles or []))
              if g['n'] > 0]
    k = len(groups)
    invalid = {'k': k, 'N': 0, 'F': _NAN, 'df1': _NAN, 'df2': _NAN,
               'kappa': _NAN, 'beta': _NAN, 'Rsum': _NAN, 'r': _NAN,
               'pValue': _NAN, 'valid': False}
    if k < 2:
        return invalid
    N = sum(g['n'] for g in groups)
    if N <= k:
        return {**invalid, 'N': N}
    Rsum = sum(g['r'] for g in groups)
    Cp = sum(g['C'] for g in groups)
    Sp = sum(g['S'] for g in groups)
    r = math.sqrt(Cp * Cp + Sp * Sp)
    r_bar_w = Rsum / N
    kappa = kappa_from_rbar(r_bar_w)
    beta = float('inf') if kappa == 0 else 1 + 3 / (8 * kappa)
    denom = (k - 1) * (N - Rsum)
    if denom == 0:
        F = 0.0 if (Rsum - r) == 0 else float('inf')
    else:
        F = (beta * (N - k) * (Rsum - r)) / denom
    df1 = k - 1
    df2 = N - k
    p = _NAN
    if callable(p_from_f) and math.isfinite(F):
        p = p_from_f(F, df1, df2)
    elif F == float('inf'):
        p = 0.0
    return {'k': k, 'N': N, 'F': F, 'df1': df1, 'df2': df2, 'kappa': kappa,
            'beta': beta, 'Rsum': Rsum, 'r': r, 'pValue': p, 'valid': True}


def _angles_col_to_radians(data, unit, period):
    out = []
    for v in data or []:
        if v is None:
            out.append(_NAN)
            continue
        if isinstance(v, str) and v.strip() == '':
            out.append(_NAN)
            continue
        try:
            num = float(v)
        except (TypeError, ValueError):
            out.append(_NAN)
            continue
        out.append(to_radians(num, unit, period) if math.isfinite(num) else _NAN)
    return out


def _column_to_phase_hours(data, col_type):
    """Time-hours for the Rayleigh weighted-mode time input: a 'time'-type
    column is raw epoch-ms -> ABSOLUTE hours (n/3.6e6, no baseline
    subtraction); any other type is raw hours already. Gaps/blank/non-numeric
    -> NaN. Mirrors circularPlot.js columnToPhaseHours exactly (this is
    deliberately NOT Column.hours_since_start, which subtracts a baseline)."""
    out = []
    for v in data or []:
        if v is None:
            out.append(_NAN)
            continue
        if isinstance(v, str) and v.strip() == '':
            out.append(_NAN)
            continue
        try:
            n = float(v)
        except (TypeError, ValueError):
            out.append(_NAN)
            continue
        if not math.isfinite(n):
            out.append(_NAN)
            continue
        out.append(n / 3_600_000.0 if col_type == 'time' else n)
    return out


def _time_to_angle_rad(hours, period):
    """Fold hours modulo period and map to radians (0 at phase 0). Mirrors
    circularPlot.js timeToAngleRad exactly."""
    if not (isinstance(hours, (int, float)) and math.isfinite(hours)):
        return _NAN
    p = period if (isinstance(period, (int, float)) and period > 0) else 24
    return ((hours % p + p) % p) / p * (2 * math.pi)


def tp_rayleightest(args, cols, raw_data, _sv):
    # Circular-stats node: the Rayleigh uniformity test ALWAYS runs (per-Y
    # R/z/pvalue). The optional Watson-Williams equal-mean-direction test
    # (showWatsonWilliams) adds a single F/ww_pvalue across the Y columns.
    # Mirrors RayleighTest.svelte.
    y_ins = _id_list(args.get('yIN'))
    if not y_ins:
        return False
    unit = args.get('unit', 'radians')
    period = args.get('period', 24)
    if not (isinstance(period, (int, float)) and math.isfinite(period)):
        period = 24

    # Optional: when the Y values were measured. When wired, the test switches
    # to an amplitude-weighted mode (weighted_rayleigh): the time column
    # supplies the angle, the Y value is the weight, and `unit` is ignored.
    time_in = args.get('timeIN', -1)
    time_col = cols.get(time_in) if time_in is not None and time_in != -1 else None

    per_y = {}
    any_valid = False
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y_col = cols[y_id]

        if time_col is not None:
            angles = [_time_to_angle_rad(h, period)
                      for h in _column_to_phase_hours(time_col.get_data(), time_col.type)]
            s = weighted_rayleigh(angles, y_col.get_data())
            if s['n'] > 0:
                # Mirrors circularPlot.js weightedSeriesStats, which scales by
                # displayPeriodFor('hours', period): falls back to 24 when
                # period <= 0 (same fallback timeToAngleRad already applies).
                display_period = (period if (isinstance(period, (int, float))
                                              and math.isfinite(period) and period > 0)
                                   else 24)
                mean_value = ((s['meanAngle'] / (2 * math.pi)) * display_period
                              if math.isfinite(s['meanAngle']) else _NAN)
                # No z or p in timed mode (FIT-11), as weightedSeriesStats: the weights are the
                # series' values, so the weighted Rayleigh p moves with a constant baseline.
                per_y[y_id] = {'R': s['R'], 'z': _NAN, 'pValue': _NAN,
                               'meanAngle': s['meanAngle'], 'meanValue': mean_value}
                any_valid = True
            continue

        angles = _angles_col_to_radians(y_col.get_data(), unit, period)
        res = rayleigh_test(angles)
        if res['n'] > 0:
            mean_value = ((res['meanAngle'] / (2 * math.pi)) * period
                          if math.isfinite(res['meanAngle']) else _NAN)
            per_y[y_id] = {**res, 'meanValue': mean_value}
            any_valid = True
    if not any_valid:
        return False
    for key in ('R', 'z', 'pvalue', 'acrophase'):
        field = {'pvalue': 'pValue', 'acrophase': 'meanValue'}.get(key, key)
        arr = [per_y[y].get(field, _NAN) if y in per_y else _NAN for y in y_ins]
        _set_col(raw_data, cols, _out_id(args, key), arr, type_='number')

    # Optional Watson-Williams: a single F/ww_pvalue across the groups (NaN when
    # the test is off, timed, or degenerate), so the ports stay numeric +
    # present. WW is meaningless in timed mode (yIN holds amplitude values, not
    # event angles) — mirrors RayleighTest.svelte's isTimeWired guard.
    ww_F, ww_p = _NAN, _NAN
    if args.get('showWatsonWilliams') and time_col is None:
        groups = [
            _angles_col_to_radians(cols[y_id].get_data(), unit, period)
            for y_id in y_ins
            if y_id is not None and y_id != -1 and y_id in cols
        ]
        result = watson_williams(groups, _p_upper_from_f)
        if result['valid']:
            ww_F, ww_p = result['F'], result['pValue']
    _set_col(raw_data, cols, _out_id(args, 'F'), [ww_F], type_='number')
    _set_col(raw_data, cols, _out_id(args, 'ww_pvalue'), [ww_p], type_='number')
    return True


# --- L: Cosinor add-ons (src/lib/utils/cosinorAddons.js) ---

def wrap_to_period(hrs, period_hrs):
    if not (isinstance(hrs, (int, float)) and math.isfinite(hrs)) or not (period_hrs > 0):
        return _NAN
    return ((hrs % period_hrs) + period_hrs) % period_hrs


def bathyphase(acrophase_hrs, period_hrs):
    if not (isinstance(acrophase_hrs, (int, float)) and math.isfinite(acrophase_hrs)) \
            or not (period_hrs > 0):
        return _NAN
    return wrap_to_period(acrophase_hrs + period_hrs / 2, period_hrs)


# --- Time origin and phase reference (utils/phaseReference.js) -------------------------
#
# The session's display time zone (appState.displayTimezone). The exported scripts set it
# from the session; clock-time phase outputs are hours after local midnight in it.
DISPLAY_TIMEZONE = 'utc'


def set_display_timezone(zone):
    """Set the session's display zone (exported scripts call this; works whether the
    runtime is inlined or imported as ancir_helpers)."""
    global DISPLAY_TIMEZONE
    DISPLAY_TIMEZONE = zone or 'utc'


PHASE_REFERENCE_START = 'start'
PHASE_REFERENCE_CLOCK = 'clock'
_CLOCK_FALLBACK_WARNING = ('Phase reference "Clock time of day" needs a time column as x; '
                           'phases are reported as hours since the first sample instead.')


def _wrap_js(h, period):
    """cosinorAddons.js wrapToPeriod with JS remainder semantics."""
    if not (isinstance(h, (int, float)) and math.isfinite(h)) or not (period > 0):
        return _NAN
    return math.fmod(math.fmod(h, period) + period, period)


def time_origin_ms(col):
    """phaseReference.js timeOriginMs: a time column's MINIMUM valid timestamp (the
    baseline hoursSinceStart measures from); None otherwise."""
    if col is None or col.type != 'time':
        return None
    vals = [_js_number(v) for v in (col.get_data() or []) if not _js_invalid(v)]
    vals = [v for v in vals if math.isfinite(v)]
    return min(vals) if vals else None


def fit_time_frame(t_col, output_x_col=None):
    """phaseReference.js fitTimeFrame: (origin_ms, output_x_data) for a fit. A time output
    grid on a time input is put in the INPUT's hour frame ((ms - input min) / 3.6e6) with the
    input's origin; a numeric output grid is taken as hours in that frame; a time grid on a
    numeric input keeps its own hours and origin. Invalid grid values are dropped."""
    in_origin = time_origin_ms(t_col)
    origin = in_origin
    out = None
    if output_x_col is not None:
        if output_x_col.type == 'time':
            if in_origin is not None:
                out = [(_js_number(v) - in_origin) / 3600000
                       for v in (output_x_col.get_data() or []) if not _js_invalid(v)]
            else:
                origin = time_origin_ms(output_x_col)
                out = [v for v in (output_x_col.hours_since_start or []) if not _js_invalid(v)]
        else:
            out = [_js_number(v) for v in (output_x_col.get_data() or [])
                   if not _js_invalid(v)]
    return origin, out


def clock_hour_of_day(ms, zone='utc'):
    """phaseReference.js clockHourOfDay: hours after local midnight in `zone`, in [0, 24)."""
    if ms is None or not math.isfinite(ms):
        return _NAN
    import datetime as _dt
    if not zone or zone in ('utc', 'UTC'):
        d = _dt.datetime.fromtimestamp(ms / 1000, tz=_dt.timezone.utc)
    else:
        from zoneinfo import ZoneInfo
        d = _dt.datetime.fromtimestamp(ms / 1000, tz=ZoneInfo(zone))
    msec = int(round(ms)) % 1000
    return d.hour + d.minute / 60 + d.second / 3600 + msec / 3600000


def resolve_phase_reference(reference, origin_ms, zone=None):
    """phaseReference.js resolvePhaseReference -> {'clock', 'offsetHours', 'warning'}."""
    if reference != PHASE_REFERENCE_CLOCK:
        return {'clock': False, 'offsetHours': 0.0, 'warning': None}
    off = _NAN if origin_ms is None else clock_hour_of_day(
        origin_ms, DISPLAY_TIMEZONE if zone is None else zone)
    if not math.isfinite(off):
        return {'clock': False, 'offsetHours': 0.0, 'warning': _CLOCK_FALLBACK_WARNING}
    return {'clock': True, 'offsetHours': off, 'warning': None}


def node_phase_reference(args, x_col):
    """phaseReferenceSupport.js resolveNodePhaseReference."""
    if (args or {}).get('phaseReference') != PHASE_REFERENCE_CLOCK:
        return resolve_phase_reference(None, None)
    return resolve_phase_reference(PHASE_REFERENCE_CLOCK, time_origin_ms(x_col))


def apply_phase_reference(hrs, ref, period):
    """phaseReference.js applyPhaseReference: untouched in the default reference; clock time
    adds the origin's clock hour and wraps to [0, period)."""
    if not (ref and ref.get('clock')):
        return hrs
    if hrs is None or not math.isfinite(hrs):
        return _NAN
    return _wrap_js(hrs + ref['offsetHours'], period)


def relabel_folded_profile(bin_times, series, ref, period):
    """phaseReference.js relabelFoldedProfile: shift and wrap the bin times, then reorder the
    bins (and every parallel array) so the times ascend (stable)."""
    if not (ref and ref.get('clock')) or bin_times is None:
        return bin_times, series
    shifted = [apply_phase_reference(c, ref, period) for c in bin_times]
    order = sorted(range(len(shifted)), key=lambda i: shifted[i])
    return ([shifted[i] for i in order],
            [[arr[i] for i in order] if isinstance(arr, list) else arr for arr in series])


def nearest_phase_instant(phase, period, centre):
    """phaseReference.js nearestPhaseInstant: phase moved by whole periods to within half a
    period of centre (round = floor(x + 0.5), JS Math.round)."""
    if not (isinstance(phase, (int, float)) and math.isfinite(phase)) or not (period > 0) \
            or not math.isfinite(centre):
        return _NAN
    return phase + period * math.floor((centre - phase) / period + 0.5)


WAVEFORM_GRID_POINTS = 2880


def multi_component_waveform(M, harmonics, period):
    """cosinorAddons.js multiComponentWaveform: the overall waveform of a multi-harmonic
    cosinor on a 2880-point grid, peak and trough refined by a parabola through three points;
    amplitude = half the range, orthophase and bathyphase in [0, period)."""
    nan = {'amplitude': _NAN, 'orthophase': _NAN, 'bathyphase': _NAN, 'max': _NAN,
           'min': _NAN}
    if not _finite(M) or not (period > 0) or not harmonics:
        return nan
    for h in harmonics:
        if not all(_finite(h.get(k)) for k in ('k', 'beta', 'gamma')):
            return nan
    N = WAVEFORM_GRID_POINTS
    dt = period / N
    om = 2 * math.pi / period
    y = [0.0] * N
    i_max = i_min = 0
    for i in range(N):
        t = i * dt
        v = M
        for h in harmonics:
            v += h['beta'] * math.cos(h['k'] * om * t) + h['gamma'] * math.sin(h['k'] * om * t)
        y[i] = v
        if v > y[i_max]:
            i_max = i
        if v < y[i_min]:
            i_min = i

    def refine(i):
        a, b, c = y[(i - 1 + N) % N], y[i], y[(i + 1) % N]
        den = a - 2 * b + c
        d = (0.5 * (a - c)) / den if den != 0 else 0.0
        off = max(-0.5, min(0.5, d))
        return _wrap_js((i + off) * dt, period), b - 0.25 * (a - c) * off
    ht, hv = refine(i_max)
    lt, lv = refine(i_min)
    return {'amplitude': (hv - lv) / 2, 'orthophase': ht, 'bathyphase': lt, 'max': hv,
            'min': lv}


def phase_angle_of_entrainment(acrophase_hrs, reference_hrs=0, period_hrs=24):
    if not (isinstance(acrophase_hrs, (int, float)) and math.isfinite(acrophase_hrs)) \
            or not (period_hrs > 0):
        return _NAN
    ref = reference_hrs if (isinstance(reference_hrs, (int, float))
                            and math.isfinite(reference_hrs)) else 0
    d = wrap_to_period(acrophase_hrs - ref, period_hrs)
    if d > period_hrs / 2:
        d -= period_hrs
    return d


def _clamp01(v):
    if not (isinstance(v, (int, float)) and math.isfinite(v)):
        return _NAN
    return min(1.0, max(0.0, v))


def circadian_function_index(IS=None, IV=None, RA=None):
    is_c = _clamp01(IS)
    iv_c = _clamp01((2 - IV) / 2) if (isinstance(IV, (int, float)) and math.isfinite(IV)) else _NAN
    ra_c = _clamp01(RA)
    components = {'IS': is_c, 'IVcomplement': iv_c, 'RA': ra_c}
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (is_c, iv_c, ra_c)):
        return {'CFI': _NAN, 'components': components}
    return {'CFI': (is_c + iv_c + ra_c) / 3, 'components': components}


def tp_circadianfunctionindex(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    epoch = float(args.get('epochHours', 1))
    period = float(args.get('period', 24))
    m_window = float(args.get('mWindow', 10))
    l_window = float(args.get('lWindow', 5))
    t = _t_for_col(cols[x_in])
    if not t:
        return False
    per_y = {}
    any_valid = False
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y = cols[y_id].get_data()
        if not y:
            continue
        res = compute_npcra(t, y, epoch, period, m_window, l_window)
        if not res:
            continue
        cfi = circadian_function_index(IS=res['IS'], IV=res['IV'], RA=res['RA'])['CFI']
        per_y[y_id] = {'CFI': cfi, 'IS': res['IS'], 'IV': res['IV'], 'RA': res['RA']}
        any_valid = True
    if not any_valid:
        return False
    for key in ('CFI', 'IS', 'IV', 'RA'):
        arr = [per_y[y][key] if y in per_y else _NAN for y in y_ins]
        _set_col(raw_data, cols, _out_id(args, key), arr, type_='number')
    return True


# --- DescribeData / NormalityTest / Correlation / CrossCorrelation ------------
# --- ChiSquared / LogisticRegression / Interpolate ---------------------------
#
# These seven were the PYTHON_GAPS: analyses the JS engine had and the Python port
# did not. Their numeric kernels already existed here (describe_stats, correlate,
# cross_correlation, chi_square_*, logistic_regression, shapiro_wilk/d_agostino/
# jarque_bera) and were parity-checked; only the table-process wrappers that write
# their results into output columns were missing. That is precisely why the gap was
# invisible: no wrapper means no fixture, so nothing failed.
#
# ColumnSet is NOT here and is not a gap. It emits no columns (nodeSpec.outputs is
# empty) and its selection is materialised into each consumer's real inputs by
# syncTPSets before a session is ever saved, so by export time consumers already
# hold concrete column ids and there is nothing for a runtime to do.


def _result_rows(raw_data, cols, args, columns):
    """Write a result TABLE: `columns` is {out_key: [values]}, one row per entry."""
    wrote = False
    for key, values in columns.items():
        out_id = _out_id(args, key)
        if out_id == -1:
            continue
        is_text = any(isinstance(v, str) for v in values)
        _set_col(raw_data, cols, out_id, values,
                 type_='category' if is_text else 'number')
        wrote = True
    return wrote


def tp_describedata(args, cols, raw_data, _sv):
    """One row per wired column: n, centre, spread, shape."""
    y_ins = _id_list(args.get('yIN'))
    if not y_ins:
        return False
    keys = ('n', 'mean', 'median', 'sd', 'min', 'max', 'range',
            'q1', 'q3', 'iqr', 'skewness', 'kurtosis')
    rows = {'variable': []}
    for k in keys:
        rows[k] = []
    for y_id in y_ins:
        if y_id not in cols:
            continue
        col = cols[y_id]
        st = describe_stats(col.get_data())
        rows['variable'].append(col.name or str(y_id))
        for k in keys:
            rows[k].append(st[k])
    return _result_rows(raw_data, cols, args, rows)


def tp_normalitytest(args, cols, raw_data, _sv):
    """One row per wired column. Default is Shapiro-Wilk, matching the JS."""
    y_ins = _id_list(args.get('yIN'))
    if not y_ins:
        return False
    method = args.get('method', 'shapiro')
    alpha = float(args.get('alpha', 0.05))
    fn = {'shapiro': shapiro_wilk,
          'dagostino': d_agostino,
          'jarquebera': jarque_bera}.get(method, shapiro_wilk)
    rows = {'variable': [], 'statistic': [], 'pvalue': [], 'n': [], 'normal': []}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        col = cols[y_id]
        res = fn(col.get_data())
        p = res['pvalue']
        rows['variable'].append(col.name or str(y_id))
        rows['statistic'].append(res['statistic'])
        rows['pvalue'].append(p)
        rows['n'].append(res['n'])
        # NaN p (test could not run) is NOT evidence of normality, so it stays NaN
        # rather than collapsing to 0/1.
        rows['normal'].append(float('nan') if _isnan(p) else (1 if p > alpha else 0))
    return _result_rows(raw_data, cols, args, rows)


def jarque_bera_normality(values):
    """Port of GroupComparison.svelte jarqueBeraNormality: the app's assumption check (used
    by Correlation's `auto` method and GroupComparison's warnings). The textbook statistic on
    the population (n-divisor) moments, the same as the NormalityTest node's Jarque-Bera
    (utils/normality.js; Jarque and Bera 1987). It used to standardise by the n - 1 SD
    (STAT-25). Fewer than 8 values is not evaluable; zero variance is evaluable and
    non-normal; normal means p >= 0.05."""
    clean = _gc_present_numbers(values)
    n = len(clean)
    if n < 8:
        return {'evaluable': False, 'normal': None}
    m = float(np.mean(clean))
    m2 = sum((x - m) ** 2 for x in clean) / n
    if not math.isfinite(m2) or m2 == 0:
        return {'evaluable': True, 'normal': False, 'statistic': float('inf'), 'pValue': 0.0}
    skew = (sum((x - m) ** 3 for x in clean) / n) / m2 ** 1.5
    kurt = (sum((x - m) ** 4 for x in clean) / n) / (m2 * m2)
    jb = (n / 6) * (skew ** 2 + (kurt - 3) ** 2 / 4)
    p = float(sp_stats.chi2.sf(jb, 2)) if math.isfinite(jb) and jb >= 0 else float('nan')
    return {'evaluable': True, 'normal': (p >= 0.05) if math.isfinite(p) else False,
            'statistic': jb, 'pValue': p}


def tp_correlation(args, cols, raw_data, _sv):
    """Port of Correlation.svelte `correlation`: the pairwise matrix over the wired columns,
    one row per pair, under ONE method for the whole matrix. `auto` is Pearson unless ANY
    column is non-normal by the app's Jarque-Bera check (jarque_bera_normality), then
    Spearman for every pair."""
    y_ins = [y for y in _id_list(args.get('yIN')) if y in cols]
    if len(y_ins) < 2:
        return False
    requested = args.get('method', 'auto') or 'auto'
    alpha_raw = args.get('alpha', 0.05)
    try:
        alpha = float(alpha_raw)
    except (TypeError, ValueError):
        alpha = float('nan')
    if not math.isfinite(alpha):
        alpha = 0.05
    columns = [cols[y].get_data() or [] for y in y_ins]
    names = [cols[y].name if cols[y].name is not None else str(y) for y in y_ins]
    use = 'spearman' if requested == 'spearman' else 'pearson'
    if requested == 'auto':
        for c in columns:
            jb = jarque_bera_normality(c)
            if jb['evaluable'] and jb['normal'] is False:
                use = 'spearman'
                break
    rows = {'var_i': [], 'var_j': [], 'r': [], 'pvalue': [], 'n': [],
            'ciLow': [], 'ciHigh': []}
    for a in range(len(y_ins)):
        for b in range(a + 1, len(y_ins)):
            res = correlate(columns[a], columns[b], use)
            ci = correlation_ci([res['r'], res['n']], use, 1 - alpha)
            rows['var_i'].append(names[a])
            rows['var_j'].append(names[b])
            rows['r'].append(res['r'])
            rows['pvalue'].append(res['pvalue'])
            rows['n'].append(res['n'])
            rows['ciLow'].append(ci['ciLow'])
            rows['ciHigh'].append(ci['ciHigh'])
    # Holm (1979) across every pair (statsmodels multipletests 'holm' via p_adjust); NaN p stays
    # NaN and is excluded from the family. `significant` reads the ADJUSTED p.
    rows['padj'] = p_adjust(rows['pvalue'], 'holm')['adjusted']
    rows['significant'] = [float('nan') if _isnan(q) else (1 if q < alpha else 0)
                           for q in rows['padj']]
    _result_rows(raw_data, cols, args, rows)
    return True


def tp_crosscorrelation(args, cols, raw_data, _sv):
    """Correlation at each lag between two series; one row per lag."""
    x_in = args.get('xIN', -1)
    y_in = args.get('yIN', -1)
    if isinstance(y_in, list):
        y_in = y_in[0] if y_in else -1
    if x_in == -1 or y_in == -1 or x_in not in cols or y_in not in cols:
        return False
    ml = _js_number(args.get('maxLag', 0))
    res = cross_correlation(cols[x_in].get_data() or [], cols[y_in].get_data() or [],
                            ml if ml > 0 else 0, args.get('method', 'pearson'))
    if not res['lags']:
        return False
    return _result_rows(raw_data, cols, args, {
        'lag': res['lags'], 'correlation': res['r'], 'pvalue': res['pvalue']})


def _is_missing_category(v):
    """chisquare.js isMissingCategory: null, a blank or whitespace-only string, and NaN (or
    the text 'NaN') are absent."""
    if v is None or (isinstance(v, str) and v.strip(_JS_WS) == ''):
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return _js_string(v) == 'NaN'


def _js_string(v):
    """JS String(v) for the values a column holds: integral floats print without '.0'."""
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, float):
        if math.isnan(v):
            return 'NaN'
        if v.is_integer() and abs(v) < 1e21:
            return str(int(v))
    return str(v)


def contingency_table(row_var, col_var):
    """chisquare.js contingencyTable: PAIRED columns cross-tabulated by index (to the shorter
    length), rows with a missing cell skipped, labels in order of first appearance."""
    row_labels, col_labels, cells = [], [], {}
    n = min(len(row_var or []), len(col_var or []))
    for i in range(n):
        r, c = row_var[i], col_var[i]
        if _is_missing_category(r) or _is_missing_category(c):
            continue
        rk, ck = _js_string(r), _js_string(c)
        if rk not in row_labels:
            row_labels.append(rk)
        if ck not in col_labels:
            col_labels.append(ck)
        cells[(rk, ck)] = cells.get((rk, ck), 0) + 1
    table = [[cells.get((r, c), 0) for c in col_labels] for r in row_labels]
    return {'rowLabels': row_labels, 'colLabels': col_labels, 'table': table}


def groups_to_table(columns, names=None):
    """chisquare.js groupsToTable: INDEPENDENT groups, one column per group holding that
    group's outcomes; rows are the groups, columns the outcomes by first appearance."""
    groups = [c for c in (columns or []) if isinstance(c, list)]
    names = names or []
    if len(groups) < 2:
        return {'rowLabels': [], 'colLabels': [], 'table': []}
    col_labels, per_group = [], []
    for vals in groups:
        counts = {}
        for v in vals:
            if _is_missing_category(v):
                continue
            k = _js_string(v)
            if k not in col_labels:
                col_labels.append(k)
            counts[k] = counts.get(k, 0) + 1
        per_group.append(counts)
    row_labels = [names[i] if i < len(names) and names[i] is not None else f'Group {i + 1}'
                  for i in range(len(groups))]
    table = [[counts.get(c, 0) for c in col_labels] for counts in per_group]
    return {'rowLabels': row_labels, 'colLabels': col_labels, 'table': table}


def fisher_exact_full(table, alternative='two-sided'):
    """utils/fisherExact.js fisherExact on a 2x2 table: the p-value for `alternative`, the
    conditional-MLE odds ratio and its exact 95% interval for the SAME alternative ('less' is
    [0, upper], 'greater' is [lower, inf], as R fisher.test). A table with an empty row or column margin gives
    p = 1 and NaN estimates, as in the app. Returns None for a table that is not 2x2 of
    non-negative whole counts or has an unknown alternative."""
    if (not isinstance(table, list) or len(table) != 2
            or any(not isinstance(r, list) or len(r) != 2 for r in table)):
        return None
    if alternative not in ('two-sided', 'less', 'greater'):
        return None
    cells = [float(v) for r in table for v in r]
    if any((not math.isfinite(v)) or v < 0 or not v.is_integer() for v in cells):
        return None
    a, b, c, d = cells
    if a + b + c + d == 0:
        return None
    nan = float('nan')
    if a + b == 0 or c + d == 0 or a + c == 0 or b + d == 0:
        return {'pvalue': 1.0, 'conditionalOddsRatio': nan, 'ciLow': nan, 'ciHigh': nan}
    p = fisher_exact_test([[int(a), int(b)], [int(c), int(d)]], alternative)['pvalue']
    ci = fisher_odds_ratio_ci([[int(a), int(b)], [int(c), int(d)]], 0.95, alternative)
    return {'pvalue': min(1.0, max(0.0, p)), 'conditionalOddsRatio': ci['conditionalOddsRatio'],
            'ciLow': ci['ciLow'], 'ciHigh': ci['ciHigh']}


def tp_chisquared(args, cols, raw_data, _sv):
    """Port of ChiSquared.svelte `chisquared` (the "Categorical tests" node).

    testType: 'independence' (default), 'goodness' or 'fisher'. For independence and
    Fisher the two wired columns are read per `dataFormat`: 'groups' (the DEFAULT, also for
    sessions saved without it) treats each column as one independent group's outcomes;
    'paired' cross-tabulates them row by row. Writes statistic / pvalue / df / effectSize /
    ciLow / ciHigh (Cramer's V, Cohen's w or the conditional-MLE odds ratio; the interval is
    Fisher's only). Like the app, a result it cannot compute (too few categories, a NaN
    p-value) is VALID but writes nothing."""
    x_in = args.get('xIN', -1)
    y_in = args.get('yIN', -1)
    if isinstance(y_in, list):
        y_in = y_in[0] if y_in else -1
    test_type = args.get('testType')
    if test_type not in ('goodness', 'fisher'):
        test_type = 'independence'
    data_format = args.get('dataFormat', 'groups')
    correction = bool(args.get('correction', True))
    nan = float('nan')

    def is_ref(cid):
        return cid is not None and cid != -1 and cid in cols

    def write(stat, p, df, effect, ci_low=nan, ci_high=nan):
        if p is None or (isinstance(p, float) and math.isnan(p)):
            return True  # the app gates the write on the p-value
        _result_rows(raw_data, cols, args, {
            'statistic': [stat], 'pvalue': [p], 'df': [df], 'effectSize': [effect],
            'ciLow': [ci_low], 'ciHigh': [ci_high]})
        return True

    def build_table():
        rc, cc = cols[x_in], cols[y_in]
        a, b = rc.get_data() or [], cc.get_data() or []
        if data_format == 'groups':
            return groups_to_table([list(a), list(b)],
                                   [rc.name or 'Group 1', cc.name or 'Group 2'])
        return contingency_table(a, b)

    if test_type in ('fisher', 'independence'):
        if not is_ref(x_in) or not is_ref(y_in):
            return False
        built = build_table()
        table = built['table']
        if test_type == 'fisher':
            if not (len(table) == 2 and len(table[0]) == 2):
                return True
            fx = fisher_exact_full(table, args.get('alternative') or 'two-sided')
            if fx is None:
                return True
            return write(nan, fx['pvalue'], nan, fx['conditionalOddsRatio'],
                         fx['ciLow'], fx['ciHigh'])
        if len(built['rowLabels']) < 2 or len(built['colLabels']) < 2:
            return True
        if sum(sum(r) for r in table) <= 0:
            return True
        res = chi_square_independence_effects(table, correction)
        return write(res['statistic'], res['pvalue'], res['df'],
                     res.get('cramersV', nan))

    # goodness of fit: `gofInput` 'auto' (default) reads an all-numeric column as observed
    # counts and anything else as categories (tabulated by first appearance), tested against
    # a uniform expectation; 'counts' / 'categories' force one reading (STAT-13). Missing
    # cells (None, blank, NaN) are dropped first, and counts must be non-negative whole
    # numbers, else nothing is written (ChiSquared.svelte countsProblem).
    if not is_ref(x_in):
        return False
    raw = cols[x_in].get_data() or []

    def numeric_cell(v):
        if isinstance(v, bool):
            return False
        try:
            return math.isfinite(_js_number(v))
        except (TypeError, ValueError):
            return False

    gof_input = args.get('gofInput')
    if gof_input not in ('auto', 'counts', 'categories'):
        gof_input = 'auto'
    present = [v for v in raw if not _is_missing_category(v)]
    if gof_input == 'counts' or (gof_input == 'auto' and present
                                 and all(numeric_cell(v) for v in present)):
        if not all(numeric_cell(v) for v in present):
            return True
        observed = [float(_js_number(v)) for v in present]
        if any(v < 0 or v != math.floor(v) for v in observed):
            return True
    else:
        counts = {}
        for v in raw:
            if _is_missing_category(v):
                continue
            k = _js_string(v)
            counts[k] = counts.get(k, 0) + 1
        observed = list(counts.values())
    if len(observed) < 2:
        return True
    res = chi_square_goodness_of_fit(observed)
    return write(res['statistic'], res['pvalue'], res['df'],
                 cohens_w(res['statistic'], sum(observed)))


def _isfinite(v):
    return v is not None and isinstance(v, (int, float)) and math.isfinite(v)


def _logit_coerce_binary(raw):
    """LogisticRegression.svelte coerceBinary: (y as 0/1/NaN, positive class or None).
    Levels are the distinct String() values of the cells that are not missing
    (_is_missing_category: null, NaN, 'NaN', blank or whitespace; review STAT-24). All of
    them '0'/'1' -> Number(); exactly two other levels -> the later in sort order is 1;
    anything else is not binary. A missing cell is NaN in y, so the fit drops that row."""
    present = [v for v in raw if not _is_missing_category(v)]
    levels = []
    for v in present:
        sv = _js_string(v)
        if sv not in levels:
            levels.append(sv)
    if all(lv in ('0', '1') for lv in levels):
        return [float('nan') if _is_missing_category(v) else _js_number(v) for v in raw], '1'
    if len(levels) != 2:
        return [float('nan')] * len(raw), None
    positive = sorted(levels, key=lambda t: t.encode('utf-16-be'))[1]
    return [float('nan') if _is_missing_category(v) else (1.0 if _js_string(v) == positive
                                                          else 0.0) for v in raw], positive


def tp_logisticregression(args, cols, raw_data, _sv):
    """Binary outcome ~ predictors: coefficients, odds ratios, and per-observation fit."""
    y_in = args.get('yIN', -1)
    if isinstance(y_in, list):
        y_in = y_in[0] if y_in else -1
    x_ins = [x for x in _id_list(args.get('xIN')) if x in cols]
    if y_in == -1 or y_in not in cols or not x_ins:
        return False
    y, positive = _logit_coerce_binary(cols[y_in].get_data() or [])
    if positive is None:
        # Not a binary outcome: the app reports it and writes nothing (still "valid").
        return True
    predictors = [cols[x].get_data() for x in x_ins]
    names = [cols[x].name or str(x) for x in x_ins]
    res = logistic_regression(y, predictors, names)
    if not res or not res.get('coef'):
        return False
    # The kernel returns PARALLEL ARRAYS (term/coef/se/...), not a list of term objects.
    coef, se = res['coef'], res['se']
    # Wald CI on the ODDS RATIO, matching logistic.js:164 — exp(coef +/- 1.96*se), and NaN
    # rather than a bogus interval when the standard error did not come back finite.
    z975 = 1.959963984540054
    ci_low = [math.exp(c - z975 * s) if _isfinite(s) else float('nan')
              for c, s in zip(coef, se)]
    ci_high = [math.exp(c + z975 * s) if _isfinite(s) else float('nan')
               for c, s in zip(coef, se)]
    wrote = _result_rows(raw_data, cols, args, {
        'term': res['term'], 'coef': coef, 'se': se, 'z': res['z'],
        'pvalue': res['pvalue'], 'oddsRatio': res['oddsRatio'],
        'ciLow': ci_low, 'ciHigh': ci_high})
    # Per-observation columns are a different LENGTH from the coefficient rows, so
    # they are written separately rather than as extra columns of the same table.
    for key in ('outcome', 'eta', 'fitted'):
        out_id = _out_id(args, key)
        if out_id != -1 and res.get(key) is not None:
            _set_col(raw_data, cols, out_id, res[key], type_='number')
            wrote = True
    return wrote


def _interp_known_points(x_data, y_data):
    """interpolate.js knownPoints: house rule on both, Number(), finite only, sorted by x
    (stable), duplicate x keeps the LATER value."""
    pairs = []
    n = min(len(x_data or []), len(y_data or []))
    for i in range(n):
        if _js_invalid(x_data[i]) or _js_invalid(y_data[i]):
            continue
        x, y = _js_number(x_data[i]), _js_number(y_data[i])
        if math.isfinite(x) and math.isfinite(y):
            pairs.append((x, y))
    pairs.sort(key=lambda p: p[0])
    xs, ys = [], []
    for x, y in pairs:
        if xs and xs[-1] == x:
            ys[-1] = y
        else:
            xs.append(x)
            ys.append(y)
    return xs, ys


def _interp_bracket(xs, q):
    """Largest i with xs[i] <= q, clamped to [0, n-2] (interpolate.js bracket)."""
    lo, hi = 0, len(xs) - 1
    if q <= xs[0]:
        return 0
    if q >= xs[hi]:
        return hi - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if xs[mid] <= q:
            lo = mid
        else:
            hi = mid
    return lo


def make_interpolator(xs, ys, method='linear'):
    """interpolate.js makeInterpolator: NO extrapolation (outside [xs[0], xs[-1]] or a
    non-finite query is NaN). Methods linear, nearest (a tie goes to the lower point) and
    spline (natural cubic, Numerical Recipes)."""
    n = len(xs)
    nan = float('nan')
    if n == 0:
        return lambda q: nan
    if n == 1:
        inner = lambda q: ys[0]  # noqa: E731
    elif method == 'nearest':
        def inner(q):
            if q <= xs[0]:
                return ys[0]
            if q >= xs[-1]:
                return ys[-1]
            i = _interp_bracket(xs, q)
            return ys[i] if q - xs[i] <= xs[i + 1] - q else ys[i + 1]
    elif method == 'spline':
        y2 = [0.0] * n
        u = [0.0] * n
        for i in range(1, n - 1):
            sig = (xs[i] - xs[i - 1]) / (xs[i + 1] - xs[i - 1])
            p = sig * y2[i - 1] + 2
            y2[i] = (sig - 1) / p
            ui = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) - (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1])
            u[i] = (6 * ui) / (xs[i + 1] - xs[i - 1])
            u[i] = (u[i] - sig * u[i - 1]) / p
        for k in range(n - 2, -1, -1):
            y2[k] = y2[k] * y2[k + 1] + u[k]

        def inner(q):
            if q <= xs[0]:
                return ys[0]
            if q >= xs[-1]:
                return ys[-1]
            klo = _interp_bracket(xs, q)
            khi = klo + 1
            h = xs[khi] - xs[klo]
            a_ = (xs[khi] - q) / h
            b_ = (q - xs[klo]) / h
            return (a_ * ys[klo] + b_ * ys[khi]
                    + ((a_ * a_ * a_ - a_) * y2[klo] + (b_ * b_ * b_ - b_) * y2[khi])
                    * (h * h) / 6)
    else:
        def inner(q):
            if q <= xs[0]:
                return ys[0]
            if q >= xs[-1]:
                return ys[-1]
            i = _interp_bracket(xs, q)
            t = (q - xs[i]) / (xs[i + 1] - xs[i])
            return ys[i] + t * (ys[i + 1] - ys[i])
    return lambda q: (inner(q) if (q >= xs[0] and q <= xs[-1]) else nan)


def _make_grid(start, end, step, max_points=2_000_000):
    """interpolate.js makeGrid: start + i * step (no accumulated drift), end inclusive."""
    if not (_finite(start) and _finite(end) and _finite(step)) or step <= 0 or end < start:
        return []
    count = int(math.floor((end - start) / step + 1e-9)) + 1
    if count > max_points:
        return []
    return [start + i * step for i in range(count)]


def tp_interpolate(args, cols, raw_data, _sv):
    """Port of Interpolate.svelte interpolatedata. 'fill' keeps every input row and reads
    each row's y off the interpolant at its own x; 'resample' builds makeGrid(start, end,
    step) in x units (hours for a time x). A time x is written back as epoch ms from the
    earliest time. No extrapolation: outside the known x range is missing."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in is None or x_in == -1 or x_in not in cols or not y_ins:
        return False
    mode = 'resample' if args.get('mode') == 'resample' else 'fill'
    method = args.get('method') if args.get('method') in ('linear', 'nearest', 'spline') \
        else 'linear'
    x_col = cols[x_in]
    is_time = x_col.type == 'time'
    x_raw = list(x_col.get_data() or [])
    x_interp = x_col.hours_since_start if is_time else x_raw
    present = [v for v in x_raw if not _js_invalid(v)]
    baseline = min(_js_number(v) for v in present) if (is_time and present) else 0.0

    if mode == 'resample':
        finite = [v for v in x_interp if _finite(v)]
        if not finite:
            return False
        start = args.get('start') if _finite(args.get('start')) else min(finite)
        end = args.get('end') if _finite(args.get('end')) else max(finite)
        step = _js_number(args.get('step'))
        query = _make_grid(start, end, step)
        if not query:
            return False
        out_x_vals = [baseline + h * 3600000 for h in query] if is_time else list(query)
    else:
        query = list(x_interp)
        out_x_vals = list(x_raw)

    y_results = {}
    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y_data = cols[y_id].get_data()
        xs, ys = _interp_known_points(x_interp, y_data)
        if not xs:
            continue
        f = make_interpolator(xs, ys, method)
        vals = [float('nan') if _js_invalid(q) else f(_js_number(q)) for q in query]
        if mode == 'fill':
            # A row whose y is present but whose x is missing keeps its own y: it cannot be
            # placed on the x axis, but it is not missing data.
            for i, q in enumerate(query):
                if _js_invalid(q) and i < len(y_data) and not _js_invalid(y_data[i]):
                    vals[i] = _js_number(y_data[i])
        y_results[y_id] = vals
    if not y_results:
        return False
    out_x = _out_id(args, 'interpx')
    if out_x != -1:
        _set_col(raw_data, cols, out_x, out_x_vals, type_='time' if is_time else 'number')
        for y_id, vals in y_results.items():
            _set_col(raw_data, cols, _out_id(args, f'interpy_{y_id}'), vals, type_='number')
    return True


TABLE_PROCESS_MAP = {
    'describedata': tp_describedata,
    'normalitytest': tp_normalitytest,
    'correlation': tp_correlation,
    'crosscorrelation': tp_crosscorrelation,
    'chisquared': tp_chisquared,
    'columnset': tp_columnset,
    'logisticregression': tp_logisticregression,
    'interpolate': tp_interpolate,
    'averageprofile': tp_averageprofile,
    'circadianfunctionindex': tp_circadianfunctionindex,
    'rayleightest': tp_rayleightest,
    'binneddata': tp_binneddata,
    'blankcolumn': tp_blankcolumn,
    'collectcolumns': tp_collectcolumns,
    'columnfunctions': tp_columnfunctions,
    'cosinor': tp_cosinor,
    'doublelogistic': tp_doublelogistic,
    'duplicate': tp_duplicate,
    'formulacolumn': tp_formulacolumn,
    'longtowide': tp_longtowide,
    'widetolong': tp_widetolong,
    'movinganalysis': tp_movinganalysis,
    'nonparametricra': tp_npcra,
    'random': tp_random,
    'rectangularwave': tp_rectangularwave,
    'rhythmicityanalysis': tp_rhythmicityanalysis,
    'sequencecolumn': tp_sequencecolumn,
    'simulateddata': tp_simulateddata,
    'smootheddata': tp_smootheddata,
    'sort': tp_sort,
    'threshold': tp_threshold,
    'crossing': tp_crossing,
    'fdrcorrection': tp_fdrcorrection,
    'surrogatetest': tp_surrogatetest,
    'split': tp_split,
    'trendfit': tp_trendfit,
    'storedvaluegroup': tp_storedvaluegroup,
    'groupcomparison': tp_groupcomparison,
    'fitfunction': tp_fitfunction,
}


def run_table_process(name_or_funcname, args, columns_index, raw_data,
                      stored_values):
    """Look up by AnCiR displayName first, fall back to lowercased key."""
    key = DISPLAY_TO_TP.get(name_or_funcname)
    if key is None:
        # also accept already-normalised keys
        key = name_or_funcname.lower().replace(' ', '') if isinstance(
            name_or_funcname, str) else None
    fn = TABLE_PROCESS_MAP.get(key)
    if fn is None:
        _handle_unsupported('table', name_or_funcname, TABLE_PROCESS_MAP.keys())
        return False
    return fn(args, columns_index, raw_data, stored_values)


# ----------------------------------------------------------------------
# Plotting (matplotlib)
#
# Plot specs come from the session JSON `plots` array. Each plot has a
# `type` (scatterplot / actogram / fft / periodogram / correlogram /
# boxplot) and a `plot` dict with axis settings + a `data` list of
# series. Each series embeds an x and y column header with a `refId`
# pointing to the actual column in the global columns list.
# ----------------------------------------------------------------------

def _resolve_plot_col(col_header, columns_index):
    """Plot series store column metadata inline (with `refId` pointing
    to the real column). Resolve to an actual Column instance."""
    if not col_header:
        return None
    ref = col_header.get('refId')
    if ref is not None and ref in columns_index:
        return columns_index[ref]
    cid = col_header.get('id')
    if cid in columns_index:
        return columns_index[cid]
    return None


def _x_for_plot(col):
    """Return raw x values for plotting. Time columns → matplotlib
    datetime objects; everything else → numeric pass-through."""
    if col is None:
        return []
    data = col.get_data()
    if col.type == 'time':
        return pd.to_datetime(data, unit='ms', utc=True).tolist()
    return data


def _paired_finite(x_vals, y_vals):
    """Drop (x, y) pairs where either side is None / NaN / NaT.
    Returns parallel lists; preserves x dtype (datetime stays datetime)."""
    out_x, out_y = [], []
    for xv, yv in zip(x_vals, y_vals):
        if xv is None or yv is None:
            continue
        if isinstance(yv, float) and math.isnan(yv):
            continue
        # NaT / NaN check via pandas
        try:
            if pd.isna(xv):
                continue
        except (TypeError, ValueError):
            pass
        out_x.append(xv)
        out_y.append(yv)
    return out_x, out_y


def _apply_axes(ax, xlims=None, ylims=None, xlog=False, ylog=False,
                xlabel='', ylabel='', title=''):
    if xlims and any(v is not None for v in xlims):
        cur = ax.get_xlim()
        ax.set_xlim(xlims[0] if xlims[0] is not None else cur[0],
                    xlims[1] if xlims[1] is not None else cur[1])
    if ylims and any(v is not None for v in ylims):
        cur = ax.get_ylim()
        ax.set_ylim(ylims[0] if ylims[0] is not None else cur[0],
                    ylims[1] if ylims[1] is not None else cur[1])
    if xlog: ax.set_xscale('log')
    if ylog: ax.set_yscale('log')
    if xlabel: ax.set_xlabel(xlabel)
    if ylabel: ax.set_ylabel(ylabel)
    if title:  ax.set_title(title)


def plot_scatterplot(plot, columns_index, ax_left, ax_right=None):
    """Series may target the left or right Y axis (`yAxis: 'right'`).
    Each series may show points and/or a line."""
    p = plot.get('plot', {})
    used_right = False
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        x = _x_for_plot(x_col)
        y = y_col.get_data()
        x, y = _paired_finite(x, y)
        if not x:
            continue
        ax = ax_right if (series.get('yAxis') == 'right'
                          and ax_right is not None) else ax_left
        if series.get('yAxis') == 'right':
            used_right = True
        line = series.get('line') or {}
        points = series.get('points') or {}
        label = series.get('label') or y_col.name
        colour = (line.get('colour') or line.get('color')
                  or points.get('colour') or points.get('color') or None)
        if line.get('show', True):
            ax.plot(x, y, color=colour, linewidth=line.get('width', 1),
                    label=label)
        if points.get('show'):
            ax.scatter(x, y, color=colour, s=(points.get('size', 3) ** 2),
                       label=None if line.get('show') else label)
    _apply_axes(ax_left,
                xlims=p.get('xlimsIN'),
                ylims=p.get('ylimsLeftIN'),
                xlog=p.get('xLogScale', False),
                ylog=p.get('yLogScaleLeft', False),
                xlabel=(p.get('xAxis') or {}).get('label', ''),
                ylabel=(p.get('yAxisLeft') or {}).get('label', ''),
                title=plot.get('name', ''))
    if ax_right is not None and used_right:
        _apply_axes(ax_right,
                    ylims=p.get('ylimsRightIN'),
                    ylog=p.get('yLogScaleRight', False),
                    ylabel=(p.get('yAxisRight') or {}).get('label', ''))
    if (p.get('legend') or {}).get('show', False):
        ax_left.legend(loc='best', fontsize=8)


def plot_fft(plot, columns_index, ax):
    p = plot.get('plot', {})
    show_period = p.get('showPeriod', False)
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        # Use hours-since-start for time axis (matches the JS plot).
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        y = y_col.get_data()
        t, y = _paired_finite(t, y)
        if not t:
            continue
        fft = compute_fft(t, y, series.get('freqStep'))
        if not fft['frequencies']:
            continue
        xs = ([1.0 / f if f else float('nan') for f in fft['frequencies']]
              if show_period else fft['frequencies'])
        line = series.get('line') or {}
        colour = line.get('colour') or line.get('color')
        ax.plot(xs, fft['magnitudes'], color=colour,
                linewidth=line.get('width', 1),
                label=series.get('label') or y_col.name)
    xlabel = ('Period' if show_period
              else (p.get('xAxis') or {}).get('label', 'Frequency'))
    _apply_axes(ax,
                xlims=p.get('xlimsIN'),
                ylims=p.get('ylimsIN'),
                xlog=p.get('logScale', False),
                xlabel=xlabel,
                ylabel=(p.get('yAxisMag') or {}).get('label', 'Magnitude'),
                title=plot.get('name', ''))
    ax.legend(loc='best', fontsize=8)


def plot_periodogram(plot, columns_index, ax):
    p = plot.get('plot', {})
    # Method and bin size are per series, as in the app (_periodogram_series_params). They
    # used to be read from the plot, where the app never stores them, so every exported
    # periodogram was drawn as Lomb-Scargle.
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        params = _periodogram_series_params(p, series, t)
        y = y_col.get_data()
        t, y = _paired_finite(t, y)
        if not t:
            continue
        result = run_periodogram_calculation({'t': t, 'y': y, **params})
        line = series.get('line') or {}
        colour = line.get('colour') or line.get('color')
        ax.plot(result['x'], result['y'], color=colour,
                linewidth=line.get('width', 1),
                label=series.get('label') or y_col.name)
        if result.get('threshold') is not None:
            # The Sidak line is per fold (its df follows the occupied columns), so it is a
            # curve over period, not one horizontal value.
            ax.plot(result['x'], result['threshold'], color=colour or 'gray',
                    linestyle='--', linewidth=0.8, alpha=0.5)
    _apply_axes(ax,
                xlims=p.get('periodlimsIN') or p.get('xlimsIN'),
                ylims=p.get('ylimsIN'),
                xlabel=(p.get('xAxis') or {}).get('label', 'Period'),
                ylabel=(p.get('yAxis') or {}).get('label', 'Power'),
                title=plot.get('name', ''))
    ax.legend(loc='best', fontsize=8)


def plot_correlogram(plot, columns_index, ax):
    p = plot.get('plot', {})
    for series in p.get('data', []):
        ac = correlogram_series_acf(series, columns_index)
        if ac is None or not ac['lags']:
            continue
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        line = series.get('line') or {}
        colour = line.get('colour') or line.get('color')
        ax.plot(ac['lags'], ac['correlations'], color=colour,
                linewidth=line.get('width', 1),
                label=series.get('label') or y_col.name)
    ax.axhline(0, color='gray', linewidth=0.5)
    _apply_axes(ax,
                xlims=p.get('xlimsIN'),
                ylims=p.get('ylimsIN'),
                xlabel=(p.get('xAxis') or {}).get('label', 'Lag (hrs)'),
                ylabel=(p.get('yAxis') or {}).get('label', 'Correlation'),
                title=plot.get('name', ''))
    ax.legend(loc='best', fontsize=8)


def plot_boxplot(plot, columns_index, ax):
    p = plot.get('plot', {})
    data = []
    labels = []
    for series in p.get('data', []):
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if y_col is None:
            continue
        # Box.svelte presentValues: the house rule, then Number() (a blank or text cell is
        # missing, numeric text is a number).
        y = [_js_number(v) for v in y_col.get_data() if not _js_invalid(v)]
        data.append(y)
        labels.append(series.get('label') or y_col.name)
    if data:
        # matplotlib's defaults are the app's box: type-7 (linear) quartiles and median,
        # whiskers at the most extreme points within 1.5 IQR of the quartiles.
        ax.boxplot(data, tick_labels=labels, whis=1.5)
    _apply_axes(ax,
                ylims=p.get('ylimsIN'),
                ylabel=(p.get('yAxis') or {}).get('label', ''),
                title=plot.get('name', ''))


def plot_actogram(plot, columns_index, ax):
    """Double-plotted actogram: each row shows two consecutive periods of
    activity. Bars use mean-zeroed values normalised to row height."""
    p = plot.get('plot', {})
    period_hrs = float(p.get('periodHrs', 24))
    double = int(p.get('doublePlot', 2))
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        # X is time → hours since start; bin into periods.
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        y = y_col.get_data()
        ta = np.array([np.nan if v is None else v for v in t], dtype=float)
        ya = np.array([np.nan if v is None else v for v in y], dtype=float)
        finite = np.isfinite(ta) & np.isfinite(ya)
        ta, ya = ta[finite], ya[finite]
        if ta.size == 0:
            continue
        n_days = int(math.ceil((ta.max() - ta.min()) / period_hrs))
        if n_days <= 0:
            n_days = 1
        ymax = float(ya.max()) if ya.size else 1.0
        if ymax == 0:
            ymax = 1.0
        colour = series.get('colour') or series.get('color') or '#234154'
        # Plot each day as a horizontal trace; double-plot tiles the next
        # period to the right of the current one.
        for d in range(n_days):
            row_y = n_days - 1 - d  # day 0 at top
            for tile in range(double):
                d_eff = d + tile
                lo = d_eff * period_hrs + ta.min()
                hi = lo + period_hrs
                mask = (ta >= lo) & (ta < hi)
                tt = ta[mask] - lo + tile * period_hrs
                yy = ya[mask]
                # vertical bars from baseline (row_y) up by yy/ymax
                if tt.size:
                    ax.vlines(tt, row_y, row_y + yy / ymax * 0.9,
                              colors=colour, linewidth=0.5)
        ax.set_xlim(0, period_hrs * double)
        ax.set_ylim(-0.5, n_days - 0.5)
        ax.set_xlabel((p.get('xAxis') or {}).get('label', 'Hours'))
        ax.set_ylabel('Day')
        ax.set_yticks(range(n_days))
        ax.set_yticklabels([str(n_days - i) for i in range(n_days)])
        ax.set_title(plot.get('name', ''))
        # Light bands
        for band in ((p.get('lightBands') or {}).get('bands', [])):
            start = float(band.get('start', 0))
            end = float(band.get('end', 0))
            colour_b = band.get('colour') or band.get('color') or '#fff8a0'
            alpha = float(band.get('alpha', 0.3))
            ax.axvspan(start, end, color=colour_b, alpha=alpha, zorder=0)
            if double > 1:
                ax.axvspan(start + period_hrs, end + period_hrs,
                           color=colour_b, alpha=alpha, zorder=0)
        break  # actograms typically one Y series


PLOT_TYPE_DISPATCH = {
    'scatterplot': 'scatter',
    'fft': 'fft',
    'periodogram': 'periodogram',
    'correlogram': 'correlogram',
    'boxplot': 'boxplot',
    'actogram': 'actogram',
}


def render_plots(plots, columns_index, output_dir):
    """Render every plot in `plots` to a PNG inside `output_dir`.
    Returns the list of file paths written. Skips unsupported types
    (tableplot, etc) with a console note."""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from pathlib import Path

    out = Path(output_dir)
    out.mkdir(exist_ok=True)
    written = []
    for plot in plots:
        ptype = plot.get('type', '')
        kind = PLOT_TYPE_DISPATCH.get(ptype)
        if kind is None:
            print(f"[ancir-plot] skipped unsupported plot: {ptype} "
                  f"({plot.get('name')})")
            continue
        fig, ax = plt.subplots(figsize=(8, 5))
        try:
            if kind == 'scatter':
                # Does any series target the right axis?
                has_right = any((s.get('yAxis') == 'right')
                                for s in plot.get('plot', {}).get('data', []))
                ax_right = ax.twinx() if has_right else None
                plot_scatterplot(plot, columns_index, ax, ax_right)
            elif kind == 'fft':
                plot_fft(plot, columns_index, ax)
            elif kind == 'periodogram':
                plot_periodogram(plot, columns_index, ax)
            elif kind == 'correlogram':
                plot_correlogram(plot, columns_index, ax)
            elif kind == 'boxplot':
                plot_boxplot(plot, columns_index, ax)
            elif kind == 'actogram':
                plot_actogram(plot, columns_index, ax)
        except Exception as e:
            print(f"[ancir-plot] error rendering {plot.get('name')}: {e}")
            plt.close(fig)
            continue
        fig.tight_layout()
        safe_name = ''.join(c if c.isalnum() or c in '-_' else '_'
                            for c in str(plot.get('name', f'plot_{plot.get("id", "?")}')))
        path = out / f"plot_{plot.get('id', '?')}_{safe_name}.png"
        fig.savefig(path, dpi=120)
        plt.close(fig)
        written.append(path)
        print(f"[ancir-plot] wrote {path}")
    return written


# ----------------------------------------------------------------------
# Computed plot-data export (CSV)
#
# Calculating plots (periodogram, FFT, correlogram, actogram) derive numbers
# the raw columns don't contain. These builders mirror each plot's JS
# `getDownloadData()` (src/lib/plots/*/*.svelte) header-for-header and
# row-for-row so the CSVs match the app's "Show/Save data" output. They reuse
# the same compute functions the PNG renderers use, so a plot's CSV and its
# PNG always agree.
# ----------------------------------------------------------------------

def _series_time_and_y(series, columns_index):
    """Resolve a plot series to (t, y) finite-paired lists, or (None, None)."""
    x_col = _resolve_plot_col(series.get('x'), columns_index)
    y_col = _resolve_plot_col(series.get('y'), columns_index)
    if x_col is None or y_col is None:
        return None, None
    t = (x_col.hours_since_start if x_col.type == 'time' else x_col.get_data())
    y = y_col.get_data()
    t, y = _paired_finite(t, y)
    return (t, y) if t else (None, None)


_PGRAM_CALC_RANGE_BUFFER = 0.25


def median_sampling_interval(times):
    """periodogram.js medianSamplingInterval: the median of the positive gaps between the
    sorted usable x values (house rule, then finite), or NaN when there is no such gap."""
    xs = []
    for v in times or []:
        if _js_invalid(v):
            continue
        f = _js_number(v)
        if math.isfinite(f):
            xs.append(f)
    xs.sort()
    gaps = sorted(b - a for a, b in zip(xs, xs[1:]) if b > a)
    if not gaps:
        return math.nan
    mid = len(gaps) // 2
    return gaps[mid] if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2


# Legacy Enright bin sizes (core/enrightBinMigration.js, v81.0). Before v81 the app's
# Periodogram plot HID the Bin Size control for Enright, so a saved Enright series sat at a
# 0.25 h nobody chose. The app migrates such a series on load to follow its x (binSizeAuto),
# and so does this port, with the identical rule:
#   the session's version has a first number below 81 (or no readable version), the plot is
#   a 'periodogram', the series' method is 'Enright', it has no `binSizeAuto` field, and its
#   binSize is 0.25 or absent.
# Chi-squared and Lomb-Scargle series, and Enright series with another bin size, are kept.
# Only the plot: Rhythmicity / Moving Analysis always showed their bin size for Enright.
_FIRST_FOLLOWING_MAJOR = 81
_LEGACY_HIDDEN_BIN = 0.25


def _version_major(version):
    if isinstance(version, bool) or not isinstance(version, (str, int, float)):
        return None
    m = re.search(r'\d+', str(version))
    return int(m.group(0)) if m else None


def is_legacy_bin_session(version):
    """Whether a session saved by `version` predates the following Enright bin size."""
    major = _version_major(version)
    return major is None or major < _FIRST_FOLLOWING_MAJOR


def is_legacy_enright_series(series):
    """Whether one saved Periodogram series is a legacy Enright series at the hidden default."""
    if not isinstance(series, dict) or series.get('method') != 'Enright':
        return False
    if 'binSizeAuto' in series:
        return False
    b = series.get('binSize')
    return b is None or (not isinstance(b, bool) and b == _LEGACY_HIDDEN_BIN)


def migrate_legacy_enright_bins(session):
    """Set every legacy Enright Periodogram series of a pre-v81 session to follow its x.
    Returns (session, migrated); the session is a copy when anything changed (the input is
    never mutated), exactly as the app's migrateLegacyEnrightBins."""
    plots = session.get('plots') if isinstance(session, dict) else None
    if not isinstance(plots, list) or not is_legacy_bin_session(session.get('version')):
        return session, 0
    migrated = 0
    out = []
    for plot in plots:
        is_pgram = isinstance(plot, dict) and plot.get('type') == 'periodogram'
        inner = plot.get('plot') if is_pgram else None
        data = inner.get('data') if isinstance(inner, dict) else None
        if not isinstance(data, list) or not any(is_legacy_enright_series(s) for s in data):
            out.append(plot)
            continue
        new_data = []
        for s in data:
            if is_legacy_enright_series(s):
                migrated += 1
                b = s.get('binSize')
                s = {**s, 'binSize': _LEGACY_HIDDEN_BIN if b is None else b,
                     'binSizeAuto': True}
            new_data.append(s)
        out.append({**plot, 'plot': {**inner, 'data': new_data}})
    return ({**session, 'plots': out}, migrated) if migrated else (session, 0)


def periodogram_series_bin_size(series, x_hours=None):
    """The bin size (h) a Periodogram series computes with. A series that follows its x
    (binSizeAuto) uses its x's median sampling interval, which is what the app writes into
    binSize (PeriodogramDataclass.followSamplingInterval); a series the app never got to
    resolve, or a migrated legacy one, therefore computes as the app will. Otherwise the
    stored binSize, or the class default 0.25 h."""
    bin_size = series.get('binSize')
    if series.get('binSizeAuto') is True and x_hours is not None:
        dt = median_sampling_interval(x_hours)
        if dt > 0 and math.isfinite(dt):
            return dt
    return float(bin_size) if bin_size is not None else 0.25


def _periodogram_series_params(plot_inner, series, x_hours=None):
    """The runPeriodogramCalculation params the app's Periodogram plot uses for one series.

    Method, bin size and alpha are PER SERIES (PeriodogramDataclass), not on the plot; the
    period range is the plot's periodlimsIN (default [1, 30]) widened by CALC_RANGE_BUFFER
    on each side, and the step is periodSteps (default 0.25). A series saved before it
    carried a method or bin size gets the class defaults (Lomb-Scargle, 0.25 h, 0.05). The
    bin size is periodogram_series_bin_size's (`x_hours`: the series' whole x, in hours).
    """
    lims = plot_inner.get('periodlimsIN') or [1, 30]
    lo, hi = float(lims[0]), float(lims[1])
    span = hi - lo
    method = series.get('method') or 'Lomb-Scargle'
    return {
        'method': method,
        'minPeriod': max(0.01, lo - span * _PGRAM_CALC_RANGE_BUFFER),
        'maxPeriod': hi + span * _PGRAM_CALC_RANGE_BUFFER,
        'stepSize': float(plot_inner.get('periodSteps') or 0.25),
        'dt': periodogram_series_bin_size(series, x_hours),
        'alpha': float(series.get('chiSquaredAlpha') or 0.05),
    }


def periodogram_download_data(plot, columns_index):
    """Mirror Periodogramclass.getDownloadData (Periodogram.svelte).

    Headers: ['DataSeries', 'Period (hours)', 'Power']; the JS adds
    ['Threshold', 'P-value'] only when a series uses the Chi-squared method.
    Threshold and P-value are per fold, as in the app (the p-value is the
    chi-square upper tail, computed directly). Each series is computed with its
    own method and bin size (_periodogram_series_params).
    """
    p = plot.get('plot', {})
    series_list = p.get('data', [])
    has_threshold = any((s.get('method') or 'Lomb-Scargle') == 'Chi-squared'
                        for s in series_list)
    headers = ['DataSeries', 'Period (hours)', 'Power']
    if has_threshold:
        headers += ['Threshold', 'P-value']
    rows = []
    for d, series in enumerate(series_list):
        t, y = _series_time_and_y(series, columns_index)
        if t is None:
            continue
        # The bin size of a series that follows its x reads the WHOLE x, as the app's does
        # (Periodogram.svelte passes datum.x.hoursSinceStart), not the y-paired subset.
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        x_all = x_col.hours_since_start if x_col.type == 'time' else x_col.get_data()
        result = run_periodogram_calculation({
            't': t, 'y': y, **_periodogram_series_params(p, series, x_all)})
        thr = result.get('threshold') or []
        pv = result.get('pvalue') or []
        for i, per in enumerate(result['x']):
            row = [d, per, result['y'][i]]
            if has_threshold:
                # Per-fold threshold and the per-fold chi-square UPPER-tail p (SPEC-14).
                row += [thr[i] if i < len(thr) else '', pv[i] if i < len(pv) else '']
            rows.append(row)
    return headers, rows


def fft_download_data(plot, columns_index):
    """Mirror FFTclass.getDownloadData (FFT.svelte)."""
    p = plot.get('plot', {})
    series_list = p.get('data', [])
    has_phase = any(s.get('showPhase') for s in series_list)
    headers = ['DataSeries', 'Frequency (cycles/hr)', 'Period (hours)', 'Magnitude']
    if has_phase:
        headers.append('Phase (radians)')
    rows = []
    for d, series in enumerate(series_list):
        t, y = _series_time_and_y(series, columns_index)
        if t is None:
            continue
        fft = compute_fft(t, y, series.get('freqStep'))
        freqs = fft['frequencies']
        for i, freq in enumerate(freqs):
            row = [d, freq, (1.0 / freq if freq else ''), fft['magnitudes'][i]]
            if has_phase:
                phases = fft.get('phases') or []
                row.append(phases[i] if i < len(phases) else '')
            rows.append(row)
    return headers, rows


def correlogram_download_data(plot, columns_index):
    """Mirror Correlogramclass.getDownloadData (Correlogram.svelte)."""
    p = plot.get('plot', {})
    headers = ['DataSeries', 'Lag (hours)', 'Autocorrelation']
    rows = []
    for d, series in enumerate(p.get('data', [])):
        # The app's acfData, series by series (lag step from the x column's binWidth or
        # the median interval, per-series maxLag / minLag): see correlogram_series_acf.
        ac = correlogram_series_acf(series, columns_index)
        if ac is None:
            continue
        for i, lag in enumerate(ac['lags']):
            # An empty lag slot (NaN) is a blank cell, as the app writes it.
            r = ac['correlations'][i]
            rows.append([d, lag, r if math.isfinite(r) else None])
    return headers, rows


def actogram_bins_by_period(frame, period_hrs, bin_width=None):
    """ActogramDataclass.allBins + binsByPeriod (Actogram.svelte) over one series already
    folded at the plot's startTime (actogram_series_frame): a left-edge bar per valid sample
    in offset-corrected hours, `bin_width` wide when the column carries one and the scanned
    step otherwise, then split at every row boundary it crosses. Returns
    {row_index: [{'xStart', 'xEnd', 'y'}, ...]}."""
    hss, y, offset = frame['hoursSinceStart'], frame['y'], frame['offset']
    width = bin_width if bin_width else frame['binSize']
    period_bins = {}
    for i, tx in enumerate(hss):
        ty = y[i] if i < len(y) else None
        if tx is None or tx != tx or ty is None or _js_invalid(ty):
            continue
        bin_start, bin_end = tx - offset, tx + width - offset
        start_period = math.floor(bin_start / period_hrs)
        end_period = math.floor(bin_end / period_hrs)
        if end_period < 0:
            continue
        if start_period == end_period and start_period >= 0:
            period_bins.setdefault(start_period, []).append(
                {'xStart': bin_start, 'xEnd': bin_end, 'y': ty})
        else:
            for pp in range(max(0, start_period), end_period + 1):
                seg_start = max(bin_start, pp * period_hrs)
                seg_end = min(bin_end, (pp + 1) * period_hrs)
                if seg_end > seg_start:
                    period_bins.setdefault(pp, []).append(
                        {'xStart': seg_start, 'xEnd': seg_end, 'y': ty})
    return period_bins


def actogram_download_data(plot, columns_index, zone='utc'):
    """Mirror Actogramclass.getDownloadData (Actogram.svelte): one tidy row per bar, rows
    (periods) numbered from 1. Every series is folded at the plot's ONE startTime: the
    earliest valid sample over ALL series, snapped to its midnight in the display `zone`
    (the session's appState.displayTimezone), exactly as the app draws it."""
    p = plot.get('plot', {})
    period_hrs = float(p.get('periodHrs', 24) or 24)
    headers = ['DataSeries', 'Period', 'BinStart (hrs)', 'BinEnd (hrs)', 'Value']
    resolved = []
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        resolved.append(None if x_col is None or y_col is None else (x_col, {
            'xType': x_col.type, 'x': x_col.get_data() or [], 'y': y_col.get_data() or [],
            'rawBinStart0': x_col.raw_first, 'originTime_ms': x_col.eff_origin_time_ms}))
    start = actogram_start_time([r[1] for r in resolved if r is not None], zone)
    rows = []
    for d, r in enumerate(resolved):
        if r is None:
            continue
        x_col, s = r
        frame = actogram_series_frame(s['x'], s['y'], s['xType'], start, period_hrs,
                                      s['rawBinStart0'], s['originTime_ms'])
        # `if (this.x.binWidth)`: the column's own bin width when it carries one.
        bins = actogram_bins_by_period(frame, period_hrs, x_col.eff_bin_width)
        for per in sorted(bins.keys()):
            for b in bins[per]:
                rows.append([d, per + 1, b['xStart'], b['xEnd'], b['y']])
    return headers, rows


PLOT_DATA_BUILDERS = {
    'periodogram': periodogram_download_data,
    'fft': fft_download_data,
    'correlogram': correlogram_download_data,
    'actogram': actogram_download_data,
}


def export_plot_data(plots, columns_index, output_dir, zone='utc'):
    """Write `<plot>_data.csv` for every calculating plot (periodogram, FFT,
    correlogram, actogram). Each CSV mirrors the plot's in-app "Show/Save data"
    output. Returns the list of paths written; non-calculating plots
    (scatter, boxplot, tableplot) are skipped. `zone` is the session's
    display time zone (appState.displayTimezone); only the actogram reads it, to
    place its rows at local midnight as the app does."""
    import csv
    from pathlib import Path

    out = Path(output_dir)
    out.mkdir(exist_ok=True)
    written = []
    for plot in plots:
        builder = PLOT_DATA_BUILDERS.get(plot.get('type', ''))
        if builder is None:
            continue
        try:
            kwargs = {'zone': zone} if plot.get('type') == 'actogram' else {}
            headers, rows = builder(plot, columns_index, **kwargs)
        except Exception as e:  # noqa: BLE001 — one bad plot shouldn't abort the rest
            print(f"[ancir-plotdata] error building {plot.get('name')}: {e}")
            continue
        if not rows:
            print(f"[ancir-plotdata] {plot.get('name')}: no computed data, skipped")
            continue
        safe_name = ''.join(c if c.isalnum() or c in '-_' else '_'
                            for c in str(plot.get('name', f'plot_{plot.get("id", "?")}')))
        path = out / f"plot_{plot.get('id', '?')}_{safe_name}_data.csv"
        with open(path, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(headers)
            w.writerows(rows)
        written.append(path)
        print(f"[ancir-plotdata] wrote {path} ({len(rows)} rows)")
    return written


# ---------------------------------------------------------------------------
# Correlation (mirrors src/lib/utils/correlation.js). Pearson / Spearman with a
# two-sided p-value from t = r*sqrt((n-2)/(1-r^2)), whose square is F(1, n-2) —
# the same route @stdlib's F-CDF gives on the JS side, so the ports agree.
# ---------------------------------------------------------------------------
def _corr_valid_pairs(x, y):
    xs, ys = [], []
    n = min(len(x or []), len(y or []))
    for i in range(n):
        # validPairs.js: the house rule on both values, then Number().
        if _js_invalid(x[i]) or _js_invalid(y[i]):
            continue
        xs.append(_js_number(x[i]))
        ys.append(_js_number(y[i]))
    return xs, ys


def rank_average(arr):
    order = sorted(range(len(arr)), key=lambda i: arr[i])
    ranks = [0.0] * len(arr)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and arr[order[j + 1]] == arr[order[i]]:
            j += 1
        avg = (i + j + 2) / 2.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _pearson_rn(xs, ys):
    n = len(xs)
    if n < 2:
        return float("nan"), n
    mx = sum(xs) / n
    my = sum(ys) / n
    sxy = sxx = syy = 0.0
    for a, b in zip(xs, ys):
        dx, dy = a - mx, b - my
        sxy += dx * dy
        sxx += dx * dx
        syy += dy * dy
    if sxx == 0 or syy == 0:
        return float("nan"), n
    return sxy / math.sqrt(sxx * syy), n


def correlation_pvalue(r, n):
    if r is None or (isinstance(r, float) and math.isnan(r)) or n < 3:
        return float("nan")
    if abs(r) >= 1:
        return 0.0
    t2 = (r * r * (n - 2)) / (1 - r * r)
    return float(sp_stats.f.sf(t2, 1, n - 2))


def correlate(x, y, method="pearson"):
    """Reference implementation for parity: scipy's pearsonr / spearmanr on the
    pairwise-complete rows. The JS side (src/lib/utils/correlation.js) is bespoke and
    lean (single-file bundle); pinning it to scipy here validates its CORRECTNESS, not
    merely that a second hand-written port agrees with it.

    The edge cases are guarded to match the JS contract (NaN, never an exception): fewer
    than 3 usable pairs, or a constant column, yield NaN r and p."""
    xs, ys = _corr_valid_pairs(x, y)
    n = len(xs)
    nan = float("nan")
    if n < 3 or len(set(xs)) < 2 or len(set(ys)) < 2:
        # scipy warns/raises here; the JS returns NaN, so mirror the JS.
        r_short, _ = _pearson_rn(rank_average(xs) if method == "spearman" else xs,
                                 rank_average(ys) if method == "spearman" else ys)
        return {"r": r_short, "pvalue": nan, "n": n}
    if method == "spearman":
        res = sp_stats.spearmanr(xs, ys)
        r, p = float(res.statistic), float(res.pvalue)
    else:
        res = sp_stats.pearsonr(xs, ys)
        r, p = float(res.statistic), float(res.pvalue)
    return {"r": r, "pvalue": p, "n": n}

# --- reference implementations for the newer stats utils (parity harness) ------
# These mirror the JS in src/lib/utils/{describeStats,normality,crossCorrelation,
# chisquare,logistic}.js. As with `correlate`, the Python side deliberately calls
# scipy / statsmodels so the parity test validates the bespoke JS against a trusted
# reference, not against a second hand-written port. Edge cases return NaN to match
# the JS contract (never raise).


def _clean_numeric(values):
    out = []
    for v in values or []:
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if not math.isnan(f):
            out.append(f)
    return out


def describe_stats(values):
    """scipy/numpy reference for utils/describeStats.js. Skewness/kurtosis are the
    bias-corrected sample forms (scipy skew/kurtosis with bias=False)."""
    x = np.asarray(_clean_numeric(values), dtype=float)
    n = x.size
    nan = float("nan")
    if n == 0:
        return {k: nan for k in ("n", "mean", "median", "sd", "min", "max", "range", "q1", "q3", "iqr", "skewness", "kurtosis")}
    q1 = float(np.percentile(x, 25, method="linear"))
    q3 = float(np.percentile(x, 75, method="linear"))
    return {
        "n": int(n),
        "mean": float(np.mean(x)),
        "median": float(np.median(x)),
        "sd": float(np.std(x, ddof=1)) if n > 1 else nan,
        "min": float(np.min(x)),
        "max": float(np.max(x)),
        "range": float(np.max(x) - np.min(x)),
        "q1": q1,
        "q3": q3,
        "iqr": q3 - q1,
        "skewness": float(sp_stats.skew(x, bias=False)) if n > 2 else nan,
        "kurtosis": float(sp_stats.kurtosis(x, bias=False, fisher=True)) if n > 3 else nan,
    }


def shapiro_wilk(values):
    """scipy.stats.shapiro reference for utils/normality.js shapiroWilk (Royston AS R94)."""
    x = _clean_numeric(values)
    n = len(x)
    nan = float("nan")
    if n < 3 or len(set(x)) < 2:
        return {"statistic": nan, "pvalue": nan, "n": n}
    res = sp_stats.shapiro(np.asarray(x, dtype=float))
    return {"statistic": float(res.statistic), "pvalue": float(res.pvalue), "n": n}


def qq_points(values, confidence=0.95):
    """scipy reference for utils/qq.js qqPoints (normal Q-Q computation).

    Positions are computed EXPLICITLY as Blom, (i - 3/8)/(n + 1/4) —
    scipy.stats.probplot defaults to Filliben, which is deliberately NOT what
    the JS uses (Blom matches the Shapiro-Wilk m-value convention in
    utils/normality.js). Theoretical quantiles via scipy's norm.ppf, quartiles
    via np.quantile's default linear (type-7) interpolation, reference line
    through the quartile pair (R's qqline), pointwise envelope per car::qqPlot:
    SE_i = (slope / pdf(z_i)) * sqrt(p_i (1 - p_i) / n).
    """
    x = sorted(_clean_numeric(values))
    n = len(x)
    if n < 3:
        return {"theoretical": [], "sample": [], "linePar": [float("nan")] * 2,
                "bandLo": [], "bandHi": []}
    i = np.arange(1, n + 1)
    positions = (i - 0.375) / (n + 0.25)
    theoretical = sp_stats.norm.ppf(positions)
    sample = np.asarray(x, dtype=float)
    z_q1, z_q3 = sp_stats.norm.ppf([0.25, 0.75])
    s_q1, s_q3 = np.quantile(sample, [0.25, 0.75])  # linear / type-7 default
    slope = (s_q3 - s_q1) / (z_q3 - z_q1)
    intercept = s_q1 - slope * z_q1
    z_crit = sp_stats.norm.ppf(1 - (1 - confidence) / 2)
    fit = intercept + slope * theoretical
    se = (slope / sp_stats.norm.pdf(theoretical)) * np.sqrt(positions * (1 - positions) / n)
    return {
        "theoretical": theoretical.tolist(),
        "sample": sample.tolist(),
        "linePar": [float(slope), float(intercept)],
        "bandLo": (fit - z_crit * se).tolist(),
        "bandHi": (fit + z_crit * se).tolist(),
    }


def qq_correlation(values):
    """scipy.stats.pearsonr reference for utils/qq.js qqCorrelation — the
    probability-plot correlation the Q-Q plot displays (and its qq_r metric
    column). Filliben's statistic computed on BLOM positions, (i - 3/8)/(n +
    1/4), NOT Filliben's own positions: deliberately the same quantiles the
    plot draws (see qq_points). Undefined cases (n < 3, constant data) return
    r = None, matching the JS null."""
    x = sorted(_clean_numeric(values))
    n = len(x)
    if n < 3 or len(set(x)) < 2:
        return {"r": None, "n": n}
    i = np.arange(1, n + 1)
    theoretical = sp_stats.norm.ppf((i - 0.375) / (n + 0.25))
    r = sp_stats.pearsonr(theoretical, np.asarray(x, dtype=float)).statistic
    return {"r": float(r), "n": n}


def d_agostino(values):
    """scipy.stats.normaltest reference for utils/normality.js dAgostino."""
    x = _clean_numeric(values)
    n = len(x)
    nan = float("nan")
    if n < 8 or len(set(x)) < 2:
        return {"statistic": nan, "pvalue": nan, "n": n}
    res = sp_stats.normaltest(np.asarray(x, dtype=float))
    return {"statistic": float(res.statistic), "pvalue": float(res.pvalue), "n": n}


def jarque_bera(values):
    """scipy.stats.jarque_bera reference for utils/normality.js jarqueBera."""
    x = _clean_numeric(values)
    n = len(x)
    nan = float("nan")
    if n < 3 or len(set(x)) < 2:
        return {"statistic": nan, "pvalue": nan, "n": n}
    res = sp_stats.jarque_bera(np.asarray(x, dtype=float))
    return {"statistic": float(res.statistic), "pvalue": float(res.pvalue), "n": n}


def _cc_finite(v):
    """crossCorrelation.js `finite`: not null, not '', and Number(v) finite. NOTE this is
    looser than the house rule: a whitespace-only cell is Number(' ') = 0, a value."""
    if v is None or (isinstance(v, str) and v == ''):
        return False
    return math.isfinite(_js_number(v))


def fit_ar(x, max_order=None):
    """crossCorrelation.js fitAR: Yule-Walker AR with the order chosen by AIC (Levinson-
    Durbin), exactly R's ar(x, method = "yule-walker") defaults: autocovariances divided by
    the number of present values n, order.max = min(n - 1, floor(10 log10 n), length - 2),
    order minimising n log(v) + 2m. Missing values are skipped in each lag's sum."""
    vals = [_js_number(v) for v in (x or []) if _cc_finite(v)]
    n_obs = len(vals)
    none = {'order': 0, 'coef': [], 'mean': float('nan'), 'variance': float('nan')}
    if n_obs < 3:
        return none
    mean = sum(vals) / n_obs
    n = len(x)
    dev = [(_js_number(v) - mean) if _cc_finite(v) else float('nan') for v in x]
    cap = float('inf') if max_order is None else max_order
    m_max = int(max(0, min(cap, n_obs - 1, math.floor(10 * math.log10(n_obs)), n - 2)))
    acov = []
    for k in range(m_max + 1):
        acc = 0.0
        for i in range(k, n):
            a_, b_ = dev[i], dev[i - k]
            if a_ == a_ and b_ == b_:
                acc += a_ * b_
        acov.append(acc / n_obs)
    if not (acov[0] > 0):
        return {'order': 0, 'coef': [], 'mean': mean, 'variance': 0.0}
    phi = []
    v = acov[0]
    best = {'order': 0, 'coef': [], 'variance': v, 'aic': n_obs * math.log(v)}
    for m in range(1, m_max + 1):
        num = acov[m]
        for j in range(m - 1):
            num -= phi[j] * acov[m - 1 - j]
        kappa = num / v
        if not math.isfinite(kappa) or abs(kappa) >= 1:
            break
        nxt = [phi[j] - kappa * phi[m - 2 - j] for j in range(m - 1)] + [kappa]
        phi = nxt
        v *= 1 - kappa * kappa
        if not (v > 0):
            break
        aic = n_obs * math.log(v) + 2 * m
        if aic < best['aic']:
            best = {'order': m, 'coef': list(phi), 'variance': v, 'aic': aic}
    return {'order': best['order'], 'coef': best['coef'], 'mean': mean,
            'variance': best['variance']}


def ar_filter(z, ar, mean):
    """crossCorrelation.js arFilter: e[t] = (z[t] - mean) - sum_i coef[i] (z[t-1-i] - mean).
    The first `order` values, and any with a missing value in their history, are NaN."""
    n = len(z or [])
    p = len(ar['coef'])
    out = [float('nan')] * n
    for t in range(p, n):
        if not _cc_finite(z[t]):
            continue
        e = _js_number(z[t]) - mean
        ok = True
        for i in range(p):
            prev = z[t - 1 - i]
            if not _cc_finite(prev):
                ok = False
                break
            e -= ar['coef'][i] * (_js_number(prev) - mean)
        if ok:
            out[t] = e
    return out


def _ccf_at_lags(x, y, max_lag, method):
    nx, ny = len(x), len(y)
    lags, rs, ps, ns = [], [], [], []
    for k in range(-max_lag, max_lag + 1):
        i0 = max(0, -k)
        i1 = min(nx - 1, ny - 1 - k)
        xs = [x[i] for i in range(i0, i1 + 1)]
        ys = [y[i + k] for i in range(i0, i1 + 1)]
        c = correlate(xs, ys, method)
        lags.append(k)
        rs.append(c["r"])
        ps.append(c["pvalue"])
        ns.append(c["n"])
    return {"lags": lags, "r": rs, "pvalue": ps, "n": ns}


def cross_correlation(x, y, max_lag=0, method="pearson"):
    """Port of utils/crossCorrelation.js crossCorrelation. r(k) = corr(x[t], y[t + k]) on
    the overlap (k > 0: x LEADS y). The per-lag `pvalue` is for the PREWHITENED pair (x's
    Yule-Walker AR filter applied to x and, with y's own mean, to y; raw p when the order is
    0); `r` stays raw. minP / minPLag (ties: larger |prewhitened r|, then positive, then
    smaller |lag|) and the Sidak familywiseP = -expm1(L log1p(-minP)) over the L lags with a
    finite p."""
    method = 'spearman' if method == 'spearman' else 'pearson'
    xs = list(x or [])
    ys = list(y or [])
    nx, ny = len(xs), len(ys)
    cap = max(1, min(nx, ny) // 4)
    if _finite(max_lag) and max_lag > 0:
        max_lag = min(int(math.floor(max_lag)), min(nx, ny) - 1)
    else:
        max_lag = cap
    raw = _ccf_at_lags(xs, ys, max_lag, method)
    ar = fit_ar(xs)
    pw = raw
    if ar['order'] > 0:
        yv = [_js_number(v) for v in ys if _cc_finite(v)]
        ym = sum(yv) / len(yv) if yv else float('nan')
        pw = _ccf_at_lags(ar_filter(xs, ar, ar['mean']), ar_filter(ys, ar, ym), max_lag,
                          method)
    min_p, min_p_lag, min_idx, n_lags = math.inf, float('nan'), -1, 0
    for i, pv in enumerate(pw['pvalue']):
        if not _finite(pv):
            continue
        n_lags += 1
        tie = False
        if pv == min_p:
            ri, rm = pw['r'][i], pw['r'][min_idx]
            tie = abs(ri) > abs(rm) + _CC_TIE or _cc_beats_on_tie(
                pw['lags'][i], ri, abs(ri), pw['lags'][min_idx], rm, abs(rm))
        if pv < min_p or tie:
            min_p, min_p_lag, min_idx = pv, pw['lags'][i], i
    if not n_lags:
        min_p = float('nan')
    familywise = (-math.expm1(n_lags * math.log1p(-min(min_p, 1))) if n_lags
                  else float('nan'))
    peak_lag, peak_r = _cross_correlation_peak(raw['lags'], raw['r'])
    pw_peak_lag, pw_peak_r = _cross_correlation_peak(pw['lags'], pw['r'])
    return {"lags": raw['lags'], "r": raw['r'], "pvalue": pw['pvalue'], "n": raw['n'],
            "peakLag": peak_lag, "peakR": peak_r, "pwR": pw['r'], "pwPeakLag": pw_peak_lag,
            "pwPeakR": pw_peak_r, "arOrder": ar['order'], "minP": min_p,
            "minPLag": min_p_lag, "familywiseP": familywise, "nLags": n_lags}


def _cc_beats_on_tie(lag, r, mag, best_lag, best_r, best_mag):
    """findPeak's rules 2-4 (crossCorrelation.js beatsOnTie): only on a tie in |r|."""
    if not (abs(mag - best_mag) <= _CC_TIE):
        return False
    if (r >= 0) != (best_r >= 0):
        return r >= 0
    if abs(lag) != abs(best_lag):
        return abs(lag) < abs(best_lag)
    return lag < best_lag


# Two lags whose |r| differ by less than this are a TIE, not a ranking.
_CC_TIE = 1e-12


def _cross_correlation_peak(lags, rs):
    """Mirror of findPeak in utils/crossCorrelation.js. Peak convention, in order:
    largest |r|; then the POSITIVE r (an exact +1 is never beaten by an exact -1 at
    the anti-phase lag); then the smallest |lag| (a periodic series repeats its own
    peak once per period); then the smaller lag, for determinism."""
    nan = float("nan")
    best_lag, best_r, best_mag = nan, nan, float("-inf")
    for lag, r in zip(lags, rs):
        if r is None or math.isnan(r) or math.isinf(r):
            continue
        mag = abs(r)
        if mag > best_mag + _CC_TIE:
            best_lag, best_r, best_mag = lag, r, mag
            continue
        if abs(mag - best_mag) > _CC_TIE:
            continue
        if (r >= 0) != (best_r >= 0):
            if r >= 0:
                best_lag, best_r, best_mag = lag, r, mag
            continue
        if abs(lag) != abs(best_lag):
            if abs(lag) < abs(best_lag):
                best_lag, best_r, best_mag = lag, r, mag
            continue
        if lag < best_lag:
            best_lag, best_r, best_mag = lag, r, mag
    return best_lag, best_r


def chi_square_goodness_of_fit(observed, expected=None, ddof=0):
    """scipy.stats.chisquare reference for utils/chisquare.js chiSquareGoodnessOfFit."""
    o = [float(v) for v in observed]
    k = len(o)
    nan = float("nan")
    if k < 2:
        return {"statistic": nan, "pvalue": nan, "df": nan, "k": k}
    f_exp = None if expected is None else [float(v) for v in expected]
    res = sp_stats.chisquare(o, f_exp=f_exp, ddof=ddof)
    return {"statistic": float(res.statistic), "pvalue": float(res.pvalue), "df": k - 1 - ddof, "k": k}


def chi_square_independence(table, correction=True):
    """scipy.stats.chi2_contingency reference for utils/chisquare.js chiSquareIndependence."""
    arr = np.asarray(table, dtype=float)
    nan = float("nan")
    if arr.ndim != 2 or arr.shape[0] < 2 or arr.shape[1] < 2:
        return {"statistic": nan, "pvalue": nan, "df": nan}
    res = sp_stats.chi2_contingency(arr, correction=bool(correction))
    return {"statistic": float(res.statistic), "pvalue": float(res.pvalue), "df": int(res.dof)}


def logistic_regression(y, predictor_cols, names=None):
    """statsmodels Logit reference for utils/logistic.js. Returns per-term fields as
    parallel arrays (term/coef/se/z/pvalue/oddsRatio) plus model scalars."""
    import statsmodels.api as sm

    p = len(predictor_cols)
    total = len(y)
    rows, ys, kept = [], [], []
    for i in range(total):
        # The house rule BEFORE Number() (logistic.js): a missing outcome or predictor drops
        # the row. float() alone accepted the text 'nan' as a NaN predictor and fitted it.
        if _js_invalid(y[i]):
            continue
        yi = _js_number(y[i])
        if yi not in (0.0, 1.0):
            continue
        xr, ok = [1.0], True
        for j in range(p):
            raw = predictor_cols[j][i] if i < len(predictor_cols[j]) else None
            v = float('nan') if _js_invalid(raw) else _js_number(raw)
            if not math.isfinite(v):
                ok = False
                break
            xr.append(v)
        if not ok:
            continue
        rows.append(xr)
        ys.append(yi)
        kept.append(i)
    n, k = len(rows), p + 1
    labels = ["(intercept)"] + list(names or [f"x{j+1}" for j in range(p)])
    nan = float("nan")
    empty = {"eta": [nan] * total, "fitted": [nan] * total, "outcome": [nan] * total}
    if n < k + 1:
        return {"term": [], "coef": [], "se": [], "z": [], "pvalue": [], "oddsRatio": [],
                "n": n, "logLik": nan, "lrChiSq": nan, "lrPvalue": nan, "pseudoR2": nan, **empty}
    X = np.asarray(rows, dtype=float)
    Y = np.asarray(ys, dtype=float)
    m = sm.Logit(Y, X).fit(disp=0)
    coef = [float(v) for v in m.params]
    se = [float(v) for v in m.bse]
    # Per-observation linear predictor (m.fittedvalues = Xβ) and probability, scattered back to
    # the full input length (NaN for dropped rows), matching utils/logistic.js perObs.
    eta_arr = [nan] * total
    fit_arr = [nan] * total
    out_arr = [nan] * total
    lin = np.asarray(m.fittedvalues, dtype=float)
    prob = np.asarray(m.predict(X), dtype=float)
    for r, idx in enumerate(kept):
        eta_arr[idx] = float(lin[r])
        fit_arr[idx] = float(prob[r])
        out_arr[idx] = float(ys[r])
    return {
        "term": labels,
        "coef": coef,
        "se": se,
        "z": [float(v) for v in m.tvalues],
        "pvalue": [float(v) for v in m.pvalues],
        "oddsRatio": [float(np.exp(v)) for v in coef],
        "n": n,
        "logLik": float(m.llf),
        "lrChiSq": float(m.llr),
        "lrPvalue": float(m.llr_pvalue),
        "pseudoR2": float(m.prsquared),
        "eta": eta_arr,
        "fitted": fit_arr,
        "outcome": out_arr,
    }


# ---------------------------------------------------------------------------
# Multiple-comparison correction — mirrors src/lib/utils/pAdjust.js
# ---------------------------------------------------------------------------
def p_adjust(pvalues, method="benjamini-hochberg"):
    """Adjust p-values for multiple comparisons.

    Backed by statsmodels.stats.multitest.multipletests, so the JS is checked
    against a real reference implementation rather than a second copy of itself.

    Non-finite entries (None, '', bool, NaN) and values outside [0, 1] are
    EXCLUDED from n and returned as NaN, matching the JS and R p.adjust's NA
    handling: a test that failed to run must not tighten the correction applied
    to the ones that did, and a value that cannot be a p-value is not clamped in.
    """
    from statsmodels.stats.multitest import multipletests

    name_map = {
        "bonferroni": "bonferroni",
        "holm": "holm",
        "benjamini-hochberg": "fdr_bh",
        "benjamini-yekutieli": "fdr_by",
    }

    kept, out = [], [float("nan")] * len(pvalues)
    for i, raw in enumerate(pvalues):
        if raw is None or isinstance(raw, bool) or raw == "":
            continue
        try:
            v = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(v) or v < 0.0 or v > 1.0:
            continue
        kept.append((i, v))

    if not kept:
        return {"adjusted": out}
    if method == "none":
        for i, v in kept:
            out[i] = v
        return {"adjusted": out}

    sm_method = name_map.get(method)
    if sm_method is None:
        raise ValueError(f"p_adjust: unknown method {method!r}")

    adj = multipletests([v for _, v in kept], method=sm_method)[1]
    for (i, _), a in zip(kept, adj):
        out[i] = float(a)
    return {"adjusted": out}


# ---------------------------------------------------------------------------
# Continuous wavelet transform — mirrors src/lib/utils/cwt.js
# ---------------------------------------------------------------------------
def cwt_peak_scale_index(values, opts):
    """Index of the maximum-power SCALE at each interior time point.

    Backed by PyWavelets (pywt.cwt with a complex Morlet).

    Why the peak scale INDEX rather than the power map: pywt's `cmor`
    normalisation and edge handling differ from Torrence & Compo's, so the two
    power fields agree only up to a scale-dependent factor (measured: dominant
    rows correlate 0.99, low-power rows diverge). The argmax over scales is
    invariant to any per-scale factor, and it is also the quantity that carries
    the science — "what period dominates here". Interior points only, because
    inside the cone of influence both implementations are reporting edge
    artefacts rather than a measurement.
    """
    import pywt

    dt = float(opts["dt"])
    dj = float(opts.get("dj", 0.25))
    s0 = float(opts.get("s0", 2 * dt))
    j1 = int(opts.get("j1", 12))
    w0 = float(opts.get("w0", 6.0))
    lo = int(opts["lo"])
    hi = int(opts["hi"])

    y = np.asarray([float(v) for v in values], dtype=float)
    y = y - y.mean()

    scales = np.array([s0 * 2 ** (j * dj) for j in range(j1 + 1)])
    fc = w0 / (2 * np.pi)
    # cmor bandwidth 2.0 gives the exp(-t^2/2) envelope of the standard Morlet.
    coef, _ = pywt.cwt(y, scales / dt, f"cmor2.0-{fc:.10f}", sampling_period=dt)
    power = np.abs(coef) ** 2

    return {"peakScaleIndex": [int(v) for v in power[:, lo:hi].argmax(axis=0)]}


def moving_stat_keys(args):
    """movinganalysis.js getStatKeys."""
    an = args.get('analysis')
    if an == 'periodogram':
        return ['peak_period', 'peak_power']
    if an == 'summary':
        return ['mean', 'sd', 'percentile']
    if an == 'npcra':
        return ['IS', 'IV', 'RA', 'L5', 'M10', 'M10onset']
    if an == 'cosinor':
        if args.get('useFixedPeriod'):
            keys = ['mesor']
            for h in range(1, max(1, int(args.get('nHarmonics') or 1)) + 1):
                keys += [f'H{h}_amplitude', f'H{h}_acrophase']
            return keys + ['rel_amplitude', 'r2', 'rmse', 'pvalue']
        keys = []
        for c in range(1, max(1, int(args.get('Ncurves') or 1)) + 1):
            keys += [f'C{c}_period', f'C{c}_amplitude', f'C{c}_phase', f'C{c}_acrophase']
        return keys + ['r2', 'rmse']
    if an == 'fft':
        return ['peak_period', 'peak_frequency', 'peak_magnitude']
    if an == 'correlogram':
        return ['peak_lag', 'peak_correlation']
    if an == 'rectfit':
        return ['mesor', 'amplitude', 'period', 'acrophase', 'duty_cycle', 'kappa', 'r2', 'rmse']
    if an == 'doublelogistic':
        keys = ['mesor', 'amplitude', 'onset', 'offset', 'k1', 'k2']
        if args.get('dlPeriodic'):
            keys.append('period')
        return keys + ['r2', 'rmse']
    if an == 'trend':
        model = args.get('trendModel') or 'linear'
        if model == 'linear':
            return ['slope', 'intercept', 'r2', 'rmse']
        if model in ('exponential', 'logarithmic'):
            return ['a', 'b', 'r2', 'rmse']
        if model == 'polynomial':
            deg = max(0, int(math.floor(args.get('trendPolyDegree', 2) or 0)))
            return [f'c{i}' for i in range(deg + 1)] + ['r2', 'rmse']
    return []


_FREE_PHASE_FOLD_HOURS = 24


def _a(args, k, d):
    v = args.get(k)
    return d if v is None else v


def _moving_window_stats(tt, yy, args, phase=None, centre=_NAN):
    """movinganalysis.js computeStatsForWindow, including the rolling phase frame (FIT-9):
    phases read nearest the window centre (free periods), on the record's hour 0, folded onto
    a fixed period (else 24 h), then put in the node's phase reference."""
    ref = (phase or {}).get('ref')
    record_start = (phase or {}).get('recordStart', 0) or 0
    keys = moving_stat_keys(args)
    st = {k: _NAN for k in keys}
    if len(tt) < 3:
        return st
    an = args.get('analysis')
    if an == 'summary':
        pct = _js_number(_a(args, 'summaryPercentile', 50))
        st['mean'] = sum(yy) / len(yy)
        st['sd'] = _gc_sample_std(yy)
        st['percentile'] = _quantile_type7(yy, (pct if math.isfinite(pct) else 50) / 100)
        return st
    if an == 'periodogram':
        res = run_periodogram_calculation({
            't': tt, 'y': yy, 'method': _a(args, 'pgMethod', 'Lomb-Scargle'),
            'minPeriod': args.get('periodMin'), 'maxPeriod': args.get('periodMax'),
            'stepSize': args.get('periodStep'), 'dt': _a(args, 'pgBinSize', 0.25),
            'alpha': _a(args, 'pgAlpha', 0.05)})
        i = _spectral_peak_index(res['y'] or [])
        if i >= 0:
            st['peak_period'] = res['x'][i]
            st['peak_power'] = res['y'][i]
        return st
    if an == 'npcra':
        P = _a(args, 'npcraPeriod', 24)
        r = compute_npcra(tt, yy, epoch_hours=_a(args, 'npcraEpochHours', 1), period=P,
                          m_window=_a(args, 'npcraMWindow', 10),
                          l_window=_a(args, 'npcraLWindow', 5))
        if not r:
            return st
        for k in ('IS', 'IV', 'RA', 'L5', 'M10'):
            st[k] = r[k]
        st['M10onset'] = apply_phase_reference(
            wrap_to_period(r['M10onset'] + r['t0'] - record_start, P), ref, P)
        return st
    if an == 'cosinor':
        if args.get('useFixedPeriod'):
            per = _a(args, 'fixedPeriod', 24)
            r = fit_cosinor_fixed(tt, yy, per, max(1, int(_a(args, 'nHarmonics', 1))),
                                  _a(args, 'alpha', 0.05))
            if not r:
                return st
            st['mesor'] = r['M']
            for h in r['harmonics']:
                k = h['k']
                st[f'H{k}_amplitude'] = h['amplitude']
                st[f'H{k}_acrophase'] = apply_phase_reference(
                    wrap_to_period(h['acrophase_hrs'], per / k), ref, per / k)
            amp1 = r['harmonics'][0]['amplitude'] if r['harmonics'] else _NAN
            st['rel_amplitude'] = (amp1 / r['M'] if (math.isfinite(r['M'])
                                   and abs(r['M']) > 1e-12 and math.isfinite(amp1)) else _NAN)
            st['r2'], st['rmse'], st['pvalue'] = r['R2'], r['RMSE'], r['pF']
            return st
        r = fit_cosine_curves(tt, yy, max(1, int(_a(args, 'Ncurves', 1))))
        if not r or not r['parameters'].get('cosines'):
            return st
        for c, cs in enumerate(r['parameters']['cosines'], start=1):
            w = cs['frequency']  # cycles per unit in this port
            per = 1 / w if w else _NAN
            st[f'C{c}_period'] = per
            st[f'C{c}_amplitude'] = cs['amplitude']
            st[f'C{c}_phase'] = cs['phase']
            peak = wrap_to_period(-cs['phase'] / (2 * math.pi * w), per) if per > 0 else _NAN
            st[f'C{c}_acrophase'] = apply_phase_reference(
                wrap_to_period(nearest_phase_instant(peak, per, centre), _FREE_PHASE_FOLD_HOURS),
                ref, _FREE_PHASE_FOLD_HOURS)
        st['r2'], st['rmse'] = r['rSquared'], r['rmse']
        return st
    if an == 'fft':
        st.update(_moving_fft_stats(tt, yy, args))
        return st
    if an == 'correlogram':
        mn = args.get('corrMinLag')
        mx = args.get('corrMaxLag')
        r = compute_autocorrelation(tt, yy, None, mx if (_finite(mx) and mx > 0) else None,
                                    mn if (_finite(mn) and mn > 0) else 0)
        if not r['lags']:
            return st
        lag, cr = find_autocorrelation_peak(r['lags'], r['correlations'])
        if not math.isnan(lag):
            st['peak_lag'], st['peak_correlation'] = lag, cr
        return st
    if an == 'rectfit':
        fixed = bool(args.get('useFixedPeriod'))
        fp = _a(args, 'fixedPeriod', 24)
        try:
            r = fit_rectangular_wave(tt, yy, {
                'fixOmega': fixed, 'fixedOmega': 2 * math.pi / fp if fixed else None,
                'fixKappa': bool(args.get('rwFixKappa')), 'fixedKappa': _a(args, 'rwFixedKappa', 5),
                'fixDutyCycle': bool(args.get('rwFixDutyCycle')),
                'fixedDutyCycle': _a(args, 'rwFixedDutyCycle', 0.5)})
        except ValueError:
            r = None
        if not r:
            return st
        pr = r['parameters']
        st['mesor'], st['amplitude'], st['period'] = pr['M'], pr['A'], r['period']
        fold = fp if fixed else _FREE_PHASE_FOLD_HOURS
        peak = r['acrophase'] if fixed else wrap_to_period(
            nearest_phase_instant(r['acrophase'], r['period'], centre), fold)
        st['acrophase'] = apply_phase_reference(peak, ref, fold)
        st['duty_cycle'], st['kappa'] = pr['dutyCycle'], pr['kappa']
        st['r2'], st['rmse'] = r['rSquared'], r['rmse']
        return st
    if an == 'doublelogistic':
        periodic = bool(args.get('dlPeriodic'))
        r = fit_double_logistic(tt, yy, {
            'periodic': periodic, 'fixK1': bool(args.get('dlFixK1')),
            'fixedK1': _a(args, 'dlFixedK1', 0.5), 'fixK2': bool(args.get('dlFixK2')),
            'fixedK2': _a(args, 'dlFixedK2', 0.5),
            'fixPeriod': periodic and bool(args.get('useFixedPeriod')),
            'fixedPeriod': _a(args, 'fixedPeriod', 24)})
        if not r:
            return st
        pr = r['parameters']
        st['mesor'], st['amplitude'] = pr['M'], pr['A']
        T = pr.get('T')
        fold = (_a(args, 'fixedPeriod', 24) if (periodic and args.get('useFixedPeriod'))
                else _FREE_PHASE_FOLD_HOURS)

        def dl_phase(tx):
            inst = nearest_phase_instant(tx, T, centre) if (periodic and T and T > 0) else tx
            return apply_phase_reference(wrap_to_period(inst, fold), ref, fold)
        st['onset'], st['offset'] = dl_phase(pr['t1']), dl_phase(pr['t2'])
        st['k1'], st['k2'] = pr['k1'], pr['k2']
        if periodic:
            st['period'] = T
        st['r2'], st['rmse'] = r['rSquared'], r['rmse']
        return st
    if an == 'trend':
        model = args.get('trendModel') or 'linear'
        deg = max(0, int(math.floor(_a(args, 'trendPolyDegree', 2))))
        if model == 'logarithmic' and any(not (v > 0) for v in tt):
            return st
        if model == 'exponential' and any(not (v > 0) for v in yy):
            return st
        if model == 'polynomial' and len(tt) <= deg:
            return st
        try:
            r = fit_trend(tt, yy, model, deg)
        except Exception:  # noqa: BLE001
            return st
        if not r or not r.get('parameters'):
            return st
        pr = r['parameters']
        if model == 'linear':
            st['slope'], st['intercept'] = pr['slope'], pr['intercept']
        elif model in ('exponential', 'logarithmic'):
            st['a'], st['b'] = pr['a'], pr['b']
        elif model == 'polynomial':
            for i, c in enumerate(pr.get('coeffs') or []):
                st[f'c{i}'] = c
        st['r2'], st['rmse'] = r['rSquared'], r['rmse']
        return st
    return st


def compute_moving_windows(t_all, ys, starts, window_size, stat_keys, args, phase=None):
    """movinganalysis.js computeMovingWindows: per y, per window [start, start + size), the
    rows with a valid x and y (house rule, Number()); fewer than 3, a trend outside its
    domain, or an FFT window off its regular grid is NaN; only finite stats are kept. Window
    centre = start + size / 2 (rolling phases)."""
    model = (args.get('trendModel') or 'linear') if args.get('analysis') == 'trend' else None
    deg = max(0, int(math.floor(_a(args, 'trendPolyDegree', 2))))
    out = []
    for y_data in ys:
        per = {k: [_NAN] * len(starts) for k in stat_keys}
        for w, w_start in enumerate(starts):
            w_end = w_start + window_size
            tt, yy = [], []
            for i in range(min(len(t_all), len(y_data))):
                if _js_invalid(t_all[i]) or _js_invalid(y_data[i]):
                    continue
                tn = _js_number(t_all[i])
                if w_start <= tn < w_end:
                    tt.append(tn)
                    yy.append(_js_number(y_data[i]))
            if len(tt) < 3:
                continue
            if model == 'logarithmic' and any(not (v > 0) for v in tt):
                continue
            if model == 'exponential' and any(not (v > 0) for v in yy):
                continue
            if model == 'polynomial' and len(tt) <= deg:
                continue
            if args.get('analysis') == 'fft' and not regrid_uniform(tt, yy)['ok']:
                continue
            s_ = _moving_window_stats(tt, yy, args, phase, w_start + window_size / 2)
            for k in stat_keys:
                v = s_.get(k)
                if _finite(v):
                    per[k][w] = v
        out.append(per)
    return out


def moving_windows(times, values, opts):
    """Parity surface mirroring the emitter's movingWindowsAdapter: starts from the valid
    times (s += step), one y, the phase frame {recordStart: min valid t, ref: clock with
    opts['clockOffsetHours'] when given}. Returns {'starts', <stat>: [...]}."""
    window = _js_number(_a(opts, 'windowSize', 168))
    step = _js_number(_a(opts, 'stepSize', 24))
    tt = [_NAN if _js_invalid(v) else _js_number(v) for v in times]
    yv = [_NAN if _js_invalid(v) else _js_number(v) for v in values]
    valid = [v for v in tt if math.isfinite(v)]
    lo, hi = min(valid), max(valid)
    starts = []
    s_ = lo
    while s_ <= hi - window + 1e-9:
        starts.append(s_)
        s_ += step
    keys = moving_stat_keys(opts)
    off = opts.get('clockOffsetHours')
    phase = {'recordStart': lo,
             'ref': {'clock': True, 'offsetHours': off} if off is not None else None}
    per = compute_moving_windows(tt, [yv], starts, window, keys, opts, phase)[0]
    out = {'starts': starts}
    out.update(per)
    return out


def fisher_exact_test(table, alternative='two-sided'):
    """Fisher's exact test for a 2x2 table.

    Delegates to scipy.stats.fisher_exact — a real reference implementation
    rather than a second copy of the JS, per the D13 parity policy. The JS side
    enumerates the hypergeometric distribution itself (utils/fisherExact.js);
    this is what pins it.

    Returns the sample odds ratio ad/bc (scipy's first return value), NOT the
    conditional MLE that scipy exposes separately as `odds_ratio`.
    """
    from scipy.stats import fisher_exact as _fisher
    odds, p = _fisher(table, alternative=alternative)
    return {
        'pvalue': float(p),
        'oddsRatio': float(odds),
        'alternative': alternative,
    }


def chi_square_independence_effects(table, correction=True):
    """chi2 independence PLUS effect sizes.

    Cramer's V comes from scipy.stats.contingency.association — a real reference
    implementation rather than a second copy of the JS formula. phi is the signed
    2x2 special case, which scipy does not expose directly.

    Note the JS computes V from the UNCORRECTED statistic even when Yates is on
    (the correction is a p-value device, not an effect-size one), and scipy's
    `association` likewise uses correction=False internally.
    """
    import numpy as np
    from scipy.stats.contingency import association
    a = np.asarray(table, dtype=float)
    base = chi_square_independence(table, correction)
    # scipy's association() insists on an INTEGER array (counts), so pass a
    # rounded integer copy; the float view is kept for the phi arithmetic below.
    v = float(association(np.rint(a).astype(np.int64), method='cramer'))
    phi = float('nan')
    if a.shape == (2, 2):
        (aa, bb), (cc, dd) = a
        denom = math.sqrt((aa + bb) * (cc + dd) * (aa + cc) * (bb + dd))
        phi = (aa * dd - bb * cc) / denom if denom > 0 else float('nan')
    return {**base, 'cramersV': v, 'phi': phi, 'n': float(a.sum())}


def cohens_w(statistic, n):
    """Cohen's w = sqrt(chi2 / n)."""
    if not (math.isfinite(statistic) and math.isfinite(n)) or n <= 0:
        return float('nan')
    return math.sqrt(statistic / n)


def fisher_odds_ratio_ci(table, confidence=0.95, alternative='two-sided'):
    """Conditional MLE odds ratio + its confidence interval.

    Delegates to scipy.stats.contingency.odds_ratio(kind='conditional'), which is
    the same quantity R's fisher.test prints - a real reference rather than a
    second copy of the JS root-finding. A one-sided `alternative` gives the
    one-sided interval ('less' [0, upper], 'greater' [lower, inf]), as R does.
    """
    from scipy.stats.contingency import odds_ratio as _or
    import numpy as np
    r = _or(np.rint(np.asarray(table, dtype=float)).astype(np.int64), kind='conditional')
    ci = r.confidence_interval(confidence_level=confidence, alternative=alternative)
    return {
        'conditionalOddsRatio': float(r.statistic),
        'ciLow': float(ci.low),
        'ciHigh': float(ci.high),
    }


def correlation_ci(values, method='pearson', confidence=0.95):
    """Fisher z confidence interval for a correlation coefficient.

    `values` is [r, n]. The normal quantile comes from scipy; the transform
    itself is three lines and is the thing being checked.
    """
    import numpy as np
    from scipy.stats import norm
    r, n = float(values[0]), float(values[1])
    if not np.isfinite(r) or n < 4:
        return {'ciLow': float('nan'), 'ciHigh': float('nan')}
    if abs(r) >= 1:
        return {'ciLow': r, 'ciHigh': r}
    z = np.arctanh(r)
    zc = norm.ppf(1 - (1 - confidence) / 2)
    se = np.sqrt((1 + r ** 2 / 2) / (n - 3)) if method == 'spearman' else 1 / np.sqrt(n - 3)
    return {'ciLow': float(np.tanh(z - zc * se)), 'ciHigh': float(np.tanh(z + zc * se))}


# ----------------------------------------------------------------------
# Actogram marker rules (plan docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md,
# Phase B2). A one-for-one port of the pure JS modules the app computes a rule's five output
# ports from, so an actogram's onset/offset tau, phi, R2, RMSE and n can be recomputed
# outside the app:
#
#   plots/Actogram/onsetUnwrap.js      find_centile_value, find_best_match_index,
#                                      match_template_markers, marker_absolute_times,
#                                      unwrap_onsets, wrap_phase_to_row
#   plots/Actogram/markerSelection.js  fit_day_range, is_day_selected, selection_mask,
#                                      is_outside_fit_range
#   plots/Actogram/lineFit.js          fit_line (all four lock combinations)
#   plots/Actogram/harmonicCheck.js    harmonic_check (over this runtime's _lomb_scargle)
#   plotbits/helpers/wrangleData.js    kahan_linear_regression (the app's linearRegression)
#   plots/plotMetricDefs.js            rule_output_values
#
# and the parts of the Svelte classes the outputs depend on: the row folding at the plot's
# startTime (Actogram.svelte: startTime, offset, dataByDays, binSize, Ndays), a rule's cfg
# adapter (markerRules.svelte.js ruleCfg: fixed tau/theta re-encoded as slope/intercept) and
# the block's deriveds (PhaseMarker.svelte: markers, markerTimes, selectedMask, onsetUnwrap,
# linearRegression, estimatedPhase, harmonicCheck). The `actogramMarkers` parity fixtures
# compare every one of those intermediates, not only the five outputs, against the JS.
#
# JS semantics reproduced on purpose (each one changes a number somewhere):
#   - `%` is JS remainder (sign of the dividend): math.fmod, never Python's %;
#   - Math.round rounds half toward +inf: _js_round;
#   - `x ?? d` treats only null/undefined as missing, `x || d` treats 0 and NaN as missing
#     too (an own block's centile 0 reads as 50; a rule's does not);
#   - sorts are stable and numeric; sums that JS compensates (KahanSum) are compensated here.
# ----------------------------------------------------------------------

class _KahanJS:
    """KahanSum exactly as utils/numerics.js has it: no NaN skipping (KahanSum above skips
    None and NaN, which the JS class does not)."""

    def __init__(self):
        self.sum = 0.0
        self.c = 0.0

    def add(self, value):
        y = value - self.c
        t = self.sum + y
        self.c = t - self.sum - y
        self.sum = t

    @property
    def value(self):
        return self.sum


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _js_number(v):
    """JS Number(v) for a cell: a float, NaN where JS gives NaN. Strings follow JS syntax,
    not Python's: '0x10' is 16 and 'Infinity' is inf, while '1_000', 'inf' and 'nan' are NaN
    (Python's float() accepts those three). null is 0 as in JS; callers test the house rule
    (_js_invalid) first, which treats it as missing."""
    if v is None:
        return 0.0
    if isinstance(v, (bool, np.bool_)):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    if isinstance(v, str):
        t = v.strip(_JS_WS)
        if t == '':
            return 0.0
        if t in ('Infinity', '+Infinity'):
            return math.inf
        if t == '-Infinity':
            return -math.inf
        if _JS_DECIMAL_RE.fullmatch(t):
            return float(t)
        m = _JS_RADIX_RE.fullmatch(t)
        if m:
            base = {'x': 16, 'o': 8, 'b': 2}[m.group(1).lower()]
            try:
                return float(int(m.group(2), base))
            except ValueError:
                return math.nan
            except OverflowError:
                return math.inf
        return math.nan
    return math.nan


def _js_invalid(v):
    """stats.js isInvalidValue (the house rule): null/undefined, a blank or whitespace-only
    string, or NaN after JS Number() coercion. Booleans and +-Infinity are NOT invalid."""
    if v is None:
        return True
    if isinstance(v, str) and v.strip(_JS_WS) == '':
        return True
    return math.isnan(_js_number(v))


def _js_min(data):
    """stats.js min: the smallest valid value, or None when there is none."""
    out = math.inf
    for v in data:
        if not _js_invalid(v) and v < out:
            out = v
    return None if out == math.inf else out


def _js_mod(a, b):
    """JS `a % b` (the remainder takes the sign of the dividend)."""
    return math.fmod(a, b)


def kahan_linear_regression(x, y):
    """plotbits/helpers/wrangleData.js linearRegression: raw compensated sums, no NaN
    filtering, NaN slope for a single point (the sums' 0 / 0), exactly as the app fits
    both-free marker lines. (`linear_regression` above is a different, centred numpy fit.)"""
    n = len(x)
    if n != len(y) or n == 0:
        raise ValueError('Input arrays must have the same non-zero length')
    kx, ky, kxy, kxx = _KahanJS(), _KahanJS(), _KahanJS(), _KahanJS()
    for i in range(n):
        kx.add(x[i])
        ky.add(y[i])
        kxy.add(x[i] * y[i])
        kxx.add(x[i] * x[i])
    sx, sy, sxy, sxx = kx.value, ky.value, kxy.value, kxx.value
    num = n * sxy - sx * sy
    den = n * sxx - sx * sx
    slope = _js_div(num, den)
    intercept = (sy - slope * sx) / n
    k_tot, k_res = _KahanJS(), _KahanJS()
    mean_y = sy / n
    for i in range(n):
        pred = slope * x[i] + intercept
        k_tot.add((y[i] - mean_y) ** 2)
        k_res.add((y[i] - pred) ** 2)
    r2 = 1 - _js_div(k_res.value, k_tot.value)
    rmse = math.sqrt(k_res.value / n) if k_res.value == k_res.value else float('nan')
    return {'slope': slope, 'intercept': intercept, 'rSquared': r2, 'rmse': rmse}


def _js_div(a, b):
    """IEEE division as JS does it: x / 0 is +-Infinity, 0 / 0 is NaN (Python raises)."""
    if b == 0:
        if a == 0 or a != a:
            return float('nan')
        return math.copysign(math.inf, a) * math.copysign(1.0, b)
    return a / b


# --- onsetUnwrap.js: template matching ------------------------------------------------

def find_centile_value(data, centile):
    """The value at the centile of the non-zero, non-NaN values (None when there is none,
    JS `undefined`)."""
    filtered = [v for v in data if not (v != v) and v != 0]
    s = sorted(filtered)
    idx = math.ceil((centile / 100) * len(s)) - 1
    return s[idx] if 0 <= idx < len(s) else None


def find_best_match_index(test, template):
    """Start index of the best (strictly highest) cross-correlation, or -1."""
    best_idx = -1
    best = -math.inf
    for i in range(0, len(test) - len(template) + 1):
        corr = 0
        for j in range(len(template)):
            corr += test[i + j] * template[j]
        if corr > best:
            best = corr
            best_idx = i
    return best_idx


def match_template_markers(x_by_period, y_by_period, period_hrs, bin_size, hrs_before,
                           hrs_after, centile, type):
    """One detection per actogram row (see onsetUnwrap.js matchTemplateMarkers). Returns
    {'hours': per-row hour in [0, P), 'times': per-row absolute time}, NaN = none."""
    N = _js_round(hrs_before / bin_size)
    M = _js_round(hrs_after / bin_size)
    template = [(-1 if type == 'onset' else 1)] * N + [(1 if type == 'onset' else -1)] * M
    hours, times = [], []
    keys = [int(k) for k in x_by_period.keys()]
    if not keys:
        return {'hours': hours, 'times': times}
    max_period = max(keys)
    nan = float('nan')
    for i in range(0, max_period + 1):
        yi = y_by_period.get(i)
        if not yi:
            hours.append(nan)
            times.append(nan)
            continue
        yn = y_by_period.get(i + 1)
        if yn:
            data = list(yi) + list(yn)
            xs = list(x_by_period[i]) + list(x_by_period[i + 1])
        else:
            data = list(yi)
            xs = list(x_by_period[i])
        cv = find_centile_value(data, centile)
        # JS: value <= undefined is false, so with no centile every non-NaN value is +1.
        above_below = [-1 if (v != v) or (cv is not None and v <= cv) else 1 for v in data]
        # The new state starts at template start + N (onsetUnwrap.js, FIT-6); the old
        # midpoint (N + M) / 2 moved the marker by (M - N) / 2 bins when N != M.
        best = find_best_match_index(above_below, template) + N
        if 0 <= best < len(xs):
            t = xs[best]
            raw = t - i * period_hrs
            raw = _js_mod(_js_mod(raw, period_hrs) + period_hrs, period_hrs)
            hours.append(raw)
            times.append(t)
        else:
            hours.append(nan)
            times.append(nan)
    return {'hours': hours, 'times': times}


def marker_absolute_times(markers, period_hrs, times=None):
    """Absolute time of each row's marker: the detection's own time, else i * P + hour."""
    out = []
    for i, h in enumerate(markers):
        t = times[i] if times is not None and i < len(times) else None
        if _finite(t):
            out.append(t)
        elif _finite(h):
            out.append(i * period_hrs + h)
        else:
            out.append(float('nan'))
    return out


# --- onsetUnwrap.js: unwrapping ---------------------------------------------------------

def _wrap_half(v, P):
    """Wrap v into [-P/2, P/2)."""
    return v - P * math.floor(v / P + 0.5)


def _median_js(arr):
    if not arr:
        return float('nan')
    s = sorted(arr)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def _seed_tau(pts, P):
    by_row = sorted(pts, key=lambda p: p['row'])
    adjacent, spaced = [], []
    for j in range(1, len(by_row)):
        g = by_row[j]['row'] - by_row[j - 1]['row']
        if g < 1:
            continue
        change = _wrap_half(by_row[j]['t'] - by_row[j - 1]['t'] - g * P, P)
        (adjacent if g == 1 else spaced).append(change / g)
    changes = adjacent if len(adjacent) >= 2 else adjacent + spaced
    drift = _median_js(changes)
    tau = P + (drift if math.isfinite(drift) else 0)
    return tau if tau > 0 else P


def _number_cycles(sorted_pts, tau):
    groups = [{'k': 0, 'ts': [sorted_pts[0]['t']], 'rows': [sorted_pts[0]['row']]}]
    ambiguous = 0
    for j in range(1, len(sorted_pts)):
        last = groups[-1]
        acc = 0
        for v in last['ts']:
            acc += v
        prev_t = acc / len(last['ts'])
        ratio = (sorted_pts[j]['t'] - prev_t) / tau
        n = _js_round(ratio)
        if abs(ratio - n) > 0.25:
            ambiguous += 1
        if n <= 0:
            last['ts'].append(sorted_pts[j]['t'])
            last['rows'].append(sorted_pts[j]['row'])
        else:
            groups.append({'k': last['k'] + n, 'ts': [sorted_pts[j]['t']],
                           'rows': [sorted_pts[j]['row']]})
    return groups, ambiguous


def _plain_mean(vals):
    acc = 0
    for v in vals:
        acc += v
    return acc / len(vals)


def unwrap_onsets(times, period_hrs, selected=None):
    """Unwrap the selected per-row marker times into fit points whose slope is tau (see
    onsetUnwrap.js unwrapOnsets). xs = 1-indexed UNWRAPPED rows, ys = absolute time + P."""
    P = period_hrs
    selected = selected or []
    pts = []
    for i, t in enumerate(times):
        sel = selected[i] if i < len(selected) else None
        if not (True if sel is None else sel):
            continue
        if not _finite(t):
            continue
        pts.append({'row': i, 't': t})
    if not pts or not (P > 0):
        return {'xs': [], 'ys': [], 'n': 0, 'nDetections': len(pts), 'nMerged': 0,
                'nAmbiguous': 0, 'seedTau': float('nan')}
    sorted_pts = sorted(pts, key=lambda p: p['t'])
    tau = _seed_tau(pts, P)
    result = None
    prev_key = ''
    for _ in range(5):
        groups, ambiguous = _number_cycles(sorted_pts, tau)
        first_t = _plain_mean(groups[0]['ts'])
        x0 = math.floor(first_t / P) + 1
        xs = [x0 + g['k'] for g in groups]
        ys = [_plain_mean(g['ts']) + P for g in groups]
        result = {'xs': xs, 'ys': ys, 'n': len(groups), 'nDetections': len(pts),
                  'nMerged': len(pts) - len(groups), 'nAmbiguous': ambiguous, 'seedTau': tau}
        key = ','.join(str(g['k']) for g in groups)
        if key == prev_key or len(xs) < 2:
            break
        prev_key = key
        fitted = kahan_linear_regression(xs, ys)['slope']
        if not math.isfinite(fitted) or fitted <= 0:
            break
        tau = fitted
    return result


def wrap_phase_to_row(hour, tau, period_hrs):
    """The line's time of day in [0, P) in a row, from its unwrapped position there."""
    if not _finite(hour):
        return float('nan')
    period = tau if (_finite(tau) and tau > 0) else period_hrs
    v = hour - period * math.floor(hour / period)
    if v >= period_hrs:
        v -= period_hrs
    return v


# --- markerSelection.js -----------------------------------------------------------------

def fit_day_range(line_min_day=None, line_max_day=None):
    """The inclusive 1-indexed day range the fit may use; hi is inf when unbounded."""
    lo = max(1, line_min_day) if _finite(line_min_day) else 1
    hi = line_max_day if _finite(line_max_day) else math.inf
    return {'lo': lo, 'hi': hi}


def is_day_selected(i, selected_periods, range_scopes_fit=False, line_min_day=None,
                    line_max_day=None):
    """Whether row i (0-based) enters the fit: ticked (missing = ticked) AND, when the range
    scopes the fit, inside lineMinDay..lineMaxDay."""
    sp = selected_periods or []
    v = sp[i] if 0 <= i < len(sp) else None
    if not (True if v is None else v):
        return False
    if not range_scopes_fit:
        return True
    r = fit_day_range(line_min_day, line_max_day)
    day = i + 1
    return r['lo'] <= day <= r['hi']


def selection_mask(n, selected_periods, range_scopes_fit=False, line_min_day=None,
                   line_max_day=None):
    """The selection for rows 0..n-1 as a dense list of booleans."""
    return [is_day_selected(i, selected_periods, range_scopes_fit, line_min_day, line_max_day)
            for i in range(max(0, int(n)))]


def is_outside_fit_range(i, range_scopes_fit=False, line_min_day=None, line_max_day=None):
    """Whether row i is left out by the range (not by the series' own tick)."""
    if not range_scopes_fit:
        return False
    r = fit_day_range(line_min_day, line_max_day)
    day = i + 1
    return day < r['lo'] or day > r['hi']


# --- lineFit.js -------------------------------------------------------------------------

def _line_residuals(xs, ys, slope, intercept, period_hrs):
    """lineFit.js residuals. R2 is in the TIME-OF-DAY frame: SS_tot is the spread of
    z = y - period_hrs * x about its mean (on absolute time the 24 h-per-day ramp dominated
    and random onsets scored R2 ~ 0.99, FIT-4); None when z does not vary. RMSE unchanged."""
    n = len(xs)
    if n == 0 or not math.isfinite(slope) or not math.isfinite(intercept):
        return None, None
    kz = _KahanJS()
    for i in range(n):
        kz.add(ys[i] - period_hrs * xs[i])
    mean_z = kz.value / n
    k_tot, k_res = _KahanJS(), _KahanJS()
    for i in range(n):
        k_tot.add((ys[i] - period_hrs * xs[i] - mean_z) ** 2)
        k_res.add((ys[i] - (slope * xs[i] + intercept)) ** 2)
    r2 = 1 - k_res.value / k_tot.value if k_tot.value > 0 else None
    return r2, math.sqrt(k_res.value / n)


def fit_line(xs, ys, tau=None, theta=None, ref_day=1, period_hrs=24):
    """The marker line with tau (slope) and theta (time of day at ref_day) each fitted or
    fixed (lineFit.js fitLine). Frame: x = 1-indexed day, y = absolute time, so the line's
    time of day at day d is (slope - P) * d + intercept; a fixed theta pins the line through
    (ref_day, theta + P * ref_day). R2/RMSE are of the line as drawn, None with no markers."""
    if len(xs) != len(ys):
        raise ValueError('fit_line: x and y must be arrays of the same length')
    n = len(xs)
    tau_fixed = _finite(tau)
    theta_fixed = _finite(theta)
    x0 = ref_day
    y0 = (theta if theta_fixed else 0) + period_hrs * ref_day
    nan = float('nan')
    if not tau_fixed and not theta_fixed:
        if n == 0:
            slope, intercept = nan, nan
        else:
            reg = kahan_linear_regression(xs, ys)
            slope, intercept = reg['slope'], reg['intercept']
    elif tau_fixed and not theta_fixed:
        slope = tau
        if n == 0:
            intercept = nan
        else:
            k = _KahanJS()
            for i in range(n):
                k.add(ys[i] - slope * xs[i])
            intercept = k.value / n
    elif not tau_fixed and theta_fixed:
        num = 0
        den = 0
        for i in range(n):
            dx = xs[i] - x0
            num += dx * (ys[i] - y0)
            den += dx * dx
        slope = nan if den == 0 else num / den
        intercept = y0 - slope * x0
    else:
        slope = tau
        intercept = y0 - slope * x0
    r2, rmse = _line_residuals(xs, ys, slope, intercept, period_hrs)
    return {'slope': slope, 'intercept': intercept, 'rSquared': r2, 'rmse': rmse, 'n': n}


# --- harmonicCheck.js -------------------------------------------------------------------

def _harmonic_power(x_data, y_data, period):
    """One single-period Lomb-Scargle evaluation as runPeriodogramCalculation returns it
    for periodMin = periodMax = period: [] when the JS gives NaN (fewer than two raw samples,
    which its NaN strip then removes), else [power]. The pairs are filtered with the app's
    validPairs rule, and a degenerate series (no pairs, zero or undefined variance) scores 0,
    as calculateLombScarglePower does, before this runtime's _lomb_scargle is called."""
    if x_data is None or y_data is None or len(x_data) < 2 or len(y_data) < 2 \
            or len(x_data) != len(y_data):
        return []
    tt, yy = [], []
    for t, v in zip(x_data, y_data):
        if not _js_invalid(t) and not _js_invalid(v):
            tt.append(float(t))
            yy.append(float(v))
    if len(tt) < 2:
        return [0.0]
    m = _plain_mean(yy)
    var = sum((v - m) ** 2 for v in yy) / (len(yy) - 1)
    if not (var > 0):
        return [0.0]
    p = _lomb_scargle(tt, yy, [period])[0]
    return [p if math.isfinite(p) else 0.0]


def harmonic_check(x_data, y_data, bin_size, tau):
    """tau, tau/2 and 2 tau, each scored by one Lomb-Scargle evaluation of the series; the
    strongest wins, ties keeping the earlier candidate. Candidates must satisfy
    bin*2 < period < span/2 with span = last PRESENT sample minus first (sample order) and
    bin = bin_size or 0.25. None when there is no tau, no data or no candidate."""
    if not tau or tau != tau:
        return None
    if not x_data or not y_data:
        return None
    bin_ = bin_size if (bin_size and bin_size == bin_size) else 0.25
    # First and last PRESENT samples. The app used to read a missing end as 0 (JS
    # `null - x0`), which made a missing LAST time a span of about 0 and dropped every
    # candidate; this port copied that. Both now skip a missing end (harmonicCheck.js).
    present = [i for i, v in enumerate(x_data) if not _js_invalid(v)]
    span = (float(x_data[present[-1]]) - float(x_data[present[0]])) if present else float('nan')
    cands = [{'label': 'τ', 'period': tau}, {'label': 'τ/2', 'period': tau / 2},
             {'label': '2τ', 'period': tau * 2}]
    cands = [c for c in cands if c['period'] > bin_ * 2 and c['period'] < span / 2]
    if not cands:
        return None
    results = []
    for c in cands:
        power = _harmonic_power(x_data, y_data, c['period'])
        if not power:
            results.append({**c, 'peakPeriod': c['period'], 'power': 0})
        else:
            results.append({**c, 'peakPeriod': c['period'], 'power': power[0]})
    # Eligibility (harmonicCheck.js): tau always; tau/2 only when the half-cycle F test at
    # L = tau finds NO significant odd harmonics (p >= 0.05); 2 tau only when the test at
    # L = 2 tau DOES (p < 0.05). An uncomputable test leaves the candidate ineligible.
    for c in results:
        if c['label'] == 'τ':
            c['eligible'] = True
            continue
        L = tau if c['label'] == 'τ/2' else 2 * tau
        c['test'] = half_cycle_test(x_data, y_data, L, bin_)
        pv = c['test']['pValue'] if c['test'] else None
        c['eligible'] = (pv is not None and math.isfinite(pv)
                         and (pv >= _HARMONIC_SWITCH_ALPHA if c['label'] == 'τ/2'
                              else pv < _HARMONIC_SWITCH_ALPHA))

    def pick(lst):
        best = lst[0]
        for r in lst[1:]:
            if r['power'] > best['power']:
                best = r
        return best
    elig = [c for c in results if c['eligible']]
    strongest = pick(elig) if elig else {'label': 'τ', 'period': tau, 'peakPeriod': tau,
                                         'power': float('nan'), 'eligible': True,
                                         'inRecord': False}
    return {'candidates': results, 'strongest': strongest, 'powerStrongest': pick(results)}


_HARMONIC_SWITCH_ALPHA = 0.05


def half_cycle_test(x_data, y_data, L, bin_size):
    """harmonicCheck.js halfCycleTest: does a period-L rhythm carry ODD harmonics (a
    difference between its two halves)? Full model fitCosinorFixed(L, 2H) against the
    reduced fitCosinorFixed(L / 2, H), H = max(1, min(3, floor(L / (4 bin)))); F on
    (2H, n - 1 - 4H) df with RSS = RMSE^2 (n - p). None when not computable."""
    t, y = [], []
    for i in range(min(len(x_data or []), len(y_data or []))):
        if _js_invalid(x_data[i]) or _js_invalid(y_data[i]):
            continue
        t.append(_js_number(x_data[i]))
        y.append(_js_number(y_data[i]))
    H = max(1, min(3, int(math.floor(L / (4 * (bin_size or 0.25))))))
    n = len(t)
    df1, df2 = 2 * H, n - 1 - 4 * H
    if not (df2 > 0):
        return None
    full = fit_cosinor_fixed(t, y, L, 2 * H)
    red = fit_cosinor_fixed(t, y, L / 2, H)
    if not full or not red:
        return None
    rss_f = full['RMSE'] ** 2 * df2
    rss_r = red['RMSE'] ** 2 * (n - 1 - 2 * H)
    if not (math.isfinite(rss_f) and math.isfinite(rss_r)):
        return None
    if rss_f > 0:
        F = max(0.0, rss_r - rss_f) / df1 / (rss_f / df2)
    else:
        F = math.inf if rss_r > 0 else 0.0
    p = 0.0 if F == math.inf else float(sp_stats.f.sf(F, df1, df2))
    return {'period': L, 'harmonics': 2 * H, 'F': F, 'df1': df1, 'df2': df2, 'pValue': p}


# --- Actogram.svelte: the row folding ---------------------------------------------------

def _num_or_none(v):
    """Number(v) for a present value, None for a missing one."""
    if v is None or (isinstance(v, str) and v.strip() == ''):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return float('nan')


def actogram_start_time(series_list, zone='utc'):
    """The plot's startTime (epoch ms): the earliest sample over ALL time-typed series whose
    x and y are both valid, snapped to the start of its day in the display zone ('utc', the
    app's default, or an IANA zone such as 'America/New_York'). 0 when no series is
    time-typed; rows of a non-time actogram never read it."""
    min_time = math.inf
    for s in series_list:
        if s.get('xType') != 'time':
            continue
        xd, yd = s.get('x') or [], s.get('y') or []
        if not xd or not yd:
            continue
        for i in range(min(len(xd), len(yd))):
            xv, yv = _num_or_none(xd[i]), _num_or_none(yd[i])
            if xv is None or yv is None or xv != xv or yv != yv:
                continue
            if xv < min_time:
                min_time = xv
    if min_time == math.inf:
        min_time = 0
    import datetime as _dt
    if zone in (None, 'utc', 'UTC'):
        return math.floor(min_time / 86400000.0) * 86400000.0
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(zone)
    local = _dt.datetime.fromtimestamp(min_time / 1000.0, tz)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    # Re-attach the zone at the new wall-clock time so its own UTC offset applies.
    midnight = _dt.datetime(midnight.year, midnight.month, midnight.day, tzinfo=tz)
    return float(round(midnight.timestamp() * 1000))


def actogram_hours_since_start(x, x_type):
    """Column.hoursSinceStart: minus the smallest valid value (and / 3.6e6 for time),
    invalid entries kept as None."""
    base = _js_min(x)
    if base is None:
        return []
    out = []
    for v in x:
        if v is None or _js_invalid(v):
            out.append(None)
        elif x_type == 'time':
            out.append((v - base) / 3600000)
        else:
            out.append(v - base)
    return out


def actogram_bin_size(hours):
    """ActogramDataclass.binSize: (last - first) / (last_idx - first_idx) over valid hours."""
    if not hours or len(hours) <= 1:
        return 0
    first = last = -1
    for i, v in enumerate(hours):
        if v is not None and v == v:
            if first == -1:
                first = i
            last = i
    if first == -1 or last == first:
        return 0
    return (hours[last] - hours[first]) / (last - first)


def actogram_series_frame(x, y, x_type, start_time, period_hrs, raw_bin_start0=None,
                          origin_time_ms=None):
    """One series folded into rows as ActogramDataclass.dataByDays does it: x in hours
    since the plot's startTime (hoursSinceStart - offset), row = floor(x / P), rows before 0
    dropped. Also returns what the harmonic check reads (hoursSinceStart and y, unfolded).
    `x` is the column's getData (bin CENTRES for a 'bin' column); a 'bin' column also needs
    its raw first bin start and its originTime_ms, which place its rows."""
    hss = actogram_hours_since_start(x, x_type)
    xmin = _js_min(x)
    if x_type == 'time':
        # JS: (startTime - min(x)) / 3.6e6; min() of an empty column is null, i.e. 0.
        offset = (start_time - (xmin if xmin is not None else 0)) / 3600000
    elif x_type == 'bin':
        # JS: -rawBinStart0 + (startTime - (originTime_ms ?? startTime)) / 3.6e6, so bars
        # sit at their raw bin starts, shifted to clock time when the column has an origin.
        origin = origin_time_ms if origin_time_ms is not None else start_time
        offset = -(raw_bin_start0 or 0) + (start_time - origin) / 3600000
    else:
        offset = -(xmin if xmin is not None else 0)
    x_by, y_by = {}, {}
    for i in range(len(hss)):
        tx = hss[i]
        ty = y[i] if i < len(y) else None
        if tx is None or tx != tx or ty is None or _js_invalid(ty):
            continue
        p = math.floor((tx - offset) / period_hrs)
        if p < 0:
            continue
        x_by.setdefault(p, []).append(tx - offset)
        y_by.setdefault(p, []).append(ty)
    return {'hoursSinceStart': hss, 'y': list(y), 'binSize': actogram_bin_size(hss),
            'offset': offset, 'xByPeriod': x_by, 'yByPeriod': y_by}


def actogram_ndays(frames):
    """Actogram Ndays: the highest row over all series + 1 (0 past 20000 rows)."""
    max_period = -1
    for f in frames:
        for k in f['xByPeriod']:
            if k > max_period:
                max_period = k
    if max_period < 0 or max_period + 1 > 20000:
        return 0
    return max_period + 1


# --- markerRules.svelte.js / PhaseMarker.svelte: a block's settings --------------------

def _js_or(v, d):
    """JS `v || d`: 0, NaN, '', null and false all fall back."""
    if v is None or v is False or v == '' or (isinstance(v, (int, float)) and (v == 0 or v != v)):
        return d
    return v


def marker_rule_from_json(json_rule):
    """MarkerRule's constructor guards (markerRules.svelte.js), on a saved rule."""
    j = json_rule or {}

    def finite_or(v, d):
        return v if _finite(v) else d

    def positive_or(v, d):
        return v if (_finite(v) and v > 0) else d

    def day_or_none(v):
        return _js_round(v) if (_finite(v) and v >= 1) else None

    def lock_or(v, d):
        return v if v in ('fit', 'fixed') else d

    return {
        'id': j.get('id'),
        'name': j.get('name') if isinstance(j.get('name'), str) else '',
        'type': j.get('type') if j.get('type') in ('onset', 'offset', 'manual') else 'onset',
        'templateHrsBefore': finite_or(j.get('templateHrsBefore'), 3),
        'templateHrsAfter': finite_or(j.get('templateHrsAfter'), 3),
        'centileThreshold': finite_or(j.get('centileThreshold'), 50),
        'lockTau': lock_or(j.get('lockTau'), 'fit'),
        'lockTheta': lock_or(j.get('lockTheta'), 'fit'),
        'fixedTau': positive_or(j.get('fixedTau'), None),
        'fixedTheta': j.get('fixedTheta') if _finite(j.get('fixedTheta')) else None,
        'phaseRefDay': day_or_none(j.get('phaseRefDay')),
        'lineMinDay': day_or_none(j.get('lineMinDay')),
        'lineMaxDay': day_or_none(j.get('lineMaxDay')),
    }


def marker_block_from_json(json_block):
    """PhaseMarkerClass's constructor defaults (PhaseMarker.svelte), on a saved own block.
    Its `||` defaults differ from a rule's on purpose: a block's centile 0 reads as 50."""
    j = json_block or {}
    legacy_fitline = j.get('type') == 'fitline'
    lock_default = 'fixed' if legacy_fitline else 'fit'
    return {
        'type': 'manual' if legacy_fitline else _js_or(j.get('type'), 'onset'),
        'centileThreshold': _js_or(j.get('centileThreshold'), 50),
        'templateHrsBefore': _js_or(j.get('templateHrsBefore'), 3),
        'templateHrsAfter': _js_or(j.get('templateHrsAfter'), 3),
        'fitSlope': j.get('fitSlope'),
        'fitIntercept': j.get('fitIntercept'),
        'lockTau': j.get('lockTau') if j.get('lockTau') is not None else lock_default,
        'lockTheta': j.get('lockTheta') if j.get('lockTheta') is not None else lock_default,
        'lineMinDay': j.get('lineMinDay'),
        'lineMaxDay': j.get('lineMaxDay'),
        'phaseRefDay': j.get('phaseRefDay'),
        'fitWithinRange': j.get('fitWithinRange') is True,
        'fromRule': j.get('fromRule') if isinstance(j.get('fromRule'), str) and j.get('fromRule') else None,
    }


def _fit_ref_day(cfg, n_days):
    """PhaseMarkerClass.fitRefDay: phaseRefDay ?? lineMinDay ?? 1, clamped to 1..Ndays."""
    nd = max(1, n_days)
    raw = cfg.get('phaseRefDay')
    if raw is None:
        raw = cfg.get('lineMinDay')
    if raw is None:
        raw = 1
    return min(max(1, raw), nd)


def marker_rule_cfg(rule, period_hrs, n_days):
    """markerRules.svelte.js ruleCfg: a rule seen as a block's settings. The fixed pair is
    stored on the rule as (fixedTau, fixedTheta) and re-encoded here as the block's
    (fitSlope, fitIntercept) with intercept = theta - (tau - P) * refDay; tau defaults to P
    when only theta is fixed, which decodes back to exactly theta. The range always scopes
    the fit (Decision 1a)."""
    r = marker_rule_from_json(rule)
    cfg = {k: r[k] for k in ('type', 'templateHrsBefore', 'templateHrsAfter',
                             'centileThreshold', 'lockTau', 'lockTheta', 'phaseRefDay',
                             'lineMinDay', 'lineMaxDay')}
    cfg['fitWithinRange'] = True
    P = period_hrs
    if r['fixedTau'] is not None:
        cfg['fitSlope'] = r['fixedTau']
    else:
        cfg['fitSlope'] = P if r['fixedTheta'] is not None else None
    if r['fixedTheta'] is None:
        cfg['fitIntercept'] = None
    else:
        slope = r['fixedTau'] if r['fixedTau'] is not None else P
        cfg['fitIntercept'] = r['fixedTheta'] - (slope - P) * _fit_ref_day(cfg, n_days)
    return cfg


def _rule_store(series, rule_id):
    """A series' per-rule data as ruleDataFromJSON reads it (Actogram.svelte)."""
    entry = (series.get('ruleData') or {}).get(rule_id)
    if not isinstance(entry, dict):
        return {'selectedPeriods': [], 'manualMarkers': []}
    sp = entry.get('selectedPeriods')
    mm = entry.get('manualMarkers')
    return {
        'selectedPeriods': [v is not False for v in sp] if isinstance(sp, list) else [],
        'manualMarkers': [v for v in mm if _finite(v)] if isinstance(mm, list) else [],
    }


def _block_store(json_block, frame):
    """An own block's per-series data as its constructor reads it (PhaseMarker.svelte)."""
    j = json_block or {}
    if isinstance(j.get('selectedPeriods'), list):
        sp = list(j['selectedPeriods'])
    elif j.get('periodRangeMin') is not None and j.get('periodRangeMax') is not None:
        keys = [k for k in frame['xByPeriod'] if _finite(k)]
        n = max(keys) + 1 if keys else 0
        if n > 20000:
            n = 0
        sp = [j['periodRangeMin'] <= i + 1 <= j['periodRangeMax'] for i in range(n)]
    else:
        sp = []
    mm = [] if j.get('type') == 'fitline' else list(_js_or(j.get('manualMarkers'), []))
    return {'selectedPeriods': sp, 'manualMarkers': mm}


def _manual_markers_by_row(manual, period_hrs):
    """PhaseMarkerClass.markers for a 'manual' block: hand-placed absolute times grouped by
    row (the LAST point in a row wins), hour = time % P in JS remainder semantics."""
    by_row = {}
    for t in manual:
        row = math.floor(t / period_hrs)
        by_row[row] = _js_mod(t, period_hrs)
    max_row = max([-1] + list(by_row.keys()))
    return [by_row.get(i, float('nan')) for i in range(max_row + 1)]


def marker_block_compute(cfg, store, frame, period_hrs, n_days):
    """Everything PhaseMarkerClass derives for one block (own block or rule instance) on
    one series: detections, absolute times, the fit selection, the unwrap, the line, the
    phase and the harmonic check."""
    P = period_hrs
    if cfg['type'] == 'manual':
        markers = _manual_markers_by_row(store['manualMarkers'], P)
        times = None
    else:
        tm = match_template_markers(frame['xByPeriod'], frame['yByPeriod'], P,
                                    frame['binSize'], cfg['templateHrsBefore'],
                                    cfg['templateHrsAfter'], cfg['centileThreshold'],
                                    cfg['type'])
        markers = tm['hours']
        times = tm['times'] if cfg['type'] in ('onset', 'offset') else None
    marker_times = marker_absolute_times(markers, P, times)
    scope = dict(range_scopes_fit=bool(cfg.get('fitWithinRange')),
                 line_min_day=cfg.get('lineMinDay'), line_max_day=cfg.get('lineMaxDay'))
    mask = selection_mask(len(markers), store['selectedPeriods'], **scope)
    unwrap = unwrap_onsets(marker_times, P, mask)
    ref_day = _fit_ref_day(cfg, n_days)
    fit_slope, fit_intercept = cfg.get('fitSlope'), cfg.get('fitIntercept')
    tau_value = fit_slope
    theta_value = None if (fit_slope is None or fit_intercept is None) \
        else (fit_slope - P) * ref_day + fit_intercept
    res = fit_line(unwrap['xs'], unwrap['ys'],
                   tau=tau_value if cfg['lockTau'] == 'fixed' else None,
                   theta=theta_value if cfg['lockTheta'] == 'fixed' else None,
                   ref_day=ref_day, period_hrs=P)
    reg = res if (math.isfinite(res['slope']) and math.isfinite(res['intercept'])) else None
    phase = None
    if reg is not None and reg['slope']:
        y_pred = reg['slope'] * ref_day + reg['intercept']
        phase = wrap_phase_to_row(y_pred - ref_day * P, reg['slope'], P)
    fitted_slope = reg['slope'] if reg is not None else None
    hc = harmonic_check(frame['hoursSinceStart'], frame['y'], frame['binSize'], fitted_slope)
    return {
        'markerHours': markers,
        'markerTimes': marker_times,
        'selectedMask': mask,
        'outsideRange': [is_outside_fit_range(i, **scope) for i in range(len(markers))],
        'unwrap': unwrap,
        'refDay': ref_day,
        'fitSlope': fit_slope,
        'fitIntercept': fit_intercept,
        'regression': reg,
        'phase': phase,
        'harmonic': None if hc is None else {
            'candidates': [{'label': c['label'], 'period': c['period'],
                            'peakPeriod': c['peakPeriod'], 'power': c['power'],
                            'eligible': c['eligible'],
                            'testF': (c['test']['F'] if c.get('test') else None),
                            'testP': (c['test']['pValue'] if c.get('test') else None)}
                           for c in hc['candidates']],
            'strongest': hc['strongest']['label'],
            'powerStrongest': hc['powerStrongest']['label']},
        '_harmonicPick': None if hc is None else hc['strongest']['peakPeriod'],
    }


def rule_output_values(block):
    """plotMetricDefs.js ruleOutputValues: a block's five port values. tau is the harmonic
    pick; tau/phi/r2/rmse are NaN with no valid line (r2/rmse also with no markers to compare
    against); n is always the count of fitted markers; no block at all is five NaNs."""
    nan = float('nan')
    if block is None:
        return {'tau': nan, 'phi': nan, 'r2': nan, 'rmse': nan, 'n': nan}
    reg = block['regression']
    ok = reg is not None

    def nn(v):
        return nan if v is None else v
    return {
        'tau': nn(block['_harmonicPick']) if ok else nan,
        'phi': nn(block['phase']) if ok else nan,
        'r2': nn(reg['rSquared']) if ok else nan,
        'rmse': nn(reg['rmse']) if ok else nan,
        'n': len(block['unwrap']['xs']),
    }


def actogram_marker_rule_outputs(rule, series, frame, period_hrs=24, n_days=None,
                                 details=False):
    """The five outputs (tau, phi, r2, rmse, n) one marker rule gives one series, exactly as
    the app's `r<id>_*` ports carry them. `rule` is MarkerRule.toJSON's shape; `series` is
    the series' saved JSON (its `ruleData`, `detachedRules`, `phaseMarkers`); `frame` is that
    series folded at the plot's startTime (actogram_series_frame). A series detached from the
    rule reports its own block that carries `fromRule` (computed with ITS settings); a
    detached series with no such block reports five NaNs. With details=True the result also
    carries every intermediate under 'details' and where the block came from ('source')."""
    if n_days is None:
        n_days = actogram_ndays([frame])
    rid = rule.get('id')
    detached = rid in (series.get('detachedRules') or [])
    block = None
    source = 'none'
    if not detached:
        block = marker_block_compute(marker_rule_cfg(rule, period_hrs, n_days),
                                     _rule_store(series, rid), frame, period_hrs, n_days)
        source = 'instance'
    else:
        for bj in series.get('phaseMarkers') or []:
            if isinstance(bj, dict) and bj.get('fromRule') == rid:
                block = marker_block_compute(marker_block_from_json(bj), _block_store(bj, frame),
                                             frame, period_hrs, n_days)
                source = 'detached'
                break
    out = rule_output_values(block)
    if details:
        d = {} if block is None else {k: v for k, v in block.items() if k != '_harmonicPick'}
        out = {'source': source, 'outputs': dict(out), **d}
    return out


def actogram_plot_rule_outputs(inner, series_data, zone='utc'):
    """Every marker rule's outputs for a whole actogram, as the app's metric columns carry
    them: {'startTime', 'Ndays', 'series': [{'binSize', 'rules': {id: details}}],
    'columns': {'r1_tau': [one value per series], ...}}. `inner` is the actogram's saved
    inner JSON (periodHrs, markerRules, data[i] with ruleData/detachedRules/phaseMarkers);
    `series_data[i]` is {'xType', 'x', 'y'} with x as the column's values (epoch ms for a
    time column, hours otherwise) and y the values."""
    # Actogram fromJSON: `json.periodHrs ?? 24`.
    P = inner.get('periodHrs') if inner.get('periodHrs') is not None else 24
    start = actogram_start_time(series_data, zone)
    frames = [actogram_series_frame(s.get('x') or [], s.get('y') or [], s.get('xType'), start, P,
                                    s.get('rawBinStart0'), s.get('originTime_ms'))
              for s in series_data]
    n_days = actogram_ndays(frames)
    rules = inner.get('markerRules') or []
    datas = inner.get('data') or []
    out_series = []
    columns = {}
    for r in rules:
        for suffix in ('tau', 'phi', 'r2', 'rmse', 'n'):
            columns[f"{r.get('id')}_{suffix}"] = []
    for i, frame in enumerate(frames):
        sj = datas[i] if i < len(datas) else {}
        per = {}
        for r in rules:
            det = actogram_marker_rule_outputs(r, sj, frame, P, n_days, details=True)
            per[r.get('id')] = det
            for suffix, v in det['outputs'].items():
                columns[f"{r.get('id')}_{suffix}"].append(v)
        out_series.append({'binSize': frame['binSize'], 'rules': per})
    return {'startTime': start, 'Ndays': n_days, 'series': out_series, 'columns': columns}
