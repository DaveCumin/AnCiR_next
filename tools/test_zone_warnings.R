# R port: a zoned column's daylight-saving warnings (utils/time/dstCountWarnings.js,
# printed by col_data through node_warning) come once per column per LOAD of a session, as the
# app warns once per column each time a session is loaded and the Python port once per Column
# object (tools/test_zone_warnings.py). Plan ClaudeNotes/AnCiR/2026-10-20-per-column-timezone-plan.md,
# section 5f. The texts themselves are pinned by the `clockZone` parity fixtures.
#
#   Rscript tools/test_zone_warnings.R
#
# Exit status is 1 if any check fails.

root <- dirname(dirname(normalizePath(sub("^--file=", "",
  grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)[1]))))
if (is.na(root) || !nzchar(root)) root <- getwd()
source(file.path(root, "tools", "ancir_runtime.R"))

GAP_TEXT <- c("2024-09-29 01:00", "2024-09-29 01:30", "2024-09-29 02:00", "2024-09-29 02:30",
              "2024-09-29 03:00", "2024-09-29 03:30")
SKIPPED <- paste0(
  'Column "logger": 2 times fall in the hour skipped when daylight saving began in ',
  "Pacific/Auckland, so they do not exist there; they are moved forward by the change ",
  "(02:30 reads 03:30 after a 1 h change). This logger may not follow daylight saving: ",
  "try a fixed offset.")

# One load of a session, as an exported script's main() builds it: new_column() for each
# column, then every reader of the columns (here, two reads of each and a reference to one).
load_session <- function() {
  raw <- list("1" = GAP_TEXT, "2" = GAP_TEXT)
  cols <- list(
    "1" = new_column(id = 1, name = "logger", type = "time", data = 1,
                     time_format = "YYYY-MM-DD HH:mm", time_zone = "Pacific/Auckland"),
    "2" = new_column(id = 2, name = "logger 2", type = "time", data = 2,
                     time_format = "YYYY-MM-DD HH:mm", time_zone = "Pacific/Auckland"),
    "3" = new_column(id = 3, name = "ref", type = "time", ref_id = 1))
  for (cid in c("1", "1", "2", "2", "3")) col_data(cols[[cid]], cols, raw)
  invisible(cols)
}

collect_warnings <- function(expr) {
  got <- character(0)
  withCallingHandlers(expr, warning = function(w) {
    got <<- c(got, conditionMessage(w))
    invokeRestart("muffleWarning")
  })
  got
}

n_fail <- 0
check <- function(label, ok) {
  cat(sprintf("%s  %s\n", if (isTRUE(ok)) "PASS" else "FAIL", label))
  if (!isTRUE(ok)) n_fail <<- n_fail + 1
}

first <- collect_warnings(load_session())
check("one load warns once per column (two columns, each read twice, plus a reference)",
      identical(first, c(SKIPPED, sub('"logger"', '"logger 2"', SKIPPED, fixed = TRUE))))
second <- collect_warnings(load_session())
check("loading the session again in the same R process warns again", identical(second, first))
both <- collect_warnings({ load_session(); load_session() })
check("two loads in one call: each warns once per column", length(both) == 4 &&
        sum(both == SKIPPED) == 2)

cat(sprintf("\n%d failed\n", n_fail))
quit(status = if (n_fail > 0) 1 else 0)
