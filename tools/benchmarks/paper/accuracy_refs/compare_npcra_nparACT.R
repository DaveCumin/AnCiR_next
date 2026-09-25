# Study C (NPCRA): run the R package nparACT (Blume et al. 2016) on the byte-identical
# minute-resolution inputs exported by C_export_reference_inputs.bench.test.js.
#
# Run from the repo root:
#   Rscript tools/benchmarks/paper/accuracy_refs/compare_npcra_nparACT.R
# Writes results/accuracy/C_npcra_nparACT.csv (merged with AnCiR values by the Python script).
#
# Notes on nparACT 0.9.1 behaviour relevant to the comparison (read from its source):
#  - IS/IV use hourly means (bin_hr = 60), as AnCiR does at epochHours = 1.
#  - L5/M10 use sliding 1-min windows over the 1440-min average day, i.e. MINUTE resolution.
#  - All outputs are rounded to 2 decimals (so |diff| <= 0.005 is rounding only).
#  - With fulldays = TRUE the record is truncated to whole days (inputs here are whole days).
suppressPackageStartupMessages(library(nparACT))

args <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", args[grep("^--file=", args)])
here <- if (length(file_arg)) dirname(normalizePath(file_arg)) else "tools/benchmarks/paper/accuracy_refs"
res_dir <- file.path(here, "..", "results", "accuracy")
in_dir <- file.path(res_dir, "C_npcra_inputs")

files <- sort(list.files(in_dir, pattern = "\\.csv$", full.names = TRUE))
out <- list()
for (f in files) {
  d <- read.csv(f)
  start <- as.POSIXct("2024-01-01 00:00:00", tz = "UTC")
  npar_input <- data.frame(time = start + d$minute * 60, activity = d$count)
  assign("npar_input", npar_input, envir = globalenv())
  r <- nparACT_base("npar_input", SR = 1 / 60, cutoff = 1, plot = FALSE, fulldays = TRUE)
  out[[length(out) + 1]] <- data.frame(
    name = sub("\\.csv$", "", basename(f)),
    IS = r$IS, IV = r$IV, RA = r$RA, L5 = r$L5, M10 = r$M10,
    L5_starttime = as.character(r$L5_starttime), M10_starttime = as.character(r$M10_starttime)
  )
}
res <- do.call(rbind, out)
write.csv(res, file.path(res_dir, "C_npcra_nparACT.csv"), row.names = FALSE)
cat("R:", R.version.string, "\n")
cat("nparACT:", as.character(packageVersion("nparACT")), "\n")
print(res)
