<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  import Formula from '$lib/components/Formula.svelte';

  const contextEntries = [
    {
      year: '1970s–80s',
      text: 'As the field developed increasingly complex analytical tools, simulated data became essential for validation and benchmarking.'
    },
    {
      year: '2007',
      text: 'Refinetti, Cornélissen &amp; Halberg provide the most comprehensive framework for simulating chronobiological data, including guidelines on period, amplitude, noise, and waveform shape.<sup class="cite"><a href="#ref-1">[1]</a></sup>'
    }
  ];
  const _tex1 = String.raw`y(t) = M + A \cdot \cos\!\left(\frac{2\pi t}{\tau} - \phi\right) + \varepsilon(t)`;
</script>

<ChapterSection id="ch3" num="Chapter 3" title="Simulating Chronobiological Data">
  <HistoricalContext entries={contextEntries} />

  <h3 class="section-head">Why Simulate Data?</h3>
  <p>Simulated data serve several purposes: testing whether an analysis method correctly recovers known parameters; teaching how analytical tools behave; benchmarking new software; and exploring how noise, sampling rate, or missing data affect results.</p>
  <p>The most useful of these is <strong>validation</strong>. Because you set the parameters yourself, you know the right answer in advance. If you generate a rhythm with a period of exactly 24.0 h and your <a class="gloss" href="#gloss-periodogram">periodogram</a> or <a class="gloss" href="#gloss-cosinor">cosinor</a> fit returns 24.0 h, the pipeline works; if it returns something else, the problem is in your analysis, not your biology. Simulating first is the surest way to trust a new workflow.</p>

  <h3 class="section-head">The Basic Sinusoidal Model</h3>
  <p>A simple rhythm is just a repeating wave (a cosine that rises and falls) plus some random noise. Four numbers describe it: the average level, the size of the swing, how fast it repeats, and when it peaks.</p>
  <Formula tex={_tex1} />
  <p>Here M is the <a class="gloss" href="#gloss-mesor">MESOR</a> (the mid-line the wave oscillates around), A is the <a class="gloss" href="#gloss-amplitude">amplitude</a> (half the peak-to-trough height), τ is the <a class="gloss" href="#gloss-period">period</a> (hours per cycle), φ is the <a class="gloss" href="#gloss-phase">phase</a> offset, and ε(t) ~ N(0, σ²) is random measurement noise. The handbook uses the <strong>cosine convention</strong> throughout (Chapters 1, 7 and 11), so that φ is the <a class="gloss" href="#gloss-acrophase">acrophase</a>: written this way the peak occurs at t = φ·τ/2π. This matches AnCiR's Simulate Data node, which builds a cosine plus noise; note the node takes the phase offset in <strong>hours</strong> (φ<sub>h</sub> = φ·τ/2π), not radians.</p>
  <p><strong>Worked example.</strong> With M = 100, A = 20, τ = 24 h and φ = 0, and no noise, the signal oscillates smoothly between 80 and 120, completing one full cycle every 24 hours with its peak at t = 0 (a cosine with zero phase starts at its peak). Doubling A to 40 would swing it between 60 and 140; halving τ to 12 h would make it repeat twice as often.</p>
  <p>Real biological rhythms are rarely perfectly sinusoidal. More realistic simulations may use <strong>truncated sinusoids</strong> (a sine wave with its troughs clipped flat, mimicking an animal that is simply inactive at rest), <strong>Poisson noise</strong> (the natural scatter of count data such as wheel revolutions, where variability grows with the count), or a gradual <strong>period drift</strong> (τ slowly changing, as in a free-running clock).<sup class="cite"><a href="#ref-1">[1]</a></sup></p>

  <AnCiRBox title="Generating Simulated Data in AnCiR" tip="Use Simulate Data to verify your analysis pipeline: if you generate data with a known period of exactly 24.0 h, the periodogram and cosinor should recover 24.0 h — if they don't, something is wrong with the pipeline.">
    <ol>
      <li>Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right) and, under <strong>Sources</strong>, choose <strong>Simulate Data</strong>. The node is placed on the canvas.</li>
      <li>Double-click the node to expand it, then set the <strong>Start Time</strong> and the <strong>Sampling period</strong> (e.g., 0.25 h for 15-minute resolution).</li>
      <li>Add one or more <strong>Sections</strong>: each section defines a phase of recording with its own <strong>Duration</strong>, <strong>Rhythm period</strong>, <strong>Rhythm phase shift</strong>, and <strong>Rhythm amplitude</strong>, plus an optional <strong>Noise</strong> term (mode and amplitude). Using multiple sections lets you simulate a free-running rhythm that shifts partway through.</li>
      <li>Noise is <em>on by default</em>. For a clean pipeline check (below), turn the section's <strong>Noise</strong> off — or set a fixed <strong>Noise seed</strong> at the node level for reproducible noise.</li>
      <li>The node produces a timestamp column and a values column on its output ports.</li>
      <li>Add a plot from the palette (e.g. <strong>Periodogram</strong> or <strong>Actogram</strong>) and wire these columns into it — drag from the Simulate Data output port to the plot's input port.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-tp-simulateddata.json" label="Open the Simulate Data example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch3" />
</ChapterSection>
