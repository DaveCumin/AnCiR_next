<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import Formula from '$lib/components/Formula.svelte';
  import ParamTable from '$lib/components/ParamTable.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  import NoteBox from '$lib/components/NoteBox.svelte';

  const historyEntries = [
    {
      year: '1950s–60s',
      text: 'Franz Halberg (University of Minnesota) develops cosinor analysis as a principled way to estimate rhythm parameters from clinical and physiological data. Halberg had coined the term "circadian" in 1959.'
    },
    {
      year: '1967',
      text: 'Halberg formally describes the cosinor method<sup class="cite"><a href="#ref-5">[5]</a></sup>; it rapidly becomes the standard for quantifying circadian parameters in human studies.'
    },
    {
      year: '1970s–80s',
      text: 'The population-mean cosinor extension is developed, enabling group-level inference across multiple subjects.'
    },
    {
      year: 'Present',
      text: 'Cosinor analysis is implemented in cosinor2 (R), CircadiPy (Python), BioDare2 (web), and AnCiR.'
    }
  ];

  const paramHeaders = ['Parameter', 'Meaning', 'Units'];
  const paramRows = [
    ['MESOR (M)', 'Rhythm-adjusted mean — the midline of the fitted cosine', 'Same as y'],
    ['Amplitude (A)', 'Half the peak-to-trough excursion of the rhythm', 'Same as y'],
    ['Acrophase (φ)', 'Time of peak (clock time or hours from ZT0)', 'Hours'],
    ['Period (τ)', 'Duration of one cycle — fixed or free to vary', 'Hours']
  ];

  const ancirTip = 'Best practice: Detrend the data first (Remove Trend column process) if there is a slow baseline drift, then bin or smooth before fitting the cosinor.';
  const _tex1 = String.raw`y(t) = M + \beta\cos\!\left(\frac{2\pi t}{\tau}\right) + \gamma\sin\!\left(\frac{2\pi t}{\tau}\right) + \varepsilon(t)`;
  const _tex2 = String.raw`A = \sqrt{\beta^2 + \gamma^2}, \qquad \phi = \operatorname{atan2}(-\gamma,\ \beta)`;
</script>

<ChapterSection id="ch7" num="Chapter 7" title="Cosinor Analysis">
  <HistoricalContext entries={historyEntries} />

  <p class="chapter-intro"><a class="gloss" href="#gloss-cosinor">Cosinor</a> analysis is a regression-based method for characterising rhythms. Unlike periodograms, which detect <em>whether</em> a rhythm exists, cosinor analysis <strong>estimates rhythm parameters</strong> — <a class="gloss" href="#gloss-mesor">MESOR</a>, <a class="gloss" href="#gloss-amplitude">amplitude</a>, and <a class="gloss" href="#gloss-acrophase">acrophase</a> — with <a class="gloss" href="#gloss-confidence-interval">confidence intervals</a>, enabling formal comparison between groups or conditions.</p>

  <h3 class="section-head">The Cosinor Model</h3>
  <p>A rhythm is modelled as a cosine function fitted by linear regression. By substituting β = A·cos(φ) and γ = −A·sin(φ):</p>

  <Formula tex={_tex1} />

  <p>This is linear in β and γ and is fitted by ordinary least squares. The rhythm parameters are recovered as:</p>

  <Formula tex={_tex2} />

  <p>The <strong>two-argument</strong> arctangent (<code>atan2</code>) is essential — plain <code>arctan</code> cannot separate φ from φ + π and would place the <a class="gloss" href="#gloss-acrophase">acrophase</a> at the trough for half of all datasets. Convert to clock time as t<sub>peak</sub> = φ·τ/2π (mod τ). The classical cosinor convention instead reports acrophase in <strong>negative degrees</strong> from a stated reference time (0°), with 360° = one period; whichever you use, <strong>always state the reference time</strong>, and note that when τ ≠ 24 h the acrophase drifts in clock time across the record.</p>

  <ParamTable headers={paramHeaders} rows={paramRows} />

  <h3 class="section-head">Fixed-Period vs. Free-Parameter Mode</h3>
  <p>When the period is known (e.g., studying a circadian rhythm in LD conditions), <strong>fixed-period (Halberg) cosinor</strong> is preferred — it gives more robust parameter estimates with confidence intervals and an <a class="gloss" href="#gloss-f-test">F-test</a> for rhythm significance. When the period is unknown, <strong>free-parameter</strong> mode fits the period alongside amplitude and phase.</p>
  <p>For fixed τ the model is linear in (M, β, γ) and the test of rhythmicity is the joint hypothesis H₀: β = γ = 0, an F-test with <strong>2 and N − 3 degrees of freedom</strong>. This assumes <strong>independent residuals</strong>. Circadian recordings are strongly autocorrelated, so p-values are optimistic and confidence intervals too narrow unless the data are binned coarsely enough to decorrelate, or an autocorrelation-aware model is used (Chapter 11). In free-period mode τ is estimated too, the model is <em>no longer linear</em>, and OLS/F-test theory does not apply — intervals are asymptotic approximations at best.</p>

  <h3 class="section-head">Population-Mean Cosinor</h3>
  <p>When multiple subjects have been recorded, the <a class="gloss" href="#gloss-population-cosinor">population-mean cosinor</a><sup class="cite"><a href="#ref-6">[6]</a></sup> estimates group-level rhythm parameters by vector-averaging individual (β, γ) estimates, tested using the modified F-test (Nelson et al.<sup class="cite"><a href="#ref-7">[7]</a></sup>; Bingham et al.<sup class="cite"><a href="#ref-8">[8]</a></sup>).</p>
  <NoteBox title="Population-mean cosinor and AnCiR">
    <p>AnCiR does not yet implement the population-mean cosinor as a single test: wiring several <strong>Y columns</strong> (one per subject) into a <strong>Cosinor</strong> node fits each subject <em>independently</em> and returns a per-subject results table. To obtain a group-level estimate, export that table (via a <strong>tableplot</strong> or <strong>Save session</strong>) and vector-average the individual (β, γ) estimates in R (<em>cosinor2</em>) or Python, or plot the individual acrophases on the <strong>Circular phase plot</strong> and test them with the <strong>Rayleigh test</strong> node (Chapter 12).</p>
  </NoteBox>

  <AnCiRBox title="Cosinor Analysis in AnCiR" tip={ancirTip}>
    <ol>
      <li>Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right) and, under <strong>Fitting</strong>, choose <strong>Cosinor</strong>.</li>
      <li>Expand the node and choose your <strong>X column</strong> (time) and one or more <strong>Y columns</strong>. Multiple Y columns are fitted independently in one step.</li>
      <li>Choose the mode:
        <ul>
          <li><strong>Use Fixed Period (Halberg cosinor):</strong> enter the <strong>Period (hrs)</strong> (use 24 h, or your estimated τ from the periodogram) and the number of <strong>harmonics</strong> (<a class="gloss" href="#gloss-harmonic">harmonics</a>; start with 1). Choose the <strong>CI level</strong> (the dropdown offers 95% / 99%). This gives MESOR, amplitude, acrophase ± CI, and an F-test <a class="gloss" href="#gloss-p-value">p-value</a>. AnCiR can also run an optional <strong>permutation test</strong> for a distribution-free p-value.</li>
          <li><strong>Free period:</strong> leave Fixed Period unticked and set <strong>N cosine curves</strong> = 1 to fit a single sinusoid with optimised period and phase. N &gt; 1 fits multiple overlapping cosines.</li>
        </ul>
      </li>
      <li>Optionally enable an <strong>Output X column</strong> (a regularly spaced Sequence Column) to evaluate the fitted curve at fine intervals for a smooth overlay.</li>
      <li>The node outputs fitted columns plus a results table; read off <strong>MESOR</strong>, <strong>amplitude</strong>, <strong>acrophase</strong>, <strong>R²</strong>, and <strong>p-value</strong>.</li>
      <li><strong>Overlay the fit:</strong> add a <strong>scatterplot</strong> from the palette, wire the raw data as one series (points) and the fitted columns as a second series (line).</li>
      <li>Click <strong>Store Value</strong> next to any scalar (e.g., period, amplitude) to save it as a <strong>Stored Value</strong> for use in Formula Columns or elsewhere.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-tp-cosinor.json" label="Open the Cosinor example in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Beyond the Cosine: Non-Sinusoidal Fits</h3>
  <p>A cosine is the right model only when the waveform is roughly sinusoidal. Many activity rhythms are not: they switch sharply between active and rest, or rise and fall on different timescales. A single cosine then <strong>underestimates the amplitude</strong> and can misplace the peak. AnCiR's <strong>Fitting</strong> family offers shape-matched alternatives, all fitted by nonlinear least squares and sharing the same permutation significance test, so you can compare their fits on the same series.</p>
  <AnCiRBox title="Other fitting models in AnCiR">
    <ul>
      <li><strong>Harmonic cosinor</strong> — set <strong>harmonics</strong> &gt; 1 on the <strong>Cosinor</strong> node to bend the sinusoid toward the true shape while keeping cosinor's interpretable parameters.</li>
      <li><strong>Rectangular Wave</strong> (Fitting) — a smooth on/off square wave (a hyperbolic-tangent, <code>tanh</code>, approximation) for near-binary active/rest rhythms. Its <strong>duty cycle</strong> parameter reports the fraction of each cycle spent active; a sharpness parameter controls how square the corners are.</li>
      <li><strong>Double-Logistic</strong> (Fitting) — two back-to-back sigmoids modelling a smooth rise to a plateau and a return, giving <em>separate</em> transition times and steepnesses for the onset and the offset. Standard in land-surface phenology, and a good fit when circadian on/off transitions are gradual and possibly asymmetric.</li>
      <li><strong>FitFunction</strong> (Fitting) — the umbrella node: switch between cosinor, rectangular-wave and double-logistic on the same series without rewiring, with a common set of controls.</li>
    </ul>
    <p>Match the model to the biology: cosinor for smooth, near-sinusoidal rhythms; rectangular wave for crisp on/off patterns; double-logistic when onset and offset are gradual. For a summary that assumes <em>no</em> functional form at all, use the nonparametric rest-activity measures or the average-day profile (<a href="#ch9">Chapter 9</a>).</p>
  </AnCiRBox>
  <ChapterExamples chapter="ch7" />
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
