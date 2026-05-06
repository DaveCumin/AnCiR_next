# Implementation Summary: Stats-to-Boxplot with Full Reactivity

## Executive Summary

Your goal is to enable Cosinor stats (amplitude, phase, period, mesor, p-values, CI, etc.) to be plotted in boxplots and undergo statistical testing (t-test, ANOVA) while maintaining full reactive updates when input data changes.

**The optimal approach** uses a **4-layer composable architecture** that extends existing infrastructure:

1. **Cosinor stat export** - Create individual stat columns (like MovingAnalysis does)
2. **StatsByCategory** - Reshape stats for grouping/comparison (optional)
3. **Statistical testing** - Perform t-tests and ANOVA on stat distributions
4. **Boxplot integration** - Plot stats with one-click testing (near-free)

---

## Why This Approach is Optimal

### ✅ Strengths

| Criterion                    | Why It Works                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------- |
| **Reuses Existing Patterns** | Column output matching MovingAnalysis; reactivity via $effect already proven |
| **True Composability**       | Stat columns are regular columns; can feed to any plot or downstream TP      |
| **Full Reactivity**          | Hash-based $effect; no polling; auto-cascades through plots                  |
| **Backward Compatible**      | Toggle feature; doesn't breaking existing Cosinor usage                      |
| **UI-Light**                 | Leverages existing plot components; minimal new UI                           |
| **Testable**                 | Each layer independent; can unit test stat extraction and stat functions     |
| **Production-Ready**         | Follows established design patterns in your codebase                         |

### Alternative Approaches (Why Not)

| Approach                              | Problem                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| Store all stats in single JSON column | Not plottable; can't subset/filter stats individually           |
| Ad-hoc button "export stats as CSV"   | Manual workflow; no reactivity; not composable                  |
| Create nested plot inside Cosinor     | Violates separation of concerns; hard to test                   |
| Use column processes for stats        | Stats computed per-row; need Y-level aggregation, not row-level |

---

## 4-Layer Implementation Plan

### Layer 1: Cosinor Stat Columns (PHASE 1 - Priority 100%)

**Changes**: Modify `src/lib/tableProcesses/Cosinor.svelte`

**Key Points**:

- Add `getCosinorStatKeys(args)` helper (extract stat names based on mode)
- Create output columns for each stat (using existing `core.rawData.set()` pattern)
- Add **toggle UI**: "Export individual stat columns" (default OFF for backward compat)
- Use existing `useMultiYTP` pattern for auto-column lifecycle

**Output Column Naming**:

- Fixed period mode: `cosinor_M_{yId}`, `cosinor_H{k}_amp_{yId}`, `cosinor_H{k}_acro_{yId}`, `cosinor_r2_{yId}`, `cosinor_rmse_{yId}`, `cosinor_pval_{yId}`
- Curve fitting mode: `cosinor_C{c}_period_{yId}`, `cosinor_C{c}_amp_{yId}`, `cosinor_C{c}_phase_{yId}`, `cosinor_r2_{yId}`, `cosinor_rmse_{yId}`

**Reactivity**:

- Include stat generation in `getHash` derived (params like nHarmonics, useFixedPeriod already there)
- $effect watches getHash; triggers `getCosinor()` debounced
- Stat columns auto-update when inputs change

**Time to implement**: ~2 hours (most logic already in place; just reorganize)

---

### Layer 2: StatsByCategory Table Process (PHASE 2 - Priority 80%, Optional)

**New file**: `src/lib/tableProcesses/StatsByCategory.svelte`

**Purpose**: Reshape stat columns + grouping column into long format suitable for boxplot comparisons

**Data Flow**:

```
Input:  {amplitude_col, phase_col, mesor_col} + {treatment_col}
        [0.5, 0.6, 0.4, ...] + ["ctrl", "drug", "ctrl", ...]

Output: {category, stat_name, stat_value}
        category: ["ctrl", "drug", "ctrl", ..., "ctrl", "drug", "ctrl", ...]
        stat_name: ["amplitude", "amplitude", "amplitude", ..., "phase", "phase", "phase", ...]
        stat_value: [0.5, 0.6, 0.4, ..., 2.1, 1.8, 2.0, ...]
```

**Key Points**:

- Multi-input selector for stat columns
- Single grouping column selector
- Auto-detect stat name from column name (e.g., "cosinor_amplitude_123" → "amplitude")
- Outputs 3 columns: category, stat_name, stat_value

**Time to implement**: ~3 hours

---

### Layer 3: Statistical Testing Utilities (PHASE 3 - Priority 70%, Optional)

**New file**: `src/lib/utils/statTests.js`

**Core Functions**:

```js
export function tTest(group1, group2, paired = false)
  → { t, df, pValue, effectSize, ci }

export function anova(groups)  // Map<label, values[]> or Array[values[]]
  → { fStat, df_between, df_within, pValue, groups_stats }

export function postHocTukey(groups, anovaResult)
  → Map<pairLabel, pValue>
```

**Integration Points**:

- Button in Cosinor output preview (quick t-test on any two stat columns)
- Button in Boxplot controls (t-test or ANOVA on displayed data)
- Optional: ApplyStatTest table process for persistent stat columns

**Time to implement**: ~4 hours (stat functions are complex; need reference implementation)

---

### Layer 4: Boxplot UI Enhancements (PHASE 4 - Priority 60%, Optional)

**Changes**: Minor updates to `src/lib/plots/Boxplot/Boxplot.svelte` controls

**Additions**:

- Detect if data has stat-like structure (optional; could be manual toggle)
- Add "Run t-test" and "Run ANOVA" buttons in control panel
- Modal display: p-value, effect size, group stats
- Optional: checkbox to annotate boxplot with p-value belt

**Time to implement**: ~2 hours

---

## Immediate Action Items (Quick Win Path)

If you want stat columns + boxplot visualization **immediately** without full testing framework:

### TODAY (Phase 1 Only):

1. **Modify Cosinor.svelte** (2 hrs):
   - Extract stat generation into `getCosinorStatKeys()` helper
   - Add `exportStatColumns` toggle
   - Create stat columns in the write-output section
   - Add to `useMultiYTP` lifecycle for auto-column cleanup

2. **Test**:
   - Run Cosinor with toggle ON
   - Verify stat columns appear in table column list
   - Select stat column as Y in boxplot
   - Verify boxplot renders with stat distribution

3. **Result**: ✅ Cosinor stats now **plottable in boxplots** with **full reactivity**

---

## Complete Path (All Phases)

If you want full statistical analysis + comparison workflows:

### Phase 1 (TODAY): Stat columns + boxplot ✅

### Phase 2 (TOMORROW): StatsByCategory reshape for grouping ✅

### Phase 3 (DAY 3): t-test, ANOVA utilities ✅

### Phase 4 (DAY 4): UI buttons + p-value annotations ✅

**Total effort**: ~11 hours
**Result**: Professional stats workflow with one-click testing

---

## Reactivity Guarantees

**Guarantee 1: Input Data Changes**

```
User edits data → column.rawDataVersion++
  → getHash changes
  → $effect fires
  → getCosinor() recomputes
  → stat columns update via core.rawData.set()
  → plot re-renders automatically
```

**Guarantee 2: Config Changes**

```
User changes fixedPeriod/nHarmonics
  → params in getHash
  → $effect fires
  → Same cascade as above
```

**Guarantee 3: Cascading Updates**

```
Cosinor stat columns update
  → plots subscribed to those columnIds
  → boxplot auto-refreshes
  → subsequent stat test uses fresh data
```

**No polling, no manual refresh needed.** Fully Svelte-driven reactivity.

---

## Code Sketches (Ready to Copy)

### Sketch 1: getCosinorStatKeys() Helper

```js
export function getCosinorStatKeys(args) {
	const keys = [];

	if (args.useFixedPeriod) {
		keys.push('M'); // Mesor
		const H = args.nHarmonics ?? 1;
		for (let h = 1; h <= H; h++) {
			keys.push(`H${h}_amp`, `H${h}_acro`);
		}
		keys.push('r2', 'rmse', 'pval');
	} else {
		const N = args.Ncurves ?? 1;
		for (let c = 1; c <= N; c++) {
			keys.push(`C${c}_period`, `C${c}_amp`, `C${c}_phase`);
		}
		keys.push('r2', 'rmse');
	}

	return keys;
}
```

### Sketch 2: Extract Stats from y_results

```js
export function extractStatsFromResults(y_results, yId, useFixedPeriod, args) {
	const yr = y_results[yId];
	if (!yr) return {};

	const stats = {
		r2: yr.fittedData?.rSquared ?? NaN,
		rmse: yr.fittedData?.rmse ?? NaN
	};

	if (useFixedPeriod && yr.fixedStats) {
		stats.M = yr.fixedStats.M;
		yr.fixedStats.harmonics?.forEach((h, idx) => {
			stats[`H${idx + 1}_amp`] = h.amplitude;
			stats[`H${idx + 1}_acro`] = h.acrophase_hrs;
		});
		stats.pval = yr.fixedStats.pF;
	} else {
		yr.fittedData?.parameters?.cosines?.forEach((c, idx) => {
			const period = (2 * Math.PI) / c.frequency;
			stats[`C${idx + 1}_period`] = period;
			stats[`C${idx + 1}_amp`] = c.amplitude;
			stats[`C${idx + 1}_phase`] = c.phase;
		});
	}

	return stats;
}
```

### Sketch 3: Write Stat Columns

```js
// In cosinor() function, after computing result
if (anyValid && argsIN.exportStatColumns) {
	const processHash = crypto.randomUUID();
	const statKeys = getCosinorStatKeys(argsIN);

	for (const yId of yINs) {
		const stats = extractStatsFromResults(result.y_results, yId, argsIN.useFixedPeriod, argsIN);

		const statValues = {}; // Map stat to [values] for each key
		statKeys.forEach((key) => {
			if (key in stats) {
				// Each stat is a scalar; repeat for each time point or store as single-value column
				statValues[key] = [stats[key]];
			}
		});

		// Write each stat as a column
		for (const [statKey, value] of Object.entries(statValues)) {
			const outKey = `stat_${statKey}_${yId}`;
			const statColId = argsIN.out[outKey];

			if (statColId != null && statColId >= 0) {
				core.rawData.set(statColId, value);
				const col = getColumnById(statColId);
				if (col) {
					col.data = statColId;
					col.type = 'number';
					col.tableProcessGUId = processHash;
				}
			}
		}
	}
}
```

---

## Next Steps

**Choose your path**:

1. **Quick Win** (2 hrs): Implement Phase 1 only. Get stat columns + boxplot visualization working with reactivity.

2. **Professional** (11 hrs): All 4 phases. Full stats workflow with t-test, ANOVA, annotations.

3. **Hybrid** (6 hrs): Phases 1 + 2 + 3. Stat columns + reshaping + testing backend, without UI polish.

**Recommendation**: Start with Phase 1. It's solid, complete, and immediately useful. Add phases 2-4 based on user feedback.

---

## Files to Create/Modify

| Phase | File                                            | Action    | Est. Time |
| ----- | ----------------------------------------------- | --------- | --------- |
| 1     | `src/lib/tableProcesses/Cosinor.svelte`         | Modify    | 2 hrs     |
| 1     | `.planning/stats-boxplot-architecture.md`       | Reference | —         |
| 2     | `src/lib/tableProcesses/StatsByCategory.svelte` | Create    | 3 hrs     |
| 3     | `src/lib/utils/statTests.js`                    | Create    | 4 hrs     |
| 3     | `src/lib/utils/__tests__/statTests.test.js`     | Create    | 2 hrs     |
| 4     | `src/lib/plots/Boxplot/Boxplot.svelte`          | Modify    | 2 hrs     |
| 4     | `src/lib/components/StatTestModal.svelte`       | Create    | 1 hr      |

---

## Key Insights

1. **Stat columns are the secret sauce**: Making stats plottable columns (not just preview data) unlocks composability and reactivity.

2. **Leverage existing patterns**: MovingAnalysis already does multi-stat multi-column output. Just follow that design.

3. **Reactivity is automatic**: Svelte's $effect + data hash pattern means you don't build polling; just depend on input hashes.

4. **Testing is UI-free**: t-test/ANOVA logic can be pure JS functions, tested independently of Svelte.

5. **Boxplot "just works"**: No deep boxplot changes needed. It already accepts any X/Y columns. Just feed it stat data.

---

## Questions to Address Before Coding

1. **Stat column naming**: Use `cosinor_` prefix or something else?  
   **Suggestion**: `cosinor_stat_{key}_{yId}` for clarity.

2. **Default behavior**: Export stat columns by default or require toggle?  
   **Suggestion**: Toggle OFF by default (backward compat); users opt-in.

3. **Statistical testing**: Start with unpaired t-test + 1-way ANOVA, or include paired t-test + Welch's?  
   **Suggestion**: Unpaired + 1-way; add paired if users request.

4. **p-value handling**: Display in modal only, or also export as column?  
   **Suggestion**: Modal first; add column export as nice-to-have.

Good luck! This is a solid, extensible architecture that will serve the project well. 🚀
