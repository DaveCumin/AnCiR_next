<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import HistoricalContext from "$lib/components/HistoricalContext.svelte";
  import AnCiRBox from "$lib/components/AnCiRBox.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import WarnBox from "$lib/components/WarnBox.svelte";
  import Formula from "$lib/components/Formula.svelte";
  import PeriodogramAnim from "$lib/animations/PeriodogramAnim.svelte";

  const contextEntries = [
    {
      year: "1965",
      text: 'James Enright introduces a periodogram for detecting rhythmicity in locomotor activity data, based on the variance of period-folded data<sup class="cite"><a href="#ref-23">[23]</a></sup> — the direct ancestor of the chi-squared periodogram formalised by Sokolove and Bushell in 1978 (below).',
    },
    {
      year: "1976–1982",
      text: 'Building on earlier least-squares spectral methods, Nicholas Lomb<sup class="cite"><a href="#ref-3">[3]</a></sup> (1976) develops a periodogram for unequally spaced data; Jeffrey Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup> (1982) establishes its statistical behaviour and false-alarm probabilities, giving the modern Lomb-Scargle periodogram.',
    },
    {
      year: "1978",
      text: 'Philip Sokolove<sup class="cite"><a href="#ref-2">[2]</a></sup> and Wayne Bushell refine and popularise the chi-square periodogram with a clear mathematical framework still used today (J. Theor. Biol. 72:131–160).',
    },
  ];
  const _tex1 = String.raw`Q_P = \frac{N}{k} \cdot \frac{\displaystyle\sum_j (\bar{x}_j - \bar{x})^2}{s^2}`;
</script>

<ChapterSection id="ch6" num="Chapter 6" title="Periodograms">
  <HistoricalContext entries={contextEntries} />

  <p class="chapter-intro">
    A <a class="gloss" href="#gloss-periodogram">periodogram</a> provides an objective, quantitative assessment of rhythmic
    structure by estimating the relative contribution of different periodicities
    to an observed time series. The result is a plot of spectral power (a
    measure of how strongly each period contributes to the signal) against
    period, with significant peaks identifying dominant rhythms.
  </p>

  <h3 class="section-head">Chi-Squared Periodogram (Sokolove-Bushell)</h3>
  <p>
    The <a class="gloss" href="#gloss-chi-squared-periodogram">chi-squared periodogram</a> is the most widely used method in chronobiology. For each test period P, data
    are folded and the χ² statistic tests whether bin means differ from the
    grand mean:
  </p>
  <Formula tex={_tex1} />
  <p>
    Where N is the number of (binned) data points included, k is the number of
    bins per fold, x̄ⱼ is the mean of bin j, x̄ is the grand mean, and the divisor
    is the <strong>population</strong> <a class="gloss" href="#gloss-variance">variance</a> σ̂² = (1/N)·Σ(xᵢ − x̄)² (divisor N,
    not N−1). The factor N/k must be the <strong>truncated integer</strong> number of
    <em>complete</em> cycles at that trial period, ⌊N/k⌋; non-integer cycle counts
    are the source of the periodogram's well-documented discontinuity artefact.<sup class="cite"><a href="#ref-23">[23]</a></sup>
    Q_p is approximately χ²-distributed with (k−1) <a class="gloss" href="#gloss-degrees-of-freedom">degrees of freedom</a> under the
    <a class="gloss" href="#gloss-null-hypothesis">null hypothesis</a> of no rhythmicity.
  </p>
  <WarnBox title="Important Limitation">
    <p>
      The χ² periodogram requires <strong>equally spaced data</strong>. For
      sparse or irregularly sampled data (e.g., clinical hormone assays), use
      the Lomb<sup class="cite"><a href="#ref-3">[3]</a></sup
      >-Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup> periodogram
      instead.
    </p>
  </WarnBox>

  <h3 class="section-head">Lomb-Scargle Periodogram</h3>
  <p>
    Handles irregularly sampled time series by fitting sinusoidal models at each
    test frequency, correcting for unequal spacing via a time-offset parameter.
    Increasingly used in chronobiology for sparse clinical datasets, actigraphy
    with gaps, and hormone time-course data.
  </p>
  <p>
    Lomb-Scargle is not assumption-free. It fits a <strong>single sinusoid</strong>
    at each frequency, so like <a class="gloss" href="#gloss-cosinor">cosinor</a> it underestimates the amplitude of, and can
    miss, strongly non-sinusoidal (square-wave) rhythms; its noise model is Gaussian
    and homoscedastic, which count data violate (consider a variance-stabilising
    transform); and its standard false-alarm probability assumes independent trial
    frequencies, so it understates the false-positive rate on a fine period grid — a
    permutation-based threshold is safer. Irregular sampling also imposes a spectral
    window whose sidelobes can create spurious peaks, so inspect the sampling pattern
    when it is structured (e.g. daytime-only clinical sampling).
  </p>

  <h3 class="section-head">Enright Periodogram</h3>
  <p>
    The <a class="gloss" href="#gloss-enright-periodogram">Enright periodogram</a><sup class="cite"><a href="#ref-23">[23]</a></sup> folds the series at each trial
    period into a Buys-Ballot table (rows = cycles, columns = position within the
    cycle) and uses the <strong>standard deviation of the column means</strong> as
    its test statistic: a true period makes the fold means scatter widely. It is the
    direct ancestor of the chi-squared periodogram — Sokolove and Bushell's Q_P is
    essentially Enright's statistic rescaled to a known χ² null distribution.
    Because the two are so closely related, an Enright peak and a chi-squared peak
    at the same period are <strong>not independent confirmation</strong> of each
    other. Enright's method makes no distributional assumption and is robust with
    longer recordings.
  </p>

  <h3 class="section-head">Interpreting a Periodogram</h3>
  <ul>
    <li>
      A sharp, high-power peak at ~24 h indicates well-entrained circadian
      rhythmicity.
    </li>
    <li>
      In free-running conditions, the peak shifts to the animal's endogenous τ.
    </li>
    <li>
      Multiple peaks may indicate <a class="gloss" href="#gloss-harmonic">harmonic</a> structure (at τ/2, τ/3) or genuine
      multi-frequency rhythmicity.
    </li>
    <li>
      A flat periodogram suggests arrhythmicity, insufficient data, or excessive
      noise.
    </li>
  </ul>
  <WarnBox title="Harmonic Artefact">
    <p>
      The chi-squared periodogram may identify a spurious 12 h component in
      square-wave data (Refinetti et al. 2007, Fig. 16). If you see a 12 h peak
      alongside the 24 h peak, confirm with Lomb<sup class="cite"
        ><a href="#ref-3">[3]</a></sup
      >-Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup>.
    </p>
  </WarnBox>

  <WarnBox title="The significance line and multiple testing">
    <p>
      A periodogram scanning 16–32 h in 0.05 h steps performs several hundred
      simultaneous χ² tests, so an uncorrected α = 0.05 threshold will be exceeded
      by chance in most pure-noise records. Apply a <strong>Bonferroni-type
      correction</strong> over the number of trial periods tested (use α/m), or
      better, derive the threshold by <strong>permuting the series</strong> and
      taking the 95th percentile of the maximum Q_P — this handles both the
      multiplicity and the correlation between neighbouring trial periods. Two
      further cautions: the χ² null assumes <strong>independent observations</strong>,
      and activity data are strongly autocorrelated, which inflates Q_P and makes
      nominal p-values optimistic; and the <strong>bin size sets the degrees of
      freedom</strong> (k−1), so changing it moves the significance line — always
      report the bin size alongside the p-value.
    </p>
  </WarnBox>

  <p>
    The animation below illustrates a <em>cosinor-style</em> periodogram — it plots
    the variance explained (R²) by a best-fit sinusoid at each trial period, which
    peaks at the true period just as the χ² statistic does. The chi-squared and
    Lomb-Scargle methods above use different statistics but are read the same way.
  </p>

  <PeriodogramAnim height="600px" />

  <AnCiRBox
    title="Running a Periodogram in AnCiR"
    tip="Note the estimated period for use in the next step — Cosinor analysis performs better when you use the measured τ rather than assuming exactly 24 h."
  >
    <ol>
      <li>
        Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right)
        and, under <strong>Plots</strong>, choose <strong>periodogram</strong>.
      </li>
      <li>
        Wire your <strong>time column</strong> into the <strong>x</strong> input and your
        <strong>data column</strong> into the <strong>y</strong> input.
      </li>
      <li>
        Select the <strong>Method</strong>:
        <ul>
          <li>
            <strong>Chi-squared (Sokolove-Bushell)</strong> — best for regularly
            sampled activity data; most widely used in chronobiology.
          </li>
          <li>
            <strong
              >Lomb<sup class="cite"
                ><a href="#ref-3">[3]</a></sup
              >-Scargle<sup class="cite"
                ><a href="#ref-4">[4]</a></sup
              ></strong
            > — use for data with irregular timing or gaps.
          </li>
          <li>
            <strong>Enright</strong> — variance-of-period-folded-means; a robust
            alternative to Chi-squared for longer recordings.
          </li>
        </ul>
      </li>
      <li>
        Set the period range to test using <strong>Period min</strong> and
        <strong>Period max</strong> (e.g., 16–32 h for circadian analysis; widen for
        ultradian/infradian) and the <strong>Step</strong> resolution (default 0.25 h).
        The default method is <strong>Lomb-Scargle</strong>.
      </li>
      <li>
        For the <strong>Chi-squared</strong> method, set the <strong>Bin Size</strong>
        (e.g., 0.5–1 h) and the significance level <strong>Alpha</strong> (default 0.05);
        a significance threshold line is then drawn across the plot. These two controls
        appear only for Chi-squared — the Lomb-Scargle and Enright methods do not draw a
        significance line, so judge their peaks against a permutation threshold if you
        need a formal test.
      </li>
      <li>
        The dominant <strong>Peak Period</strong> and its <strong>Peak Power</strong>
        are reported in the node.
      </li>
      <li>
        Hover over the plot to read off the exact period and power at any point.
      </li>
    </ol>
    <DemoLink session="sessions/demos/demo-periodogram-rhythm.json" label="Open the Periodogram example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch6" />
</ChapterSection>
