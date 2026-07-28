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
      # Seed amplitude and phase by SOLVING for them at this frequency: with w fixed the
      # model is linear in (B cos o, B sin o) and the offset, so the best pair has a closed
      # form. Seeding phase at 0 instead leaves the starting cosine anti-correlated whenever
      # the true acrophase is far from 0, and an optimiser can then shrink the AMPLITUDE
      # toward zero rather than rotate the phase. The Python port did exactly that and
      # returned amplitude 3.3 against a true 38; this seeding is what fixed it, and both
      # ports now seed identically so neither can drift into that basin.
      w <- fs * i
      th <- 2 * pi * w * t
      design <- cbind(1, cos(th), sin(th))
      coef <- tryCatch(qr.solve(design, x), error = function(e) NULL)
      if (is.null(coef)) {
        amp0 <- span_amp / max(1, n_curves); pha0 <- 0
      } else {
        amp0 <- sqrt(coef[2]^2 + coef[3]^2)
        pha0 <- atan2(-coef[3], coef[2])
      }
      p0 <- c(p0, amp0, w, pha0)
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

tp_trendfit <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  model <- if (is.null(args$model)) "linear" else args$model
  deg <- as.integer(if (is.null(args$polyDegree)) 2 else args$polyDegree)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  output_x_id <- if (is.null(args$outputX)) -1 else args$outputX
  output_x <- NULL
  if (output_x_id != -1 && !is.null(env$cols[[as.character(output_x_id)]])) {
    output_x <- t_for_col(env$cols[[as.character(output_x_id)]], env$cols, env$raw_data)
  }
  xs <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    ys_raw <- col_data(env$cols[[yk]], env$cols, env$raw_data)
    res <- fit_trend(t, ys_raw, model, deg)
    if (is.null(res)) next
    if (is.null(xs)) {
      # The JS evaluates the fit at the FINITE input t, not on a dense grid.
      xs <- if (!is.null(output_x)) output_x else t[is.finite(t)]
      set_col(env, env$cols, out_id(args, "trendx"), xs, type = "number")
    }
    yy <- evaluate_trend_at_points(res$parameters, model, xs)
    y_out <- out_id(args, paste0("trendy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "trendy")
    set_col(env, env$cols, y_out, yy, type = "number")
    any_valid <- TRUE
  }
  any_valid
}

tp_smootheddata <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  smoother <- if (!is.null(args$smootherType)) args$smootherType
              else if (!is.null(args$smoother)) args$smoother else "whittaker"
  x_col <- env$cols[[as.character(x_in)]]
  x_data <- t_for_col(x_col, env$cols, env$raw_data)
  sx <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    r <- smooth_arrays(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data), smoother, args)
    if (is.null(sx)) {
      sx <- r$x
      set_col(env, env$cols, out_id(args, "smoothedx"), r$x,
              type = x_col$type, time_format = x_col$time_format)
    }
    y_out <- out_id(args, paste0("smoothedy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "smoothedy")
    set_col(env, env$cols, y_out, r$y, type = "number")
    any_valid <- TRUE
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

cp_add <- function(x, args, cols, raw_data) {
  v <- as.numeric(if (is.null(args$value)) 0 else args$value)
  vapply(x, function(xi) {
    n <- suppressWarnings(as.numeric(xi))
    if (length(n) != 1 || is.na(n)) NA_real_ else n + v
  }, numeric(1), USE.NAMES = FALSE)
}

cp_multiply <- function(x, args, cols, raw_data) {
  v <- as.numeric(if (is.null(args$value)) 1 else args$value)
  vapply(x, function(xi) {
    n <- suppressWarnings(as.numeric(xi))
    if (length(n) != 1 || is.na(n)) NA_real_ else n * v
  }, numeric(1), USE.NAMES = FALSE)
}

# "Substitute", not "subtract" — the JS registry key `Sub` is find-and-replace. Guessing
# subtraction here would silently corrupt every column that used it.
cp_substitute <- function(x, args, cols, raw_data) {
  find <- args$find; replace <- args$replace
  lapply(x, function(xi) if (identical(xi, find)) replace else xi)
}

cp_normalize <- function(x, args, cols, raw_data) {
  method <- if (is.null(args$method)) "z-score" else args$method
  arr <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ok <- is.finite(arr)
  if (!any(ok)) return(arr)
  sub <- arr[ok]
  out_sub <- switch(method,
    "z-score" = {
      # numpy std(ddof = 0) is the POPULATION sd; R's sd() is the sample one.
      s <- sqrt(sum((sub - mean(sub))^2) / length(sub))
      (sub - mean(sub)) / (if (s > 0) s else 1)
    },
    "min-max" = {
      lo <- min(sub); hi <- max(sub)
      (sub - lo) / (if (hi > lo) hi - lo else 1)
    },
    "robust" = {
      med <- median(sub)
      mad <- median(abs(sub - med))
      (sub - med) / (if (mad != 0) mad else 1)
    },
    "unit-vector" = {
      nrm <- sqrt(sum(sub * sub))
      sub / (if (nrm != 0) nrm else 1)
    },
    sub)
  arr[ok] <- out_sub
  arr
}

cp_removetrend <- function(x, args, cols, raw_data) {
  x_col_id <- if (is.null(args$xColId)) -1 else args$xColId
  x_col <- if (x_col_id != -1) cols[[as.character(x_col_id)]] else NULL
  t <- if (!is.null(x_col)) t_for_col(x_col, cols, raw_data) else seq_along(x) - 1
  y <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ok <- is.finite(t) & is.finite(y)
  if (sum(ok) < 2) return(y)
  fit <- fit_trend(t[ok], y[ok], if (is.null(args$model)) "linear" else args$model,
                   as.integer(if (is.null(args$polyDegree)) 2 else args$polyDegree))
  if (is.null(fit)) return(y)
  out <- y
  out[ok] <- y[ok] - fit$fitted
  out
}

# ---------------------------------------------------------------------------
# Binning
# ---------------------------------------------------------------------------

# Port of plotbits/helpers/wrangleData.js::binData. The loop pushes the bin and THEN checks
# the end condition, so there is always one trailing bin past the last datum — matching the
# JS exactly rather than the more obvious pre-check, which would drop it.
bin_data <- function(x_values, y_values, bin_size, bin_start = 0, step_size = NULL,
                     agg_func = "mean") {
  if (is.null(step_size)) step_size <- bin_size
  xa <- suppressWarnings(as.numeric(unlist(x_values, use.names = FALSE)))
  ya <- suppressWarnings(as.numeric(unlist(y_values, use.names = FALSE)))
  ok <- is.finite(xa) & is.finite(ya)
  xa <- xa[ok]; ya <- ya[ok]
  if (!length(xa)) return(list(bins = numeric(0), y_out = numeric(0)))
  end <- max(xa)
  bins <- c(); y_out <- c(); cur <- bin_start
  repeat {
    in_bin <- ya[xa >= cur & xa < cur + bin_size]
    v <- if (!length(in_bin)) NA_real_ else switch(agg_func,
      min = min(in_bin), max = max(in_bin), median = median(in_bin),
      # numpy std(ddof = 0): population, not sample.
      stddev = sqrt(sum((in_bin - mean(in_bin))^2) / length(in_bin)),
      mean(in_bin))
    bins <- c(bins, cur); y_out <- c(y_out, v)
    if (cur >= end) break
    cur <- cur + step_size
  }
  list(bins = bins, y_out = y_out)
}

tp_binneddata <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  bin_size <- as.numeric(if (is.null(args$binSize)) 1 else args$binSize)
  bin_start <- as.numeric(if (is.null(args$binStart)) 0 else args$binStart)
  step <- as.numeric(if (is.null(args$stepSize)) bin_size else args$stepSize)
  agg <- if (is.null(args$aggFunc)) "mean" else args$aggFunc
  x_col <- env$cols[[as.character(x_in)]]
  x_data <- t_for_col(x_col, env$cols, env$raw_data)
  bins_x <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    b <- bin_data(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                  bin_size, bin_start, step, agg)
    if (is.null(bins_x)) {
      # The JS emits bin CENTRES (start + binSize/2), not bin starts.
      bins_x <- b$bins + bin_size / 2
      set_col(env, env$cols, out_id(args, "binnedx"), bins_x,
              type = x_col$type, time_format = x_col$time_format)
    }
    y_out <- out_id(args, paste0("binnedy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "binnedy")
    set_col(env, env$cols, y_out, b$y_out, type = "number")
    any_valid <- TRUE
  }
  any_valid
}

# ---------------------------------------------------------------------------
# Cosinor (Halberg fixed-period)
# ---------------------------------------------------------------------------

# Fixed-period cosinor is LINEAR in its parameters: regress on cos/sin of each harmonic and
# solve by least squares. No optimiser, and no risk of landing in a different basin from the
# other ports — unlike the free-period fit, which is why that one needed the analytic
# Jacobian treatment.
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
  ss_tot <- sum((y - mean(y))^2)
  r2 <- if (ss_tot > 0) 1 - rss / ss_tot else 0
  cov <- tryCatch(mse * solve(crossprod(X)), error = function(e) matrix(0, p, p))
  M <- beta[1]
  se_m <- sqrt(max(cov[1, 1], 0))
  tcrit <- qt(1 - alpha / 2, df_resid)
  harmonics <- list()
  for (k in seq_len(n_harmonics)) {
    ib <- 1 + 2 * (k - 1) + 1
    ig <- ib + 1
    b <- beta[ib]; g <- beta[ig]
    amp <- sqrt(b^2 + g^2)
    phi <- atan2(-g, b)                      # JS: atan2(-gamma, beta)
    acro <- (-phi / (k * omega)) %% (period / k)
    var_b <- max(cov[ib, ib], 0); var_g <- max(cov[ig, ig], 0); cov_bg <- cov[ib, ig]
    se_a <- if (amp > 0) sqrt(max((b^2 * var_b + g^2 * var_g + 2 * b * g * cov_bg) / amp^2, 0)) else 0
    den <- b^2 + g^2
    se_phi <- if (den > 0) sqrt(max((g^2 * var_b + b^2 * var_g - 2 * b * g * cov_bg) / den^2, 0)) else 0
    se_acro <- se_phi / (k * omega)
    harmonics[[k]] <- list(k = k, beta = b, gamma = g, amplitude = amp,
                           acrophase_hrs = acro, phi_rad = phi,
                           SE_A = se_a, SE_acrophase_hrs = se_acro,
                           CI_A = c(amp - tcrit * se_a, amp + tcrit * se_a),
                           CI_acrophase = c(acro - tcrit * se_acro, acro + tcrit * se_acro))
  }
  df1 <- p - 1
  f_stat <- if (rss > 0) ((ss_tot - rss) / df1) / (rss / df_resid) else Inf
  pf_val <- if (is.finite(f_stat)) pf(f_stat, df1, df_resid, lower.tail = FALSE) else 0
  list(M = M, SE_M = se_m, CI_M = c(M - tcrit * se_m, M + tcrit * se_m),
       harmonics = harmonics, F_stat = f_stat, df = c(df1, df_resid), pF = pf_val,
       R2 = r2, RMSE = rmse, fitted = fitted, n = n,
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

tp_cosinor <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  n_curves <- as.integer(if (is.null(args$Ncurves)) 0 else args$Ncurves)
  use_fixed <- isTRUE(args$useFixedPeriod)
  fixed_period <- as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
  n_h <- as.integer(if (is.null(args$nHarmonics)) 1 else args$nHarmonics)
  alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
  output_x_id <- if (is.null(args$outputX)) -1 else args$outputX
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)

  output_x <- NULL
  if (output_x_id != -1 && !is.null(env$cols[[as.character(output_x_id)]])) {
    ox <- t_for_col(env$cols[[as.character(output_x_id)]], env$cols, env$raw_data)
    output_x <- ox[is.finite(ox)]
  }

  any_valid <- FALSE; first_x <- NULL
  mesor <- c(); acro <- c()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) { mesor <- c(mesor, NA_real_); acro <- c(acro, NA_real_); next }
    y <- suppressWarnings(as.numeric(unlist(col_data(env$cols[[yk]], env$cols, env$raw_data),
                                            use.names = FALSE)))
    ok <- is.finite(t) & is.finite(y)
    tt <- t[ok]; yy <- y[ok]
    res <- if (use_fixed || n_curves == 0) {
      fit_cosinor_fixed(tt, yy, fixed_period, n_h, alpha)
    } else {
      fit_cosine_curves(tt, yy, n_curves)
    }
    if (is.null(res)) { mesor <- c(mesor, NA_real_); acro <- c(acro, NA_real_); next }
    params <- if (!is.null(res$harmonics)) res else res$parameters
    if (is.null(first_x)) {
      first_x <- if (!is.null(output_x)) output_x else tt
      set_col(env, env$cols, out_id(args, "cosinorx"), first_x, type = "number")
    }
    set_col(env, env$cols,
            {
              yo <- out_id(args, paste0("cosinory_", y_id))
              if (yo == -1) out_id(args, "cosinory") else yo
            },
            evaluate_cosinor_at_points(params, first_x), type = "number")
    mesor <- c(mesor, if (!is.null(res$M)) res$M else NA_real_)
    acro <- c(acro, if (!is.null(res$harmonics)) res$harmonics[[1]]$acrophase_hrs else NA_real_)
    any_valid <- TRUE
  }
  # Scalar metric ports carry ONE value per y input, in yIN order — the contract the whole
  # "one analysis node per group" idiom depends on.
  set_col(env, env$cols, out_id(args, "mesor"), mesor, type = "number")
  set_col(env, env$cols, out_id(args, "acrophase"), acro, type = "number")
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
                               sem = sem, n = n))
  t0 <- min(ti)
  # Double modulo, as the JS does: a negative remainder would otherwise index backwards.
  tod <- ((ti - t0) %% period + period) %% period
  b <- pmin(pmax(floor(tod / bin_width), 0), n_bins - 1) + 1
  for (k in seq_len(n_bins)) {
    vals <- yi[b == k]
    n[k] <- length(vals)
    if (!length(vals)) next
    m <- mean(vals)
    profile[k] <- m
    if (length(vals) >= 2) sem[k] <- sqrt(sum((vals - m)^2) / (length(vals) - 1)) / sqrt(length(vals))
  }
  list(bin_centres = bin_centres, profile = profile, sem = sem, n = n)
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
  k <- pmin(pmax(floor((tf - t0) / e), 0), n_epochs - 1) + 1
  for (i in seq_along(tf)) {
    if (!is.finite(yf[i])) next
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
    tod <- (((kk - 1) * e) %% period + period) %% period
    h <- floor(tod / e) %% p
    p_sum[h + 1] <- p_sum[h + 1] + x[kk]
    p_cnt[h + 1] <- p_cnt[h + 1] + 1
  }
  profile <- ifelse(p_cnt > 0, p_sum / p_cnt, NA_real_)

  prof_ss <- sum((profile[is.finite(profile)] - xbar)^2)
  IS <- if (overall_ss > 0) (nn * prof_ss) / (p * overall_ss) else NA_real_

  d <- diff(x)
  diff_ss <- sum(d[is.finite(d)]^2)
  IV <- if (overall_ss > 0 && nn > 1) (nn * diff_ss) / ((nn - 1) * overall_ss) else NA_real_

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
       n = nn, p = p, n_epochs = n_epochs)
}

tp_averageprofile <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  period <- as.numeric(if (is.null(args$period)) 24 else args$period)
  n_bins <- as.integer(if (is.null(args$nBins)) 24 else args$nBins)
  x_data <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  centres <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- compute_average_profile(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                                   period, n_bins)
    if (!length(res$bin_centres)) next
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

  scalar_keys <- c("IS", "IV", "RA", "M10", "L5", "M10onset", "L5onset")
  per_y <- list(); centres <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- compute_npcra(x_data, col_data(env$cols[[yk]], env$cols, env$raw_data),
                         epoch, period, m_window, l_window)
    if (is.null(res)) next
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

# Analyses this runtime implements. Kept in step with R_IMPLEMENTED in
# src/lib/_parity/runtimeCoverage.js by a test, in BOTH directions, so the declared reach and
# the real reach cannot drift apart the way the Python port's did.
TABLE_PROCESS_MAP = list(
  averageprofile = tp_averageprofile,
  binneddata = tp_binneddata,
  cosinor = tp_cosinor,
  describedata = tp_describedata,
  nonparametricra = tp_nonparametricra,
  normalitytest = tp_normalitytest,
  smootheddata = tp_smootheddata,
  threshold = tp_threshold,
  trendfit = tp_trendfit
)

# Column processes. Strict for the same reason analyses are: a column silently missing its
# transform is WRONG data, not partial data.
COLUMN_PROCESS_MAP = list(
  add = cp_add,
  multiply = cp_multiply,
  normalize = cp_normalize,
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
      parsed <- suppressWarnings(as.POSIXct(v, tz = "UTC",
                                            tryFormats = c("%Y-%m-%dT%H:%M:%OSZ",
                                                           "%Y-%m-%dT%H:%M:%OS",
                                                           "%Y-%m-%d %H:%M:%OS",
                                                           "%Y-%m-%d")))
      d <- as.numeric(parsed) * 1000
    }
  }
  if (identical(col$type, "bin")) {
    d <- unlist(d, use.names = FALSE) + col$bin_width / 2
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

moving_average <- function(y, window = 5, type = "simple") {
  v <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(v)
  if (n == 0 || window < 2) return(v)
  half <- window %/% 2
  out <- numeric(n)
  for (i in seq_len(n)) {
    # Window is CLAMPED at the edges rather than shortened symmetrically, matching the JS:
    # the first and last points keep a full-width average over whatever data exists.
    lo <- max(1, i - half); hi <- min(n, i + half)
    seg <- v[lo:hi]
    seg <- seg[is.finite(seg)]
    out[i] <- if (length(seg)) mean(seg) else NA_real_
  }
  out
}

# Whittaker-Eilers: minimise ||y - z||^2 + lambda * ||D_order z||^2. Solved directly; the
# system is small and banded, and base R's solve() is exact here.
whittaker_eilers <- function(y, lambda = 100, order = 2) {
  v <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(v)
  if (n < order + 1) return(v)
  ok <- is.finite(v)
  if (!any(ok)) return(v)
  filled <- v
  filled[!ok] <- mean(v[ok])
  d <- diag(n)
  for (k in seq_len(order)) d <- diff(d)
  w <- diag(as.numeric(ok))
  as.vector(solve(w + lambda * crossprod(d), w %*% filled))
}

savitzky_golay <- function(y, window = 5, poly_order = 2) {
  v <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(v)
  if (window %% 2 == 0) window <- window + 1
  if (n < window || window <= poly_order) return(v)
  half <- window %/% 2
  z <- -half:half
  des <- outer(z, 0:poly_order, `^`)
  # Row 1 of the pseudo-inverse gives the smoothing weights for the window centre.
  wts <- solve(crossprod(des), t(des))[1, ]
  out <- v
  for (i in (half + 1):(n - half)) out[i] <- sum(wts * v[(i - half):(i + half)])
  out
}

smooth_arrays <- function(x_vals, y_vals, smoother_type, options = list()) {
  g <- function(k, d) if (!is.null(options[[k]])) options[[k]] else d
  if (identical(smoother_type, "whittaker")) {
    return(list(x = x_vals, y = whittaker_eilers(y_vals, g("lambda", 100), g("order", 2))))
  }
  if (smoother_type %in% c("savitzky-golay", "savitzky")) {
    return(list(x = x_vals, y = savitzky_golay(
      y_vals, as.integer(g("savitzkyWindowSize", g("windowSize", 5))),
      as.integer(g("savitzkyPolyOrder", g("polyOrder", 2))))))
  }
  if (smoother_type %in% c("moving-average", "moving")) {
    return(list(x = x_vals, y = moving_average(
      y_vals, as.integer(g("movingAvgWindowSize", g("windowSize", 5))),
      g("movingAvgType", g("type", "simple")))))
  }
  list(x = x_vals, y = y_vals)
}
