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
  mesor <- c(); acro <- c(); pval <- c()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) {
      mesor <- c(mesor, NA_real_); acro <- c(acro, NA_real_); pval <- c(pval, NA_real_); next
    }
    y <- suppressWarnings(as.numeric(unlist(col_data(env$cols[[yk]], env$cols, env$raw_data),
                                            use.names = FALSE)))
    ok <- is.finite(t) & is.finite(y)
    tt <- t[ok]; yy <- y[ok]
    res <- if (use_fixed || n_curves == 0) {
      fit_cosinor_fixed(tt, yy, fixed_period, n_h, alpha)
    } else {
      fit_cosine_curves(tt, yy, n_curves)
    }
    if (is.null(res)) {
      mesor <- c(mesor, NA_real_); acro <- c(acro, NA_real_); pval <- c(pval, NA_real_); next
    }
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
    # `pvalue` is the ANALYTIC zero-amplitude F-test p of the FIXED-period fit
    # (fit_cosinor_fixed's pF), matching the JS and Python semantics fixed in
    # v72.x. The free-period nonlinear fit has no analytic test, so NA there.
    pval <- c(pval, if (!is.null(res$pF)) res$pF else NA_real_)
    any_valid <- TRUE
  }
  # Scalar metric ports carry ONE value per y input, in yIN order — the contract the whole
  # "one analysis node per group" idiom depends on.
  set_col(env, env$cols, out_id(args, "mesor"), mesor, type = "number")
  set_col(env, env$cols, out_id(args, "acrophase"), acro, type = "number")
  set_col(env, env$cols, out_id(args, "pvalue"), pval, type = "number")
  # The permutation p is a Monte Carlo quantity tied to the JS's seeded PRNG
  # (same boundary as the Python runtime): emitted as NA, never a lookalike.
  set_col(env, env$cols, out_id(args, "perm_pvalue"),
          rep(NA_real_, length(pval)), type = "number")
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

tp_collectcolumns <- function(args, env) {
  ids <- if (!is.null(args$colIds)) unlist(args$colIds, use.names = FALSE) else id_list(args$yIN)
  any_valid <- FALSE
  for (cid in ids) {
    ck <- as.character(cid)
    if (is.null(env$cols[[ck]])) next
    oid <- out_id(args, paste0("col_", cid))
    if (oid == -1) next
    set_col(env, env$cols, oid, col_data(env$cols[[ck]], env$cols, env$raw_data),
            type = env$cols[[ck]]$type)
    any_valid <- TRUE
  }
  any_valid
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
  } else return(FALSE)

  set_col(env, env$cols, out_id(args, "result"), unlist(result, use.names = FALSE),
          type = "number")
  length(result) > 0
}

tp_widetolong <- function(args, env) {
  x_in <- if (!is.null(args$timeIN)) args$timeIN else if (!is.null(args$xIN)) args$xIN else -1
  y_ins <- id_list(if (!is.null(args$valueColIds)) args$valueColIds else args$yIN)
  if (!length(y_ins)) return(FALSE)
  times <- list(); cats <- character(0); vals <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y_col <- env$cols[[yk]]
    yd <- col_data(y_col, env$cols, env$raw_data)
    xd <- if (x_in != -1 && !is.null(env$cols[[as.character(x_in)]]))
      col_data(env$cols[[as.character(x_in)]], env$cols, env$raw_data) else as.list(seq_along(yd) - 1)
    for (i in seq_along(yd)) {
      xi <- if (i <= length(xd)) xd[[i]] else NULL
      yi <- yd[[i]]
      if (is.null(xi) || is.null(yi)) next
      if (length(xi) != 1 || length(yi) != 1) next
      if ((is.character(xi) && !nzchar(xi)) || (is.character(yi) && !nzchar(yi))) next
      if (is.atomic(xi) && is.na(xi)) next
      if (is.atomic(yi) && is.na(yi)) next
      times[[length(times) + 1]] <- xi
      cats <- c(cats, if (is.null(y_col$name)) yk else y_col$name)
      vals[[length(vals) + 1]] <- yi
    }
  }
  x_col <- if (x_in != -1) env$cols[[as.character(x_in)]] else NULL
  set_col(env, env$cols, out_id(args, "time"), unlist(times, use.names = FALSE),
          type = if (!is.null(x_col)) x_col$type else "number",
          time_format = if (!is.null(x_col)) x_col$time_format else NULL)
  set_col(env, env$cols, out_id(args, "category"), cats, type = "category")
  set_col(env, env$cols, out_id(args, "value"), unlist(vals, use.names = FALSE), type = "number")
  TRUE
}

tp_longtowide <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  cat_in <- if (!is.null(args$categoryColId)) args$categoryColId
            else if (!is.null(args$catIN)) args$catIN else -1
  val_in <- if (!is.null(args$valueColId)) args$valueColId
            else if (!is.null(args$valIN)) args$valIN else -1
  if (x_in == -1 || cat_in == -1 || val_in == -1) return(FALSE)
  xk <- as.character(x_in)
  if (is.null(env$cols[[xk]])) return(FALSE)
  xd <- unlist(col_data(env$cols[[xk]], env$cols, env$raw_data), use.names = FALSE)
  cd <- as.character(unlist(col_data(env$cols[[as.character(cat_in)]], env$cols, env$raw_data),
                            use.names = FALSE))
  vd <- suppressWarnings(as.numeric(unlist(col_data(env$cols[[as.character(val_in)]],
                                                    env$cols, env$raw_data), use.names = FALSE)))
  n <- min(length(xd), length(cd), length(vd))
  xd <- xd[seq_len(n)]; cd <- cd[seq_len(n)]; vd <- vd[seq_len(n)]
  # pandas pivot_table SORTS both the index and the columns, and aggregates duplicates with
  # the mean. Matching that ordering matters: the output columns are addressed by name, so a
  # different order would pair the wrong values with the wrong ids.
  ux <- sort(unique(xd))
  uc <- sort(unique(cd))
  set_col(env, env$cols, out_id(args, "time"), ux,
          type = env$cols[[xk]]$type, time_format = env$cols[[xk]]$time_format)
  for (cc in uc) {
    oid <- out_id(args, paste0("value_", cc))
    if (oid == -1) next
    vals <- vapply(ux, function(xx) {
      sel <- vd[xd == xx & cd == cc]
      sel <- sel[is.finite(sel)]
      if (!length(sel)) NA_real_ else mean(sel)
    }, numeric(1))
    set_col(env, env$cols, oid, vals, type = "number")
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

cross_correlation <- function(x, y, max_lag = 0, method = "pearson") {
  xa <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ya <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  nx <- length(xa); ny <- length(ya)
  if (is.null(max_lag) || max_lag <= 0) max_lag <- max(1, min(nx, ny) %/% 4)
  max_lag <- min(as.integer(max_lag), min(nx, ny) - 1)
  lags <- c(); rs <- c(); ps <- c(); ns <- c()
  for (k in (-max_lag):max_lag) {
    # Index arithmetic is kept 0-based as in the Python and shifted by 1 only at the
    # subscript, so the overlap window is identical rather than merely similar.
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
  yv <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  preds <- lapply(predictor_cols,
                  function(cc) suppressWarnings(as.numeric(unlist(cc, use.names = FALSE))))
  n <- min(c(length(yv), vapply(preds, length, integer(1))))
  if (n < 2) return(NULL)
  yv <- yv[seq_len(n)]
  preds <- lapply(preds, function(v) v[seq_len(n)])
  df <- as.data.frame(preds)
  colnames(df) <- paste0("v", seq_along(preds))
  df$.y <- yv
  df <- df[stats::complete.cases(df), , drop = FALSE]
  if (!nrow(df) || length(unique(df$.y)) < 2) return(NULL)
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
  labels <- c("(intercept)",
              if (is.null(names)) paste0("x", seq_along(preds))
              else unlist(names, use.names = FALSE))
  coefs <- unname(sm[, 1])
  list(term = labels, coef = coefs, se = unname(sm[, 2]), z = unname(sm[, 3]),
       pvalue = unname(sm[, 4]), oddsRatio = exp(coefs), n = nrow(df),
       logLik = as.numeric(logLik(fit)),
       eta = as.vector(predict(fit, type = "link")),
       fitted = as.vector(predict(fit, type = "response")),
       outcome = df$.y)
}

# Interpolate ys(xs) at `grid`, or fill ys' own gaps when grid is NULL.
# Extrapolation is deliberately NOT attempted: a target outside the observed x range comes
# back NA rather than a straight-line guess, because a fabricated value beyond the end of the
# recording is worse than an honest gap.
interp_series <- function(xs, ys, grid = NULL, method = "linear") {
  x <- suppressWarnings(as.numeric(unlist(xs, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(ys, use.names = FALSE)))
  n <- min(length(x), length(y))
  x <- x[seq_len(n)]; y <- y[seq_len(n)]
  ok <- is.finite(x) & is.finite(y)
  px <- x[ok]; py <- y[ok]
  o <- order(px); px <- px[o]; py <- py[o]
  if (length(px) < 2) {
    return(rep(NA_real_, if (is.null(grid)) length(y) else length(grid)))
  }
  at <- function(v) {
    if (!is.finite(v) || v < px[1] || v > px[length(px)]) return(NA_real_)
    if (identical(method, "nearest")) return(py[which.min(abs(px - v))])
    approx(px, py, xout = v, method = "linear")$y
  }
  if (!is.null(grid)) return(vapply(grid, at, numeric(1)))
  vapply(seq_along(y), function(i) if (is.finite(y[i])) y[i] else at(x[i]), numeric(1))
}

# --- the analyses ----------------------------------------------------------

tp_correlation <- function(args, env) {
  y_ins <- id_list(args$yIN)
  y_ins <- y_ins[vapply(y_ins, function(i) !is.null(env$cols[[as.character(i)]]), logical(1))]
  if (length(y_ins) < 2) return(FALSE)
  method <- if (is.null(args$method)) "auto" else args$method
  alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
  rows <- list(var_i = c(), var_j = c(), r = c(), pvalue = c(), n = c(),
               ciLow = c(), ciHigh = c(), significant = c())
  for (a in seq_len(length(y_ins) - 1)) for (b in (a + 1):length(y_ins)) {
    ca <- env$cols[[as.character(y_ins[a])]]
    cb <- env$cols[[as.character(y_ins[b])]]
    xs <- col_data(ca, env$cols, env$raw_data)
    ys <- col_data(cb, env$cols, env$raw_data)
    use <- method
    if (identical(method, "auto")) {
      # Shapiro on both; Spearman if EITHER looks non-normal, matching the JS.
      pa <- shapiro_wilk(xs)$pvalue
      pb <- shapiro_wilk(ys)$pvalue
      non_normal <- (!is.na(pa) && pa <= 0.05) || (!is.na(pb) && pb <= 0.05)
      use <- if (non_normal) "spearman" else "pearson"
    }
    res <- correlate(xs, ys, use)
    ci <- correlation_ci(c(res$r, res$n), use, 1 - alpha)
    rows$var_i <- c(rows$var_i, if (is.null(ca$name)) as.character(y_ins[a]) else ca$name)
    rows$var_j <- c(rows$var_j, if (is.null(cb$name)) as.character(y_ins[b]) else cb$name)
    rows$r <- c(rows$r, res$r)
    rows$pvalue <- c(rows$pvalue, res$pvalue)
    rows$n <- c(rows$n, res$n)
    rows$ciLow <- c(rows$ciLow, ci$ciLow)
    rows$ciHigh <- c(rows$ciHigh, ci$ciHigh)
    rows$significant <- c(rows$significant,
                          if (is.na(res$pvalue)) NA_real_ else as.numeric(res$pvalue < alpha))
  }
  .write_result_rows(args, env, rows)
}

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
                           as.integer(if (is.null(args$maxLag)) 0 else args$maxLag),
                           if (is.null(args$method)) "pearson" else args$method)
  .write_result_rows(args, env,
                     list(lag = res$lags, correlation = res$r, pvalue = res$pvalue))
}

# Counts of (x, y) category pairs, with rows and columns ordered by FIRST APPEARANCE rather
# than sorted: chi-square's statistic is order-invariant, but phi's SIGN is not, so the row
# and column order has to match the JS.
contingency <- function(xs, ys) {
  xs <- as.character(unlist(xs, use.names = FALSE))
  ys <- as.character(unlist(ys, use.names = FALSE))
  n <- min(length(xs), length(ys))
  rows <- character(0); cols <- character(0)
  pairs_a <- character(0); pairs_b <- character(0)
  for (i in seq_len(n)) {
    a <- xs[i]; b <- ys[i]
    if (is.na(a) || is.na(b) || !nzchar(a) || !nzchar(b)) next
    if (!(a %in% rows)) rows <- c(rows, a)
    if (!(b %in% cols)) cols <- c(cols, b)
    pairs_a <- c(pairs_a, a); pairs_b <- c(pairs_b, b)
  }
  if (!length(rows) || !length(cols)) return(NULL)
  m <- matrix(0, nrow = length(rows), ncol = length(cols))
  for (i in seq_along(pairs_a)) {
    m[match(pairs_a[i], rows), match(pairs_b[i], cols)] <-
      m[match(pairs_a[i], rows), match(pairs_b[i], cols)] + 1
  }
  m
}

tp_chisquared <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]])) return(FALSE)
  test_type <- if (is.null(args$testType)) "independence" else args$testType
  correction <- !identical(args$correction, FALSE)
  xs <- col_data(env$cols[[as.character(x_in)]], env$cols, env$raw_data)

  if (identical(test_type, "goodnessoffit")) {
    counts <- clean_numeric(xs)
    if (!length(counts)) return(FALSE)
    res <- chi_square_goodness_of_fit(counts)
    return(.write_result_rows(args, env, list(
      statistic = res$statistic, pvalue = res$pvalue, df = res$df,
      effectSize = NA_real_, ciLow = NA_real_, ciHigh = NA_real_)))
  }

  if (y_in == -1 || is.null(env$cols[[as.character(y_in)]])) return(FALSE)
  tab <- contingency(xs, col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data))
  if (is.null(tab) || nrow(tab) < 2 || ncol(tab) < 2) return(FALSE)
  res <- chi_square_independence_effects(tab, correction)
  .write_result_rows(args, env, list(
    statistic = res$statistic, pvalue = res$pvalue, df = res$df,
    effectSize = res$cramersV, ciLow = NA_real_, ciHigh = NA_real_))
}

tp_logisticregression <- function(args, env) {
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  x_ins <- id_list(args$xIN)
  x_ins <- x_ins[vapply(x_ins, function(i) !is.null(env$cols[[as.character(i)]]), logical(1))]
  if (y_in == -1 || is.null(env$cols[[as.character(y_in)]]) || !length(x_ins)) return(FALSE)
  y <- col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data)
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

tp_interpolate <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  mode <- if (is.null(args$mode)) "fill" else args$mode
  method <- if (is.null(args$method)) "linear" else args$method
  x_col <- env$cols[[as.character(x_in)]]
  xs_raw <- t_for_col(x_col, env$cols, env$raw_data)

  target <- NULL
  if (identical(mode, "resample")) {
    finite <- xs_raw[is.finite(xs_raw)]
    if (!length(finite)) return(FALSE)
    step <- as.numeric(if (is.null(args$step)) 1 else args$step)
    start <- if (is.null(args$start)) min(finite) else as.numeric(args$start)
    end <- if (is.null(args$end)) max(finite) else as.numeric(args$end)
    if (step <= 0 || end < start) return(FALSE)
    # The 1e-9 slack matches the Python: without it a range that is an exact multiple of the
    # step loses its final point to floating-point drift.
    target <- seq(start, end + 1e-9, by = step)
  }

  wrote <- FALSE
  ox <- out_id(args, "interpx")
  if (ox != -1) {
    set_col(env, env$cols, ox, if (identical(mode, "resample")) target else xs_raw,
            type = x_col$type, time_format = x_col$time_format)
    wrote <- TRUE
  }
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    ys <- interp_series(xs_raw, col_data(env$cols[[yk]], env$cols, env$raw_data), target, method)
    oy <- out_id(args, paste0("interpy_", y_id))
    if (oy == -1) oy <- out_id(args, "interpy")
    if (oy != -1) {
      set_col(env, env$cols, oy, ys, type = "number")
      wrote <- TRUE
    }
  }
  wrote
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
        per_y[[yk]] <- list(R = st$R, z = st$z, pValue = st$pValue,
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

# Multi-start over PERIOD seeds, mirroring fit_rectangular_wave. Parameters are
# [M, A, kappa, omega, phi, dutyCycle]; `fix*` options hold individual ones at their seed by
# excluding them from the free set rather than by bounding them tightly.
fit_rectangular_wave <- function(t, x, options = list()) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  x <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ok <- is.finite(t) & is.finite(x)
  t <- t[ok]; x <- x[ok]
  if (length(t) < 6) return(NULL)
  g <- function(k, d) if (!is.null(options[[k]])) options[[k]] else d

  fix_kappa <- isTRUE(g("fixKappa", FALSE))
  fix_omega <- isTRUE(g("fixOmega", FALSE))
  fix_d <- isTRUE(g("fixD", FALSE))
  kappa0 <- as.numeric(g("kappa", 5))
  omega0 <- as.numeric(g("omega", 2 * pi / 24))
  d0 <- as.numeric(g("dutyCycle", 0.5))

  free_idx <- c(1, 2, 5)
  if (!fix_kappa) free_idx <- c(free_idx, 3)
  if (!fix_omega) free_idx <- c(free_idx, 4)
  if (!fix_d) free_idx <- c(free_idx, 6)
  free_idx <- sort(free_idx)

  m0 <- mean(x)
  a0 <- (max(x) - min(x)) / 2
  if (a0 == 0) a0 <- 1
  full0 <- c(m0, a0, kappa0, omega0, 0, d0)
  lb_full <- c(-Inf, -Inf, 1e-3, 1e-3, -Inf, 0.01)
  ub_full <- c(Inf, Inf, Inf, 100, Inf, 0.99)

  timespan <- if (t[length(t)] > t[1]) t[length(t)] - t[1] else 1
  best <- NULL; best_full <- NULL
  for (p_seed in c(24, 12, 6, max(timespan, 1))) {
    f0 <- full0
    if (!fix_omega) f0[4] <- 2 * pi / p_seed
    cost <- function(pf) {
      full <- f0
      full[free_idx] <- pf
      0.5 * sum((rectwave_model(full, t) - x)^2)
    }
    # Analytic gradient. tanh SATURATES, so over most of the cycle a differenced gradient is
    # numerically zero and L-BFGS-B stalls: with the default numerical one R reached only
    # R^2 = 0.89 where scipy's trust-region got 0.99 on the same data. sech^2 = 1 - tanh^2 is
    # the factor that carries the (tiny but real) slope through the flat region.
    grad <- function(pf) {
      full <- f0
      full[free_idx] <- pf
      M <- full[1]; A <- full[2]; k <- full[3]; w <- full[4]; phi <- full[5]; d <- full[6]
      th <- w * t + phi
      u <- k * (sin(th) - cos(pi * d))
      tu <- tanh(u)
      sech2 <- 1 - tu * tu
      r <- M + A * tu - x
      g_full <- c(
        sum(r),                                        # dM
        sum(r * tu),                                   # dA
        sum(r * A * sech2 * (sin(th) - cos(pi * d))),  # dkappa
        sum(r * A * sech2 * k * t * cos(th)),          # domega
        sum(r * A * sech2 * k * cos(th)),              # dphi
        sum(r * A * sech2 * k * pi * sin(pi * d))      # dduty
      )
      g_full[free_idx]
    }
    fit <- tryCatch(
      optim(f0[free_idx], cost, grad, method = "L-BFGS-B",
            lower = lb_full[free_idx], upper = ub_full[free_idx],
            control = list(factr = 1, pgtol = 0, maxit = 5000)),
      error = function(e) NULL)
    if (!is.null(fit) && (is.null(best) || fit$value < best$value)) {
      best <- fit; best_full <- f0
    }
  }
  if (is.null(best)) return(NULL)
  full <- best_full
  full[free_idx] <- best$par
  pred <- rectwave_model(full, t)
  rss <- sum((x - pred)^2)
  ss_tot <- sum((x - mean(x))^2)
  w <- full[4]
  period <- if (w != 0) 2 * pi / w else Inf
  acrophase <- if (w != 0) ((pi / 2 - full[5]) / w) %% period else 0
  list(parameters = list(M = full[1], A = full[2], kappa = full[3],
                         omega = w, phi = full[5], dutyCycle = full[6]),
       period = period, acrophase = acrophase, fitted = pred,
       rmse = sqrt(rss / length(t)),
       rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0,
       rss = rss)
}

tp_rectangularwave <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  opts <- list(fixKappa = args$fixKappa, fixOmega = args$fixOmega, fixD = args$fixD,
               kappa = if (is.null(args$kappa)) 5 else args$kappa,
               omega = if (is.null(args$omega)) 2 * pi / 24 else args$omega,
               dutyCycle = if (is.null(args$dutyCycle)) 0.5 else args$dutyCycle)
  output_x_id <- if (is.null(args$outputX)) -1 else args$outputX
  output_x <- if (output_x_id != -1 && !is.null(env$cols[[as.character(output_x_id)]]))
    t_for_col(env$cols[[as.character(output_x_id)]], env$cols, env$raw_data) else NULL

  first_xs <- NULL; any_valid <- FALSE; stats_by_y <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- fit_rectangular_wave(t, col_data(env$cols[[yk]], env$cols, env$raw_data), opts)
    if (is.null(res)) next
    if (is.null(first_xs)) {
      # The JS evaluates the fit at the (finite) input t, not on a dense grid.
      first_xs <- if (!is.null(output_x)) output_x else t[is.finite(t)]
      set_col(env, env$cols, out_id(args, "rectwavex"), first_xs, type = "number")
    }
    ys <- evaluate_rectwave_at_points(res$parameters, first_xs)
    y_out <- out_id(args, paste0("rectwavey_", y_id))
    if (y_out == -1) y_out <- out_id(args, "rectwavey")
    set_col(env, env$cols, y_out, ys, type = "number")
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

# M + A*(rise - fall): two sigmoids, one turning activity on at t1 and one off at t2.
# In PERIODIC mode the pair is tiled at every multiple of T and summed, so one parameter set
# describes a repeating daily bout rather than a single episode. The tile range runs from -1
# so the bout starting BEFORE the window still contributes to its leading edge.
dl_model <- function(p, t, periodic) {
  if (periodic) {
    M <- p[1]; A <- p[2]; k1 <- p[3]; t1 <- p[4]; k2 <- p[5]; t2 <- p[6]; T <- p[7]
    n_tiles <- max(1, ceiling((max(t) - min(t)) / T) + 2)
    j <- seq(-1, n_tiles)
    acc <- numeric(length(t))
    for (off in j * T) {
      acc <- acc + sigmoid(k1 * (t - t1 - off)) - sigmoid(k2 * (t - t2 - off))
    }
    return(M + A * acc)
  }
  p[1] + p[2] * (sigmoid(p[3] * (t - p[4])) - sigmoid(p[5] * (t - p[6])))
}

evaluate_dl_at_points <- function(parameters, x_points, periodic = FALSE) {
  xa <- suppressWarnings(as.numeric(unlist(x_points, use.names = FALSE)))
  p <- c(parameters$M, parameters$A, parameters$k1, parameters$t1,
         parameters$k2, parameters$t2)
  if (periodic) p <- c(p, parameters$T)
  dl_model(p, xa, periodic)
}

fit_double_logistic <- function(t, x, options = list()) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  x <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  ok <- is.finite(t) & is.finite(x)
  t <- t[ok]; x <- x[ok]
  if (length(t) < 6) return(NULL)
  g <- function(k, d) if (!is.null(options[[k]])) options[[k]] else d

  periodic <- isTRUE(g("periodic", FALSE))
  fix_k1 <- isTRUE(g("fixK1", FALSE))
  fix_k2 <- isTRUE(g("fixK2", FALSE))
  fix_T <- isTRUE(g("fixT", FALSE))

  m0 <- min(x)
  a0 <- max(x) - min(x)
  if (a0 == 0) a0 <- 1
  k1_0 <- as.numeric(g("k1", 1))
  k2_0 <- as.numeric(g("k2", 1))
  timespan <- t[length(t)] - t[1]
  if (timespan == 0) timespan <- 1
  # A FREE period inits from the data TIMESPAN, not from 24: seeding it small lets the
  # optimiser collapse into a degenerate many-tile fit that scores well and means nothing.
  T0 <- as.numeric(g("T", if (fix_T) 24 else timespan))

  if (periodic) {
    # PERIODIC mode seeds both edges from the PHASE-FOLDED data, inside ONE cycle, mirroring
    # generateInitialGuessP in doubleLogistic.js. Seeding at 25% and 75% of the whole record
    # (correct for the aperiodic case) puts them ~83 h apart in a 24 h model; the tiled sum
    # is then nonsense and no optimiser recovers. The Python port did exactly that and
    # returned R^2 = 0.008 against the JS engine's 0.982.
    t_min <- t[1]
    mean_x <- mean(x)
    phases <- ((t - t_min) %% T0 + T0) %% T0
    above <- sort(phases[x > mean_x])
    if (length(above) > 2) {
      onset_phase <- above[1]; offset_phase <- above[length(above)]
    } else {
      onset_phase <- T0 * 0.25; offset_phase <- T0 * 0.75
    }
    t1_0 <- t_min + onset_phase
    t2_0 <- t1_0 + max(0.01, offset_phase - onset_phase)
  } else {
    t1_0 <- t[1] + timespan * 0.25
    t2_0 <- t[1] + timespan * 0.75
  }

  if (periodic) {
    full0 <- c(m0, a0, k1_0, t1_0, k2_0, t2_0, T0)
    free <- c(1, 2, 4, 6)
    if (!fix_k1) free <- c(free, 3)
    if (!fix_k2) free <- c(free, 5)
    if (!fix_T) free <- c(free, 7)
    lb_full <- c(-Inf, -Inf, 1e-4, -Inf, 1e-4, -Inf, 0.1)
    ub_full <- c(Inf, Inf, Inf, Inf, Inf, Inf, Inf)
  } else {
    full0 <- c(m0, a0, k1_0, t1_0, k2_0, t2_0)
    free <- c(1, 2, 4, 6)
    if (!fix_k1) free <- c(free, 3)
    if (!fix_k2) free <- c(free, 5)
    lb_full <- c(-Inf, -Inf, 1e-4, -Inf, 1e-4, -Inf)
    ub_full <- c(Inf, Inf, Inf, Inf, Inf, Inf)
  }
  free <- sort(free)

  # t2 > t1 is ENFORCED inside the objective rather than by a bound, because the constraint
  # couples two parameters. Without it the fit can swap the on and off edges and report a
  # negative-duration bout.
  expand <- function(pf) {
    full <- full0
    full[free] <- pf
    if (full[6] <= full[4] + 0.01) full[6] <- full[4] + 0.01
    full
  }
  cost <- function(pf) 0.5 * sum((dl_model(expand(pf), t, periodic) - x)^2)

  # Analytic gradient. The sigmoid saturates the same way tanh does, so a differenced
  # gradient is numerically zero wherever the curve is flat — which for a square-ish bout is
  # most of the cycle. s' = s(1-s) is what carries the slope through.
  grad <- function(pf) {
    full <- expand(pf)
    M <- full[1]; A <- full[2]; k1 <- full[3]; t1 <- full[4]; k2 <- full[5]; t2 <- full[6]
    offs <- if (periodic) {
      T <- full[7]
      (seq(-1, max(1, ceiling((max(t) - min(t)) / T) + 2))) * T
    } else 0
    on_sum <- numeric(length(t)); off_sum <- numeric(length(t))
    dk1 <- numeric(length(t)); dt1 <- numeric(length(t))
    dk2 <- numeric(length(t)); dt2 <- numeric(length(t)); dT <- numeric(length(t))
    for (off in offs) {
      a1 <- k1 * (t - t1 - off); s1 <- sigmoid(a1); d1 <- s1 * (1 - s1)
      a2 <- k2 * (t - t2 - off); s2 <- sigmoid(a2); d2 <- s2 * (1 - s2)
      on_sum <- on_sum + s1; off_sum <- off_sum + s2
      dk1 <- dk1 + d1 * (t - t1 - off)
      dt1 <- dt1 - d1 * k1
      dk2 <- dk2 - d2 * (t - t2 - off)
      dt2 <- dt2 + d2 * k2
      if (periodic) dT <- dT - d1 * k1 * (off / full[7]) + d2 * k2 * (off / full[7])
    }
    r <- M + A * (on_sum - off_sum) - x
    g_full <- c(sum(r), sum(r * (on_sum - off_sum)),
                sum(r * A * dk1), sum(r * A * dt1),
                sum(r * A * dk2), sum(r * A * dt2))
    if (periodic) g_full <- c(g_full, sum(r * A * dT))
    g_full[free]
  }

  fit <- tryCatch(
    optim(full0[free], cost, grad, method = "L-BFGS-B",
          lower = lb_full[free], upper = ub_full[free],
          control = list(factr = 1, pgtol = 0, maxit = 8000)),
    error = function(e) NULL)
  if (is.null(fit)) return(NULL)

  full <- expand(fit$par)
  pred <- dl_model(full, t, periodic)
  rss <- sum((x - pred)^2)
  ss_tot <- sum((x - mean(x))^2)
  params <- list(M = full[1], A = full[2], k1 = full[3], t1 = full[4],
                 k2 = full[5], t2 = full[6])
  if (periodic) params$T <- full[7]
  duration <- full[6] - full[4]
  period <- if (periodic) full[7] else max(timespan, 1)
  list(parameters = params, duration = duration,
       onsetPhase = (full[4] %% period) / period,
       offsetPhase = (full[6] %% period) / period,
       dutyCycle = if (period > 0) duration / period else 0,
       fitted = pred, rmse = sqrt(rss / length(t)),
       rSquared = if (ss_tot > 0) 1 - rss / ss_tot else 0, rss = rss)
}

tp_doublelogistic <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  periodic <- !identical(args$periodic, FALSE)
  # The JS keys the fixed period as fixPeriod/fixedPeriod, not fixT/T.
  fix_period <- isTRUE(args$fixPeriod) || isTRUE(args$fixT)
  opts <- list(periodic = periodic, fixK1 = args$fixK1, fixK2 = args$fixK2,
               fixT = fix_period,
               k1 = if (is.null(args$fixedK1)) 0.5 else args$fixedK1,
               k2 = if (is.null(args$fixedK2)) 0.5 else args$fixedK2,
               T = if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
  x_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(x_col, env$cols, env$raw_data)
  output_x_id <- if (is.null(args$outputX)) -1 else args$outputX
  output_x <- if (output_x_id != -1 && !is.null(env$cols[[as.character(output_x_id)]]))
    t_for_col(env$cols[[as.character(output_x_id)]], env$cols, env$raw_data) else NULL

  first_xs <- NULL; any_valid <- FALSE; stats_by_y <- list()
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    res <- fit_double_logistic(t, col_data(env$cols[[yk]], env$cols, env$raw_data), opts)
    if (is.null(res)) next
    if (is.null(first_xs)) {
      first_xs <- if (!is.null(output_x)) output_x else t[is.finite(t)]
      set_col(env, env$cols, out_id(args, "dlogx"), first_xs, type = "number")
    }
    ys <- evaluate_dl_at_points(res$parameters, first_xs, periodic)
    y_out <- out_id(args, paste0("dlogy_", y_id))
    if (y_out == -1) y_out <- out_id(args, "dlogy")
    set_col(env, env$cols, y_out, ys, type = "number")
    stats_by_y[[yk]] <- res
    any_valid <- TRUE
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
    if (isTRUE(args$useFixedPeriod)) {
      fp <- as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod)
      nh <- max(1, as.integer(if (is.null(args$nHarmonics)) 1 else args$nHarmonics))
      alpha <- as.numeric(if (is.null(args$alpha)) 0.05 else args$alpha)
      res <- fit_cosinor_fixed(tt, yy, fp, nh, alpha)
      if (is.null(res)) return(NULL)
      return(list(model = "cosinor", mode = "fixed",
                  parameters = list(mode = "fixed", period = fp, M = res$M,
                                    harmonics = res$harmonics),
                  fitted = res$fitted))
    }
    nc <- max(1, as.integer(if (is.null(args$Ncurves)) 1 else args$Ncurves))
    res <- fit_cosine_curves(tt, yy, nc)
    if (is.null(res)) return(NULL)
    return(list(model = "cosinor", mode = "free",
                parameters = c(list(mode = "free"), res$parameters),
                fitted = res$fitted))
  }
  if (identical(model, "rectangular")) {
    res <- fit_rectangular_wave(tt, yy, list(
      fixKappa = args$fixKappa, fixOmega = args$fixOmega, fixD = args$fixDutyCycle,
      kappa = if (is.null(args$fixedKappa)) 5 else args$fixedKappa,
      omega = 2 * pi / as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod),
      dutyCycle = if (is.null(args$fixedDutyCycle)) 0.5 else args$fixedDutyCycle))
    if (is.null(res)) return(NULL)
    return(list(model = "rectangular", parameters = res$parameters, fitted = res$fitted))
  }
  if (identical(model, "doublelogistic")) {
    periodic <- !identical(args$periodic, FALSE)
    res <- fit_double_logistic(tt, yy, list(
      periodic = periodic, fixK1 = args$fixK1, fixK2 = args$fixK2,
      fixT = isTRUE(args$fixPeriod),
      k1 = if (is.null(args$fixedK1)) 0.5 else args$fixedK1,
      k2 = if (is.null(args$fixedK2)) 0.5 else args$fixedK2,
      T = if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod))
    if (is.null(res)) return(NULL)
    return(list(model = "doublelogistic", periodic = periodic,
                parameters = res$parameters, fitted = res$fitted))
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

tp_fitfunction <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  model <- if (is.null(args$model)) "cosinor" else args$model
  x_out <- out_id(args, "fitx")
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  t_col <- env$cols[[as.character(x_in)]]
  t <- t_for_col(t_col, env$cols, env$raw_data)

  output_x_id <- if (is.null(args$outputX)) -1 else args$outputX
  output_x <- NULL
  if (output_x_id != -1 && !is.null(env$cols[[as.character(output_x_id)]])) {
    ox <- t_for_col(env$cols[[as.character(output_x_id)]], env$cols, env$raw_data)
    output_x <- ox[is.finite(ox)]
  }

  y_results <- list(); any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    y <- suppressWarnings(as.numeric(unlist(col_data(env$cols[[yk]], env$cols, env$raw_data),
                                            use.names = FALSE)))
    n <- min(length(t), length(y))
    ok <- is.finite(t[seq_len(n)]) & is.finite(y[seq_len(n)])
    tt <- t[seq_len(n)][ok]; yy <- y[seq_len(n)][ok]
    if (!length(tt)) next
    fr <- ff_fit_curve_model(tt, yy, model, args)
    if (is.null(fr)) next
    y_out_data <- if (!is.null(output_x)) ff_evaluate_at_points(fr, model, output_x)
                  else fr$fitted
    y_results[[yk]] <- list(xOutData = if (!is.null(output_x)) output_x else tt,
                            yOutData = y_out_data)
    if (length(fr$fitted)) any_valid <- TRUE
  }

  if (any_valid && x_out != -1) {
    first <- y_results[[1]]
    set_col(env, env$cols, x_out, first$xOutData, type = "number")
    for (y_id in y_ins) {
      yr <- y_results[[as.character(y_id)]]
      y_out <- out_id(args, paste0("fity_", y_id))
      if (y_out != -1 && !is.null(yr)) {
        set_col(env, env$cols, y_out, yr$yOutData, type = "number")
      }
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
compute_fft <- function(times, values, freq_step = NULL) {
  t <- suppressWarnings(as.numeric(unlist(times, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(values, use.names = FALSE)))
  n0 <- min(length(t), length(y))
  t <- t[seq_len(n0)]; y <- y[seq_len(n0)]
  ok <- is.finite(t) & is.finite(y)
  t <- t[ok]; y <- y[ok]
  if (length(t) < 2) {
    return(list(frequencies = numeric(0), magnitudes = numeric(0), phases = numeric(0),
                samplingRate = 0, nyquistFreq = 0, minPeriod = 0))
  }
  y <- y - mean(y)
  dt <- (t[length(t)] - t[1]) / (length(t) - 1)
  sampling_rate <- 1 / dt
  nyquist <- sampling_rate / 2
  n <- if (!is.null(freq_step) && freq_step > 0) {
    2^ceiling(log2(max(ceiling(sampling_rate / freq_step), 1)))
  } else 2^ceiling(log2(length(y)))
  if (n < length(y)) n <- 2^ceiling(log2(length(y)))
  y_pad <- c(y, rep(0, n - length(y)))
  spec <- fft(y_pad)
  half_n <- n %/% 2
  freqs <- c(); mags <- c(); phases <- c()
  for (i in seq_len(max(half_n - 1, 0))) {
    freq <- i * sampling_rate / n
    if (freq > nyquist) break
    z <- spec[i + 1]
    freqs <- c(freqs, freq)
    mags <- c(mags, Mod(z) * 2 / n)
    phases <- c(phases, Arg(z))
  }
  list(frequencies = freqs, magnitudes = mags, phases = phases,
       samplingRate = sampling_rate, nyquistFreq = nyquist, minPeriod = 2 * dt)
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
    if (!is.na(pos) && pos >= 1 && pos <= length(out)) out[[pos]] <- edit$value
  }
  out
}

cp_outlierremoval <- function(x, args, cols, raw_data) {
  method <- if (is.null(args$method)) "iqr" else args$method
  arr <- suppressWarnings(as.numeric(unlist(x, use.names = FALSE)))
  sub <- arr[is.finite(arr)]
  if (!length(sub)) return(arr)
  if (identical(method, "iqr")) {
    q <- unname(quantile(sub, c(0.25, 0.75), type = 7))
    iqr <- q[2] - q[1]
    mult <- as.numeric(if (is.null(args$multiplier)) 1.5 else args$multiplier)
    lo <- q[1] - mult * iqr; hi <- q[2] + mult * iqr
  } else {
    mu <- mean(sub)
    # Population sd (ddof = 0), matching numpy's default and the Python port.
    sd0 <- sqrt(sum((sub - mu)^2) / length(sub))
    if (sd0 == 0) sd0 <- 1
    thr <- as.numeric(if (is.null(args$threshold)) 3 else args$threshold)
    lo <- mu - thr * sd0; hi <- mu + thr * sd0
  }
  # Outliers become NA rather than being dropped: the column stays row-aligned with every
  # other column in the table, which removal would break.
  ifelse(is.finite(arr) & (arr < lo | arr > hi), NA_real_, arr)
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
tp_surrogatetest <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_in <- args$yIN
  if (is.list(y_in)) y_in <- if (length(y_in)) y_in[[1]] else -1
  if (is.null(y_in)) y_in <- -1
  if (x_in == -1 || y_in == -1) return(FALSE)
  if (is.null(env$cols[[as.character(x_in)]]) || is.null(env$cols[[as.character(y_in)]])) {
    return(FALSE)
  }
  times <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  values <- suppressWarnings(as.numeric(unlist(
    col_data(env$cols[[as.character(y_in)]], env$cols, env$raw_data), use.names = FALSE)))
  if (length(times) < 8 || length(values) < 8) return(FALSE)
  n <- min(length(times), length(values))
  ok <- is.finite(times[seq_len(n)]) & is.finite(values[seq_len(n)])
  ta <- times[seq_len(n)][ok]; ya <- values[seq_len(n)][ok]
  if (length(ta) < 8) return(FALSE)

  period_min <- as.numeric(if (is.null(args$periodMin)) 20 else args$periodMin)
  period_max <- as.numeric(if (is.null(args$periodMax)) 28 else args$periodMax)
  f <- compute_fft(ta, ya)
  best <- 0
  for (i in seq_along(f$frequencies)) {
    fr <- f$frequencies[i]
    if (fr == 0) next
    p <- 1 / fr
    if (p >= period_min && p <= period_max && f$magnitudes[i] > best) best <- f$magnitudes[i]
  }
  set_col(env, env$cols, out_id(args, "observed"), best, type = "number")
  set_col(env, env$cols, out_id(args, "pvalue"), NA_real_, type = "number")
  TRUE
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

# Lomb-Scargle: the classical form with the tau time-offset that makes the sine and cosine
# terms orthogonal on UNEVENLY sampled data. That offset is the whole point of the method —
# without it an uneven series leaks power between neighbouring periods.
lomb_scargle <- function(t, y, periods) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  y <- y - mean(y)
  # SAMPLE variance (n-1), matching periodogram.js:38 — R's var() default is already this.
  # The Python port used the POPULATION form until 2026-07-28 and inflated every power by
  # n/(n-1); the chi-squared periodogram below legitimately DOES use the population form
  # (periodogram.js:155), so the two methods differ on purpose and neither follows the other.
  vary <- var(y)
  if (!is.finite(vary) || vary == 0) vary <- 1
  vapply(periods, function(P) {
    w <- 2 * pi / P
    # tau, the offset that makes the sine and cosine bases orthogonal on unevenly sampled
    # data. Lomb (1976, Ap&SS 39:447) and Scargle (1982, ApJ 263:835):
    #     tan(2*w*tau) = sum(sin(2*w*t)) / sum(cos(2*w*t))
    # The sums run over 2*w. This port and the JS engine both previously summed over w while
    # still dividing by 2*w, which is some other offset that does not orthogonalise the
    # bases. Fixed in all three languages together; tp-rhythmicity-periodogram enforces it.
    two_w <- 2 * w
    tau <- if (w != 0) atan2(sum(sin(two_w * t)), sum(cos(two_w * t))) / two_w else 0
    cwt <- cos(w * (t - tau)); swt <- sin(w * (t - tau))
    den1 <- sum(cwt^2); den2 <- sum(swt^2)
    if (den1 > 0 && den2 > 0) {
      (sum(y * cwt)^2 / den1 + sum(y * swt)^2 / den2) / (2 * vary)
    } else 0
  }, numeric(1))
}

# Folding chi-squared periodogram, with the p = 0.05 threshold taken at a typical bin count.
chi_squared_pgram <- function(t, y, periods, dt) {
  t <- suppressWarnings(as.numeric(unlist(t, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  n <- length(y)
  ymean <- mean(y)
  vary <- sum((y - ymean)^2) / n
  if (vary == 0) vary <- 1
  powers <- vapply(periods, function(P) {
    nbins <- max(2, js_round(P / dt))
    b <- as.integer(t / dt) %% nbins
    sums <- numeric(nbins); counts <- numeric(nbins)
    for (i in seq_along(y)) {
      k <- b[i] + 1
      sums[k] <- sums[k] + y[i]; counts[k] <- counts[k] + 1
    }
    means <- ifelse(counts > 0, sums / pmax(counts, 1), 0)
    n * (sum((means - ymean)^2 * counts) / n) / vary
  }, numeric(1))
  df_mid <- max(2, js_round(median(periods) / dt)) - 1
  list(powers = powers, threshold = qchisq(0.95, df_mid))
}

# Binned-autocorrelation Enright periodogram (the simplified form the app uses).
enright_pgram <- function(t, y, periods, dt) {
  y <- suppressWarnings(as.numeric(unlist(y, use.names = FALSE)))
  y <- y - mean(y)
  vapply(periods, function(P) {
    lag <- js_round(P / dt)
    if (lag <= 0 || lag >= length(y)) return(0)
    a <- y[seq_len(length(y) - lag)]
    b <- y[(lag + 1):length(y)]
    den <- sqrt(sum(a * a) * sum(b * b))
    if (den > 0) sum(a * b) / den else 0
  }, numeric(1))
}

run_periodogram_calculation <- function(params) {
  t <- suppressWarnings(as.numeric(unlist(params$t, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(params$y, use.names = FALSE)))
  method <- if (is.null(params$method)) "Lomb-Scargle" else params$method
  p_min <- as.numeric(if (is.null(params$minPeriod)) 1 else params$minPeriod)
  p_max <- as.numeric(if (is.null(params$maxPeriod)) 48 else params$maxPeriod)
  step <- as.numeric(if (is.null(params$stepSize)) 0.1 else params$stepSize)
  periods <- make_seq_array(p_min, p_max, step)
  dt <- if (!is.null(params$dt) && is.finite(params$dt) && params$dt > 0) params$dt
        else median_dt(t)
  if (identical(method, "Lomb-Scargle")) {
    list(x = periods, y = lomb_scargle(t, y, periods), threshold = NULL)
  } else if (identical(method, "Chi-squared")) {
    r <- chi_squared_pgram(t, y, periods, dt)
    list(x = periods, y = r$powers, threshold = r$threshold)
  } else {
    list(x = periods, y = enright_pgram(t, y, periods, dt), threshold = NULL)
  }
}

compute_autocorrelation <- function(times, values, bin_size = NULL,
                                    max_lag = NULL, min_lag = 0) {
  t <- suppressWarnings(as.numeric(unlist(times, use.names = FALSE)))
  y <- suppressWarnings(as.numeric(unlist(values, use.names = FALSE)))
  n0 <- min(length(t), length(y))
  t <- t[seq_len(n0)]; y <- y[seq_len(n0)]
  ok <- is.finite(t) & is.finite(y)
  t <- t[ok]; y <- y[ok]
  n <- length(y)
  if (n < 2) return(list(lags = numeric(0), correlations = numeric(0), dt = 1))
  dt <- if (!is.null(bin_size)) as.numeric(bin_size) else median_dt(t)
  timespan <- t[length(t)] - t[1]
  max_lag_t <- if (!is.null(max_lag) && is.finite(max_lag) && max_lag > 0) as.numeric(max_lag)
               else timespan / 2
  min_lag_t <- if (!is.null(min_lag) && is.finite(min_lag) && min_lag > 0) as.numeric(min_lag)
               else 0
  if (min_lag_t >= max_lag_t) return(list(lags = numeric(0), correlations = numeric(0), dt = dt))
  n_lags <- min(floor(max_lag_t / dt), n %/% 2)
  start_idx <- ceiling(min_lag_t / dt)
  ymean <- mean(y)
  yvar <- sum((y - ymean)^2) / n
  if (yvar == 0) return(list(lags = numeric(0), correlations = numeric(0), dt = dt))
  diffs <- diff(t)
  med <- median(diffs)
  # "Uniform enough" within 10% of the median spacing takes the fast index-shift path; the
  # uneven path is O(n^2) and pairs samples by TIME difference instead, so a gappy record
  # still gets the right lags rather than lags that silently mean "index offset".
  is_uniform <- max(abs(diffs - med)) < med * 0.1
  lags <- c(); corrs <- c()
  ydem <- y - ymean
  if (is_uniform) {
    for (lag in seq(start_idx, n_lags)) {
      if (lag >= n) break
      a <- ydem[seq_len(n - lag)]; b <- ydem[(lag + 1):n]
      corrs <- c(corrs, if (length(a) > 0) sum(a * b) / (length(a) * yvar) else 0)
      lags <- c(lags, lag * dt)
    }
  } else {
    tol <- dt / 2
    for (li in seq(start_idx, n_lags)) {
      target <- li * dt
      s <- 0; count <- 0
      for (i in seq_len(n)) {
        for (j in seq_len(n)[-seq_len(i)]) {
          td <- t[j] - t[i]
          if (abs(td - target) <= tol) { s <- s + ydem[i] * ydem[j]; count <- count + 1 }
          if (td > target + tol) break
        }
      }
      corrs <- c(corrs, if (count > 0) s / (count * yvar) else 0)
      lags <- c(lags, target)
    }
  }
  list(lags = lags, correlations = corrs, dt = dt)
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
  hide_inputs <- isTRUE(args$hideInputs)
  t <- t_for_col(env$cols[[as.character(x_in)]], env$cols, env$raw_data)
  shared_x <- NULL; any_valid <- FALSE
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
        stepSize = pick("periodStep", "stepSize", 0.1)))
      if (hide_inputs) {
        if (is.null(shared_x)) {
          shared_x <- pg$x
          set_col(env, env$cols, out_id(args, "rhythmicityx"), pg$x, type = "number")
        }
        set_col(env, env$cols, out_id(args, paste0("rhythmicityy_", y_id)), pg$y, type = "number")
      } else {
        set_col(env, env$cols, out_id(args, paste0(y_id, "_period")), pg$x, type = "number")
        set_col(env, env$cols, out_id(args, paste0(y_id, "_power")), pg$y, type = "number")
        if (!is.null(pg$threshold)) {
          set_col(env, env$cols, out_id(args, paste0(y_id, "_threshold")),
                  rep(pg$threshold, length(pg$x)), type = "number")
        }
      }
    } else if (identical(analysis, "fft")) {
      f <- compute_fft(t, y)
      periods <- ifelse(f$frequencies != 0, 1 / f$frequencies, NA_real_)
      if (hide_inputs) {
        if (is.null(shared_x)) {
          shared_x <- periods
          set_col(env, env$cols, out_id(args, "rhythmicityx"), periods, type = "number")
        }
        set_col(env, env$cols, out_id(args, paste0("rhythmicityy_", y_id)),
                f$magnitudes, type = "number")
      } else {
        set_col(env, env$cols, out_id(args, paste0(y_id, "_frequency")),
                f$frequencies, type = "number")
        set_col(env, env$cols, out_id(args, paste0(y_id, "_period")), periods, type = "number")
        set_col(env, env$cols, out_id(args, paste0(y_id, "_magnitude")),
                f$magnitudes, type = "number")
        set_col(env, env$cols, out_id(args, paste0(y_id, "_phase")), f$phases, type = "number")
      }
    } else if (identical(analysis, "correlogram")) {
      ac <- compute_autocorrelation(
        t, y,
        min_lag = as.numeric(if (is.null(args$corrMinLag)) 0 else args$corrMinLag),
        max_lag = if (is.null(args$corrMaxLag)) NULL else args$corrMaxLag)
      if (hide_inputs) {
        if (is.null(shared_x)) {
          shared_x <- ac$lags
          set_col(env, env$cols, out_id(args, "rhythmicityx"), ac$lags, type = "number")
        }
        set_col(env, env$cols, out_id(args, paste0("rhythmicityy_", y_id)),
                ac$correlations, type = "number")
      } else {
        set_col(env, env$cols, out_id(args, paste0(y_id, "_lag")), ac$lags, type = "number")
        set_col(env, env$cols, out_id(args, paste0(y_id, "_correlation")),
                ac$correlations, type = "number")
      }
    }
    any_valid <- TRUE
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
tp_movinganalysis <- function(args, env) {
  x_in <- if (is.null(args$xIN)) -1 else args$xIN
  y_ins <- id_list(args$yIN)
  if (x_in == -1 || is.null(env$cols[[as.character(x_in)]]) || !length(y_ins)) return(FALSE)
  win <- as.numeric(if (is.null(args$windowSize)) 48 else args$windowSize)
  step <- as.numeric(if (is.null(args$stepSize)) 12 else args$stepSize)
  label <- if (is.null(args$binLabel)) "center" else args$binLabel
  analysis <- if (is.null(args$analysis)) "periodogram" else args$analysis
  x_col <- env$cols[[as.character(x_in)]]
  t_full <- t_for_col(x_col, env$cols, env$raw_data)
  pick <- function(a, b, d) if (!is.null(args[[a]])) args[[a]]
                            else if (!is.null(args[[b]])) args[[b]] else d

  movex <- NULL; any_valid <- FALSE
  for (y_id in y_ins) {
    yk <- as.character(y_id)
    if (is.null(env$cols[[yk]])) next
    ya <- suppressWarnings(as.numeric(unlist(col_data(env$cols[[yk]], env$cols, env$raw_data),
                                             use.names = FALSE)))
    n0 <- min(length(t_full), length(ya))
    ta <- t_full[seq_len(n0)]; ya <- ya[seq_len(n0)]
    ok <- is.finite(ta) & is.finite(ya)
    ta <- ta[ok]; ya <- ya[ok]
    if (length(ta) < 4) next

    # The 1e-9 slack decides whether a window ending exactly at the last sample is emitted;
    # without it floating-point drift drops the final window on tidy inputs.
    starts <- seq(min(ta), max(ta) - win + 1e-9, by = step)
    if (!length(starts) || is.na(starts[1])) next
    per_stat <- list(); x_labels <- c()

    for (s in starts) {
      e <- s + win
      # Half-open [s, e): a sample on the boundary belongs to exactly one window.
      m <- ta >= s & ta < e
      tw <- ta[m]; yw <- ya[m]
      if (length(tw) < 4) next
      x_labels <- c(x_labels, switch(label, start = s, end = e, (s + e) / 2))
      stats <- list()

      if (identical(analysis, "periodogram")) {
        pg <- run_periodogram_calculation(list(
          t = tw, y = yw,
          method = pick("pgMethod", "method", "Lomb-Scargle"),
          minPeriod = pick("periodMin", "minPeriod", 1),
          maxPeriod = pick("periodMax", "maxPeriod", win),
          stepSize = pick("periodStep", "stepPg", 0.1)))
        if (length(pg$y)) {
          i <- which.max(pg$y)
          stats$peak_period <- pg$x[i]; stats$peak_power <- pg$y[i]
        }
      } else if (identical(analysis, "cosinor")) {
        if (!identical(args$useFixedPeriod, FALSE)) {
          res <- fit_cosinor_fixed(tw, yw,
                                   as.numeric(if (is.null(args$fixedPeriod)) 24 else args$fixedPeriod),
                                   as.integer(if (is.null(args$nHarmonics)) 1 else args$nHarmonics))
          if (!is.null(res)) {
            stats$mesor <- res$M; stats$r2 <- res$R2
            stats$rmse <- res$RMSE; stats$pvalue <- res$pF
            for (h in res$harmonics) {
              stats[[paste0("H", h$k, "_amplitude")]] <- h$amplitude
              stats[[paste0("H", h$k, "_acrophase")]] <- h$acrophase_hrs
            }
            # rel_amplitude is NaN when the MESOR is ~0: a mean-centred signal has no
            # meaningful relative amplitude, and +/-Inf would poison every downstream plot.
            amp1 <- if (length(res$harmonics)) res$harmonics[[1]]$amplitude else NA_real_
            stats$rel_amplitude <- if (is.finite(res$M) && abs(res$M) > 1e-12 && is.finite(amp1))
              amp1 / res$M else NA_real_
          }
        } else {
          res <- fit_cosine_curves(tw, yw,
                                   as.integer(if (is.null(args$Ncurves)) 1 else args$Ncurves))
          if (!is.null(res)) {
            stats$r2 <- res$rSquared; stats$rmse <- res$rmse
            cs <- res$parameters$cosines
            for (k in seq_along(cs)) {
              stats[[paste0("C", k, "_period")]] <-
                if (cs[[k]]$frequency != 0) 1 / cs[[k]]$frequency else Inf
              stats[[paste0("C", k, "_amplitude")]] <- cs[[k]]$amplitude
              stats[[paste0("C", k, "_phase")]] <- cs[[k]]$phase
            }
          }
        }
      } else if (identical(analysis, "npcra")) {
        npc <- compute_npcra(tw, yw,
                             as.numeric(if (is.null(args$npcraEpochHours)) 1 else args$npcraEpochHours),
                             as.numeric(if (is.null(args$npcraPeriod)) 24 else args$npcraPeriod),
                             as.numeric(if (is.null(args$npcraMWindow)) 10 else args$npcraMWindow),
                             as.numeric(if (is.null(args$npcraLWindow)) 5 else args$npcraLWindow))
        if (!is.null(npc)) {
          for (k in c("IS", "IV", "RA", "L5", "M10", "M10onset")) {
            stats[[k]] <- if (is.null(npc[[k]])) NA_real_ else npc[[k]]
          }
        }
      } else if (identical(analysis, "fft")) {
        f <- compute_fft(tw, yw)
        if (length(f$magnitudes)) {
          # Skip bin 1 when picking the peak: it is the lowest resolvable frequency and on a
          # short window it carries the residual trend, not a rhythm.
          i <- if (length(f$magnitudes) > 1) which.max(f$magnitudes[-1]) + 1 else 1
          fr <- f$frequencies[i]
          stats$peak_frequency <- fr
          stats$peak_period <- if (fr != 0) 1 / fr else Inf
          stats$peak_magnitude <- f$magnitudes[i]
        }
      } else if (identical(analysis, "correlogram")) {
        ac <- compute_autocorrelation(
          tw, yw,
          min_lag = as.numeric(if (is.null(args$corrMinLag)) 0 else args$corrMinLag),
          max_lag = if (is.null(args$corrMaxLag)) NULL else args$corrMaxLag)
        if (length(ac$correlations)) {
          i <- which.max(ac$correlations)
          stats$peak_lag <- ac$lags[i]; stats$peak_correlation <- ac$correlations[i]
        }
      }

      for (k in names(stats)) {
        per_stat[[k]] <- c(per_stat[[k]], as.numeric(stats[[k]]))
      }
    }

    if (is.null(movex) && length(x_labels)) {
      movex <- x_labels
      set_col(env, env$cols, out_id(args, "movex"), movex,
              type = if (identical(x_col$type, "time")) "time" else "number")
    }
    for (k in names(per_stat)) {
      oid <- out_id(args, paste0(y_id, "_", k))
      if (oid != -1) {
        set_col(env, env$cols, oid, per_stat[[k]], type = "number")
        any_valid <- TRUE
      }
    }
  }
  any_valid
}


# Rolling-window statistics as flat arrays, one per stat key.
#
# Targets the pure windowing rather than tp_movinganalysis, because the JS node's per-stat
# output COLUMNS are created by its component reconcile and not by its `func` — so the
# table-process parity path cannot reach them. This is where the windowing and the per-window
# maths actually live, so checking it checks the thing that could be wrong.
#
# Note the window minimum here is 3 samples, NOT the 4 that tp_movinganalysis uses: the two
# were written against different call sites and the fixtures pin this one. Kept faithful
# rather than harmonised, since changing it would move the first window.
moving_windows <- function(times, values, opts = list()) {
  window <- as.numeric(if (is.null(opts$windowSize)) 168 else opts$windowSize)
  step <- as.numeric(if (is.null(opts$stepSize)) 24 else opts$stepSize)
  analysis <- if (is.null(opts$analysis)) "npcra" else opts$analysis
  ta <- suppressWarnings(as.numeric(unlist(times, use.names = FALSE)))
  ya <- suppressWarnings(as.numeric(unlist(values, use.names = FALSE)))
  n0 <- min(length(ta), length(ya))
  ta <- ta[seq_len(n0)]; ya <- ya[seq_len(n0)]
  ok <- is.finite(ta) & is.finite(ya)
  ta <- ta[ok]; ya <- ya[ok]

  starts <- c(); s <- min(ta); hi <- max(ta)
  while (s <= hi - window + 1e-9) { starts <- c(starts, s); s <- s + step }

  n_h <- as.integer(if (is.null(opts$nHarmonics)) 1 else opts$nHarmonics)
  keys <- if (identical(analysis, "npcra")) {
    c("IS", "IV", "RA", "L5", "M10", "M10onset")
  } else if (identical(analysis, "cosinor")) {
    c("mesor", as.vector(rbind(paste0("H", seq_len(n_h), "_amplitude"),
                               paste0("H", seq_len(n_h), "_acrophase"))),
      "rel_amplitude", "r2", "rmse", "pvalue")
  } else {
    stop(sprintf("moving_windows: unsupported analysis '%s'", analysis))
  }

  out <- setNames(lapply(keys, function(k) numeric(0)), keys)
  for (st in starts) {
    m <- ta >= st & ta < st + window
    tw <- ta[m]; yw <- ya[m]
    stats <- setNames(as.list(rep(NA_real_, length(keys))), keys)
    if (length(tw) >= 3) {
      if (identical(analysis, "npcra")) {
        npc <- compute_npcra(tw, yw,
                             as.numeric(if (is.null(opts$npcraEpochHours)) 1 else opts$npcraEpochHours),
                             as.numeric(if (is.null(opts$npcraPeriod)) 24 else opts$npcraPeriod),
                             as.numeric(if (is.null(opts$npcraMWindow)) 10 else opts$npcraMWindow),
                             as.numeric(if (is.null(opts$npcraLWindow)) 5 else opts$npcraLWindow))
        if (!is.null(npc)) for (k in keys) {
          stats[[k]] <- if (is.null(npc[[k]])) NA_real_ else as.numeric(npc[[k]])
        }
      } else {
        res <- fit_cosinor_fixed(tw, yw,
                                 as.numeric(if (is.null(opts$fixedPeriod)) 24 else opts$fixedPeriod),
                                 n_h)
        if (!is.null(res)) {
          stats$mesor <- res$M; stats$r2 <- res$R2
          stats$rmse <- res$RMSE; stats$pvalue <- res$pF
          for (h in res$harmonics) {
            stats[[paste0("H", h$k, "_amplitude")]] <- h$amplitude
            stats[[paste0("H", h$k, "_acrophase")]] <- h$acrophase_hrs
          }
          amp1 <- if (length(res$harmonics)) res$harmonics[[1]]$amplitude else NA_real_
          stats$rel_amplitude <- if (is.finite(res$M) && abs(res$M) > 1e-12 && is.finite(amp1))
            amp1 / res$M else NA_real_
        }
      }
    }
    for (k in keys) out[[k]] <- c(out[[k]], stats[[k]])
  }
  out$starts <- starts
  out
}

# ---------------------------------------------------------------------------
# GroupComparison
# ---------------------------------------------------------------------------
#
# Returns a RESULT OBJECT rather than writing output columns — the node feeds the UI, and
# nodeSpec.outputs is empty. The parity harness compares named fields instead of arrays,
# which is why its fixtures use the `tableProcessResult` kind.

gc_mean <- function(a) if (!length(a)) NA_real_ else mean(a)

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
    if (is.null(g_raw) || is.null(y_raw)) next
    if (length(g_raw) != 1 || length(y_raw) != 1) next
    if (is.atomic(g_raw) && is.na(g_raw)) next
    yv <- suppressWarnings(as.numeric(y_raw))
    if (!is.finite(yv)) next
    g <- as.character(g_raw)
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
  list(valid = TRUE, difference = diff, t = t, df = df, pValue = p_value,
       se = se, ciLow = diff - ci_half, ciHigh = diff + ci_half)
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
  f <- if (ms_within == 0) { if (ms_between == 0) 0 else Inf } else ms_between / ms_within
  list(valid = TRUE, f = f, ssBetween = ss_between, ssWithin = ss_within,
       dfBetween = df_between, dfWithin = df_within,
       msBetween = ms_between, msWithin = ms_within,
       etaSquared = if ((ss_between + ss_within) > 0) ss_between / (ss_between + ss_within) else NA_real_,
       pValue = gc_p_upper_from_f(f, df_between, df_within))
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

gc_run_selected <- function(groups, chosen, alpha) {
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

  # Boxplot-like fallback: several Y columns and NO group column means each column IS a group.
  if (is.null(group_col) && length(y_ins) > 1) {
    groups <- lapply(y_ins, function(y) {
      c1 <- env$cols[[as.character(y)]]
      v <- suppressWarnings(as.numeric(unlist(col_data(c1, env$cols, env$raw_data),
                                              use.names = FALSE)))
      v <- v[is.finite(v)]
      list(name = if (is.null(c1$name)) as.character(y) else c1$name,
           values = v, n = length(v), mean = gc_mean(v), sd = gc_sample_std(v))
    })
    comp <- gc_run_selected(groups, gc_resolve_method(mode, length(groups)), alpha)
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
    comp <- gc_run_selected(groups, gc_resolve_method(mode, length(groups)), alpha)
    nm <- env$cols[[yk]]$name
    out[[yk]] <- c(list(columnName = if (is.null(nm)) yk else nm), comp)
    if (isTRUE(comp$valid)) any_valid <- TRUE
  }
  list(result = out, anyValid = any_valid)
}

# The node writes no output columns; the pipeline only needs the anyValid flag. The numbers
# are still computed so the algorithm is exercised, and compute_group_comparison is what the
# parity harness calls for the detail.
tp_groupcomparison <- function(args, env) {
  isTRUE(compute_group_comparison(args, env)$anyValid)
}

# ---------------------------------------------------------------------------
# Deterministic source nodes
# ---------------------------------------------------------------------------
#
# SequenceColumn and BlankColumn look like "generator" nodes and are NOT: neither draws from
# a PRNG. A sequence is start + i*step and a blank column is a constant fill, so both
# reproduce exactly in any language. Only Random and SimulatedData need the JS PRNG, and only
# those are out of scope for R.

tp_sequencecolumn <- function(args, env) {
  kind <- if (!is.null(args$seqType)) args$seqType
          else if (!is.null(args$kind)) args$kind else "number"
  n <- as.integer(if (!is.null(args$count)) args$count
                  else if (!is.null(args$rows)) args$rows else 100)
  if (is.na(n) || n <= 0) return(FALSE)
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

# Pure kernels the parity harness can call by name, keyed by the fixture's `rFunc` (which
# sits beside the existing `pyFunc`, so both legs read one fixture file).
#
# Referenced directly rather than wrapped in adapters: the fixtures already describe how to
# build the call — `argRefs`/`valuesRef` name the inputs and `pyArgs`/`rArgs` supply the rest
# — so the harness assembles positional arguments the same way for every kernel. Per-kernel
# adapters would be a second, hand-maintained copy of that contract, and would drift.
PURE_UTIL_MAP <- list(
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
  d_agostino     = d_agostino,
  shapiro_wilk   = shapiro_wilk,
  qq_points      = qq_points,
  qq_correlation = qq_correlation,
  correlate      = correlate,
  p_adjust       = p_adjust,
  rayleigh_test  = rayleigh_test
)

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
  groupcomparison = tp_groupcomparison,
  chisquared = tp_chisquared,
  circadianfunctionindex = tp_circadianfunctionindex,
  correlation = tp_correlation,
  crosscorrelation = tp_crosscorrelation,
  interpolate = tp_interpolate,
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
      if (any(ok)) {
        fmt <- .strptime_from_dayjs(col$time_format)
        p <- NULL
        if (!is.null(fmt)) {
          p <- suppressWarnings(as.POSIXct(v[ok], tz = "UTC", format = fmt))
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
