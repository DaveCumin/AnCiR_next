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
shapiro_wilk <- function(values) {
  x <- clean_numeric(values)
  n <- length(x)
  if (n < 3 || length(unique(x)) < 2) {
    return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  }
  res <- tryCatch(shapiro.test(x), error = function(e) NULL)
  if (is.null(res)) return(list(statistic = NA_real_, pvalue = NA_real_, n = n))
  list(statistic = unname(res$statistic), pvalue = unname(res$p.value), n = n)
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
  res <- suppressWarnings(cor.test(p$x, p$y,
                                   method = if (method == "spearman") "spearman" else "pearson"))
  list(r = unname(res$estimate), pvalue = unname(res$p.value), n = n)
}

# ---------------------------------------------------------------------------
# Multiple comparisons
# ---------------------------------------------------------------------------

# Non-finite entries are EXCLUDED from n and returned as NA: a test that failed to run must
# not tighten the correction applied to the ones that did.
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
    if (length(v) != 1 || !is.finite(v)) next
    keep_i <- c(keep_i, i); keep_v <- c(keep_v, min(1, max(0, v)))
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

# Multi-start free-period cosine fit. Mirrors fit_cosine_curves: same seed frequencies, same
# bounds, same "keep the lowest cost" rule, so the two land in the same basin.
fit_cosine_curves <- function(t, x, n_curves = 1) {
  ok <- is.finite(t) & is.finite(x)
  t <- as.numeric(t)[ok]; x <- as.numeric(x)[ok]
  if (length(t) < 4 * n_curves) return(NULL)

  cost <- function(p) 0.5 * sum(.cos_resid(p, t, x)^2)
  grad <- function(p) as.vector(crossprod(.cos_jac(p, t), .cos_resid(p, t, x)))

  timespan <- if (t[length(t)] > t[1]) t[length(t)] - t[1] else 1
  # numpy's std is the population form; sd() is the sample form, hence the rescale.
  span_amp <- sd(x) * sqrt((length(x) - 1) / length(x))
  best <- NULL
  for (fs in c(1 / 24, 1 / 12, 1 / 6, 1 / max(timespan, 1))) {
    p0 <- c(); lb <- c(); ub <- c()
    for (i in seq_len(n_curves)) {
      p0 <- c(p0, span_amp / max(1, n_curves), fs * i, 0)
      lb <- c(lb, -Inf, 0.001, -Inf); ub <- c(ub, Inf, 100, Inf)
    }
    p0 <- c(p0, mean(x)); lb <- c(lb, -Inf); ub <- c(ub, Inf)
    fit <- tryCatch(
      optim(p0, cost, grad, method = "L-BFGS-B", lower = lb, upper = ub,
            control = list(factr = 1, pgtol = 0, maxit = 5000)),
      error = function(e) NULL)
    if (!is.null(fit) && (is.null(best) || fit$value < best$value)) best <- fit
  }
  if (is.null(best)) return(NULL)

  p <- best$par
  pred <- .cos_resid(p, t, x) + x
  rss <- sum((x - pred)^2)
  ss_tot <- sum((x - mean(x))^2)
  cosines <- lapply(seq_len(n_curves), function(i) {
    list(amplitude = abs(p[3 * (i - 1) + 1]),
         frequency = p[3 * (i - 1) + 2],
         phase = p[3 * (i - 1) + 3])
  })
  list(parameters = list(A = 0, cosines = cosines, O = p[length(p)]),
       fitted = pred, residuals = x - pred,
       rmse = sqrt(rss / length(t)),
       rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0,
       rss = rss)
}

# ---------------------------------------------------------------------------
# Parity entry point
# ---------------------------------------------------------------------------

# Pure kernels the parity harness can call by name, keyed by the fixture's `rFunc` (which
# sits beside the existing `pyFunc`, so both legs read one fixture file).
#
# Referenced directly rather than wrapped in adapters: the fixtures already describe how to
# build the call — `argRefs`/`valuesRef` name the inputs and `pyArgs`/`rArgs` supply the rest
# — so the harness assembles positional arguments the same way for every kernel. Per-kernel
# adapters would be a second, hand-maintained copy of that contract, and would drift.
PURE_UTIL_MAP <- list(
  describe_stats = describe_stats,
  jarque_bera    = jarque_bera,
  d_agostino     = d_agostino,
  shapiro_wilk   = shapiro_wilk,
  correlate      = correlate,
  p_adjust       = p_adjust
)

# Session-level analyses (table processes) this runtime implements.
#
# EMPTY ON PURPOSE, and it must stay honest. The pure kernels above are the shared numeric
# foundation every table process sits on, and they are what the parity fixtures actually
# exercise (43 of 68), so they are ported and verified first. Wiring a table process needs
# the Column/session plumbing as well, which is the next piece of work.
#
# Listing a key here that has no implementation behind it would pass the coverage guard
# while doing nothing — exactly the silent-gap failure that let the Python port fall eight
# analyses behind. The guard in runtimeCoverage.test.js checks this list against
# R_IMPLEMENTED in both directions for that reason.
TABLE_PROCESS_MAP = list()
