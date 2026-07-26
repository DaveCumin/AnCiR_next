<script>
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import NoteBox from "$lib/components/NoteBox.svelte";
  import MethodPicker from "$lib/components/MethodPicker.svelte";
  // The goal index lives in $lib/methodGuide.js so this table and the picker
  // below it are driven by one set of facts.
  import { GOALS, SAMPLING_SHORT, SPACING_SHORT } from "$lib/methodGuide.js";

</script>

<ChapterSection id="choosing" num="Guide" title="Choosing a Method: The Bigger Picture">
  <p class="chapter-intro">
    The chapters are organised by <em>method</em>; real analysis starts from a
    <em>question</em>. This guide is the map between the two. Find your goal in the
    index below and it will point you at the right method, the chapter that
    explains it, and a worked <a href="#recipes">recipe</a> to copy. Before that,
    one distinction shapes almost every choice: whether your data come from one
    individual or from many.
  </p>

  <NoteBox title="Look before you quantify">
    <p>
      Whatever your goal, the first step is always the same: plot an
      <a href="#ch5">actogram</a> and the raw series, and look at them. Every method
      below returns numbers even from noise; the actogram is how you keep those
      numbers honest.
    </p>
  </NoteBox>

  <h3 class="section-head">One individual over time, or many individuals?</h3>
  <p>
    How you collected the data decides what you can ask of it. Two designs sit
    behind almost every method, and mixing them up is a common source of wrong
    conclusions (Refinetti, Cornélissen &amp; Halberg 2007 <sup class="cite"><a href="#ref-1">[1]</a></sup>).
  </p>
  <div class="design-grid">
    <div class="design-card">
      <h4>Longitudinal — one individual, many cycles</h4>
      <p>
        The same subject measured repeatedly across many days. This is the only
        design that lets you estimate <strong>that individual's own period</strong>
        and watch its phase or amplitude drift over time. Periodograms, correlograms,
        single-subject cosinor and PRCs all assume it. The catch: one individual is
        a sample of one, so you cannot yet generalise to a population.
      </p>
    </div>
    <div class="design-card">
      <h4>Cross-sectional — many individuals</h4>
      <p>
        Many subjects, each sampled once or over a short window, with the
        <strong>clock time of every sample recorded</strong>. You cannot recover a
        within-individual period from a single time point, but you can describe the
        <strong>group's</strong> average rhythm by fitting a cosinor at the expected
        period: a rhythm is present if its amplitude differs significantly from zero.
        You can also compare groups. This is the usual design for clinical and field
        studies.
      </p>
    </div>
  </div>
  <p class="design-takeaway">
    <strong>Rule of thumb:</strong> questions about a rhythm's <em>period</em>, or
    how it changes over time, need a <em>longitudinal</em> record from a single
    individual. Questions that <em>compare groups</em> need <em>many</em>
    individuals, with the sampling time of every point. Measuring the
    <em>period</em> is the one thing a cross-sectional design cannot do: folding
    many individuals onto clock time assumes the period rather than revealing it,
    so an unknown period must come from a longitudinal record. The
    &ldquo;Sampling&rdquo; column below says which design each question wants.
  </p>

  <h3 class="section-head">Start from your goal</h3>
  <p>
    Pick the row that matches the question you actually have. The method column
    names what to reach for; <strong>Sampling</strong> and <strong>Spacing</strong>
    say what the data must look like for that method to be valid, and the last
    column links to the chapter and, where one exists, a ready-made recipe. A
    <em>Spacing</em> of &ldquo;Even&rdquo; means the method reads position in the
    sequence rather than clock time; hover it for what to use instead on gappy data.
  </p>

  <div class="goal-table-wrap">
    <table class="goal-table">
      <thead>
        <tr>
          <th>Your question</th>
          <th>Reach for</th>
          <th>Sampling</th>
          <th>Spacing</th>
          <th>You need</th>
          <th>Go to</th>
        </tr>
      </thead>
      <tbody>
        {#each GOALS as row}
          <tr>
            <td class="goal-cell">
              {@html row.goal}{#if row.context}<span class="q-design">{row.context}</span>{/if}
            </td>
            <td>{@html row.method}</td>
            <td class="axis-cell">
              <span class="axis-badge">{SAMPLING_SHORT[row.sampling]}</span>
            </td>
            <td class="axis-cell">
              <span
                class="axis-badge"
                class:even={row.spacing === 'even'}
                title={row.spacing === 'even'
                  ? row.ifUneven
                    ? `Unevenly spaced data: use ${row.ifUneven}.`
                    : 'Unevenly spaced data must be re-binned or interpolated onto an even grid first.'
                  : 'Fits against the actual timestamps, so gaps are fine.'}
              >{SPACING_SHORT[row.spacing]}</span>
            </td>
            <td class="need-cell">{row.need}</td>
            <td class="go-cell">
              {#each row.go as [label, id], i}<a href="#{id}">{label}</a>{#if i < row.go.length - 1}<span class="sep">·</span>{/if}{/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h3 class="section-head">Or let the picker narrow it for you</h3>
  <p>
    The same index, filtered. Tell it your question and what your data look like
    and it keeps only the routes that stay valid, showing the ruled-out ones
    greyed with the reason, because <em>why</em> a method is out is usually the
    part worth knowing.
  </p>
  <MethodPicker />

  <h3 class="section-head">Ordinary statistics: which test?</h3>
  <p>
    The rows above are circadian questions. Underneath them sit ordinary
    statistical ones, and the same goal-first logic applies. Each row names the
    AnCiR node; <a href="#stats">Statistical Foundations</a> explains the
    reasoning.
  </p>

  <div class="goal-table-wrap">
    <table class="goal-table">
      <thead>
        <tr><th>Your question</th><th>Reach for</th><th>Node</th><th>Go to</th></tr>
      </thead>
      <tbody>
        <tr>
          <td class="goal-cell">What does this variable look like?</td>
          <td>Summary statistics plus a histogram and boxplot &mdash; never the numbers alone</td>
          <td class="need-cell">Describe Data, histogram, boxplot</td>
          <td class="go-cell"><a href="#stats">Stats</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Are these data normal enough?</td>
          <td>Shapiro-Wilk on the <em>residuals</em>, read alongside a plot, never as an automatic gate</td>
          <td class="need-cell">Normality Test</td>
          <td class="go-cell"><a href="#stats">Stats</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Do two groups differ?</td>
          <td>Welch t-test; Mann-Whitney if skewed or outlier-prone</td>
          <td class="need-cell">Compare groups (stats)</td>
          <td class="go-cell"><a href="#stats">Stats</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Do three or more groups differ?</td>
          <td>ANOVA; Kruskal-Wallis if skewed</td>
          <td class="need-cell">Compare groups (stats)</td>
          <td class="go-cell"><a href="#stats">Stats</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Do counts differ between categories?</td>
          <td>Chi-squared (independence for a contingency table)</td>
          <td class="need-cell">Chi-squared test</td>
          <td class="go-cell"><a href="#stats">Stats</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Are two variables associated?</td>
          <td>Pearson if linear; Spearman if skewed, curved-but-monotonic, or outlier-driven. Plot first.</td>
          <td class="need-cell">Correlation, pairsplot</td>
          <td class="go-cell"><a href="#stats">Stats</a> &middot; <a href="#ch9">Ch 9</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Does a predictor explain an outcome?</td>
          <td>Trend fit for continuous; logistic regression for binary. Check the residuals.</td>
          <td class="need-cell">Fit Trend Curves, Logistic regression</td>
          <td class="go-cell"><a href="#stats">Stats</a> &middot; <a href="#ch11">Ch 11</a></td>
        </tr>
        <tr>
          <td class="goal-cell">I ran many tests &mdash; what now?</td>
          <td>FDR (Benjamini-Hochberg) for a screen; Holm if a single false claim is costly</td>
          <td class="need-cell">FDR Correction</td>
          <td class="go-cell"><a href="#stats">Stats</a> &middot; <a href="#ch6">Ch 6</a></td>
        </tr>
        <tr>
          <td class="goal-cell">Can I trust this p-value on a time series?</td>
          <td>Probably not &mdash; build a null that preserves the autocorrelation</td>
          <td class="need-cell">Surrogate Test</td>
          <td class="go-cell"><a href="#stats">Stats</a> &middot; <a href="#ch6">Ch 6</a></td>
        </tr>
      </tbody>
    </table>
  </div>

  <NoteBox title="How this fits with the rest of the handbook">
    <p>
      This guide answers <em>which</em> method. The <a href="#recipes">Recipes</a>
      show the exact node chain to run it, the method <strong>chapters</strong>
      explain <em>why</em> it works, and Chapter 13's
      <a href="#ch13">method table</a> summarises what each method is best suited
      to. When in doubt, start here and follow the links.
    </p>
  </NoteBox>
</ChapterSection>

<style>
  /* ---- Study-design discussion ---- */
  .design-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.9rem;
    margin: 1rem 0;
  }
  .design-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-top: 3px solid var(--blue);
    border-radius: 8px;
    padding: 0.85rem 1rem;
  }
  .design-card h4 {
    margin: 0 0 0.4rem;
    color: var(--text);
    font-size: 0.98rem;
  }
  .design-card p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text);
  }
  .design-takeaway {
    background: var(--blue-lt);
    border-radius: 8px;
    padding: 0.7rem 0.9rem;
    font-size: 0.9rem;
    line-height: 1.55;
  }

  /* ---- Goal index ---- */
  .goal-table-wrap {
    overflow-x: auto;
    margin: 1rem 0 1.75rem;
  }
  .goal-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    min-width: 820px;
  }
  .goal-table th,
  .goal-table td {
    text-align: left;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
    line-height: 1.45;
  }
  .goal-table thead th {
    background: var(--panel-bg);
    color: var(--text);
    font-weight: 600;
    border-bottom: 2px solid var(--border);
    position: sticky;
    top: 0;
  }
  .goal-table tbody tr:hover {
    background: var(--blue-lt);
  }
  .goal-cell {
    font-weight: 600;
    color: var(--text);
    width: 24%;
  }
  .goal-cell :global(.q-design) {
    display: block;
    font-weight: 400;
    color: var(--muted);
    font-size: 0.8rem;
    margin-top: 0.15rem;
  }
  .need-cell {
    color: var(--muted);
    width: 16%;
  }
  /* The two structured axes the picker filters on. Badges rather than prose so a
     reader can scan one column and see which rows their data rule out. */
  .axis-cell {
    width: 9%;
  }
  .axis-badge {
    display: inline-block;
    font-size: 0.76rem;
    font-weight: 600;
    line-height: 1.3;
    padding: 0.15rem 0.4rem;
    border-radius: 4px;
    background: var(--panel-bg);
    color: var(--text);
    cursor: help;
  }
  /* "Even" is the constraint that bites, so it is the one that gets the warning tint. */
  .axis-badge.even {
    background: var(--gold-lt);
    color: var(--gold);
  }
  .go-cell {
    white-space: nowrap;
  }
  .go-cell a {
    color: var(--blue);
    text-decoration: none;
    font-weight: 600;
  }
  .go-cell a:hover {
    text-decoration: underline;
  }
  .sep {
    color: var(--muted);
    margin: 0 0.3rem;
  }
</style>
