<script>
  import ChapterSection from '$lib/components/ChapterSection.svelte';
</script>

<ChapterSection id="glossary" num="Appendix A" title="Glossary">
  <table class="glossary-table">
    <tbody>
      <tr id="gloss-acrophase"><td>Acrophase</td><td>The clock time at which a rhythm reaches its peak (e.g., the warmest point of the day, or when activity is highest).</td></tr>
      <tr id="gloss-activity-onset"><td>Activity onset</td><td>The time an animal starts its daily active phase. A clear, easily-marked reference point used to track the clock's phase, especially in actograms and phase response curves (Chapters 5, 10).</td></tr>
      <tr id="gloss-amplitude"><td>Amplitude</td><td>How "tall" a rhythm is: half the distance from the lowest point to the highest. (Some authors use the full height instead — be aware of this ambiguity.)</td></tr>
      <tr id="gloss-autocorrelation"><td>Autocorrelation</td><td>A measure of how similar a signal is to a time-shifted copy of itself. Strong repeating patterns show up as peaks at lags equal to the period.</td></tr>
      <tr id="gloss-chi-squared-periodogram"><td>Chi-squared (χ²) periodogram</td><td>A way to test for a repeating pattern. Tries many candidate periods and asks: does the data line up neatly when folded at this period? Best for densely-sampled activity records (Chapter 6).</td></tr>
      <tr id="gloss-circadian-rhythm"><td>Circadian rhythm</td><td>A body rhythm with a period close to 24 hours, driven by an internal clock.</td></tr>
      <tr id="gloss-circular-statistics"><td>Circular statistics</td><td>Maths for data that wrap around a circle, such as clock times where 23:59 sits right next to 00:00. Ordinary averages and tests go wrong near midnight; circular versions fix this (Chapter 12).</td></tr>
      <tr id="gloss-r-squared"><td>Coefficient of determination (R²)</td><td>How much of the variation in the data a model explains. Runs from 0 (nothing explained) to 1 (perfect fit).</td></tr>
      <tr id="gloss-confidence-interval"><td>Confidence interval (CI)</td><td>A range of plausible values for a measurement. A 95% CI means: if you repeated the experiment many times, 95% of such intervals would contain the true value.</td></tr>
      <tr id="gloss-correlogram"><td>Correlogram</td><td>A plot showing how similar a signal is to itself at different time shifts. Peaks at 24 h, 48 h, and so on point to a daily rhythm (Chapter 9).</td></tr>
      <tr id="gloss-cosinor"><td>Cosinor</td><td>A method that fits a cosine wave to your data to pull out the average level (MESOR), the size of the rhythm (amplitude), and the time of its peak (acrophase) (Chapter 7).</td></tr>
      <tr id="gloss-degrees-of-freedom"><td>Degrees of freedom (df)</td><td>Roughly, how much information is left in your data after you've estimated things from it. It tells you which reference table to use when judging how unusual a result is.</td></tr>
      <tr id="gloss-detrending"><td>Detrending</td><td>Subtracting a slow drift from the data (for example, sensor drift or the animal gaining weight) so the rhythm is easier to see (Chapter 4).</td></tr>
      <tr id="gloss-dft"><td>Discrete Fourier Transform (DFT)</td><td>A maths tool that breaks a recorded signal into a set of pure waves at different speeds (frequencies) (Chapter 8).</td></tr>
      <tr id="gloss-duty-cycle"><td>Duty cycle</td><td>For an on/off (square-wave) signal, the fraction of each cycle spent in the "on" state.</td></tr>
      <tr id="gloss-enright-periodogram"><td>Enright periodogram</td><td>A period-finding method based on the variance of period-folded data: for each candidate period it folds the series into a table (cycles as rows) and measures how much the column means scatter. The direct ancestor of the chi-squared periodogram (Chapter 6).</td></tr>
      <tr id="gloss-entrainment"><td>Entrainment</td><td>When a biological rhythm locks on to a daily cue from the environment (most often the light/dark cycle).</td></tr>
      <tr id="gloss-f-test"><td>F-test</td><td>A test that compares two sources of variation. In cosinor, it asks: is the rhythm I fitted big enough to be real, or could it just be noise?</td></tr>
      <tr id="gloss-fft"><td>Fast Fourier Transform (FFT)</td><td>A fast computer algorithm for doing a Fourier Transform. Needs evenly-spaced samples to work (Chapter 8).</td></tr>
      <tr id="gloss-fourier"><td>Fourier analysis</td><td>The idea that essentially any well-behaved repeating signal can be written as a sum of simple waves at different speeds. The basis of most frequency-based methods (Chapter 8).</td></tr>
      <tr id="gloss-free-running-period"><td>Free-running period (τ)</td><td>The natural period of the body clock when there are no external time cues (constant lighting, no clocks).</td></tr>
      <tr id="gloss-gam"><td>Generalised Additive Model (GAM)</td><td>A flexible kind of regression that replaces straight lines with smooth curves — useful when a rhythm is not a clean cosine shape (Chapter 11).</td></tr>
      <tr id="gloss-harmonic"><td>Harmonic</td><td>A multiple of a rhythm's main frequency (e.g., a 12-hour bump on top of a 24-hour rhythm). Adding harmonics lets a cosine fit describe non-sinusoidal shapes.</td></tr>
      <tr id="gloss-infradian"><td>Infradian rhythm</td><td>A body rhythm with a period longer than 24 hours (e.g., menstrual cycle, seasonal rhythm).</td></tr>
      <tr id="gloss-interpolation"><td>Interpolation</td><td>Estimating missing values from the points around them, so a broken series becomes complete and evenly spaced. Linear draws a straight line across the gap; a spline threads a smooth curve (Chapter 4).</td></tr>
      <tr id="gloss-is"><td>IS (Interdaily Stability)</td><td>How regular the daily pattern is across several days. 0 means no regularity, 1 means every day is identical.</td></tr>
      <tr id="gloss-iv"><td>IV (Intradaily Variability)</td><td>How choppy the rhythm is within a single day. 0 is perfectly smooth; the theoretical maximum is 4, and IV ≈ 2 is the value expected from random noise, so values near or above 2 mean a highly fragmented record. Strongly dependent on the epoch length.</td></tr>
      <tr id="gloss-lasso"><td>LASSO / Ridge regression</td><td>Regression methods that add a penalty to keep the model from over-fitting when there are a lot of possible predictors (common in circadian gene-expression studies) (Chapter 11).</td></tr>
      <tr id="gloss-loess"><td>LOESS</td><td>A smoothing method that fits a little curve through each local slice of the data. Handles uneven sampling well (Chapter 4).</td></tr>
      <tr id="gloss-lomb-scargle"><td>Lomb-Scargle periodogram</td><td>A period-finding method that works on data with gaps or irregular timestamps — no need to fill in missing values first (Chapter 6).</td></tr>
      <tr id="gloss-mesor"><td>MESOR</td><td>The average level of a fitted cosine curve. A "rhythm-adjusted mean" that isn't thrown off by uneven sampling across the day.</td></tr>
      <tr id="gloss-missing-data"><td>Missing data</td><td>Gaps in a recording (dropped sensors, removed outliers, lost samples). Many methods assume an unbroken, evenly spaced series, so gaps must be handled by a gap-tolerant method or filled by interpolation (Chapter 4).</td></tr>
      <tr id="gloss-lmem"><td>Mixed-effects model (LMEM)</td><td>A regression that handles repeated measures from several subjects at once. One set of effects describes the typical person; another captures how each person differs (Chapter 11).</td></tr>
      <tr id="gloss-npcra"><td>NPCRA</td><td>Non-parametric circadian rhythm analysis. A group of simple summary metrics (IS, IV, L5, M10, RA) most commonly used for activity-watch data (Chapter 9).</td></tr>
      <tr id="gloss-null-hypothesis"><td>Null hypothesis (H₀)</td><td>The "nothing is happening" starting assumption (e.g., no rhythm, no difference between groups). Rejected when your data would be very unlikely if it were true.</td></tr>
      <tr id="gloss-nyquist"><td>Nyquist-Shannon theorem</td><td>You can't reliably detect a rhythm faster than half your sampling rate. To characterise a 24-hour rhythm, sample <em>well inside</em> every 12 hours (1–3 hourly in practice); faster components alias into lower frequencies if you sample too slowly (Chapter 2).</td></tr>
      <tr id="gloss-p-value"><td>p-value</td><td>The chance of seeing a result at least as striking as yours if the null hypothesis (no effect) were true. Smaller values mean stronger evidence that something is really going on.</td></tr>
      <tr id="gloss-period"><td>Period (τ)</td><td>The length of one full cycle of a rhythm (usually in hours).</td></tr>
      <tr id="gloss-periodogram"><td>Periodogram</td><td>A chart that shows the strength of a rhythm at each candidate period. The tallest peak is your best estimate of the period.</td></tr>
      <tr id="gloss-phase"><td>Phase</td><td>Where the rhythm is in its cycle at a given moment (often reported as the time of the peak).</td></tr>
      <tr id="gloss-phase-shift"><td>Phase shift (ΔΦ)</td><td>A change in the timing of a rhythm caused by a stimulus (e.g., a pulse of light, a dose of melatonin).</td></tr>
      <tr id="gloss-population-cosinor"><td>Population-mean cosinor</td><td>Cosinor applied across several subjects at once to get group-level rhythm parameters. Averages each person's sine/cosine components as vectors and tests with a modified F-test.</td></tr>
      <tr id="gloss-power-spectrum"><td>Power spectrum</td><td>A plot of how much "energy" a signal carries at each frequency. Peaks mark periodic components (Chapter 8).</td></tr>
      <tr id="gloss-prc"><td>PRC</td><td>Phase Response Curve. Shows how much a stimulus shifts the clock depending on when in the cycle it is given.</td></tr>
      <tr id="gloss-rayleigh"><td>Rayleigh test</td><td>A circular-statistics test for whether a set of phases (clock times) cluster around a particular time or are spread evenly round the clock (Chapter 12).</td></tr>
      <tr id="gloss-residual"><td>Residual</td><td>The leftover: what the data look like after you subtract the model's fit. Small, random-looking residuals = good fit.</td></tr>
      <tr id="gloss-rmse"><td>RMSE</td><td>Root Mean Squared Error. A simple number for how far, on average, the model's predictions sit from the actual data.</td></tr>
      <tr id="gloss-savitzky-golay"><td>Savitzky-Golay filter</td><td>A smoothing method that fits a small polynomial inside a sliding window. Keeps sharp peaks intact better than a plain moving average (Chapter 4).</td></tr>
      <tr id="gloss-scn"><td>SCN</td><td>Suprachiasmatic nucleus. The master body clock in mammals, sitting in the base of the brain just above the optic chiasm.</td></tr>
      <tr id="gloss-smoothing"><td>Smoothing</td><td>Gently averaging away short-term jitter so the underlying rhythm is easier to see (Chapter 4).</td></tr>
      <tr id="gloss-spectral-leakage"><td>Spectral leakage</td><td>A quirk of Fourier analysis: power from one frequency "bleeds" into the frequencies next to it. Reduced by tapering the signal with a window function (Chapter 8).</td></tr>
      <tr id="gloss-spline"><td>Spline</td><td>A smooth curve built from low-degree polynomial pieces joined so the result has no kinks. Cubic splines are a common way to interpolate smoothly across short gaps (Chapter 4).</td></tr>
      <tr id="gloss-t-test"><td>t-test</td><td>A standard test for whether two groups have different averages. Not safe for clock times — use the Watson-Williams test for phases instead.</td></tr>
      <tr id="gloss-ultradian"><td>Ultradian rhythm</td><td>A body rhythm with a period shorter than 24 hours (e.g., REM sleep cycles of about 90 minutes).</td></tr>
      <tr id="gloss-variance"><td>Variance</td><td>A measure of how spread out the data are around the mean. Many methods (F-test, R², IS, IV) are built on variance.</td></tr>
      <tr id="gloss-watson-williams"><td>Watson-Williams test</td><td>The circular-statistics equivalent of a t-test: compares the average timing of peaks between two groups, without getting confused by the midnight wrap-around (Chapter 12).</td></tr>
      <tr id="gloss-whittaker-eilers"><td>Whittaker-Eilers smoother</td><td>A smoother that balances "stay close to the data" against "keep the curve smooth". Handles gaps in the data well (Chapter 4).</td></tr>
      <tr id="gloss-window-function"><td>Window function</td><td>A shaped envelope (Hann, Hamming, Blackman) that tapers a signal to zero at its ends before Fourier analysis, to reduce spectral leakage (Chapter 8).</td></tr>
      <tr id="gloss-zeitgeber"><td>Zeitgeber (ZT)</td><td>An environmental time cue (German for "time-giver") that synchronises the body clock. ZT0 is usually defined as lights-on.</td></tr>
      <tr id="gloss-zero-padding"><td>Zero-padding</td><td>Sticking zeros on the end of a time series before running an FFT. Doesn't add new information, but spaces the results more finely along the frequency axis (Chapter 8).</td></tr>
    </tbody>
  </table>
</ChapterSection>
