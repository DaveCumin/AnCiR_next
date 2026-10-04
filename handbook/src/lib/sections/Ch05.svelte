<script>
	import ChapterExamples from '$lib/components/ChapterExamples.svelte';
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import HistoricalContext from '$lib/components/HistoricalContext.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import DemoLink from '$lib/components/DemoLink.svelte';
	import Formula from '$lib/components/Formula.svelte';
	import WarnBox from '$lib/components/WarnBox.svelte';
	import ActogramAnim from '$lib/animations/ActogramAnim.svelte';

	const contextEntries = [
		{
			year: '1926',
			text: 'Maynard Johnson creates some of the first recognisably modern actograms, plotting locomotor activity of wild mice over consecutive days.<sup class="cite"><a href="#ref-24">[24]</a></sup>'
		},
		{
			year: '1960s',
			text: 'Colin Pittendrigh popularises the double-plotted actogram, displaying two consecutive 24-hour cycles side by side on each row — invaluable for revealing free-running rhythms.'
		},
		{
			year: '1930s–60s',
			text: 'Esterline-Angus event recorders enable continuous paper records; actograms were produced by physically cutting and re-aligning paper tapes.'
		},
		{
			year: 'Present',
			text: 'Web-based platforms including AnCiR make actogram generation accessible without any software installation.'
		}
	];
	const _tex1 = String.raw`\text{Row} = \left\lfloor \frac{t_i}{\tau} \right\rfloor, \qquad \text{Position within row} = t_i \bmod \tau`;
	const _tex2 = String.raw`\text{Threshold} = \bar{y} + k\,\text{SD}(y), \qquad \text{Onset}[c] = \min\bigl\{t : y(t) > \text{Threshold},\; t \in c\bigr\}`;
</script>

<ChapterSection id="ch5" num="Chapter 5" title="Actograms">
	<HistoricalContext entries={contextEntries} />

	<p class="chapter-intro">
		Actograms are the <strong>fundamental visualisation tool</strong> of chronobiology. They display
		activity data across multiple days in a stacked format that makes temporal patterns immediately
		visible — periodicity, <a class="gloss" href="#gloss-phase-shift">phase shifts</a>,
		<a class="gloss" href="#gloss-entrainment">entrainment</a>, and
		<a class="gloss" href="#gloss-free-running-period">free-running rhythms</a> all become apparent at
		a glance.
	</p>

	<h3 class="section-head">How an Actogram Works</h3>
	<p>
		Time-series data are "folded" into cycles of the assumed period (typically 24 hours). Each cycle
		occupies one horizontal row, with time on the x-axis and activity on the y-axis. Days are
		stacked top-to-bottom. Vertical bars represent the magnitude of activity at each time point.
	</p>

	<h3 class="section-head">Double-Plotting</h3>
	<p>
		In a <strong>double-plotted actogram</strong>, each row displays two consecutive cycles side by
		side. This is the
		<em>standard format in chronobiology</em>. When the endogenous period is not exactly 24 hours,
		activity onsets drift systematically across rows — rightward for τ > 24 h, leftward for τ &lt;
		24 h — and double-plotting makes this drift easy to see by providing visual continuity.
	</p>

	<h3 class="section-head">What Actograms Reveal</h3>
	<ul>
		<li>
			<strong>Periodicity</strong> — whether a rhythm repeats consistently (e.g. every ~24 hours).
		</li>
		<li>
			<strong>Phase shifts</strong> — changes in the timing of activity onset or offset due to jet lag,
			shifted light-dark cycles, or experimental manipulations.
		</li>
		<li>
			<strong>Entrainment</strong> — stable onset times relative to the zeitgeber indicate successful
			synchronisation.
		</li>
		<li>
			<strong>Free-running rhythms</strong> — in constant conditions (DD or LL), the endogenous period
			is revealed by systematic onset drift.
		</li>
		<li>
			<strong>Arrhythmicity</strong> — absence of rhythmic patterning, seen in clock-mutant animals or
			severe disruption.
		</li>
		<li>
			<strong>Masking</strong> — direct effects of the environment on behaviour that are not mediated
			by the clock (light acutely suppressing activity in a nocturnal rodent, handling or cage-change
			spikes, feeding-driven bouts).
		</li>
	</ul>

	<WarnBox title="Masking can mimic entrainment">
		<p>
			Masking is the commonest reason an actogram misleads: an animal can appear well entrained in a
			light-dark cycle purely through masking while its clock is not entrained at all. This is why
			phase markers taken in LD are unreliable indicators of clock phase, and why the free-running
			period must be measured in
			<strong>constant conditions (DD or LL)</strong>. Activity that starts abruptly exactly at
			lights-off with no anticipation is a hallmark of masking rather than true entrainment.
		</p>
	</WarnBox>

	<h3 class="section-head">Mathematics</h3>
	<h4 class="sub-head">Data Folding</h4>
	<p>
		For timestamps t₁, t₂, …, tₙ and folding period τ, the row number and position within row for
		the i-th data point are:
	</p>
	<Formula tex={_tex1} />

	<h4 class="sub-head">Period Estimation from Onset Times</h4>
	<p>Activity onsets are detected as the first time per cycle that y exceeds a threshold:</p>
	<Formula tex={_tex2} />
	<p>
		Estimate the period by regressing <strong>absolute onset time</strong> (hours since the start of
		the record, not the within-row position) on cycle number;
		<strong>the slope is τ̂ directly</strong>. Equivalently, if you regress the within-row onset
		position from an actogram folded at τ<sub>fold</sub>, then τ̂ = τ<sub>fold</sub> + slope — note
		this is the <em>folding</em> period, not always 24 h. Because the within-row position wraps at
		the row boundary, onset times must be unwrapped (adding τ<sub>fold</sub> at each wrap) before regression.
	</p>
	<p>
		In practice a single noisy bin will trip a bare first-crossing rule. Standard implementations
		require the signal to <strong>remain above threshold for several consecutive bins</strong> and to
		be preceded by a quiet interval. State whether the mean and SD are computed over the whole record
		or per cycle — on a drifting record the two give different onsets — and check onsets that fall close
		to a row boundary by eye.
	</p>

	<h3 class="section-head">Worked Example</h3>
	<p>
		Simulated rodent locomotor activity: 15-minute resolution over 28 days in DD. Days 1–14: τ =
		24.5 h (rightward drift); days 15–28: τ = 22.25 h (leftward drift). Signal: Activity = 50 + 50 ·
		sin(2πt/τ) + Uniform(0,10) noise. The actogram immediately reveals the change at day 14.
		Automated onset detection with threshold = mean + 1·SD, followed by linear regression, yields τ̂
		= 24.52 h for days 1–14 and τ̂ = 22.28 h for days 15–28.
	</p>

	<ActogramAnim height="400px" />

	<AnCiRBox
		title="Creating an Actogram in AnCiR"
		tip="If onset markers seem wrong, adjust the N/M window lengths and the percentile threshold — a higher percentile marks only stronger activity onsets."
	>
		<ol>
			<li>
				Open the <strong>node palette</strong> (the <strong>+</strong> button, top-right) and, under
				<strong>Plots</strong>, choose <strong>actogram</strong>.
			</li>
			<li>
				Wire your <strong>time column</strong> into the plot's <strong>time</strong> input and your
				<strong>values column</strong>
				into the <strong>values</strong> input (drag from the data node's output ports), or pick them
				from the node's dropdowns.
			</li>
			<li>
				Set the <strong>Period</strong> (default: 24 h) — this sets how many hours fit in each horizontal
				row.
			</li>
			<li>
				Set the <strong>Start Time</strong> using the date-and-time picker — the date and clock time at
				which the first row begins.
			</li>
			<li>
				Set <strong>Repeat</strong> to 2 for a <strong>double-plotted</strong> actogram (two consecutive
				cycles per row — the standard chronobiology format); it defaults to 2. Set it to 1 for a single
				plot.
			</li>
			<li>
				<strong>Light/dark shading:</strong> add one or more shading <strong>bands</strong>
				with the <strong>+</strong> button; each band takes a percentage of the period and a colour. For
				a 12:12 LD cycle, add two bands at 50% each.
			</li>
			<li>
				<strong>Onset/offset markers:</strong> enable to draw a marker at activity onset or offset
				each day. The detector is a template match with three controls — <strong>N</strong> (hours
				before), <strong>M</strong> (hours after) and a <strong>%</strong> (percentile) threshold — not
				a mean + SD cutoff.
			</li>
			<li>
				<strong>Marker rules:</strong> with several animals on one actogram, add a
				<strong>rule</strong> under <strong>Marker rules</strong> at the top of the Data tab instead
				of one block per series. A rule applies the same markers and line to every series (every
				panel when faceted) and lists each series' fitted τ, φ, R², RMSE and marker count. Its
				<strong>min and max day</strong> set which days are fitted on every series, and each series
				can still untick its own days. φ is reported in hours after the row start, at the range's
				first day unless you set a φ day. Changing a setting under one series (or dragging its line,
				or correcting one of its onsets) <strong>detaches</strong> that series with its own copy;
				<strong>Reattach to rule</strong> undoes that, and <strong>Make rule</strong> on a series' own
				block turns it into a rule for all series.
			</li>
			<li>
				<strong>Wiring the results:</strong> each rule adds five <strong>output ports</strong> to
				the actogram node, named after the rule (for a rule called Onsets: <em>Onsets τ (h)</em>,
				<em>Onsets φ (h)</em>, <em>Onsets R²</em>, <em>Onsets RMSE (h)</em> and <em>Onsets n</em>),
				each a column with one value per series. Wire τ into <strong>Describe Data</strong> for the
				mean period across animals, or φ into a <strong>Rayleigh test</strong>. τ is the harmonic
				check's pick: the fitted slope, unless the data clearly support half or twice it (half only
				when the two halves of each cycle look alike, so two unequal daily bouts or one short bout
				keep the slope; twice only when alternate cycles differ). R² is the share of the spread in
				onset time of day that the line's drift explains, so an entrained animal with no drift
				scores near 0 however tight its onsets are; read RMSE for that. Renaming the rule relabels
				the ports and keeps the wires; deleting it removes them, and undo brings them back. Marker
				blocks no longer publish Stored Values: in an older session, a formula that used one keeps
				its saved number, and <strong>Make rule</strong> on that block makes it live again.
			</li>
			<li>
				Resize the plot by dragging its corners, and export it as <strong>PNG or SVG</strong>
				from the plot's controls.
			</li>
		</ol>
		<DemoLink
			session="sessions/demos/demo-actogram-rhythm.json"
			label="Open the Actogram example in AnCiR"
		/>
	</AnCiRBox>
	<ChapterExamples chapter="ch5" />
</ChapterSection>
