<script>
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import NoteBox from '$lib/components/NoteBox.svelte';
	import WarnBox from '$lib/components/WarnBox.svelte';
	import MethodTable from '$lib/components/MethodTable.svelte';
	import DemoLink from '$lib/components/DemoLink.svelte';

	// Colour by and Size by (AnCiR v82.36 to v82.45; colour-by plan 2026-10-20). Every claim
	// below is read from the app: the panel words from plotbits/Encoding.svelte and
	// SizeBy.svelte, the modes from plotbits/encodings.js, the maps from plotbits/colormaps.js.
	const modeHeaders = ['Read as', 'What each point gets', 'Default colours', 'Size by?'];
	const modeRows = [
		['<strong>Value</strong>', 'The number in the cell.', 'Viridis', 'Yes'],
		[
			'<strong>Hour of day</strong>',
			'The clock time of a time column, 0 to 24&nbsp;h, in that column&rsquo;s own time zone (set at import or in the column&rsquo;s Properties; a column with no zone reads its times as written). <strong>Show times in</strong> under <strong>Settings</strong> only relabels times, so it never moves a colour. The scale is fixed at 0 to 24&nbsp;h and wraps at midnight.',
			'Twilight (cyclic)',
			'No: a cycle has no larger end (23:59 would be drawn largest beside a smallest 00:00)'
		],
		[
			'<strong>Day of year</strong>',
			'1 to 366, by the calendar date in the same time zone.',
			'Viridis',
			'Yes'
		],
		[
			'<strong>Days since start</strong>',
			'Days after the column&rsquo;s earliest value. A number column is read as hours.',
			'Viridis',
			'Yes'
		],
		[
			'<strong>Category</strong>',
			'The label in the cell: each category is its own colour, the same one it has in box plots. The only mode of a text or category column; offered last for a plain number column (an animal or colony id).',
			'The session&rsquo;s category colours',
			'No: a category has no larger end'
		]
	];
</script>

<ChapterSection
	id="colour-by"
	num="Plotting"
	title="Colour by and Size by: a Third Variable on a Plot"
>
	<p class="chapter-intro">
		A scatterplot shows one column against another. <strong>Colour by</strong> and
		<strong>Size by</strong> add a third and a fourth: each point takes its colour, or its size, from
		the same row of another column. The points stay where they are; what changes is how much each one
		tells you.
	</p>

	<h3 class="section-head">When to use it</h3>
	<ul>
		<li>
			<strong>Hysteresis loops.</strong> Plot hive temperature against air temperature and the
			points trace a loop each day, because the hive lags the air by a few hours. Colour the points
			(and the line) by the <strong>hour of day</strong> of the shared time column and you can see
			which part of the loop belongs to which time of day, and which way round it runs. Put the two
			recordings on one clock first (Join Data, then Bin Data; see
			<a href="#ch4">Chapter 4</a>).
		</li>
		<li>
			<strong>Drift over a season.</strong> Colour the same loop by <strong>day of year</strong> or
			<strong>days since start</strong> to see whether it moves or changes shape over weeks.
		</li>
		<li>
			<strong>A third variable.</strong> Activity against temperature, coloured by light level; a fitted
			residual against time, coloured by the animal&rsquo;s age.
		</li>
		<li>
			<strong>Groups.</strong> Colour points by a category or group label (colony, treatment, genotype),
			each group in its own colour.
		</li>
		<li>
			<strong>A fourth variable.</strong> Size by adds another column on top of colour, for example humidity
			or a count, with each point&rsquo;s area growing with its value.
		</li>
	</ul>

	<AnCiRBox title="Colour by and Size by in AnCiR">
		<ol>
			<li>
				Select the plot and open the <strong>Data</strong> tab. Every series has a
				<strong>Colour by</strong> switch, and below it a <strong>Size by</strong> switch.
			</li>
			<li>
				Tick <strong>Colour by</strong>. A <strong>colour</strong> port appears on the plot node on
				the canvas, beside the series&rsquo; own inputs. Wire a column into it, or pick one under
				<strong>Column</strong> in the panel. Either way the column is wired like any other input, so
				it updates when the data upstream changes.
			</li>
			<li>
				Choose how the column is read under <strong>Read as</strong> (the table below).
				<strong>Automatic</strong> reads a time column as the hour of day and a number column as its
				value. Choose the scale under <strong>Colours</strong>.
			</li>
			<li>
				For a line, tick <strong>Colour the line too</strong>; otherwise the line keeps the series
				colour.
			</li>
			<li>
				Size by works the same way, with a <strong>size</strong> port,
				<strong>Size read as</strong>, the <strong>Smallest (px)</strong> and
				<strong>Largest (px)</strong>
				point (2 and 10 px to start), and an optional <strong>Size from</strong> /
				<strong>Size to</strong> range.
			</li>
		</ol>
		<DemoLink
			session="sessions/demos/demo-workflow-colour-by-hysteresis.json"
			label="Open the hysteresis loop example in AnCiR"
		/>
	</AnCiRBox>

	<p>
		The example joins a synthetic air and hive record, bins both onto hours, and plots hive against
		air: the points and line are coloured by the hour of day and sized by the air&rsquo;s humidity.
		A logger outage on day 3 leaves blank hours, and the line breaks there instead of drawing across
		the gap.
	</p>

	<h3 class="section-head">Reading a column: the modes</h3>
	<MethodTable headers={modeHeaders} rows={modeRows} />
	<p>
		A time column offers hour of day, day of year and days since start. A plain number column offers
		its value, days since start and category, and hour of day only as &ldquo;hours since start,
		wrapped at 24 h&rdquo; (the panel says so), because it has no clock. A binned column that counts
		hours from a known start time has a clock, so it offers the first four. A text or category
		column is read as categories.
	</p>

	<h3 class="section-head">Colour scales and range</h3>
	<ul>
		<li>
			<strong>Hour of day</strong> uses a <strong>cyclic</strong> scale, Twilight (or its grey twin):
			dark at midnight, light at noon, and the same colour at both ends. Midnight is not an edge, so 23:30
			and 00:30 look alike and a loop drawn across midnight shows no false break. A sequential scale would
			put them at opposite ends.
		</li>
		<li>
			For everything else, choose a sequential scale (<strong>Viridis</strong>,
			<strong>Magma</strong>, <strong>Greys</strong>) or the diverging
			<strong>Blue&ndash;White&ndash;Red</strong> for a signed value centred on a midpoint (set the range
			symmetric about it).
		</li>
		<li>
			The <strong>range</strong> is the full data range of every series on the plot coloured by the
			same column read the same way, so two series share one scale, and zooming in does not recolour
			anything. Set <strong>Min</strong> and <strong>Max</strong> to fix either end; values beyond it
			take the end colour and the colour bar labels that end &ldquo;&le;&rdquo; or &ldquo;&ge;&rdquo;.
			The reset button returns to the data range. Hour of day is always 0 to 24 h.
		</li>
		<li>
			<strong>Category</strong> uses the session&rsquo;s category colours, the ones box plots use,
			so a label has one colour everywhere; change them under <strong>Category colours</strong> in the
			panel. A category has no range. The key lists one swatch per category, by name. A column with more
			categories than the palette has colours is not coloured at all, and the panel says so: pick a column
			with fewer categories.
		</li>
		<li>
			Points are drawn in 64 colour steps, which is finer than the eye separates on a scale and
			keeps a plot of hundreds of thousands of points fast.
		</li>
	</ul>

	<h3 class="section-head">Coloured lines</h3>
	<p>
		With <strong>Colour the line too</strong> on, each segment between two consecutive rows takes
		the colour of its <strong>starting</strong> point. The segment from 23:50 to 00:10 is coloured by
		23:50, which on a cyclic scale is almost the colour of 00:10, so a loop has no seam at midnight. A
		coloured line is drawn solid; a dashed line gets its dashes back when colouring is switched off.
	</p>
	<p>
		A coloured line breaks exactly where the plain line does. A row with a missing x or y draws no
		segment to or from it, unless the series&rsquo; <strong>Join gaps</strong> is on, which bridges to
		the next valid row as it always does. There is no time-gap rule: two valid rows three days apart are
		joined. To show an outage as a break, bin the data first, so the missing hours become empty rows.
		Where a loop crosses itself, the segment with the higher colour value is drawn on top, not the later
		one.
	</p>

	<h3 class="section-head">Missing values</h3>
	<p>
		Nothing is hidden. A point with no colour value is still drawn, in the series colour, and the
		colour bar adds a <strong>no value</strong> swatch; the panel says how many points (and line segments)
		that is. A point with no size value is drawn at the series&rsquo; own point size, and the size key
		lists it. If the colour or size column is shorter than the series, the panel says so and the rows
		beyond its end have no value.
	</p>

	<h3 class="section-head">The colour bar and the size key</h3>
	<p>
		The <strong>colour bar</strong> is titled with the column and how it is read, for example
		&ldquo;Hour of day (UTC)&rdquo;, so the time zone is on the figure. The
		<strong>size key</strong>
		shows three reference points, at the low end, the middle and the high end of the range, in the series&rsquo;
		marker shape. Both are placed with the legend: beside the plot (stacked under the legend) or in a
		corner, clear of the legend. While a series is coloured its legend swatch is a neutral grey, because
		its colour is on the bar. On a small plot the bar keeps its labels readable: it shows every second
		label (for hour of day, 0, 12 and 24), or just the ends, shortens a long title with an ellipsis (the
		full title shows on hover), and moves the size key beside the bar rather than squeeze it.
	</p>

	<h3 class="section-head">Monochrome, facets and export</h3>
	<ul>
		<li>
			<strong>Monochrome (print-safe)</strong>, in the figure style, draws every colour scale in
			greys (hour of day in a cyclic grey; categories in distinct greys, as box plots are). Your
			chosen scale is kept and returns when monochrome is off. A cyclic grey shows 6:00 and 18:00
			alike, so in monochrome the loop&rsquo;s direction has to come from the line. Sizes are
			unchanged.
		</li>
		<li>
			A faceted plot (<strong>One plot per series</strong>) shares one colour scale and one size
			scale across all its panels, so a colour or a size means the same value in every panel.
		</li>
		<li>
			Downloading a scatterplot&rsquo;s data adds a <code>c_</code> column (the value each point is
			coloured by, such as its hour) and an <code>s_</code> column (the value it is sized by) beside
			its <code>x_</code> and <code>y_</code> columns.
		</li>
		<li>
			<strong>Export session as Python</strong> redraws a scatterplot with the same colours, point sizes,
			coloured line, colour bar and size key as the app. Q-Q, Mean &plusmn; SEM and Circular phase plots
			are not drawn by the Python export yet.
		</li>
	</ul>

	<h3 class="section-head">Which plots have it, and why not the others</h3>
	<ul>
		<li><strong>Scatterplot</strong>: points and the line.</li>
		<li>
			<strong>Q-Q plot</strong>: points. The values are sorted to plot them, and each point keeps
			its own row&rsquo;s colour and size through the sort.
		</li>
		<li>
			<strong>Mean &plusmn; SEM</strong>: each mean is coloured and sized by the mean of the column
			over the rows in its group (the circular mean for hour of day, so a group either side of
			midnight is not coloured as noon). In Category mode a mean takes its group&rsquo;s label when
			all its rows share one, and is drawn as &ldquo;no value&rdquo; when they mix. The connecting
			line can be coloured; the error bars keep the series colour.
		</li>
		<li>
			<strong>Circular phase</strong>: the dots, in every placement. Wedges and mean vectors keep
			the series colour, and the colour bar sits beside the clock.
		</li>
	</ul>
	<p>
		<strong>Periodogram</strong>, <strong>FFT</strong> and <strong>Correlogram</strong> do not offer
		it: their points are computed values (a period, a frequency, a lag), not rows of your data, so
		there is no row to read a colour from. <strong>Box plots</strong>, histograms and actogram bars
		summarise many rows in one mark; a box plot colours its boxes by category instead (<strong
			>Box colours</strong
		>), with the same colours Category mode uses.
	</p>

	<WarnBox title="Do Not Rely on Colour Alone">
		<p>
			Some readers cannot tell some colours apart, and a figure printed or photocopied in greys
			loses hue entirely. Keep every encoded value readable another way. AnCiR helps: on a
			scatterplot or a circular phase plot, hovering a point shows its colour and size values in the
			tooltip; the colour bar and size key carry numbers; the data download carries the <code
				>c_</code
			>
			and <code>s_</code> columns; and a coloured line shows the order of the points. A
			point&rsquo;s <strong>area</strong>, not its radius, grows in step with its value between the
			smallest and largest size, so large values are not exaggerated, and no point is drawn smaller
			than 1 px. Say in the figure legend what the colour and the size mean.
		</p>
	</WarnBox>

	<NoteBox title="Key Point">
		<p>
			Colour by and Size by change how points are drawn, never where. They read each point&rsquo;s
			own row, keep points with no value visible, and share one scale across series and facet
			panels, so the same colour always means the same value on one figure.
		</p>
	</NoteBox>
</ChapterSection>
