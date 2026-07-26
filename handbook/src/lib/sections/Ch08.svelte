<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from "$lib/components/ChapterSection.svelte";
  import HistoricalContext from "$lib/components/HistoricalContext.svelte";
  import Formula from "$lib/components/Formula.svelte";
  import WarnBox from "$lib/components/WarnBox.svelte";
  import NoteBox from "$lib/components/NoteBox.svelte";
  import AnCiRBox from "$lib/components/AnCiRBox.svelte";
  import DemoLink from "$lib/components/DemoLink.svelte";
  import FftAnim from "$lib/animations/FftAnim.svelte";
  import WaveletAnim from "$lib/animations/WaveletAnim.svelte";

  const historyEntries = [
    {
      year: "1822",
      text: "Jean-Baptiste Joseph Fourier shows that essentially any well-behaved periodic function can be expressed as a sum of sinusoids — the theoretical foundation of all spectral analysis.<sup class=\"cite\"><a href=\"#ref-28\">[28]</a></sup>",
    },
    {
      year: "1965",
      text: 'James Cooley and John Tukey publish the Fast Fourier Transform (FFT) algorithm<sup class="cite"><a href="#ref-9">[9]</a></sup>, reducing computational cost from O(N²) to O(N log N) (from slow to fast for large datasets) and enabling practical spectral analysis of long time series.',
    },
    {
      year: "1970s",
      text: "Fourier-based power spectrum analysis is adopted in chronobiology alongside the χ² periodogram.",
    },
  ];
  const _tex1 = String.raw`F_j = \sum_{k=0}^{N-1} x_k \cdot e^{-2\pi\,\mathrm{i}\,jk/N}`;
</script>

<ChapterSection id="ch8" num="Chapter 8" title="Fourier Analysis">
  <HistoricalContext entries={historyEntries} />

  <h3 class="section-head">Core Concept</h3>
  <p>
    The <a class="gloss" href="#gloss-dft">Discrete Fourier Transform (DFT)</a> decomposes a time series into
    constituent frequency components. For N discretely sampled points with
    sampling interval Δt:
  </p>

  <Formula tex={_tex1} />

  <p>
    Each component sits at frequency fⱼ = j/(NΔt). The <a class="gloss" href="#gloss-power-spectrum">power spectrum</a> |Fⱼ|²
    (or, as AnCiR plots it, the magnitude √|Fⱼ|²) against period 1/fⱼ reveals
    dominant rhythmic components. AnCiR uses the Cooley-Tukey <a class="gloss" href="#gloss-fft">FFT</a> algorithm and
    <a class="gloss" href="#gloss-zero-padding">zero-pads</a> the series to the next power of 2, and removes the mean and
    trend before transforming.
  </p>
  <WarnBox title="Zero-padding is interpolation, not resolution">
    <p>
      Zero-padding makes the transform efficient and produces a smoother, more
      finely sampled spectrum, but it is <strong>interpolation, not added
      resolution</strong> — the true resolution is still set by the record length
      (see below), and no amount of padding separates two periods the record cannot
      resolve. Always remove the mean and any trend before padding: appending zeros
      to a series with a non-zero mean creates a large artificial step and severe
      <a class="gloss" href="#gloss-spectral-leakage">spectral leakage</a>.
    </p>
  </WarnBox>

  <h3 class="section-head">Windowing</h3>
  <p>
    When the true rhythm period is not a precise multiple of the record length,
    spectral power "leaks" to adjacent frequencies. <a class="gloss" href="#gloss-window-function">Windowing functions</a> (Hann,
    Hamming, Blackman) reduce <a class="gloss" href="#gloss-spectral-leakage">spectral leakage</a> (where power from one frequency
    'bleeds' into neighbouring frequencies) at the cost of some frequency
    resolution. AnCiR's FFT does not currently expose a choice of window; removing
    the mean and trend first (which it does automatically) is the most important
    step for limiting leakage in practice.
  </p>

  <h3 class="section-head">Important Limitation</h3>
  <WarnBox title="Requires Uniform Sampling">
    FFT assumes <strong>uniformly sampled data</strong>. For irregularly sampled
    data or recordings with gaps, use the
    <strong
      >Lomb <sup class="cite"><a href="#ref-3">[3]</a></sup>-Scargle
      <sup class="cite"><a href="#ref-4">[4]</a></sup> periodogram</strong
    > (Chapter 6) instead.
  </WarnBox>

  <h3 class="section-head">Frequency Resolution — a Major Practical Limit</h3>
  <p>
    Fourier frequency resolution is Δf = 1/T, where T is the total record length.
    Converted to <em>period</em> — which is how chronobiological spectra are read —
    the resolution near a period τ is <strong>Δτ ≈ τ²/T</strong>, and this is far
    coarser than most users expect. For a <strong>10-day record (T = 240 h),
    Δτ ≈ 24²/240 = 2.4 h at the circadian peak</strong>: the neighbouring FFT bins
    fall near 21.8 h and 26.7 h, so a raw FFT of 10 days <strong>cannot separate a
    23.5 h rhythm from a 24.5 h one</strong>. Resolving τ to ±0.5 h at 24 h needs
    T ≈ 24²/0.5 ≈ 1150 h, about 48 days. This is why the FFT is a good
    <em>screening</em> tool but a poor <em>period estimator</em> for circadian work;
    use the chi-squared periodogram, free-period cosinor, or onset regression when
    the value of τ matters.
  </p>

  <FftAnim />

  <NoteBox title="FFT vs. periodogram">
    <p>
      The FFT spectrum looks a lot like a periodogram: both show how much rhythmic
      structure is present at each possible period. However, FFT is strictly for
      evenly spaced data and decomposes the signal into a sum of sinusoids, while
      periodograms (like Lomb-Scargle) can handle uneven sampling and use different
      statistical approaches to assess rhythmicity.
    </p>
  </NoteBox>

  <AnCiRBox title="Fourier Analysis in AnCiR" tip="">
    <ol>
      <li>
        Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right)
        and, under <strong>Plots</strong>, choose <strong>fft</strong>.
      </li>
      <li>
        Wire your <strong>time column</strong> into the <strong>x</strong> input and your
        <strong>data column</strong> into the <strong>y</strong> input. Ensure the data are
        uniformly sampled (use <strong>Bin Data</strong> first if needed).
      </li>
      <li>
        The magnitude spectrum (√power) is plotted against period in hours.
        Peaks correspond to dominant oscillatory components.
      </li>
      <li>
        Hover over a peak to read off its period. The primary peak is
        highlighted automatically.
      </li>
      <li>
        Note: for irregularly sampled or gappy data, use the <strong
          >Lomb <sup class="cite"><a href="#ref-3">[3]</a></sup>-Scargle
          <sup class="cite"><a href="#ref-4">[4]</a></sup> Periodogram</strong
        > instead.
      </li>
    </ol>
    <DemoLink session="sessions/demos/demo-fft-rhythm.json" label="Open the FFT example in AnCiR" />
  </AnCiRBox>

  <NoteBox title="The one constraint that makes this a DFT">
    <p>
      Look at what the animation is doing: at each frequency it multiplies the data by a test wave and adds up the result, then reports how big the answer is. That is a <strong>correlation</strong> — and it is also, exactly, a least-squares fit of that sinusoid to the data. On an evenly spaced grid the two are the same operation, because the sines and cosines are already mathematically independent of one another.
    </p>
    <p>
      So what makes this the <em>discrete Fourier transform</em> rather than something more general? Just one thing: <strong>k is a whole number</strong>. The test frequencies are locked to a fixed grid of one, two, three… complete cycles across the record. You can ask about 24 h and 12 h because they land on that grid. You cannot ask about 23.7 h at all.
    </p>
    <p>
      Relax that single constraint — allow any frequency you like, and do the extra work needed to keep the sine and cosine independent when the samples are unevenly spaced — and you have the <a href="#ch6">Lomb-Scargle periodogram</a> of Chapter 6. Seen this way, the DFT is the special case where your sampling is regular enough that you get that independence for free.
    </p>
  </NoteBox>

  <h3 class="section-head">Beyond Fourier: Wavelets and Time-Frequency Analysis</h3>
  <p>
    Everything above assumes the rhythm is <strong>the same throughout the record</strong>. The Fourier transform correlates your data with sines and cosines that run the entire length of the recording, so it answers one question: <em>how much energy is there at each period, overall?</em> If the period changed half-way through, the FFT does not tell you so. It reports a single blurred or doubled peak, averaging two states that were never true at the same time.
  </p>
  <p>
    A <strong>wavelet transform</strong> fixes this by using a wave packet that is <em>localised in time</em> instead of infinite. The packet — a <strong>wavelet</strong> — is stretched or squeezed to probe different periods, and slid along the record to probe different times. The result is a two-dimensional picture called a <strong>scalogram</strong>: power as a function of both period <em>and</em> time.
  </p>

  <p>
    In the animation the signal has a period of <strong>24 h for the first five days and 21 h for the last five</strong>. Watch the gold wavelet stretch as it probes longer periods, and sweep across the record at each one. The scalogram builds up underneath: a bright ridge at 24 h in the first half that steps down to 21 h in the second. An FFT of this record would report one smeared peak somewhere in between.
  </p>
  <WaveletAnim height="560px" />

  <NoteBox title="Why the wavelet changes width — and why that is the whole idea">
    <p>
      Watch the gold packet as the animation moves to longer periods: it <strong>stretches</strong>. At 33 h it is more than twice as wide as at 15 h. That scaling is the entire difference between a wavelet transform and the more familiar <strong>spectrogram</strong>.
    </p>
    <p>
      A spectrogram picks a window of <em>fixed</em> width, Fourier-transforms whatever is inside it, and slides it along — so it fills the picture in <strong>vertical</strong> strips, one time at a time, all frequencies at once. Because the window never changes size, it is necessarily a compromise: wide enough to resolve a 24 h rhythm means far too wide to localise anything fast.
    </p>
    <p>
      A wavelet transform instead fills the picture in <strong>horizontal</strong> strips, one period at a time, sweeping across all times — which is exactly what you are watching, and also how the standard algorithm computes it. Each strip uses a window matched to the period it is probing: long windows for long periods, short for short. You get good period resolution where you need it and good time resolution where you need that, instead of one compromise everywhere.
    </p>
  </NoteBox>

  <p>
    Three things are worth reading off the finished scalogram:
  </p>
  <ul>
    <li><strong>A horizontal ridge</strong> means a stable period.</li>
    <li><strong>A ridge that steps or slopes</strong> means the period is changing — the thing an FFT cannot show.</li>
    <li><strong>A ridge that fades</strong> means the amplitude is falling, as in a damping culture.</li>
  </ul>

  <WarnBox title="The cone of influence: do not interpret the shaded edges">
    <p>
      Near the start and end of the record the wavelet runs off the edge of the data, and software pads the gap. Values there are partly made of padding rather than signal. That region is the <strong>cone of influence</strong>, hatched in the animation.
    </p>
    <p>
      Notice how <em>wide</em> it is: because longer wavelets reach further, the cone at 32 h extends roughly 44 h — nearly two days — in from each end. This is a real trap in chronobiology, because the interesting event (a light pulse, a drug, a treatment) is so often near the start or end of the recording, which is exactly where the cone is widest. If a claim depends on structure inside the hatched region, the answer is to record for longer, not to reinterpret the plot.
    </p>
  </WarnBox>

  <NoteBox title="The trade-off you cannot escape">
    <p>
      A wavelet cannot be sharp in time <em>and</em> sharp in period at once. A long wavelet spans many cycles, so it pins the period down precisely — but it smears the moment of any change across its own length. A short wavelet localises the change sharply but cannot tell 23 h from 25 h.
    </p>
    <p>
      You can see this in the animation: the ridge does not step cleanly at day 5. It transitions over roughly a day either side, because the wavelet at those periods is about that wide. That blur is not a defect in the method — it is the honest width of what the data can resolve, and it is the same limit as the <strong>Δτ ≈ τ²/T</strong> resolution result above, viewed from a different direction.
    </p>
  </NoteBox>

  <AnCiRBox title="Wavelet analysis in AnCiR" tip="Put the scalogram directly above an actogram of the same record. A change in period is far easier to believe when you can see it in the summary and in the raw data at once.">
    <ol>
      <li>Add a <strong>Wavelet (CWT)</strong> node from <strong>Plots</strong> and wire your time and value columns into it.</li>
      <li>
        Choose the <strong>wavelet</strong>: <strong>Morlet</strong> (the default, and the right choice for period estimation), <strong>Paul</strong> (better time localisation, worse period resolution — useful for pinning down when a shift happened), or <strong>DOG / Mexican hat</strong> (good for detecting sharp features rather than oscillations).
      </li>
      <li>
        Set <strong>omega0</strong> for Morlet — this is the trade-off dial. Larger values sharpen period resolution and blur time; smaller does the reverse. The conventional 6 is a sensible default, and it makes period ≈ scale.
      </li>
      <li>
        Set <strong>periodMin</strong> and <strong>periodMax</strong>. The default 1–48 h spans ultradian through circadian, which is where a wavelet most earns its keep; narrow it to 20–28 h if you only care about the circadian band.
      </li>
      <li>Keep <strong>show COI</strong> on, and ignore everything inside the shaded wedges.</li>
    </ol>
    <p>
      For tracking a <em>single</em> parameter rather than reading a whole surface, the <strong>Moving Analysis</strong> node (Analysis family) is often easier to interpret: it slides a window along the record and emits period, amplitude, or phase as a new column you can plot like any other. The window length is the same trade-off as the wavelet's width.
    </p>
    <p>
      One caution for both: overlapping windows share data, so the resulting curve is much smoother than the evidence warrants. Use them to <em>see</em> when something changed, not to compute a p-value for the change.
    </p>
  </AnCiRBox>
  <ChapterExamples chapter="ch8" />
</ChapterSection>

<style>
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
