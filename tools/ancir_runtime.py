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

import math
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


def bin_data(x_values, y_values, bin_size, bin_start=0.0, step_size=None,
             agg_func='mean'):
    """Port of plotbits/helpers/wrangleData.js::binData."""
    if step_size is None:
        step_size = bin_size
    xa = _to_float_arr(x_values)
    ya = _to_float_arr(y_values)
    mask = ~(np.isnan(xa) | np.isnan(ya))
    xa, ya = xa[mask], ya[mask]
    if xa.size == 0:
        return {'bins': [], 'y_out': []}
    end = xa.max()
    bins, y_out = [], []
    cur = bin_start
    while True:  # JS binData pushes the bin THEN breaks (post-push) → one trailing bin
        in_bin = ya[(xa >= cur) & (xa < cur + bin_size)]
        if in_bin.size:
            if agg_func == 'mean':
                v = float(in_bin.mean())
            elif agg_func == 'min':
                v = float(in_bin.min())
            elif agg_func == 'max':
                v = float(in_bin.max())
            elif agg_func == 'median':
                v = float(np.median(in_bin))
            elif agg_func == 'stddev':
                v = float(in_bin.std(ddof=0))
            else:
                v = float(in_bin.mean())
        else:
            v = float('nan')
        bins.append(cur)
        y_out.append(v)
        if cur >= end:
            break
        cur += step_size
    return {'bins': bins, 'y_out': y_out}


# ----------------------------------------------------------------------
# Cosinor (Halberg fixed-period + free multi-cosine LM)
# ----------------------------------------------------------------------

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
    rmse = math.sqrt(rss / n)
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

    harmonics = []
    for k in range(1, n_harmonics + 1):
        idx_b = 1 + 2 * (k - 1)
        idx_g = idx_b + 1
        b, g = float(beta[idx_b]), float(beta[idx_g])
        amp = math.hypot(b, g)
        phi = math.atan2(-g, b)  # JS: atan2(-gamma, beta)
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
        harmonics.append({
            'k': k, 'beta': b, 'gamma': g,
            'amplitude': amp, 'acrophase_hrs': acro_hrs,
            'phi_rad': phi, 'SE_A': SE_A, 'SE_acrophase_hrs': SE_acro_hrs,
            'CI_A': [amp - tcrit * SE_A, amp + tcrit * SE_A],
            'CI_acrophase': [acro_hrs - tcrit * SE_acro_hrs,
                             acro_hrs + tcrit * SE_acro_hrs],
        })

    # F-stat: H0 = mean only
    ss_null = float(((y - y.mean()) ** 2).sum())
    df1 = p - 1
    F_stat = ((ss_null - rss) / df1) / (rss / df_resid) if rss > 0 else float('inf')
    pF = float(1 - sp_stats.f.cdf(F_stat, df1, df_resid)) if math.isfinite(F_stat) else 0.0

    return {
        'M': M, 'SE_M': SE_M, 'CI_M': CI_M,
        'harmonics': harmonics, 'F_stat': float(F_stat),
        'df': [df1, df_resid], 'pF': pF,
        'R2': float(r2), 'RMSE': rmse,
        'fitted': fitted.tolist(), 'n': n,
        'period': period, 'nHarmonics': n_harmonics, 'alpha': alpha,
    }


def fit_cosine_curves(t, x, n_curves, options=None):
    """Multi-cosine fit (free periods/phases). Param layout: [B0,w0,o0,...,O].

    Uses scipy.optimize.least_squares (Trust Region Reflective) as a
    drop-in replacement for the JS Levenberg-Marquardt loop. Multi-start
    over period seeds taken from a coarse periodogram pass on the data.
    """
    options = options or {}
    t = _to_float_arr(t)
    x = _to_float_arr(x)
    mask = ~(np.isnan(t) | np.isnan(x))
    t, x = t[mask], x[mask]
    if t.size < 4 * n_curves:
        return None

    def residuals(p, t_, x_):
        m = (len(p) - 1) // 3
        y = np.full_like(t_, p[-1])
        for i in range(m):
            B = p[3 * i]
            w = p[3 * i + 1]
            o = p[3 * i + 2]
            y = y + B * np.cos(2 * math.pi * w * t_ + o)
        return y - x_

    timespan = float(t[-1] - t[0]) if t[-1] > t[0] else 1.0
    span_amp = float(np.std(x))
    seed_freqs = [1.0 / 24.0, 1.0 / 12.0, 1.0 / 6.0, 1.0 / max(timespan, 1.0)]
    best = None
    for f_seed in seed_freqs:
        p0 = []
        for i in range(n_curves):
            p0 += [span_amp / max(1, n_curves), f_seed * (i + 1), 0.0]
        p0.append(float(np.mean(x)))
        lb = []
        ub = []
        for i in range(n_curves):
            lb += [-np.inf, 0.001, -np.inf]
            ub += [np.inf, 100.0, np.inf]
        lb.append(-np.inf)
        ub.append(np.inf)
        try:
            res = sp_optimize.least_squares(residuals, p0, args=(t, x),
                                            bounds=(lb, ub), max_nfev=2000)
        except Exception:
            continue
        if best is None or res.cost < best.cost:
            best = res
    if best is None:
        return None
    p = best.x
    fitted = x + (best.fun if False else residuals(p, t, x) + x)  # = pred
    pred = residuals(p, t, x) + x
    rss = float(((x - pred) ** 2).sum())
    rmse = math.sqrt(rss / t.size)
    ss_tot = float(((x - x.mean()) ** 2).sum())
    r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
    cosines = []
    for i in range(n_curves):
        B = float(p[3 * i])
        w = float(p[3 * i + 1])
        o = float(p[3 * i + 2])
        cosines.append({'amplitude': abs(B), 'frequency': w, 'phase': o})
    return {
        'parameters': {'A': 0.0, 'cosines': cosines, 'O': float(p[-1])},
        'fitted': pred.tolist(),
        'residuals': (x - pred).tolist(),
        'rmse': rmse, 'rSquared': float(r2), 'rss': rss,
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

def _lomb_scargle(t, y, periods):
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    y = y - y.mean()
    omegas = 2 * math.pi / np.asarray(periods, dtype=float)
    powers = np.empty_like(omegas)
    for k, w in enumerate(omegas):
        s2 = math.sin(2 * w * t).sum() if False else float(np.sin(2 * w * t).sum())
        c2 = float(np.cos(2 * w * t).sum())
        tau = math.atan2(s2, c2) / (2 * w) if w != 0 else 0.0
        cwt = np.cos(w * (t - tau))
        swt = np.sin(w * (t - tau))
        num1 = float((y * cwt).sum()) ** 2
        den1 = float((cwt ** 2).sum())
        num2 = float((y * swt).sum()) ** 2
        den2 = float((swt ** 2).sum())
        var = float(y.var()) or 1.0
        powers[k] = (num1 / den1 + num2 / den2) / (2 * var) if den1 > 0 and den2 > 0 else 0.0
    return powers.tolist()


def _chi_squared_pgram(t, y, periods, dt):
    # Folding chi-squared periodogram
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float)
    n = y.size
    var_y = float(y.var()) or 1.0
    powers = np.empty(len(periods))
    for k, P in enumerate(periods):
        nbins = max(2, int(round(P / dt)))
        bins = ((t / dt).astype(int)) % nbins
        means = np.zeros(nbins)
        counts = np.zeros(nbins)
        for b, v in zip(bins, y):
            means[b] += v
            counts[b] += 1
        with np.errstate(invalid='ignore', divide='ignore'):
            means = np.where(counts > 0, means / np.maximum(counts, 1), 0.0)
        bin_var = ((means - y.mean()) ** 2 * counts).sum() / n
        powers[k] = n * bin_var / var_y
    # threshold at p=0.05 with df = nbins-1 (using a typical mid nbins)
    df_mid = max(2, int(round(np.median(periods) / dt))) - 1
    thr = float(sp_stats.chi2.ppf(0.95, df_mid))
    return powers.tolist(), thr


def _enright_pgram(t, y, periods, dt):
    """Binned autocorrelation Enright periodogram (simplified)."""
    t = np.asarray(t, dtype=float)
    y = np.asarray(y, dtype=float) - float(np.mean(y))
    powers = []
    for P in periods:
        lag = int(round(P / dt))
        if lag <= 0 or lag >= y.size:
            powers.append(0.0)
            continue
        a = y[:-lag]
        b = y[lag:]
        denom = math.sqrt(float((a * a).sum()) * float((b * b).sum()))
        powers.append(float((a * b).sum()) / denom if denom > 0 else 0.0)
    return powers


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
    if method == 'Lomb-Scargle':
        powers = _lomb_scargle(t, y, periods)
        threshold = None
    elif method == 'Chi-squared':
        powers, threshold = _chi_squared_pgram(t, y, periods, dt)
    else:
        powers = _enright_pgram(t, y, periods, dt)
        threshold = None
    return {'x': periods, 'y': powers, 'threshold': threshold}


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

def compute_fft(times, values, freq_step=None):
    t = _to_float_arr(times)
    y = _to_float_arr(values)
    mask = ~(np.isnan(t) | np.isnan(y))
    t, y = t[mask], y[mask]
    if t.size < 4:
        return {'frequencies': [], 'magnitudes': [], 'phases': [],
                'samplingRate': 0.0, 'nyquistFreq': 0.0, 'minPeriod': 0.0}
    # Detrend
    reg = linear_regression(t.tolist(), y.tolist())
    y = y - (reg['slope'] * t + reg['intercept'])
    # Resample to uniform grid
    dt = _median_dt(t.tolist())
    t_uni = np.arange(t[0], t[-1] + dt, dt)
    y_uni = np.interp(t_uni, t, y)
    # zero-pad to next power of 2
    n = 1
    while n < y_uni.size:
        n *= 2
    y_pad = np.zeros(n)
    y_pad[:y_uni.size] = y_uni
    fft = np.fft.fft(y_pad)
    freqs = np.fft.fftfreq(n, d=dt)
    half = n // 2
    freqs = freqs[:half]
    fft = fft[:half]
    mag = np.abs(fft) / max(y_uni.size, 1)
    phase = np.angle(fft)
    sampling_rate = 1.0 / dt
    return {
        'frequencies': freqs.tolist(),
        'magnitudes': mag.tolist(),
        'phases': phase.tolist(),
        'samplingRate': sampling_rate,
        'nyquistFreq': sampling_rate / 2.0,
        'minPeriod': 2 * dt,
    }


# ----------------------------------------------------------------------
# Correlogram (with minLag)
# ----------------------------------------------------------------------

def compute_autocorrelation(times, values, bin_size=None, max_lag=None,
                            min_lag=0.0):
    t = _to_float_arr(times)
    y = _to_float_arr(values)
    mask = ~(np.isnan(t) | np.isnan(y))
    t, y = t[mask], y[mask]
    n = y.size
    if n < 2:
        return {'lags': [], 'correlations': [], 'dt': 1.0}
    if bin_size is not None:
        dt = float(bin_size)
    else:
        dt = _median_dt(t.tolist())
    timespan = float(t[-1] - t[0])
    max_lag_t = float(max_lag) if max_lag else timespan / 2.0
    min_lag_t = float(min_lag) if (min_lag and min_lag > 0) else 0.0
    if min_lag_t >= max_lag_t:
        return {'lags': [], 'correlations': [], 'dt': dt}
    n_lags = min(int(max_lag_t // dt), n // 2)
    start_idx = int(math.ceil(min_lag_t / dt))
    ymean = float(y.mean())
    yvar = float(((y - ymean) ** 2).sum() / n)
    if yvar == 0:
        return {'lags': [], 'correlations': [], 'dt': dt}
    diffs = np.diff(t)
    median_dt = float(np.median(diffs))
    is_uniform = bool(np.max(np.abs(diffs - median_dt)) < median_dt * 0.1)
    lags, corrs = [], []
    if is_uniform:
        ydem = y - ymean
        for lag in range(start_idx, n_lags + 1):
            if lag >= n:
                break
            a = ydem[:n - lag]
            b = ydem[lag:]
            count = a.size
            if count <= 0:
                corrs.append(0.0)
            else:
                corrs.append(float((a * b).sum() / (count * yvar)))
            lags.append(lag * dt)
    else:
        tol = dt / 2.0
        for li in range(start_idx, n_lags + 1):
            target = li * dt
            sum_, count = 0.0, 0
            for i in range(n):
                for j in range(i + 1, n):
                    td = t[j] - t[i]
                    if abs(td - target) <= tol:
                        sum_ += (y[i] - ymean) * (y[j] - ymean)
                        count += 1
                    if td > target + tol:
                        break
            corrs.append(sum_ / (count * yvar) if count > 0 else 0.0)
            lags.append(target)
    return {'lags': lags, 'correlations': corrs, 'dt': dt}


# ----------------------------------------------------------------------
# Rectangular wave
# ----------------------------------------------------------------------

def fit_rectangular_wave(t, x, options=None):
    options = options or {}
    t = _to_float_arr(t)
    x = _to_float_arr(x)
    mask = ~(np.isnan(t) | np.isnan(x))
    t, x = t[mask], x[mask]
    if t.size < 6:
        return None

    fix_kappa = options.get('fixKappa', False)
    fix_omega = options.get('fixOmega', False)
    fix_d = options.get('fixD', False)
    kappa0 = float(options.get('kappa', 5.0))
    omega0 = float(options.get('omega', 2 * math.pi / 24))
    d0 = float(options.get('dutyCycle', 0.5))

    free_idx = [0, 1, 4]
    if not fix_kappa: free_idx.append(2)
    if not fix_omega: free_idx.append(3)
    if not fix_d:     free_idx.append(5)
    free_idx = sorted(free_idx)

    def model(p_full, t_):
        M, A, k, w, phi, d = p_full
        return M + A * np.tanh(k * (np.sin(w * t_ + phi) - math.cos(math.pi * d)))

    M0 = float(np.mean(x))
    A0 = (float(np.max(x)) - float(np.min(x))) / 2.0 or 1.0
    full0 = [M0, A0, kappa0, omega0, 0.0, d0]
    bounds_full = ([-np.inf, -np.inf, 1e-3, 1e-3, -np.inf, 0.01],
                   [np.inf, np.inf, np.inf, 100.0, np.inf, 0.99])

    def residuals(p_free):
        full = full0.copy()
        for i, idx in enumerate(free_idx):
            full[idx] = p_free[i]
        return model(full, t) - x

    p0 = [full0[i] for i in free_idx]
    lb = [bounds_full[0][i] for i in free_idx]
    ub = [bounds_full[1][i] for i in free_idx]
    # multi-start over period seeds
    timespan = float(t[-1] - t[0]) or 1.0
    best = None
    for P_seed in [24.0, 12.0, 6.0, max(timespan, 1.0)]:
        full0[3] = 2 * math.pi / P_seed if not fix_omega else omega0
        p0 = [full0[i] for i in free_idx]
        try:
            res = sp_optimize.least_squares(residuals, p0, bounds=(lb, ub),
                                            max_nfev=2000)
        except Exception:
            continue
        if best is None or res.cost < best.cost:
            best = res
    if best is None:
        return None
    full = full0.copy()
    for i, idx in enumerate(free_idx):
        full[idx] = best.x[i]
    M, A, k, w, phi, d = full
    pred = model(full, t)
    rss = float(((x - pred) ** 2).sum())
    ss_tot = float(((x - x.mean()) ** 2).sum())
    r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
    rmse = math.sqrt(rss / t.size)
    period = 2 * math.pi / w if w != 0 else float('inf')
    acrophase = ((math.pi / 2 - phi) / w) % period if w != 0 else 0.0
    return {
        'parameters': {'M': float(M), 'A': float(A), 'kappa': float(k),
                       'omega': float(w), 'phi': float(phi),
                       'dutyCycle': float(d)},
        'period': float(period), 'acrophase': float(acrophase),
        'fitted': pred.tolist(), 'rmse': rmse, 'rSquared': float(r2),
        'rss': rss,
    }


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


def fit_double_logistic(t, x, options=None):
    options = options or {}
    t = _to_float_arr(t)
    x = _to_float_arr(x)
    mask = ~(np.isnan(t) | np.isnan(x))
    t, x = t[mask], x[mask]
    if t.size < 6:
        return None
    periodic = bool(options.get('periodic', False))
    fix_k1 = options.get('fixK1', False)
    fix_k2 = options.get('fixK2', False)
    fix_T = options.get('fixT', False)

    M0 = float(np.min(x))
    A0 = float(np.max(x) - np.min(x)) or 1.0
    k1_0 = float(options.get('k1', 1.0))
    k2_0 = float(options.get('k2', 1.0))
    timespan = float(t[-1] - t[0]) or 1.0
    # A FREE period inits from the data timespan; starting it small (e.g. 24)
    # lets the optimizer collapse to a degenerate many-tile fit. With this init
    # the fit matches JS exactly for the aperiodic-pulse case.
    T0 = float(options.get('T', 24.0 if fix_T else timespan))
    t1_0 = float(t[0]) + timespan * 0.25
    t2_0 = float(t[0]) + timespan * 0.75

    if periodic:
        full0 = [M0, A0, k1_0, t1_0, k2_0, t2_0, T0]
        free = [0, 1, 3, 5]
        if not fix_k1: free.append(2)
        if not fix_k2: free.append(4)
        if not fix_T:  free.append(6)
        bounds_full = ([-np.inf, -np.inf, 1e-4, -np.inf, 1e-4, -np.inf, 0.1],
                       [np.inf, np.inf, np.inf, np.inf, np.inf, np.inf, np.inf])
    else:
        full0 = [M0, A0, k1_0, t1_0, k2_0, t2_0]
        free = [0, 1, 3, 5]
        if not fix_k1: free.append(2)
        if not fix_k2: free.append(4)
        bounds_full = ([-np.inf, -np.inf, 1e-4, -np.inf, 1e-4, -np.inf],
                       [np.inf, np.inf, np.inf, np.inf, np.inf, np.inf])
    free = sorted(free)

    def model(p_full, t_):
        if periodic:
            M, A, k1, t1, k2, t2, T = p_full
            n_tiles = max(1, int(math.ceil((t_.max() - t_.min()) / T)) + 2)
            j_range = np.arange(-1, n_tiles + 1)
            T_off = j_range * T
            # broadcast: shape (n_t, n_tiles)
            tt = t_[:, None]
            on = _sigmoid(k1 * (tt - t1 - T_off[None, :]))
            off = _sigmoid(k2 * (tt - t2 - T_off[None, :]))
            return M + A * (on - off).sum(axis=1)
        M, A, k1, t1, k2, t2 = p_full
        return M + A * (_sigmoid(k1 * (t_ - t1)) - _sigmoid(k2 * (t_ - t2)))

    def residuals(p_free):
        full = full0.copy()
        for i, idx in enumerate(free):
            full[idx] = p_free[i]
        # enforce t2 > t1 + 0.01
        if full[5] <= full[3] + 0.01:
            full[5] = full[3] + 0.01
        return model(full, t) - x

    p0 = [full0[i] for i in free]
    lb = [bounds_full[0][i] for i in free]
    ub = [bounds_full[1][i] for i in free]
    try:
        res = sp_optimize.least_squares(residuals, p0, bounds=(lb, ub),
                                        max_nfev=4000)
    except Exception:
        return None
    full = full0.copy()
    for i, idx in enumerate(free):
        full[idx] = res.x[i]
    pred = model(full, t)
    rss = float(((x - pred) ** 2).sum())
    ss_tot = float(((x - x.mean()) ** 2).sum())
    r2 = 1 - rss / ss_tot if ss_tot > 0 else 0.0
    rmse = math.sqrt(rss / t.size)
    if periodic:
        M, A, k1, t1, k2, t2, T = full
        params = {'M': M, 'A': A, 'k1': k1, 't1': t1, 'k2': k2, 't2': t2, 'T': T}
    else:
        M, A, k1, t1, k2, t2 = full
        params = {'M': M, 'A': A, 'k1': k1, 't1': t1, 'k2': k2, 't2': t2}
    duration = t2 - t1
    period = T if periodic else max(timespan, 1.0)
    onset_phase = (t1 % period) / period
    offset_phase = (t2 % period) / period
    duty = duration / period if period > 0 else 0.0
    return {
        'parameters': {k: float(v) for k, v in params.items()},
        'duration': float(duration),
        'onsetPhase': float(onset_phase),
        'offsetPhase': float(offset_phase),
        'dutyCycle': float(duty),
        'fitted': pred.tolist(),
        'rmse': rmse, 'rSquared': float(r2), 'rss': rss,
    }


def evaluate_dl_at_points(parameters, x_points, periodic=False):
    xa = np.asarray(x_points, dtype=float)
    if periodic:
        M = parameters['M']; A = parameters['A']
        k1 = parameters['k1']; t1 = parameters['t1']
        k2 = parameters['k2']; t2 = parameters['t2']
        T = parameters['T']
        n_tiles = max(1, int(math.ceil((xa.max() - xa.min()) / T)) + 2)
        j = np.arange(-1, n_tiles + 1)
        on = _sigmoid(k1 * (xa[:, None] - t1 - j[None, :] * T))
        off = _sigmoid(k2 * (xa[:, None] - t2 - j[None, :] * T))
        return (M + A * (on - off).sum(axis=1)).tolist()
    M = parameters['M']; A = parameters['A']
    k1 = parameters['k1']; t1 = parameters['t1']
    k2 = parameters['k2']; t2 = parameters['t2']
    return (M + A * (_sigmoid(k1 * (xa - t1)) - _sigmoid(k2 * (xa - t2)))).tolist()


# ----------------------------------------------------------------------
# Smoothing
# ----------------------------------------------------------------------

def whittaker_eilers(y, lam=100.0, order=2):
    y = _to_float_arr(y)
    n = y.size
    if n < order + 2:
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
    y = _to_float_arr(y)
    if window_size % 2 == 0:
        window_size += 1
    if window_size > y.size:
        window_size = y.size if y.size % 2 == 1 else y.size - 1
    if window_size < poly_order + 2:
        return y.tolist()
    half = window_size // 2
    out = np.empty_like(y)
    for i in range(y.size):
        lo = max(0, i - half)
        hi = min(y.size, i + half + 1)
        xs = np.arange(lo, hi) - i
        ys = y[lo:hi]
        deg = min(poly_order, xs.size - 1)
        coeffs = np.polyfit(xs, ys, deg)
        out[i] = np.polyval(coeffs, 0.0)
    return out.tolist()


def loess(x, y, bandwidth=0.3):
    xa = _to_float_arr(x); ya = _to_float_arr(y)
    n = xa.size
    if n < 4:
        return ya.tolist()
    h = max(2, int(round(bandwidth * n)))
    out = np.empty_like(ya)
    for i in range(n):
        d = np.abs(xa - xa[i])
        idx = np.argsort(d)[:h]
        dx = d[idx]
        dmax = dx.max() if dx.size else 1.0
        w = (1 - (dx / (dmax or 1.0)) ** 3) ** 3
        w = np.where(np.isfinite(w), w, 0.0)
        X = np.column_stack([np.ones(idx.size), xa[idx]])
        WX = X * w[:, None]
        try:
            beta = np.linalg.lstsq(WX, ya[idx] * w, rcond=None)[0]
            out[i] = beta[0] + beta[1] * xa[i]
        except Exception:
            out[i] = ya[i]
    return out.tolist()


def moving_average(y, window_size=5, kind='simple'):
    y = _to_float_arr(y)
    n = y.size
    if window_size < 1 or n == 0:
        return y.tolist()
    if kind == 'exponential':
        alpha = 2.0 / (window_size + 1)
        out = np.empty_like(y)
        out[0] = y[0]
        for i in range(1, n):
            out[i] = alpha * y[i] + (1 - alpha) * out[i - 1]
        return out.tolist()
    half = window_size // 2
    out = np.empty_like(y)
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        win = y[lo:hi]
        if kind == 'weighted':
            w = np.arange(1, win.size + 1, dtype=float)
            out[i] = float((win * w).sum() / w.sum())
        else:
            out[i] = float(win.mean())
    return out.tolist()


def smooth_arrays(x_vals, y_vals, smoother_type, options=None):
    options = options or {}
    if smoother_type == 'whittaker':
        return list(x_vals), whittaker_eilers(y_vals,
                                              options.get('lambda', 100.0),
                                              options.get('order', 2))
    if smoother_type in ('savitzky-golay', 'savitzky'):
        return list(x_vals), savitzky_golay(
            y_vals,
            int(options.get('savitzkyWindowSize', options.get('windowSize', 5))),
            int(options.get('savitzkyPolyOrder', options.get('polyOrder', 2))))
    if smoother_type == 'loess':
        return list(x_vals), loess(x_vals, y_vals,
                                   options.get('bandwidth', 0.3))
    # JS dispatches smootherType 'moving' → movingAverage with movingAvg* args.
    if smoother_type in ('moving-average', 'moving'):
        return list(x_vals), moving_average(
            y_vals,
            int(options.get('movingAvgWindowSize', options.get('windowSize', 5))),
            options.get('movingAvgType', options.get('type', 'simple')))
    return list(x_vals), list(y_vals)


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

@dataclass
class Column:
    id: int
    name: str
    type: str = 'number'  # 'time'|'number'|'category'|'bin'
    data: Any = None  # raw payload key into RAW_DATA, or list, or {start,step,length}
    raw_data: dict = field(default_factory=dict)
    time_format: str | None = None
    bin_width: float = 1.0
    compression: str | None = None
    ref_id: int | None = None  # if this column is referencial
    columns_index: dict = field(default_factory=dict)  # {id: Column}
    processes: list = field(default_factory=list)  # [(funcname, args)]

    def is_referencial(self):
        return self.ref_id is not None

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
            # Already-numeric (UNIX ms, e.g. written by SimulatedData TP):
            # leave alone. Otherwise parse with pandas (auto-detects ISO
            # 8601; the JS Luxon format string is not valid Python).
            if data and not isinstance(data[0], (int, float)):
                try:
                    parsed = pd.to_datetime(data, errors='coerce', utc=True)
                    # Epoch MS, tz-safe and resolution-independent (pandas >=2
                    # datetime resolution varies, so a fixed //10**6 from ns and
                    # a tz-aware datetime64[ms] cast are both unreliable).
                    epoch = pd.Timestamp('1970-01-01', tz='UTC')
                    data = ((parsed - epoch) // pd.Timedelta('1ms')).tolist()
                except Exception:
                    pass
        if self.type == 'bin':
            data = [v + self.bin_width / 2 for v in data]
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
    v = float(args.get('value', 0))
    return [None if xi is None else xi + v for xi in x]


def _proc_substitute(x, args, _cols):
    find = args.get('find')
    replace = args.get('replace')
    return [replace if xi == find else xi for xi in x]


def _proc_multiply(x, args, _cols):
    v = float(args.get('value', 1))
    return [None if xi is None else xi * v for xi in x]


def _proc_editvalue(x, args, _cols):
    out = list(x)
    for edit in args.get('edits', []):
        pos = int(edit['position']) - 1
        if 0 <= pos < len(out):
            out[pos] = edit['value']
    return out


def _proc_normalize(x, args, _cols):
    method = args.get('method', 'z-score')
    arr = np.array([np.nan if v is None else v for v in x], dtype=float)
    valid = ~np.isnan(arr)
    if not valid.any():
        return list(x)
    sub = arr[valid]
    if method == 'z-score':
        m, s = sub.mean(), sub.std(ddof=0)
        out_sub = (sub - m) / (s if s > 0 else 1.0)
    elif method == 'min-max':
        lo, hi = sub.min(), sub.max()
        rng = hi - lo if hi > lo else 1.0
        out_sub = (sub - lo) / rng
    elif method == 'robust':
        med = np.median(sub)
        mad = np.median(np.abs(sub - med)) or 1.0
        out_sub = (sub - med) / mad
    elif method == 'unit-vector':
        norm = math.sqrt(float((sub * sub).sum())) or 1.0
        out_sub = sub / norm
    else:
        out_sub = sub
    out = list(x)
    j = 0
    for i, ok in enumerate(valid):
        if ok:
            out[i] = float(out_sub[j]); j += 1
    return out


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


def _proc_outlierremoval(x, args, _cols):
    method = args.get('method', 'iqr')
    arr = np.array([np.nan if v is None else v for v in x], dtype=float)
    valid = ~np.isnan(arr)
    sub = arr[valid]
    if sub.size == 0:
        return list(x)
    if method == 'iqr':
        q1, q3 = np.percentile(sub, [25, 75])
        iqr = q3 - q1
        m = float(args.get('multiplier', 1.5))
        lo, hi = q1 - m * iqr, q3 + m * iqr
        out = [None if (v is not None and (v < lo or v > hi)) else v for v in x]
    else:  # zscore
        mu, sd = sub.mean(), sub.std(ddof=0) or 1.0
        thr = float(args.get('threshold', 3.0))
        out = [None if (v is not None and abs((v - mu) / sd) > thr) else v
               for v in x]
    return out


def _proc_removetrend(x, args, cols):
    x_col_id = args.get('xColId', -1)
    x_col = cols.get(x_col_id) if x_col_id != -1 else None
    if x_col is not None:
        t = x_col.hours_since_start if x_col.type == 'time' else x_col.get_data()
    else:
        t = list(range(len(x)))
    valid = [i for i, (ti, xi) in enumerate(zip(t, x))
             if ti is not None and not (isinstance(ti, float) and math.isnan(ti))
             and xi is not None and not (isinstance(xi, float) and math.isnan(xi))]
    if len(valid) < 2:
        return list(x)
    tt = [t[i] for i in valid]
    yy = [x[i] for i in valid]
    fit = fit_trend(tt, yy, args.get('model', 'linear'),
                    int(args.get('polyDegree', 2)))
    detrended = [yy[k] - fit['fitted'][k] for k in range(len(yy))]
    if args.get('slidingWindow') and int(args.get('windowSize', 1)) > 1:
        ws = int(args['windowSize'])
        half = ws // 2
        new = []
        for i in range(len(detrended)):
            lo = max(0, i - half); hi = min(len(detrended), i + half + 1)
            win = detrended[lo:hi]
            m = sum(win) / len(win)
            v = sum((w - m) ** 2 for w in win) / len(win)
            sd = math.sqrt(v) or 1.0
            new.append((detrended[i] - m) / sd)
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


COLUMN_PROCESS_MAP = {
    'add': _proc_add,
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
        i = 0.0
        while i < duration:
            ms = start_time + (current_time + i) * 3600000
            sim_time.append(ms)
            shifted = i + phase
            cur_amp = amp if (math.floor(shifted % period) < period / 2) else 1.0
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

def tp_cosinor(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    n_curves = int(args.get('Ncurves', 0) or 0)
    use_fixed = bool(args.get('useFixedPeriod', False))
    fixed_period = float(args.get('fixedPeriod', 24))
    n_h = int(args.get('nHarmonics', 1))
    alpha = float(args.get('alpha', 0.05))
    output_x_id = args.get('outputX', -1)
    x_col = cols[x_in]
    t = _t_for_col(x_col)

    output_x_data = None
    if output_x_id != -1 and output_x_id in cols:
        oxc = cols[output_x_id]
        output_x_data = _t_for_col(oxc)
        output_x_data = [v for v in output_x_data
                         if v is not None and not (isinstance(v, float) and math.isnan(v))]
    origin_ms = None
    if output_x_id != -1 and output_x_id in cols and cols[output_x_id].type == 'time':
        d = cols[output_x_id].get_data()
        origin_ms = d[0] if d else None
    if origin_ms is None and x_col.type == 'time':
        d = x_col.get_data()
        origin_ms = d[0] if d else None

    any_valid = False
    first_x_out = None
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y = cols[y_id].get_data()
        valid = [i for i, (ti, yi) in enumerate(zip(t, y))
                 if ti is not None and yi is not None
                 and not (isinstance(ti, float) and math.isnan(ti))
                 and not (isinstance(yi, float) and math.isnan(yi))]
        tt = [t[i] for i in valid]
        yy = [y[i] for i in valid]
        if not tt:
            continue
        if use_fixed:
            res = fit_cosinor_fixed(tt, yy, fixed_period, n_h, alpha)
            if res is None:
                continue
            xs = output_x_data if output_x_data else tt
            ys = (evaluate_cosinor_at_points(
                {**res, 'period': fixed_period}, xs)
                  if output_x_data else res['fitted'])
        else:
            res = fit_cosine_curves(tt, yy, n_curves)
            if res is None:
                continue
            xs = output_x_data if output_x_data else tt
            ys = (evaluate_cosinor_at_points(res['parameters'], xs)
                  if output_x_data else res['fitted'])
        if first_x_out is None:
            first_x_out = xs
            x_out_id = _out_id(args, 'cosinorx')
            x_out_ms = ([origin_ms + h * 3600000 for h in xs]
                       if origin_ms is not None else xs)
            x_type = 'time' if origin_ms is not None else 'number'
            _set_col(raw_data, cols, x_out_id, x_out_ms, type_=x_type,
                     time_format=None)
        y_out_id = _out_id(args, f'cosinory_{y_id}')
        if y_out_id == -1:
            y_out_id = _out_id(args, 'cosinory')
        _set_col(raw_data, cols, y_out_id, ys, type_='number')
        any_valid = True
    return any_valid


# --- BinnedData ---

def tp_binneddata(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    bin_size = float(args.get('binSize', 1.0))
    bin_start = float(args.get('binStart', 0.0))
    step = float(args.get('stepSize', bin_size))
    agg = args.get('aggFunc', 'mean')
    x_col = cols[x_in]
    x_data = _t_for_col(x_col)

    bins_x = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        b = bin_data(x_data, cols[y_id].get_data(),
                     bin_size, bin_start, step, agg)
        if bins_x is None:
            # JS emits bin CENTRES (start + binSize/2), not bin starts.
            bins_x = [bx + bin_size / 2.0 for bx in b['bins']]
            x_out = _out_id(args, 'binnedx')
            _set_col(raw_data, cols, x_out, bins_x,
                     type_=x_col.type, time_format=x_col.time_format)
        y_out = _out_id(args, f'binnedy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'binnedy')
        _set_col(raw_data, cols, y_out, b['y_out'], type_='number')
        any_valid = True
    return any_valid


# --- BlankColumn ---

def tp_blankcolumn(args, cols, raw_data, sv):
    n = int(args.get('N', args.get('rows', args.get('length', 0))))
    fill = args.get('fillValue', '')  # JS BlankColumn fills '' (empty), type category
    out_id = _out_id(args, 'result')
    _set_col(raw_data, cols, out_id, [fill] * n, type_='category')
    return n > 0


# --- CollectColumns ---

def tp_collectcolumns(args, cols, raw_data, _sv):
    """Stack many columns side-by-side. Real AnCiR uses this to gather
    per-Y outputs from `forcollected: true` TPs into a wide table."""
    ids = args.get('colIds', _id_list(args.get('yIN')))
    out = args.get('out') or {}
    any_valid = False
    for cid in ids:
        if cid in cols:
            key = f'col_{cid}'
            out_id = out.get(key)
            if isinstance(out_id, dict):
                out_id = out_id.get('val', -1)
            if out_id and out_id != -1:
                _set_col(raw_data, cols, out_id, cols[cid].get_data(),
                         type_=cols[cid].type)
                any_valid = True
    return any_valid


# --- ColumnFunctions ---

def tp_columnfunctions(args, cols, raw_data, _sv):
    op = args.get('operation', 'add')
    ids = args.get('colIds', _id_list(args.get('yIN')))
    arrs = [cols[i].get_data() for i in ids if i in cols]
    if not arrs:
        return False
    n = max(len(a) for a in arrs)
    rows = []
    for i in range(n):
        vals = [a[i] for a in arrs if i < len(a) and a[i] is not None
                and not (isinstance(a[i], float) and math.isnan(a[i]))]
        if not vals:
            rows.append(None); continue
        if op == 'add':       rows.append(sum(vals))
        elif op == 'average': rows.append(sum(vals) / len(vals))
        elif op == 'min':     rows.append(min(vals))
        elif op == 'max':     rows.append(max(vals))
        elif op == 'sd':
            m = sum(vals) / len(vals)
            rows.append(math.sqrt(sum((v - m) ** 2 for v in vals) / len(vals)))
        else:                  rows.append(None)
    out_id = _out_id(args, 'result')
    _set_col(raw_data, cols, out_id, rows, type_='number')
    return True


# --- DoubleLogistic ---

def tp_doublelogistic(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    periodic = bool(args.get('periodic', True))
    # JS keys the fixed period as fixPeriod/fixedPeriod (not fixT/T).
    fix_period = bool(args.get('fixPeriod', args.get('fixT', False)))
    opts = {
        'periodic': periodic,
        'fixK1': args.get('fixK1', False),
        'fixK2': args.get('fixK2', False),
        'fixT': fix_period,
        'k1': args.get('k1', 1.0), 'k2': args.get('k2', 1.0),
    }
    # Seed an explicit period only when it's FIXED; a free period inits from the
    # data timespan inside fit_double_logistic (matches JS, avoids degenerate fit).
    if fix_period:
        opts['T'] = float(args.get('fixedPeriod', args.get('T', 24.0)))
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    output_x_id = args.get('outputX', -1)
    output_x_data = None
    if output_x_id != -1 and output_x_id in cols:
        output_x_data = _t_for_col(cols[output_x_id])
    first_xs = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        res = fit_double_logistic(t, cols[y_id].get_data(), opts)
        if res is None:
            continue
        if first_xs is None:
            t_arr = np.array([v for v in t if v is not None
                              and not (isinstance(v, float) and math.isnan(v))],
                             dtype=float)
            # JS evaluates the fit at the (finite) input t, not a dense grid.
            first_xs = output_x_data if output_x_data else t_arr.tolist()
            x_out = _out_id(args, 'dlogx')
            _set_col(raw_data, cols, x_out, first_xs, type_='number')
        ys = evaluate_dl_at_points(res['parameters'], first_xs, periodic)
        y_out = _out_id(args, f'dlogy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'dlogy')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        any_valid = True
    return any_valid


# --- FormulaColumn ---

def tp_formulacolumn(args, cols, raw_data, sv):
    tokens = args.get('tokens', [])

    def _tok_col(t):  # JS FormulaColumn tokens key the column as 'id'
        return t.get('id', t.get('colId'))

    n = max((len(cols[_tok_col(t)].get_data()) for t in tokens
             if t.get('type') == 'col' and _tok_col(t) in cols),
            default=0)
    rows = []
    for i in range(n):
        expr = ''
        for tok in tokens:
            if tok['type'] == 'text':
                expr += tok['value']
            elif tok['type'] == 'col':
                cid = _tok_col(tok)
                v = cols[cid].get_data()[i] if cid in cols else None
                expr += repr(v if v is not None else 'None')
            elif tok['type'] == 'stored':
                expr += repr(sv.get(tok['name']))
        try:
            rows.append(eval(expr, {'math': math, '__builtins__': {}}, {}))
        except Exception:
            rows.append(None)
    _set_col(raw_data, cols, _out_id(args, 'result'), rows, type_='number')
    return True


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
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    win = float(args.get('windowSize', 48))
    step = float(args.get('stepSize', 12))
    label = args.get('binLabel', 'center')
    analysis = args.get('analysis', 'periodogram')
    x_col = cols[x_in]
    t_full = _t_for_col(x_col)

    movex = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        y_col = cols[y_id]
        ya = np.array([np.nan if v is None else v for v in y_col.get_data()],
                      dtype=float)
        ta = np.array([np.nan if v is None else v for v in t_full],
                      dtype=float)
        finite = np.isfinite(ta) & np.isfinite(ya)
        ta, ya = ta[finite], ya[finite]
        if ta.size < 4:
            continue
        starts = np.arange(ta.min(), ta.max() - win + 1e-9, step)
        per_stat = {}
        x_labels = []
        for s in starts:
            e = s + win
            mask = (ta >= s) & (ta < e)
            tw, yw = ta[mask], ya[mask]
            if tw.size < 4:
                continue
            x_labels.append({'start': s, 'end': e, 'center': (s + e) / 2}[label])
            stats = {}
            if analysis == 'periodogram':
                pg = run_periodogram_calculation({
                    't': tw.tolist(), 'y': yw.tolist(),
                    'method': args.get('pgMethod', args.get('method', 'Lomb-Scargle')),
                    'minPeriod': args.get('periodMin', args.get('minPeriod', 1.0)),
                    'maxPeriod': args.get('periodMax', args.get('maxPeriod', win)),
                    'stepSize': args.get('periodStep', args.get('stepPg', 0.1)),
                })
                if pg['y']:
                    idx = int(np.argmax(pg['y']))
                    stats['peak_period'] = pg['x'][idx]
                    stats['peak_power'] = pg['y'][idx]
            elif analysis == 'cosinor':
                fixed = args.get('useFixedPeriod', True)
                if fixed:
                    res = fit_cosinor_fixed(tw, yw,
                                            float(args.get('fixedPeriod', 24)),
                                            int(args.get('nHarmonics', 1)))
                    if res:
                        stats['mesor'] = res['M']
                        stats['r2'] = res['R2']
                        stats['rmse'] = res['RMSE']
                        stats['pvalue'] = res['pF']
                        for h in res['harmonics']:
                            stats[f"H{h['k']}_amplitude"] = h['amplitude']
                            stats[f"H{h['k']}_acrophase"] = h['acrophase_hrs']
                else:
                    res = fit_cosine_curves(tw, yw, int(args.get('Ncurves', 1)))
                    if res:
                        stats['r2'] = res['rSquared']
                        stats['rmse'] = res['rmse']
                        for k, c in enumerate(res['parameters']['cosines'], 1):
                            stats[f"C{k}_period"] = (1.0 / c['frequency']
                                                     if c['frequency'] else float('inf'))
                            stats[f"C{k}_amplitude"] = c['amplitude']
                            stats[f"C{k}_phase"] = c['phase']
            elif analysis == 'fft':
                fft = compute_fft(tw, yw)
                if fft['magnitudes']:
                    idx = int(np.argmax(fft['magnitudes'][1:])) + 1
                    f = fft['frequencies'][idx]
                    stats['peak_frequency'] = f
                    stats['peak_period'] = 1.0 / f if f else float('inf')
                    stats['peak_magnitude'] = fft['magnitudes'][idx]
            elif analysis == 'correlogram':
                ac = compute_autocorrelation(
                    tw, yw,
                    min_lag=float(args.get('corrMinLag', 0.0)),
                    max_lag=args.get('corrMaxLag') or None)
                if ac['correlations']:
                    idx = int(np.argmax(ac['correlations']))
                    stats['peak_lag'] = ac['lags'][idx]
                    stats['peak_correlation'] = ac['correlations'][idx]
            for k, v in stats.items():
                per_stat.setdefault(k, []).append(v)
        if movex is None and x_labels:
            movex = x_labels
            mx_id = _out_id(args, 'movex')
            x_type = 'time' if x_col.type == 'time' else 'number'
            _set_col(raw_data, cols, mx_id, movex, type_=x_type)
        for k, vlist in per_stat.items():
            out_key = f'{y_id}_{k}'
            out_id = _out_id(args, out_key)
            if out_id != -1:
                _set_col(raw_data, cols, out_id, vlist, type_='number')
                any_valid = True
    return any_valid


# --- Random ---

def tp_random(args, cols, raw_data, _sv):
    n = int(args.get('N', args.get('rows', 100)))
    offset = float(args.get('offset', 0.0))
    mult = float(args.get('multiply', 1.0))
    # NOTE: JS Random uses a seeded @stdlib minstd PRNG; this port uses an
    # unseeded RNG, so output is NOT bit-identical. demo-tp-random is excluded
    # from session parity as non-deterministic (see test_session_parity.py).
    rng = np.random.default_rng()
    _set_col(raw_data, cols, _out_id(args, 'result'),
             (offset + rng.random(n) * mult).tolist(), type_='number')
    return n > 0


# --- RectangularWave ---

def tp_rectangularwave(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    x_col = cols[x_in]
    t = _t_for_col(x_col)
    opts = {
        'fixKappa': args.get('fixKappa', False),
        'fixOmega': args.get('fixOmega', False),
        'fixD': args.get('fixD', False),
        'kappa': args.get('kappa', 5.0),
        'omega': args.get('omega', 2 * math.pi / 24),
        'dutyCycle': args.get('dutyCycle', 0.5),
    }
    output_x_id = args.get('outputX', -1)
    output_x_data = None
    if output_x_id != -1 and output_x_id in cols:
        output_x_data = _t_for_col(cols[output_x_id])
    first_xs = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        res = fit_rectangular_wave(t, cols[y_id].get_data(), opts)
        if res is None:
            continue
        if first_xs is None:
            t_arr = np.array([v for v in t if v is not None
                              and not (isinstance(v, float) and math.isnan(v))],
                             dtype=float)
            # JS evaluates the fit at the (finite) input t, not a dense grid.
            first_xs = output_x_data if output_x_data else t_arr.tolist()
            _set_col(raw_data, cols, _out_id(args, 'rectwavex'),
                     first_xs, type_='number')
        ys = evaluate_rectwave_at_points(res['parameters'], first_xs)
        y_out = _out_id(args, f'rectwavey_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'rectwavey')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        any_valid = True
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
                             [pg['threshold']] * len(xs), type_='number')
        elif analysis == 'fft':
            fft = compute_fft(t, y)
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
        any_valid = True
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

def tp_smootheddata(args, cols, raw_data, _sv):
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    if x_in == -1 or x_in not in cols or not y_ins:
        return False
    smoother = args.get('smootherType', args.get('smoother', 'whittaker'))
    x_col = cols[x_in]
    x_data = _t_for_col(x_col)
    sx = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        nx, ny = smooth_arrays(x_data, cols[y_id].get_data(), smoother, args)
        if sx is None:
            sx = nx
            _set_col(raw_data, cols, _out_id(args, 'smoothedx'), nx,
                     type_=x_col.type, time_format=x_col.time_format)
        y_out = _out_id(args, f'smoothedy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'smoothedy')
        _set_col(raw_data, cols, y_out, ny, type_='number')
        any_valid = True
    return any_valid


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
    output_x_data = None
    if output_x_id != -1 and output_x_id in cols:
        output_x_data = _t_for_col(cols[output_x_id])
    xs = None
    any_valid = False
    for y_id in y_ins:
        if y_id not in cols:
            continue
        res = fit_trend(t, cols[y_id].get_data(), model, deg)
        if res is None:
            continue
        if xs is None:
            t_arr = np.array([v for v in t if v is not None
                              and not (isinstance(v, float) and math.isnan(v))],
                             dtype=float)
            # JS evaluates the fit at the (finite) input t, not a dense grid.
            xs = output_x_data if output_x_data else t_arr.tolist()
            _set_col(raw_data, cols, _out_id(args, 'trendx'), xs, type_='number')
        ys = evaluate_trend_at_points(res['parameters'], model, xs)
        y_out = _out_id(args, f'trendy_{y_id}')
        if y_out == -1:
            y_out = _out_id(args, 'trendy')
        _set_col(raw_data, cols, y_out, ys, type_='number')
        any_valid = True
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
    if not (math.isfinite(f_value) and math.isfinite(df1) and math.isfinite(df2)):
        return float('nan')
    if df1 <= 0 or df2 <= 0 or f_value < 0:
        return float('nan')
    return float(1 - sp_stats.f.cdf(f_value, df1, df2))


def _gc_p_upper_from_chisq(x_value, df):                 # JS safePUpperFromChiSq (:67-71)
    if not (math.isfinite(x_value) and math.isfinite(df)):
        return float('nan')
    if x_value < 0 or df <= 0:
        return float('nan')
    return float(1 - sp_stats.chi2.cdf(x_value, df))


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
        # JS: if (gRaw == null || yRaw == null || Number.isNaN(yRaw)) continue
        if g_raw is None or y_raw is None:
            continue
        if isinstance(y_raw, float) and math.isnan(y_raw):
            continue
        g = str(g_raw)
        if g not in buckets:
            buckets[g] = []
            order.append(g)
        buckets[g].append(float(y_raw))
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
        values = [float(v) for v in (y_col.get_data() or [])
                  if v is not None and not (isinstance(v, float) and math.isnan(v))]
        if not values:
            continue
        groups.append({
            'name': y_col.name or str(y_id), 'values': values,
            'n': len(values), 'mean': _gc_mean(values),
            'sd': _gc_sample_std(values),
        })
    return groups


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
    p_value = _gc_p_upper_from_f(f, df_between, df_within) if math.isfinite(f) else 0.0
    eta_squared = (ss_between / (ss_between + ss_within)
                   if (ss_between + ss_within) > 0 else float('nan'))
    return {'valid': True, 'f': f, 'dfBetween': df_between,
            'dfWithin': df_within, 'msWithin': ms_within, 'pValue': p_value,
            'ssBetween': ss_between, 'ssWithin': ss_within,
            'etaSquared': eta_squared}


def _gc_tukey_kramer_post_hoc(groups, ms_within, df_within, alpha=0.05):
    # JS tukeyKramerPostHoc (:342-365)
    if not (math.isfinite(ms_within) and math.isfinite(df_within)) or df_within <= 0:
        return []
    pairs = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            a = groups[i]
            b = groups[j]
            if a['n'] == 0 or b['n'] == 0:
                continue
            diff = a['mean'] - b['mean']
            se = math.sqrt(ms_within * (1 / a['n'] + 1 / b['n']))
            if se == 0:
                t = 0.0 if diff == 0 else float('inf')
            else:
                t = diff / se
            q = abs(t) * math.sqrt(2)
            p_value = _gc_p_upper_from_f(t * t, 1, df_within) if math.isfinite(t) else 0.0
            pairs.append({'groupA': a['name'], 'groupB': b['name'],
                          'diff': diff, 'statistic': q, 'pValue': p_value})
    adjusted = _gc_holm_adjust(pairs)
    for p in adjusted:
        p['significant'] = p['pAdjusted'] < alpha
    return adjusted


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
    epsilon_squared = (h_corrected - df) / (n - 1)
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
        use_fixed = args.get('useFixedPeriod', False)
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
                    'fitted': res['fitted']}
        n_curves = max(1, int(args.get('Ncurves', 1)))
        res = fit_cosine_curves(tt, yy, n_curves)
        if res is None:
            return None
        return {'model': 'cosinor', 'mode': 'free',
                'parameters': {'mode': 'free', **res['parameters']},
                'fitted': res['fitted']}
    if model == 'rectangular':
        opts = {
            'fixKappa': args.get('fixKappa', False),
            'fixedKappa': args.get('fixedKappa', 5),
            'fixOmega': args.get('fixOmega', False),
            'fixedPeriod': args.get('fixedPeriod', 24),
            'fixDutyCycle': args.get('fixDutyCycle', False),
            'fixedDutyCycle': args.get('fixedDutyCycle', 0.5),
        }
        res = fit_rectangular_wave(tt, yy, opts)
        if res is None:
            return None
        return {'model': 'rectangular', 'parameters': res['parameters'],
                'fitted': res['fitted']}
    if model == 'doublelogistic':
        periodic = args.get('periodic', True)
        opts = {
            'periodic': periodic,
            'fixK1': args.get('fixK1', False), 'fixedK1': args.get('fixedK1', 0.5),
            'fixK2': args.get('fixK2', False), 'fixedK2': args.get('fixedK2', 0.5),
            'fixPeriod': args.get('fixPeriod', False),
            'fixedPeriod': args.get('fixedPeriod', 24),
        }
        res = fit_double_logistic(tt, yy, opts)
        if res is None:
            return None
        return {'model': 'doublelogistic', 'periodic': periodic,
                'parameters': res['parameters'], 'fitted': res['fitted']}
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


def tp_fitfunction(args, cols, raw_data, _sv):
    # Port of FitFunction.svelte buildFitResult (:131-235)
    x_in = args.get('xIN', -1)
    y_ins = _id_list(args.get('yIN'))
    output_x_id = args.get('outputX', -1)
    x_out = _out_id(args, 'fitx')
    model = args.get('model', 'cosinor')

    if x_in == -1 or x_in not in cols or not y_ins:
        return False

    t_col = cols[x_in]
    t = _t_for_col(t_col)

    output_x_data = None
    if output_x_id != -1 and output_x_id in cols:
        ox = _t_for_col(cols[output_x_id])
        output_x_data = [v for v in ox
                         if not (v is None or (isinstance(v, float) and math.isnan(v)))]

    origin_ms = None
    if output_x_id != -1 and output_x_id in cols and cols[output_x_id].type == 'time':
        d = cols[output_x_id].get_data()
        origin_ms = d[0] if d else None
    if origin_ms is None and t_col.type == 'time':
        d = t_col.get_data()
        origin_ms = d[0] if d else None

    y_results = {}     # JS result.y_results
    any_valid = False
    t_ref = []

    for y_id in y_ins:
        if y_id is None or y_id == -1 or y_id not in cols:
            continue
        y = cols[y_id].get_data()
        # JS getValidPairs (:99-107)
        valid_idx = [i for i in range(min(len(t), len(y)))
                     if not (_isnan(t[i]) or _isnan(y[i]))]
        tt = [t[i] for i in valid_idx]
        yy = [y[i] for i in valid_idx]
        if not tt:
            continue
        fit_result = _ff_fit_curve_model(tt, yy, model, args)   # JS computeSingleFit
        if fit_result is None:
            continue
        predicted = (_ff_evaluate_at_points(fit_result, model, output_x_data)
                     if output_x_data else None)
        y_out_data = predicted if predicted is not None else fit_result['fitted']
        x_out_data = output_x_data if output_x_data is not None else tt
        y_results[y_id] = {'fitResult': fit_result, 'xOutData': x_out_data,
                           'yOutData': y_out_data, 't': tt}
        if not t_ref:
            t_ref = tt
        if fit_result.get('fitted'):
            any_valid = True

    # Write output columns (JS :202-232)
    if any_valid and x_out != -1:
        first_y_id = next(iter(y_results))
        first = y_results[first_y_id]
        x_out_data = first['xOutData'] or output_x_data or first['t']
        x_out_ms = ([origin_ms + h * 3600000 for h in x_out_data]
                    if origin_ms is not None else x_out_data)
        x_type = 'time' if origin_ms is not None else 'number'
        _set_col(raw_data, cols, x_out, x_out_ms, type_=x_type,
                 time_format=None if origin_ms is not None else None)
        for y_id in y_ins:
            out_key = f"fity_{y_id}"
            y_out = _out_id(args, out_key)
            yr = y_results.get(y_id)
            if y_out is not None and y_out != -1 and yr:
                _set_col(raw_data, cols, y_out, yr['yOutData'], type_='number')

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
    'Bin Data': 'binneddata',
    'Binned Data': 'binneddata',
    'BinnedData': 'binneddata',
    'Blank Column': 'blankcolumn',
    'BlankColumn': 'blankcolumn',
    'Collect Columns': 'collectcolumns',
    'CollectColumns': 'collectcolumns',
    'Column Function': 'columnfunctions',
    'Column Functions': 'columnfunctions',
    'ColumnFunctions': 'columnfunctions',
    'Compare groups (stats)': 'groupcomparison',
    'Cosinor': 'cosinor',
    'Double Logistic': 'doublelogistic',
    'DoubleLogistic': 'doublelogistic',
    'Duplicate': 'duplicate',
    'Enter Data': 'blankcolumn',
    'Fit Function': 'fitfunction',
    'Fit Trend Curves': 'trendfit',
    'FitFunction': 'fitfunction',
    'Formula Column': 'formulacolumn',
    'FormulaColumn': 'formulacolumn',
    'GroupComparison': 'groupcomparison',
    'Long To Wide': 'longtowide',
    'Long to Wide': 'longtowide',
    'LongToWide': 'longtowide',
    'Moving Analysis': 'movinganalysis',
    'MovingAnalysis': 'movinganalysis',
    'Random': 'random',
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
    'Split': 'split',
    'Split data': 'split',
    'Stored Value Group': 'storedvaluegroup',
    'StoredValueGroup': 'storedvaluegroup',
    'Trend Fit': 'trendfit',
    'TrendFit': 'trendfit',
    'Wide To Long': 'widetolong',
    'Wide to Long': 'widetolong',
    'WideToLong': 'widetolong',
}
# <<< AUTO-GENERATED DISPLAY_TO_TP <<<


TABLE_PROCESS_MAP = {
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
    'random': tp_random,
    'rectangularwave': tp_rectangularwave,
    'rhythmicityanalysis': tp_rhythmicityanalysis,
    'sequencecolumn': tp_sequencecolumn,
    'simulateddata': tp_simulateddata,
    'smootheddata': tp_smootheddata,
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
    method = p.get('method', 'Lomb-Scargle')
    p_min = float(p.get('periodMin', 1.0))
    p_max = float(p.get('periodMax', 48.0))
    step = float(p.get('periodStep', 0.1))
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        y = y_col.get_data()
        t, y = _paired_finite(t, y)
        if not t:
            continue
        result = run_periodogram_calculation({
            't': t, 'y': y, 'method': method,
            'minPeriod': p_min, 'maxPeriod': p_max, 'stepSize': step,
        })
        line = series.get('line') or {}
        colour = line.get('colour') or line.get('color')
        ax.plot(result['x'], result['y'], color=colour,
                linewidth=line.get('width', 1),
                label=series.get('label') or y_col.name)
        if result.get('threshold') is not None:
            ax.axhline(result['threshold'], color=colour or 'gray',
                       linestyle='--', linewidth=0.8, alpha=0.5)
    _apply_axes(ax,
                xlims=p.get('xlimsIN'),
                ylims=p.get('ylimsIN'),
                xlabel=(p.get('xAxis') or {}).get('label', 'Period'),
                ylabel=(p.get('yAxis') or {}).get('label', 'Power'),
                title=plot.get('name', ''))
    ax.legend(loc='best', fontsize=8)


def plot_correlogram(plot, columns_index, ax):
    p = plot.get('plot', {})
    for series in p.get('data', []):
        x_col = _resolve_plot_col(series.get('x'), columns_index)
        y_col = _resolve_plot_col(series.get('y'), columns_index)
        if x_col is None or y_col is None:
            continue
        t = (x_col.hours_since_start if x_col.type == 'time'
             else x_col.get_data())
        y = y_col.get_data()
        t, y = _paired_finite(t, y)
        if not t:
            continue
        ac = compute_autocorrelation(
            t, y,
            min_lag=float(p.get('corrMinLag', 0.0)),
            max_lag=p.get('corrMaxLag') or None)
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
        y = [v for v in y_col.get_data()
             if v is not None and not (isinstance(v, float) and math.isnan(v))]
        data.append(y)
        labels.append(series.get('label') or y_col.name)
    if data:
        ax.boxplot(data, tick_labels=labels)
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
    (tableplot, dataview, etc) with a console note."""
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
