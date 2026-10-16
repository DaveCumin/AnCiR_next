<script>
	import ChapterExamples from '$lib/components/ChapterExamples.svelte';
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import HistoricalContext from '$lib/components/HistoricalContext.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import DemoLink from '$lib/components/DemoLink.svelte';
	import WarnBox from '$lib/components/WarnBox.svelte';
	import NoteBox from '$lib/components/NoteBox.svelte';
	import Formula from '$lib/components/Formula.svelte';
	import FoldedPeriodogramAnim from '$lib/animations/FoldedPeriodogramAnim.svelte';

	const contextEntries = [
		{
			year: '1965',
			text: 'James Enright introduces a periodogram for detecting rhythmicity in locomotor activity data, based on the spread of the period-folded means<sup class="cite"><a href="#ref-23">[23]</a></sup> — the direct ancestor of the chi-squared periodogram formalised by Sokolove and Bushell in 1978 (below).'
		},
		{
			year: '1976–1982',
			text: 'Building on earlier least-squares spectral methods, Nicholas Lomb<sup class="cite"><a href="#ref-3">[3]</a></sup> (1976) develops a periodogram for unequally spaced data; Jeffrey Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup> (1982) establishes its statistical behaviour and false-alarm probabilities, giving the modern Lomb-Scargle periodogram.'
		},
		{
			year: '1978',
			text: 'Philip Sokolove<sup class="cite"><a href="#ref-2">[2]</a></sup> and Wayne Bushell refine and popularise the chi-square periodogram with a clear mathematical framework still used today (J. Theor. Biol. 72:131–160).'
		}
	];
	const _tex1 = String.raw`Q_P = \frac{N}{k} \cdot \frac{\displaystyle\sum_j (\bar{x}_j - \bar{x})^2}{s^2}`;
</script>

<ChapterSection id="ch6" num="Chapter 6" title="Periodograms">
	<HistoricalContext entries={contextEntries} />

	<p class="chapter-intro">
		A <a class="gloss" href="#gloss-periodogram">periodogram</a> provides an objective, quantitative assessment
		of rhythmic structure by estimating the relative contribution of different periodicities to an observed
		time series. The result is a plot of spectral power (a measure of how strongly each period contributes
		to the signal) against period, with significant peaks identifying dominant rhythms.
	</p>

	<h3 class="section-head">Chi-Squared Periodogram (Sokolove-Bushell)</h3>
	<p>
		The <a class="gloss" href="#gloss-chi-squared-periodogram">chi-squared periodogram</a> is the most
		widely used method in chronobiology. For each test period P, data are folded and the χ² statistic
		tests whether bin means differ from the grand mean:
	</p>
	<Formula tex={_tex1} />
	<p>
		Where N is the number of (binned) data points included, k is the number of bins per fold, x̄ⱼ is
		the mean of bin j, x̄ is the grand mean, and the divisor is the <strong>population</strong>
		<a class="gloss" href="#gloss-variance">variance</a>
		σ̂² = (1/N)·Σ(xᵢ − x̄)² (divisor N, not N−1). In the classic form N/k is the number of
		<em>complete</em> cycles at that trial period, ⌊N/k⌋, and the points after the last complete
		cycle are dropped. Tackenberg and Hughey showed that this truncation makes the periodogram jump
		from one trial period to the next and can pull the period estimate low; keeping every point
		removes the jumps<sup class="cite"><a href="#ref-32">[32]</a></sup>. AnCiR keeps every point:
		each bin mean averages all the cycles that reach that bin, a partial last cycle included, and
		each bin is weighted by the number of points it holds. Q_p is approximately χ²-distributed with
		(k−1)
		<a class="gloss" href="#gloss-degrees-of-freedom">degrees of freedom</a>
		under the
		<a class="gloss" href="#gloss-null-hypothesis">null hypothesis</a> of no rhythmicity. In AnCiR, k
		counts only the bins the data actually occupies: bins the sampling never fills (a bin size below the
		sampling interval, or gaps in the record) carry no information and are excluded from Q_p, its degrees
		of freedom, the significance line, and the p-value alike — so under the null the statistic averages
		about its df at any bin size, which is what keeps the drawn threshold meaningful.
	</p>
	<WarnBox title="Important Limitation">
		<p>
			The χ² periodogram requires <strong>equally spaced data</strong>. For sparse or irregularly
			sampled data (e.g., clinical hormone assays), use the Lomb<sup class="cite"
				><a href="#ref-3">[3]</a></sup
			>-Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup> periodogram instead.
		</p>
	</WarnBox>

	<h4 class="sub-head">Where the &chi;&sup2; actually comes from</h4>
	<p>
		The name is not an analogy. Fold the record at a trial period and average each bin across
		cycles. If there is no rhythm at that period, the folding scrambles the cycles and every bin
		mean should sit near the grand mean, differing only by sampling noise. Each bin mean has
		variance &sigma;&sup2;/K for K cycles, so
	</p>
	<p style="text-align:center">
		<strong
			>Q<sub>p</sub> = &Sigma;<sub>h</sub> (x̄<sub>h</sub> &minus; x̄)&sup2; &divide; (&sigma;&sup2;/K)</strong
		>
	</p>
	<p>
		is a sum of <em>squared standardised deviations</em> &mdash; which is exactly what a chi-squared
		statistic is, here with <strong>df = P &minus; 1</strong>
		for P bins per cycle.
	</p>
	<p>
		The animation in <a href="#ch6-one-fold">One Fold, Three Summaries</a> below draws this fold and its
		bin means, next to the Lomb-Scargle and Enright views of the same folded data.
	</p>

	<WarnBox title="Bin count is a user choice that moves the significance bar">
		<p>
			On AnCiR's chi-squared periodogram the red significance line <strong>rises</strong>
			with the trial period. That is because df = P &minus; 1, and more bins per cycle means more degrees
			of freedom, which means a higher bar to clear.
		</p>
		<p>
			So your choice of <strong>bin size</strong> changes the significance threshold, not just the resolution.
			Finer bins buy detail and cost sensitivity. Report the bin size alongside the period range and step;
			a &ldquo;&chi;&sup2; periodogram&rdquo; without them is not reproducible.
		</p>
		<p>
			And going <em>below the sampling interval</em> buys nothing: bins the sampling never fills are empty,
			and empty bins are excluded from the statistic and its degrees of freedom. A 0.25&nbsp;h bin on
			hourly data therefore gives exactly the 1&nbsp;h-bin answer wherever the fold aligns with the sampling
			grid, and in between it makes the effective bin count &mdash; and with it the significance bar &mdash;
			jump from one trial period to the next. Match the bin size to the sampling interval or larger.
		</p>
	</WarnBox>

	<WarnBox title="A test for rhythm, not the best estimate of τ">
		<p>
			Use the chi-squared periodogram to ask <em>whether</em> a record is rhythmic. To measure the
			period, prefer Lomb-Scargle. Tackenberg and Hughey found that the classic chi-squared
			periodogram (the truncated form above) can underestimate the period, by an amount that depends
			on the true period and the length of the record, and that even a version keeping every point
			was less accurate than Lomb-Scargle on their simulated records<sup class="cite"
				><a href="#ref-32">[32]</a></sup
			>.
		</p>
		<p>
			AnCiR's chi-squared keeps every point, so it avoids the cause they identified, but Q<sub
				>p</sub
			>
			has a bias of its own when the rhythm is weak: on noise it averages about its df (P &minus; 1),
			which grows with the trial period, so the <strong>largest Q<sub>p</sub></strong> drifts toward
			long periods (and toward twice the true period, when that is in range). AnCiR therefore
			reports as the peak the period whose Q<sub>p</sub> rises
			<strong>furthest above its own threshold</strong>, in the plot, in Rhythmicity Analysis and in
			Moving Analysis alike. In a check of 300 simulated ten-day hourly records holding a 24 h
			cosine (periods 16 to 32 h, 1 h bins), with white noise four times the cosine's amplitude, the
			largest Q<sub>p</sub> fell beyond 25 h in 63% of records, the peak AnCiR reports in 18%, and Lomb-Scargle's
			peak in 9%; with noise twice the amplitude, 10%, 2% and 0%; with noise equal to the amplitude, all
			three found 24 h every time. When no period crosses its threshold the peak is still reported, and
			its family-wise p (at or above alpha) says it is not significant. Read the period from the chi-squared
			periodogram only when its peak clears the significance line clearly.
		</p>
	</WarnBox>

	<h3 class="section-head">Lomb-Scargle Periodogram</h3>
	<p>
		Handles irregularly sampled time series by fitting sinusoidal models at each test frequency,
		correcting for unequal spacing via a time-offset parameter. Its power is the share of the
		variance that one fitted sinusoid explains at that period (in AnCiR, (N&minus;1)/2 &times;
		R&sup2;); the data's mean is subtracted first rather than fitted. Increasingly used in
		chronobiology for sparse clinical datasets, actigraphy with gaps, and hormone time-course data.
	</p>
	<NoteBox title="How this relates to the FFT">
		<p>
			Lomb-Scargle is, in effect, a <a href="#ch7">cosinor</a> swept across frequencies: at each
			trial period it fits a sinusoid and reports how much of the variance that fit explains. The
			<a href="#ch8">FFT</a> does the same thing, with two restrictions lifted here.
		</p>
		<p>
			First, the FFT can only test frequencies on a <strong>fixed grid</strong> (one, two, three… whole
			cycles across the record); Lomb-Scargle can test any period you name, so you can search 20&ndash;28
			h at whatever step you choose. Second, the FFT relies on even spacing to keep its sine and cosine
			terms independent of each other; Lomb-Scargle restores that independence explicitly, with a small
			time offset computed at each frequency, which is what lets it cope with gaps and irregular timestamps.
		</p>
		<p>
			For evenly spaced, complete data the two give the same answer. The differences only appear
			when the sampling is not ideal &mdash; which, for clinical and field data, is most of the
			time.
		</p>
	</NoteBox>
	<p>
		Lomb-Scargle is not assumption-free. It fits a <strong>single sinusoid</strong>
		at each frequency, so like <a class="gloss" href="#gloss-cosinor">cosinor</a> it underestimates the
		amplitude of, and can miss, strongly non-sinusoidal (square-wave) rhythms; its noise model is Gaussian
		and homoscedastic, which count data violate (consider a variance-stabilising transform); and its standard
		false-alarm probability assumes independent trial frequencies, so it understates the false-positive
		rate on a fine period grid — a permutation-based threshold is safer. Irregular sampling also imposes
		a spectral window whose sidelobes can create spurious peaks, so inspect the sampling pattern when
		it is structured (e.g. daytime-only clinical sampling).
	</p>

	<h3 class="section-head">Enright Periodogram</h3>
	<p>
		The <a class="gloss" href="#gloss-enright-periodogram">Enright periodogram</a><sup class="cite"
			><a href="#ref-23">[23]</a></sup
		>
		folds the series at each trial period into a Buys-Ballot table (rows = cycles, columns = position
		within the cycle), averages each column, and reports Enright's amplitude A<sub>p</sub>, the
		<strong>standard deviation of the column means</strong> about their grand mean:
	</p>
	<p class="formula">
		<strong
			>A<sub>p</sub> = &radic;( &Sigma;<sub>h</sub> (x̄<sub>h</sub> &minus; x̄)&sup2; &divide; P )</strong
		>
	</p>
	<p>
		with P the number of columns and x̄ the mean of the column means (Legendre and Legendre's
		statement of Enright's statistic<sup class="cite"><a href="#ref-31">[31]</a></sup>). A true
		period lines the cycles up, so the column means scatter widely. A<sub>p</sub> is in the units of
		the data, so compare it between trial periods of one recording, not between recordings. It is
		the direct ancestor of the chi-squared periodogram: Sokolove and Bushell's Q<sub>p</sub><sup
			class="cite"><a href="#ref-2">[2]</a></sup
		>
		is built from the same sum of squares, rescaled to a known &chi;&sup2; null distribution. Because
		the two share that sum, an Enright peak and a chi-squared peak at the same period are
		<strong>not independent confirmation</strong> of each other.
	</p>
	<p>
		A<sub>p</sub> has no simple significance threshold, so no line is drawn for it. Each column mean
		also carries noise (with standard error &sigma;/&radic;r for r cycles per column), so A<sub
			>p</sub
		>
		never falls to zero on noise, and it creeps up wherever the columns hold fewer cycles: at long trial
		periods, in short recordings, and at folds that use bins narrower than the sampling interval. Judge
		a peak against its neighbours, and use the chi-squared periodogram when you need a test.
	</p>
	<p>
		In AnCiR a column mean averages only the bins that hold data: an empty bin (a gap, a missing
		value, or a bin narrower than the sampling interval) is missing, not zero, and a partial last
		cycle simply leaves its later columns one row shorter<sup class="cite"
			><a href="#ref-31">[31]</a></sup
		>. Before version 80.1 the method computed a different quantity (an average autocorrelation at
		multiples of the trial period, which could be negative), so Enright values from older sessions
		change when they are recalculated.
	</p>

	<h3 class="section-head" id="ch6-one-fold">One Fold, Three Summaries</h3>
	<p>
		The three periodograms above look like different machines, but they start the same way. At each
		trial period, cut the record into period-long pieces and stack them. Every sample now has a
		<em>phase</em> (its position within the trial cycle) and a value. At the true period the stacked
		cycles line up into a clear profile; at a wrong one they smear into a flat cloud. The methods
		differ only in how they <strong>summarise the folded cloud</strong>:
	</p>
	<ul>
		<li>
			<strong>Lomb-Scargle fits one cosine</strong> to the folded points and asks what share of the variance
			it explains. This is exact, not an analogy: a cosine at the trial period depends on time only through
			phase, so fitting it to the raw series and fitting it to the folded cloud are the same regression,
			with the same coefficients and the same residuals. A cosine needs points spread around the cycle,
			not a full set in every bin, which is why Lomb-Scargle copes with gaps and uneven sampling.
		</li>
		<li>
			<strong>Chi-squared and Enright average each phase bin</strong> and ask how far the bin means
			spread. Bin means can follow any shape. Q<sub>p</sub> turns their spread into a &chi;&sup2;
			test; A<sub>p</sub> reports it in the units of the data. They lean on every bin: they assume evenly
			spaced samples, so that every bin collects a fair share of each cycle, and as bins thin each bin
			mean gets noisier.
		</li>
	</ul>
	<p>
		The animation draws all three from one folded cloud and puts them on one scale, the share of the
		variance each summary explains. Play the sweep and watch every curve collapse where the fold
		smears the cycles and peak where it lines them up. The record is sampled hourly, so the trial
		period steps one hour at a time: the binned methods fold at a whole number of bins, so those are
		the periods they can test, and each plotted point is the value AnCiR reports there. The faint
		phase bins are drawn for all three, but Lomb-Scargle does not use them: its cosine is fitted to
		the points.
	</p>
	<p>
		Then try the <strong>Narrow activity bout</strong> button, which pulls the methods apart. Bin means
		are shape-free and trace the bout. One cosine cannot, so it explains much less of the variance, and
		the part it misses shows up as a second Lomb-Scargle peak at half the period (a harmonic of the daily
		rhythm, not a second rhythm). The bin means find a 12 h peak too, because folding at 12 h overlays
		the two halves of a lopsided day.
	</p>
	<FoldedPeriodogramAnim />
	<p>
		Two consequences are worth carrying away. A sinusoid is the right summary when the waveform is
		close to one, and its few parameters keep its noise floor low; bin means are the right summary
		when the shape matters, at the price of one free value per bin, which lifts their floor and is
		why Q<sub>p</sub>'s significance line rises with the number of bins. And because chi-squared and
		Enright summarise the <em>same</em> bin means, agreement between them is not independent confirmation;
		agreement between a bin-mean method and Lomb-Scargle says more.
	</p>

	<h3 class="section-head">Interpreting a Periodogram</h3>
	<ul>
		<li>A sharp, high-power peak at ~24 h indicates well-entrained circadian rhythmicity.</li>
		<li>In free-running conditions, the peak shifts to the animal's endogenous τ.</li>
		<li>
			Multiple peaks may indicate <a class="gloss" href="#gloss-harmonic">harmonic</a> structure (at τ/2,
			τ/3) or genuine multi-frequency rhythmicity.
		</li>
		<li>A flat periodogram suggests arrhythmicity, insufficient data, or excessive noise.</li>
	</ul>
	<WarnBox title="Harmonic Artefact">
		<p>
			The chi-squared periodogram may identify a spurious 12 h component in square-wave data
			(Refinetti et al. 2007, Fig. 16). Lomb<sup class="cite"><a href="#ref-3">[3]</a></sup
			>-Scargle<sup class="cite"><a href="#ref-4">[4]</a></sup> is not a clean check on it: a
			non-sinusoidal daily waveform also gives Lomb-Scargle a 12 h peak, because one cosine cannot
			follow the shape (try the <em>Narrow activity bout</em> button above). Look at the record folded
			at 24 h instead: one lopsided daily profile means the 12 h peak is a harmonic of the daily rhythm;
			a genuine 12 h rhythm repeats the same profile twice within each day.
		</p>
	</WarnBox>

	<WarnBox title="The significance line and multiple testing">
		<p>
			A periodogram scanning 16–32 h at 15 min bins performs 65 simultaneous χ² tests (one per fold
			length from 64 to 128 bins), so an uncorrected α = 0.05 threshold will be exceeded by chance
			in many pure-noise records. AnCiR's drawn threshold line already applies a <strong
				>Sidak correction</strong
			>
			over the number of <em>distinct fold lengths</em> tested (the per-fold confidence level is
			(1−α)<sup>1/m</sup>), so it does not need a further Bonferroni adjustment; the per-period
			p-values it exports are raw, uncorrected upper-tail values. The count is of folds, not of
			trial periods: a step finer than the bin size revisits the same fold, which is the same test
			and is not counted twice. For a still safer bar, derive the threshold by
			<strong>permuting the series</strong>
			and taking the 95th percentile of the maximum Q_P — this handles both the multiplicity and the correlation
			between neighbouring trial periods. Two further cautions: the χ² null assumes
			<strong>independent observations</strong>, and activity data are strongly autocorrelated,
			which inflates Q_P and makes nominal p-values optimistic; and the
			<strong>bin size sets the degrees of freedom</strong> (k−1), so changing it moves the significance
			line — always report the bin size alongside the p-value.
		</p>
	</WarnBox>

	<AnCiRBox
		title="Running a Periodogram in AnCiR"
		tip="Note the estimated period for use in the next step — Cosinor analysis performs better when you use the measured τ rather than assuming exactly 24 h."
	>
		<ol>
			<li>
				Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right) and, under
				<strong>Plots</strong>, choose <strong>periodogram</strong>.
			</li>
			<li>
				Wire your <strong>time column</strong> into the <strong>x</strong> input and your
				<strong>data column</strong> into the <strong>y</strong> input.
			</li>
			<li>
				Select the <strong>Method</strong>:
				<ul>
					<li>
						<strong>Chi-squared (Sokolove-Bushell)</strong>: a test of whether regularly sampled
						activity data are rhythmic, with a significance line; most widely used in chronobiology.
						To measure τ, prefer Lomb-Scargle (see the warning above).
					</li>
					<li>
						<strong
							>Lomb<sup class="cite"><a href="#ref-3">[3]</a></sup>-Scargle<sup class="cite"
								><a href="#ref-4">[4]</a></sup
							></strong
						>: use to estimate τ, and for data with irregular timing or gaps.
					</li>
					<li>
						<strong>Enright</strong>: the standard deviation of the period-folded means (A<sub
							>p</sub
						>), in the units of the data; no significance line.
					</li>
				</ul>
			</li>
			<li>
				Set the period range to test under <strong>Period range (hrs)</strong>:
				<strong>Min</strong> and <strong>Max</strong> (e.g., 16–32 h for circadian analysis; widen
				for ultradian/infradian) and the <strong>Step</strong> resolution (default 0.25 h). The
				default method is <strong>Lomb-Scargle</strong>. Chi-squared and Enright fold the binned
				data at a whole number of bins, so they can only test periods that are multiples of the bin
				size: each fold appears once, plotted at the period it actually tests, and a step finer than
				the bin size adds no new points.
			</li>
			<li>
				For <strong>Chi-squared</strong> and <strong>Enright</strong>, set the
				<strong>Bin Size</strong>. A new series starts at the median sampling interval of its x (one
				sample per bin); type a value to set your own. A bin narrower than the sampling interval
				leaves bins empty, which both methods treat as missing. For Chi-squared, also set the
				significance level <strong>Alpha</strong> (default 0.05); a significance threshold line is then
				drawn across the plot. The Lomb-Scargle and Enright methods do not draw a significance line, so
				judge their peaks against a permutation threshold if you need a formal test.
			</li>
			<li>
				The dominant <strong>Peak Period</strong> and its <strong>Peak Power</strong>
				are reported in the node. For Chi-squared the peak is the period that rises furthest above its
				threshold line, and the node adds its family-wise p, marked
				<em>not significant</em> when the peak does not cross the line.
			</li>
			<li>
				The y axis is titled after the statistic each method computes: <strong
					>Normalised power</strong
				>
				(Lomb-Scargle), <strong>Chi-squared Qp</strong> and
				<strong>Enright amplitude (A_p)</strong>. These are different quantities on different
				scales, so when one plot carries series of different methods the title reads
				<strong>Statistic (mixed methods)</strong>, and their heights are not comparable with each
				other. Type a label under Y-Axis Controls to use your own; clear it to go back to the
				default. A periodogram saved before this default existed keeps the title it was saved with.
			</li>
			<li>
				Tick <strong>Log Scale</strong> (Y-Axis) to draw the power axis on a log scale, which keeps the
				baseline readable under a tall peak. It changes the display only: peaks, thresholds, p-values
				and output ports are the same numbers. The threshold line and reference lines are drawn at their
				values on the log axis; a value at or below zero has no place on it and is left out. The axis
				starts just below the smallest value drawn (unless you set a minimum) and labels its ticks as
				plain numbers (0.01, 1, 100). The FFT plot's Log Scale draws its magnitude axis the same way.
			</li>
			<li>Hover over the plot to read off the exact period and power at any point.</li>
		</ol>
		<DemoLink
			session="sessions/demos/demo-periodogram-rhythm.json"
			label="Open the Periodogram example in AnCiR"
		/>
	</AnCiRBox>

	<h3 class="section-head">Correcting for Multiple Comparisons</h3>
	<p>
		The warning above applies whenever you run more than one test. Screen 15,000 transcripts for
		rhythmicity at p &lt; 0.05 and you should expect roughly <strong>750 false positives</strong> before
		any real biology — comparable to the true signal in many tissues. The same problem arises on a smaller
		scale whenever you test several animals, several tissues, or several metrics.
	</p>
	<p>Two different things can be controlled, and choosing between them is the real decision:</p>
	<ul>
		<li>
			The <strong>family-wise error rate (FWER)</strong> — the probability of <em>even one</em> false
			positive. Strict, appropriate when a single wrong claim is costly.
		</li>
		<li>
			The <strong>false discovery rate (FDR)</strong> — the expected <em>proportion</em> of your declared
			discoveries that are false. More permissive, and the right frame for a screen whose output is a
			candidate list you intend to follow up.
		</li>
	</ul>

	<AnCiRBox
		title="FDR Correction node"
		tip="Wire the node's padj output into a Filter to keep only the rows that survive, or plot padj against the raw p-value to see how hard the correction bit."
	>
		<p>
			The <strong>FDR Correction</strong> node (Analysis family) takes a column of p-values in
			<code>xIN</code>
			and returns two columns: <strong>padj</strong> (the adjusted p-values) and
			<strong>reject</strong> (whether each survives at your chosen α).
		</p>
		<ul>
			<li>
				<strong>Benjamini-Hochberg</strong> — controls FDR under independence or positive dependence.
				The default, and the right choice for almost every omics screen.
			</li>
			<li>
				<strong>Benjamini-Yekutieli</strong> — controls FDR under <em>arbitrary</em> dependence. More
				conservative; use when the tests may be negatively correlated in ways you cannot rule out.
			</li>
			<li>
				<strong>Holm</strong> — controls FWER, step-down. Uniformly more powerful than Bonferroni, so
				there is rarely a reason to prefer Bonferroni to it.
			</li>
			<li>
				<strong>Bonferroni</strong> — controls FWER by multiplying each p-value by <em>n</em>.
				Simple and very conservative.
			</li>
			<li>
				<strong>None</strong> — pass through unchanged, for when correction is applied elsewhere.
			</li>
		</ul>
		<p>
			Set <strong>alpha</strong> (default 0.05) to the threshold you will report against. The
			adjusted values are computed so that comparing <code>padj</code> against α gives the same decisions
			as the classical step-up or step-down procedure.
		</p>
	</AnCiRBox>

	<NoteBox title="Two details worth knowing">
		<p>
			<strong>Failed fits do not tighten the correction.</strong> Non-finite p-values — from a node
			that did not converge — are carried through as NaN and excluded from the count <em>n</em>,
			rather than being silently treated as 1. A model that failed to fit should not make the
			correction harsher for the ones that succeeded.
		</p>
		<p>
			<strong>The implementation is checked against a reference.</strong> All four methods are
			tested to agree with the standard implementations (as in Python's <code>statsmodels</code>) to
			nine decimal places, so results are directly comparable with a scripted pipeline.
		</p>
	</NoteBox>

	<h3 class="section-head">Surrogate Testing: a Null That Respects Your Data</h3>
	<p>
		The significance line on a periodogram, and the p-value from a cosinor, both rest on an
		assumption that circadian data routinely break: that the noise is <strong
			>independent from one sample to the next</strong
		>. It is not. Activity now strongly predicts activity a minute from now, and that
		autocorrelation alone produces broad spectral peaks that look convincingly rhythmic.
	</p>
	<p>
		A <strong>surrogate test</strong> sidesteps the assumption entirely. Instead of trusting a
		formula, it builds the null distribution empirically: generate many artificial series that share
		the nuisance structure of your data but contain <em>no genuine rhythm</em>, compute the same
		statistic on each, and see where your real value falls.
	</p>
	<p>
		Everything depends on what "share the nuisance structure" means, which is what the method choice
		controls.
	</p>

	<AnCiRBox
		title="Surrogate Test node"
		tip="Start with block and a block length near one cycle. If the result is borderline, try ar1 as well; a rhythm that survives both is a rhythm worth reporting."
	>
		<p>
			The <strong>Surrogate Test</strong> node (Analysis family) takes time in <code>xIN</code> and
			values in <code>yIN</code>, and returns a <strong>pvalue</strong> and the
			<strong>observed</strong> statistic as metrics you can wire onward or store.
		</p>
		<ul>
			<li>
				<strong>Block</strong> (default) — resample contiguous blocks of the record. Preserves
				short-range autocorrelation up to the block length while destroying rhythm across blocks.
				Set <strong>blockLengthHours</strong> near one cycle (default 24).
			</li>
			<li>
				<strong>AR(1)</strong> — fit a first-order autoregressive model and simulate from it. The classic
				"red noise" null: this asks directly whether your peak beats what autocorrelation alone would
				produce.
			</li>
			<li>
				<strong>Phase</strong> and <strong>AAFT</strong> (amplitude-adjusted Fourier transform)
				surrogates are <strong>not offered</strong> by this node. They randomise the Fourier phases while
				keeping the amplitude spectrum exactly, and the spectrum is where a rhythm lives: every surrogate
				keeps the very peak being tested, so they cannot answer "is there a rhythm". In AnCiR's own simulations,
				computed correctly they returned p = 1 on every record, rhythmic or not; an earlier version that
				padded the transform called 47 to 58% of pure white-noise records rhythmic. They are the right
				null for other questions, such as coupling between two series, not for this one.
			</li>
			<li>
				<strong>Shuffle</strong> — plain random reordering. Destroys autocorrelation along with the
				rhythm, which makes the null far too easy to beat. Included for comparison and teaching;
				<strong>not</strong> a defensible primary analysis for a dense record.
			</li>
		</ul>
		<p>
			Set <strong>nSurrogates</strong> (default 199) to control resolution — the smallest achievable
			p-value is 1/(n+1), so 199 surrogates bottoms out at 0.005. Set <strong>seed</strong> for a
			reproducible result. <strong>periodMin</strong> and <strong>periodMax</strong> (default 20–28 h)
			bound the period range searched.
		</p>
		<p>
			The statistic is the largest FFT amplitude in that band, so the record must be evenly sampled.
			The node puts it on its own sampling grid first, fills up to 3 missing samples in a row by
			linear interpolation, and refuses a longer gap with a reason rather than joining the samples
			either side of it.
		</p>
	</AnCiRBox>

	<WarnBox title="Shuffling is the wrong null for a time series">
		<p>
			This is the single most common mistake in surrogate testing. Randomly reordering your data
			destroys the autocorrelation as well as the rhythm, so the resulting null is a white-noise
			null — a much lower bar than your data actually face. Almost any real recording beats it, and
			the resulting p-value is spuriously tiny.
		</p>
		<p>
			Use <strong>block</strong> or <strong>ar1</strong> for any densely sampled record. Reserve
			<strong>shuffle</strong> for genuinely independent observations — one value per subject, for instance.
		</p>
	</WarnBox>

	<NoteBox title="Why the p-value is never exactly zero">
		<p>
			The node computes p as <strong>(k + 1) / (m + 1)</strong>, where <em>k</em> is the number of
			surrogates matching or exceeding your observed statistic (a surrogate equal to it up to
			rounding counts as matching) and <em>m</em> is the number of surrogates. Adding one to each count
			includes the observed value in its own reference distribution, which is the standard convention
			for a Monte Carlo test.
		</p>
		<p>
			The practical consequence is that p can never be 0 — with 199 surrogates the floor is 0.005.
			This is honest: having beaten 199 random draws is evidence, but it is not evidence of p &lt;
			0.001. If you need a smaller p-value, run more surrogates.
		</p>
	</NoteBox>
	<ChapterExamples chapter="ch6" />
</ChapterSection>
