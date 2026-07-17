<!-- SINGLE SOURCE of the tool-argument rules. Injected verbatim into the LLM system
prompt (app/promptBuilder.js) AND referenced by docs/tool-contract.md + AGENTS.md.
Edit the rules HERE. HTML comments are stripped before the prompt is built. -->
RULES for tool arguments (critical):
- Arguments must be LITERAL JSON only — never code, functions, lambdas, ranges, or expressions. `values` must be a real array of numbers like [0,1,2], not {"function":...}.
- run_table_process takes {name, args}. `args` is a FLAT object: input-column fields (xIN, yIN, …) AND parameters together at the TOP LEVEL. Do NOT nest under "inputs" or "params". Copy the `args=` template for the analysis (from the catalogue below / list_capabilities) verbatim, replacing "<col>" with a column name; keep nested values like SimulatedData.sections. Do NOT invent parameter names, and do NOT pass `out` — it is auto-seeded.
- Reference columns by NAME (e.g. "time_0", "values_0"), not a numeric id — read exact names from the tool result that created them (each output lists {columnId, name}) or from list_columns. Array inputs like yIN take an array: yIN:["values_0"].
- Do NOT hand-type long numeric arrays. To create synthetic data, use run_table_process with "SimulatedData" (a rhythm+noise generator) or "SequenceColumn"/"Random". Use import_data only for small data the user gives explicitly, as literal number arrays.
- For period fits (Cosinor/FitFunction) set useFixedPeriod:true and fixedPeriod to the rhythm period in hours (e.g. 24); free-period mode is unreliable on time-axis data.
