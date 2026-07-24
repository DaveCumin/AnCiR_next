<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import HistoricalContext from "$lib/components/HistoricalContext.svelte";
  import Formula from "$lib/components/Formula.svelte";
  import ParamTable from "$lib/components/ParamTable.svelte";
  import AnCiRBox from "$lib/components/AnCiRBox.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import CorrelogramAnim from "$lib/animations/CorrelogramAnim.svelte";

  const historyEntries = [
    {
      year: "1930s–40s",
      text: 'Norbert Wiener\'s work on generalised harmonic analysis (1930)<sup class="cite"><a href="#ref-29">[29]</a></sup> and time-series prediction (1949) formalises the link between the autocorrelation function and the power spectrum — a foundation later adopted in biological rhythm research.',
    },
    {
      year: "1990s",
      text: 'Non-parametric circadian rhythm analysis (NPCRA) metrics including Interdaily Stability (IS) and Intradaily Variability (IV) are developed for actigraphic data in clinical and ageing research (Witting et al.<sup class="cite"><a href="#ref-10">[10]</a></sup>; van Someren et al.<sup class="cite"><a href="#ref-11">[11]</a></sup>).',
    },
  ];

  const metricsHeaders = ["Metric", "What it measures", "Range"];
  const metricsRows = [
    [
      "Interdaily Stability (IS)",
      "Fraction of total variance explained by the average 24-hour pattern — a measure of how regular the daily rhythm is across multiple days",
      "0 (no regularity) to 1 (perfect)",
    ],
    [
      "Intradaily Variability (IV)",
      "Mean squared difference between consecutive time points relative to overall variance — a measure of within-day fragmentation",
      "0 (smooth) to a theoretical max of 4; IV ≈ 2 is the value expected from uncorrelated noise",
    ],
    [
      "M10 / L5",
      "Mean activity over the most active 10 hours (M10) and least active 5 hours (L5) of the average day, plus their onset times",
      "Activity units; onsets in hours",
    ],
    [
      "Relative Amplitude (RA)",
      "(M10 − L5) / (M10 + L5) — normalised difference between the active and rest phases, robust to overall activity level",
      "0 (no rhythm) to 1 (strong)",
    ],
  ];
  const _tex1 = String.raw`r(k) = \frac{\displaystyle\sum_{i=1}^{N-k} (y_i - \bar{y})(y_{i+k} - \bar{y})}{\displaystyle\sum_{i=1}^{N} (y_i - \bar{y})^2}`;
  const _tex2 = String.raw`\hat{\tau} = k_{\text{peak}} \cdot \Delta t \quad \text{(first ACF peak lag} \times \text{sampling interval)}`;
</script>

<ChapterSection id="ch9" num="Chapter 9" title="Correlograms">
  <HistoricalContext entries={historyEntries} />

  <p class="chapter-intro">
    The <a class="gloss" href="#gloss-autocorrelation">autocorrelation</a> function (ACF) measures the correlation of a time series
    with a time-lagged version of itself. A <a class="gloss" href="#gloss-correlogram">correlogram</a> (ACF vs. lag) detects
    rhythmicity and estimates period without the distributional assumptions of
    spectral methods.
  </p>

  <h3 class="section-head">The Autocorrelation Function</h3>
  <Formula tex={_tex1} />

  <p>
    For a 24-hour rhythm, significant positive peaks are expected at lags of
    approximately 24, 48, and 72 hours. This is the standard <strong>biased</strong>
    estimator: because the numerator has only N − k terms while the denominator has
    N, r(k) is automatically shrunk by roughly (N − k)/N. Peak heights therefore
    decline with lag <em>even for a perfect, noiseless rhythm</em>, and only the
    excess decline reflects genuine loss of rhythm stability. Under the null of
    white noise, r(k) has approximate 95% bounds of <strong>±1.96/√N</strong>,
    conventionally drawn on the correlogram; peaks outside them are taken as
    significant.
  </p>
  <p>
    The ACF assumes a <strong>stationary, evenly spaced</strong> series and requires
    the data to be <a class="gloss" href="#gloss-detrending">detrended</a> first — an undetrended drift produces a slowly
    decaying, uniformly positive ACF that buries the rhythmic peaks. It is also
    unreliable if the period or amplitude changes during the record; segment the
    record and analyse each part separately.
  </p>

  <h3 class="section-head">Period Estimation</h3>
  <Formula tex={_tex2} />

  <p>
    This approach is robust to moderate noise. If no clear peak appears within
    the circadian range, this suggests arrhythmicity or signal-to-noise too low
    for reliable detection.
  </p>

  <CorrelogramAnim />

  <AnCiRBox title="Creating a Correlogram in AnCiR" tip="The correlogram estimates period from the autocorrelation function. For the NPCRA metrics (IS, IV, RA, M10, L5), use the separate Nonparametric RA node described below.">
    <ol>
      <li>
        Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right)
        and, under <strong>Plots</strong>, choose <strong>correlogram</strong>.
      </li>
      <li>
        Wire your <strong>time column</strong> into the <strong>x</strong> input and your
        <strong>data column</strong> into the <strong>y</strong> input.
      </li>
      <li>The autocorrelation function is plotted against lag (in hours).</li>
      <li>
        Significant peaks at 24, 48, 72 h confirm circadian rhythmicity. The lag
        of the first major positive peak after zero estimates τ; AnCiR reports the
        overall <strong>peak lag</strong>.
      </li>
      <li>
        Adjust the minimum and maximum <strong>lag range</strong> to inspect ultradian
        structure (&lt; 24 h) or multi-day rhythms (> 24 h).
      </li>
    </ol>
    <DemoLink session="sessions/demos/demo-correlogram-rhythm.json" label="Open the Correlogram example in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Non-Parametric Rest-Activity Metrics</h3>
  <p>
    Not every rhythm is a smooth sine wave. Rest-activity records in particular
    switch sharply between rest and activity, so <a class="gloss" href="#gloss-cosinor">cosinor</a>
    and spectral measures of <a class="gloss" href="#gloss-amplitude">amplitude</a> can be
    misleading. <a class="gloss" href="#gloss-npcra">NPCRA</a> metrics instead summarise the
    rhythm directly from the data, without assuming a sinusoidal shape, by folding
    activity onto an average 24-hour profile<sup class="cite"><a href="#ref-10">[10]</a><a href="#ref-11">[11]</a><a href="#ref-18">[18]</a></sup>.
    <a class="gloss" href="#gloss-is">IS</a> and <a class="gloss" href="#gloss-iv">IV</a>
    capture day-to-day regularity and within-day fragmentation, while M10, L5, and
    Relative Amplitude (RA) describe the height and contrast of the active and rest
    phases. They are especially useful in clinical populations (older adults, ICU
    patients, dementia) where traditional period estimation may be unreliable due to
    irregular activity patterns.
  </p>

  <ParamTable headers={metricsHeaders} rows={metricsRows} />

  <p>
    All four metrics are computed on the <strong>binned</strong> record and are
    strongly <strong>epoch-dependent</strong> — IS and IV computed at 1-minute and
    1-hour epochs are not comparable, so always report the epoch. IS is biased upward
    in short records and needs at least 7 days. Note that IS is arithmetically the
    Sokolove-Bushell statistic at a 24 h trial period divided by N, linking this
    chapter to Chapter 6. Finally, all of these describe <em>observed behaviour, not
    the endogenous clock</em>: they are fully exposed to masking by light, feeding and
    social schedule. AnCiR also provides a <strong>Cross-correlation</strong> node
    (Analysis family) for the correlation between two series at each lag — useful for
    measuring the delay between, say, activity and temperature rhythms.
  </p>

  <AnCiRBox title="Non-Parametric Rest-Activity Metrics in AnCiR" tip="The Nonparametric RA node outputs IS, IV, RA, M10, L5 and their onsets as scalar ports, so you can wire them straight into a Boxplot or Compare Groups node to contrast conditions.">
    <ol>
      <li>
        Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right)
        and, under <strong>Analysis</strong>, choose <strong>Nonparametric RA</strong>.
      </li>
      <li>
        Wire your <strong>time column</strong> into the <strong>x</strong> input and one or
        more <strong>activity columns</strong> into the <strong>y</strong> input (each
        subject is analysed independently).
      </li>
      <li>
        Set the <strong>epoch</strong> (resampling interval, default 1 h), the
        <strong>period</strong> (default 24 h), and the <strong>M</strong> / <strong>L</strong>
        window lengths (default 10 h and 5 h).
      </li>
      <li>
        The node reports <strong>IS</strong>, <strong>IV</strong>, <strong>RA</strong>,
        <strong>M10</strong>, <strong>L5</strong>, and the M10/L5 onset times, alongside the
        average-day profile.
      </li>
    </ol>
  </AnCiRBox>
  <ChapterExamples chapter="ch9" />
</ChapterSection>

<style>
  :global(.chapter-intro) {
    margin: 1.5rem 0;
    font-size: 1.05rem;
    line-height: 1.6;
  }

  :global(.section-head) {
    margin-top: 2rem;
    margin-bottom: 1rem;
    font-size: 1.2rem;
    font-weight: 600;
  }

  :global(.cite) {
    font-size: 0.9em;
  }

  :global(.cite a) {
    color: inherit;
    text-decoration: none;
  }

  :global(.cite a:hover) {
    text-decoration: underline;
  }
</style>
