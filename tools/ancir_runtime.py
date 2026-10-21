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
import warnings as _warnings
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
    # sqrt(SSres / n): the RMSE every other fit reports, comparable with them (the `rmse_n`
    # port; cosinor.js RMSE_n). `rmse` above stays the residual SE (FIT-15).
    rmse_n = math.sqrt(rss / n)  # n > p >= 1 here (df_resid > 0 above)
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
        'R2': float(r2), 'RMSE': rmse, 'RMSE_n': rmse_n,
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


# periodogram.js LS_DEGENERATE_BASIS: a basis whose spread about its mean is at most this
# fraction of n is constant up to rounding.
LS_DEGENERATE_BASIS = 1e-12


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
        # periodogram.js: each term on its own guard. A basis that is constant over the
        # samples (spread about its own mean at most LS_DEGENERATE_BASIS of n; a period equal
        # to the sampling interval puts every sample at one phase, making one basis 0 and the
        # other +-1) carries nothing, so its term is left out; the other term still counts.
        # Both terms used to be dropped when either denominator was 0.
        n_ = len(t)
        min_spread = LS_DEGENERATE_BASIS * n_
        c_var = den1 - float(cwt.sum()) ** 2 / n_ > min_spread
        s_var = den2 - float(swt.sum()) ** 2 / n_ > min_spread
        p = ((num1 / den1 if c_var and den1 > 0 else 0.0)
             + (num2 / den2 if s_var and den2 > 0 else 0.0))
        p = p / (2 * var)
        powers[k] = p if math.isfinite(p) else 0.0
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


def periodogram_peak_index(res, candidates=None):
    """periodogram.js periodogramPeakIndex (SPEC-9): for Chi-squared (any finite threshold) the
    period with the largest Qp - threshold, else the largest power; a non-positive or
    non-finite power is never a peak (ROB-13). -1 when there is none."""
    y = res.get('y') or []
    thr = res.get('threshold') or []
    idxs = list(range(len(y))) if candidates is None else list(candidates)
    use_excess = any(i < len(thr) and _finite(thr[i]) for i in idxs)
    best, best_score = -1, -math.inf
    for i in idxs:
        v = y[i]
        if not (_finite(v) and v > 0):
            continue
        score = v - thr[i] if use_excess else v
        if use_excess and not _finite(score):
            continue
        if best < 0 or score > best_score:
            best, best_score = i, score
    return best


def peak_familywise_p(res, idx):
    """periodogram.js peakFamilywiseP (SPEC-6): 1 - (1 - p)^M at the peak, M the number of
    folds with a statistic; NaN without a chi-squared p (Lomb-Scargle, Enright)."""
    pv = res.get('pvalue') or []
    M = sum(1 for v in pv if _finite(v))
    if not M or idx < 0 or not _finite(pv[idx]):
        return float('nan')
    df = (res.get('df') or [None] * len(pv))[idx]
    q = (res.get('y') or [None] * len(pv))[idx]
    p = float(sp_stats.chi2.sf(q, df)) if (_finite(df) and _finite(q)) else pv[idx]
    return float(-math.expm1(M * math.log1p(-min(1.0, max(0.0, p)))))


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
    """trendfit.js _fitTrendInternal. The linear, exponential and logarithmic models go
    through the app's own regression (wrangleData.js linearRegression, raw compensated
    sums: kahan_linear_regression), so a single point gives a NaN slope and a constant y a
    NaN linear R2, as in the app (the centred numpy fit gave 0 for both). The RMSE is
    sqrt(sum((y - fitted)^2) / n) from the fitted values, as _fitTrendInternal computes it."""
    xa = _to_float_arr(x); ya = _to_float_arr(y)

    def _rmse(fitted):
        return math.sqrt(sum((float(yi) - fi) ** 2 for yi, fi in zip(ya, fitted)) / xa.size)

    def _r2(fitted):
        # trendfit.js _computeRSquared: NaN on a non-finite total, 0 when y is constant.
        fa = np.asarray(fitted, dtype=float)
        rss = float(((ya - fa) ** 2).sum())
        ss_tot = float(((ya - ya.mean()) ** 2).sum())
        if not math.isfinite(ss_tot):
            return float('nan')
        return 1 - rss / ss_tot if ss_tot > 0 else 0.0

    if model == 'linear':
        reg = kahan_linear_regression(xa.tolist(), ya.tolist())
        fitted = [reg['slope'] * xi + reg['intercept'] for xi in xa.tolist()]
        return {'parameters': {'slope': reg['slope'], 'intercept': reg['intercept']},
                'fitted': fitted, 'rmse': _rmse(fitted), 'rSquared': reg['rSquared']}
    if model == 'exponential':
        reg = kahan_linear_regression(xa.tolist(), np.log(ya).tolist())
        with np.errstate(over='ignore', invalid='ignore'):  # JS Math.exp overflows to Infinity
            a = float(np.exp(reg['intercept']))
            b = reg['slope']
            fitted = (a * np.exp(b * xa)).tolist()
        return {'parameters': {'a': a, 'b': b}, 'fitted': fitted,
                'rmse': _rmse(fitted), 'rSquared': _r2(fitted)}
    if model == 'logarithmic':
        reg = kahan_linear_regression(np.log(xa).tolist(), ya.tolist())
        a = reg['intercept']; b = reg['slope']
        fitted = [a + b * math.log(xi) for xi in xa.tolist()]
        return {'parameters': {'a': a, 'b': b}, 'fitted': fitted,
                'rmse': _rmse(fitted), 'rSquared': _r2(fitted)}
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
    # The name the app SHOWS for this column (a node output's label, "Residuals: y" for
    # `resid_191_15`), when the exporter supplied one; plot legends use it. `name` stays the
    # stored identity (columns.csv headers, references). See _display_name.
    label: str | None = None

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


def apply_output_pre_processes(values, args, cols_index):
    """The `preProcesses` of BinnedData, Cosinor, FitFunction, DoubleLogistic,
    RectangularWave and TrendFit: after every series is fitted (or binned), each column
    process in order runs on that series' OUTPUT curve (the binned y; the fitted y at the
    output x), and nothing else. The x output, the residuals and every scalar metric are
    left as they were (the app computes them from the fit, not from the processed curve).
    An entry with no processName is skipped, as in the app."""
    out = list(values)
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        out = list(run_column_process(name.lower().replace(' ', ''), out,
                                      pp.get('processArgs') or {}, cols_index))
    return out


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


def _input_label(args, cols, cid):
    """The name a node writes into an output column as DATA for input column `cid` (the
    `variable` of Describe data and Normality test, Correlation's `var_i`/`var_j`, Logistic
    regression's `term`). The app writes the column's DISPLAY name ("Residuals: y" for
    `resid_191_15`) and bakes it into the node's args as `_inputLabels` ({id: label}), because
    working out a node output's label needs the app's label tables. Without a baked label (a
    session saved before the app baked them) this is the stored name, as the app wrote then."""
    baked = args.get('_inputLabels')
    if isinstance(baked, dict):
        label = baked.get(str(cid))
        if isinstance(label, str) and label != '':
            return label
    col = cols.get(cid)
    name = col.name if col is not None else None
    return name if name else str(cid)


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


def _fit_param_count(model, o):
    """Free-parameter count of a waveform fit under its options (utils/fitMinPoints.js
    fitModelParameters): cosinor fixed 1 + 2 per harmonic, free 1 + 3 per curve;
    rectangular 3 + steepness, period and duty cycle unless fixed; double logistic 4 +
    k1 and k2 unless fixed + the period when periodic and not fixed. None for another model."""
    def pos_int(v):
        try:
            n = int(float(v))
        except (TypeError, ValueError):
            n = 0
        return max(1, n or 1)
    if model == 'cosinor':
        if o.get('useFixedPeriod'):
            return 1 + 2 * pos_int(o.get('nHarmonics'))
        return 1 + 3 * pos_int(o.get('Ncurves'))
    if model == 'rectangular':
        return 3 + sum(0 if o.get(k) else 1 for k in ('fixKappa', 'fixOmega', 'fixDutyCycle'))
    if model == 'doublelogistic':
        periodic = o.get('periodic', True)
        periodic = True if periodic is None else periodic
        free_period = bool(periodic) and not o.get('fixPeriod')
        return (4 + (0 if o.get('fixK1') else 1) + (0 if o.get('fixK2') else 1)
                + (1 if free_period else 0))
    return None


def _fit_min_points(model, o):
    """Fewest rows with both x and y a waveform fit can be fitted to: parameters + 1
    (utils/fitMinPoints.js fitMinPoints, the Cosinor and Fit waveform model rule)."""
    n = _fit_param_count(model, o)
    return 0 if n is None else n + 1


def _cosinor_min_points(use_fixed, n_harmonics, n_curves):
    """Fewest rows with both x and y a cosinor can be fitted to: parameters + 1.
    Fixed period: 1 + 2 per harmonic; free period: 1 + 3 per curve."""
    return _fit_min_points('cosinor', {'useFixedPeriod': use_fixed,
                                       'nHarmonics': n_harmonics, 'Ncurves': n_curves})


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
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    # Column or sequence output x (resolve_output_x, outputXSequence.js).
    origin_ms, output_x_data = resolve_output_x(x_col, args, cols)
    phase_ref = node_phase_reference(args, x_col)

    metrics_by_y = {}
    any_valid = False
    curves = {}
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        # Too few rows with both x and y for the model (p parameters need p + 1 points):
        # no fit, as the JS node (cosinorTooFewPointsWarning in Cosinor.svelte).
        if len(tt) < _cosinor_min_points(use_fixed, n_h, n_curves):
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
        # Residuals (Cosinor.svelte writeCosinorOutputs): written only with the x output
        # wired, the model evaluated at every input x (fixed period: the full model, mesor
        # included, v82.11).
        resid_id = _out_id(args, f'resid_{y_id}')
        if resid_id != -1 and _out_id(args, 'cosinorx') != -1:
            model_params = ({**fixed_res, 'period': fixed_period} if use_fixed
                            else free_res['parameters'])
            _set_col(raw_data, cols, resid_id,
                     _fit_residuals(lambda xs, mp=model_params: evaluate_cosinor_at_points(mp, xs),
                                    t, y),
                     type_='number')
        # preProcesses on the fitted curve only (Cosinor.svelte, before writing).
        curves[y_id] = (xs, apply_output_pre_processes(ys, args, cols))
        any_valid = True

    # writeCosinorOutputs writes nothing without the x output wired. The x is the FIRST
    # y result's by Object.keys order (the smallest column id, _js_first_key), not the first
    # y wired; each y's curve is its own (its own valid x when no output x is set).
    if any_valid and _out_id(args, 'cosinorx') != -1:
        xs = curves[_js_first_key(curves)][0]
        x_out_ms = ([origin_ms + h * 3600000 for h in xs]
                    if origin_ms is not None else xs)
        _set_col(raw_data, cols, _out_id(args, 'cosinorx'), x_out_ms,
                 type_='time' if origin_ms is not None else 'number', time_format=None)
        for y_id, (_xs, ys) in curves.items():
            y_out_id = _out_id(args, f'cosinory_{y_id}')
            if y_out_id == -1:
                y_out_id = _out_id(args, 'cosinory')
            _set_col(raw_data, cols, y_out_id, ys, type_='number')
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
            # The shared x is the LONGEST y's bins (each y's uniform bins are a prefix of it).
            if bins_x is None or len(b['bins']) > len(bins_x):
                bins_x = b['bins']
            y_results[y_id] = b['y_out']
    x_out = _out_id(args, 'binnedx')
    if bins_x is None:
        return False
    for y_id, ys in y_results.items():  # pad to the shared x with NaN (an empty bin)
        if len(ys) < len(bins_x):
            y_results[y_id] = list(ys) + [float('nan')] * (len(bins_x) - len(ys))
    # preProcesses on each padded binned y (BinnedData.svelte, before writing); the bins
    # (x) are not processed.
    for y_id in list(y_results):
        y_results[y_id] = apply_output_pre_processes(y_results[y_id], args, cols)
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
    # Column or sequence output x (resolve_output_x, outputXSequence.js).
    origin_ms, output_x_data = resolve_output_x(x_col, args, cols)
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
        # preProcesses on the fitted curve only (DoubleLogistic.svelte); the curves are
        # written only with the x output wired (writeXOutput gates them in the app).
        if _out_id(args, 'dlogx') != -1:
            _set_col(raw_data, cols, y_out, apply_output_pre_processes(ys, args, cols),
                     type_='number')
        # Residuals (DoubleLogistic.svelte): only with the x output wired; the periodic model
        # evaluated at every input x.
        resid_id = _out_id(args, f'resid_{y_id}')
        if resid_id != -1 and _out_id(args, 'dlogx') != -1:
            _set_col(raw_data, cols, resid_id,
                     _fit_residuals(lambda xs, pr=res['parameters']:
                                    evaluate_dl_at_points(pr, xs, True), t, y),
                     type_='number')
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

def _cell_missing_rule(col_type):
    """The missing-cell rule LongToWide and WideToLong apply to a column of this type: the
    house rule (isInvalidValue) everywhere except a category column, whose cells are labels
    (isMissingCategory: null, blank or whitespace-only text, NaN)."""
    return _is_missing_category if col_type == 'category' else _js_invalid


def _js_sort_key_cmp(a, b):
    """JS `(a, b) => a - b` as a comparator: NaN (a non-numeric key) compares as equal, so a
    stable sort keeps first-appearance order there, as V8's does."""
    d = _js_number(a) - _js_number(b)
    if math.isnan(d) or d == 0:
        return 0
    return -1 if d < 0 else 1


def tp_longtowide(args, cols, raw_data, _sv):
    """Port of LongToWide.svelte evaluateLongToWide + writeLongToWideOutputs.

    Args are the app's own: categoryIN, timeIN, valueIN (the node never had any other names).
    - A row whose time is missing (the time column's missing rule) is dropped.
    - Categories in order of first appearance; a missing label (isMissingCategory) is none.
    - The time column is the union of the kept times (exact values), sorted ascending.
    - value_<category> holds, per union time, the value of the LAST row with that category
      and time (a repeated time is not averaged); NaN where the category has no such row.
      A missing value is kept as it is, so it reads as a blank cell.
    - The pre-processes run on each category's values before writing, in order.
    """
    cat_in = args.get('categoryIN', -1)
    time_in = args.get('timeIN', -1)
    val_in = args.get('valueIN', -1)
    for cid in (cat_in, time_in, val_in):
        if cid is None or cid == -1 or cid not in cols:
            return False
    cat_data = list(cols[cat_in].get_data())
    time_col = cols[time_in]
    time_data = list(time_col.get_data())
    val_data = list(cols[val_in].get_data())
    time_missing = _cell_missing_rule(time_col.type)

    union, seen_t = [], set()
    for i, t in enumerate(time_data):
        if time_missing(t) or t in seen_t:
            continue
        seen_t.add(t)
        union.append(t)
    union.sort(key=functools.cmp_to_key(_js_sort_key_cmp))

    categories, seen_c = [], set()
    for c in cat_data:
        if _is_missing_category(c) or c in seen_c:
            continue
        seen_c.add(c)
        categories.append(c)

    cat_time = {c: {} for c in categories}
    for i, c in enumerate(cat_data):
        if i >= len(time_data) or time_missing(time_data[i]) or c not in cat_time:
            continue
        cat_time[c][time_data[i]] = val_data[i] if i < len(val_data) else None
    if not union:
        return False

    nan = float('nan')
    result = {c: [cat_time[c].get(t, nan) for t in union] for c in categories}
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        for c in categories:
            result[c] = list(run_column_process(name.lower().replace(' ', ''), result[c],
                                                pp.get('processArgs') or {}, {}))

    t_id = _out_id(args, 'time')
    if t_id == -1:
        return True
    # The app stores the input's raw time text (with its format) when it can, else epoch ms
    # with the format cleared; both read back as the same epoch ms, which is what is stored here.
    _set_col(raw_data, cols, t_id, union, type_=time_col.type)
    if t_id in cols:
        cols[t_id].time_format = None
    val_type = cols[val_in].type
    for c in categories:
        _set_col(raw_data, cols, _out_id(args, f'value_{_js_string(c)}'), result[c],
                 type_=val_type)
    return True


# --- WideToLong ---

def tp_widetolong(args, cols, raw_data, _sv):
    """Port of WideToLong.svelte widetolong. One block of rows per value column (in the
    selected order, duplicates and negative ids ignored), its rows to the shorter of the two
    lengths; a row is dropped when its time or its cell is missing by its column's rule
    (_cell_missing_rule). The category is the value column's display name (baked
    `_inputLabels`, _input_label); the time output keeps the time column's type with no text
    format, the value output the FIRST value column's type."""
    x_in = args.get('timeIN', args.get('xIN', -1))
    y_ins = []
    for v in _id_list(args.get('valueColIds', args.get('yIN'))):
        n = _js_number(v)
        if not math.isnan(n) and n >= 0 and int(n) not in y_ins:
            y_ins.append(int(n))
    if x_in is None or x_in == -1 or x_in not in cols or not y_ins:
        return False
    time_col = cols[x_in]
    time_data = list(time_col.get_data())
    time_missing = _cell_missing_rule(time_col.type)
    times, cats, vals = [], [], []
    for y_id in y_ins:
        if y_id not in cols:
            return False
        y_col = cols[y_id]
        y_data = list(y_col.get_data())
        cell_missing = _cell_missing_rule(y_col.type)
        # The app writes the value column's DISPLAY name and bakes it as `_inputLabels`
        # (WideToLong.svelte, core/columnLabels.js bakeInputLabels); else the stored name.
        label = _input_label(args, cols, y_id)
        for xi, yi in zip(time_data, y_data):
            if time_missing(xi) or cell_missing(yi):
                continue
            times.append(xi)
            cats.append(label)
            vals.append(yi)
    # Each output is written when wired (the app's three are always wired together).
    t_id, c_id, v_id = (_out_id(args, k) for k in ('time', 'category', 'value'))
    _set_col(raw_data, cols, t_id, times, type_=time_col.type)
    if t_id in cols:
        cols[t_id].time_format = None
    _set_col(raw_data, cols, c_id, cats, type_='category')
    _set_col(raw_data, cols, v_id, vals, type_=cols[y_ins[0]].type)
    return len(times) > 0


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
    # Column or sequence output x (resolve_output_x, outputXSequence.js).
    origin_ms, output_x_data = resolve_output_x(x_col, args, cols)
    curves = {}
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
        # preProcesses on the fitted curve only (RectangularWave.svelte).
        curves[y_id] = (xs_out, apply_output_pre_processes(ys, args, cols))
        # Residuals (RectangularWave.svelte): only with the x output wired; the model
        # evaluated at every input x.
        resid_id = _out_id(args, f'resid_{y_id}')
        if resid_id != -1 and _out_id(args, 'rectwavex') != -1:
            _set_col(raw_data, cols, resid_id,
                     _fit_residuals(lambda xs, pr=res['parameters']:
                                    evaluate_rectwave_at_points(pr, xs), t, y),
                     type_='number')
        stats_by_y[y_id] = res
        any_valid = True
    # RectangularWave.svelte writes the x, the curves and the metric ports only with the x
    # output wired; the x is the first y result's by Object.keys order (smallest column id).
    if any_valid and _out_id(args, 'rectwavex') != -1:
        first_xs = curves[_js_first_key(curves)][0]
        if origin_ms is not None:
            _set_col(raw_data, cols, _out_id(args, 'rectwavex'),
                     [origin_ms + h * 3600000 for h in first_xs], type_='time')
        else:
            _set_col(raw_data, cols, _out_id(args, 'rectwavex'), first_xs, type_='number')
        for y_id, (_xs, ys) in curves.items():
            y_out = _out_id(args, f'rectwavey_{y_id}')
            if y_out == -1:
                y_out = _out_id(args, 'rectwavey')
            _set_col(raw_data, cols, y_out, ys, type_='number')
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
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    any_valid = False
    stats_by_y = {}
    per_key_by_y = []
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
            per_key = {'period': xs, 'power': ys}
            if pg.get('threshold') is not None:
                per_key['threshold'] = list(pg['threshold'])
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
            per_key = {'frequency': xs, 'period': periods, 'magnitude': ys,
                       'phase': fft['phases']}
            xs = periods  # the primary x (getPrimaryKeys: period, magnitude)
        elif analysis == 'correlogram':
            ac = compute_autocorrelation(
                t, y,
                min_lag=float(args.get('corrMinLag', 0.0)),
                max_lag=args.get('corrMaxLag') or None)
            xs, ys = ac['lags'], ac['correlations']
            per_key = {'lag': xs, 'correlation': ys}
        else:
            per_key = None
        if per_key is not None:
            per_key_by_y.append((y_id, per_key))
        # The scalar stats (the `stat_<key>` metric ports): the peak by the app's rules.
        st = {}
        if analysis == 'periodogram':
            # Largest Qp - threshold for Chi-squared (SPEC-9); no positive power is no peak.
            i_ = periodogram_peak_index(pg)
            if i_ >= 0:
                st = {'peak_period': pg['x'][i_], 'peak_power': pg['y'][i_]}
                if args.get('pgMethod') == 'Chi-squared':
                    st['peak_pvalue'] = peak_familywise_p(pg, i_)
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
    # The node's preProcesses (RhythmicityAnalysis.svelte, after every y is analysed): each
    # column process in order, on EVERY output array of every y (the x arrays such as
    # period, frequency and lag included), before anything is written. The stats above are
    # taken from the unprocessed arrays, as in the app. The app skips a process it cannot
    # find; the runtime's own lookup decides here (strict by default).
    for pp in args.get('preProcesses') or []:
        name = (pp or {}).get('processName')
        if not name:
            continue
        for _y, per_key in per_key_by_y:
            for k in list(per_key):
                per_key[k] = list(run_column_process(name.lower().replace(' ', ''),
                                                     per_key[k],
                                                     pp.get('processArgs') or {}, cols))
    # RhythmicityAnalysis.svelte writes EVERY wired output: one column per (y, key), and
    # the shared primary pair (rhythmicityx from the first y with output, rhythmicityy_<y>;
    # getPrimaryKeys). The ports used to write one family or the other on an
    # args.hideInputs that the app never saves (it is a component prop), so the primary
    # pair was empty in every exported session.
    px_key, py_key = {'periodogram': ('period', 'power'), 'fft': ('period', 'magnitude'),
                      'correlogram': ('lag', 'correlation')}.get(analysis, (None, None))
    shared_x = None
    for y_id, per_key in per_key_by_y:
        for k, v in per_key.items():
            _set_col(raw_data, cols, _out_id(args, f'{y_id}_{k}'), v, type_='number')
        xs, ys = per_key.get(px_key) or [], per_key.get(py_key) or []
        if shared_x is None and len(xs) > 0:
            shared_x = xs
            _set_col(raw_data, cols, _out_id(args, 'rhythmicityx'), xs, type_='number')
        _set_col(raw_data, cols, _out_id(args, f'rhythmicityy_{y_id}'), ys, type_='number')
    if any_valid:
        keys = {'periodogram': ['peak_period', 'peak_power'] +
                (['peak_pvalue'] if args.get('pgMethod') == 'Chi-squared' else []),
                'fft': ['peak_period', 'peak_frequency', 'peak_magnitude'],
                'correlogram': ['peak_lag', 'peak_correlation']}.get(analysis, [])
        for k in keys:
            _set_col(raw_data, cols, _out_id(args, f'stat_{k}'),
                     [stats_by_y.get(y, {}).get(k, float('nan')) for y in y_ins],
                     type_='number')
    return any_valid


# --- SequenceColumn ---

# SequenceColumn.svelte MAX_SEQUENCE_LENGTH: the longest sequence (a guard against a mistyped
# count). Past it nothing is made and the same warning as the app's is printed.
MAX_SEQUENCE_LENGTH = 2_000_000


def sequence_limit_warning(count):
    """SequenceColumn.svelte sequenceLimitWarning: the warning text, or None when it fits."""
    if not count > MAX_SEQUENCE_LENGTH:
        return None
    return (f'Nothing was made: {count:,} values is more than the limit of '
            f'{MAX_SEQUENCE_LENGTH:,}. Lower the count, or use a larger step '
            f'for the same start and end.')


def sequence_limit(_unused, count):
    """Parity probe for the sequence limit: allowed (1/0) and the warning ('' if none)."""
    w = sequence_limit_warning(count)
    return {'allowed': 0 if w else 1, 'warning': w or ''}


def tp_sequencecolumn(args, cols, raw_data, _sv):
    kind = args.get('seqType', args.get('kind', 'number'))
    n = int(args.get('count', args.get('rows', 100)))
    too_long = sequence_limit_warning(n)
    if too_long:
        # The app shows this on the node and empties the output.
        print(f'WARNING: Sequence Column: {too_long}', file=sys.stderr)
        return False
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
    """residualSupport.js residualColumn: raw - predicted, NaN where either side is missing.
    Aligned to y; a y row beyond the end of x reads x as undefined (missing), as in JS."""
    out = []
    for i, v in enumerate(y_full):
        p_i = predicted[i] if i < len(predicted) else None
        x_bad = x_full is not None and (i >= len(x_full) or _js_invalid(x_full[i]))
        bad = _js_invalid(v) or x_bad or not _finite(p_i)
        out.append(float('nan') if bad else _js_number(v) - p_i)
    return out


def _fit_residuals(evaluate, x_full, y_full):
    """The fit nodes' resid_<yId> column (residualSupport.js writeResidual / FitFunction's
    residualColumn): the fitted model evaluated at EVERY input x (in the fit's hour frame),
    then observed - predicted, full input length, NaN wherever y or x is missing or the
    prediction is not finite. Only the valid x are handed to `evaluate`: the app evaluates
    the missing ones too, but residualColumn discards them, and the periodic double
    logistic's tile range is taken over the valid x either way (stats.js min/max skip
    missing values)."""
    nan = float('nan')
    x_full = list(x_full if x_full is not None else [])
    idx = [i for i, v in enumerate(x_full) if not _js_invalid(v)]
    pts = [_js_number(x_full[i]) for i in idx]
    predicted = [nan] * len(x_full)
    if pts:
        for i, pv in zip(idx, evaluate(pts)):
            predicted[i] = pv
    return _residual_column(predicted, list(y_full), x_full)


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

def _js_first_key(d):
    """Object.keys(obj)[0] in JS: integer-like keys come first in ASCENDING numeric order,
    whatever order they were inserted in, so a node that takes "the first y result" this way
    takes the y with the smallest column id, not the first one wired."""
    ints = [k for k in d if isinstance(k, int) and not isinstance(k, bool) and k >= 0]
    return min(ints) if ints else next(iter(d))


def _trend_coef_keys(args):
    """TrendFit.svelte getCoefKeys: the coefficient ports of the chosen model."""
    model = args.get('model') or 'linear'
    if model == 'linear':
        return ['coef_slope', 'coef_intercept']
    if model in ('exponential', 'logarithmic'):
        return ['coef_a', 'coef_b']
    if model == 'polynomial':
        deg = args.get('polyDegree')
        deg = deg if isinstance(deg, (int, float)) and not isinstance(deg, bool) \
            and math.isfinite(deg) else 2
        return [f'coef_c{i}' for i in range(int(deg) + 1)]
    return []


def _trend_coef_value(key, model, parameters):
    """TrendFit.svelte coefValueForKey."""
    nan = float('nan')
    if not parameters:
        return nan
    if model == 'linear':
        v = parameters.get('slope') if key == 'coef_slope' else parameters.get('intercept')
    elif model in ('exponential', 'logarithmic'):
        v = parameters.get('a') if key == 'coef_a' else parameters.get('b')
    elif model == 'polynomial':
        i = int(key[len('coef_c'):])
        cs = parameters.get('coeffs') or []
        v = cs[i] if i < len(cs) else None
    else:
        v = None
    return nan if v is None else v


def _write_trend_metrics(args, cols, raw_data, y_ins, fits):
    """TrendFit.svelte writeTrendMetricOutputs: r2, rmse and the model's coefficients, one
    value per y input in yIN order, NaN for a y with no fit."""
    nan = float('nan')
    model = args.get('model') or 'linear'
    _set_col(raw_data, cols, _out_id(args, 'r2'),
             [fits[y]['rSquared'] if y in fits else nan for y in y_ins], type_='number')
    _set_col(raw_data, cols, _out_id(args, 'rmse'),
             [fits[y]['rmse'] if y in fits else nan for y in y_ins], type_='number')
    for k in _trend_coef_keys(args):
        _set_col(raw_data, cols, _out_id(args, k),
                 [_trend_coef_value(k, model, (fits.get(y) or {}).get('parameters'))
                  for y in y_ins], type_='number')


def tp_trendfit(args, cols, raw_data, _sv):
    """Port of TrendFit.svelte trendfit. Each y is fitted on its own valid (x, y) pairs; with
    no output x its curve is its OWN fitted values (one per valid pair), and the x output is
    the first fitted y's valid x, exactly as the app writes them (this port used to evaluate
    every y at the first y's x). The curve then goes through the node's preProcesses. The x,
    the curves, the residuals and the metric ports are written only with the x output wired.
    A y outside its model's domain (fitDomain.js) is refused; when every y is refused the app
    CLEARS the outputs (x, curves and residuals empty, every metric NaN), which this port now
    does too."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    model = args.get('model', 'linear')
    deg = int(args.get('polyDegree', 2))
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    # The output grid in the fit's hour frame and the origin (the input's minimum valid
    # time) that turns it back into timestamps (fit_time_frame, STAT-19).
    # Column or sequence output x (resolve_output_x, outputXSequence.js).
    origin_ms, output_x_data = resolve_output_x(x_col, args, cols)
    results = {}
    any_valid = False
    any_refused = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        idx = _js_valid_pairs(t, y)
        tt = [_js_number(t[i]) for i in idx]
        yy = [_js_number(y[i]) for i in idx]
        if not tt:
            continue
        if _trend_domain_refused(tt, yy, model, deg):
            any_refused = True
            continue
        res = fit_trend(tt, yy, model, deg)
        if res is None:
            continue
        x_out_data = output_x_data if output_x_data is not None else tt
        y_out_data = (evaluate_trend_at_points(res['parameters'], model, output_x_data)
                      if output_x_data is not None else list(res['fitted']))
        results[y_id] = {'fit': res, 'xOutData': x_out_data, 'yOutData': y_out_data,
                         'y': y}
        if res['fitted']:
            any_valid = True
    for r in results.values():
        r['yOutData'] = apply_output_pre_processes(r['yOutData'], args, cols)

    x_out = _out_id(args, 'trendx')
    fits = {y: r['fit'] for y, r in results.items()}
    if any_valid and x_out != -1:
        xs = results[_js_first_key(results)]['xOutData']
        _set_col(raw_data, cols, x_out,
                 [origin_ms + h * 3600000 for h in xs] if origin_ms is not None else xs,
                 type_='time' if origin_ms is not None else 'number')
        for y_id in y_ins:
            r = results.get(y_id)
            if r is None:
                continue
            y_out = _out_id(args, f'trendy_{y_id}')
            if y_out == -1:
                y_out = _out_id(args, 'trendy')
            _set_col(raw_data, cols, y_out, r['yOutData'], type_='number')
            # Residuals: the trend evaluated at every input x.
            resid_id = _out_id(args, f'resid_{y_id}')
            if resid_id != -1:
                _set_col(raw_data, cols, resid_id,
                         _fit_residuals(lambda pts, pr=r['fit']['parameters']:
                                        evaluate_trend_at_points(pr, model, pts), t, r['y']),
                         type_='number')
        _write_trend_metrics(args, cols, raw_data, y_ins, fits)
    if not any_valid and any_refused:
        # A refused fit must not leave a previous model's numbers in the ports: the app
        # blanks them (metrics NaN, x / curves / residuals empty) and says why.
        _write_trend_metrics(args, cols, raw_data, y_ins, {})
        _set_col(raw_data, cols, x_out, [], type_='number')
        for y_id in y_ins:
            _set_col(raw_data, cols, _out_id(args, f'trendy_{y_id}'), [], type_='number')
            _set_col(raw_data, cols, _out_id(args, f'resid_{y_id}'), [], type_='number')
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
    # sampleStats.js mean: `arr.reduce((a, b) => a + b, 0) / n`, a plain left-to-right sum.
    # Not sum(): from Python 3.12 sum() of floats is compensated (more precise), so it can
    # differ from the app in the last place.
    if not arr:
        return float('nan')
    s = 0.0
    for x in arr:
        s += x
    return s / len(arr)


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
    # JS `usable.reduce((acc, g) => acc + g.mean * g.n, 0)`: left to right, not sum() (see
    # _gc_mean). n_total is a sum of counts (integers), exact either way.
    weighted = 0.0
    for g in usable:
        weighted += g['mean'] * g['n']
    grand_mean = weighted / n_total
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
    # The app returns before writing the metric ports only when there is neither a group
    # column nor a multi-Y comparison (or no y at all).
    x_in = args.get('xIN')
    has_group = x_in is not None and x_in != -1 and x_in in cols
    if 'multiY' in result['comparisons'] or (has_group and _id_list(args.get('yIN'))):
        _gc_write_metrics(args, cols, raw_data, result)
    return any_valid


def _gc_write_metrics(args, cols, raw_data, result):
    """GroupComparison.svelte writeGroupComparisonMetrics: the scalar metric ports, one value
    per y input in yIN order (one value in the no-group multi-Y mode): the test's statistic
    (t / F / U / H), its p and the effect size that belongs with that test. Written whenever
    any of the three is wired, before validity is decided, as in the app."""
    ids = [_out_id(args, k) for k in ('statistic', 'pvalue', 'effectSize')]
    if all(i is None or i == -1 for i in ids):
        return
    nan = float('nan')

    def _num(v):
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def statistic_of(c):
        # JS comp?.t ?? comp?.f ?? comp?.u ?? comp?.h ?? NaN (null/undefined fall through).
        for k in ('t', 'f', 'u', 'h'):
            if c and c.get(k) is not None:
                return c[k]
        return nan

    def effect_of(c):
        if not c:
            return nan
        for k in ('cohenD', 'etaSquared', 'rEffect', 'epsilonSquared'):
            v = _num(c.get(k))
            if v is not None and math.isfinite(v):
                return v
        return nan

    comps = result.get('comparisons', {})
    if comps.get('multiY'):
        chosen = [comps['multiY']]
    else:
        chosen = [comps.get(y) for y in _id_list(args.get('yIN'))]
    stat = [statistic_of(c) for c in chosen]
    pv = [(c or {}).get('pValue', nan) if (c or {}).get('pValue') is not None else nan
          for c in chosen]
    eff = [effect_of(c) for c in chosen]
    for oid, vals in zip(ids, (stat, pv, eff)):
        _set_col(raw_data, cols, oid, vals, type_='number')


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
# preProcesses run on each fitted curve before it is written (apply_output_pre_processes);
# the permutation test is not ported (perm_pvalue is NaN, "not computed").

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
        # rmse_n (sqrt(SS/n)) beside the fixed-period fit's residual-SE rmse; fixed is the default.
        uf = args.get('useFixedPeriod')
        fixed = ['rmse_n'] if (True if uf is None else bool(uf)) else []
        return shared + fixed + ['period', 'mesor', 'amplitude', 'acrophase', 'amplitude_h1',
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
    if key == 'rmse_n':
        return (fr.get('fixedStats') or {}).get('RMSE_n', nan)
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


def _ff_min_points(model, args):
    """FitFunction.svelte tooFewPointsWarning: the model options as getModelOptions reads
    them (useFixedPeriod ?? true for the cosinor), then the shared parameters + 1 rule."""
    o = dict(args)
    uf = args.get('useFixedPeriod', True)
    o['useFixedPeriod'] = True if uf is None else uf
    return _fit_min_points(model, o)


def tp_fitfunction(args, cols, raw_data, _sv):
    """Port of FitFunction.svelte: the fit, the output curve (output x from the input's
    minimum time, STAT-19) and the scalar metric ports (phase reference FIT-9; overall
    multi-harmonic waveform FIT-13)."""
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    x_out = _out_id(args, 'fitx')
    model = args.get('model', 'cosinor')

    if x_in == -1 or x_in not in cols or not y_ins:
        return False

    t_col = cols[x_in]
    t = _t_for_col(t_col)
    # Column or sequence output x (resolve_output_x, outputXSequence.js).
    origin_ms, output_x_data = resolve_output_x(t_col, args, cols)
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
        # Too few rows for the model (p parameters need p + 1 points): no fit, as the JS
        # node (tooFewPointsWarning in FitFunction.svelte, utils/fitMinPoints.js).
        if len(tt) < _ff_min_points(model, args):
            continue
        fit_result = _ff_fit_curve_model(tt, yy, model, args)   # JS computeSingleFit
        if fit_result is None:
            continue
        predicted = (_ff_evaluate_at_points(fit_result, model, output_x_data)
                     if output_x_data is not None else None)
        y_out_data = predicted if predicted is not None else fit_result['fitted']
        x_out_data = output_x_data if output_x_data is not None else tt
        y_results[y_id] = {'fitResult': fit_result, 'xOutData': x_out_data,
                           'yOutData': y_out_data, 't': tt, 'y': y}
        if not t_ref:
            t_ref = tt
        if fit_result.get('fitted'):
            any_valid = True

    if any_valid and x_out != -1:
        first = y_results[_js_first_key(y_results)]
        x_out_data = first['xOutData'] or output_x_data or first['t']
        x_out_ms = ([origin_ms + h * 3600000 for h in x_out_data]
                    if origin_ms is not None else x_out_data)
        _set_col(raw_data, cols, x_out, x_out_ms,
                 type_='time' if origin_ms is not None else 'number', time_format=None)
        for y_id in y_ins:
            y_out = _out_id(args, f"fity_{y_id}")
            yr = y_results.get(y_id)
            if y_out is not None and y_out != -1 and yr:
                # preProcesses on the fitted curve only (FitFunction.svelte).
                _set_col(raw_data, cols, y_out,
                         apply_output_pre_processes(yr['yOutData'], args, cols), type_='number')
            # Residuals (FitFunction.svelte residualColumn): the model evaluated at every
            # input x, observed - predicted.
            resid_id = _out_id(args, f'resid_{y_id}')
            if resid_id != -1 and yr:
                _set_col(raw_data, cols, resid_id,
                         _fit_residuals(lambda pts, fr=yr['fitResult']:
                                        _ff_evaluate_at_points(fr, model, pts), t, yr['y']),
                         type_='number')
    # writeFitMetricOutputs runs inside the same `anyValid && xOUT !== -1` block.
    if any_valid and x_out != -1:
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
    'Crossing': 'crossing',
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
    'Join Data': 'joindata',
    'JoinData': 'joindata',
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
        rows['variable'].append(_input_label(args, cols, y_id))
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
        rows['variable'].append(_input_label(args, cols, y_id))
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
    names = [_input_label(args, cols, y) for y in y_ins]
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
    names = [_input_label(args, cols, x) for x in x_ins]
    res = logistic_regression(y, predictors, names)
    if not res or not res.get('coef'):
        # Too few complete rows: the app warns and writes nothing, and the node stays valid
        # (LogisticRegression.svelte returns [result, true]); this port used to return False.
        return True
    # The kernel returns PARALLEL ARRAYS (term/coef/se/...), not a list of term objects.
    coef, se = res['coef'], res['se']
    # Wald CI on the ODDS RATIO, matching logistic.js:164 — exp(coef +/- 1.96*se), and NaN
    # rather than a bogus interval when the standard error did not come back finite.
    z975 = 1.959963984540054
    ci_low = [_js_exp(c - z975 * s) if _isfinite(s) else float('nan')
              for c, s in zip(coef, se)]
    ci_high = [_js_exp(c + z975 * s) if _isfinite(s) else float('nan')
               for c, s in zip(coef, se)]
    _result_rows(raw_data, cols, args, {
        'term': res['term'], 'coef': coef, 'se': se, 'z': res['z'],
        'pvalue': res['pvalue'], 'oddsRatio': res['oddsRatio'],
        'ciLow': ci_low, 'ciHigh': ci_high})
    # Per-observation columns are a different LENGTH from the coefficient rows, so
    # they are written separately rather than as extra columns of the same table.
    for key in ('outcome', 'eta', 'fitted'):
        out_id = _out_id(args, key)
        if out_id != -1 and res.get(key) is not None:
            _set_col(raw_data, cols, out_id, res[key], type_='number')
    # A fitted model is a valid node whether or not any output is wired, as in the app.
    return True


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


# interpolate.js MAX_GRID_POINTS: the largest resample grid (a guard against a step in the
# wrong units). Past it nothing is resampled and the same warning as the app's is printed.
MAX_GRID_POINTS = 2_000_000


def _grid_point_count(start, end, step):
    """interpolate.js gridPointCount: points in makeGrid(start, end, step), 0 if invalid."""
    if not (_finite(start) and _finite(end) and _finite(step)) or step <= 0 or end < start:
        return 0
    return int(math.floor((end - start) / step + 1e-9)) + 1


def _readable_number(v):
    """interpolate.js readable: 6 significant figures (ties up, as JS toPrecision), never in
    exponent form, thousands separated."""
    import decimal
    d = decimal.Decimal(v)
    if d == 0:
        return '0'
    q = decimal.Decimal(1).scaleb(d.adjusted() - 5)
    d = d.quantize(q, rounding=decimal.ROUND_HALF_UP).normalize()
    text = format(d, 'f')
    whole, _, frac = text.partition('.')
    whole = f'{int(whole):,}' if whole not in ('', '-') else whole
    return f'{whole}.{frac}' if frac else whole


def grid_too_large_warning(start, end, step, unit='', max_points=MAX_GRID_POINTS,
                           lead='Nothing was resampled',
                           hint=', or a shorter start to end range'):
    """interpolate.js gridTooLargeWarning: the warning text, or None when the grid fits.
    `lead` says what was refused and `hint` is any other way out after the step."""
    count = _grid_point_count(start, end, step)
    if count <= max_points:
        return None
    need = (end - start) / (max_points - 1)
    mag = 10 ** (math.floor(math.log10(need)) - 1)
    min_step = math.ceil(need / mag - 1e-9) * mag
    return (f'{lead}: a step of {_readable_number(step)}{unit} over '
            f'{_readable_number(end - start)}{unit} gives {count:,} grid points, more than the '
            f'limit of {max_points:,}. Use a step of at least {_readable_number(min_step)}{unit}'
            f'{hint}.')


def interpolate_grid_limit(_unused, start, end, step, unit=''):
    """Parity probe for the resample-grid limit: the grid size and the warning ('' if none)."""
    return {'count': _grid_point_count(start, end, step),
            'warning': grid_too_large_warning(start, end, step, unit) or ''}


def _make_grid(start, end, step, max_points=MAX_GRID_POINTS):
    """interpolate.js makeGrid: start + i * step (no accumulated drift), end inclusive."""
    count = _grid_point_count(start, end, step)
    if count == 0 or count > max_points:
        return []
    return [start + i * step for i in range(count)]


# outputXSequence.js: "Specify output x values" > Sequence on the fitting nodes (Cosinor,
# RectangularWave, DoubleLogistic, FitFunction, TrendFit). From the minimum to the maximum of
# the x input's valid values in the fit's frame (hours since the earliest sample for a time x),
# every `outputXStep` (null or not positive: span / 500 snapped to the nearest 1-2-5 number on
# a log scale); the maximum is included when it lands on the grid, else the sequence stops at
# the last step below it. Over MAX_GRID_POINTS: no sequence (the fit at the input x) and the
# shared grid-limit warning.
OUTPUT_X_DEFAULT_POINTS = 500
OUTPUT_X_LIMIT_LEAD = 'No output x sequence was made (the fit is shown at the input x)'


def _output_x_specified(args):
    v = args.get('outputX', -1)
    return v is not None and v != -1


def _output_x_is_sequence(args):
    return _output_x_specified(args) and args.get('outputXMode') == 'sequence'


def nice_step(v):
    """outputXSequence.js niceStep: the nearest 1-2-5 number on a log scale, or None."""
    if not (isinstance(v, (int, float)) and math.isfinite(v) and v > 0):
        return None
    e = math.floor(math.log10(v))

    def scale(c, k):
        return c * 10 ** k if k >= 0 else c / 10 ** -k
    m = v / scale(1, e)
    if m < math.sqrt(2):
        c = 1
    elif m < math.sqrt(10):
        c = 2
    elif m < math.sqrt(50):
        c = 5
    else:
        c = 10
    return scale(1, e + 1) if c == 10 else scale(c, e)


def _output_x_range(values):
    """(lo, hi) of the finite numbers among `values`, or None without a span."""
    nums = []
    for v in values or []:
        if _js_invalid(v):
            continue
        n = _js_number(v)
        if math.isfinite(n):
            nums.append(n)
    if not nums:
        return None
    lo, hi = min(nums), max(nums)
    return (lo, hi) if hi > lo else None


def default_output_x_step(values):
    """outputXSequence.js defaultOutputXStep: span / 500, 1-2-5 snapped (None without span)."""
    r = _output_x_range(values)
    return nice_step((r[1] - r[0]) / OUTPUT_X_DEFAULT_POINTS) if r else None


def output_x_sequence(values, step, unit=''):
    """outputXSequence.js outputXSequence: {'values', 'step', 'warning'} (values None when no
    sequence is made)."""
    r = _output_x_range(values)
    if r is None:
        return {'values': None, 'step': None, 'warning': None}
    try:
        s = float(step) if step is not None and step != '' else _NAN
    except (TypeError, ValueError):
        s = _NAN
    if not (math.isfinite(s) and s > 0):
        s = default_output_x_step(values)
    if s is None or not s > 0:
        return {'values': None, 'step': None, 'warning': None}
    lo, hi = r
    if _grid_point_count(lo, hi, s) > MAX_GRID_POINTS:
        return {'values': None, 'step': s,
                'warning': grid_too_large_warning(lo, hi, s, unit, MAX_GRID_POINTS,
                                                  lead=OUTPUT_X_LIMIT_LEAD, hint='')}
    return {'values': _make_grid(lo, hi, s), 'step': s, 'warning': None}


def resolve_output_x(x_col, args, cols):
    """outputXSequence.js resolveOutputX: (origin_ms, output_x_data) for a fitting node.
    Column mode is fit_time_frame on the named column; sequence mode builds the sequence over
    the x input with the input's origin."""
    if not _output_x_is_sequence(args):
        out_id = args.get('outputX', -1)
        out_col = cols.get(out_id) if _output_x_specified(args) else None
        return fit_time_frame(x_col, out_col)
    is_time = x_col.type == 'time'
    xs = x_col.hours_since_start if is_time else x_col.get_data()
    seq = output_x_sequence(xs, args.get('outputXStep'), ' h' if is_time else '')
    return time_origin_ms(x_col), seq['values']


def output_x_sequence_probe(values, step, unit=''):
    """Parity probe for the output x sequence: the default step, and the sequence made with
    `step` (count, first, last, step used; warning '' when none)."""
    seq = output_x_sequence(values, step, unit)
    v = seq['values'] or []
    return {'defaultStep': default_output_x_step(values) or _NAN,
            'count': len(v),
            'first': v[0] if v else _NAN,
            'last': v[-1] if v else _NAN,
            'step': seq['step'] if seq['step'] is not None else _NAN,
            'warning': seq['warning'] or ''}


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
        too_large = grid_too_large_warning(start, end, step, ' h' if is_time else '')
        if too_large:
            # The app shows this on the node and empties the outputs.
            print(f'WARNING: Interpolate: {too_large}', file=sys.stderr)
            return False
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


# --- JoinData ---
#
# Port of utils/joinPairing.js (which value columns are the same measurement, and the output
# names) and utils/joinData.js (every row of A and B on one time column) as JoinData.svelte
# wires them. No matching or merging: rows that share a time stay separate rows, A's first.

MAX_JOIN_ROWS = MAX_GRID_POINTS


def _join_norm_name(name):
    """joinPairing.js normaliseColumnName: trimmed, inner whitespace runs as one space, lower."""
    return re.sub(r'\s+', ' ', str('' if name is None else name).strip()).lower()


def _join_ids(v):
    out = []
    for raw in (v if isinstance(v, list) else ([] if v is None else [v])):
        n = _js_number(raw)
        if math.isfinite(n) and n == int(n) and n >= 0 and int(n) not in out:
            out.append(int(n))
    return out


def join_pairing(a_ids, b_ids, name_of, pairing=None):
    """joinPairing.js decidePairs: {b_id: a_id} and the conflicts. Overrides first (an A id, or
    -1 for separate; a stale one falls back to the name), then same-normalised-name matches,
    each A column taking at most one B partner."""
    pair_of, taken, decided, conflicts = {}, set(), set(), []
    overrides = pairing if isinstance(pairing, dict) else {}
    for b in b_ids:
        if str(b) not in overrides:
            continue
        want = _js_number(overrides[str(b)])
        if want == -1:
            decided.add(b)
            continue
        if want not in a_ids:
            continue
        want = int(want)
        decided.add(b)
        if want in taken:
            conflicts.append({'bId': b, 'aId': want, 'why': 'taken'})
            continue
        pair_of[b] = want
        taken.add(want)
    for b in b_ids:
        if b in decided:
            continue
        key = _join_norm_name(name_of(b))
        if key == '':
            continue
        matches = [a for a in a_ids if _join_norm_name(name_of(a)) == key]
        free = next((a for a in matches if a not in taken), None)
        if free is not None:
            pair_of[b] = free
            taken.add(free)
        elif matches:
            conflicts.append({'bId': b, 'aId': matches[0], 'why': 'taken'})
    return pair_of, conflicts


def join_outputs(a_ids, b_ids, pair_of, name_of):
    """joinPairing.js joinOutputs: joined_<A id> per A column, then joined_<B id> per unpaired
    B column; labels are the (trimmed) names, with " (A)"/" (B)" on unpaired ones that read
    alike and a number on any still alike."""
    partner = {a: b for b, a in pair_of.items()}
    outs = []
    for a in a_ids:
        outs.append({'key': f'joined_{a}', 'aId': a, 'bId': partner.get(a),
                     'label': str(name_of(a)).strip(), 'side': 'A'})
    for b in b_ids:
        if b in pair_of:
            continue
        outs.append({'key': f'joined_{b}', 'aId': None, 'bId': b,
                     'label': str(name_of(b)).strip(), 'side': 'B'})
    counts = {}
    for o in outs:
        k = _join_norm_name(o['label'])
        counts[k] = counts.get(k, 0) + 1
    for o in outs:
        paired = o['aId'] is not None and o['bId'] is not None
        if not paired and counts[_join_norm_name(o['label'])] > 1:
            o['label'] = f"{o['label']} ({o['side']})"
    seen = {}
    for o in outs:
        k = _join_norm_name(o['label'])
        seen[k] = seen.get(k, 0) + 1
        if seen[k] > 1:
            o['label'] = f"{o['label']} {seen[k]}"
    return outs


def join_time_kind(col_type):
    """joinData.js timeKind: 'time', 'number' (number or bin), or None."""
    if col_type == 'time':
        return 'time'
    if col_type in ('number', 'bin'):
        return 'number'
    return None


def join_too_large_warning(rows, max_rows=MAX_JOIN_ROWS, stack=False):
    """joinData.js joinTooLargeWarning."""
    if not rows > max_rows:
        return None
    with_time = '' if stack else ' with a time'
    return (f'Nothing was joined: A and B together have {rows:,} rows{with_time}, more than '
            f'the limit of {max_rows:,}. Bin or filter one of them first.')


JOIN_ONE_TIME_ERROR = 'Wire a time for both datasets, or for neither.'


def _join_wired(v):
    if v is None or v == '' or isinstance(v, bool):
        return False
    n = _js_number(v)
    return math.isfinite(n) and n == int(n) and n >= 0


def join_mode(args):
    """joinPairing.js joinMode: 'time' (both times wired), 'stack' (neither) or 'one'."""
    a, b = _join_wired(args.get('aTimeIN')), _join_wired(args.get('bTimeIN'))
    if a and b:
        return 'time'
    return 'one' if (a or b) else 'stack'


def join_source_on(args):
    """joinPairing.js joinSourceOn: a stored true/false wins; else on when stacking."""
    v = args.get('sourceColumn')
    if isinstance(v, bool):
        return v
    return join_mode(args) == 'stack'


def stack_data(a_ids, b_ids, data_of, type_of, outputs, source_labels=('A', 'B'),
               max_rows=MAX_JOIN_ROWS):
    """joinData.js stackData: A's rows in their order, then B's (no time, no sort). A dataset
    has as many rows as its longest value column."""
    n_a = max([len(data_of.get(i) or []) for i in a_ids] or [0])
    n_b = max([len(data_of.get(i) or []) for i in b_ids] or [0])
    rows = n_a + n_b
    counts = {'rows': rows, 'fromA': n_a, 'fromB': n_b, 'stacked': True}
    too_large = join_too_large_warning(rows, max_rows, stack=True)
    if too_large:
        return {'ok': False, 'error': too_large, 'counts': counts}

    def cell(col_id, row):
        data = data_of.get(col_id) or []
        if row >= len(data):
            return None
        v = data[row]
        missing = _is_missing_category(v) if type_of.get(col_id) == 'category' else _js_invalid(v)
        return None if missing else v

    source = [source_labels[0]] * n_a + [source_labels[1]] * n_b
    columns = {}
    for o in outputs:
        a = [cell(o['aId'], r) if o['aId'] is not None else None for r in range(n_a)]
        b = [cell(o['bId'], r) if o['bId'] is not None else None for r in range(n_b)]
        columns[o['key']] = a + b
    return {'ok': rows > 0, 'error': None, 'source': source, 'columns': columns,
            'counts': counts, 'rareShared': False}


def _join_shift(shift_b, kind):
    s = _js_number(shift_b) if shift_b is not None else 0.0
    if not math.isfinite(s) or s == 0:
        return 0.0
    # JS Math.round: halves go up (towards +infinity), unlike Python's round().
    return float(math.floor(s * 3600000 + 0.5)) if kind == 'time' else s


def _join_placed(times, shift):
    idx, t = [], {}
    for i, v in enumerate(times):
        if _js_invalid(v):
            continue
        x = _js_number(v) + shift
        if not math.isfinite(x):
            continue
        t[i] = x
        idx.append(i)
    idx.sort(key=lambda i: (t[i], i))
    return idx, t, len(times) - len(idx)


def join_data(time_a, time_b, kind, data_of, type_of, outputs, shift_b=0,
              source_labels=('A', 'B'), max_rows=MAX_JOIN_ROWS):
    """joinData.js joinData: every row of A and B on one time column. Returns a dict with
    ok, error, time, source, columns, counts, rareShared."""
    ia, ta, da = _join_placed(list(time_a), 0.0)
    ib, tb, db = _join_placed(list(time_b), _join_shift(shift_b, kind))
    rows = len(ia) + len(ib)
    counts = {'rows': rows, 'fromA': len(ia), 'fromB': len(ib), 'droppedA': da, 'droppedB': db,
              'sharedTimes': 0, 'sharedRows': 0}
    too_large = join_too_large_warning(rows, max_rows)
    if too_large:
        return {'ok': False, 'error': too_large, 'counts': counts}

    def cell(col_id, row):
        data = data_of.get(col_id) or []
        if row >= len(data):
            return None
        v = data[row]
        missing = _is_missing_category(v) if type_of.get(col_id) == 'category' else _js_invalid(v)
        return None if missing else v

    time, source = [], []
    columns = {o['key']: [] for o in outputs}
    i = j = 0
    while i < len(ia) or j < len(ib):
        take_a = i < len(ia) and (j >= len(ib) or ta[ia[i]] <= tb[ib[j]])
        if take_a:
            row = ia[i]
            i += 1
            time.append(ta[row])
            source.append(source_labels[0])
            for o in outputs:
                columns[o['key']].append(cell(o['aId'], row) if o['aId'] is not None else None)
        else:
            row = ib[j]
            j += 1
            time.append(tb[row])
            source.append(source_labels[1])
            for o in outputs:
                columns[o['key']].append(cell(o['bId'], row) if o['bId'] is not None else None)

    in_a, in_b = {}, {}
    for r in ia:
        in_a[ta[r]] = in_a.get(ta[r], 0) + 1
    for r in ib:
        in_b[tb[r]] = in_b.get(tb[r], 0) + 1
    for t, n in in_b.items():
        if t in in_a:
            counts['sharedTimes'] += 1
            counts['sharedRows'] += n + in_a[t]
    rare = counts['fromA'] > 0 and counts['fromB'] > 0 and counts['sharedRows'] / rows < 0.1
    return {'ok': rows > 0, 'error': None, 'time': time, 'source': source, 'columns': columns,
            'counts': counts, 'rareShared': rare}


def join_limit_probe(_unused, rows):
    """Parity probe for the join row limit: allowed (1/0) and the warning ('' if none)."""
    w = join_too_large_warning(int(rows))
    return {'allowed': 0 if w else 1, 'warning': w or ''}


def tp_joindata(args, cols, raw_data, _sv):
    """Port of JoinData.svelte joindata. Pairs come from the node's baked `_resolvedPairs`
    when the session has them (the app decides them by the names it SHOWS, which this runtime
    cannot always reproduce), else from the column names with `pairing` overrides; the Source
    labels likewise from `_sourceLabels`, else A and B. A refused join (mixed time kinds, a
    column on both sides, too many rows) writes empty outputs, as the app clears them."""
    def clear():
        out = args.get('out') or {}
        for k in out:
            oid = _out_id(args, k)
            if oid is not None and oid != -1 and oid in cols:
                _set_col(raw_data, cols, oid, [])
        return False

    mode = join_mode(args)
    if mode == 'one':
        print(f'WARNING: Join Data: {JOIN_ONE_TIME_ERROR}', file=sys.stderr)
        return clear()
    if mode == 'time':
        a_t, b_t = int(_js_number(args.get('aTimeIN'))), int(_js_number(args.get('bTimeIN')))
        col_a, col_b = cols.get(a_t), cols.get(b_t)
        if col_a is None or col_b is None:
            return clear()
        kind_a, kind_b = join_time_kind(col_a.type), join_time_kind(col_b.type)
        if kind_a is None or kind_b is None or kind_a != kind_b:
            print(f'WARNING: Join Data: time A is {col_a.type} and time B is {col_b.type}; '
                  'both must be times or both numbers.', file=sys.stderr)
            return clear()
    a_ids, b_ids = _join_ids(args.get('aValuesIN')), _join_ids(args.get('bValuesIN'))
    if any(a in b_ids for a in a_ids):
        return clear()

    def name_of(cid):
        c = cols.get(cid)
        return c.name if c is not None and c.name is not None else str(cid)

    baked = args.get('_resolvedPairs')
    if isinstance(baked, dict):
        pair_of = {}
        for b, a in baked.items():
            bi, ai = int(_js_number(b)), int(_js_number(a))
            if bi in b_ids and ai in a_ids:
                pair_of[bi] = ai
    else:
        pair_of, _ = join_pairing(a_ids, b_ids, name_of, args.get('pairing'))
    outputs = join_outputs(a_ids, b_ids, pair_of, name_of)
    labels = args.get('_sourceLabels')
    if not (isinstance(labels, list) and len(labels) == 2):
        labels = ['A', 'B']

    data_of, type_of = {}, {}
    for cid in a_ids + b_ids:
        c = cols.get(cid)
        data_of[cid] = list(c.get_data()) if c is not None else []
        type_of[cid] = c.type if c is not None else 'number'
    if mode == 'stack':
        res = stack_data(a_ids, b_ids, data_of, type_of, outputs, labels)
    else:
        res = join_data(col_a.get_data(), col_b.get_data(), kind_a, data_of, type_of, outputs,
                        args.get('shiftB', 0), labels)
    if res['error']:
        print(f"WARNING: Join Data: {res['error']}", file=sys.stderr)
        return clear()

    if mode == 'time':
        t_id = _out_id(args, 'jointime')
        _set_col(raw_data, cols, t_id, res['time'],
                 type_='time' if kind_a == 'time' else 'number')
        if t_id in cols and kind_a == 'time':
            cols[t_id].time_format = None
    for o in outputs:
        oid = _out_id(args, o['key'])
        src = cols.get(o['aId'] if o['aId'] is not None else o['bId'])
        typ = src.type if src is not None else 'number'
        _set_col(raw_data, cols, oid, res['columns'][o['key']], type_=typ)
        if oid in cols and typ == 'time':
            cols[oid].time_format = None
    if join_source_on(args) and (mode == 'time' or outputs):
        _set_col(raw_data, cols, _out_id(args, 'source'), res['source'], type_='category')
    return res['ok']


TABLE_PROCESS_MAP = {
    'describedata': tp_describedata,
    'normalitytest': tp_normalitytest,
    'correlation': tp_correlation,
    'crosscorrelation': tp_crosscorrelation,
    'chisquared': tp_chisquared,
    'columnset': tp_columnset,
    'logisticregression': tp_logisticregression,
    'interpolate': tp_interpolate,
    'joindata': tp_joindata,
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


def _display_name(col):
    """The name to show for a column in a plot legend: the app's display name when the export
    carried one (Column.label), else the stored name, as the app's seriesDisplayLabel falls
    back to the wired column's display name."""
    if col is None:
        return ''
    return col.label or col.name


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


# ---- Colour by: colour scales, modes, ranges and buckets ---------------------------------
#
# Ports of components/plotbits/colormaps.js (the stop tables and colormapRGB),
# components/plotbits/encodings.js (modes, range, buckets), encodingHost.js (effective mode
# and map, colour bar title and ticks) and colouredLine.js (coloured line segments), so an
# exported plot colours every mark exactly as the app does (colour-by plan 2026-10-20,
# section 3.10). The colours are the app's 64 BUCKET colours, not a continuous map: bucket
# b of a map is colormapRGB(map, (b + 0.5) / 64), and a mark's bucket is
# min(63, floor(t * 64)) of its position t in the range.
#
# The stop tables are the app's own (viridis, magma, twilight_shifted and greysCyclic come
# from src/lib/components/plotbits/colormapStops.json, sampled from matplotlib by
# tools/gen_colormap_stops.py; greys and rdbu are the app's ramps). They are copied here so
# the runtime stands alone; tools/test_plot_colour_by.py fails if they drift from the app.

COLOUR_BUCKETS = 64
NO_COLOUR_VALUE = -1

COLORMAPS = {
    'viridis': (
        (68, 1, 84), (70, 7, 90), (71, 13, 96), (71, 19, 101), (72, 24, 106), (72, 29, 111),
        (72, 35, 116), (72, 40, 120), (71, 45, 123), (70, 50, 126), (69, 55, 129),
        (68, 59, 132), (66, 64, 134), (64, 69, 136), (62, 73, 137), (61, 78, 138),
        (59, 82, 139), (57, 86, 140), (55, 91, 141), (53, 95, 141), (51, 99, 141),
        (49, 103, 142), (47, 107, 142), (46, 111, 142), (44, 114, 142), (42, 118, 142),
        (41, 122, 142), (39, 126, 142), (38, 130, 142), (37, 133, 142), (35, 137, 142),
        (34, 141, 141), (33, 145, 140), (31, 148, 140), (31, 152, 139), (30, 156, 137),
        (31, 160, 136), (32, 163, 134), (34, 167, 133), (37, 171, 130), (40, 174, 128),
        (45, 178, 125), (50, 182, 122), (56, 185, 119), (63, 188, 115), (70, 192, 111),
        (78, 195, 107), (86, 198, 103), (94, 201, 98), (103, 204, 92), (112, 207, 87),
        (122, 209, 81), (132, 212, 75), (142, 214, 69), (152, 216, 62), (162, 218, 55),
        (173, 220, 48), (184, 222, 41), (194, 223, 35), (205, 225, 29), (216, 226, 25),
        (226, 228, 24), (236, 229, 27), (246, 230, 32), (253, 231, 37),
    ),
    'magma': (
        (0, 0, 4), (2, 1, 9), (3, 3, 18), (6, 5, 26), (10, 8, 34), (14, 11, 43), (19, 13, 52),
        (24, 15, 61), (29, 17, 71), (34, 17, 80), (41, 17, 90), (47, 17, 99), (54, 16, 107),
        (61, 15, 113), (68, 15, 118), (74, 16, 121), (81, 18, 124), (87, 21, 126),
        (93, 23, 127), (100, 26, 128), (106, 28, 129), (112, 31, 129), (118, 33, 129),
        (124, 35, 130), (131, 38, 129), (137, 40, 129), (144, 42, 129), (150, 44, 128),
        (156, 46, 127), (163, 48, 126), (170, 51, 125), (176, 53, 123), (183, 55, 121),
        (189, 57, 119), (196, 60, 117), (202, 62, 114), (208, 65, 111), (214, 69, 108),
        (220, 72, 105), (226, 77, 102), (231, 82, 99), (235, 87, 96), (239, 93, 94),
        (242, 100, 92), (245, 107, 92), (247, 114, 92), (249, 121, 93), (250, 129, 95),
        (252, 137, 97), (252, 144, 101), (253, 152, 105), (254, 159, 109), (254, 167, 114),
        (254, 174, 119), (254, 182, 124), (254, 189, 130), (254, 196, 136), (254, 204, 143),
        (254, 211, 149), (253, 218, 156), (253, 226, 163), (253, 233, 170), (252, 240, 178),
        (252, 247, 185), (252, 253, 191),
    ),
    'greys': (
        (247, 247, 247), (217, 217, 217), (189, 189, 189), (150, 150, 150), (115, 115, 115),
        (82, 82, 82), (55, 55, 55), (28, 28, 28), (0, 0, 0),
    ),
    'rdbu': (
        (5, 48, 97), (42, 104, 172), (110, 160, 205), (185, 210, 230), (247, 247, 247),
        (244, 197, 173), (214, 118, 94), (178, 47, 46), (103, 0, 31),
    ),
    'twilight_shifted': (
        (48, 20, 55), (51, 17, 61), (56, 17, 69), (62, 17, 80), (69, 19, 92), (76, 22, 105),
        (81, 27, 119), (86, 34, 132), (89, 42, 143), (92, 52, 153), (93, 61, 161),
        (94, 71, 167), (94, 81, 173), (95, 90, 177), (95, 100, 181), (96, 109, 184),
        (98, 118, 186), (100, 126, 188), (104, 135, 190), (108, 143, 191), (114, 151, 193),
        (121, 159, 194), (129, 166, 195), (138, 174, 197), (149, 181, 199), (160, 188, 201),
        (172, 194, 204), (184, 201, 208), (196, 206, 212), (206, 211, 217), (215, 215, 221),
        (222, 217, 225), (226, 217, 226), (225, 216, 221), (223, 212, 214), (220, 206, 203),
        (216, 199, 190), (213, 191, 177), (209, 182, 163), (207, 173, 150), (204, 163, 137),
        (202, 154, 125), (200, 144, 115), (197, 134, 106), (194, 124, 99), (191, 114, 93),
        (187, 105, 88), (183, 95, 85), (178, 86, 82), (172, 77, 81), (166, 69, 80),
        (160, 61, 80), (152, 53, 80), (144, 46, 80), (135, 39, 80), (126, 34, 80),
        (116, 30, 79), (105, 26, 77), (95, 23, 74), (84, 21, 70), (74, 19, 66), (65, 18, 61),
        (58, 17, 58), (52, 18, 56), (48, 20, 55),
    ),
    'greysCyclic': (
        (31, 31, 31), (32, 32, 32), (35, 35, 35), (39, 39, 39), (44, 44, 44), (50, 50, 50),
        (55, 55, 55), (62, 62, 62), (68, 68, 68), (75, 75, 75), (81, 81, 81), (88, 88, 88),
        (94, 94, 94), (101, 101, 101), (108, 108, 108), (114, 114, 114), (121, 121, 121),
        (127, 127, 127), (134, 134, 134), (141, 141, 141), (148, 148, 148), (155, 155, 155),
        (161, 161, 161), (169, 169, 169), (176, 176, 176), (184, 184, 184), (190, 190, 190),
        (198, 198, 198), (204, 204, 204), (210, 210, 210), (215, 215, 215), (219, 219, 219),
        (220, 220, 220), (218, 218, 218), (215, 215, 215), (209, 209, 209), (202, 202, 202),
        (195, 195, 195), (187, 187, 187), (179, 179, 179), (171, 171, 171), (164, 164, 164),
        (156, 156, 156), (149, 149, 149), (141, 141, 141), (134, 134, 134), (127, 127, 127),
        (120, 120, 120), (114, 114, 114), (107, 107, 107), (101, 101, 101), (95, 95, 95),
        (88, 88, 88), (82, 82, 82), (76, 76, 76), (70, 70, 70), (64, 64, 64), (58, 58, 58),
        (53, 53, 53), (47, 47, 47), (42, 42, 42), (37, 37, 37), (34, 34, 34), (32, 32, 32),
        (31, 31, 31),
    ),
}

# colormaps.js COLORMAP_META: the map monochrome swaps each map to.
COLORMAP_MONOCHROME = {'viridis': 'greys', 'magma': 'greys', 'greys': 'greys', 'rdbu': 'greys',
                       'twilight_shifted': 'greysCyclic', 'greysCyclic': 'greysCyclic'}
CYCLIC_COLORMAPS = ('twilight_shifted', 'greysCyclic')
DEFAULT_COLORMAP = 'viridis'
DEFAULT_CYCLIC_COLORMAP = 'twilight_shifted'
# Scatterplot.svelte COLOUR_BY_SWATCH: the legend swatch of a series coloured by a column.
COLOUR_BY_SWATCH = 'rgb(140, 140, 140)'
COLOUR_ENCODING_MODES = ('value', 'hourOfDay', 'dayOfYear', 'daysSinceStart', 'category')
# The modes of a column with a clock (time, or hours from a time origin), no Category.
_CLOCK_ENCODING_MODES = ('value', 'hourOfDay', 'dayOfYear', 'daysSinceStart')
# The app's default palette (core.svelte.js appState.appColours): Category's colours and its
# cap when the export carries none (the app's resolved colours are always used when present).
APP_PALETTE = ('#234154', '#BE796B', '#3E7295', '#EDADAD', '#A6ACD5', '#83422A', '#6B9FD5',
               '#4A1E0E', '#fbe67280')
WRAPPED_HOURS_WARNING = ('This column has no clock time, so hour of day is its hours since '
                         'start, wrapped at 24 h.')
NO_DATE_WARNING = 'Day of year needs a time column (or hours from a time origin).'
_HOURS_PER_DAY = 24


def _js_round(v):
    """JS Math.round: halves round up (towards +infinity)."""
    return math.floor(v + 0.5)


def colormap_rgb(name, t):
    """colormaps.js colormapRGB: the map at t in [0, 1] (clamped; NaN is 0) as (r, g, b)
    integers, linearly interpolated between the two bracketing stops."""
    stops = COLORMAPS.get(name) or COLORMAPS[DEFAULT_COLORMAP]
    u = t if (isinstance(t, (int, float)) and math.isfinite(t)) else 0
    u = 0 if u < 0 else (1 if u > 1 else u)
    last = len(stops) - 1
    scaled = u * last
    i = min(last - 1, math.floor(scaled))
    frac = scaled - i
    a, b = stops[i], stops[i + 1]
    return tuple(_js_round(a[k] + (b[k] - a[k]) * frac) for k in range(3))


def bucket_colours(name, k=COLOUR_BUCKETS):
    """encodings.js bucketColours: bucket b is the map at its centre, (b + 0.5) / K."""
    return [colormap_rgb(name, (b + 0.5) / k) for b in range(k)]


def normalise_to_01(value, lo, hi):
    """colormaps.js normaliseTo01: (value - lo) / (hi - lo) clamped to [0, 1]; 0 for a
    non-finite input or an empty range."""
    if not (_finite(value) and _finite(lo) and _finite(hi)) or hi <= lo:
        return 0.0
    t = (float(value) - lo) / (hi - lo)
    return 0.0 if t < 0 else (1.0 if t > 1 else t)


def _rgb_css(rgb):
    return f'rgb({rgb[0]}, {rgb[1]}, {rgb[2]})'


def _mpl_colour(c, fallback=None):
    """A colour the app saved ('#rrggbb', '#rrggbbaa', 'rgb(r, g, b)', 'rgba(...)', a CSS
    name) as matplotlib reads it, or `fallback` when there is none."""
    if c is None or c == '':
        return fallback
    if isinstance(c, (tuple, list)):
        return tuple(v / 255 for v in c[:3]) if any(v > 1 for v in c[:3]) else tuple(c)
    s = str(c).strip()
    m = re.fullmatch(r'rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)', s)
    if m:
        rgb = tuple(float(m.group(k)) / 255 for k in (1, 2, 3))
        return rgb + (float(m.group(4)),) if m.group(4) is not None else rgb
    return s


def is_cyclic_mode(mode):
    return mode == 'hourOfDay'


def _has_clock(col_type, origin_ms):
    return col_type == 'time' or (origin_ms is not None and math.isfinite(origin_ms))


def encoding_modes_for(col_type, origin_ms=None, categories=True):
    """encodings.js encodingModesFor: the modes a column can be coloured by. Category is the
    only mode of a text or category column and the last of a plain number column (never a
    time or clock column); `categories=False` leaves it out (Size by)."""
    if categories and col_type in ('category', 'text'):
        return ['category']
    if col_type == 'time':
        return ['hourOfDay', 'dayOfYear', 'daysSinceStart']
    if _has_clock(col_type, origin_ms):
        return list(_CLOCK_ENCODING_MODES)
    return ['value', 'hourOfDay', 'daysSinceStart'] + (['category'] if categories else [])


def effective_colour_mode(stored, col_type, origin_ms=None):
    """encodingHost.js effectiveColourMode: the stored mode when the column offers it, else
    hour of day for a time column and the first offered mode for anything else."""
    offered = encoding_modes_for(col_type, origin_ms)
    if stored and stored != 'auto' and stored in offered:
        return stored
    return 'hourOfDay' if col_type == 'time' else offered[0]


def effective_colormap(stored, mode, monochrome=False):
    """encodingHost.js effectiveColormap: a stored map that suits the mode (cyclic for hour of
    day, not cyclic otherwise), else the mode's default; monochrome swaps it for its grey
    twin at draw time (the saved map is untouched)."""
    cyclic = is_cyclic_mode(mode)
    m = DEFAULT_CYCLIC_COLORMAP if cyclic else DEFAULT_COLORMAP
    if stored and stored != 'auto' and stored in COLORMAPS and (stored in CYCLIC_COLORMAPS) == cyclic:
        m = stored
    return COLORMAP_MONOCHROME.get(m, 'greys') if monochrome else m


def _colour_cell_number(v):
    """encodings.js finiteOrNaN: a cell as a finite number, else NaN (no value)."""
    if _js_invalid(v):
        return _NAN
    n = _js_number(v)
    return n if math.isfinite(n) else _NAN


def _colour_clock_ms(v, col_type, origin_ms):
    """encodings.js clockMs: a time cell's epoch ms, or a number cell's hours after its time
    origin, else NaN."""
    n = _colour_cell_number(v)
    if not math.isfinite(n):
        return _NAN
    if col_type == 'time':
        return n
    if origin_ms is not None and math.isfinite(origin_ms):
        return origin_ms + n * _MS_PER_HOUR
    return _NAN


def day_of_year(ms, zone='utc'):
    """encodings.js dayOfYear: 1 to 366, from the calendar date in `zone`."""
    if ms is None or not math.isfinite(ms):
        return _NAN
    import datetime as _dt
    try:
        if not zone or zone in ('utc', 'UTC'):
            d = _dt.datetime.fromtimestamp(ms / 1000, tz=_dt.timezone.utc)
        else:
            from zoneinfo import ZoneInfo
            d = _dt.datetime.fromtimestamp(ms / 1000, tz=ZoneInfo(zone))
    except (OverflowError, OSError, ValueError):
        return _NAN
    return d.timetuple().tm_yday


def encoding_values(mode, values, col_type='number', origin_ms=None, zone='utc'):
    """encodings.js encodingValues: (the value each row is coloured by, warning). NaN is no
    value."""
    values = list(values or [])
    if mode == 'category':
        return [category_label(v) for v in values], None
    if mode == 'hourOfDay':
        if _has_clock(col_type, origin_ms):
            return [clock_hour_of_day(_colour_clock_ms(v, col_type, origin_ms), zone)
                    for v in values], None
        out = []
        for v in values:
            h = _colour_cell_number(v)
            out.append(math.fmod(math.fmod(h, 24) + 24, 24) if math.isfinite(h) else _NAN)
        return out, WRAPPED_HOURS_WARNING
    if mode == 'dayOfYear':
        if not _has_clock(col_type, origin_ms):
            return [_NAN] * len(values), NO_DATE_WARNING
        return [day_of_year(_colour_clock_ms(v, col_type, origin_ms), zone) for v in values], None
    if mode == 'daysSinceStart':
        per_day = _MS_PER_DAY if col_type == 'time' else _HOURS_PER_DAY
        nums = [_colour_cell_number(v) for v in values]
        finite = [v for v in nums if math.isfinite(v)]
        first = min(finite) if finite else math.inf
        return [(v - first) / per_day if math.isfinite(v) else _NAN for v in nums], None
    return [_colour_cell_number(v) for v in values], None


def category_label(v):
    """encodings.js categoryLabel: a cell's label (JS String(v)), or None when missing."""
    return None if _is_missing_category(v) else _js_string(v)


def _category_cmp(a, b):
    """encodings.js compareCategories (the Boxplot's order): numerically when both labels
    read as numbers, else alphabetically (localeCompare, approximated case-insensitively)."""
    def num(x):
        if '_' in str(x):
            return None
        try:
            v = float(str(x).strip()) if str(x).strip() != '' else 0.0
        except ValueError:
            return None
        return None if math.isnan(v) else v
    na, nb = num(a), num(b)
    if na is not None and nb is not None:
        return (na > nb) - (na < nb)
    ka, kb = (str(a).casefold(), str(a)), (str(b).casefold(), str(b))
    return (ka > kb) - (ka < kb)


def category_domain(label_arrays):
    """encodings.js categoryDomain: {'categories' (the Boxplot's order), 'first_seen'} over
    every array, plus the numeric domain's keys (NaN) so the rest of the code reads it."""
    import functools
    seen, first = set(), []
    for arr in label_arrays or []:
        for v in arr or []:
            if v is None or v in seen:
                continue
            seen.add(v)
            first.append(v)
    cats = sorted(first, key=functools.cmp_to_key(_category_cmp))
    return {'lo': _NAN, 'hi': _NAN, 'cyclic': False, 'period': None, 'categories': cats,
            'first_seen': first}


def category_indices(labels, categories):
    """encodings.js categoryIndices: each label's place in `categories`, -1 for none."""
    at = {c: i for i, c in enumerate(categories)}
    return [at.get(v, NO_COLOUR_VALUE) if v is not None else NO_COLOUR_VALUE for v in labels]


def grey_for_index(i, n):
    """seriesAppearance.js greyForIndex: an evenly spaced grey from #222222 to #aaaaaa."""
    count = max(1, n)
    t = 0 if count == 1 else min(1, max(0, i / (count - 1)))
    v = _js_round(0x22 + (0xaa - 0x22) * t)
    return '#' + f'{v:02x}' * 3


def category_palette_fallback(first_seen, categories, monochrome=False):
    """seriesColour.js categoryPalette with no pins (an export without the app's resolved
    colours): each label in first-appearance order claims the next default palette slot; in
    monochrome, the Boxplot's greys by key order."""
    if monochrome:
        return [grey_for_index(i, len(categories)) for i in range(len(categories))]
    size = len(APP_PALETTE)
    slot = {c: APP_PALETTE[i % size] for i, c in enumerate(first_seen)}
    return [slot.get(c, APP_PALETTE[0]) for c in categories]


def _number_or_none(v):
    """Encoding.svelte numberOrNullIn: a finite number, else None (an automatic end)."""
    if v is None or v == '' or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def encoding_domain(value_arrays, mode=None, domain_in=None):
    """encodings.js encodingDomain: {'lo', 'hi', 'cyclic', 'period'}. Hour of day is fixed
    at [0, 24) and wraps; otherwise the finite min and max over EVERY array given, a manual
    end overriding either. Category: its categories (category_domain)."""
    if mode == 'category':
        return category_domain(value_arrays)
    if is_cyclic_mode(mode):
        return {'lo': 0, 'hi': _HOURS_PER_DAY, 'cyclic': True, 'period': _HOURS_PER_DAY}
    lo, hi = math.inf, -math.inf
    for arr in value_arrays or []:
        for v in arr or []:
            if isinstance(v, (int, float)) and math.isfinite(v):
                lo = min(lo, v)
                hi = max(hi, v)
    manual = list(domain_in or [])
    if len(manual) > 0 and _number_or_none(manual[0]) is not None:
        lo = _number_or_none(manual[0])
    if len(manual) > 1 and _number_or_none(manual[1]) is not None:
        hi = _number_or_none(manual[1])
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return {'lo': _NAN, 'hi': _NAN, 'cyclic': False, 'period': None}
    return {'lo': lo, 'hi': hi, 'cyclic': False, 'period': None}


def domain_position(v, domain):
    """encodings.js domainPosition: t in [0, 1] (cyclic wraps, else clamps), NaN for no
    value; a degenerate range puts every value at 0."""
    if not (isinstance(v, (int, float)) and math.isfinite(v)) or not domain:
        return _NAN
    lo, hi = domain['lo'], domain['hi']
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return _NAN
    if domain.get('cyclic'):
        period = domain.get('period') or (hi - lo)
        if not (period > 0):
            return _NAN
        u = (v - lo) / period
        return u - math.floor(u)
    span = hi - lo
    if span == 0:
        return 0
    t = (v - lo) / span
    return 0 if t < 0 else (1 if t > 1 else t)


def bucket_index(t, k=COLOUR_BUCKETS):
    """encodings.js bucketIndex: min(K - 1, floor(t * K)), or NO_COLOUR_VALUE."""
    if not (isinstance(t, (int, float)) and math.isfinite(t)):
        return NO_COLOUR_VALUE
    u = 0 if t < 0 else (1 if t > 1 else t)
    return min(k - 1, math.floor(u * k))


def colour_buckets(values, domain, k=COLOUR_BUCKETS):
    """encodings.js colourBuckets: the bucket of every row."""
    return [bucket_index(domain_position(v, domain), k) for v in values or []]


def _zone_label(zone):
    return 'UTC' if not zone or zone == 'utc' else str(zone)


def colour_bar_title(mode, column_name='', zone='utc', wrapped=False):
    """encodingHost.js colourBarTitle."""
    if mode == 'hourOfDay':
        return ('Hours since start, wrapped at 24 h' if wrapped
                else f'Hour of day ({_zone_label(zone)})')
    if mode == 'dayOfYear':
        return f'Day of year ({_zone_label(zone)})'
    if mode == 'daysSinceStart':
        return 'Days since start'
    return column_name or 'Value'


def _js_number_to_string(x):
    """JS String(number) for a finite float: the shortest round-trip digits, in positional
    form for exponents -7 < e < 21 and exponential form outside (ECMA-262 Number::toString)."""
    import decimal
    if x == 0:
        return '0'
    if not math.isfinite(x):
        return 'NaN' if math.isnan(x) else ('Infinity' if x > 0 else '-Infinity')
    sign = '-' if x < 0 else ''
    d = decimal.Decimal(repr(abs(x))).normalize()
    _, digits, exp = d.as_tuple()
    s = ''.join(str(v) for v in digits)
    k = len(s)
    n = k + exp
    if k <= n <= 21:
        out = s + '0' * (n - k)
    elif 0 < n <= 21:
        out = s[:n] + '.' + s[n:]
    elif -6 < n <= 0:
        out = '0.' + '0' * (-n) + s
    else:
        e = n - 1
        mant = s if k == 1 else s[0] + '.' + s[1:]
        out = f"{mant}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + out


def _js_to_precision_number(v, p):
    """Number(v.toPrecision(p)): v rounded to p significant figures, ties away from zero on
    the exact binary value (as toPrecision rounds)."""
    import decimal
    d = decimal.Decimal(v)
    if d == 0:
        return 0.0
    q = decimal.Decimal(1).scaleb(d.adjusted() - p + 1)
    return float(d.quantize(q, rounding=decimal.ROUND_HALF_UP))


def format_colour_value(v, mode):
    """encodingHost.js formatColourValue: a colour value as the colour bar prints it."""
    if mode == 'category':
        return 'no value' if v is None else str(v)
    if not (isinstance(v, (int, float)) and math.isfinite(v)):
        return 'no value'
    if mode == 'hourOfDay':
        total = _js_round(v * 60) % (24 * 60)
        return f'{total // 60:02d}:{total % 60:02d}'
    if mode == 'dayOfYear':
        return _js_number_to_string(float(_js_round(v)))
    if v == 0:
        return '0'
    return _js_number_to_string(_js_to_precision_number(v, 3))


def colour_bar_ticks(domain, mode, manual_lo=False, manual_hi=False):
    """encodingHost.js colourBarTicks: [(t, label)], t along the bar. Hour of day reads 0, 6,
    12, 18, 24; otherwise both ends and the middle, a manual end marked <= or >=."""
    if domain and domain.get('cyclic'):
        return [(h / 24, str(h)) for h in (0, 6, 12, 18, 24)]
    lo, hi = (domain or {}).get('lo', _NAN), (domain or {}).get('hi', _NAN)
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return []
    if lo == hi:
        return [(0.5, format_colour_value(lo, mode))]
    return [(0, ('≤ ' if manual_lo else '') + format_colour_value(lo, mode)),
            (0.5, format_colour_value((lo + hi) / 2, mode)),
            (1, ('≥ ' if manual_hi else '') + format_colour_value(hi, mode))]


def coloured_line_segments(xs, ys, idx, k=COLOUR_BUCKETS, join_gaps=False):
    """colouredLine.js colouredLineSegments: the line's segments as (start row, end row),
    grouped by the colour of the STARTING row. groups[0] is "no value", groups[b + 1]
    bucket b. Without joinGaps a segment needs both rows valid (a missing x or y breaks the
    line); with it, each valid row joins the next valid row."""
    groups = [[] for _ in range(k + 1)]
    n = min(len(xs), len(ys))
    n_idx = len(idx or [])

    def group_of(i):
        b = idx[i] if i < n_idx else -1
        return b + 1 if 0 <= b < k else 0

    if join_gaps:
        prev = -1
        for i in range(n):
            if not (_js_plot_valid(xs[i]) and _js_plot_valid(ys[i])):
                continue
            if prev >= 0:
                groups[group_of(prev)].append((prev, i))
            prev = i
    else:
        prev_valid = n > 0 and _js_plot_valid(xs[0]) and _js_plot_valid(ys[0])
        for i in range(1, n):
            valid = _js_plot_valid(xs[i]) and _js_plot_valid(ys[i])
            if valid and prev_valid:
                groups[group_of(i - 1)].append((i - 1, i))
            prev_valid = valid
    return groups



# ---- Size by (colour-by plan 2026-10-20, section 3.7; phase 3) --------------------------
#
# encodings.js / encodingHost.js, ported: the same modes (no Hour of day: a cycle has no
# "bigger"), range and bucket rules as colour, with an AREA-proportional radius between the
# smallest and largest point radius. The radius is exact per point; the 8 size layers only
# order the drawing (largest first). tools/test_plot_size_by.py pins every point's `s`
# against the app.

SIZE_BUCKETS = 8
DEFAULT_MIN_RADIUS = 2
DEFAULT_MAX_RADIUS = 10
MIN_RADIUS_FLOOR = 1


def size_modes_for(col_type, origin_ms=None):
    """encodings.js sizeModesFor: the colour modes without Hour of day."""
    return [m for m in encoding_modes_for(col_type, origin_ms, categories=False)
            if not is_cyclic_mode(m)]


def effective_size_mode(stored, col_type, origin_ms=None):
    """encodingHost.js effectiveSizeMode: the stored mode when the column offers it for size,
    else days since start for a time column and the value (the first offered) otherwise."""
    offered = size_modes_for(col_type, origin_ms)
    if stored and stored != 'auto' and stored in offered:
        return stored
    return 'daysSinceStart' if col_type == 'time' else offered[0]


def _radius_in(v, fallback):
    """Encoding.svelte radiusIn: a finite number, at least 1 px, else the default."""
    if v is None or v == '' or isinstance(v, bool):
        return fallback
    try:
        n = float(v)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_RADIUS_FLOOR, n) if math.isfinite(n) else fallback


def size_range(r_min, r_max):
    """encodings.js sizeRange: (rMin, rMax), each finite and at least 1 px."""
    return (max(MIN_RADIUS_FLOOR, _radius_in(r_min, DEFAULT_MIN_RADIUS)),
            max(MIN_RADIUS_FLOOR, _radius_in(r_max, DEFAULT_MAX_RADIUS)))


def size_radius(t, r_min, r_max):
    """encodings.js sizeRadius: sqrt(rMin^2 + t (rMax^2 - rMin^2)), t clamped; NaN for none."""
    if not (isinstance(t, (int, float)) and math.isfinite(t)):
        return _NAN
    u = 0 if t < 0 else (1 if t > 1 else t)
    return math.sqrt(r_min * r_min + u * (r_max * r_max - r_min * r_min))


def size_layer(r, lo, hi, s=SIZE_BUCKETS):
    """encodings.js sizeLayer: the AREA position of r between the smallest and largest radius,
    cut into s layers (clamped)."""
    span = hi * hi - lo * lo
    if not (isinstance(r, (int, float)) and math.isfinite(r)) or not (span > 0):
        return 0
    return bucket_index((r * r - lo * lo) / span, s)


def size_radii(values, domain, r_min, r_max, fallback, s=SIZE_BUCKETS):
    """encodings.js sizeRadii: (radius per mark, layer per mark, the "no value" layer); a mark
    with no size value keeps `fallback` (the series' point radius)."""
    lo, hi = min(r_min, r_max), max(r_min, r_max)
    nv_layer = size_layer(fallback, lo, hi, s)
    radii, layers = [], []
    for v in values or []:
        r = size_radius(domain_position(v, domain), r_min, r_max)
        if math.isfinite(r):
            radii.append(r)
            layers.append(size_layer(r, lo, hi, s))
        else:
            radii.append(fallback)
            layers.append(nv_layer)
    return radii, layers, nv_layer


def size_key_items(domain, mode, r_min, r_max, manual_lo=False, manual_hi=False):
    """encodingHost.js sizeKeyItems: [(value, r, label)], low first: both ends and the middle
    (one entry for a one-value range), a manual end marked <= or >=."""
    lo, hi = (domain or {}).get('lo', _NAN), (domain or {}).get('hi', _NAN)
    if not (math.isfinite(lo) and math.isfinite(hi)):
        return []

    def at(v):
        return size_radius(domain_position(v, domain), r_min, r_max)
    if lo == hi:
        return [(lo, at(lo), format_colour_value(lo, mode))]
    mid = (lo + hi) / 2
    return [(lo, at(lo), ('≤ ' if manual_lo else '') + format_colour_value(lo, mode)),
            (mid, at(mid), format_colour_value(mid, mode)),
            (hi, at(hi), ('≥ ' if manual_hi else '') + format_colour_value(hi, mode))]


SIZE_KEY_LABEL_GAP = 6
_SIZE_KEY_TITLE_GAP = 4
_SIZE_KEY_TITLE_LINE_GAP = 2
_SIZE_KEY_TITLE_MIN_CHARS = 14


def wrap_key_title(title, max_chars):
    """SizeKey.svelte wrapKeyTitle: greedy lines of at most max_chars at spaces."""
    lines, line = [], ''
    for w in [w for w in str(title or '').split(' ') if w != '']:
        if line and len(line) + 1 + len(w) > max_chars:
            lines.append(line)
            line = w
        else:
            line = f'{line} {w}' if line else w
    if line:
        lines.append(line)
    return lines


def size_key_geometry(items, no_value, title, font_px, item_spacing=4):
    """SizeKey.svelte sizeKeyGeometry: the key's footprint, its title lines and its rows, in
    px. The title wraps at the rows' width (14 characters at least); rows run low value first,
    then "no value"; each row as tall as its circle or the text; the circles on one centre
    line as wide as the largest. {'width', 'height', 'colW', 'titleLines': [(text, y)],
    'rows': [(r, label, cy, is_no_value)]}."""
    rows_in = [(r, label, False) for _, r, label in items or []]
    if no_value:
        rows_in.append((no_value['r'], no_value.get('label') or 'no value', True))
    col_w = 2 * max([0] + [r for r, _, _ in rows_in])
    label_w = max([0] + [len(str(lab)) * font_px * 0.6 for _, lab, _ in rows_in])
    rows_w = col_w + SIZE_KEY_LABEL_GAP + label_w if rows_in else 0
    max_chars = max(_SIZE_KEY_TITLE_MIN_CHARS, math.floor(rows_w / (font_px * 0.6)))
    lines = wrap_key_title(title, max_chars) if title else []
    title_lines = [(t, k * (font_px + _SIZE_KEY_TITLE_LINE_GAP)) for k, t in enumerate(lines)]
    title_h = (len(lines) * font_px + (len(lines) - 1) * _SIZE_KEY_TITLE_LINE_GAP
               + _SIZE_KEY_TITLE_GAP) if lines else 0
    y = title_h
    rows = []
    for i, (r, label, nv) in enumerate(rows_in):
        h = max(2 * r, font_px)
        rows.append((r, label, y + h / 2, nv))
        y += h + (item_spacing if i < len(rows_in) - 1 else 0)
    width = max([rows_w] + [len(t) * font_px * 0.6 for t in lines])
    return {'width': width, 'height': y, 'colW': col_w, 'titleLines': title_lines,
            'rows': rows}


def place_key(position, box_w, box_h, plot_w, plot_h, margin, has_right_axis=False,
              padding_right=0, stack=(), custom=None, inset=0):
    """encodingHost.js placeKey: (x, y, max_length) of a key (not its backdrop), in px from
    the plot area's top left; `stack` the boxes placed before it ({'x', 'y', 'w', 'h',
    'outside', 'corner'}). Beside the plot ('right') it goes under every box already in the
    right margin; in a corner, past the boxes in that corner, its room capped by a box at
    the other end it would run into; 'custom' at the fractions."""
    if position == 'right':
        x = plot_w + (padding_right if has_right_axis else 0) + margin
        y = 0
        for b in stack or ():
            if b and b.get('outside'):
                y = max(y, b['y'] + b['h'] + margin)
        return x, y, max(0, plot_h - y)
    w, h = box_w + 2 * inset, box_h + 2 * inset
    if position == 'custom':
        c = custom or {}
        fx = min(1, max(0, c.get('customX') or 0))
        fy = min(1, max(0, c.get('customY') or 0))
        bx = margin + max(0, plot_w - w - 2 * margin) * fx
        by = margin + max(0, plot_h - h - 2 * margin) * fy
        return bx + inset, by + inset, max(0, plot_h - 2 * margin - 2 * inset)
    left = position in ('topleft', 'bottomleft')
    bottom = position in ('bottomright', 'bottomleft')
    x = margin if left else plot_w - w - margin
    inside = [b for b in stack or () if b and not b.get('outside')]
    same = [b for b in inside if b.get('corner') == position]
    far = [b for b in inside if b.get('corner') and b['corner'].startswith('bottom') != bottom
           and b['x'] < x + w and x < b['x'] + b['w']]
    if bottom:
        floor = (min(b['y'] for b in same) - margin) if same else plot_h - margin
        ceiling = (max(b['y'] + b['h'] for b in far) + margin) if far else margin
        y = floor - h
        max_len = max(0, floor - ceiling)
    else:
        y = (max(b['y'] + b['h'] for b in same) + margin) if same else margin
        floor = (min(b['y'] for b in far) - margin) if far else plot_h - margin
        max_len = max(0, floor - y)
    return x + inset, y + inset, max(0, max_len - 2 * inset)

# ---- Series marks: a series' line and points as the app draws them -----------------------
#
# The app saves them as LineClass.toJSON {colour, strokeWidth, stroke, draw, joinGaps}
# (components/plotbits/Line.svelte) and PointsClass.toJSON {colour, radius, shape, draw}
# (Points.svelte). No writer ever saved `show`, `width` or `size` (checked over the
# history of both classes and the MCP normaliser), which is what this port used to read,
# so every exported scatterplot drew a width-1 line and no points.
#
# Units: the app draws in CSS px, matplotlib in typographic points; 1 in = 96 px = 72 pt.

_PX_TO_PT = 0.75

# The class constructors' defaults (`dataIN?.x ?? default`), for a series saved without them.
_LINE_DEFAULTS = {'strokeWidth': 3, 'stroke': 'solid', 'draw': True, 'joinGaps': False}
_POINTS_DEFAULTS = {'radius': 4, 'shape': 'circle', 'draw': True}

# pointShapes.js POINT_SHAPES.
POINT_SHAPES = ('circle', 'triangle', 'square', 'star', 'cross', 'x')


def _with_defaults(saved, defaults):
    saved = saved or {}
    return {k: (saved.get(k) if saved.get(k) is not None else d) for k, d in defaults.items()}


def _app_marker_vertices(shape):
    """pointShapes.js getPointPath(shape, 0, 0, 1) as vertices, y UP (matplotlib), for the
    polygon shapes; None for the circle (an SVG arc, matplotlib's 'o')."""
    if shape == 'square':
        pts = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    elif shape == 'triangle':
        h = math.sqrt(3) / 2
        pts = [(0, -1), (h, 0.5), (-h, 0.5)]
    elif shape == 'star':
        inner = 0.3819660113
        pts = []
        for i in range(10):
            rad = 1 if i % 2 == 0 else inner
            ang = -math.pi / 2 + i * math.pi / 5
            pts.append((rad * math.cos(ang), rad * math.sin(ang)))
    elif shape in ('cross', 'x'):
        t = 1 / 3
        base = [(-t, -t), (-t, -1), (t, -1), (t, -t), (1, -t), (1, t), (t, t), (t, 1),
                (-t, 1), (-t, t), (-1, t), (-1, -t)]
        sin, cos = (math.sqrt(0.5), math.sqrt(0.5)) if shape == 'x' else (0.0, 1.0)
        pts = [(px * cos - py * sin, px * sin + py * cos) for px, py in base]
    else:
        return None
    return [(x, -y) for x, y in pts]  # SVG y points down


def _scatter_marker(shape, radius_px):
    """(marker, s) for ax.scatter so a marker of the app's `radius` (px) lands at the app's
    size. matplotlib scales a marker to `sqrt(s)` points across its unit box: the circle 'o'
    has radius sqrt(s) / 2, and a custom vertex list is rescaled so its largest |coordinate|
    is 0.5. The app's radius r px is 0.75 r pt, so s = (1.5 r m)^2, m being the largest
    |coordinate| of the shape at r = 1 (1 for the circle; below 1 for the rotated 'x')."""
    verts = _app_marker_vertices(shape if shape in POINT_SHAPES else 'circle')
    r_pt = radius_px * _PX_TO_PT
    if verts is None:
        return 'o', (2 * r_pt) ** 2
    m = max(max(abs(x), abs(y)) for x, y in verts)
    return verts, (2 * r_pt * m) ** 2


def _js_plot_valid(v):
    """One coordinate of Line.svelte's isValid (and the Points filter): `v != null &&
    !isNaN(v)`. isNaN coerces with Number(), as _js_number does; a datetime is valid unless
    it is NaT."""
    if v is None:
        return False
    if isinstance(v, (pd.Timestamp, np.datetime64)) or hasattr(v, 'tzinfo'):
        return not pd.isna(v)
    try:
        return not math.isnan(_js_number(v))
    except (TypeError, ValueError):
        return False


def _resolved_series_colours(plot, index):
    """The colours the APP resolved for series `index` of a plot ({'line', 'points'}), which
    the export carries as `plot['seriesColours']` (core/exportSeriesColours.js): a series
    with no saved colour takes its column's colour from the session's appearance map, not
    its position, so matplotlib's positional palette would differ from the app."""
    cols = (plot or {}).get('seriesColours') or []
    entry = cols[index] if 0 <= index < len(cols) else None
    return entry if isinstance(entry, dict) else {}


def _x_numbers(ax, xs):
    """x values as the axis's float coordinates (dates become matplotlib date numbers), for
    artists such as LineCollection that do not convert units themselves."""
    if not xs:
        return []
    ax.xaxis.update_units(xs)
    return [float(v) for v in np.asarray(ax.convert_xunits(xs), dtype=float)]


# SVG joins a line's segments with a miter, but past its miter limit (4: a corner sharper
# than about 29 degrees, the steep peaks and dips of a spectrum) with a bevel. Matplotlib's
# Agg miter has no such fallback and leaves a spike there, so the bevel is used throughout:
# exactly SVG's corner where the corner is sharp, and within half a pixel of it elsewhere.
_SVG_LINE_JOIN = 'bevel'


def _draw_series_marks(ax, x, y, series, index, label, resolved=None, colour_by=None,
                       size_by=None, gid_prefix=None):
    """Draw one series' line, then its points, as Line.svelte and Points.svelte do, and
    return the drawn artists (gids `series-<index>-line` / `series-<index>-points`, plus
    `series-<index>-points-novalue` for coloured points with no colour value).

    - `draw` false hides a mark; a missing key takes the class default.
    - Colour: the saved colour, else the colour the app resolved for the series
      (`resolved`, from the session's appearance map; see _resolved_series_colours), else
      `C<index>` (positional, as the app's last-resort palette fallback).
    - The line breaks at every row whose x or y is missing (d3 `defined(isValid)`) unless
      `joinGaps` is on, which drops those rows and bridges straight across. Fewer than two
      valid rows draw no line. No other gap rule exists (none in the app).
    - Widths, dashes and marker sizes keep the app's px lengths (_PX_TO_PT); SVG's default
      butt caps and its miter joins as SVG draws them (_SVG_LINE_JOIN). The points have no
      outline (stroke="none").
    - zorder 2 for both, so series stack in the app's order (each series' line under its
      points) between the bands (0.5) and the reference lines (2.5).
    - Colour by (`colour_by` = {'idx': bucket per row, 'palette': the 64 bucket colours,
      'line': colour the line too}): each point takes its row's bucket colour; a point with
      no colour value is drawn in the series colour, underneath (Points.svelte draws "no
      value" first, then the buckets in order). A coloured line is a LineCollection of
      segments (colouredLine.js): each takes its starting row's colour (the series line
      colour when that row has no value), solid, round caps and joins.
    - Size by (`size_by` = {'r': radius per row, 'layer': drawing layer per row,
      'no_value_layer'}): every point at its own exact radius (s = (1.5 r m)^2 per point,
      _scatter_marker), in ONE collection whose points run in the app's drawing order:
      largest layer first, within a layer "no value" colour first then the buckets, rows in
      data order (markerPaths.js). A row past the size column's end keeps the series radius.
    The label goes on the line when it is drawn, else on the points. That artist carries the
    app's legend swatch (`_ancir_legend_handle`: the line with the marker on it, the points
    grey when coloured by a column), which _legend_with_overlays uses in its place."""
    from matplotlib.lines import Line2D
    gp = gid_prefix or f'series-{index}'
    line = _with_defaults(series.get('line'), _LINE_DEFAULTS)
    points = _with_defaults(series.get('points'), _POINTS_DEFAULTS)
    resolved = resolved or {}
    auto = f'C{index}'
    line_colour = _mpl_colour((series.get('line') or {}).get('colour')
                              or resolved.get('line'), auto)
    points_colour = _mpl_colour((series.get('points') or {}).get('colour')
                                or resolved.get('points'), auto)
    drawn = {'line': None, 'points': None, 'points_novalue': None}
    n = min(len(x), len(y))
    valid = [_js_plot_valid(x[i]) and _js_plot_valid(y[i]) for i in range(n)]
    rows = [i for i in range(n) if valid[i]]
    idx = list((colour_by or {}).get('idx') or [])
    # Bucket colours are (r, g, b) 0..255; Category's are the app's CSS colours (hex, with
    # alpha for a translucent palette entry).
    palette = [tuple(v / 255 for v in c) if isinstance(c, (tuple, list)) else _mpl_colour(c)
               for c in ((colour_by or {}).get('palette') or [])]
    coloured = colour_by is not None and bool(palette)
    coloured_line = coloured and bool(colour_by.get('line'))

    def bucket(i):
        b = idx[i] if i < len(idx) else NO_COLOUR_VALUE
        return b if 0 <= b < len(palette) else NO_COLOUR_VALUE

    width = line['strokeWidth']
    if line['draw'] and len(rows) >= 2 and coloured_line:
        from matplotlib.collections import LineCollection
        groups = coloured_line_segments(x, y, idx, k=len(palette), join_gaps=line['joinGaps'])
        used = sorted({i for g in groups for seg in g for i in seg})
        xnum = dict(zip(used, _x_numbers(ax, [x[i] for i in used])))
        segs, colours = [], []
        for g, members in enumerate(groups):
            c = line_colour if g == 0 else palette[g - 1]
            for a, b in members:
                segs.append([(xnum[a], _js_number(y[a])), (xnum[b], _js_number(y[b]))])
                colours.append(c)
        lc = LineCollection(segs, colors=colours, linewidths=width * _PX_TO_PT,
                            linestyles='solid', capstyle='round', joinstyle='round',
                            zorder=2, gid=f'{gp}-line', label=label)
        ax.add_collection(lc, autolim=True)
        ax.autoscale_view()
        drawn['line'] = lc
    elif line['draw'] and len(rows) >= 2:
        if line['joinGaps']:
            lx = [x[i] for i in rows]
            ly = [_js_number(y[i]) for i in rows]
        else:
            # A missing row keeps a placeholder x (the nearest earlier valid one, so a time
            # axis never sees NaT) and a NaN y, which is where matplotlib breaks the line.
            lx, ly, last = [], [], x[rows[0]]
            for i in range(n):
                if valid[i]:
                    last = x[i]
                    lx.append(x[i])
                    ly.append(_js_number(y[i]))
                else:
                    lx.append(last)
                    ly.append(float('nan'))
        (drawn['line'],) = ax.plot(
            lx, ly, color=line_colour,
            linewidth=width * _PX_TO_PT, linestyle=_overlay_dashes(line['stroke'], width),
            solid_capstyle='butt', solid_joinstyle=_SVG_LINE_JOIN, dash_capstyle='butt',
            dash_joinstyle=_SVG_LINE_JOIN, zorder=2, gid=f'{gp}-line', label=label)
    marker, size = _scatter_marker(points['shape'], points['radius'])
    if points['draw'] and rows:
        point_label = '_nolegend_' if drawn['line'] is not None else label
        common = dict(marker=marker, s=size, linewidths=0, edgecolors='none', zorder=2)
        if size_by is not None:
            radii = list(size_by.get('r') or [])
            layers = list(size_by.get('layer') or [])
            nv_layer = size_by.get('no_value_layer', 0)

            def group(i):
                b = bucket(i) if coloured else NO_COLOUR_VALUE
                return 0 if b == NO_COLOUR_VALUE else b + 1
            order = sorted(rows, key=lambda i: (-(layers[i] if i < len(layers) else nv_layer),
                                                group(i)))
            sizes = [_scatter_marker(points['shape'],
                                     radii[i] if i < len(radii) else points['radius'])[1]
                     for i in order]
            colours = [palette[group(i) - 1] if group(i) > 0 else points_colour for i in order]
            drawn['points'] = ax.scatter(
                [x[i] for i in order], [_js_number(y[i]) for i in order],
                color=colours, gid=f'{gp}-points', label=point_label,
                **{**common, 's': sizes})
        elif coloured:
            none_rows = [i for i in rows if bucket(i) == NO_COLOUR_VALUE]
            # Buckets in index order, rows in data order within a bucket (one path each).
            col_rows = sorted((i for i in rows if bucket(i) != NO_COLOUR_VALUE), key=bucket)
            if none_rows:
                drawn['points_novalue'] = ax.scatter(
                    [x[i] for i in none_rows], [_js_number(y[i]) for i in none_rows],
                    color=points_colour, gid=f'{gp}-points-novalue',
                    label=point_label if not col_rows else '_nolegend_', **common)
            if col_rows:
                drawn['points'] = ax.scatter(
                    [x[i] for i in col_rows], [_js_number(y[i]) for i in col_rows],
                    color=[palette[bucket(i)] for i in col_rows],
                    gid=f'{gp}-points', label=point_label, **common)
        else:
            drawn['points'] = ax.scatter(
                [x[i] for i in rows], [_js_number(y[i]) for i in rows],
                color=points_colour, gid=f'{gp}-points', label=point_label,
                **common)
    # The legend swatch (Scatterplot getLegendItem, drawn by Legend.svelte): the line, with
    # the series' marker at its centre when the points are shown too. Coloured by a column,
    # the swatch is a neutral grey in the series' shape (the colour bar is the key).
    show_line = drawn['line'] is not None
    show_points = drawn['points'] is not None or drawn['points_novalue'] is not None
    if show_line or show_points:
        grey = _mpl_colour(COLOUR_BY_SWATCH)
        handle = Line2D(
            [], [], color=(grey if coloured_line else line_colour) if show_line else 'none',
            linewidth=width * _PX_TO_PT if show_line else 0,
            linestyle=('solid' if coloured_line else _overlay_dashes(line['stroke'], width))
            if show_line else 'None',
            marker=marker if show_points else 'None', markersize=math.sqrt(size),
            markerfacecolor=grey if coloured else points_colour, markeredgecolor='none',
            markeredgewidth=0)
        owner = drawn['line'] or drawn['points'] or drawn['points_novalue']
        owner._ancir_legend_handle = handle
        drawn['legend_handle'] = handle
    return drawn


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


# plots/logAxis.js: the log value axis of the Periodogram (power) and the FFT (magnitude). The
# lower end follows the smallest positive value drawn (lowered by 5% of the decades shown,
# never below 1e-6), a user minimum wins, and ticks read as plain numbers (0.01, not 10^-2).
LOG_AXIS_FLOOR = 1e-6


def log_axis_domain(user_min, min_positive, hi):
    """logAxis.js logAxisDomain."""
    top = hi if (hi is not None and math.isfinite(hi) and hi > 0) else 1.0
    if user_min is not None and user_min > 0:
        lo = user_min
    elif min_positive is not None and math.isfinite(min_positive) and 0 < min_positive < top:
        lo = min_positive / (top / min_positive) ** 0.05
    else:
        lo = top / 10
    lo = max(lo, LOG_AXIS_FLOOR)
    if not top > lo:
        top = lo * 10
    return lo, top


def _min_positive(*arrays):
    m = math.inf
    for a in arrays:
        for v in a or []:
            if v is not None and isinstance(v, (int, float)) and math.isfinite(v) and 0 < v < m:
                m = v
    return m


def _plain_number(v):
    """A tick value as a plain number (d3 '~g' on the app's log axis): 0.001, 1, 1000."""
    if v == 0 or not math.isfinite(v):
        return ''
    if abs(v) >= 1e15:
        return f'{v:g}'
    return f'{v:.12f}'.rstrip('0').rstrip('.')


def _apply_log_axis(ax, ylims_in, values):
    """After _apply_axes(ylog=True): the app's log domain (log_axis_domain) and plain tick
    labels. `values` are the values drawn on the axis; the top stays the plotted top unless
    the user set one."""
    from matplotlib.ticker import FuncFormatter, NullFormatter
    user = list(ylims_in or [None, None]) + [None, None]
    hi = user[1] if user[1] is not None else ax.get_ylim()[1]
    lo, top = log_axis_domain(user[0], _min_positive(values), hi)
    ax.set_ylim(lo, top)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _pos: _plain_number(v)))
    ax.yaxis.set_minor_formatter(NullFormatter())


# ----------------------------------------------------------------------
# Plot overlays: reference LINES and shaded BANDS (overlays plan 2026-10-15, step 5)
#
# A port of the app's overlay model: the channel table and host capabilities
# (components/plotbits/overlaySpec.js), OverlayClass's constructor, values / positions /
# geometry (components/plotbits/Overlay.svelte) and overlaysFromJSON / fromLegacyNightBand
# (components/plotbits/overlayHost.js), so an exported figure carries the same marks at the
# same data values as the app:
#
# - a form the host does not allow is coerced to the host's first form of that kind, and an
#   overlay whose kind the host does not allow is dropped;
# - a line's `at` positions are collapsed to finite uniques and cut at OVERLAY_POSITION_CAP;
#   paired channels (start/end, lower/upper) are deduped per PAIR, then cut (so a band column
#   repeated on every row keeps all of its bands, not those in its first 50 rows); a
#   ribbon draws only when x, lower and upper hold the same number of values;
# - repeating bands use NightBand's maths: anchored at the data minimum when `useDataMin`
#   (continued backwards to the axis), hours scaled to ms on a time axis;
# - x channels on a scatterplot's time axis go through the host's overlayXValueFor (an
#   hours-from-origin column lands on the time axis as series x does); an FFT's vertical
#   positions are periods in hours, drawn at 1/p in frequency mode (overlayXTransform).
#
# Drawing (_draw_overlays): bands BENEATH the series (zorder 0.5), lines ABOVE them (2.5);
# axvline / axhline per position, axvspan / axhspan per segment (an edge is the two data
# edges, never the plot sides), fill_between for a ribbon. A host widens only the axes in
# its `domain` (matplotlib's autoscale does it); the others are restored, so an overlay never
# changes a periodogram's period range or a correlogram's lag range. Labelled overlays get
# a legend entry (a proxy handle, so one entry per overlay however many marks it draws).
# Every drawn artist carries gid `overlay-<id>`.
# ----------------------------------------------------------------------

OVERLAY_POSITION_CAP = 50

# overlaySpec.js CHANNEL_TABLE: (key, axis) per (kind, form), in panel order.
_OVERLAY_CHANNELS = {
    'line': {
        'vertical': (('at', 'x'),),
        'horizontal': (('at', 'y'),),
    },
    'band': {
        'ribbon': (('x', 'x'), ('lower', 'y'), ('upper', 'y')),
        'horizontal': (('lower', 'y'), ('upper', 'y')),
        'vertical': (('start', 'x'), ('end', 'x')),
        'repeating': (),
    },
}
_OVERLAY_FORMS = {
    'line': ('vertical', 'horizontal'),
    'band': ('ribbon', 'horizontal', 'vertical', 'repeating'),
}

# Each rendered host's `static overlayCapabilities` (forms in the host's panel order; the
# first is the default) and the axes whose automatic range an overlay may widen. Pinned to
# the app by test_plot_overlays.py against mcp/src/emit/session-schema.generated.json.
# Histogram, Q-Q plot, Mean +/- SEM and CWT carry overlays in the app but are not rendered
# by this runtime (render_plots skips them).
OVERLAY_CAPABILITIES = {
    'scatterplot': {'line': ('vertical', 'horizontal'),
                    'band': ('ribbon', 'horizontal', 'vertical', 'repeating'),
                    'domain': ('x', 'y')},
    'periodogram': {'line': ('vertical', 'horizontal'),
                    'band': ('vertical', 'horizontal', 'ribbon'),
                    'domain': ('y',)},
    'correlogram': {'line': ('vertical', 'horizontal'),
                    'band': ('vertical', 'horizontal'),
                    'domain': ('y',)},
    'fft': {'line': ('vertical', 'horizontal'),
            'band': ('vertical', 'horizontal'),
            'domain': ('y',)},
    'boxplot': {'line': ('horizontal',),
                'band': ('horizontal',),
                'domain': ('y',)},
    # CWTClass: period marks only, and nothing widens (the period range is the transform's).
    'cwt': {'line': ('horizontal',), 'band': ('horizontal',), 'domain': ()},
}

_OVERLAY_LINE_PALETTE = ('#2C2C2C', '#C0392B', '#2980B9', '#27AE60', '#8E44AD')
_OVERLAY_BAND_FILL_DEFAULT = '#2C2C2C30'  # the NightBand grey
_OVERLAY_RIBBON_FILL_FALLBACK = '#4682B430'
_OVERLAY_EDGE_COLOUR_DEFAULT = '#2C2C2C'
_MS_PER_HOUR = 3600000
_MS_PER_DAY = 86400000


def _nn(v, default):
    """JS `v ?? default`."""
    return default if v is None else v


def _overlay_to_finite(v):
    """Overlay.svelte toFinite: the house rule (stats.js isInvalidValue), then Number();
    +-Infinity is not a position either."""
    if _js_invalid(v):
        return None
    n = _js_number(v)
    return n if math.isfinite(n) else None


def _overlay_allowed_forms(caps, kind):
    """overlaySpec.js allowedForms: the forms of `kind` the host allows, host order; caps
    None means no restriction."""
    known = _OVERLAY_FORMS.get(kind)
    if not known:
        return []
    if caps is None:
        return list(known)
    return [f for f in (caps.get(kind) or ()) if f in known]


def _overlay_with_alpha(hex_colour, alpha_byte):
    if isinstance(hex_colour, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', hex_colour):
        return hex_colour + alpha_byte
    return None


def _overlay_default_fill(form, series_colour):
    """OverlayClass.defaultFillFor: a ribbon borrows the host's series colour."""
    if form != 'ribbon':
        return _OVERLAY_BAND_FILL_DEFAULT
    return _overlay_with_alpha(series_colour, '33') or _OVERLAY_RIBBON_FILL_FALLBACK


def _overlay_new(j, caps, overlays_so_far, series_colour=None):
    """OverlayClass constructor over saved JSON: a plain dict, or None when the host does not
    allow the overlay's kind (overlaysFromJSON drops it)."""
    j = j or {}
    kind = 'band' if j.get('kind') == 'band' else 'line'
    allowed = _overlay_allowed_forms(caps, kind)
    if not allowed:
        return None
    form = j.get('form') if j.get('form') in allowed else allowed[0]
    same_kind = sum(1 for o in overlays_so_far if o.get('kind') == kind)
    saved_channels = j.get('channels') or {}
    channels = {}
    for key, _axis in _OVERLAY_CHANNELS[kind][form]:
        saved = saved_channels.get(key) or {}
        cols = [c.get('refId') for c in (saved.get('columns') or [])
                if isinstance(c, dict) and c.get('refId') is not None][:1]
        typed = [t for t in (_overlay_to_finite(v) for v in (saved.get('typed') or []))
                 if t is not None]
        channels[key] = {'columns': cols, 'typed': typed}
    return {
        'id': j.get('id'),
        'name': _nn(j.get('name'), f"{'Line' if kind == 'line' else 'Band'} {same_kind + 1}"),
        'kind': kind,
        'form': form,
        'enabled': _nn(j.get('enabled'), True),
        'label': _nn(j.get('label'), ''),
        'colour': _nn(j.get('colour'),
                      _OVERLAY_LINE_PALETTE[same_kind % len(_OVERLAY_LINE_PALETTE)]),
        'strokeWidth': _nn(j.get('strokeWidth'), 1.5),
        'stroke': _nn(j.get('stroke'), '5, 5'),
        'fill': _nn(j.get('fill'), _overlay_default_fill(form, series_colour)),
        'edge': _nn(j.get('edge'), False),
        'edgeColour': _nn(j.get('edgeColour'), _OVERLAY_EDGE_COLOUR_DEFAULT),
        'edgeWidth': _nn(j.get('edgeWidth'), 1),
        'repeatEveryHours': _nn(j.get('repeatEveryHours'), 24),
        'nightDurationHours': _nn(j.get('nightDurationHours'), 12),
        'startTimeHours': _nn(j.get('startTimeHours'), 0),
        'useDataMin': _nn(j.get('useDataMin'), True),
        'channels': channels,
    }


def _overlay_from_legacy_night_band(nb, caps, overlays_so_far, x_is_time):
    """OverlayClass.fromLegacyNightBand: mode 'repeating' -> a repeating band, 'custom' -> a
    vertical band typed from `customBands` (`{startTime, durationHours}` or the older
    `{startTime, endTime}`; durations scale to ms on a time axis)."""
    nb = nb or {}
    base = {'kind': 'band', 'name': _nn(nb.get('name'), 'Night'),
            'fill': _nn(nb.get('colour'), _OVERLAY_BAND_FILL_DEFAULT),
            'enabled': _nn(nb.get('enabled'), True)}
    if nb.get('mode') != 'custom':
        return _overlay_new({**base, 'form': 'repeating',
                             'repeatEveryHours': _nn(nb.get('repeatEveryHours'), 24),
                             'nightDurationHours': _nn(nb.get('nightDurationHours'), 12),
                             'startTimeHours': _nn(nb.get('startTimeHours'), 0),
                             'useDataMin': _nn(nb.get('useDataMin'), True)},
                            caps, overlays_so_far)
    ms_per_unit = _MS_PER_HOUR if x_is_time else 1
    start, end = [], []
    for band in nb.get('customBands') or []:
        band = band or {}
        s = _overlay_to_finite(band.get('startTime'))
        if s is None:
            continue
        e = _overlay_to_finite(band.get('endTime'))
        dur = _overlay_to_finite(band.get('durationHours'))
        if dur is not None:
            e = s + dur * ms_per_unit
        if e is None or not (e > s):
            continue
        start.append(s)
        end.append(e)
    return _overlay_new({**base, 'form': 'vertical',
                         'channels': {'start': {'typed': start}, 'end': {'typed': end}}},
                        caps, overlays_so_far)


def _overlays_from_plot(plot_inner, caps, *, legacy_night_bands=False, x_is_time=False,
                        series_colour=None):
    """overlayHost.js overlaysFromJSON over a saved plot's inner JSON: the overlays as plain
    dicts, in draw order. A Line saved with several `at` columns (before 2026-09-18) becomes
    one Line per column (OverlayClass.fromJSONSplit); with `legacy_night_bands` the
    pre-overlay `nightBands` list follows as band overlays (Scatterplot only)."""
    out = []
    for j in plot_inner.get('overlays') or []:
        first = _overlay_new(j, caps, out, series_colour)
        if first is None:
            continue
        saved = [c for c in (((j or {}).get('channels') or {}).get('at') or {}).get('columns')
                 or [] if isinstance(c, dict) and c.get('refId') is not None]
        out.append(first)
        if first['kind'] != 'line' or len(saved) <= 1:
            continue
        line_count = sum(1 for o in out if o['kind'] == 'line')
        for i, c in enumerate(saved[1:]):
            copy = dict(first, channels={'at': {'columns': [c['refId']], 'typed': []}},
                        id=None, name=f'Line {line_count + i + 1}')
            out.append(copy)
    if legacy_night_bands:
        for nb in plot_inner.get('nightBands') or []:
            ov = _overlay_from_legacy_night_band(nb, caps, out, x_is_time)
            if ov is not None:
                out.append(ov)
    return out


def _overlay_channel_axis(overlay, key):
    for k, axis in _OVERLAY_CHANNELS[overlay['kind']].get(overlay['form'], ()):
        if k == key:
            return axis
    return None


def _overlay_values(overlay, key, columns_index, x_value_for=None):
    """OverlayClass.values: the finite numbers a channel provides, in order. A wired column's
    data (house-rule invalid cells skipped; an x channel goes through the host's
    overlayXValueFor when it has one), else the typed list."""
    ch = overlay['channels'].get(key)
    if not ch:
        return []
    if not ch['columns']:
        return list(ch['typed'])
    col = columns_index.get(ch['columns'][0])
    data = (col.get_data() if col is not None else None) or []
    to_axis = (x_value_for(col) if (x_value_for is not None and col is not None
                                    and _overlay_channel_axis(overlay, key) == 'x') else None)
    out = []
    for raw in data:
        v = _overlay_to_finite(raw)
        if v is None:
            continue
        out.append(to_axis(v) if to_axis else v)
    return out


def _overlay_uniques(values):
    seen = set()
    out = []
    for v in values:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _overlay_positions(overlay, key, columns_index, x_value_for=None):
    """OverlayClass.positions: a line's `at` collapsed to uniques and capped; ribbon channels
    whole. Paired channels go through _overlay_paired_segments (deduped, then capped)."""
    vals = _overlay_values(overlay, key, columns_index, x_value_for)
    if overlay['form'] == 'ribbon':
        return vals
    base = _overlay_uniques(vals) if (overlay['kind'] == 'line' and key == 'at') else vals
    return base[:OVERLAY_POSITION_CAP]


def _overlay_paired_segments(overlay, k0, k1, n0, n1, columns_index, x_value_for=None):
    """OverlayClass #pairedSegments: k0[i] with k1[i], ordered, empty pairs skipped, repeats
    dropped, THEN cut at OVERLAY_POSITION_CAP bands."""
    a = _overlay_values(overlay, k0, columns_index, x_value_for)
    b = _overlay_values(overlay, k1, columns_index, x_value_for)
    seen = set()
    out = []
    for i in range(min(len(a), len(b))):
        lo, hi = min(a[i], b[i]), max(a[i], b[i])
        if not (hi > lo):
            continue  # an empty pair draws nothing
        if (lo, hi) in seen:
            continue
        seen.add((lo, hi))
        out.append({n0: lo, n1: hi})
    return out[:OVERLAY_POSITION_CAP]


def _overlay_repeating_segments(overlay, ctx):
    """NightBand's repeating maths, as OverlayClass #repeatingSegments: `startTimeHours` is
    in AXIS units (ms on a time axis), duration and period are hours (scaled to ms there)."""
    min_x, max_x = ctx.get('xDomainMin'), ctx.get('xDomainMax')
    is_time = bool(ctx.get('xIsTime'))
    if not (_is_finite_number(min_x) and _is_finite_number(max_x)):
        return []
    dur = overlay['nightDurationHours']
    every = overlay['repeatEveryHours']
    band_width = dur * _MS_PER_HOUR if is_time else dur
    step = every * _MS_PER_HOUR if is_time else every
    if not (step > 0) or not (band_width > 0):
        return []
    if overlay['useDataMin']:
        band_start = _nn(ctx.get('xAnchorMin'), min_x)
    else:
        band_start = overlay['startTimeHours']
    if overlay['useDataMin'] and _is_finite_number(band_start) and band_start > min_x:
        band_start -= math.ceil((band_start - min_x) / step) * step
    if not _is_finite_number(band_start):
        return []
    segments = []
    while band_start < max_x:
        band_end = band_start + band_width
        if band_end > min_x and band_start < max_x:
            segments.append({'x0': max(band_start, min_x), 'x1': min(band_end, max_x)})
        band_start += step
    return segments


def _is_finite_number(v):
    return (isinstance(v, (int, float, np.integer, np.floating))
            and not isinstance(v, bool) and math.isfinite(v))


def _overlay_geometry(overlay, columns_index, ctx=None, x_value_for=None, x_transform=None):
    """OverlayClass.geometry: what to draw, in AXIS units.

      line            -> {kind:'line', orientation, positions}
      band vertical   -> {kind:'band', form, segments:[{x0,x1}]}
      band repeating  -> {kind:'band', form, segments:[{x0,x1}]}  (needs ctx)
      band horizontal -> {kind:'band', form, segments:[{y0,y1}]}
      band ribbon     -> {kind:'band', form, x, lower, upper}      (equal lengths, or all empty)

    `x_transform(v)` maps a stored x to the axis (None drops it; FFT: 1/p in frequency mode);
    repeating bands are built in axis units and never go through it."""
    ctx = ctx or {}

    def tx(v):
        if x_transform is None:
            return v
        ax = x_transform(v)
        return ax if _is_finite_number(ax) else None

    def pos(key):
        return _overlay_positions(overlay, key, columns_index, x_value_for)

    if overlay['kind'] == 'line':
        at = pos('at')
        if overlay['form'] == 'vertical':
            at = [a for a in (tx(v) for v in at) if a is not None]
        return {'kind': 'line', 'orientation': overlay['form'], 'positions': at}
    form = overlay['form']
    if form == 'vertical':
        segs = []
        for s in _overlay_paired_segments(overlay, 'start', 'end', 'x0', 'x1',
                                          columns_index, x_value_for):
            a, b = tx(s['x0']), tx(s['x1'])
            if a is None or b is None:
                continue
            segs.append({'x0': min(a, b), 'x1': max(a, b)})  # 1/p reverses the edges
        return {'kind': 'band', 'form': 'vertical', 'segments': segs}
    if form == 'horizontal':
        return {'kind': 'band', 'form': 'horizontal',
                'segments': _overlay_paired_segments(overlay, 'lower', 'upper', 'y0', 'y1',
                                                     columns_index, x_value_for)}
    if form == 'repeating':
        return {'kind': 'band', 'form': 'repeating',
                'segments': _overlay_repeating_segments(overlay, ctx)}
    x, lower, upper = pos('x'), pos('lower'), pos('upper')
    empty = {'kind': 'band', 'form': 'ribbon', 'x': [], 'lower': [], 'upper': []}
    if len(x) != len(lower) or len(x) != len(upper) or not x:
        return empty
    out = dict(empty, x=[], lower=[], upper=[])
    for i, v in enumerate(x):
        a = tx(v)
        if a is None:
            continue  # dropped from all three channels, so they stay parallel
        out['x'].append(a)
        out['lower'].append(lower[i])
        out['upper'].append(upper[i])
    return out


def _overlay_extent(values):
    return (min(values), max(values)) if values else None


def _overlay_domain_extension(overlay, geometry):
    """OverlayClass.domainExtension: {'x': (lo, hi)|None, 'y': ...} from what is drawn;
    nothing when disabled, and never for a repeating band."""
    none = {'x': None, 'y': None}
    if not overlay['enabled'] or overlay['form'] == 'repeating':
        return none
    g = geometry
    if g['kind'] == 'line':
        ext = _overlay_extent(g['positions'])
        return {'x': ext, 'y': None} if g['orientation'] == 'vertical' else {'x': None, 'y': ext}
    if g['form'] == 'ribbon':
        return {'x': _overlay_extent(g['x']), 'y': _overlay_extent(g['lower'] + g['upper'])}
    if g['form'] == 'vertical':
        return {'x': _overlay_extent([v for s in g['segments'] for v in (s['x0'], s['x1'])]),
                'y': None}
    return {'x': None,
            'y': _overlay_extent([v for s in g['segments'] for v in (s['y0'], s['y1'])])}


def _overlay_dashes(stroke, width):
    """A Line.svelte `stroke` (an SVG dasharray: 'solid', '5, 5', '2, 2', '5, 2') as a
    matplotlib linestyle. Matplotlib scales dashes by the line width, so the pattern is
    divided by it to keep the app's absolute lengths."""
    if not isinstance(stroke, str) or stroke.strip() in ('', 'solid', 'none'):
        return '-'
    try:
        parts = [float(t) for t in re.split(r'[\s,]+', stroke.strip()) if t]
    except ValueError:
        return '-'
    if not parts or any(not math.isfinite(v) or v < 0 for v in parts) or sum(parts) <= 0:
        return '-'
    if len(parts) % 2:
        parts = parts * 2  # SVG repeats an odd list
    w = width if width and width > 0 else 1
    return (0, tuple(v / w for v in parts))


def _overlay_colour(c, fallback):
    from matplotlib.colors import is_color_like
    return c if isinstance(c, str) and is_color_like(c) else fallback


def _ms_to_datenum(ms):
    """Epoch ms (the app's time axis) to a matplotlib date number."""
    import matplotlib.dates as mdates
    return mdates.date2num(pd.Timestamp(0, unit='ms', tz='UTC')) + ms / _MS_PER_DAY


def _datenum_to_ms(num):
    import matplotlib.dates as mdates
    return (num - mdates.date2num(pd.Timestamp(0, unit='ms', tz='UTC'))) * _MS_PER_DAY


def _draw_overlays(ax, plot, columns_index, x_transform=None, *, host=None,
                   x_value_for=None, x_is_time=False, x_data_extent=None, xlims_in=None,
                   xlog=False, ylog=False, legacy_night_bands=False, series_colour=None,
                   x_domain=None):
    """Draw a plot's overlays onto `ax` (call it after the series, before the manual limits
    are applied). `host` is the plot type (its OVERLAY_CAPABILITIES entry; defaults to
    plot['type']). Scatterplot only: `x_value_for(col)` (overlayXValueFor), `x_is_time` (x
    is epoch ms, drawn on a date axis), `x_data_extent` (the series' [floor min, ceil max] x,
    for the repeating-band anchor), `xlims_in` (manual x limits), `legacy_night_bands` and
    `x_domain(extent)` (the host's x domain, app units, given the other overlays' extent:
    the visible range a repeating band is clamped to).
    Positions <= 0 on a log axis draw nothing, as in the app.

    Returns {'legend': [(handle, label)], 'artists': {index: [artist, ...]}, 'y_values':
    [...]} with the overlays' legend entries (proxy handles, not on the axes) in draw order,
    and the y values of the marks drawn on the y axis (for a log axis's lower end)."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch

    p = plot.get('plot', {}) or {}
    caps = OVERLAY_CAPABILITIES.get(host or plot.get('type'))
    overlays = _overlays_from_plot(p, caps, legacy_night_bands=legacy_night_bands,
                                   x_is_time=x_is_time, series_colour=series_colour)
    result = {'legend': [], 'artists': {}, 'y_values': [], 'extent': {}}
    if not overlays:
        return result
    domain = (caps or {}).get('domain', ('x', 'y'))
    saved_xlim = ax.get_xlim() if 'x' not in domain else None
    saved_ylim = ax.get_ylim() if 'y' not in domain else None

    def to_x(v):
        return _ms_to_datenum(v) if x_is_time else v

    def placeable(v, log):
        return v > 0 if log else True

    geoms = {}
    for i, ov in enumerate(overlays):
        if ov['enabled'] and ov['form'] != 'repeating':
            geoms[i] = _overlay_geometry(ov, columns_index, None, x_value_for, x_transform)

    def draw(i, ov, g):
        gid = f"overlay-{ov['id'] if ov['id'] is not None else i}"
        arts = []
        if g['kind'] == 'line':
            width = ov['strokeWidth']
            # Widths are the app's px (Line.svelte), drawn at the same length as the series.
            style = dict(color=_overlay_colour(ov['colour'], '#2C2C2C'),
                         linewidth=width * _PX_TO_PT,
                         linestyle=_overlay_dashes(ov['stroke'], width), zorder=2.5,
                         label='_nolegend_', gid=gid)
            for v in g['positions']:
                if g['orientation'] == 'vertical':
                    if placeable(v, xlog):
                        arts.append(ax.axvline(to_x(v), **style))
                elif placeable(v, ylog):
                    arts.append(ax.axhline(v, **style))
                    result['y_values'].append(v)
            return arts
        fill = _overlay_colour(ov['fill'], _OVERLAY_BAND_FILL_DEFAULT)
        edge = dict(color=_overlay_colour(ov['edgeColour'], _OVERLAY_EDGE_COLOUR_DEFAULT),
                    linewidth=ov['edgeWidth'] * _PX_TO_PT, zorder=0.6, label='_nolegend_',
                    gid=gid)
        band = dict(facecolor=fill, edgecolor='none', linewidth=0, zorder=0.5,
                    label='_nolegend_', gid=gid)
        if g['form'] == 'ribbon':
            xs = [to_x(v) for v in g['x']]
            arts.append(ax.fill_between(xs, g['lower'], g['upper'], **band))
            result['y_values'] += list(g['lower']) + list(g['upper'])
            if ov['edge']:
                arts.extend(ax.plot(xs, g['lower'], **edge))
                arts.extend(ax.plot(xs, g['upper'], **edge))
            return arts
        for s in g['segments']:
            if 'y0' in s:
                if not (placeable(s['y0'], ylog) and placeable(s['y1'], ylog)):
                    continue
                arts.append(ax.axhspan(s['y0'], s['y1'], **band))
                result['y_values'] += [s['y0'], s['y1']]
                if ov['edge']:
                    arts.append(ax.axhline(s['y0'], **edge))
                    arts.append(ax.axhline(s['y1'], **edge))
            else:
                if not (placeable(s['x0'], xlog) and placeable(s['x1'], xlog)):
                    continue
                arts.append(ax.axvspan(to_x(s['x0']), to_x(s['x1']), **band))
                if ov['edge']:
                    arts.append(ax.axvline(to_x(s['x0']), **edge))
                    arts.append(ax.axvline(to_x(s['x1']), **edge))
        return arts

    for i, g in geoms.items():
        result['artists'][i] = draw(i, overlays[i], g)
    # The automatic domain's widening (the host's overlayExtent(axis)): every enabled
    # overlay's domainExtension, merged per axis.
    for i, g in geoms.items():
        e = _overlay_domain_extension(overlays[i], g)
        for k in ('x', 'y'):
            if e.get(k):
                cur = result['extent'].get(k)
                result['extent'][k] = (list(e[k]) if cur is None
                                       else [min(cur[0], e[k][0]), max(cur[1], e[k][1])])

    # Restore the axes a host never widens (an analysis range such as the period range).
    if saved_xlim is not None:
        ax.set_xlim(saved_xlim)
    if saved_ylim is not None:
        ax.set_ylim(saved_ylim)

    repeating = [i for i, ov in enumerate(overlays)
                 if ov['enabled'] and ov['form'] == 'repeating']
    if repeating:
        # The host's overlayContext(): the visible x range (manual limits win) and, for a
        # band that follows the data, the data minimum (Scatterplot xlimsUnpadded[0]: the
        # manual minimum, else the series' extent merged with the other overlays').
        manual = list(xlims_in or [None, None]) + [None, None]
        if x_domain is not None:
            lo, hi = x_domain(result['extent'])
        else:
            lo, hi = ax.get_xlim()
            if x_is_time:
                lo, hi = _datenum_to_ms(lo), _datenum_to_ms(hi)
            if manual[0] is not None:
                lo = manual[0]
            if manual[1] is not None:
                hi = manual[1]
        # xExtent is null (anchor 0) when no series has a valid x, whatever the overlays say.
        anchor = 0
        if x_data_extent:
            anchor = x_data_extent[0]
            for i, g in geoms.items():
                e = _overlay_domain_extension(overlays[i], g)['x']
                if e:
                    anchor = min(anchor, e[0])
        if manual[0] is not None:
            anchor = manual[0]
        ctx = {'xDomainMin': float(lo), 'xDomainMax': float(hi), 'xAnchorMin': anchor,
               'xIsTime': x_is_time}
        for i in repeating:
            g = _overlay_geometry(overlays[i], columns_index, ctx, x_value_for, x_transform)
            geoms[i] = g
            result['artists'][i] = draw(i, overlays[i], g)
        # The bands are clamped to the domain; keep it exactly (no autoscale margin on top).
        ax.set_xlim(to_x(lo), to_x(hi))

    for i, ov in enumerate(overlays):
        label = (ov['label'] or '').strip() if isinstance(ov['label'], str) else ''
        if not ov['enabled'] or not label:
            continue
        if ov['kind'] == 'line':
            width = ov['strokeWidth']
            handle = Line2D([], [], color=_overlay_colour(ov['colour'], '#2C2C2C'),
                            linewidth=width * _PX_TO_PT,
                            linestyle=_overlay_dashes(ov['stroke'], width))
        else:
            handle = Patch(facecolor=_overlay_colour(ov['fill'], _OVERLAY_BAND_FILL_DEFAULT),
                           edgecolor=(_overlay_colour(ov['edgeColour'],
                                                      _OVERLAY_EDGE_COLOUR_DEFAULT)
                                      if ov['edge'] else 'none'),
                           linewidth=ov['edgeWidth'] * _PX_TO_PT if ov['edge'] else 0)
        result['legend'].append((handle, label))
    return result


def _series_legend_entries(ax, extra_axes=()):
    """The series' labelled artists on `ax` and any `extra_axes` (a right y axis), each as the
    app's swatch (line + marker, grey when coloured by a column; _draw_series_marks)."""
    handles, labels = ax.get_legend_handles_labels()
    for other in extra_axes:
        if other is None:
            continue
        h, l = other.get_legend_handles_labels()
        handles += h
        labels += l
    return [getattr(h, '_ancir_legend_handle', h) for h in handles], labels


def _legend_with_overlays(ax, overlay_legend, extra_axes=(), legend_json=None, look=None,
                          layout=None, entries=None, on=None):
    """ax.legend over the series' labelled artists (on `ax` and any `extra_axes`, such as a
    right y axis), or `entries` [(handle, label)] in the app's order, followed by the
    overlays' entries, as the app's legend lists them; sized and boxed as the plot's saved
    legend says (legend_kwargs) and placed where the app puts it: a fixed corner or custom
    spot from the saved position, an 'auto' or outside one from `layout` (legend_layout)."""
    if entries is None:
        handles, labels = _series_legend_entries(ax, extra_axes)
    else:
        handles, labels = [h for h, _ in entries], [lab for _, lab in entries]
    for h, l in overlay_legend or []:
        handles.append(h)
        labels.append(l)
    if handles:
        kw = legend_kwargs(legend_json, look or resolve_figure_style(None), len(handles))
        frame = kw.pop('_frame')
        anchor = legend_anchor_kwargs(legend_json, layout, ax) \
            if layout is not None and layout.get('box') else {}
        if anchor:
            kw.pop('bbox_to_anchor', None)
            kw.update(anchor)
        # On the top-most axes (`on`: a twin y axis is drawn after `ax` and would otherwise
        # paint its series over the legend; the app draws the legend after every series).
        leg = (on or ax).legend(handles, labels, **kw)
        style_legend(leg, frame)
        return leg
    return None


def _overlay_legend_labels(plot, host=None, legacy_night_bands=False, x_is_time=False):
    """overlayHost.js overlayLegendItems' labels: every enabled overlay with a label, in
    order (what the legend lists after the series, read from the saved overlays)."""
    p = plot.get('plot', {}) or {}
    caps = OVERLAY_CAPABILITIES.get(host or plot.get('type'))
    out = []
    for ov in _overlays_from_plot(p, caps, legacy_night_bands=legacy_night_bands,
                                  x_is_time=x_is_time):
        label = (ov['label'] or '').strip() if isinstance(ov['label'], str) else ''
        if ov['enabled'] and label:
            out.append(label)
    return out


def _scatter_x_origin_ms(col):
    """Scatterplot.resolveXOriginMs over the series' resolved column: the first finite
    originTime_ms along its reference chain, or None."""
    seen = set()
    c = col
    while c is not None and id(c) not in seen:
        seen.add(id(c))
        raw = c.origin_time_ms
        if raw is not None:
            try:
                v = float(raw)
            except (TypeError, ValueError):
                v = math.nan
            if math.isfinite(v):
                return v
        c = c._ref()
    return None


def _scatter_x_context(p, columns_index):
    """The scatterplot's x axis as the app builds it: `any_time` (anyXdataTime: a time
    series, or one whose column carries a time origin), `origin_for(col)` (xOriginFor: the ms
    a number column's hours count from on a time axis, else None) and `extent` (xExtent before
    overlays: floor of the smallest, ceil of the largest valid x, preferring x with a valid
    y, in axis units; None when there is none)."""
    series = []
    for s in p.get('data', []) or []:
        x_col = _resolve_plot_col(s.get('x'), columns_index)
        y_col = _resolve_plot_col(s.get('y'), columns_index)
        if x_col is not None:
            series.append((x_col, y_col))
    any_time = any(x.type == 'time' or _scatter_x_origin_ms(x) is not None
                   for x, _ in series)
    ref_origin = None
    for x, _ in series:
        o = _scatter_x_origin_ms(x)
        if o is not None:
            ref_origin = o
            break
        if x.type == 'time':
            raw = x.get_data() or []
            if len(raw) > 0:
                ref_origin = raw[0]
                break

    def origin_for(col):
        if col is None or col.type == 'time' or not any_time:
            return None
        o = _scatter_x_origin_ms(col)
        return o if o is not None else ref_origin

    def ok(v):
        return v is not None and not _js_invalid(v)

    lo, hi = math.inf, -math.inf
    for x, y in series:
        xs = list(x.get_data() or [])
        ys = list(y.get_data() or []) if y is not None else []
        valid = [v for j, v in enumerate(xs) if ok(v) and j < len(ys) and ok(ys[j])]
        if not valid:
            valid = [v for v in xs if ok(v)]
        if not valid:
            continue
        valid = [_js_number(v) for v in valid]
        origin = origin_for(x)
        if origin is not None:
            valid = [origin + h * _MS_PER_HOUR for h in valid]
        lo = min(lo, math.floor(min(valid)))
        hi = max(hi, math.ceil(max(valid)))
    extent = (lo, hi) if math.isfinite(lo) and math.isfinite(hi) else None
    return {'any_time': any_time, 'origin_for': origin_for, 'extent': extent}


def scatter_colour_encodings(plot, columns_index, zone=None):
    """Scatterplot colour by, per series (None where it is off): what the app's
    ScatterDataclass derives (colourActive, colourMode, colourEncoded, colourDomain,
    colourIdx, colourMap, colourPalette, colourTitle), from the saved series alone.

    - Active only while switched on AND wired to a column that exists.
    - A number or bin column reads its clock from its time origin (resolveXOriginMs).
    - Values in the display zone (`zone`, default the session's DISPLAY_TIMEZONE).
    - The range spans every coloured series of the plot reading the same column the same
      way; on a faceted plot (`facet`), every coloured series of that mode, so all panels
      share one scale (Scatterplotclass.colourDomainFor). A manual end overrides.
    - The map is resolved at draw time; monochrome (the figure's `style.monochrome`) swaps
      it for its grey twin without touching the saved map.
    - Category (v1.1): each row's label; the categories over the same series as the range;
      their colours are the APP's (the export's `seriesColours[i].colourCategories`: the
      session's category colours, pinned palette slots or the user's own, greys when
      monochrome), so a label has the colour its box has in the app. Without them (a session
      not exported from the app) the default palette by first appearance. More categories
      than palette colours, or the app's `refused`, colour nothing (None: the series is drawn
      plain and has no key), as the app refuses."""
    zone = DISPLAY_TIMEZONE if zone is None else zone
    p = plot.get('plot', {}) or {}
    data = p.get('data', []) or []
    monochrome = ((plot.get('style') or {}).get('monochrome') is True)
    facet = plot.get('facet') is True
    out = []
    for s in data:
        enc = s.get('colourEncoding')
        cb = s.get('colourBy')
        ref = (cb or {}).get('refId')
        col = (_resolve_plot_col(cb, columns_index)
               if enc and isinstance(ref, int) and not isinstance(ref, bool) and ref >= 0
               else None)
        if col is None:
            out.append(None)
            continue
        origin = None if col.type == 'time' else _scatter_x_origin_ms(col)
        mode = effective_colour_mode(enc.get('mode'), col.type, origin)
        values, warning = encoding_values(mode, col.get_data() or [], col.type, origin, zone)
        if mode == 'category':
            out.append({
                'ref': ref, 'mode': mode, 'values': values, 'warning': None,
                'colormap': None, 'palette': None, 'domain_in': [None, None],
                'line': enc.get('colourLine') is True, 'monochrome': monochrome,
                'resolved': _resolved_series_colours(plot, len(out)).get('colourCategories'),
                'title': colour_bar_title(mode, column_name=_display_name(col), zone=zone),
            })
            continue
        cmap = effective_colormap(enc.get('colormap'), mode, monochrome)
        out.append({
            'ref': ref, 'mode': mode, 'values': values, 'warning': warning,
            'colormap': cmap, 'palette': bucket_colours(cmap),
            'domain_in': [_number_or_none(enc.get('domainMin')),
                          _number_or_none(enc.get('domainMax'))],
            'line': enc.get('colourLine') is True,
            'title': colour_bar_title(mode, column_name=_display_name(col), zone=zone,
                                      wrapped=bool(warning) and mode == 'hourOfDay'),
        })
    for e in out:
        if e is None:
            continue
        arrays = [o['values'] for o in out
                  if o is not None and o['mode'] == e['mode'] and (facet or o['ref'] == e['ref'])]
        e['domain'] = encoding_domain(arrays, mode=e['mode'], domain_in=e['domain_in'])
        if e['mode'] == 'category':
            _resolve_category_colours(e)
            continue
        e['idx'] = colour_buckets(e['values'], e['domain'])
    return [None if (e is not None and e.get('refused')) else e for e in out]


def _resolve_category_colours(e):
    """A Category encoding's categories, colours and per-row index (in place): the app's
    (`resolved`: {'labels', 'colours'} or {'refused': True}) when the export carries them,
    else the categories found here and the default palette (category_palette_fallback),
    refused past its length."""
    resolved = e.get('resolved') or {}
    dom = e['domain']
    if resolved.get('refused'):
        e['refused'] = True
        return
    labels = resolved.get('labels')
    colours = resolved.get('colours')
    if isinstance(labels, list) and isinstance(colours, list) and len(labels) == len(colours):
        cats, palette = [str(c) for c in labels], list(colours)
    else:
        cats = dom['categories']
        if len(cats) > len(APP_PALETTE):
            e['refused'] = True
            return
        palette = category_palette_fallback(dom['first_seen'], cats, e['monochrome'])
    e['domain'] = {**dom, 'categories': cats}
    e['categories'] = cats
    e['palette'] = palette
    e['idx'] = category_indices(e['values'], cats)


def _colour_drawn_by(series, enc):
    """Whether a coloured series draws coloured marks: its points, or its line coloured too."""
    line = _with_defaults(series.get('line'), _LINE_DEFAULTS)
    points = _with_defaults(series.get('points'), _POINTS_DEFAULTS)
    return points['draw'] or (line['draw'] and enc['line'])


def scatter_colour_key(plot, columns_index, encodings, xy=None):
    """Scatterplotclass.colourKey: the colour bar's content for the FIRST series whose points
    (or line, coloured too) are coloured ({'colormap', 'domain', 'title', 'ticks',
    'no_value'}), or None. `no_value` names the colour of the marks with no colour value on
    the same scale: the points' colour of the first series with such a point, else the line
    colour of the first with such a line segment."""
    p = plot.get('plot', {}) or {}
    data = p.get('data', []) or []
    first = next((i for i, e in enumerate(encodings)
                  if e is not None and _colour_drawn_by(data[i], e)), None)
    if first is None:
        return None
    e = encodings[first]

    def sig(o):
        if o['mode'] == 'category':
            return (o['ref'], o['mode'], tuple(o['categories']))
        return (o['ref'], o['mode'], o['colormap'], repr(o['domain']['lo']),
                repr(o['domain']['hi']), o['domain']['cyclic'])

    using = [i for i, o in enumerate(encodings)
             if o is not None and _colour_drawn_by(data[i], o) and sig(o) == sig(e)]

    def point_missing(i):
        o = encodings[i]
        if not _with_defaults(data[i].get('points'), _POINTS_DEFAULTS)['draw']:
            return False
        xs, ys = (xy or {}).get(i, ([], []))
        return any(_js_plot_valid(xs[r]) and _js_plot_valid(ys[r])
                   and (r >= len(o['idx']) or o['idx'][r] == NO_COLOUR_VALUE)
                   for r in range(min(len(xs), len(ys))))

    def line_missing(i):
        o = encodings[i]
        line = _with_defaults(data[i].get('line'), _LINE_DEFAULTS)
        if not (o['line'] and line['draw']):
            return False
        xs, ys = (xy or {}).get(i, ([], []))
        return len(coloured_line_segments(xs, ys, o['idx'], join_gaps=line['joinGaps'])[0]) > 0

    # A point with no value names the points' colour; else a line segment, the line's.
    no_value = None
    hit = next((i for i in using if point_missing(i)), None)
    part = 'points'
    if hit is None:
        hit = next((i for i in using if line_missing(i)), None)
        part = 'line'
    if hit is not None:
        colour = ((data[hit].get(part) or {}).get('colour')
                  or _resolved_series_colours(plot, hit).get(part) or f'C{hit}')
        no_value = {'colour': colour, 'label': 'no value'}
    if e['mode'] == 'category':
        # Category (v1.1): a named swatch per category, in the app's order and colours.
        return {
            'series': first, 'categorical': True, 'colormap': None, 'palette': e['palette'],
            'domain': e['domain'], 'title': e['title'], 'ticks': [],
            'categories': list(zip(e['categories'], e['palette'])), 'no_value': no_value,
        }
    return {
        'series': first, 'colormap': e['colormap'], 'palette': e['palette'],
        'domain': e['domain'], 'title': e['title'],
        'ticks': colour_bar_ticks(e['domain'], e['mode'],
                                  manual_lo=e['domain_in'][0] is not None,
                                  manual_hi=e['domain_in'][1] is not None),
        'no_value': no_value,
    }



def scatter_size_encodings(plot, columns_index, zone=None):
    """Scatterplot size by, per series (None where it is off): what the app's EncodedSeries
    derives (sizeActive, sizeMode, sizeMarkValues, sizeDomain, sizeRadiusRange, sizeRadii,
    sizeTitle), from the saved series alone. Active only while switched on AND wired to a
    column that exists; the range spans every sized series of the plot reading the same
    column the same way (facets: every sized series of that mode); a manual end overrides.
    A point with no size value keeps the series' point radius."""
    zone = DISPLAY_TIMEZONE if zone is None else zone
    p = plot.get('plot', {}) or {}
    data = p.get('data', []) or []
    facet = plot.get('facet') is True
    out = []
    for s in data:
        enc = s.get('sizeEncoding')
        sb = s.get('sizeBy')
        ref = (sb or {}).get('refId')
        col = (_resolve_plot_col(sb, columns_index)
               if enc and isinstance(ref, int) and not isinstance(ref, bool) and ref >= 0
               else None)
        if col is None:
            out.append(None)
            continue
        origin = None if col.type == 'time' else _scatter_x_origin_ms(col)
        mode = effective_size_mode(enc.get('mode'), col.type, origin)
        values, warning = encoding_values(mode, col.get_data() or [], col.type, origin, zone)
        r_min, r_max = size_range(enc.get('minRadius'), enc.get('maxRadius'))
        points = _with_defaults(s.get('points'), _POINTS_DEFAULTS)
        out.append({
            'ref': ref, 'mode': mode, 'values': values, 'warning': warning,
            'domain_in': [_number_or_none(enc.get('domainMin')),
                          _number_or_none(enc.get('domainMax'))],
            'r_min': r_min, 'r_max': r_max, 'default_r': points['radius'],
            'shape': points['shape'] if points['shape'] in POINT_SHAPES else 'circle',
            'title': colour_bar_title(mode, column_name=_display_name(col), zone=zone),
        })
    for e in out:
        if e is None:
            continue
        arrays = [o['values'] for o in out
                  if o is not None and o['mode'] == e['mode'] and (facet or o['ref'] == e['ref'])]
        e['domain'] = encoding_domain(arrays, mode=e['mode'], domain_in=e['domain_in'])
        e['r'], e['layer'], e['no_value_layer'] = size_radii(
            e['values'], e['domain'], e['r_min'], e['r_max'], e['default_r'])
        e['max_r'] = max(e['r']) if e['r'] else e['default_r']
    return out


def scatter_size_key(plot, sizes, xy=None):
    """EncodingKeyLayout.sizeKey: the size key's content for the FIRST series whose points are
    sized ({'items', 'no_value', 'title', 'shape'}), or None. `no_value` ({'r', 'label'}, at
    that series' point radius) when a drawn point of a series on the same scale had no size
    value."""
    p = plot.get('plot', {}) or {}
    data = p.get('data', []) or []

    def drawn(i):
        return sizes[i] is not None and \
            _with_defaults(data[i].get('points'), _POINTS_DEFAULTS)['draw']
    first = next((i for i in range(len(sizes)) if drawn(i)), None)
    if first is None:
        return None
    e = sizes[first]

    def sig(o):
        return (o['ref'], o['mode'], repr(o['domain']['lo']), repr(o['domain']['hi']),
                o['r_min'], o['r_max'])

    def missing(i):
        o = sizes[i]
        xs, ys = (xy or {}).get(i, ([], []))
        return any(_js_plot_valid(xs[r]) and _js_plot_valid(ys[r])
                   and not (r < len(o['values']) and math.isfinite(o['values'][r]))
                   for r in range(min(len(xs), len(ys))))
    hit = next((i for i in range(len(sizes)) if drawn(i) and sig(sizes[i]) == sig(e)
                and missing(i)), None)
    return {
        'series': first, 'title': e['title'], 'shape': e['shape'],
        'items': size_key_items(e['domain'], e['mode'], e['r_min'], e['r_max'],
                                manual_lo=e['domain_in'][0] is not None,
                                manual_hi=e['domain_in'][1] is not None),
        'no_value': ({'r': sizes[hit]['default_r'], 'label': 'no value'}
                     if hit is not None else None),
    }


def _key_font_px(scale_json, look):
    """A key's own `fontSize` (px), else the figure's legend size."""
    return _colour_key_font_px(scale_json, look)


def _key_inset(scale_json):
    """The backdrop a key draws round itself over the data (its padding), px; none beside."""
    scale = scale_json or {}
    if (scale.get('position') or 'right') == 'right':
        return 0
    pad = scale.get('padding')
    return pad if isinstance(pad, (int, float)) and not isinstance(pad, bool) else 8


def encoding_key_layout(ax, key, size_key, colour_json, size_json, look,
                        has_right_axis=False, padding_right=30, legend_box=None,
                        legend_json=None, legend_size=None, base_h=None):
    """EncodingKeyLayout.placement / sizePlacement: where the colour bar ({'x', 'y', 'length',
    'geom'}) and the size key ({'x', 'y', 'geom'}) go, in px from the plot area's top left, or
    None for a key not shown. They stack in reading order after the series legend
    (`legend_box`, legend_placed_box: outside on the right they go under it, in its inside
    corner past it): the size key after the bar (beside the plot under it, in a shared corner
    past it), and an automatic vertical bar shortens so all fit (fitVertical). `legend_size` is
    the legend's box when `legend_json` places it 'outsideright' (a category key's room starts
    under it)."""
    ax_w, ax_h = _axes_px(ax)
    legend_stack = [legend_box] if legend_box else []
    under = 0
    if (legend_json or {}).get('position') == 'outsideright' and legend_size:
        under = legend_size['height'] + LEGEND_MARGIN
    margin = 10
    cs = colour_json or {}
    ss = size_json or {}
    colour_on = key is not None and cs.get('show', True) is not False
    size_on = size_key is not None and ss.get('show', True) is not False
    out = {'colour': None, 'size': None}
    size_geom = None
    s_pos = ss.get('position') or 'right'
    if s_pos not in ('right', 'topright', 'topleft', 'bottomright', 'bottomleft', 'custom'):
        s_pos = 'right'
    if size_on:
        size_geom = size_key_geometry(size_key['items'], size_key['no_value'],
                                      size_key['title'], _key_font_px(ss, look),
                                      ss.get('itemSpacing') if isinstance(
                                          ss.get('itemSpacing'), (int, float)) else 4)
    s_inset = _key_inset(ss)
    args = dict(plot_w=ax_w, plot_h=ax_h, margin=margin, has_right_axis=has_right_axis,
                padding_right=padding_right)
    bar_box = None
    beside = False
    if colour_on:
        plan = _colour_key_plan(ax_h, key, cs, look, under=under)
        vertical, fixed, length0 = plan['vertical'], plan['fixed'], plan['length0']
        geom = plan['geom']
        c_pos = cs.get('position') or 'right'
        c_inset = _key_inset(cs)
        custom = {'customX': cs.get('customX'), 'customY': cs.get('customY')}
        base = geom(length0)
        x, y, max_len = place_key(c_pos, base['width'], base['height'], custom=custom,
                                  inset=c_inset, stack=legend_stack, **args)
        length = length0
        shares = size_on and c_pos == s_pos and c_pos != 'custom'
        beside = shares and _keys_side_by_side(ax_h, plan, base, size_geom, c_pos, c_inset,
                                               s_inset, margin)
        after = size_geom['height'] + 2 * s_inset + margin if shares and not beside else 0
        besides = base['height'] - length0
        if vertical and fixed is None and max_len - after < length0 + besides:
            length = min(length0, max(plan['min_len'], max_len - after - besides))
            g = geom(length)
            x, y, _ = place_key(c_pos, g['width'], g['height'], custom=custom, inset=c_inset,
                                stack=legend_stack, **args)
        g = geom(length)
        out['colour'] = {'x': x, 'y': y, 'length': length, 'geom': g}
        bar_box = {'x': x - c_inset, 'y': y - c_inset, 'w': g['width'] + 2 * c_inset,
                   'h': g['height'] + 2 * c_inset, 'outside': c_pos == 'right',
                   'corner': None if c_pos in ('right', 'custom') else c_pos}
    if size_on:
        if beside and bar_box:
            x, y = place_beside(s_pos, size_geom['width'], size_geom['height'], bar_box,
                                margin, inset=s_inset)
        else:
            x, y, _ = place_key(s_pos, size_geom['width'], size_geom['height'],
                                stack=legend_stack + ([bar_box] if bar_box else []),
                                custom={'customX': ss.get('customX'),
                                        'customY': ss.get('customY')},
                                inset=s_inset, **args)
        out['size'] = {'x': x, 'y': y, 'geom': size_geom, 'position': s_pos, 'inset': s_inset}
    out['beside'] = beside
    return out


def _colour_key_plan(ax_h, key, cs, look, under=0):
    """EncodingKeyLayout's bar before placement: orientation, a stored length (or None), the
    automatic length (long enough for the title where the plot is), the minimum, the
    comfortable minimum, and the geometry at a length. A category key (Category mode): its
    room for its rows instead (category_key_plan)."""
    if key.get('categorical'):
        return category_key_plan(ax_h, key, cs, look, under=under)
    vertical = cs.get('orientation') != 'horizontal'
    thickness = cs.get('barThickness') or 10
    fixed = cs.get('barLength')
    fixed = fixed if isinstance(fixed, (int, float)) and not isinstance(fixed, bool) else None
    font_px = _colour_key_font_px(cs, look)
    title_len = colour_key_title_run(key['title'], font_px, vertical)
    length0 = fixed if fixed is not None else colour_key_auto_length(ax_h, title_len)
    min_len = colour_key_min_length(font_px)
    labels = [lab for _, lab in key['ticks']]
    nv = key['no_value']['label'] if key['no_value'] else None

    def geom(length):
        return colour_key_geometry(vertical, thickness, length, font_px, labels, key['title'],
                                   nv)
    return {'vertical': vertical, 'fixed': fixed, 'length0': length0, 'min_len': min_len,
            'comfort': min(length0, max(min_len, title_len)), 'geom': geom,
            'font_px': font_px}


# ColourScale.svelte: the category key's row and column gaps, swatch-to-name gap and title.
CATEGORY_ROW_GAP = 3
CATEGORY_COLUMN_GAP = 10
CATEGORY_LABEL_GAP = 4
_CATEGORY_TITLE_GAP = 4
_CATEGORY_TITLE_LINE_GAP = 2
_CATEGORY_TITLE_MIN_CHARS = 14


def category_key_geometry(items, no_value, title, font_px, length=None):
    """ColourScale.svelte categoryKeyGeometry: the category key's footprint in px. `items`
    [(label, colour)] in key order, then "no value"; the rows wrap into columns (top to
    bottom, then left to right) when `length` px of room does not hold them in one; the title
    on top, wrapped at the rows' width (14 characters at least)."""
    entries = [(str(lab), col, False) for lab, col in items]
    if no_value:
        entries.append((no_value.get('label') or 'no value', no_value['colour'], True))
    swatch = max(6, _js_round(font_px * 0.8))
    row_h = max(swatch, font_px)
    step = row_h + CATEGORY_ROW_GAP
    n = max(1, len(entries))
    if length is not None and math.isfinite(length):
        fit = max(1, math.floor((length + CATEGORY_ROW_GAP) / step))
    else:
        fit = n
    per_col = min(n, fit)
    columns = max(1, math.ceil(len(entries) / per_col))
    char_w = font_px * 0.6
    col_ws = []
    for c in range(columns):
        names = [len(e[0]) for e in entries[c * per_col:(c + 1) * per_col]]
        col_ws.append(swatch + CATEGORY_LABEL_GAP + max([0] + names) * char_w)
    entries_w = sum(col_ws) + (columns - 1) * CATEGORY_COLUMN_GAP
    max_chars = max(_CATEGORY_TITLE_MIN_CHARS, math.floor(entries_w / char_w))
    lines = wrap_key_title(title, max_chars) if title else []
    title_lines = [(text, k * (font_px + _CATEGORY_TITLE_LINE_GAP))
                   for k, text in enumerate(lines)]
    title_h = (len(lines) * font_px + (len(lines) - 1) * _CATEGORY_TITLE_LINE_GAP
               + _CATEGORY_TITLE_GAP) if lines else 0
    rows, x = [], 0
    for c in range(columns):
        for r, (lab, col, nv) in enumerate(entries[c * per_col:(c + 1) * per_col]):
            rows.append({'label': lab, 'colour': col, 'no_value': nv, 'x': x,
                         'y': title_h + r * step})
        x += col_ws[c] + CATEGORY_COLUMN_GAP
    title_w = max([0] + [len(t) * char_w for t in lines])
    return {'width': max(entries_w, title_w), 'height': title_h + per_col * step - CATEGORY_ROW_GAP,
            'swatch': swatch, 'row_h': row_h, 'step': step, 'title_h': title_h,
            'natural': n * step - CATEGORY_ROW_GAP, 'per_column': per_col, 'columns': columns,
            'title_lines': title_lines, 'rows': rows}


def category_key_plan(ax_h, key, cs, look, under=0):
    """EncodingKeyLayout for a category key: always vertical, no stored length; the room
    for its rows is one column of them, or the plot's height (less a corner's margins and
    backdrop, and the title) when they do not fit, never under one row."""
    font_px = _colour_key_font_px(cs, look)
    items = key['categories']
    nv = key['no_value']
    plain = category_key_geometry(items, nv, None, font_px)
    titled = category_key_geometry(items, nv, key['title'], font_px)
    min_len = plain['row_h']
    position = cs.get('position') or 'right'
    # Beside the plot under a legend placed 'outsideright', the room starts below it.
    room = ax_h - under if position == 'right' else ax_h - 2 * 10 - 2 * _key_inset(cs)
    length0 = max(min_len, min(plain['natural'], room - titled['title_h']))

    def geom(length):
        return category_key_geometry(items, nv, key['title'], font_px, length)
    return {'vertical': True, 'fixed': None, 'length0': length0, 'min_len': min_len,
            'comfort': min(length0, min_len), 'geom': geom, 'font_px': font_px,
            'categorical': True}


def _keys_side_by_side(ax_h, plan, base, size_geom, position, c_inset, s_inset, margin):
    """EncodingKeyLayout.sizeBeside: a column of the bar and the size key would squeeze an
    automatic vertical bar under its comfortable length (decided on the plot height alone)."""
    if not plan['vertical'] or plan['fixed'] is not None:
        return False
    column = ax_h if position == 'right' else ax_h - 2 * margin - 2 * c_inset
    after = size_geom['height'] + 2 * s_inset + margin
    besides = base['height'] - plan['length0']
    return column - after < plan['comfort'] + besides


def place_beside(position, box_w, box_h, beside, margin, inset=0):
    """encodingHost.js placeBeside: (x, y) of a key beside the box before it ({'x', 'y', 'w',
    'h'}, its backdrop included): on its right beside the plot and in a left corner, on its
    left in a right corner; level with its top, or its bottom in a bottom corner."""
    w, h = box_w + 2 * inset, box_h + 2 * inset
    to_left = position in ('topright', 'bottomright')
    bottom = position in ('bottomright', 'bottomleft')
    x = beside['x'] - margin - w if to_left else beside['x'] + beside['w'] + margin
    y = beside['y'] + beside['h'] - h if bottom else beside['y']
    return x + inset, y + inset


def _key_backdrop(ax, x, y, w, h, scale_json, look, gid):
    """The box a key draws round itself over the data (ColourScale.svelte / SizeKey.svelte):
    its `backgroundColor`, its border (`borderColor`, `borderWidth`) when the figure style
    boxes legends, corners rounded 3 px; x, y, w, h in px from the plot area's top left."""
    from matplotlib.patches import FancyBboxPatch
    scale = scale_json or {}
    ax_w, ax_h = _axes_px(ax)
    look = look or resolve_figure_style(None)
    width = scale.get('borderWidth', 1)
    width = width if isinstance(width, (int, float)) and not isinstance(width, bool) else 1
    show_box = look['legend_box'] and width > 0
    ax.add_patch(FancyBboxPatch(
        (x / ax_w, 1 - (y + h) / ax_h), w / ax_w, h / ax_h,
        boxstyle=f'round,pad=0,rounding_size={3 / ax_w}', mutation_aspect=ax_w / ax_h,
        # Not clipped to the plot area: a key taller than a small plot's corner runs past it
        # in the app too (its <g> is not clipped), backdrop and all.
        transform=ax.transAxes, zorder=4.9, gid=gid, clip_on=False,
        facecolor=_css_colour(scale.get('backgroundColor'), (1, 1, 1, 0.9)),
        edgecolor=(_css_colour(scale.get('borderColor'), _LEGEND_BORDER_DEFAULT)
                   if show_box else 'none'),
        linewidth=width * _PX_TO_PT if show_box else 0))


def _draw_size_key(ax, size_key, scale_json, at, look=None):
    """The size key (SizeKey.svelte) at the app's placement `at` (encoding_key_layout): an
    inset axes (gid 'size-key') exactly the key's px footprint, its reference circles drawn as
    the series' markers at their exact radii in the key's neutral grey, labelled to the
    right, the title above; on a white backdrop when it sits over the data."""
    from matplotlib.patches import Rectangle
    if size_key is None or at is None:
        return None
    scale = scale_json or {}
    ax_w, ax_h = _axes_px(ax)
    g = at['geom']
    font_px = _key_font_px(scale, look)
    font_pt = font_px * _PX_TO_PT
    family = _font_family_list((look or resolve_figure_style(None))['family'])
    pad = at.get('inset', 0)
    if pad:
        _key_backdrop(ax, at['x'] - pad, at['y'] - pad, g['width'] + 2 * pad,
                      g['height'] + 2 * pad, scale, look, 'size-key-backdrop')
    w = max(g['width'], 1e-6)
    h = max(g['height'], 1e-6)
    kax = ax.inset_axes([at['x'] / ax_w, 1 - (at['y'] + h) / ax_h, w / ax_w, h / ax_h])
    kax.set_gid('size-key')
    kax.set_xlim(0, w)
    kax.set_ylim(h, 0)  # px, y down, as the SVG
    kax.set_axis_off()
    kax.patch.set_alpha(0)
    grey = _mpl_colour(COLOUR_BY_SWATCH)
    for r, label, cy, nv in g['rows']:
        marker, s_ = _scatter_marker(size_key['shape'], r)
        kax.scatter([g['colW'] / 2], [cy], s=s_, marker=marker, color=grey, linewidths=0,
                    edgecolors='none', clip_on=False, gid='size-key-novalue' if nv else None)
        kax.text(g['colW'] + SIZE_KEY_LABEL_GAP, cy, label, va='center', ha='left',
                 fontsize=font_pt, fontfamily=family, clip_on=False)
    for text, ty in g['titleLines']:
        kax.text(0, ty, text, va='top', ha='left', fontsize=font_pt, fontfamily=family,
                 clip_on=False)
    return kax

def _draw_category_key(ax, key, scale_json, at, look=None):
    """The category key (ColourScale.svelte, Category mode) at the app's placement `at`
    (encoding_key_layout): an inset axes (gid 'colour-key') exactly the key's px footprint, a
    square swatch per category in its colour (gid 'colour-key-category', 'colour-key-novalue'
    for "no value") with its name to the right, the title on top; on the key's backdrop when
    it sits over the data."""
    from matplotlib.patches import Rectangle
    if at is None:
        return None
    scale = scale_json or {}
    ax_w, ax_h = _axes_px(ax)
    font_px = _colour_key_font_px(scale, look)
    g = category_key_geometry(key['categories'], key['no_value'], key['title'], font_px,
                              at['length'])
    font_pt = font_px * _PX_TO_PT
    family = _font_family_list((look or resolve_figure_style(None))['family'])
    pad = _key_inset(scale)
    if pad:
        _key_backdrop(ax, at['x'] - pad, at['y'] - pad, g['width'] + 2 * pad,
                      g['height'] + 2 * pad, scale, look, 'colour-key-backdrop')
    w = max(g['width'], 1e-6)
    h = max(g['height'], 1e-6)
    kax = ax.inset_axes([at['x'] / ax_w, 1 - (at['y'] + h) / ax_h, w / ax_w, h / ax_h])
    kax.set_gid('colour-key')
    kax.set_xlim(0, w)
    kax.set_ylim(h, 0)  # px, y down, as the SVG
    kax.set_axis_off()
    kax.patch.set_alpha(0)
    sw = g['swatch']
    for row in g['rows']:
        kax.add_patch(Rectangle(
            (row['x'], row['y'] + (g['row_h'] - sw) / 2), sw, sw, linewidth=0,
            edgecolor='none', facecolor=_mpl_colour(row['colour']), clip_on=False,
            gid='colour-key-novalue' if row['no_value'] else 'colour-key-category'))
        kax.text(row['x'] + sw + CATEGORY_LABEL_GAP, row['y'] + g['row_h'] / 2, row['label'],
                 va='center', ha='left', fontsize=font_pt, fontfamily=family, clip_on=False)
    for text, ty in g['title_lines']:
        kax.text(0, ty, text, va='top', ha='left', fontsize=font_pt, fontfamily=family,
                 clip_on=False)
    return kax


# ColourScale.svelte TICK_LABEL_SPACE: px kept between two neighbouring tick labels.
COLOUR_KEY_TICK_LABEL_SPACE = 2


def colour_key_tick_span(t, label, vertical, bar_len, font_px):
    """ColourScale.svelte tickLabelSpan: where a tick's label runs along the bar, (from, to)
    px from the bar's LOW end; an end label inside the bar's length, any other centred; one
    em along a vertical bar, its estimated width (0.6 em a character) along a horizontal."""
    at = t * bar_len
    ext = font_px if vertical else len(str(label)) * font_px * 0.6
    if t <= 0:
        return at, at + ext
    if t >= 1:
        return at - ext, at
    return at - ext / 2, at + ext / 2


def _colour_key_ticks_fit(ticks, vertical, bar_len, font_px):
    for (t0, l0), (t1, l1) in zip(ticks, ticks[1:]):
        a = colour_key_tick_span(t0, l0, vertical, bar_len, font_px)
        b = colour_key_tick_span(t1, l1, vertical, bar_len, font_px)
        if b[0] - a[1] < COLOUR_KEY_TICK_LABEL_SPACE:
            return False
    return True


def fit_colour_key_ticks(ticks, vertical, bar_len, font_px):
    """ColourScale.svelte fitBarTicks: the ticks [(t, label)] (low first) a bar of this length
    labels without two labels crowding: all, else every second (ends kept: hour of day reads
    0, 12, 24), every fourth, ..., else the two ends (kept even when they crowd)."""
    ticks = list(ticks)
    n = len(ticks)
    if n <= 2 or _colour_key_ticks_fit(ticks, vertical, bar_len, font_px):
        return ticks
    stride = 2
    while stride < n - 1:
        if (n - 1) % stride == 0:
            kept = ticks[::stride]
            if _colour_key_ticks_fit(kept, vertical, bar_len, font_px):
                return kept
        stride *= 2
    return [ticks[0], ticks[-1]]


def fit_colour_key_title(title, room, font_px):
    """ColourScale.svelte fitScaleTitle: the title whole when it fits along `room` px, else
    whole characters and an ellipsis, else nothing."""
    s_ = str(title or '')
    char_w = font_px * 0.6
    if len(s_) * char_w <= room:
        return s_
    keep = math.floor(room / char_w) - 1
    return s_[:keep].rstrip() + '\u2026' if keep >= 1 else ''


def colour_key_min_length(font_px):
    """ColourScale.svelte minBarLength: room for both end labels, never under 30 px."""
    return max(30, 2 * font_px + COLOUR_KEY_TICK_LABEL_SPACE)


def colour_key_title_run(label, font_px, vertical):
    """ColourScale.svelte titleRunLength: how far the title runs along the bar, px (0 for an
    upright one- or two-character title beside a vertical bar)."""
    if not label:
        return 0
    if vertical and len(str(label)) <= 2:
        return 0
    return len(str(label)) * font_px * 0.6


def colour_key_auto_length(extent, title_len=0):
    """ColourScale.svelte autoBarLength: the extent between 30 and 150 px, or longer (within
    the extent) for a title that runs further."""
    return max(30, min(extent, max(150, title_len)))


def colour_key_geometry(vertical, thickness, bar_len, font_px, tick_labels, label=None,
                        no_value_label=None):
    """ColourScale.svelte colourScaleGeometry: the key's footprint in px (bar, ticks, title
    and "no value" entry), {'width', 'height', 'swatch'}."""
    tick_w = max([len(t) for t in tick_labels] + [1]) * font_px * 0.6
    rotate = bool(label) and len(str(label)) > 2
    label_gap = ((font_px + 4) if rotate else len(str(label)) * font_px * 0.6 + 4) if label else 0
    swatch = max(6, _js_round(font_px * 0.8))
    nv_w = swatch + 4 + len(no_value_label) * font_px * 0.6 if no_value_label else 0
    nv_h = 6 + max(swatch, font_px) if no_value_label else 0
    width = max(thickness + 5 + tick_w + label_gap, nv_w) if vertical else max(bar_len, nv_w)
    height = (bar_len + nv_h) if vertical else thickness + 3 + font_px + label_gap + nv_h
    return {'width': width, 'height': height, 'swatch': swatch}


def _draw_colour_key(ax, key, scale_json, has_right_axis=False, look=None, padding_right=30,
                     at=None):
    """The colour bar (ColourScale.svelte, placed by encodingHost.placeColourKey) as a
    matplotlib colorbar over the same 64 bucket colours, ticks and title, with a "no value"
    swatch under it when a mark had no colour value. Its axes has gid 'colour-key'.

    Laid out as the app lays it out, in its px (1 CSS px = 1/96 in): a bar `barThickness`
    (10) across and `barLength` (else the plot extent clamped to 30..150) long, no outline
    and no tick marks, the labels 5 px past the bar (the end labels flush with its ends), the
    title past the widest label (turned to read upwards when longer than two characters), the
    "no value" swatch 6 px under the bar. The default position 'right' sits 10 px beside the
    plot at its top (past the right padding when there is a right axis); an inside corner or
    'custom' sits over the data, inset by the legend margin, on a white backdrop (`padding`,
    8 px). Text is the key's own `fontSize` (px), else the figure's legend size (`look`).
    `show` false draws none. `at` ({'x', 'y', 'length'} in px from the plot area's top left,
    encoding_key_layout) places it as the app's EncodingKeyLayout does, sharing its place
    with the size key."""
    import matplotlib.cm as mcm
    from matplotlib.colors import ListedColormap, Normalize
    from matplotlib.patches import Patch, Rectangle
    scale = scale_json or {}
    if key is None or scale.get('show', True) is False:
        return None
    if key.get('categorical'):
        return _draw_category_key(ax, key, scale, at, look)
    fig = ax.figure
    vertical = scale.get('orientation') != 'horizontal'
    ax_w, ax_h = _axes_px(ax)
    thickness = scale.get('barThickness') or 10
    margin = 10
    font_px = _colour_key_font_px(scale, look)
    font_pt = font_px * _PX_TO_PT
    length = scale.get('barLength')
    if not isinstance(length, (int, float)) or isinstance(length, bool):
        length = colour_key_auto_length(ax_h if vertical else ax_w,
                                        colour_key_title_run(key['title'], font_px, vertical))
    if at is not None:
        length = at['length']
    labels = [lab for _, lab in key['ticks']]
    # What a bar of this length shows (ColourScale.svelte): its labels thinned so none crowd,
    # a title that runs along it shortened to its length. The geometry is the full set's.
    shown_ticks = fit_colour_key_ticks(key['ticks'], vertical, length, font_px)
    title = key['title']
    shown_title = (fit_colour_key_title(title, length, font_px)
                   if title and (not vertical or len(str(title)) > 2) else title)
    geom = colour_key_geometry(vertical, thickness, length, font_px, labels, key['title'],
                               key['no_value']['label'] if key['no_value'] else None)
    position = scale.get('position') or 'right'
    w = (thickness if vertical else length) / ax_w
    h = (length if vertical else thickness) / ax_h
    inside = position != 'right'
    pad = (scale.get('padding') if isinstance(scale.get('padding'), (int, float)) else 8) \
        if inside else 0
    box_w, box_h = (geom['width'] + 2 * pad) / ax_w, (geom['height'] + 2 * pad) / ax_h
    mx, my = margin / ax_w, margin / ax_h
    if at is not None:
        rect = [at['x'] / ax_w, 1 - at['y'] / ax_h - h, w, h]
        if inside:
            _key_backdrop(ax, at['x'] - pad, at['y'] - pad, geom['width'] + 2 * pad,
                          geom['height'] + 2 * pad, scale, look, 'colour-key-backdrop')
    elif not inside:
        gap = (margin + (padding_right if has_right_axis else 0)) / ax_w
        rect = [1 + gap, 1 - h, w, h]
    else:
        # Place the backdrop (the key plus its padding), then step in to the bar.
        if position == 'custom':
            fx = min(1, max(0, scale.get('customX') or 0))
            fy = min(1, max(0, scale.get('customY') or 0))
            bx = mx + max(0, 1 - box_w - 2 * mx) * fx
            by_top = 1 - my - max(0, 1 - box_h - 2 * my) * fy
        else:
            left = position in ('topleft', 'bottomleft')
            bottom = position in ('bottomleft', 'bottomright')
            bx = mx if left else 1 - mx - box_w
            by_top = (my + box_h) if bottom else 1 - my
        ix, iy = pad / ax_w, pad / ax_h
        rect = [bx + ix, by_top - iy - h, w, h]
        ax.add_patch(Rectangle((bx, by_top - box_h), box_w, box_h, transform=ax.transAxes,
                               facecolor='white', alpha=0.9, edgecolor='none', zorder=4.9,
                               gid='colour-key-backdrop'))
    cax = ax.inset_axes(rect)
    cax.set_gid('colour-key')
    sm = mcm.ScalarMappable(norm=Normalize(0, 1),
                            cmap=ListedColormap([tuple(v / 255 for v in c)
                                                 for c in key['palette']]))
    cbar = fig.colorbar(sm, cax=cax, orientation='vertical' if vertical else 'horizontal')
    cbar.set_ticks([t for t, _ in shown_ticks], labels=[lab for _, lab in shown_ticks])
    family = _font_family_list((look or resolve_figure_style(None))['family'])
    gap_pt = 5 * _PX_TO_PT  # ColourScale TICK_GAP
    cbar.ax.tick_params(labelsize=font_pt, length=0, pad=gap_pt if vertical else 3 * _PX_TO_PT)
    cbar.outline.set_visible(False)
    axis = cax.yaxis if vertical else cax.xaxis
    for (t, _), lab in zip(shown_ticks, axis.get_ticklabels()):
        lab.set_fontfamily(family)
        edge = 'low' if t <= 0 else 'high' if t >= 1 else 'mid'
        if vertical:
            lab.set_va({'low': 'bottom', 'high': 'top', 'mid': 'center'}[edge])
        else:
            lab.set_ha({'low': 'left', 'high': 'right', 'mid': 'center'}[edge])
            lab.set_va('top')
    if shown_title:
        cbar.set_label(shown_title, fontsize=font_pt, fontfamily=family)
        lab = axis.get_label()
        if vertical:
            tick_w = max([len(t) for t in labels] + [1]) * font_px * 0.6
            if geom['width'] and len(str(key['title'])) > 2:
                lab.set_rotation(90)
                lab.set_rotation_mode('anchor')
                lab.set_ha('center')
                lab.set_va('baseline')
                axis.set_label_coords((thickness + 5 + tick_w + font_px) / thickness, 0.5)
            else:
                lab.set_rotation(0)
                lab.set_ha('left')
                lab.set_va('center')
                axis.set_label_coords((thickness + 5 + tick_w + 4) / thickness, 0.5)
        else:
            lab.set_va('top')
            axis.set_label_coords(0.5, -(3 + font_px + 3) / thickness)
    if key['no_value']:
        # 6 px under the bar (ColourScale NO_VALUE_GAP): a swatch, then the words.
        sw = geom['swatch']
        title = key['title']
        label_gap = (((font_px + 4) if len(str(title)) > 2 else len(str(title)) * font_px * 0.6
                      + 4) if title else 0)
        nv_y = length + 6 if vertical else thickness + 3 + font_px + label_gap + 6
        cax.legend([Patch(facecolor=_mpl_colour(key['no_value']['colour']), edgecolor='none')],
                   [key['no_value']['label']], loc='upper left',
                   bbox_to_anchor=(0, 1 - nv_y / (length if vertical else thickness)),
                   frameon=False, prop={'family': family, 'size': font_pt},
                   handlelength=sw / font_px, handleheight=sw / font_px,
                   handletextpad=4 / font_px, borderaxespad=0, borderpad=0)
    return cbar

# ----------------------------------------------------------------------
# The app's figure look: type, axes, ticks, gridlines (figureStyle.js, Axis.svelte, d3)
#
# An exported figure is laid out as the app lays the plot out: the plot area is the plot's
# width and height in CSS px less its padding (96 px = 1 in, so type in px is 0.75 of that in
# pt), the axes are d3 axes (outward 6 px ticks, 4 px from their labels, a domain line only
# where the app draws an axis), the ticks are the ticks d3 picks for the saved tick count,
# labelled as d3 and the app label them (time ticks in the display zone), and the gridlines are
# the app's dashed grey ones, per axis, at the labelled ticks only. The figure's type comes
# from its saved style (resolveStyle). The export's title is drawn as the app's export draws
# it: bold, top left, above the figure.
# ----------------------------------------------------------------------

# figureStyle.js
_STYLE_BASE_PT = {'s': 7, 'm': 8.5, 'l': 10}
_STYLE_ROLE_RATIOS = {'axisLabel': 1, 'legend': 1, 'tick': 0.9, 'sigBar': 0.9,
                      'annotation': 0.8, 'title': 1.1}
_STYLE_TRANSITIONAL = {'fontFamily': 'sans', 'fontSize': 'custom', 'fontSizePt': 12,
                       'roleScale': {'tick': 0.9375, 'legend': 0.75, 'sigBar': 0.6875},
                       'exportDpi': 300, 'backgroundColour': 'transparent', 'legendBox': True,
                       'monochrome': False}
_STYLE_FIELDS = {
    'fontFamily': ('sans', ('sans', 'serif')), 'fontSize': ('m', ('s', 'm', 'l', 'custom')),
    'fontSizePt': (None, 'number'), 'exportDpi': (300, 'number'),
    'monochrome': (False, 'boolean'), 'backgroundColour': ('transparent', 'string'),
    'legendBox': (True, 'boolean'), 'roleScale': (None, 'object'),
}
# The app's stacks (FONT_STACKS) name system fonts a browser has; matplotlib gets the same
# kind of face from the fonts it can find, ending in the one it always has.
_STYLE_FONT_FAMILIES = {
    'sans': ['Helvetica', 'Arial', 'Liberation Sans', 'DejaVu Sans'],
    'serif': ['Georgia', 'Times New Roman', 'Times', 'Liberation Serif', 'DejaVu Serif'],
}
_PX_PER_PT = 96 / 72
_FIG_PX_PER_IN = 96
# axisLayout.js AXIS_TICK_LENGTH / AXIS_TICK_PADDING / AXIS_TITLE_BUFFER
_AXIS_TICK_LENGTH = 6
_AXIS_TICK_PADDING = 4
_AXIS_TITLE_BUFFER = 16
# Axis.svelte GRID_AXIS_CLEAR and the gridline style (stroke grey, 1 px, dash 4, opacity 0.8).
_GRID_AXIS_CLEAR = 4
_GRID_COLOUR = '#808080'
_GRID_ALPHA = 0.8
# The legend box's border (Legend.svelte: var(--color-lightness-25)).
_LEGEND_BORDER_DEFAULT = '#404040'


def _style_valid(v, kind):
    if v is None:
        return False
    if isinstance(kind, tuple):
        return v in kind
    if kind == 'number':
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    if kind == 'boolean':
        return isinstance(v, bool)
    if kind == 'string':
        return isinstance(v, str)
    if kind == 'object':
        return isinstance(v, dict)
    return False


def normalise_figure_style(saved):
    """figureStyle.js: a plot's saved style made complete (normaliseFigureStyle: an invalid or
    missing field takes the registry default), or, for a plot saved with no style at all, the
    shipped template (transitionalFigureStyle, which reproduces the historical 16 px axis
    labels, 15 px ticks and 12 px legend)."""
    if not isinstance(saved, dict):
        return dict(_STYLE_TRANSITIONAL)
    out = {}
    for key, (default, kind) in _STYLE_FIELDS.items():
        v = saved.get(key)
        out[key] = v if _style_valid(v, kind) else default
    return out


def resolve_figure_style(saved):
    """figureStyle.js resolveStyle for a saved plot style: {'family': 'sans'|'serif', 'base_pt',
    'px': {role: px}, 'pt': {role: pt}, 'legend_box', 'background', 'dpi', 'monochrome'}.
    One base point size drives every role at a fixed ratio (ROLE_RATIOS), a role in
    `roleScale` overrides its ratio, and no role goes under 1 pt."""
    s = normalise_figure_style(saved)
    if s['fontSize'] == 'custom':
        pt = s['fontSizePt']
        base = max(1.0, float(pt)) if _style_valid(pt, 'number') else _STYLE_BASE_PT['m']
    else:
        base = _STYLE_BASE_PT.get(s['fontSize'], _STYLE_BASE_PT['m'])
    over = s['roleScale'] if isinstance(s['roleScale'], dict) else {}
    px = {}
    for role, ratio in _STYLE_ROLE_RATIOS.items():
        o = over.get(role)
        eff = o if _style_valid(o, 'number') else ratio
        px[role] = max(1.0, base * eff) * _PX_PER_PT
    dpi = s['exportDpi'] if s['exportDpi'] > 0 else 96
    return {'family': s['fontFamily'], 'base_pt': base, 'px': px,
            'pt': {r: v * _PX_TO_PT for r, v in px.items()},
            'legend_box': s['legendBox'] is not False, 'background': s['backgroundColour'],
            'dpi': dpi, 'monochrome': s['monochrome'] is True}


def _font_family_list(family):
    """The installed faces for a style family, in preference order (no warnings for the
    ones this machine lacks)."""
    from matplotlib import font_manager as fm
    have = {f.name for f in fm.fontManager.ttflist}
    names = [n for n in _STYLE_FONT_FAMILIES.get(family, _STYLE_FONT_FAMILIES['sans'])
             if n in have]
    return names or ['DejaVu Serif' if family == 'serif' else 'DejaVu Sans']


# ---- d3-array ticks, d3-scale nice and tickFormat, d3-format (the versions the app ships:
# d3-array 3.2, d3-scale 4.0, d3-format 3.1, d3-time 3.1) ---------------------------------

_D3_E10, _D3_E5, _D3_E2 = math.sqrt(50), math.sqrt(10), math.sqrt(2)


def _d3_tick_spec(start, stop, count):
    # d3 runs this in JS arithmetic and does not guard it: a zero, negative or non-finite
    # step gives a non-finite increment (start == stop gives -Infinity, so tickStep is 0),
    # which tickStep and tickFormat then carry. Python raises on log10(0) and x / 0, so
    # those steps return d3's increment here (a correlogram whose series has no lags has
    # the lag domain [0, 0]).
    span, count = stop - start, max(0.0, count)
    if count == 0:
        step = math.nan if span == 0 or math.isnan(span) else math.copysign(math.inf, span)
    else:
        step = span / count
    if step == 0:
        return math.nan, math.nan, -math.inf
    if math.isinf(step) and step > 0:
        return math.nan, math.nan, math.inf
    if not step > 0 or not math.isfinite(step):
        return math.nan, math.nan, math.nan
    power = math.floor(math.log10(step))
    error = step / 10 ** power
    factor = 10 if error >= _D3_E10 else 5 if error >= _D3_E5 else 2 if error >= _D3_E2 else 1
    if power < 0:
        inc = 10 ** -power / factor
        i1, i2 = _js_round(start * inc), _js_round(stop * inc)
        if i1 / inc < start:
            i1 += 1
        if i2 / inc > stop:
            i2 -= 1
        inc = -inc
    else:
        inc = 10 ** power * factor
        i1, i2 = _js_round(start / inc), _js_round(stop / inc)
        if i1 * inc < start:
            i1 += 1
        if i2 * inc > stop:
            i2 -= 1
    if i2 < i1 and 0.5 <= count < 2:
        return _d3_tick_spec(start, stop, count * 2)
    return i1, i2, inc


def d3_ticks(start, stop, count):
    """d3-array ticks(start, stop, count)."""
    start, stop, count = float(start), float(stop), float(count)
    if not count > 0:
        return []
    if start == stop:
        return [start]
    if not (math.isfinite(start) and math.isfinite(stop)):
        return []
    reverse = stop < start
    i1, i2, inc = _d3_tick_spec(stop, start, count) if reverse else \
        _d3_tick_spec(start, stop, count)
    if not i2 >= i1:
        return []
    n = int(i2 - i1 + 1)
    if reverse:
        return [((i2 - i) / -inc) if inc < 0 else ((i2 - i) * inc) for i in range(n)]
    return [((i1 + i) / -inc) if inc < 0 else ((i1 + i) * inc) for i in range(n)]


def d3_tick_increment(start, stop, count):
    return _d3_tick_spec(float(start), float(stop), float(count))[2]


def d3_tick_step(start, stop, count):
    reverse = stop < start
    inc = d3_tick_increment(stop, start, count) if reverse else \
        d3_tick_increment(start, stop, count)
    return (-1 if reverse else 1) * (1 / -inc if inc < 0 else inc)


def d3_nice(lo, hi, count=10):
    """d3-scale linear .nice(count) on [lo, hi]."""
    start, stop = float(lo), float(hi)
    swap = stop < start
    if swap:
        start, stop = stop, start
    prestep = None
    for _ in range(10):
        if not (math.isfinite(start) and math.isfinite(stop)) or start == stop:
            break
        step = d3_tick_increment(start, stop, count)
        if step == prestep:
            break
        if step > 0:
            start = math.floor(start / step) * step
            stop = math.ceil(stop / step) * step
        elif step < 0:
            start = math.ceil(start * step) / step
            stop = math.floor(stop * step) / step
        else:
            break
        prestep = step
    return (stop, start) if swap else (start, stop)


def _js_fixed(x, digits):
    """Number.prototype.toFixed for a finite x >= 0 (ties go to the larger value)."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(1).scaleb(-digits)
    return format(Decimal(x).quantize(q, rounding=ROUND_HALF_UP), 'f')


def _js_exponential(x, digits):
    """Number.prototype.toExponential(digits) for a finite x >= 0: 'd.ddde+N'."""
    from decimal import Decimal, ROUND_HALF_UP
    if x == 0:
        return '0' + ('.' + '0' * digits if digits else '') + 'e+0'
    d = Decimal(x)
    e = d.adjusted()
    m = (d.scaleb(-e)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    if m >= 10:
        e += 1
        m = (d.scaleb(-e)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    s = format(m, 'f')
    return f"{s}e{'+' if e >= 0 else '-'}{abs(e)}"


def _js_precision(x, p):
    """Number.prototype.toPrecision(p) for a finite x >= 0."""
    if x == 0:
        return '0' + ('.' + '0' * (p - 1) if p > 1 else '')
    ex = _js_exponential(x, p - 1)
    e = int(ex.split('e')[1])
    if e < -6 or e >= p:
        return ex
    return _js_fixed(x, p - 1 - e)


def _d3_trim(s):
    """d3-format formatTrim: drop insignificant trailing zeros (and a bare point)."""
    if '.' not in s.split('e')[0]:
        return s
    head, _, tail = s.partition('e')
    head = head.rstrip('0').rstrip('.')
    return head + ('e' + tail if tail else '')


_D3_MINUS = '−'
_D3_SI_PREFIXES = ['y', 'z', 'a', 'f', 'p', 'n', 'µ', 'm', '', 'k', 'M', 'G', 'T', 'P',
                   'E', 'Z', 'Y']


def _d3_group(int_part):
    out = []
    while len(int_part) > 3:
        out.insert(0, int_part[-3:])
        int_part = int_part[:-3]
    out.insert(0, int_part)
    return ','.join(out)


def d3_format(value, spec):
    """d3-format for the specifiers the app's axes use: ',.Nf' (a linear axis), '~g' (the
    Periodogram and FFT log axis) and '~s' (a log axis with d3's own format, SI prefixes)."""
    v = float(value)
    if not math.isfinite(v):
        return 'NaN' if math.isnan(v) else ('-' if v < 0 else '') + 'Infinity'
    neg = v < 0 or (v == 0 and math.copysign(1, v) < 0)
    a = abs(v)
    m = re.match(r'^(,)?(?:\.(\d+))?(~)?([fgs])$', spec)
    group, prec, trim, kind = m.group(1), m.group(2), m.group(3), m.group(4)
    suffix = ''
    if kind == 'f':
        body = _js_fixed(a, int(prec) if prec is not None else 6)
    elif kind == 'g':
        body = _js_precision(a, max(1, min(21, int(prec) if prec is not None else 6)))
    else:  # 's'
        p = max(1, min(21, int(prec) if prec is not None else 6))
        if a == 0:
            body, pe = '0', 0
        else:
            ex = _js_exponential(a, p - 1)
            coef = ex.split('e')[0].replace('.', '')
            exponent = int(ex.split('e')[1])
            pe = max(-8, min(8, math.floor(exponent / 3))) * 3
            i = exponent - pe + 1
            n = len(coef)
            if i == n:
                body = coef
            elif i > n:
                body = coef + '0' * (i - n)
            elif i > 0:
                body = coef[:i] + '.' + coef[i:]
            else:
                q = max(0, p + i - 1)
                # formatDecimalParts(x, 0) is toExponential(): the shortest digits.
                digits = (_js_exponential(a, q - 1).split('e')[0] if q > 0
                          else repr(a).split('e')[0].lstrip('0'))
                body = '0.' + '0' * (-i) + digits.replace('.', '')
        suffix = _D3_SI_PREFIXES[8 + pe // 3]
    if trim:
        body = _d3_trim(body)
    if neg and float(body.split('e')[0] or 0) == 0 and 'e' not in body:
        neg = False
    if group:
        ip, dot, frac = body.partition('.')
        body = _d3_group(ip) + dot + frac
    return (_D3_MINUS if neg else '') + body + suffix


def d3_linear_tick_format(lo, hi, count):
    """d3-scale linear scale.tickFormat(count): ',.Nf' with N from the tick step."""
    step = d3_tick_step(lo, hi, count)
    a = abs(step)
    # d3-format's precisionFixed is NaN for a zero or non-finite step (exponent() has no
    # parts for 0, NaN or Infinity), so tickFormat leaves ',f' at its default precision, 6.
    spec = f',.{max(0, -math.floor(math.log10(a)))}f' if a > 0 and math.isfinite(a) else ',f'
    return lambda v: d3_format(v, spec)


def d3_log_ticks(lo, hi, count=10):
    """d3-scale log (base 10) scale.ticks(count), for a positive domain."""
    u, v = float(lo), float(hi)
    r = v < u
    if r:
        u, v = v, u
    i, j = math.log10(u), math.log10(v)
    n = 10 if count is None else float(count)
    z = []
    pows = lambda e: float(f'1e{int(e)}')  # noqa: E731

    if j - i < n:
        i, j = math.floor(i), math.ceil(j)
        for e in range(int(i), int(j) + 1):
            for k in range(1, 10):
                t = k / pows(-e) if e < 0 else k * pows(e)
                if t < u:
                    continue
                if t > v:
                    break
                z.append(t)
        if len(z) * 2 < n:
            z = d3_ticks(u, v, n)
    else:
        z = [pows(e) if float(e).is_integer() else 10 ** e
             for e in d3_ticks(i, j, min(j - i, n))]
    return z[::-1] if r else z


def d3_log_tick_format(lo, hi, count=10, spec='~s'):
    """d3-scale log scale.tickFormat(count, spec): the label of a labelled tick, '' for the
    ticks between (k = 10 * count / ticks().length of them per decade keep a label)."""
    n_default = len(d3_log_ticks(lo, hi, 10))
    k = max(1, 10 * (10 if count is None else count) / max(1, n_default))

    def fmt(d):
        if not d > 0:
            return ''
        i = d / float(f'1e{_js_round(math.log10(d))}')
        if i * 10 < 10 - 0.5:
            i *= 10
        return d3_format(d, spec) if i <= k else ''
    return fmt


# ---- d3-time utcTicks (d3-scale scaleUtc().ticks(count)) -------------------------------

_MS_S, _MS_MIN, _MS_H, _MS_D = 1000, 60000, 3600000, 86400000
_UTC_TICK_INTERVALS = [
    ('second', 1, _MS_S), ('second', 5, 5 * _MS_S), ('second', 15, 15 * _MS_S),
    ('second', 30, 30 * _MS_S), ('minute', 1, _MS_MIN), ('minute', 5, 5 * _MS_MIN),
    ('minute', 15, 15 * _MS_MIN), ('minute', 30, 30 * _MS_MIN), ('hour', 1, _MS_H),
    ('hour', 3, 3 * _MS_H), ('hour', 6, 6 * _MS_H), ('hour', 12, 12 * _MS_H),
    ('day', 1, _MS_D), ('day', 2, 2 * _MS_D), ('week', 1, 7 * _MS_D),
    ('month', 1, 30 * _MS_D), ('month', 3, 90 * _MS_D), ('year', 1, 365 * _MS_D),
]


def _utc_dt(ms):
    import datetime as _dt
    return _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc) + _dt.timedelta(milliseconds=ms)


def _utc_ms(d):
    import datetime as _dt
    delta = d - _dt.datetime(1970, 1, 1, tzinfo=_dt.timezone.utc)
    return delta.days * _MS_D + delta.seconds * 1000 + delta.microseconds // 1000


def _utc_floor(unit, ms):
    if unit == 'second':
        return ms - ms % _MS_S
    if unit == 'minute':
        return ms - ms % _MS_MIN
    if unit == 'hour':
        return ms - ms % _MS_H
    if unit == 'day':
        return ms - ms % _MS_D
    if unit == 'week':  # utcSunday
        day = ms - ms % _MS_D
        return day - ((day // _MS_D + 4) % 7) * _MS_D  # 1 Jan 1970 was a Thursday
    d = _utc_dt(ms)
    if unit == 'month':
        return _utc_ms(d.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    return _utc_ms(d.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0))


def _utc_offset(unit, ms, step=1):
    fixed = {'second': _MS_S, 'minute': _MS_MIN, 'hour': _MS_H, 'day': _MS_D,
             'week': 7 * _MS_D}
    if unit in fixed:
        return ms + step * fixed[unit]
    d = _utc_dt(ms)
    if unit == 'month':
        m = d.month - 1 + step
        return _utc_ms(d.replace(year=d.year + m // 12, month=m % 12 + 1))
    return _utc_ms(d.replace(year=d.year + step))


def _utc_field(unit, ms):
    d = _utc_dt(ms)
    return {'second': d.second, 'minute': d.minute, 'hour': d.hour,
            'day': ms // _MS_D,  # unixDay: days since the epoch
            'month': d.month - 1}.get(unit, 0)


def d3_utc_ticks(start_ms, stop_ms, count=10):
    """d3-time utcTicks(start, stop, count) as epoch ms: the interval (1, 5, 15, 30 s or min;
    1, 3, 6, 12 h; 1, 2 days; a week from Sunday; 1, 3 months; years) nearest the span over
    `count`, every instant of it from start to stop inclusive, in UTC."""
    start, stop = float(start_ms), float(stop_ms)
    if not (math.isfinite(start) and math.isfinite(stop)):
        return []
    rev = stop < start
    if rev:
        start, stop = stop, start
    target = abs(stop - start) / count if count else math.inf
    steps = [s for _, _, s in _UTC_TICK_INTERVALS]
    import bisect
    i = bisect.bisect_right(steps, target)
    end = stop + 1  # inclusive stop
    out = []
    if i == len(_UTC_TICK_INTERVALS):
        k = math.floor(d3_tick_step(start / (365 * _MS_D), stop / (365 * _MS_D), count))
        if k > 0:
            def yfloor(ms):
                d = _utc_dt(ms)
                return _utc_ms(d.replace(year=(d.year // k) * k, month=1, day=1, hour=0,
                                         minute=0, second=0, microsecond=0))
            t = yfloor(_utc_offset('year', yfloor(int(math.floor(start)) - 1), k))
            while t < end:
                out.append(t)
                t = yfloor(_utc_offset('year', t, k))
    elif i == 0:
        k = max(math.floor(d3_tick_step(start, stop, count)), 1)
        t = math.floor((start - 1) / k) * k + k
        while t < end:
            out.append(t)
            t += k
    else:
        unit, step, _ = _UTC_TICK_INTERVALS[
            i - 1 if target / steps[i - 1] < steps[i] / target else i]
        t = _utc_floor(unit, _utc_offset(unit, _utc_floor(unit, int(math.floor(start)) - 1)))
        while t < end:
            if step <= 1 or _utc_field(unit, t) % step == 0:
                out.append(t)
            t = _utc_floor(unit, _utc_offset(unit, t))
    return out[::-1] if rev else out


# ---- dayjs format (core tokens, English) and the app's time tick labels -----------------

_DAYJS_FORMAT_RE = re.compile(
    r'\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS')
_EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
              'September', 'October', 'November', 'December']
_EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']


def _zoned(ms, zone):
    """The instant `ms` as a datetime in the display zone ('utc' or an IANA name)."""
    import datetime as _dt
    if not zone or zone == 'utc':
        return _utc_dt(ms)
    from zoneinfo import ZoneInfo
    return _utc_dt(ms).astimezone(ZoneInfo(zone))


def dayjs_format(ms, fmt, zone='utc'):
    """dayjs(ms) in `zone` .format(fmt) for the core tokens (dayjs 1.11, English locale): a
    [bracketed] run is literal, an unknown token prints the zone offset as dayjs does."""
    d = _zoned(int(ms) if float(ms).is_integer() else ms, zone)
    off = d.utcoffset()
    mins = int(off.total_seconds() // 60) if off is not None else 0
    sign = '+' if mins >= 0 else '-'
    zstr = f'{sign}{abs(mins) // 60:02d}:{abs(mins) % 60:02d}'
    wd = (d.weekday() + 1) % 7
    h12 = d.hour % 12 or 12
    table = {
        'YY': str(d.year)[-2:], 'YYYY': f'{d.year:04d}', 'M': str(d.month),
        'MM': f'{d.month:02d}', 'MMM': _EN_MONTHS[d.month - 1][:3],
        'MMMM': _EN_MONTHS[d.month - 1], 'D': str(d.day), 'DD': f'{d.day:02d}',
        'd': str(wd), 'dd': _EN_WEEKDAYS[wd][:2], 'ddd': _EN_WEEKDAYS[wd][:3],
        'dddd': _EN_WEEKDAYS[wd], 'H': str(d.hour), 'HH': f'{d.hour:02d}', 'h': str(h12),
        'hh': f'{h12:02d}', 'a': 'am' if d.hour < 12 else 'pm',
        'A': 'AM' if d.hour < 12 else 'PM', 'm': str(d.minute), 'mm': f'{d.minute:02d}',
        's': str(d.second), 'ss': f'{d.second:02d}',
        'SSS': f'{d.microsecond // 1000:03d}', 'Z': zstr, 'ZZ': zstr.replace(':', ''),
    }

    def rep(m):
        if m.group(1):
            return m.group(1)
        return table.get(m.group(0), zstr.replace(':', ''))
    return _DAYJS_FORMAT_RE.sub(rep, fmt)


def time_tick_pattern(ms, zone='utc'):
    """displayTime.js autoTickPattern: the most concise format that still says what this tick
    is, read in the display zone."""
    d = _zoned(ms, zone)
    if d.microsecond // 1000:
        return '[.]SSS'
    if d.second:
        return '[:]ss'
    if d.minute or d.hour:
        return 'HH:mm'
    if d.day != 1:
        return 'D MMM'
    if d.month != 1:
        return 'MMM'
    return 'YYYY'


def time_tick_label(ms, zone='utc', fmt=''):
    """A time axis tick label as the app draws it: the user's dayjs pattern when the plot has
    one (Scatterplot xTickFormat), else the per-tick cascade (formatTimeAxisTick), both in the
    display zone."""
    if isinstance(fmt, str) and fmt.strip():
        return dayjs_format(ms, fmt, zone)
    return dayjs_format(ms, time_tick_pattern(ms, zone), zone)


# ---- axisDomain.js ----------------------------------------------------------------------

def padded_domain(lo, hi, pad=0.05, lower_bound=-math.inf, upper_bound=math.inf, nice=None):
    """axisDomain.js paddedDomain."""
    if not (_finite(lo) and _finite(hi)):
        return 0.0, 1.0
    mn, mx = (lo, hi) if lo <= hi else (hi, lo)
    span = (mx - mn) or abs(mx) or 1
    a, b = mn - span * pad, mx + span * pad
    if mn >= lower_bound:
        a = max(a, lower_bound)
    if mx <= upper_bound:
        b = min(b, upper_bound)
    if nice:
        na, nb = d3_nice(a, b, nice)
        a = max(na, lower_bound) if mn >= lower_bound else na
        b = min(nb, upper_bound) if mx <= upper_bound else nb
    return a, b


def marker_padded_domain(lo, hi, pad_px, length_px, log=False):
    """axisDomain.js markerPaddedDomain: room for a mark `pad_px` wide at each end."""
    if not (_finite(lo) and _finite(hi)) or not pad_px > 0 or not length_px > 0:
        return lo, hi
    f = min(pad_px / length_px, 0.25)

    def widen(a, b):
        span = (b - a) or abs(b) or 1
        extra = (span / (1 - 2 * f) - span) / 2
        return a - extra, b + extra
    if log:
        if not (lo > 0 and hi > 0):
            return lo, hi
        a, b = widen(math.log10(lo), math.log10(hi))
        return 10 ** a, 10 ** b
    return widen(lo, hi)


def nice_axis_limit(value, direction):
    """Boxplot.svelte niceAxisLimit: round out to the value's leading decade."""
    if not _finite(value) or value == 0:
        return value
    step = 10 ** math.floor(math.log10(abs(value)))
    if direction == 'floor':
        return -math.ceil(abs(value) / step) * step if value < 0 else \
            math.floor(value / step) * step
    return -math.floor(abs(value) / step) * step if value < 0 else math.ceil(value / step) * step


def clear_ends(lo, hi, mn, mx, gap_px, length_px, auto_lo=True, auto_hi=True):
    """axisDomain.js clearEnds."""
    if not all(_finite(v) for v in (lo, hi, mn, mx)) or not hi > lo:
        return lo, hi
    L = length_px
    g = min(gap_px, L / 4)
    if not (g > 0 and L > 0):
        return lo, hi

    def px(v, a, b):
        return (v - a) / (b - a) * L
    for _ in range(2):
        if auto_lo and px(mn, lo, hi) < g:
            lo = (mn * L - g * hi) / (L - g)
        if auto_hi and L - px(mx, lo, hi) < g:
            hi = (mx * L - g * lo) / (L - g)
    return lo, hi


def _manual_or(manual, auto):
    m = list(manual or [None, None]) + [None, None]
    return (m[0] if _number_or_none(m[0]) is not None else auto[0],
            m[1] if _number_or_none(m[1]) is not None else auto[1])


# ---- one axis, as Axis.svelte draws it --------------------------------------------------

def app_axis_ticks(spec):
    """The (value, label) pairs Axis.svelte draws for an axis `spec`:
      kind     'linear' | 'log' | 'time' | 'category'
      domain   (lo, hi) in the app's units (epoch ms on a time axis)
      axis     the saved AxisClass ({'nticks', 'manualTicks', 'gridlines', 'label'})
      format   optional label function (a plot's own tickFormat)
      log_spec the log axis's d3 specifier ('~s' is d3's own, '~g' the Periodogram/FFT's)
      ticks    category axes: the tick values
    Manual ticks (a numeric axis with a non-empty list) replace d3's, inside the domain only,
    labelled by the scale's default format (d3-axis calls tickFormat() with no count, i.e.
    10). Otherwise d3 picks `nticks` ticks."""
    axis = spec.get('axis') or {}
    lo, hi = spec['domain']
    kind = spec.get('kind', 'linear')
    nticks = axis.get('nticks')
    nticks = nticks if _style_valid(nticks, 'number') else 5
    manual = axis.get('manualTicks')
    fmt = spec.get('format')
    if kind == 'category':
        vals = list(spec.get('ticks') or [])
        return [(v, fmt(v) if fmt else str(v)) for v in vals]
    use_manual = (kind in ('linear', 'log') and spec.get('tick_mode', 'numeric') == 'numeric'
                  and isinstance(manual, list) and len(manual) > 0)
    if kind == 'time':
        vals = d3_utc_ticks(lo, hi, nticks)
        zone = spec.get('zone', DISPLAY_TIMEZONE)
        label = fmt or (lambda v: time_tick_label(v, zone, spec.get('time_format', '')))
        return [(v, label(v)) for v in vals]
    if use_manual:
        a, b = min(lo, hi), max(lo, hi)
        eps = (b - a) * 1e-9
        vals = [float(t) for t in manual if _style_valid(t, 'number') and a - eps <= t <= b + eps]
        count = 10
    else:
        vals = d3_log_ticks(lo, hi, nticks) if kind == 'log' else d3_ticks(lo, hi, nticks)
        count = nticks
    if fmt is None:
        if kind == 'log':
            fmt = d3_log_tick_format(lo, hi, count, spec.get('log_spec', '~s'))
        else:
            fmt = d3_linear_tick_format(lo, hi, count)
    return [(v, fmt(v)) for v in vals]


def _to_axis_units(kind, v):
    return _ms_to_datenum(v) if kind == 'time' else v


def apply_app_axis(ax, which, position, spec, look, *, draw_label=True, grid_ax=None):
    """Draw one of the app's axes onto a matplotlib axes: limits = the app's domain, ticks and
    labels from app_axis_ticks, outward 6 px tick marks 4 px from their labels in the figure's
    tick size, the axis title in its axis-label size, and the dashed grey gridlines (when the
    axis has them on) at the LABELLED ticks, skipping one that would lie on the axis line
    crossing this one (within 4 px, Axis.svelte onAxisLine). `which` is 'x' or 'y';
    `position` 'bottom' | 'top' | 'left' | 'right'. `grid_ax` is the axes the gridlines go in
    (default `ax`): a right axis's gridlines go in the left axes, beneath every series, as the
    app draws every axis before the data. Returns the drawn ticks and gridline values."""
    from matplotlib.ticker import FixedLocator, FixedFormatter, NullLocator
    from matplotlib.lines import Line2D
    kind = spec.get('kind', 'linear')
    lo, hi = spec['domain']
    ticks = app_axis_ticks(spec)
    axis_obj = ax.xaxis if which == 'x' else ax.yaxis
    if kind == 'log':
        (ax.set_xscale if which == 'x' else ax.set_yscale)('log')
    lims = (_to_axis_units(kind, lo), _to_axis_units(kind, hi))
    if lims[0] == lims[1] and kind != 'log':
        # A zero-width domain: d3 maps every value to the middle of the range (its
        # normalize is the constant 0.5), so the one tick sits mid-axis.
        lims = (lims[0] - 0.5, lims[1] + 0.5)
    (ax.set_xlim if which == 'x' else ax.set_ylim)(*lims)
    locs = [_to_axis_units(kind, v) for v, _ in ticks]
    axis_obj.set_major_locator(FixedLocator(locs))
    axis_obj.set_major_formatter(FixedFormatter([lab for _, lab in ticks]))
    axis_obj.set_minor_locator(NullLocator())
    family = _font_family_list(look['family'])
    tick_pt = look['pt']['tick']
    side = {'bottom': 'bottom', 'top': 'top', 'left': 'left', 'right': 'right'}[position]
    params = dict(which='major', direction='out', length=_AXIS_TICK_LENGTH * _PX_TO_PT,
                  width=1 * _PX_TO_PT, pad=_AXIS_TICK_PADDING * _PX_TO_PT, labelsize=tick_pt,
                  colors='black')
    if which == 'x':
        params.update(bottom=side == 'bottom', labelbottom=side == 'bottom',
                      top=side == 'top', labeltop=side == 'top')
    else:
        params.update(left=side == 'left', labelleft=side == 'left',
                      right=side == 'right', labelright=side == 'right')
    ax.tick_params(axis=which, **params)
    for t in axis_obj.get_ticklabels():
        t.set_fontfamily(family)
    if which == 'x':
        axis_obj.set_label_position('top' if side == 'top' else 'bottom')
    else:
        axis_obj.set_label_position('right' if side == 'right' else 'left')
    ax.spines[side].set_visible(True)
    ax.spines[side].set_linewidth(1 * _PX_TO_PT)
    ax.spines[side].set_color('black')
    label = spec.get('label')
    if label is None:
        label = (spec.get('axis') or {}).get('label') or spec.get('default_label') or ''
    lab_px = look['px']['axisLabel']
    if draw_label:
        (ax.set_xlabel if which == 'x' else ax.set_ylabel)(
            label, fontsize=look['pt']['axisLabel'], fontfamily=family, color='black')
        # Axis.svelte puts the title's BASELINE at tick padding + the largest tick label
        # (its height on an x axis, its width on a y axis) + 16 px from the axis line,
        # centred along it; a y title is turned to read upwards (left) or downwards (right).
        w_px, h_px = _axes_px(ax)
        if which == 'x':
            extent = _TICK_LABEL_BOX_EM * look['px']['tick']
        else:
            extent = max([_text_width_px(ax.figure, lab, tick_pt, family)
                          for _, lab in ticks] + [0])
        off = _AXIS_TICK_PADDING + extent + _AXIS_TITLE_BUFFER
        lab_artist = axis_obj.label
        lab_artist.set_rotation_mode('anchor')
        lab_artist.set_ha('center')
        lab_artist.set_va('baseline')
        if which == 'x':
            lab_artist.set_rotation(0)
            axis_obj.set_label_coords(0.5, 1 + off / h_px if side == 'top' else -off / h_px)
        else:
            lab_artist.set_rotation(-90 if side == 'right' else 90)
            axis_obj.set_label_coords(1 + off / w_px if side == 'right' else -off / w_px, 0.5)
    # Gridlines: the axis's own, at its labelled ticks, beneath everything drawn.
    from matplotlib.transforms import blended_transform_factory
    host = grid_ax if grid_ax is not None else ax
    for old in [a for a in host.lines if a.get_gid() == f'gridline-{position}']:
        old.remove()
    grid = (spec.get('axis') or {}).get('gridlines')
    grid = spec.get('gridlines', grid)
    drawn_grid = []
    if grid:
        ax_w, ax_h = _axes_px(ax)
        span = ax_w if which == 'x' else ax_h
        for v, lab in ticks:
            if not str(lab).strip():
                continue
            c = _to_axis_units(kind, v)
            if span > 0:
                lo_u, hi_u = lims
                if kind == 'log':
                    if not (c > 0 and lo_u > 0 and hi_u > 0):
                        continue
                    frac = (math.log10(c) - math.log10(lo_u)) / (math.log10(hi_u) - math.log10(lo_u))
                else:
                    frac = (c - lo_u) / (hi_u - lo_u) if hi_u != lo_u else 0
                # bottom/top axes are crossed by the y axis at x = 0; left/right axes by the
                # x axis at the plot's bottom (y = lo).
                if abs(frac * span) < _GRID_AXIS_CLEAR:
                    continue
            style = dict(color=_GRID_COLOUR, alpha=_GRID_ALPHA, linewidth=1 * _PX_TO_PT,
                         linestyle=(0, (4.0, 4.0)), dash_capstyle='butt', zorder=0.4,
                         gid=f'gridline-{position}')
            if which == 'x':
                tr = blended_transform_factory(ax.transData, host.transAxes)
                ln = Line2D([c, c], [0, 1], transform=tr, **style)
            else:
                tr = blended_transform_factory(host.transAxes, ax.transData)
                ln = Line2D([0, 1], [c, c], transform=tr, **style)
            host.add_line(ln)
            drawn_grid.append(v)
    return {'ticks': ticks, 'grid': drawn_grid}


# The height a browser gives a line of tick text (getBoundingClientRect: the face's ascent
# plus descent; about 1.19 em for the system UI face the app's sans stack starts with).
_TICK_LABEL_BOX_EM = 1.19


def _text_width_px(fig, text, size_pt, family):
    """The width of `text` in figure px as matplotlib sets it (for a y axis's widest tick
    label, which the app measures in the browser)."""
    from matplotlib.font_manager import FontProperties
    if not text:
        return 0.0
    renderer = fig.canvas.get_renderer()
    w, _h, _d = renderer.get_text_width_height_descent(
        str(text), FontProperties(family=family, size=size_pt), ismath=False)
    return w / fig.dpi * _FIG_PX_PER_IN


def app_axes_frame(ax, sides, *, twin=False):
    """Only the axis lines the app draws (d3's domain path), no box. A `twin` (a right y axis
    sharing x) leaves the shared x axis's ticks alone: its locator is the host's."""
    for s in ('bottom', 'top', 'left', 'right'):
        ax.spines[s].set_visible(s in sides)
    if twin:
        ax.tick_params(axis='x', bottom=False, top=False, labelbottom=False, labeltop=False)
        ax.set_facecolor('none')
        return
    if 'bottom' not in sides and 'top' not in sides:
        ax.xaxis.set_major_locator(__import__('matplotlib.ticker', fromlist=['NullLocator'])
                                   .NullLocator())
        ax.tick_params(axis='x', bottom=False, top=False, labelbottom=False, labeltop=False)
    if 'left' not in sides and 'right' not in sides:
        ax.yaxis.set_major_locator(__import__('matplotlib.ticker', fromlist=['NullLocator'])
                                   .NullLocator())
        ax.tick_params(axis='y', left=False, right=False, labelleft=False, labelright=False)
    ax.set_facecolor('none')


def plot_figure_geometry(plot, padding=None, band=0):
    """The figure in px and the plot area as figure fractions: the plot's saved width and
    height (plus a title band of `band` px above), less its padding (the app's
    plotwidth / plotheight)."""
    w = plot.get('width')
    h = plot.get('height')
    w = float(w) if _style_valid(w, 'number') and w > 0 else 520.0
    h = float(h) if _style_valid(h, 'number') and h > 0 else 300.0
    pad = padding or (plot.get('plot') or {}).get('padding') or \
        {'top': 15, 'right': 30, 'bottom': 30, 'left': 30}
    t, r, b, l_ = (float(pad.get(k) or 0) for k in ('top', 'right', 'bottom', 'left'))
    pw, ph = max(1.0, w - l_ - r), max(1.0, h - t - b)
    fh = h + band
    return {'w': w, 'h': h, 'band': band, 'fig_h': fh, 'plot_w': pw, 'plot_h': ph,
            'rect': [l_ / w, b / fh, pw / w, ph / fh],
            'padding': {'top': t, 'right': r, 'bottom': b, 'left': l_}}


def new_plot_figure(plot, padding=None, band=0):
    """A matplotlib figure the plot's size (96 px to the inch; `band` px taller for the
    export's title) with one axes on the app's plot area. Returns (fig, ax, geometry)."""
    import matplotlib.pyplot as plt
    g = plot_figure_geometry(plot, padding, band)
    # At 96 dpi the figure is exactly the plot's px (matplotlib rounds a figure to whole
    # pixels at its own dpi); the PNG is saved at the export dpi.
    fig = plt.figure(figsize=(g['w'] / _FIG_PX_PER_IN, g['fig_h'] / _FIG_PX_PER_IN),
                     dpi=_FIG_PX_PER_IN)
    ax = fig.add_axes(g['rect'])
    fig._ancir_geometry = g
    return fig, ax, g


# exportStyle.js title band
_TITLE_LINE_HEIGHT = 1.25
_TITLE_PAD = 0.6
_TITLE_MAX_LINES = 2
_TITLE_CHAR_WIDTH = 0.58


def wrap_title(text, max_chars, max_lines=_TITLE_MAX_LINES):
    """exportStyle.js wrapTitle."""
    words = [w for w in str(text or '').strip().split() if w]
    if not words:
        return []
    cap = max(1, math.floor(max_chars))
    lines, line = [], ''
    for word in words:
        nxt = line + ' ' + word if line else word
        if len(nxt) <= cap:
            line = nxt
            continue
        if line:
            lines.append(line)
        line = word[:cap] if len(word) > cap else word
        if len(lines) == max_lines:
            break
    if len(lines) < max_lines:
        lines.append(line)
    overflow = len(lines) == max_lines and re.sub(r'\s+', ' ', ' '.join(lines)) != ' '.join(words)
    if overflow:
        last = lines[max_lines - 1]
        lines[max_lines - 1] = (last[:cap - 1] if len(last) >= cap else last).rstrip() + '…'
    return lines


def export_title_band(plot, look):
    """(band px, lines) of the export's title (exportStyle.js addTitle): the plot's name
    wrapped to two lines at the figure's title size; (0, []) for a plot with no name."""
    name = str(plot.get('name') or '').strip()
    if not name:
        return 0, []
    w = plot.get('width')
    w = float(w) if _style_valid(w, 'number') and w > 0 else 520.0
    fs = look['px']['title']
    pad = fs * _TITLE_PAD
    lines = wrap_title(name, (w - 2 * pad) / (fs * _TITLE_CHAR_WIDTH))
    return _js_round(pad + len(lines) * fs * _TITLE_LINE_HEIGHT + pad / 2), lines


def draw_export_title(fig, plot, look):
    """The export's title (exportStyle.js addTitle): the plot's name, bold, at the figure's
    title size, top left, in the band above the figure, its first baseline 0.6 + 0.9 of the
    font size down."""
    band, lines = export_title_band(plot, look)
    if not lines:
        return None
    g = getattr(fig, '_ancir_geometry', None) or plot_figure_geometry(plot, band=band)
    fs = look['px']['title']
    pad = fs * _TITLE_PAD
    fh = g.get('fig_h', g['h'])
    return fig.text(pad / g['w'], 1 - (pad + fs * 0.9) / fh, '\n'.join(lines), ha='left',
                    va='baseline', fontsize=fs * _PX_TO_PT, fontweight='bold',
                    fontfamily=_font_family_list(look['family']), color='black',
                    linespacing=_TITLE_LINE_HEIGHT, gid='export-title')


_LEGEND_LOC = {'topright': 'upper right', 'topleft': 'upper left',
               'bottomright': 'lower right', 'bottomleft': 'lower left', 'auto': 'best'}


def legend_kwargs(legend_json, look, n_items=0):
    """ax.legend keyword arguments for the plot's saved legend (Legend.svelte, legendLayout.js):
    its corner (or custom position, or beside the plot) 10 px in, its type size (its own
    `fontSize` px, else the figure's legend size), a 25 px swatch 4 px from its label, rows
    `itemSpacing` + 4 px apart, `padding` px inside a white box with its border unless the
    figure style turns the box off; horizontal puts the entries in one row."""
    lj = legend_json or {}
    fs = lj.get('fontSize')
    fs_px = fs if _style_valid(fs, 'number') and fs > 0 else look['px']['legend']
    pos = lj.get('position') or 'topright'
    kw = {'prop': {'family': _font_family_list(look['family']), 'size': fs_px * _PX_TO_PT}}
    if pos == 'outsideright':
        kw.update(loc='upper left', bbox_to_anchor=(1, 1))
    elif pos == 'custom':
        fx = min(1, max(0, float(lj.get('customX') or 0)))
        fy = min(1, max(0, float(lj.get('customY') or 0)))
        kw.update(loc='upper left', bbox_to_anchor=(0.02 + 0.96 * fx, 0.98 - 0.96 * fy))
    else:
        kw['loc'] = _LEGEND_LOC.get(pos, 'best')
    pad = lj.get('padding')
    pad = pad if _style_valid(pad, 'number') else 8
    spacing = lj.get('itemSpacing')
    spacing = spacing if _style_valid(spacing, 'number') else 4
    kw['borderaxespad'] = 10 / fs_px  # LEGEND_MARGIN
    kw['borderpad'] = pad / fs_px
    kw['handlelength'] = 25 / fs_px  # LEGEND_ICON_W
    kw['handletextpad'] = 4 / fs_px  # LEGEND_ICON_GAP
    # matplotlib's row is the text's own height (about 1.2 em) plus labelspacing.
    kw['labelspacing'] = max(0.0, (fs_px + spacing + 4 - 1.2 * fs_px) / fs_px)
    if lj.get('orientation') == 'horizontal' and n_items:
        kw['ncols'] = n_items
        kw['columnspacing'] = 10 / fs_px  # LEGEND_H_SPACING
    show_box = look['legend_box'] and (lj.get('borderWidth', 1) or 0) > 0
    kw['frameon'] = True
    kw['fancybox'] = True
    kw['_frame'] = {
        'facecolor': _css_colour(lj.get('backgroundColor'), (1, 1, 1, 0.9)),
        'edgecolor': (_css_colour(lj.get('borderColor'), _LEGEND_BORDER_DEFAULT)
                      if show_box else 'none'),
        'linewidth': (float(lj.get('borderWidth', 1) or 0) * _PX_TO_PT) if show_box else 0,
        'radius': 3 / fs_px,
    }
    return kw


def _css_colour(c, fallback):
    """A saved CSS colour as matplotlib reads it; `fallback` for one it cannot (a CSS custom
    property such as var(--color-lightness-25), which only a stylesheet resolves)."""
    from matplotlib.colors import is_color_like
    m = _mpl_colour(c, None)
    return m if m is not None and is_color_like(m) else fallback


def style_legend(leg, frame):
    if leg is None:
        return
    f = leg.get_frame()
    f.set_facecolor(frame['facecolor'])
    f.set_edgecolor(frame['edgecolor'])
    f.set_linewidth(frame['linewidth'])
    f.set_alpha(None)
    f.set_boxstyle(f'round,pad=0,rounding_size={frame.get("radius", 0.2)}')


# ---- Legend placement (components/plotbits/legendLayout.js, legendAuto.svelte.js) ---------
#
# The legend box is sized from its label widths (legendBoxSize). A fixed corner sits 10 px in;
# 'auto' rasterises the plot's drawn marks onto a 4 px grid over the plot area (before any
# room is taken for an outside legend: the acyclic rule of legendAuto.svelte.js) and takes the
# first candidate (corners, then edge midpoints, matplotlib's order) that covers under 1% of
# its cells; when none is clear the legend goes OUTSIDE on the right, where 'outsideright'
# puts it too: top-aligned with the plot area, 10 px past it (and past a right axis), the
# plot area giving up the box's width plus that gap.

LEGEND_MARGIN = 10
LEGEND_ICON_W = 25
LEGEND_ICON_GAP = 4
LEGEND_H_SPACING = 10
LEGEND_CLEAR_FRACTION = 0.01
_LEGEND_EST_CHAR_EM = 0.55
# How the label widths that size the legend box are found: 'measure' (matplotlib's own text
# extents in the figure's family, as the browser measures them on a canvas) or 'estimate'
# (0.55 em a character, the app's fallback when it has no canvas, as in its jsdom tests).
LEGEND_LABEL_WIDTHS = 'measure'
_LEGEND_DEFAULTS = {'show': False, 'position': 'topright', 'orientation': 'vertical',
                    'padding': 8, 'itemSpacing': 4, 'customX': 0.02, 'customY': 0.02}


def legend_font_px(legend_json, look):
    """Legend.svelte legendFontSize: the legend's own `fontSize` px, else the figure's."""
    fs = (legend_json or {}).get('fontSize')
    return float(fs) if _style_valid(fs, 'number') and fs > 0 else look['px']['legend']


def _legend_setting(legend_json, key):
    v = (legend_json or {}).get(key)
    return _LEGEND_DEFAULTS[key] if v is None else v


def legend_label_widths(labels, font_px, family, fig=None, mode=None):
    """legendLayout.js measureLabelWidths: each label's width in px at `font_px`."""
    mode = mode or LEGEND_LABEL_WIDTHS
    if mode == 'measure' and fig is not None:
        fam = _font_family_list(family)
        return [_text_width_px(fig, str(lab), font_px * _PX_TO_PT, fam) for lab in labels]
    return [len(str(lab)) * font_px * _LEGEND_EST_CHAR_EM for lab in labels]


def legend_box_size(label_widths, font_px, padding=8, item_spacing=4, orientation='vertical'):
    """legendLayout.js legendBoxSize (at figure scale): {'width', 'height', 'lineH',
    'padding'} in px; zero for no labels."""
    n = len(label_widths)
    if n == 0:
        return {'width': 0, 'height': 0, 'lineH': 0, 'padding': 0}
    pad = float(padding)
    line_h = font_px + (item_spacing + 4)
    if orientation == 'horizontal':
        total = sum(LEGEND_ICON_W + LEGEND_ICON_GAP + w + LEGEND_H_SPACING for w in label_widths)
        return {'width': total + pad * 2, 'height': line_h + pad * 2, 'lineH': line_h,
                'padding': pad}
    max_label_w = max(list(label_widths) + [0]) + 2 + pad / 2
    return {'width': LEGEND_ICON_W + LEGEND_ICON_GAP + max_label_w + pad * 2,
            'height': n * line_h + pad * 2, 'lineH': line_h, 'padding': pad}


def _ok_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def build_occupancy(width, height, series, cell=4):
    """legendLayout.js buildOccupancy: which `cell` px cells of a width x height plot area hold
    a drawn mark. `series` are dicts with optional 'px'/'py' (px coordinates, NaN or None for a
    gap), 'line' (the segments between consecutive points count too), 'radius' and 'rects'
    ([x0, y0, x1, y1] filled areas). Returns {'cols', 'rows', 'cell', 'grid'} (a bytearray,
    row-major)."""
    cols = max(1, math.ceil(width / cell))
    rows = max(1, math.ceil(height / cell))
    grid = bytearray(cols * rows)

    def mark(x, y, r):
        c0 = math.floor((x - r) / cell)
        c1 = math.floor((x + r) / cell)
        r0 = math.floor((y - r) / cell)
        r1 = math.floor((y + r) / cell)
        for rr in range(max(0, r0), min(rows - 1, r1) + 1):
            base = rr * cols
            for cc in range(max(0, c0), min(cols - 1, c1) + 1):
                grid[base + cc] = 1

    def fill(rect):
        ax_, ay, bx, by = rect
        if not all(_ok_number(v) for v in (ax_, ay, bx, by)):
            return
        c0 = max(0, math.floor(min(ax_, bx) / cell))
        c1 = min(cols - 1, math.floor(max(ax_, bx) / cell))
        r0 = max(0, math.floor(min(ay, by) / cell))
        r1 = min(rows - 1, math.floor(max(ay, by) / cell))
        for rr in range(r0, r1 + 1):
            base = rr * cols
            for cc in range(c0, c1 + 1):
                grid[base + cc] = 1

    for s in series or []:
        for rect in s.get('rects') or []:
            fill(rect)
        px, py = s.get('px') or [], s.get('py') or []
        n = min(len(px), len(py))
        r = max(0, s.get('radius') or 0)
        prev = None
        for i in range(n):
            x, y = px[i], py[i]
            if not (_ok_number(x) and _ok_number(y)):
                prev = None
                continue
            mark(x, y, r)
            if s.get('line') and prev is not None:
                dx, dy = x - prev[0], y - prev[1]
                steps = math.ceil(math.hypot(dx, dy) / (cell / 2))
                for k in range(1, steps):
                    mark(prev[0] + dx * k / steps, prev[1] + dy * k / steps, 0)
            prev = (x, y)
    return {'cols': cols, 'rows': rows, 'cell': cell, 'grid': grid}


def covered_fraction(occ, x, y, w, h):
    """legendLayout.js coveredFraction: the share of the grid cells under a box that hold data."""
    cols, rows, cell, grid = occ['cols'], occ['rows'], occ['cell'], occ['grid']
    c0 = max(0, math.floor(x / cell))
    c1 = min(cols - 1, math.floor((x + w) / cell))
    r0 = max(0, math.floor(y / cell))
    r1 = min(rows - 1, math.floor((y + h) / cell))
    if c1 < c0 or r1 < r0:
        return 0
    hit = sum(grid[r * cols + c] for r in range(r0, r1 + 1) for c in range(c0, c1 + 1))
    return hit / ((c1 - c0 + 1) * (r1 - r0 + 1))


def legend_inside_candidates(plot_w, plot_h, box_w, box_h, margin=LEGEND_MARGIN):
    """legendLayout.js insideCandidates, in preference order."""
    L, R = margin, plot_w - box_w - margin
    T, B = margin, plot_h - box_h - margin
    CX, CY = (plot_w - box_w) / 2, (plot_h - box_h) / 2
    return [('topright', R, T), ('topleft', L, T), ('bottomright', R, B), ('bottomleft', L, B),
            ('top', CX, T), ('bottom', CX, B), ('right', R, CY), ('left', L, CY)]


def choose_legend_placement(occ, plot_w, plot_h, box_w, box_h, margin=LEGEND_MARGIN,
                            allow_outside=False):
    """legendLayout.js chooseLegendPlacement: {'outside', 'name', 'x', 'y', 'covered'}."""
    fits = box_w + 2 * margin <= plot_w and box_h + 2 * margin <= plot_h
    best = None
    for name, x, y in (legend_inside_candidates(plot_w, plot_h, box_w, box_h, margin)
                       if fits else []):
        covered = covered_fraction(occ, x, y, box_w, box_h)
        cand = {'outside': False, 'name': name, 'x': x, 'y': y, 'covered': covered}
        if covered <= LEGEND_CLEAR_FRACTION:
            return cand
        if best is None or covered < best['covered']:
            best = cand
    if allow_outside:
        return {'outside': True, 'name': 'outsideright', 'x': 0, 'y': 0, 'covered': 0}
    return best or {'outside': False, 'name': 'topright', 'x': plot_w - box_w - margin,
                    'y': margin, 'covered': 1}


def legend_layout(legend_json, labels, look, base_w, base_h, *, obstacles=None, area=None,
                  has_right_axis=False, padding_right=0, keys_reserve=0, fig=None,
                  allow_outside=True):
    """LegendAutoLayout for one plot: the box (None with nothing to draw), the 'auto' choice,
    the outside placement in force ({'reserveW', 'x', 'y'}: rightOfPlot, sharing the right
    margin with keys beside the plot, withEncodingKeysOutside) and the room it takes.
    `obstacles(w, h)` returns the plot's marks in px over a w x h area (buildOccupancy series);
    `area` is the (w, h) an inside legend is placed over (default the base plot area)."""
    lj = legend_json or {}
    font_px = legend_font_px(lj, look)
    out = {'box': None, 'auto': None, 'outside': None, 'reserveW': 0.0, 'font_px': font_px,
           'margin': LEGEND_MARGIN, 'occupancy': None, 'area': None,
           'position': lj.get('position') or 'topright'}
    if not lj.get('show') or not labels:
        return out
    widths = legend_label_widths(labels, font_px, look['family'], fig)
    out['box'] = legend_box_size(widths, font_px, _legend_setting(lj, 'padding'),
                                 _legend_setting(lj, 'itemSpacing'),
                                 _legend_setting(lj, 'orientation'))
    box = out['box']
    # The plot area in whole thousandths of a px: matplotlib's figure fractions carry float
    # dust (440.00000000000006) that would add a column to the occupancy grid.
    base_w, base_h = round(float(base_w), 6), round(float(base_h), 6)
    aw, ah = area if area is not None else (base_w, base_h)
    aw, ah = round(float(aw), 6), round(float(ah), 6)
    out['area'] = (aw, ah)
    if out['position'] == 'auto' and aw > 0 and ah > 0:
        occ = build_occupancy(aw, ah, obstacles(aw, ah) if obstacles else [])
        out['occupancy'] = occ
        out['auto'] = choose_legend_placement(occ, aw, ah, box['width'], box['height'],
                                              LEGEND_MARGIN, allow_outside)
    outside = allow_outside and (out['position'] == 'outsideright' or (
        out['position'] == 'auto' and out['auto'] is not None and out['auto']['outside']))
    if outside:
        m = LEGEND_MARGIN
        reserve = box['width'] + m + (m if has_right_axis else 0)
        x = base_w - reserve + (padding_right if has_right_axis else 0) + m
        extra = keys_reserve - reserve
        if extra > 0:
            reserve, x = keys_reserve, x - extra
        out['outside'] = {'reserveW': reserve, 'x': x, 'y': 0.0}
        out['reserveW'] = reserve
    return out


def legend_draw_position(legend_json, layout, plot_w, plot_h):
    """Legend.svelte legendPosition: the box's top left in px from the plot area's top left,
    over the plot area as drawn (`plot_w` x `plot_h`)."""
    lj = legend_json or {}
    box = layout['box']
    w, h, m = box['width'], box['height'], LEGEND_MARGIN
    pos = layout['position']
    auto = layout.get('auto')
    if pos == 'auto':
        if auto and auto['outside'] and layout.get('outside'):
            return layout['outside']['x'], layout['outside']['y']
        if auto and not auto['outside']:
            return auto['x'], auto['y']
        return plot_w - w - m, m
    if pos == 'outsideright':
        if layout.get('outside'):
            return layout['outside']['x'], layout['outside']['y']
        return plot_w - w - m, m
    if pos == 'custom':
        fx = min(1, max(0, _legend_setting(lj, 'customX') or 0))
        fy = min(1, max(0, _legend_setting(lj, 'customY') or 0))
        return m + max(0, plot_w - w - 2 * m) * fx, m + max(0, plot_h - h - 2 * m) * fy
    return {'topright': (plot_w - w - m, m), 'topleft': (m, m),
            'bottomright': (plot_w - w - m, plot_h - h - m),
            'bottomleft': (m, plot_h - h - m)}.get(pos, (m, m))


def legend_placed_box(legend_json, layout, plot_w, plot_h):
    """EncodingKeyLayout.legendPlaced: the series legend as drawn, for the keys to keep clear
    of ({'x', 'y', 'w', 'h', 'outside', 'corner'}), or None."""
    box = layout.get('box') if layout else None
    if not box:
        return None
    if layout.get('outside'):
        o = layout['outside']
        return {'x': o['x'], 'y': o['y'], 'w': box['width'], 'h': box['height'],
                'outside': True, 'corner': None}
    pos = layout['position']
    m = LEGEND_MARGIN
    auto = layout.get('auto') if pos == 'auto' else None
    corner = (auto['name'] if auto else None) if pos == 'auto' else \
        (None if pos == 'custom' else pos)
    bottom = corner in ('bottomright', 'bottomleft')
    left = corner in ('topleft', 'bottomleft')
    y = auto['y'] if auto else (plot_h - box['height'] - m if bottom else m)
    x = auto['x'] if auto else (m if left else plot_w - box['width'] - m)
    return {'x': x, 'y': y, 'w': box['width'], 'h': box['height'], 'outside': False,
            'corner': corner}


def reserve_axes_right(axes, reserve):
    """Take `reserve` px off the right of every axes in `axes` (the room an outside legend or
    a key beside the plot takes from the plot area)."""
    if not reserve or reserve <= 0:
        return
    # Every new position from the ORIGINAL ones: twinned axes (twinx) share their position,
    # so moving one already moves the other.
    axes = [a for a in axes if a is not None]
    targets = []
    for a in axes:
        pos = a.get_position()
        fw = a.figure.get_size_inches()[0] * _FIG_PX_PER_IN
        targets.append([pos.x0, pos.y0, max(1.0, pos.width * fw - reserve) / fw, pos.height])
    for a, t in zip(axes, targets):
        a.set_position(t)


# Where matplotlib anchors an inside candidate's box (its corner or edge midpoint), so the
# frame lines up with the plot area's edges as the app's box does whatever its exact size.
_LEGEND_ANCHOR = {'topright': 'upper right', 'topleft': 'upper left',
                  'bottomright': 'lower right', 'bottomleft': 'lower left',
                  'top': 'upper center', 'bottom': 'lower center', 'right': 'center right',
                  'left': 'center left'}


def legend_anchor_kwargs(legend_json, layout, ax):
    """ax.legend placement keywords for a legend `layout` (legend_layout): an inside candidate
    or fixed corner by its anchor 10 px in, an outside legend by its top left."""
    w_px, h_px = _axes_px(ax)
    pos = layout['position']
    auto = layout.get('auto')
    if layout.get('outside'):
        x, y = layout['outside']['x'], layout['outside']['y']
        return {'loc': 'upper left', 'bbox_to_anchor': (x / w_px, 1 - y / h_px),
                'borderaxespad': 0}
    if pos == 'auto' and auto and not auto['outside']:
        return {'loc': _LEGEND_ANCHOR.get(auto['name'], 'upper right')}
    if pos in ('auto', 'outsideright'):
        return {'loc': 'upper right'}
    return {}


def _axes_frame_px(ax):
    """The axes' plot area in figure px from the figure's top left: (left, top, w, h)."""
    fw, fh = ax.figure.get_size_inches()
    pos = ax.get_position()
    return (pos.x0 * fw * _FIG_PX_PER_IN, (1 - pos.y1) * fh * _FIG_PX_PER_IN,
            pos.width * fw * _FIG_PX_PER_IN, pos.height * fh * _FIG_PX_PER_IN)


def _px_scale(lo, hi, length, log=False, flip=False):
    """A d3 linear (or log) scale from [lo, hi] onto [0, length] px ([length, 0] with `flip`),
    as a function returning NaN for what it cannot place."""
    if log:
        if not (lo > 0 and hi > 0) or lo == hi:
            return lambda v: float('nan')
        a, b = math.log(lo), math.log(hi)

        def f(v):
            if not _ok_number(v) or v <= 0:
                return float('nan')
            t = (math.log(v) - a) / (b - a)
            return length - t * length if flip else t * length
        return f
    span = hi - lo

    def g(v):
        if not _ok_number(v):
            return float('nan')
        t = (v - lo) / span if span else 0.5
        return length - t * length if flip else t * length
    return g


def line_series_obstacle(x, y, xs, ys, line_json=None, points_json=None):
    """legendAuto.svelte.js lineSeriesObstacle: one series' line and/or points in px, or None
    when neither is drawn."""
    line = bool(_with_defaults(line_json, _LINE_DEFAULTS)['draw']) if line_json is not None \
        else False
    pts_cfg = _with_defaults(points_json, _POINTS_DEFAULTS) if points_json is not None else None
    pts = bool(pts_cfg['draw']) if pts_cfg else False
    if not line and not pts:
        return None
    n = min(len(x or []), len(y or []))
    px, py = [], []
    for i in range(n):
        xv, yv = x[i], y[i]
        bad = xv is None or yv is None or (isinstance(xv, float) and math.isnan(xv)) or \
            (isinstance(yv, float) and math.isnan(yv))
        px.append(float('nan') if bad else xs(xv))
        py.append(float('nan') if bad else ys(yv))
    return {'px': px, 'py': py, 'line': line,
            'radius': (_js_number(pts_cfg['radius']) or 0) if pts else 0}


def _axes_px(ax):
    """The axes' (width, height) in figure px (96 to the inch)."""
    fw, fh = ax.figure.get_size_inches()
    pos = ax.get_position()
    return max(1.0, pos.width * fw * _FIG_PX_PER_IN), max(1.0, pos.height * fh * _FIG_PX_PER_IN)


def plot_look(plot):
    """resolve_figure_style for one exported plot."""
    return resolve_figure_style((plot or {}).get('style'))


def _finite_values(values):
    out = []
    for v in values or []:
        if v is None or _js_invalid(v):
            continue
        f = _js_number(v)
        if math.isfinite(f):
            out.append(f)
    return out


def _extent_of(*arrays):
    lo, hi = math.inf, -math.inf
    for a in arrays:
        for v in _finite_values(a):
            lo, hi = min(lo, v), max(hi, v)
    return (lo, hi) if lo <= hi else (None, None)


def _merge_extent(ext, other):
    if not other:
        return ext
    lo, hi = ext
    return (other[0] if lo is None else min(lo, other[0]),
            other[1] if hi is None else max(hi, other[1]))


def plot_scatterplot(plot, columns_index, ax_left, ax_right=None):
    """Series may target the left or right Y axis (`yAxis: 'right'`).
    Each series may show points and/or a line. A number x series on a plot that also has
    time x data counts hours from its column's time origin (the app's xOriginFor), so it
    shares the date axis; the overlays (reference lines and bands, including migrated legacy
    night bands) are drawn as the app draws them (_draw_overlays). The axes are the app's
    (scatter_axis_specs): its domains, d3's ticks for the saved tick counts, time ticks in the
    display zone, gridlines per axis and the figure's type sizes. The legend goes where the
    app puts it (legend_layout: a corner, the 'auto' search over the drawn marks and an inside
    colour bar, or outside on the right sharing the margin with the keys beside the plot), and
    the keys stack after it (encoding_key_layout)."""
    p = plot.get('plot', {})
    look = plot_look(plot)
    base_w, base_h = _axes_px(ax_left)
    xctx = _scatter_x_context(p, columns_index)
    encodings = scatter_colour_encodings(plot, columns_index)
    sizes = scatter_size_encodings(plot, columns_index)
    xy = {}
    app_xy = []
    used_right = False
    for index, series in enumerate(p.get('data', [])):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        origin = xctx['origin_for'](x_col)
        if origin is not None:
            x = pd.to_datetime([None if _js_invalid(h) else origin + _js_number(h) * _MS_PER_HOUR
                                for h in x_col.get_data()], unit='ms', utc=True).tolist()
            x_app = [None if _js_invalid(h) else origin + _js_number(h) * _MS_PER_HOUR
                     for h in x_col.get_data()]
        else:
            x = _x_for_plot(x_col)
            x_app = [None if _js_invalid(v) else _js_number(v) for v in x_col.get_data()]
        y = y_col.get_data()
        # Rows stay aligned (not _paired_finite): a missing row is where the line breaks.
        if not any(_js_plot_valid(a) and _js_plot_valid(b) for a, b in zip(x, y)):
            continue
        ax = ax_right if (series.get('yAxis') == 'right'
                          and ax_right is not None) else ax_left
        if series.get('yAxis') == 'right':
            used_right = True
        label = series.get('label') or _display_name(y_col)
        xy[index] = (x, y)
        enc = encodings[index] if index < len(encodings) else None
        size = sizes[index] if index < len(sizes) else None
        _draw_series_marks(ax, x, y, series, index, label,
                           resolved=_resolved_series_colours(plot, index),
                           colour_by=None if enc is None else {
                               'idx': enc['idx'], 'palette': enc['palette'],
                               'line': enc['line']},
                           size_by=None if size is None else {
                               'r': size['r'], 'layer': size['layer'],
                               'no_value_layer': size['no_value_layer']})
        app_xy.append((index, series, x_app,
                       [None if _js_invalid(v) else _js_number(v) for v in y],
                       label, size))
    # Overlay y channels read on the left axis while it carries data, else on the right
    # (Scatterplot overlayYAxis).
    series_list = p.get('data', []) or []
    has_left = any((s.get('yAxis') or 'left') == 'left' for s in series_list)
    has_right = any(s.get('yAxis') == 'right' for s in series_list)
    ov_ax = ax_right if (ax_right is not None and not has_left and has_right) else ax_left
    is_time = xctx['any_time']
    xlims_in = p.get('xlimsIN')
    first_line = (series_list[0].get('line') or {}) if series_list else {}
    first_colour = first_line.get('colour') or first_line.get('color') or (
        _resolved_series_colours(plot, 0).get('line'))
    right_axis = ax_right is not None and used_right
    pad_right = float(((p.get('padding') or {}).get('right')) or 30)

    def x_value_for(col):
        # Scatterplot.overlayXValueFor: an hours-from-origin column lands on the time axis.
        origin = xctx['origin_for'](col)
        return (lambda h: origin + h * _MS_PER_HOUR) if origin is not None else None

    # Colour by / Size by: the colour bar for the first coloured series and the size key for
    # the first sized one (EncodingKeyLayout); the room they take beside the plot.
    key = scatter_colour_key(plot, columns_index, encodings, xy)
    size_key = scatter_size_key(plot, sizes, xy)
    legend_json = p.get('legend') or {}
    labels = [lab for _i, s, _x, _y, lab, _z in app_xy
              if _marks_legend_drawn(s.get('line'), s.get('points'))]
    labels += _overlay_legend_labels(plot, host='scatterplot', legacy_night_bands=True,
                                     x_is_time=is_time)
    box_only = legend_layout({**legend_json, 'position': 'topright'}, labels, look, base_w,
                             base_h, fig=ax_left.figure)['box']
    keys = _colour_key_reserve(base_h, key, p.get('colourScale'), look,
                               has_right_axis=right_axis, size_key=size_key,
                               size_json=p.get('sizeScale'), legend_json=legend_json,
                               legend_box=box_only)
    # The x domain's marker room is decided at the narrowest the plot area can be (the
    # Scatterplot's xlims): less an outside legend that may be reserved, or the keys.
    may_go_outside = box_only is not None and legend_json.get('position') in ('auto',
                                                                              'outsideright')
    length_px = base_w - max(box_only['width'] + 2 * LEGEND_MARGIN if may_go_outside else 0,
                             keys['reserveW'])

    def x_domain(extent):
        return scatter_axis_specs(plot, columns_index, ax_left, xctx, extent,
                                  sizes=sizes, length_px=length_px)['bottom']['domain']

    ov = _draw_overlays(
        ov_ax, plot, columns_index, host='scatterplot', x_value_for=x_value_for,
        x_is_time=is_time, x_data_extent=xctx['extent'], xlims_in=xlims_in,
        xlog=bool(p.get('xLogScale')) and not is_time,
        ylog=bool(p.get('yLogScaleRight' if ov_ax is ax_right and ax_right is not None
                        else 'yLogScaleLeft')),
        legacy_night_bands=True,
        series_colour=first_colour, x_domain=x_domain)
    specs = scatter_axis_specs(plot, columns_index, ax_left, xctx, ov.get('extent'),
                               key=key, has_right_axis=right_axis, sizes=sizes,
                               length_px=length_px)

    def obstacles(w, h):
        xd = specs['bottom']['domain']
        xs = _px_scale(xd[0], xd[1], w, log=specs['bottom']['kind'] == 'log')
        yscales = {}
        for side in ('left', 'right'):
            if side in specs:
                d = specs[side]['domain']
                yscales[side] = _px_scale(d[0], d[1], h, log=specs[side]['kind'] == 'log',
                                          flip=True)
        out = []
        for _i, s, x_app, y_app, _lab, size in app_xy:
            line = _with_defaults(s.get('line'), _LINE_DEFAULTS)
            pts = _with_defaults(s.get('points'), _POINTS_DEFAULTS)
            if not line['draw'] and not pts['draw']:
                continue
            ys = yscales.get('right' if s.get('yAxis') == 'right' else 'left') or \
                yscales['left']
            n = min(len(x_app), len(y_app))
            px = [float('nan') if x_app[i] is None or y_app[i] is None else xs(x_app[i])
                  for i in range(n)]
            py = [float('nan') if x_app[i] is None or y_app[i] is None else ys(y_app[i])
                  for i in range(n)]
            radius = ((size['max_r'] if size is not None else _js_number(pts['radius'])) or 0) \
                if pts['draw'] else 0
            out.append({'px': px, 'py': py, 'line': bool(line['draw']), 'radius': radius})
        bar = _keys_obstacle(w, h, keys)
        if bar:
            out.append(bar)
        return out
    layout = legend_layout(legend_json, labels, look, base_w, base_h, obstacles=obstacles,
                           area=(base_w - keys['reserveW'], base_h),
                           has_right_axis=right_axis, padding_right=pad_right,
                           keys_reserve=keys['reserveW'], fig=ax_left.figure)
    reserve_axes_right((ax_left, ax_right), max(layout['reserveW'], keys['reserveW']))
    _draw_app_axes(ax_left, ax_right if used_right else None, specs, look)
    if ax_right is not None and not used_right:
        ax_right.set_axis_off()
    if legend_json.get('show', False):
        _legend_with_overlays(ax_left, ov['legend'],
                              extra_axes=(ax_right,) if ax_right is not None else (),
                              legend_json=legend_json, look=look, layout=layout,
                              on=ax_right)
    ax_left._ancir_legend_layout = layout
    plot_w, plot_h = _axes_px(ax_left)
    placed = legend_placed_box(legend_json, layout, plot_w, plot_h)
    klayout = encoding_key_layout(ax_left, key, size_key, p.get('colourScale'),
                                  p.get('sizeScale'), look, has_right_axis=right_axis,
                                  padding_right=pad_right, legend_box=placed,
                                  legend_json=legend_json, legend_size=box_only,
                                  base_h=base_h)
    ax_left._ancir_key_layout = klayout
    if klayout['colour'] is not None:
        _draw_colour_key(ax_left, key, p.get('colourScale'), has_right_axis=right_axis,
                         look=look, padding_right=pad_right, at=klayout['colour'])
    _draw_size_key(ax_left, size_key, p.get('sizeScale'), klayout['size'], look=look)


def _colour_key_reserve(base_h, key, scale_json, look, has_right_axis=False, size_key=None,
                        size_json=None, legend_json=None, legend_box=None):
    """EncodingKeyLayout before placement: the bar's plan and base geometry, the size key's
    geometry, whether they sit side by side, and `reserveW`, the room the keys beside the plot
    take from the plot area (the wider one's width, or both and the gap between them side by
    side, plus a 10 px margin and another past a right axis). `legend_box` is the series
    legend's box (legend_box_size): a category key's room beside the plot starts under a legend
    placed 'outsideright'."""
    scale = scale_json or {}
    ss = size_json or {}
    out = {'reserveW': 0.0, 'plan': None, 'base': None, 'size_geom': None, 'beside': False,
           'cs': scale, 'ss': ss, 'look': look}
    bar_w = size_w = 0
    under = 0
    if (legend_json or {}).get('position') == 'outsideright' and legend_box:
        under = legend_box['height'] + LEGEND_MARGIN
    if key is not None and scale.get('show', True) is not False:
        plan = _colour_key_plan(base_h, key, scale, look, under=under)
        out['plan'], out['base'] = plan, plan['geom'](plan['length0'])
        if (scale.get('position') or 'right') == 'right':
            bar_w = out['base']['width']
    if size_key is not None and ss.get('show', True) is not False:
        spacing = ss.get('itemSpacing')
        out['size_geom'] = size_key_geometry(
            size_key['items'], size_key['no_value'], size_key['title'], _key_font_px(ss, look),
            spacing if isinstance(spacing, (int, float)) else 4)
        if (ss.get('position') or 'right') == 'right':
            size_w = out['size_geom']['width']
    c_pos = scale.get('position') or 'right'
    s_pos = ss.get('position') or 'right'
    if out['base'] is not None and out['size_geom'] is not None and c_pos == s_pos and \
            c_pos != 'custom':
        out['beside'] = _keys_side_by_side(base_h, out['plan'], out['base'], out['size_geom'],
                                           c_pos, _key_inset(scale), _key_inset(ss),
                                           LEGEND_MARGIN)
    # Side by side beside the plot (EncodingKeyLayout.sizeBeside): both widths and the margin.
    width = bar_w + LEGEND_MARGIN + size_w if (out['beside'] and bar_w > 0) else \
        max(bar_w, size_w)
    if width > 0:
        out['reserveW'] = width + LEGEND_MARGIN + (LEGEND_MARGIN if has_right_axis else 0)
    return out


def _keys_obstacle(w, h, keys):
    """EncodingKeyLayout.obstacle: the keys inside a w x h plot area as a buildOccupancy
    series of rectangles (backdrops included), or None when neither is inside."""
    rects = []
    cs, ss = keys['cs'], keys['ss']
    m = LEGEND_MARGIN
    bar = None
    base = keys['base']
    c_pos = cs.get('position') or 'right'
    s_pos = ss.get('position') or 'right'
    c_inset, s_inset = _key_inset(cs), _key_inset(ss)
    if base is not None and c_pos != 'right':
        x, y, _ = place_key(c_pos, base['width'], base['height'], w, h, m,
                            custom={'customX': cs.get('customX'), 'customY': cs.get('customY')},
                            inset=c_inset)
        bar = [x - c_inset, y - c_inset, x + base['width'] + c_inset,
               y + base['height'] + c_inset]
        rects.append(bar)
    sg = keys['size_geom']
    if bar and keys['beside'] and sg is not None:
        x, y = place_beside(s_pos, sg['width'], sg['height'],
                            {'x': bar[0], 'y': bar[1], 'w': bar[2] - bar[0], 'h': bar[3] - bar[1]},
                            m, inset=s_inset)
        rects.append([x - s_inset, y - s_inset, x + sg['width'] + s_inset,
                      y + sg['height'] + s_inset])
        return {'rects': rects}
    shares = bar is not None and sg is not None and c_pos == s_pos and c_pos != 'custom'
    before = [{'x': bar[0], 'y': bar[1], 'w': bar[2] - bar[0], 'h': bar[3] - bar[1],
               'outside': False, 'corner': c_pos}] if shares else []
    if sg is not None and s_pos != 'right':
        x, y, _ = place_key(s_pos, sg['width'], sg['height'], w, h, m, stack=before,
                            custom={'customX': ss.get('customX'), 'customY': ss.get('customY')},
                            inset=s_inset)
        rects.append([x - s_inset, y - s_inset, x + sg['width'] + s_inset,
                      y + sg['height'] + s_inset])
    return {'rects': rects} if rects else None


def _colour_key_font_px(scale_json, look):
    """ColourScale.svelte: the key's own `fontSize` (px), else the figure's legend size."""
    fs = (scale_json or {}).get('fontSize')
    if _style_valid(fs, 'number') and fs > 0:
        return float(fs)
    return (look or resolve_figure_style(None))['px']['legend']


def _draw_app_axes(ax, ax_right, specs, look):
    """Every axis in `specs` ({'bottom'|'top'|'left'|'right': spec}) onto `ax` (the right one
    onto `ax_right`, its gridlines into `ax`), with only those axis lines drawn."""
    sides = set(specs)
    app_axes_frame(ax, sides - {'right'} if ax_right is not None else sides)
    ax._ancir_axes = {s: (ax_right if s == 'right' and ax_right is not None else ax)
                      for s in sides}
    for pos in ('bottom', 'top'):
        if pos in specs:
            apply_app_axis(ax, 'x', pos, specs[pos], look)
    if 'left' in specs:
        apply_app_axis(ax, 'y', 'left', specs['left'], look)
    if 'right' in specs:
        if ax_right is not None:
            app_axes_frame(ax_right, {'right'}, twin=True)
            apply_app_axis(ax_right, 'y', 'right', specs['right'], look, grid_ax=ax)
        else:
            apply_app_axis(ax, 'y', 'right', specs['right'], look)


def scatter_axis_specs(plot, columns_index, ax, xctx=None, overlay_extent=None, key=None,
                       has_right_axis=False, sizes=None, length_px=None):
    """Scatterplotclass's axes: x (xlims, XScale: time when any x is time, log when asked
    and both ends are positive) and the left and right y (ylimsLeft/Right, YScaleLeft/Right).
    Automatic ends are the data's range (x floored and ceiled to whole units) widened by the
    overlays on that axis, then by room for the widest marker (markerPaddedDomain; a sized
    series' largest point, `sizes` from scatter_size_encodings); a manual end wins as
    typed."""
    p = plot.get('plot', {}) or {}
    xctx = xctx or _scatter_x_context(p, columns_index)
    w_px, h_px = _axes_px(ax)
    if length_px is not None:
        # The width the x domain's marker room is decided at (plot_scatterplot).
        w_px = length_px
    series = []
    max_r = {}
    for i, s in enumerate(p.get('data', []) or []):
        x_col = _resolve_plot_col(s.get('x'), columns_index)
        y_col = _resolve_plot_col(s.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        series.append((s, x_col, y_col))
        if sizes is not None and i < len(sizes) and sizes[i] is not None:
            max_r[id(s)] = sizes[i]['max_r']

    def pad_px(ss):
        pad = 0.0
        for s, _, _ in ss:
            line = _with_defaults(s.get('line'), _LINE_DEFAULTS)
            pts = _with_defaults(s.get('points'), _POINTS_DEFAULTS)
            if pts['draw']:
                pad = max(pad, max_r.get(id(s), _js_number(pts['radius'])) or 0)
            if line['draw']:
                pad = max(pad, (_js_number(line['strokeWidth']) or 0) / 2)
        return pad + 1 if pad > 0 else 0
    ov_ext = overlay_extent or {}
    is_time = xctx['any_time']
    xlog = bool(p.get('xLogScale')) and not is_time
    # x
    ext = xctx['extent']
    xin = list(p.get('xlimsIN') or [None, None]) + [None, None]
    if not series:
        xd = (0.0, 0.0)
    elif ext is None:
        xd = (xin[0] if xin[0] is not None else 0, xin[1] if xin[1] is not None else 1)
    else:
        lo, hi = _merge_extent(tuple(ext), ov_ext.get('x'))
        xd = _manual_or(xin, marker_padded_domain(lo, hi, pad_px(series), w_px, log=xlog))
    x_kind = 'time' if is_time else ('log' if xlog and xd[0] > 0 and xd[1] > 0 else 'linear')
    x_axis = p.get('xAxis') or {}
    specs = {'bottom': {
        'kind': x_kind, 'domain': xd, 'axis': x_axis,
        'zone': DISPLAY_TIMEZONE, 'time_format': p.get('xTickFormat') or '',
        'tick_mode': 'time' if is_time else 'numeric'}}
    has_left = any((s.get('yAxis') or 'left') == 'left' for s, _, _ in series)
    has_right = any(s.get('yAxis') == 'right' for s, _, _ in series)
    ov_side = 'left' if has_left or not has_right else 'right'
    for side in ('left', 'right'):
        ss = [t for t in series if (t[0].get('yAxis') or 'left') == side]
        log = bool(p.get('yLogScaleLeft' if side == 'left' else 'yLogScaleRight'))
        manual = p.get('ylimsLeftIN' if side == 'left' else 'ylimsRightIN')
        if not ss:
            dom = (0.0, 0.0)
        else:
            lo, hi = _extent_of(*[y.get_data() for _, _, y in ss])
            if side == ov_side:
                lo, hi = _merge_extent((lo, hi), ov_ext.get('y'))
            if lo is None:
                lo, hi = math.inf, -math.inf
            dom = _manual_or(manual, marker_padded_domain(lo, hi, pad_px(ss), h_px, log=log))
        if side == 'right' and not ss:
            continue
        axis_json = p.get('yAxisLeft' if side == 'left' else 'yAxisRight') or (
            {'gridlines': side == 'left'})
        specs[side] = {'kind': 'log' if log and dom[0] > 0 and dom[1] > 0 else 'linear',
                       'domain': dom, 'axis': axis_json}
    if 'left' not in specs:
        specs['left'] = {'kind': 'linear', 'domain': (0.0, 0.0),
                         'axis': p.get('yAxisLeft') or {}}
    for s in specs.values():
        if s['domain'][0] == s['domain'][1]:
            # d3 draws a zero-span domain at one tick; matplotlib needs a span.
            s['domain'] = (s['domain'][0] - 0.5, s['domain'][1] + 0.5) if s['kind'] != 'time' \
                else (s['domain'][0] - _MS_PER_HOUR, s['domain'][1] + _MS_PER_HOUR)
    return specs


# fftAxis.js: the x title follows the mode while it is one the plot generated itself.
FFT_PERIOD_LABEL = 'Period (h)'
FFT_FREQUENCY_LABEL = 'Frequency (cycles/h)'
_FFT_AUTO_LABELS = {'Frequency', 'Period', 'Period (hours)', FFT_PERIOD_LABEL,
                    FFT_FREQUENCY_LABEL, 'Frequency (cycles/hr)'}


def fft_x_axis_label(x_axis, show_period):
    """The FFT's x title (FFTclass.fromJSON + syncXAxisLabel): a saved automatic label (or
    none saved, a legacy plot) is the mode's; the user's own wording, even empty, is kept."""
    auto = FFT_PERIOD_LABEL if show_period else FFT_FREQUENCY_LABEL
    if not isinstance(x_axis, dict):
        return auto
    label = x_axis.get('label')
    label = '' if label is None else str(label)
    return auto if label.strip() in _FFT_AUTO_LABELS else label


def plot_fft(plot, columns_index, ax):
    """The FFT as the app draws it: each series' magnitude line and points on the left axis
    and, for a series with `showPhase`, its phase line and points (`phaseLine` /
    `phasePoints`, the series' own colour unless chosen) on the right-hand phase axis
    (`yAxisPhase`, its range the drawn phases padded 10%, `phaseYlimsIN` winning), all in one
    plot area; period mode drops the f = 0 term. The legend lists every series' magnitude
    entry, then its phase entry ("<series> phase"), then the overlays."""
    p = plot.get('plot', {})
    look = plot_look(plot)
    show_period = p.get('showPeriod', False)
    log = bool(p.get('logScale', False))
    base_w, base_h = _axes_px(ax)
    drawn = []
    mags_all = []
    nyquists, min_periods, valid_freqs = [], [], []
    series_out = []
    series_list = p.get('data', []) or []
    any_phase = any(s.get('showPhase') for s in series_list)
    ax_phase = ax.twinx() if any_phase else None
    for index, series in enumerate(series_list):
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
        nyquists.append(fft.get('nyquistFreq') or 0)
        min_periods.append(fft.get('minPeriod') or 0.1)
        valid_freqs += [f for f in fft['frequencies'] if f > 0]
        mags_all += list(fft['magnitudes'])
        if not fft['frequencies']:
            continue
        freqs = fft['frequencies']
        keep = [i for i, f in enumerate(freqs) if f > 0 or not show_period]
        xs = [1.0 / freqs[i] if show_period else freqs[i] for i in keep]
        mags = [fft['magnitudes'][i] for i in keep]
        phases = [fft['phases'][i] for i in keep]
        # Period mode draws f > 0 only (the f = 0 term has no period), as the app does.
        drawn += mags
        label = series.get('label') or _display_name(y_col)
        resolved = _resolved_series_colours(plot, index)
        marks = _draw_series_marks(ax, xs, mags, series, index, label, resolved=resolved)
        entry = {'index': index, 'series': series, 'label': label, 'x': xs, 'mag': mags,
                 'phase': phases, 'all_phases': list(fft['phases']), 'marks': marks,
                 'phase_marks': None}
        if series.get('showPhase') and ax_phase is not None:
            # The phase line and points are LineClass / PointsClass of the same series: an
            # automatic colour is the series' own (the column's), as the magnitude's.
            phase_series = {'line': series.get('phaseLine'), 'points': series.get('phasePoints')}
            entry['phase_marks'] = _draw_series_marks(
                ax_phase, xs, phases, phase_series, index, f'{label} phase',
                resolved={'line': resolved.get('line'), 'points': resolved.get('points')},
                gid_prefix=f'series-{index}-phase')
        series_out.append(entry)
    # Vertical overlay positions are periods in hours, drawn at 1/p while the axis shows
    # frequency (FFT.overlayXTransform); p <= 0 has no place on either axis. Overlays read on
    # the magnitude axis only.
    ov = _draw_overlays(ax, plot, columns_index,
                        x_transform=lambda v: (None if not (v > 0)
                                               else (v if show_period else 1.0 / v)),
                        ylog=log)
    # FFTclass.xlims: frequency 0 .. Nyquist, or period from the shortest resolvable one
    # (2 dt) to the longest drawn, the user's ends winning within those bounds.
    n_series = len(series_list)
    max_f = max(nyquists) if nyquists else 1
    min_p = max(min_periods) if min_periods else 0.1
    xin = list(p.get('xlimsIN') or [None, None]) + [None, None]
    if n_series == 0:
        xd = (0.1, 100) if show_period else (0, 1)
    elif show_period:
        d0, d1 = ((max(1 / max(valid_freqs), min_p), 1 / min(valid_freqs)) if valid_freqs
                  else (min_p, 100))
        xd = (max(xin[0], min_p) if xin[0] is not None else d0,
              xin[1] if xin[1] is not None else d1)
    else:
        xd = (max(xin[0], 0) if xin[0] is not None else 0,
              min(xin[1], max_f) if xin[1] is not None else max_f)
    y_axis = p.get('yAxisMag') or {}
    lo, hi = _merge_extent(_extent_of(mags_all), ov.get('extent', {}).get('y'))
    yd = (0.0, 1.0) if lo is None else padded_domain(lo, hi, lower_bound=0,
                                                     nice=y_axis.get('nticks') or 5)
    yd = _manual_or(p.get('ylimsIN'), yd)
    if log:
        yd = log_axis_domain(_number_or_none((p.get('ylimsIN') or [None])[0]),
                             _min_positive(drawn, ov['y_values']), yd[1])
    phase_d = fft_phase_domain(series_out, series_list, p.get('phaseYlimsIN'))
    x_axis = p.get('xAxis') or {}
    specs = {
        'bottom': {'kind': 'linear', 'domain': xd, 'axis': x_axis,
                   'label': fft_x_axis_label(p.get('xAxis'), show_period)},
        'left': {'kind': 'log' if log else 'linear', 'domain': yd, 'axis': y_axis,
                 'log_spec': '~g',
                 'label': y_axis.get('label') or 'Magnitude'},
    }
    if any_phase:
        phase_axis = p.get('yAxisPhase') or {'label': 'Phase (radians)', 'gridlines': False}
        specs['right'] = {'kind': 'linear', 'domain': phase_d, 'axis': phase_axis,
                          'label': phase_axis.get('label') or ''}
    legend_json = p.get('legend') or {}
    entries, labels = fft_legend_entries(series_out, series_list, columns_index)

    def obstacles(w, h):
        xs_ = _px_scale(xd[0], xd[1], w)
        ys_ = _px_scale(yd[0], yd[1], h, log=log, flip=True)
        ps_ = _px_scale(phase_d[0], phase_d[1], h, flip=True)
        out = []
        for e in series_out:
            s = e['series']
            mags = [v if (not log or (_ok_number(v) and v > 0)) else float('nan')
                    for v in e['mag']]
            o = line_series_obstacle(e['x'], mags, xs_, ys_, s.get('line') or {},
                                     s.get('points') or {})
            if o:
                out.append(o)
            if s.get('showPhase'):
                o = line_series_obstacle(e['x'], e['phase'], xs_, ps_, s.get('phaseLine') or {},
                                         s.get('phasePoints') or {})
                if o:
                    out.append(o)
        return out
    pad_right = float(((p.get('padding') or {}).get('right')) or 0)
    layout = legend_layout(legend_json, labels + _overlay_legend_labels(plot), look,
                           base_w, base_h, obstacles=obstacles, has_right_axis=any_phase,
                           padding_right=pad_right, fig=ax.figure)
    reserve_axes_right((ax, ax_phase), layout['reserveW'])
    _draw_app_axes(ax, ax_phase, specs, look)
    if ax_phase is not None:
        ax_phase.set_ylim(phase_d)
    if legend_json.get('show', False):
        _legend_with_overlays(ax, ov['legend'], legend_json=legend_json, look=look,
                              layout=layout, entries=entries, on=ax_phase)
    ax._ancir_legend_layout = layout


def fft_phase_domain(series_out, series_list, phase_in=None):
    """FFTclass.phaseYlims: over every series with phase shown, its phases (all of them, the
    f = 0 term included) padded 10% of their range each way; -pi..pi with none; the user's
    `phaseYlimsIN` ends win."""
    if not any(s.get('showPhase') for s in series_list):
        return (-math.pi, math.pi)
    vals = [v for e in series_out if e['series'].get('showPhase') for v in e['all_phases']]
    lo, hi = _extent_of(vals)
    if lo is None:
        return (-math.pi, math.pi)
    rng = hi - lo
    lo, hi = lo - rng * 0.1, hi + rng * 0.1
    manual = list(phase_in or [None, None]) + [None, None]
    return (manual[0] if manual[0] is not None else lo,
            manual[1] if manual[1] is not None else hi)


def _marks_legend_drawn(line_json, points_json):
    """Whether a Line / Points pair puts anything in the legend (their `draw`)."""
    line = _with_defaults(line_json, _LINE_DEFAULTS)
    pts = _with_defaults(points_json, _POINTS_DEFAULTS)
    return bool(line['draw']) or bool(pts['draw'])


def fft_legend_entries(series_out, series_list, columns_index):
    """FFTclass.getLegendItems' series part: ([(handle, label)] for the drawn entries, [labels]
    of every entry the app lists), each series' magnitude entry then its phase entry."""
    entries, labels = [], []
    drawn = {e['index']: e for e in series_out}
    for index, s in enumerate(series_list):
        e = drawn.get(index)
        if e is not None:
            label = e['label']
        else:
            y_col = _resolve_plot_col(s.get('y'), columns_index)
            label = s.get('label') or (_display_name(y_col) if y_col is not None else '')
        if _marks_legend_drawn(s.get('line'), s.get('points')):
            labels.append(label)
            h = (e or {}).get('marks', {}) or {}
            if h.get('legend_handle') is not None:
                entries.append((h['legend_handle'], label))
        if s.get('showPhase') and _marks_legend_drawn(s.get('phaseLine'), s.get('phasePoints')):
            labels.append(f'{label} phase')
            h = (e or {}).get('phase_marks') or {}
            if h.get('legend_handle') is not None:
                entries.append((h['legend_handle'], f'{label} phase'))
    return entries, labels


# Periodogram.svelte PERIODOGRAM_Y_LABELS / periodogramYLabel: the y title while the stored
# label is empty names the series' statistic; mixed methods are not comparable numbers.
PERIODOGRAM_Y_LABELS = {'Lomb-Scargle': 'Normalised power', 'Chi-squared': 'Chi-squared Qp',
                        'Enright': 'Enright amplitude (A_p)'}
PERIODOGRAM_MIXED_Y_LABEL = 'Statistic (mixed methods)'


def periodogram_y_label(methods):
    s = {m for m in methods if m}
    if len(s) > 1:
        return PERIODOGRAM_MIXED_Y_LABEL
    if len(s) == 1:
        return PERIODOGRAM_Y_LABELS.get(next(iter(s)), 'Power')
    return 'Power'


def plot_periodogram(plot, columns_index, ax):
    p = plot.get('plot', {})
    look = plot_look(plot)
    # Method and bin size are per series, as in the app (_periodogram_series_params). They
    # used to be read from the plot, where the app never stores them, so every exported
    # periodogram was drawn as Lomb-Scargle.
    drawn = []
    base_w, base_h = _axes_px(ax)
    series_out = []
    labels = []
    for index, series in enumerate(p.get('data', [])):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        label = series.get('label') or _display_name(y_col)
        method = series.get('method') or 'Lomb-Scargle'
        threshold_line = series.get('thresholdline') or {}
        show_threshold = method == 'Chi-squared' and \
            _with_defaults(threshold_line, _LINE_DEFAULTS)['draw']
        if _marks_legend_drawn(series.get('line'), series.get('points')):
            labels.append(label)
        if show_threshold:
            labels.append(f'{label} threshold')
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        params = _periodogram_series_params(p, series, t)
        y = y_col.get_data()
        t, y = _paired_finite(t, y)
        if not t:
            continue
        result = run_periodogram_calculation({'t': t, 'y': y, **params})
        threshold = result.get('threshold') if show_threshold else None
        drawn += list(result['y']) + list(threshold or [])
        resolved = _resolved_series_colours(plot, index)
        _draw_series_marks(ax, result['x'], result['y'], series, index, label,
                           resolved=resolved)
        if threshold is not None:
            # The Sidak line is per fold (its df follows the occupied columns), so it is a
            # curve over period, not one horizontal value; drawn as the series' threshold
            # line (`thresholdline`, the series' colour unless chosen), only for Chi-squared.
            _draw_series_marks(ax, result['x'], threshold,
                               {'line': threshold_line, 'points': {'draw': False}}, index,
                               f'{label} threshold', resolved={'line': resolved.get('line')},
                               gid_prefix=f'series-{index}-threshold')
        series_out.append((series, result, threshold))
    # Overlays widen the power axis only: the period range is an analysis parameter. The app's
    # `logScale` is the power axis (display only, as FFT's): a mark at or below 0 is skipped.
    log = bool(p.get('logScale', False))
    first_line = ((p.get('data') or [{}])[0].get('line') or {})
    ov = _draw_overlays(ax, plot, columns_index,
                        series_colour=(first_line.get('colour') or first_line.get('color')
                                       or _resolved_series_colours(plot, 0).get('line')),
                        ylog=log)
    # An empty stored label is the per-method default (Periodogram.svelte defaultYLabel); an
    # inner from before AxisClass (no yAxis) drew a fixed "Power".
    y_axis = p.get('yAxis')
    ylabel = ((y_axis or {}).get('label') or
              (periodogram_y_label([d.get('method') or 'Lomb-Scargle' for d in p.get('data', [])])
               if (y_axis is not None or 'ygridlines' not in p) else 'Power'))
    # Periodogramclass.ylims: the drawn power (and threshold) padded 5%, never below 0, out
    # to a nice tick; the period axis is the analysis range (periodlimsIN).
    lo, hi = _merge_extent(_extent_of(drawn), ov.get('extent', {}).get('y'))
    y_axis = y_axis or {}
    if not (p.get('data') or []):
        yd = (0.0, 0.0)
    elif lo is None:
        yd = (0.0, 0.0)
    else:
        yd = _manual_or(p.get('ylimsIN'),
                        padded_domain(lo, hi, lower_bound=0, nice=y_axis.get('nticks') or 5))
    if log:
        yd = log_axis_domain(_number_or_none((p.get('ylimsIN') or [None])[0]),
                             _min_positive(drawn, ov['y_values']), yd[1])
    if yd[0] == yd[1]:
        yd = (yd[0], yd[0] + 1)
    xd = list(p.get('periodlimsIN') or p.get('xlimsIN') or [1, 30])
    xd = (float(xd[0] if xd[0] is not None else 1), float(xd[1] if xd[1] is not None else 30))
    x_axis = p.get('xAxis') or {}
    specs = {
        'bottom': {'kind': 'linear', 'domain': xd, 'axis': x_axis,
                   'label': x_axis.get('label') or 'Period'},
        'left': {'kind': 'log' if log else 'linear', 'domain': yd, 'axis': y_axis,
                 'log_spec': '~g', 'label': ylabel},
    }

    def obstacles(w, h):
        xs = _px_scale(xd[0], xd[1], w)
        ys = _px_scale(yd[0], yd[1], h, log=log, flip=True)
        out = []
        for series, result, threshold in series_out:
            o = line_series_obstacle(result['x'], result['y'], xs, ys, series.get('line') or {},
                                     series.get('points') or {})
            if o:
                out.append(o)
            if (series.get('method') or 'Lomb-Scargle') == 'Chi-squared' and \
                    result.get('threshold') is not None:
                o = line_series_obstacle(result['x'], result['threshold'], xs, ys,
                                         series.get('thresholdline') or {})
                if o:
                    out.append(o)
        return out
    legend_json = p.get('legend') or {}
    layout = legend_layout(legend_json, labels + _overlay_legend_labels(plot), look, base_w,
                           base_h, obstacles=obstacles, fig=ax.figure)
    reserve_axes_right((ax,), layout['reserveW'])
    _draw_app_axes(ax, None, specs, look)
    if legend_json.get('show', False):
        _legend_with_overlays(ax, ov['legend'], legend_json=legend_json, look=look,
                              layout=layout)
    ax._ancir_legend_layout = layout


def plot_correlogram(plot, columns_index, ax):
    """The Correlogram as the app draws it: per series its autocorrelation line and points,
    then its confidence bounds (+/- z / sqrt(n), n the y values present, z 1.96 or 2.576 at
    99%, each a line over the lags in the series' confidence line: '5, 5' dashes, 1 px, the
    series' colour); the zero line; the overlays; the legend (each series' entry then its
    bounds', "<series> <pct>% bounds" once the plot has more than one series) where the app
    puts it (legend_layout)."""
    p = plot.get('plot', {})
    look = plot_look(plot)
    base_w, base_h = _axes_px(ax)
    lags_max, corrs = 0, []
    series_list = p.get('data', []) or []
    name_series = len(series_list) > 1
    drawn_series = []
    labels = []
    for index, series in enumerate(series_list):
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        name = series.get('label') or (_display_name(y_col) if y_col is not None else '')
        conf = series.get('confidenceLine') or {}
        bounds_on = series.get('showConfidenceBounds', True) is not False and \
            conf.get('draw', True) is not False
        pct = round((series.get('confidenceLevel') or 0.95) * 100)
        bounds_label = f'{name} {pct}% bounds' if name_series else f'{pct}% confidence bounds'
        if _marks_legend_drawn(series.get('line'), series.get('points')):
            labels.append(name)
        if bounds_on:
            labels.append(bounds_label)
        ac = correlogram_series_acf(series, columns_index)
        if ac is None or not ac['lags']:
            continue
        m = max(_finite_values(ac['lags']) or [0])
        lags_max = max(lags_max, m)
        corrs += list(ac['correlations'])
        resolved = _resolved_series_colours(plot, index)
        _draw_series_marks(ax, ac['lags'], ac['correlations'], series, index, name,
                           resolved=resolved)
        level = None
        if bounds_on:
            # CorrelogramDataclass.confidenceBounds: under two values present both bounds are 0.
            n = len(_finite_values(y_col.get_data() if y_col is not None else []))
            z = 1.96 if series.get('confidenceLevel', 0.95) == 0.95 else 2.576
            level = z / math.sqrt(n) if n >= 2 else 0.0
            width = conf.get('strokeWidth')
            width = width if _style_valid(width, 'number') else 1
            stroke = conf.get('stroke') or '5, 5'
            colour = _mpl_colour(conf.get('colour') or (series.get('line') or {}).get('colour')
                                 or resolved.get('line'), f'C{index}')
            for k, b in enumerate((level, -level)):
                ax.plot(ac['lags'], [b] * len(ac['lags']), color=colour,
                        linewidth=width * _PX_TO_PT, linestyle=_overlay_dashes(stroke, width),
                        dash_capstyle='butt', zorder=2.1, gid=f'confidence-{index}',
                        label=bounds_label if k == 0 else '_nolegend_')
        drawn_series.append((series, ac, level))
    # Overlays widen the correlation axis only: the lag range is an analysis parameter.
    ov = _draw_overlays(ax, plot, columns_index)
    # Correlogramclass: lags 0 .. the longest lag (laglimsIN wins; `xlimsIN` is a fallback
    # for hand-written plots); correlation padded 5%, not capped at +/-1.
    n_series = len(series_list)
    xd = (0, 10) if n_series == 0 else _manual_or(p.get('laglimsIN') or p.get('xlimsIN'),
                                                   (0, lags_max))
    lo, hi = _merge_extent(_extent_of(corrs), ov.get('extent', {}).get('y'))
    yd = (-1, 1) if (n_series == 0 or lo is None) else \
        _manual_or(p.get('ylimsIN'), padded_domain(lo, hi, pad=0.05))
    # The zero line (Correlogram.svelte): dashed 4 2, 1 px, the muted text colour at half
    # opacity, when 0 is in range.
    if n_series and yd[0] <= 0 <= yd[1]:
        ax.axhline(0, color='#666666', alpha=0.5, linewidth=_PX_TO_PT,
                   linestyle=(0, (4.0, 2.0)), zorder=0.7, gid='zero-line')
    x_axis, y_axis = p.get('xAxis') or {}, p.get('yAxis') or {}
    specs = {
        'bottom': {'kind': 'linear', 'domain': xd, 'axis': x_axis,
                   'label': x_axis.get('label') or 'Lag (hrs)'},
        'left': {'kind': 'linear', 'domain': yd, 'axis': y_axis,
                 'label': y_axis.get('label') or 'Correlation'},
    }

    def obstacles(w, h):
        xs = _px_scale(xd[0], xd[1], w)
        ys = _px_scale(yd[0], yd[1], h, flip=True)
        out = []
        for series, ac, level in drawn_series:
            o = line_series_obstacle(ac['lags'], ac['correlations'], xs, ys,
                                     series.get('line') or {}, series.get('points') or {})
            if o:
                out.append(o)
            if level is not None:
                for v in (level, -level):
                    o = line_series_obstacle(ac['lags'], [v] * len(ac['lags']), xs, ys,
                                             series.get('confidenceLine') or {})
                    if o:
                        out.append(o)
        return out
    legend_json = p.get('legend') or {}
    layout = legend_layout(legend_json, labels + _overlay_legend_labels(plot), look, base_w,
                           base_h, obstacles=obstacles, fig=ax.figure)
    reserve_axes_right((ax,), layout['reserveW'])
    _draw_app_axes(ax, None, specs, look)
    if legend_json.get('show', False):
        _legend_with_overlays(ax, ov['legend'], legend_json=legend_json, look=look,
                              layout=layout)
    ax._ancir_legend_layout = layout


# ---- Boxplot (plots/Boxplot/Boxplot.svelte, plotbits/Box.svelte, plotbits/Violin.svelte) ----
#
# The export draws what the app draws, in the app's px: one box per CATEGORY per series on a
# categorical x axis (category i centred at x = i), dodged side by side when several series
# share the categories; the jittered points, the violins (Silverman KDE, 128-point grid,
# trimmed to the data), the significance brackets (the same pairwise tests as the app,
# GroupComparison's ports below) and the legend. boxplot_layout computes all of it in px from
# the plot area's top left (y down, as SVG); plot_boxplot converts each mark to data
# coordinates and draws it in the app's paint order. tools/test_plot_boxplot.py checks every
# mark against what the app draws (tools/parity/boxplot_app.json).

# Box.svelte / Violin.svelte: no violin below this many points (helpers/violin.js VIOLIN_MIN_N).
VIOLIN_MIN_N = 5
# The significance bracket's end ticks drop this many px below its bar (Boxplot.svelte).
SIG_BAR_TICK_PX = 4
_BOX_DEFAULTS = {'fillOpacity': 0.3, 'strokeWidth': 2, 'stroke': 'solid', 'draw': True,
                 'showOutliers': True, 'outlierSize': 3, 'outlierMethod': 'iqr',
                 'iqrMultiplier': 1.5, 'zThreshold': 3, 'whiskerWidth': 0.5, 'boxWidth': 0.8,
                 'medianWidth': 2, 'medianColour': '#000000'}
_BOXPLOT_DEFAULTS = {'showPoints': False, 'pointJitter': 0.35, 'pointSize': 2.5,
                     'pointOpacity': 0.6, 'pointColour': None, 'showViolin': False,
                     'showBox': True, 'violinBandwidth': None, 'violinWidth': 0.8,
                     'violinOpacity': 0.3, 'showSigBars': False, 'sigMethod': 'auto',
                     'sigAlpha': 0.05, 'showNs': False, 'sigBarThickness': 1,
                     'sigBarColor': '#000000', 'sigBarFontSize': None, 'sigBarYOffset': 0,
                     'sigBarSpacing': 1}
# Boxplot.svelte LEGACY_SIG_BAR_FONT_SIZE: a saved 11 was the old hard-coded size, released to
# follow the figure.
_LEGACY_SIG_BAR_FONT_SIZE = 11
_U32 = 0xFFFFFFFF


def box_fill_opacity(v):
    """Box.svelte boxFillOpacity: the saved fill opacity clamped to [0, 1]; anything that is not
    a finite number draws the default (0.3)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return _BOX_DEFAULTS['fillOpacity']
    return min(1.0, max(0.0, float(v)))


def _nn_default(saved, key, default):
    """`saved[key] ?? default` (JS nullish: only None/missing take the default)."""
    v = (saved or {}).get(key)
    return default if v is None else v


def _js_sum(values):
    """A left-to-right sum, as JS `reduce((a, b) => a + b, 0)` (Python 3.12's sum() of floats
    is compensated, so it can differ in the last place)."""
    s = 0.0
    for v in values:
        s += v
    return s


def _js_median(values):
    """sampleStats.js median: the middle value, or the mean of the middle two."""
    if not values:
        return float('nan')
    srt = sorted(values)
    mid = len(srt) // 2
    return (srt[mid - 1] + srt[mid]) / 2 if len(srt) % 2 == 0 else srt[mid]


def boxplot_jitter_offset(series_index, category_index, point_index):
    """helpers/jitter.js jitterOffset: the deterministic offset in [-1, 1) of one point (a
    32-bit hash of where it sits, mulberry32's finalizer), bit for bit."""
    def imul(a, b):
        return ((a & _U32) * (b & _U32)) & _U32
    h = (imul(series_index + 1, 0x9e3779b9) ^ imul(category_index + 1, 0x85ebca6b) ^
         imul(point_index + 1, 0xc2b2ae35)) & _U32
    h = imul(h ^ (h >> 15), h | 1)
    h = (h ^ ((h + imul(h ^ (h >> 7), h | 61)) & _U32)) & _U32
    h = (h ^ (h >> 14)) & _U32
    return (h / 4294967296) * 2 - 1


def darken_colour(colour, amount=0.35):
    """helpers/colourShade.js darkenColour: a #rgb / #rrggbb colour with each channel scaled
    towards 0 (JS Math.round), anything else unchanged."""
    if not isinstance(colour, str):
        return colour
    m = re.match(r'^#([0-9a-f]{3}|[0-9a-f]{6})$', colour.strip(), re.IGNORECASE)
    if not m:
        return colour
    hx = m.group(1)
    if len(hx) == 3:
        hx = ''.join(c * 2 for c in hx)
    f = 1 - min(1, max(0, amount))
    return '#' + ''.join(f'{int(math.floor(int(hx[i:i + 2], 16) * f + 0.5)):02x}'
                         for i in (0, 2, 4))


def boxplot_box_stats(values, method='iqr', iqr_multiplier=1.5, z_threshold=3):
    """Box.svelte calculateBoxPlotStats over a group's present values: type-7 quartiles, the
    median, and the outliers by the series' rule ('zscore': |z| > threshold on the population
    SD, OutlierRemoval's detectOutliersZScore; else Tukey fences multiplier x IQR beyond the
    DRAWN quartiles); the whiskers end at the most extreme non-outliers. None when empty."""
    vals = list(values)
    if not vals:
        return None
    srt = sorted(vals)
    q1 = _quantile_type7(srt, 0.25)
    q2 = _js_median(srt)
    q3 = _quantile_type7(srt, 0.75)
    if method == 'zscore':
        thr = 3 if z_threshold is None else z_threshold
        mu = kahan_mean(vals)
        acc = KahanSum()
        for v in vals:
            acc.add((v - mu) * (v - mu))
        sd = math.sqrt(acc.value() / len(vals))
        mask = [False] * len(vals) if sd == 0 else [abs((v - mu) / sd) > thr for v in vals]
    else:
        k = 1.5 if iqr_multiplier is None else iqr_multiplier
        lo, hi = q1 - k * (q3 - q1), q3 + k * (q3 - q1)
        mask = [v < lo or v > hi for v in vals]
    outliers = [v for v, o in zip(vals, mask) if o]
    inliers = sorted(v for v, o in zip(vals, mask) if not o)
    return {'q1': q1, 'q2': q2, 'q3': q3,
            'lowerWhisker': inliers[0] if inliers else srt[0],
            'upperWhisker': inliers[-1] if inliers else srt[-1],
            'outliers': outliers, 'min': srt[0], 'max': srt[-1]}


def violin_curve(values, bandwidth=None, grid_size=128, min_n=VIOLIN_MIN_N):
    """helpers/violin.js violinCurve: the group's KDE (kde: Silverman auto unless a positive
    bandwidth is given, 128 grid points over [min - 3h, max + 3h]) trimmed to the data, the
    ends interpolated exactly. {'points': [(v, d)], 'max': peak density}, or None below min_n
    points or for a degenerate group."""
    cleaned = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if len(cleaned) < min_n:
        return None
    bw = bandwidth if (bandwidth is not None and _finite(bandwidth) and bandwidth > 0) else None
    k = kde(cleaned, bandwidth=bw, grid_size=grid_size)
    xs, ds = k['x'], k['density']
    if not xs:
        return None
    lo, hi = min(cleaned), max(cleaned)

    def at(v):
        if v <= xs[0]:
            return ds[0]
        last = len(xs) - 1
        if v >= xs[last]:
            return ds[last]
        for i in range(1, last + 1):
            if xs[i] >= v:
                t = (v - xs[i - 1]) / (xs[i] - xs[i - 1])
                return ds[i - 1] + t * (ds[i] - ds[i - 1])
        return ds[last]
    pts = [(lo, at(lo))] + [(x, d) for x, d in zip(xs, ds) if lo < x < hi] + [(hi, at(hi))]
    peak = max((d for _, d in pts), default=0)
    if not peak > 0:
        return None
    return {'points': pts, 'max': peak}


def violin_outline(curve, x_center, half_width_px, yscale):
    """helpers/violin.js violinOutline: up the right flank, back down the left, in px."""
    s = half_width_px / curve['max'] if curve['max'] > 0 else 0
    right = [(x_center + d * s, yscale(v)) for v, d in curve['points']]
    left = [(x_center - d * s, yscale(v)) for v, d in reversed(curve['points'])]
    return right + left


def format_sig_label(p_adjusted):
    """Boxplot.svelte formatSigLabel: stars by the adjusted p, else 'ns'."""
    if p_adjusted is None:
        return 'ns'
    if p_adjusted < 0.001:
        return '***'
    if p_adjusted < 0.01:
        return '**'
    if p_adjusted < 0.05:
        return '*'
    return 'ns'


def _boxplot_series_frames(p, columns_index):
    """Each series as the Boxplot reads it: (index, series, box settings, category cells,
    value cells, has-category-column). A series with no category column is one category named
    by its label ('Box plot N' while blank; Boxplot.svelte xDataForDatum)."""
    out = []
    for i, s in enumerate(p.get('data', []) or []):
        y_col = _resolve_plot_col(s.get('y'), columns_index)
        x_col = _resolve_plot_col(s.get('x'), columns_index)
        y = list(y_col.get_data()) if y_col is not None else []
        x = list(x_col.get_data()) if x_col is not None else []
        has_x = len(x) > 0
        name = s.get('label') or f'Box plot {i + 1}'
        out.append({'index': i, 'series': s, 'y_col': y_col,
                    'box': _with_defaults(s.get('boxPlot'), _BOX_DEFAULTS),
                    'x': x if has_x else [name] * len(y), 'y': y, 'has_x': has_x,
                    'name': name})
    return out


def boxplot_categories(frames):
    """Boxplotclass.uniqueXValues: every category with a present value, over every series (a
    series without categories contributes its name), as labels, numerically when both read
    as numbers, else alphabetically."""
    import functools
    seen, found = set(), []
    for f in frames:
        added = False
        if f['has_x']:
            for i, c in enumerate(f['x']):
                v = f['y'][i] if i < len(f['y']) else None
                if not _is_missing_category(c) and not _js_invalid(v):
                    lab = _js_string(c)
                    added = True
                    if lab not in seen:
                        seen.add(lab)
                        found.append(lab)
        if not added and any(not _js_invalid(v) for v in f['y']):
            if f['name'] not in seen:
                seen.add(f['name'])
                found.append(f['name'])

    def cmp(a, b):
        na, nb = _js_number(a), _js_number(b)
        if not math.isnan(na) and not math.isnan(nb):
            return (na > nb) - (na < nb)
        return _category_cmp(a, b)
    return sorted(found, key=functools.cmp_to_key(cmp))


def _boxplot_groups(frame):
    """Box.svelte groupedStats: the series' present values per category label, in the order
    the categories first appear."""
    groups = {}
    for i, c in enumerate(frame['x']):
        v = frame['y'][i] if i < len(frame['y']) else None
        if _is_missing_category(c) or _js_invalid(v):
            continue
        groups.setdefault(_js_string(c), []).append(_js_number(v))
    return groups


def _sig_group(name, values):
    n = len(values)
    m = _js_sum(values) / n if n > 0 else 0
    sd = math.sqrt(_js_sum([(v - m) ** 2 for v in values]) / (n - 1)) if n > 1 else 0
    return {'name': name, 'values': values, 'n': n, 'mean': m, 'sd': sd}


def boxplot_sig_groups(frames, categories):
    """Boxplot.svelte buildSigBarGroups: with a category column anywhere, one group per
    category (pooled over the series; empty ones dropped); otherwise one per series."""
    if not any(f['has_x'] for f in frames):
        return [_sig_group(f['name'], [_js_number(v) for v in f['y'] if not _js_invalid(v)])
                for f in frames]
    pooled = {c: [] for c in categories}
    for f in frames:
        if not f['has_x']:
            continue
        for i, c in enumerate(f['x']):
            v = f['y'][i] if i < len(f['y']) else None
            if _is_missing_category(c) or _js_invalid(v):
                continue
            lab = _js_string(c)
            if lab in pooled:
                pooled[lab].append(_js_number(v))
    return [g for g in (_sig_group(c, pooled[c]) for c in categories) if g['n'] > 0]


def boxplot_sig_stats(groups, method='auto', alpha=0.05):
    """Boxplot.svelte runSigBarStats (with every pair kept, as its table keeps them): the same
    tests as Group Comparison. Two groups: Welch's t-test, or Mann-Whitney when the method is
    non-parametric; more: one-way ANOVA then Tukey-Kramer, or pairwise Mann-Whitney with
    Holm's adjustment. Returns (pairs, data max)."""
    if len(groups) < 2:
        return [], -math.inf
    data_max = -math.inf
    for g in groups:
        for v in g['values']:
            if v > data_max:
                data_max = v
    # plots/Boxplot/sigMethods.js: 'kruskal' (and the old 'mannwhitney') is non-parametric;
    # 'auto' (and the old 'tukey' / 'ttest' / 'anova', or anything else) is parametric.
    nonparam = method in ('kruskal', 'mannwhitney')
    pairs = []
    if len(groups) == 2:
        a, b = groups
        res = _gc_mann_whitney_two_groups(a, b) if nonparam else _gc_welch_t_test(a, b, alpha)
        if res.get('valid'):
            pairs = [{'groupA': a['name'], 'groupB': b['name'], 'pValue': res['pValue'],
                      'pAdjusted': res['pValue'], 'significant': res['pValue'] < alpha}]
    elif nonparam:
        pairs = _gc_pairwise_mann_whitney(groups, alpha)
    else:
        an = _gc_one_way_anova(groups)
        if an.get('valid'):
            pairs = _gc_tukey_kramer_post_hoc(groups, an['msWithin'], an['dfWithin'], alpha)
    return pairs, data_max


def boxplot_bracket_levels(pairs, categories):
    """Boxplot.svelte assignBracketLevels: shortest spans first (then leftmost), each on the
    lowest level whose brackets it does not overlap. [{'pair', 'i', 'j', 'level'}]."""
    entries = []
    for p in pairs:
        i = categories.index(p['groupA']) if p['groupA'] in categories else -1
        j = categories.index(p['groupB']) if p['groupB'] in categories else -1
        if i >= 0 and j >= 0:
            entries.append({'pair': p, 'i': min(i, j), 'j': max(i, j), 'level': -1})
    entries.sort(key=lambda e: (e['j'] - e['i'], e['i']))
    levels = []
    for e in entries:
        lv = 0
        while True:
            if lv == len(levels):
                levels.append([])
            if not any(not (e['j'] < r[0] or e['i'] > r[1]) for r in levels[lv]):
                levels[lv].append((e['i'], e['j']))
                e['level'] = lv
                break
            lv += 1
    return entries


def _boxplot_series_colours(plot, frame, n_series):
    """The stroke and fill a series' boxes are drawn in: the app's (the export's
    `seriesColours[i].box`), else the saved colour (a saved colour is a pick, BoxClass; null is
    automatic), else the palette by position. The fill follows the stroke unless one was
    chosen; a saved fill that is only what an automatic fill was (palette entry 0, the series'
    own palette entry, or its stroke) follows too, as plots/legacyAutoColours.js releases it."""
    got = _resolved_series_colours(plot, frame['index']).get('box') or {}
    if isinstance(got.get('colour'), str) and got.get('colour'):
        return got['colour'], got.get('fill') or got['colour']
    saved = frame['series'].get('boxPlot') or {}
    own = APP_PALETTE[frame['index'] % len(APP_PALETTE)]
    colour = saved.get('colour') if isinstance(saved.get('colour'), str) and \
        saved.get('colour') else own
    fill = saved.get('fillColour') if isinstance(saved.get('fillColour'), str) else None
    if fill is not None and fill.lower() in {APP_PALETTE[0].lower(), own.lower(), colour.lower()}:
        fill = None
    return colour, fill or colour


def _boxplot_category_colours(plot, frames, categories, monochrome):
    """The colour of each category's boxes when the plot colours per category: the app's
    (`seriesColours[0].colourCategories`), else greys by place when monochrome, else each
    label's default palette slot in the order the categories first appear."""
    got = _resolved_series_colours(plot, 0).get('colourCategories') or {}
    labels, colours = got.get('labels'), got.get('colours')
    if isinstance(labels, list) and isinstance(colours, list) and len(labels) == len(colours):
        return {str(lab): c for lab, c in zip(labels, colours)}
    first = list(_boxplot_groups(frames[0]).keys()) if frames else []
    pal = category_palette_fallback(first, categories, monochrome)
    return dict(zip(categories, pal))


def boxplot_layout(plot, columns_index, plot_w, plot_h, overlay_extent=None):
    """Everything the Boxplot draws, in px from the plot area's top left (y down): the
    categories, the x and y domains (Boxplotclass.xlims / ylims, the latter with room for the
    significance brackets), each series' boxes, points and violins (Box.svelte, Violin.svelte),
    the brackets and the pairwise table behind them, and the legend entries."""
    p = plot.get('plot', {}) or {}
    opt = {k: _nn_default(p, k, d) for k, d in _BOXPLOT_DEFAULTS.items()}
    look = plot_look(plot)
    mono = look['monochrome']
    frames = _boxplot_series_frames(p, columns_index)
    cats = boxplot_categories(frames)
    n_cats, n_series = len(cats), len(frames)
    cat_index = {c: i for i, c in enumerate(cats)}

    # Significance pairs: every pair for the table; the bars drop the non-significant unless
    # "Show ns" is on.
    groups = boxplot_sig_groups(frames, cats)
    table, data_max = boxplot_sig_stats(groups, opt['sigMethod'], opt['sigAlpha'])
    bar_pairs = []
    if opt['showSigBars']:
        bar_pairs = table if opt['showNs'] else [q for q in table if q['significant']]
    levels = boxplot_bracket_levels(bar_pairs, cats) if bar_pairs else []

    # x: the category index, -0.5 .. n - 0.5 (the saved limits win).
    xin = list(p.get('xlimsIN') or [None, None]) + [None, None]
    if n_cats == 0:
        xd = (0.0, 1.0)
    else:
        xd = (xin[0] if xin[0] is not None else -0.5,
              xin[1] if xin[1] is not None else n_cats - 0.5)
    # y: the data's range (with the overlays'), out to the leading decade, the top raised for
    # the brackets, both ends kept clear of a whisker cap.
    lo, hi = math.inf, -math.inf
    for f in frames:
        for v in f['y']:
            if not _js_invalid(v):
                lo, hi = min(lo, _js_number(v)), max(hi, _js_number(v))
    if overlay_extent:
        lo, hi = min(lo, overlay_extent[0]), max(hi, overlay_extent[1])
    yin = list(p.get('ylimsIN') or [None, None]) + [None, None]
    if lo == math.inf or hi == -math.inf:
        yd = (0.0, 10.0)
    else:
        bot = yin[0] if yin[0] is not None else nice_axis_limit(lo, 'floor')
        top = yin[1] if yin[1] is not None else nice_axis_limit(hi, 'ceil')
        if opt['showSigBars'] and yin[1] is None and levels:
            n_levels = max(e['level'] for e in levels) + 1
            base = data_max if math.isfinite(data_max) else hi
            step = (top - bot) * 0.1 * opt['sigBarSpacing']
            needed = base + step * (n_levels + 1)
            if needed > top:
                top = nice_axis_limit(needed, 'ceil')
        yd = clear_ends(bot, top, lo, hi, 4, plot_h, auto_lo=yin[0] is None,
                        auto_hi=yin[1] is None)

    def xs(v):
        return (v - xd[0]) / (xd[1] - xd[0]) * plot_w

    def ys(v):
        return plot_h - (v - yd[0]) / (yd[1] - yd[0]) * plot_h if yd[1] != yd[0] else plot_h

    def half_width(fraction):
        if n_cats == 0:
            return 20
        if n_cats == 1:
            return max(2, plot_w * 0.2 * fraction / (2 * n_series))
        return max(2, (plot_w / n_cats) * fraction / (2 * n_series))

    def dodge(frame, half):
        if not frame['has_x'] or n_series <= 1:
            return 0
        return (frame['index'] - (n_series - 1) / 2) * (half * 2)

    category_coloured = (n_series == 1 and n_cats > 1 and frames[0]['has_x'])
    cat_colours = (_boxplot_category_colours(plot, frames, cats, mono)
                   if category_coloured else {})
    boxes, points, violins, legend = [], [], [], []
    for f in frames:
        b = f['box']
        colour, fill = _boxplot_series_colours(plot, f, n_series)
        f['colour'], f['fill'] = colour, fill
        if not f['y'] or b['draw'] is False:
            continue
        grouped = _boxplot_groups(f)
        half = half_width(b['boxWidth'])
        whisker_half = half * b['whiskerWidth']
        off = dodge(f, half)
        for cat, values in grouped.items():
            k = cat_index.get(cat, -1)
            cx = xs(k) + off
            cc = cat_colours.get(cat) if category_coloured else None
            stroke, face = cc or colour, cc or fill
            if opt['showBox']:
                st = boxplot_box_stats(values, b['outlierMethod'], b['iqrMultiplier'],
                                       b['zThreshold'])
                boxes.append({
                    'series': f['index'], 'category': cat, 'cx': cx, 'halfWidth': half,
                    'whiskerHalfWidth': whisker_half, 'stats': st,
                    'yQ1': ys(st['q1']), 'yQ3': ys(st['q3']), 'yMedian': ys(st['q2']),
                    'yLowerWhisker': ys(st['lowerWhisker']),
                    'yUpperWhisker': ys(st['upperWhisker']),
                    'outliers': ([ys(v) for v in st['outliers']] if b['showOutliers'] else []),
                    'outlierSize': b['outlierSize'], 'fill': face,
                    'fillOpacity': box_fill_opacity(b['fillOpacity']), 'stroke': stroke,
                    'strokeWidth': b['strokeWidth'], 'dash': b['stroke'],
                    'medianStroke': b['medianColour'], 'medianWidth': b['medianWidth']})
            if opt['showPoints']:
                pc = opt['pointColour'] or stroke
                for vi, v in enumerate(values):
                    points.append({
                        'series': f['index'], 'category': cat,
                        'cx': cx + boxplot_jitter_offset(f['index'], k, vi) * half *
                        opt['pointJitter'],
                        'cy': ys(v), 'r': opt['pointSize'], 'fill': pc,
                        'fillOpacity': opt['pointOpacity'], 'stroke': darken_colour(pc, 0.35),
                        'strokeWidth': 0.8})
        if opt['showViolin']:
            vhalf = half_width(opt['violinWidth'])
            voff = dodge(f, vhalf)
            for cat, values in grouped.items():
                curve = violin_curve(values, opt['violinBandwidth'])
                if curve is None:
                    continue
                k = cat_index.get(cat, -1)
                cc = cat_colours.get(cat) if category_coloured else None
                vc = cc or colour
                violins.append({'series': f['index'], 'category': cat,
                                'points': violin_outline(curve, xs(k) + voff, vhalf, ys),
                                'fill': vc, 'fillOpacity': opt['violinOpacity'], 'stroke': vc,
                                'strokeWidth': 1})
    if not category_coloured:
        for f in frames:
            if f['box']['draw'] is False:
                continue
            label = f['series'].get('label') or _display_name(f['y_col']) or \
                f"Data {f['index'] + 1}"
            legend.append({'label': label, 'colour': f['colour'], 'fill': f['fill'],
                           'fillOpacity': box_fill_opacity(f['box']['fillOpacity'])})

    # Brackets: from the data maximum (else the top of the axis), a tenth of the axis per
    # level, shifted by the saved offset; the label's baseline a third of its size below the
    # bar, less 2 px.
    sig_bars = []
    if opt['showSigBars'] and levels:
        saved_px = p.get('sigBarFontSize')
        saved_px = None if (not _style_valid(saved_px, 'number') or
                            saved_px == _LEGACY_SIG_BAR_FONT_SIZE) else saved_px
        font_px = saved_px if saved_px is not None else look['px']['sigBar']
        step = (yd[1] - yd[0]) * 0.1 * opt['sigBarSpacing']
        base = data_max if math.isfinite(data_max) else yd[1]
        for e in levels:
            y = ys(base + step * (e['level'] + 1)) + opt['sigBarYOffset']
            x1, x2 = xs(e['i']), xs(e['j'])
            sig_bars.append({'x1': x1, 'x2': x2, 'y': y, 'tick': y + SIG_BAR_TICK_PX,
                             'stroke': opt['sigBarColor'], 'strokeWidth': opt['sigBarThickness'],
                             'label': format_sig_label(e['pair']['pAdjusted']),
                             'labelX': (x1 + x2) / 2, 'labelY': y + font_px / 3 - 2,
                             'labelPx': font_px, 'level': e['level'], 'i': e['i'],
                             'j': e['j']})
    return {'categories': cats, 'x_domain': xd, 'y_domain': yd, 'plot_w': plot_w,
            'plot_h': plot_h, 'category_coloured': category_coloured, 'boxes': boxes,
            'points': points, 'violins': violins, 'sig_bars': sig_bars, 'sig_table': table,
            'sig_levels': levels, 'legend': legend}


def _boxplot_legend(ax, items, overlay_legend, legend_json, look, layout=None):
    """The Boxplot's legend: each series' swatch as Legend.svelte draws it (a 14 x 12 px box
    3 px into the 25 px icon, filled at the box's fill opacity, 2 px stroke), then the overlays'
    entries."""
    from matplotlib.patches import Patch, Rectangle
    from matplotlib.legend_handler import HandlerPatch
    from matplotlib.colors import to_rgba

    class _BoxSwatch(Patch):
        pass

    def swatch(legend, orig_handle, xdescent, ydescent, width, height, fontsize):
        return Rectangle((-xdescent + 3 * _PX_TO_PT, -ydescent + height / 2 - 6 * _PX_TO_PT),
                         14 * _PX_TO_PT, 12 * _PX_TO_PT)
    handles, labels = [], []
    for it in items:
        face = _mpl_colour(it['fill'], 'none')
        if face != 'none':
            face = to_rgba(face, it.get('fillOpacity', _BOX_DEFAULTS['fillOpacity']))
        handles.append(_BoxSwatch(facecolor=face,
                                  edgecolor=_mpl_colour(it['colour'], 'black'),
                                  linewidth=2 * _PX_TO_PT))
        labels.append(it['label'])
    for h, lab in overlay_legend or []:
        handles.append(h)
        labels.append(lab)
    if not handles:
        return None
    kw = legend_kwargs(legend_json, look, len(handles))
    frame = kw.pop('_frame')
    anchor = legend_anchor_kwargs(legend_json, layout, ax) \
        if layout is not None and layout.get('box') else {}
    if anchor:
        kw.pop('bbox_to_anchor', None)
        kw.update(anchor)
    leg = ax.legend(handles, labels, handler_map={_BoxSwatch: HandlerPatch(patch_func=swatch)},
                    **kw)
    style_legend(leg, frame)
    return leg


def plot_boxplot(plot, columns_index, ax):
    """The Boxplot as the app draws it (boxplot_layout), in its paint order: the overlays'
    bands, every violin, then per series each category's whiskers, box, median, outlier rings
    and jittered points, the overlays' lines, the legend and the significance brackets. Marks
    keep the app's px sizes (strokes and dashes at 0.75 pt to the px, circles their radius);
    the plot's figure style sets the axes' type and the bracket labels' size. The layout and
    the artists drawn for it are kept on the axes as `ax._ancir_boxplot`."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Rectangle, Polygon
    from matplotlib.colors import to_rgba
    p = plot.get('plot', {}) or {}
    look = plot_look(plot)
    family = _font_family_list(look['family'])
    # Horizontal lines and bands only (the x axis is categorical); they widen the y axis.
    ov = _draw_overlays(ax, plot, columns_index)
    w_px, h_px = _axes_px(ax)
    oy = ov.get('extent', {}).get('y')
    lay = boxplot_layout(plot, columns_index, w_px, h_px, oy)
    # The legend: 'auto' avoids every category's span of values and the brackets, decided
    # over the plot area before an outside legend takes its room (legend_layout); the boxes
    # are then laid out over the plot area that is left.
    leg = p.get('legend') or {}
    legend_json = {**leg, 'show': leg.get('show', True) is not False}
    labels = [it['label'] for it in lay['legend']] + _overlay_legend_labels(plot)
    layout = legend_layout(legend_json, labels, look, w_px, h_px,
                           obstacles=lambda w, h: boxplot_obstacles(plot, columns_index, lay),
                           fig=ax.figure)
    if layout['reserveW'] > 0:
        reserve_axes_right((ax,), layout['reserveW'])
        w_px, h_px = _axes_px(ax)
        lay = boxplot_layout(plot, columns_index, w_px, h_px, oy)
    xd, yd = lay['x_domain'], lay['y_domain']
    if yd[0] == yd[1]:
        yd = (yd[0] - 0.5, yd[1] + 0.5)
        lay['y_domain'] = yd
    kx, ky = (xd[1] - xd[0]) / w_px, (yd[1] - yd[0]) / h_px

    def X(px):
        return xd[0] + px * kx

    def Y(py):
        return yd[0] + (h_px - py) * ky

    z = [1.0]

    def nz(step=1e-4):
        z[0] += step
        return z[0]

    def colour(c, fallback='black'):
        return _mpl_colour(c, fallback)

    for v in lay['violins']:
        rgba = to_rgba(colour(v['fill']), v['fillOpacity'])
        v['artist'] = ax.add_patch(Polygon(
            [(X(a), Y(b)) for a, b in v['points']], closed=True, facecolor=rgba,
            edgecolor=colour(v['stroke']), linewidth=v['strokeWidth'] * _PX_TO_PT,
            joinstyle='miter', zorder=nz(), gid=f"violin-{v['series']}"))
    z[0] = 1.5
    by_series = {}
    for b in lay['boxes']:
        by_series.setdefault((b['series'], b['category']), {})['box'] = b
    for pt in lay['points']:
        by_series.setdefault((pt['series'], pt['category']), {}).setdefault('points', []) \
            .append(pt)
    for (s, cat), marks in by_series.items():
        b = marks.get('box')
        if b is not None:
            sw = b['strokeWidth'] * _PX_TO_PT
            dash = _overlay_dashes(b['dash'], b['strokeWidth'])
            cx, hw, whw = b['cx'], b['halfWidth'], b['whiskerHalfWidth']
            sk = colour(b['stroke'])
            line = dict(color=sk, linewidth=sw, solid_capstyle='butt', dash_capstyle='butt')
            gid = f'box-{s}-{cat}'
            art = {}
            art['lower'] = ax.add_line(Line2D([X(cx)] * 2, [Y(b['yLowerWhisker']), Y(b['yQ1'])],
                                              linestyle=dash, zorder=nz(), gid=gid, **line))
            art['lower_cap'] = ax.add_line(Line2D([X(cx - whw), X(cx + whw)],
                                                  [Y(b['yLowerWhisker'])] * 2, zorder=nz(),
                                                  gid=gid, **line))
            art['rect'] = ax.add_patch(Rectangle(
                (X(cx - hw), Y(b['yQ1'])), 2 * hw * kx, (b['yQ1'] - b['yQ3']) * ky,
                # Only the fill is translucent (Box.svelte): outline, whiskers, median and outlier
                # rings stay opaque.
                facecolor=(to_rgba(colour(b['fill']), b['fillOpacity'])
                           if colour(b['fill'], 'none') != 'none' else 'none'),
                edgecolor=sk, linewidth=sw,
                linestyle=dash, joinstyle='miter', zorder=nz(), gid=gid))
            art['median'] = ax.add_line(Line2D(
                [X(cx - hw), X(cx + hw)], [Y(b['yMedian'])] * 2, color=colour(b['medianStroke']),
                linewidth=b['medianWidth'] * _PX_TO_PT, solid_capstyle='butt', zorder=nz(),
                gid=gid))
            art['upper'] = ax.add_line(Line2D([X(cx)] * 2, [Y(b['yQ3']), Y(b['yUpperWhisker'])],
                                              linestyle=dash, zorder=nz(), gid=gid, **line))
            art['upper_cap'] = ax.add_line(Line2D([X(cx - whw), X(cx + whw)],
                                                  [Y(b['yUpperWhisker'])] * 2, zorder=nz(),
                                                  gid=gid, **line))
            if b['outliers']:
                d_pt = 2 * b['outlierSize'] * _PX_TO_PT
                art['outliers'] = ax.scatter(
                    [X(cx)] * len(b['outliers']), [Y(v) for v in b['outliers']], s=d_pt ** 2,
                    marker='o', facecolors='none', edgecolors=sk, linewidths=sw, zorder=nz(),
                    gid=gid)
            b['artists'] = art
        pts = marks.get('points') or []
        if pts:
            coll = ax.scatter(
                [X(q['cx']) for q in pts], [Y(q['cy']) for q in pts],
                s=[(2 * q['r'] * _PX_TO_PT) ** 2 for q in pts], marker='o',
                facecolors=[to_rgba(colour(q['fill']), q['fillOpacity']) for q in pts],
                edgecolors=[colour(q['stroke']) for q in pts],
                linewidths=[q['strokeWidth'] * _PX_TO_PT for q in pts], zorder=nz(),
                gid=f'points-{s}-{cat}')
            for q in pts:
                q['artist'] = coll
    # The brackets sit above the legend and are not clipped to the plot area.
    for k, sb in enumerate(lay['sig_bars']):
        style = dict(color=colour(sb['stroke']), linewidth=sb['strokeWidth'] * _PX_TO_PT,
                     solid_capstyle='butt', clip_on=False, zorder=6 + k * 1e-3,
                     gid=f'sig-bar-{k}')
        sb['artists'] = [
            ax.add_line(Line2D([X(sb['x1'])] * 2, [Y(sb['tick']), Y(sb['y'])], **style)),
            ax.add_line(Line2D([X(sb['x1']), X(sb['x2'])], [Y(sb['y'])] * 2, **style)),
            ax.add_line(Line2D([X(sb['x2'])] * 2, [Y(sb['y']), Y(sb['tick'])], **style)),
        ]
        sb['text'] = ax.text(X(sb['labelX']), Y(sb['labelY']), sb['label'], ha='center',
                             va='baseline', fontsize=sb['labelPx'] * _PX_TO_PT,
                             fontfamily=family, color=colour(sb['stroke']), clip_on=False,
                             zorder=6 + k * 1e-3, gid=f'sig-label-{k}')
    y_axis = p.get('yAxis') or {}
    x_axis = p.get('xAxis') or {}
    cats = lay['categories']
    n = len(cats)
    specs = {
        # One tick per category at its index (its centre), labelled with it; enabled x
        # gridlines at each category's centre (getXAxisForManualCategories).
        'bottom': {'kind': 'category', 'domain': xd,
                   'axis': {**x_axis, 'gridlines': x_axis.get('gridlines') is True},
                   'ticks': list(range(n)),
                   'format': lambda v: cats[int(v)] if 0 <= int(v) < n else ''},
        'left': {'kind': 'linear', 'domain': yd, 'axis': y_axis,
                 'label': y_axis.get('label') or ''},
    }
    _draw_app_axes(ax, None, specs, look)
    lay['legend_artist'] = None
    if legend_json['show']:
        lay['legend_artist'] = _boxplot_legend(ax, lay['legend'], ov['legend'], leg, look,
                                               layout=layout)
    ax._ancir_boxplot = lay
    ax._ancir_legend_layout = layout


def boxplot_obstacles(plot, columns_index, lay):
    """Boxplotclass.legendObstacles over the plot area `lay` was laid out on: per series, a
    rectangle 0.45 of a category either side of each category's centre over its values'
    range, and every significance bracket from 16 px above its bar to 6 px below."""
    p = plot.get('plot', {}) or {}
    xd, yd = lay['x_domain'], lay['y_domain']
    xs = _px_scale(xd[0], xd[1], lay['plot_w'])
    ys = _px_scale(yd[0], yd[1], lay['plot_h'], flip=True)
    cat_index = {c: i for i, c in enumerate(lay['categories'])}
    rects = []
    for f in _boxplot_series_frames(p, columns_index):
        for cat, values in _boxplot_groups(f).items():
            c = cat_index.get(cat)
            if c is None or not values:
                continue
            rects.append([xs(c - 0.45), ys(max(values)), xs(c + 0.45), ys(min(values))])
    for sb in lay['sig_bars']:
        rects.append([sb['x1'], sb['y'] - 16, sb['x2'], sb['y'] + 6])
    return [{'rects': rects}]


def actogram_row_geometry(plot_h, n_rows, space_between):
    """rowHeight.js rowGeometry: ({'gap', 'height'}) of each row in px."""
    sb = space_between if _style_valid(space_between, 'number') and space_between > 0 else 0

    def row_h(gap):
        if not n_rows > 0:
            return 0
        h = (plot_h - (n_rows - 1) * gap) / n_rows
        return h if math.isfinite(h) and h > 0 else 0
    as_set = row_h(sb)
    if as_set >= 1 or not n_rows > 0 or not plot_h > 0:
        return {'gap': sb, 'height': as_set}
    if plot_h >= n_rows:
        gap = min(sb, (plot_h - n_rows) / (n_rows - 1)) if n_rows > 1 else 0
        return {'gap': gap, 'height': row_h(gap)}
    return {'gap': 0, 'height': plot_h / n_rows}


def actogram_labelled_rows(n_rows):
    """rowLabels.js labelledRows: every row up to 20, else d3's ticks over [0, n)."""
    n = max(0, math.floor(n_rows or 0))
    if n <= 20:
        return list(range(n))
    return [int(t) for t in d3_ticks(0, n, 10) if 0 <= t < n]


def actogram_row_label_px(tick_px, plot_h, n_rows, space_between=0):
    """rowLabels.js rowLabelFontPx: the tick size, capped at the labelled-row pitch."""
    size = tick_px if tick_px and tick_px > 0 else 10
    n = math.floor(n_rows or 0)
    if not (n > 0 and plot_h > 0):
        return size
    rows = actogram_labelled_rows(n)
    step = rows[1] - rows[0] if len(rows) > 1 else 1
    pitch = (plot_h + (space_between or 0)) / n * step
    return max(1, min(size, pitch))


def actogram_row_label_text(day, mode, start_ms, period_hrs, date_format, zone):
    """rowLabels.js rowLabelText."""
    ordinal = str(day + 1)
    if mode != 'date' or start_ms is None or not math.isfinite(start_ms):
        return ordinal
    hrs = period_hrs if period_hrs and period_hrs > 0 else 24
    text = dayjs_format(start_ms + day * hrs * _MS_PER_HOUR, date_format or 'DD MMM', zone)
    return text if text.strip() else dayjs_format(start_ms + day * hrs * _MS_PER_HOUR,
                                                  'DD MMM', zone)


def _actogram_row_labels_mode(p):
    """rowLabels.js migrateRowLabels."""
    mode = p.get('rowLabels')
    if mode in ('none', 'period', 'date'):
        return mode
    if 'showDayNumbers' not in p:
        return 'none'
    if not p.get('showDayNumbers'):
        return 'none'
    return 'date' if p.get('rowLabelMode') == 'date' else 'period'


def _js_min_max(values):
    lo, hi = _extent_of(values)
    return (lo, hi)


# Actogram.svelte: past this many heatmap cells (one per bin per double-plot copy) the
# heatmap is one image per series, as rows under 1 px always are (MAX_SVG_HEATMAP_CELLS).
ACTOGRAM_MAX_SVG_HEATMAP_CELLS = 20000
# rowHeight.js MAX_ACTOGRAM_ROWS: past this many rows the actogram draws nothing and says why.
MAX_ACTOGRAM_ROWS = 20000
# LightBandClass: the bar's height in px (not saved by the app, so always its default).
ACTOGRAM_LIGHT_BAND_HEIGHT = 10


def _actogram_series(plot, columns_index, zone):
    """Every series of an actogram resolved and folded at the plot's ONE startTime:
    ([{'d', 'series', 'x_col', 'y_col', 'frame', 'bins'} or None], startTime, Ndays)."""
    p = plot.get('plot', {}) or {}
    period_hrs = float(p.get('periodHrs', 24) or 24)
    resolved = []
    for series in p.get('data', []) or []:
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        resolved.append(None if x_col is None or y_col is None else (series, x_col, y_col, {
            'xType': x_col.type, 'x': x_col.get_data() or [], 'y': y_col.get_data() or [],
            'rawBinStart0': x_col.raw_first, 'originTime_ms': x_col.eff_origin_time_ms}))
    start = actogram_plot_start_time(p, [r[3] for r in resolved if r is not None], zone)
    out = []
    for d, r in enumerate(resolved):
        if r is None:
            out.append(None)
            continue
        series, x_col, y_col, sd = r
        frame = actogram_series_frame(sd['x'], sd['y'], sd['xType'], start, period_hrs,
                                      sd['rawBinStart0'], sd['originTime_ms'])
        out.append({'d': d, 'series': series, 'x_col': x_col, 'y_col': y_col, 'frame': frame,
                    'bins': actogram_bins_by_period(frame, period_hrs, x_col.eff_bin_width)})
    # Actogram rowsNeeded: the highest row any series' samples fall in, + 1.
    max_period = -1
    for e in out:
        if e is not None:
            for k in e['frame']['xByPeriod']:
                max_period = max(max_period, k)
    return out, start, (max_period + 1 if max_period >= 0 else 0)


def actogram_row_bins(bins, day, double, period_hrs):
    """Actogram getBinsForPeriods: the bins row `day` shows (periods day .. day + double - 1),
    in hours from the row's start: (xStart, xEnd, y) lists."""
    xs, xe, ys = [], [], []
    off = day * period_hrs
    for q in range(day, day + double):
        for b in bins.get(q, []):
            xs.append(b['xStart'] - off)
            xe.append(b['xEnd'] - off)
            ys.append(b['y'])
    return xs, xe, ys


def actogram_raster(n_rows, width_px, height_px, span, row_bins, mode, y_frac=None, colour=None,
                    row_h=None, gap=0.0):
    """actogramRaster.js rasterizeRows: the area every row's bars (or heatmap cells) cover in
    each pixel of a width x height grid ({'cover': H x W array, 'rgb': H x W x 3 cover-weighted
    sums or None}). Row `day` occupies [gap + day * (row_h + gap), + row_h) px; a bar of value y
    the bottom y_frac(day, y) of its row; a heatmap cell the whole row, in colour(y) (0..255)."""
    W = max(0, math.floor(width_px))
    H = max(0, math.floor(height_px))
    cover = np.zeros((H, W), dtype=np.float64)
    heat = mode == 'heatmap'
    rgb = np.zeros((H, W, 3), dtype=np.float64) if heat else None
    if not (n_rows > 0) or W == 0 or H == 0 or not (span > 0):
        return {'cover': cover, 'rgb': rgb}
    rh = row_h if row_h is not None else H / n_rows
    k = W / span
    for day in range(n_rows):
        xs, xe, ys = row_bins(day)
        if not xs:
            continue
        row_top = gap + day * (rh + gap)
        row_bottom = row_top + rh
        for i in range(len(xs)):
            y = ys[i]
            if y is None or _js_invalid(y):
                continue
            top = row_top
            c = None
            if heat:
                c = colour(y)
            else:
                f = min(1.0, max(0.0, y_frac(day, y)))
                if not f > 0:
                    continue
                top = row_bottom - f * rh
            x0 = max(0.0, xs[i] * k)
            x1 = min(float(W), xe[i] * k)
            if not x1 > x0:
                continue
            c0 = math.floor(x0)
            c1 = min(W - 1, math.ceil(x1) - 1)
            r0 = max(0, math.floor(top))
            r1 = min(H - 1, math.ceil(row_bottom) - 1)
            if c1 < c0 or r1 < r0:
                continue
            cols = np.arange(c0, c1 + 1)
            cx = np.minimum(x1, cols + 1) - np.maximum(x0, cols)
            rows_ = np.arange(r0, r1 + 1)
            cy = np.minimum(row_bottom, rows_ + 1) - np.maximum(top, rows_)
            a = np.clip(cy, 0, None)[:, None] * np.clip(cx, 0, None)[None, :]
            cover[r0:r1 + 1, c0:c1 + 1] += a
            if heat:
                for ch in range(3):
                    rgb[r0:r1 + 1, c0:c1 + 1, ch] += a * c[ch]
    return {'cover': cover, 'rgb': rgb}


def actogram_raster_rgba(raster, bar_rgb=(0, 0, 0)):
    """actogramRaster.js rasterToRGBA as an H x W x 4 array of 0..1: bars in the series colour
    at the covered fraction's opacity; a heatmap in the cover-weighted mean colour."""
    cover = raster['cover']
    out = np.zeros(cover.shape + (4,), dtype=np.float64)
    on = cover > 0
    if raster['rgb'] is not None:
        for ch in range(3):
            out[..., ch] = np.where(on, raster['rgb'][..., ch] / np.where(on, cover, 1), 0)
    else:
        for ch in range(3):
            out[..., ch] = bar_rgb[ch]
    # Uint8ClampedArray: the channels clamp and round to whole steps.
    out[..., :3] = np.clip(np.round(out[..., :3]), 0, 255) / 255
    out[..., 3] = np.where(on, np.round(np.minimum(1, cover) * 255) / 255, 0)
    return out


def _parse_rgb(c):
    """actogramRaster.js parseColour, then the canvas's own reading of any other CSS colour:
    (r, g, b) 0..255 (an alpha channel is dropped, as the raster draws opaque bars)."""
    from matplotlib.colors import to_rgb
    m = _mpl_colour(c, '#000000')
    try:
        return tuple(round(v * 255) for v in to_rgb(m))
    except ValueError:
        return (0, 0, 0)


def _fig_px_transform(fig):
    """A transform taking the app's plot px (x right, y down from the plot's own top left) to
    the figure, past the export's title band."""
    from matplotlib.transforms import Affine2D
    g = getattr(fig, '_ancir_geometry', None) or {}
    band = g.get('band', 0)
    fh = g.get('fig_h', fig.get_size_inches()[1] * _FIG_PX_PER_IN)
    # Through inches, so it holds at any dpi the figure is saved at.
    return Affine2D().scale(1 / _FIG_PX_PER_IN, -1 / _FIG_PX_PER_IN).translate(
        0, (fh - band) / _FIG_PX_PER_IN) + fig.dpi_scale_trans


def _draw_actogram_light_bar(ax, p, total_w):
    """LightBand.svelte: the light bar above the actogram, each band a rect `pc`% of one
    period's width in its colour with a 1 px grey outline, side by side from the plot's SAVED
    left padding, `height` px tall and as far down from the top (it is drawn over the saved
    padding, not the plot area: a row-label gutter or an outside legend does not move it)."""
    from matplotlib.patches import Rectangle
    lb = p.get('lightBands') or {}
    bands = lb.get('bands') or []
    if not bands:
        return []
    pad_in = p.get('paddingIN') or {'top': 30, 'right': 20, 'bottom': 10, 'left': 20}
    height = lb.get('height')
    height = height if _style_valid(height, 'number') else ACTOGRAM_LIGHT_BAND_HEIGHT
    double = max(1, int(p.get('doublePlot', 2) or 1))
    single = (total_w - (pad_in.get('left') or 0) - (pad_in.get('right') or 0)) / double
    tr = _fig_px_transform(ax.figure)
    x = float(pad_in.get('left') or 0)
    arts = []
    for b in bands:
        pc = _js_number(b.get('pc')) or 0
        w = single * 0.01 * pc
        arts.append(ax.figure.add_artist(Rectangle(
            (x, height), w, height, transform=tr, facecolor=_mpl_colour(b.get('col'), 'none'),
            edgecolor='gray', linewidth=_PX_TO_PT, clip_on=False, zorder=3,
            gid='actogram-light-band')))
        x += w
    return arts


def _actogram_block_style(block, series_colour, rule=None):
    """The colour, line width, dot radius and show-line of an own marker block
    (PhaseMarkerClass's `||` defaults) or of a rule's instance (MarkerRule: the rule's colour,
    else the series')."""
    if rule is not None:
        c = rule.get('colour')
        return {'colour': c if isinstance(c, str) and c else (series_colour or 'black'),
                'lineWidth': rule.get('lineWidth') if (_finite(rule.get('lineWidth')) and
                                                      rule.get('lineWidth') > 0) else 1,
                'markerSize': rule.get('markerSize') if (_finite(rule.get('markerSize')) and
                                                        rule.get('markerSize') > 0) else 5,
                'showLine': rule.get('showLine') is not False}
    return {'colour': block.get('colour') or series_colour or 'black',
            'lineWidth': block.get('lineWidth') or 1,
            'markerSize': block.get('markerSize') or 5,
            'showLine': True if block.get('showLine') is None else bool(block.get('showLine'))}


def line_copy_offsets(slope, intercept, period_hrs, span, lo, hi):
    """onsetUnwrap.js lineCopyOffsets: the multiples of tau at which copies of the fitted line
    cross [0, span] between the top of row lo - 1 and the bottom of row hi."""
    if not (slope > 0) or not math.isfinite(intercept) or not (span > 0):
        return [0]
    dx = slope - period_hrs
    xa, xb = intercept + (lo - 1) * dx, intercept + hi * dx
    min_x, max_x = min(xa, xb), max(xa, xb)
    m_lo = math.ceil((0 - max_x) / slope)
    m_hi = math.floor((span - min_x) / slope)
    out = []
    m = m_lo
    while m <= m_hi and len(out) < 1000:
        out.append(m * slope + 0.0)
        m += 1
    return out


def actogram_marker_blocks(plot, entries, period_hrs, n_days):
    """Every marker block each series draws, in the app's order (Actogram.svelte: per series
    its rule instances, then its own blocks): [(series index, kind, name, style, computed)].
    A series detached from a rule draws no instance of it (its detached copy is an own
    block)."""
    p = plot.get('plot', {}) or {}
    rules = [r for r in (p.get('markerRules') or []) if isinstance(r, dict) and
             isinstance(r.get('id'), str) and re.fullmatch(r'r(\d+)', r['id']) and
             int(r['id'][1:]) > 0]
    out = []
    for e in entries:
        if e is None:
            continue
        s, frame = e['series'], e['frame']
        colour = s.get('colour') or s.get('color')
        detached = set(s.get('detachedRules') or [])
        for r in rules:
            if r['id'] in detached:
                continue
            comp = marker_block_compute(marker_rule_cfg(r, period_hrs, n_days),
                                        _rule_store(s, r['id']), frame, period_hrs, n_days)
            out.append((e['d'], 'rule', r, _actogram_block_style(None, colour, rule=r), comp,
                        marker_rule_from_json(r)))
        for bj in s.get('phaseMarkers') or []:
            if not isinstance(bj, dict):
                continue
            cfg = marker_block_from_json(bj)
            comp = marker_block_compute(cfg, _block_store(bj, frame), frame, period_hrs,
                                        n_days)
            out.append((e['d'], 'block', bj, _actogram_block_style(bj, colour), comp, cfg))
    return out


def _marker_line_segments(comp, cfg, style, period_hrs, double, n_days, eph, gap):
    """PhaseMarker.svelte's fitted line and its copies, in (hours, px) from the plot area's
    top left: [(x1, y1, x2, y2)], the primary line LAST (it is drawn after its copies)."""
    reg = comp['regression']
    if not style['showLine'] or reg is None or not reg['slope']:
        return []
    lo = max(1, cfg.get('lineMinDay') if cfg.get('lineMinDay') is not None else 1)
    hi = min(n_days, cfg.get('lineMaxDay') if cfg.get('lineMaxDay') is not None else n_days)
    if hi < lo:
        return []
    slope, icpt = reg['slope'], reg['intercept']
    dx = slope - period_hrs
    y1 = (lo - 1) * (eph + gap)
    y2 = (hi - 1) * (eph + gap) + eph
    segs = [(icpt + off + (lo - 1) * dx, y1, icpt + off + hi * dx, y2)
            for off in line_copy_offsets(slope, icpt, period_hrs, period_hrs * double, lo, hi)
            if off != 0]
    segs.append((icpt + (lo - 1) * dx, y1, icpt + hi * dx, y2))
    return segs


def _marker_dots(comp, style, period_hrs, eph, gap):
    """PhaseMarker.svelte markerPoints: a dot (radius markerSize) per selected marker, in the
    row its time falls in, its centre markerSize / 2 above the row's foot (the rows' first gap
    is not counted): [(hours, px)]."""
    out = []
    r = style['markerSize']
    for m, v in enumerate(comp['markerHours']):
        if not comp['selectedMask'][m] if m < len(comp['selectedMask']) else True:
            continue
        if v is None or (isinstance(v, float) and math.isnan(v)):
            continue
        t = comp['markerTimes'][m]
        row = math.floor(t / period_hrs)
        hour = t - row * period_hrs
        cy = eph - r / 2 + row * gap + row * eph
        if math.isfinite(hour) and math.isfinite(cy):
            out.append((hour, cy))
    return out


def actogram_annotation_segments(ann, start_ms, period_hrs, eph, gap):
    """Annotation.svelte segments: the annotation split at every period boundary it crosses,
    each [(start hour in its row, duration h, top px of its row)] (the row may lie outside the
    plot: the app does not clip annotations)."""
    a = ann or {}
    if a.get('startMs') is not None:
        start = (_js_number(a['startMs']) - start_ms) / _MS_PER_HOUR
    elif a.get('startTime') is not None:
        start = _js_number(a['startTime'])
    else:
        start = 1.0
    if a.get('duration') is not None:
        dur = _js_number(a['duration'])
    elif a.get('endTime') is not None and a.get('startTime') is not None:
        dur = max(0.0, _js_number(a['endTime']) - _js_number(a['startTime']))
    else:
        dur = 1.0
    if not (dur > 0):
        return []
    end = start + dur
    segs = []
    for per in range(math.floor(start / period_hrs), math.floor(end / period_hrs) + 1):
        s0 = max(start, per * period_hrs)
        s1 = min(end, (per + 1) * period_hrs)
        if s1 > s0:
            segs.append((_js_mod(s0, period_hrs), s1 - s0, per * (eph + gap)))
    return segs


def actogram_legend_items(plot, entries, blocks, n_days=0):
    """Actogramclass.getLegendItems: per series its entry (a box swatch in its colour, the
    colormap's mid stop in heatmap mode) then its marker entries (each rule that follows the
    series' colour, "<series>: <rule>", then each own block, its name or "<series> marker
    <n>"), then one entry per FIXED-colour rule. Each item {'label', 'elements'} as
    Legend.svelte reads it."""
    p = plot.get('plot', {}) or {}
    heat = p.get('renderMode') == 'heatmap'
    cmap = p.get('colormap') or DEFAULT_COLORMAP
    items = []

    def elements(style, comp, cfg, n_days):
        els = []
        if any(comp['selectedMask'][m] and v is not None and not (isinstance(v, float) and
                                                                  math.isnan(v))
               for m, v in enumerate(comp['markerHours']) if m < len(comp['selectedMask'])):
            els.append({'type': 'points', 'color': style['colour'],
                        'size': min(6, style['markerSize'])})
        reg = comp['regression']
        lo = max(1, cfg.get('lineMinDay') if cfg.get('lineMinDay') is not None else 1)
        hi = min(n_days, cfg.get('lineMaxDay') if cfg.get('lineMaxDay') is not None else n_days)
        if style['showLine'] and reg is not None and reg['slope'] and hi >= lo:
            els.append({'type': 'line', 'color': style['colour'],
                        'strokeWidth': style['lineWidth']})
        return els
    for e in entries:
        if e is None:
            continue
        s = e['series']
        name = s.get('label') or _display_name(e['y_col'])
        if s.get('draw') is not False:
            sw = _rgb_css(colormap_rgb(cmap, 0.5)) if heat else (s.get('colour') or
                                                                   s.get('color'))
            items.append({'label': name, 'elements': [{'type': 'box', 'color': sw}]})
        own = 0
        for d, kind, j, style, comp, cfg in blocks:
            if d != e['d']:
                continue
            if kind == 'rule':
                if j.get('colour'):
                    continue
                els = elements(style, comp, cfg, n_days)
                if els:
                    items.append({'label': f"{name}: {cfg.get('name') or ''}", 'elements': els})
            else:
                own += 1
                els = elements(style, comp, cfg, n_days)
                if els:
                    nm = j.get('name').strip() if isinstance(j.get('name'), str) else ''
                    items.append({'label': nm or f'{name} marker {own}', 'elements': els})
    for r in p.get('markerRules') or []:
        if not isinstance(r, dict) or not r.get('colour'):
            continue
        kinds = {}
        for d, kind, j, style, comp, cfg in blocks:
            if kind == 'rule' and j is r:
                for el in elements(style, comp, cfg, n_days):
                    kinds[el['type']] = el
        if kinds:
            items.append({'label': r.get('name') or '',
                          'elements': [kinds[k] for k in ('points', 'line') if k in kinds]})
    return items


def _legend_item_handle(item):
    """A matplotlib handle for a Legend.svelte item: a box swatch (14 x 12 px, 2 px outline)
    or a line with its marker."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    els = item['elements']
    box = next((e for e in els if e['type'] == 'box'), None)
    if box is not None:
        h = Patch(facecolor=_mpl_colour(box['color'], 'none'),
                  edgecolor=_mpl_colour(box['color'], 'black'), linewidth=2 * _PX_TO_PT)
        h._ancir_box_swatch = True
        return h
    line = next((e for e in els if e['type'] == 'line'), None)
    pts = next((e for e in els if e['type'] == 'points'), None)
    colour = _mpl_colour((line or pts)['color'], 'black')
    return Line2D([], [], color=colour if line else 'none',
                  linewidth=(line['strokeWidth'] * _PX_TO_PT) if line else 0,
                  marker='o' if pts else 'None',
                  markersize=(2 * pts['size'] * _PX_TO_PT) if pts else 0,
                  markerfacecolor=_mpl_colour(pts['color'], 'black') if pts else 'none',
                  markeredgecolor='none')


def plot_actogram(plot, columns_index, ax, zone=None):
    """Double-plotted actogram drawn from the SAME rows as the plot-data CSV
    (actogram_download_data), so the PNG folds where the app does: every series at the
    plot's one startTime (the user's chosen `startTimeIN`, else midnight in the display
    zone before the earliest sample). Row r shows periods r .. r + doublePlot - 1, laid out
    as Actogram.svelte lays them (rowGeometry: the user's gap, rows sharing the rest), with
    the hours axis on top and the row labels it is set to show.

    renderMode 'bars': each bar rises from its row's foot by its value over the row's range
    (ylimsOption: 'overall' the series' range, 'manual' ylimsIN, 'byperiod' the range of the
    periods the row shows). 'heatmap': every bin fills its row in the plot's colormap at its
    value over the series' range (intensityDomain; a missing value is the map's low end), with
    the app's scale bar (top right, or top left beside a top-right legend). Rows under 1 px, or
    a heatmap past 20,000 cells, are one image per series (actogramRaster.js: each pixel holds
    the area its bars or cells cover). Past 20,000 rows nothing is drawn and the plot says why.
    Over the rows: each series' phase markers (its marker rules' instances, then its own
    blocks: the fitted line and its copies a tau apart, and a dot per selected marker), the
    annotations (the lower half of each row they cover), the light bar above the plot, the row
    labels and the legend (legend_layout, 'auto' avoiding the bars and the scale bar). `zone`
    defaults to the session's display zone (DISPLAY_TIMEZONE)."""
    from matplotlib.patches import Rectangle
    from matplotlib.collections import PatchCollection
    from matplotlib.lines import Line2D
    p = plot.get('plot', {})
    look = plot_look(plot)
    zone = DISPLAY_TIMEZONE if zone is None else zone
    period_hrs = float(p.get('periodHrs', 24) or 24)
    double = max(1, int(p.get('doublePlot', 2) or 1))
    span = period_hrs * double
    entries, start_ms, rows_needed = _actogram_series(plot, columns_index, zone)
    series_data = p.get('data', []) or []
    heat = p.get('renderMode') == 'heatmap'
    base_w, h_px = _axes_px(ax)
    fig = ax.figure
    total_w = float(plot.get('width') or 520)
    refused = rows_needed > MAX_ACTOGRAM_ROWS
    n_rows = 0 if refused else rows_needed
    geom = actogram_row_geometry(h_px, n_rows, p.get('spaceBetween', 2))
    gap, row_h = geom['gap'], geom['height']
    cmap = p.get('colormap') or DEFAULT_COLORMAP
    # Ranges: per series (overall / heatmap intensity), per row (byperiod) or manual.
    raw_y = {}
    for d, s in enumerate(series_data):
        y_col = _resolve_plot_col(s.get('y'), columns_index)
        raw_y[d] = _js_min_max(y_col.get_data() if y_col is not None else [])
    option = p.get('ylimsOption') or 'overall'
    ylims_in = list(p.get('ylimsIN') or [0, 100]) + [None, None]

    def row_range(d, row):
        if option == 'manual':
            return _number_or_none(ylims_in[0]) or 0.0, _number_or_none(ylims_in[1])
        if option == 'byperiod':
            e = entries[d] if d < len(entries) else None
            if e is None:
                return (None, None)
            _xs, _xe, vals = actogram_row_bins(e['bins'], row, double, period_hrs)
            vals = [float(v) for v in vals if _finite(v)]
            return (min(vals), max(vals)) if vals else (None, None)
        return raw_y.get(d, (None, None))
    # Every bar or cell, in (hours along its row, px down the plot area): drawn below, and
    # what an 'auto' legend avoids (Actogramclass.legendObstacles).
    marks = []
    heat_cells = 0
    for e in entries:
        if e is None or e['series'].get('draw') is False:
            continue
        d = e['d']
        heat_cells += sum(len(v) for v in e['bins'].values()) * double
        for day in range(n_rows):
            xs, xe, vals = actogram_row_bins(e['bins'], day, double, period_hrs)
            top = day * (gap + row_h) + gap
            lo = hi = None
            if not heat and xs:
                lo, hi = row_range(d, day)
            for i in range(len(xs)):
                v = vals[i]
                finite = _finite(v)
                if heat:
                    marks.append((d, xs[i], xe[i], top, top + row_h, v, finite))
                    continue
                if not finite or lo is None or hi is None or not math.isfinite(hi - lo) \
                        or hi == lo:
                    continue
                h = (float(v) - lo) / (hi - lo) * row_h
                if h <= 0:
                    continue
                marks.append((d, xs[i], xe[i], top + row_h - h, top + row_h, v, True))
    raster = n_rows > 0 and (row_h < 1 or (heat and heat_cells > ACTOGRAM_MAX_SVG_HEATMAP_CELLS))
    # Phase markers, for the legend and the drawing.
    blocks = actogram_marker_blocks(plot, entries, period_hrs, n_rows) if n_rows > 0 else []
    items = actogram_legend_items(plot, entries, blocks, n_rows)
    legend_json = p.get('legend') or {}
    any_drawn = any(s.get('draw') is not False for s in series_data)

    def obstacles(w, h):
        rects = [[x0 / span * w, y0, x1 / span * w, y1] for _d, x0, x1, y0, y1, _v, ok in marks
                 if ok]
        if heat and any_drawn:
            rects.append([w - 96 - 15, 2, w - 5, 28])
        return [{'rects': rects}]
    layout = legend_layout(legend_json, [it['label'] for it in items], look, base_w, h_px,
                           obstacles=obstacles, fig=fig)
    reserve_axes_right((ax,), layout['reserveW'])
    w_px, _ = _axes_px(ax)
    # y runs down the plot area in px, as the app's SVG does.
    ax.set_xlim(0, span)
    ax.set_ylim(h_px, 0)
    if raster:
        rh_total = n_rows * (row_h + gap)
        scale = min(2.0, max(1.0, float(look.get('dpi') or 96) / _FIG_PX_PER_IN))
        W = round(w_px * scale)
        H = round(rh_total * scale)
        sy = H / rh_total if rh_total > 0 else 1
        for e in entries:
            if e is None or e['series'].get('draw') is False:
                continue
            d = e['d']
            dom = raw_y.get(d, (None, None))
            dom = (0, 1) if dom[0] is None else dom
            r = actogram_raster(
                n_rows, W, H, span,
                lambda day, e=e: actogram_row_bins(e['bins'], day, double, period_hrs),
                'heatmap' if heat else 'bars',
                y_frac=lambda day, y, d=d: (
                    (lambda lo, hi: (float(y) - lo) / (hi - lo)
                     if (lo is not None and hi is not None and hi > lo) else 0)
                    (*row_range(d, day))),
                colour=lambda y, dom=dom: colormap_rgb(cmap, normalise_to_01(y, dom[0], dom[1])),
                row_h=row_h * sy, gap=gap * sy)
            rgba = actogram_raster_rgba(r, _parse_rgb(e['series'].get('colour')))
            ax.imshow(rgba, extent=(0, span, rh_total, 0), aspect='auto', interpolation='nearest',
                      zorder=1, gid='actogram-raster')
        ax.set_xlim(0, span)
        ax.set_ylim(h_px, 0)
    elif marks:
        rects, colours = [], []
        for d, x0, x1, y0, y1, v, ok in marks:
            sd = series_data[d] if d < len(series_data) else {}
            if heat:
                lo, hi = raw_y.get(d, (None, None))
                t = normalise_to_01(v, lo, hi) if ok else 0.0
                rects.append(Rectangle((x0, y0), max(x1 - x0, 0.5 / w_px * span), y1 - y0))
                colours.append(tuple(c / 255 for c in colormap_rgb(cmap, t)))
            else:
                rects.append(Rectangle((x0, y0), x1 - x0, y1 - y0))
                colours.append(_mpl_colour(sd.get('colour') or sd.get('color'), '#234154'))
        pc = PatchCollection(rects, facecolors=colours, edgecolors='none', linewidths=0,
                             zorder=1, gid='actogram-heatmap' if heat else 'actogram-bars')
        ax.add_collection(pc)
    # The markers (clipped to the plot area, as the app's marker group is): per block its line
    # copies, its line, then its dots.
    z = 2.0
    for d, kind, j, style, comp, cfg in blocks:
        colour = _mpl_colour(style['colour'], 'black')
        gid = f"actogram-marker-{d}-{kind}-{(j.get('id') if kind == 'rule' else j.get('name'))}"
        for x1, y1, x2, y2 in _marker_line_segments(comp, cfg, style, period_hrs, double,
                                                    n_rows, row_h, gap):
            z += 1e-4
            ax.add_line(Line2D([x1, x2], [y1, y2], color=colour,
                               linewidth=style['lineWidth'] * _PX_TO_PT, solid_capstyle='butt',
                               zorder=z, gid=gid + '-line'))
        dots = _marker_dots(comp, style, period_hrs, row_h, gap)
        if dots:
            z += 1e-4
            ax.scatter([a for a, _ in dots], [b for _, b in dots],
                       s=(2 * style['markerSize'] * _PX_TO_PT) ** 2, marker='o',
                       facecolors=colour, edgecolors='none', linewidths=0, zorder=z,
                       gid=gid + '-dots')
    # Annotations (not clipped): the lower half of every row they cover.
    for k, ann in enumerate(p.get('annotations') or []):
        for hr, dur, y_off in actogram_annotation_segments(ann, start_ms, period_hrs, row_h,
                                                           gap):
            ax.add_patch(Rectangle((hr, y_off + gap + row_h / 2), dur, row_h / 2,
                                   facecolor=_mpl_colour((ann or {}).get('colour'), '#0000FF'),
                                   edgecolor='none', linewidth=0, clip_on=False, zorder=4,
                                   gid=f'actogram-annotation-{k}'))
    if refused:
        msg = (f"Not drawn: the data span {rows_needed:,} periods of "
               f"{_js_number(float(f'{period_hrs:.6g}'))} h, and an actogram draws at most "
               f"{MAX_ACTOGRAM_ROWS:,} rows. A plain number column is read as hours: convert "
               "seconds or minutes to hours (or import it as time), or set a longer period.")
        ax.text(0.5, 0.5, msg, transform=ax.transAxes, ha='center', va='center', wrap=True,
                fontsize=look['px']['tick'] * _PX_TO_PT, color='#555555',
                gid='actogram-refused')
    _draw_actogram_light_bar(ax, p, total_w)
    x_axis = p.get('xAxis') or {'gridlines': False, 'nticks': 6}
    specs = {'top': {'kind': 'linear', 'domain': (0, span), 'axis': x_axis,
                     'label': x_axis.get('label') or ''}}
    _draw_app_axes(ax, None, specs, look)
    ax.set_ylim(h_px, 0)
    # Row labels (Actogram.svelte): 10 px left of the rows, centred on each labelled row.
    mode = _actogram_row_labels_mode(p)
    if mode != 'none' and n_rows > 0:
        fpx = actogram_row_label_px(look['px']['tick'], h_px, n_rows, p.get('spaceBetween', 2))
        from matplotlib.transforms import blended_transform_factory
        tr = blended_transform_factory(ax.transAxes, ax.transData)
        for day in actogram_labelled_rows(n_rows):
            ax.text(-10 / w_px, day * (row_h + gap) + row_h / 2,
                    actogram_row_label_text(day, mode, start_ms if mode == 'date' else None,
                                            period_hrs, p.get('dateFormat'), zone),
                    transform=tr, ha='right', va='center', fontsize=fpx * _PX_TO_PT,
                    fontfamily=_font_family_list(look['family']), color='black',
                    gid='actogram-row-label')
    if legend_json.get('show') and items:
        _actogram_legend(ax, items, legend_json, look, layout)
    ax._ancir_legend_layout = layout
    ax._ancir_actogram = {'blocks': blocks, 'raster': raster, 'n_rows': n_rows,
                          'row_h': row_h, 'gap': gap, 'start': start_ms}
    if heat:
        _draw_actogram_heat_legend(ax, p, raw_y, series_data, cmap, look,
                                   n_items=len(items))


def _actogram_legend(ax, items, legend_json, look, layout):
    """The actogram's legend: each item's swatch as Legend.svelte draws it (a series' box, a
    marker block's dot and line)."""
    from matplotlib.patches import Rectangle
    from matplotlib.legend_handler import HandlerPatch

    def swatch(legend, orig_handle, xdescent, ydescent, width, height, fontsize):
        return Rectangle((-xdescent + 3 * _PX_TO_PT, -ydescent + height / 2 - 6 * _PX_TO_PT),
                         14 * _PX_TO_PT, 12 * _PX_TO_PT)
    handles = [_legend_item_handle(it) for it in items]
    labels = [it['label'] for it in items]
    kw = legend_kwargs(legend_json, look, len(handles))
    frame = kw.pop('_frame')
    anchor = legend_anchor_kwargs(legend_json, layout, ax) if layout.get('box') else {}
    if anchor:
        kw.pop('bbox_to_anchor', None)
        kw.update(anchor)
    hmap = {h: HandlerPatch(patch_func=swatch) for h in handles
            if getattr(h, '_ancir_box_swatch', False)}
    leg = ax.legend(handles, labels, handler_map=hmap, **kw)
    style_legend(leg, frame)
    return leg


def _draw_actogram_heat_legend(ax, p, raw_y, series_data, cmap, look, n_items=None):
    """The heatmap's scale bar (Actogram.svelte): 96 x 8 px, the map through six stops, the
    first drawn series' range at its ends (3 significant figures, 9 px #555), on a white
    backdrop 10 px in from the plot's top right (top left while a shown top-right legend
    has entries), 6 px down."""
    from matplotlib.patches import FancyBboxPatch
    fdi = next((i for i, s in enumerate(series_data) if s.get('draw') is not False), None)
    if fdi is None:
        return
    lo, hi = raw_y.get(fdi, (None, None))
    lo, hi = (0, 1) if lo is None else (lo, hi)
    w_px, h_px = _axes_px(ax)
    leg = p.get('legend') or {}
    step_aside = leg.get('show') is True and leg.get('position', 'topright') == 'topright' \
        and (n_items if n_items is not None else len(series_data)) > 0
    leg_w = 96
    lx = 10 if step_aside else w_px - leg_w - 10
    ly = 6

    def fx(px):
        return px / w_px

    def fy(px):
        return 1 - px / h_px
    ax.add_patch(FancyBboxPatch((fx(lx - 5), fy(ly - 4 + 26)), fx(leg_w + 10) - fx(0),
                                fy(0) - fy(26), boxstyle='round,pad=0,rounding_size=0.004',
                                transform=ax.transAxes, facecolor=(1, 1, 1, 0.82),
                                edgecolor='#cccccc', linewidth=0.5 * _PX_TO_PT, zorder=5,
                                gid='actogram-heat-legend'))
    stops = [colormap_rgb(cmap, t) for t in (0, 0.2, 0.4, 0.6, 0.8, 1)]
    grad = []
    for k in range(256):
        u = k / 255 * 5
        i = min(4, int(u))
        f = u - i
        grad.append([(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) / 255 for c in range(3)])
    ax.imshow([grad], extent=(fx(lx), fx(lx + leg_w), fy(ly + 8), fy(ly)), aspect='auto',
              transform=ax.transAxes, zorder=5.1, interpolation='bilinear')
    family = _font_family_list(look['family'])
    for x, val, ha in ((lx, lo, 'left'), (lx + leg_w, hi, 'right')):
        ax.text(fx(x), fy(ly + 20), _js_to_precision_signed(val, 3), transform=ax.transAxes,
                ha=ha, va='baseline', fontsize=9 * _PX_TO_PT, color='#555555',
                fontfamily=family, zorder=5.2, gid='actogram-heat-legend-label')


def _js_to_precision_signed(v, p):
    """Number(v).toPrecision(p)."""
    v = float(v)
    if not math.isfinite(v):
        return 'NaN' if math.isnan(v) else ('-' if v < 0 else '') + 'Infinity'
    return ('-' if v < 0 else '') + _js_precision(abs(v), p)


# ---- Wavelet scalogram (utils/cwt.js, plots/CWT/CWT.svelte) ----------------------------
#
# Torrence & Compo (1998) in the Fourier domain, exactly as cwt.js computes it: the mean
# removed, gaps zero-filled, zero-padded to a power of two, one forward FFT and one inverse
# per scale; scales log2-spaced from 2 dt, each converted to its Fourier period; power
# |W|^2 (divided by the scale when rectified); the cone of influence the e-folding time.

CWT_WAVELETS = ('morlet', 'paul', 'dog')
_CWT_MAX_N = 1 << 22


def _lanczos_gamma(x):
    """cwt.js gamma: the Lanczos approximation (g = 7, nine coefficients)."""
    g = 7
    c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
         -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
         1.5056327351493116e-7]
    if x < 0.5:
        return math.pi / (math.sin(math.pi * x) * _lanczos_gamma(1 - x))
    x -= 1
    a = c[0]
    t = x + g + 0.5
    for i in range(1, g + 2):
        a += c[i] / (x + i)
    return math.sqrt(2 * math.pi) * t ** (x + 0.5) * math.exp(-t) * a


def cwt_wavelet_props(name, param=None):
    """cwt.js waveletProps: the scale-to-period factor, the COI factor and the wavelet's
    energy-normalised Fourier transform psi_hat(omega array, s, dt)."""
    if name == 'paul':
        m = 4 if param is None else param

        def psi(w, s, dt):
            norm = math.sqrt(2 * math.pi * s / dt) * (2 ** m / math.sqrt(m * _lanczos_gamma(2 * m)))
            out = np.zeros_like(w)
            pos = w > 0
            out[pos] = norm * (s * w[pos]) ** m * np.exp(-s * w[pos])
            return out
        return {'fourierFactor': 4 * math.pi / (2 * m + 1), 'coiFactor': 1 / math.sqrt(2),
                'psiHat': psi}
    if name == 'dog':
        m = 2 if param is None else param

        def psi(w, s, dt):
            norm = math.sqrt(2 * math.pi * s / dt) * math.sqrt(1 / _lanczos_gamma(m + 0.5))
            return norm * (s * np.abs(w)) ** m * np.exp(-((s * w) ** 2) / 2)
        return {'fourierFactor': 2 * math.pi / math.sqrt(m + 0.5), 'coiFactor': math.sqrt(2),
                'psiHat': psi}
    w0 = 6 if param is None else param

    def psi(w, s, dt):
        norm = math.sqrt(2 * math.pi * s / dt) * math.pi ** -0.25
        out = np.zeros_like(w)
        pos = w > 0
        out[pos] = norm * np.exp(-((s * w[pos] - w0) ** 2) / 2)
        return out
    return {'fourierFactor': 4 * math.pi / (w0 + math.sqrt(2 + w0 * w0)),
            'coiFactor': math.sqrt(2), 'psiHat': psi}


def cwt_build_scales(dt, n, dj=0.125, s0=None, j1=None):
    """cwt.js buildScales: s0 * 2^(j dj), j = 0 .. J (span-limited unless given)."""
    smallest = s0 if (s0 and s0 > 0) else 2 * dt
    max_j = j1 if (j1 is not None and j1 > 0) else max(
        1, math.floor(math.log2((n * dt) / smallest) / dj))
    return [smallest * 2 ** (j * dj) for j in range(max_j + 1)]


def _cwt_empty(reason, dt=0):
    return {'periods': [], 'scales': [], 'power': [], 'coi': [], 'times': [], 'dt': dt,
            'nScales': 0, 'valid': False, 'reason': reason}


def cwt_transform(values, dt, wavelet='morlet', param=None, dj=0.125, s0=None, j1=None,
                  period_range=None, rectify=True):
    """cwt.js cwt: {'periods', 'scales', 'power' (rows = scales), 'coi', 'dt', 'nScales',
    'valid', 'reason'}."""
    if not isinstance(values, (list, tuple, np.ndarray)) or len(values) < 4:
        return _cwt_empty('need at least 4 samples')
    if not (isinstance(dt, (int, float)) and math.isfinite(dt) and dt > 0):
        return _cwt_empty('sample interval must be positive and finite')
    if wavelet not in CWT_WAVELETS:
        return _cwt_empty(f'unknown wavelet "{wavelet}"')
    n = len(values)
    clean = [float(v) if _finite(v) else float('nan') for v in values]
    finite = [v for v in clean if math.isfinite(v)]
    if len(finite) < 4:
        return _cwt_empty('need at least 4 finite samples')
    mu = kahan_mean(finite)
    n_pad = 1 if n <= 1 else 2 ** math.ceil(math.log2(n))
    if n_pad > _CWT_MAX_N:
        return _cwt_empty('series too long for the transform')
    x = np.zeros(n_pad, dtype=np.float64)
    x[:n] = [v - mu if math.isfinite(v) else 0.0 for v in clean]
    spec = np.fft.fft(x)
    k = np.arange(n_pad)
    kk = np.where(k <= n_pad / 2, k, k - n_pad)
    omega = 2 * math.pi * kk / (n_pad * dt)
    props = cwt_wavelet_props(wavelet, param)
    scales, periods = [], []
    for sc in cwt_build_scales(dt, n, dj, s0, j1):
        period = sc * props['fourierFactor']
        if period_range:
            lo, hi = period_range
            if _finite(lo) and period < lo:
                continue
            if _finite(hi) and period > hi:
                continue
        scales.append(sc)
        periods.append(period)
    if not scales:
        return _cwt_empty('no scales fall inside the requested period range')
    power = []
    for sc in scales:
        w = np.fft.ifft(spec * props['psiHat'](omega, sc, dt))[:n]
        row = (w.real ** 2 + w.imag ** 2) / (sc if rectify else 1)
        power.append(row)
    coi_const = props['fourierFactor'] * props['coiFactor']
    i = np.arange(n)
    coi = coi_const * dt * (np.minimum(i, n - 1 - i) + 1e-9)
    return {'periods': periods, 'scales': scales, 'power': power, 'coi': list(coi), 'dt': dt,
            'nScales': len(scales), 'valid': True, 'reason': ''}


def cwt_from_series(times, values, wavelet='morlet', param=None, dj=0.125, period_range=None,
                    rectify=True, tolerance=0.01):
    """cwt.js cwtFromSeries: the transform of (times, values) as the app stores them (rows
    with both present), refused when the sampling is not uniform; adds 'times'."""
    if times is None or values is None or len(times) != len(values) or len(times) < 4:
        return _cwt_empty('need at least 4 aligned samples')
    idx = [i for i in range(len(times)) if not _js_invalid(times[i]) and
           not _js_invalid(values[i])]
    if len(idx) < 4:
        return _cwt_empty('need at least 4 finite samples')
    t = [_js_number(times[i]) for i in idx]
    y = [_js_number(values[i]) for i in idx]
    diffs = [t[i] - t[i - 1] for i in range(1, len(t))]
    dt = kahan_mean(diffs)
    if not math.isfinite(dt) or dt <= 0:
        return _cwt_empty('time axis is not increasing')
    max_dev = max(abs(d - dt) for d in diffs) / dt
    if max_dev > tolerance:
        return _cwt_empty(f'sampling is not uniform (intervals vary by {max_dev * 100:.1f}%). '
                          'Bin or interpolate first.', dt)
    out = cwt_transform(y, dt, wavelet, param, dj, period_range=period_range, rectify=rectify)
    out['times'] = t
    return out


def cwt_ridge(tr):
    """cwt.js waveletRidge: the period of greatest power at each time, ignoring cells inside
    the cone of influence: {'ridgePeriod', 'ridgePower'} (NaN where none)."""
    power = tr.get('power') or []
    if not len(power):
        return {'ridgePeriod': [], 'ridgePower': []}
    P = np.array(power)
    periods = np.array(tr['periods'])[:, None]
    coi = np.array(tr['coi'])[None, :] if len(tr.get('coi') or []) else None
    masked = np.where(np.isfinite(P), P, -np.inf)
    if coi is not None:
        masked = np.where(periods > coi, -np.inf, masked)
    best = masked.argmax(axis=0)
    val = masked[best, np.arange(P.shape[1])]
    ok = np.isfinite(val)
    return {'ridgePeriod': [float(tr['periods'][b]) if o else float('nan')
                            for b, o in zip(best, ok)],
            'ridgePower': [float(v) if o else float('nan') for v, o in zip(val, ok)]}


SCALOGRAM_MAX_COLUMNS = 4096


def downsample_columns(power, max_cols):
    """CWT.svelte downsampleColumns: each row's time axis binned to at most `max_cols`
    columns, the mean of the finite values in each bin (NaN for none)."""
    P = np.asarray(power, dtype=np.float64)
    n = P.shape[1] if P.ndim == 2 else 0
    if n <= max_cols:
        return P
    out = np.full((P.shape[0], max_cols), np.nan)
    for c in range(max_cols):
        i0 = math.floor(c * n / max_cols)
        i1 = math.floor((c + 1) * n / max_cols)
        seg = P[:, i0:i1]
        fin = np.isfinite(seg)
        cnt = fin.sum(axis=1)
        tot = np.where(fin, seg, 0).sum(axis=1)
        out[:, c] = np.where(cnt > 0, tot / np.maximum(cnt, 1), np.nan)
    return out


def cwt_period_to_y(period, periods, h, log_scale):
    """CWT.svelte periodToY: a period's px down the plot area (longest at the top)."""
    if len(periods) < 2:
        return h / 2
    lo, hi = periods[0], periods[-1]
    if log_scale:
        t = (math.log(period) - math.log(lo)) / (math.log(hi) - math.log(lo))
        return h - t * h
    return h - (period - lo) / (hi - lo) * h


def cwt_period_ticks(periods):
    """CWT.svelte periodTicks: the readable periods inside the range, else the ends and
    their geometric mean."""
    if len(periods) < 2:
        return []
    lo, hi = periods[0], periods[-1]
    inside = [c for c in (0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 36, 48, 72, 96, 168, 336)
              if lo <= c <= hi]
    return inside if len(inside) >= 2 else [lo, math.sqrt(lo * hi), hi]


def _js_to_fixed(v, digits):
    """Number.prototype.toFixed for the scalogram's labels."""
    s = _js_fixed(v, digits)
    return s


def cwt_transform_of_plot(plot, columns_index):
    """CWTClass.transform for a saved scalogram: its series' hours since the start and values
    through cwt_from_series with the plot's wavelet, its parameter, dj, rectify and period
    range."""
    p = plot.get('plot', {}) or {}
    data = p.get('data') or []
    d = data[0] if data else None
    x_col = _resolve_plot_col((d or {}).get('x') or (d or {}).get('time'), columns_index)
    y_col = _resolve_plot_col((d or {}).get('y') or (d or {}).get('values'), columns_index)
    t = x_col.hours_since_start if x_col is not None else []
    v = y_col.get_data() if y_col is not None else []
    if not len(t or []) or not len(v or []):
        return _cwt_empty('no data')
    return cwt_from_series(list(t), list(v), wavelet=_nn(p.get('wavelet'), 'morlet'),
                           param=_nn(p.get('waveletParam'), 6), dj=_nn(p.get('dj'), 0.125),
                           period_range=[_nn(p.get('periodMin'), 1), _nn(p.get('periodMax'), 48)],
                           rectify=_nn(p.get('rectify'), True))


_CWT_GREY_25 = '#333333'   # --color-lightness-25
_CWT_GREY_50 = '#808080'   # --color-lightness-50
_CWT_GREY_75 = '#b3b3b3'   # --color-lightness-75
_CWT_SURFACE = '#ffffff'   # --surface-card


def plot_cwt(plot, columns_index, ax):
    """The wavelet scalogram as CWT.svelte draws it, in the plot area's px (x right, y down):
    the power field as one image (time across, the longest period at the top, scale rows
    evenly spaced, at most 4096 columns, each cell the colormap at its power over 0 .. the
    largest power), the shaded period bands over it, the cone of influence (white dashed
    curve, everything outside it washed with the card colour at 45%), the ridge (red), the
    frame, the period ticks and the time ticks (fixed 10 / 11 px type, scaled with the
    figure only through its view), the reference lines, and the colour scale ("Power", 0 ..
    largest power) beside the plot. A transform that cannot run draws its reason."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Rectangle, Polygon
    p = plot.get('plot', {}) or {}
    look = plot_look(plot)
    family = _font_family_list(look['family'])
    W, H = _axes_px(ax)
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)
    ax.set_axis_off()
    tr = cwt_transform_of_plot(plot, columns_index)
    ax._ancir_cwt = {'transform': tr}
    if not tr['valid']:
        ax.text(0.5, 0.5, 'Wire a time column and a value column.' if tr['reason'] == 'no data'
                else tr['reason'], transform=ax.transAxes, ha='center', va='center',
                fontsize=12 * _PX_TO_PT, color='#666666', gid='cwt-reason')
        return
    cmap = p.get('colormap') or 'viridis'
    log_scale = _nn(p.get('logScale'), True)
    periods = tr['periods']
    times = tr['times']
    t0, t1 = times[0], times[-1]
    P = np.array(tr['power'])
    fin = P[np.isfinite(P)]
    pmax = float(fin.max()) if fin.size and fin.max() > 0 else 1.0
    ax._ancir_cwt['powerMax'] = pmax
    img = downsample_columns(P, SCALOGRAM_MAX_COLUMNS)[::-1]
    t = np.where(np.isfinite(img), np.clip(img / pmax, 0, 1), 0.0)
    rgb = colormap_rgb_array(cmap, t) / 255.0
    ax.imshow(rgb, extent=(0, W, H, 0), aspect='auto', interpolation='bilinear', zorder=0.2,
              gid='cwt-power')
    ax.set_xlim(0, W)
    ax.set_ylim(H, 0)

    def ypx(period):
        return cwt_period_to_y(period, periods, H, log_scale)

    def xpx(hours):
        return (hours - t0) / ((t1 - t0) or 1) * W
    # Overlays: horizontal lines and bands on the period axis, drawn where the app draws them
    # (bands over the image, lines above everything but the colour scale); a mark outside the
    # period range is not drawn.
    overlays = _overlays_from_plot(p, OVERLAY_CAPABILITIES['cwt'])
    lines_later = []
    for i, ov in enumerate(overlays):
        if not ov['enabled']:
            continue
        g = _overlay_geometry(ov, columns_index, {'xDomainMin': t0, 'xDomainMax': t1,
                                                  'xAnchorMin': t0, 'xIsTime': False})
        gid = f"overlay-{ov['id'] if ov['id'] is not None else i}"
        if g['kind'] == 'line':
            lines_later.append((ov, g, gid))
            continue
        for sgm in g.get('segments') or []:
            if 'y0' not in sgm:
                continue
            a, b = sorted((sgm['y0'], sgm['y1']))
            if not (_finite(a) and _finite(b)) or (log_scale and a <= 0):
                continue
            y0, y1 = ypx(b), ypx(a)
            ax.add_patch(Rectangle((0, y0), W, y1 - y0,
                                   facecolor=_overlay_colour(ov['fill'],
                                                             _OVERLAY_BAND_FILL_DEFAULT),
                                   edgecolor='none', linewidth=0, zorder=0.5, gid=gid))
            if ov['edge']:
                for yy in (y0, y1):
                    ax.add_line(Line2D([0, W], [yy, yy],
                                       color=_overlay_colour(ov['edgeColour'],
                                                             _OVERLAY_EDGE_COLOUR_DEFAULT),
                                       linewidth=ov['edgeWidth'] * _PX_TO_PT, zorder=0.6,
                                       gid=gid))
    n = len(times)
    p_lo, p_hi = periods[0], periods[-1]
    if _nn(p.get('showCOI'), True) and len(tr['coi']):
        step = max(1, math.floor(n / 240))
        pts = [(xpx(times[i]), ypx(max(p_lo, min(p_hi, tr['coi'][i]))))
               for i in range(n) if i % step == 0 or i == n - 1]
        ax.add_patch(Polygon([(0, 0)] + pts + [(W, 0)], closed=True, facecolor=_CWT_SURFACE,
                             alpha=0.45, edgecolor='none', zorder=1.1, gid='cwt-coi-shade'))
        ax.add_line(Line2D([a for a, _ in pts], [b for _, b in pts], color='#ffffff',
                           alpha=0.85, linewidth=1.5 * _PX_TO_PT, linestyle=(0, (4, 3)),
                           dash_capstyle='butt', zorder=1.0, gid='cwt-coi'))
    if _nn(p.get('showRidge'), False):
        ridge = cwt_ridge(tr)['ridgePeriod']
        step = max(1, math.floor(n / 400))
        pts = [(xpx(times[i]), ypx(ridge[i])) for i in range(n)
               if i % step == 0 and math.isfinite(ridge[i])]
        if pts:
            ax.add_line(Line2D([a for a, _ in pts], [b for _, b in pts], color='#ff3b30',
                               alpha=0.9, linewidth=1.5 * _PX_TO_PT, zorder=1.2,
                               gid='cwt-ridge'))
    ax.add_patch(Rectangle((0, 0), W, H, facecolor='none', edgecolor=_CWT_GREY_75,
                           linewidth=_PX_TO_PT, zorder=1.3, clip_on=False, gid='cwt-frame'))
    fs = 1.0  # a figure is drawn at its own size (viewFontScale 1)
    for per in cwt_period_ticks(periods):
        y = ypx(per)
        ax.add_line(Line2D([-4, 0], [y, y], color=_CWT_GREY_50, linewidth=_PX_TO_PT,
                           clip_on=False, zorder=1.3, gid='cwt-period-tick'))
        ax.text(-(4 + 3 * fs), y, _js_to_fixed(per, 0) if per >= 10 else _js_to_fixed(per, 1),
                ha='right', va='center', fontsize=10 * fs * _PX_TO_PT, color=_CWT_GREY_25,
                fontfamily=family, clip_on=False, gid='cwt-period-label')
    ax.text(-(4 + 42 * fs), H / 2, 'Period (h)', rotation=90, rotation_mode='anchor',
            ha='center', va='baseline', fontsize=11 * fs * _PX_TO_PT, color=_CWT_GREY_25,
            fontfamily=family, clip_on=False, gid='cwt-period-title')
    for f in (0, 0.25, 0.5, 0.75, 1):
        x = f * W
        ax.add_line(Line2D([x, x], [H, H + 4], color=_CWT_GREY_50, linewidth=_PX_TO_PT,
                           clip_on=False, zorder=1.3, gid='cwt-time-tick'))
        ax.text(x, H + 4 + 12 * fs, _js_to_fixed(t0 + f * (t1 - t0), 0), ha='center',
                va='baseline', fontsize=10 * fs * _PX_TO_PT, color=_CWT_GREY_25,
                fontfamily=family, clip_on=False, gid='cwt-time-label')
    ax.text(W / 2, H + 4 + 30 * fs, 'Time', ha='center', va='baseline',
            fontsize=11 * fs * _PX_TO_PT, color=_CWT_GREY_25, fontfamily=family, clip_on=False,
            gid='cwt-time-title')
    for ov, g, gid in lines_later:
        width = ov['strokeWidth']
        for v in g.get('positions') or []:
            if not _finite(v) or (log_scale and v <= 0) or not (p_lo <= v <= p_hi):
                continue
            y = ypx(v)
            ax.add_line(Line2D([0, W], [y, y], color=_overlay_colour(ov['colour'], '#2C2C2C'),
                               linewidth=width * _PX_TO_PT,
                               linestyle=_overlay_dashes(ov['stroke'], width), zorder=2.5,
                               gid=gid))
    # The power key: ColourScale over the gradient of the colormap's 11 stops, ticks at both
    # ends and the middle of 0 .. the largest power, placed by its own position presets.
    cs = p.get('colourScale') or {}
    if cs.get('show', True) is not False:
        _draw_cwt_colour_key(ax, cs, cmap, pmax, look, p.get('padding') or {})


def colormap_rgb_array(name, t):
    """colormap_rgb over an array of t in [0, 1]: (..., 3) floats 0..255, rounded as the app
    rounds each channel."""
    t = np.asarray(t, dtype=np.float64)
    flat = t.ravel()
    out = np.empty((flat.size, 3))
    cache = {}
    for i, v in enumerate(flat):
        key = round(float(v), 12)
        c = cache.get(key)
        if c is None:
            c = cache[key] = colormap_rgb(name, float(v))
        out[i] = c
    return out.reshape(t.shape + (3,))


_GRADIENT_STOPS = 11


def _draw_cwt_colour_key(ax, cs, cmap, pmax, look, padding):
    """ColourScale.svelte on the scalogram: the colormap's 11 stops as a gradient, ticks
    '0', the middle and the largest power (3 significant figures), titled "Power"; beside
    the plot ('right': 10 px past it, clamped to the figure's right edge) or in a corner over
    the data."""
    stops = [colormap_rgb(cmap, i / (_GRADIENT_STOPS - 1)) for i in range(_GRADIENT_STOPS)]
    palette = []
    for k in range(256):
        u = k / 255 * (_GRADIENT_STOPS - 1)
        i = min(_GRADIENT_STOPS - 2, int(u))
        f = u - i
        palette.append(tuple(stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f
                             for c in range(3)))
    vals = [0.0, pmax / 2, pmax]
    ticks = [(i / 2, _format_scale_value(v)) for i, v in enumerate(vals)]
    key = {'palette': palette, 'ticks': ticks, 'title': 'Power', 'no_value': None}
    font_px = _colour_key_font_px(cs, look)
    w_px, h_px = _axes_px(ax)
    vertical = cs.get('orientation') != 'horizontal'
    thickness = cs.get('barThickness') or 10
    length = cs.get('barLength')
    if not _style_valid(length, 'number'):
        length = colour_key_auto_length(h_px if vertical else w_px,
                                        colour_key_title_run('Power', font_px, vertical))
    geom = colour_key_geometry(vertical, thickness, length, font_px, [lab for _, lab in ticks],
                               'Power', None)
    position = cs.get('position') or 'right'
    m = LEGEND_MARGIN
    gw, gh = geom['width'], geom['height']
    if position == 'right':
        limit = w_px + (padding.get('right') or 0) - gw
        x, y = max(0, min(w_px + m, limit)), 0
    elif position == 'custom':
        fx = min(1, max(0, cs.get('customX') or 0))
        fy = min(1, max(0, cs.get('customY') or 0))
        x = m + max(0, w_px - gw - 2 * m) * fx
        y = m + max(0, h_px - gh - 2 * m) * fy
    else:
        x = m if position in ('topleft', 'bottomleft') else w_px - gw - m
        y = h_px - gh - m if position in ('bottomleft', 'bottomright') else m
    at = {'x': x, 'y': y, 'length': length}
    cbar = _draw_colour_key(ax, key, {**cs, 'barLength': length}, look=look, at=at)
    ax._ancir_cwt['key'] = {'at': at, 'length': length, 'ticks': ticks}
    return cbar


def _format_scale_value(v):
    """ColourScale.svelte formatScaleValue: 3 significant figures, '0' for zero."""
    if not math.isfinite(v):
        return ''
    if v == 0:
        return '0'
    return _js_number_to_string(float(_js_to_precision_signed(v, 3)))


PLOT_TYPE_DISPATCH = {
    'scatterplot': 'scatter',
    'fft': 'fft',
    'periodogram': 'periodogram',
    'correlogram': 'correlogram',
    'boxplot': 'boxplot',
    'actogram': 'actogram',
    'cwt': 'cwt',
}


def _plot_padding(plot, columns_index=None):
    """The plot area's padding in px as the app lays the plot out: the saved `padding`; for
    the actogram its `paddingIN`, plus room for its row labels (rowLabelGutter) and light
    bands (twice their height on top)."""
    p = plot.get('plot', {}) or {}
    if plot.get('type') == 'cwt':
        pad = p.get('padding')
        return pad if isinstance(pad, dict) else {'top': 20, 'right': 70, 'bottom': 46,
                                                  'left': 62}
    if plot.get('type') != 'actogram':
        pad = p.get('padding')
        return pad if isinstance(pad, dict) else {'top': 15, 'right': 30, 'bottom': 30,
                                                  'left': 50}
    pad = dict(p.get('paddingIN') or {'top': 30, 'right': 20, 'bottom': 10, 'left': 20})
    bands = (p.get('lightBands') or {})
    if bands.get('bands'):
        # LightBandClass.height is not saved: the bar is always its default height.
        height = bands.get('height')
        pad['top'] = (pad.get('top') or 0) + 2 * (height if _style_valid(height, 'number')
                                                  else ACTOGRAM_LIGHT_BAND_HEIGHT)
    mode = _actogram_row_labels_mode(p)
    if mode in ('period', 'date') and columns_index is not None:
        _, rows = actogram_download_data(plot, columns_index, DISPLAY_TIMEZONE)
        n_rows = max((r[1] for r in rows), default=0)
        look = plot_look(plot)
        h = float(plot.get('height') or 440)
        fpx = actogram_row_label_px(look['px']['tick'], h - pad['top'] - pad['bottom'], n_rows,
                                    p.get('spaceBetween', 2))
        sample = (re.sub(r'[A-Za-z]', 'M', p.get('dateFormat') or 'DD MMM') if mode == 'date'
                  else str(max(1, n_rows)))
        pad['left'] = (pad.get('left') or 0) + math.ceil(len(sample) * fpx * 0.6) + 4
    return pad


# The plots whose padding the app measures from what it drew (viewBox.autoPadWhenDrawn).
AUTO_PADDED_PLOTS = {'scatterplot', 'periodogram', 'fft', 'correlogram', 'boxplot'}
# getAutoScaleValues: room past each axis's outer edge (more under the x axis).
_AUTO_PAD_EXTRA = {'left': 6, 'right': 6, 'top': 6, 'bottom': 12}


def _draw_plot_kind(kind, plot, columns_index, ax):
    if kind == 'scatter':
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
    elif kind == 'cwt':
        plot_cwt(plot, columns_index, ax)


def measured_padding(fig, ax, padding):
    """The app's automatic padding for what this figure drew (getAutoScaleValues): on each
    side that has an axis, the distance from its axis line to the outer edge of everything
    the axis drew (ticks, labels, title), rounded, plus 6 px (12 under the x axis); a side
    with no axis keeps its padding."""
    renderer = fig.canvas.get_renderer()
    out = dict(padding)
    sides = getattr(ax, '_ancir_axes', {}) or {}
    for side, owner in sides.items():
        axis = owner.xaxis if side in ('bottom', 'top') else owner.yaxis
        box = axis.get_tightbbox(renderer)
        frame = owner.get_window_extent(renderer)
        if box is None:
            continue
        k = _FIG_PX_PER_IN / fig.dpi
        width = {'left': frame.x0 - box.x0, 'right': box.x1 - frame.x1,
                 'bottom': frame.y0 - box.y0, 'top': box.y1 - frame.y1}[side] * k
        out[side] = float(_js_round(width + _AUTO_PAD_EXTRA[side]))
    return out


def render_plot_figure(plot, columns_index, *, auto_pad=True):
    """One plot as the exported PNG draws it: (fig, ax), or None for a plot type this
    runtime does not render. The figure is the plot's size with the export's title band
    above; the plot area is what the app's would be: for the plots that size their padding
    from their own axes (AUTO_PADDED_PLOTS), drawn, measured (measured_padding) and redrawn
    until the padding settles (at most four passes, as autoPadWhenDrawn), else the saved
    padding. `auto_pad=False` keeps the saved padding."""
    import copy as _copy
    import matplotlib.pyplot as plt
    kind = PLOT_TYPE_DISPATCH.get(plot.get('type', ''))
    if kind is None:
        return None
    look = plot_look(plot)
    band, _lines = export_title_band(plot, look)
    padding = dict(_plot_padding(plot, columns_index))
    passes = 4 if (auto_pad and plot.get('type') in AUTO_PADDED_PLOTS) else 1
    for i in range(passes):
        fig, ax, _g = new_plot_figure(plot, padding=padding, band=band)
        try:
            _draw_plot_kind(kind, _copy.deepcopy(plot), columns_index, ax)
        except Exception:
            plt.close(fig)
            raise
        if i == passes - 1:
            break
        fig.canvas.draw()
        nxt = measured_padding(fig, ax, padding)
        if all(abs(nxt[k] - padding[k]) < 0.5 for k in padding):
            break
        plt.close(fig)
        padding = nxt
    draw_export_title(fig, plot, look)
    return fig, ax


def save_plot_figure(fig, path, plot):
    """Save as the app's PNG export does: the figure's size at its export DPI, on its
    background (transparent unless the style sets a colour)."""
    look = plot_look(plot)
    bg = look['background']
    transparent = not isinstance(bg, str) or bg.strip() in ('', 'transparent', 'none')
    fig.savefig(path, dpi=look['dpi'], transparent=transparent,
                facecolor='none' if transparent else _mpl_colour(bg, 'white'))


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
        if PLOT_TYPE_DISPATCH.get(ptype) is None:
            print(f"[ancir-plot] skipped unsupported plot: {ptype} "
                  f"({plot.get('name')})")
            continue
        try:
            fig, _ax = render_plot_figure(plot, columns_index)
        except Exception as e:
            print(f"[ancir-plot] error rendering {plot.get('name')}: {e}")
            continue
        safe_name = ''.join(c if c.isalnum() or c in '-_' else '_'
                            for c in str(plot.get('name', f'plot_{plot.get("id", "?")}')))
        path = out / f"plot_{plot.get('id', '?')}_{safe_name}.png"
        save_plot_figure(fig, path, plot)
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

    Headers: ['DataSeries', 'Period (hours)', <statistic>]; the values column is
    named for the method's statistic as the y axis is by default (periodogram_y_label:
    'Normalised power', 'Chi-squared Qp', 'Enright amplitude (A_p)'). The JS adds
    ['Threshold', 'P-value'] only when a series uses the Chi-squared method, and a
    last 'Method' column when the series mix methods (the values header is then
    'Statistic (mixed methods)').
    Threshold and P-value are per fold, as in the app (the p-value is the
    chi-square upper tail, computed directly). Each series is computed with its
    own method and bin size (_periodogram_series_params).
    """
    p = plot.get('plot', {})
    series_list = p.get('data', [])
    methods = [s.get('method') or 'Lomb-Scargle' for s in series_list]
    mixed = len(set(methods)) > 1
    has_threshold = 'Chi-squared' in methods
    headers = ['DataSeries', 'Period (hours)', periodogram_y_label(methods)]
    if has_threshold:
        headers += ['Threshold', 'P-value']
    if mixed:
        headers.append('Method')
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
            if mixed:
                row.append(methods[d])
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
    user's chosen start (`startTimeIN`) when the plot carries one, else the earliest valid
    sample over ALL series, snapped to its midnight in the display `zone` (the session's
    appState.displayTimezone), exactly as the app draws it (actogram_plot_start_time)."""
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
    start = actogram_plot_start_time(p, [r[1] for r in resolved if r is not None], zone)
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


CWT_EXPORT_MAX_ROWS = 250000


def cwt_download_data(plot, columns_index):
    """CWT.svelte scalogramExport: the scalogram as a long table (time, period, power), one
    row per cell, periods outer; past CWT_EXPORT_MAX_ROWS cells the time axis is binned
    (power averaged, each row's time its bin's mean time) to the most time points that fit."""
    headers = ['time', 'period', 'power']
    tr = cwt_transform_of_plot(plot, columns_index)
    if not tr['valid']:
        return headers, []
    n_p, n_t = len(tr['periods']), len(tr['times'])
    max_cols = max(1, math.floor(CWT_EXPORT_MAX_ROWS / max(1, n_p)))
    times = np.asarray(tr['times'], dtype=np.float64)
    power = np.asarray(tr['power'], dtype=np.float64)
    if n_t > max_cols:
        times = downsample_columns([times], max_cols)[0]
        power = downsample_columns(power, max_cols)
    rows = []
    for j in range(n_p):
        for i in range(len(times)):
            rows.append([float(times[i]), tr['periods'][j], float(power[j][i])])
    return headers, rows


PLOT_DATA_BUILDERS = {
    'periodogram': periodogram_download_data,
    'fft': fft_download_data,
    'correlogram': correlogram_download_data,
    'actogram': actogram_download_data,
    'cwt': cwt_download_data,
}


def export_plot_data(plots, columns_index, output_dir, zone='utc'):
    """Write `<plot>_data.csv` for every calculating plot (periodogram, FFT,
    correlogram, actogram, wavelet scalogram). Each CSV mirrors the plot's in-app "Show/Save data"
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


# utils/normality.js SHAPIRO_MAX_N: Royston's p-value approximation is validated for
# 3 <= n <= 5000 (Royston 1995, Remark AS R94); scipy's own docs say "For N > 5000 the W test
# statistic is accurate, but the p-value may not be". Above it W is kept and p is NaN, as in
# the app and the R port.
SHAPIRO_MAX_N = 5000


def shapiro_wilk(values):
    """scipy.stats.shapiro reference for utils/normality.js shapiroWilk (Royston AS R94)."""
    x = _clean_numeric(values)
    n = len(x)
    nan = float("nan")
    if n < 3 or len(set(x)) < 2:
        return {"statistic": nan, "pvalue": nan, "n": n}
    with _warnings.catch_warnings():
        # scipy warns that the p-value may be inaccurate above 5000; that p is not reported.
        _warnings.simplefilter("ignore", UserWarning)
        res = sp_stats.shapiro(np.asarray(x, dtype=float))
    p = float(res.pvalue) if n <= SHAPIRO_MAX_N else nan
    return {"statistic": float(res.statistic), "pvalue": p, "n": n}


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


def _js_exp(v):
    """JS Math.exp: overflows to Infinity rather than raising."""
    try:
        return math.exp(v)
    except OverflowError:
        return math.inf


def _logit_solve_js(A, b):
    """logistic.js solve: Gauss-Jordan elimination with partial pivoting, None when a pivot is
    below 1e-12, in the same operation order as the app."""
    n = len(b)
    M = [list(row) + [b[i]] for i, row in enumerate(A)]
    for col in range(n):
        piv = col
        for r in range(col + 1, n):
            if abs(M[r][col]) > abs(M[piv][col]):
                piv = r
        if abs(M[piv][col]) < 1e-12:
            return None
        M[col], M[piv] = M[piv], M[col]
        for r in range(n):
            if r == col:
                continue
            f = M[r][col] / M[col][col]
            for c in range(col, n + 1):
                M[r][c] -= f * M[col][c]
    return [M[i][n] / M[i][i] for i in range(n)]


def _logit_inverse_js(A):
    n = len(A)
    inv = [[0.0] * n for _ in range(n)]
    for col in range(n):
        e = [0.0] * n
        e[col] = 1.0
        x = _logit_solve_js(A, e)
        if x is None:
            return None
        for row in range(n):
            inv[row][col] = x[row]
    return inv


def _logistic_irls_js(rows, ys, labels, kept, total, max_iter=50, tol=1e-8):
    """utils/logistic.js logisticRegression from the complete rows on, step for step: Newton
    (IRLS) with the weight floored at 1e-10, at most 50 iterations, the covariance from the
    information matrix at the last beta. Used where the reference fit (statsmodels) has no
    answer but the app still reports one: whenever this loop does not converge (an outcome
    left with ONE level after the incomplete rows are dropped, or perfect separation). The app does not refuse that case; its Newton steps walk the
    intercept out until the floored weight stops them (|coef| about 26, se about 1e5, p near
    1, CI 0 to Infinity), flags the fit as not converged, and writes it. Perfect separation
    is the same story with the slope walking out instead."""
    def sigmoid(x):
        return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))
    n, k = len(rows), len(labels)
    beta = [0.0] * k
    converged = False
    for _ in range(max_iter):
        XtWX = [[0.0] * k for _ in range(k)]
        grad = [0.0] * k
        for i in range(n):
            eta = 0.0
            for j in range(k):
                eta += rows[i][j] * beta[j]
            mu = sigmoid(eta)
            w = max(mu * (1 - mu), 1e-10)
            r = ys[i] - mu
            for a in range(k):
                grad[a] += rows[i][a] * r
                for b in range(k):
                    XtWX[a][b] += rows[i][a] * rows[i][b] * w
        step = _logit_solve_js(XtWX, grad)
        if step is None:
            break
        max_delta = 0.0
        for j in range(k):
            beta[j] += step[j]
            max_delta = max(max_delta, abs(step[j]))
        if max_delta < tol:
            converged = True
            break
    nan = float('nan')
    XtWX = [[0.0] * k for _ in range(k)]
    eta_arr, fit_arr, out_arr = [nan] * total, [nan] * total, [nan] * total
    log_lik = 0.0
    for i in range(n):
        eta = 0.0
        for j in range(k):
            eta += rows[i][j] * beta[j]
        mu = sigmoid(eta)
        w = max(mu * (1 - mu), 1e-10)
        log_lik += math.log(max(mu, 1e-300)) if ys[i] == 1 else math.log(max(1 - mu, 1e-300))
        for a in range(k):
            for b in range(k):
                XtWX[a][b] += rows[i][a] * rows[i][b] * w
        eta_arr[kept[i]] = eta
        fit_arr[kept[i]] = mu
        out_arr[kept[i]] = ys[i]
    cov = _logit_inverse_js(XtWX)
    se = [math.sqrt(cov[j][j]) if cov is not None and cov[j][j] >= 0 else nan
          for j in range(k)]
    z = [beta[j] / se[j] if (se[j] and not math.isnan(se[j])) else nan for j in range(k)]
    pv = [float(sp_stats.chi2.sf(v * v, 1)) if math.isfinite(v) else nan for v in z]
    ybar = sum(ys) / n
    null_ll = sum(math.log(max(ybar, 1e-300)) if yi == 1 else math.log(max(1 - ybar, 1e-300))
                  for yi in ys)
    lr = 2 * (log_lik - null_ll)
    p = k - 1
    return {
        "term": list(labels), "coef": list(beta), "se": se, "z": z, "pvalue": pv,
        "oddsRatio": [_js_exp(c) for c in beta], "n": n, "logLik": log_lik,
        "lrChiSq": lr,
        "lrPvalue": float(sp_stats.chi2.sf(lr, p)) if math.isfinite(lr) and lr >= 0 else nan,
        "pseudoR2": 1 - log_lik / null_ll if null_ll != 0 else nan,
        "converged": converged,
        "eta": eta_arr, "fitted": fit_arr, "outcome": out_arr,
    }


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
    # Where the app's own Newton loop does not converge (an outcome left with ONE level after
    # the drops, or perfect separation) it still writes what the loop reached, flagged as not
    # converged; statsmodels then has no answer or a different artefact, so that result is
    # mirrored step for step. A converged fit is checked against statsmodels as before.
    js_fit = _logistic_irls_js(rows, ys, labels, kept, total)
    if not js_fit['converged']:
        return js_fit
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
        # peak_pvalue: the chi-squared peak's family-wise p (SPEC-9); LS/Enright have none.
        return ['peak_period', 'peak_power'] + (
            ['peak_pvalue'] if args.get('pgMethod') == 'Chi-squared' else [])
    if an == 'summary':
        return ['mean', 'sd', 'percentile']
    if an == 'npcra':
        return ['IS', 'IV', 'RA', 'L5', 'M10', 'M10onset']
    if an == 'cosinor':
        if args.get('useFixedPeriod'):
            keys = ['mesor']
            for h in range(1, max(1, int(args.get('nHarmonics') or 1)) + 1):
                keys += [f'H{h}_amplitude', f'H{h}_acrophase']
            return keys + ['rel_amplitude', 'r2', 'rmse', 'rmse_n', 'pvalue']
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
        i = periodogram_peak_index(res)  # largest Qp - threshold for Chi-squared (SPEC-9)
        if i >= 0:
            st['peak_period'] = res['x'][i]
            st['peak_power'] = res['y'][i]
            if 'peak_pvalue' in st:
                st['peak_pvalue'] = peak_familywise_p(res, i)
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
            st['rmse_n'] = r['RMSE_n']
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


def actogram_plot_start_time(inner, series_list, zone='utc'):
    """The actogram's startTime as the app reads it: `startTimeIN ?? autoStartTime`
    (Actogram.svelte). startTimeIN is the user's chosen first-row start (epoch ms, saved on
    the plot since v82.23 and only when chosen); fromJSON keeps it only when it is a finite
    number. Otherwise the automatic start, actogram_start_time."""
    chosen = (inner or {}).get('startTimeIN')
    if isinstance(chosen, (int, float)) and not isinstance(chosen, bool) \
            and math.isfinite(chosen):
        return float(chosen)
    return actogram_start_time(series_list, zone)


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
    start = actogram_plot_start_time(inner, series_data, zone)
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
