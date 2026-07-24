<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import NoteBox from '$lib/components/NoteBox.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
</script>

<ChapterSection id="ch10" num="Chapter 10" title="Phase Response Curves">
  <HistoricalContext
    entries={[
      {
        year: '1958–64',
        text: 'The first phase response curves (PRCs) are published: J. Woodland Hastings and Beatrice Sweeney report one in the dinoflagellate <em>Gonyaulax</em> (1958)<sup class="cite"><a href="#ref-25">[25]</a></sup>, and Patricia DeCoursey constructs the first PRC for a mammal (1960, the flying squirrel <em>Glaucomys volans</em>)<sup class="cite"><a href="#ref-26">[26]</a></sup>, showing the clock can be reset by light. Colin Pittendrigh develops systematic light PRCs in <em>Drosophila pseudoobscura</em> (1960–64)<sup class="cite"><a href="#ref-27">[27]</a></sup> — together establishing that a zeitgeber&rsquo;s effect depends critically on when in the cycle it is applied.'
      },
      {
        year: '1980s–90s',
        text: 'Human PRCs for light (Czeisler, Kronauer) and melatonin (Lewy) are constructed using carefully controlled laboratory studies, enabling clinical applications in jet lag, shift work, and delayed sleep-wake phase disorder.'
      },
      {
        year: 'Present',
        text: 'PRCs have been characterised for light, melatonin, exercise, temperature, and feeding across many organisms, with increasing clinical application in timed light therapy and chronobiotic treatments.'
      }
    ]}
  />

  <h3 class="section-head">Overview</h3>
  <p>
    A <a class="gloss" href="#gloss-prc"><strong>phase response curve (PRC)</strong></a> describes how the timing (phase) of a circadian rhythm shifts in response to a stimulus applied at different phases of the clock. PRCs are essential for predicting entrainment, understanding zeitgeber action, and designing clinical interventions such as timed light therapy or melatonin administration.
  </p>

  <h3 class="section-head">Types of PRCs</h3>
  <ul>
    <li><strong>Type 1 (weak) resetting</strong> — small, continuous advances and delays (conventionally &lt; ~6 h), with a smooth transition between the delay and advance regions. Plotted as a <strong>phase transition curve</strong> (new phase vs. old phase) it has an average slope of 1: the new phase still depends on the old one. Produced by most zeitgebers at moderate strength.</li>
    <li><strong>Type 0 (strong) resetting</strong> — very large shifts (up to ~12 h) with an abrupt jump between the delay and advance regions. The phase transition curve has an average slope of 0: after the stimulus the clock arrives at essentially the <strong>same phase whatever its phase beforehand</strong>. Produced by intense stimuli (bright light in humans; certain drugs). The Type 0/Type 1 distinction is properly made on the phase transition curve, not the PRC, and the transition between them passes through a <strong>phase singularity</strong> at which the stimulus drives rhythm amplitude to zero.</li>
  </ul>

  <h3 class="section-head">Constructing a PRC</h3>
  <p>
    Because there is no external light-dark cycle in constant conditions, time is measured in <strong>circadian time (CT)</strong>: the organism's own clock is divided into 24 equal hours, with CT0 defined as the start of subjective day. <strong>Subjective day</strong> is the part of the cycle the clock "thinks" is daytime (rest phase in a nocturnal animal); <strong>subjective night</strong> is the part it thinks is night (its active phase). These labels come from the animal's internal clock, not the room lights, which stay constant throughout.
  </p>
  <p>
    To build a PRC, many animals are each kept in constant conditions and given a brief <strong>stimulus</strong> (for example, a 15-minute light pulse, or a single melatonin dose) at a different CT. Circadian time is scaled to the animal's own free-running period, so one "circadian hour" is τ/24 real hours, and by convention <strong>CT12 is defined as activity onset in nocturnal species</strong> (CT0 as onset in diurnal species). The <a class="gloss" href="#gloss-phase-shift">phase shift (ΔΦ)</a> is then measured as the change in a clear time marker, usually <a class="gloss" href="#gloss-activity-onset">activity onset</a>, compared with where it would have fallen without the stimulus. By convention a phase advance (the rhythm shifts earlier) is positive and a delay (later) is negative. Plotting ΔΦ against the CT of stimulation, typically across 8–12 points spanning the cycle, traces out the PRC.
  </p>
  <p>
    One caution dominates real PRC work: the first few cycles after a stimulus show <strong>transients</strong> and are not yet at the new steady-state phase. ΔΦ must therefore be measured by fitting a regression line to the post-stimulus onsets <strong>from about cycle 4 onwards</strong> and back-extrapolating it to the day of the pulse, then comparing it with a line fitted to the pre-stimulus onsets. Reading off the very next onset (as the simplified worked example below does) will systematically misestimate the shift.
  </p>
  <p>
    For light PRCs the pattern is consistent: pulses in the <strong>early subjective night</strong> cause phase <strong>delays</strong>; pulses in the <strong>late subjective night</strong> and early morning cause phase <strong>advances</strong>; and during the <strong>subjective day</strong> the clock barely responds (the "dead zone"). Typical shifts are on the order of a few hours for bright light.
  </p>
  <p>
    <strong>Worked example.</strong> An animal in constant darkness normally begins running at CT12. A bright-light pulse given at CT16 (early subjective night) delays the next onset to CT13, i.e. one hour later, so ΔΦ = &minus;1 h. The same pulse given at CT22 (late subjective night) instead advances onset to CT11, so ΔΦ = +1 h. A pulse at CT6 (mid subjective day) leaves onset essentially unchanged, ΔΦ ≈ 0.
  </p>

  <NoteBox title="Human Clinical Relevance">
    Human light and melatonin PRCs have direct clinical relevance — they underpin timing protocols for jet lag recovery, shift-work adaptation, delayed sleep-wake phase disorder, and seasonal affective disorder treatment.
  </NoteBox>

  <AnCiRBox title="Phase Response Curves in AnCiR" tip="For formal PRC construction and Type 0/1 classification, dedicated tools such as BioDare2, or PRC-fitting routines in R, are recommended.">
    <p>PRC analysis is not yet implemented as a dedicated module in AnCiR. To construct a PRC manually:</p>
    <ol>
      <li>Import your data with columns: <strong>Stimulus CT</strong> (circadian time of stimulus, in hours) and <strong>Phase Shift</strong> (Δhours, positive = advance, negative = delay).</li>
      <li>From the <strong>node palette</strong> (the <strong>+</strong> button, top-right), under <strong>Plots</strong>, add a <strong>scatterplot</strong> and wire Stimulus CT into <strong>x</strong> and Phase Shift into <strong>y</strong>.</li>
      <li>Add a <strong>Smooth Data</strong> node (<strong>Smoothing</strong> family; <a class="gloss" href="#gloss-loess">LOESS</a> or <a class="gloss" href="#gloss-whittaker-eilers">Whittaker-Eilers</a>) and wire its output back into the scatterplot as a second series to draw a smooth PRC curve.</li>
      <li>To overlay multiple PRCs (e.g., different stimulus intensities), wire each as a separate data series into the same scatterplot.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-scatter-rhythm.json" label="Open a scatterplot example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch10" />
</ChapterSection>
