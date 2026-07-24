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
