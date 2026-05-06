# Stats-to-Boxplot Reactive Architecture

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER WORKFLOW                               │
└─────────────────────────────────────────────────────────────────────┘

Raw Data (time, activity)
         ↓
 ┌──────────────────┐
 │ Cosinor Process  │  ← Detects activity rhythm (fitting model)
 └──────────────────┘
    ↓         ↓         ↓
  X col    fitted_y   stat_cols  ← NEW: Individual stat columns
  (time)    (fitted)     ↓
             ↓      Multiple columns created:
          Plottable   • cosinor_M_{yId} (mesor)
                      • cosinor_H1_amp_{yId} (amplitude)
                      • cosinor_H1_acro_{yId} (acrophase)
                      • cosinor_r2_{yId}
                      • cosinor_rmse_{yId}
                      • cosinor_pval_{yId}
                      
         ↓ (Optional: Grouping)
 ┌────────────────────────────────────┐
 │ StatsByCategory Table Process      │  ← Reshape for comparisons
 └────────────────────────────────────┘
    Input: [stat_col_1, stat_col_2, grouping_col]
    Output:
    • category col (e.g., "ctrl", "treatment", ...)
    • stat_name col (e.g., "amplitude", "phase", ...)
    • stat_value col (numeric, plottable)
    
         ↓
 ┌──────────────────────────────────────┐
 │ Boxplot Visualization                │
 │ X: category + stat_name (optional)   │
 │ Y: stat_value                        │
 │ Shows: distribution + outliers       │
 │ Button: "Run t-test" / "Run ANOVA"   │
 └──────────────────────────────────────┘
 
         ↓ (Statistical Testing)
 ┌──────────────────────────────────────┐
 │ Statistical Testing Result           │
 │ (t-test / ANOVA)                     │
 │ p-value, effect size, CI             │
 │ Option: export as column or annotate │
 └──────────────────────────────────────┘
```

## Reactivity Flow (Svelte $effect Chain)

```
Input Column Data / Config Changes
    ↓
    │ (hash change detected)
    ↓
$effect(() => { getCosinor() })
    ↓ (debounced, 0ms timeout)
    ↓
cosinor(args) → [result, valid]
    ↓ (in result: y_results[yId].fittedData + fixedStats)
    ↓
Generate stat columns:
  for each yId:
    for each stat in getCosinorStatKeys(args):
      • Extract stat value from y_results[yId]
      • core.rawData.set(statColId, [values])
      • Update column.data = statColId
    ↓
ALL columns updated reactively
    ↓
Plots referencing stat columns auto-refresh
    ↓
Boxplot receives new data → recalculates box stats → renders
```

## Layer 1: Individual Stat Columns (Cosinor Enhancement)

### Data Structure (in function)
```js
export function cosinor(argsIN) {
  // ... existing code ...
  
  result = {
    t: [...],
    y_results: {
      [yId]: {
        fittedData: { fitted: [...], parameters: {...}, rmse: N, rSquared: N },
        fixedStats: { M, CI_M, harmonics: [{amplitude, CI_A, acrophase, ...}], pF, F_stat, ... },
        t: [...],
        yOutData: [...]
      }
    }
  }
  
  // Helper to extract all stats
  const statEntries = extractAllStats(result.y_results, useFixedPeriod, nHarmonics, Ncurves);
  // → [[statKey, yId, value], ...]
  
  // Write each stat as a column (NEW)
  if (exportStatColumns) {
    for (const [statKey, yId, values] of statEntries) {
      const outKey = `cosinor_${statKey}_${yId}`;
      const statColId = argsIN.out[outKey];
      if (statColId >= 0) {
        core.rawData.set(statColId, values);  // values are per-Y arrays or scalars repeated
        const col = getColumnById(statColId);
        if (col) {
          col.data = statColId;
          col.type = 'number';
          col.tableProcessGUId = processHash;
        }
      }
    }
  }
  
  return [result, anyValid];
}
```

### Component UI Enhancement
```svelte
<script>
  // In Cosinor.svelte
  let exportStatColumns = $state(false);  // NEW
  
  // In defaults Map:
  defaults.set('exportStatColumns', { val: false });  // NEW
  defaults.set('statColIds', { val: {} });            // NEW
  
  // In onMount:
  // Auto-create stat output columns (like Y columns)
  if (initStatColumns?.()) {
    needsCompute = true;
  }
</script>

<div class="control-input-horizontal">
  <label>
    <input type="checkbox" bind:checked={p.args.exportStatColumns} />
    Export individual stat columns
  </label>
</div>
```

## Layer 2: StatsByCategory Table Process (New File)

### Pattern: Reshape Strategy
```js
// src/lib/tableProcesses/StatsByCategory.svelte (new)

export const definition = {
  displayName: 'Stats by Category',
  defaults: new Map([
    ['statColIds', { val: [] }],      // Input: stat columns (amplitude, period, etc.)
    ['categoryColId', { val: -1 }],   // Input: grouping column (treatment, replicate, etc.)
    ['out', { category: { val: -1 }, stat_name: { val: -1 }, stat_value: { val: -1 } }],
    ['valid', { val: false }]
  ]),
  func: statsByCategory
};

export function statsByCategory(argsIN) {
  const statColIds = argsIN.statColIds ?? [];
  const categoryColId = argsIN.categoryColId;
  
  if (categoryColId === -1 || statColIds.length === 0) {
    return [{ categories: [], stat_names: [], stat_values: [] }, false];
  }
  
  const categoryCols = getColumnById(categoryColId);
  const categoryData = categoryCols.getData();
  
  const categories = [];
  const stat_names = [];
  const stat_values = [];
  
  // For each stat column
  for (const statColId of statColIds) {
    const statCol = getColumnById(statColId);
    if (!statCol) continue;
    
    const statData = statCol.getData();
    const statName = extractStatName(statCol.name);  // e.g., "amplitude" from "cosinor_amplitude_123"
    
    // For each row
    for (let i = 0; i < Math.min(categoryData.length, statData.length); i++) {
      categories.push(categoryData[i]);    // e.g., "ctrl"
      stat_names.push(statName);           // e.g., "amplitude"
      stat_values.push(statData[i]);       // e.g., 0.45
    }
  }
  
  // Write output columns
  const processHash = crypto.randomUUID();
  
  const catId = argsIN.out.category;
  if (catId >= 0) {
    core.rawData.set(catId, categories);
    getColumnById(catId).type = 'text';
    getColumnById(catId).tableProcessGUId = processHash;
  }
  
  const nameId = argsIN.out.stat_name;
  if (nameId >= 0) {
    core.rawData.set(nameId, stat_names);
    getColumnById(nameId).type = 'text';
    getColumnById(nameId).tableProcessGUId = processHash;
  }
  
  const valId = argsIN.out.stat_value;
  if (valId >= 0) {
    core.rawData.set(valId, stat_values);
    getColumnById(valId).type = 'number';
    getColumnById(valId).tableProcessGUId = processHash;
  }
  
  return [{ categories, stat_names, stat_values }, true];
}
```

## Layer 3: Statistical Testing Functions

### `src/lib/utils/statTests.js` (New Module)
```js
/**
 * Perform independent samples t-test
 * Returns t-statistic, df, p-value (two-tailed), effect size (Cohen's d)
 */
export function tTest(group1, group2, paired = false) {
  const g1 = group1.filter(x => typeof x === 'number' && isFinite(x));
  const g2 = group2.filter(x => typeof x === 'number' && isFinite(x));
  
  if (g1.length < 2 || g2.length < 2) {
    return { t: NaN, df: 0, pValue: NaN, effectSize: NaN, error: 'Insufficient data' };
  }
  
  const n1 = g1.length, n2 = g2.length;
  const mean1 = g1.reduce((a, b) => a + b) / n1;
  const mean2 = g2.reduce((a, b) => a + b) / n2;
  const var1 = g1.reduce((acc, x) => acc + (x - mean1) ** 2, 0) / (n1 - 1);
  const var2 = g2.reduce((acc, x) => acc + (x - mean2) ** 2, 0) / (n2 - 1);
  
  const pooledVar = ((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2);
  const se = Math.sqrt(pooledVar * (1 / n1 + 1 / n2));
  const t = (mean1 - mean2) / se;
  const df = n1 + n2 - 2;
  
  // Approximate p-value using t-distribution tail probability
  const pValue = 2 * tDistributionCDF(Math.abs(t), df, true); // two-tailed
  
  // Cohen's d
  const cohensD = (mean1 - mean2) / Math.sqrt(pooledVar);
  
  return { t, df, pValue, effectSize: cohensD };
}

/**
 * Perform one-way ANOVA
 * groups: Map<label, [values]> or Object with group arrays
 */
export function anova(groups) {
  const groupArray = Array.isArray(groups) ? groups : Array.from(groups.values());
  const groupNames = Array.isArray(groups) 
    ? groupArray.map((_, i) => i)
    : Array.from(groups.keys());
  
  const clean = groupArray.map(g => 
    g.filter(x => typeof x === 'number' && isFinite(x))
  ).filter(g => g.length > 0);
  
  if (clean.length < 2) {
    return { fStat: NaN, df_between: 0, df_within: 0, pValue: NaN, error: 'Need ≥2 groups' };
  }
  
  const N = clean.reduce((sum, g) => sum + g.length, 0);
  const k = clean.length;
  const grandMean = clean.flat().reduce((a, b) => a + b) / N;
  
  let ss_between = 0;
  let ss_within = 0;
  
  clean.forEach(group => {
    const n = group.length;
    const mean = group.reduce((a, b) => a + b) / n;
    ss_between += n * (mean - grandMean) ** 2;
    ss_within += group.reduce((acc, x) => acc + (x - mean) ** 2, 0);
  });
  
  const df_between = k - 1;
  const df_within = N - k;
  const ms_between = ss_between / df_between;
  const ms_within = ss_within / df_within;
  const fStat = ms_between / ms_within;
  
  // F-distribution p-value approximation
  const pValue = fDistributionCDF(fStat, df_between, df_within, true);
  
  return { 
    fStat, 
    df_between, 
    df_within, 
    pValue,
    groups_stats: clean.map((g, i) => ({
      label: groupNames[i],
      n: g.length,
      mean: g.reduce((a, b) => a + b) / g.length,
      sd: Math.sqrt(g.reduce((acc, x) => acc + (x - g.reduce((a, b) => a + b) / g.length) ** 2, 0) / (g.length - 1))
    }))
  };
}

// Helper: t-distribution CDF approximation
function tDistributionCDF(t, df, upper = false) {
  // Use approximation or jStat-like library
  // For now, simplified Abramowitz & Stegun
  const absT = Math.abs(t);
  // ... implementation ...
}
```

## Layer 4: Boxplot Integration (Minimal Changes)

### Boxplot Component Enhancement
```svelte
<script>
  // In Boxplot.svelte components/controls
  
  let selectedStats = $derived.by(() => {
    // Auto-detect if data comes from StatsByCategory
    if (hasStatColumn && hasCategoryColumn) {
      return true;  // Show stat test button
    }
    return false;
  });
</script>

{#if selectedStats}
  <div class="stat-test-controls">
    <button onclick={() => runTTest()}>Run t-test</button>
    <button onclick={() => runANOVA()}>Run ANOVA</button>
  </div>
  
  {#if testResult}
    <div class="test-result">
      <p>p-value: {testResult.pValue.toFixed(4)}</p>
      <p>Effect size: {testResult.effectSize?.toFixed(3)}</p>
      {#if testResult.pValue < 0.05}
        <p class="significant">✓ Significant (p < 0.05)</p>
      {/if}
    </div>
  {/if}
{/if}
```

## Complete Workflow Example

### Scenario: Compare amplitude across treatment groups

**Step 1: Run Cosinor (with new toggle)**
```
- Select X (time), Y (activity columns)
- Toggle: "Export individual stat columns" → ON
- Output: cosinor_M_1, cosinor_H1_amp_1, cosinor_H1_acro_1, ... + cosinor_fitted_1, cosinor_x
```

**Step 2: (Optional) Reshape with StatsByCategory**
```
- Input: [cosinor_H1_amp_1, cosinor_H1_acro_1, ...] + treatment_column
- Output: category, stat_name, stat_value
- Reshape: [scalar] × [groups] → long format
```

**Step 3: Create Boxplot**
```
- X: stat_name (amplitude, acrophase, ...)  OR  category (if ungrouped)
- Y: (stat_value if grouped)  OR  (cosinor_H1_amp_1 if ungrouped)
- Visualize distribution for easy outlier spotting
```

**Step 4: Statistical Test (Button)**
```
- Click "Run ANOVA" on boxplot
- Compares amplitude across treatment groups
- Modal shows: p-value, effect size, group means ± SD
- Option: "Export p-value as column" → creates p_value_col for reference
```

## Reactivity Guarantees

| Event | Trigger | Result |
|-------|---------|--------|
| Input Y changes | Data hash mismatch | Cosinor recomputes → stat columns update → boxplot auto-refreshes |
| fixedPeriod changed | Parameter changed | Same as above (hash includes params) |
| User edits a value in source data | Column.rawDataVersion++ | Hash detects change → cascade |
| StatsByCategory inputs change | Column reference update | Reshape recomputes → new long-format columns |
| Boxplot data columns change | Column IDs updated | Plot auto-subscribes to new data |

## Performance Notes
- **Debounce**: `setTimeout(..., 0)` prevents rapid re-fires during rapid user input
- **Token pattern**: `_calcToken` ensures old requests are cancelled if overtaken by new ones
- **Hash-based reactivity**: Avoids deep object comparisons; only recomputes if actual data changed
- **Lazy column creation**: Stat columns only created if `exportStatColumns = true`

## Testing Strategy
1. **Unit**: Test each stat extraction function in isolation  
2. **Integration**: Cosinor → stat columns → boxplot visualization
3. **Reactivity**: Change input → verify columns update → verify plot refreshes
4. **Stats**: Compare tTest/ANOVA results vs. R or Python reference
5. **E2E**: Full workflow (fixture data → Cosinor → category reshape → boxplot → t-test → result)
