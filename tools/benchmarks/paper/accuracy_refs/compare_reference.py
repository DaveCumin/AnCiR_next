"""Study C: agreement of AnCiR's engine with independent reference implementations
on byte-identical inputs (exported by C_export_reference_inputs.bench.test.js).

References
  * Lomb-Scargle : astropy.timeseries.LombScargle and scipy.signal.lombscargle
  * Chi-squared  : an independent implementation written here directly from
                   Sokolove & Bushell (1978, J Theor Biol 72:131-160), in two forms:
                   (i) the literal published form, truncated to K complete cycles;
                   (ii) the same formula using all bins (unequal rows per column)
  * Cosinor      : ordinary least squares in statsmodels (Halberg/Nelson single-
                   and two-harmonic cosinor), amplitude/acrophase derived as usual
  * NPCRA        : R package nparACT (see compare_npcra_nparACT.R), merged here

Run from the repo root:
  tools/.venv/bin/python tools/benchmarks/paper/accuracy_refs/compare_reference.py
Writes results/accuracy/C_reference_comparison.json and C_reference_comparison.csv
"""

import csv
import json
import math
import platform
import sys
from pathlib import Path

import astropy
import numpy as np
import scipy
import statsmodels
import statsmodels.api as sm
from astropy.timeseries import LombScargle
from scipy.signal import lombscargle
from scipy.stats import chi2

HERE = Path(__file__).resolve().parent
RES = HERE.parent / "results" / "accuracy"
DATA = json.loads((RES / "C_inputs_and_ancir.json").read_text())


def spectrum_agreement(a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    d = np.abs(a - b)
    scale = np.max(np.abs(b))
    return {
        "n_points": int(a.size),
        "max_abs_diff": float(d.max()),
        "max_diff_rel_to_peak": float(d.max() / scale) if scale > 0 else float("nan"),
        "median_pointwise_rel_diff": float(np.median(d / np.maximum(np.abs(b), 1e-300))),
        "pearson_r": float(np.corrcoef(a, b)[0, 1]) if a.size > 2 else float("nan"),
    }


# ---------------------------------------------------------------- Lomb-Scargle
# AnCiR (periodogram.js) computes the classical Lomb (1976)/Scargle (1982) power with a
# fixed (pre-subtracted) mean and divides by 2*s^2 with s^2 the SAMPLE variance (N-1):
#     P_AnCiR = [ (sum yc cos)^2/sum cos^2 + (sum yc sin)^2/sum sin^2 ] / (2 s^2)
# i.e. the Horne & Baliunas (1986) normalisation. Equivalent reference quantities:
#   astropy, fit_mean=False, center_data=True, normalization='standard':
#       P_std = [..] / sum (y - ybar)^2   ->  P_AnCiR = P_std * (N - 1) / 2
#   astropy normalization='psd' (dy=None):  P_psd = 0.5 [..]  ->  P_AnCiR = P_psd / s^2
#   scipy.signal.lombscargle(t, y - ybar, 2 pi f) (unnormalised) = 0.5 [..] -> / s^2
ls_rows = []
for s in DATA["periodogram"]:
    t = np.asarray(s["t"], float)
    y = np.asarray(s["y"], float)
    periods = np.asarray(s["ls"]["periods"], float)
    ancir = np.asarray(s["ls"]["power"], float)
    f = 1.0 / periods
    n = y.size
    s2 = np.var(y, ddof=1)
    p_std = LombScargle(t, y, fit_mean=False, center_data=True, normalization="standard").power(f)
    p_psd = LombScargle(t, y, fit_mean=False, center_data=True, normalization="psd").power(f)
    p_scipy = lombscargle(t, y - y.mean(), 2 * np.pi * f, normalize=False)
    # Floating-mean (generalised LS, Zechmeister & Kuerster 2009): astropy's DEFAULT.
    # Not the same statistic; reported only to show the size of that modelling choice.
    p_gls = LombScargle(t, y, fit_mean=True, center_data=True, normalization="standard").power(f)
    ref_std = p_std * (n - 1) / 2
    ref_psd = p_psd / s2
    ref_scipy = p_scipy / s2
    ref_gls = p_gls * (n - 1) / 2
    row = {
        "series": s["name"],
        "n": n,
        "astropy_standard": spectrum_agreement(ancir, ref_std),
        "astropy_psd": spectrum_agreement(ancir, ref_psd),
        "scipy": spectrum_agreement(ancir, ref_scipy),
        "astropy_floating_mean_GLS": spectrum_agreement(ancir, ref_gls),
        "peak_period_ancir": float(periods[np.argmax(ancir)]),
        "peak_period_astropy": float(periods[np.argmax(ref_std)]),
        "peak_period_scipy": float(periods[np.argmax(ref_scipy)]),
        "peak_period_astropy_GLS": float(periods[np.argmax(ref_gls)]),
    }
    ls_rows.append(row)


# ------------------------------------------------------------ Chi-squared (S&B)
def bin_means(t, y, bs):
    """Mean of y in bins [k*bs, (k+1)*bs) from t = 0 up to the bin containing max(t).
    Empty bins are NaN. (Tolerance 1e-10 on bin edges, as floating-point hygiene.)"""
    k = np.floor((t + 1e-10) / bs).astype(int)
    nb = int(k.max()) + 1
    sums = np.bincount(k, weights=y, minlength=nb)
    cnts = np.bincount(k, minlength=nb)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(cnts > 0, sums / np.maximum(cnts, 1), np.nan)


def qp_literal(x, P):
    """Sokolove & Bushell (1978) eq.: Qp = K N sum_h (M_h - M)^2 / sum_i (X_i - M)^2,
    data arranged in K complete rows of P columns (N = K P; trailing partial row dropped)."""
    K = x.size // P
    if K < 2:
        return float("nan"), P - 1
    X = x[: K * P]
    if np.isnan(X).any():
        return float("nan"), P - 1
    N = K * P
    M = X.mean()
    Mh = X.reshape(K, P).mean(axis=0)
    return K * N * np.sum((Mh - M) ** 2) / np.sum((X - M) ** 2), P - 1


def qp_alldata(x, P):
    """Same statistic using every non-empty bin: rows need not be complete, so each
    column h has its own K_h. Between-column SS is weighted by K_h (one-way ANOVA form):
    Qp = N * sum_h K_h (M_h - M)^2 / sum_i (X_i - M)^2, df = (#non-empty columns) - 1."""
    ok = ~np.isnan(x)
    idx = np.arange(x.size)[ok] % P
    X = x[ok]
    N = X.size
    M = X.mean()
    Kh = np.bincount(idx, minlength=P)
    Sh = np.bincount(idx, weights=X, minlength=P)
    nz = Kh > 0
    Mh = Sh[nz] / Kh[nz]
    return N * np.sum(Kh[nz] * (Mh - M) ** 2) / np.sum((X - M) ** 2), int(nz.sum()) - 1


chi_rows = []
for s in DATA["periodogram"]:
    t = np.asarray(s["t"], float)
    y = np.asarray(s["y"], float)
    for c in s["chi"]:
        bs = c["binSize"]
        x = bin_means(t, y, bs)
        periods = np.asarray(c["periods"], float)
        n_trials = int(math.floor((s["grid"]["periodMax"] - s["grid"]["periodMin"]) / s["grid"]["periodSteps"])) + 1
        conf = (1 - 0.05) ** (1 / n_trials)  # Sidak over the trial-period grid, as AnCiR
        lit, lit_df, alld, alld_df = [], [], [], []
        for p in periods:
            # columns per trial period, rounding half UP (Python's round() is half-to-even,
            # which would pair a different column count with periods such as 24.5 h)
            P = int(math.floor(p / bs + 0.5))
            q1, d1 = qp_literal(x, P)
            q2, d2 = qp_alldata(x, P)
            lit.append(q1)
            lit_df.append(d1)
            alld.append(q2)
            alld_df.append(d2)
        lit = np.array(lit)
        alld = np.array(alld)
        alld_df = np.array(alld_df)
        anc = np.asarray(c["power"], float)
        anc_df = np.asarray(c["df"], float)
        thr_ref = chi2.ppf(conf, alld_df)
        p_ref = chi2.sf(alld, alld_df)
        row = {
            "series": s["name"],
            "binSize": bs,
            "empty_bins": int(np.isnan(x).sum()),
            "vs_alldata": spectrum_agreement(anc, alld),
            "df_identical": bool(np.all(anc_df == alld_df)),
            "threshold_max_abs_diff": float(np.max(np.abs(np.asarray(c["threshold"]) - thr_ref))),
            "pvalue_max_abs_diff": float(np.max(np.abs(np.asarray(c["pvalue"]) - p_ref))),
            "peak_period_ancir": float(periods[np.argmax(anc)]),
            "peak_period_ref_alldata": float(periods[np.argmax(alld)]),
        }
        if np.isfinite(lit).all():
            row["vs_literal_truncated"] = spectrum_agreement(anc, lit)
            row["peak_period_ref_literal"] = float(periods[np.argmax(lit)])
        else:
            row["vs_literal_truncated"] = None  # literal form undefined with empty bins
        chi_rows.append(row)


# --------------------------------------------------------------------- Cosinor
def wrap(v, per):
    return ((v % per) + per) % per


def circ_diff(a, b, per):
    d = abs(wrap(a, per) - wrap(b, per))
    return min(d, per - d)


cos_rows = []
for c in DATA["cosinor"]:
    t = np.asarray(c["t"], float)
    y = np.asarray(c["y"], float)
    per = c["period"]
    H = c["nHarmonics"]
    w = 2 * np.pi / per
    cols = [np.ones_like(t)]
    for k in range(1, H + 1):
        cols += [np.cos(k * w * t), np.sin(k * w * t)]
    X = np.column_stack(cols)
    fit = sm.OLS(y, X).fit()
    V = fit.cov_params()
    a = c["ancir"]
    out = {
        "series": c["name"],
        "period": per,
        "nHarmonics": H,
        "abs_diff": {
            "MESOR": abs(a["M"] - fit.params[0]),
            "SE_MESOR": abs(a["SE_M"] - fit.bse[0]),
            "R2": abs(a["R2"] - fit.rsquared),
            "F": abs(a["F_stat"] - fit.fvalue),
            "p_F": abs(a["pF"] - fit.f_pvalue),
        },
        "rel_diff_F": abs(a["F_stat"] - fit.fvalue) / abs(fit.fvalue),
        "p_F_ref": float(fit.f_pvalue),
        "p_F_ancir": a["pF"],
    }
    for k in range(1, H + 1):
        b, g = fit.params[2 * k - 1], fit.params[2 * k]
        A = math.hypot(b, g)
        phi = math.atan2(-g, b)
        # delta-method SE for amplitude (standard; e.g. Bingham et al. 1982)
        vb, vg, cbg = V[2 * k - 1, 2 * k - 1], V[2 * k, 2 * k], V[2 * k - 1, 2 * k]
        se_A = math.sqrt((b * b * vb + g * g * vg + 2 * b * g * cbg) / (A * A))
        h = a["harmonics"][k - 1]
        # AnCiR (v76+) reports the acrophase as the time of peak within the cycle.
        peak_time = wrap(-phi * per / (2 * np.pi * k), per / k)
        out["abs_diff"][f"H{k}_amplitude"] = abs(h["amplitude"] - A)
        out["abs_diff"][f"H{k}_acrophase_h(circular)"] = circ_diff(h["acrophase_hrs"], peak_time, per / k)
        out["abs_diff"][f"H{k}_SE_amplitude"] = abs(h["SE_A"] - se_A)
        # SE with and without the cov(beta, gamma) term (AnCiR v76+ includes it)
        out[f"H{k}_SE_A_ref_with_cov"] = se_A
        out[f"H{k}_SE_A_ref_without_cov"] = math.sqrt((b * b * vb + g * g * vg) / (A * A))
        out[f"H{k}_SE_A_ancir"] = h["SE_A"]
        out[f"H{k}_peak_time_h"] = peak_time
        out[f"H{k}_acrophase_hrs_ancir"] = h["acrophase_hrs"]
    cos_rows.append(out)


# ----------------------------------------------------------------------- NPCRA
npcra_rows = []
npar_path = RES / "C_npcra_nparACT.csv"
if npar_path.exists():
    with npar_path.open() as fh:
        npar = {r["name"]: r for r in csv.DictReader(fh)}

    def hhmm(sv):
        hh, mm, *_ = sv.split(":")
        return int(hh) + int(mm) / 60

    for s in DATA["npcra"]:
        r = npar.get(s["name"])
        if r is None:
            continue
        a1 = s["ancir_epoch1h"]
        am = s["ancir_epoch1min"]
        row = {"series": s["name"], "days": s["days"]}
        for k in ["IS", "IV", "RA", "L5", "M10"]:
            row[f"{k}_nparACT"] = float(r[k])
            row[f"{k}_ancir_1h"] = a1[k]
            row[f"{k}_ancir_1min"] = am[k]
            row[f"{k}_absdiff_1h"] = abs(a1[k] - float(r[k]))
            row[f"{k}_absdiff_1min"] = abs(am[k] - float(r[k]))
        # nparACT 0.9.1's nparACT_IS pads the hourly series to whole days with
        # `data_hrs3[s * p] <- NA`; on a whole-day record s*p == n, so that line OVERWRITES
        # the last hourly mean with NA and the 24 h profile silently omits the final hour.
        # Emulating that quirk on the same input reproduces nparACT's IS; reported so the
        # IS differences can be attributed.
        cts = np.asarray(s["counts"], float)
        hrs = cts[: (cts.size // 60) * 60].reshape(-1, 60).mean(1)
        mall = hrs.mean()
        hq = hrs.copy()
        hq[-1] = np.nan
        prof_q = np.nanmean(hq[: (hq.size // 24) * 24].reshape(-1, 24), 0)
        is_q = hrs.size * np.sum((prof_q - mall) ** 2) / (24 * np.sum((hrs - mall) ** 2))
        row["IS_ancir_formula_with_nparACT_lasthour_quirk"] = float(is_q)
        row["IS_quirk_rounded_equals_nparACT"] = bool(round(is_q + 1e-12, 2) == float(r["IS"]))
        row["L5onset_nparACT_h"] = hhmm(r["L5_starttime"])
        row["M10onset_nparACT_h"] = hhmm(r["M10_starttime"])
        row["L5onset_ancir_1min_h"] = am["L5onset"]
        row["M10onset_ancir_1min_h"] = am["M10onset"]
        row["L5onset_ancir_1h_h"] = a1["L5onset"]
        row["M10onset_ancir_1h_h"] = a1["M10onset"]
        npcra_rows.append(row)


# --------------------------------------------------------------------- output
def mx(rows, path):
    vals = []
    for r in rows:
        v = r
        for p in path:
            v = v.get(p) if isinstance(v, dict) else None
            if v is None:
                break
        if v is not None and not (isinstance(v, float) and math.isnan(v)):
            vals.append(v)
    return max(vals) if vals else None


summary = {
    "versions": {
        "python": sys.version.split()[0],
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "astropy": astropy.__version__,
        "statsmodels": statsmodels.__version__,
        "platform": platform.platform(),
    },
    "lomb_scargle": ls_rows,
    "chi_squared": chi_rows,
    "cosinor": cos_rows,
    "npcra": npcra_rows,
    "headline": {
        "LS_vs_astropy_std_max_diff_rel_to_peak": mx(ls_rows, ["astropy_standard", "max_diff_rel_to_peak"]),
        "LS_vs_astropy_std_min_r": min(r["astropy_standard"]["pearson_r"] for r in ls_rows),
        "LS_vs_scipy_max_diff_rel_to_peak": mx(ls_rows, ["scipy", "max_diff_rel_to_peak"]),
        "LS_peak_period_all_equal_astropy": all(r["peak_period_ancir"] == r["peak_period_astropy"] for r in ls_rows),
        "LS_peak_period_all_equal_scipy": all(r["peak_period_ancir"] == r["peak_period_scipy"] for r in ls_rows),
        "CHI_vs_alldata_max_diff_rel_to_peak": mx(chi_rows, ["vs_alldata", "max_diff_rel_to_peak"]),
        "CHI_vs_literal_max_diff_rel_to_peak": mx(chi_rows, ["vs_literal_truncated", "max_diff_rel_to_peak"]),
        "CHI_vs_literal_min_r": min(r["vs_literal_truncated"]["pearson_r"] for r in chi_rows if r["vs_literal_truncated"]),
        "CHI_df_all_identical": all(r["df_identical"] for r in chi_rows),
        "CHI_threshold_max_abs_diff": mx(chi_rows, ["threshold_max_abs_diff"]),
        "CHI_pvalue_max_abs_diff": mx(chi_rows, ["pvalue_max_abs_diff"]),
        "COS_max_abs_diff": {k: max(r["abs_diff"].get(k, 0) for r in cos_rows) for k in sorted({kk for r in cos_rows for kk in r["abs_diff"]})},
    },
}
(RES / "C_reference_comparison.json").write_text(json.dumps(summary, indent=1, default=float))

with (RES / "C_reference_comparison.csv").open("w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["analysis", "series", "reference", "n_points", "max_abs_diff", "max_diff_rel_to_peak", "pearson_r", "peak_period_ancir", "peak_period_ref"])
    for r in ls_rows:
        for ref, key in [("astropy standard", "astropy_standard"), ("astropy psd", "astropy_psd"), ("scipy.signal.lombscargle", "scipy"), ("astropy GLS (floating mean)", "astropy_floating_mean_GLS")]:
            a = r[key]
            pk = {"astropy_standard": "peak_period_astropy", "astropy_psd": "peak_period_astropy", "scipy": "peak_period_scipy", "astropy_floating_mean_GLS": "peak_period_astropy_GLS"}[key]
            w.writerow(["Lomb-Scargle", r["series"], ref, a["n_points"], a["max_abs_diff"], a["max_diff_rel_to_peak"], a["pearson_r"], r["peak_period_ancir"], r[pk]])
    for r in chi_rows:
        a = r["vs_alldata"]
        w.writerow(["Chi-squared bin=" + str(r["binSize"]), r["series"], "S&B all-data (own Python)", a["n_points"], a["max_abs_diff"], a["max_diff_rel_to_peak"], a["pearson_r"], r["peak_period_ancir"], r["peak_period_ref_alldata"]])
        a = r["vs_literal_truncated"]
        if a:
            w.writerow(["Chi-squared bin=" + str(r["binSize"]), r["series"], "S&B literal, K complete cycles (own Python)", a["n_points"], a["max_abs_diff"], a["max_diff_rel_to_peak"], a["pearson_r"], r["peak_period_ancir"], r["peak_period_ref_literal"]])

print(json.dumps(summary["versions"], indent=1))
print(json.dumps(summary["headline"], indent=1, default=float))
