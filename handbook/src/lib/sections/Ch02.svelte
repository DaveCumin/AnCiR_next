<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import HistoricalContext from "$lib/components/HistoricalContext.svelte";
  import WarnBox from "$lib/components/WarnBox.svelte";
  import AnCiRBox from "$lib/components/AnCiRBox.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import NyquistAnim from "../animations/NyquistAnim.svelte";
</script>

<ChapterSection id="ch2" num="Chapter 2" title="Data Collection">
  <HistoricalContext
    entries={[
      {
        year: 1926,
        text: 'Maynard Johnson pioneers quantitative locomotor activity recording in rodents, publishing one of the first recognisably modern actograms of wild mice.<sup class="cite"><a href="#ref-24">[24]</a></sup>',
      },
      {
        year: "1930s–60s",
        text: "The Esterline-Angus event recorder enables continuous paper-tape recordings of animal activity.",
      },
      {
        year: "1980s–90s",
        text: "Wrist actigraphy devices emerge for human circadian research.",
      },
      {
        year: "2000s–present",
        text: "Miniaturised wearables and smartphone-based sensing dramatically expand scale and ecological validity.",
      },
    ]}
  />

  <h3 class="section-head">Types of Chronobiological Data</h3>
  <ul>
    <li>
      <strong>Locomotor activity</strong> — running wheel counts, accelerometry,
      infrared beam breaks.
    </li>
    <li>
      <strong>Sleep-wake state</strong> — polysomnography (PSG), actigraphy, video
      scoring.
    </li>
    <li>
      <strong>Physiological signals</strong> — core body temperature (CBT), heart
      rate, blood pressure.
    </li>
    <li>
      <strong>Hormonal markers</strong> — cortisol, melatonin, insulin, growth hormone
      at multiple time points.
    </li>
    <li>
      <strong>Gene/protein expression</strong> — qPCR, RNA-seq, proteomics time-courses.
    </li>
  </ul>

  <h3 class="section-head">Sampling Considerations</h3>
  <p>
    The <a class="gloss" href="#gloss-nyquist"><strong>Nyquist-Shannon sampling theorem</strong></a><sup class="cite"
      ><a href="#ref-15">[15]</a>,<a href="#ref-16">[16]</a></sup
    >
    (the rule that to detect a rhythm, you need to sample more than twice as often
    as it repeats) states that to represent a rhythm of period τ, the sampling
    interval must be <strong>strictly less than τ/2</strong>. Sampling at exactly
    τ/2 is the failure case: depending on phase, a sinusoid sampled twice per cycle
    can appear to have zero amplitude. Nyquist is a noiseless, infinite-record limit
    and is a <strong>floor, not a target</strong>: to estimate amplitude and phase
    reliably from a real, noisy, finite record, aim for at least 8–12 samples per
    cycle. Equally important, components <em>faster</em> than half the sampling rate
    do not vanish — they <strong>alias</strong> into lower frequencies and can
    masquerade as circadian signal, so sample fast enough to cover the ultradian
    components too, or filter before down-sampling. For circadian rhythms, 1–4
    hourly sampling is standard for hormone assays; wearables typically sample at
    30-second to 1-minute resolution.
  </p>

  <NyquistAnim height="600px" />

  <WarnBox title="Sparse Sampling">
    <p>
      With fewer than ~6 samples per 24-hour cycle, or clearly irregular
      timestamps, the <a class="gloss" href="#gloss-chi-squared-periodogram">χ² periodogram</a> and <a class="gloss" href="#gloss-fft">FFT</a> become unusable. The
      <a class="gloss" href="#gloss-lomb-scargle">Lomb-Scargle periodogram</a> and <a class="gloss" href="#gloss-cosinor">cosinor</a> regression tolerate irregular and
      incomplete sampling, but neither <em>rescues genuinely sparse data</em> — no
      method recovers information that was never sampled. With sparse data,
      fixed-period cosinor (assuming τ = 24 h) can still estimate amplitude and
      acrophase, but period estimation should not be attempted. For reliable period
      estimation, aim for at least <strong>7 complete cycles, preferably 10–14</strong>;
      six-day records can give χ² periodogram errors up to 0.5 h.
    </p>
  </WarnBox>

  <h3 class="section-head">File Formats</h3>
  <p>
    AnCiR accepts <strong>CSV</strong>, <strong>Excel (.xlsx)</strong> and
    <strong>AWD</strong> actigraphy files.
    The minimum requirement is a timestamp column and one or more data columns. Timestamps
    can be provided as absolute datetime, elapsed time in hours/minutes, or Zeitgeber
    Time (ZT) / Circadian Time (CT).
  </p>

  <AnCiRBox title="Importing Data into AnCiR">
    <ol>
      <li>
        Go to <strong>ancir.pages.dev</strong> — no installation needed. AnCiR
        opens on the <strong>workflow canvas</strong>, where every step of an
        analysis is a node you wire together.
      </li>
      <li>
        Open the <strong>node palette</strong>: click the blue <strong>+ (Add
        node)</strong> button at the top-right of the canvas, or
        <strong>Click here to add data</strong> in the middle of an empty canvas.
      </li>
      <li>
        Under <strong>Sources</strong>, choose <strong>Import file</strong> (you
        can also drag-and-drop a <strong>CSV</strong>, <strong>Excel (.xlsx)</strong>
        or <strong>AWD</strong> file straight onto the canvas).
      </li>
      <li>
        In the import dialog, confirm <strong>Has Header</strong>, optionally
        pick a <strong>Sort by</strong> column, and tick the columns to bring in.
        For very large files you can switch on <strong>binning</strong> at import
        to down-sample as you load.
      </li>
      <li>
        Click <strong>Import</strong>. Your data appears as a <strong>data node</strong>
        on the canvas, with each column available as an output port to feed into
        plots and processes.
      </li>
      <li>
        Check that your <strong>time column</strong> was read correctly; times are
        handled in hours-since-start internally, so you don't need to convert them.
      </li>
      <li>
        To explore without your own data, use <strong>Load session</strong> (top-left
        of the canvas) → <strong>Examples</strong>, or open a ready-made example
        with the button below.
      </li>
    </ol>
    <DemoLink
      session="sessions/classroom/learn-hidden-rhythm.json"
      label="Open a ready-made example session in AnCiR"
    />
  </AnCiRBox>
  <ChapterExamples chapter="ch2" />
</ChapterSection>
