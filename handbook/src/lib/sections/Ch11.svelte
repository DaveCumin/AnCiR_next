<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import Formula from '$lib/components/Formula.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  const _tex1 = String.raw`y(t) = \beta_0 + \beta_1\cos\!\left(\frac{2\pi t}{\tau}\right) + \beta_2\sin\!\left(\frac{2\pi t}{\tau}\right) + \text{group}[\cdots] + (1|\text{subject}) + \varepsilon`;
  const _tex2 = String.raw`y(t) = f(t \bmod 24) + \text{covariates} + \varepsilon`;
</script>

<ChapterSection id="ch11" num="Chapter 11" title="General Linear and Additive Models">
  <HistoricalContext
    entries={[
      {
        year: '1990s',
        text: 'Linear mixed-effects models (LMEMs) provide a natural framework for multi-subject chronobiological studies. R packages nlme and later lme4 make these methods accessible.'
      },
      {
        year: '2000s–present',
        text: 'Generalised Additive Models (GAMs) with cyclic smooths are applied to circadian data to handle non-sinusoidal waveforms. LASSO and ridge regression enable high-dimensional circadian omics analysis.'
      }
    ]}
  />

  <p class="chapter-intro">
    <a class="gloss" href="#gloss-cosinor">Cosinor</a> analysis (Chapter 7) fits one rhythm to one recording. But real studies usually have many subjects, measured under different conditions, whose waveforms are not perfectly sinusoidal. The models in this chapter extend cosinor to answer two harder questions: <strong>how do rhythms differ between groups while accounting for individual variability?</strong> (mixed-effects models), and <strong>what if the rhythm's shape is not a simple cosine?</strong> (additive models).
  </p>

  <h3 class="section-head">Mixed-Effects Cosine Models</h3>
  <p>
    When you record several subjects, each has its own baseline level and rhythm, and you typically want a group-level conclusion (e.g. "does the drug shift acrophase?") without being fooled by one unusual individual. A linear <a class="gloss" href="#gloss-lmem">mixed-effects model</a> handles exactly this by fitting cosine predictors together with two kinds of effect:
  </p>
  <Formula tex={_tex1} />
  <p>
    <strong>Fixed effects</strong> are the population-level quantities you care about: the cosine terms that define the average rhythm, plus predictors such as group membership (treatment vs. control) and <strong>continuous covariates</strong> (measured numbers like age or BMI). <strong>Random effects</strong>, written <code>(1|subject)</code>, allow each subject its own baseline: this "random intercept" absorbs the fact that some individuals are simply more active than others, so that between-subject scatter is not mistaken for a treatment effect. Use a mixed-effects model whenever you have repeated measures from multiple subjects and want group-level inference. Implemented in R via <em>lme4</em>; in Python via <em>statsmodels</em>.
  </p>
  <p>
    A <strong>random intercept alone</strong> lets subjects differ in <a class="gloss" href="#gloss-mesor">MESOR</a> but constrains them to share the same amplitude and acrophase — often the very variation the study exists to measure. To allow subject-specific rhythms, put random slopes on the cosine terms too: <code>(1 + cos + sin | subject)</code>. Note also that dense within-subject time series have strongly <a class="gloss" href="#gloss-autocorrelation">autocorrelated</a> residuals, violating the model's conditional-independence assumption and producing over-confident p-values; fit an AR(1) residual correlation structure (available in <em>nlme</em> via <code>corAR1</code>, but not in <em>lme4</em>) or bin coarsely enough to decorrelate.
  </p>

  <h3 class="section-head">Generalised Additive Models (GAMs)</h3>
  <p>
    A cosine assumes the rhythm is a smooth, symmetric wave. Many biological rhythms are not: hormone profiles have sharp peaks, and activity records have long flat rest bouts and steep on/off transitions. <a class="gloss" href="#gloss-gam">GAMs</a> relax that assumption by replacing the fixed cosine with a <strong>smooth function</strong> &mdash; a flexible wiggly curve whose shape is learned from the data rather than imposed in advance:
  </p>
  <Formula tex={_tex2} />
  <p>
    For a daily rhythm the smoother must connect back on itself at the 24-hour boundary (the value and slope at hour 24 must match hour 0), so a <strong>cyclic cubic <a class="gloss" href="#gloss-spline">spline</a></strong> is used: a smooth curve, built from polynomial pieces, that wraps seamlessly around the day. GAMs are the right tool when the waveform clearly departs from a cosine and you care about its true shape; the price is that they estimate a curve rather than a few interpretable parameters like amplitude and acrophase. Implemented in R via <em>mgcv</em>.
  </p>

  <AnCiRBox title="Linear/Additive Models in AnCiR" tip="">
    <p>Formal mixed-effects cosine models and GAMs are not currently implemented in AnCiR. However, AnCiR provides several tools for related analyses (all added from the <strong>node palette</strong>, the <strong>+</strong> button at top-right):</p>
    <ol>
      <li><strong>Cosinor</strong> (Fitting family; fixed period, multiple harmonics) — approximates a GAM for the circadian component. Use 2–3 harmonics for non-sinusoidal waveforms.</li>
      <li><strong>Long To Wide</strong> (Transform family) feeding a Cosinor node — fits all subjects at once and produces a statistics table for further analysis in R. (To bundle several existing columns into one wire, use a <strong>Column Set</strong> or a <strong>Group</strong> rather than the palette, since Collect Columns is not on the node palette.)</li>
      <li><strong>Smooth Data</strong> (LOESS) — a non-parametric smooth, useful for exploring non-sinusoidal shape before fitting a parametric model.</li>
      <li>For full mixed-effects modelling, export your data (via a <strong>tableplot</strong> or <strong>Save session</strong>) and use R (<em>lme4</em>) or Python (<em>statsmodels</em>).</li>
    </ol>
    <DemoLink session="sessions/demos/demo-tp-cosinor.json" label="Open the Cosinor example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch11" />
</ChapterSection>
