<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import MethodTable from '$lib/components/MethodTable.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  import WarnBox from '$lib/components/WarnBox.svelte';
  import NoteBox from '$lib/components/NoteBox.svelte';
</script>

<ChapterSection id="ch13" num="Chapter 13" title="Best Practices and Reporting">
  <h3 class="section-head">Choosing the Right Method</h3>
  <MethodTable
    headers={['Method', 'Best suited for']}
    rows={[
      ['Actogram', 'Visual inspection, quality control, detecting phase shifts and free-running rhythms'],
      ['χ² Periodogram', 'Period detection in dense, equally-spaced activity/locomotor data'],
      ['Lomb-Scargle', 'Period detection in sparse, irregularly-spaced or clinical data'],
      ['Cosinor (fixed-period)', 'Parameter estimation (amplitude, phase, MESOR) with CIs; group comparison'],
      ['Cosinor (free-parameter)', 'Exploratory period estimation when τ is not known in advance'],
      ['Mixed-effects cosinor', 'Multi-subject clinical studies with covariates'],
      ['GAM (cyclic spline)', 'Non-sinusoidal waveforms; exploratory analysis'],
      ['NPCRA (IS, IV)', 'Actigraphy in clinical populations; rhythm fragmentation assessment'],
      ['Circular statistics', 'Comparing phase angles between groups']
    ]}
  />
  <p>A few rules of thumb turn this table into decisions. On <strong>sampling density</strong>: with fewer than roughly 6 samples per 24 h, or clearly irregular timestamps, use Lomb-Scargle; with dense, evenly-spaced data the χ² periodogram is faster and equally valid. On <strong>fixed vs. free period</strong>: use fixed-period cosinor when you already know τ (from the periodogram, or because the animal is entrained to a 24 h cycle), and free-parameter mode only when the period is genuinely unknown. Reach for <strong>NPCRA</strong> or a <strong>GAM</strong> whenever the waveform is visibly non-sinusoidal, since cosinor will then underestimate the amplitude. And always start with an <strong>actogram</strong>: look before you quantify.</p>

  <h3 class="section-head">What Each Method Requires of Your Data</h3>
  <p>
    The table above says what each method is <em>for</em>. This one says what each method
    <em>demands</em>, on the two axes that most often disqualify a method outright,
    after Refinetti, Cornélissen &amp; Halberg<sup class="cite"><a href="#ref-1">[1]</a></sup>.
    A ✗ here is not a matter of degree: it means the method cannot answer the question
    from that kind of data at all, however much data you have.
  </p>
  <MethodTable
    headers={[
      'Method',
      'Single observations from multiple subjects',
      'Unevenly spaced data',
      'In AnCiR'
    ]}
    rows={[
      ['Correlogram', '❌', '❌', 'Correlogram (Plots)'],
      ['Periodogram — Enright', '❌', '❌', 'Periodogram (Plots)'],
      ['Periodogram — χ² (Sokolove-Bushell)', '❌', '❌', 'Periodogram (Plots)'],
      ['Periodogram — Lomb-Scargle', '❌', '✅', 'Periodogram (Plots)'],
      ['Fourier analysis', '❌', '❌', 'Fourier analysis (Plots)'],
      ['Curve fitting — cosinor', '✅', '✅', 'Cosinor (Fitting)'],
      ['Curve fitting — square wave', '✅', '✅', 'Rectangular Wave (Fitting)'],
      ['Curve fitting — double logistic', '✅', '✅', 'Double Logistic (Fitting)'],
      ['ANOVA — general additive model (GAM)', '✅', '✅', '<em>not available</em>'],
      ['ANOVA — general linear model (GLM)', '✅', '✅', '<em>not available</em>']
    ]}
  />
  <p>
    Both columns come down to the same thing: <strong>does the method consume the
    timestamps, or only the sequence?</strong> The correlogram, the Enright and χ²
    periodograms, and Fourier analysis all work by shifting or folding a series
    against <em>itself</em>. They read position in the sequence, not clock time, so
    they assume every sample is one fixed interval after the last. Gaps and irregular
    timestamps silently violate that assumption rather than raising an error, which is
    why the second column is ✗ for all four. Lomb-Scargle escapes this because it
    least-squares-fits sinusoids at each trial period <em>against the actual
    timestamps</em>, so uneven spacing is simply part of the design matrix.
  </p>
  <p>
    The first column is stricter, and Lomb-Scargle does not escape it. Every
    periodogram, correlogram and Fourier method needs <strong>repeated measurements of
    the same individual</strong>, because a period is a within-individual property:
    it is the interval after which <em>that</em> oscillator returns to the same phase.
    One observation per subject carries no such interval, so there is nothing for these
    methods to find. Curve fitting is different in kind: it fits a
    <em>shape</em> to (clock time, value) pairs, and never asks which subject each pair
    came from. Fifty subjects each sampled once, spread across the 24 h cycle, give a
    cosinor exactly what it needs; a rhythm is present if the fitted amplitude differs
    significantly from zero. That is the whole reason cross-sectional and clinical
    studies are almost always analysed by curve fitting.
  </p>
  <WarnBox title="The assumption you take on with a cross-sectional design">
    <p>
      Fitting one curve across many subjects treats between-subject differences as if
      they were within-subject variation over time. That buys the rhythm estimate at
      the cost of assuming the subjects are <em>exchangeable</em>: same period, same
      phase, differing only by noise. Where that fails — a group spanning chronotypes,
      shift workers, or ages — the pooled amplitude is damped toward zero, because
      peaks that fall at different clock times average each other out. A real rhythm
      can therefore be missed entirely. Note also what the table does <em>not</em>
      claim: a cross-sectional cosinor can estimate amplitude, phase and MESOR
      <em>at an assumed period</em>, but it cannot estimate the period itself. See
      <a href="#choosing">Choosing a Method</a> for the longitudinal alternative.
    </p>
  </WarnBox>

  <h3 class="section-head">Recommended Analysis Workflow for Actigraphy Data</h3>
  <AnCiRBox title="Standard Actigraphy Pipeline in AnCiR" tip="On the canvas this whole pipeline is one connected chain of nodes — each step reads from the previous node's output port, so you can change a parameter early on and watch every downstream plot update.">
    <ol>
      <li><strong>Import</strong> your data (time column + activity counts column) via <strong>Sources → Import file</strong>.</li>
      <li><strong>Inspect visually:</strong> add a <strong>scatterplot</strong> of the raw data and a first <strong>actogram</strong> (Plots) to check data quality.</li>
      <li><strong>Remove outliers</strong> (Filtering → Remove Outliers) if there are implausible spikes.</li>
      <li><strong>Handle the resulting gaps.</strong> Outlier removal leaves holes, and the χ² periodogram and FFT need a complete, evenly spaced series. Interpolate short gaps (Binning → Interpolate) or switch to Lomb-Scargle, and <strong>record the fraction of data removed and interpolated</strong>.</li>
      <li><strong>Detrend</strong> (Filtering → Remove Trend, linear) if there is a slow baseline drift.</li>
      <li><strong>Bin</strong> if needed (Binning → Bin Data, e.g., 15-minute bins, mean) to reduce noise and regularise sampling.</li>
      <li><strong>Actogram:</strong> build the main actogram with double-plotting and light-dark shading.</li>
      <li><strong>Periodogram:</strong> run a Chi-squared periodogram to confirm the dominant period and estimate τ.</li>
      <li><strong>Cosinor:</strong> apply Cosinor (Fitting; fixed period = τ from step 7, or 24 h) to extract MESOR, amplitude, and acrophase with 95% confidence intervals.</li>
      <li><strong>Store</strong> key results (period, amplitude, acrophase) with <strong>Store Value</strong> for reporting.</li>
    </ol>
    <DemoLink session="sessions/classroom/learn-hidden-rhythm.json" label="Open a worked example session in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Common Pitfalls</h3>
  <WarnBox title="Common Mistakes to Avoid">
    <ul>
      <li><strong>Analysing raw, unpreprocessed data</strong> — always inspect and preprocess before formal analysis.</li>
      <li><strong>Assuming τ = exactly 24 h</strong> — always estimate τ from the periodogram; even a 0.5 h error matters for cosinor acrophase estimates.</li>
      <li><strong>χ² periodogram on sparse or irregular data</strong> — use Lomb-Scargle instead.</li>
      <li><strong>Linear statistics on circular phase data</strong> — use <a class="gloss" href="#gloss-circular-statistics">circular statistics</a> for acrophase comparisons between groups.</li>
      <li><strong>Insufficient recording duration</strong> — at minimum 5–7 complete cycles are needed for reliable period estimation.</li>
      <li><strong>Chi-squared harmonics in square-wave data</strong> — may produce a spurious 12 h peak. Confirm with Lomb-Scargle.</li>
      <li><strong>Time-unspecified group comparisons</strong> — comparing groups at uncontrolled times without accounting for circadian variation can reverse effect directions (Refinetti et al. 2007, Fig. 26).</li>
      <li><strong>Ignoring masking</strong> — acute environmental effects can temporarily obscure the underlying rhythm.</li>
    </ul>
  </WarnBox>

  <h3 class="section-head">Reporting Standards</h3>
  <p>When reporting chronobiological analyses, include:</p>
  <ul>
    <li>Data type, recording duration, and sampling resolution.</li>
    <li>Preprocessing steps (outlier removal, binning, smoothing) with parameters, and the <strong>proportion of data removed or interpolated</strong>.</li>
    <li>Analysis method and software, including version and citation.</li>
    <li>Estimated period τ with 95% confidence interval.</li>
    <li>Cosinor parameters (MESOR, amplitude, acrophase) with 95% CIs, if applicable.</li>
    <li>Sample size; whether values represent group means or individual estimates.</li>
    <li>Statistical tests for group comparisons, with effect sizes and p-values.</li>
  </ul>
  <p>Report parameters as an estimate with its uncertainty, not a bare number. A complete statement might read:</p>
  <blockquote class="report-example">
    "Locomotor activity was recorded for 10 days at 1-minute resolution, binned to 15 minutes (mean; 0.3% of bins interpolated across short gaps). After linear detrending, a χ² periodogram (0.05 h period step, 60 bins) identified a dominant period of τ = 23.8 h (Q_P = 412, p &lt; 0.001). A 95% CI for τ of 23.7–23.9 h was obtained by linear regression of daily activity onsets on cycle number. Fixed-period cosinor (τ = 23.8 h) estimated MESOR = 102 ± 6, amplitude = 24 ± 5, and acrophase at 14:20 ± 40 min (referenced to day 1; all 95% CI; n = 12). Acrophase differed between treatment and control (Watson-Williams F(1, 22) = 6.1, p = 0.02). Analysed in AnCiR (v β6)."
  </blockquote>
  <p>A <a class="gloss" href="#gloss-p-value">p-value</a> alone is not enough: always pair it with the effect size (here, the actual difference in acrophase and amplitude) so readers can judge biological, not just statistical, significance.</p>

  <NoteBox title="Reporting Acrophase">
    For group comparisons of acrophase, polar plots provide an intuitive summary (amplitude = vector length, acrophase = vector angle). The 95% confidence ellipse shows joint uncertainty. For population-mean cosinor, individual vectors are plotted with the group mean vector and confidence region (Refinetti et al. 2007 <sup class="cite"><a href="#ref-1">[1]</a></sup>, Fig. 22).
  </NoteBox>
  <ChapterExamples chapter="ch13" />
</ChapterSection>

<style>
  .report-example {
    margin: 1rem 0;
    padding: 0.85rem 1.1rem;
    border-left: 4px solid var(--blue, #3e7295);
    background: var(--color-info-bg, #eef4f9);
    border-radius: 0 6px 6px 0;
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--text, #1a202c);
  }
</style>
