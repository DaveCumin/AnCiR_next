<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import Formula from '$lib/components/Formula.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  const _tex1 = String.raw`\bar{C} = \tfrac{1}{n}\sum_i \cos\theta_i,\quad \bar{S} = \tfrac{1}{n}\sum_i \sin\theta_i,\quad \bar{\theta} = \operatorname{arctan2}(\bar{S},\bar{C}),\quad R = \sqrt{\bar{C}^2+\bar{S}^2}`;
</script>

<ChapterSection id="ch12" num="Chapter 12" title="Circular Statistics">
  <HistoricalContext
    entries={[
      {
        year: '1953',
        text: 'R.A. Fisher publishes foundational work on the statistics of directional data ("Dispersion on a sphere").<sup class="cite"><a href="#ref-30">[30]</a></sup>'
      },
      {
        year: '1993–2000',
        text: 'The modern reference texts appear: N.I. Fisher\'s <em>Statistical Analysis of Circular Data</em> (1993)<sup class="cite"><a href="#ref-13">[13]</a></sup> and Mardia &amp; Jupp\'s <em>Directional Statistics</em> (2000)<sup class="cite"><a href="#ref-12">[12]</a></sup>, both still standard.'
      },
      {
        year: '1990s–present',
        text: 'Circular statistics are increasingly applied in chronobiology for acrophase distributions, activity onset times, and sleep timing data. R packages <em>circular</em> and <em>CircStats</em> implement these methods.'
      }
    ]}
  />

  <p class="chapter-intro">
    Phase angles — <a class="gloss" href="#gloss-acrophase">acrophases</a>, activity onset times, peak cortisol times — are <strong>circular variables</strong> that wrap around at 360° or 24 hours. Standard linear statistics (mean, SD, <a class="gloss" href="#gloss-t-test">t-test</a>) are inappropriate and give misleading results for circular data. <a class="gloss" href="#gloss-circular-statistics">Circular statistics</a> provide the correct framework.
  </p>

  <h3 class="section-head">Descriptive Circular Statistics</h3>
  <p>
    First convert each clock time t<sub>i</sub> (hours) to an angle: <strong>θ<sub>i</sub> = 2π t<sub>i</sub> / 24</strong> radians (or 360° t<sub>i</sub>/24), measuring from 00:00 as 0°. If the rhythm's period is not 24 h, divide by τ instead. The trick is then to treat each phase as an arrow of length 1 pointing in its direction on the clock face, and average the arrows rather than the numbers. In the formula below, C̄ and S̄ are the average of the cosines and of the sines of all the phase angles &mdash; together they are the x and y coordinates of the average arrow. Its direction, recovered with <code>arctan2</code> (the two-argument arctangent, which keeps track of the correct quadrant), is the <strong>mean phase</strong> θ̄; its length R is the <strong>mean resultant length</strong>.
  </p>
  <Formula tex={_tex1} />
  <p>
    R measures how tightly the phases cluster: R = 1 means every phase is identical (arrows all point the same way and reinforce), while R = 0 means they are spread evenly around the clock (arrows cancel out). <strong>Circular variance</strong> = 1 − R is the mirror image: 0 for perfectly clustered, 1 for perfectly scattered.
  </p>
  <p>
    <strong>Worked example.</strong> Five subjects have peak (acrophase) times of 23:30, 00:15, 23:45, 00:30 and 00:00. A naïve arithmetic mean of the clock numbers (23.5, 0.25, 23.75, 0.5, 0) gives ≈ 9.6 h &mdash; the middle of the afternoon, badly wrong, because it does not know 23:59 is next to 00:00. Averaging them as arrows instead gives a circular mean of about 00:00 with a large R (≈ 0.99), correctly capturing that all five peak around midnight.
  </p>

  <h3 class="section-head">Tests for Circular Data</h3>
  <p>Which test you need depends on the question you are asking:</p>
  <ul>
    <li><a class="gloss" href="#gloss-rayleigh"><strong>Rayleigh test</strong></a> &mdash; <em>Is there a preferred phase at all?</em> The null hypothesis is that the phases are spread uniformly around the clock; a significant result (large R for the sample size n) means the group clusters at some time. Use it for a single group, e.g. "do these animals reliably peak at a particular time?"</li>
    <li><a class="gloss" href="#gloss-watson-williams"><strong>Watson-Williams test</strong></a> &mdash; <em>Do two groups peak at different times?</em> The circular analogue of the two-sample <a class="gloss" href="#gloss-t-test">t-test</a>; its null hypothesis is that both groups share the same mean phase. Use it to compare, say, treatment vs. control acrophases. It assumes both samples are von Mises distributed with a <strong>common concentration κ</strong> (the circular analogue of equal variances) and are reasonably clustered — <strong>R̄ ≳ 0.7 in each group</strong>. Unequal concentration is the commonest violation, since treated groups are often more dispersed than controls; check R̄ in both groups first, and fall back to Watson's U² if they differ.</li>
    <li><strong>Watson U² test</strong> &mdash; <em>Do two groups differ in any way</em> (mean phase or spread)? A non-parametric test of whether two samples come from the same circular distribution. Prefer it to Watson-Williams when the data are scattered or clearly non-symmetric, where the Watson-Williams assumptions fail.</li>
  </ul>

  <AnCiRBox title="Circular Statistics in AnCiR" tip="Never use a standard unpaired t-test to compare acrophase times between groups — use the Watson-Williams test (the circular analogue of the t-test). A 23:00 acrophase and a 01:00 acrophase are only 2 hours apart circularly, but would appear 22 hours apart to a linear test.">
    <p>AnCiR has a dedicated circular-statistics stack. Add these nodes from the <strong>node palette</strong> (the <strong>+</strong> button, top-right):</p>
    <ol>
      <li>Fit a <strong>Cosinor</strong> node (Fitting family) per group to obtain each subject's <strong>acrophase</strong>; the acrophase output port carries one value per subject.</li>
      <li>Wire those acrophase columns into the <strong>Rayleigh test</strong> node (Analysis family). Set <strong>unit</strong> to hours and the <strong>period</strong> to 24 h. It reports the mean resultant length <strong>R</strong>, <strong>z</strong>, and the Rayleigh <strong>p-value</strong> per column (is there a preferred phase at all?), and — with <strong>Watson-Williams</strong> enabled — an <strong>F</strong> and p-value for whether the groups share the same mean phase.</li>
      <li>For a visual summary, wire the same acrophase columns into the <strong>Circular phase plot</strong> (Plots family): each group appears as a coloured cluster on a 24-hour clock with its mean-resultant vector, with optional rose wedges and the Watson-Williams test overlaid.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-workflow-phase-groups.json" label="Open the phase-groups example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch12" />
</ChapterSection>
