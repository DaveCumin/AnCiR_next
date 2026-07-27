<script>
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import NoteBox from '$lib/components/NoteBox.svelte';
	import WarnBox from '$lib/components/WarnBox.svelte';
	import DemoLink from '$lib/components/DemoLink.svelte';
	import PermutationAnim from '$lib/animations/PermutationAnim.svelte';
	import FDRAnim from '$lib/animations/FDRAnim.svelte';
	import ChiSquaredAnim from '$lib/animations/ChiSquaredAnim.svelte';
</script>

<ChapterSection id="stats" num="Foundations" title="Statistical Foundations">
	<p class="chapter-intro">
		The method chapters assume a working knowledge of ordinary statistics. This section supplies it,
		in the order you actually need it: describe your data, compare groups, look for association, and
		then deal honestly with the fact that you have run more than one test. Every part names the
		AnCiR node that does the job.
	</p>

	<NoteBox title="Why a statistics section in a chronobiology handbook">
		<p>
			Because the circadian methods sit <em>on top</em> of these. A cosinor is a regression; a periodogram
			peak needs a significance threshold; comparing acrophases between groups is a two-sample test on
			circular data. If the foundations are shaky the rhythm analysis inherits the problem, and the failure
			is usually invisible.
		</p>
	</NoteBox>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h3 class="section-head">1. Describing Data and Distributions</h3>

	<p>
		Before any test, look at the distribution. The summary you report and the test you are entitled
		to use both follow from its shape.
	</p>

	<AnCiRBox title="Describe Data, Histogram, Boxplot">
		<p>
			<strong>Describe Data</strong> (Analysis) returns the standard battery for each variable:
			<strong>n</strong>, <strong>mean</strong>,
			<strong>median</strong>, <strong>sd</strong>, <strong>min</strong>,
			<strong>max</strong>, <strong>range</strong>, <strong>q1</strong>,
			<strong>q3</strong>, <strong>iqr</strong>, <strong>skewness</strong> and
			<strong>kurtosis</strong>.
		</p>
		<p>
			Pair it with a <strong>histogram</strong> and a <strong>boxplot</strong>
			(Plots). The numbers tell you the centre and spread; the plots tell you whether those numbers mean
			anything. A bimodal distribution has a mean, and the mean describes nobody.
		</p>
	</AnCiRBox>

	<p>
		Two of the outputs are worth reading properly. <strong>Skewness</strong> is asymmetry: positive
		means a long right tail, which is the normal state of affairs for activity counts, where most
		epochs are low and a few are very high. <strong>Kurtosis</strong> is tail weight relative to a normal
		distribution: high values mean outliers are more common than a normal curve predicts. Both are diagnostic,
		not decorative &mdash; they tell you in advance which tests are going to misbehave.
	</p>

	<h4 class="sub-head">Testing normality, and when it actually matters</h4>

	<AnCiRBox title="Normality Test">
		<p>
			The <strong>Normality Test</strong> node offers three methods, returning a
			<strong>statistic</strong>, a <strong>pvalue</strong>, <strong>n</strong>, and a
			<strong>normal</strong> flag:
		</p>
		<ul>
			<li>
				<strong>Shapiro-Wilk</strong> (default) &mdash; the most powerful general test for small to moderate
				samples. AnCiR implements Royston's AS R94 algorithm, valid for 3 &le; n &le; 5000.
			</li>
			<li>
				<strong>D'Agostino-Pearson K&sup2;</strong> &mdash; combines skewness and kurtosis into an
				omnibus test. Matches SciPy's <code>normaltest</code>.
			</li>
			<li>
				<strong>Jarque-Bera</strong> &mdash; also skewness/kurtosis based; common in econometrics, and
				best suited to large samples.
			</li>
		</ul>
	</AnCiRBox>

	<WarnBox title="Normality of what, and does it even matter?">
		<p>Two corrections that between them prevent most misuse of these tests.</p>
		<p>
			<strong>The assumption is about residuals, not raw data.</strong> A t-test does not require
			your measurements to be normal; it requires the
			<em>errors</em> to be. Testing the raw pooled data mixes the group difference into the
			distribution and can flag non-normality that is really just two separated groups. For a
			regression or cosinor, run the test on the
			<strong>resid_*</strong> output that the fit nodes already emit.
		</p>
		<p>
			<strong>The test's usefulness runs backwards with sample size.</strong> At n = 20, when normality
			genuinely matters, the test has little power to detect a departure. At n = 5000, when the Central
			Limit Theorem has made the mean approximately normal regardless, the test will reject on a trivially
			small deviation. So it is least informative exactly where you most want an answer. Use it as one
			input alongside a histogram and a Q-Q-style look at the residuals &mdash; never as an automatic
			gate.
		</p>
	</WarnBox>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h3 class="section-head">2. Comparing Groups</h3>

	<AnCiRBox title="Compare groups (stats)">
		<p>
			The <strong>Compare groups</strong> node returns a <strong>statistic</strong>
			and a <strong>pvalue</strong> as metrics you can wire onward, with optional post-hoc tests. Methods:
		</p>
		<ul>
			<li>
				<strong>Auto</strong> (default) &mdash; two groups: Welch t-test; three or more: ANOVA.
			</li>
			<li>
				<strong>Welch t-test</strong> &mdash; two groups. Does <em>not</em> assume equal variances, which
				is why it is the sensible default rather than the classical Student version.
			</li>
			<li><strong>Mann-Whitney U</strong> &mdash; two groups, rank based.</li>
			<li><strong>ANOVA</strong> &mdash; three or more groups.</li>
			<li><strong>Kruskal-Wallis</strong> &mdash; three or more, rank based.</li>
		</ul>
		<p>
			For a categorical outcome &mdash; counts of rhythmic versus arrhythmic animals, say &mdash;
			use <strong>Chi-squared test</strong> instead, with
			<strong>independence</strong> (a contingency table) or
			<strong>goodness</strong> (observed against expected proportions).
		</p>
	</AnCiRBox>

	<p>
		The chi-squared test is worth understanding mechanically, because the same machinery reappears
		inside the periodogram. It asks a single question: how far are the <strong>observed</strong> counts
		from what the null predicts, measured in units of what the null expects? For each category it takes
		the gap, squares it (so overs and unders both count), and divides by the expected value (so a gap
		of 5 matters more when only 10 were expected than when 100 were). Add those up and you have &chi;&sup2;.
	</p>
	<WarnBox title="Two layouts, and only one of them pairs by row">
		<p>
			Categorical data reaches you in two shapes that look similar and behave completely
			differently. In the <strong>paired</strong> layout every row is one subject with both
			variables recorded &mdash; this animal was treated
			<em>and</em> it responded &mdash; so the two columns are the same length and correspond row by
			row. In the <strong>independent groups</strong>
			layout each column is a separate sample holding only its own outcomes, and the columns are usually
			different lengths: &ldquo;7 of 10 treated animals responded versus 2 of 25 controls&rdquo; is a
			column of 10 and a column of 25, with no meaningful pairing between the third treated animal and
			the third control.
		</p>
		<p>
			Handing independent groups to a procedure that expects the paired layout does not produce a
			slightly wrong answer; it produces an answer about nothing. The rows are matched arbitrarily,
			everything past the shorter column is thrown away, and the table that results describes no
			real comparison. On the 7-of-10 versus 2-of-25 example it keeps just 10 of the 35 observations
			and reports p&nbsp;=&nbsp;0.86, no association, where the correct test on all 35 gives
			p&nbsp;=&nbsp;0.0008 with Cram&eacute;r&rsquo;s V&nbsp;=&nbsp;0.64 &mdash; a strong one. A
			real effect vanishes silently.
		</p>
		<p>
			So state the layout rather than assuming it. AnCiR&rsquo;s Chi-squared node has an <strong
				>Input format</strong
			> control for exactly this. It defaults to independent groups, because in AnCiR a column is a data
			series and two groups in two columns is the shape the data usually takes; switch it to
			<em>Paired</em> when your rows really are subjects. It also warns when the two columns differ
			markedly in length, which is the usual sign that the wrong layout is selected.
		</p>
	</WarnBox>

	<ChiSquaredAnim stage="test" />
	<NoteBox title="The p-value is an area, not a number you look up">
		<p>
			The right-hand panel is the &chi;&sup2; distribution &mdash; the range of totals you would get
			if nothing were going on. As each category's contribution is added, the red line marching
			rightwards is your statistic, and the shaded region beyond it is the probability of landing
			that far out by chance. That shaded area <em>is</em> the p-value.
		</p>
		<p>
			Note the <strong>degrees of freedom</strong>: three categories give df = 2, because once you
			know the total and two of the counts, the third is fixed. The shape of the reference curve
			depends on df, which is why the same statistic means different things in different tests
			&mdash; a point that matters a great deal in <a href="#ch6">Chapter 6</a>.
		</p>
	</NoteBox>

	<h4 class="sub-head">Report an effect size, not just a p-value</h4>

	<p>
		A p-value answers one narrow question: how surprising is this result if nothing is going on? It
		says nothing about <em>how big</em> the effect is, and with a large enough sample any trivial difference
		becomes &ldquo;significant&rdquo;. This bites unusually hard in chronobiology, where a recording can
		contain tens of thousands of time points but only a handful of animals.
	</p>
	<p>
		Report the difference itself, in the units you measured, with a confidence interval: <em
			>&ldquo;acrophase differed by 1.2 h (95% CI 0.3&ndash;2.1)&rdquo;</em
		>
		tells a reader everything the p-value does and much that it does not.
	</p>

	<NoteBox title="SEM and CI are not the same thing, and error bars must be labelled">
		<p>
			The <strong>standard deviation</strong> describes how spread out your
			<em>data</em> are. The <strong>standard error of the mean</strong>
			(SEM = SD/&radic;n) describes how precisely you have located the
			<em>mean</em>. SEM is always smaller, and gets smaller as you add subjects &mdash; which is
			why error bars drawn as SEM look reassuringly tight while saying nothing about the variability
			of the underlying biology.
		</p>
		<p>
			A <strong>95% confidence interval</strong> is roughly the mean &plusmn; 2 SEM, and is the more
			honest default because it is directly interpretable. The <strong>meansem</strong> plot draws mean
			&plusmn; SEM; state in the caption which you have plotted. An unlabelled error bar is uninterpretable,
			and the difference between SD and SEM bars can be a factor of five.
		</p>
	</NoteBox>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h3 class="section-head">3. Association and Regression</h3>

	<AnCiRBox title="Correlation, pairs plot, Fit Trend Curves, Logistic regression">
		<ul>
			<li>
				<strong>Correlation</strong> (Analysis) returns <strong>r</strong>,
				<strong>pvalue</strong> and <strong>n</strong> for each variable pair.
			</li>
			<li>
				<strong>pairsplot</strong> and <strong>correlationheatmap</strong> (Plots) show all pairs at once
				&mdash; the fastest way to spot a relationship that is driven entirely by one outlier.
			</li>
			<li>
				<strong>Fit Trend Curves</strong> (Fitting) fits linear, polynomial, exponential or
				logarithmic models and returns <strong>trendy_*</strong>,
				<strong>r2</strong>, <strong>rmse</strong>, coefficients, and crucially
				<strong>resid_*</strong>.
			</li>
			<li>
				<strong>Logistic regression</strong> (Analysis) for a binary outcome, returning coefficients
				with <strong>se</strong>, <strong>z</strong>,
				<strong>pvalue</strong>, <strong>oddsRatio</strong> and its confidence interval.
			</li>
		</ul>
	</AnCiRBox>

	<h4 class="sub-head">Pearson or Spearman?</h4>
	<p>
		<strong>Pearson</strong> measures <em>linear</em> association and uses the values themselves.
		<strong>Spearman</strong>
		is Pearson computed on the
		<em>ranks</em>, so it measures any monotonic relationship and is far less disturbed by outliers
		or skew. Prefer Spearman when the data are skewed (activity counts), when the relationship looks
		curved but consistently increasing, or when a single extreme point is doing the work.
	</p>

	<WarnBox title="Always plot before you trust a correlation coefficient">
		<p>
			Anscombe's quartet is the classic demonstration: four datasets with identical means,
			variances, correlation and regression line, which look nothing alike when plotted. One is
			linear, one is curved, one is a perfect line with a single outlier, and one is a vertical
			stack plus one point. Only the plot distinguishes them.
		</p>
		<p>
			In this field there is a second trap on top of that: two rhythmic series are almost always
			&ldquo;significantly correlated&rdquo; simply because both follow time of day, and consecutive
			samples are not independent so the p-value is computed from far more effective observations
			than exist. See
			<a href="#ch9">Chapter 9</a>.
		</p>
	</WarnBox>

	<NoteBox title="Residuals are where a fit is judged">
		<p>
			R&sup2; tells you how much variance the model absorbed; it does not tell you whether the model
			is right. The residuals do. Plot <strong>resid_*</strong>
			against the fitted values and against time, and look for three things:
			<strong>curvature</strong> (the model shape is wrong), a
			<strong>funnel</strong> (variance grows with the mean &mdash; consider a log transform), and
			<strong>structure in time</strong> (autocorrelation, which means the standard errors are too small).
		</p>
		<p>
			Every fitting node in AnCiR emits residuals for exactly this purpose. In circadian data the
			third pattern is the norm rather than the exception, and it is the reason so many published
			p-values in this field are optimistic.
		</p>
	</NoteBox>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h3 class="section-head">4. Multiple Comparisons and What a Null Preserves</h3>

	<h4 class="sub-head">What a p-value actually is</h4>
	<p>
		A p-value is the probability of seeing a result at least as extreme as yours
		<em>if the null hypothesis were true</em>. The cleanest way to see this is to build the null
		yourself, which is exactly what a <strong>permutation test</strong> does: if the group labels were
		meaningless, then reshuffling them should give differences like the one you observed. Do that a few
		hundred times and you have the null distribution, drawn from your own data, assuming nothing about
		normality.
	</p>
	<p>
		In the animation the labels are shuffled repeatedly and the difference in means recomputed each
		time. The histogram is the null. The p-value is simply the fraction of that histogram lying at
		least as far from zero as the red observed line.
	</p>
	<PermutationAnim height="520px" />

	<NoteBox title="Reading it">
		<p>
			Notice that the null is centred on zero &mdash; unsurprising, since randomly assigned labels
			should show no systematic difference. Notice also that it has real width: differences of two
			or three units happen readily by chance with this sample size. That width <em>is</em> the sampling
			variability, and it is what a p-value compares against.
		</p>
		<p>
			The p-value never reaches zero. With <em>m</em> shuffles the smallest attainable value is 1/(m+1),
			because the observed result is counted in its own reference set. Beating 400 shuffles is evidence;
			it is not evidence of p &lt; 0.001.
		</p>
	</NoteBox>

	<h4 class="sub-head">What a surrogate null preserves</h4>
	<p>
		Shuffling destroys everything except the values themselves &mdash; which is right for
		independent observations, and quite wrong for a time series. Break the autocorrelation and the
		null becomes far too easy to beat, so almost any recording looks significant.
	</p>
	<p>
		<strong>Surrogate</strong> methods fix this by generating artificial series that keep the
		nuisance structure while destroying the rhythm. The choice of method is a choice about
		<em>what to preserve</em>: block resampling keeps short-range autocorrelation, AR(1) keeps the
		red-noise character, phase randomisation keeps the entire autocorrelation function, and AAFT
		keeps that plus the distribution of values. This is the subject of
		<a href="#ch6">Chapter 6</a>, where the <strong>Surrogate Test</strong> node is described in full.
	</p>

	<h4 class="sub-head">Correcting for many tests</h4>
	<p>
		Run 60 tests at &alpha; = 0.05 and you should expect three false positives before any real
		effect exists. Run 15,000 in a transcriptomic screen and you expect 750. Correction is not
		optional bookkeeping; without it a screen's output is mostly noise.
	</p>
	<p>
		The animation shows how <strong>Benjamini-Hochberg</strong> works. Sort the p-values from
		smallest to largest, draw the sloping line
		<em>i</em>/<em>m</em> &times; &alpha;, find the largest rank whose p-value still falls below
		that line, and reject everything up to it. Compare it with the flat Bonferroni line far below:
		BH rejects considerably more, because it controls the <em>proportion</em> of false discoveries rather
		than the probability of any at all.
	</p>
	<FDRAnim height="500px" />

	<AnCiRBox title="FDR Correction">
		<p>
			Wire a column of p-values into the <strong>FDR Correction</strong> node and it returns
			<strong>padj</strong>
			and <strong>reject</strong>. Choose the method by what you need to control:
		</p>
		<ul>
			<li>
				<strong>Benjamini-Hochberg</strong> &mdash; controls the false discovery rate, the expected
				<em>proportion</em> of your discoveries that are false. The right default for a screen.
			</li>
			<li>
				<strong>Benjamini-Yekutieli</strong> &mdash; the same, valid under arbitrary dependence between
				tests; more conservative.
			</li>
			<li>
				<strong>Holm</strong> &mdash; controls the family-wise error rate, the probability of
				<em>even one</em> false positive. Uniformly more powerful than Bonferroni, so prefer it.
			</li>
			<li><strong>Bonferroni</strong> &mdash; the same goal, simplest and strictest.</li>
		</ul>
		<p>
			All four are tested to agree with the standard implementations (as in Python's <code
				>statsmodels</code
			>) to nine decimal places.
		</p>
	</AnCiRBox>

	<!-- ─────────────────────────────────────────────────────────────────── -->
	<h3 class="section-head">5. Smoothing and Uncertainty</h3>

	<AnCiRBox title="Smooth Data">
		<p>
			The <strong>Smooth Data</strong> node offers <strong>Whittaker-Eilers</strong>
			(default, &lambda; controls stiffness), <strong>LOESS</strong> (local regression, bandwidth
			controls span), <strong>Savitzky-Golay</strong>
			(polynomial in a sliding window, preserves peak height well) and a
			<strong>moving average</strong>. It emits <strong>smoothedy_*</strong> and
			<strong>resid_*</strong>.
		</p>
	</AnCiRBox>

	<WarnBox title="Smooth to look; measure on the unsmoothed data">
		<p>
			Every smoother reduces variance by borrowing from neighbouring points, and in doing so it <strong
				>attenuates amplitude</strong
			>
			and can
			<strong>shift phase</strong>. Measure an amplitude from a smoothed series and it will be too
			small, by an amount that depends entirely on a setting you chose.
		</p>
		<p>
			The failure has a characteristic signature: turn the smoothing up and the curve looks better
			and better while the estimate drifts further from the truth. If smoothing changes your
			conclusion, the conclusion was not there. Use smoothing for display and for onset detection;
			fit models to the raw data.
		</p>
	</WarnBox>

	<p>
		The bandwidth or &lambda; is a bias-variance dial. Too little smoothing and you are fitting
		noise; too much and you have flattened the signal. The residuals decide it: a well-chosen
		smoother leaves residuals that look like noise, while an over-smoothed one leaves obvious
		structure behind &mdash; the signal it failed to capture.
	</p>

	<NoteBox title="Where the statistics chapters continue">
		<p>
			Group comparison of <em>phases</em> needs circular statistics, because 23:00 and 01:00 are two
			hours apart, not twenty-two (<a href="#ch12">Chapter 12</a>). Models with repeated measures
			per subject, and residual autocorrelation, are in
			<a href="#ch11">Chapter 11</a>. Significance for periodogram peaks, and the Surrogate Test
			node, are in <a href="#ch6">Chapter 6</a>.
		</p>
	</NoteBox>
</ChapterSection>
