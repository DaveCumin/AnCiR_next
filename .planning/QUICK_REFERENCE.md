# Quick Reference: Stats-to-Boxplot Architecture

## The Problem You're Solving

Currently:

- Cosinor computes stats (amplitude, phase, period, p-values, etc.)
- Stats only shown in **preview table** or **CSV export**
- **Not plottable** in boxplot
- **No statistical testing** (t-test, ANOVA) on stat distributions

Goal:

- Make stats **directly plottable in boxplots** ✓
- Enable **full reactivity** (auto-update when data changes) ✓
- Perform **t-test & ANOVA** with one-click ✓
- Keep stats **composable** (can feed to other table processes) ✓

---

## The Solution in One Sentence

**Create individual stat columns from Cosinor (following MovingAnalysis pattern), making them regular plottable columns with reactive updates via Svelte $effect.**

---

## Architecture at a Glance

```
Raw Data → Cosinor → {X col, fitted Y col, individual stat cols}
                              ↓
                        Stat cols are normal columns!
                              ↓
                        Plot in any visualization
                              ↓
                    Boxplot shows stat distribution
                              ↓
                  Click "Run ANOVA" → p-value appears
```

---

## 4 Layers (Pick Your Path)

| Layer | What                                   | When     | Time | Priority        |
| ----- | -------------------------------------- | -------- | ---- | --------------- |
| **1** | Individual stat columns from Cosinor   | TODAY    | 2h   | 🔴 DO THIS      |
| **2** | StatsByCategory reshape (for grouping) | Tomorrow | 3h   | 🟡 Nice to have |
| **3** | t-test/ANOVA utilities                 | Day 3    | 4h   | 🟡 Nice to have |
| **4** | Boxplot UI buttons + annotations       | Day 4    | 2h   | 🟢 Polish       |

**Minimum viable**: Layer 1 only (2 hours). You get stats in boxplots with reactivity.  
**Full power**: All layers (11 hours). Professional stats workflow.

---

## Why This Design is Best

| Aspect              | Why It Works                                                   |
| ------------------- | -------------------------------------------------------------- |
| **Pattern**         | Copies proven MovingAnalysis approach (already in codebase)    |
| **Reactivity**      | Uses Svelte $effect on data hash (no polling, fully automatic) |
| **Composability**   | Stats are regular columns; can feed to any plot or TP          |
| **Testability**     | Each layer testable independently (stat functions are pure JS) |
| **Backward Compat** | Toggle feature; doesn't break existing Cosinor usage           |
| **Minimal UI**      | Leverages existing plot infrastructure; ~40 new UI lines       |

---

## Data Flow (Interactive)

**User edits source data**
→ `getDataHash` changes
→ `$effect()` fires
→ `cosinor()` recomputes stats
→ `core.rawData.set(statColId, values)` updates columns
→ Plots auto-subscribe to new data
→ Boxplot re-renders instantly

**No manual refresh. No polling. Pure Svelte reactivity.**

---

## Phase 1 Implementation Sketch (2 hours)

### Step 1: Add helpers to Cosinor module function

```js
function getCosinorStatKeys(args) {
  if (args.useFixedPeriod) {
    return ['M', `H1_amp`, `H1_acro`, 'r2', 'rmse', 'pval'];  // for nHarmonics=1
  }
  return [`C1_period`, `C1_amp`, `C1_phase`, 'r2', 'rmse'];   // for Ncurves=1
}

function extractStats(y_results, yId, args) {
  // Pull stat values from result.y_results[yId].fixedStats or parameters
  return { M: 0.5, H1_amp: 0.3, ... }
}
```

### Step 2: Add toggle UI

```svelte
<input type="checkbox" bind:checked={p.args.exportStatColumns} />
Export individual stat columns
```

### Step 3: Write stat columns (in cosinor function)

```js
if (anyValid && p.args.exportStatColumns) {
	for (const yId of yINs) {
		const stats = extractStats(result.y_results, yId, argsIN);
		for (const [key, value] of Object.entries(stats)) {
			const colId = argsIN.out[`stat_${key}_${yId}`];
			if (colId >= 0) {
				core.rawData.set(colId, [value]); // or array if multi-row
				getColumnById(colId).type = 'number';
			}
		}
	}
}
```

### Step 4: Test

- Run Cosinor with toggle ON
- Verify stat columns appear in column list
- Select stat column as Y in boxplot
- Verify boxplot renders ✓

---

## Phase 2+3+4 (If You Want Full Testing)

### Phase 2: StatsByCategory TP

- **Input**: Stat columns + grouping column
- **Output**: Long format (category, stat_name, stat_value)
- **Rationale**: Enables comparisons across conditions

### Phase 3: StatTests Utilities

- **Functions**: `tTest()`, `anova()`
- **File**: `src/lib/utils/statTests.js`
- **Use**: Pure JS functions (testable independently)

### Phase 4: UI Buttons

- **Where**: Cosinor output or Boxplot controls
- **What**: "Run t-test", "Run ANOVA" buttons
- **Result**: Modal with p-value, effect size, CI

---

## Key Insights

1. **Stats as columns = superpower**  
   Once Cosinor outputs individual stat columns (not just preview data), they're like any other plottable column. They can feed to boxplot, other TPs, statistical functions, etc.

2. **Follow MovingAnalysis pattern**  
   MovingAnalysis already does multi-stat multi-column output perfectly. Just copy that design.

3. **Reactivity is automatic**  
   You don't have to build it. Svelte's `$effect` on data hash already handles cascading updates through plots.

4. **Composition first**  
   By making stats regular columns, you unlock StatsByCategory (Phase 2) for grouping/comparison without extra plumbing.

5. **Testing lives separately**  
   t-test/ANOVA logic can be pure JS functions in `statTests.js`, unit-tested independently of UI.

---

## Recommended Implementation Order

### Day 1 (Phase 1: 2 hrs)

- [ ] Extract `getCosinorStatKeys()` and `extractStats()` from Cosinor logic
- [ ] Add `exportStatColumns` toggle UI
- [ ] Write stat columns in `cosinor()` function
- [ ] Test: stat columns appear, plottable in boxplot, reactive on data change

### Day 2 (Phase 2: 3 hrs) — _Optional_

- [ ] Create `StatsByCategory.svelte` TP
- [ ] Test reshape: stat columns + grouping → long format
- [ ] Verify boxplot works with reshaped data

### Day 3 (Phase 3: 4 hrs) — _Optional_

- [ ] Implement `tTest()` and `anova()` in `statTests.js`
- [ ] Unit test against reference implementations (R or Python)
- [ ] Add stat test button in Cosinor output preview

### Day 4 (Phase 4: 2 hrs) — _Optional_

- [ ] Add "Run test" button in Boxplot controls
- [ ] Modal display for p-value + effect size
- [ ] (Nice to have) p-value annotation overlay on boxplot

---

## Files to Modify/Create

### Phase 1 (2 hrs)

- ✏️ `src/lib/tableProcesses/Cosinor.svelte` — Modify
- 📋 `.planning/stats-boxplot-architecture.md` — Reference

### Phase 2 (3 hrs)

- ✨ `src/lib/tableProcesses/StatsByCategory.svelte` — Create

### Phase 3 (4 hrs)

- ✨ `src/lib/utils/statTests.js` — Create
- ✨ `src/lib/utils/__tests__/statTests.test.js` — Create

### Phase 4 (2 hrs)

- ✏️ `src/lib/plots/Boxplot/Boxplot.svelte` — Modify
- ✨ `src/lib/components/StatTestModal.svelte` — Create

---

## Success Criteria

### Phase 1: ✓ Complete

- [ ] Cosinor toggle exists and works
- [ ] Stat columns created when toggle ON
- [ ] Stat columns visible in column list
- [ ] Can select stat as Y in boxplot
- [ ] Boxplot visualizes stat distribution
- [ ] Boxplot updates when input data changes (reactivity test)

### Phase 2: ✓ Complete

- [ ] StatsByCategory TP exists
- [ ] Takes stat columns + grouping column as input
- [ ] Outputs long format: category, stat_name, stat_value
- [ ] Boxplot works with reshaped data

### Phase 3: ✓ Complete

- [ ] `tTest()` function implemented
- [ ] `anova()` function implemented
- [ ] Both tested against reference implementations
- [ ] Button in Cosinor or Boxplot calls test function
- [ ] p-value Modal displays result

### Phase 4: ✓ Complete

- [ ] "Run test" buttons in Boxplot controls
- [ ] p-value overlay annotation on plot (optional)
- [ ] Export p-value as column option

---

## Questions Before You Start?

**Q: Default behavior for stat columns?**  
A: Toggle OFF by default (backward compat). Users opt-in.

**Q: Stat column naming?**  
A: `cosinor_stat_{key}_{yId}` or `cosinor_{key}_{yId}`. Your choice.

**Q: Which statistical tests to start with?**  
A: Unpaired t-test + 1-way ANOVA. Add paired t-test if users request.

**Q: Where to put test buttons?**  
A: Cosinor output preview first (quick test). Boxplot controls second (more discovery).

---

## Summary

✅ **Phase 1** gets you 80% of the value in 2 hours.  
✅ **Full path** is 11 hours for professional stats workflow.  
✅ **Design is solid** — reuses proven patterns, fully reactive, composable.  
✅ **Ready to code** — all sketches and architecture documented.

Pick your path and start coding! 🚀
