<script>
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import Recipe from "$lib/components/Recipe.svelte";
  import NoteBox from "$lib/components/NoteBox.svelte";
</script>

<ChapterSection id="recipes" num="Recipes" title="Recipes: Common Tasks, Start to Finish">
  <p class="chapter-intro">
    The method chapters explain <em>how</em> each analysis works. This section is
    the other way round: it starts from a <strong>goal</strong> and walks you
    through the exact node chain that gets you there, using a ready-made example
    session you can open in AnCiR and take apart. Each recipe links back to the
    chapter that explains the reasoning.
  </p>

  <NoteBox title="How to use a recipe">
    <p>
      Click <strong>Open this example in AnCiR</strong> to load the finished
      workflow on the canvas, then follow the steps below against it — double-click
      any node to see its settings, and change a value to watch every downstream
      plot update. The numbers quoted under <em>What to read off</em> are the values
      baked into that example session.
    </p>
  </NoteBox>

  <h3 class="section-head">Detecting and describing a rhythm</h3>

  <Recipe
    title="First, is there a rhythm at all?"
    chapters='Chapters <a href="#ch5">5</a> and <a href="#ch6">6</a>'
    when="Before you quantify anything. A periodogram always returns a &lsquo;peak period&rsquo;, even for noise, so you need a way to tell a real rhythm from nothing."
    data="A single time column and one activity/value column, several days long."
    steps={[
      "<strong>Import file</strong> (Sources) &mdash; or open the example, which contains two records with the same average activity: one intact, one arrhythmic (as after SCN ablation).",
      "<strong>actogram</strong> (Plots) on each &mdash; the intact record shows an obvious activity band; the arrhythmic one shows none.",
      "<strong>periodogram</strong> (Plots) on each &mdash; compare the <strong>peak power</strong>, not just the peak period.",
    ]}
    readoff="The arrhythmic periodogram does <em>not</em> go blank &mdash; it still reports a peak period, but at low power and with no band in the actogram. The intact record has a tall, significant peak and a clear band."
    pitfall="Never report a peak period without its <strong>power</strong> and a look at the raw actogram. A bare period number is meaningless on its own."
    session="sessions/demos/demo-workflow-arrhythmic.json"
    sessionLabel="Open the arrhythmic negative-control example"
  />

  <Recipe
    title="Measure a rhythm's period (τ)"
    chapters='Chapters <a href="#ch5">5</a> and <a href="#ch6">6</a>'
    when="You want the endogenous period of a rhythm running without a zeitgeber (e.g. an animal in constant darkness), or you simply need τ before fixing it in a cosinor fit."
    data="A time column and an activity column spanning at least 7 cycles, preferably 10&ndash;14."
    steps={[
      "<strong>actogram</strong> (Plots), double-plotted &mdash; a rhythm whose τ differs from 24 h drifts steadily across days instead of sitting vertical (right = τ &gt; 24 h, left = τ &lt; 24 h).",
      "<strong>periodogram</strong> (Plots) with method <strong>Lomb-Scargle</strong> to estimate τ numerically.",
      "<strong>Rhythmicity Analysis</strong> (Analysis) to output the peak period as a wireable number for a table or downstream comparison.",
    ]}
    readoff="The example free-runs at τ ≈ 24.8 h; the periodogram recovers a peak at <strong>24.85 h</strong>. The actogram band visibly leans to the right against the 24 h grid."
    pitfall="Avoid the chi-square (Sokolove-Bushell) periodogram as your <em>first</em> choice for period estimation &mdash; it systematically underestimates period. Lomb-Scargle is the safer default."
    session="sessions/demos/demo-workflow-free-running.json"
    sessionLabel="Open the free-running period example"
  />

  <Recipe
    title="Measure a rhythm's phase (acrophase)"
    chapters='Chapter <a href="#ch7">7</a>'
    when="You want the time of day at which a rhythm peaks &mdash; the single most reported circadian parameter &mdash; with a confidence interval."
    data="A time column and a value column. Sparse or unevenly sampled data are fine; fix the period if you already know it."
    steps={[
      "<strong>Remove Trend</strong> (Filtering, linear) first if there is a slow baseline drift &mdash; a trend biases the MESOR and inflates the amplitude.",
      "<strong>Cosinor</strong> (Fitting): tick <strong>Use Fixed Period</strong> and enter 24 h (or your measured τ), harmonics = 1, and a 95% CI.",
      "Read the <strong>acrophase</strong>, <strong>amplitude</strong>, <strong>MESOR</strong> and F-test p-value from the node; overlay the fitted curve on a scatterplot to sanity-check it.",
    ]}
    readoff="Acrophase in hours (convert to clock time as t = φ·τ/2π), amplitude, MESOR, each with its 95% CI, plus an F-test p-value for whether a rhythm is present at all."
    pitfall="Always state the <strong>reference time</strong> the acrophase is measured from, and remember the F-test assumes independent residuals &mdash; dense, autocorrelated data make its p-value optimistic."
    session="sessions/demos/demo-tp-cosinor.json"
    sessionLabel="Open the Cosinor example"
  />

  <h3 class="section-head">Comparing two groups</h3>

  <Recipe
    title="Do two groups peak at different times? (phase difference)"
    chapters='Chapters <a href="#ch7">7</a> and <a href="#ch12">12</a>'
    when="The canonical &lsquo;does the treatment shift the clock?&rsquo; question &mdash; comparing acrophases (or onset times) between two groups."
    data="Repeated recordings from several subjects per group (the example uses 8 per group over 4 days)."
    steps={[
      "One <strong>Cosinor</strong> node per group (fixed 24 h). Because a scalar metric port emits one value per Y input, the <strong>acrophase</strong> port becomes that group's whole distribution of per-subject peak times.",
      "Wire both acrophase columns into the <strong>Circular phase plot</strong> (Plots) &mdash; each group appears as a coloured cluster on a 24 h clock with its mean-resultant vector.",
      "Wire the same two columns into the <strong>Rayleigh test</strong> (Analysis), with the <strong>Watson-Williams</strong> toggle on.",
    ]}
    readoff="Rayleigh R and p per group (is each group clustered at all?), and a Watson-Williams F and p for whether they share a mean phase. In the example, group A peaks ≈ 7.4 h and B ≈ 14.2 h; R ≈ 0.97/0.99; Watson-Williams F ≈ 292, p ≈ 0 &mdash; the groups differ."
    pitfall="Never compare acrophases with an ordinary t-test: 23:00 and 01:00 are two hours apart on the clock but 22 hours apart to a linear test. Use Watson-Williams (the circular analogue)."
    session="sessions/demos/demo-workflow-phase-groups.json"
    sessionLabel="Open the group phase-comparison example"
  />

  <Recipe
    title="Is a rhythm parameter different between two groups?"
    chapters='Chapters <a href="#ch11">11</a> and <a href="#ch13">13</a>'
    when="You have extracted a scalar per subject (amplitude, MESOR, IS, M10&hellip;) and want to know whether two groups differ on it, with the correct test chosen for you."
    data="One value per subject in each of two groups (e.g. an amplitude column per group from a Cosinor fit)."
    steps={[
      "Produce the per-subject scalar (e.g. <strong>Cosinor</strong> amplitude, or a <strong>Nonparametric RA</strong> metric) for each group.",
      "<strong>Compare groups</strong> (Analysis) on <strong>auto</strong>: it checks each group for normality and equal variance and picks a Welch t-test or a Mann-Whitney U test, surfacing the choice and any warnings.",
      "Add a <strong>Boxplot</strong> (Plots) to show medians, spread and outliers alongside the test.",
    ]}
    readoff="Which test fired and why, the p-value against your α, and &mdash; from the boxplot &mdash; the direction and size of the difference. A significant p says the groups differ; the boxplot says by how much."
    pitfall="A p-value alone is not enough. Always pair it with the effect size (the actual difference and its spread) so readers can judge biological, not just statistical, significance."
    session="sessions/demos/demo-workflow-stats-two-group.json"
    sessionLabel="Open the compare-two-groups example"
  />

  <Recipe
    title="Characterise a fragmented rest-activity rhythm"
    chapters='Chapter <a href="#ch9">9</a>'
    when="Clinical or ageing actigraphy where the rhythm is not a clean sine &mdash; you want robust, shape-free descriptors and a group contrast."
    data="A time column and an activity column per subject, binned to the analysis epoch (e.g. 1 h)."
    steps={[
      "One <strong>Nonparametric RA</strong> node (Analysis) per group &mdash; each metric port (IS, IV, RA, M10, L5) emits that group's distribution.",
      "A <strong>Cosinor</strong> node on the same subjects for the model-based view (amplitude, acrophase) &mdash; combining non-parametric and model-based is the recommended pairing.",
      "<strong>Compare groups</strong> (Analysis) on the metric of interest, and an <strong>actogram</strong> of one representative subject per group.",
    ]}
    readoff="IS (day-to-day stability, →1), IV (fragmentation, →0 consolidated), RA = (M10&minus;L5)/(M10+L5). The example's consolidated phenotype has IS ≈ 0.98, IV ≈ 0.4, RA ≈ 0.95; the fragmented one IS ≈ 0.45, IV ≈ 1.4, RA ≈ 0.6."
    pitfall="IS and IV are strongly <strong>epoch-dependent</strong> &mdash; values at 1-minute and 1-hour epochs are not comparable, so always report the epoch and match it across groups."
    session="sessions/demos/demo-workflow-rest-activity.json"
    sessionLabel="Open the rest-activity profile example"
  />

  <h3 class="section-head">Reading tricky records</h3>

  <Recipe
    title="Detect a free-running (non-24) rhythm in a person"
    chapters='Chapters <a href="#ch5">5</a> and <a href="#ch6">6</a>'
    when="Sleep-wake data that drift later (or earlier) every day &mdash; the human counterpart of the free-running mouse, and a recognised clinical presentation in blind individuals."
    data="A long sleep-wake or activity record (weeks), so the drift can accumulate visibly."
    steps={[
      "<strong>actogram</strong> (Plots), double-plotted &mdash; a 24 h rhythm sits vertical; this one leans as the sleep window walks around the clock.",
      "<strong>periodogram</strong> (Plots, Lomb-Scargle) to recover τ numerically.",
    ]}
    readoff="The example runs at τ ≈ 24.5 h, drifting about half an hour later each day and circling the clock over roughly seven weeks; the periodogram peak sits just above 24 h."
    pitfall="A rhythm that merely looks irregular in clock time may be a perfectly regular non-24 rhythm &mdash; the double-plotted actogram is what makes the steady drift obvious."
    session="sessions/demos/demo-workflow-non24-blind.json"
    sessionLabel="Open the non-24 sleep-wake example"
  />

  <Recipe
    title="Tell masking apart from true entrainment"
    chapters='Chapter <a href="#ch5">5</a>'
    when="A schedule shift where the activity appears to follow the new light cycle &mdash; but you need to know whether the clock actually moved."
    data="An activity record spanning the shift and the release into constant conditions."
    steps={[
      "<strong>actogram</strong> (Plots) of both records &mdash; while the light cycle runs, a truly entrained animal and a merely masked one look identical.",
      "Compare their behaviour <strong>after release into constant darkness</strong>: the entrained clock keeps the new phase; the masked one snaps back to its original phase.",
    ]}
    readoff="Persistence of the new phase in constant conditions is the signature of real entrainment; an immediate snap-back reveals masking (light was suppressing behaviour, not resetting the clock)."
    pitfall="A phase shift observed <em>under</em> a light cycle is not evidence of entrainment. The release into constant conditions is the actual test."
    session="sessions/demos/demo-workflow-masking.json"
    sessionLabel="Open the masking-vs-entrainment example"
  />

  <Recipe
    title="Avoid the multiple-comparison trap"
    chapters='Chapters <a href="#ch6">6</a> and <a href="#ch13">13</a>'
    when="Any time you scan many periods, run many records, or try several preprocessing choices and then report the best-looking result."
    data="This example is twelve records of pure noise, analysed identically."
    steps={[
      "Run the same <strong>periodogram</strong> on all twelve noise records.",
      "Look at where the twelve peak periods land: scattered arbitrarily across the search window &mdash; the signature of a null result in aggregate.",
    ]}
    readoff="Every record reports a peak period, because a periodogram always returns its largest value. Picking the most impressive single spectrum out of many is how noise becomes a &lsquo;finding&rsquo;."
    pitfall="Decide what you are testing <strong>before</strong> you test it. Correct for the number of trial periods (Bonferroni, or a permutation threshold), and read this next to the arrhythmic negative control above."
    session="sessions/demos/demo-workflow-noise-peak.json"
    sessionLabel="Open the multiple-comparison-trap example"
  />
</ChapterSection>
