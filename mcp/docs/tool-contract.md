# Tool contract — building an AnCiR session

How to generate **correct** MCP tool calls. The engine is now forgiving (it flattens,
coerces, name-resolves, auto-seeds), but generating clean calls avoids wasted turns.

## Build order

`create_session` → build data → analyses (`run_table_process`) → transforms
(`add_column_process`) → plots (`add_plot`) → `export_session`. Then open the exported
JSON in AnCiR (the app does this via `?loadFromURL=`).

## The tools

| Tool                 | Args                                              | Returns                                                                                                                                       |
| -------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_capabilities`  | —                                                 | `{analyses[], transforms[], plots[]}` with per-item `inputs`, `params` (defaults), `outKeys`, `status`. **Call this first for exact shapes.** |
| `create_session`     | `{id?}`                                           | `{created, id}` (resets the session)                                                                                                          |
| `import_data`        | `{columns:[{name, type?, values[], time_zone?}]}` | `{added:[{id,name,type,time_zone?}]}`                                                                                                         |
| `list_columns`       | none                                              | `{columns:[{id,name,type,length, time_zone?, times?, zone_from?}]}`                                                                           |
| `run_table_process`  | `{name, args}`                                    | `{name, valid, outputs:[{key,columnId,name,type,length,preview}], fit?, stats?, error?}`                                                      |
| `add_column_process` | `{columnId, name, args?}`                         | `{columnId, processId, name, length, preview}`                                                                                                |
| `add_plot`           | `{type, inputs}`                                  | `{plotId, type, name, inputs}`                                                                                                                |
| `render_plot`        | `{type, inputs, path, width?, height?}`           | `{png, svg, pngBytes, svgBytes}` (needs headless Chromium; not needed to build a session)                                                     |
| `export_session`     | `{path?}`                                         | JSON string, or `{written, bytes}` when `path` given                                                                                          |

## Rules — single source: [`../app/prompts/tool-rules.md`](../app/prompts/tool-rules.md)

The tool-argument rules are canonical in **`app/prompts/tool-rules.md`** — the exact text
injected into the model's system prompt (`app/promptBuilder.js`). **Read that file; don't
rely on a copy.** In one line each:

- **`run_table_process.args` is FLAT** — input fields (`xIN`, `yIN`, …) + params at the
  top level; never nest under `inputs`/`params`; literal JSON only.
- **Reference columns by NAME** (`"time_0"`), not id — from a result's `outputs[].name` or
  `list_columns`; array inputs like `yIN` take an array.
- **Never pass `out`** — auto-seeded (fixed + dynamic keys).
- **Omitted params take the node's defaults**, as a node added in the app does (`null` counts as
  omitted): e.g. Bin Data without `binStart` starts at 0 h. A free-period fit with no range
  searches 1 to 30 h on a time x (the Nyquist period to the record span on a number x), and a
  binned periodogram's `pgBinSize` is the median sampling interval.
- **Generate data** with `SimulatedData`/`SequenceColumn`/`Random`; don't type big arrays.
- **Cosinor/FitFunction:** `useFixedPeriod:true` + `fixedPeriod` (hours) for known rhythms.

Doc-only facts (not in the prompt, but agents should know):

- **Time columns and zones.** A `time` column takes epoch ms or ISO 8601 text
  (`2024-04-01T13:00:00`, seconds and milliseconds optional, optionally ending in `Z` or an
  offset such as `+13:00`); other text is refused. `time_zone` says where the clock was: an IANA
  name (`Pacific/Auckland`, follows daylight saving), a fixed offset (`+12:00`) or `utc` (the
  default). It is stored as the app stores it (nothing for `utc`). Text with no offset is read in
  that zone (the repeated and skipped hours of a daylight-saving change as the app reads them);
  epoch ms and text with an offset keep their instants, and the zone only names their clock (day
  starts, hour of day, clock phase). An unknown zone, or a zone on a non-time column, refuses the
  whole call. `list_columns` reports each time column's `time_zone`, `times` (`as written`: text
  with no zone kept in UTC; `wall clock`: text with no zone read in its zone; `instants`) and,
  for an output, `zone_from` (the column it inherits the zone from).
- **Analyses persist as nodes only via `run_table_process`** (no separate "just compute"
  tool) — it also returns `fit` (Cosinor/FitFunction) and `stats` (GroupComparison).
- **Get exact per-analysis shapes at runtime** from `list_capabilities` (22 analyses;
  params drift, so no static list here).

## Column reference / input fields per plot

`add_plot.inputs` field names come from `list_capabilities().plots[].inputs`:
scatterplot/boxplot → `{x, y}`; actogram/periodogram/correlogram/fft → `{time, values}`;
histogram → `{column}`; tableplot → an array of column names/ids.

## Worked example (what a correct sequence looks like)

```jsonc
create_session { "id": "demo" }

// generate 2 days of a 24 h rhythm (outputs columns time_0, values_0)
run_table_process {
  "name": "SimulatedData",
  "args": { "startTime": "2024-01-01T00:00:00.000Z",
            "sections": [{ "duration_hours": 48, "rhythmPeriod_hours": 24,
              "rhythmPhase_hours": 0, "rhythmAmplitude": 100,
              "noiseEnabled": true, "noiseMode": "add", "noiseAmplitude": 20 }],
            "samplingPeriod_hours": 0.25 } }

// fit — reference the columns by NAME; fixed period; result has `fit`
run_table_process {
  "name": "Cosinor",
  "args": { "xIN": "time_0", "yIN": ["values_0"],
            "useFixedPeriod": true, "fixedPeriod": 24, "nHarmonics": 1 } }

add_plot { "type": "scatterplot", "inputs": { "x": "time_0", "y": "values_0" } }
export_session { "path": "/tmp/demo.json" }
```

## Dynamic-output analyses (auto-handled — informational)

`RhythmicityAnalysis`, `MovingAnalysis`, `Split`, `CollectColumns`, `StoredValueGroup`,
`Duplicate`, `LongToWide` produce keys derived from inputs (per-Y, per-segment,
per-category). The engine synthesises `out` for these — just supply the inputs/params.

## Failure behaviour

A `run_table_process` that fails/returns invalid comes back `{valid:false, error}` and
its node/columns are **removed** from the session (so a broken node can't crash the GUI
on load). Fix the args (per `list_capabilities`) and retry.
