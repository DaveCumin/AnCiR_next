# AnCiR runtime — R port.
#
# The third implementation of the AnCiR engine, beside the JavaScript one the app runs and
# the Python port in ancir_runtime.py. Two jobs:
#
#   1. It is embedded into the R script that "export session as R" produces, so a session
#      can be re-run outside the browser.
#   2. It is the R leg of the parity harness (tools/test_parity.R), which checks it against
#      the SAME fixtures and the SAME recorded JS outputs the Python leg uses.
#
# DEPENDENCIES: base R only. Deliberate.
#
# This file is embedded in a script handed to end users, so every package they would have to
# install is friction on the feature. Everything here is base R (`stats` included), which
# also removed the one dependency the scope expected to need: minpack.lm for nonlinear least
# squares. `optim(method = "L-BFGS-B")` with an ANALYTIC gradient matches scipy's
# trust-region least_squares to ~1e-8 on the free-period cosinor (measured; the same fit with
# optim's default numerical gradient is only good to ~1e-2, so the analytic Jacobian is doing
# the work, not the optimiser choice).
#
# jsonlite is used ONLY by tools/test_parity.R, never here.
#
# CONVENTIONS THAT MUST MATCH, and are easy to get wrong:
#   - describe_stats skewness/kurtosis are the BIAS-CORRECTED sample forms (scipy
#     bias = FALSE), kurtosis EXCESS (Fisher).
#   - jarque_bera and d_agostino use the BIASED (population) moments instead. Reusing the
#     bias-corrected ones there is the obvious mistake and shifts the statistic visibly on
#     small samples.
#   - quantiles use type 7, which is both R's default and numpy's "linear" method.
#   - sd() is already ddof = 1; numpy defaults to ddof = 0, so the Python side asks for
#     ddof=1 explicitly and R needs no adjustment.

# ---------------------------------------------------------------------------
# Coercion
# ---------------------------------------------------------------------------

# Drop everything that is not a finite number, mirroring _clean_numeric: the JS treats null,
# "" and non-numeric strings as absent rather than as an error. Logicals are excluded too —
# the Python side rejects bools explicitly, and R would otherwise coerce TRUE to 1.
clean_numeric <- function(values) {
  if (is.null(values)) return(numeric(0))
  out <- vapply(values, function(x) {
    if (is.null(x) || length(x) != 1 || is.logical(x)) return(NA_real_)
    if (is.character(x) && !nzchar(x)) return(NA_real_)
    v <- suppressWarnings(as.numeric(x))
    if (length(v) != 1 || is.na(v)) NA_real_ else v
  }, numeric(1), USE.NAMES = FALSE)
  out[is.finite(out)]
}

# Biased (population) central moments, shared by the normality tests.
.moments <- function(x) {
  n <- length(x); m <- mean(x)
  list(n = n,
       m2 = sum((x - m)^2) / n,
       m3 = sum((x - m)^3) / n,
       m4 = sum((x - m)^4) / n)
}

# ---------------------------------------------------------------------------
# Descriptive statistics
# ---------------------------------------------------------------------------

# scipy.stats.skew(bias = FALSE) — the G1 sample skewness.
skewness_unbiased <- function(x) {
  n <- length(x)
  if (n < 3) return(NA_real_)
  mo <- .moments(x)
  if (mo$m2 == 0) return(NA_real_)
  sqrt(n * (n - 1)) / (n - 2) * (mo$m3 / mo$m2^1.5)
}

# scipy.stats.kurtosis(bias = FALSE, fisher = TRUE) — the G2 sample EXCESS kurtosis.
kurtosis_unbiased <- function(x) {
  n <- length(x)
  if (n < 4) return(NA_real_)
  mo <- .moments(x)
  if (mo$m2 == 0) return(NA_real_)
  g2 <- mo$m4 / mo$m2^2 - 3
  ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3))
}

describe_stats <- function(values) {
  x <- clean_numeric(values)
  n <- length(x)
  keys <- c("n", "mean", "median", "sd", "min", "max", "range",
            "q1", "q3", "iqr", "skewness", "kurtosis")
  if (n == 0) return(setNames(as.list(rep(NA_real_, length(keys))), keys))
  q1 <- unname(quantile(x, 0.25, type = 7))
  q3 <- unname(quantile(x, 0.75, type = 7))
  list(n = n, mean = mean(x), median = median(x),
       sd = if (n > 1) sd(x) else NA_real_,
       min = min(x), max = max(x), range = max(x) - min(x),
       q1 = q1, q3 = q3, iqr = q3 - q1,
       skewness = skewness_unbiased(x), kurtosis = kurtosis_unbiased(x))
}

# ---------------------------------------------------------------------------
# Normality tests
# ---------------------------------------------------------------------------

jarque_bera <- function(values) {
  x <- clean_numeric(values)
  n <- length(x)
  if (n < 3 || length(unique(x)) < 2) {
    return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  }
  mo <- .moments(x)
  s <- mo$m3 / mo$m2^1.5
  k <- mo$m4 / mo$m2^2 - 3
  stat <- n / 6 * (s^2 + k^2 / 4)
  list(statistic = stat, pvalue = pchisq(stat, df = 2, lower.tail = FALSE), n = n)
}

# scipy.stats.skewtest — the Z transform of sqrt(b1) (D'Agostino 1970).
.skewtest_z <- function(x) {
  n <- length(x); mo <- .moments(x)
  b1 <- mo$m3 / mo$m2^1.5
  y <- b1 * sqrt((n + 1) * (n + 3) / (6 * (n - 2)))
  beta2 <- 3 * (n^2 + 27 * n - 70) * (n + 1) * (n + 3) /
    ((n - 2) * (n + 5) * (n + 7) * (n + 9))
  w2 <- -1 + sqrt(2 * (beta2 - 1))
  delta <- 1 / sqrt(0.5 * log(w2))
  alpha <- sqrt(2 / (w2 - 1))
  if (y == 0) y <- 1                      # scipy substitutes 1 to keep the log finite
  delta * log(y / alpha + sqrt((y / alpha)^2 + 1))
}

# scipy.stats.kurtosistest — the Z transform of b2 (Anscombe & Glynn 1983).
.kurtosistest_z <- function(x) {
  n <- length(x); mo <- .moments(x)
  b2 <- mo$m4 / mo$m2^2
  e <- 3 * (n - 1) / (n + 1)
  varb2 <- 24 * n * (n - 2) * (n - 3) / ((n + 1)^2 * (n + 3) * (n + 5))
  xx <- (b2 - e) / sqrt(varb2)
  sqrtbeta1 <- 6 * (n * n - 5 * n + 2) / ((n + 7) * (n + 9)) *
    sqrt(6 * (n + 3) * (n + 5) / (n * (n - 2) * (n - 3)))
  a <- 6 + 8 / sqrtbeta1 * (2 / sqrtbeta1 + sqrt(1 + 4 / sqrtbeta1^2))
  term1 <- 1 - 2 / (9 * a)
  denom <- 1 + xx * sqrt(2 / (a - 4))
  term2 <- sign(denom) * ((1 - 2 / a) / abs(denom))^(1 / 3)
  (term1 - term2) / sqrt(2 / (9 * a))
}

# scipy.stats.normaltest — D'Agostino-Pearson K² = Zskew² + Zkurt².
d_agostino <- function(values) {
  x <- clean_numeric(values)
  n <- length(x)
  if (n < 8 || length(unique(x)) < 2) {
    return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  }
  k2 <- .skewtest_z(x)^2 + .kurtosistest_z(x)^2
  list(statistic = k2, pvalue = pchisq(k2, df = 2, lower.tail = FALSE), n = n)
}

# Shapiro-Wilk. Base R's shapiro.test is Royston's AS R94, the same algorithm the JS port
# and scipy implement, so this is a genuine third opinion rather than a re-derivation.
# R caps n at 5000, matching the useful range of the approximation.
# utils/normality.js SHAPIRO_MAX_N: Royston's p-value approximation is validated for
# 3 <= n <= 5000 (Royston 1995, Remark AS R94, Applied Statistics 44: 547-551), which is why
# shapiro.test (and its C routine) refuse n > 5000. Above it W is still computed (the Royston
# weights below, as in normality.js) and the p-value is NA, as in the app and the Python port.
SHAPIRO_MAX_N <- 5000

# W from the Royston (AS R94) weights for any n > 5: normality.js shapiroWilk, step for step.
.shapiro_w <- function(x) {
  x <- sort(x)
  n <- length(x)
  poly <- function(c, v) sum(c * v^(seq_along(c) - 1))
  m <- qnorm((seq_len(n) - 0.375) / (n + 0.25))
  ssm <- sum(m^2)
  rsn <- 1 / sqrt(n)
  a_n <- m[n] / sqrt(ssm) + poly(c(0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056), rsn)
  a_n1 <- m[n - 1] / sqrt(ssm) +
    poly(c(0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633), rsn)
  fac <- sqrt((ssm - 2 * m[n]^2 - 2 * m[n - 1]^2) / (1 - 2 * a_n^2 - 2 * a_n1^2))
  a <- m / fac
  a[c(1, 2, n - 1, n)] <- c(-a_n, -a_n1, a_n1, a_n)
  w <- sum(a * x)^2 / sum((x - mean(x))^2)
  min(w, 1)
}

shapiro_wilk <- function(values) {
  x <- clean_numeric(values)
  n <- length(x)
  if (n < 3 || length(unique(x)) < 2) {
    return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  }
  if (n > SHAPIRO_MAX_N) return(list(statistic = .shapiro_w(x), pvalue = NA_real_, n = n))
  res <- tryCatch(shapiro.test(x), error = function(e) NULL)
  if (is.null(res)) return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  list(statistic = unname(res$statistic), pvalue = unname(res$p.value), n = n)
}

# ---------------------------------------------------------------------------
# Q-Q plot maths (utils/qq.js)
# ---------------------------------------------------------------------------

# Blom positions, (i - 3/8)/(n + 1/4), computed EXPLICITLY. R's own ppoints() is
# deliberately NOT used: it switches its constant by n (a = 3/8 only for n <= 10,
# then a = 1/2), whereas utils/qq.js uses Blom for ALL n — the house convention
# shared with the Shapiro-Wilk m-values. qnorm is R's genuine inverse normal, a
# third opinion against JS's Acklam approximation and scipy's ndtri.
.blom_positions <- function(n) (seq_len(n) - 0.375) / (n + 0.25)

# Mirror of utils/qq.js qqPoints, same flattened shape the emitter records:
# theoretical / sample arrays, linePar = c(slope, intercept) of the quartile
# reference line (R's qqline construction, but pinned to type-7 quantiles to
# match the JS and numpy — quantile()'s own default), and the pointwise
# car::qqPlot envelope SE_i = (slope / dnorm(z_i)) * sqrt(p_i (1 - p_i) / n).
qq_points <- function(values, confidence = 0.95) {
  x <- sort(clean_numeric(values))
  n <- length(x)
  if (n < 3) {
    return(list(theoretical = numeric(0), sample = numeric(0),
                linePar = c(NA_real_, NA_real_),
                bandLo = numeric(0), bandHi = numeric(0)))
  }
  positions <- .blom_positions(n)
  theoretical <- qnorm(positions)
  z_q <- qnorm(c(0.25, 0.75))
  s_q <- unname(quantile(x, c(0.25, 0.75), type = 7))
  slope <- (s_q[2] - s_q[1]) / (z_q[2] - z_q[1])
  intercept <- s_q[1] - slope * z_q[1]
  z_crit <- qnorm(1 - (1 - confidence) / 2)
  fit <- intercept + slope * theoretical
  se <- (slope / dnorm(theoretical)) * sqrt(positions * (1 - positions) / n)
  list(theoretical = theoretical, sample = x,
       linePar = c(slope, intercept),
       bandLo = fit - z_crit * se, bandHi = fit + z_crit * se)
}

# The probability-plot correlation r the Q-Q panel displays (and its qq_r metric
# column): Pearson r of the sorted sample against qnorm at the SAME Blom
# positions the plot draws. Undefined cases (n < 3, constant data) return NA,
# matching the JS null.
qq_correlation <- function(values) {
  x <- sort(clean_numeric(values))
  n <- length(x)
  if (n < 3 || length(unique(x)) < 2) return(list(r = NA_real_, n = n))
  theoretical <- qnorm(.blom_positions(n))
  list(r = cor(theoretical, x), n = n)
}

# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------

# Pairwise-complete rows, mirroring _corr_valid_pairs.
.corr_pairs <- function(x, y) {
  n <- min(length(x), length(y))
  xs <- suppressWarnings(as.numeric(unlist(x)[seq_len(n)]))
  ys <- suppressWarnings(as.numeric(unlist(y)[seq_len(n)]))
  ok <- is.finite(xs) & is.finite(ys)
  list(x = xs[ok], y = ys[ok])
}

# The JS contract is NaN-never-throws: too few pairs or a constant column gives NaN r and p
# rather than an error, so the guards come before cor.test.
correlate <- function(x, y, method = "pearson") {
  p <- .corr_pairs(x, y)
  n <- length(p$x)
  if (n < 3 || length(unique(p$x)) < 2 || length(unique(p$y)) < 2) {
    r <- suppressWarnings(
      if (method == "spearman") cor(rank(p$x), rank(p$y)) else cor(p$x, p$y)
    )
    return(list(r = if (length(r) == 1 && is.finite(r)) r else NA_real_,
                pvalue = NA_real_, n = n))
  }
  # exact = FALSE: the app (utils/correlation.js) and scipy's spearmanr give Spearman's p
  # from the t approximation. cor.test's default for n < 1290 without ties is the EXACT
  # AS 89 p-value, which differs (0.4350 vs 0.4367 on tp-correlation-auto-one-skewed).
  # Pearson ignores the flag.
  res <- suppressWarnings(cor.test(p$x, p$y, exact = FALSE,
                                   method = if (method == "spearman") "spearman" else "pearson"))
  list(r = unname(res$estimate), pvalue = unname(res$p.value), n = n)
}

# ---------------------------------------------------------------------------
# Multiple comparisons
# ---------------------------------------------------------------------------

# Non-finite entries and values outside [0, 1] are EXCLUDED from n and returned as NA, as
# p.adjust does for NA: a test that failed to run must not tighten the correction applied to
# the ones that did, and a value that cannot be a p-value is not clamped in.
p_adjust <- function(pvalues, method = "benjamini-hochberg") {
  name_map <- c("bonferroni" = "bonferroni", "holm" = "holm",
                "benjamini-hochberg" = "BH", "benjamini-yekutieli" = "BY")
  out <- rep(NA_real_, length(pvalues))
  keep_i <- integer(0); keep_v <- numeric(0)
  for (i in seq_along(pvalues)) {
    raw <- pvalues[[i]]
    if (is.null(raw) || length(raw) != 1 || is.logical(raw)) next
    if (is.character(raw) && !nzchar(raw)) next
    v <- suppressWarnings(as.numeric(raw))
    if (length(v) != 1 || !is.finite(v) || v < 0 || v > 1) next
    keep_i <- c(keep_i, i); keep_v <- c(keep_v, v)
  }
  if (!length(keep_i)) return(list(adjusted = out))
  if (identical(method, "none")) {
    out[keep_i] <- keep_v
    return(list(adjusted = out))
  }
  m <- name_map[[method]]
  if (is.null(m) || is.na(m)) stop(sprintf("p_adjust: unknown method '%s'", method))
  out[keep_i] <- p.adjust(keep_v, method = m)
  list(adjusted = out)
}

# ---------------------------------------------------------------------------
# Curve fitting
# ---------------------------------------------------------------------------

# Residual vector for the free-period multi-cosine model. Parameter layout matches the
# Python exactly — [B0, w0, o0, ..., O] with w a FREQUENCY, not a period. The frequency
# parameterisation is what makes the problem well conditioned; fitting period directly lets
# period and phase trade off against each other and the search wanders.
.cos_resid <- function(p, t, x) {
  m <- (length(p) - 1) %/% 3
  y <- rep(p[length(p)], length(t))
  for (i in seq_len(m)) {
    y <- y + p[3 * (i - 1) + 1] * cos(2 * pi * p[3 * (i - 1) + 2] * t + p[3 * (i - 1) + 3])
  }
  y - x
}

# Analytic Jacobian. Supplying this is what buys the ~1e-8 agreement with scipy; with
# optim's default finite differences the same fit is only good to ~1e-2.
.cos_jac <- function(p, t) {
  m <- (length(p) - 1) %/% 3
  jm <- matrix(0, nrow = length(t), ncol = length(p))
  for (i in seq_len(m)) {
    b <- p[3 * (i - 1) + 1]; w <- p[3 * (i - 1) + 2]; o <- p[3 * (i - 1) + 3]
    th <- 2 * pi * w * t + o
    jm[, 3 * (i - 1) + 1] <- cos(th)
    jm[, 3 * (i - 1) + 2] <- -b * 2 * pi * t * sin(th)
    jm[, 3 * (i - 1) + 3] <- -b * sin(th)
  }
  jm[, length(p)] <- 1
  jm
}

# Free-period cosinor: bounded period range, periodogram-seeded starts. Mirrors
# src/lib/utils/cosinor.js (FREE_PERIOD_DEFAULTS, resolvePeriodRange, scanPeriodogram,
# buildStarts) and the Python fit_cosine_curves. Without a bound the fit followed trends out
# to its internal frequency clamp on real activity data, silently.
FREE_PERIOD_DEFAULTS <- list(minPeriod = 1, maxPeriod = 48)
.SCAN_OVERSAMPLE <- 4; .SCAN_MIN_FREQS <- 64; .SCAN_MAX_FREQS <- 5000
.SCAN_MAX_POINTS <- 10000; .SCAN_PEAKS <- 3; .BOUND_RTOL <- 1e-6

# [min, max] period the free fit may use (t units). Missing ends fall back to the Nyquist
# period (2 x median spacing) and the record span; the short end is never below Nyquist.
resolve_period_range <- function(t, min_period = NULL, max_period = NULL) {
  ts <- sort(as.numeric(t)[is.finite(as.numeric(t))])
  if (length(ts) < 2) return(NULL)
  span <- ts[length(ts)] - ts[1]
  d <- diff(ts); d <- d[d > 0]
  if (!(span > 0) || !length(d)) return(NULL)
  nyq <- 2 * stats::median(d)
  umin <- suppressWarnings(as.numeric(if (is.null(min_period)) NA else min_period))
  umax <- suppressWarnings(as.numeric(if (is.null(max_period)) NA else max_period))
  lo <- if (is.finite(umin) && umin > 0) max(umin, nyq) else nyq
  hi <- if (is.finite(umax) && umax > 0) umax else span
  if (!(hi > lo)) return(NULL)
  list(minPeriod = lo, maxPeriod = hi, nyquist = nyq, span = span)
}

# Floating-mean least-squares periodogram on a uniform frequency grid; returns up to
# n_peaks local maxima (range ends included), strongest first, in cycles per t unit.
scan_periodogram <- function(t, x, min_period, max_period, n_peaks = .SCAN_PEAKS) {
  ok <- is.finite(t) & is.finite(x)
  t <- as.numeric(t)[ok]; x <- as.numeric(x)[ok]
  if (length(t) < 3) return(numeric(0))
  t_min <- min(t); span <- max(t) - t_min
  if (!(span > 0)) return(numeric(0))
  if (length(t) > .SCAN_MAX_POINTS) {
    # Long records: average into bins for the scan only (the fit uses every point).
    w <- min(span / .SCAN_MAX_POINTS, min_period / 8)
    nb <- floor(span / w) + 1
    b <- pmin(nb - 1, floor((t - t_min) / w)) + 1
    cnt <- tabulate(b, nb)
    st <- rowsum(t, b, reorder = TRUE); sx <- rowsum(x, b, reorder = TRUE)
    keep <- cnt[cnt > 0]
    t <- as.vector(st) / keep; x <- as.vector(sx) / keep
  }
  n <- length(t); y <- x - mean(x); tau <- t - t_min
  f_lo <- 1 / max_period; f_hi <- 1 / min_period
  nf <- min(.SCAN_MAX_FREQS,
            max(.SCAN_MIN_FREQS, ceiling(.SCAN_OVERSAMPLE * span * (f_hi - f_lo)) + 1))
  freqs <- f_lo + (f_hi - f_lo) * (0:(nf - 1)) / (nf - 1)
  power <- numeric(nf)
  for (k in seq_len(nf)) {
    th <- 2 * pi * freqs[k] * tau
    cc <- cos(th); ss <- sin(th)
    C <- sum(cc) / n; S <- sum(ss) / n
    CC <- sum(cc * cc) / n - C * C; SS <- sum(ss * ss) / n - S * S
    CS <- sum(cc * ss) / n - C * S
    YC <- sum(y * cc) / n; YS <- sum(y * ss) / n
    D <- CC * SS - CS * CS
    power[k] <- if (D > 1e-12) (SS * YC^2 + CC * YS^2 - 2 * CS * YC * YS) / D else 0
  }
  left <- c(-Inf, power[-nf]); right <- c(power[-1], -Inf)
  pk <- which(power >= left & power > right)
  pk <- pk[order(-power[pk], pk)]
  freqs[utils::head(pk, n_peaks)]
}

# OLS amplitude/phase/offset at fixed frequencies: a cos + b sin = B cos(2 pi w t + o).
.cos_linear_init <- function(t, x, fs) {
  X <- matrix(1, nrow = length(t), ncol = 1)
  for (w in fs) X <- cbind(X, cos(2 * pi * w * t), sin(2 * pi * w * t))
  coef <- tryCatch(solve(crossprod(X), crossprod(X, x)), error = function(e) NULL)
  p0 <- c()
  for (j in seq_along(fs)) {
    if (is.null(coef)) { p0 <- c(p0, 0, fs[j], 0); next }
    a <- coef[2 * j]; b <- coef[2 * j + 1]
    p0 <- c(p0, sqrt(a^2 + b^2), fs[j], atan2(-b, a))
  }
  c(p0, if (is.null(coef)) mean(x) else coef[1])
}

# Bounded Gauss-Newton refinement with step halving; parameters on a bound whose step
# points outward are held fixed for that step.
.gn_polish <- function(p, t, x, lb, ub, iters = 100) {
  cost <- function(q) sum(.cos_resid(q, t, x)^2)
  cur <- cost(p)
  for (it in seq_len(iters)) {
    r <- .cos_resid(p, t, x); J <- .cos_jac(p, t)
    g <- as.vector(crossprod(J, r))
    free <- !((p <= lb & g > 0) | (p >= ub & g < 0))
    JtJ <- crossprod(J[, free, drop = FALSE])
    step <- tryCatch(solve(JtJ, g[free]), error = function(e) NULL)
    if (is.null(step)) break
    accepted <- FALSE; h <- 1
    for (k in 1:30) {
      q <- p; q[free] <- p[free] - h * step
      q <- pmin(ub, pmax(lb, q))
      cq <- cost(q)
      if (cq < cur) { accepted <- TRUE; break }
      h <- h / 2
    }
    if (!accepted) break
    rel <- (cur - cq) / (cur + 1e-10)
    p <- q; cur <- cq
    if (rel < 1e-15) break
  }
  p
}

# Multi-start free-period cosine fit from the same periodogram-peak starts as the JS and
# Python; lowest cost wins. Amplitude and phase are SOLVED for at each seed frequency: a
# phase-0 seed can be anti-correlated with the data, and an optimiser then shrinks the
# AMPLITUDE toward zero rather than rotating the phase (the Python port once returned
# amplitude 3.3 against a true 38 that way).
fit_cosine_curves <- function(t, x, n_curves = 1, min_period = NULL, max_period = NULL) {
  ok <- is.finite(t) & is.finite(x)
  t <- as.numeric(t)[ok]; x <- as.numeric(x)[ok]
  if (length(t) < 4 * n_curves) return(NULL)
  rng <- resolve_period_range(t, min_period, max_period)
  if (is.null(rng)) return(NULL)
  f_lo <- 1 / rng$maxPeriod; f_hi <- 1 / rng$minPeriod
  clampf <- function(w) min(f_hi, max(f_lo, w))

  cost <- function(p) 0.5 * sum(.cos_resid(p, t, x)^2)
  grad <- function(p) as.vector(crossprod(.cos_jac(p, t), .cos_resid(p, t, x)))

  peaks <- scan_periodogram(t, x, rng$minPeriod, rng$maxPeriod, max(.SCAN_PEAKS, n_curves))
  top <- if (length(peaks)) peaks else clampf(1 / 24)
  sets <- if (n_curves == 1) {
    lapply(top, function(w) w)
  } else {
    list(vapply(seq_len(n_curves), function(i)
           if (i <= length(top)) top[i] else clampf(top[1] * i), numeric(1)),
         vapply(seq_len(n_curves), function(i) clampf(top[1] * i), numeric(1)))
  }
  lb <- c(rep(c(-Inf, f_lo, -Inf), n_curves), -Inf)
  ub <- c(rep(c(Inf, f_hi, Inf), n_curves), Inf)
  best <- NULL
  for (fs in sets) {
    p0 <- .cos_linear_init(t, x, fs)
    fit <- tryCatch(
      optim(p0, cost, grad, method = "L-BFGS-B", lower = lb, upper = ub,
            control = list(factr = 1, pgtol = 0, maxit = 5000)),
      error = function(e) NULL)
    if (!is.null(fit) && (is.null(best) || fit$value < best$value)) best <- fit
  }
  if (is.null(best)) return(NULL)

  # L-BFGS-B stops ~1e-6 short of the least-squares optimum on this badly scaled problem
  # (the frequency gradient is ~t times the others); a bounded Gauss-Newton polish from
  # its answer reaches the optimum the JS (LM) and Python (TRF) find, to ~1e-9.
  p <- .gn_polish(best$par, t, x, lb, ub)
  # Canonical form: B >= 0, phase in (-pi, pi] (B cos(th) = -B cos(th + pi)).
  for (i in seq_len(n_curves)) {
    ib <- 3 * (i - 1) + 1
    if (p[ib] < 0) { p[ib] <- -p[ib]; p[ib + 2] <- p[ib + 2] + pi }
    ph <- p[ib + 2] %% (2 * pi)
    if (ph > pi) ph <- ph - 2 * pi
    p[ib + 2] <- ph
  }
  pred <- .cos_resid(p, t, x) + x
  rss <- sum((x - pred)^2)
  ss_tot <- sum((x - mean(x))^2)
  cosines <- lapply(seq_len(n_curves), function(i) {
    list(amplitude = p[3 * (i - 1) + 1],
         frequency = p[3 * (i - 1) + 2],
         phase = p[3 * (i - 1) + 3])
  })
  at_bound <- vapply(seq_len(n_curves), function(i) {
    w <- p[3 * (i - 1) + 2]
    if (abs(w - f_lo) <= .BOUND_RTOL * f_lo) "max"
    else if (abs(w - f_hi) <= .BOUND_RTOL * f_hi) "min" else NA_character_
  }, character(1))
  list(parameters = list(A = 0, cosines = cosines, O = p[length(p)]),
       fitted = pred, residuals = x - pred,
       rmse = sqrt(rss / length(t)),
       rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0,
       rss = rss,
       diagnostics = list(converged = best$convergence == 0, atBound = at_bound,
                          periodRange = c(rng$minPeriod, rng$maxPeriod)))
}

# ---------------------------------------------------------------------------
# Parity entry point
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Table processes
# ---------------------------------------------------------------------------
#
# Each takes (args, env) and returns TRUE if it wrote anything. `env` carries `cols` and
# `raw_data` so writes are visible to later analyses, mirroring the Python port where
# raw_data is a shared dict.

tp_threshold <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  key <- as.character(x_in)
  if (x_in == -1 || is.null(env$cols[[key]])) return(FALSE)
  d <- unlist(col_data(env$cols[[key]], env$cols, env$raw_data), use.names = FALSE)
  th <- as.numeric(if (is.null(args$threshold)) 0 else args$threshold)
  comp <- if (is.null(args$comparison)) ">=" else args$comparison
  cmp <- switch(comp,
                ">"  = function(v) v > th,
                "<"  = function(v) v < th,
                "<=" = function(v) v <= th,
                function(v) v >= th)      # ">=" and any unknown value
  out <- vapply(d, function(v) {
    n <- suppressWarnings(as.numeric(v))
    if (length(n) != 1 || is.na(n)) NA_real_ else as.numeric(cmp(n))
  }, numeric(1), USE.NAMES = FALSE)
  set_col(env, env$cols, out_id(args, "binary"), out, type = "number")
  length(out) > 0
}

# The fit nodes' resid_<yId> column (residualSupport.js writeResidual / FitFunction's
# residualColumn; Python: _fit_residuals): the fitted model evaluated at EVERY input x (in the
# fit's hour frame), then observed - predicted, full input length, NaN wherever y or x is
# missing or the prediction is not finite. Only the valid x are handed to `evaluate`: the app
# evaluates the missing ones too, but discards them, and the periodic double logistic's tile
# range is taken over the valid x either way (stats.js min/max skip missing values).
.fit_residuals <- function(evaluate, x_full, y_full) {
  xl <- as.list(x_full); yl <- as.list(y_full)
  ok <- which(!vapply(xl, .js_invalid, logical(1)))
  pred <- rep(NaN, length(xl))
  if (length(ok)) {
    pred[ok] <- suppressWarnings(as.numeric(unlist(
      evaluate(vapply(xl[ok], .js_number, numeric(1))), use.names = FALSE)))
  }
  vapply(seq_along(yl), function(i) {
    if (i > length(xl) || .js_invalid(yl[[i]]) || .js_invalid(xl[[i]]) ||
        !is.finite(pred[i])) return(NaN)
    .js_number(yl[[i]]) - pred[i]
  }, numeric(1))
}

tp_trendfit <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  model <- if (is.null(args$model)) "linear" else args$model
  deg <- as.integer(if (is.null(args$polyDegree)) 2 else args$polyDegree)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  # Output grid in the fit's hour frame, origin = the input's minimum time (STAT-19).
  # Column or sequence output x (resolve_output_x, outputXSequence.js).
  frm <- resolve_output_x(x_col, args, env$cols, env$raw_data)
  output_x <- frm$out
  xs <- NULL; any_valid <- FALSE; stats_by_y <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    pr <- .pgram_pairs(t, col_data(env$cols[[yk]], env$cols, env$raw_data))
    if (!length(pr$t)) next
    tt <- pr$t; yv <- pr$y
    refused <- (identical(model, "logarithmic") && any(tt <= 0)) ||
               (identical(model, "exponential") && any(yv <= 0)) ||
               (identical(model, "polynomial") && length(tt) <= deg) ||
               (length(tt) >= 2 && all(tt == tt[1]))
    if (refused) next
    res <- fit_trend(tt, yv, model, deg)
    if (is.null(res)) next
    if (is.null(xs)) {
      xs <- if (!is.null(output_x)) output_x else tt
      if (!is.null(frm$origin)) set_col(env, env$cols, out_id(args, "trendx"),
                                        frm$origin + xs * 3600000, type = "time")
      else set_col(env, env$cols, out_id(args, "trendx"), xs, type = "number")
    }
    yy <- evaluate_trend_at_points(res$parameters, model, xs)
    y_out <- out_id(args, paste0("trendy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "trendy")
    set_col(env, env$cols, y_out, yy, type = "number")
    # Residuals (TrendFit.svelte): only with the x output wired; the trend evaluated at every
    # input x.
    rid <- out_id(args, paste0("resid_", y_id))
    if (rid != -1 && out_id(args, "trendx") != -1) {
      prm <- res$parameters
      set_col(env, env$cols, rid,
              .fit_residuals(function(p) evaluate_trend_at_points(prm, model, p), t,
                             col_data(env$cols[[yk]], env$cols, env$raw_data)),
              type = "number")
    }
    stats_by_y[[yk]] <- res
    any_valid <- TRUE
  }
  if (any_valid) {
    # Fit-quality and linear-coefficient ports, one value per y (as the Python port).
    pick <- function(f) vapply(y_ins, function(y) {
      r <- stats_by_y[[as.character(y)]]
      v <- if (is.null(r)) NULL else f(r)
      if (is.null(v)) NaN else as.numeric(v)
    }, numeric(1))
    set_col(env, env$cols, out_id(args, "r2"), pick(function(r) r$rSquared), type = "number")
    set_col(env, env$cols, out_id(args, "rmse"), pick(function(r) r$rmse), type = "number")
    set_col(env, env$cols, out_id(args, "coef_slope"), pick(function(r) r$parameters$slope),
            type = "number")
    set_col(env, env$cols, out_id(args, "coef_intercept"),
            pick(function(r) r$parameters$intercept), type = "number")
  }
  any_valid
}

# Port of SmoothedData.svelte smootheddata, matching the Python port: per y, rows kept by the
# house rule on x and y, converted with Number(), fewer than 3 skipped, stably sorted by x.
# The x output is the FIRST valid y's sorted x (a time input written back as epoch ms from
# the first time). Residual outputs resid_<yId> are raw - smoothed.
tp_smootheddata <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  x_col <- env$cols[[as.character(x_in)]]
  is_time <- identical(x_col$type, "time")
  x_data <- if (is_time) col_hours(x_col, env$cols, env$raw_data)
            else col_data(x_col, env$cols, env$raw_data)
  origin_ms <- if (is_time) {
    o <- time_origin_ms(x_col, env$cols, env$raw_data)
    if (is.null(o)) NA_real_ else o
  } else NA_real_
  x_out <- NULL; y_res <- list(); raw_by <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y_data <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    xl <- as.list(x_data); yl <- as.list(y_data)
    n <- min(length(xl), length(yl))
    keep <- which(vapply(seq_len(n), function(i)
      !.js_invalid(xl[[i]]) && !.js_invalid(yl[[i]]), logical(1)))
    if (length(keep) < 3) next
    xs <- vapply(xl[keep], .js_number, numeric(1))
    ys <- vapply(yl[keep], .js_number, numeric(1))
    o <- order(xs, method = "radix")
    xs <- xs[o]; ys <- ys[o]
    sy <- tryCatch(smooth_arrays(xs, ys, args$smootherType, args)$y, error = function(e) NULL)
    if (is.null(sy)) next
    if (is.null(x_out)) x_out <- xs
    y_res[[yk]] <- sy; raw_by[[yk]] <- ys
    any_valid <- TRUE
  }
  for (pp in args$preProcesses) {
    nm <- pp$processName
    if (is.null(nm)) next
    for (yk in names(y_res)) {
      y_res[[yk]] <- run_column_process(tolower(gsub(" ", "", nm)), y_res[[yk]],
                                        if (is.null(pp$processArgs)) list() else pp$processArgs,
                                        env$cols, env$raw_data)
    }
  }
  xo <- out_id(args, "smoothedx")
  if (any_valid && xo != -1) {
    if (is_time && is.finite(origin_ms)) {
      set_col(env, env$cols, xo, origin_ms + x_out * 3600000, type = "time")
    } else {
      set_col(env, env$cols, xo, x_out, type = "number")
    }
    for (yk in names(y_res)) {
      set_col(env, env$cols, out_id(args, paste0("smoothedy_", yk)), y_res[[yk]],
              type = "number")
      rid <- out_id(args, paste0("resid_", yk))
      if (rid != -1) {
        p <- y_res[[yk]]
        r <- ifelse(is.finite(p), raw_by[[yk]] - p, NaN)
        set_col(env, env$cols, rid, r, type = "number")
      }
    }
  }
  any_valid
}

tp_describedata <- function(args, env) {
  y_ins <- id_list(args$yIN)
  if (!length(y_ins)) return(FALSE)
  keys <- c("n", "mean", "median", "sd", "min", "max", "range",
            "q1", "q3", "iqr", "skewness", "kurtosis")
  rows <- setNames(vector("list", length(keys) + 1), c("variable", keys))
  for (k in names(rows)) rows[[k]] <- c()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    st <- describe_stats(col_data(env$cols[[yk]], env$cols, env$raw_data))
    nm <- env$cols[[yk]]$name
    rows$variable <- c(rows$variable, if (is.null(nm)) yk else nm)
    for (k in keys) rows[[k]] <- c(rows[[k]], st[[k]])
  }
  .write_result_rows(args, env, rows)
}

tp_normalitytest <- function(args, env) {
  y_ins <- id_list(args$yIN)
  if (!length(y_ins)) return(FALSE)
  method <- if (is.null(args$method)) "shapiro" else args$method
  alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
  fn <- switch(method, dagostino = d_agostino, jarquebera = jarque_bera, shapiro_wilk)
  rows <- list(variable = c(), statistic = c(), pvalue = c(), n = c(), normal = c())
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- fn(col_data(env$cols[[yk]], env$cols, env$raw_data))
    nm <- env$cols[[yk]]$name
    rows$variable <- c(rows$variable, if (is.null(nm)) yk else nm)
    rows$statistic <- c(rows$statistic, res$statistic)
    rows$pvalue <- c(rows$pvalue, res$pvalue)
    rows$n <- c(rows$n, res$n)
    # A NaN p (the test could not run) is NOT evidence of normality, so it stays NA
    # rather than collapsing to 0/1.
    rows$normal <- c(rows$normal,
                     if (is.na(res$pvalue)) NA_real_ else as.numeric(res$pvalue > alpha))
  }
  .write_result_rows(args, env, rows)
}

# Write a result TABLE: `rows` is a named list of equal-length vectors, one column each.
.write_result_rows <- function(args, env, rows) {
  wrote <- FALSE
  for (k in names(rows)) {
    oid <- out_id(args, k)
    if (oid == -1) next
    v <- rows[[k]]
    set_col(env, env$cols, oid, v,
            type = if (is.character(v)) "category" else "number")
    wrote <- TRUE
  }
  wrote
}

# ---------------------------------------------------------------------------
# Column processes
# ---------------------------------------------------------------------------
#
# Ported before most analyses on purpose: a column carrying ANY transform hits the strict
# dispatcher, so without these the R runtime refuses most real sessions regardless of how
# many analyses it implements.

# Add.svelte / Multiply.svelte: missing in (house rule) -> NA out; numeric text is its value.
# value = Number(args.value), so an absent value is NaN, as in the JS.
cp_add <- function(x, args, cols, raw_data) {
  v <- if (is.null(args$value)) NaN else .js_number(args$value)
  vapply(as.list(x), function(xi) if (.js_invalid(xi)) NA_real_ else .js_number(xi) + v,
         numeric(1), USE.NAMES = FALSE)
}

cp_multiply <- function(x, args, cols, raw_data) {
  v <- if (is.null(args$value)) NaN else .js_number(args$value)
  vapply(as.list(x), function(xi) if (.js_invalid(xi)) NA_real_ else .js_number(xi) * v,
         numeric(1), USE.NAMES = FALSE)
}

# "Substitute", not "subtract" — the JS registry key `Sub` is find-and-replace. Guessing
# subtraction here would silently corrupt every column that used it.
# Sub.svelte asNumber / subMatches (matching the Python port): a missing cell (NULL or NA)
# matches only a missing find; numeric compare when both sides are numbers or non-blank
# numeric strings; otherwise String() equality (TRUE does not match 1, "" does not match 0).
.sub_as_number <- function(v) {
  if (is.logical(v)) return(NULL)
  if (is.numeric(v)) return(as.numeric(v))
  if (is.character(v) && nzchar(.js_trim(v)) && !is.nan(.js_number(v))) return(.js_number(v))
  NULL
}
sub_matches <- function(v, find) {
  miss <- function(z) is.null(z) || length(z) != 1 || (is.atomic(z) && is.na(z) && !is.nan(z))
  if (miss(find)) return(miss(v))
  if (miss(v)) return(FALSE)
  a <- .sub_as_number(v); b <- .sub_as_number(find)
  if (!is.null(a) && !is.null(b)) return(isTRUE(a == b))
  str <- function(z) if (is.logical(z)) (if (z) "true" else "false") else js_string(z)
  identical(str(v), str(find))
}
cp_substitute <- function(x, args, cols, raw_data) {
  find <- args$find; replace <- args$replace
  out <- lapply(as.list(x), function(xi) if (sub_matches(xi, find)) replace else xi)
  if (all(vapply(out, function(v) is.null(v) || (length(v) == 1 && (is.numeric(v) ||
      (is.logical(v) && is.na(v)))), logical(1))))
    vapply(out, function(v) if (is.null(v)) NA_real_ else as.numeric(v), numeric(1))
  else out
}

# Normalize.svelte, key 'normalize' (matching the Python port): present values by the house rule; missing
# cells stay missing, also in the degenerate cases (zero SD/range/MAD/magnitude: every present
# value 0, or customMin for min-max). Type from normalizationType (default z-score).
cp_normalize <- function(x, args, cols, raw_data) {
  typ <- if (!is.null(args$normalizationType) && nzchar(args$normalizationType))
    args$normalizationType else if (!is.null(args$method)) args$method else "z-score"
  # JS numArg: the default only when absent, blank or not finite; a 0 is kept (STAT-21)
  num_or <- function(v, d) {
    n <- if (is.null(v) || identical(v, "")) NaN else .js_number(v)
    if (is.finite(n)) n else d
  }
  cmin <- num_or(args$customMin, 0); cmax <- num_or(args$customMax, 1)
  xl <- as.list(x)
  ok <- !vapply(xl, .js_invalid, logical(1))
  arr <- vapply(xl, function(v) if (.js_invalid(v)) NA_real_ else .js_number(v), numeric(1))
  if (!any(ok)) return(arr)
  sub <- arr[ok]
  med <- function(a) { a <- sort(a); n <- length(a)
    if (n %% 2 == 0) (a[n / 2] + a[n / 2 + 1]) / 2 else a[(n + 1) / 2] }
  out_sub <- switch(typ,
    "z-score" = {
      m <- mean(sub); s <- sqrt(sum((sub - m)^2) / length(sub))
      if (s == 0) rep(0, length(sub)) else (sub - m) / s
    },
    "min-max" = {
      lo <- min(sub); rng <- max(sub) - lo
      if (rng == 0) rep(cmin, length(sub)) else ((sub - lo) / rng) * (cmax - cmin) + cmin
    },
    "robust" = {
      md <- med(sub); mad <- med(abs(sub - md))
      if (mad == 0) rep(0, length(sub)) else (sub - md) / mad
    },
    "unit-vector" = {
      nrm <- sqrt(sum(sub * sub))
      if (nrm == 0) rep(0, length(sub)) else sub / nrm
    },
    sub)
  arr[ok] <- out_sub
  arr
}

cp_removetrend <- function(x, args, cols, raw_data) {
  x_col_id <- if (is.null(args$xColId)) -1 else args$xColId
  x_col <- if (x_col_id != -1) cols[[as.character(x_col_id)]] else NULL
  t <- if (!is.null(x_col)) t_for_col(x_col, cols, raw_data) else seq_along(x) - 1
  xl <- as.list(x); tl <- as.list(t)
  n <- min(length(xl), length(tl))
  # The house rule on BOTH sides (validPairs), then Number().
  ok <- vapply(seq_along(xl), function(i)
    i <= n && !.js_invalid(tl[[i]]) && !.js_invalid(xl[[i]]), logical(1))
  y <- vapply(xl, function(v) if (.js_invalid(v)) NA_real_ else .js_number(v), numeric(1))
  t <- vapply(seq_along(xl), function(i)
    if (i <= n && !.js_invalid(tl[[i]])) .js_number(tl[[i]]) else NA_real_, numeric(1))
  if (sum(ok) < 2) return(y)
  model <- if (is.null(args$model)) "linear" else args$model
  deg <- as.integer(if (is.null(args$polyDegree)) 2 else args$polyDegree)
  tt <- t[ok]; yy <- y[ok]
  # Refuse-and-pass-through (mirrors utils/fitDomain.js checkTrendFitDomain +
  # shouldRefuse in RemoveTrend.svelte): a fit outside its model's domain must
  # not silently emit an all-NaN column, so the input passes through unchanged.
  refused <- (identical(model, "logarithmic") && any(tt <= 0)) ||
             (identical(model, "exponential") && any(yy <= 0)) ||
             (identical(model, "polynomial") && length(tt) <= deg) ||
             (length(tt) >= 2 && all(tt == tt[1]))
  if (refused) return(y)
  fit <- fit_trend(tt, yy, model, deg)
  if (is.null(fit)) return(y)
  det <- yy - fit$fitted
  ws <- args$windowSize
  if (isTRUE(args$slidingWindow) && is.numeric(ws) && length(ws) == 1 && is.finite(ws) &&
      ws > 1) {
    # RemoveTrend.svelte slidingStandardisation: one-pass sqrt(E[x^2] - mean^2), and a zero
    # or NaN spread becomes 1.
    half <- floor(ws / 2); nd <- length(det)
    det <- vapply(seq_len(nd), function(i) {
      w <- det[max(1, i - half):min(nd, i + half)]
      m <- mean(w)
      v <- sum(w * w) / length(w) - m * m
      sd <- if (is.finite(v) && v > 0) sqrt(v) else 0
      (det[i] - m) / (if (sd == 0) 1 else sd)
    }, numeric(1))
  }
  out <- y
  out[ok] <- det
  out
}

# ---------------------------------------------------------------------------
# Binning
# ---------------------------------------------------------------------------

# The app's per-bin aggregates (binData's aggFunctions) over ys[start + 1 .. end] of the
# x-sorted values (start/end are the app's 0-based half-open indices). An unknown name is
# the mean, as in the app.
bin_agg <- function(agg_func, ys, start, end) {
  k <- end - start
  if (identical(agg_func, "count")) return(k)
  sl <- if (k > 0) ys[(start + 1):end] else numeric(0)
  if (agg_func %in% c("min", "max")) {
    if (!k) return(NA_real_)  # the app's null for an empty bin
    return(if (identical(agg_func, "min")) min(sl) else max(sl))
  }
  if (identical(agg_func, "median")) {
    if (!k) return(NA_real_)
    sl <- sort(sl); mid <- k %/% 2
    return(if (k %% 2 == 0) (sl[mid] + sl[mid + 1]) / 2 else sl[mid + 1])
  }
  if (identical(agg_func, "stddev")) {
    if (k < 2) return(NA_real_)  # sample SD undefined below two points, as sd() gives NA
    m <- bin_agg("mean", ys, start, end)
    ss <- 0
    for (v in sl) ss <- ss + (v - m) * (v - m)
    return(sqrt(ss / (k - 1)))  # SAMPLE standard deviation, as the app
  }
  if (!k) return(NA_real_)
  tot <- 0
  for (v in sl) tot <- tot + v  # a plain left-to-right sum, as the app's loop
  tot / k
}

# Port of plotbits/helpers/wrangleData.js::binData, both modes; returns list(bins, bin_ends,
# y_out, dropped_count) like the app's {bins, binEnds, y_out, droppedCount}.
#
# Pairs with a missing or non-finite x or y are dropped, as the app now does (it used to
# filter with the global isFinite, which reads a null as 0 and binned it; never copied here;
# fixtures tp-binneddata-missing-*), then sorted by x (stable, as the app). Membership uses the app's 1e-10 edge tolerance: a value within 1e-10 BELOW an
# edge belongs to the next bin.
#
# Uniform mode (cuts NULL or fewer than two edges): bins [start, start + bin_size) at
# start = bin_start + i * step (step = step_size when positive, else bin_size). The loop
# pushes a bin and THEN checks the end condition, so there is always one bin at or past the
# last datum, matching the app rather than the more obvious pre-check.
#
# Cuts mode (`cuts`, strictly ascending; the caller sorts and dedupes): one bin per pair of
# consecutive edges, each [a, b) except the LAST, which is [a, b]. Values outside the edges
# are dropped. Cuts that are not strictly ascending give no bins, as in the app.
bin_data <- function(x_values, y_values, bin_size, bin_start = 0, step_size = NULL,
                     agg_func = "mean", cuts = NULL) {
  empty <- list(bins = numeric(0), bin_ends = numeric(0), y_out = numeric(0),
                dropped_count = 0)
  use_cuts <- !is.null(cuts) && length(cuts) >= 2
  xa <- suppressWarnings(as.numeric(unlist(x_values, use.names = FALSE)))
  if (!length(xa)) return(empty)
  if (use_cuts) {
    if (any(!(diff(cuts) > 0))) return(empty)
  } else {
    step <- if (!is.null(step_size) && isTRUE(step_size > 0)) step_size else bin_size
    if (is.null(step) || !isTRUE(step > 0) || !is.finite(step)) return(empty)
  }
  ya <- suppressWarnings(as.numeric(unlist(y_values, use.names = FALSE)))
  length(ya) <- length(xa)
  ok <- is.finite(xa) & is.finite(ya)
  xa <- xa[ok]; ya <- ya[ok]
  n <- length(xa)
  if (!n) return(empty)
  o <- order(xa, method = "radix")  # stable
  xs <- xa[o]; ys <- ya[o]
  eps <- 1e-10

  if (use_cuts) {
    num_bins <- length(cuts) - 1
    y_out <- numeric(num_bins)
    dropped <- 0
    pointer <- 0  # 0-based count of consumed points, as the app's index
    while (pointer < n && xs[pointer + 1] < cuts[1] - eps) {
      pointer <- pointer + 1; dropped <- dropped + 1
    }
    for (i in seq_len(num_bins)) {
      s0 <- pointer; e0 <- s0
      if (i == num_bins) {
        while (e0 < n && xs[e0 + 1] <= cuts[i + 1] + eps) e0 <- e0 + 1
      } else {
        while (e0 < n && xs[e0 + 1] < cuts[i + 1] - eps) e0 <- e0 + 1
      }
      y_out[i] <- bin_agg(agg_func, ys, s0, e0)
      pointer <- e0
    }
    dropped <- dropped + n - pointer
    return(list(bins = cuts[-length(cuts)], bin_ends = cuts[-1], y_out = y_out,
                dropped_count = dropped))
  }

  bins <- c(); bin_ends <- c(); y_out <- c()
  dropped <- 0; current <- bin_start; bin_index <- 0; pointer <- 0
  while (pointer < n && xs[pointer + 1] < current - eps) {
    pointer <- pointer + 1; dropped <- dropped + 1
  }
  repeat {
    b_end <- current + bin_size
    bins <- c(bins, current); bin_ends <- c(bin_ends, b_end)
    while (pointer < n && xs[pointer + 1] < current - eps) pointer <- pointer + 1
    s0 <- pointer; e0 <- s0
    while (e0 < n && xs[e0 + 1] < b_end - eps) e0 <- e0 + 1
    y_out <- c(y_out, bin_agg(agg_func, ys, s0, e0))
    if (current >= xs[n]) break
    bin_index <- bin_index + 1
    # From bin_start each time, not by accumulation, so the edges do not drift.
    current <- bin_start + bin_index * step
  }
  list(bins = bins, bin_ends = bin_ends, y_out = y_out, dropped_count = dropped)
}

# BinnedData's cuts at the node boundary: the finite edges, deduplicated and sorted.
binned_cuts <- function(raw) {
  v <- suppressWarnings(as.numeric(unlist(raw, use.names = FALSE)))
  sort(unique(v[is.finite(v)]))
}

# Port of BinnedData.svelte `binneddata(args)`: uniform bins (binSize / binStart /
# effectiveStep) or custom edges (binMode "cuts"). Returns the node's validity; like the app
# it writes NOTHING when invalid.
tp_binneddata <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  bin_mode <- if (identical(args$binMode, "cuts")) "cuts" else "uniform"
  bin_size <- if (is.null(args$binSize)) 1 else suppressWarnings(as.numeric(args$binSize))
  bin_start <- if (is.null(args$binStart)) 0 else suppressWarnings(as.numeric(args$binStart))
  # As the app's effectiveStep(args): stepSize (saved with a 0.25 default) is the step only
  # when diffStep is ticked and it is a usable positive number, otherwise binSize.
  step_arg <- if (is.null(args$stepSize)) NA_real_
              else suppressWarnings(as.numeric(args$stepSize))
  step <- if (isTRUE(args$diffStep) && isTRUE(step_arg > 0)) step_arg else bin_size
  agg <- if (is.null(args$aggFunction)) "mean" else args$aggFunction
  cuts <- binned_cuts(args$cuts)
  x_col <- env$cols[[as.character(x_in)]]
  if (identical(bin_mode, "cuts")) {
    # The app refuses custom edges on a time x and needs at least two distinct edges.
    if (identical(x_col$type, "time") || length(cuts) < 2) return(FALSE)
  } else if (!length(bin_size) || !length(bin_start) || !isTRUE(bin_size > 0)) {
    return(FALSE)
  }
  x_data <- t_for_col(x_col, env$cols, env$raw_data)
  cuts_arg <- if (identical(bin_mode, "cuts")) cuts else NULL
  bins_x <- NULL; y_results <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    b <- bin_data(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                  bin_size, bin_start, step, agg, cuts_arg)
    if (length(b$bins)) {
      # The shared x is the LONGEST y's bins (each y's uniform bins are a prefix of it).
      if (is.null(bins_x) || length(b$bins) > length(bins_x)) bins_x <- b$bins
      y_results[[yk]] <- b$y_out
    }
  }
  if (is.null(bins_x)) return(FALSE)
  for (yk in names(y_results)) {  # pad to the shared x with NaN (an empty bin)
    n_pad <- length(bins_x) - length(y_results[[yk]])
    if (n_pad > 0) y_results[[yk]] <- c(y_results[[yk]], rep(NaN, n_pad))
  }
  x_out <- out_id(args, "binnedx")
  if (x_out == -1) return(TRUE)  # valid, but the app writes nothing without an x output
  # As BinnedData.svelte writes it: the x output stores bin STARTS. A time input gives a time
  # column of epoch ms (origin + start hours, origin = the input's earliest sample, the
  # baseline hoursSinceStart used); anything else gives a 'bin' column, whose col_data then
  # adds half the bin width. Uniform bins carry bin_width = binSize; cut bins carry the edge
  # list (cuts_list) and the app's null binWidth, so they read back their starts.
  key <- as.character(x_out)
  if (identical(x_col$type, "time")) {
    xs <- suppressWarnings(as.numeric(unlist(col_data(x_col, env$cols, env$raw_data),
                                             use.names = FALSE)))
    origin <- if (any(is.finite(xs))) min(xs[is.finite(xs)]) else 0
    set_col(env, env$cols, x_out, origin + bins_x * 3600000, type = "time")
    if (!is.null(env$cols[[key]])) env$cols[[key]]["time_format"] <- list(NULL)
  } else {
    set_col(env, env$cols, x_out, bins_x, type = "bin")
  }
  if (!is.null(env$cols[[key]])) {
    if (identical(bin_mode, "cuts")) {
      env$cols[[key]]["bin_width"] <- list(NULL)
      env$cols[[key]]$cuts_list <- cuts
    } else {
      env$cols[[key]]$bin_width <- bin_size
      env$cols[[key]]["cuts_list"] <- list(NULL)
    }
  }
  for (yk in names(y_results)) {
    y_out <- out_id(args, paste0("binnedy_", yk))
    if (y_out == -1) y_out <- out_id(args, "binnedy")
    set_col(env, env$cols, y_out, y_results[[yk]], type = "number")
  }
  TRUE
}

# ---------------------------------------------------------------------------
# Cosinor (Halberg fixed-period)
# ---------------------------------------------------------------------------

# Fixed-period cosinor is LINEAR in its parameters: regress on cos/sin of each harmonic and
# solve by least squares. No optimiser, and no risk of landing in a different basin from the
# other ports — unlike the free-period fit, which is why that one needed the analytic
# Jacobian treatment.
# FIT-7, cosinor.js acrophaseCIDetermined: an acrophase CI only when the zero-amplitude test
# (the model's and the harmonic's own) is significant and 2 * t * SE is narrower than the
# harmonic's period. Bingham, Arbogast, Guillaume, Lee and Halberg (1982), Chronobiologia
# 9:397-439; Cornelissen (2014), Theor Biol Med Model 11:16.
acrophase_ci_determined <- function(p_overall, p_harmonic, alpha, tcrit, se, period) {
  if (!isTRUE(p_overall < alpha) || !isTRUE(p_harmonic < alpha)) return(FALSE)
  isTRUE(2 * tcrit * se < period)
}

fit_cosinor_fixed <- function(t, y, period = 24, n_harmonics = 1, alpha = 0.05) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  ok <- is.finite(t) & is.finite(y)
  t <- t[ok]; y <- y[ok]
  n <- length(t)
  if (n < 2 * n_harmonics + 2) return(NULL)
  omega <- 2 * pi / period
  X <- matrix(1, nrow = n, ncol = 1)
  for (k in seq_len(n_harmonics)) X <- cbind(X, cos(k * omega * t), sin(k * omega * t))
  beta <- tryCatch(qr.solve(X, y), error = function(e) NULL)
  if (is.null(beta)) return(NULL)
  fitted <- as.vector(X %*% beta)
  resid <- y - fitted
  p <- ncol(X)
  df_resid <- n - p
  if (df_resid <= 0) return(NULL)
  rss <- sum(resid^2)
  mse <- rss / df_resid
  # sqrt(MSE), i.e. over the residual DF — matching cosinor.js. Dividing by n instead gives
  # a ~0.9% low RMSE on a 168-point window, which went unnoticed in the Python port until a
  # fixture finally compared rmse.
  rmse <- sqrt(mse)
  # sqrt(SSres / n): the RMSE every other fit reports (the `rmse_n` port; cosinor.js RMSE_n).
  rmse_n <- sqrt(rss / n)
  ss_tot <- sum((y - mean(y))^2)
  r2 <- if (ss_tot > 0) 1 - rss / ss_tot else 0
  cov <- tryCatch(mse * solve(crossprod(X)), error = function(e) matrix(0, p, p))
  M <- beta[1]
  se_m <- sqrt(max(cov[1, 1], 0))
  tcrit <- qt(1 - alpha / 2, df_resid)
  df1 <- p - 1
  f_stat <- if (rss > 0) ((ss_tot - rss) / df1) / (rss / df_resid) else Inf
  # Upper tail at max(0, F): a rounding-negative F gives p = 1 (cosinor.js pUpperFromF).
  pf_val <- if (is.finite(f_stat)) pf(max(0, f_stat), df1, df_resid, lower.tail = FALSE)
            else if (identical(f_stat, Inf)) 0 else NA_real_
  harmonics <- list()
  for (k in seq_len(n_harmonics)) {
    ib <- 1 + 2 * (k - 1) + 1
    ig <- ib + 1
    b <- beta[ib]; g <- beta[ig]
    amp <- sqrt(b^2 + g^2)
    phi <- atan2(-g, b)                      # JS: atan2(-gamma, beta)
    acro <- (-phi / (k * omega)) %% (period / k)  # time of peak (the one convention)
    var_b <- max(cov[ib, ib], 0); var_g <- max(cov[ig, ig], 0); cov_bg <- cov[ib, ig]
    se_a <- if (amp > 0) sqrt(max((b^2 * var_b + g^2 * var_g + 2 * b * g * cov_bg) / amp^2, 0)) else 0
    den <- b^2 + g^2
    se_phi <- if (den > 0) sqrt(max((g^2 * var_b + b^2 * var_g - 2 * b * g * cov_bg) / den^2, 0)) else 0
    se_acro <- se_phi / (k * omega)
    # This harmonic's own zero-amplitude test (beta_k = gamma_k = 0): the Wald F
    # b' V^-1 b / 2 on (2, df_resid); with one harmonic it is pF (cosinor.js).
    det_v <- var_b * var_g - cov_bg^2
    f_k <- if (det_v > 0) (b^2 * var_g - 2 * b * g * cov_bg + g^2 * var_b) / det_v / 2 else NaN
    pf_k <- if (is.finite(f_k)) pf(max(0, f_k), 2, df_resid, lower.tail = FALSE) else NaN
    # FIT-7: no acrophase CI when the rhythm is not detectable or the interval spans a full
    # cycle (Bingham et al. 1982; Cornelissen 2014). cosinor.js acrophaseCIDetermined.
    ci_acro <- if (acrophase_ci_determined(pf_val, pf_k, alpha, tcrit, se_acro, period / k))
      c(acro - tcrit * se_acro, acro + tcrit * se_acro) else c(NaN, NaN)
    harmonics[[k]] <- list(k = k, beta = b, gamma = g, amplitude = amp,
                           acrophase_hrs = acro, phi_rad = phi,
                           SE_A = se_a, SE_acrophase_hrs = se_acro,
                           CI_A = c(max(0, amp - tcrit * se_a), amp + tcrit * se_a),
                           CI_acrophase = ci_acro, pF = pf_k)
  }
  list(M = M, SE_M = se_m, CI_M = c(M - tcrit * se_m, M + tcrit * se_m),
       harmonics = harmonics, F_stat = f_stat, df = c(df1, df_resid), pF = pf_val,
       R2 = r2, RMSE = rmse, RMSE_n = rmse_n, fitted = fitted, n = n,
       period = period, nHarmonics = n_harmonics, alpha = alpha)
}

evaluate_cosinor_at_points <- function(parameters, x_points) {
  xa <- suppressWarnings(as.numeric(unlist(x_points, use.names = FALSE)))
  if (!is.null(parameters$harmonics)) {
    omega <- 2 * pi / parameters$period
    y <- rep(parameters$M, length(xa))
    for (h in parameters$harmonics) {
      y <- y + h$beta * cos(h$k * omega * xa) + h$gamma * sin(h$k * omega * xa)
    }
    return(y)
  }
  y <- rep(if (is.null(parameters$O)) 0 else parameters$O, length(xa))
  for (cc in parameters$cosines) {
    y <- y + cc$amplitude * cos(2 * pi * cc$frequency * xa + cc$phase)
  }
  y
}

# --- Time origin and phase reference (utils/phaseReference.js), matching the Python port ---
# The session's display time zone (appState.displayTimezone); the exported script sets it.
DISPLAY_TIMEZONE <- "utc"
.CLOCK_FALLBACK_WARNING <- paste0('Phase reference "Clock time of day" needs a time column as ',
                                  "x; phases are reported as hours since the first sample instead.")

wrap_to_period <- function(h, p) {
  if (!is.numeric(h) || length(h) != 1 || !is.finite(h) || !isTRUE(p > 0)) return(NaN)
  .js_mod(.js_mod(h, p) + p, p)
}
bathyphase <- function(acro, p) {
  if (!is.numeric(acro) || length(acro) != 1 || !is.finite(acro) || !isTRUE(p > 0)) return(NaN)
  wrap_to_period(acro + p / 2, p)
}
phase_angle_of_entrainment <- function(acro, ref = 0, p = 24) {
  if (!is.numeric(acro) || length(acro) != 1 || !is.finite(acro) || !isTRUE(p > 0)) return(NaN)
  r <- if (is.numeric(ref) && length(ref) == 1 && is.finite(ref)) ref else 0
  d <- wrap_to_period(acro - r, p)
  if (d > p / 2) d - p else d
}

time_origin_ms <- function(col, cols, raw_data) {
  if (is.null(col) || !identical(col$type, "time")) return(NULL)
  v <- suppressWarnings(as.numeric(unlist(col_data(col, cols, raw_data), use.names = FALSE)))
  v <- v[is.finite(v)]
  if (length(v)) min(v) else NULL
}

# phaseReference.js fitTimeFrame: list(origin, out) (see the Python port).
fit_time_frame <- function(t_col, out_col, cols, raw_data) {
  in_origin <- time_origin_ms(t_col, cols, raw_data)
  origin <- in_origin; out <- NULL
  if (!is.null(out_col)) {
    if (identical(out_col$type, "time")) {
      if (!is.null(in_origin)) {
        v <- suppressWarnings(as.numeric(unlist(col_data(out_col, cols, raw_data))))
        out <- (v[is.finite(v)] - in_origin) / 3600000
      } else {
        origin <- time_origin_ms(out_col, cols, raw_data)
        h <- col_hours(out_col, cols, raw_data)
        out <- h[is.finite(h)]
      }
    } else {
      v <- col_data(out_col, cols, raw_data)
      out <- vapply(Filter(function(e) !.js_invalid(e), as.list(v)), .js_number, numeric(1))
    }
  }
  list(origin = origin, out = out)
}

clock_hour_of_day <- function(ms, zone = "utc") {
  if (is.null(ms) || !is.finite(ms)) return(NaN)
  tz <- if (is.null(zone) || zone %in% c("utc", "UTC")) "UTC" else zone
  lt <- as.POSIXlt(ms / 1000, origin = "1970-01-01", tz = tz)
  msec <- floor(ms) %% 1000
  lt$hour + lt$min / 60 + floor(lt$sec) / 3600 + msec / 3600000
}

resolve_phase_reference <- function(reference, origin_ms, zone = DISPLAY_TIMEZONE) {
  if (!identical(reference, "clock")) return(list(clock = FALSE, offsetHours = 0, warning = NULL))
  off <- if (is.null(origin_ms)) NaN else clock_hour_of_day(origin_ms, zone)
  if (!is.finite(off))
    return(list(clock = FALSE, offsetHours = 0, warning = .CLOCK_FALLBACK_WARNING))
  list(clock = TRUE, offsetHours = off, warning = NULL)
}
node_phase_reference <- function(args, x_col, cols, raw_data) {
  if (!identical(args$phaseReference, "clock")) return(resolve_phase_reference(NULL, NULL))
  resolve_phase_reference("clock", time_origin_ms(x_col, cols, raw_data))
}
apply_phase_reference <- function(h, ref, p) {
  if (is.null(ref) || !isTRUE(ref$clock)) return(h)
  if (!is.numeric(h) || !is.finite(h)) return(NaN)
  wrap_to_period(h + ref$offsetHours, p)
}
relabel_folded_profile <- function(bin_times, series, ref, p) {
  if (is.null(ref) || !isTRUE(ref$clock) || is.null(bin_times)) return(list(bin_times, series))
  sh <- vapply(bin_times, function(c) apply_phase_reference(c, ref, p), numeric(1))
  o <- order(sh, method = "radix")
  list(sh[o], lapply(series, function(a) a[o]))
}
nearest_phase_instant <- function(phase, p, centre) {
  if (!is.numeric(phase) || !is.finite(phase) || !isTRUE(p > 0) || !is.finite(centre)) return(NaN)
  phase + p * floor((centre - phase) / p + 0.5)
}

# cosinorAddons.js multiComponentWaveform (see the Python port).
multi_component_waveform <- function(M, harmonics, p) {
  nan <- list(amplitude = NaN, orthophase = NaN, bathyphase = NaN, max = NaN, min = NaN)
  if (!is.finite(M) || !isTRUE(p > 0) || !length(harmonics)) return(nan)
  N <- 2880; dt <- p / N; om <- 2 * pi / p
  t <- (0:(N - 1)) * dt
  y <- rep(M, N)
  for (h in harmonics) y <- y + h$beta * cos(h$k * om * t) + h$gamma * sin(h$k * om * t)
  i_max <- which.max(y); i_min <- which.min(y)
  refine <- function(i) {
    a <- y[((i - 2) %% N) + 1]; b <- y[i]; c <- y[(i %% N) + 1]
    den <- a - 2 * b + c
    d <- if (den != 0) 0.5 * (a - c) / den else 0
    off <- max(-0.5, min(0.5, d))
    list(t = wrap_to_period((i - 1 + off) * dt, p), v = b - 0.25 * (a - c) * off)
  }
  hi <- refine(i_max); lo <- refine(i_min)
  list(amplitude = (hi$v - lo$v) / 2, orthophase = hi$t, bathyphase = lo$t, max = hi$v,
       min = lo$v)
}

COSINOR_METRIC_KEYS <- c("period", "mesor", "amplitude", "amplitude_ciLow", "amplitude_ciHigh",
                         "acrophase_ciLow", "acrophase_ciHigh", "acrophase", "rsquared",
                         "pvalue", "perm_pvalue", "bathyphase", "phase_angle", "amplitude_h1",
                         "acrophase_h1", "bathyphase_h1")

# Cosinor.svelte cosinorMetrics (see the Python port cosinor_metrics).
cosinor_metrics <- function(fixed_res, free_res, args, phase_ref) {
  use_fixed <- isTRUE(args$useFixedPeriod)
  fp <- as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
  ref_hrs <- if (is.null(args$referenceHrs)) 0 else args$referenceHrs
  period <- NaN; mesor <- NaN; amp <- NaN; rsq <- NaN; acro <- NaN; overall <- NULL; h1 <- NULL
  if (use_fixed && !is.null(fixed_res)) {
    period <- fp; mesor <- fixed_res$M
    h1 <- if (length(fixed_res$harmonics)) fixed_res$harmonics[[1]] else NULL
    amp <- if (is.null(h1)) NaN else h1$amplitude
    acro <- if (is.null(h1)) NaN else h1$acrophase_hrs
    rsq <- fixed_res$R2
    if (length(fixed_res$harmonics) > 1)
      overall <- multi_component_waveform(mesor, fixed_res$harmonics, period)
  } else if (!is.null(free_res)) {
    c1 <- if (length(free_res$parameters$cosines)) free_res$parameters$cosines[[1]] else NULL
    w <- if (is.null(c1)) 0 else c1$frequency
    period <- if (w) 1 / w else NaN
    mesor <- free_res$parameters$O
    amp <- if (is.null(c1)) NaN else c1$amplitude
    if (!is.null(c1) && w) acro <- -c1$phase / (2 * pi * w)
    rsq <- free_res$rSquared
  }
  rf <- function(h) apply_phase_reference(h, phase_ref, period)
  acro_h1 <- rf(wrap_to_period(acro, period))
  bathy_h1 <- rf(bathyphase(acro, period))
  peak <- if (!is.null(overall)) overall$orthophase else acro
  peak_ref <- if (isTRUE(phase_ref$clock)) peak + phase_ref$offsetHours else peak
  ci_a <- if (use_fixed && !is.null(h1)) h1$CI_A else NULL
  ci_p <- if (use_fixed && !is.null(h1)) h1$CI_acrophase else NULL
  list(period = period, mesor = mesor,
       amplitude = if (!is.null(overall)) overall$amplitude else amp,
       acrophase = if (!is.null(overall)) rf(overall$orthophase) else acro_h1,
       bathyphase = if (!is.null(overall)) rf(overall$bathyphase) else bathy_h1,
       phase_angle = phase_angle_of_entrainment(peak_ref, ref_hrs, period),
       amplitude_h1 = amp, acrophase_h1 = acro_h1, bathyphase_h1 = bathy_h1,
       amplitude_ciLow = if (is.null(ci_a)) NaN else ci_a[1],
       amplitude_ciHigh = if (is.null(ci_a)) NaN else ci_a[2],
       acrophase_ciLow = if (is.null(ci_p)) NaN else rf(wrap_to_period(ci_p[1], period)),
       acrophase_ciHigh = if (is.null(ci_p)) NaN else rf(wrap_to_period(ci_p[2], period)),
       rsquared = rsq,
       pvalue = if (use_fixed && !is.null(fixed_res)) fixed_res$pF else NaN,
       perm_pvalue = NaN)
}

# Port of Cosinor.svelte (matching the Python port): output x from the input's minimum time
# (fit_time_frame, STAT-19), metrics from cosinor_metrics (FIT-9, FIT-13).
# Fewest rows with both x and y a cosinor can be fitted to: parameters + 1.
# Fixed period: 1 + 2 per harmonic; free period: 1 + 3 per curve.
.cosinor_min_points <- function(use_fixed, n_harmonics, n_curves) {
  if (use_fixed) return(1 + 2 * max(1L, n_harmonics) + 1)
  1 + 3 * max(1L, n_curves) + 1
}

tp_cosinor <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  n_curves <- as.integer(if (is.null(args$Ncurves)) 0 else args$Ncurves)
  use_fixed <- isTRUE(args$useFixedPeriod)
  fixed_period <- as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
  n_h <- as.integer(if (is.null(args$nHarmonics)) 1 else args$nHarmonics)
  alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  # Column or sequence output x (resolve_output_x, outputXSequence.js).
  fr <- resolve_output_x(x_col, args, env$cols, env$raw_data)
  phase_ref <- node_phase_reference(args, x_col, env$cols, env$raw_data)

  any_valid <- FALSE; first_x <- NULL; metrics <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    pr <- .pgram_pairs(t, col_data(env$cols[[yk]], env$cols, env$raw_data))
    tt <- pr$t; yy <- pr$y
    # Too few rows with both x and y for the model (p parameters need p + 1 points):
    # no fit, as the JS node (cosinorTooFewPointsWarning in Cosinor.svelte).
    if (length(tt) < .cosinor_min_points(use_fixed, n_h, n_curves)) next
    fixed_res <- NULL; free_res <- NULL
    if (use_fixed) {
      fixed_res <- fit_cosinor_fixed(tt, yy, fixed_period, n_h, alpha)
      res <- fixed_res
    } else {
      free_res <- fit_cosine_curves(tt, yy, n_curves,
                        if (is.null(args$minPeriod)) FREE_PERIOD_DEFAULTS$minPeriod else args$minPeriod,
                        if (is.null(args$maxPeriod)) FREE_PERIOD_DEFAULTS$maxPeriod else args$maxPeriod)
      res <- free_res
    }
    if (is.null(res)) next
    params <- if (!is.null(res$harmonics)) res else res$parameters
    xs <- if (!is.null(fr$out)) fr$out else tt
    metrics[[yk]] <- cosinor_metrics(fixed_res, free_res, args, phase_ref)
    if (is.null(first_x)) {
      first_x <- xs
      if (!is.null(fr$origin)) set_col(env, env$cols, out_id(args, "cosinorx"),
                                       fr$origin + xs * 3600000, type = "time")
      else set_col(env, env$cols, out_id(args, "cosinorx"), xs, type = "number")
    }
    yo <- out_id(args, paste0("cosinory_", y_id))
    if (yo == -1) yo <- out_id(args, "cosinory")
    set_col(env, env$cols, yo, evaluate_cosinor_at_points(params, xs), type = "number")
    # Residuals (Cosinor.svelte writeCosinorOutputs): only with the x output wired; the model
    # evaluated at every input x (fixed period: the full model, mesor included, v82.11).
    rid <- out_id(args, paste0("resid_", y_id))
    if (rid != -1 && out_id(args, "cosinorx") != -1) {
      set_col(env, env$cols, rid,
              .fit_residuals(function(p) evaluate_cosinor_at_points(params, p), t,
                             col_data(env$cols[[yk]], env$cols, env$raw_data)),
              type = "number")
    }
    any_valid <- TRUE
  }
  if (any_valid) {
    empty <- cosinor_metrics(NULL, NULL, args, phase_ref)
    for (key in COSINOR_METRIC_KEYS) {
      v <- vapply(y_ins, function(y) {
        m <- metrics[[as.character(y)]]
        x <- if (is.null(m)) empty[[key]] else m[[key]]
        if (is.null(x)) NaN else as.numeric(x)
      }, numeric(1))
      set_col(env, env$cols, out_id(args, key), v, type = "number")
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# Non-parametric rest-activity variables and the average daily profile
# ---------------------------------------------------------------------------

# JS Math.round rounds half toward +Inf; R's round() is banker's rounding (half to even).
# The difference decides an epoch count at exactly .5 and shifts every bin after it.
js_round <- function(v) floor(v + 0.5)

# Fold a series onto one period and take the per-bin mean and SEM.
# Mirrors src/lib/utils/averageProfile.js::averageDailyProfile.
compute_average_profile <- function(t, y, period = 24, n_bins = 24) {
  n_bins <- as.integer(n_bins)
  if (!(period > 0) || !(n_bins >= 1)) {
    return(list(bin_centres = numeric(0), profile = numeric(0),
                sem = numeric(0), n = integer(0)))
  }
  bin_width <- period / n_bins
  bin_centres <- (seq_len(n_bins) - 1) * bin_width + bin_width / 2
  len <- min(length(t), length(y))
  ti <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE))[seq_len(len)])
  yi <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE))[seq_len(len)])
  ok <- is.finite(ti) & is.finite(yi)
  ti <- ti[ok]; yi <- yi[ok]
  profile <- rep(NA_real_, n_bins); sem <- rep(NA_real_, n_bins); n <- integer(n_bins)
  if (!length(ti)) return(list(bin_centres = bin_centres, profile = profile,
                               sem = sem, n = n, t0 = NaN))
  t0 <- min(ti)
  # Double modulo, as the JS does: a negative remainder would otherwise index backwards.
  tod <- ((ti - t0) %% period + period) %% period
  b <- pmin(pmax(floor(tod / bin_width), 0), n_bins - 1) + 1
  # FIT-12: the SEM is across DAYS. Each day's samples in a bin are averaged first (repeated
  # measures of one day, not replicates; Hurlbert 1984), then the profile is the mean of the
  # day means and the SEM their SD / sqrt(days); n = days.
  day <- js_round((ti - t0 - tod) / period)
  n_samples <- integer(n_bins)
  for (k in seq_len(n_bins)) {
    in_bin <- b == k
    n_samples[k] <- sum(in_bin)
    if (!n_samples[k]) next
    day_means <- vapply(split(yi[in_bin], factor(day[in_bin], levels = unique(day[in_bin]))),
                        mean, numeric(1))
    n[k] <- length(day_means)
    m <- mean(day_means)
    profile[k] <- m
    if (n[k] >= 2) sem[k] <- sqrt(sum((day_means - m)^2) / (n[k] - 1)) / sqrt(n[k])
  }
  list(bin_centres = bin_centres, profile = profile, sem = sem, n = n,
       nSamples = n_samples, t0 = min(ti))
}

# IS, IV, RA, M10/L5 and their onsets. Port of src/lib/utils/npcra.js
# (van Someren et al. 1999, Chronobiol Int 16(4):505-518).
compute_npcra <- function(t, y, epoch_hours = 1, period = 24,
                          m_window = 10, l_window = 5) {
  if (!(epoch_hours > 0) || !(period > 0)) return(NULL)
  len <- min(length(t), length(y))
  tf <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE))[seq_len(len)])
  yf <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE))[seq_len(len)])
  keep <- is.finite(tf)          # y may be NA and still contribute an epoch slot
  tf <- tf[keep]; yf <- yf[keep]
  if (!length(tf)) return(NULL)
  ord <- order(tf); tf <- tf[ord]; yf <- yf[ord]

  t0 <- tf[1]; t_end <- tf[length(tf)]
  e <- epoch_hours
  # The 1e-9 slack matches the Python: without it a span that is an exact multiple of the
  # epoch gains a spurious final epoch through floating-point drift.
  n_epochs <- max(1, ceiling((t_end - t0) / e + 1e-9))
  ssum <- numeric(n_epochs); cnt <- integer(n_epochs)
  # Snap to the epoch grid before flooring: a non-integer epoch (1/24 for a
  # day-unit axis) makes (tf - t0) / e land at 11.999999... for an exact bin edge.
  k <- pmin(pmax(floor((tf - t0) / e + 1e-9), 0), n_epochs - 1) + 1
  for (i in seq_along(tf)) {
    # Only a MISSING value is skipped; +-Inf is a value to the JS (isInvalidValue keeps it).
    if (is.na(yf[i])) next
    ssum[k[i]] <- ssum[k[i]] + yf[i]
    cnt[k[i]] <- cnt[k[i]] + 1
  }
  x <- ifelse(cnt > 0, ssum / cnt, NA_real_)

  valid <- x[is.finite(x)]
  nn <- length(valid)
  if (!nn) return(NULL)
  xbar <- mean(valid)
  overall_ss <- sum((valid - xbar)^2)

  p <- max(1, js_round(period / e))
  p_sum <- numeric(p); p_cnt <- integer(p)
  for (kk in seq_len(n_epochs)) {
    if (!is.finite(x[kk])) next
    # Epoch kk-1 sits at bin (kk-1) mod p of the folded profile; computing it through
    # (k*e) %% period / e reintroduces floating-point error for non-integer e.
    h <- (kk - 1) %% p
    p_sum[h + 1] <- p_sum[h + 1] + x[kk]
    p_cnt[h + 1] <- p_cnt[h + 1] + 1
  }
  profile <- ifelse(p_cnt > 0, p_sum / p_cnt, NA_real_)

  prof_ss <- sum((profile[is.finite(profile)] - xbar)^2)
  IS <- if (overall_ss > 0) (nn * prof_ss) / (p * overall_ss) else NA_real_

  # IV: mean squared successive difference over the valid successive pairs, over the variance
  # (Witting et al. 1990); with no gaps the pairs are nn - 1, the textbook formula. Dividing by
  # nn - 1 regardless biased IV low with missing epochs (FIT-8, npcra.js).
  d <- diff(x)
  n_pairs <- sum(is.finite(d))
  diff_ss <- sum(d[is.finite(d)]^2)
  IV <- if (overall_ss > 0 && n_pairs > 0) (diff_ss / n_pairs) / (overall_ss / nn) else NA_real_

  # Circular rolling window over the folded profile: M10 is the highest-mean 10 h block,
  # L5 the lowest 5 h, and the onset is where that block starts.
  roll <- function(width_hours, better) {
    w <- min(p, max(1, js_round(width_hours / e)))
    best_val <- NA_real_; best_start <- 0
    for (st in seq_len(p) - 1) {
      idx <- ((st + seq_len(w) - 1) %% p) + 1
      v <- profile[idx]
      v <- v[is.finite(v)]
      if (!length(v)) next
      m <- mean(v)
      if (is.na(best_val) || better(m, best_val)) { best_val <- m; best_start <- st }
    }
    list(value = best_val, onset = best_start * e)
  }
  m10 <- roll(m_window, function(a, b) a > b)
  l5 <- roll(l_window, function(a, b) a < b)
  denom <- m10$value + l5$value
  RA <- if (is.finite(denom) && denom != 0) (m10$value - l5$value) / denom else NA_real_

  list(IS = IS, IV = IV, RA = RA, M10 = m10$value, L5 = l5$value,
       M10onset = m10$onset, L5onset = l5$onset,
       profile = profile, bin_centres = (seq_len(p) - 1) * e + e / 2,
       n = nn, p = p, n_epochs = n_epochs,
       missingEpochFraction = (n_epochs - nn) / n_epochs, t0 = t0)
}

tp_averageprofile <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  period <- as.numeric(if (is.null(args$period)) 24 else args$period)
  n_bins <- as.integer(if (is.null(args$nBins)) 24 else args$nBins)
  x_data <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  phase_ref <- node_phase_reference(args, env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  centres <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- compute_average_profile(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                                   period, n_bins)
    if (!length(res$bin_centres)) next
    if (isTRUE(phase_ref$clock) && is.finite(res$t0)) {
      # Clock time (FIT-9): bin times are hours after the series' first valid sample.
      rl <- relabel_folded_profile(res$bin_centres, list(res$profile, res$sem, res$n),
                                   list(clock = TRUE, offsetHours = phase_ref$offsetHours + res$t0),
                                   period)
      res$bin_centres <- rl[[1]]
      res$profile <- rl[[2]][[1]]; res$sem <- rl[[2]][[2]]; res$n <- rl[[2]][[3]]
    }
    if (is.null(centres)) {
      centres <- res$bin_centres
      set_col(env, env$cols, out_id(args, "avgprofx"), centres, type = "number")
    }
    y_out <- out_id(args, paste0("avgprof_", y_id))
    if (y_out == -1) y_out <- out_id(args, "avgprof")
    set_col(env, env$cols, y_out, res$profile, type = "number")
    sem_out <- out_id(args, paste0("avgprofsem_", y_id))
    if (sem_out == -1) sem_out <- out_id(args, "avgprofsem")
    set_col(env, env$cols, sem_out, res$sem, type = "number")
    if (any(res$n > 0)) any_valid <- TRUE
  }
  any_valid
}

tp_nonparametricra <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  epoch <- as.numeric(if (is.null(args$epochHours)) 1 else args$epochHours)
  period <- as.numeric(if (is.null(args$period)) 24 else args$period)
  m_window <- as.numeric(if (is.null(args$mWindow)) 10 else args$mWindow)
  l_window <- as.numeric(if (is.null(args$lWindow)) 5 else args$lWindow)
  x_data <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  phase_ref <- node_phase_reference(args, env$cols[[as.character(x_in)]], env$cols, env$raw_data)

  scalar_keys <- c("IS", "IV", "RA", "M10", "L5", "M10onset", "L5onset")
  per_y <- list(); centres <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- compute_npcra(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                         epoch, period, m_window, l_window)
    if (is.null(res)) next
    if (isTRUE(phase_ref$clock)) {
      # Clock time (FIT-9): onsets and bin times are hours after the series' first sample.
      rf <- list(clock = TRUE, offsetHours = phase_ref$offsetHours + res$t0)
      res$M10onset <- apply_phase_reference(res$M10onset, rf, period)
      res$L5onset <- apply_phase_reference(res$L5onset, rf, period)
      rl <- relabel_folded_profile(res$bin_centres, list(res$profile), rf, period)
      res$bin_centres <- rl[[1]]; res$profile <- rl[[2]][[1]]
    }
    per_y[[yk]] <- res
    if (is.null(centres)) {
      centres <- res$bin_centres
      set_col(env, env$cols, out_id(args, "npcrax"), centres, type = "number")
    }
    y_out <- out_id(args, paste0("npcray_", y_id))
    if (y_out == -1) y_out <- out_id(args, "npcray")
    set_col(env, env$cols, y_out, res$profile, type = "number")
    any_valid <- TRUE
  }
  if (!any_valid) return(FALSE)
  # One value per y input, in yIN order — the scalar-metric-port contract. A y that failed
  # contributes NA rather than being dropped, or the positions would no longer line up.
  for (key in scalar_keys) {
    oid <- out_id(args, key)
    if (oid == -1) next
    arr <- vapply(y_ins, function(y) {
      r <- per_y[[as.character(y)]]
      if (is.null(r)) NA_real_ else as.numeric(r[[key]])
    }, numeric(1))
    set_col(env, env$cols, oid, arr, type = "number")
  }
  any_valid
}

# ---------------------------------------------------------------------------
# Structural analyses (reshaping, ordering, combining)
# ---------------------------------------------------------------------------

# Mirror of sortRows.js::sortPermutation. Three rules that all matter:
#   - missing values sort LAST whatever the direction (so "descending" does not surface
#     gaps at the top),
#   - a value that is not numeric compares as a STRING,
#   - ties keep their original order.
# R's order() cannot express the first rule directly, so the permutation is built by hand.
sort_permutation <- function(key_values, direction = "asc") {
  dir <- if (identical(direction, "desc")) -1 else 1
  n <- length(key_values)
  if (!n) return(integer(0))
  miss <- logical(n); num <- rep(NA_real_, n); str <- rep(NA_character_, n)
  for (i in seq_len(n)) {
    v <- key_values[[i]]
    if (is.null(v) || length(v) != 1 || (is.atomic(v) && is.na(v))) { miss[i] <- TRUE; next }
    nv <- suppressWarnings(as.numeric(v))
    if (is.na(nv)) str[i] <- as.character(v) else num[i] <- nv
  }
  any_str <- any(!is.na(str))
  idx <- seq_len(n)
  cmp <- function(a, b) {
    if (miss[a] && miss[b]) return(a - b)
    if (miss[a]) return(1)
    if (miss[b]) return(-1)
    c <- if (any_str) {
      sa <- if (is.na(str[a])) format(num[a]) else str[a]
      sb <- if (is.na(str[b])) format(num[b]) else str[b]
      if (sa > sb) 1 else if (sa < sb) -1 else 0
    } else {
      if (num[a] > num[b]) 1 else if (num[a] < num[b]) -1 else 0
    }
    if (c != 0) return(dir * c)
    a - b
  }
  # Insertion sort: n is a column length, and an explicit comparator keeps the three rules
  # above readable and provably stable.
  out <- integer(0)
  for (i in idx) {
    placed <- FALSE
    if (length(out)) {
      for (j in seq_along(out)) {
        if (cmp(i, out[j]) < 0) {
          out <- append(out, i, after = j - 1); placed <- TRUE; break
        }
      }
    }
    if (!placed) out <- c(out, i)
  }
  out
}

tp_sort <- function(args, env) {
  y_ins <- id_list(args$yIN)
  if (!length(y_ins)) return(FALSE)
  direction <- if (identical(args$direction, "desc")) "desc" else "asc"
  sort_on <- args$sortOnId
  if (is.null(sort_on) || sort_on == -1 || !(sort_on %in% y_ins)) sort_on <- y_ins[1]
  key_col <- env$cols[[as.character(sort_on)]]
  if (is.null(key_col)) return(FALSE)
  key_data <- col_data(key_col, env$cols, env$raw_data)
  n <- length(key_data)
  if (!n) return(FALSE)
  ord <- sort_permutation(key_data, direction)
  any_written <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    oid <- out_id(args, paste0("sortedy_", y_id))
    if (oid == -1) next
    yd <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    # Only columns row-aligned with the key are reordered; anything else passes through
    # untouched rather than being scrambled against a key it does not share rows with.
    reordered <- if (length(yd) == n) yd[ord] else yd
    set_col(env, env$cols, oid, reordered,
            type = env$cols[[yk]]$type, time_format = env$cols[[yk]]$time_format)
    any_written <- TRUE
  }
  any_written
}

# Port of CollectColumns.svelte (matching the Python port): each input (after the node's
# preProcesses) to its col_<id> output, then each row-wise aggregate (mean/min/max/sum over
# the included columns) to its outColId; house rule per cell, an all-missing row is NA.
tp_collectcolumns <- function(args, env) {
  ids <- if (!is.null(args$colIds)) unlist(args$colIds, use.names = FALSE) else id_list(args$yIN)
  if (!length(ids)) return(FALSE)
  if (any(vapply(ids, function(i) is.null(env$cols[[as.character(i)]]), logical(1))))
    return(FALSE)
  res <- lapply(ids, function(i) col_data(env$cols[[as.character(i)]], env$cols, env$raw_data))
  names(res) <- as.character(ids)
  for (pp in args$preProcesses) {
    nm <- pp$processName
    if (is.null(nm)) next
    for (k in names(res)) res[[k]] <- run_column_process(tolower(gsub(" ", "", nm)), res[[k]],
      if (is.null(pp$processArgs)) list() else pp$processArgs, env$cols, env$raw_data)
  }
  for (cid in ids) {
    ck <- as.character(cid)
    oid <- out_id(args, paste0("col_", cid))
    if (oid == -1) next
    set_col(env, env$cols, oid, res[[ck]], type = env$cols[[ck]]$type)
  }
  for (agg in args$aggregates) {
    oc <- agg$outColId
    if (is.null(oc) || .js_number(oc) < 0) next
    exc <- unlist(agg$excludedColIds)
    inc <- as.character(ids[!(ids %in% exc)])
    if (!length(inc)) next
    nr <- length(res[[inc[1]]])
    vals <- vapply(seq_len(nr), function(i) {
      row <- lapply(inc, function(k) { d <- as.list(res[[k]]); if (i <= length(d)) d[[i]] else NULL })
      row <- vapply(Filter(function(v) !.js_invalid(v), row), .js_number, numeric(1))
      if (!length(row)) return(NA_real_)
      switch(if (is.null(agg$method)) "" else agg$method,
             mean = sum(row) / length(row), min = min(row), max = max(row), sum = sum(row),
             NA_real_)
    }, numeric(1))
    set_col(env, env$cols, oc, vals, type = "number")
  }
  TRUE
}

tp_split <- function(args, env) {
  y_ins <- id_list(args$yIN)
  if (!length(y_ins)) return(FALSE)
  splits <- sort(suppressWarnings(as.numeric(unlist(args$splitTimes, use.names = FALSE))))
  splits <- splits[is.finite(splits)]
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  x_data <- if (!is.null(env$cols[[as.character(x_in)]]))
    t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data) else NULL
  any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    x <- if (!is.null(x_data)) x_data else seq_along(y) - 1
    # Segments are FULL LENGTH: each output keeps the array length and holds NA outside its
    # own time window, so every segment stays row-aligned with the original x.
    bounds <- c(-Inf, splits, Inf)
    for (k in seq_len(length(splits) + 1)) {
      lo <- bounds[k]; hi <- bounds[k + 1]
      xv <- suppressWarnings(as.numeric(x))
      seg <- ifelse(is.finite(xv) & xv >= lo & xv < hi,
                    suppressWarnings(as.numeric(y)), NA_real_)
      # Key is "<yId>_<segment>", matching Split.svelte:103 — NOT "segment<n>_<yId>".
      oid <- out_id(args, paste0(y_id, "_", k))
      if (oid == -1) next
      set_col(env, env$cols, oid, seg, type = "number")
      any_valid <- TRUE
    }
  }
  any_valid
}

# Element-wise combination of several columns. Mirrors ColumnFunctions.svelte:20-85.
#
# The param is `func` and the inputs are `xsIN` — NOT `operation`/`colIds`, which is what the
# Python port read until a fixture caught it (and so silently summed no matter what the user
# chose). `sd` is the SAMPLE sd across columns (n-1), 0 for a single column, and `add`
# concatenates with a space when either column is categorical.
tp_columnfunctions <- function(args, env) {
  func <- if (!is.null(args$func)) args$func
          else if (!is.null(args$operation)) args$operation else "add"
  ids <- if (!is.null(args$xsIN)) id_list(args$xsIN)
         else if (!is.null(args$colIds)) id_list(args$colIds)
         else id_list(args$yIN)
  ids <- ids[vapply(ids, function(i) !is.null(env$cols[[as.character(i)]]), logical(1))]
  if (!length(ids)) return(FALSE)
  columns <- lapply(ids, function(i) col_data(env$cols[[as.character(i)]], env$cols, env$raw_data))
  types <- vapply(ids, function(i) env$cols[[as.character(i)]]$type, character(1))
  n <- length(columns[[1]])
  n_cols <- length(columns)
  num <- function(col, j) suppressWarnings(as.numeric(col[[j]]))

  result <- if (identical(func, "add")) {
    acc <- columns[[1]]
    if (n_cols > 1) for (i in 2:n_cols) {
      cat_mode <- types[1] == "category" || types[i] == "category"
      acc <- lapply(seq_len(n), function(j) {
        if (cat_mode) paste(acc[[j]], columns[[i]][[j]])
        else suppressWarnings(as.numeric(acc[[j]])) + num(columns[[i]], j)
      })
    }
    acc
  } else if (identical(func, "average")) {
    lapply(seq_len(n), function(j) sum(vapply(columns, num, numeric(1), j)) / n_cols)
  } else if (identical(func, "min")) {
    lapply(seq_len(n), function(j) min(vapply(columns, num, numeric(1), j)))
  } else if (identical(func, "max")) {
    lapply(seq_len(n), function(j) max(vapply(columns, num, numeric(1), j)))
  } else if (identical(func, "sd")) {
    lapply(seq_len(n), function(j) {
      if (n_cols < 2) return(0)
      v <- vapply(columns, num, numeric(1), j)
      sqrt(sum((v - mean(v))^2) / (n_cols - 1))
    })
  } else if (identical(func, "percentile")) {
    # Row-wise type-7 percentile across the columns; R's quantile(type = 7) IS
    # the reference. Missing values (blank cells → NA via as.numeric) are
    # dropped per row, matching the JS isInvalidValue filter.
    pct <- suppressWarnings(as.numeric(if (is.null(args$percentile)) 50 else args$percentile))
    if (!is.finite(pct)) pct <- 50
    pct <- min(100, max(0, pct))
    lapply(seq_len(n), function(j) {
      v <- vapply(columns, num, numeric(1), j)
      v <- v[is.finite(v)]
      if (!length(v)) return(NA_real_)
      as.numeric(quantile(v, pct / 100, type = 7, names = FALSE))
    })
  } else return(FALSE)

  set_col(env, env$cols, out_id(args, "result"), unlist(result, use.names = FALSE),
          type = "number")
  length(result) > 0
}

# The missing-cell rule LongToWide and WideToLong apply to a column of this type: the house
# rule (.js_invalid) everywhere except a category column, whose cells are labels
# (is_missing_category: NA, blank or whitespace-only text, NaN). Python: _cell_missing_rule.
.cell_missing_rule <- function(type) {
  if (identical(type, "category")) {
    function(v) {
      if (is.null(v)) return(TRUE)
      if (is.list(v)) v <- if (length(v) == 1) v[[1]] else return(TRUE)
      length(v) != 1 || isTRUE(is_missing_category(v))
    }
  } else .js_invalid
}

# An exact key for one cell (JS Set / Map identity on the values a column holds).
.cell_key <- function(v) {
  if (is.list(v)) v <- v[[1]]
  if (is.numeric(v)) sprintf("n:%.17g", v) else paste0("s:", as.character(v))
}

# Port of WideToLong.svelte widetolong (Python: tp_widetolong). One block of rows per value
# column (selected order, duplicates and negative ids ignored), its rows to the shorter of the
# two lengths; a row is dropped when its time or its cell is missing by its column's rule. The
# category is the value column's name; the time output keeps the time column's type with no
# text format, the value output the FIRST value column's type.
tp_widetolong <- function(args, env) {
  x_in <- if (!is.null(args$timeIN)) args$timeIN else if (!is.null(args$xIN)) args$xIN else -1
  y_ins <- unique(id_list(if (!is.null(args$valueColIds)) args$valueColIds else args$yIN))
  y_ins <- y_ins[y_ins >= 0]
  if (is.null(x_in) || x_in == -1 || !length(y_ins)) return(FALSE)
  x_col <- env$cols[[as.character(x_in)]]
  if (is.null(x_col)) return(FALSE)
  xd <- as.list(col_data(x_col, env$cols, env$raw_data))
  time_missing <- .cell_missing_rule(x_col$type)
  times <- list(); cats <- character(0); vals <- list()
  for (y_id in y_ins) {
    y_col <- env$cols[[as.character(y_id)]]
    if (is.null(y_col)) return(FALSE)
    yd <- as.list(col_data(y_col, env$cols, env$raw_data))
    cell_missing <- .cell_missing_rule(y_col$type)
    label <- if (is.null(y_col$name)) paste0("column_", y_id) else y_col$name
    for (i in seq_len(min(length(xd), length(yd)))) {
      if (time_missing(xd[[i]]) || cell_missing(yd[[i]])) next
      times[[length(times) + 1]] <- xd[[i]]
      cats <- c(cats, label)
      vals[[length(vals) + 1]] <- yd[[i]]
    }
  }
  # Each output is written when wired (the app's three are always wired together).
  t_id <- out_id(args, "time")
  set_col(env, env$cols, t_id, unlist(times, use.names = FALSE), type = x_col$type)
  if (!is.null(env$cols[[as.character(t_id)]])) env$cols[[as.character(t_id)]]$time_format <- NULL
  set_col(env, env$cols, out_id(args, "category"), cats, type = "category")
  v_type <- env$cols[[as.character(y_ins[1])]]$type
  set_col(env, env$cols, out_id(args, "value"), unlist(vals, use.names = FALSE),
          type = if (is.null(v_type)) "number" else v_type)
  length(times) > 0
}

# Port of LongToWide.svelte evaluateLongToWide + writeLongToWideOutputs (Python:
# tp_longtowide). Args are the app's own: categoryIN, timeIN, valueIN.
# - A row whose time is missing (the time column's rule) is dropped.
# - Categories in order of first appearance; a missing label (is_missing_category) is none.
# - The time column is the union of the kept times (exact values), sorted ascending.
# - value_<category> holds, per union time, the value of the LAST row with that category and
#   time (a repeated time is not averaged); NaN where there is no such row. A missing value is
#   kept, so it reads as a blank cell.
# - The pre-processes run on each category's values before writing, in order.
tp_longtowide <- function(args, env) {
  ids <- list(args$categoryIN, args$timeIN, args$valueIN)
  for (cid in ids) {
    if (is.null(cid) || cid == -1 || is.null(env$cols[[as.character(cid)]])) return(FALSE)
  }
  cat_col <- env$cols[[as.character(args$categoryIN)]]
  t_col <- env$cols[[as.character(args$timeIN)]]
  v_col <- env$cols[[as.character(args$valueIN)]]
  cd <- as.list(col_data(cat_col, env$cols, env$raw_data))
  td <- as.list(col_data(t_col, env$cols, env$raw_data))
  vd <- as.list(col_data(v_col, env$cols, env$raw_data))
  time_missing <- .cell_missing_rule(t_col$type)
  is_cat_missing <- .cell_missing_rule("category")

  union <- list(); union_keys <- character(0)
  for (t in td) {
    if (time_missing(t)) next
    k <- .cell_key(t)
    if (k %in% union_keys) next
    union_keys <- c(union_keys, k); union[[length(union) + 1]] <- t
  }
  if (!length(union)) return(FALSE)
  tnum <- vapply(union, .js_number, numeric(1))
  # JS sorts with (a, b) => a - b: numeric keys ascending (stable); a non-numeric key compares
  # as equal, so all-text times keep their first-appearance order.
  if (!anyNA(tnum)) {
    o <- order(tnum, method = "radix")
    union <- union[o]; union_keys <- union_keys[o]
  }

  categories <- list(); cat_keys <- character(0)
  for (c in cd) {
    if (is_cat_missing(c)) next
    k <- .cell_key(c)
    if (k %in% cat_keys) next
    cat_keys <- c(cat_keys, k); categories[[length(categories) + 1]] <- c
  }

  cells <- new.env(hash = TRUE)
  n <- min(length(cd), length(td))
  for (i in seq_len(n)) {
    if (time_missing(td[[i]]) || is_cat_missing(cd[[i]])) next
    key <- paste(.cell_key(cd[[i]]), .cell_key(td[[i]]), sep = "|")
    assign(key, if (i <= length(vd)) vd[[i]] else NA, envir = cells)
  }

  result <- lapply(cat_keys, function(ck) {
    unlist(lapply(union_keys, function(tk) {
      key <- paste(ck, tk, sep = "|")
      if (exists(key, envir = cells, inherits = FALSE)) {
        v <- get(key, envir = cells)
        if (is.null(v)) NA else v
      } else NaN
    }), use.names = FALSE)
  })
  for (pp in args$preProcesses) {
    nm <- pp$processName
    if (is.null(nm) || !nzchar(nm)) next
    result <- lapply(result, function(vals)
      run_column_process(tolower(gsub(" ", "", nm)), vals,
                         if (is.null(pp$processArgs)) list() else pp$processArgs,
                         env$cols, env$raw_data))
  }

  t_id <- out_id(args, "time")
  if (t_id == -1) return(TRUE)
  # The app stores the input's raw time text (with its format) when it can, else epoch ms with
  # the format cleared; both read back as the same epoch ms, which is what is stored here.
  set_col(env, env$cols, t_id, unlist(union, use.names = FALSE), type = t_col$type)
  if (!is.null(env$cols[[as.character(t_id)]])) env$cols[[as.character(t_id)]]$time_format <- NULL
  v_type <- if (is.null(v_col$type)) "number" else v_col$type
  for (j in seq_along(categories)) {
    set_col(env, env$cols, out_id(args, paste0("value_", js_string(categories[[j]]))),
            result[[j]], type = v_type)
  }
  TRUE
}

# ---------------------------------------------------------------------------
# Correlation CI, cross-correlation, chi-square, logistic regression, interpolation
# ---------------------------------------------------------------------------

# Fisher z interval for a correlation coefficient. `values` is c(r, n), matching the Python.
correlation_ci <- function(values, method = "pearson", confidence = 0.95) {
  r <- suppressWarnings(as.numeric(values[[1]]))
  n <- suppressWarnings(as.numeric(values[[2]]))
  if (!is.finite(r) || !is.finite(n) || n < 4) return(list(ciLow = NA_real_, ciHigh = NA_real_))
  if (abs(r) >= 1) return(list(ciLow = r, ciHigh = r))
  z <- atanh(r)
  # Spearman's z variance is the Bonett-Wright form, (1 + r^2/2)/(n-3) — NOT the Fieller
  # 1.06/(n-3) inflation, which is the other common choice and gives visibly different
  # bounds (0.160 vs 0.148 at r = 0.5, n = 30).
  se <- if (identical(method, "spearman")) sqrt((1 + r^2 / 2) / (n - 3)) else 1 / sqrt(n - 3)
  zc <- qnorm(1 - (1 - confidence) / 2)
  list(ciLow = tanh(z - zc * se), ciHigh = tanh(z + zc * se))
}

# crossCorrelation.js `finite`: not null, not "", and Number(v) finite. Looser than the house
# rule: a whitespace-only cell is Number(" ") = 0, a value.
.cc_finite <- function(v) {
  if (is.null(v) || length(v) != 1 || (is.atomic(v) && is.na(v) && !is.nan(v))) return(FALSE)
  if (is.character(v) && v == "") return(FALSE)
  is.finite(.js_number(v))
}

# crossCorrelation.js fitAR: Yule-Walker with the order chosen by AIC (Levinson-Durbin),
# exactly R's ar(x, method = "yule-walker") defaults (autocovariances / n present values,
# order.max = min(n - 1, floor(10 log10 n), length - 2)). Missing values are skipped in each
# lag's sum.
fit_ar <- function(x, max_order = Inf) {
  xl <- as.list(x)
  ok <- vapply(xl, .cc_finite, logical(1))
  vals <- vapply(xl[ok], .js_number, numeric(1))
  n_obs <- length(vals)
  none <- list(order = 0, coef = numeric(0), mean = NaN, variance = NaN)
  if (n_obs < 3) return(none)
  mu <- sum(vals) / n_obs
  n <- length(xl)
  dev <- rep(NaN, n)
  dev[ok] <- vals - mu
  m_max <- max(0, min(max_order, n_obs - 1, floor(10 * log10(n_obs)), n - 2))
  acov <- vapply(0:m_max, function(k) {
    if (k >= n) return(0)
    a <- dev[(k + 1):n]; b <- dev[1:(n - k)]
    use <- !is.na(a) & !is.na(b)
    sum(a[use] * b[use]) / n_obs
  }, numeric(1))
  if (!(acov[1] > 0)) return(list(order = 0, coef = numeric(0), mean = mu, variance = 0))
  phi <- numeric(0); v <- acov[1]
  best <- list(order = 0, coef = numeric(0), variance = v, aic = n_obs * log(v))
  if (m_max >= 1) for (m in 1:m_max) {
    num <- acov[m + 1]
    if (m > 1) for (j in 1:(m - 1)) num <- num - phi[j] * acov[m - j + 1]
    kappa <- num / v
    if (!is.finite(kappa) || abs(kappa) >= 1) break
    nxt <- numeric(m)
    if (m > 1) for (j in 1:(m - 1)) nxt[j] <- phi[j] - kappa * phi[m - j]
    nxt[m] <- kappa
    phi <- nxt
    v <- v * (1 - kappa * kappa)
    if (!(v > 0)) break
    aic <- n_obs * log(v) + 2 * m
    if (aic < best$aic) best <- list(order = m, coef = phi, variance = v, aic = aic)
  }
  list(order = best$order, coef = best$coef, mean = mu, variance = best$variance)
}

# crossCorrelation.js arFilter: e[t] = (z[t] - mean) - sum_i coef[i] (z[t-1-i] - mean); the
# first `order` values and any with a missing value in their history are NaN.
ar_filter <- function(z, ar, mu) {
  zl <- as.list(z); n <- length(zl); p <- length(ar$coef)
  out <- rep(NaN, n)
  if (n > p) for (t in (p + 1):n) {
    if (!.cc_finite(zl[[t]])) next
    e <- .js_number(zl[[t]]) - mu
    ok <- TRUE
    if (p > 0) for (i in 1:p) {
      prev <- zl[[t - i]]
      if (!.cc_finite(prev)) { ok <- FALSE; break }
      e <- e - ar$coef[i] * (.js_number(prev) - mu)
    }
    if (ok) out[t] <- e
  }
  out
}

.ccf_at_lags <- function(xa, ya, max_lag, method) {
  nx <- length(xa); ny <- length(ya)
  lags <- c(); rs <- c(); ps <- c(); ns <- c()
  for (k in (-max_lag):max_lag) {
    # Index arithmetic kept 0-based as in the JS and shifted by 1 only at the subscript.
    i0 <- max(0, -k); i1 <- min(nx - 1, ny - 1 - k)
    if (i1 < i0) {
      lags <- c(lags, k); rs <- c(rs, NA_real_); ps <- c(ps, NA_real_); ns <- c(ns, 0); next
    }
    idx <- i0:i1
    c1 <- correlate(xa[idx + 1], ya[idx + k + 1], method)
    lags <- c(lags, k); rs <- c(rs, c1$r); ps <- c(ps, c1$pvalue); ns <- c(ns, c1$n)
  }
  list(lags = lags, r = rs, pvalue = ps, n = ns)
}

# Port of utils/crossCorrelation.js crossCorrelation (see the Python port): raw r(k) =
# corr(x[t], y[t + k]); per-lag p of the PREWHITENED pair; minP, minPLag and the Sidak
# familywiseP over the lags with a finite p.
cross_correlation <- function(x, y, max_lag = 0, method = "pearson") {
  method <- if (identical(method, "spearman")) "spearman" else "pearson"
  num <- function(v) vapply(as.list(v), function(e) if (.js_invalid(e)) NA_real_
                            else .js_number(e), numeric(1))
  xa <- num(x); ya <- num(y)
  nx <- length(xa); ny <- length(ya)
  cap <- max(1, min(nx, ny) %/% 4)
  max_lag <- if (!is.null(max_lag) && is.finite(max_lag) && max_lag > 0)
    min(floor(max_lag), min(nx, ny) - 1) else cap
  raw <- .ccf_at_lags(xa, ya, max_lag, method)
  ar <- fit_ar(x)
  pw <- raw
  if (ar$order > 0) {
    yl <- as.list(y); okv <- vapply(yl, .cc_finite, logical(1))
    ym <- if (any(okv)) mean(vapply(yl[okv], .js_number, numeric(1))) else NaN
    fx <- ar_filter(x, ar, ar$mean); fy <- ar_filter(y, ar, ym)
    pw <- .ccf_at_lags(ifelse(is.nan(fx), NA_real_, fx), ifelse(is.nan(fy), NA_real_, fy),
                       max_lag, method)
  }
  min_p <- Inf; min_lag <- NA_real_; min_i <- 0; n_lags <- 0
  for (i in seq_along(pw$pvalue)) {
    pv <- pw$pvalue[i]
    if (is.na(pv) || !is.finite(pv)) next
    n_lags <- n_lags + 1
    tie <- FALSE
    if (pv == min_p) {
      ri <- pw$r[i]; rm <- pw$r[min_i]
      tie <- abs(ri) > abs(rm) + CC_TIE ||
        .cc_beats_on_tie(pw$lags[i], ri, pw$lags[min_i], rm)
    }
    if (pv < min_p || tie) { min_p <- pv; min_lag <- pw$lags[i]; min_i <- i }
  }
  if (!n_lags) min_p <- NaN
  fw <- if (n_lags) -expm1(n_lags * log1p(-min(min_p, 1))) else NaN
  peak <- cross_correlation_peak(raw$lags, raw$r)
  pw_peak <- cross_correlation_peak(pw$lags, pw$r)
  list(lags = raw$lags, r = raw$r, pvalue = pw$pvalue, n = raw$n,
       peakLag = peak$lag, peakR = peak$r, pwR = pw$r, pwPeakLag = pw_peak$lag,
       pwPeakR = pw_peak$r, arOrder = ar$order, minP = min_p, minPLag = min_lag,
       familywiseP = fw, nLags = n_lags)
}

# findPeak's rules 2-4 (crossCorrelation.js beatsOnTie): only on a tie in |r|.
.cc_beats_on_tie <- function(lag, r, best_lag, best_r) {
  if (!(abs(abs(r) - abs(best_r)) <= CC_TIE)) return(FALSE)
  if ((r >= 0) != (best_r >= 0)) return(r >= 0)
  if (abs(lag) != abs(best_lag)) return(abs(lag) < abs(best_lag))
  lag < best_lag
}

# Two lags whose |r| differ by less than this are a TIE, not a ranking.
CC_TIE <- 1e-12

# Mirror of findPeak in utils/crossCorrelation.js. Peak convention, in order: largest |r|;
# then the POSITIVE r (an exact +1 is never beaten by an exact -1 at the anti-phase lag);
# then the smallest |lag| (a periodic series repeats its own peak once per period); then
# the smaller lag, for determinism.
cross_correlation_peak <- function(lags, rs) {
  best_lag <- NA_real_; best_r <- NA_real_; best_mag <- -Inf
  for (i in seq_along(lags)) {
    r <- rs[i]
    if (is.na(r) || !is.finite(r)) next
    mag <- abs(r)
    take <- FALSE
    if (mag > best_mag + CC_TIE) {
      take <- TRUE
    } else if (abs(mag - best_mag) <= CC_TIE) {
      if ((r >= 0) != (best_r >= 0)) take <- (r >= 0)
      else if (abs(lags[i]) != abs(best_lag)) take <- abs(lags[i]) < abs(best_lag)
      else take <- lags[i] < best_lag
    }
    if (take) { best_lag <- lags[i]; best_r <- r; best_mag <- mag }
  }
  list(lag = best_lag, r = best_r)
}

chi_square_goodness_of_fit <- function(observed, expected = NULL, ddof = 0) {
  o <- suppressWarnings(as.numeric(unlist(observed, use.names = FALSE)))
  k <- length(o)
  if (k < 2) return(list(statistic = NA_real_, pvalue = NA_real_, df = NA_real_, k = k))
  e <- if (is.null(expected)) rep(sum(o) / k, k)
       else suppressWarnings(as.numeric(unlist(expected, use.names = FALSE)))
  stat <- sum((o - e)^2 / e)
  df <- k - 1 - ddof
  list(statistic = stat, pvalue = pchisq(stat, df, lower.tail = FALSE), df = df, k = k)
}

chi_square_independence <- function(table, correction = TRUE) {
  a <- as.matrix(table)
  n <- sum(a)
  expected <- outer(rowSums(a), colSums(a)) / n
  df <- (nrow(a) - 1) * (ncol(a) - 1)
  # Yates' correction applies only to the 2x2 case, matching scipy.
  use_yates <- correction && nrow(a) == 2 && ncol(a) == 2
  d <- abs(a - expected)
  if (use_yates) d <- pmax(0, d - 0.5)
  stat <- sum(d^2 / expected)
  list(statistic = stat, pvalue = pchisq(stat, df, lower.tail = FALSE), df = df, n = n)
}

chi_square_independence_effects <- function(table, correction = TRUE) {
  base <- chi_square_independence(table, correction)
  a <- as.matrix(table)
  n <- sum(a)
  # Cramer's V uses the UNCORRECTED statistic even when Yates is on: the correction is a
  # p-value device, not an effect-size one, and both the JS and scipy's association() do the
  # same. Using the corrected statistic would shrink V on every 2x2 table.
  uncorrected <- chi_square_independence(table, FALSE)$statistic
  k <- min(nrow(a), ncol(a))
  v <- if (n > 0 && k > 1) sqrt(uncorrected / (n * (k - 1))) else NA_real_
  phi <- NA_real_
  if (nrow(a) == 2 && ncol(a) == 2) {
    den <- sqrt(prod(rowSums(a)) * prod(colSums(a)))
    if (den > 0) phi <- (a[1, 1] * a[2, 2] - a[1, 2] * a[2, 1]) / den
  }
  c(base, list(cramersV = v, phi = phi, n = as.numeric(n)))
}

# Logistic regression via base R's glm(family = binomial): a genuine third implementation
# rather than a re-derivation of the JS IRLS, the same reasoning as using shapiro.test.
logistic_regression <- function(y, predictor_cols, names = NULL) {
  # Complete rows only, by the house rule BEFORE Number() (logistic.js): a missing outcome or
  # predictor drops the row, an outcome other than 0/1 drops it, and a predictor must be
  # finite. `kept` records each kept row's index so the per-observation outputs scatter
  # back to the full input length (NaN for dropped rows), as the JS does.
  yl <- as.list(y)
  pl <- lapply(predictor_cols, as.list)
  total <- length(yl)
  cell <- function(v) if (.js_invalid(v)) NaN else .js_number(v)
  rows <- list(); ys <- numeric(0); kept <- integer(0)
  for (i in seq_len(total)) {
    if (.js_invalid(yl[[i]])) next
    yi <- .js_number(yl[[i]])
    if (!(yi == 0 || yi == 1)) next
    xr <- vapply(pl, function(cc) if (i <= length(cc)) cell(cc[[i]]) else NaN, numeric(1))
    if (!all(is.finite(xr))) next
    rows[[length(rows) + 1]] <- xr; ys <- c(ys, yi); kept <- c(kept, i)
  }
  if (length(rows) < 2) return(NULL)
  df <- as.data.frame(do.call(rbind, rows))
  colnames(df) <- paste0("v", seq_along(predictor_cols))
  df$.y <- ys
  if (length(unique(df$.y)) < 2) return(NULL)
  preds <- predictor_cols
  # epsilon = 1e-12, not glm's default 1e-8. The default stops one IRLS iteration early:
  # the coefficients are already converged by then, but the standard errors (built from the
  # final iteration's weights) are still off in the 5th significant figure, which shows up as
  # a visible disagreement in z and p. One extra iteration closes it to ~5e-9.
  fit <- tryCatch(
    suppressWarnings(glm(.y ~ ., data = df, family = binomial(),
                         control = glm.control(epsilon = 1e-12, maxit = 200))),
    error = function(e) NULL)
  if (is.null(fit)) return(NULL)
  sm <- summary(fit)$coefficients
  scatter <- function(v) { out <- rep(NaN, total); out[kept] <- v; out }
  labels <- c("(intercept)",
              if (is.null(names)) paste0("x", seq_along(preds))
              else unlist(names, use.names = FALSE))
  coefs <- unname(sm[, 1])
  list(term = labels, coef = coefs, se = unname(sm[, 2]), z = unname(sm[, 3]),
       pvalue = unname(sm[, 4]), oddsRatio = exp(coefs), n = nrow(df),
       logLik = as.numeric(logLik(fit)),
       eta = scatter(as.vector(predict(fit, type = "link"))),
       fitted = scatter(as.vector(predict(fit, type = "response"))),
       outcome = scatter(df$.y))
}

# --- the analyses ----------------------------------------------------------

# Port of GroupComparison.svelte jarqueBeraNormality: the app's assumption check (used by
# Correlation's `auto` method). The textbook statistic on the population (n-divisor) moments,
# the same as the NormalityTest node's Jarque-Bera (utils/normality.js; Jarque and Bera 1987);
# it used to standardise by the n - 1 SD (STAT-25). Fewer than 8 values is not evaluable; zero
# variance is evaluable and non-normal; normal means p >= 0.05.
jarque_bera_normality <- function(values) {
  x <- .present_numbers(values)
  n <- length(x)
  if (n < 8) return(list(evaluable = FALSE, normal = NA))
  m <- mean(x)
  m2 <- sum((x - m)^2) / n
  if (!is.finite(m2) || m2 == 0) return(list(evaluable = TRUE, normal = FALSE))
  skew <- (sum((x - m)^3) / n) / m2^1.5
  kurt <- (sum((x - m)^4) / n) / m2^2
  jb <- (n / 6) * (skew^2 + (kurt - 3)^2 / 4)
  p <- if (is.finite(jb) && jb >= 0) pchisq(jb, 2, lower.tail = FALSE) else NA_real_
  list(evaluable = TRUE, normal = if (is.finite(p)) p >= 0.05 else FALSE)
}

# Port of Correlation.svelte `correlation`: the pairwise matrix, one row per pair, under ONE
# method for the whole matrix. `auto` is Pearson unless ANY column is non-normal by the app's
# Jarque-Bera check, then Spearman for every pair.
tp_correlation <- function(args, env) {
  y_ins <- id_list(args$yIN)
  y_ins <- y_ins[vapply(y_ins, function(i) !is.null(env$cols[[as.character(i)]]), logical(1))]
  if (length(y_ins) < 2) return(FALSE)
  requested <- if (is.null(args$method)) "auto" else args$method
  alpha <- suppressWarnings(as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha))
  if (!length(alpha) || !is.finite(alpha)) alpha <- 0.05
  columns <- lapply(y_ins, function(i) col_data(env$cols[[as.character(i)]], env$cols,
                                                 env$raw_data))
  names_ <- vapply(y_ins, function(i) {
    nm <- env$cols[[as.character(i)]]$name
    if (is.null(nm)) as.character(i) else nm
  }, character(1))
  use <- if (identical(requested, "spearman")) "spearman" else "pearson"
  if (identical(requested, "auto")) {
    for (cvals in columns) {
      jb <- jarque_bera_normality(cvals)
      if (isTRUE(jb$evaluable) && identical(jb$normal, FALSE)) { use <- "spearman"; break }
    }
  }
  rows <- list(var_i = c(), var_j = c(), r = c(), pvalue = c(), n = c(),
               ciLow = c(), ciHigh = c())
  for (a in seq_len(length(y_ins) - 1)) for (b in (a + 1):length(y_ins)) {
    res <- correlate(columns[[a]], columns[[b]], use)
    ci <- correlation_ci(c(res$r, res$n), use, 1 - alpha)
    rows$var_i <- c(rows$var_i, names_[a])
    rows$var_j <- c(rows$var_j, names_[b])
    rows$r <- c(rows$r, res$r)
    rows$pvalue <- c(rows$pvalue, res$pvalue)
    rows$n <- c(rows$n, res$n)
    rows$ciLow <- c(rows$ciLow, ci$ciLow)
    rows$ciHigh <- c(rows$ciHigh, ci$ciHigh)
  }
  # Holm (1979) across every pair (p.adjust(method = "holm") via p_adjust); NA p stays NA and is
  # excluded from the family. `significant` reads the ADJUSTED p.
  rows$padj <- p_adjust(as.list(rows$pvalue), "holm")$adjusted
  rows$significant <- ifelse(is.na(rows$padj), NA_real_, as.numeric(rows$padj < alpha))
  .write_result_rows(args, env, rows)
  TRUE
}

# ColumnSet.svelte `columnset`: a recognised NO-OP, valid, writing nothing. A Column Set emits
# no columns; the app materialises its selection into each consumer's saved inputs, so there is
# nothing to compute, but the node is still in the saved tableProcesses and the strict
# dispatcher used to abort the whole exported script on it.
tp_columnset <- function(args, env) TRUE

tp_crosscorrelation <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  if (x_in == -1 || y_in == -1) return(FALSE)
  if (is.null(env$cols[[as.character(x_in)]]) || is.null(env$cols[[as.character(y_in)]])) {
    return(FALSE)
  }
  res <- cross_correlation(col_data(env$cols[[as.character(x_in)]], env$cols, env$raw_data),
                           col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data),
                           max(0, .js_number(if (is.null(args$maxLag)) 0 else args$maxLag),
                               na.rm = TRUE),
                           if (is.null(args$method)) "pearson" else args$method)
  .write_result_rows(args, env,
                     list(lag = res$lags, correlation = res$r, pvalue = res$pvalue))
}

# Counts of (x, y) category pairs, with rows and columns ordered by FIRST APPEARANCE rather
# than sorted: chi-square's statistic is order-invariant, but phi's SIGN is not, so the row
# and column order has to match the JS.
# chisquare.js isMissingCategory: NULL/NA, "" and NaN (or the text "NaN") are absent. Values
# arrive as character (a category column) or numeric; an integral number prints without ".0",
# as JS String() does.
is_missing_category <- function(v) {
  # Whitespace-only text is missing too (JS trims, as isInvalidValue does for a blank cell).
  is.na(v) | (is.character(v) & (trimws(v, whitespace = "[\\h\\v]") == "" | v == "NaN")) |
    (is.numeric(v) & is.nan(v))
}
js_string <- function(v) if (is.numeric(v)) format(v, digits = 15, trim = TRUE) else as.character(v)

# chisquare.js contingencyTable: PAIRED columns cross-tabulated by index (to the shorter
# length), rows with a missing cell skipped, labels in order of first appearance.
contingency_table <- function(row_var, col_var) {
  rv <- unlist(row_var, use.names = FALSE); cv <- unlist(col_var, use.names = FALSE)
  n <- min(length(rv), length(cv))
  rv <- rv[seq_len(n)]; cv <- cv[seq_len(n)]
  keep <- !(is_missing_category(rv) | is_missing_category(cv))
  rk <- js_string(rv[keep]); ck <- js_string(cv[keep])
  rl <- unique(rk); cl <- unique(ck)
  m <- matrix(0, nrow = length(rl), ncol = length(cl))
  for (i in seq_along(rk)) {
    m[match(rk[i], rl), match(ck[i], cl)] <- m[match(rk[i], rl), match(ck[i], cl)] + 1
  }
  list(rowLabels = rl, colLabels = cl, table = m)
}

# chisquare.js groupsToTable: INDEPENDENT groups, one column per group holding that group's
# outcomes; rows are the groups, columns the outcomes by first appearance across groups.
groups_to_table <- function(columns, names_) {
  vals <- lapply(columns, function(v) {
    v <- unlist(v, use.names = FALSE)
    js_string(v[!is_missing_category(v)])
  })
  cl <- unique(unlist(vals, use.names = FALSE))
  m <- matrix(0, nrow = length(vals), ncol = length(cl))
  for (g in seq_along(vals)) for (k in vals[[g]]) m[g, match(k, cl)] <- m[g, match(k, cl)] + 1
  list(rowLabels = names_, colLabels = cl, table = m)
}

# Port of utils/fisherExact.js on a 2x2 table [[a, b], [c, d]]: the p-value for `alternative`
# (the two-sided one sums every table no more probable than the observed, with the 1e-7
# relative tolerance), the conditional-MLE odds ratio and its exact 95% interval for the SAME
# alternative ("less" is [0, upper], "greater" [lower, Inf], as fisher.test), both by 200-step
# bisection on log(psi) as in the app. R's fisher.test gives the same
# quantities, but its uniroot tolerance (~1e-4) is far looser than the app's bisection.
# An empty row or column margin gives p = 1 and NA estimates; NULL for an unusable table.
fisher_exact_full <- function(m, alternative = "two-sided") {
  if (!is.matrix(m) || any(dim(m) != 2)) return(NULL)
  if (!(alternative %in% c("two-sided", "less", "greater"))) return(NULL)
  a <- m[1, 1]; b <- m[1, 2]; c <- m[2, 1]; d <- m[2, 2]
  cells <- c(a, b, c, d)
  if (any(!is.finite(cells) | cells < 0 | cells != round(cells))) return(NULL)
  n <- sum(cells)
  if (n == 0) return(NULL)
  row_a <- a + b; row_b <- c + d; col_a <- a + c
  if (row_a == 0 || row_b == 0 || col_a == 0 || col_a == n) {
    return(list(pvalue = 1, conditionalOddsRatio = NA_real_, ciLow = NA_real_, ciHigh = NA_real_))
  }
  lo <- max(0, col_a - row_b); hi <- min(row_a, col_a)
  ks <- lo:hi
  logw <- lchoose(row_a, ks) + lchoose(row_b, col_a - ks)
  probs_at <- function(psi) {
    l <- logw + ks * log(psi)
    r <- exp(l - max(l))
    r / sum(r)
  }
  norm <- probs_at(1)
  idx <- a - lo + 1
  p <- if (identical(alternative, "less")) sum(norm[seq_len(idx)])
       else if (identical(alternative, "greater")) sum(norm[idx:length(norm)])
       else sum(norm[norm <= norm[idx] * (1 + 1e-7)])
  bisect <- function(go_up) {
    l <- -50; h <- 50
    for (i in 1:200) {
      mid <- (l + h) / 2
      if (go_up(exp(mid))) l <- mid else h <- mid
    }
    exp((l + h) / 2)
  }
  cor <- if (a <= lo) 0 else if (a >= hi) Inf
         else bisect(function(psi) sum(ks * probs_at(psi)) < a)
  # One-sided: the single bound sits at the full 1 - conf tail (fisher.test's conf.int).
  alpha <- if (alternative == "two-sided") (1 - 0.95) / 2 else 1 - 0.95
  ci_low <- if (a > lo && alternative != "less")
    bisect(function(psi) sum(probs_at(psi)[ks >= a]) < alpha) else 0
  ci_high <- if (a < hi && alternative != "greater")
    bisect(function(psi) sum(probs_at(psi)[ks <= a]) > alpha) else Inf
  list(pvalue = min(1, max(0, p)), conditionalOddsRatio = cor, ciLow = ci_low, ciHigh = ci_high)
}

cohens_w <- function(statistic, n) {
  if (!is.finite(statistic) || !is.finite(n) || n <= 0) return(NA_real_)
  sqrt(statistic / n)
}

# Port of ChiSquared.svelte `chisquared` (the "Categorical tests" node). testType
# "independence" (default), "goodness" or "fisher". For independence and Fisher the two
# wired columns are read per `dataFormat`: "groups" (the DEFAULT, also for sessions saved
# without it) treats each column as one independent group's outcomes; "paired"
# cross-tabulates them row by row. Like the app, a result it cannot compute (too few
# categories, an NA p-value) is VALID but writes nothing.
tp_chisquared <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  test_type <- if (!is.null(args$testType) && args$testType %in% c("goodness", "fisher"))
                 args$testType else "independence"
  data_format <- if (is.null(args$dataFormat)) "groups" else args$dataFormat
  correction <- !identical(args$correction, FALSE)
  is_ref <- function(id) !is.null(id) && id != -1 && !is.null(env$cols[[as.character(id)]])
  write <- function(stat, p, df, effect, ci_low = NA_real_, ci_high = NA_real_) {
    if (is.null(p) || is.na(p)) return(TRUE)  # the app gates the write on the p-value
    .write_result_rows(args, env, list(statistic = stat, pvalue = p, df = df,
                                       effectSize = effect, ciLow = ci_low, ciHigh = ci_high))
    TRUE
  }

  if (test_type %in% c("fisher", "independence")) {
    if (!is_ref(x_in) || !is_ref(y_in)) return(FALSE)
    rc <- env$cols[[as.character(x_in)]]; cc <- env$cols[[as.character(y_in)]]
    a <- col_data(rc, env$cols, env$raw_data); b <- col_data(cc, env$cols, env$raw_data)
    built <- if (identical(data_format, "groups"))
      groups_to_table(list(a, b), c(if (is.null(rc$name)) "Group 1" else rc$name,
                                    if (is.null(cc$name)) "Group 2" else cc$name))
      else contingency_table(a, b)
    tab <- built$table
    if (identical(test_type, "fisher")) {
      if (!(nrow(tab) == 2 && ncol(tab) == 2)) return(TRUE)
      alt <- if (is.null(args$alternative)) "two-sided" else args$alternative
      fx <- fisher_exact_full(tab, alt)
      if (is.null(fx)) return(TRUE)
      return(write(NA_real_, fx$pvalue, NA_real_, fx$conditionalOddsRatio, fx$ciLow, fx$ciHigh))
    }
    if (length(built$rowLabels) < 2 || length(built$colLabels) < 2 || sum(tab) <= 0) {
      return(TRUE)
    }
    res <- chi_square_independence_effects(tab, correction)
    return(write(res$statistic, res$pvalue, res$df, res$cramersV))
  }

  # goodness of fit: `gofInput` "auto" (default) reads an all-numeric column as observed
  # counts and anything else as categories (tabulated by first appearance), tested against a
  # uniform expectation; "counts" / "categories" force one reading (STAT-13). Missing cells
  # (NULL/NA, blank, NaN) are dropped first, and counts must be non-negative whole numbers,
  # else nothing is written (ChiSquared.svelte countsProblem).
  if (!is_ref(x_in)) return(FALSE)
  raw <- unlist(col_data(env$cols[[as.character(x_in)]], env$cols, env$raw_data),
                use.names = FALSE)
  gof_input <- if (!is.null(args$gofInput) && args$gofInput %in% c("auto", "counts", "categories"))
                 args$gofInput else "auto"
  present <- raw[!is_missing_category(raw)]
  nums <- if (is.logical(present)) rep(NA_real_, length(present))
          else suppressWarnings(as.numeric(present))
  as_counts <- identical(gof_input, "counts") ||
    (identical(gof_input, "auto") && length(present) > 0 && all(is.finite(nums)))
  if (as_counts && (!all(is.finite(nums)) || any(nums < 0) || any(nums != floor(nums)))) {
    return(TRUE)
  }
  observed <- if (as_counts) nums else {
    keys <- js_string(present)
    as.numeric(table(factor(keys, levels = unique(keys))))
  }
  if (length(observed) < 2) return(TRUE)
  res <- chi_square_goodness_of_fit(observed)
  write(res$statistic, res$pvalue, res$df, cohens_w(res$statistic, sum(observed)))
}

# LogisticRegression.svelte coerceBinary: levels are the distinct String() values of the cells
# that are not missing (is_missing_category: NULL/NA, NaN, "NaN", blank or whitespace; review
# STAT-24); all "0"/"1" -> Number(); exactly two other levels -> the later in sort order is 1;
# anything else is not binary. A missing cell is NaN in y, so the fit drops that row.
.logit_coerce_binary <- function(raw) {
  rl <- as.list(raw)
  absent <- function(v) is.null(v) || length(v) != 1 || isTRUE(is_missing_category(v))
  strs <- vapply(rl, function(v) if (absent(v)) NA_character_ else
    if (is.logical(v)) (if (v) "true" else "false") else js_string(v), character(1))
  levels <- unique(strs[!is.na(strs)])
  if (all(levels %in% c("0", "1"))) {
    return(list(y = vapply(rl, function(v) if (absent(v)) NaN else .js_number(v), numeric(1)),
                positive = "1"))
  }
  if (length(levels) != 2) return(list(y = rep(NaN, length(rl)), positive = NULL))
  # JS default sort compares UTF-16 code units; for these labels that is code-point order.
  positive <- levels[order(vapply(levels, function(l) paste(sprintf("%06x", utf8ToInt(l)),
                                                             collapse = ""), character(1)))][2]
  list(y = ifelse(is.na(strs), NaN, ifelse(strs == positive, 1, 0)), positive = positive)
}

tp_logisticregression <- function(args, env) {
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  x_ins <- id_list(args$xIN)
  x_ins <- x_ins[vapply(x_ins, function(i) !is.null(env$cols[[as.character(i)]]), logical(1))]
  if (y_in == -1 || is.null(env$cols[[as.character(y_in)]]) || !length(x_ins)) return(FALSE)
  cb <- .logit_coerce_binary(col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data))
  # Not a binary outcome: the app reports it and writes nothing (still "valid").
  if (is.null(cb$positive)) return(TRUE)
  y <- cb$y
  preds <- lapply(x_ins, function(i) col_data(env$cols[[as.character(i)]], env$cols, env$raw_data))
  nms <- vapply(x_ins, function(i) {
    nm <- env$cols[[as.character(i)]]$name
    if (is.null(nm)) as.character(i) else nm
  }, character(1))
  res <- logistic_regression(y, preds, nms)
  if (is.null(res) || !length(res$coef)) return(FALSE)
  # Wald CI on the ODDS RATIO, matching logistic.js:164 — exp(coef +/- 1.96*se), and NA
  # rather than a bogus interval when the standard error is not finite.
  z975 <- 1.959963984540054
  ci_low <- ifelse(is.finite(res$se), exp(res$coef - z975 * res$se), NA_real_)
  ci_high <- ifelse(is.finite(res$se), exp(res$coef + z975 * res$se), NA_real_)
  wrote <- .write_result_rows(args, env, list(
    term = res$term, coef = res$coef, se = res$se, z = res$z,
    pvalue = res$pvalue, oddsRatio = res$oddsRatio, ciLow = ci_low, ciHigh = ci_high))
  # Per-observation columns have a DIFFERENT length from the coefficient rows, so they go out
  # separately rather than as extra columns of the same table.
  for (key in c("outcome", "eta", "fitted")) {
    oid <- out_id(args, key)
    if (oid != -1 && !is.null(res[[key]])) {
      set_col(env, env$cols, oid, res[[key]], type = "number")
      wrote <- TRUE
    }
  }
  wrote
}

# interpolate.js knownPoints: house rule on both, Number(), finite only, sorted by x (stable),
# duplicate x keeps the LATER value.
interp_known_points <- function(x_data, y_data) {
  xl <- as.list(x_data); yl <- as.list(y_data)
  n <- min(length(xl), length(yl))
  xs <- numeric(0); ys <- numeric(0)
  for (i in seq_len(n)) {
    if (.js_invalid(xl[[i]]) || .js_invalid(yl[[i]])) next
    x <- .js_number(xl[[i]]); y <- .js_number(yl[[i]])
    if (is.finite(x) && is.finite(y)) { xs <- c(xs, x); ys <- c(ys, y) }
  }
  o <- order(xs, method = "radix")
  xs <- xs[o]; ys <- ys[o]
  if (length(xs) > 1) {
    # Keep the LAST of each run of equal x (the later value wins).
    keep <- c(xs[-1] != xs[-length(xs)], TRUE)
    xs <- xs[keep]; ys <- ys[keep]
  }
  list(xs = xs, ys = ys)
}

# Largest i (1-based) with xs[i] <= q, clamped to [1, n-1] (interpolate.js bracket).
.interp_bracket <- function(xs, q) {
  n <- length(xs)
  if (q <= xs[1]) return(1)
  if (q >= xs[n]) return(n - 1)
  lo <- 1; hi <- n
  while (hi - lo > 1) {
    mid <- (lo + hi) %/% 2
    if (xs[mid] <= q) lo <- mid else hi <- mid
  }
  lo
}

# interpolate.js makeInterpolator: NO extrapolation; linear, nearest (tie to the lower
# point) or natural cubic spline.
make_interpolator <- function(xs, ys, method = "linear") {
  n <- length(xs)
  if (n == 0) return(function(q) NaN)
  inner <- if (n == 1) function(q) ys[1]
  else if (identical(method, "nearest")) function(q) {
    if (q <= xs[1]) return(ys[1])
    if (q >= xs[n]) return(ys[n])
    i <- .interp_bracket(xs, q)
    if (q - xs[i] <= xs[i + 1] - q) ys[i] else ys[i + 1]
  } else if (identical(method, "spline")) {
    y2 <- numeric(n); u <- numeric(n)
    if (n > 2) for (i in 2:(n - 1)) {
      sig <- (xs[i] - xs[i - 1]) / (xs[i + 1] - xs[i - 1])
      p <- sig * y2[i - 1] + 2
      y2[i] <- (sig - 1) / p
      ui <- (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) - (ys[i] - ys[i - 1]) / (xs[i] - xs[i - 1])
      u[i] <- (6 * ui) / (xs[i + 1] - xs[i - 1])
      u[i] <- (u[i] - sig * u[i - 1]) / p
    }
    for (k in (n - 1):1) y2[k] <- y2[k] * y2[k + 1] + u[k]
    function(q) {
      if (q <= xs[1]) return(ys[1])
      if (q >= xs[n]) return(ys[n])
      klo <- .interp_bracket(xs, q); khi <- klo + 1
      h <- xs[khi] - xs[klo]
      a <- (xs[khi] - q) / h; b <- (q - xs[klo]) / h
      a * ys[klo] + b * ys[khi] + ((a^3 - a) * y2[klo] + (b^3 - b) * y2[khi]) * (h * h) / 6
    }
  } else function(q) {
    if (q <= xs[1]) return(ys[1])
    if (q >= xs[n]) return(ys[n])
    i <- .interp_bracket(xs, q)
    t <- (q - xs[i]) / (xs[i + 1] - xs[i])
    ys[i] + t * (ys[i + 1] - ys[i])
  }
  function(q) if (is.finite(q) && q >= xs[1] && q <= xs[n]) inner(q) else NaN
}

# interpolate.js MAX_GRID_POINTS: the largest resample grid (a guard against a step in the
# wrong units). Past it nothing is resampled and the same warning as the app's is given.
MAX_GRID_POINTS <- 2e6

# interpolate.js gridPointCount: points in make_grid(start, end, step), 0 if invalid.
grid_point_count <- function(start, end, step) {
  if (!all(is.finite(c(start, end, step))) || step <= 0 || end < start) return(0)
  floor((end - start) / step + 1e-9) + 1
}

# interpolate.js readable: 6 significant figures, never in exponent form, thousands
# separated. signif rounds an exact binary tie (976.5625) half to even where JS toPrecision
# rounds it up; the 1e-15 nudge sends such a tie up too and moves nothing else.
readable_number <- function(v) {
  trimws(format(signif(v * (1 + 1e-15), 6), scientific = FALSE, big.mark = ",", digits = 15))
}

# A whole number with thousands separators, at any size (formatC "d" stops at 2^31).
.thousands <- function(n) trimws(format(n, big.mark = ",", scientific = FALSE))

# interpolate.js gridTooLargeWarning: the warning text, or NULL when the grid fits.
# `lead` says what was refused and `hint` is any other way out after the step.
grid_too_large_warning <- function(start, end, step, unit = "", max_points = MAX_GRID_POINTS,
                                   lead = "Nothing was resampled",
                                   hint = ", or a shorter start to end range") {
  count <- grid_point_count(start, end, step)
  if (count <= max_points) return(NULL)
  need <- (end - start) / (max_points - 1)
  mag <- 10^(floor(log10(need)) - 1)
  min_step <- ceiling(need / mag - 1e-9) * mag
  paste0(lead, ": a step of ", readable_number(step), unit, " over ",
         readable_number(end - start), unit, " gives ",
         .thousands(count), " grid points, more than the limit of ",
         .thousands(max_points), ". Use a step of at least ",
         readable_number(min_step), unit, hint, ".")
}

# Parity probe for the resample-grid limit: the grid size and the warning ("" if none).
interpolate_grid_limit <- function(unused, start, end, step, unit = "") {
  w <- grid_too_large_warning(start, end, step, unit)
  list(count = grid_point_count(start, end, step), warning = if (is.null(w)) "" else w)
}

# interpolate.js makeGrid: start + i * step (no accumulated drift), end inclusive.
make_grid <- function(start, end, step, max_points = MAX_GRID_POINTS) {
  count <- grid_point_count(start, end, step)
  if (count == 0 || count > max_points) return(numeric(0))
  start + (seq_len(count) - 1) * step
}

# outputXSequence.js: "Specify output x values" > Sequence on the fitting nodes (see the
# Python port output_x_sequence for the rules: min to max of the valid x in the fit's frame,
# every outputXStep (default span / 500 snapped to 1-2-5), max included when on the grid,
# refused past MAX_GRID_POINTS with the shared warning).
OUTPUT_X_DEFAULT_POINTS <- 500
OUTPUT_X_LIMIT_LEAD <- "No output x sequence was made (the fit is shown at the input x)"

.output_x_specified <- function(args) {
  v <- args$outputX
  !is.null(v) && length(v) == 1 && !is.na(v) && v != -1
}
.output_x_is_sequence <- function(args) {
  .output_x_specified(args) && identical(args$outputXMode, "sequence")
}

# outputXSequence.js niceStep: the nearest 1-2-5 number on a log scale, or NULL.
nice_step <- function(v) {
  if (!is.numeric(v) || length(v) != 1 || !is.finite(v) || v <= 0) return(NULL)
  e <- floor(log10(v))
  scale <- function(c, k) if (k >= 0) c * 10^k else c / 10^(-k)
  m <- v / scale(1, e)
  k <- if (m < sqrt(2)) 1 else if (m < sqrt(10)) 2 else if (m < sqrt(50)) 5 else 10
  if (k == 10) scale(1, e + 1) else scale(k, e)
}

.output_x_range <- function(values) {
  vals <- Filter(function(e) !.js_invalid(e), as.list(values))
  nums <- vapply(vals, .js_number, numeric(1))
  nums <- nums[is.finite(nums)]
  if (!length(nums)) return(NULL)
  lo <- min(nums); hi <- max(nums)
  if (hi > lo) c(lo, hi) else NULL
}

default_output_x_step <- function(values) {
  r <- .output_x_range(values)
  if (is.null(r)) NULL else nice_step((r[2] - r[1]) / OUTPUT_X_DEFAULT_POINTS)
}

# list(values, step, warning); values NULL when no sequence is made.
output_x_sequence <- function(values, step, unit = "") {
  r <- .output_x_range(values)
  if (is.null(r)) return(list(values = NULL, step = NULL, warning = NULL))
  s <- if (is.null(step) || identical(step, "")) NaN else suppressWarnings(as.numeric(step))
  if (length(s) != 1 || !is.finite(s) || s <= 0) s <- default_output_x_step(values)
  if (is.null(s) || !(s > 0)) return(list(values = NULL, step = NULL, warning = NULL))
  if (grid_point_count(r[1], r[2], s) > MAX_GRID_POINTS) {
    return(list(values = NULL, step = s,
                warning = grid_too_large_warning(r[1], r[2], s, unit, MAX_GRID_POINTS,
                                                 lead = OUTPUT_X_LIMIT_LEAD, hint = "")))
  }
  list(values = make_grid(r[1], r[2], s), step = s, warning = NULL)
}

# outputXSequence.js resolveOutputX: list(origin, out) like fit_time_frame.
resolve_output_x <- function(x_col, args, cols, raw_data) {
  if (!.output_x_is_sequence(args)) {
    out_col <- if (.output_x_specified(args)) cols[[as.character(args$outputX)]] else NULL
    return(fit_time_frame(x_col, out_col, cols, raw_data))
  }
  is_time <- identical(x_col$type, "time")
  xs <- t_for_col(x_col, cols, raw_data)
  sq <- output_x_sequence(xs, args$outputXStep, if (is_time) " h" else "")
  list(origin = time_origin_ms(x_col, cols, raw_data), out = sq$values)
}

# Parity probe for the output x sequence (see the Python port output_x_sequence_probe).
output_x_sequence_probe <- function(values, step, unit = "") {
  sq <- output_x_sequence(values, step, unit)
  v <- sq$values
  d <- default_output_x_step(values)
  list(defaultStep = if (is.null(d)) NaN else d,
       count = length(v),
       first = if (length(v)) v[1] else NaN,
       last = if (length(v)) v[length(v)] else NaN,
       step = if (is.null(sq$step)) NaN else sq$step,
       warning = if (is.null(sq$warning)) "" else sq$warning)
}

# Port of Interpolate.svelte interpolatedata, matching the Python port: 'fill' keeps every
# input row and reads its y off the interpolant at its own x (a row with a present y but a
# missing x keeps its own y); 'resample' builds make_grid(start, end, step) in x units (hours
# for a time x). A time x is written back as epoch ms from the earliest time.
tp_interpolate <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  mode <- if (identical(args$mode, "resample")) "resample" else "fill"
  method <- if (!is.null(args$method) && args$method %in% c("linear", "nearest", "spline"))
    args$method else "linear"
  x_col <- env$cols[[as.character(x_in)]]
  is_time <- identical(x_col$type, "time")
  x_raw <- col_data(x_col, env$cols, env$raw_data)
  x_interp <- if (is_time) col_hours(x_col, env$cols, env$raw_data) else x_raw
  xr_num <- vapply(as.list(x_raw), function(v) if (.js_invalid(v)) NA_real_ else .js_number(v),
                   numeric(1))
  baseline <- if (is_time && any(!is.na(xr_num))) min(xr_num, na.rm = TRUE) else 0
  is_num1 <- function(v) is.numeric(v) && length(v) == 1 && is.finite(v)

  if (identical(mode, "resample")) {
    xi <- unlist(lapply(as.list(x_interp), function(v) if (is_num1(v)) v else NULL))
    if (!length(xi)) return(FALSE)
    start <- if (is_num1(args$start)) args$start else min(xi)
    end <- if (is_num1(args$end)) args$end else max(xi)
    step <- .js_number(args$step)
    too_large <- grid_too_large_warning(start, end, step, if (is_time) " h" else "")
    if (!is.null(too_large)) {
      # The app shows this on the node and empties the outputs.
      warning(paste0("Interpolate: ", too_large), call. = FALSE)
      return(FALSE)
    }
    query <- make_grid(start, end, step)
    if (!length(query)) return(FALSE)
    out_x <- if (is_time) baseline + query * 3600000 else query
  } else {
    query <- x_interp
    out_x <- x_raw
  }
  ql <- as.list(query)
  y_res <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y_data <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    kp <- interp_known_points(x_interp, y_data)
    if (!length(kp$xs)) next
    f <- make_interpolator(kp$xs, kp$ys, method)
    yl <- as.list(y_data)
    vals <- vapply(seq_along(ql), function(i) {
      q <- ql[[i]]
      if (.js_invalid(q)) {
        if (identical(mode, "fill") && i <= length(yl) && !.js_invalid(yl[[i]]))
          return(.js_number(yl[[i]]))
        return(NaN)
      }
      f(.js_number(q))
    }, numeric(1))
    y_res[[yk]] <- vals
  }
  if (!length(y_res)) return(FALSE)
  ox <- out_id(args, "interpx")
  if (ox != -1) {
    set_col(env, env$cols, ox, out_x, type = if (is_time) "time" else "number")
    for (yk in names(y_res))
      set_col(env, env$cols, out_id(args, paste0("interpy_", yk)), y_res[[yk]], type = "number")
  }
  TRUE
}

# ---------------------------------------------------------------------------
# Circular (directional) statistics
# ---------------------------------------------------------------------------

# Drop non-finite angles. Absent is not zero: a missing phase must not be counted as
# pointing at 0 rad, which would drag the mean direction toward it.
clean_angles <- function(angles_rad) {
  v <- suppressWarnings(as.numeric(unlist(angles_rad, use.names = FALSE)))
  v[is.finite(v)]
}

to_radians <- function(v, unit = "radians", period = 24) {
  vv <- suppressWarnings(as.numeric(v))
  if (length(vv) != 1 || !is.finite(vv)) return(NA_real_)
  if (identical(unit, "degrees")) return(vv * pi / 180)
  if (identical(unit, "hours")) {
    p <- if (is.finite(period) && period > 0) period else 24
    return((vv / p) * 2 * pi)
  }
  vv
}

angles_col_to_radians <- function(data, unit, period) {
  vapply(data, function(v) {
    if (is.null(v) || length(v) != 1) return(NA_real_)
    if (is.character(v) && !nzchar(trimws(v))) return(NA_real_)
    to_radians(v, unit, period)
  }, numeric(1), USE.NAMES = FALSE)
}

circular_mean <- function(angles_rad) {
  a <- clean_angles(angles_rad)
  n <- length(a)
  if (!n) return(list(meanAngle = NA_real_, R = NA_real_, n = 0, C = NA_real_, S = NA_real_))
  C <- mean(cos(a)); S <- mean(sin(a))
  ma <- atan2(S, C)
  # Wrapped into [0, 2pi) rather than left in atan2's (-pi, pi]: the acrophase is reported
  # as a time of day, and a negative one reads as the previous day.
  if (ma < 0) ma <- ma + 2 * pi
  list(meanAngle = ma, R = sqrt(C * C + S * S), n = n, C = C, S = S)
}

# Rayleigh test of uniformity, with the standard second-order p-value expansion.
rayleigh_test <- function(angles_rad) {
  cm <- circular_mean(angles_rad)
  n <- cm$n
  if (!n) return(list(n = 0, R = NA_real_, meanAngle = NA_real_, z = NA_real_, pValue = NA_real_))
  R <- cm$R
  z <- n * R * R
  inner <- (1 + (2 * z - z * z) / (4 * n)
            - (24 * z - 132 * z * z + 76 * z^3 - 9 * z^4) / (288 * n * n))
  p <- exp(-z) * inner
  # The expansion can overshoot outside its useful range; fall back to the leading term and
  # clamp, exactly as the JS and Python do, so a p-value is never negative or above 1.
  if (!is.finite(p)) p <- exp(-z)
  p <- min(1, max(0, p))
  list(n = n, R = R, meanAngle = cm$meanAngle, z = z, pValue = p)
}

resultant <- function(angles_rad) {
  a <- clean_angles(angles_rad)
  n <- length(a)
  C <- sum(cos(a)); S <- sum(sin(a))
  r <- sqrt(C * C + S * S)
  list(n = n, C = C, S = S, r = r, rBar = if (n > 0) r / n else NA_real_)
}

# Concentration parameter from the mean resultant length (Fisher 1993, piecewise approx).
kappa_from_rbar <- function(r_bar) {
  if (!is.finite(r_bar) || r_bar <= 0) return(0)
  if (r_bar >= 1) return(Inf)
  if (r_bar < 0.53) return(2 * r_bar + r_bar^3 + (5 * r_bar^5) / 6)
  if (r_bar < 0.85) return(-0.4 + 1.39 * r_bar + 0.43 / (1 - r_bar))
  1 / (r_bar^3 - 4 * r_bar^2 + 3 * r_bar)
}

p_upper_from_f <- function(F, df1, df2) {
  if (!is.finite(F) || !is.finite(df1) || !is.finite(df2)) return(NA_real_)
  if (df1 <= 0 || df2 <= 0 || F < 0) return(NA_real_)
  pf(F, df1, df2, lower.tail = FALSE)
}

# Watson-Williams test for equal mean directions across groups.
watson_williams <- function(groups_of_angles) {
  groups <- Filter(function(g) g$n > 0, lapply(groups_of_angles, resultant))
  k <- length(groups)
  invalid <- list(k = k, N = 0, F = NA_real_, df1 = NA_real_, df2 = NA_real_,
                  kappa = NA_real_, beta = NA_real_, Rsum = NA_real_, r = NA_real_,
                  pValue = NA_real_, valid = FALSE)
  if (k < 2) return(invalid)
  N <- sum(vapply(groups, function(g) g$n, numeric(1)))
  if (N <= k) { invalid$N <- N; return(invalid) }
  Rsum <- sum(vapply(groups, function(g) g$r, numeric(1)))
  Cp <- sum(vapply(groups, function(g) g$C, numeric(1)))
  Sp <- sum(vapply(groups, function(g) g$S, numeric(1)))
  r <- sqrt(Cp * Cp + Sp * Sp)
  kappa <- kappa_from_rbar(Rsum / N)
  beta <- if (kappa == 0) Inf else 1 + 3 / (8 * kappa)
  denom <- (k - 1) * (N - Rsum)
  F <- if (denom == 0) {
    if ((Rsum - r) == 0) 0 else Inf
  } else beta * (N - k) * (Rsum - r) / denom
  df1 <- k - 1; df2 <- N - k
  p <- if (is.finite(F)) p_upper_from_f(F, df1, df2) else if (is.infinite(F)) 0 else NA_real_
  list(k = k, N = N, F = F, df1 = df1, df2 = df2, kappa = kappa, beta = beta,
       Rsum = Rsum, r = r, pValue = p, valid = TRUE)
}


# Weighted-mode helpers for RayleighTest, when a time column supplies the angle and the Y
# value supplies the weight.

# Hours for the weighted-mode time input. A 'time' column is epoch-ms -> ABSOLUTE hours with
# NO baseline subtraction, which is deliberately NOT col_hours(): the phase is a time of day,
# so shifting it by the recording start would rotate every point.
column_to_phase_hours <- function(data, col_type) {
  vapply(data, function(v) {
    if (is.null(v) || length(v) != 1) return(NA_real_)
    if (is.character(v) && !nzchar(trimws(v))) return(NA_real_)
    n <- suppressWarnings(as.numeric(v))
    if (length(n) != 1 || !is.finite(n)) return(NA_real_)
    if (identical(col_type, "time")) n / 3600000 else n
  }, numeric(1), USE.NAMES = FALSE)
}

# Fold hours modulo the period and map onto the circle. The double modulo keeps a negative
# hour (a phase before the origin) on the circle rather than off it.
time_to_angle_rad <- function(hours, period) {
  if (!is.finite(hours)) return(NA_real_)
  p <- if (is.finite(period) && period > 0) period else 24
  ((hours %% p + p) %% p) / p * (2 * pi)
}

weighted_circular_mean <- function(angles_rad, weights) {
  a <- suppressWarnings(as.numeric(unlist(angles_rad, use.names = FALSE)))
  w <- suppressWarnings(as.numeric(unlist(weights, use.names = FALSE)))
  m <- min(length(a), length(w))
  a <- a[seq_len(m)]; w <- w[seq_len(m)]
  ok <- is.finite(a) & is.finite(w)
  n <- sum(ok)
  if (!n) return(list(meanAngle = NA_real_, R = NA_real_, n = 0, W = NA_real_,
                      C = NA_real_, S = NA_real_))
  C <- sum(w[ok] * cos(a[ok])); S <- sum(w[ok] * sin(a[ok])); W <- sum(w[ok])
  if (W <= 0) return(list(meanAngle = NA_real_, R = NA_real_, n = n, W = W,
                          C = NA_real_, S = NA_real_))
  mean_a <- atan2(S, C)
  if (mean_a < 0) mean_a <- mean_a + 2 * pi
  list(meanAngle = mean_a, R = sqrt(C * C + S * S) / W, n = n, W = W, C = C, S = S)
}

# Rayleigh on weighted data. The EFFECTIVE n is W^2 / sum(w^2) (Kish), not the row count:
# a handful of large weights carries less evidence than the same number of equal ones, and
# using n would overstate significance.
weighted_rayleigh <- function(angles_rad, weights) {
  cm <- weighted_circular_mean(angles_rad, weights)
  a <- suppressWarnings(as.numeric(unlist(angles_rad, use.names = FALSE)))
  w <- suppressWarnings(as.numeric(unlist(weights, use.names = FALSE)))
  m <- min(length(a), length(w))
  ok <- is.finite(a[seq_len(m)]) & is.finite(w[seq_len(m)])
  sum_sq <- sum(w[seq_len(m)][ok]^2)
  n <- cm$n; R <- cm$R; W <- cm$W
  if (!n || !is.finite(W) || W <= 0 || sum_sq <= 0 || !is.finite(R)) {
    return(list(n = n, nEff = NA_real_, R = NA_real_, meanAngle = NA_real_,
                z = NA_real_, pValue = NA_real_,
                W = if (is.finite(W)) W else NA_real_))
  }
  n_eff <- (W * W) / sum_sq
  z <- n_eff * R * R
  inner <- (1 + (2 * z - z * z) / (4 * n_eff)
            - (24 * z - 132 * z * z + 76 * z^3 - 9 * z^4) / (288 * n_eff * n_eff))
  p <- exp(-z) * inner
  if (!is.finite(p)) p <- exp(-z)
  p <- min(1, max(0, p))
  list(n = n, nEff = n_eff, R = R, meanAngle = cm$meanAngle, z = z, pValue = p, W = W)
}

# ---------------------------------------------------------------------------
# Circadian Function Index
# ---------------------------------------------------------------------------

clamp01 <- function(v) {
  if (!is.finite(v)) return(NA_real_)
  min(1, max(0, v))
}

# CFI = mean of IS, the COMPLEMENT of IV (rescaled so higher is better), and RA.
# Ortiz-Tudela et al. IV runs 0..2 with LOW meaning consolidated, so (2 - IV) / 2 flips it
# into the same "higher is better" 0..1 sense as the other two before averaging.
circadian_function_index <- function(IS = NA_real_, IV = NA_real_, RA = NA_real_) {
  is_c <- clamp01(IS)
  iv_c <- if (is.finite(IV)) clamp01((2 - IV) / 2) else NA_real_
  ra_c <- clamp01(RA)
  comps <- list(IS = is_c, IVcomplement = iv_c, RA = ra_c)
  if (!is.finite(is_c) || !is.finite(iv_c) || !is.finite(ra_c)) {
    return(list(CFI = NA_real_, components = comps))
  }
  list(CFI = (is_c + iv_c + ra_c) / 3, components = comps)
}

# --- the analyses ----------------------------------------------------------

tp_fdrcorrection <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  k <- as.character(x_in)
  if (x_in == -1 || is.null(env$cols[[k]])) return(FALSE)
  data <- col_data(env$cols[[k]], env$cols, env$raw_data)
  if (!length(data)) return(FALSE)
  method <- if (is.null(args$method)) "benjamini-hochberg" else args$method
  if (!(method %in% c("none", "bonferroni", "holm",
                      "benjamini-hochberg", "benjamini-yekutieli"))) {
    method <- "benjamini-hochberg"
  }
  alpha <- suppressWarnings(as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha))
  if (length(alpha) != 1 || !is.finite(alpha)) alpha <- 0.05
  padj <- p_adjust(data, method)$adjusted
  # A test that could not run stays NA rather than becoming "not rejected": absence of a
  # p-value is not evidence against the hypothesis.
  reject <- ifelse(is.finite(padj), as.numeric(padj < alpha), NA_real_)
  set_col(env, env$cols, out_id(args, "padj"), padj, type = "number")
  set_col(env, env$cols, out_id(args, "reject"), reject, type = "number")
  sum(is.finite(padj)) > 0
}

tp_circadianfunctionindex <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  epoch <- as.numeric(if (is.null(args$epochHours)) 1 else args$epochHours)
  period <- as.numeric(if (is.null(args$period)) 24 else args$period)
  m_window <- as.numeric(if (is.null(args$mWindow)) 10 else args$mWindow)
  l_window <- as.numeric(if (is.null(args$lWindow)) 5 else args$lWindow)
  t <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  if (!length(t)) return(FALSE)
  per_y <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    if (!length(y)) next
    res <- compute_npcra(t, y, epoch, period, m_window, l_window)
    if (is.null(res)) next
    per_y[[yk]] <- list(CFI = circadian_function_index(res$IS, res$IV, res$RA)$CFI,
                        IS = res$IS, IV = res$IV, RA = res$RA)
    any_valid <- TRUE
  }
  if (!any_valid) return(FALSE)
  for (key in c("CFI", "IS", "IV", "RA")) {
    arr <- vapply(y_ins, function(y) {
      r <- per_y[[as.character(y)]]
      if (is.null(r)) NA_real_ else as.numeric(r[[key]])
    }, numeric(1))
    set_col(env, env$cols, out_id(args, key), arr, type = "number")
  }
  TRUE
}

tp_rayleightest <- function(args, env) {
  y_ins <- id_list(args$yIN)
  if (!length(y_ins)) return(FALSE)
  unit <- if (is.null(args$unit)) "radians" else args$unit
  period <- suppressWarnings(as.numeric(if (is.null(args$period)) 24 else args$period))
  if (length(period) != 1 || !is.finite(period)) period <- 24

  # `timeIN`, when wired, switches the node to amplitude-weighted mode: the time column
  # supplies the angle, the Y value is the weight, and `unit` is ignored.
  time_in <- if (is.null(args$timeIN)) -1 else args$timeIN
  time_col <- if (time_in != -1) env$cols[[as.character(time_in)]] else NULL

  per_y <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y_col <- env$cols[[yk]]
    if (!is.null(time_col)) {
      angles <- vapply(column_to_phase_hours(col_data(time_col, env$cols, env$raw_data),
                                             time_col$type),
                       time_to_angle_rad, numeric(1), period)
      st <- weighted_rayleigh(angles, col_data(y_col, env$cols, env$raw_data))
      if (st$n > 0) {
        # Scaled by the DISPLAY period, which falls back to 24 when period <= 0 — the same
        # fallback time_to_angle_rad already applies, so the angle and its label agree.
        dp <- if (is.finite(period) && period > 0) period else 24
        mv <- if (is.finite(st$meanAngle)) (st$meanAngle / (2 * pi)) * dp else NA_real_
        # No z or p in timed mode (FIT-11), as weightedSeriesStats: the weights are the
        # series' values, so the weighted Rayleigh p moves with a constant baseline.
        per_y[[yk]] <- list(R = st$R, z = NA_real_, pValue = NA_real_,
                            meanAngle = st$meanAngle, meanValue = mv)
        any_valid <- TRUE
      }
      next
    }
    angles <- angles_col_to_radians(col_data(y_col, env$cols, env$raw_data), unit, period)
    res <- rayleigh_test(angles)
    if (res$n > 0) {
      mean_value <- if (is.finite(res$meanAngle)) (res$meanAngle / (2 * pi)) * period else NA_real_
      per_y[[yk]] <- c(res, list(meanValue = mean_value))
      any_valid <- TRUE
    }
  }
  if (!any_valid) return(FALSE)
  fields <- c(R = "R", z = "z", pvalue = "pValue", acrophase = "meanValue")
  for (key in names(fields)) {
    arr <- vapply(y_ins, function(y) {
      r <- per_y[[as.character(y)]]
      if (is.null(r)) NA_real_ else as.numeric(r[[fields[[key]]]])
    }, numeric(1))
    set_col(env, env$cols, out_id(args, key), arr, type = "number")
  }
  # Watson-Williams is a SINGLE F/p across the groups, and is meaningless in timed mode
  # (yIN then holds amplitudes, not event angles). The ports are always written so they stay
  # numeric and present; NaN means "not run", not "no difference".
  ww_F <- NA_real_; ww_p <- NA_real_
  if (isTRUE(args$showWatsonWilliams) && is.null(time_col)) {
    groups <- lapply(y_ins, function(y) {
      yk <- as.character(y)
      if (is.null(env$cols[[yk]])) return(numeric(0))
      angles_col_to_radians(col_data(env$cols[[yk]], env$cols, env$raw_data), unit, period)
    })
    result <- watson_williams(groups)
    if (isTRUE(result$valid)) { ww_F <- result$F; ww_p <- result$pValue }
  }
  set_col(env, env$cols, out_id(args, "F"), ww_F, type = "number")
  set_col(env, env$cols, out_id(args, "ww_pvalue"), ww_p, type = "number")
  TRUE
}

# ---------------------------------------------------------------------------
# Rectangular-wave fit
# ---------------------------------------------------------------------------

# M + A*tanh(k*(sin(wt + phi) - cos(pi*d))). The tanh squares off the cosine: large k gives
# a near-rectangular wave, and d sets the duty cycle through the offset it subtracts.
rectwave_model <- function(p, t) {
  p[1] + p[2] * tanh(p[3] * (sin(p[4] * t + p[5]) - cos(pi * p[6])))
}

evaluate_rectwave_at_points <- function(parameters, x_points) {
  xa <- suppressWarnings(as.numeric(unlist(x_points, use.names = FALSE)))
  rectwave_model(c(parameters$M, parameters$A, parameters$kappa,
                   parameters$omega, parameters$phi, parameters$dutyCycle), xa)
}

# solveLinearSystem (rectwave.js / doublelogistic.js): Gaussian elimination with partial
# pivoting; an error on a pivot below 1e-12.
.solve_linear_js <- function(A, b) {
  n <- nrow(A); aug <- cbind(A, b)
  for (i in seq_len(n)) {
    mx <- i - 1 + which.max(abs(aug[i:n, i]))
    if (mx != i) { tmp <- aug[i, ]; aug[i, ] <- aug[mx, ]; aug[mx, ] <- tmp }
    if (abs(aug[i, i]) < 1e-12) stop("Singular matrix")
    if (i < n) for (k in (i + 1):n) {
      f <- aug[k, i] / aug[i, i]
      aug[k, i:(n + 1)] <- aug[k, i:(n + 1)] - f * aug[i, i:(n + 1)]
    }
  }
  sol <- numeric(n)
  for (i in n:1) {
    s <- aug[i, n + 1]
    if (i < n) s <- s - sum(aug[i, (i + 1):n] * sol[(i + 1):n])
    sol[i] <- s / aug[i, i]
  }
  sol
}

.rw_normal_eqs <- function(t, x, p, free) {
  A <- p[2]; k <- p[3]; w <- p[4]; phi <- p[5]; d <- p[6]
  arg <- w * t + phi
  ca <- cos(arg); s <- sin(arg) - cos(pi * d)
  th <- tanh(k * s); sech2 <- 1 - th * th
  r <- x - (p[1] + A * th)
  J <- cbind(-1, -th, -A * s * sech2, -A * k * t * ca * sech2, -A * k * ca * sech2,
             -A * k * pi * sin(pi * d) * sech2)[, free, drop = FALSE]
  list(JtJ = crossprod(J), JtR = as.vector(crossprod(J, r)), rss = sum(r * r))
}

# rectwave.js fitWithLM, step for step (see the Python port).
.rw_fit_lm <- function(t, x, params, free, max_iter, tol, w_lo, w_hi) {
  p <- params
  p[4] <- min(w_hi, max(w_lo, p[4]))
  lam <- 0.01
  ne <- .rw_normal_eqs(t, x, p, free)
  converged <- FALSE; iterations <- 0
  w_pos <- match(4, free)
  for (it in seq_len(max_iter)) {
    iterations <- it
    frozen <- !is.na(w_pos) && ((p[4] <= w_lo && ne$JtR[w_pos] > 0) ||
                                (p[4] >= w_hi && ne$JtR[w_pos] < 0))
    JtJd <- ne$JtJ
    dg <- diag(ne$JtJ)
    diag(JtJd) <- dg + lam * ifelse(dg > 0, dg, 1)
    rhs <- ne$JtR
    if (frozen) {
      JtJd[w_pos, ] <- 0; JtJd[, w_pos] <- 0; JtJd[w_pos, w_pos] <- 1; rhs[w_pos] <- 0
    }
    delta <- tryCatch(.solve_linear_js(JtJd, rhs), error = function(e) NULL)
    if (is.null(delta)) {
      lam <- min(lam * 10, 1e12)
      if (lam >= 1e12) { converged <- TRUE; break }
      next
    }
    np_ <- p
    np_[free] <- p[free] - delta
    np_[3] <- max(0.01, np_[3])
    np_[4] <- max(w_lo, min(np_[4], w_hi))
    np_[6] <- max(0.01, min(np_[6], 0.99))
    nne <- .rw_normal_eqs(t, x, np_, free)
    if (is.finite(nne$rss) && nne$rss < ne$rss) {
      rel <- (ne$rss - nne$rss) / (ne$rss + 1e-10)
      p <- np_; ne <- nne
      lam <- max(lam / 3, 1e-10)
      if (rel < tol) { converged <- TRUE; break }
    } else {
      lam <- min(lam * 10, 1e12)
      if (lam >= 1e12) { converged <- TRUE; break }
    }
  }
  rss <- ne$rss; n <- length(t)
  fitted <- rectwave_model(p, t)
  xm <- mean(x); sst <- sum((x - xm)^2)
  r2 <- if (sst > 0) 1 - rss / sst else 0
  if (p[2] < 0) { p[2] <- -p[2]; p[5] <- p[5] + pi; p[6] <- 1 - p[6] }
  p[5] <- atan2(sin(p[5]), cos(p[5]))
  period <- 2 * pi / p[4]
  acro <- (pi / 2 - p[5]) / p[4]
  acro <- .js_mod(.js_mod(acro, period) + period, period)
  side <- NA_character_
  if (!is.na(w_pos)) {
    if (abs(p[4] - w_lo) <= .BOUND_RTOL * w_lo) side <- "max"
    else if (abs(p[4] - w_hi) <= .BOUND_RTOL * w_hi) side <- "min"
  }
  list(parameters = list(M = p[1], A = p[2], kappa = p[3], omega = p[4], phi = p[5],
                         dutyCycle = p[6]),
       period = period, acrophase = acro, fitted = fitted, rmse = sqrt(rss / n),
       rSquared = r2, rss = rss,
       diagnostics = list(converged = converged && all(is.finite(p)) && is.finite(rss),
                          iterations = iterations, atBound = side))
}

# Port of utils/rectwave.js fitRectangularWave (FIT-1), matching the Python port: the JS
# multi-start Levenberg-Marquardt, free period bounded to [minPeriod, maxPeriod] (default
# 1-48 h), start s seeded from the s-th least-squares periodogram peak, phi = pi/2 -
# atan2(S, C). Callers pass the valid (t, x) pairs.
fit_rectangular_wave <- function(t, x, options = list()) {
  t <- as.numeric(t); x <- as.numeric(x)
  o <- options
  g <- function(k, d) if (is.null(o[[k]])) d else o[[k]]
  fix_kappa <- isTRUE(o$fixKappa); fix_omega <- isTRUE(o$fixOmega)
  fix_d <- isTRUE(o$fixDutyCycle) || isTRUE(o$fixD)
  fixed_kappa <- g("fixedKappa", 5); fixed_omega <- o$fixedOmega
  fixed_d <- g("fixedDutyCycle", 0.5)
  max_iter <- g("maxIterations", 10000); tol <- g("tolerance", 1e-6)
  n_starts <- g("numStarts", 5)
  if (fix_omega && !(is.numeric(fixed_omega) && length(fixed_omega) == 1 &&
                     is.finite(fixed_omega) && fixed_omega > 0))
    stop("fit_rectangular_wave: fixOmega needs a positive finite fixedOmega")
  w_lo <- 0.001; w_hi <- 100; rng <- NULL; peaks <- NULL
  if (!fix_omega) {
    rng <- resolve_period_range(t, g("minPeriod", FREE_PERIOD_DEFAULTS$minPeriod),
                                g("maxPeriod", FREE_PERIOD_DEFAULTS$maxPeriod))
    if (is.null(rng)) return(NULL)
    w_lo <- 2 * pi / rng$maxPeriod; w_hi <- 2 * pi / rng$minPeriod
    peaks <- 2 * pi * scan_periodogram(t, x, rng$minPeriod, rng$maxPeriod, n_starts)
  }
  free <- sort(c(1, 2, 5, if (!fix_kappa) 3, if (!fix_omega) 4, if (!fix_d) 6))
  n <- length(x)
  if (!n) return(NULL)
  mu <- sum(x) / n
  half <- (max(x) - min(x)) / 2
  d_seeds <- c(0.5, 0.3, 0.7, 0.4, 0.6); k_seeds <- c(5, 2, 10, 3, 8)
  best <- NULL; best_rmse <- Inf
  for (st in 0:(n_starts - 1)) {
    w <- if (fix_omega && !is.null(fixed_omega)) fixed_omega else {
      ww <- if (length(peaks)) peaks[min(st, length(peaks) - 1) + 1] else 2 * pi / 24
      min(w_hi, max(w_lo, ww))
    }
    kap <- if (fix_kappa) fixed_kappa else k_seeds[st %% 5 + 1]
    d <- if (fix_d) fixed_d else d_seeds[st %% 5 + 1]
    cs <- sum((x - mu) * cos(w * t)); sn <- sum((x - mu) * sin(w * t))
    params <- c(mu, if (half > 0) half else 1, kap, w, pi / 2 - atan2(sn, cs), d)
    res <- tryCatch(.rw_fit_lm(t, x, params, free, max_iter, tol, w_lo, w_hi),
                    error = function(e) NULL)
    if (!is.null(res) && is.finite(res$rmse) && res$rmse < best_rmse) {
      best_rmse <- res$rmse; best <- res
    }
  }
  if (!is.null(best)) {
    best$diagnostics$periodRange <- if (is.null(rng)) NULL else c(rng$minPeriod, rng$maxPeriod)
    if (fix_omega) best$diagnostics$atBound <- NA_character_
  }
  best
}

tp_rectangularwave <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  fix_omega <- isTRUE(args$fixOmega)
  fp <- if (is.null(args$fixedPeriod)) 24 else .js_number(args$fixedPeriod)
  opts <- list(fixKappa = args$fixKappa, fixedKappa = args$fixedKappa, fixOmega = fix_omega,
               fixedOmega = if (fix_omega) 2 * pi / fp else NULL,
               fixDutyCycle = args$fixDutyCycle, fixedDutyCycle = args$fixedDutyCycle,
               minPeriod = args$minPeriod, maxPeriod = args$maxPeriod)
  # Column or sequence output x (resolve_output_x, outputXSequence.js).
  frm <- resolve_output_x(x_col, args, env$cols, env$raw_data)
  output_x <- frm$out
  origin <- if (is.null(frm$origin)) NA_real_ else frm$origin

  first_xs <- NULL; any_valid <- FALSE; stats_by_y <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    pr <- .pgram_pairs(t, y)
    if (length(pr$t) < 4) next
    res <- fit_rectangular_wave(pr$t, pr$y, opts)
    if (is.null(res)) next
    xs_out <- if (!is.null(output_x)) output_x else pr$t
    ys <- if (!is.null(output_x)) evaluate_rectwave_at_points(res$parameters, output_x)
          else res$fitted
    if (is.null(first_xs)) {
      first_xs <- xs_out
      if (is.finite(origin)) set_col(env, env$cols, out_id(args, "rectwavex"),
                                     origin + first_xs * 3600000, type = "time")
      else set_col(env, env$cols, out_id(args, "rectwavex"), first_xs, type = "number")
    }
    y_out <- out_id(args, paste0("rectwavey_", y_id))
    if (y_out == -1) y_out <- out_id(args, "rectwavey")
    set_col(env, env$cols, y_out, ys, type = "number")
    # Residuals (RectangularWave.svelte): only with the x output wired; the model evaluated
    # at every input x.
    rid <- out_id(args, paste0("resid_", y_id))
    if (rid != -1 && out_id(args, "rectwavex") != -1) {
      prm <- res$parameters
      set_col(env, env$cols, rid,
              .fit_residuals(function(p) evaluate_rectwave_at_points(prm, p), t, y),
              type = "number")
    }
    stats_by_y[[yk]] <- res
    any_valid <- TRUE
  }
  if (any_valid) {
    # r2/rmse are declared ports that the Python port never wrote until 2026-07-28;
    # `perm_pvalue` (renamed from the bare `pvalue` in JS v72.25 — the permutation
    # test's p, the only p this node emits) belongs to a Monte Carlo test not run
    # here, so it stays NA — "not computed", not "not significant".
    for (key in c("r2", "rmse", "perm_pvalue")) {
      arr <- vapply(y_ins, function(y) {
        r <- stats_by_y[[as.character(y)]]
        if (is.null(r)) NA_real_
        else if (key == "r2") r$rSquared
        else if (key == "rmse") r$rmse
        else NA_real_
      }, numeric(1))
      set_col(env, env$cols, out_id(args, key), arr, type = "number")
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# Double-logistic fit
# ---------------------------------------------------------------------------

sigmoid <- function(z) 1 / (1 + exp(-z))

# Port of utils/doublelogistic.js (FIT-1, FIT-2), matching the Python port: the JS
# multi-start Levenberg-Marquardt; periodic mode works in [M, A, k1, t1, k2, u, T] with
# t2 = t1 + T sigmoid(u) (|u| <= 30) so tiles never overlap, a free T stays inside
# [minPeriod, maxPeriod] with periodogram-peak starts, and the result is the canonical A >= 0
# form. Tiles run over computeJRange.
.dl_jrange <- function(t, t1, t2, T)
  c(floor((min(t) - max(t1, t2)) / T) - 1, ceiling((max(t) - min(t1, t2)) / T) + 1)

.dl_eval <- function(t, m, periodic) {
  if (!periodic) return(m[1] + m[2] * (sigmoid(m[3] * (t - m[4])) - sigmoid(m[5] * (t - m[6]))))
  jr <- .dl_jrange(t, m[4], m[6], m[7]); j <- jr[1]:jr[2]
  m[1] + m[2] * rowSums(sigmoid(m[3] * outer(t, m[4] + j * m[7], "-")) -
                          sigmoid(m[5] * outer(t, m[6] + j * m[7], "-")))
}

.dl_to_model <- function(q) c(q[1:5], q[4] + q[7] * sigmoid(q[6]), q[7])

canonical_periodic_params <- function(m) {
  if (!(m[2] < 0)) return(m)
  c(m[1] + m[2], -m[2], m[5], m[6], m[3], m[4] + m[7], m[7])
}

.dl_ne <- function(t, x, q, free, periodic) {
  if (!periodic) {
    A <- q[2]; k1 <- q[3]; t1 <- q[4]; k2 <- q[5]; t2 <- q[6]
    s1 <- sigmoid(k1 * (t - t1)); s2 <- sigmoid(k2 * (t - t2))
    s1p <- s1 * (1 - s1); s2p <- s2 * (1 - s2)
    r <- x - (q[1] + A * (s1 - s2))
    J <- cbind(-1, -(s1 - s2), -A * s1p * (t - t1), A * k1 * s1p, A * s2p * (t - t2),
               -A * k2 * s2p)
  } else {
    m <- .dl_to_model(q)
    A <- m[2]; k1 <- m[3]; t1 <- m[4]; k2 <- m[5]; t2 <- m[6]; T <- m[7]
    sg <- sigmoid(q[6])
    jr <- .dl_jrange(t, t1, t2, T); j <- jr[1]:jr[2]
    d1 <- outer(t, t1 + j * T, "-"); d2 <- outer(t, t2 + j * T, "-")
    s1 <- sigmoid(k1 * d1); s2 <- sigmoid(k2 * d2)
    s1p <- s1 * (1 - s1); s2p <- s2 * (1 - s2)
    jm <- matrix(j, nrow = length(t), ncol = length(j), byrow = TRUE)
    a1 <- rowSums(s1 - s2); b1 <- rowSums(s1p * d1); c1 <- rowSums(s1p)
    dd <- rowSums(s2p * d2); e1 <- rowSums(s2p)
    f1 <- rowSums(jm * k1 * s1p); g1 <- rowSums(jm * k2 * s2p)
    r <- x - (m[1] + A * a1)
    dT1 <- A * k1 * c1; dT2 <- -A * k2 * e1; dT <- A * (f1 - g1)
    J <- cbind(-1, -a1, -A * b1, dT1 + dT2, A * dd, dT2 * T * sg * (1 - sg), dT + dT2 * sg)
  }
  J <- J[, free, drop = FALSE]
  list(JtJ = crossprod(J), JtR = as.vector(crossprod(J, r)), rss = sum(r * r))
}

.dl_fit_lm <- function(t, x, params, free, periodic, max_iter, tol, t_lo = 0.1, t_hi = Inf) {
  p <- params
  if (periodic) {
    p[7] <- min(t_hi, max(t_lo, p[7]))
    frac <- min(0.98, max(0.02, (params[6] - params[4]) / p[7]))
    p[6] <- log(frac / (1 - frac))
  }
  t_pos <- if (periodic) match(7, free) else NA
  lam <- 0.01
  ne <- .dl_ne(t, x, p, free, periodic)
  converged <- FALSE; iterations <- 0
  for (it in seq_len(max_iter)) {
    iterations <- it
    frozen <- !is.na(t_pos) && ((p[7] <= t_lo && ne$JtR[t_pos] > 0) ||
                                (p[7] >= t_hi && ne$JtR[t_pos] < 0))
    JtJd <- ne$JtJ; dg <- diag(ne$JtJ)
    diag(JtJd) <- dg + lam * ifelse(dg > 0, dg, 1)
    rhs <- ne$JtR
    if (frozen) { JtJd[t_pos, ] <- 0; JtJd[, t_pos] <- 0; JtJd[t_pos, t_pos] <- 1; rhs[t_pos] <- 0 }
    delta <- tryCatch(.solve_linear_js(JtJd, rhs), error = function(e) NULL)
    if (is.null(delta)) {
      lam <- min(lam * 10, 1e12)
      if (lam >= 1e12) { converged <- TRUE; break }
      next
    }
    np_ <- p; np_[free] <- p[free] - delta
    np_[3] <- max(1e-4, np_[3]); np_[5] <- max(1e-4, np_[5])
    if (periodic) {
      np_[7] <- min(t_hi, max(t_lo, np_[7])); np_[6] <- min(30, max(-30, np_[6]))
    } else if (np_[6] <= np_[4]) np_[6] <- np_[4] + 0.01
    nne <- .dl_ne(t, x, np_, free, periodic)
    if (is.finite(nne$rss) && nne$rss < ne$rss) {
      rel <- (ne$rss - nne$rss) / (ne$rss + 1e-10)
      p <- np_; ne <- nne
      lam <- max(lam / 3, 1e-10)
      if (rel < tol) { converged <- TRUE; break }
    } else {
      lam <- min(lam * 10, 1e12)
      if (lam >= 1e12) { converged <- TRUE; break }
    }
  }
  side <- NA_character_
  if (!is.na(t_pos)) {
    if (abs(p[7] - t_hi) <= .BOUND_RTOL * t_hi) side <- "max"
    else if (abs(p[7] - t_lo) <= .BOUND_RTOL * t_lo) side <- "min"
  }
  ok <- all(is.finite(p)) && is.finite(ne$rss)
  m <- if (periodic) canonical_periodic_params(.dl_to_model(p)) else p
  fitted <- .dl_eval(t, m, periodic)
  rss <- sum((x - fitted)^2); sst <- sum((x - mean(x))^2)
  T <- if (periodic) m[7] else NULL
  dur <- m[6] - m[4]
  list(parameters = list(M = m[1], A = m[2], k1 = m[3], t1 = m[4], k2 = m[5], t2 = m[6],
                         T = T),
       duration = dur,
       onsetPhase = if (periodic) .js_mod(.js_mod(m[4], T) + T, T) else NULL,
       offsetPhase = if (periodic) .js_mod(.js_mod(m[6], T) + T, T) else NULL,
       dutyCycle = if (periodic) dur / T else NULL,
       fitted = fitted, rmse = sqrt(rss / length(t)),
       rSquared = if (sst > 0) 1 - rss / sst else 0, rss = rss,
       diagnostics = list(converged = converged && ok, iterations = iterations,
                          atBound = side))
}

.dl_guess <- function(t, x, seed, periodic, o, peaks, t_lo, t_hi) {
  n <- length(x); mu <- sum(x) / n; xmin <- min(x)
  ks <- c(0.5, 0.2, 1.0, 0.3, 0.8)
  k1 <- if (o$fix_k1) o$fk1 else ks[seed %% 5 + 1]
  k2 <- if (o$fix_k2) o$fk2 else ks[seed %% 5 + 1]
  if (!periodic) {
    tmin <- min(t); tr <- max(t) - tmin
    A <- (max(x) - xmin) * (1 + 0.1 * seed)
    above <- t[x > mu]
    t1e <- tmin + tr * 0.25; t2e <- tmin + tr * 0.75
    if (length(above) > 2) { t1e <- above[1]; t2e <- above[length(above)] }
    shift <- tr * c(0, -0.15, 0.15, -0.3, 0.3)[seed %% 5 + 1]
    t1 <- t1e + shift
    return(c(xmin, A, k1, t1, k2, max(t1 + 0.01, t2e + shift)))
  }
  A <- max(x) - xmin
  T <- if (o$fix_p) o$fp else {
    tt <- if (length(peaks)) peaks[min(seed, length(peaks) - 1) + 1] else 24
    min(t_hi, max(t_lo, tt))
  }
  tmin <- min(t)
  dc <- c(0.5, 0.3, 0.7, 0.4, 0.6)[seed %% 5 + 1]
  above <- sort(vapply(t[x > mu] - tmin, function(v) .js_mod(.js_mod(v, T) + T, T), numeric(1)))
  onset <- T * (0.5 - dc / 2); dur <- T * dc
  if (length(above) > 2) {
    gap <- above[1] + T - above[length(above)]; after <- 1
    for (i in 2:length(above)) {
      g <- above[i] - above[i - 1]
      if (g > gap) { gap <- g; after <- i }
    }
    onset <- above[after]
    dur <- min(0.98 * T, max(0.02 * T, T - gap))
  }
  t1 <- tmin + onset
  c(xmin, A, k1, t1, k2, t1 + dur, T)
}

fit_double_logistic <- function(t, x, options = list()) {
  t <- as.numeric(t); x <- as.numeric(x)
  if (!length(t)) return(NULL)
  g <- function(k, d) if (is.null(options[[k]])) d else options[[k]]
  periodic <- isTRUE(g("periodic", FALSE))
  o <- list(fix_k1 = isTRUE(options$fixK1), fix_k2 = isTRUE(options$fixK2),
            fix_p = isTRUE(options$fixPeriod) || isTRUE(options$fixT),
            fk1 = g("fixedK1", 0.5), fk2 = g("fixedK2", 0.5),
            fp = g("fixedPeriod", g("T", 24)))
  max_iter <- g("maxIterations", 10000); tol <- g("tolerance", 1e-6)
  n_starts <- g("numStarts", 5)
  rng <- NULL; peaks <- NULL; t_lo <- 0.1; t_hi <- Inf
  if (periodic && !o$fix_p) {
    rng <- resolve_period_range(t, g("minPeriod", FREE_PERIOD_DEFAULTS$minPeriod),
                                g("maxPeriod", FREE_PERIOD_DEFAULTS$maxPeriod))
    if (is.null(rng)) return(NULL)
    t_lo <- rng$minPeriod; t_hi <- rng$maxPeriod
    peaks <- 1 / scan_periodogram(t, x, t_lo, t_hi, n_starts)
  }
  free <- sort(c(1, 2, 4, 6, if (!o$fix_k1) 3, if (!o$fix_k2) 5,
                 if (periodic && !o$fix_p) 7))
  best <- NULL; best_rmse <- Inf
  for (st in 0:(n_starts - 1)) {
    params <- .dl_guess(t, x, st, periodic, o, peaks, t_lo, t_hi)
    if (o$fix_k1) params[3] <- o$fk1
    if (o$fix_k2) params[5] <- o$fk2
    if (periodic && o$fix_p) params[7] <- o$fp
    res <- tryCatch(.dl_fit_lm(t, x, params, free, periodic, max_iter, tol, t_lo, t_hi),
                    error = function(e) NULL)
    if (!is.null(res) && is.finite(res$rmse) && res$rmse < best_rmse) {
      best_rmse <- res$rmse; best <- res
    }
  }
  if (!is.null(best))
    best$diagnostics$periodRange <- if (is.null(rng)) NULL else c(rng$minPeriod, rng$maxPeriod)
  best
}

evaluate_dl_at_points <- function(parameters, x_points, periodic = FALSE) {
  xa <- suppressWarnings(as.numeric(unlist(x_points, use.names = FALSE)))
  if (!length(xa)) return(numeric(0))
  pr <- parameters
  m <- c(pr$M, pr$A, pr$k1, pr$t1, pr$k2, pr$t2, if (periodic) pr$T)
  .dl_eval(xa, m, periodic)
}

tp_doublelogistic <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  # The node always fits the PERIODIC model (DoubleLogistic.svelte passes periodic: true).
  periodic <- TRUE
  opts <- list(periodic = TRUE, fixK1 = args$fixK1, fixedK1 = args$fixedK1,
               fixK2 = args$fixK2, fixedK2 = args$fixedK2,
               fixPeriod = isTRUE(args$fixPeriod) || isTRUE(args$fixT),
               fixedPeriod = if (is.null(args$fixedPeriod)) args$T else args$fixedPeriod,
               minPeriod = args$minPeriod, maxPeriod = args$maxPeriod)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  # Column or sequence output x (resolve_output_x, outputXSequence.js).
  frm <- resolve_output_x(x_col, args, env$cols, env$raw_data)
  output_x <- frm$out
  origin <- if (is.null(frm$origin)) NA_real_ else frm$origin

  first_xs <- NULL; any_valid <- FALSE; stats_by_y <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    pr <- .pgram_pairs(t, col_data(env$cols[[yk]], env$cols, env$raw_data))
    if (length(pr$t) < 4) next
    if (is.null(first_xs)) first_xs <- if (!is.null(output_x)) output_x else pr$t
    res <- fit_double_logistic(pr$t, pr$y, opts)
    if (is.null(res)) next
    ys <- if (!is.null(output_x)) evaluate_dl_at_points(res$parameters, output_x, TRUE)
          else res$fitted
    y_out <- out_id(args, paste0("dlogy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "dlogy")
    set_col(env, env$cols, y_out, ys, type = "number")
    # Residuals (DoubleLogistic.svelte): only with the x output wired; the periodic model
    # evaluated at every input x.
    rid <- out_id(args, paste0("resid_", y_id))
    if (rid != -1 && out_id(args, "dlogx") != -1) {
      prm <- res$parameters
      set_col(env, env$cols, rid,
              .fit_residuals(function(p) evaluate_dl_at_points(prm, p, TRUE), t,
                             col_data(env$cols[[yk]], env$cols, env$raw_data)),
              type = "number")
    }
    stats_by_y[[yk]] <- res
    any_valid <- TRUE
  }
  if (any_valid) {
    if (is.finite(origin)) set_col(env, env$cols, out_id(args, "dlogx"),
                                   origin + first_xs * 3600000, type = "time")
    else set_col(env, env$cols, out_id(args, "dlogx"), first_xs, type = "number")
  }
  if (any_valid) {
    # r2/rmse were declared but unwritten in the Python port until 2026-07-28;
    # `perm_pvalue` (renamed from the bare `pvalue` in JS v72.25 — the permutation
    # test's p, the only p this node emits) is Monte Carlo and not run here, so NA.
    for (key in c("r2", "rmse", "perm_pvalue")) {
      arr <- vapply(y_ins, function(y) {
        r <- stats_by_y[[as.character(y)]]
        if (is.null(r)) NA_real_
        else if (key == "r2") r$rSquared else if (key == "rmse") r$rmse else NA_real_
      }, numeric(1))
      set_col(env, env$cols, out_id(args, key), arr, type = "number")
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# FitFunction: one node, several models
# ---------------------------------------------------------------------------

# Dispatches to whichever curve family the user picked. Mirrors fitFunction.js
# fitCurveModel + the per-model option plumbing.
ff_fit_curve_model <- function(tt, yy, model, args) {
  if (identical(model, "cosinor")) {
    # FitFunction.svelte getModelOptions: useFixedPeriod ?? true.
    if (!identical(args$useFixedPeriod, FALSE)) {
      fp <- as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
      nh <- max(1, as.integer(if (is.null(args$nHarmonics)) 1 else args$nHarmonics))
      alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
      res <- fit_cosinor_fixed(tt, yy, fp, nh, alpha)
      if (is.null(res)) return(NULL)
      return(list(model = "cosinor", mode = "fixed",
                  parameters = list(mode = "fixed", period = fp, M = res$M,
                                    harmonics = res$harmonics),
                  fixedStats = res, fitted = res$fitted, rSquared = res$R2, rmse = res$RMSE))
    }
    nc <- max(1, as.integer(if (is.null(args$Ncurves)) 1 else args$Ncurves))
    res <- fit_cosine_curves(tt, yy, nc,
                             if (is.null(args$minPeriod)) FREE_PERIOD_DEFAULTS$minPeriod else args$minPeriod,
                             if (is.null(args$maxPeriod)) FREE_PERIOD_DEFAULTS$maxPeriod else args$maxPeriod)
    if (is.null(res)) return(NULL)
    return(list(model = "cosinor", mode = "free",
                parameters = c(list(mode = "free"), res$parameters),
                fitted = res$fitted, rSquared = res$rSquared, rmse = res$rmse))
  }
  if (identical(model, "rectangular")) {
    # rectwave.js pins omega, not the period: fitFunction.js derives it from fixedPeriod.
    res <- fit_rectangular_wave(tt, yy, list(
      fixKappa = args$fixKappa, fixedKappa = args$fixedKappa, fixOmega = args$fixOmega,
      fixedOmega = if (isTRUE(args$fixOmega))
        2 * pi / .js_number(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod) else NULL,
      fixDutyCycle = args$fixDutyCycle, fixedDutyCycle = args$fixedDutyCycle,
      minPeriod = args$minPeriod, maxPeriod = args$maxPeriod))
    if (is.null(res)) return(NULL)
    return(list(model = "rectangular", parameters = res$parameters, fitted = res$fitted,
                rSquared = res$rSquared, rmse = res$rmse, period = res$period,
                acrophase = res$acrophase))
  }
  if (identical(model, "doublelogistic")) {
    periodic <- !identical(args$periodic, FALSE)
    res <- fit_double_logistic(tt, yy, list(
      periodic = periodic, fixK1 = args$fixK1, fixedK1 = args$fixedK1,
      fixK2 = args$fixK2, fixedK2 = args$fixedK2, fixPeriod = isTRUE(args$fixPeriod),
      fixedPeriod = args$fixedPeriod, minPeriod = args$minPeriod, maxPeriod = args$maxPeriod))
    if (is.null(res)) return(NULL)
    return(list(model = "doublelogistic", periodic = periodic,
                parameters = res$parameters, fitted = res$fitted, rSquared = res$rSquared,
                rmse = res$rmse, onsetPhase = res$onsetPhase, offsetPhase = res$offsetPhase,
                dutyCycle = res$dutyCycle))
  }
  NULL
}

ff_evaluate_at_points <- function(fit_result, model, t_points) {
  if (is.null(fit_result) || is.null(fit_result$parameters)) {
    return(rep(NA_real_, length(t_points)))
  }
  if (identical(model, "cosinor")) {
    if (identical(fit_result$mode, "fixed")) {
      p <- fit_result$parameters
      omega <- 2 * pi / p$period
      xa <- suppressWarnings(as.numeric(unlist(t_points, use.names = FALSE)))
      val <- rep(p$M, length(xa))
      hs <- p$harmonics
      for (i in seq_along(hs)) {
        h <- hs[[i]]
        ki <- if (is.null(h$k)) i else h$k
        val <- val + h$beta * cos(ki * omega * xa) + h$gamma * sin(ki * omega * xa)
      }
      return(val)
    }
    return(evaluate_cosinor_at_points(fit_result$parameters, t_points))
  }
  if (identical(model, "rectangular")) {
    return(evaluate_rectwave_at_points(fit_result$parameters, t_points))
  }
  if (identical(model, "doublelogistic")) {
    return(evaluate_dl_at_points(fit_result$parameters, t_points,
                                 !identical(fit_result$periodic, FALSE)))
  }
  rep(NA_real_, length(t_points))
}

# FitFunction.svelte getFitMetricKeys / rawFitMetricValue / fitMetricValue (see the Python
# port).
ff_metric_keys <- function(args) {
  shared <- c("r2", "rmse", "perm_pvalue")
  model <- if (is.null(args$model)) "cosinor" else args$model
  switch(model,
    # rmse_n (sqrt(SS/n)) beside the fixed-period fit's residual-SE rmse; fixed is the default.
    cosinor = c(shared, if (!identical(args$useFixedPeriod, FALSE)) "rmse_n",
                "period", "mesor", "amplitude", "acrophase", "amplitude_h1", "acrophase_h1"),
    rectangular = c(shared, "period", "mesor", "amplitude", "acrophase", "duty_cycle", "kappa"),
    doublelogistic = c(shared, "period", "mesor", "amplitude", "onset", "offset", "k1", "k2",
                       "duty_cycle"),
    shared)
}
.nz <- function(...) { for (v in list(...)) if (!is.null(v)) return(as.numeric(v)); NaN }
ff_raw_metric <- function(key, model, fr) {
  if (is.null(fr)) return(NaN)
  if (key == "r2") return(.nz(fr$rSquared))
  if (key == "rmse") return(.nz(fr$rmse))
  if (key == "rmse_n") return(.nz(fr$fixedStats$RMSE_n))
  if (key == "perm_pvalue") return(NaN)
  p <- fr$parameters
  if (identical(model, "cosinor")) {
    if (identical(fr$mode, "fixed")) {
      period <- .nz(p$period)
      if (key == "period") return(period)
      if (key == "mesor") return(.nz(fr$fixedStats$M, p$M))
      hs <- fr$fixedStats$harmonics
      if (length(hs) > 1 && key %in% c("amplitude", "acrophase")) {
        w <- multi_component_waveform(fr$fixedStats$M, hs, period)
        return(if (key == "amplitude") w$amplitude else w$orthophase)
      }
      if (key %in% c("amplitude", "amplitude_h1")) return(if (length(hs)) hs[[1]]$amplitude else NaN)
      if (key %in% c("acrophase", "acrophase_h1"))
        return(if (length(hs)) hs[[1]]$acrophase_hrs else NaN)
    } else {
      c1 <- if (length(p$cosines)) p$cosines[[1]] else NULL
      w <- if (is.null(c1)) 0 else c1$frequency
      period <- if (w) 1 / w else NaN
      if (key == "period") return(period)
      if (key == "mesor") return(.nz(p$O))
      if (key %in% c("amplitude", "amplitude_h1")) return(.nz(c1$amplitude))
      if (key %in% c("acrophase", "acrophase_h1"))
        return(if (w) wrap_to_period(-c1$phase / (2 * pi * w), period) else NaN)
    }
    return(NaN)
  }
  if (identical(model, "rectangular"))
    return(switch(key, period = .nz(fr$period), acrophase = .nz(fr$acrophase),
                  mesor = .nz(p$M), amplitude = .nz(p$A), duty_cycle = .nz(p$dutyCycle),
                  kappa = .nz(p$kappa), NaN))
  if (identical(model, "doublelogistic"))
    return(switch(key, period = .nz(p$T), mesor = .nz(p$M), amplitude = .nz(p$A),
                  onset = .nz(fr$onsetPhase, p$t1), offset = .nz(fr$offsetPhase, p$t2),
                  k1 = .nz(p$k1), k2 = .nz(p$k2), duty_cycle = .nz(fr$dutyCycle), NaN))
  NaN
}
ff_metric_value <- function(key, model, fr, phase_ref) {
  v <- ff_raw_metric(key, model, fr)
  if (!isTRUE(phase_ref$clock) || !(key %in% c("acrophase", "acrophase_h1", "onset", "offset")))
    return(v)
  per <- if (identical(model, "cosinor")) ff_raw_metric("period", model, fr)
         else if (identical(model, "rectangular")) .nz(fr$period)
         else if (identical(model, "doublelogistic")) (if (is.null(fr$parameters$T)) 24 else fr$parameters$T)
         else NaN
  apply_phase_reference(v, phase_ref, per)
}

tp_fitfunction <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  model <- if (is.null(args$model)) "cosinor" else args$model
  x_out <- out_id(args, "fitx")
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  t_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(t_col, env$cols, env$raw_data)
  # Column or sequence output x (resolve_output_x, outputXSequence.js).
  frm <- resolve_output_x(t_col, args, env$cols, env$raw_data)
  output_x <- frm$out
  phase_ref <- node_phase_reference(args, t_col, env$cols, env$raw_data)

  y_results <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    pr <- .pgram_pairs(t, col_data(env$cols[[yk]], env$cols, env$raw_data))
    tt <- pr$t; yy <- pr$y
    if (!length(tt)) next
    fr <- ff_fit_curve_model(tt, yy, model, args)
    if (is.null(fr)) next
    y_out_data <- if (!is.null(output_x)) ff_evaluate_at_points(fr, model, output_x)
                  else fr$fitted
    y_results[[yk]] <- list(fr = fr, xOutData = if (!is.null(output_x)) output_x else tt,
                            yOutData = y_out_data,
                            y = col_data(env$cols[[yk]], env$cols, env$raw_data))
    if (length(fr$fitted)) any_valid <- TRUE
  }

  if (any_valid && x_out != -1) {
    first <- y_results[[1]]
    if (!is.null(frm$origin)) set_col(env, env$cols, x_out,
                                      frm$origin + first$xOutData * 3600000, type = "time")
    else set_col(env, env$cols, x_out, first$xOutData, type = "number")
    for (y_id in y_ins) {
      yr <- y_results[[as.character(y_id)]]
      y_out <- out_id(args, paste0("fity_", y_id))
      if (y_out != -1 && !is.null(yr)) {
        set_col(env, env$cols, y_out, yr$yOutData, type = "number")
      }
      # Residuals (FitFunction.svelte residualColumn): the model evaluated at every input x.
      rid <- out_id(args, paste0("resid_", y_id))
      if (rid != -1 && !is.null(yr)) {
        fres <- yr$fr
        set_col(env, env$cols, rid,
                .fit_residuals(function(p) ff_evaluate_at_points(fres, model, p), t, yr$y),
                type = "number")
      }
    }
  }
  if (any_valid) {
    for (key in ff_metric_keys(args)) {
      v <- vapply(y_ins, function(y) ff_metric_value(key, model,
                                                     y_results[[as.character(y)]]$fr, phase_ref),
                  numeric(1))
      set_col(env, env$cols, out_id(args, key), v, type = "number")
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# Spectrum
# ---------------------------------------------------------------------------

# Magnitude/phase spectrum. Mirrors src/lib/utils/fft.js computeFFT step for step:
# mean-detrend ONLY (no linear detrend), assume approximately uniform sampling (no
# resampling), zero-pad to the next power of two, and report the one-sided spectrum for bins
# 1..N/2-1 with magnitude = |X| * 2 / N. The DC bin is dropped, which is why the loop starts
# at 1 — including it would put the series mean in the spectrum as a spurious huge peak.
# fft.js FFT_GAP_RULE and regridUniform, matching the Python port: the step is the LOWER
# median of the positive intervals between consecutive valid samples; slot = round((t - t0) /
# dt); refused when a sample is more than a quarter step off its slot or two share one, when
# a run of missing slots is longer than 3, or when more than 10% are missing. Short runs are
# filled by linear interpolation.
FFT_MAX_GAP <- 3
FFT_MAX_MISSING <- 0.1
.MAX_FFT_N <- 2^24

.js_round <- function(x) { r <- floor(x); if (x - r >= 0.5) r + 1 else r }

regrid_uniform <- function(times, values) {
  fail <- function(reason, dt = NaN, longestGap = 0, nObserved = 0)
    list(ok = FALSE, reason = reason, t0 = NaN, dt = dt, y = numeric(0), nObserved = nObserved,
         nFilled = 0, longestGap = longestGap)
  tl <- as.list(times); vl <- as.list(values)
  n <- min(length(tl), length(vl))
  idx <- which(vapply(seq_len(n), function(i) !.js_invalid(tl[[i]]) && !.js_invalid(vl[[i]]),
                      logical(1)))
  if (length(idx) < 2) return(fail("need at least 2 samples with both a time and a value"))
  t <- vapply(tl[idx], .js_number, numeric(1))
  y <- vapply(vl[idx], .js_number, numeric(1))
  d <- diff(t)
  if (any(!(d > 0) | !is.finite(d))) return(fail("the time axis is not increasing"))
  dt <- sort(d)[floor((length(d) - 1) / 2) + 1]
  t0 <- t[1]
  slots <- integer(length(t))
  for (i in seq_along(t)) {
    pos <- (t[i] - t0) / dt
    sl <- .js_round(pos)
    if (abs(pos - sl) > 0.25 || (i > 1 && sl == slots[i - 1]))
      return(fail("the samples do not sit on a regular grid", dt = dt))
    slots[i] <- sl
  }
  n_grid <- slots[length(slots)] + 1
  if (!(n_grid <= .MAX_FFT_N)) return(fail("the record is too long for the transform", dt = dt))
  longest <- if (length(slots) > 1) max(diff(slots) - 1) else 0
  n_missing <- n_grid - length(t)
  if (longest > FFT_MAX_GAP)
    return(fail(sprintf("the record has a gap of %d missing samples", longest), dt = dt,
                longestGap = longest, nObserved = length(t)))
  if (n_missing > FFT_MAX_MISSING * n_grid)
    return(fail(sprintf("%d of %d samples are missing", n_missing, n_grid), dt = dt,
                longestGap = longest, nObserved = length(t)))
  out <- numeric(n_grid)
  for (i in seq_along(slots)) {
    out[slots[i] + 1] <- y[i]
    if (i > 1) {
      gap <- slots[i] - slots[i - 1]
      if (gap > 1) for (g in 1:(gap - 1))
        out[slots[i - 1] + g + 1] <- y[i - 1] + ((y[i] - y[i - 1]) * g) / gap
    }
  }
  list(ok = TRUE, reason = "", t0 = t0, dt = dt, y = out, nObserved = length(t),
       nFilled = n_missing, longestGap = longest)
}

.empty_spectrum <- function(reason = "") {
  list(frequencies = numeric(0), magnitudes = numeric(0), phases = numeric(0),
       samplingRate = 0, nyquistFreq = 0, minPeriod = 0, resolution = 0, nSamples = 0,
       nTransform = 0, nFilled = 0, grid = NULL, flat = FALSE, reason = reason)
}

# Port of fft.js computeFFT (see the Python port): own grid, mean removed, DFT at the
# record's own length N (or M = ceil(rate / freq_step) zero-padded when finer), bins 1 ..
# below M/2 at k rate / M, magnitude 2|X_k| / N, phase atan2(Im, Re); flat data has
# magnitude 0 everywhere. R's fft() handles any length.
compute_fft <- function(times, values, freq_step = NULL) {
  if (is.null(times) || is.null(values) || length(times) < 2 || length(values) < 2 ||
      length(times) != length(values)) return(.empty_spectrum())
  g <- regrid_uniform(times, values)
  if (!g$ok) return(.empty_spectrum(g$reason))
  n <- length(g$y)
  if (n < 4) return(.empty_spectrum("need at least 4 samples"))
  dt <- g$dt; rate <- 1 / dt
  m <- n
  if (!is.null(freq_step) && is.finite(freq_step) && freq_step > 0) {
    want <- ceiling(rate / freq_step)
    if (is.finite(want) && want > n) m <- want
  }
  if (m > .MAX_FFT_N) return(.empty_spectrum("the requested frequency step is too fine"))
  yc <- g$y - mean(g$y)
  flat <- all(g$y == g$y[1])
  spec <- fft(c(yc, rep(0, m - n)))
  k <- seq_len(ceiling(m / 2) - 1)
  z <- spec[k + 1]
  list(frequencies = k * rate / m,
       magnitudes = if (flat) rep(0, length(k)) else 2 * Mod(z) / n,
       phases = atan2(Im(z), Re(z)), samplingRate = rate, nyquistFreq = rate / 2,
       minPeriod = 2 * dt, resolution = rate / n, nSamples = n, nTransform = m,
       nFilled = g$nFilled, grid = list(t0 = g$t0, dt = dt, y = yc), flat = flat,
       reason = "")
}

# fft.js magnitudeAt: least-squares sinusoid at f with centred cos/sin regressors.
# The sums run left to right in plain doubles, as the JS does: R's sum() accumulates in long
# double, and the objective is flat enough at its maximum that the difference moves the
# refined frequency by ~1e-7.
.dsum <- function(v) { s <- 0; for (x in v) s <- s + x; s }
.fft_magnitude_at <- function(y, dt, f) {
  w <- 2 * pi * f * dt
  j <- seq_along(y) - 1
  cs <- cos(w * j); sn <- sin(w * j)
  cc <- cs - .dsum(cs) / length(y); ss <- sn - .dsum(sn) / length(y)
  scc <- .dsum(cc * cc); sss <- .dsum(ss * ss); scs <- .dsum(cc * ss)
  syc <- .dsum(y * cc); sys <- .dsum(y * ss)
  det <- scc * sss - scs * scs
  if (!(abs(det) > 1e-12 * scc * sss)) {
    mag <- 2 * sqrt(syc^2 + sys^2) / length(y)
    return(list(mag = mag, phase = atan2(-sys, syc), fit = mag * mag * length(y) / 2))
  }
  a <- (syc * sss - sys * scs) / det
  b <- (sys * scc - syc * scs) / det
  list(mag = sqrt(a * a + b * b), phase = atan2(-b, a), fit = a * syc + b * sys)
}

# Port of fft.js fftPeak: largest bin (optionally within a period range or among `indices`,
# 1-based), refined by golden-section search between its neighbouring bins on the explained
# variance; the bin is kept if the search finds nothing better. NULL when there is no peak.
fft_peak <- function(spec, period_min = NULL, period_max = NULL, indices = NULL) {
  f <- spec$frequencies; m <- spec$magnitudes
  if (!length(f) || isTRUE(spec$flat)) return(NULL)
  cand <- indices
  if (is.null(cand)) {
    lo <- if (is.null(period_min)) 0 else period_min
    hi <- if (is.null(period_max)) Inf else period_max
    cand <- which(1 / f >= lo & 1 / f <= hi)
  }
  best <- 0
  for (i in cand) if (is.finite(m[i]) && (best == 0 || m[i] > m[best])) best <- i
  if (best == 0 || !(m[best] > 0)) return(NULL)
  freq <- f[best]; mag <- m[best]; phase <- spec$phases[best]
  gy <- spec$grid$y; gdt <- spec$grid$dt
  if (length(gy)) {
    a <- if (best > 1) f[best - 1] else f[best]
    b <- if (best < length(f)) f[best + 1] else f[best]
    if (!is.null(period_max) && is.finite(period_max)) a <- max(a, 1 / period_max)
    if (!is.null(period_min) && period_min > 0) b <- min(b, 1 / period_min)
    if (b > a) {
      gr <- (sqrt(5) - 1) / 2
      c1 <- b - gr * (b - a); d1 <- a + gr * (b - a)
      fc <- .fft_magnitude_at(gy, gdt, c1)$fit; fd <- .fft_magnitude_at(gy, gdt, d1)$fit
      it <- 0
      while (it < 60 && b - a > 1e-12 * f[best]) {
        if (fc > fd) {
          b <- d1; d1 <- c1; fd <- fc
          c1 <- b - gr * (b - a); fc <- .fft_magnitude_at(gy, gdt, c1)$fit
        } else {
          a <- c1; c1 <- d1; fc <- fd
          d1 <- a + gr * (b - a); fd <- .fft_magnitude_at(gy, gdt, d1)$fit
        }
        it <- it + 1
      }
      fr <- (a + b) / 2
      at <- .fft_magnitude_at(gy, gdt, fr)
      if (at$fit >= .fft_magnitude_at(gy, gdt, f[best])$fit) {
        freq <- fr; mag <- at$mag; phase <- at$phase
      }
    }
  }
  list(frequency = freq, period = 1 / freq, magnitude = mag, phase = phase, index = best)
}

# movinganalysis.js FFT window stats: a window failing the grid check is skipped (NaN);
# otherwise computeFFT and the refined fftPeak.
.moving_fft_stats <- function(tw, yw, args) {
  if (!regrid_uniform(tw, yw)$ok) return(list())
  fs <- args$fftFreqStep
  r <- compute_fft(tw, yw, if (is.numeric(fs) && length(fs) == 1 && is.finite(fs) && fs > 0)
                   fs else NULL)
  if (!length(r$frequencies)) return(list())
  pk <- fft_peak(r)
  if (is.null(pk)) return(list())
  list(peak_frequency = pk$frequency,
       peak_period = if (pk$frequency != 0) pk$period else NaN,
       peak_magnitude = pk$magnitude)
}

# periodogram.js periodogramPeakIndex (SPEC-9), 1-based, 0 if none: for Chi-squared (any
# finite threshold) the period with the largest Qp - threshold, else the largest power; a
# non-positive or non-finite power is never a peak (ROB-13).
.periodogram_peak_index <- function(res, candidates = NULL) {
  y <- res$y
  thr <- res$threshold
  idxs <- if (is.null(candidates)) seq_along(y) else candidates
  use_excess <- !is.null(thr) && any(is.finite(thr[idxs]))
  best <- 0; best_score <- -Inf
  for (i in idxs) {
    v <- y[i]
    if (!(is.finite(v) && v > 0)) next
    score <- if (use_excess) v - thr[i] else v
    if (use_excess && !is.finite(score)) next
    if (best == 0 || score > best_score) { best <- i; best_score <- score }
  }
  best
}

# periodogram.js peakFamilywiseP (SPEC-6): 1 - (1 - p)^M at the peak, M the number of folds
# with a statistic; NaN without a chi-squared p (Lomb-Scargle, Enright).
.peak_familywise_p <- function(res, i) {
  pv <- res$pvalue
  if (is.null(pv) || i < 1) return(NaN)
  M <- sum(is.finite(pv))
  if (!M || !is.finite(pv[i])) return(NaN)
  df <- res$df[i]; q <- res$y[i]
  p <- if (is.finite(df) && is.finite(q)) pchisq(q, df, lower.tail = FALSE) else pv[i]
  -expm1(M * log1p(-min(1, max(0, p))))
}

# ---------------------------------------------------------------------------
# Remaining column processes
# ---------------------------------------------------------------------------

cp_editvalue <- function(x, args, cols, raw_data) {
  out <- as.list(x)
  for (edit in args$edits) {
    # Positions are 1-based in the UI and stay 1-based in R, unlike the Python which
    # subtracts 1 for its 0-based lists.
    pos <- as.integer(edit$position)
    # A null value (a cleared cell, STAT-15) is MISSING: `out[[pos]] <- NULL` would delete
    # the element and shift every later row up.
    if (!is.na(pos) && pos >= 1 && pos <= length(out))
      out[pos] <- list(if (is.null(edit$value)) NA else edit$value)
  }
  out
}

# OutlierRemoval.svelte (matching the Python port): present values by the house rule, fewer
# than 4 -> unchanged; "zscore" flags |z| > zThreshold (population SD, none when it is 0);
# anything else the IQR rule on type-7 quartiles with k = iqrMultiplier. Flagged -> NA.
cp_outlierremoval <- function(x, args, cols, raw_data) {
  xl <- as.list(x)
  ok <- !vapply(xl, .js_invalid, logical(1))
  vals <- vapply(xl[ok], .js_number, numeric(1))
  if (length(vals) < 4) return(x)
  if (identical(args$method, "zscore")) {
    thr <- if (is.null(args$zThreshold)) 3 else as.numeric(args$zThreshold)
    mu <- mean(vals)
    sd0 <- sqrt(sum((vals - mu)^2) / length(vals))
    flag <- if (sd0 == 0) rep(FALSE, length(vals)) else abs((vals - mu) / sd0) > thr
  } else {
    k <- if (is.null(args$iqrMultiplier)) 1.5 else as.numeric(args$iqrMultiplier)
    q <- unname(quantile(vals, c(0.25, 0.75), type = 7))
    flag <- vals < q[1] - k * (q[2] - q[1]) | vals > q[2] + k * (q[2] - q[1])
  }
  out <- xl
  out[which(ok)[flag]] <- list(NA)
  if (all(vapply(out, function(v) is.null(v) || is.numeric(v) || is.logical(v), logical(1))))
    vapply(out, function(v) if (is.null(v) || length(v) != 1) NA_real_ else as.numeric(v),
           numeric(1))
  else out
}

cp_filterbyothercol <- function(x, args, cols, raw_data) {
  conditions <- args$conditions
  if (is.null(conditions) || !length(conditions)) return(x)
  n <- length(x)
  mask <- rep(TRUE, n)
  parent <- args$parentColId
  for (cond in conditions) {
    by_id <- if (is.null(cond$byColId)) -1 else cond$byColId
    if (by_id == -1) next
    by <- if (!is.null(parent) && identical(by_id, parent)) {
      suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
    } else {
      bc <- cols[[as.character(by_id)]]
      if (is.null(bc)) next
      suppressWarnings(as.numeric(unlist(col_data(bc, cols, raw_data), use.names = FALSE)))
    }
    op <- cond$operator
    val <- suppressWarnings(as.numeric(cond$value))
    cmp <- switch(as.character(op),
      ">" = by > val, "<" = by < val, ">=" = by >= val, "<=" = by <= val,
      "!=" = by != val, by == val)
    cmp[is.na(cmp)] <- FALSE
    mask <- mask & c(cmp, rep(FALSE, max(0, n - length(cmp))))[seq_len(n)]
  }
  # Values are KEPT where the mask holds and blanked elsewhere — again preserving row
  # alignment rather than compacting the column.
  ifelse(mask, suppressWarnings(as.numeric(unlist(x, use.names = FALSE))), NA_real_)
}

# ---------------------------------------------------------------------------
# SurrogateTest
# ---------------------------------------------------------------------------

# PARITY SCOPE, deliberately limited and identical to the Python port's.
#
# `observed` — the peak FFT magnitude inside the period band — is fully deterministic and IS
# checked across languages. `pvalue` is NOT: it is a Monte Carlo quantity whose value depends
# on the exact sequence drawn from the JS's seeded @stdlib minstd-shuffle PRNG, which this
# runtime does not reproduce. It is emitted as NaN rather than as a number that would look
# comparable and could not be. Same boundary as the generator nodes.
# Seeded PRNG: @stdlib minstd-shuffle as permutationTest.js createSeededRNG (see the Python
# port). Exactly reproducible in doubles: 16807 * s < 2^46.
.normalize_seed <- function(seed) {
  v <- .js_number(seed)
  if (!is.finite(v)) return(1)
  v <- trunc(v); M <- 2147483646
  ((((v - 1) %% M) + M) %% M) + 1
}
seeded_rng <- function(seed) {
  st <- .normalize_seed(seed)
  minstd <- function() { st <<- (16807 * st) %% 2147483647; st }
  for (i in 1:8) minstd()
  tbl <- numeric(32)
  for (i in 32:1) tbl[i] <- minstd()
  sh <- tbl[1]
  function() {
    i <- floor(32 * (sh / 2147483647)) + 1
    s <- tbl[i]; sh <<- s; tbl[i] <<- minstd()
    (s - 1) / 2147483646
  }
}
seeded_sequence <- function(unused, n, seed) {
  rng <- seeded_rng(seed)
  list(values = vapply(seq_len(n), function(i) rng(), numeric(1)))
}

# utils/surrogates.js, matching the Python port.
.sur_gaussian <- function(rng) {
  u <- 0
  while (u == 0) u <- rng()
  v <- rng()
  sqrt(-2 * log(u)) * cos(2 * pi * v)
}
.sur_clean <- function(values) {
  vl <- as.list(values)
  ok <- vapply(vl, function(v) !is.null(v) && length(v) == 1 && !identical(v, "") &&
                 !(is.atomic(v) && is.na(v) && !is.nan(v)) && is.finite(.js_number(v)),
               logical(1))
  vapply(vl[ok], .js_number, numeric(1))
}
phase_randomise <- function(values, rng) {
  y <- .sur_clean(values); n <- length(y)
  if (n < 4) return(y)
  mu <- mean(y)
  X <- fft(y - mu)
  k <- 1
  while (2 * k < n) {
    phi <- 2 * pi * rng(); mag <- Mod(X[k + 1])
    X[k + 1] <- complex(modulus = mag, argument = phi)
    X[n - k + 1] <- Conj(X[k + 1])
    k <- k + 1
  }
  X[1] <- complex(real = Re(X[1]), imaginary = 0)
  if (n %% 2 == 0) X[n / 2 + 1] <- complex(real = Re(X[n / 2 + 1]), imaginary = 0)
  Re(fft(X, inverse = TRUE)) / n + mu
}
aaft_surrogate <- function(values, rng) {
  y <- .sur_clean(values); n <- length(y)
  if (n < 4) return(y)
  gs <- sort(vapply(seq_len(n), function(i) .sur_gaussian(rng), numeric(1)))
  g <- numeric(n); g[order(y, method = "radix")] <- gs
  r <- phase_randomise(g, rng)
  out <- numeric(n); out[order(r, method = "radix")] <- sort(y)
  out
}
block_bootstrap <- function(values, rng, block_length) {
  y <- .sur_clean(values); n <- length(y)
  if (n < 4) return(y)
  bl <- if (is.finite(block_length)) floor(block_length) else 0
  L <- max(1, min(n, if (bl == 0) 1 else bl))
  ms <- n - L
  out <- numeric(0)
  while (length(out) < n) {
    st <- floor(rng() * (ms + 1))
    out <- c(out, y[st + seq_len(min(L, n - length(out)))])
  }
  out
}
ar1_surrogate <- function(values, rng) {
  y <- .sur_clean(values); n <- length(y)
  if (n < 4) return(y)
  mu <- mean(y); dev <- y - mu
  num <- sum(dev[-1] * dev[-n]); den <- sum(dev * dev)
  alpha <- if (den > 0) max(-0.999, min(0.999, num / den)) else 0
  v <- den / n; isd <- sqrt(max(0, v * (1 - alpha^2)))
  prev <- sqrt(v) * .sur_gaussian(rng)
  out <- numeric(n)
  for (i in seq_len(n)) { prev <- alpha * prev + isd * .sur_gaussian(rng); out[i] <- prev + mu }
  out
}
shuffle_surrogate <- function(values, rng) {
  out <- .sur_clean(values)
  if (length(out) > 1) for (i in length(out):2) {
    j <- floor(rng() * i) + 1
    tmp <- out[i]; out[i] <- out[j]; out[j] <- tmp
  }
  out
}
make_surrogate <- function(values, method, rng, block_length = 24) {
  switch(method, phase = phase_randomise(values, rng), aaft = aaft_surrogate(values, rng),
         block = block_bootstrap(values, rng, block_length), ar1 = ar1_surrogate(values, rng),
         shuffle = shuffle_surrogate(values, rng),
         stop(sprintf('make_surrogate: unknown method "%s"', method)))
}
surrogate_test <- function(values, stat_fn, method = "block", n_surrogates = 999,
                           seed = 12345, block_length = 24) {
  y <- .sur_clean(values)
  fail <- function(r) list(pValue = NaN, observed = NaN, nSurrogates = 0, valid = FALSE,
                           reason = r)
  if (length(y) < 8) return(fail("need at least 8 finite samples"))
  if (!(method %in% c("phase", "aaft", "block", "ar1", "shuffle"))) return(fail("unknown method"))
  obs <- tryCatch(as.numeric(stat_fn(y)), error = function(e) NaN)
  if (!is.finite(obs)) return(fail("the statistic is not finite on the observed series"))
  rng <- seeded_rng(seed)
  st <- numeric(0)
  for (i in seq_len(n_surrogates)) {
    v <- tryCatch(as.numeric(stat_fn(make_surrogate(y, method, rng, block_length))),
                  error = function(e) NaN)
    if (is.finite(v)) st <- c(st, v)
  }
  if (!length(st)) return(fail("every surrogate failed"))
  ext <- sum(st >= obs - 1e-9 * pmax(abs(obs), abs(st)))
  list(pValue = (ext + 1) / (length(st) + 1), observed = obs, nSurrogates = length(st),
       valid = TRUE, reason = "")
}

# Port of SurrogateTest.svelte (matching the Python port): regrid first (refused when off a
# regular grid or gapped), block length round(hours / step), band-limited largest FFT bin,
# phase/AAFT refused, and the p-value from the reproduced seeded draws.
tp_surrogatetest <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  if (x_in == -1 || y_in == -1) return(FALSE)
  if (is.null(env$cols[[as.character(x_in)]]) || is.null(env$cols[[as.character(y_in)]]))
    return(FALSE)
  times <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  values <- col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data)
  if (length(times) < 8 || length(values) < 8) return(FALSE)
  refuse <- function() {
    set_col(env, env$cols, out_id(args, "pvalue"), NaN, type = "number")
    set_col(env, env$cols, out_id(args, "observed"), NaN, type = "number")
    FALSE
  }
  method <- if (is.null(args$method)) "block" else args$method
  if (!(method %in% c("block", "ar1", "shuffle"))) return(refuse())
  g <- regrid_uniform(times, values)
  if (!g$ok) return(refuse())
  vals <- g$y; dt <- g$dt
  grid_t <- g$t0 + (seq_along(vals) - 1) * dt
  num_or <- function(v, d) { x <- if (is.null(v)) NaN else .js_number(v)
    if (is.finite(x) && x != 0) x else d }
  block <- max(1, .js_round(num_or(args$blockLengthHours, 24) / dt))
  pmin_ <- num_or(args$periodMin, 20); pmax_ <- num_or(args$periodMax, 28)
  stat <- function(y) {
    f <- compute_fft(grid_t, y)
    per <- 1 / f$frequencies
    m <- f$magnitudes[per >= pmin_ & per <= pmax_]
    if (length(m)) max(0, m) else 0
  }
  res <- surrogate_test(vals, stat, method,
                        max(9, floor(num_or(args$nSurrogates, 199))),
                        num_or(args$seed, 12345), block)
  set_col(env, env$cols, out_id(args, "pvalue"), res$pValue, type = "number")
  set_col(env, env$cols, out_id(args, "observed"), res$observed, type = "number")
  isTRUE(res$valid)
}

# ---------------------------------------------------------------------------
# Periodograms and autocorrelation
# ---------------------------------------------------------------------------

make_seq_array <- function(start, end, step) {
  if (step <= 0 || end < start) return(numeric(0))
  # The 1e-9 slack keeps the final point when (end - start) is an exact multiple of the step
  # and floating-point division lands just under it.
  n <- floor((end - start) / step + 1e-9) + 1
  start + (seq_len(n) - 1) * step
}

median_dt <- function(t) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  if (length(t) < 2) return(1)
  d <- diff(t)
  d <- d[d > 0]
  if (!length(d)) 1 else median(d)
}

next_pow2 <- function(n) if (n <= 1) 1 else 2^ceiling(log2(n))

# periodogram.js isFlatSeries (ROB-13): every usable value (house rule) EXACTLY equal, or
# fewer than two. Flat data has no rhythm: zero power and no peak.
is_flat_series <- function(values) {
  vl <- as.list(values)
  ok <- !vapply(vl, .js_invalid, logical(1))
  v <- vapply(vl[ok], .js_number, numeric(1))
  length(v) < 2 || all(v == v[1])
}

# periodogram.js binOrigin: floor(min(x) / binSize) * binSize, one binSize lower when that
# rounds above min(x). The binned methods used to start at t = 0 whatever the data.
bin_origin <- function(xs, bin_size) {
  x <- suppressWarnings(as.numeric(unlist(xs, use.names = FALSE)))
  x <- x[is.finite(x)]
  if (!length(x) || !is.finite(bin_size) || !(bin_size > 0)) return(0)
  mn <- min(x)
  o <- floor(mn / bin_size) * bin_size
  if (o > mn) o <- o - bin_size
  o
}

.pgram_pairs <- function(t, y) {
  tl <- as.list(t); yl <- as.list(y)
  n <- min(length(tl), length(yl))
  ok <- vapply(seq_len(n), function(i) !.js_invalid(tl[[i]]) && !.js_invalid(yl[[i]]),
               logical(1))
  list(t = vapply(tl[seq_len(n)][ok], .js_number, numeric(1)),
       y = vapply(yl[seq_len(n)][ok], .js_number, numeric(1)))
}

# Lomb-Scargle: the classical form with the tau time-offset that makes the sine and cosine
# terms orthogonal on UNEVENLY sampled data. Valid pairs only; flat data is 0 everywhere.
lomb_scargle <- function(t, y, periods) {
  if (length(t) < 2 || length(y) < 2 || length(t) != length(y))
    return(rep(NA_real_, length(periods)))
  pr <- .pgram_pairs(t, y); t <- pr$t; y <- pr$y
  if (!length(t) || is_flat_series(y)) return(rep(0, length(periods)))
  y <- y - mean(y)
  # SAMPLE variance (n-1), matching periodogram.js.
  vary <- var(y)
  if (!is.finite(vary) || vary == 0) vary <- 1
  vapply(periods, function(P) {
    w <- 2 * pi / P
    # tan(2 w tau) = sum(sin(2 w t)) / sum(cos(2 w t)) (Lomb 1976; Scargle 1982).
    two_w <- 2 * w
    tau <- if (w != 0) atan2(sum(sin(two_w * t)), sum(cos(two_w * t))) / two_w else 0
    cwt <- cos(w * (t - tau)); swt <- sin(w * (t - tau))
    den1 <- sum(cwt^2); den2 <- sum(swt^2)
    # periodogram.js: each term on its own guard; a basis that is constant over the samples
    # (spread about its mean at most LS_DEGENERATE_BASIS of n; a period equal to the sampling
    # interval) is left out, the other term still counts.
    n <- length(t)
    min_spread <- LS_DEGENERATE_BASIS * n
    c_var <- den1 - sum(cwt)^2 / n > min_spread
    s_var <- den2 - sum(swt)^2 / n > min_spread
    p <- ((if (c_var && den1 > 0) sum(y * cwt)^2 / den1 else 0) +
          (if (s_var && den2 > 0) sum(y * swt)^2 / den2 else 0)) / (2 * vary)
    if (is.finite(p)) p else 0
  }, numeric(1))
}

# periodogram.js LS_DEGENERATE_BASIS: a basis whose spread about its mean is at most this
# fraction of n is constant up to rounding.
LS_DEGENERATE_BASIS <- 1e-12

# Folding chi-squared (Sokolove-Bushell 1978), the periodogram.js pipeline step for step
# (matching the Python port): valid pairs, bin at dt from bin_origin, fold the BIN MEANS at
# colNum = round(P / dt) columns (bin i in column i %% colNum), occupancy-weighted over
# non-empty columns: Qp = N_eff sum_h K_h (M_h - M)^2 / sum_i (x_i - M)^2, df = occupied
# columns - 1. Flat data: Qp 0 with its real df. Per-fold p is the UPPER tail
# (pchisq lower.tail = FALSE, SPEC-14); threshold the Sidak-corrected upper quantile.
chi_squared_pgram <- function(t, y, periods, dt, alpha = 0.05) {
  pr <- .pgram_pairs(t, y)
  flat <- is_flat_series(pr$y)
  data <- as.numeric(bin_data(pr$t, pr$y, dt, bin_origin(pr$t, dt))$y_out)
  np <- length(periods)
  if (!length(data)) return(list(powers = rep(NA_real_, np), dfs = rep(NA_real_, np),
                                 threshold = rep(NA_real_, np), pvalue = rep(NA_real_, np)))
  ok <- !is.na(data)
  avg <- mean(data[ok])
  denom <- sum((data[ok] - avg)^2)
  powers <- rep(NA_real_, np); dfs <- rep(NA_real_, np); pv <- rep(NA_real_, np)
  for (k in seq_len(np)) {
    cn <- js_round(periods[k] / dt)
    if (!is.finite(cn) || cn < 1 || cn > length(data)) next
    col <- (seq_along(data) - 1) %% cn + 1
    sums <- numeric(cn); counts <- numeric(cn)
    for (i in which(ok)) { sums[col[i]] <- sums[col[i]] + data[i]; counts[col[i]] <- counts[col[i]] + 1 }
    occ <- counts > 0
    df <- sum(occ) - 1
    if (df < 1) next
    qp <- if (flat) 0 else
      sum(counts[occ] * (sums[occ] / counts[occ] - avg)^2) * sum(counts[occ]) / denom
    if (!is.finite(qp)) next
    powers[k] <- qp; dfs[k] <- df
    pv[k] <- pchisq(qp, df, lower.tail = FALSE)
  }
  m <- sum(!is.na(dfs) & dfs >= 1)
  corrected <- if (m > 0) (1 - alpha)^(1 / m) else NA_real_
  thresholds <- vapply(dfs, function(df) {
    if (!is.na(df) && df >= 1) qchisq(corrected, df) else NA_real_
  }, numeric(1))
  list(powers = powers, dfs = dfs, threshold = thresholds, pvalue = pv)
}

# Port of periodogram.js enrightAmplitude: Enright's (1965) A_p for one fold of nb bins.
# The binned series is folded into a Buys-Ballot table of nb columns; each column mean uses
# only its occupied bins (an empty bin is missing, never 0), empty columns are left out, and
# A_p = sqrt(mean over occupied columns of (M_h - Mbar)^2) with Mbar the plain mean of the
# column means (Legendre & Legendre, Numerical Ecology, 1998, eq. 12.12-12.13). NA when the fold
# is longer than the binned record or fewer than two columns are occupied.
enright_amplitude <- function(data, nb) {
  n <- length(data)
  if (!is.finite(nb) || nb < 1 || nb > n) return(NA_real_)
  ok <- !is.na(data)
  cols <- ((seq_len(n) - 1) %% nb)[ok]
  sums <- vapply(split(data[ok], factor(cols, levels = 0:(nb - 1))),
                                 sum, numeric(1))
  counts <- tabulate(cols + 1, nbins = nb)
  occ <- counts > 0
  if (sum(occ) < 2) return(NA_real_)
  means <- sums[occ] / counts[occ]
  sqrt(sum((means - mean(means))^2) / length(means))
}

# Port of periodogram.js calculateEnrightPower (Enright 1965): valid pairs, bin at dt from
# bin_origin, then Enright's A_p (enright_amplitude) at each fold of nb = round(P / dt)
# bins. Flat data: 0 at every fold that has a statistic.
enright_pgram <- function(t, y, periods, dt) {
  if (length(t) < 2 || length(y) < 2) return(rep(NA_real_, length(periods)))
  pr <- .pgram_pairs(t, y)
  flat <- is_flat_series(pr$y)
  data <- as.numeric(bin_data(pr$t, pr$y, dt, bin_origin(pr$t, dt))$y_out)
  if (!length(data)) return(rep(NA_real_, length(periods)))
  vapply(periods, function(P) {
    ap <- enright_amplitude(data, js_round(P / dt))
    if (is.na(ap)) NA_real_ else if (flat) 0 else ap
  }, numeric(1))
}

# Distinct fold periods for the binned methods, matching periodogram.js foldGrid.
# Chi-squared and Enright depend on a trial period only through nbins = round(P / dt),
# so trial periods within one bin width are the same test; reporting them separately
# tied their power and argmax took the first (a -dt/2 bias on the peak). Each distinct
# fold is returned once, at the period it actually tests (nbins * dt); folds that round
# outside [p_min, p_max] are dropped. The grid ascends, so equal folds are adjacent.
fold_grid <- function(periods, dt, p_min, p_max) {
  if (!is.finite(dt) || dt <= 0) return(numeric(0))
  eps <- 1e-9 * max(1, abs(p_min), abs(p_max))
  n <- js_round(periods / dt)
  n <- n[n >= 1]
  n <- n[c(TRUE, diff(n) != 0)[seq_along(n)]]
  fold <- n * dt
  fold[fold >= p_min - eps & fold <= p_max + eps]
}

run_periodogram_calculation <- function(params) {
  t <- params$t
  y <- params$y
  method <- if (is.null(params$method)) "Lomb-Scargle" else params$method
  p_min <- as.numeric(if (is.null(params$minPeriod)) 1 else params$minPeriod)
  p_max <- as.numeric(if (is.null(params$maxPeriod)) 48 else params$maxPeriod)
  step <- as.numeric(if (is.null(params$stepSize)) 0.1 else params$stepSize)
  periods <- make_seq_array(p_min, p_max, step)
  dt <- if (!is.null(params$dt) && is.finite(params$dt) && params$dt > 0) params$dt
        else median_dt(t)
  if (!identical(method, "Lomb-Scargle")) periods <- fold_grid(periods, dt, p_min, p_max)
  res <- if (identical(method, "Lomb-Scargle")) {
    list(x = periods, y = lomb_scargle(t, y, periods), threshold = NULL)
  } else if (identical(method, "Chi-squared")) {
    alpha <- as.numeric(if (!is.null(params$alpha)) params$alpha
                        else if (!is.null(params$chiSquaredAlpha)) params$chiSquaredAlpha
                        else 0.05)
    r <- chi_squared_pgram(t, y, periods, dt, alpha)
    list(x = periods, y = r$powers, threshold = r$threshold, df = r$dfs, pvalue = r$pvalue)
  } else {
    list(x = periods, y = enright_pgram(t, y, periods, dt), threshold = NULL)
  }
  # periodogram.js drops the periods whose power is NaN.
  keep <- !is.na(res$y) & !is.na(res$x)
  for (k in c("x", "y", "threshold", "df", "pvalue")) if (!is.null(res[[k]])) res[[k]] <- res[[k]][keep]
  res
}

# Two lags whose correlation differs by less than this are a TIE, not a ranking: a
# perfectly periodic series lands on its repeat value to within a few ulps, so a raw
# `>` lets floating-point noise decide which repeat is reported.
ACF_PEAK_TIE <- 1e-12

# The peak of an autocorrelogram: the DOMINANT PERIOD of the series.
#
# Deliberately NOT the cross-correlogram's convention (largest |r|, see
# cross_correlation). Lag 0 is exactly 1 by definition, so a sign-blind maximum always
# answers 0; a rhythm is anti-correlated with itself at half a period, so the largest
# |r| away from 0 is typically r = -1 at P/2, the same rhythm in antiphase rather than
# a second finding; and a rhythm repeats at every MULTIPLE of its period, with this
# estimator normalising each lag by its own overlap count, so the long lags are
# computed from fewer pairs and drift ABOVE the fundamental (values over 1 are routine
# at lag 3P). A plain maximum over non-zero lags therefore reports 2P, 3P or the last
# lag in the window.
#
# So: drop lag 0 and non-finite values; find where the correlogram first goes negative
# and then returns to non-negative, and take the largest correlation in that first
# positive lobe, ties within 1e-12 going to the smaller lag. With no lobe (no dip, or
# no recovery after one), fall back to the largest correlation over the non-zero lags.
# This is the standard reading of a circadian autocorrelogram (Levine et al. 2002,
# BMC Neuroscience 3:1). Mirrors findAutocorrelationPeak in utils/correlogram.js.
find_autocorrelation_peak <- function(lags, correlations) {
  m <- min(length(lags), length(correlations))
  cand <- if (m < 1) integer(0)
          else Filter(function(i) lags[i] > 0 && is.finite(correlations[i]), seq_len(m))
  if (!length(cand)) return(list(lag = NA_real_, correlation = NA_real_))
  window <- cand
  dip <- NA_integer_
  for (k in seq_along(cand)) if (correlations[cand[k]] < 0) { dip <- k; break }
  if (!is.na(dip)) {
    start <- NA_integer_
    if (dip + 1 <= length(cand)) {
      for (k in (dip + 1):length(cand)) if (correlations[cand[k]] >= 0) { start <- k; break }
    }
    if (!is.na(start)) {
      end <- start
      while (end + 1 <= length(cand) && correlations[cand[end + 1]] >= 0) end <- end + 1
      window <- cand[start:end]
    }
  }
  best <- window[1]
  for (i in window) if (correlations[i] > correlations[best] + ACF_PEAK_TIE) best <- i
  list(lag = lags[best], correlation = correlations[best])
}

# The app's median spacing (utils/correlogram.js): the diffs sorted ascending and the element
# at floor(len / 2), i.e. the UPPER median for an even count, not the mean of the middle two
# (R's median). Every diff counts, including zero and negative ones.
js_upper_median <- function(d) sort(d)[length(d) %/% 2 + 1]

# Port of utils/correlogram.js computeAutocorrelation. `bin_size` NULL estimates the lag step
# as the upper median of the successive spacings of the valid times (in their given order);
# a non-finite or non-positive step, or times and values of different lengths, give no lags,
# as in the app. The uneven path is the slotted estimator (Edelson and Krolik 1988; Rehfeld
# et al. 2011, Nonlin. Processes Geophys. 18:389, Eqs. 10-11), with the app's rules: lag 0 is
# exactly 1 on both paths; slots are half-open, lag k takes (k - 1/2) dt <= d < (k + 1/2) dt,
# so a pair on a boundary counts once (in the upper lag); distinct pairs closer than half a
# step are not used at any lag; the default lag window is half the recording span in hours.
compute_autocorrelation <- function(times, values, bin_size = NULL,
                                    max_lag = NULL, min_lag = 0) {
  empty <- function(dt) list(lags = numeric(0), correlations = numeric(0), dt = dt,
                             peakLag = NA_real_, peakCorrelation = NA_real_)
  t <- suppressWarnings(as.numeric(unlist(times, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(values, use.names = FALSE)))
  if (length(t) < 2 || length(y) < 2 || length(t) != length(y)) return(empty(1))
  ok <- !is.na(t) & !is.na(y)
  t <- t[ok]; y <- y[ok]
  n <- length(y)
  if (n < 2) return(empty(1))
  diffs <- diff(t)
  dt <- if (!is.null(bin_size)) as.numeric(bin_size) else js_upper_median(diffs)
  if (!is.finite(dt) || dt <= 0) return(empty(1))
  timespan <- t[length(t)] - t[1]
  # `maxLag ? maxLag : span / 2`: JS truthiness, so 0, null and NaN mean "auto".
  # The lag window is set by TIME, not by the sample count (correlogram.js rule 5): the
  # default is half the recording span in hours, since the spacing may be uneven (Chatfield,
  # The Analysis of Time Series: lags up to about N/4 to N/2). A user max lag wins, up to the
  # span; on the index-shift path also below n shifts.
  max_lag_t <- if (!is.null(max_lag) && !is.na(max_lag) && max_lag != 0) as.numeric(max_lag)
               else timespan / 2
  min_lag_t <- if (!is.null(min_lag) && is.finite(min_lag) && min_lag > 0) as.numeric(min_lag)
               else 0
  if (min_lag_t >= max_lag_t) return(empty(dt))
  n_lags <- min(floor(max_lag_t / dt), floor(timespan / dt))
  start_idx <- ceiling(min_lag_t / dt)
  ymean <- mean(y)
  yvar <- sum((y - ymean)^2) / n
  if (yvar == 0) return(list(lags = numeric(0), correlations = numeric(0), dt = dt,
                             peakLag = NA_real_, peakCorrelation = NA_real_))
  med <- js_upper_median(diffs)
  # "Uniform enough" within 10% of the median spacing takes the fast index-shift path; the
  # uneven path is O(n^2) and pairs samples by TIME difference instead, so a gappy record
  # still gets the right lags rather than lags that silently mean "index offset".
  is_uniform <- max(abs(diffs - med)) < med * 0.1
  # A shift of n samples or more has no pairs.
  if (is_uniform) n_lags <- min(n_lags, n - 1)
  lags <- c(); corrs <- c()
  ydem <- y - ymean
  # The app's `for (lag = start; lag <= nLags; lag++)` runs zero times when start > nLags
  # (a minLag beyond the lag window); seq(start, nLags) would count DOWN instead.
  lag_idx <- if (start_idx <= n_lags) start_idx:n_lags else integer(0)
  if (is_uniform) {
    for (lag in lag_idx) {
      if (lag >= n) break
      # Lag 0 is 1 by definition, not sum / (n * var) with its rounding.
      if (lag == 0) { corrs <- c(corrs, 1); lags <- c(lags, 0); next }
      a <- ydem[seq_len(n - lag)]; b <- ydem[(lag + 1):n]
      # A lag with no pairs is missing (NaN), not r = 0 (correlogram.js rule 4).
      corrs <- c(corrs, if (length(a) > 0) sum(a * b) / (length(a) * yvar) else NaN)
      lags <- c(lags, lag * dt)
    }
  } else {
    for (li in lag_idx) {
      target <- li * dt
      if (li == 0) { corrs <- c(corrs, 1); lags <- c(lags, target); next }
      # The half-open slot [(k - 1/2) dt, (k + 1/2) dt).
      lo <- (li - 0.5) * dt
      hi <- (li + 0.5) * dt
      s <- 0; count <- 0
      for (i in seq_len(n)) {
        for (j in seq_len(n)[-seq_len(i)]) {
          td <- t[j] - t[i]
          if (td >= lo && td < hi) { s <- s + ydem[i] * ydem[j]; count <- count + 1 }
          if (td >= hi) break
        }
      }
      # An empty slot is missing (NaN), not r = 0: the slotted estimator is a ratio over the
      # slot's pairs (Rehfeld et al. 2011, NPG 18:389, Eq. 10), undefined with none.
      corrs <- c(corrs, if (count > 0) s / (count * yvar) else NaN)
      lags <- c(lags, target)
    }
  }
  pk <- find_autocorrelation_peak(lags, corrs)
  list(lags = lags, correlations = corrs, dt = dt,
       peakLag = pk$lag, peakCorrelation = pk$correlation)
}

# ---------------------------------------------------------------------------
# Frequency filter
# ---------------------------------------------------------------------------

dc_in_band <- function(type_, low, high) {
  if (identical(type_, "high")) return(0 >= low)
  if (identical(type_, "band")) return(0 >= low && 0 <= high)
  0 <= high
}

# Zero out spectral bins outside the band and transform back. Gaps are filled with the MEAN
# before the transform (so they do not ring) and restored as NA afterwards, and the mean is
# added back only when the band actually contains DC — otherwise a high-pass would
# reintroduce the offset it just removed.
fft_filter <- function(y, type_ = "low", low = 0, high = 1) {
  raw <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(raw)
  if (!n) return(numeric(0))
  valid <- is.finite(raw)
  if (sum(valid) < 2) return(ifelse(valid, raw, NA_real_))
  m <- mean(raw[valid])
  M <- next_pow2(n)
  re <- numeric(M)
  re[seq_len(n)] <- ifelse(valid, raw, m) - m
  spec <- fft(re)
  for (k in seq_len(M)) {
    kk <- min(k - 1, M - (k - 1))
    norm_freq <- (2 * kk) / M
    keep <- if (identical(type_, "high")) norm_freq >= low
            else if (identical(type_, "band")) norm_freq >= low && norm_freq <= high
            else norm_freq <= high
    if (!keep) spec[k] <- 0
  }
  inv <- Re(fft(spec, inverse = TRUE)) / M
  add_back <- if (dc_in_band(type_, low, high)) m else 0
  ifelse(valid, inv[seq_len(n)] + add_back, NA_real_)
}

cp_frequencyfilter <- function(x, args, cols, raw_data) {
  type_ <- if (is.null(args$type)) "low" else args$type
  low <- as.numeric(if (is.null(args$low)) 0 else args$low)
  high <- as.numeric(if (is.null(args$high)) 1 else args$high)
  fft_filter(x, type_, low, high)
}

# ---------------------------------------------------------------------------
# RhythmicityAnalysis
# ---------------------------------------------------------------------------

# One node, three spectra. `hideInputs` switches the output SHAPE: on, every y shares one
# x column (rhythmicityx) plus a per-y series; off, each y gets its own fully named set.
tp_rhythmicityanalysis <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  analysis <- if (is.null(args$analysis)) "periodogram" else args$analysis
  t <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  shared_x <- NULL; any_valid <- FALSE; stats_by_y <- list()
  pick <- function(a, b, d) if (!is.null(args[[a]])) args[[a]]
                            else if (!is.null(args[[b]])) args[[b]] else d

  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y <- col_data(env$cols[[yk]], env$cols, env$raw_data)

    if (identical(analysis, "periodogram")) {
      pg <- run_periodogram_calculation(list(
        t = t, y = y,
        method = pick("pgMethod", "method", "Lomb-Scargle"),
        minPeriod = pick("periodMin", "minPeriod", 1),
        maxPeriod = pick("periodMax", "maxPeriod", 48),
        stepSize = pick("periodStep", "stepSize", 0.1),
        # JS RhythmicityAnalysis passes binSize = pgBinSize ?? 0.25 and
        # chiSquaredAlpha = pgAlpha ?? 0.05 (RhythmicityAnalysis.svelte:142).
        dt = if (is.null(args$pgBinSize)) 0.25 else as.numeric(args$pgBinSize),
        alpha = if (is.null(args$pgAlpha)) 0.05 else as.numeric(args$pgAlpha)))
      per_key <- list(period = pg$x, power = pg$y)
      if (!is.null(pg$threshold)) per_key$threshold <- pg$threshold
      px <- pg$x; py <- pg$y
    } else if (identical(analysis, "fft")) {
      fs <- args$fftFreqStep
      f <- compute_fft(t, y, if (is.numeric(fs) && length(fs) == 1 && is.finite(fs) && fs > 0)
                       fs else NULL)
      periods <- ifelse(f$frequencies != 0, 1 / f$frequencies, NA_real_)
      per_key <- list(frequency = f$frequencies, period = periods, magnitude = f$magnitudes,
                      phase = f$phases)
      px <- periods; py <- f$magnitudes
    } else if (identical(analysis, "correlogram")) {
      ac <- compute_autocorrelation(
        t, y,
        min_lag = as.numeric(if (is.null(args$corrMinLag)) 0 else args$corrMinLag),
        max_lag = if (is.null(args$corrMaxLag)) NULL else args$corrMaxLag)
      per_key <- list(lag = ac$lags, correlation = ac$correlations)
      px <- ac$lags; py <- ac$correlations
    } else {
      per_key <- NULL
    }
    # RhythmicityAnalysis.svelte writes EVERY wired output: one column per (y, key) and the
    # shared primary pair (rhythmicityx from the first y with output, rhythmicityy_<y>;
    # getPrimaryKeys). The ports used to write one family or the other on an args$hideInputs
    # the app never saves (it is a component prop), so the pair was empty in every export.
    if (!is.null(per_key)) {
      for (k in names(per_key)) {
        set_col(env, env$cols, out_id(args, paste0(y_id, "_", k)), per_key[[k]], type = "number")
      }
      if (is.null(shared_x) && length(px)) {
        shared_x <- px
        set_col(env, env$cols, out_id(args, "rhythmicityx"), px, type = "number")
      }
      set_col(env, env$cols, out_id(args, paste0("rhythmicityy_", y_id)), py, type = "number")
    }
    # The scalar stats behind the stat_<key> metric ports, by the app's peak rules.
    st <- list()
    if (identical(analysis, "periodogram")) {
      i <- .periodogram_peak_index(pg)  # largest Qp - threshold for Chi-squared (SPEC-9)
      if (i > 0) {
        st <- list(peak_period = pg$x[i], peak_power = pg$y[i])
        if (identical(args$pgMethod, "Chi-squared")) st$peak_pvalue <- .peak_familywise_p(pg, i)
      }
    } else if (identical(analysis, "fft")) {
      pk <- if (length(f$frequencies)) fft_peak(f) else NULL
      if (!is.null(pk)) st <- list(peak_frequency = pk$frequency,
                                   peak_period = if (pk$frequency != 0) pk$period else NaN,
                                   peak_magnitude = pk$magnitude)
    } else if (identical(analysis, "correlogram") && length(ac$lags)) {
      pk <- find_autocorrelation_peak(ac$lags, ac$correlations)
      if (!is.na(pk$lag)) st <- list(peak_lag = pk$lag, peak_correlation = pk$correlation)
    }
    stats_by_y[[yk]] <- st
    any_valid <- TRUE
  }
  if (any_valid) {
    keys <- switch(analysis, periodogram = c("peak_period", "peak_power",
                                             if (identical(args$pgMethod, "Chi-squared")) "peak_pvalue"),
                   fft = c("peak_period", "peak_frequency", "peak_magnitude"),
                   correlogram = c("peak_lag", "peak_correlation"), character(0))
    for (k in keys) {
      v <- vapply(y_ins, function(y) {
        x <- stats_by_y[[as.character(y)]][[k]]
        if (is.null(x)) NaN else as.numeric(x)
      }, numeric(1))
      set_col(env, env$cols, out_id(args, paste0("stat_", k)), v, type = "number")
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# StoredValueGroup
# ---------------------------------------------------------------------------

# Gathers named stored values into per-group columns. Only FINITE numbers are collected: a
# stored value that never resolved is skipped rather than entering the group as NA, because
# the group's length is what downstream comparisons treat as its n.
tp_storedvaluegroup <- function(args, env) {
  groups <- args$groups
  if (!is.list(groups)) groups <- list()
  any_valid <- FALSE
  sv <- if (is.null(env$stored_values)) list() else env$stored_values
  for (i in seq_along(groups)) {
    group <- groups[[i]]
    if (is.null(group)) group <- list()
    group_id <- if (!is.null(group$id)) group$id else paste0("idx_", i - 1)
    keys <- group$keys
    if (!is.list(keys) && !is.character(keys)) keys <- list()
    vals <- c()
    for (key in unlist(keys, use.names = FALSE)) {
      if (is.null(sv[[key]])) next
      v <- sv[[key]]
      # Stored values are held as {source, staticValue}; unwrap before testing.
      if (is.list(v)) v <- v$staticValue
      if (is.null(v) || is.logical(v)) next
      nv <- suppressWarnings(as.numeric(v))
      if (length(nv) == 1 && is.finite(nv)) vals <- c(vals, nv)
    }
    if (length(vals)) {
      set_col(env, env$cols, out_id(args, paste0("group_", group_id)), vals, type = "number")
      any_valid <- TRUE
    }
  }
  any_valid
}

# ---------------------------------------------------------------------------
# MovingAnalysis
# ---------------------------------------------------------------------------

# Slide a window along the record and run one of the rhythm analyses inside each, emitting a
# per-window series for every statistic that analysis produces. Everything here is plumbing
# over kernels already ported; the only real decisions are the window edges and the labels.
# movinganalysis.js getStatKeys (matching the Python port moving_stat_keys).
moving_stat_keys <- function(args) {
  an <- if (is.null(args$analysis)) "" else args$analysis
  g <- function(k, d) if (is.null(args[[k]])) d else args[[k]]
  switch(an,
    periodogram = c("peak_period", "peak_power",
                    if (identical(args$pgMethod, "Chi-squared")) "peak_pvalue"),
    summary = c("mean", "sd", "percentile"),
    npcra = c("IS", "IV", "RA", "L5", "M10", "M10onset"),
    cosinor = if (isTRUE(args$useFixedPeriod)) {
      H <- max(1, as.integer(g("nHarmonics", 1)))
      c("mesor", as.vector(rbind(paste0("H", 1:H, "_amplitude"), paste0("H", 1:H, "_acrophase"))),
        "rel_amplitude", "r2", "rmse", "rmse_n", "pvalue")
    } else {
      N <- max(1, as.integer(g("Ncurves", 1)))
      c(as.vector(rbind(paste0("C", 1:N, "_period"), paste0("C", 1:N, "_amplitude"),
                        paste0("C", 1:N, "_phase"), paste0("C", 1:N, "_acrophase"))),
        "r2", "rmse")
    },
    fft = c("peak_period", "peak_frequency", "peak_magnitude"),
    correlogram = c("peak_lag", "peak_correlation"),
    rectfit = c("mesor", "amplitude", "period", "acrophase", "duty_cycle", "kappa", "r2", "rmse"),
    doublelogistic = c("mesor", "amplitude", "onset", "offset", "k1", "k2",
                       if (isTRUE(args$dlPeriodic)) "period", "r2", "rmse"),
    trend = {
      model <- g("trendModel", "linear")
      if (model == "linear") c("slope", "intercept", "r2", "rmse")
      else if (model %in% c("exponential", "logarithmic")) c("a", "b", "r2", "rmse")
      else if (model == "polynomial") {
        deg <- max(0, floor(g("trendPolyDegree", 2)))
        c(paste0("c", 0:deg), "r2", "rmse")
      } else character(0)
    },
    character(0))
}

# movinganalysis.js computeStatsForWindow with the rolling phase frame (FIT-9).
.moving_window_stats <- function(tt, yy, args, phase = NULL, centre = NaN) {
  ref <- phase$ref
  rs <- if (is.null(phase$recordStart)) 0 else phase$recordStart
  g <- function(k, d) if (is.null(args[[k]])) d else args[[k]]
  keys <- moving_stat_keys(args)
  st <- setNames(as.list(rep(NaN, length(keys))), keys)
  if (length(tt) < 3) return(st)
  an <- g("analysis", "")
  if (an == "summary") {
    pct <- .js_number(g("summaryPercentile", 50))
    st$mean <- mean(yy); st$sd <- sd(yy)
    st$percentile <- as.numeric(quantile(yy, (if (is.finite(pct)) pct else 50) / 100,
                                         type = 7, names = FALSE))
  } else if (an == "periodogram") {
    res <- run_periodogram_calculation(list(t = tt, y = yy, method = g("pgMethod", "Lomb-Scargle"),
      minPeriod = args$periodMin, maxPeriod = args$periodMax, stepSize = args$periodStep,
      dt = g("pgBinSize", 0.25), alpha = g("pgAlpha", 0.05)))
    i <- .periodogram_peak_index(res)  # largest Qp - threshold for Chi-squared (SPEC-9)
    if (i > 0) {
      st$peak_period <- res$x[i]; st$peak_power <- res$y[i]
      if ("peak_pvalue" %in% keys) st$peak_pvalue <- .peak_familywise_p(res, i)
    }
  } else if (an == "npcra") {
    P <- g("npcraPeriod", 24)
    r <- compute_npcra(tt, yy, g("npcraEpochHours", 1), P, g("npcraMWindow", 10),
                       g("npcraLWindow", 5))
    if (!is.null(r)) {
      for (k in c("IS", "IV", "RA", "L5", "M10")) st[[k]] <- r[[k]]
      st$M10onset <- apply_phase_reference(wrap_to_period(r$M10onset + r$t0 - rs, P), ref, P)
    }
  } else if (an == "cosinor") {
    if (isTRUE(args$useFixedPeriod)) {
      per <- g("fixedPeriod", 24)
      r <- fit_cosinor_fixed(tt, yy, per, max(1, as.integer(g("nHarmonics", 1))), g("alpha", 0.05))
      if (!is.null(r)) {
        st$mesor <- r$M
        for (h in r$harmonics) {
          st[[paste0("H", h$k, "_amplitude")]] <- h$amplitude
          st[[paste0("H", h$k, "_acrophase")]] <- apply_phase_reference(
            wrap_to_period(h$acrophase_hrs, per / h$k), ref, per / h$k)
        }
        amp1 <- if (length(r$harmonics)) r$harmonics[[1]]$amplitude else NaN
        st$rel_amplitude <- if (is.finite(r$M) && abs(r$M) > 1e-12 && is.finite(amp1))
          amp1 / r$M else NaN
        st$r2 <- r$R2; st$rmse <- r$RMSE; st$rmse_n <- r$RMSE_n; st$pvalue <- r$pF
      }
    } else {
      r <- fit_cosine_curves(tt, yy, max(1, as.integer(g("Ncurves", 1))))
      if (!is.null(r) && length(r$parameters$cosines)) {
        for (ci in seq_along(r$parameters$cosines)) {
          cs <- r$parameters$cosines[[ci]]
          w <- cs$frequency; per <- if (w) 1 / w else NaN
          st[[paste0("C", ci, "_period")]] <- per
          st[[paste0("C", ci, "_amplitude")]] <- cs$amplitude
          st[[paste0("C", ci, "_phase")]] <- cs$phase
          pk <- if (isTRUE(per > 0)) wrap_to_period(-cs$phase / (2 * pi * w), per) else NaN
          st[[paste0("C", ci, "_acrophase")]] <- apply_phase_reference(
            wrap_to_period(nearest_phase_instant(pk, per, centre), 24), ref, 24)
        }
        st$r2 <- r$rSquared; st$rmse <- r$rmse
      }
    }
  } else if (an == "fft") {
    fs <- .moving_fft_stats(tt, yy, args)
    for (k in names(fs)) st[[k]] <- fs[[k]]
  } else if (an == "correlogram") {
    mn <- args$corrMinLag; mx <- args$corrMaxLag
    r <- compute_autocorrelation(tt, yy, NULL,
                                 max_lag = if (is.numeric(mx) && isTRUE(mx > 0)) mx else NULL,
                                 min_lag = if (is.numeric(mn) && isTRUE(mn > 0)) mn else 0)
    if (length(r$lags)) {
      pk <- find_autocorrelation_peak(r$lags, r$correlations)
      if (!is.na(pk$lag)) { st$peak_lag <- pk$lag; st$peak_correlation <- pk$correlation }
    }
  } else if (an == "rectfit") {
    fixed <- isTRUE(args$useFixedPeriod); fp <- g("fixedPeriod", 24)
    r <- tryCatch(fit_rectangular_wave(tt, yy, list(
      fixOmega = fixed, fixedOmega = if (fixed) 2 * pi / fp else NULL,
      fixKappa = isTRUE(args$rwFixKappa), fixedKappa = g("rwFixedKappa", 5),
      fixDutyCycle = isTRUE(args$rwFixDutyCycle), fixedDutyCycle = g("rwFixedDutyCycle", 0.5))),
      error = function(e) NULL)
    if (!is.null(r)) {
      pr <- r$parameters
      st$mesor <- pr$M; st$amplitude <- pr$A; st$period <- r$period
      fold <- if (fixed) fp else 24
      pk <- if (fixed) r$acrophase
            else wrap_to_period(nearest_phase_instant(r$acrophase, r$period, centre), fold)
      st$acrophase <- apply_phase_reference(pk, ref, fold)
      st$duty_cycle <- pr$dutyCycle; st$kappa <- pr$kappa
      st$r2 <- r$rSquared; st$rmse <- r$rmse
    }
  } else if (an == "doublelogistic") {
    periodic <- isTRUE(args$dlPeriodic)
    r <- fit_double_logistic(tt, yy, list(periodic = periodic, fixK1 = isTRUE(args$dlFixK1),
      fixedK1 = g("dlFixedK1", 0.5), fixK2 = isTRUE(args$dlFixK2), fixedK2 = g("dlFixedK2", 0.5),
      fixPeriod = periodic && isTRUE(args$useFixedPeriod), fixedPeriod = g("fixedPeriod", 24)))
    if (!is.null(r)) {
      pr <- r$parameters
      st$mesor <- pr$M; st$amplitude <- pr$A
      T <- pr$T
      fold <- if (periodic && isTRUE(args$useFixedPeriod)) g("fixedPeriod", 24) else 24
      dlp <- function(tx) {
        inst <- if (periodic && !is.null(T) && isTRUE(T > 0)) nearest_phase_instant(tx, T, centre) else tx
        apply_phase_reference(wrap_to_period(inst, fold), ref, fold)
      }
      st$onset <- dlp(pr$t1); st$offset <- dlp(pr$t2)
      st$k1 <- pr$k1; st$k2 <- pr$k2
      if (periodic) st$period <- T
      st$r2 <- r$rSquared; st$rmse <- r$rmse
    }
  } else if (an == "trend") {
    model <- g("trendModel", "linear"); deg <- max(0, floor(g("trendPolyDegree", 2)))
    bad <- (model == "logarithmic" && any(!(tt > 0))) || (model == "exponential" && any(!(yy > 0))) ||
      (model == "polynomial" && length(tt) <= deg)
    r <- if (bad) NULL else tryCatch(fit_trend(tt, yy, model, deg), error = function(e) NULL)
    if (!is.null(r) && !is.null(r$parameters)) {
      pr <- r$parameters
      if (model == "linear") { st$slope <- pr$slope; st$intercept <- pr$intercept }
      else if (model %in% c("exponential", "logarithmic")) { st$a <- pr$a; st$b <- pr$b }
      else if (model == "polynomial") for (i in seq_along(pr$coeffs)) st[[paste0("c", i - 1)]] <- pr$coeffs[i]
      st$r2 <- r$rSquared; st$rmse <- r$rmse
    }
  }
  st
}

# movinganalysis.js computeMovingWindows (matching the Python port compute_moving_windows).
compute_moving_windows <- function(t_all, ys, starts, window_size, stat_keys, args, phase = NULL) {
  model <- if (identical(args$analysis, "trend")) (if (is.null(args$trendModel)) "linear" else args$trendModel) else NULL
  deg <- max(0, floor(if (is.null(args$trendPolyDegree)) 2 else args$trendPolyDegree))
  tl <- as.list(t_all)
  tn_all <- vapply(tl, function(v) if (.js_invalid(v)) NaN else .js_number(v), numeric(1))
  lapply(ys, function(y_data) {
    yl <- as.list(y_data)
    yn_all <- vapply(yl, function(v) if (.js_invalid(v)) NaN else .js_number(v), numeric(1))
    n <- min(length(tn_all), length(yn_all))
    tn <- tn_all[seq_len(n)]; yn <- yn_all[seq_len(n)]
    ok <- !is.nan(tn) & !is.nan(yn)
    per <- setNames(lapply(stat_keys, function(k) rep(NaN, length(starts))), stat_keys)
    for (w in seq_along(starts)) {
      ws <- starts[w]
      m <- ok & tn >= ws & tn < ws + window_size
      tt <- tn[m]; yy <- yn[m]
      if (length(tt) < 3) next
      if (identical(model, "logarithmic") && any(!(tt > 0))) next
      if (identical(model, "exponential") && any(!(yy > 0))) next
      if (identical(model, "polynomial") && length(tt) <= deg) next
      if (identical(args$analysis, "fft") && !regrid_uniform(tt, yy)$ok) next
      s <- .moving_window_stats(tt, yy, args, phase, ws + window_size / 2)
      for (k in stat_keys) {
        v <- s[[k]]
        if (!is.null(v) && length(v) == 1 && is.finite(v)) per[[k]][w] <- v
      }
    }
    per
  })
}

# Port of MovingAnalysis.svelte movinganalysis over compute_moving_windows (see the Python
# port tp_movinganalysis).
tp_movinganalysis <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  win <- if (is.null(args$windowSize)) NaN else .js_number(args$windowSize)
  step <- if (is.null(args$stepSize)) NaN else .js_number(args$stepSize)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins) ||
      !isTRUE(win > 0) || !isTRUE(step > 0)) return(FALSE)
  x_col <- env$cols[[as.character(x_in)]]
  is_time <- identical(x_col$type, "time")
  t_all <- if (is_time) col_hours(x_col, env$cols, env$raw_data)
           else col_data(x_col, env$cols, env$raw_data)
  origin <- if (is_time) time_origin_ms(x_col, env$cols, env$raw_data) else NULL
  vx <- vapply(Filter(function(v) !.js_invalid(v), as.list(t_all)), .js_number, numeric(1))
  if (length(vx) < 3) return(FALSE)
  x_min <- min(vx); x_max <- max(vx)
  if (x_max - x_min < win) return(FALSE)
  starts <- c(); s <- x_min
  while (s <= x_max - win + 1e-9) { starts <- c(starts, s); s <- s + step }
  if (!length(starts)) return(FALSE)
  lab <- if (is.null(args$binLabel)) "center" else args$binLabel
  off <- if (lab == "start") 0 else if (lab == "end") win else win / 2
  bins <- starts + off
  keys <- moving_stat_keys(args)
  ids <- Filter(function(y) !is.null(env$cols[[as.character(y)]]), y_ins)
  if (!length(ids)) return(FALSE)
  phase <- list(recordStart = x_min, ref = node_phase_reference(args, x_col, env$cols, env$raw_data))
  per_y <- compute_moving_windows(t_all, lapply(ids, function(y)
    col_data(env$cols[[as.character(y)]], env$cols, env$raw_data)), starts, win, keys, args, phase)
  names(per_y) <- as.character(ids)
  for (pp in args$preProcesses) {
    nm <- pp$processName
    if (is.null(nm)) next
    for (yk in names(per_y)) for (k in keys)
      per_y[[yk]][[k]] <- run_column_process(tolower(gsub(" ", "", nm)), per_y[[yk]][[k]],
        if (is.null(pp$processArgs)) list() else pp$processArgs, env$cols, env$raw_data)
  }
  mx <- out_id(args, "movex")
  if (mx != -1) {
    if (!is.null(origin)) set_col(env, env$cols, mx, origin + bins * 3600000, type = "time")
    else set_col(env, env$cols, mx, bins, type = "number")
    if (!is.null(env$cols[[as.character(mx)]])) env$cols[[as.character(mx)]]$bin_width <- win
    for (yk in names(per_y)) for (k in keys)
      set_col(env, env$cols, out_id(args, paste0(yk, "_", k)), per_y[[yk]][[k]], type = "number")
  }
  TRUE
}

# Parity surface mirroring the emitter's movingWindowsAdapter (see the Python port).
moving_windows <- function(times, values, opts = list()) {
  window <- .js_number(if (is.null(opts$windowSize)) 168 else opts$windowSize)
  step <- .js_number(if (is.null(opts$stepSize)) 24 else opts$stepSize)
  tt <- vapply(as.list(times), function(v) if (.js_invalid(v)) NaN else .js_number(v), numeric(1))
  yv <- vapply(as.list(values), function(v) if (.js_invalid(v)) NaN else .js_number(v), numeric(1))
  valid <- tt[is.finite(tt)]
  lo <- min(valid); hi <- max(valid)
  starts <- c(); s <- lo
  while (s <= hi - window + 1e-9) { starts <- c(starts, s); s <- s + step }
  keys <- moving_stat_keys(opts)
  off <- opts$clockOffsetHours
  phase <- list(recordStart = lo,
                ref = if (!is.null(off)) list(clock = TRUE, offsetHours = off) else NULL)
  per <- compute_moving_windows(tt, list(yv), starts, window, keys, opts, phase)[[1]]
  c(list(starts = starts), per)
}

# ---------------------------------------------------------------------------
# GroupComparison
# ---------------------------------------------------------------------------
#
# Returns a RESULT OBJECT rather than writing output columns — the node feeds the UI, and
# nodeSpec.outputs is empty. The parity harness compares named fields instead of arrays,
# which is why its fixtures use the `tableProcessResult` kind.

gc_mean <- function(a) if (!length(a)) NA_real_ else mean(a)

# JS NON_FINITE_REASON: a NaN statistic is reported as not computable, never as p = 0.
GC_NON_FINITE_REASON <- paste0("The test statistic could not be computed: a group contains ",
                               "a non-finite value.")

gc_sample_variance <- function(a) {
  if (length(a) < 2) return(NA_real_)
  sum((a - mean(a))^2) / (length(a) - 1)
}

gc_sample_std <- function(a) {
  v <- gc_sample_variance(a)
  if (is.finite(v)) sqrt(v) else NA_real_
}

gc_p_upper_from_f <- function(f, df1, df2) {
  if (!is.finite(f) || !is.finite(df1) || !is.finite(df2)) return(NA_real_)
  if (df1 <= 0 || df2 <= 0 || f < 0) return(NA_real_)
  pf(f, df1, df2, lower.tail = FALSE)
}

# Bucket y by group label, keeping FIRST-APPEARANCE order (the JS builds a Map, which
# preserves insertion order). Sorting instead would silently relabel "group 1" and "group 2"
# in the reported difference, flipping its sign.
gc_build_groups <- function(group_data, y_data) {
  n <- length(y_data)
  order_ <- character(0); buckets <- list()
  for (i in seq_len(n)) {
    g_raw <- if (i <= length(group_data)) group_data[[i]] else NULL
    y_raw <- y_data[[i]]
    # A missing label (NA, "", NaN or "NaN") is not a group and a missing value (house rule)
    # is not a zero: both rows are dropped (JS isMissingCategory / isInvalidValue). +-Inf is
    # a value, as in the JS, and makes the test statistic non-computable below.
    if (is.null(g_raw) || length(g_raw) != 1 || isTRUE(is_missing_category(g_raw))) next
    if (.js_invalid(y_raw)) next
    yv <- .js_number(y_raw)
    g <- js_string(g_raw)
    if (!(g %in% order_)) { order_ <- c(order_, g); buckets[[g]] <- numeric(0) }
    buckets[[g]] <- c(buckets[[g]], yv)
  }
  lapply(order_, function(nm) {
    v <- buckets[[nm]]
    list(name = nm, values = v, n = length(v), mean = gc_mean(v), sd = gc_sample_std(v))
  })
}

# Welch's t-test: unequal variances assumed, with the Welch-Satterthwaite df. NOT Student's
# pooled test — using the pooled form here would report a different df and p on unequal ns,
# which is the common case for group comparisons.
gc_welch_t_test <- function(a, b, alpha = 0.05) {
  n1 <- a$n; n2 <- b$n
  if (n1 < 2 || n2 < 2) {
    return(list(valid = FALSE, reason = "Each group needs at least 2 valid values for a t-test."))
  }
  if (!is.finite(a$mean) || !is.finite(b$mean)) {
    return(list(valid = FALSE, t = NaN, pValue = NaN, reason = GC_NON_FINITE_REASON))
  }
  v1 <- gc_sample_variance(a$values); v2 <- gc_sample_variance(b$values)
  aa <- v1 / n1; bb <- v2 / n2
  se <- sqrt(aa + bb)
  diff <- a$mean - b$mean
  if (!is.finite(se) || se < 0) {
    return(list(valid = FALSE, reason = "Unable to compute standard error for t-test."))
  }
  t <- if (se == 0) { if (diff == 0) 0 else Inf } else diff / se
  df_den <- (aa * aa) / (n1 - 1) + (bb * bb) / (n2 - 1)
  df <- if (df_den == 0) (n1 + n2 - 2) else (aa + bb)^2 / df_den
  # p from t^2 on F(1, df): identical to the two-sided t p-value, and matches the JS, which
  # has an F CDF to hand but not a t one.
  p_value <- if (is.finite(t)) gc_p_upper_from_f(t * t, 1, df) else 0
  t_crit <- if (is.finite(df)) qt(1 - alpha / 2, df) else NA_real_
  ci_half <- if (is.finite(t_crit) && is.finite(se)) t_crit * se else NA_real_
  # Cohen's d on the pooled SD (GroupComparison.svelte welchTTest), the effect size the node's
  # effectSize port reports for the t-test. It was missing here, so that port read NaN in R.
  pooled_den <- n1 + n2 - 2
  pooled_var <- if (pooled_den > 0) ((n1 - 1) * v1 + (n2 - 1) * v2) / pooled_den else NaN
  cohen_d <- if (is.finite(pooled_var) && pooled_var > 0) diff / sqrt(pooled_var) else NaN
  list(valid = TRUE, difference = diff, t = t, df = df, pValue = p_value,
       se = se, ciLow = diff - ci_half, ciHigh = diff + ci_half, cohenD = cohen_d)
}

gc_one_way_anova <- function(groups) {
  usable <- Filter(function(g) g$n > 0, groups)
  k <- length(usable)
  if (k < 2) return(list(valid = FALSE, reason = "ANOVA needs at least 2 non-empty groups."))
  n_total <- sum(vapply(usable, function(g) g$n, numeric(1)))
  if (n_total <= k) {
    return(list(valid = FALSE,
                reason = "ANOVA needs at least one group with more than 1 value."))
  }
  grand_mean <- sum(vapply(usable, function(g) g$mean * g$n, numeric(1))) / n_total
  ss_between <- sum(vapply(usable, function(g) g$n * (g$mean - grand_mean)^2, numeric(1)))
  ss_within <- sum(vapply(usable, function(g) sum((g$values - g$mean)^2), numeric(1)))
  df_between <- k - 1
  df_within <- n_total - k
  ms_between <- ss_between / df_between
  ms_within <- ss_within / df_within
  f <- if (is.nan(ms_within)) NaN
       else if (ms_within == 0) { if (ms_between == 0) 0 else Inf } else ms_between / ms_within
  if (is.nan(f)) return(list(valid = FALSE, f = NaN, pValue = NaN, reason = GC_NON_FINITE_REASON))
  list(valid = TRUE, f = f, ssBetween = ss_between, ssWithin = ss_within,
       dfBetween = df_between, dfWithin = df_within,
       msBetween = ms_between, msWithin = ms_within,
       etaSquared = if ((ss_between + ss_within) > 0) ss_between / (ss_between + ss_within) else NA_real_,
       # f = Inf only when ms_within == 0 and the means differ: p = 0 is its limit.
       pValue = if (is.finite(f)) gc_p_upper_from_f(f, df_between, df_within) else 0)
}

# 'auto' picks by GROUP COUNT, not by a normality test: two groups get a t-test, more get
# ANOVA. An explicitly requested method that does not suit the group count returns NULL
# rather than silently falling back to one that does.
gc_resolve_method <- function(requested, groups_count) {
  if (identical(requested, "ttest")) return(if (groups_count == 2) "ttest" else NULL)
  if (identical(requested, "anova")) return(if (groups_count >= 2) "anova" else NULL)
  if (identical(requested, "mannwhitney")) return(if (groups_count == 2) "mannwhitney" else NULL)
  if (identical(requested, "kruskal")) return(if (groups_count >= 2) "kruskal" else NULL)
  if (groups_count == 2) "ttest" else if (groups_count > 2) "anova" else NULL
}

gc_run_selected <- function(groups, chosen, alpha, post_hoc_enabled = TRUE) {
  if (is.null(chosen)) {
    return(list(valid = FALSE, groups = groups,
                reason = "Need at least 2 groups with data for comparison."))
  }
  if (identical(chosen, "ttest")) {
    r <- gc_welch_t_test(groups[[1]], groups[[2]], alpha)
    return(c(list(test = "Welch t-test", groupCount = length(groups),
                  nTotal = groups[[1]]$n + groups[[2]]$n, groups = list(groups)), r))
  }
  if (identical(chosen, "anova")) {
    r <- gc_one_way_anova(groups)
    # The post-hoc table only when the node's switch is on (GroupComparison.svelte
    # runSelectedComparison: `postHocEnabled && aRes.valid && groups.length > 2`).
    ph <- if (post_hoc_enabled && isTRUE(r$valid) && length(groups) > 2)
      gc_tukey_kramer_post_hoc(groups, r$msWithin, r$dfWithin, alpha) else list()
    r$postHoc <- ph
    return(c(list(test = "One-way ANOVA", groupCount = length(groups),
                  nTotal = sum(vapply(groups, function(g) g$n, numeric(1))),
                  groups = list(groups)), r))
  }
  # The rank-based tests are not ported. Refusing beats returning a parametric answer under a
  # nonparametric label, which is what a silent fallback would do.
  stop(sprintf(paste0("ancir: GroupComparison method '%s' is not implemented by the R ",
                      "runtime (only Welch t-test and one-way ANOVA are). Export this ",
                      "session as Python instead."), chosen))
}

compute_group_comparison <- function(args, env) {
  x_in <- args$xIN
  y_ins <- args$yIN
  if (!is.list(y_ins)) y_ins <- if (!is.null(y_ins) && y_ins != -1) list(y_ins) else list()
  y_ins <- unlist(y_ins, use.names = FALSE)
  group_col <- if (!is.null(x_in) && x_in != -1) env$cols[[as.character(x_in)]] else NULL
  mode <- if (is.null(args$method)) "auto" else args$method
  alpha <- suppressWarnings(as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha))
  if (length(alpha) != 1 || !is.finite(alpha)) alpha <- 0.05
  # `argsIN.postHocEnabled !== false`: only an explicit false turns the post-hoc off.
  post_hoc <- !identical(args$postHocEnabled, FALSE)

  # Boxplot-like fallback: several Y columns and NO group column means each column IS a group.
  if (is.null(group_col) && length(y_ins) > 1) {
    groups <- lapply(y_ins, function(y) {
      c1 <- env$cols[[as.character(y)]]
      v <- .present_numbers(col_data(c1, env$cols, env$raw_data))
      list(name = if (is.null(c1$name)) as.character(y) else c1$name,
           values = v, n = length(v), mean = gc_mean(v), sd = gc_sample_std(v))
    })
    comp <- gc_run_selected(groups, gc_resolve_method(mode, length(groups)), alpha, post_hoc)
    return(list(result = list(multiY = comp), anyValid = isTRUE(comp$valid)))
  }
  if (is.null(group_col) || !length(y_ins)) {
    return(list(result = list(), anyValid = FALSE))
  }

  group_data <- col_data(group_col, env$cols, env$raw_data)
  out <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    groups <- gc_build_groups(group_data, col_data(env$cols[[yk]], env$cols, env$raw_data))
    groups <- Filter(function(g) g$n > 0, groups)
    comp <- gc_run_selected(groups, gc_resolve_method(mode, length(groups)), alpha, post_hoc)
    nm <- env$cols[[yk]]$name
    out[[yk]] <- c(list(columnName = if (is.null(nm)) yk else nm), comp)
    if (isTRUE(comp$valid)) any_valid <- TRUE
  }
  list(result = out, anyValid = any_valid)
}

# GroupComparison.svelte writeGroupComparisonMetrics (Python: _gc_write_metrics): the scalar
# metric ports, one value per y input in yIN order (one in the no-group multi-Y mode): the
# test's statistic (t / F / U / H), its p and the effect size that belongs with that test.
.gc_write_metrics <- function(args, env, result) {
  ids <- c(out_id(args, "statistic"), out_id(args, "pvalue"), out_id(args, "effectSize"))
  if (all(ids == -1)) return(invisible(NULL))
  num1 <- function(v) if (is.numeric(v) && length(v) == 1) as.numeric(v) else NULL
  statistic_of <- function(c) {
    for (k in c("t", "f", "u", "h")) if (!is.null(c[[k]])) return(as.numeric(c[[k]]))
    NaN
  }
  effect_of <- function(c) {
    for (k in c("cohenD", "etaSquared", "rEffect", "epsilonSquared")) {
      v <- num1(c[[k]])
      if (!is.null(v) && is.finite(v)) return(v)
    }
    NaN
  }
  p_of <- function(c) { v <- num1(c$pValue); if (is.null(v)) NaN else v }
  chosen <- if (!is.null(result$multiY)) list(result$multiY)
            else lapply(id_list(args$yIN), function(y) result[[as.character(y)]])
  set_col(env, env$cols, ids[1], vapply(chosen, statistic_of, numeric(1)), type = "number")
  set_col(env, env$cols, ids[2], vapply(chosen, p_of, numeric(1)), type = "number")
  set_col(env, env$cols, ids[3], vapply(chosen, effect_of, numeric(1)), type = "number")
}

# The validity flag, and the metric ports (statistic, pvalue, effectSize) as the app writes
# them. The app returns before writing them only when there is neither a group column nor a
# multi-Y comparison (or no y at all).
tp_groupcomparison <- function(args, env) {
  gc <- compute_group_comparison(args, env)
  x_in <- args$xIN
  has_group <- !is.null(x_in) && x_in != -1 && !is.null(env$cols[[as.character(x_in)]])
  if (!is.null(gc$result$multiY) || (has_group && length(id_list(args$yIN)))) {
    .gc_write_metrics(args, env, gc$result)
  }
  isTRUE(gc$anyValid)
}

# ---------------------------------------------------------------------------
# Deterministic source nodes
# ---------------------------------------------------------------------------
#
# SequenceColumn and BlankColumn look like "generator" nodes and are NOT: neither draws from
# a PRNG. A sequence is start + i*step and a blank column is a constant fill, so both
# reproduce exactly in any language. Only Random and SimulatedData need the JS PRNG, and only
# those are out of scope for R.

# SequenceColumn.svelte MAX_SEQUENCE_LENGTH: the longest sequence (a guard against a mistyped
# count). Past it nothing is made and the same warning as the app's is given.
MAX_SEQUENCE_LENGTH <- 2e6

# SequenceColumn.svelte sequenceLimitWarning: the warning text, or NULL when it fits.
sequence_limit_warning <- function(count) {
  if (!(count > MAX_SEQUENCE_LENGTH)) return(NULL)
  paste0("Nothing was made: ", .thousands(count),
         " values is more than the limit of ",
         .thousands(MAX_SEQUENCE_LENGTH),
         ". Lower the count, or use a larger step for the same start and end.")
}

# Parity probe for the sequence limit: allowed (1/0) and the warning ("" if none).
sequence_limit <- function(unused, count) {
  w <- sequence_limit_warning(count)
  list(allowed = if (is.null(w)) 1 else 0, warning = if (is.null(w)) "" else w)
}

tp_sequencecolumn <- function(args, env) {
  kind <- if (!is.null(args$seqType)) args$seqType
          else if (!is.null(args$kind)) args$kind else "number"
  n <- as.numeric(if (!is.null(args$count)) args$count
                  else if (!is.null(args$rows)) args$rows else 100)
  n <- if (is.finite(n)) floor(n) else NA
  if (is.na(n) || n <= 0) return(FALSE)
  too_long <- sequence_limit_warning(n)
  if (!is.null(too_long)) {
    # The app shows this on the node and empties the output.
    warning(paste0("Sequence Column: ", too_long), call. = FALSE)
    return(FALSE)
  }
  oid <- out_id(args, "result")
  if (identical(kind, "time")) {
    base_ms <- as.numeric(if (!is.null(args$startTime)) args$startTime
                          else if (!is.null(args$startMs)) args$startMs else 0)
    step_h <- as.numeric(if (!is.null(args$stepHours)) args$stepHours
                         else if (!is.null(args$step)) args$step else 1)
    set_col(env, env$cols, oid, base_ms + (seq_len(n) - 1) * step_h * 3600000, type = "time")
  } else {
    start <- as.numeric(if (is.null(args$start)) 0 else args$start)
    step <- as.numeric(if (!is.null(args$step)) args$step
                       else if (!is.null(args$stepHours)) args$stepHours else 1)
    set_col(env, env$cols, oid, start + (seq_len(n) - 1) * step, type = "number")
  }
  TRUE
}

tp_blankcolumn <- function(args, env) {
  n <- as.integer(if (!is.null(args$N)) args$N
                  else if (!is.null(args$rows)) args$rows
                  else if (!is.null(args$length)) args$length else 0)
  if (is.na(n) || n <= 0) return(FALSE)
  # An empty cell reads back as NULL in the JS engine (a category column maps "" -> null), so
  # the default fill is NA to match. An explicit fillValue is still honoured.
  fill <- if (is.null(args$fillValue)) NA else args$fillValue
  set_col(env, env$cols, out_id(args, "result"), rep(fill, n), type = "category")
  TRUE
}

# Pure-util parity surface for the chi-squared (Sokolove-Bushell) periodogram. `period`,
# `power`, `df` and `threshold` are all parity-compared: with binSize at or below the
# sampling interval every bin holds at most one point, so this mod-binning port and the JS
# binData-then-fold pipeline are the SAME fold and must agree exactly — including on grids
# where most bins are empty, the regime whose empty-bin handling this pins. (With several
# points per bin the two pipelines still differ — that regime stays unpinned.)
chi_squared_periodogram <- function(t, y, opts) {
  res <- run_periodogram_calculation(list(
    t = t, y = y, method = "Chi-squared",
    minPeriod = if (is.null(opts$periodMin)) 1 else as.numeric(opts$periodMin),
    maxPeriod = if (is.null(opts$periodMax)) 48 else as.numeric(opts$periodMax),
    stepSize = if (is.null(opts$periodStep)) 0.1 else as.numeric(opts$periodStep),
    dt = if (is.null(opts$binSize)) 0.25 else as.numeric(opts$binSize),
    alpha = if (is.null(opts$alpha)) 0.05 else as.numeric(opts$alpha)))
  list(period = res$x, power = res$y, df = res$df, threshold = res$threshold,
       pvalue = res$pvalue)
}

# Pure-util parity surface for Lomb-Scargle through run_periodogram_calculation.
lomb_scargle_periodogram <- function(t, y, opts) {
  res <- run_periodogram_calculation(list(
    t = t, y = y, method = "Lomb-Scargle",
    minPeriod = if (is.null(opts$periodMin)) 1 else as.numeric(opts$periodMin),
    maxPeriod = if (is.null(opts$periodMax)) 48 else as.numeric(opts$periodMax),
    stepSize = if (is.null(opts$periodStep)) 0.1 else as.numeric(opts$periodStep)))
  list(period = res$x, power = res$y)
}

# Pure-util parity surface for the Enright periodogram: the distinct-fold period axis and
# the power at each fold, matching periodogram.js.
enright_periodogram <- function(t, y, opts) {
  res <- run_periodogram_calculation(list(
    t = t, y = y, method = "Enright",
    minPeriod = if (is.null(opts$periodMin)) 1 else as.numeric(opts$periodMin),
    maxPeriod = if (is.null(opts$periodMax)) 48 else as.numeric(opts$periodMax),
    stepSize = if (is.null(opts$periodStep)) 0.1 else as.numeric(opts$periodStep),
    dt = if (is.null(opts$binSize)) 0.25 else as.numeric(opts$binSize)))
  list(period = res$x, power = res$y)
}

# Pure kernels the parity harness can call by name, keyed by the fixture's `rFunc` (which
# sits beside the existing `pyFunc`, so both legs read one fixture file).
#
# Referenced directly rather than wrapped in adapters: the fixtures already describe how to
# build the call — `argRefs`/`valuesRef` name the inputs and `pyArgs`/`rArgs` supply the rest
# — so the harness assembles positional arguments the same way for every kernel. Per-kernel
# adapters would be a second, hand-maintained copy of that contract, and would drift.
# Studentized range (STAT-10). R's ptukey/qtukey, accurate to about 1e-11 ABSOLUTE in the
# upper tail (the JS and Python integrate the tail directly, so a p below ~1e-9 agrees only
# in absolute terms; fixtures carry rTolerance 1e-9).
studentized_range_sf <- function(q, k, df) {
  if (!is.finite(k) || k < 2 || !(df > 0) || is.na(q)) return(NaN)
  if (q <= 0) return(1)
  if (is.infinite(q)) return(0)
  ptukey(q, k, df, lower.tail = FALSE)
}
studentized_range <- function(v) {
  v <- as.numeric(unlist(v))
  list(sf = studentized_range_sf(v[1], v[2], v[3]), quantile = qtukey(v[4], v[2], v[3]))
}

# GroupComparison.svelte tukeyKramerPostHoc (matching the Python port): q against the
# studentized range at k non-empty groups and df = N - k, no Holm step.
gc_tukey_kramer_post_hoc <- function(groups, ms_within, df_within, alpha = 0.05) {
  if (!is.finite(ms_within) || !is.finite(df_within) || df_within <= 0) return(list())
  k <- sum(vapply(groups, function(g) g$n > 0, logical(1)))
  if (k < 2) return(list())
  qcrit <- qtukey(1 - alpha, k, df_within)
  out <- list()
  for (i in seq_along(groups)) for (j in seq_along(groups)) {
    if (j <= i) next
    a <- groups[[i]]; b <- groups[[j]]
    if (a$n == 0 || b$n == 0) next
    diff <- a$mean - b$mean
    se <- sqrt((ms_within / 2) * (1 / a$n + 1 / b$n))
    q <- if (!is.finite(diff)) NaN else if (se == 0) (if (diff == 0) 0 else Inf) else abs(diff) / se
    pv <- if (is.nan(q)) NaN else if (is.finite(q)) pf(q * q / 2, 1, df_within, lower.tail = FALSE) else 0
    pa <- if (is.nan(q)) NaN else studentized_range_sf(q, k, df_within)
    out[[length(out) + 1]] <- list(groupA = a$name, groupB = b$name, diff = diff,
                                   statistic = q, pValue = pv, pAdjusted = pa,
                                   ciLow = diff - qcrit * se, ciHigh = diff + qcrit * se,
                                   significant = isTRUE(pa < alpha))
  }
  out
}

# Parity surface: one-way ANOVA then Tukey-Kramer on groups given as value arrays (g1, g2,
# ...); the last argument is alpha. Returned column-wise (one vector per field).
tukey_kramer_of <- function(...) {
  args <- list(...)
  alpha <- as.numeric(args[[length(args)]])
  groups <- lapply(seq_len(length(args) - 1), function(i) {
    v <- .present_numbers(args[[i]])
    list(name = paste0("g", i), values = v, n = length(v), mean = gc_mean(v),
         sd = gc_sample_std(v))
  })
  an <- gc_one_way_anova(groups)
  rows <- if (isTRUE(an$valid)) gc_tukey_kramer_post_hoc(groups, an$msWithin, an$dfWithin, alpha)
          else list()
  fields <- c("groupA", "groupB", "diff", "statistic", "pValue", "pAdjusted", "ciLow",
              "ciHigh", "significant")
  setNames(lapply(fields, function(f) {
    v <- lapply(rows, function(r) r[[f]])
    if (f %in% c("groupA", "groupB")) as.list(unlist(v)) else unlist(v)
  }), fields)
}

# Parity surfaces: fft_peak over compute_fft as scalars (NaN for no peak), and the grid.
fft_peak_of <- function(times, values, freq_step = NULL, period_min = NULL, period_max = NULL) {
  pk <- fft_peak(compute_fft(times, values, freq_step), period_min, period_max)
  if (is.null(pk)) return(list(frequency = NaN, period = NaN, magnitude = NaN, phase = NaN))
  pk[c("frequency", "period", "magnitude", "phase")]
}
regrid_uniform_summary <- function(times, values) {
  g <- regrid_uniform(times, values)
  list(ok = if (g$ok) 1 else 0, dt = g$dt, nFilled = g$nFilled, longestGap = g$longestGap,
       y = g$y)
}

PURE_UTIL_MAP <- list(
  studentized_range = studentized_range,
  interpolate_grid_limit = interpolate_grid_limit,
  output_x_sequence_probe = output_x_sequence_probe,
  sequence_limit = sequence_limit,
  tukey_kramer_of = tukey_kramer_of,
  seeded_sequence = seeded_sequence,
  lomb_scargle_periodogram = lomb_scargle_periodogram,
  fft_peak_of = fft_peak_of,
  regrid_uniform_summary = regrid_uniform_summary,
  circular_mean = circular_mean,
  weighted_circular_mean = weighted_circular_mean,
  weighted_rayleigh = weighted_rayleigh,
  correlation_ci = correlation_ci,
  cross_correlation = cross_correlation,
  describe_stats = describe_stats,
  jarque_bera    = jarque_bera,
  moving_windows = moving_windows,
  compute_autocorrelation = compute_autocorrelation,
  compute_fft    = compute_fft,
  chi_squared_periodogram = chi_squared_periodogram,
  enright_periodogram = enright_periodogram,
  d_agostino     = d_agostino,
  shapiro_wilk   = shapiro_wilk,
  qq_points      = qq_points,
  qq_correlation = qq_correlation,
  correlate      = correlate,
  p_adjust       = p_adjust,
  rayleigh_test  = rayleigh_test
)

# ---------------------------------------------------------------------------
# FormulaColumn
# ---------------------------------------------------------------------------
#
# Port of src/lib/utils/formulaExpression.js (grammar in its header comment) and the module
# `formulacolumn` in src/lib/tableProcesses/FormulaColumn.svelte, matching the Python port.
# The formula is lexed against a fixed grammar, parsed into a tree, flattened to a postfix
# program and run on a value stack. Nothing here calls eval/parse/str2lang or looks anything
# up by a name taken from the formula except as a key into the fixed .FORMULA_FUNCTIONS
# table: a session file is untrusted input, and string-built evaluation of its text is how
# the JS (SEC-1) and Python (SEC-2) versions of this node came to run arbitrary code.

.formula_error <- function(msg) {
  stop(structure(class = c("formula_error", "error", "condition"),
                 list(message = msg, call = NULL)))
}

# A rounding result of zero carries the sign of its argument, as in JS (Math.round(-0.4) and
# Math.ceil(-0.5) are -0). R's floor/ceiling/trunc already keep it; the half-up round does not.
.formula_zero_sign <- function(r, a) if (r == 0 && (a < 0 || 1 / a < 0)) -0 else r

# JS Math.round: halves go toward +infinity, exactly (0.49999999999999994 -> 0).
.formula_round <- function(a) {
  r <- floor(a)
  .formula_zero_sign(if (a - r >= 0.5) r + 1 else r, a)
}

# C fmod / JS %: the remainder has the sign of the DIVIDEND (R's %% takes the divisor's).
.formula_fmod <- function(a, b) {
  if (b == 0) return(NaN)
  r <- abs(a) %% abs(b)
  if (a < 0) -r else r
}

# JS Math.sign: -1, 1, or the zero itself (sign(-0) = -0).
.formula_sign <- function(a) if (a == 0) a else sign(a)

# JS Math.cbrt: the REAL cube root (negative for a negative); R has no cbrt and a^(1/3) is NaN
# for a < 0. A power estimate polished by one Newton step.
.formula_cbrt <- function(a) {
  if (a == 0) return(a)
  r <- sign(a) * abs(a)^(1 / 3)
  d <- 3 * r * r
  if (is.finite(d) && d != 0) r <- r - (r * r * r - a) / d
  r
}

# JS ToUint32 for a finite double: truncate, then wrap modulo 2^32. Exact in doubles: v / 2^32
# is exact, so is its floor and the product, and the difference is an integer below 2^32.
.formula_uint32 <- function(a) {
  v <- trunc(a)
  v - 4294967296 * floor(v / 4294967296)
}

# JS Math.clz32: leading zero bits of ToUint32(a); clz32(0) = 32, clz32(-1) = 0.
.formula_clz32 <- function(a) {
  v <- .formula_uint32(a)
  bits <- 0
  while (v >= 1) { v <- floor(v / 2); bits <- bits + 1 }
  32 - bits
}

# JS Math.imul: the low 32 bits of ToInt32(a) * ToInt32(b), as a signed int32. The full product
# of two 32-bit values is not exact in a double, so it is built from 16-bit halves: only the low
# 16 bits of the cross terms survive the wrap.
.formula_imul <- function(a, b) {
  x <- .formula_uint32(a); y <- .formula_uint32(b)
  xh <- floor(x / 65536); xl <- x - xh * 65536
  yh <- floor(y / 65536); yl <- y - yh * 65536
  mid <- (xh * yl + xl * yh) %% 65536
  r <- (xl * yl + mid * 65536) %% 4294967296
  if (r >= 2147483648) r - 4294967296 else r
}

# JS Math.fround: the nearest float32, ties to even. 24 significant bits; below 2^-126 the
# quantum is fixed at 2^-149 (subnormals). Past the largest float32 the tie rule can carry to
# 2^128, which is +-Infinity in JS (missing here). R's round() at 0 digits is ties-to-even.
.formula_fround <- function(a) {
  if (a == 0) return(a)
  m <- abs(a)
  e <- floor(log2(m))
  if (2^e > m) e <- e - 1
  if (2^(e + 1) <= m) e <- e + 1
  q <- 2^(max(e, -126) - 23)
  r <- round(m / q) * q
  if (r >= 2^128) r <- Inf
  if (r == 0) return(if (a < 0) -0 else 0)
  if (a < 0) -r else r
}

# JS Math.hypot: sqrt of the sum of squares without overflowing on the way (scaled by the
# largest magnitude); a true overflow is Inf, missing.
.formula_hypot <- function(...) {
  v <- abs(c(...))
  m <- max(v)
  if (m == 0) return(0)
  m * sqrt(sum((v / m)^2))
}

# name -> list(min args, max args (Inf = unbounded), function). JS FUNCTIONS table: every
# function of the JS Math object with its spec arity. `random` has no function: it draws from
# the seeded generator evaluate_formula is given.
.FORMULA_FUNCTIONS <- list(
  abs = list(1, 1, function(a) abs(a)),
  acos = list(1, 1, function(a) acos(a)),
  acosh = list(1, 1, function(a) acosh(a)),
  asin = list(1, 1, function(a) asin(a)),
  asinh = list(1, 1, function(a) asinh(a)),
  atan = list(1, 1, function(a) atan(a)),
  atan2 = list(2, 2, function(y, x) atan2(y, x)),
  atanh = list(1, 1, function(a) atanh(a)),
  cbrt = list(1, 1, .formula_cbrt),
  ceil = list(1, 1, function(a) ceiling(a)),
  clz32 = list(1, 1, .formula_clz32),
  cos = list(1, 1, function(a) cos(a)),
  cosh = list(1, 1, function(a) cosh(a)),
  exp = list(1, 1, function(a) exp(a)),
  expm1 = list(1, 1, function(a) expm1(a)),
  floor = list(1, 1, function(a) floor(a)),
  fround = list(1, 1, .formula_fround),
  hypot = list(1, Inf, .formula_hypot),
  imul = list(2, 2, .formula_imul),
  log = list(1, 1, function(a) log(a)),
  log10 = list(1, 1, function(a) log10(a)),
  log1p = list(1, 1, function(a) log1p(a)),
  log2 = list(1, 1, function(a) log2(a)),
  max = list(1, Inf, function(...) max(...)),
  min = list(1, Inf, function(...) min(...)),
  pow = list(2, 2, function(a, b) a^b),
  random = list(0, 0, NULL),
  round = list(1, 1, .formula_round),
  sign = list(1, 1, .formula_sign),
  sin = list(1, 1, function(a) sin(a)),
  sinh = list(1, 1, function(a) sinh(a)),
  sqrt = list(1, 1, function(a) sqrt(a)),
  tan = list(1, 1, function(a) tan(a)),
  tanh = list(1, 1, function(a) tanh(a)),
  trunc = list(1, 1, function(a) trunc(a))
)
# The JS Math constants as the exact doubles JS holds (bare and after `Math.`), plus the bare
# lower-case pi and e the grammar always had.
.FORMULA_MATH_CONSTANTS <- list(
  E = 2.718281828459045, LN10 = 2.302585092994046, LN2 = 0.6931471805599453,
  LOG10E = 0.4342944819032518, LOG2E = 1.4426950408889634, PI = 3.141592653589793,
  SQRT1_2 = 0.7071067811865476, SQRT2 = 1.4142135623730951
)
.FORMULA_CONSTANTS <- c(list(pi = pi, e = exp(1)), .FORMULA_MATH_CONSTANTS)
.FORMULA_DEFAULT_SEED <- 12345
.FORMULA_MAX_LEXEMES <- 2000
.FORMULA_MAX_DEPTH <- 200
# ASCII classes only, anchored at the start of the remaining text.
.FORMULA_NUMBER_RE <- "^(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
.FORMULA_NAME_RE <- "^[A-Za-z_][A-Za-z0-9_]*"

.formula_has <- function(tbl, name) !is.null(name) && name %in% names(tbl)

.formula_show <- function(s) {
  ch <- strsplit(as.character(s), "")[[1]]
  cp <- vapply(ch, function(c) utf8ToInt(c)[1], numeric(1))
  ch[cp < 32 | cp == 127] <- "?"
  t <- paste(ch, collapse = "")
  if (nchar(t) > 20) t <- paste0(substr(t, 1, 20), "...")
  if (grepl('"', t, fixed = TRUE) && !grepl("'", t, fixed = TRUE)) paste0("'", t, "'")
  else paste0('"', t, '"')
}

.formula_match <- function(re, s) {
  m <- regmatches(s, regexpr(re, s, perl = TRUE))
  if (length(m)) m else NULL
}

# JS lex(): token list -> list of lexemes (lists with a `t` field).
.formula_lex <- function(tokens) {
  out <- list()
  for (tok in tokens) {
    if (!is.list(tok)) .formula_error("Malformed formula token.")
    tt <- tok$type
    if (identical(tt, "col")) {
      out[[length(out) + 1]] <- list(t = "col", id = if (!is.null(tok$id)) tok$id else tok$colId)
      next
    }
    if (identical(tt, "stored")) {
      out[[length(out) + 1]] <- list(t = "stored",
                                     key = if (!is.null(tok$key)) tok$key else tok$name)
      next
    }
    if (!identical(tt, "text"))
      .formula_error(sprintf("Unknown formula token type %s.",
                             .formula_show(if (is.null(tt)) "undefined" else tt)))
    src <- tok$value
    if (is.null(src)) src <- ""
    if (!is.character(src) || length(src) != 1) .formula_error("Formula text must be a string.")
    n <- nchar(src)
    i <- 1
    while (i <= n) {
      ch <- substr(src, i, i)
      if (ch %in% c(" ", "\t", "\n", "\r")) { i <- i + 1; next }
      rest <- substr(src, i, n)
      m <- .formula_match(.FORMULA_NUMBER_RE, rest)
      if (!is.null(m)) {
        glued <- .formula_match(.FORMULA_NAME_RE, substr(rest, nchar(m) + 1, nchar(rest)))
        if (!is.null(glued))
          .formula_error(sprintf("Cannot read %s: put an operator between a number and a name.",
                                 .formula_show(paste0(m, glued))))
        out[[length(out) + 1]] <- list(t = "num", v = as.numeric(m))
        i <- i + nchar(m)
        next
      }
      m <- .formula_match(.FORMULA_NAME_RE, rest)
      if (!is.null(m)) {
        name <- m
        len <- nchar(m)
        is_math <- FALSE
        if (name == "Math" && substr(rest, len + 1, len + 1) == ".") {
          m2 <- .formula_match(.FORMULA_NAME_RE, substr(rest, len + 2, nchar(rest)))
          if (is.null(m2)) .formula_error('Expected a function name after "Math.".')
          name <- m2
          len <- len + 1 + nchar(m2)
          is_math <- TRUE
        }
        if (substr(rest, len + 1, len + 1) == ".")
          .formula_error(sprintf(
            '%s is not allowed: a formula cannot reach into names with ".".',
            .formula_show(substr(rest, 1, len + 1))))
        out[[length(out) + 1]] <- list(t = "name", name = name, math = is_math,
                                       text = substr(rest, 1, len))
        i <- i + len
        next
      }
      if (ch %in% c("+", "-", "*", "/", "%", "^", "(", ")", ",")) {
        out[[length(out) + 1]] <- list(t = "op", v = ch)
        i <- i + 1
        next
      }
      .formula_error(sprintf(paste0(
        "Unexpected character %s. A formula can use numbers, columns ($), stored values (#), ",
        "+ - * / %% ^ ( ) and the functions %s."),
        .formula_show(ch), paste(names(.FORMULA_FUNCTIONS), collapse = ", ")))
    }
  }
  out
}

.formula_describe <- function(lx) {
  if (is.null(lx)) return("the end of the formula")
  switch(lx$t,
         num = sprintf("the number %s", format(lx$v)),
         name = .formula_show(lx$text),
         col = "a column",
         stored = "a stored value",
         .formula_show(lx$v))
}

# JS parseFormula(): token list -> tree (nested lists with a `k` field). Errors are
# `formula_error` conditions.
parse_formula <- function(tokens) {
  lx <- .formula_lex(tokens)
  if (!length(lx)) .formula_error("The formula is empty.")
  if (length(lx) > .FORMULA_MAX_LEXEMES)
    .formula_error(sprintf("The formula is too long (over %d parts).", .FORMULA_MAX_LEXEMES))
  st <- new.env()
  st$pos <- 1
  st$depth <- 0
  peek <- function() if (st$pos <= length(lx)) lx[[st$pos]] else NULL
  is_op <- function(v) {
    t <- peek()
    !is.null(t) && t$t == "op" && t$v == v
  }
  expect_op <- function(v) {
    if (!is_op(v))
      .formula_error(sprintf("Expected %s but found %s.", .formula_show(v),
                             .formula_describe(peek())))
    st$pos <- st$pos + 1
  }
  enter <- function() {
    st$depth <- st$depth + 1
    if (st$depth > .FORMULA_MAX_DEPTH) .formula_error("The formula is nested too deeply.")
  }
  expr <- function() {
    enter()
    node <- term()
    while (is_op("+") || is_op("-")) {
      op <- peek()$v
      st$pos <- st$pos + 1
      node <- list(k = "bin", op = op, a = node, b = term())
    }
    st$depth <- st$depth - 1
    node
  }
  term <- function() {
    node <- unary()
    while (is_op("*") || is_op("/") || is_op("%")) {
      op <- peek()$v
      st$pos <- st$pos + 1
      node <- list(k = "bin", op = op, a = node, b = unary())
    }
    node
  }
  unary <- function() {
    if (is_op("-") || is_op("+")) {
      op <- peek()$v
      st$pos <- st$pos + 1
      enter()
      a <- unary()
      st$depth <- st$depth - 1
      return(if (op == "-") list(k = "neg", a = a) else a)
    }
    power()
  }
  power <- function() {
    base <- primary()
    if (is_op("^")) {
      st$pos <- st$pos + 1
      enter()
      b <- unary()
      st$depth <- st$depth - 1
      return(list(k = "bin", op = "^", a = base, b = b))
    }
    base
  }
  primary <- function() {
    tok <- peek()
    if (is.null(tok)) .formula_error("The formula ends where a value was expected.")
    if (tok$t == "num") { st$pos <- st$pos + 1; return(list(k = "num", v = tok$v)) }
    if (tok$t == "col") { st$pos <- st$pos + 1; return(list(k = "col", id = tok$id)) }
    if (tok$t == "stored") { st$pos <- st$pos + 1; return(list(k = "stored", key = tok$key)) }
    if (tok$t == "name") {
      st$pos <- st$pos + 1
      const_tbl <- if (tok$math) .FORMULA_MATH_CONSTANTS else .FORMULA_CONSTANTS
      if (is_op("(")) {
        if (!.formula_has(.FORMULA_FUNCTIONS, tok$name))
          .formula_error(sprintf("Unknown function %s. Allowed: %s.", .formula_show(tok$text),
                                 paste(names(.FORMULA_FUNCTIONS), collapse = ", ")))
        st$pos <- st$pos + 1
        args <- list()
        if (!is_op(")")) {
          args[[1]] <- expr()
          while (is_op(",")) {
            st$pos <- st$pos + 1
            args[[length(args) + 1]] <- expr()
          }
        }
        expect_op(")")
        spec <- .FORMULA_FUNCTIONS[[tok$name]]
        lo <- spec[[1]]; hi <- spec[[2]]
        if (length(args) < lo || length(args) > hi) {
          want <- if (lo == hi) as.character(lo) else if (is.infinite(hi))
            paste("at least", lo) else sprintf("%d to %d", lo, hi)
          .formula_error(sprintf("%s() takes %s argument%s, not %d.", tok$name, want,
                                 if (want %in% c("1", "at least 1")) "" else "s",
                                 length(args)))
        }
        return(list(k = "call", fn = tok$name, args = args))
      }
      if (.formula_has(const_tbl, tok$name)) return(list(k = "num", v = const_tbl[[tok$name]]))
      if (.formula_has(.FORMULA_FUNCTIONS, tok$name))
        .formula_error(sprintf("%s is a function: write %s(...).", .formula_show(tok$text),
                               tok$text))
      .formula_error(sprintf(
        "Unknown name %s. Use $ to insert a column and # for a stored value.",
        .formula_show(tok$text)))
    }
    if (is_op("(")) {
      st$pos <- st$pos + 1
      inner <- expr()
      expect_op(")")
      return(inner)
    }
    .formula_error(sprintf("Expected a value but found %s.", .formula_describe(tok)))
  }
  tree <- expr()
  if (st$pos <= length(lx)) {
    tok <- peek()
    if (tok$t == "op" && tok$v == ")") .formula_error('Unbalanced ")" in the formula.')
    .formula_error(sprintf("Unexpected %s: an operator is missing.", .formula_describe(tok)))
  }
  tree
}

# Flatten a tree to a postfix program iteratively (a 2000-lexeme left chain is ~1000 deep).
.formula_postfix <- function(tree) {
  prog <- list()
  stack <- list(list(node = tree, done = FALSE))
  while (length(stack)) {
    top <- stack[[length(stack)]]
    stack[[length(stack)]] <- NULL
    node <- top$node
    if (node$k %in% c("num", "col", "stored")) {
      prog[[length(prog) + 1]] <- node
    } else if (top$done) {
      prog[[length(prog) + 1]] <- switch(node$k,
        neg = list(k = "neg"),
        bin = list(k = "bin", op = node$op),
        call = list(k = "call", fn = node$fn, n = length(node$args)))
    } else {
      stack[[length(stack) + 1]] <- list(node = node, done = TRUE)
      children <- switch(node$k, neg = list(node$a), bin = list(node$a, node$b),
                         call = node$args)
      for (child in rev(children)) stack[[length(stack) + 1]] <- list(node = child, done = FALSE)
    }
  }
  prog
}

# JS String.prototype.trim whitespace (code points), trimmed by hand: a PCRE class with
# \x{...} escapes above 255 needs UTF mode, which R only enables for non-ASCII input.
.JS_WS_CODES <- c(0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000:0x200A, 0x2028,
                  0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF)
.js_trim <- function(s) {
  cp <- utf8ToInt(enc2utf8(s))
  if (anyNA(cp)) return(s)
  keep <- which(!(cp %in% .JS_WS_CODES))
  if (!length(keep)) return("")
  intToUtf8(cp[min(keep):max(keep)])
}

# JS Number(string) for one string: a finite double, or NA when JS gives NaN or +-Infinity.
.js_number_from_string <- function(s) {
  t <- .js_trim(s)
  if (!nzchar(t)) return(NA_real_)
  if (grepl("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$", t, perl = TRUE)) {
    v <- as.numeric(t)
    return(if (is.finite(v)) v else NA_real_)
  }
  if (grepl("^0[xXoObB][0-9A-Za-z]+$", t, perl = TRUE)) {
    base <- switch(tolower(substr(t, 2, 2)), x = 16, o = 8, b = 2)
    digits <- strsplit(tolower(substr(t, 3, nchar(t))), "")[[1]]
    vals <- match(digits, c(as.character(0:9), letters)) - 1
    if (anyNA(vals) || any(vals >= base)) return(NA_real_)
    v <- 0
    for (d in vals) v <- v * base + d
    return(if (is.finite(v)) v else NA_real_)
  }
  NA_real_
}

# JS formulaCell(): a finite double, or NA when the cell is missing.
formula_cell <- function(v) {
  if (is.null(v) || length(v) != 1) return(NA_real_)
  if (is.list(v)) v <- v[[1]]
  if (is.null(v) || length(v) != 1 || is.na(v)) return(NA_real_)
  if (is.logical(v)) return(if (v) 1 else 0)
  if (is.numeric(v)) return(if (is.finite(v)) as.numeric(v) else NA_real_)
  if (is.character(v)) return(.js_number_from_string(v))
  NA_real_
}

.formula_finite <- function(v) if (length(v) == 1 && is.finite(v)) v else NA_real_

# JS formulaSeed(): a finite non-zero number (or numeric string) as given; anything else
# (NULL, NA, "", 0, +-Inf, a logical) is the default 12345.
formula_seed <- function(v) {
  n <- NA_real_
  if (is.list(v) && length(v) == 1) v <- v[[1]]
  if (length(v) == 1 && !is.logical(v)) {
    if (is.numeric(v)) n <- as.numeric(v)
    else if (is.character(v) && nzchar(.js_trim(v))) n <- .js_number_from_string(v)
  }
  if (!is.na(n) && is.finite(n) && n != 0) n else .FORMULA_DEFAULT_SEED
}

# JS evaluateFormula(): `column(id)` returns a column's cells, `stored(key)` a stored value.
# Returns a double vector, NA = missing. Every non-finite step is missing from there on.
# `rng` is the seeded generator random() draws from (seeded_rng(seed), the exact port of the
# app's createSeededRNG). Every instruction runs once per row, so each random() draws once per
# row, left to right, even in a row that ends up missing, as the JS tree walk does.
evaluate_formula <- function(tree, column, stored, n, rng = NULL) {
  prog <- .formula_postfix(tree)
  if (is.null(rng) && any(vapply(prog, function(ins)
    identical(ins$k, "call") && identical(ins$fn, "random"), logical(1))))
    .formula_error("random() needs a seeded generator.")
  col_cache <- list()
  stored_cache <- list()
  for (ins in prog) {
    if (ins$k == "col") {
      key <- as.character(ins$id)
      if (is.null(col_cache[[key]])) {
        d <- column(ins$id)
        col_cache[[key]] <- if (is.null(d)) list() else as.list(d)
      }
    } else if (ins$k == "stored" && is.null(stored_cache[[ins$key]])) {
      stored_cache[[ins$key]] <- formula_cell(stored(ins$key))
    }
  }
  out <- rep(NA_real_, n)
  for (i in seq_len(n)) {
    stack <- numeric(0)
    for (ins in prog) {
      k <- ins$k
      if (k == "num") {
        stack <- c(stack, .formula_finite(ins$v))
      } else if (k == "col") {
        d <- col_cache[[as.character(ins$id)]]
        stack <- c(stack, if (i <= length(d)) formula_cell(d[[i]]) else NA_real_)
      } else if (k == "stored") {
        stack <- c(stack, stored_cache[[ins$key]])
      } else if (k == "neg") {
        stack[length(stack)] <- -stack[length(stack)]
      } else if (k == "bin") {
        b <- stack[length(stack)]
        a <- stack[length(stack) - 1]
        stack <- stack[seq_len(length(stack) - 2)]
        r <- if (is.na(a) || is.na(b)) NA_real_ else suppressWarnings(switch(ins$op,
          "+" = a + b, "-" = a - b, "*" = a * b, "/" = a / b,
          "%" = .formula_fmod(a, b), "^" = a^b))
        stack <- c(stack, .formula_finite(r))
      } else if (ins$fn == "random") {  # a zero-argument call: one draw
        stack <- c(stack, rng())
      } else {  # call
        m <- ins$n
        vals <- stack[(length(stack) - m + 1):length(stack)]
        stack <- stack[seq_len(length(stack) - m)]
        r <- if (anyNA(vals)) NA_real_
             else suppressWarnings(do.call(.FORMULA_FUNCTIONS[[ins$fn]][[3]], as.list(vals)))
        stack <- c(stack, .formula_finite(r))
      }
    }
    out[i] <- stack[1]
  }
  out
}

# JS formulacolumn (FormulaColumn.svelte). Returns validity; a refused formula writes nothing.
tp_formulacolumn <- function(args, env) {
  tokens <- args$tokens
  if (is.null(tokens) || !is.list(tokens)) return(FALSE)
  tok_col <- function(t) if (!is.null(t$id)) t$id else t$colId
  is_col <- function(t) is.list(t) && identical(t$type, "col")
  col_tokens <- Filter(function(t) {
    id <- tok_col(t)
    is_col(t) && is.numeric(id) && length(id) == 1 && !is.na(id) && id >= 0
  }, tokens)
  if (!length(col_tokens)) return(FALSE)
  for (t in tokens) {
    if (is_col(t)) {
      id <- tok_col(t)
      if (is.null(id) || is.null(env$cols[[as.character(id)]])) return(FALSE)
    }
  }
  sv <- if (is.null(env$stored_values)) list() else env$stored_values
  for (t in tokens) {
    if (is.list(t) && identical(t$type, "stored")) {
      key <- if (!is.null(t$key)) t$key else t$name
      if (is.null(key) || !(key %in% names(sv))) return(FALSE)
    }
  }
  tree <- tryCatch(parse_formula(tokens), formula_error = function(e) NULL)
  if (is.null(tree)) return(FALSE)
  cell_list <- function(id) {
    col_data(env$cols[[as.character(id)]], env$cols, env$raw_data)
  }
  first <- cell_list(tok_col(col_tokens[[1]]))
  n <- length(first)
  if (n == 0) return(FALSE)
  stored_of <- function(key) {
    e <- sv[[key]]
    if (is.list(e)) e$staticValue else e
  }
  result <- evaluate_formula(tree, cell_list, stored_of, n,
                             rng = seeded_rng(formula_seed(args$seed)))
  set_col(env, env$cols, out_id(args, "result"), result, type = "number")
  length(result) > 0
}

# ---------------------------------------------------------------------------
# Join Data (Python: tp_joindata, join_pairing, join_outputs, join_data)
# ---------------------------------------------------------------------------
# Port of utils/joinPairing.js and utils/joinData.js as JoinData.svelte wires them: every row
# of A and B on one time column, sorted by time, A's rows first at equal times. No matching
# or merging. Same-named value columns (trimmed, inner whitespace as one space, case ignored)
# share one output column unless `pairing` says otherwise.

MAX_JOIN_ROWS <- MAX_GRID_POINTS

.join_norm_name <- function(name) {
  if (is.null(name) || (length(name) == 1 && is.na(name))) name <- ""
  tolower(gsub("\\s+", " ", trimws(as.character(name)), perl = TRUE))
}

.join_ids <- function(v) {
  out <- integer(0)
  for (raw in as.list(if (is.null(v)) list() else v)) {
    n <- .js_number(raw)
    if (is.finite(n) && n == floor(n) && n >= 0 && !(n %in% out)) out <- c(out, as.integer(n))
  }
  out
}

join_pairing <- function(a_ids, b_ids, name_of, pairing = NULL) {
  pair_of <- list(); taken <- integer(0); decided <- integer(0); conflicts <- list()
  overrides <- if (is.list(pairing)) pairing else list()
  for (b in b_ids) {
    ov <- overrides[[as.character(b)]]
    if (is.null(ov)) next
    want <- .js_number(ov)
    if (want == -1) { decided <- c(decided, b); next }
    if (!(want %in% a_ids)) next
    decided <- c(decided, b)
    if (want %in% taken) {
      conflicts[[length(conflicts) + 1]] <- list(bId = b, aId = want, why = "taken"); next
    }
    pair_of[[as.character(b)]] <- as.integer(want)
    taken <- c(taken, as.integer(want))
  }
  for (b in b_ids) {
    if (b %in% decided) next
    key <- .join_norm_name(name_of(b))
    if (!nzchar(key)) next
    matches <- a_ids[vapply(a_ids, function(a) .join_norm_name(name_of(a)) == key, logical(1))]
    free <- matches[!(matches %in% taken)]
    if (length(free)) {
      pair_of[[as.character(b)]] <- free[1]
      taken <- c(taken, free[1])
    } else if (length(matches)) {
      conflicts[[length(conflicts) + 1]] <- list(bId = b, aId = matches[1], why = "taken")
    }
  }
  list(pair_of = pair_of, conflicts = conflicts)
}

join_outputs <- function(a_ids, b_ids, pair_of, name_of) {
  partner <- list()
  for (b in names(pair_of)) partner[[as.character(pair_of[[b]])]] <- as.integer(b)
  outs <- list()
  for (a in a_ids) {
    p <- partner[[as.character(a)]]
    outs[[length(outs) + 1]] <- list(key = paste0("joined_", a), aId = a, bId = p,
                                     label = trimws(as.character(name_of(a))), side = "A")
  }
  for (b in b_ids) {
    if (!is.null(pair_of[[as.character(b)]])) next
    outs[[length(outs) + 1]] <- list(key = paste0("joined_", b), aId = NULL, bId = b,
                                     label = trimws(as.character(name_of(b))), side = "B")
  }
  keys <- vapply(outs, function(o) .join_norm_name(o$label), character(1))
  for (i in seq_along(outs)) {
    paired <- !is.null(outs[[i]]$aId) && !is.null(outs[[i]]$bId)
    if (!paired && sum(keys == keys[i]) > 1)
      outs[[i]]$label <- paste0(outs[[i]]$label, " (", outs[[i]]$side, ")")
  }
  seen <- list()
  for (i in seq_along(outs)) {
    k <- .join_norm_name(outs[[i]]$label)
    n <- (if (is.null(seen[[k]])) 0 else seen[[k]]) + 1
    seen[[k]] <- n
    if (n > 1) outs[[i]]$label <- paste0(outs[[i]]$label, " ", n)
  }
  outs
}

join_time_kind <- function(type) {
  if (identical(type, "time")) return("time")
  if (!is.null(type) && type %in% c("number", "bin")) return("number")
  NULL
}

join_too_large_warning <- function(rows, max_rows = MAX_JOIN_ROWS) {
  if (!(rows > max_rows)) return(NULL)
  paste0("Nothing was joined: A and B together have ", .thousands(rows),
         " rows with a time, more than the limit of ", .thousands(max_rows),
         ". Bin or filter one of them first.")
}

.join_shift <- function(shift_b, kind) {
  s <- if (is.null(shift_b)) 0 else .js_number(shift_b)
  if (!is.finite(s) || s == 0) return(0)
  if (identical(kind, "time")) floor(s * 3600000 + 0.5) else s
}

.join_placed <- function(times, shift) {
  times <- as.list(times)
  n <- length(times)
  t <- rep(NA_real_, n)
  for (i in seq_len(n)) {
    if (.js_invalid(times[[i]])) next
    x <- .js_number(times[[i]]) + shift
    if (is.finite(x)) t[i] <- x
  }
  keep <- which(!is.na(t))
  idx <- keep[order(t[keep], keep)]
  list(idx = idx, t = t, dropped = n - length(keep))
}

join_data <- function(time_a, time_b, kind, data_of, type_of, outputs, shift_b = 0,
                      source_labels = c("A", "B"), max_rows = MAX_JOIN_ROWS) {
  A <- .join_placed(time_a, 0)
  B <- .join_placed(time_b, .join_shift(shift_b, kind))
  na <- length(A$idx); nb <- length(B$idx); rows <- na + nb
  counts <- list(rows = rows, fromA = na, fromB = nb, droppedA = A$dropped,
                 droppedB = B$dropped, sharedTimes = 0, sharedRows = 0)
  too_large <- join_too_large_warning(rows, max_rows)
  if (!is.null(too_large)) return(list(ok = FALSE, error = too_large, counts = counts))
  cell <- function(id, row) {
    d <- data_of[[as.character(id)]]
    if (is.null(d) || row > length(d)) return(NULL)
    v <- d[[row]]
    if (.cell_missing_rule(type_of[[as.character(id)]])(v)) NULL else v
  }
  time <- numeric(rows); source <- character(rows)
  columns <- lapply(outputs, function(o) vector("list", rows))
  names(columns) <- vapply(outputs, function(o) o$key, character(1))
  i <- 1; j <- 1
  for (r in seq_len(rows)) {
    take_a <- i <= na && (j > nb || A$t[A$idx[i]] <= B$t[B$idx[j]])
    if (take_a) {
      row <- A$idx[i]; i <- i + 1
      time[r] <- A$t[row]; source[r] <- source_labels[1]
      for (o in outputs) {
        v <- if (!is.null(o$aId)) cell(o$aId, row) else NULL
        if (!is.null(v)) columns[[o$key]][[r]] <- v
      }
    } else {
      row <- B$idx[j]; j <- j + 1
      time[r] <- B$t[row]; source[r] <- source_labels[2]
      for (o in outputs) {
        v <- if (!is.null(o$bId)) cell(o$bId, row) else NULL
        if (!is.null(v)) columns[[o$key]][[r]] <- v
      }
    }
  }
  ta <- table(A$t[A$idx]); tb <- table(B$t[B$idx])
  both <- intersect(names(ta), names(tb))
  counts$sharedTimes <- length(both)
  counts$sharedRows <- sum(as.integer(ta[both])) + sum(as.integer(tb[both]))
  rare <- na > 0 && nb > 0 && counts$sharedRows / rows < 0.1
  list(ok = rows > 0, error = NULL, time = time, source = source, columns = columns,
       counts = counts, rareShared = rare)
}

# A joined value column as R stores one: numbers with NA for blanks, else text with NA.
.join_as_column <- function(cells) {
  present <- !vapply(cells, is.null, logical(1))
  if (all(vapply(cells[present], is.numeric, logical(1)))) {
    out <- rep(NA_real_, length(cells))
    out[present] <- vapply(cells[present], as.numeric, numeric(1))
    return(out)
  }
  out <- rep(NA_character_, length(cells))
  out[present] <- vapply(cells[present], as.character, character(1))
  out
}

# Parity probe for the join row limit: allowed (1/0) and the warning ("" if none).
join_limit_probe <- function(unused, rows) {
  w <- join_too_large_warning(rows)
  list(allowed = if (is.null(w)) 1 else 0, warning = if (is.null(w)) "" else w)
}
# Registered here rather than in PURE_UTIL_MAP's literal, which is built before this section.
PURE_UTIL_MAP$join_limit_probe <- join_limit_probe

tp_joindata <- function(args, env) {
  clear <- function() {
    for (k in names(args$out)) {
      oid <- out_id(args, k)
      if (!is.null(oid) && oid != -1 && !is.null(env$cols[[as.character(oid)]]))
        set_col(env, env$cols, oid, numeric(0))
    }
    FALSE
  }
  a_t <- if (is.null(args$aTimeIN)) -1 else args$aTimeIN
  b_t <- if (is.null(args$bTimeIN)) -1 else args$bTimeIN
  if (a_t == -1 || b_t == -1) return(FALSE)
  col_a <- env$cols[[as.character(a_t)]]; col_b <- env$cols[[as.character(b_t)]]
  if (is.null(col_a) || is.null(col_b)) return(clear())
  ka <- join_time_kind(col_a$type); kb <- join_time_kind(col_b$type)
  if (is.null(ka) || is.null(kb) || ka != kb) {
    message("WARNING: Join Data: time A is ", col_a$type, " and time B is ", col_b$type,
            "; both must be times or both numbers.")
    return(clear())
  }
  a_ids <- .join_ids(args$aValuesIN); b_ids <- .join_ids(args$bValuesIN)
  if (any(a_ids %in% b_ids)) return(clear())
  name_of <- function(id) {
    c <- env$cols[[as.character(id)]]
    if (is.null(c) || is.null(c$name)) as.character(id) else c$name
  }
  baked <- args[["_resolvedPairs"]]
  if (is.list(baked)) {
    pair_of <- list()
    for (b in names(baked)) {
      bi <- as.integer(.js_number(b)); ai <- as.integer(.js_number(baked[[b]]))
      if (bi %in% b_ids && ai %in% a_ids) pair_of[[as.character(bi)]] <- ai
    }
  } else pair_of <- join_pairing(a_ids, b_ids, name_of, args$pairing)$pair_of
  outputs <- join_outputs(a_ids, b_ids, pair_of, name_of)
  labels <- unlist(args[["_sourceLabels"]], use.names = FALSE)
  if (length(labels) != 2) labels <- c("A", "B")
  data_of <- list(); type_of <- list()
  for (id in c(a_ids, b_ids)) {
    c <- env$cols[[as.character(id)]]
    data_of[[as.character(id)]] <- if (is.null(c)) list() else as.list(col_data(c, env$cols, env$raw_data))
    type_of[[as.character(id)]] <- if (is.null(c) || is.null(c$type)) "number" else c$type
  }
  res <- join_data(col_data(col_a, env$cols, env$raw_data), col_data(col_b, env$cols, env$raw_data),
                   ka, data_of, type_of, outputs, args$shiftB, labels)
  if (!is.null(res$error)) {
    message("WARNING: Join Data: ", res$error)
    return(clear())
  }
  t_id <- out_id(args, "jointime")
  set_col(env, env$cols, t_id, res$time, type = if (ka == "time") "time" else "number")
  if (ka == "time" && !is.null(env$cols[[as.character(t_id)]]))
    env$cols[[as.character(t_id)]]$time_format <- NULL
  for (o in outputs) {
    oid <- out_id(args, o$key)
    src <- env$cols[[as.character(if (!is.null(o$aId)) o$aId else o$bId)]]
    typ <- if (is.null(src) || is.null(src$type)) "number" else src$type
    set_col(env, env$cols, oid, .join_as_column(res$columns[[o$key]]), type = typ)
    if (typ == "time" && !is.null(env$cols[[as.character(oid)]]))
      env$cols[[as.character(oid)]]$time_format <- NULL
  }
  if (isTRUE(args$sourceColumn))
    set_col(env, env$cols, out_id(args, "source"), res$source, type = "category")
  isTRUE(res$ok)
}

# Analyses this runtime implements. Kept in step with R_IMPLEMENTED in
# src/lib/_parity/runtimeCoverage.js by a test, in BOTH directions, so the declared reach and
# the real reach cannot drift apart the way the Python port's did.
TABLE_PROCESS_MAP = list(
  averageprofile = tp_averageprofile,
  binneddata = tp_binneddata,
  blankcolumn = tp_blankcolumn,
  collectcolumns = tp_collectcolumns,
  columnfunctions = tp_columnfunctions,
  cosinor = tp_cosinor,
  describedata = tp_describedata,
  doublelogistic = tp_doublelogistic,
  fdrcorrection = tp_fdrcorrection,
  fitfunction = tp_fitfunction,
  formulacolumn = tp_formulacolumn,
  groupcomparison = tp_groupcomparison,
  chisquared = tp_chisquared,
  columnset = tp_columnset,
  circadianfunctionindex = tp_circadianfunctionindex,
  correlation = tp_correlation,
  crosscorrelation = tp_crosscorrelation,
  interpolate = tp_interpolate,
  joindata = tp_joindata,
  logisticregression = tp_logisticregression,
  longtowide = tp_longtowide,
  movinganalysis = tp_movinganalysis,
  nonparametricra = tp_nonparametricra,
  normalitytest = tp_normalitytest,
  rayleightest = tp_rayleightest,
  rhythmicityanalysis = tp_rhythmicityanalysis,
  rectangularwave = tp_rectangularwave,
  sequencecolumn = tp_sequencecolumn,
  smootheddata = tp_smootheddata,
  storedvaluegroup = tp_storedvaluegroup,
  surrogatetest = tp_surrogatetest,
  sort = tp_sort,
  split = tp_split,
  threshold = tp_threshold,
  trendfit = tp_trendfit,
  widetolong = tp_widetolong
)

# Column processes. Strict for the same reason analyses are: a column silently missing its
# transform is WRONG data, not partial data.
COLUMN_PROCESS_MAP = list(
  add = cp_add,
  editvalue = cp_editvalue,
  filterbyothercol = cp_filterbyothercol,
  frequencyfilter = cp_frequencyfilter,
  multiply = cp_multiply,
  normalize = cp_normalize,
  outlierremoval = cp_outlierremoval,
  removetrend = cp_removetrend,
  sub = cp_substitute,
  substitute = cp_substitute
)

run_column_process <- function(key, data, args, cols, raw_data) {
  fn <- COLUMN_PROCESS_MAP[[key]]
  if (is.null(fn)) {
    stop(sprintf(paste0("ancir: column process '%s' is not implemented by the R runtime. ",
                        "Re-export from AnCiR without it, or use the Python export."), key))
  }
  fn(data, args, cols, raw_data)
}

# STRICT by design. An analysis the R port does not implement ABORTS rather than being
# skipped: a script that quietly omits a step still writes a columns.csv, and a plausible
# file with a missing analysis is far more dangerous than no file. The export button refuses
# unsupported sessions up front, so reaching this error means the script was re-run after the
# runtime changed, or hand-edited.
run_table_process <- function(name, args, env) {
  key <- tolower(gsub(" ", "", name))
  fn <- TABLE_PROCESS_MAP[[key]]
  if (is.null(fn)) {
    stop(sprintf(paste0("ancir: analysis '%s' is not implemented by the R runtime.\n",
                        "  Implemented: %s\n",
                        "  Export this session as Python instead, which is complete."),
                 name, paste(sort(names(TABLE_PROCESS_MAP)), collapse = ", ")))
  }
  fn(args, env)
}

# ---------------------------------------------------------------------------
# Session plumbing
# ---------------------------------------------------------------------------
#
# A Column is a list, not an R5/S4 class: the exported script is meant to be readable by
# someone who wants to see what their analysis did, and a plain list prints usefully.
#
# `raw_data` is shared by reference through an environment so that a table process writing an
# output column is visible to every later one, which is how the Python port behaves and what
# the dependency-ordered pipeline relies on.

new_column <- function(id, name, type = "number", data = NULL, time_format = NULL,
                       bin_width = 1, compression = NULL, ref_id = NULL,
                       group_label = NULL, processes = list()) {
  list(id = id, name = name, type = type, data = data, time_format = time_format,
       bin_width = bin_width, compression = compression, ref_id = ref_id,
       group_label = group_label, processes = processes)
}

col_is_ref <- function(col) !is.null(col$ref_id)

# Translate the session's stored dayjs format into an R strptime format.
#
# The app stores a dayjs format string and parses STRICTLY against it. This port used to
# ignore it and walk a short tryFormats list, which is fine for unambiguous ISO-8601 and
# wrong for anything else: the app's own guesser returns BOTH candidates for an ambiguous
# day/month pair and asks the user to choose, so a session can legitimately carry
# DD/MM/YYYY. Re-guessing here then disagrees with the app by two months, silently, on data
# the user already disambiguated.
#
# Returns NULL when there is no format (epoch-ms columns, older sessions), leaving the
# caller on the tryFormats path it used before.
.strptime_from_dayjs <- function(fmt) {
  if (is.null(fmt) || !is.character(fmt) || !nzchar(fmt)) return(NULL)
  # Longest token first: MMMM must not be eaten by MM. %OS takes the seconds AND any
  # fractional part, so SSS is folded into it below rather than mapped separately.
  toks <- list(
    c("YYYY", "%Y"), c("YY", "%y"),
    c("MMMM", "%B"), c("MMM", "%b"), c("MM", "%m"), c("M", "%m"),
    c("DD", "%d"), c("D", "%d"),
    c("HH", "%H"), c("H", "%H"),
    c("hh", "%I"), c("h", "%I"),
    c("mm", "%M"), c("m", "%M"),
    c("ss", "%S"), c("s", "%S"),
    c("SSS", "%OS"),
    c("A", "%p"), c("a", "%p"),
    c("ZZ", "%z"), c("Z", "%z")
  )
  out <- character(0)
  i <- 1
  n <- nchar(fmt)
  while (i <= n) {
    ch <- substr(fmt, i, i)
    if (identical(ch, "[")) {
      end <- regexpr("]", substr(fmt, i, n), fixed = TRUE)
      if (end == -1) { out <- c(out, ch); i <- i + 1; next }
      out <- c(out, substr(fmt, i + 1, i + end - 2))
      i <- i + end
      next
    }
    matched <- FALSE
    for (t in toks) {
      if (identical(substr(fmt, i, i + nchar(t[1]) - 1), t[1])) {
        out <- c(out, t[2]); i <- i + nchar(t[1]); matched <- TRUE; break
      }
    }
    if (!matched) { out <- c(out, ch); i <- i + 1 }
  }
  res <- paste(out, collapse = "")
  # "%S.%OS" would demand the seconds twice; R's %OS already consumes "30.500".
  res <- gsub("%S.%OS", "%OS", res, fixed = TRUE)
  res
}

# Digit width each numeric dayjs token accepts in the JS engine. strptime's %H, %M, %S,
# %d and %m read one OR two digits, but the app parses with dayjs strict mode, where a
# double-width token (HH mm ss DD MM hh) needs exactly two digits and a single-width one
# (H m s D M h) takes one or two (parseTimeStrict in TimeUtils.js). Without this gate the
# port reads "9:30:00" under HH:mm:ss, which the app leaves blank. Tokens not listed
# (month names, meridiem, offsets) are not width-checked. Mirrors dayjs_width_pattern().
.dayjs_width_pattern <- function(fmt) {
  if (is.null(fmt) || !is.character(fmt) || !nzchar(fmt)) return(NULL)
  widths <- list(
    YYYY = "[0-9]{4}", YY = "[0-9]{2}",
    MMMM = ".+?", MMM = ".+?", MM = "[0-9]{2}", M = "[0-9]{1,2}",
    DD = "[0-9]{2}", D = "[0-9]{1,2}",
    HH = "[0-9]{2}", H = "[0-9]{1,2}",
    hh = "[0-9]{2}", h = "[0-9]{1,2}",
    mm = "[0-9]{2}", m = "[0-9]{1,2}",
    ss = "[0-9]{2}", s = "[0-9]{1,2}",
    SSS = "[0-9]{3}",
    A = ".+?", a = ".+?", ZZ = ".+?", Z = ".+?"
  )
  esc <- function(x) gsub("([][{}()+*^$|\\\\?.])", "\\\\\\1", x, perl = TRUE)
  out <- character(0)
  i <- 1
  n <- nchar(fmt)
  while (i <= n) {
    ch <- substr(fmt, i, i)
    if (identical(ch, "[")) {
      end <- regexpr("]", substr(fmt, i, n), fixed = TRUE)
      if (end != -1) {
        out <- c(out, esc(substr(fmt, i + 1, i + end - 2)))
        i <- i + end
        next
      }
    }
    matched <- FALSE
    for (t in names(widths)) {
      if (identical(substr(fmt, i, i + nchar(t) - 1), t)) {
        out <- c(out, widths[[t]]); i <- i + nchar(t); matched <- TRUE; break
      }
    }
    if (!matched) { out <- c(out, esc(ch)); i <- i + 1 }
  }
  paste0("^", paste(out, collapse = ""), "$")
}

.decompress <- function(col, raw) {
  # AWD records store a regular grid as {start, step, length} rather than every value.
  if (identical(col$compression, "awd") && is.list(raw) && !is.null(raw$start)) {
    return(raw$start + seq_len(as.integer(raw$length)) * raw$step - raw$step)
  }
  raw
}

# Values of a column, with referencing, decompression, time parsing, bin centring and any
# column processes applied — mirroring Column.get_data().
col_data <- function(col, cols, raw_data) {
  if (is.null(col)) return(list())
  if (col_is_ref(col)) {
    ref <- cols[[as.character(col$ref_id)]]
    return(if (is.null(ref)) list() else col_data(ref, cols, raw_data))
  }
  key <- as.character(col$data)
  raw <- if (!is.null(col$data) && !is.null(raw_data[[key]])) raw_data[[key]] else list()
  d <- .decompress(col, raw)
  if (identical(col$type, "time") && !identical(col$compression, "awd")) {
    v <- unlist(d, use.names = FALSE)
    # Already-numeric (UNIX ms, e.g. written by SimulatedData) is left alone; only strings
    # need parsing. as.POSIXct handles ISO 8601, which is what sessions store.
    if (length(v) && is.character(v)) {
      # Gaps must be excluded BEFORE parsing, not parsed and discarded after. An empty
      # string makes as.POSIXct ERROR ("character string is not in a standard unambiguous
      # format") rather than return NA — and an error is not a warning, so suppressWarnings
      # does not catch it and the whole generated script aborts. A blank cell is what a CSV
      # with a missing epoch looks like, i.e. the normal case for actigraphy, so this was an
      # abort on ordinary data. Plain NA parses fine; it is specifically "" that throws.
      # Gaps stay NA, matching the JS engine, which maps null/'' to null for the same reason.
      parsed <- rep(NA_real_, length(v))
      ok <- !is.na(v) & nzchar(v)
      # Values the app's strict parse rejects on digit width are gaps too.
      widths <- .dayjs_width_pattern(col$time_format)
      if (!is.null(widths)) ok <- ok & grepl(widths, v, perl = TRUE)
      if (any(ok)) {
        fmt <- .strptime_from_dayjs(col$time_format)
        p <- NULL
        if (!is.null(fmt)) {
          vv <- v[ok]
          # R's %z reads only "+0530": strip the colon from a "+05:30" offset and read a
          # trailing "Z" as "+0000" (STAT-16 zone-qualified imports).
          if (grepl("%z", fmt, fixed = TRUE)) {
            vv <- sub("([+-][0-9]{2}):([0-9]{2})$", "\\1\\2", vv, perl = TRUE)
            vv <- sub("Z$", "+0000", vv, perl = TRUE)
          }
          p <- suppressWarnings(as.POSIXct(vv, tz = "UTC", format = fmt))
          # All-NA means the translation was wrong, not that the data is bad; fall back
          # rather than return a column of NA.
          if (all(is.na(p))) p <- NULL
        }
        if (is.null(p)) {
          p <- suppressWarnings(as.POSIXct(v[ok], tz = "UTC",
                                           tryFormats = c("%Y-%m-%dT%H:%M:%OSZ",
                                                          "%Y-%m-%dT%H:%M:%OS",
                                                          "%Y-%m-%d %H:%M:%OS",
                                                          "%Y-%m-%d")))
        }
        parsed[ok] <- as.numeric(p) * 1000
      }
      d <- parsed
    }
  }
  if (identical(col$type, "bin")) {
    # getData reports bin CENTRES: start + binWidth / 2. A BinnedData cuts column carries
    # the app's null binWidth, which its arithmetic reads as 0, so it reports its starts.
    half <- if (!is.null(col$cuts_list)) 0 else col$bin_width / 2
    d <- unlist(d, use.names = FALSE) + half
  }
  for (entry in col$processes) {
    fname <- if (!is.null(entry$funcname)) entry$funcname else entry$name
    if (!is.null(fname)) {
      d <- run_column_process(tolower(gsub(" ", "", fname)), d, entry$args, cols, raw_data)
    }
  }
  d
}

# Hours since the column's own start. Time columns hold epoch ms; everything else is already
# in whatever unit the user chose, so only the offset is removed.
col_hours <- function(col, cols, raw_data) {
  d <- suppressWarnings(as.numeric(unlist(col_data(col, cols, raw_data), use.names = FALSE)))
  if (!length(d)) return(numeric(0))
  baseline <- min(d, na.rm = TRUE)
  if (identical(col$type, "time")) (d - baseline) / 3600000 else d - baseline
}

# x-axis values for a column: hours-since-start for time columns, raw otherwise.
t_for_col <- function(col, cols, raw_data) {
  if (is.null(col)) return(numeric(0))
  if (identical(col$type, "time")) col_hours(col, cols, raw_data)
  else suppressWarnings(as.numeric(unlist(col_data(col, cols, raw_data), use.names = FALSE)))
}

# args$out[[key]], tolerating the legacy {val: id} form.
out_id <- function(args, key) {
  o <- args$out
  if (is.null(o) || is.null(o[[key]])) return(-1)
  v <- o[[key]]
  if (is.list(v) && !is.null(v$val)) v$val else v
}

# Normalise yIN: scalar -> list(scalar), NULL/-1 -> empty, list -> list.
id_list <- function(y) {
  if (is.null(y)) return(integer(0))
  v <- unlist(y, use.names = FALSE)
  v <- v[!is.na(v) & v != -1]
  as.integer(v)
}

# Write values into raw_data (an environment, so later processes see them) and update meta.
set_col <- function(env, cols, id, values, type = NULL, time_format = NULL) {
  if (is.null(id) || id == -1) return(invisible(FALSE))
  env$raw_data[[as.character(id)]] <- values
  key <- as.character(id)
  if (!is.null(env$cols[[key]])) {
    env$cols[[key]]$data <- id
    env$cols[[key]]$compression <- NULL
    if (!is.null(type)) env$cols[[key]]$type <- type
    if (!is.null(time_format)) env$cols[[key]]$time_format <- time_format
  }
  invisible(TRUE)
}

# ---------------------------------------------------------------------------
# Trend fitting
# ---------------------------------------------------------------------------

# Ordinary least squares via qr.solve, which is what np.polyfit and linear_regression reduce
# to. Returned coefficients are ASCENDING in power, matching the Python's `coeffs`.
linear_regression <- function(x, y) {
  ok <- is.finite(x) & is.finite(y)
  x <- x[ok]; y <- y[ok]
  n <- length(x)
  if (n < 2) return(list(slope = NA_real_, intercept = NA_real_,
                         rmse = NA_real_, rSquared = NA_real_))
  fit <- qr.solve(cbind(1, x), y)
  pred <- fit[1] + fit[2] * x
  rss <- sum((y - pred)^2)
  ss_tot <- sum((y - mean(y))^2)
  list(slope = fit[2], intercept = fit[1],
       rmse = sqrt(rss / n),
       rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0)
}

fit_trend <- function(x, y, model = "linear", poly_degree = 2) {
  xa <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ya <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  ok <- is.finite(xa) & is.finite(ya)
  xa <- xa[ok]; ya <- ya[ok]
  if (!length(xa)) return(NULL)
  fin <- function(pred) {
    rss <- sum((ya - pred)^2)
    ss_tot <- sum((ya - mean(ya))^2)
    list(rmse = sqrt(rss / length(xa)),
         rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0)
  }
  if (identical(model, "linear")) {
    reg <- linear_regression(xa, ya)
    pred <- reg$slope * xa + reg$intercept
    return(list(parameters = list(slope = reg$slope, intercept = reg$intercept),
                fitted = pred, rmse = reg$rmse, rSquared = reg$rSquared))
  }
  if (identical(model, "exponential")) {
    reg <- linear_regression(xa, log(ya))
    a <- exp(reg$intercept); b <- reg$slope
    pred <- a * exp(b * xa); m <- fin(pred)
    return(list(parameters = list(a = a, b = b), fitted = pred,
                rmse = m$rmse, rSquared = m$rSquared))
  }
  if (identical(model, "logarithmic")) {
    reg <- linear_regression(log(xa), ya)
    a <- reg$intercept; b <- reg$slope
    pred <- a + b * log(xa); m <- fin(pred)
    return(list(parameters = list(a = a, b = b), fitted = pred,
                rmse = m$rmse, rSquared = m$rSquared))
  }
  if (identical(model, "polynomial")) {
    deg <- as.integer(poly_degree)
    des <- outer(xa, 0:deg, `^`)
    coeffs <- qr.solve(des, ya)          # ascending powers, as the Python stores them
    pred <- as.vector(des %*% coeffs); m <- fin(pred)
    return(list(parameters = list(coeffs = coeffs), fitted = pred,
                rmse = m$rmse, rSquared = m$rSquared))
  }
  NULL
}

evaluate_trend_at_points <- function(parameters, model, x_points) {
  xa <- suppressWarnings(as.numeric(unlist(x_points, use.names = FALSE)))
  if (identical(model, "linear")) return(parameters$slope * xa + parameters$intercept)
  if (identical(model, "exponential")) return(parameters$a * exp(parameters$b * xa))
  if (identical(model, "logarithmic")) return(parameters$a + parameters$b * log(xa))
  if (identical(model, "polynomial")) {
    co <- unlist(parameters$coeffs, use.names = FALSE)
    return(as.vector(outer(xa, seq_along(co) - 1, `^`) %*% co))
  }
  rep(NA_real_, length(xa))
}

# ---------------------------------------------------------------------------
# Smoothing
# ---------------------------------------------------------------------------

# smoothing.js movingAverage, exactly: a centred window of floor(window / 2) each side,
# clipped at the ends; missing values (house rule) skipped. "weighted" weights a neighbour
# max(0, window - distance), "exponential" exp(-distance / (window / 3)). A window with
# nothing usable keeps the input value.
moving_average <- function(y, window = 5, type = "simple") {
  y <- as.list(y)
  n <- length(y)
  out <- vapply(y, function(v) if (is.null(v) || length(v) != 1) NA_real_
                else suppressWarnings(as.numeric(v)), numeric(1))
  half <- floor(window / 2)
  res <- out
  for (i in seq_len(n)) {
    total <- 0; count <- 0; wsum <- 0
    for (j in max(1, i - half):min(n, i + half)) {
      if (.js_invalid(y[[j]])) next
      yj <- .js_number(y[[j]])
      d <- abs(i - j)
      if (identical(type, "simple")) { total <- total + yj; count <- count + 1 }
      else if (identical(type, "weighted")) {
        w <- max(0, window - d); total <- total + yj * w; wsum <- wsum + w
      } else if (identical(type, "exponential")) {
        w <- exp(-d / (window / 3)); total <- total + yj * w; wsum <- wsum + w
      }
    }
    res[i] <- if (identical(type, "simple")) { if (count > 0) total / count else out[i] }
              else if (wsum > 0) total / wsum else out[i]
  }
  res
}

# Whittaker-Eilers: minimise ||y - z||^2 + lambda * ||D_order z||^2, the system the JS solves
# by banded Cholesky, solved densely here. Fewer than 3 points, or no more than `order`,
# are returned unchanged (smoothing.js whittakerEilers).
whittaker_eilers <- function(y, lambda = 100, order = 2) {
  v <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(v)
  if (n < 3 || n <= order) return(v)
  d <- diag(n)
  for (k in seq_len(order)) d <- diff(d)
  as.vector(solve(diag(n) + lambda * crossprod(d), v))
}

# smoothing.js savitzkyGolay: the polynomial's centre weights on every FULL window; the first
# and last floor(window / 2) points stay as they are, and a window longer than the series
# leaves it untouched. An even window grows by one.
savitzky_golay <- function(y, window = 5, poly_order = 2) {
  v <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(v)
  if (window %% 2 == 0) window <- window + 1
  half <- window %/% 2
  if (n - half <= half) return(v)
  z <- -half:half
  des <- outer(z, 0:poly_order, `^`)
  wts <- tryCatch(solve(crossprod(des), t(des))[1, ], error = function(e) rep(NaN, window))
  out <- v
  for (i in (half + 1):(n - half)) out[i] <- sum(wts * v[(i - half):(i + half)])
  out
}

# smoothing.js loess, step for step: h = max(floor(bandwidth * n), 1) nearest points (ties in
# index order), tricube weights on distance / max distance, a weighted straight line, or the
# weighted mean when the line is degenerate.
loess_smooth <- function(x, y, bandwidth = 0.3) {
  xs <- as.numeric(x); ys <- as.numeric(y)
  n <- length(xs)
  h <- max(floor(bandwidth * n), 1)
  out <- numeric(n)
  for (i in seq_len(n)) {
    d <- abs(xs[i] - xs)
    nb <- order(d, method = "radix")[seq_len(h)]   # radix is stable: ties keep index order
    max_d <- d[nb[h]]
    u <- d[nb] / (if (max_d == 0) 1 else max_d)
    w <- ifelse(u >= 1, 0, (1 - u^3)^3)
    sw <- sum(w); swx <- sum(w * xs[nb]); swy <- sum(w * ys[nb])
    swxx <- sum(w * xs[nb] * xs[nb]); swxy <- sum(w * xs[nb] * ys[nb])
    den <- sw * swxx - swx * swx
    out[i] <- if (abs(den) < 1e-10) swy / sw else {
      slope <- (sw * swxy - swx * swy) / den
      slope * xs[i] + (swy - slope * swx) / sw
    }
  }
  out
}

# smoothing.js smoothArrays with the JS option names and `?? default` defaults; an unknown
# smoother type is the moving average.
smooth_arrays <- function(x_vals, y_vals, smoother_type, options = list()) {
  g <- function(k, d) if (!is.null(options[[k]])) options[[k]] else d
  st <- if (is.null(smoother_type)) "moving" else smoother_type
  y <- if (identical(st, "whittaker"))
         whittaker_eilers(y_vals, g("whittakerLambda", 100), g("whittakerOrder", 2))
       else if (identical(st, "savitzky"))
         savitzky_golay(y_vals, g("savitzkyWindowSize", 5), g("savitzkyPolyOrder", 2))
       else if (identical(st, "loess")) loess_smooth(x_vals, y_vals, g("loessBandwidth", 0.3))
       else moving_average(y_vals, g("movingAvgWindowSize", 5), g("movingAvgType", "simple"))
  list(x = x_vals, y = y)
}

# ======================================================================================
# Actogram marker rules (plan docs/plans/2026-09-30-actogram-marker-rules-and-outputs.md,
# Phase B2). A one-for-one port of the pure JS modules the app computes a rule's five output
# ports from, mirroring the Python port function for function:
#
#   plots/Actogram/onsetUnwrap.js      find_centile_value, find_best_match_index,
#                                      match_template_markers, marker_absolute_times,
#                                      unwrap_onsets, wrap_phase_to_row
#   plots/Actogram/markerSelection.js  fit_day_range, is_day_selected, selection_mask,
#                                      is_outside_fit_range
#   plots/Actogram/lineFit.js          fit_line (all four lock combinations)
#   plots/Actogram/harmonicCheck.js    harmonic_check (over this runtime's lomb_scargle)
#   plotbits/helpers/wrangleData.js    kahan_linear_regression (the app's linearRegression)
#   plots/plotMetricDefs.js            rule_output_values
#
# plus the row folding at the plot's startTime (Actogram.svelte), a rule's cfg adapter
# (markerRules.svelte.js ruleCfg) and a block's deriveds (PhaseMarker.svelte). The
# `actogramMarkers` parity fixtures compare every intermediate, not only the outputs.
#
# JS semantics reproduced on purpose: `%` is a remainder with the sign of the dividend
# (.js_mod, not R's %% which takes the divisor's sign), Math.round rounds half up
# (js_round), `x || d` treats 0 and NaN as missing, sorts are stable, and the sums JS
# compensates (KahanSum) are compensated here. R is 1-indexed; every row index below is
# kept 0-based, as in JS, and shifted only where a vector is subscripted.
# ======================================================================================

.js_mod <- function(a, b) {
  r <- a %% b
  if (is.finite(a) && a < 0 && r != 0) r - b else r
}

.is_fin <- function(v) is.numeric(v) && length(v) == 1 && !is.na(v) && is.finite(v)

# JS Number(v) for one cell: a double, NaN where JS gives NaN. Strings follow JS syntax, not
# R's: "0x10" is 16 and "Infinity" is Inf, while "inf", "1_000" and "TRUE" are NaN (R's
# as.numeric reads "inf" and "infinity" as Inf). NULL is 0 as in JS; callers apply the house
# rule (.js_invalid) first, which treats it as missing.
.js_number <- function(v) {
  if (is.null(v)) return(0)
  if (is.list(v)) v <- if (length(v) == 1) v[[1]] else return(NaN)
  if (length(v) != 1) return(NaN)
  if (is.logical(v)) return(if (is.na(v)) NaN else if (v) 1 else 0)
  if (is.numeric(v)) return(if (is.na(v)) NaN else as.numeric(v))
  if (!is.character(v) || is.na(v)) return(NaN)
  t <- .js_trim(v)
  if (!nzchar(t)) return(0)
  if (t %in% c("Infinity", "+Infinity")) return(Inf)
  if (t == "-Infinity") return(-Inf)
  if (grepl("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?$", t, perl = TRUE))
    return(as.numeric(t))
  if (grepl("^0[xXoObB][0-9A-Za-z]+$", t, perl = TRUE)) {
    base <- switch(tolower(substr(t, 2, 2)), x = 16, o = 8, b = 2)
    vals <- match(strsplit(tolower(substr(t, 3, nchar(t))), "")[[1]],
                  c(as.character(0:9), letters)) - 1
    if (anyNA(vals) || any(vals >= base)) return(NaN)
    out <- 0
    for (d in vals) out <- out * base + d
    return(out)
  }
  NaN
}

# stats.js isInvalidValue (the house rule) on one value: NULL/NA, a blank or whitespace-only
# string, or NaN after JS Number() coercion. Logicals and +-Inf are NOT invalid.
.js_invalid <- function(v) {
  if (is.null(v)) return(TRUE)
  if (is.list(v)) v <- if (length(v) == 1) v[[1]] else return(TRUE)
  if (is.null(v) || length(v) != 1) return(TRUE)
  if (is.character(v) && !is.na(v) && !nzchar(.js_trim(v))) return(TRUE)
  is.nan(.js_number(v))
}

# The present values of a column as numbers (JS presentNumbers): house rule, then Number().
.present_numbers <- function(values) {
  vals <- as.list(values)
  keep <- !vapply(vals, .js_invalid, logical(1))
  vapply(vals[keep], .js_number, numeric(1))
}

# KahanSum as utils/numerics.js has it: a closure over (sum, c), no NaN skipping.
.kahan <- function() {
  s <- 0; cc <- 0
  list(add = function(v) { y <- v - cc; t <- s + y; cc <<- t - s - y; s <<- t },
       value = function() s)
}

# JS division: x / 0 is +-Inf and 0 / 0 is NaN. R already does this for doubles.
kahan_linear_regression <- function(x, y) {
  n <- length(x)
  if (n != length(y) || n == 0) stop("Input arrays must have the same non-zero length")
  kx <- .kahan(); ky <- .kahan(); kxy <- .kahan(); kxx <- .kahan()
  for (i in seq_len(n)) {
    kx$add(x[i]); ky$add(y[i]); kxy$add(x[i] * y[i]); kxx$add(x[i] * x[i])
  }
  sx <- kx$value(); sy <- ky$value(); sxy <- kxy$value(); sxx <- kxx$value()
  slope <- (n * sxy - sx * sy) / (n * sxx - sx * sx)
  intercept <- (sy - slope * sx) / n
  kt <- .kahan(); kr <- .kahan()
  mean_y <- sy / n
  for (i in seq_len(n)) {
    kt$add((y[i] - mean_y)^2)
    kr$add((y[i] - (slope * x[i] + intercept))^2)
  }
  list(slope = slope, intercept = intercept, rSquared = 1 - kr$value() / kt$value(),
       rmse = sqrt(kr$value() / n))
}

# --- onsetUnwrap.js: template matching ---------------------------------------------------

# The value at the centile of the non-zero, non-NaN values; NULL when there is none (JS
# `undefined`, against which every comparison is false).
find_centile_value <- function(data, centile) {
  f <- data[!is.na(data) & data != 0]
  s <- sort(f, method = "radix")
  idx <- ceiling((centile / 100) * length(s)) - 1
  if (idx >= 0 && idx < length(s)) s[idx + 1] else NULL
}

# 0-based start index of the best (strictly highest) cross-correlation, or -1.
find_best_match_index <- function(test, template) {
  best_idx <- -1; best <- -Inf
  last <- length(test) - length(template)
  if (last < 0) return(-1)
  for (i in 0:last) {
    corr <- 0
    for (j in seq_along(template)) corr <- corr + test[i + j] * template[j]
    if (corr > best) { best <- corr; best_idx <- i }
  }
  best_idx
}

# One detection per actogram row. x_by_period / y_by_period are lists keyed by the 0-based
# row as a string. Returns list(hours, times), NaN = none.
match_template_markers <- function(x_by_period, y_by_period, period_hrs, bin_size, hrs_before,
                                   hrs_after, centile, type) {
  N <- js_round(hrs_before / bin_size)
  M <- js_round(hrs_after / bin_size)
  template <- c(rep(if (identical(type, "onset")) -1 else 1, max(0, N)),
                rep(if (identical(type, "onset")) 1 else -1, max(0, M)))
  keys <- as.numeric(names(x_by_period))
  if (!length(keys)) return(list(hours = numeric(0), times = numeric(0)))
  max_period <- max(keys)
  hours <- numeric(0); times <- numeric(0)
  for (i in 0:max_period) {
    yi <- y_by_period[[as.character(i)]]
    if (is.null(yi) || !length(yi)) { hours <- c(hours, NaN); times <- c(times, NaN); next }
    yn <- y_by_period[[as.character(i + 1)]]
    if (!is.null(yn) && length(yn)) {
      data <- c(yi, yn)
      xs <- c(x_by_period[[as.character(i)]], x_by_period[[as.character(i + 1)]])
    } else {
      data <- yi
      xs <- x_by_period[[as.character(i)]]
    }
    cv <- find_centile_value(data, centile)
    above_below <- vapply(data, function(v) {
      if (is.na(v) || (!is.null(cv) && v <= cv)) -1 else 1
    }, numeric(1))
    # The new state starts at template start + N (onsetUnwrap.js, FIT-6).
    best <- find_best_match_index(above_below, template) + N
    if (best >= 0 && best < length(xs)) {
      t <- xs[best + 1]
      raw <- t - i * period_hrs
      raw <- .js_mod(.js_mod(raw, period_hrs) + period_hrs, period_hrs)
      hours <- c(hours, raw); times <- c(times, t)
    } else {
      hours <- c(hours, NaN); times <- c(times, NaN)
    }
  }
  list(hours = hours, times = times)
}

# Absolute time of each row's marker: the detection's own time, else i * P + hour.
marker_absolute_times <- function(markers, period_hrs, times = NULL) {
  out <- numeric(length(markers))
  for (k in seq_along(markers)) {
    i <- k - 1
    t <- if (!is.null(times) && k <= length(times)) times[k] else NA
    h <- markers[k]
    out[k] <- if (!is.na(t) && is.finite(t)) t
              else if (!is.na(h) && is.finite(h)) i * period_hrs + h
              else NaN
  }
  out
}

# --- onsetUnwrap.js: unwrapping ----------------------------------------------------------

.wrap_half <- function(v, P) v - P * floor(v / P + 0.5)

.median_js <- function(a) {
  if (!length(a)) return(NaN)
  s <- sort(a, method = "radix")
  m <- length(s) %/% 2
  if (length(s) %% 2 == 1) s[m + 1] else (s[m] + s[m + 1]) / 2
}

.plain_mean <- function(v) {
  acc <- 0
  for (x in v) acc <- acc + x
  acc / length(v)
}

.seed_tau <- function(rows, ts, P) {
  o <- order(rows, method = "radix")
  r <- rows[o]; t <- ts[o]
  adjacent <- numeric(0); spaced <- numeric(0)
  if (length(r) >= 2) for (j in 2:length(r)) {
    g <- r[j] - r[j - 1]
    if (g < 1) next
    change <- .wrap_half(t[j] - t[j - 1] - g * P, P)
    if (g == 1) adjacent <- c(adjacent, change / g) else spaced <- c(spaced, change / g)
  }
  changes <- if (length(adjacent) >= 2) adjacent else c(adjacent, spaced)
  drift <- .median_js(changes)
  tau <- P + (if (is.finite(drift)) drift else 0)
  if (tau > 0) tau else P
}

.number_cycles <- function(sorted_t, sorted_rows, tau) {
  groups <- list(list(k = 0, ts = sorted_t[1], rows = sorted_rows[1]))
  ambiguous <- 0
  if (length(sorted_t) >= 2) for (j in 2:length(sorted_t)) {
    last <- groups[[length(groups)]]
    prev_t <- .plain_mean(last$ts)
    ratio <- (sorted_t[j] - prev_t) / tau
    n <- js_round(ratio)
    if (abs(ratio - n) > 0.25) ambiguous <- ambiguous + 1
    if (n <= 0) {
      last$ts <- c(last$ts, sorted_t[j]); last$rows <- c(last$rows, sorted_rows[j])
      groups[[length(groups)]] <- last
    } else {
      groups[[length(groups) + 1]] <- list(k = last$k + n, ts = sorted_t[j], rows = sorted_rows[j])
    }
  }
  list(groups = groups, ambiguous = ambiguous)
}

# Unwrap the selected per-row marker times into fit points whose slope is tau.
# xs = 1-indexed UNWRAPPED rows, ys = absolute time + P.
unwrap_onsets <- function(times, period_hrs, selected = NULL) {
  P <- period_hrs
  rows <- numeric(0); ts <- numeric(0)
  for (k in seq_along(times)) {
    sel <- if (!is.null(selected) && k <= length(selected)) selected[k] else NA
    if (!is.na(sel) && !isTRUE(as.logical(sel))) next
    t <- times[k]
    if (is.na(t) || !is.finite(t)) next
    rows <- c(rows, k - 1); ts <- c(ts, t)
  }
  if (!length(ts) || !(P > 0)) {
    return(list(xs = numeric(0), ys = numeric(0), n = 0, nDetections = length(ts),
                nMerged = 0, nAmbiguous = 0, seedTau = NaN))
  }
  o <- order(ts, method = "radix")
  st <- ts[o]; sr <- rows[o]
  tau <- .seed_tau(rows, ts, P)
  result <- NULL; prev_key <- ""
  for (pass in 1:5) {
    nc <- .number_cycles(st, sr, tau)
    groups <- nc$groups
    first_t <- .plain_mean(groups[[1]]$ts)
    x0 <- floor(first_t / P) + 1
    xs <- vapply(groups, function(g) x0 + g$k, numeric(1))
    ys <- vapply(groups, function(g) .plain_mean(g$ts) + P, numeric(1))
    result <- list(xs = xs, ys = ys, n = length(groups), nDetections = length(ts),
                   nMerged = length(ts) - length(groups), nAmbiguous = nc$ambiguous,
                   seedTau = tau)
    key <- paste(vapply(groups, function(g) format(g$k, scientific = FALSE), ""), collapse = ",")
    if (identical(key, prev_key) || length(xs) < 2) break
    prev_key <- key
    fitted <- kahan_linear_regression(xs, ys)$slope
    if (!is.finite(fitted) || fitted <= 0) break
    tau <- fitted
  }
  result
}

# The line's time of day in [0, P) in a row, from its unwrapped position there.
wrap_phase_to_row <- function(hour, tau, period_hrs) {
  if (is.null(hour) || is.na(hour) || !is.finite(hour)) return(NaN)
  period <- if (!is.null(tau) && !is.na(tau) && is.finite(tau) && tau > 0) tau else period_hrs
  v <- hour - period * floor(hour / period)
  if (v >= period_hrs) v <- v - period_hrs
  v
}

# --- markerSelection.js ------------------------------------------------------------------

fit_day_range <- function(line_min_day = NULL, line_max_day = NULL) {
  lo <- if (.is_fin(line_min_day)) max(1, line_min_day) else 1
  hi <- if (.is_fin(line_max_day)) line_max_day else Inf
  list(lo = lo, hi = hi)
}

# Whether 0-based row i enters the fit: ticked (missing = ticked) AND, when the range scopes
# the fit, inside lineMinDay..lineMaxDay.
is_day_selected <- function(i, selected_periods, range_scopes_fit = FALSE,
                            line_min_day = NULL, line_max_day = NULL) {
  v <- if (!is.null(selected_periods) && i + 1 <= length(selected_periods))
    selected_periods[[i + 1]] else NULL
  if (!is.null(v) && !is.na(v) && !isTRUE(as.logical(v))) return(FALSE)
  if (!isTRUE(range_scopes_fit)) return(TRUE)
  r <- fit_day_range(line_min_day, line_max_day)
  day <- i + 1
  day >= r$lo && day <= r$hi
}

selection_mask <- function(n, selected_periods, range_scopes_fit = FALSE,
                           line_min_day = NULL, line_max_day = NULL) {
  n <- max(0, as.integer(n))
  vapply(seq_len(n) - 1, function(i) is_day_selected(i, selected_periods, range_scopes_fit,
                                                     line_min_day, line_max_day), logical(1))
}

is_outside_fit_range <- function(i, range_scopes_fit = FALSE, line_min_day = NULL,
                                 line_max_day = NULL) {
  if (!isTRUE(range_scopes_fit)) return(FALSE)
  r <- fit_day_range(line_min_day, line_max_day)
  day <- i + 1
  day < r$lo || day > r$hi
}

# --- lineFit.js ---------------------------------------------------------------------------

# The marker line with tau (slope) and theta (time of day at ref_day) each fitted (NULL) or
# fixed. R2/RMSE are of the line as drawn against the markers, NA with no markers.
fit_line <- function(xs, ys, tau = NULL, theta = NULL, ref_day = 1, period_hrs = 24) {
  if (length(xs) != length(ys)) stop("fit_line: x and y must be arrays of the same length")
  n <- length(xs)
  tau_fixed <- .is_fin(tau)
  theta_fixed <- .is_fin(theta)
  x0 <- ref_day
  y0 <- (if (theta_fixed) theta else 0) + period_hrs * ref_day
  if (!tau_fixed && !theta_fixed) {
    if (n == 0) { slope <- NaN; intercept <- NaN }
    else { reg <- kahan_linear_regression(xs, ys); slope <- reg$slope; intercept <- reg$intercept }
  } else if (tau_fixed && !theta_fixed) {
    slope <- tau
    if (n == 0) intercept <- NaN
    else {
      k <- .kahan()
      for (i in seq_len(n)) k$add(ys[i] - slope * xs[i])
      intercept <- k$value() / n
    }
  } else if (!tau_fixed && theta_fixed) {
    num <- 0; den <- 0
    for (i in seq_len(n)) {
      dx <- xs[i] - x0
      num <- num + dx * (ys[i] - y0)
      den <- den + dx * dx
    }
    slope <- if (den == 0) NaN else num / den
    intercept <- y0 - slope * x0
  } else {
    slope <- tau
    intercept <- y0 - slope * x0
  }
  r2 <- NA_real_; rmse <- NA_real_
  if (n > 0 && is.finite(slope) && is.finite(intercept)) {
    # R2 in the TIME-OF-DAY frame (lineFit.js, FIT-4): SS_tot is the spread of
    # z = y - period_hrs * x about its mean; NA when z does not vary. RMSE unchanged.
    kz <- .kahan()
    for (i in seq_len(n)) kz$add(ys[i] - period_hrs * xs[i])
    mean_z <- kz$value() / n
    kt <- .kahan(); kr <- .kahan()
    for (i in seq_len(n)) {
      kt$add((ys[i] - period_hrs * xs[i] - mean_z)^2)
      kr$add((ys[i] - (slope * xs[i] + intercept))^2)
    }
    r2 <- if (kt$value() > 0) 1 - kr$value() / kt$value() else NA_real_
    rmse <- sqrt(kr$value() / n)
  }
  list(slope = slope, intercept = intercept, rSquared = r2, rmse = rmse, n = n)
}

# --- harmonicCheck.js ---------------------------------------------------------------------

# One single-period Lomb-Scargle evaluation as runPeriodogramCalculation returns it for
# periodMin = periodMax = period: numeric(0) when the JS gives NaN (fewer than two raw
# samples, stripped), else the power. Pairs are filtered with the app's validPairs rule and a
# degenerate series (no pairs, zero or undefined variance) scores 0, as
# calculateLombScarglePower does, before this runtime's lomb_scargle is called.
.harmonic_power <- function(x_data, y_data, period) {
  if (length(x_data) < 2 || length(y_data) < 2 || length(x_data) != length(y_data)) {
    return(numeric(0))
  }
  ok <- !is.na(x_data) & !is.na(y_data)
  tt <- x_data[ok]; yy <- y_data[ok]
  if (length(tt) < 2) return(0)
  m <- .plain_mean(yy)
  v <- sum((yy - m)^2) / (length(yy) - 1)
  if (!(v > 0)) return(0)
  p <- lomb_scargle(tt, yy, period)[1]
  if (is.finite(p)) p else 0
}

# tau, tau/2 and 2 tau, each scored by one Lomb-Scargle evaluation of the series; the
# strongest wins, ties keeping the earlier candidate. Candidates must satisfy
# bin*2 < period < span/2 with span = last PRESENT sample minus first (sample order) and
# bin = bin_size or 0.25. NULL when there is no tau, no data or no candidate.
harmonic_check <- function(x_data, y_data, bin_size, tau) {
  if (is.null(tau) || is.na(tau) || tau == 0) return(NULL)
  if (!length(x_data) || !length(y_data)) return(NULL)
  bin <- if (!is.null(bin_size) && !is.na(bin_size) && bin_size != 0) bin_size else 0.25
  # First and last PRESENT samples. The app used to read a missing end as 0 (JS
  # `null - x0`), which made a missing LAST time a span of about 0 and dropped every
  # candidate; this port copied that. Both now skip a missing end (harmonicCheck.js).
  present <- which(!is.na(suppressWarnings(as.numeric(x_data))))
  span <- if (length(present)) {
    as.numeric(x_data[present[length(present)]]) - as.numeric(x_data[present[1]])
  } else NaN
  cands <- list(list(label = "τ", period = tau),
                list(label = "τ/2", period = tau / 2),
                list(label = "2τ", period = tau * 2))
  keep <- vapply(cands, function(c) isTRUE(c$period > bin * 2 && c$period < span / 2), logical(1))
  cands <- cands[keep]
  if (!length(cands)) return(NULL)
  results <- lapply(cands, function(c) {
    p <- .harmonic_power(x_data, y_data, c$period)
    list(label = c$label, period = c$period, peakPeriod = c$period,
         power = if (length(p)) p else 0)
  })
  # Eligibility (harmonicCheck.js, matching the Python port): tau always; tau/2 only when the
  # half-cycle F test at L = tau is NOT significant; 2 tau only when the test at 2 tau IS.
  for (i in seq_along(results)) {
    c <- results[[i]]
    if (identical(c$label, "τ")) { results[[i]]$eligible <- TRUE; next }
    L <- if (identical(c$label, "τ/2")) tau else 2 * tau
    tst <- half_cycle_test(x_data, y_data, L, bin)
    pv <- if (is.null(tst)) NA_real_ else tst$pValue
    results[[i]]$eligible <- is.finite(pv) &&
      (if (identical(c$label, "τ/2")) pv >= 0.05 else pv < 0.05)
    results[[i]]$testF <- if (is.null(tst)) NULL else tst$F
    results[[i]]$testP <- if (is.null(tst)) NULL else tst$pValue
  }
  pick <- function(lst) {
    b <- lst[[1]]
    if (length(lst) >= 2) for (r in lst[-1]) if (r$power > b$power) b <- r
    b
  }
  elig <- Filter(function(r) isTRUE(r$eligible), results)
  strongest <- if (length(elig)) pick(elig)
               else list(label = "τ", period = tau, peakPeriod = tau, power = NaN)
  list(candidates = results, strongest = strongest, powerStrongest = pick(results))
}

# harmonicCheck.js halfCycleTest (see the Python port): odd harmonics of a period-L rhythm.
half_cycle_test <- function(x_data, y_data, L, bin_size) {
  pr <- .pgram_pairs(x_data, y_data)
  H <- max(1, min(3, floor(L / (4 * (if (is.null(bin_size) || bin_size == 0) 0.25 else bin_size)))))
  n <- length(pr$t); df1 <- 2 * H; df2 <- n - 1 - 4 * H
  if (!(df2 > 0)) return(NULL)
  full <- fit_cosinor_fixed(pr$t, pr$y, L, 2 * H)
  red <- fit_cosinor_fixed(pr$t, pr$y, L / 2, H)
  if (is.null(full) || is.null(red)) return(NULL)
  rf <- full$RMSE^2 * df2; rr <- red$RMSE^2 * (n - 1 - 2 * H)
  if (!is.finite(rf) || !is.finite(rr)) return(NULL)
  F <- if (rf > 0) max(0, rr - rf) / df1 / (rf / df2) else if (rr > 0) Inf else 0
  p <- if (is.infinite(F)) 0 else pf(F, df1, df2, lower.tail = FALSE)
  list(period = L, harmonics = 2 * H, F = F, df1 = df1, df2 = df2, pValue = p)
}

# --- Actogram.svelte: the row folding -----------------------------------------------------

# The plot's startTime (epoch ms): the earliest sample over ALL time-typed series with valid
# x and y, snapped to the start of its day in the display zone ('utc' or an IANA zone).
actogram_start_time <- function(series_list, zone = "utc") {
  min_time <- Inf
  for (s in series_list) {
    if (!identical(s$xType, "time")) next
    xd <- s$x; yd <- s$y
    if (!length(xd) || !length(yd)) next
    n <- min(length(xd), length(yd))
    for (i in seq_len(n)) {
      if (is.na(xd[i]) || is.na(yd[i])) next
      if (xd[i] < min_time) min_time <- xd[i]
    }
  }
  if (!is.finite(min_time)) min_time <- 0
  if (is.null(zone) || tolower(zone) == "utc") return(floor(min_time / 86400000) * 86400000)
  lt <- as.POSIXlt(min_time / 1000, origin = "1970-01-01", tz = zone)
  midnight <- as.POSIXct(format(lt, "%Y-%m-%d"), tz = zone)
  round(as.numeric(midnight) * 1000)
}

# Column.hoursSinceStart: minus the smallest valid value (/ 3.6e6 for time), NA kept.
actogram_hours_since_start <- function(x, x_type) {
  if (!length(x) || all(is.na(x))) return(numeric(0))
  base <- min(x, na.rm = TRUE)
  if (identical(x_type, "time")) (x - base) / 3600000 else x - base
}

# ActogramDataclass.binSize: (last - first) / (last_idx - first_idx) over valid hours.
actogram_bin_size <- function(hours) {
  if (length(hours) <= 1) return(0)
  ok <- which(!is.na(hours))
  if (!length(ok) || ok[length(ok)] == ok[1]) return(0)
  f <- ok[1]; l <- ok[length(ok)]
  (hours[l] - hours[f]) / (l - f)
}

# One series folded into rows as ActogramDataclass.dataByDays does it.
# `x` is the column's values (bin CENTRES for a 'bin' column); a 'bin' column also needs its
# raw first bin start and its originTime_ms, which place its rows:
# -rawBinStart0 + (startTime - (originTime_ms ?? startTime)) / 3.6e6.
actogram_series_frame <- function(x, y, x_type, start_time, period_hrs, raw_bin_start0 = NULL,
                                  origin_time_ms = NULL) {
  hss <- actogram_hours_since_start(x, x_type)
  xmin <- if (length(x) && !all(is.na(x))) min(x, na.rm = TRUE) else 0
  offset <- if (identical(x_type, "time")) {
    (start_time - xmin) / 3600000
  } else if (identical(x_type, "bin")) {
    origin <- if (is.null(origin_time_ms)) start_time else origin_time_ms
    -(if (is.null(raw_bin_start0)) 0 else raw_bin_start0) + (start_time - origin) / 3600000
  } else {
    -xmin
  }
  x_by <- list(); y_by <- list()
  for (i in seq_along(hss)) {
    tx <- hss[i]
    ty <- if (i <= length(y)) y[i] else NA
    if (is.na(tx) || is.na(ty)) next
    p <- floor((tx - offset) / period_hrs)
    if (p < 0) next
    key <- as.character(p)
    x_by[[key]] <- c(x_by[[key]], tx - offset)
    y_by[[key]] <- c(y_by[[key]], ty)
  }
  list(hoursSinceStart = hss, y = y, binSize = actogram_bin_size(hss), offset = offset,
       xByPeriod = x_by, yByPeriod = y_by)
}

actogram_ndays <- function(frames) {
  max_period <- -1
  for (f in frames) {
    k <- as.numeric(names(f$xByPeriod))
    if (length(k)) max_period <- max(max_period, k)
  }
  if (max_period < 0 || max_period + 1 > 20000) 0 else max_period + 1
}

# --- markerRules.svelte.js / PhaseMarker.svelte: a block's settings ----------------------

# JS `v || d`: NULL, FALSE, "", 0 and NaN fall back.
.js_or <- function(v, d) {
  if (is.null(v) || length(v) == 0) return(d)
  if (is.logical(v) && !isTRUE(v)) return(d)
  if (is.character(v) && !nzchar(v)) return(d)
  if (is.numeric(v) && (is.na(v) || v == 0)) return(d)
  v
}

.num_or_null <- function(v) if (.is_fin(v)) v else NULL

# MarkerRule's constructor guards on a saved rule (markerRules.svelte.js).
marker_rule_from_json <- function(j) {
  finite_or <- function(v, d) if (.is_fin(v)) v else d
  positive_or <- function(v, d) if (.is_fin(v) && v > 0) v else d
  day_or_null <- function(v) if (.is_fin(v) && v >= 1) js_round(v) else NULL
  lock_or <- function(v, d) if (!is.null(v) && v %in% c("fit", "fixed")) v else d
  list(
    id = j$id,
    type = if (!is.null(j$type) && j$type %in% c("onset", "offset", "manual")) j$type else "onset",
    templateHrsBefore = finite_or(j$templateHrsBefore, 3),
    templateHrsAfter = finite_or(j$templateHrsAfter, 3),
    centileThreshold = finite_or(j$centileThreshold, 50),
    lockTau = lock_or(j$lockTau, "fit"),
    lockTheta = lock_or(j$lockTheta, "fit"),
    fixedTau = positive_or(j$fixedTau, NULL),
    fixedTheta = .num_or_null(j$fixedTheta),
    phaseRefDay = day_or_null(j$phaseRefDay),
    lineMinDay = day_or_null(j$lineMinDay),
    lineMaxDay = day_or_null(j$lineMaxDay)
  )
}

# PhaseMarkerClass's constructor defaults on a saved own block (its `||` defaults differ from
# a rule's on purpose: a block's centile 0 reads as 50).
marker_block_from_json <- function(j) {
  legacy <- identical(j$type, "fitline")
  lock_default <- if (legacy) "fixed" else "fit"
  list(
    type = if (legacy) "manual" else .js_or(j$type, "onset"),
    centileThreshold = .js_or(j$centileThreshold, 50),
    templateHrsBefore = .js_or(j$templateHrsBefore, 3),
    templateHrsAfter = .js_or(j$templateHrsAfter, 3),
    fitSlope = j$fitSlope, fitIntercept = j$fitIntercept,
    lockTau = if (!is.null(j$lockTau)) j$lockTau else lock_default,
    lockTheta = if (!is.null(j$lockTheta)) j$lockTheta else lock_default,
    lineMinDay = j$lineMinDay, lineMaxDay = j$lineMaxDay, phaseRefDay = j$phaseRefDay,
    fitWithinRange = isTRUE(j$fitWithinRange)
  )
}

# PhaseMarkerClass.fitRefDay: phaseRefDay ?? lineMinDay ?? 1, clamped to 1..Ndays.
.fit_ref_day <- function(cfg, n_days) {
  nd <- max(1, n_days)
  raw <- if (!is.null(cfg$phaseRefDay)) cfg$phaseRefDay
         else if (!is.null(cfg$lineMinDay)) cfg$lineMinDay else 1
  min(max(1, raw), nd)
}

# markerRules.svelte.js ruleCfg: a rule seen as a block's settings. The fixed pair is
# re-encoded as (fitSlope, fitIntercept) with intercept = theta - (tau - P) * refDay; tau
# defaults to P when only theta is fixed. The range always scopes the fit (Decision 1a).
marker_rule_cfg <- function(rule, period_hrs, n_days) {
  r <- marker_rule_from_json(rule)
  cfg <- r[c("type", "templateHrsBefore", "templateHrsAfter", "centileThreshold",
             "lockTau", "lockTheta")]
  cfg$phaseRefDay <- r$phaseRefDay
  cfg$lineMinDay <- r$lineMinDay
  cfg$lineMaxDay <- r$lineMaxDay
  cfg$fitWithinRange <- TRUE
  P <- period_hrs
  cfg$fitSlope <- if (!is.null(r$fixedTau)) r$fixedTau else if (!is.null(r$fixedTheta)) P else NULL
  if (!is.null(r$fixedTheta)) {
    slope <- if (!is.null(r$fixedTau)) r$fixedTau else P
    cfg$fitIntercept <- r$fixedTheta - (slope - P) * .fit_ref_day(cfg, n_days)
  }
  cfg
}

# A series' per-rule data as ruleDataFromJSON reads it (Actogram.svelte).
.rule_store <- function(series, rule_id) {
  e <- series$ruleData[[rule_id]]
  if (is.null(e) || !is.list(e)) return(list(selectedPeriods = list(), manualMarkers = numeric(0)))
  sp <- if (is.list(e$selectedPeriods) || is.logical(e$selectedPeriods))
    lapply(e$selectedPeriods, function(v) !identical(v, FALSE)) else list()
  mm <- as_numeric_list(e$manualMarkers)
  list(selectedPeriods = sp, manualMarkers = mm[is.finite(mm)])
}

as_numeric_list <- function(v) {
  if (is.null(v)) return(numeric(0))
  vapply(v, function(e) if (is.null(e) || !is.numeric(e)) NA_real_ else as.numeric(e), numeric(1))
}

# An own block's per-series data as its constructor reads it (PhaseMarker.svelte).
.block_store <- function(j, frame) {
  if (is.list(j$selectedPeriods) || is.logical(j$selectedPeriods)) {
    sp <- as.list(j$selectedPeriods)
  } else if (!is.null(j$periodRangeMin) && !is.null(j$periodRangeMax)) {
    k <- as.numeric(names(frame$xByPeriod))
    n <- if (length(k)) max(k) + 1 else 0
    if (n > 20000) n <- 0
    sp <- lapply(seq_len(n), function(d) d >= j$periodRangeMin && d <= j$periodRangeMax)
  } else sp <- list()
  mm <- if (identical(j$type, "fitline")) numeric(0) else as_numeric_list(j$manualMarkers)
  list(selectedPeriods = sp, manualMarkers = mm)
}

# PhaseMarkerClass.markers for a 'manual' block: hand-placed absolute times grouped by row
# (the LAST point in a row wins), hour = time % P with JS remainder semantics.
.manual_markers_by_row <- function(manual, period_hrs) {
  rows <- numeric(0); hrs <- numeric(0)
  for (t in manual) {
    row <- floor(t / period_hrs)
    k <- match(row, rows)
    if (is.na(k)) { rows <- c(rows, row); hrs <- c(hrs, .js_mod(t, period_hrs)) }
    else hrs[k] <- .js_mod(t, period_hrs)
  }
  max_row <- max(c(-1, rows))
  if (max_row < 0) return(numeric(0))
  vapply(0:max_row, function(i) { k <- match(i, rows); if (is.na(k)) NaN else hrs[k] },
         numeric(1))
}

# Everything PhaseMarkerClass derives for one block (own block or rule instance) on one
# series: detections, absolute times, the fit selection, the unwrap, the line, the phase and
# the harmonic check.
marker_block_compute <- function(cfg, store, frame, period_hrs, n_days) {
  P <- period_hrs
  if (identical(cfg$type, "manual")) {
    markers <- .manual_markers_by_row(store$manualMarkers, P)
    times <- NULL
  } else {
    tm <- match_template_markers(frame$xByPeriod, frame$yByPeriod, P, frame$binSize,
                                 cfg$templateHrsBefore, cfg$templateHrsAfter,
                                 cfg$centileThreshold, cfg$type)
    markers <- tm$hours
    times <- if (cfg$type %in% c("onset", "offset")) tm$times else NULL
  }
  marker_times <- marker_absolute_times(markers, P, times)
  rsf <- isTRUE(cfg$fitWithinRange)
  mask <- selection_mask(length(markers), store$selectedPeriods, rsf, cfg$lineMinDay,
                         cfg$lineMaxDay)
  unwrap <- unwrap_onsets(marker_times, P, mask)
  ref_day <- .fit_ref_day(cfg, n_days)
  fs <- cfg$fitSlope; fi <- cfg$fitIntercept
  theta_value <- if (is.null(fs) || is.null(fi)) NULL else (fs - P) * ref_day + fi
  res <- fit_line(unwrap$xs, unwrap$ys,
                  tau = if (identical(cfg$lockTau, "fixed")) fs else NULL,
                  theta = if (identical(cfg$lockTheta, "fixed")) theta_value else NULL,
                  ref_day = ref_day, period_hrs = P)
  reg <- if (is.finite(res$slope) && is.finite(res$intercept)) res else NULL
  phase <- NA_real_
  if (!is.null(reg) && reg$slope != 0) {
    phase <- wrap_phase_to_row(reg$slope * ref_day + reg$intercept - ref_day * P, reg$slope, P)
  }
  hc <- harmonic_check(frame$hoursSinceStart, frame$y, frame$binSize,
                       if (is.null(reg)) NULL else reg$slope)
  list(
    markerHours = markers,
    markerTimes = marker_times,
    selectedMask = mask,
    outsideRange = vapply(seq_along(markers) - 1, function(i)
      is_outside_fit_range(i, rsf, cfg$lineMinDay, cfg$lineMaxDay), logical(1)),
    unwrap = unwrap,
    refDay = ref_day,
    fitSlope = if (is.null(fs)) NA_real_ else fs,
    fitIntercept = if (is.null(fi)) NA_real_ else fi,
    regression = reg,
    phase = phase,
    harmonic = if (is.null(hc)) NULL else list(candidates = hc$candidates,
                                                strongest = hc$strongest$label,
                                                powerStrongest = hc$powerStrongest$label),
    .harmonicPick = if (is.null(hc)) NA_real_ else hc$strongest$peakPeriod
  )
}

# plotMetricDefs.js ruleOutputValues: a block's five port values. tau is the harmonic pick;
# tau/phi/r2/rmse are NaN with no valid line (r2/rmse also with no markers to compare
# against); n is always the count of fitted markers; no block at all is five NaNs.
rule_output_values <- function(block) {
  if (is.null(block)) return(list(tau = NaN, phi = NaN, r2 = NaN, rmse = NaN, n = NaN))
  reg <- block$regression
  ok <- !is.null(reg)
  list(tau = if (ok) block$.harmonicPick else NaN,
       phi = if (ok) block$phase else NaN,
       r2 = if (ok) reg$rSquared else NaN,
       rmse = if (ok) reg$rmse else NaN,
       n = length(block$unwrap$xs))
}

# The five outputs one marker rule gives one series, exactly as the app's `r<id>_*` ports
# carry them. `rule` is MarkerRule.toJSON's shape; `series` the series' saved JSON (ruleData,
# detachedRules, phaseMarkers); `frame` that series folded at the plot's startTime
# (actogram_series_frame). A series detached from the rule reports its own block carrying
# `fromRule`; a detached series with no such block reports five NaNs. details = TRUE adds
# every intermediate and where the block came from (`source`).
actogram_marker_rule_outputs <- function(rule, series, frame, period_hrs = 24, n_days = NULL,
                                         details = FALSE) {
  if (is.null(n_days)) n_days <- actogram_ndays(list(frame))
  rid <- rule$id
  detached <- rid %in% unlist(series$detachedRules)
  block <- NULL; source <- "none"
  if (!detached) {
    block <- marker_block_compute(marker_rule_cfg(rule, period_hrs, n_days),
                                  .rule_store(series, rid), frame, period_hrs, n_days)
    source <- "instance"
  } else {
    for (bj in series$phaseMarkers) {
      if (is.list(bj) && identical(bj$fromRule, rid)) {
        block <- marker_block_compute(marker_block_from_json(bj), .block_store(bj, frame),
                                      frame, period_hrs, n_days)
        source <- "detached"
        break
      }
    }
  }
  out <- rule_output_values(block)
  if (!details) return(out)
  d <- if (is.null(block)) list() else block[setdiff(names(block), ".harmonicPick")]
  c(list(source = source, outputs = out), d)
}

# Every marker rule's outputs for a whole actogram, as the app's metric columns carry them:
# list(startTime, Ndays, series = [list(binSize, rules = list(<id> = details))],
# columns = list(r1_tau = one value per series, ...)). `inner` is the actogram's saved inner
# JSON; `series_data[[i]]` is list(xType, x, y) with x the column's values (epoch ms for a
# time column, hours otherwise).
actogram_plot_rule_outputs <- function(inner, series_data, zone = "utc") {
  P <- if (!is.null(inner$periodHrs)) inner$periodHrs else 24
  sd <- lapply(series_data, function(s) list(xType = s$xType,
                                             x = as_numeric_list(s$x), y = as_numeric_list(s$y),
                                             rawBinStart0 = s$rawBinStart0,
                                             originTime_ms = s$originTime_ms))
  start <- actogram_start_time(sd, zone)
  frames <- lapply(sd, function(s) actogram_series_frame(s$x, s$y, s$xType, start, P,
                                                         s$rawBinStart0, s$originTime_ms))
  n_days <- actogram_ndays(frames)
  rules <- inner$markerRules
  datas <- inner$data
  columns <- list()
  for (r in rules) for (sfx in c("tau", "phi", "r2", "rmse", "n")) {
    columns[[paste0(r$id, "_", sfx)]] <- numeric(0)
  }
  out_series <- list()
  for (i in seq_along(frames)) {
    sj <- if (i <= length(datas)) datas[[i]] else list()
    per <- list()
    for (r in rules) {
      det <- actogram_marker_rule_outputs(r, sj, frames[[i]], P, n_days, details = TRUE)
      per[[r$id]] <- det
      for (sfx in names(det$outputs)) {
        key <- paste0(r$id, "_", sfx)
        columns[[key]] <- c(columns[[key]], det$outputs[[sfx]])
      }
    }
    out_series[[i]] <- list(binSize = frames[[i]]$binSize, rules = per)
  }
  list(startTime = start, Ndays = n_days, series = out_series, columns = columns)
}
