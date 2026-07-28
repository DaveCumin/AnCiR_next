# R leg of the JS <-> Python <-> R parity harness.
#
# Reads the SAME two files the Python leg reads:
#   tools/parity/fixtures.json    language-neutral cases (process + args + which outputs to compare)
#   tools/parity/js_results.json  what the real JS engine produced, INCLUDING its inputs
#
# That second point is what makes an R leg cheap. js_results.json stores {input, outputs} per
# fixture, so R consumes the exact seeded inputs the JS emitter used rather than regenerating
# them. There is no need to reimplement mulberry32 or the rhythm generator in R, and no risk
# of the three languages silently disagreeing about their *inputs* rather than their maths.
#
# Usage (after regenerating the JS side):
#   GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js
#   Rscript tools/test_parity.R
#
# Exit status is 1 if any fixture fails, so it can be wired into a build.

suppressWarnings(suppressMessages(library(jsonlite)))

root <- dirname(dirname(normalizePath(sub("^--file=", "",
  grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]))))
if (is.na(root) || !nzchar(root)) root <- getwd()

source(file.path(root, "tools", "ancir_runtime.R"))

fixtures_path <- file.path(root, "tools", "parity", "fixtures.json")
js_path <- file.path(root, "tools", "parity", "js_results.json")

if (!file.exists(js_path)) {
  cat("js_results.json missing. Regenerate the JS side first:\n")
  cat("  GEN_PARITY=1 npx vitest run src/lib/_parity/emitParity.svelte.test.js\n")
  quit(status = 1)
}

fixtures <- fromJSON(fixtures_path, simplifyVector = FALSE)
if (!is.null(fixtures$fixtures)) fixtures <- fixtures$fixtures
js <- fromJSON(js_path, simplifyVector = FALSE)

# Default tolerance matches the Python leg's; a fixture may set its own.
DEFAULT_TOL <- 1e-9

# The emitter records each input as {type, values} rather than a bare array, so that a
# fixture can say how a column was built as well as what it held. Only the values matter
# here; the wrapper is metadata for the JS side.
unwrap_input <- function(v) {
  if (is.null(v)) return(NULL)
  if (is.list(v) && !is.null(v$values)) return(as_num_vec(v$values))
  as_num_vec(v)
}

# unlist() DROPS NULL elements, so a JSON array containing nulls comes back SHORTER than it
# was. A trailing empty bin (JS null) then made a 41-element result look like 40, and a null
# in the middle would have shifted every later index and compared the wrong pairs. Nulls are
# real results here — "this bin had no data" — so they must survive as NA.
as_num_vec <- function(v) {
  if (is.null(v)) return(numeric(0))
  if (!is.list(v)) return(v)
  vapply(v, function(e) {
    if (is.null(e) || length(e) != 1) return(NA_real_)
    n <- suppressWarnings(as.numeric(e))
    if (length(n) != 1) NA_real_ else n
  }, numeric(1), USE.NAMES = FALSE)
}

# Compare one scalar. Two NaNs agree — "this statistic is undefined here" is a real,
# intentional result in these kernels (n < 3, a constant column), not a missing answer.
cmp_scalar <- function(got, want, tol) {
  if (is.null(got)) got <- NA_real_
  if (is.null(want)) want <- NA_real_
  got <- suppressWarnings(as.numeric(got)); want <- suppressWarnings(as.numeric(want))
  if (length(got) != 1) got <- NA_real_
  if (length(want) != 1) want <- NA_real_
  if (is.na(got) && is.na(want)) return(TRUE)
  if (is.na(got) || is.na(want)) return(FALSE)
  abs(got - want) <= tol + tol * abs(want)
}

# Run a table-process fixture: build the columns its `inputs` describe, run the analysis
# through the real dispatcher, and read back the output columns. Mirrors what
# tools/test_parity.py does, so the two legs exercise the same path rather than R getting an
# easier one through a bespoke shortcut.
run_tp_fixture <- function(fx, rec) {
  env <- new.env()
  env$raw_data <- list()
  env$cols <- list()
  ref_to_id <- list()
  next_id <- 1

  for (nm in names(rec$inputs)) {
    spec <- rec$inputs[[nm]]
    vals <- unwrap_input(spec)
    id <- next_id; next_id <- next_id + 1
    ref_to_id[[nm]] <- id
    env$raw_data[[as.character(id)]] <- vals
    env$cols[[as.character(id)]] <- new_column(
      id = id, name = nm,
      type = if (!is.null(spec$type)) spec$type else "number",
      data = id)
  }

  # Resolve "@ref" argument tokens to the column ids just created, and mint a real column
  # for every declared `out` key so the analysis has somewhere to write.
  resolve <- function(v) {
    if (is.character(v) && length(v) == 1 && startsWith(v, "@")) {
      r <- substring(v, 2)
      return(if (!is.null(ref_to_id[[r]])) ref_to_id[[r]] else -1)
    }
    if (is.list(v)) return(lapply(v, resolve))
    v
  }
  args <- lapply(fx$args, resolve)

  # The JS engine auto-allocates output columns; the runtimes read ids from args$out. So
  # register BOTH a static key (e.g. "cosinorx") and a per-y dynamic key (e.g.
  # "cosinory_<yid>") for every compared output, and read back whichever the analysis chose
  # to write. This mirrors run_table_process() in test_parity.py exactly — R must be put
  # through the same path as Python, not an easier one that happens to suit its port.
  y_ids <- args$yIN
  if (is.null(y_ids)) y_ids <- list()
  if (!is.list(y_ids)) y_ids <- as.list(y_ids)
  if (is.null(args$out)) args$out <- list()
  out_pairs <- list()
  for (k in unlist(fx$compareOutputs, use.names = FALSE)) {
    static_id <- 1000 + next_id
    dyn_id <- 2000 + next_id
    next_id <- next_id + 1
    args$out[[k]] <- static_id
    for (yid in y_ids) {
      args$out[[paste0(k, "_", yid)]] <- dyn_id
      # Split names its outputs the other way round, "<yId>_<segment>"
      # (Split.svelte:103), so register that form too or it is untestable.
      args$out[[paste0(yid, "_", k)]] <- dyn_id
    }
    env$cols[[as.character(static_id)]] <- new_column(id = static_id, name = k, data = static_id)
    env$cols[[as.character(dyn_id)]] <- new_column(id = dyn_id, name = paste0(k, "_dyn"),
                                                   data = dyn_id)
    out_pairs[[k]] <- c(static_id, dyn_id)
  }

  ok <- run_table_process(fx$jsName, args, env)
  outs <- list()
  for (k in names(out_pairs)) {
    dyn <- env$raw_data[[as.character(out_pairs[[k]][2])]]
    outs[[k]] <- unlist(if (!is.null(dyn) && length(dyn)) dyn
                        else env$raw_data[[as.character(out_pairs[[k]][1])]],
                        use.names = FALSE)
  }
  outs
}

results <- list()
n_pass <- 0; n_fail <- 0; n_skip <- 0

for (fx in fixtures) {
  rfunc <- fx$rFunc
  # No rFunc means this fixture is not claimed by the R port yet. Silence here is the
  # point: the R leg reports what it covers, and runtimeCoverage.test.js is what stops the
  # uncovered set from being forgotten.
  if (is.null(rfunc)) { n_skip <- n_skip + 1; next }

  is_tp <- identical(fx$kind, "tableProcess")
  is_cp <- identical(fx$kind, "columnProcess")
  fn <- if (is_tp) TABLE_PROCESS_MAP[[rfunc]]
        else if (is_cp) COLUMN_PROCESS_MAP[[rfunc]]
        else PURE_UTIL_MAP[[rfunc]]
  if (is.null(fn)) {
    n_fail <- n_fail + 1
    results[[length(results) + 1]] <- list(id = fx$id, ok = FALSE,
      msg = sprintf("fixture names rFunc '%s', which ancir_runtime.R does not define", rfunc))
    next
  }

  rec <- js[[fx$id]]
  if (is.null(rec)) {
    n_fail <- n_fail + 1
    results[[length(results) + 1]] <- list(id = fx$id, ok = FALSE,
      msg = "no JS result recorded for this fixture")
    next
  }

  # `rTolerance` lets a fixture be looser for R ALONE. Widening the shared `tolerance`
  # would quietly weaken the Python leg too, and the Python leg passes at the strict value —
  # a known R-vs-scipy tail difference is not a reason to stop checking Python closely.
  tol <- if (!is.null(fx$rTolerance)) fx$rTolerance
         else if (!is.null(fx$tolerance)) fx$tolerance
         else DEFAULT_TOL

  # Build the call the way the fixture describes it, exactly as the Python leg does:
  # `argRefs` (or the single `valuesRef`) name inputs to pass positionally, then `rArgs`
  # (falling back to `pyArgs`, since the two ports take the same arguments) supply the rest.
  refs <- if (!is.null(fx$argRefs)) unlist(fx$argRefs) else fx$valuesRef
  extra <- if (!is.null(fx$rArgs)) fx$rArgs else fx$pyArgs
  call_args <- c(lapply(refs, function(nm) unwrap_input(rec$inputs[[nm]])),
                 if (is.null(extra)) list() else extra)

  got <- if (is_tp) tryCatch(run_tp_fixture(fx, rec), error = function(e) e)
         # A column process is a bare array -> array; the emitter records the input at the
         # TOP level (rec$input, not rec$inputs) and names the result "value".
         else if (is_cp) tryCatch(
           list(value = run_column_process(rfunc, unlist(rec$input, use.names = FALSE),
                                           fx$args, list(), list())),
           error = function(e) e)
         else tryCatch(do.call(fn, call_args), error = function(e) e)
  if (inherits(got, "error")) {
    n_fail <- n_fail + 1
    results[[length(results) + 1]] <- list(id = fx$id, ok = FALSE,
      msg = sprintf("R threw: %s", conditionMessage(got)))
    next
  }

  want <- rec$outputs
  bad <- character(0)
  for (k in names(want)) {
    w <- want[[k]]
    g <- got[[k]]
    if (is.list(w) || length(as_num_vec(w)) > 1) {
      wv <- as_num_vec(w); gv <- as_num_vec(g)
      if (length(gv) != length(wv)) {
        bad <- c(bad, sprintf("%s: length %d, expected %d", k, length(gv), length(wv)))
        next
      }
      for (i in seq_along(wv)) {
        if (!cmp_scalar(gv[i], wv[i], tol)) {
          bad <- c(bad, sprintf("%s[%d]: %s vs %s", k, i, format(gv[i]), format(wv[i])))
          break
        }
      }
    } else if (!cmp_scalar(g, w, tol)) {
      bad <- c(bad, sprintf("%s: %s vs %s", k, format(g), format(w)))
    }
  }

  if (length(bad)) {
    n_fail <- n_fail + 1
    results[[length(results) + 1]] <- list(id = fx$id, ok = FALSE,
      msg = paste(bad, collapse = "; "))
  } else {
    n_pass <- n_pass + 1
    results[[length(results) + 1]] <- list(id = fx$id, ok = TRUE, msg = "")
  }
}

for (r in results) {
  if (r$ok) cat(sprintf("PASS  %s\n", r$id))
  else cat(sprintf("FAIL  %s\n        %s\n", r$id, r$msg))
}
cat(sprintf("\n%d passed, %d failed, %d not claimed by the R port\n", n_pass, n_fail, n_skip))
quit(status = if (n_fail > 0) 1 else 0)
