<script>
  import ChapterExamples from "$lib/components/ChapterExamples.svelte";
  import ChapterSection from '$lib/components/ChapterSection.svelte';
  import HistoricalContext from '$lib/components/HistoricalContext.svelte';
  import AnCiRBox from '$lib/components/AnCiRBox.svelte';
  import DemoLink from '$lib/components/DemoLink.svelte';
  import Formula from '$lib/components/Formula.svelte';
  import MethodTable from '$lib/components/MethodTable.svelte';
  import DetrendAnim from '$lib/animations/DetrendAnim.svelte';
  import InterpolationAnim from '$lib/animations/InterpolationAnim.svelte';

  const contextEntries = [
    {
      year: 'Pre-digital era',
      text: 'Preprocessing was performed manually: researchers visually inspected paper records, hand-marked artefacts, and calculated summary statistics by hand.'
    },
    {
      year: '1980s–90s',
      text: 'Digital data enabled automated preprocessing but also introduced new artefacts (recording dropouts, sensor drift) requiring new approaches.'
    }
  ];

  const methodRows = [
    {
      cells: ['<strong>Moving Average</strong>', 'Replaces each point with the mean of its neighbours in a sliding window. Simplest option; blurs sharp peaks. Weighted and exponential variants give recent points more weight', 'Window size; type (simple/weighted/exponential)']
    },
    {
      cells: ['<strong>Savitzky-Golay</strong>', 'Fits a low-degree polynomial to each window instead of a flat average, so peak height and shape are preserved much better', 'Window size; polynomial degree']
    },
    {
      cells: ['<strong>LOESS</strong>', 'Locally weighted regression — fits a little tilted line/curve through each local slice, weighting nearby points most. Very flexible and copes with irregular sampling', 'Bandwidth (fraction of data used per local fit)']
    },
    {
      cells: ['<strong>Whittaker-Eilers</strong>', 'Fits one smooth curve to the whole series by minimising a penalty that balances staying close to the data against staying smooth. Fast, handles gaps, and is a good default for uniformly sampled biological data', 'λ (smoothness penalty); order (default 2)']
    }
  ];

  const methodHeaders = ['Method', 'Description', 'Key parameter'];
  const _tex1 = String.raw`\text{Flag if } |y_i - \bar{y}| > k\,\text{SD}(y),\ k\approx 3; \qquad \text{robust: } |y_i - \text{median}(y)| > k\cdot 1.4826\cdot\text{MAD}(y)`;
  const _tex4 = String.raw`\hat{y}[i] = \frac{1}{2k+1}\sum_{j=-k}^{k} y[i+j] \qquad \text{(simple moving average, window } 2k{+}1)`;
  const _tex5 = String.raw`y(x) = y_0 + (y_1 - y_0)\,\frac{x - x_0}{x_1 - x_0}, \qquad x_0 \le x \le x_1 \;\;\text{(linear interpolation)}`;
  const _tex2 = String.raw`\bar{y}_{\text{bin}}[i] = \begin{cases} \text{mean}\bigl(y[iw : (i{+}1)w]\bigr) & \text{continuous data} \\ \text{sum}\bigl(y[iw : (i{+}1)w]\bigr) & \text{count data (e.g., wheel turns)}\end{cases}`;
  const _tex3 = String.raw`r(t) = y(t) - \hat{f}(t), \qquad \hat{f}(t) = a + b\,t \;\;\text{(linear trend)}`;
</script>

<ChapterSection id="ch4" num="Chapter 4" title="Preprocessing">
  <HistoricalContext entries={contextEntries} />

  <p class="chapter-intro">Preprocessing — the steps taken before formal analysis — can dramatically affect results. The goal is to improve signal quality without introducing bias. Document every preprocessing decision: choices made here can strongly influence downstream results.</p>

  <h3 class="section-head">Outlier Removal</h3>
  <p>Common approaches include threshold-based flagging (values more than k·SD from the mean, typically k = 3) or the more robust median absolute deviation (MAD) method.</p>
  <Formula tex={_tex1} />
  <p>The mean/SD rule is <strong>not robust</strong>: a few extreme points inflate both the mean and the SD and can hide themselves (masking), which is why the MAD version is preferred. Note also that on a strongly rhythmic series a 3·SD rule flags almost nothing (a pure sinusoid peaks at only 1.41 SD above its mean), while on a smoothed series it can clip real daily peaks. <strong>Apply outlier rules to the residuals after removing the rhythm and trend</strong>, not to the raw trace. Missing data created by outlier removal can propagate through analyses. For spectral methods, methods designed to work with missing data points (e.g., <a class="gloss" href="#gloss-lomb-scargle">Lomb-Scargle</a>) are preferable to simple deletion or interpolation.</p>

  <AnCiRBox title="Removing Outliers in AnCiR">
    <ol>
      <li>Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right) and, under <strong>Filtering</strong>, choose <strong>Remove Outliers</strong>.</li>
      <li>Wire the column you want to clean into the node's input port (drag from the data node's output port to the Remove Outliers input).</li>
      <li>Double-click to expand the node and choose the <strong>Method</strong>: <strong>IQR</strong> (set the <strong>IQR Multiplier</strong>, default 1.5) or <strong>Z-Score</strong> (set the <strong>Z-Score Threshold</strong>, default 3).</li>
      <li>Detected outliers are removed and listed in the node. The cleaned column is available on the node's output port to feed downstream steps.</li>
      <li>The original data is untouched — delete the node to restore it.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-process-outlierremoval.json" label="Open the Remove Outliers example in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Missing Data and Interpolation</h3>
  <p>Real recordings are rarely complete. Sensors drop out, subjects remove wearables, samples are lost, and removing outliers (above) deliberately leaves holes. These <a class="gloss" href="#gloss-missing-data">gaps</a> matter because many analyses assume an unbroken, regularly spaced series. The <a class="gloss" href="#gloss-fft">FFT</a> and the <a class="gloss" href="#gloss-chi-squared-periodogram">χ² periodogram</a> break down when samples are missing; a moving average over a gap silently averages the wrong span; and even methods that tolerate gaps lose statistical power as more data go missing.</p>

  <p>There are two broad responses. The first is to <strong>use methods that tolerate gaps</strong> rather than fill them: the <a class="gloss" href="#gloss-lomb-scargle">Lomb-Scargle</a> periodogram<sup class="cite"><a href="#ref-3">[3]</a></sup> and <a class="gloss" href="#gloss-cosinor">cosinor</a> regression both work directly on irregular or incomplete data, without inventing values. This is usually the safest choice.</p>

  <p>The second is <strong><a class="gloss" href="#gloss-interpolation">interpolation</a></strong>: estimating the missing values from the points around them so downstream tools receive a complete, evenly spaced series. The simplest scheme, <strong>linear</strong> interpolation, just draws a straight line between the two known points that bracket the gap:</p>
  <Formula tex={_tex5} />
  <p><strong>Nearest-neighbour</strong> interpolation copies the closest known value (useful for categorical or state data), while a <strong>cubic <a class="gloss" href="#gloss-spline">spline</a></strong><sup class="cite"><a href="#ref-22">[22]</a></sup> threads a smooth curve through the points, giving a more natural shape across short gaps.</p>

  <p>The animation below widens the gap from a few hours to more than a day. For a short gap the straight-line estimate hugs the true rhythm and the error stays tiny; as the gap grows past the rhythm's own period the chord cuts straight across real peaks and troughs, and the largest error (marked in red) balloons. This is why interpolation is safe across small gaps but not large ones.</p>

  <InterpolationAnim />

  <p><strong>Caution:</strong> interpolation invents data. Across a gap much shorter than the rhythm it is harmless, but filling a gap comparable to or longer than the period fabricates a rhythm that was never observed and biases spectra and amplitude estimates. As a rule, only interpolate across gaps that are short relative to the period of interest<sup class="cite"><a href="#ref-1">[1]</a></sup>; for longer gaps, prefer a gap-tolerant method and report the missing fraction.</p>

  <AnCiRBox title="Interpolating Missing Data in AnCiR" tip="Prefer gap-tolerant analyses (Lomb-Scargle periodogram, cosinor) for data with large gaps; use interpolation mainly to satisfy tools that need an evenly spaced series, such as the FFT.">
    <ol>
      <li>From the <strong>node palette</strong> (the <strong>+</strong> button, top-right), under <strong>Binning</strong>, choose <strong>Interpolate</strong>, and wire your <strong>time</strong> column into <strong>x</strong> and the column with gaps into <strong>y</strong>.</li>
      <li>Choose the <strong>Method</strong>: <strong>Linear</strong> (the safe default), <strong>Nearest</strong> (for state/categorical data), or <strong>Cubic spline</strong> (smoothest across short gaps).</li>
      <li>Set the <strong>Mode</strong>. The default <strong>Fill gaps (keep times)</strong> fills holes but keeps the original irregular timestamps. To get an <em>evenly spaced</em> series ready for an FFT or actogram, choose <strong>Resample (new grid)</strong> and set the <strong>Step</strong>.</li>
      <li>Compare the filled series against the raw data before relying on it, and note how much was interpolated.</li>
    </ol>
  </AnCiRBox>

  <h3 class="section-head">Binning</h3>
  <p>High-resolution data are aggregated into coarser intervals. A bin width of τ/48 to τ/96 (15–30 min for a 24-hour rhythm) is generally appropriate.</p>
  <Formula tex={_tex2} />
  <p>Bin width is not only a noise/resolution trade-off. It sets the number of bins per cycle, k = τ/w, which in turn sets the <strong>degrees of freedom (k−1) of the <a class="gloss" href="#gloss-chi-squared-periodogram">χ² periodogram</a></strong> and the height of its significance line (Chapter 6) — the same recording binned at 1 h and at 15 min yields different Q_P values and different thresholds. Coarser bins also reduce serial correlation, bringing the data closer to the independence the χ² test assumes. Always report the bin width alongside any periodogram result.</p>

  <AnCiRBox title="Binning Data in AnCiR">
    <ol>
      <li>From the <strong>node palette</strong>, under <strong>Binning</strong>, choose <strong>Bin Data</strong>.</li>
      <li>Expand the node and pick your <strong>X column</strong> (time) and one or more <strong>Y column(s)</strong>. Multiple Y columns can be binned in one step.</li>
      <li>Set the <strong>Bin Size</strong> (e.g., 1 h) and <strong>Bin Start</strong> offset.</li>
      <li>Choose the <strong>Aggregation Function</strong>: <strong>mean</strong> (continuous measurements), <strong>count</strong> (count data such as wheel revolutions), <strong>median</strong>, <strong>min</strong>, <strong>max</strong>, or <strong>stddev</strong>.</li>
      <li>Tick <strong>Different step size</strong> and set a smaller <strong>Step Size</strong> for a sliding-window (overlapping) average.</li>
      <li>The node outputs new binned X and Y columns to wire into plots or further processes.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-tp-binneddata.json" label="Open the Bin Data example in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Smoothing</h3>
  <p>Measurements always carry <strong>noise</strong>: fast, point-to-point jitter from the sensor and the environment that has nothing to do with the underlying biology. <a class="gloss" href="#gloss-smoothing">Smoothing</a> averages each point together with its neighbours so this jitter cancels out and the slower rhythm underneath becomes visible. It is the opposite end of the scale from <a href="#gloss-detrending" class="gloss">detrending</a>: detrending strips away a very slow drift, smoothing strips away very fast noise, and the rhythm you care about sits in between.</p>

  <p>The simplest smoother, the <strong>moving average</strong>, just replaces each point with the mean of a window of neighbouring points:</p>
  <Formula tex={_tex4} />
  <p>For example, smoothing <code>[50, 70, 60, 80, 55]</code> with a width-3 window gives the interior values <code>[(50+70+60)/3, (70+60+80)/3, (60+80+55)/3] = [60, 70, 65]</code> &mdash; the spikes are pulled towards their neighbours. A wider window removes more noise but also flattens real peaks, so there is always a trade-off between smoothness and fidelity.</p>

  <p>AnCiR offers four smoothers, from the crude to the sophisticated:</p>
  <MethodTable headers={methodHeaders} rows={methodRows} />

  <p><strong>Which to choose?</strong> Use a <strong>moving average</strong> for a quick look; <strong>Savitzky-Golay</strong><sup class="cite"><a href="#ref-19">[19]</a></sup> when peak height and shape matter (hormone pulses, sharp activity onsets); <strong>LOESS</strong><sup class="cite"><a href="#ref-21">[21]</a></sup> for irregularly sampled data; and <strong>Whittaker-Eilers</strong><sup class="cite"><a href="#ref-20">[20]</a></sup> as a robust default that tolerates gaps. For Whittaker-Eilers the key control is <strong>λ</strong>: larger λ gives a smoother curve. Values of 10–1000 span most cases; start around 100 and increase if noise remains or decrease if real structure is being flattened. As a rule of thumb, keep the effective window near 1–2 bin widths so the daily rhythm is preserved.</p>

  <p><strong>Caution:</strong> smoothing is not free. Over-smoothing suppresses genuine short-period (ultradian) rhythms and reduces the apparent amplitude of the rhythm you are measuring. Always compare the smoothed trace against the raw data before trusting it, and never smooth more than the analysis requires.</p>

  <AnCiRBox title="Smoothing Data in AnCiR">
    <ol>
      <li>From the <strong>node palette</strong>, under <strong>Smoothing</strong>, choose <strong>Smooth Data</strong>.</li>
      <li>Expand the node and select the <strong>X column</strong> (time) and <strong>Y column(s)</strong>. Multiple Y columns can be smoothed in one step.</li>
      <li>Choose a <strong>Smoother Type</strong> (moving average, LOESS, Savitzky-Golay, or Whittaker-Eilers) and set its parameters. <em>Whittaker-Eilers with Lambda = 100</em> works well for most circadian recordings.</li>
      <li>The node outputs smoothed X and Y columns.</li>
      <li>Wire these smoothed columns into your Actogram or Periodogram.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-tp-smootheddata.json" label="Open the Smooth Data example in AnCiR" />
  </AnCiRBox>

  <h3 class="section-head">Removing Trend (Detrending)</h3>
  <p>Many biological recordings carry a slow, non-rhythmic <a class="gloss" href="#gloss-detrending">drift</a> on top of the rhythm of interest: an animal steadily gaining weight, a sensor baseline wandering with room temperature, electrode impedance changing over days, or masking by spontaneous activity. This low-frequency component is usually a nuisance rather than the signal you want to characterise.</p>

  <p>A trend distorts the very analyses that follow. In <a class="gloss" href="#gloss-cosinor">cosinor</a> fitting it biases the estimated <a class="gloss" href="#gloss-mesor">MESOR</a> and can inflate the apparent <a class="gloss" href="#gloss-amplitude">amplitude</a>, because part of the straight-line drift is absorbed into the fitted cosine. In spectral methods (<a class="gloss" href="#gloss-periodogram">periodograms</a> and the <a class="gloss" href="#gloss-fft">FFT</a>) a drift adds strong power at very low frequencies that can leak into the circadian band and produce spurious long-period peaks. Removing the trend first keeps these estimates honest; it is <strong>recommended before cosinor analysis and periodogram computation</strong> whenever a trend is visible.</p>

  <p>Detrending fits a smooth model of the baseline &mdash; most often a straight line by ordinary least squares &mdash; and subtracts it, leaving the <a class="gloss" href="#gloss-residual">residuals</a>: the rhythm centred on a flat baseline.<sup class="cite"><a href="#ref-1">[1]</a></sup></p>

  <Formula tex={_tex3} />

  <p>The animation below fits an ordinary-least-squares line through a drifting seven-day recording and reveals the residuals: once the trend is subtracted, the daily rhythm sits on a flat baseline instead of climbing across the record.</p>

  <DetrendAnim />

  <p>Match the model to the drift. A <strong>linear</strong> fit handles steady drift and is the safe default; a low-degree <strong>polynomial</strong> follows gentle curvature; <strong>exponential</strong> or <strong>logarithmic</strong> models suit saturating baselines. Resist over-fitting: a high-degree polynomial can soak up genuine low-frequency rhythm along with the drift, flattening real biology. When in doubt, choose the simplest model that visibly removes the baseline, and always inspect the residuals before trusting them.</p>

  <AnCiRBox title="Detrending in AnCiR">
    <ol>
      <li>From the <strong>node palette</strong>, under <strong>Filtering</strong>, choose <strong>Remove Trend</strong>, and wire the column you want to detrend into it.</li>
      <li>Expand the node and choose the <strong>Trend model</strong>: <strong>linear</strong> is sufficient for most recordings; <strong>polynomial</strong> (with configurable degree), <strong>exponential</strong>, and <strong>logarithmic</strong> are available for more complex drifts.</li>
      <li>The output column holds the <a class="gloss" href="#gloss-residual">residuals</a> (original − fitted trend). The fitted <a class="gloss" href="#gloss-r-squared">R²</a> and <a class="gloss" href="#gloss-rmse">RMSE</a> are shown in the node.</li>
      <li>The original data is always preserved — delete the node to restore it.</li>
    </ol>
    <DemoLink session="sessions/demos/demo-process-removetrend.json" label="Open the Remove Trend example in AnCiR" />
  </AnCiRBox>
  <ChapterExamples chapter="ch4" />
</ChapterSection>
