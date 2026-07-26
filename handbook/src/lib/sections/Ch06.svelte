<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import HistoricalContext from "$lib/components/HistoricalContext.svelte";
  import AnCiRBox from "$lib/components/AnCiRBox.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import WarnBox from "$lib/components/WarnBox.svelte";
  import NoteBox from "$lib/components/NoteBox.svelte";
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
  <NoteBox title="How this relates to the FFT">
    <p>
      Lomb-Scargle is, in effect, a <a href="#ch7">cosinor</a> swept across frequencies: at each trial period it fits a sinusoid and reports how much of the variance that fit explains. The <a href="#ch8">FFT</a> does the same thing, with two restrictions lifted here.
    </p>
    <p>
      First, the FFT can only test frequencies on a <strong>fixed grid</strong> (one, two, three… whole cycles across the record); Lomb-Scargle can test any period you name, so you can search 20&ndash;28 h at whatever step you choose. Second, the FFT relies on even spacing to keep its sine and cosine terms independent of each other; Lomb-Scargle restores that independence explicitly, with a small time offset computed at each frequency, which is what lets it cope with gaps and irregular timestamps.
    </p>
    <p>
      For evenly spaced, complete data the two give the same answer. The differences only appear when the sampling is not ideal &mdash; which, for clinical and field data, is most of the time.
    </p>
  </NoteBox>
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

  <h3 class="section-head">Correcting for Multiple Comparisons</h3>
  <p>
    The warning above applies whenever you run more than one test. Screen 15,000 transcripts for rhythmicity at p &lt; 0.05 and you should expect roughly <strong>750 false positives</strong> before any real biology — comparable to the true signal in many tissues. The same problem arises on a smaller scale whenever you test several animals, several tissues, or several metrics.
  </p>
  <p>
    Two different things can be controlled, and choosing between them is the real decision:
  </p>
  <ul>
    <li>
      The <strong>family-wise error rate (FWER)</strong> — the probability of <em>even one</em> false positive. Strict, appropriate when a single wrong claim is costly.
    </li>
    <li>
      The <strong>false discovery rate (FDR)</strong> — the expected <em>proportion</em> of your declared discoveries that are false. More permissive, and the right frame for a screen whose output is a candidate list you intend to follow up.
    </li>
  </ul>

  <AnCiRBox title="FDR Correction node" tip="Wire the node's padj output into a Filter to keep only the rows that survive, or plot padj against the raw p-value to see how hard the correction bit.">
    <p>
      The <strong>FDR Correction</strong> node (Analysis family) takes a column of p-values in <code>xIN</code> and returns two columns: <strong>padj</strong> (the adjusted p-values) and <strong>reject</strong> (whether each survives at your chosen α).
    </p>
    <ul>
      <li>
        <strong>Benjamini-Hochberg</strong> — controls FDR under independence or positive dependence. The default, and the right choice for almost every omics screen.
      </li>
      <li>
        <strong>Benjamini-Yekutieli</strong> — controls FDR under <em>arbitrary</em> dependence. More conservative; use when the tests may be negatively correlated in ways you cannot rule out.
      </li>
      <li>
        <strong>Holm</strong> — controls FWER, step-down. Uniformly more powerful than Bonferroni, so there is rarely a reason to prefer Bonferroni to it.
      </li>
      <li>
        <strong>Bonferroni</strong> — controls FWER by multiplying each p-value by <em>n</em>. Simple and very conservative.
      </li>
      <li>
        <strong>None</strong> — pass through unchanged, for when correction is applied elsewhere.
      </li>
    </ul>
    <p>
      Set <strong>alpha</strong> (default 0.05) to the threshold you will report against. The adjusted values are computed so that comparing <code>padj</code> against α gives the same decisions as the classical step-up or step-down procedure.
    </p>
  </AnCiRBox>

  <NoteBox title="Two details worth knowing">
    <p>
      <strong>Failed fits do not tighten the correction.</strong> Non-finite p-values — from a node that did not converge — are carried through as NaN and excluded from the count <em>n</em>, rather than being silently treated as 1. A model that failed to fit should not make the correction harsher for the ones that succeeded.
    </p>
    <p>
      <strong>The implementation is checked against a reference.</strong> All four methods are tested to agree with the standard implementations (as in Python's <code>statsmodels</code>) to nine decimal places, so results are directly comparable with a scripted pipeline.
    </p>
  </NoteBox>

  <h3 class="section-head">Surrogate Testing: a Null That Respects Your Data</h3>
  <p>
    The significance line on a periodogram, and the p-value from a cosinor, both rest on an assumption that circadian data routinely break: that the noise is <strong>independent from one sample to the next</strong>. It is not. Activity now strongly predicts activity a minute from now, and that autocorrelation alone produces broad spectral peaks that look convincingly rhythmic.
  </p>
  <p>
    A <strong>surrogate test</strong> sidesteps the assumption entirely. Instead of trusting a formula, it builds the null distribution empirically: generate many artificial series that share the nuisance structure of your data but contain <em>no genuine rhythm</em>, compute the same statistic on each, and see where your real value falls.
  </p>
  <p>
    Everything depends on what "share the nuisance structure" means, which is what the method choice controls.
  </p>

  <AnCiRBox title="Surrogate Test node" tip="Start with block and a block length near one cycle. If the result is borderline, try ar1 and phase as well — a rhythm that survives all three is a rhythm worth reporting.">
    <p>
      The <strong>Surrogate Test</strong> node (Analysis family) takes time in <code>xIN</code> and values in <code>yIN</code>, and returns a <strong>pvalue</strong> and the <strong>observed</strong> statistic as metrics you can wire onward or store.
    </p>
    <ul>
      <li>
        <strong>Block</strong> (default) — resample contiguous blocks of the record. Preserves short-range autocorrelation up to the block length while destroying rhythm across blocks. Set <strong>blockLengthHours</strong> near one cycle (default 24).
      </li>
      <li>
        <strong>AR(1)</strong> — fit a first-order autoregressive model and simulate from it. The classic "red noise" null: this asks directly whether your peak beats what autocorrelation alone would produce.
      </li>
      <li>
        <strong>Phase</strong> — randomise the Fourier phases while keeping the amplitude spectrum exactly. Preserves the entire autocorrelation structure; a strict and widely used null.
      </li>
      <li>
        <strong>AAFT</strong> — amplitude-adjusted Fourier transform. Like phase randomisation, but also preserves the <em>distribution</em> of the values, which matters for skewed data such as activity counts.
      </li>
      <li>
        <strong>Shuffle</strong> — plain random reordering. Destroys autocorrelation along with the rhythm, which makes the null far too easy to beat. Included for comparison and teaching; <strong>not</strong> a defensible primary analysis for a dense record.
      </li>
    </ul>
    <p>
      Set <strong>nSurrogates</strong> (default 199) to control resolution — the smallest achievable p-value is 1/(n+1), so 199 surrogates bottoms out at 0.005. Set <strong>seed</strong> for a reproducible result. <strong>periodMin</strong> and <strong>periodMax</strong> (default 20–28 h) bound the period range searched.
    </p>
  </AnCiRBox>

  <WarnBox title="Shuffling is the wrong null for a time series">
    <p>
      This is the single most common mistake in surrogate testing. Randomly reordering your data destroys the autocorrelation as well as the rhythm, so the resulting null is a white-noise null — a much lower bar than your data actually face. Almost any real recording beats it, and the resulting p-value is spuriously tiny.
    </p>
    <p>
      Use <strong>block</strong>, <strong>ar1</strong>, or <strong>phase</strong> for any densely sampled record. Reserve <strong>shuffle</strong> for genuinely independent observations — one value per subject, for instance.
    </p>
  </WarnBox>

  <NoteBox title="Why the p-value is never exactly zero">
    <p>
      The node computes p as <strong>(k + 1) / (m + 1)</strong>, where <em>k</em> is the number of surrogates matching or exceeding your observed statistic and <em>m</em> is the number of surrogates. Adding one to each count includes the observed value in its own reference distribution, which is the standard convention for a Monte Carlo test.
    </p>
    <p>
      The practical consequence is that p can never be 0 — with 199 surrogates the floor is 0.005. This is honest: having beaten 199 random draws is evidence, but it is not evidence of p &lt; 0.001. If you need a smaller p-value, run more surrogates.
    </p>
  </NoteBox>
  <ChapterExamples chapter="ch6" />
</ChapterSection>
