<script>
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import NoteBox from "$lib/components/NoteBox.svelte";

  // Goal-first index: what you want to know -> method -> what you need
  // (including the study design it implies) -> where to go. The "You need"
  // column names whether the question is answered from ONE individual measured
  // over time (longitudinal) or from MANY individuals (cross-sectional); see the
  // discussion above the table.
  const goals = [
    {
      goal: "Is there a rhythm?<span class=\"q-design\">one individual, over time</span>",
      method: "Periodogram (χ² or Lomb–Scargle), read with its <em>peak power</em> next to the actogram",
      need: "A multi-day record from one individual",
      go: [["Ch 6", "ch6"], ["Recipe", "recipes"]],
    },
    {
      goal: "Is there a rhythm?<span class=\"q-design\">many individuals</span>",
      method: "Fit a cosinor at the expected period and test whether the amplitude differs from zero (the fit's F-test / p-value)",
      need: "Many individuals sampled across the cycle, clock times recorded",
      go: [["Ch 7", "ch7"]],
    },
    {
      goal: "What is the period, τ?",
      method: "χ² periodogram (dense, even) · Lomb–Scargle (sparse, uneven) · FFT for a quick spectral view",
      need: "One individual, ideally ≥ 7 cycles; even spacing for χ²/FFT",
      go: [["Ch 6", "ch6"], ["Ch 8", "ch8"]],
    },
    {
      goal: "Amplitude, phase and MESOR at a known τ?",
      method: "Cosinor (fixed period); population-mean cosinor for a group",
      need: "One individual, or many for a group estimate; τ known",
      go: [["Ch 7", "ch7"], ["Recipe", "recipes"]],
    },
    {
      goal: "Compare <strong>phase</strong> between groups?",
      method: "Circular statistics (Rayleigh, Watson–Williams)",
      need: "Many individuals; one acrophase each",
      go: [["Ch 12", "ch12"], ["Recipe", "recipes"]],
    },
    {
      goal: "Compare <strong>period</strong> between groups?",
      method: "Estimate τ per individual (periodogram), then t-test or regression on the periods",
      need: "Many individuals; several cycles each",
      go: [["Ch 6", "ch6"], ["Ch 12", "ch12"]],
    },
    {
      goal: "Compare <strong>amplitude</strong> or mean level between groups?",
      method: "Cosinor per individual, then t-test on the parameters",
      need: "Many individuals; τ known or estimated",
      go: [["Ch 7", "ch7"], ["Recipe", "recipes"]],
    },
    {
      goal: "How strong or fragmented is the rhythm?",
      method: "NPCRA: interdaily stability (IS), intradaily variability (IV), relative amplitude (RA), M10 / L5",
      need: "One individual; continuous actigraphy, ≥ 7 days",
      go: [["Ch 9", "ch9"], ["Recipe", "recipes"]],
    },
    {
      goal: "Waveform clearly non-sinusoidal?",
      method: "A shape-matched fit rather than a plain cosine: harmonic cosinor, <strong>rectangular-wave</strong> (crisp on/off rhythms) or <strong>double-logistic</strong> (gradual, asymmetric on/off transitions), all via <strong>FitFunction</strong>; or NPCRA / an average-day profile for a shape-free summary",
      need: "One individual; continuous record",
      go: [["Ch 7", "ch7"], ["Ch 9", "ch9"]],
    },
    {
      goal: "Size and direction of a phase shift (PRC)?",
      method: "Detect activity onsets, then measure the phase difference against the stimulus time",
      need: "One individual; free-run before and after the stimulus",
      go: [["Ch 10", "ch10"]],
    },
    {
      goal: "Only times of events (no magnitude)?",
      method: "Rayleigh test on the event phases",
      need: "Event or onset times, from one or many individuals",
      go: [["Ch 12", "ch12"]],
    },
    {
      goal: "How do two rhythms line up in time?",
      method: "Cross-correlation",
      need: "One individual; two aligned series",
      go: [["Ch 9", "ch9"]],
    },
  ];
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
    &ldquo;You need&rdquo; column below says which each method wants.
  </p>

  <h3 class="section-head">Start from your goal</h3>
  <p>
    Pick the row that matches the question you actually have. The method column
    names what to reach for; the last column links to the chapter and, where one
    exists, a ready-made recipe.
  </p>

  <div class="goal-table-wrap">
    <table class="goal-table">
      <thead>
        <tr>
          <th>Your question</th>
          <th>Reach for</th>
          <th>You need</th>
          <th>Go to</th>
        </tr>
      </thead>
      <tbody>
        {#each goals as row}
          <tr>
            <td class="goal-cell">{@html row.goal}</td>
            <td>{@html row.method}</td>
            <td class="need-cell">{row.need}</td>
            <td class="go-cell">
              {#each row.go as [label, id], i}<a href="#{id}">{label}</a>{#if i < row.go.length - 1}<span class="sep">·</span>{/if}{/each}
            </td>
          </tr>
        {/each}
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
    min-width: 640px;
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
    width: 22%;
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
