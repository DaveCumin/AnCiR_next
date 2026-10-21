<script>
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import NoteBox from '$lib/components/NoteBox.svelte';
	import WarnBox from '$lib/components/WarnBox.svelte';
	import MethodTable from '$lib/components/MethodTable.svelte';

	// Per-column time zone (AnCiR v82.54 to v82.56; plan ClaudeNotes/AnCiR/
	// 2026-10-20-per-column-timezone-plan.md). Every claim below is read from the app: the picker
	// from components/inputs/TimeZoneSelect.svelte, the import hints from
	// components/views/modals/ImportData.svelte, the repeated and skipped hour rules from
	// utils/time/zones.js (resolveWallClocks) and core/columnWarnings.js, the notes from
	// utils/time/dstNotes.js and utils/time/zoneNotes.js, Settings from
	// components/views/modals/Settings.svelte.
	const kindHeaders = ['Zone', 'What it means', 'Use it for'];
	const kindRows = [
		[
			'<strong>As written (no zone, UTC)</strong>, the default',
			'The times are kept exactly as the file wrote them and read as UTC. There is no daylight saving.',
			'One recording on one clock, with nothing to line up against it.'
		],
		[
			'<strong>Time zone (follows daylight saving)</strong>, for example Pacific/Auckland',
			'The clock moves by an hour (in a few places, 30 minutes) when daylight saving starts and ends, as that place does.',
			'Loggers, phones and computers that change their clock for daylight saving.'
		],
		[
			'<strong>Fixed offset (no daylight saving)</strong>, for example UTC+12:00',
			'Always the same number of hours ahead of or behind UTC.',
			'Loggers that stay on standard time all year. Many data loggers do.'
		]
	];

	const dstHeaders = ['Change', 'What happens to the clock', 'How AnCiR reads it'];
	const dstRows = [
		[
			'<strong>Daylight saving ends</strong> (autumn)',
			'The clock goes back an hour, so one hour happens twice. In Pacific/Auckland, 02:00 to 02:59 on the first Sunday in April.',
			'Times in order that step back into that hour once: the first pass is daylight-saving time, the second standard time. Otherwise (sorted, shuffled, or the hour passed only once) every repeated time is read as the earlier, daylight-saving time, and the column warns.'
		],
		[
			'<strong>Daylight saving starts</strong> (spring)',
			'The clock jumps forward an hour, so one hour never happens. In Pacific/Auckland, 02:00 to 02:59 on the last Sunday in September.',
			'A time inside the missing hour does not exist there. It is moved forward by the change (02:30 reads 03:30 after a 1&nbsp;h change), never blanked, and the column warns.'
		]
	];
</script>

<ChapterSection id="time-zones" num="Data" title="Time zones and daylight saving">
	<p class="chapter-intro">
		Every time column in AnCiR has its own <strong>time zone</strong>: where the clock that wrote
		the times was. AnCiR uses it to turn the times into real moments, and to read each time on the
		clock (the time of day, the date). Two recordings in different zones then line up by themselves.
		How times are <em>shown</em> is a separate choice in Settings, and it never changes a result.
	</p>

	<h3 class="section-head">Three kinds of zone</h3>
	<MethodTable headers={kindHeaders} rows={kindRows} />
	<p>
		If you do not know, leave a column <strong>As written</strong>. Every time then shows exactly as
		the file wrote it, and nothing moves. You need a real zone when a recording crosses a
		daylight-saving change and you want elapsed time to be exact, or when you join recordings made
		on different clocks.
	</p>

	<WarnBox title="Fixed offset or zone?">
		<p>
			Pick the zone a logger&rsquo;s clock actually followed. A logger left on New Zealand standard
			time all year is <strong>UTC+12:00</strong>, not Pacific/Auckland. Choosing Pacific/Auckland
			for it would move half the year by an hour. If you are not sure, look at the file around a
			daylight-saving change: a clock that follows daylight saving skips an hour in spring and
			repeats one in autumn. AnCiR looks for this when you import (below).
		</p>
	</WarnBox>

	<h3 class="section-head">What a zone does to the times</h3>
	<ul>
		<li>
			<strong>Times written with no offset</strong> (most logger files, such as
			<code>2024-04-01 13:00</code>): the times stay as written. The zone says which real moments
			they are. Read as Pacific/Auckland time they are 12 or 13&nbsp;h earlier than the same text in
			a UTC column, so elapsed time across a daylight-saving change is exact and the column lines up
			with columns in other zones.
		</li>
		<li>
			<strong>Times that carry an offset</strong> (<code>2024-04-01T13:00+13:00</code> or
			<code>&hellip;Z</code>) <strong>and plain numbers</strong> (milliseconds since 1970): the moments
			are already fixed. The zone only says which clock to read them on.
		</li>
		<li>
			Changing a column&rsquo;s zone re-reads it, and everything downstream recomputes. It is one
			undo step.
		</li>
	</ul>

	<AnCiRBox title="Setting a column's zone in AnCiR">
		<ol>
			<li>
				<strong>When you import.</strong> In the import dialog each time column has a time zone
				picker beside its time format. It offers <strong>As written (no zone, UTC)</strong>, your
				computer&rsquo;s zone (marked &ldquo;this computer&rdquo;), the
				<strong>Fixed offset (no daylight saving)</strong> list and the
				<strong>Time zone (follows daylight saving)</strong> list. If the times carry offsets, AnCiR suggests
				the matching zone and lists the offsets it found. The summary line says which zone the times are
				shown in.
			</li>
			<li>
				<strong>Later.</strong> Select the column and open its <strong>Properties</strong>. The
				<strong>Time zone</strong> row has the same picker, and a note says what the zone does, for example
				&ldquo;Times stay as written. Read as Pacific/Auckland time, they are 12 to 13 h earlier than
				the same times in a UTC column.&rdquo;
			</li>
			<li>
				<strong>Outputs inherit.</strong> A column made by a node (Bin Data, Join Data, a fit) takes the
				zone of the node&rsquo;s time input. Its Properties show the zone read-only, with the column it
				comes from. Change the zone at the source and every output follows.
			</li>
		</ol>
	</AnCiRBox>

	<h3 class="section-head">Hints when you import</h3>
	<p>
		AnCiR never sets a zone by itself. When it sees something, it says what and offers one button.
	</p>
	<ul>
		<li>
			<strong>The times look like daylight saving.</strong> A column left as written, sampled at a
			regular interval, whose clock skips or steps back exactly at a daylight-saving change of your
			computer&rsquo;s zone: &ldquo;These times look like they follow daylight saving in
			Pacific/Auckland: the clock steps back an hour at the change on 7 Apr 2024. Set the
			zone?&rdquo; with a <strong>Use Pacific/Auckland</strong> button.
		</li>
		<li>
			<strong>The times do not look like daylight saving.</strong> A column set to a zone that
			follows daylight saving, whose times run straight through a change: &ldquo;&hellip;so the
			logger may not follow daylight saving. Try a fixed offset?&rdquo; with a button for the
			zone&rsquo;s standard time, such as <strong>Use UTC+12:00</strong>.
		</li>
		<li>
			<strong>Other columns already have a zone.</strong> You import a column as written into a session
			whose time columns are in a zone: &ldquo;Other time columns in this session are in Pacific/Auckland.
			Are the times in &lsquo;DateTime&rsquo; in that zone too?&rdquo; The prompt goes once you pick any
			zone for the column, UTC included.
		</li>
	</ul>

	<h3 class="section-head">The repeated hour and the skipped hour</h3>
	<p>
		These rules apply to times written with no offset in a zone that follows daylight saving. Times
		with an offset, and fixed offsets, have no such hours.
	</p>
	<MethodTable headers={dstHeaders} rows={dstRows} />
	<p>
		A repeated hour read in order is what a logger that follows daylight saving writes, so it is not
		a warning; the column&rsquo;s Properties say how it was read. A warning shows on the
		column&rsquo;s data node (hover it) and in its Properties, with a count, and ends with
		&ldquo;This logger may not follow daylight saving: try a fixed offset.&rdquo; That is usually
		the cause. A zone the browser does not know (from a session made elsewhere) is read as written,
		UTC, with a warning too.
	</p>

	<h3 class="section-head">Clock readings use the column&rsquo;s zone</h3>
	<p>
		Everything that asks for a time of day reads it in the time column&rsquo;s own zone, never in
		the Settings choice.
	</p>
	<ul>
		<li>
			<strong>Actogram</strong> (<a href="#ch5">Chapter 5</a>). Days start at midnight in the first
			series&rsquo; zone, and the Time panel says so (&ldquo;Days start at midnight
			Pacific/Auckland.&rdquo;). Rows stay 24&nbsp;h of elapsed time, so after a daylight-saving
			change they start at 01:00 or 23:00 local time; the panel says that too. If the series are in
			different zones, the rows follow the first series&rsquo; zone, with a note.
		</li>
		<li>
			<strong>Clock phase</strong> (<a href="#ch7">Chapter 7</a>). With
			<strong>Phase reference</strong> set to <strong>Clock time of day</strong>, Cosinor, the other
			fits, Average profile, the nonparametric measures and Moving Analysis report hours after local
			midnight in the x column&rsquo;s zone. If the record crosses a daylight-saving change, the
			first sample&rsquo;s offset is used for the whole record and the node warns that later phases
			read an hour off the local clock. Moving Analysis gives each window the offset in force at its
			centre.
		</li>
		<li>
			<strong>Hour of day and day of year</strong> in
			<a href="#colour-by">Colour by and Size by</a>. The colour bar names the zone, for example
			&ldquo;Hour of day (Pacific/Auckland)&rdquo;.
		</li>
		<li>
			<strong>Circular phase plot</strong> (<a href="#ch12">Chapter 12</a>). A timed series is
			placed by its clock time in its column&rsquo;s zone.
		</li>
		<li>
			<strong>Bin Data.</strong> The <strong>Bin start</strong> field (labelled with the zone) reads and
			writes in the column&rsquo;s zone. Bins are elapsed time, so daily bins after a daylight-saving
			change start an hour off local midnight, and the node says so.
		</li>
		<li>
			<strong>Scatterplot time axis.</strong> Shown in the first series&rsquo; zone, with a note when
			the series are in different zones.
		</li>
	</ul>

	<h3 class="section-head">Joining recordings from different zones</h3>
	<p>
		Give each time column its zone, then join them with <strong>Join Data</strong> (<a href="#ch4"
			>Chapter 4</a
		>). The times line up by themselves, across a daylight-saving change too: no shift is needed.
		The joined time column takes A&rsquo;s zone, and the summary names it.
		<strong>Shift B&rsquo;s clock by (h)</strong> is for a clock that was simply wrong. A shift set between
		columns in different zones would correct twice, so the node warns. If one side has no zone, the node
		says its times are read as UTC and suggests setting its zone.
	</p>

	<h3 class="section-head">Show times in (Settings)</h3>
	<p>
		<strong>Show times in</strong>, under <strong>Settings</strong>, is either
		<strong>Each column&rsquo;s own zone</strong> (the default) or one zone for every time. It changes
		labels only: axes, tables, tooltips and date fields. Results such as actogram days, clock phases and
		hour-of-day colours do not change. Use it to read a session in your own zone without touching the
		data.
	</p>

	<h3 class="section-head">Sessions saved before per-column zones</h3>
	<p>
		Older sessions had one <strong>Timezone</strong> setting for everything. A session saved with a
		zone there keeps its old behaviour when you open it: every time is shown in that zone, and
		actogram day starts and clock phases use it, so no result moves. Settings shows a notice with a
		<strong>Switch to each column&rsquo;s own zone</strong> button and a ticked box,
		<strong>Also mark time columns without a zone as</strong> that zone (the usual intent). After
		the switch, times show in their own column&rsquo;s zone; with the box ticked, those columns are
		read as that zone&rsquo;s time, still shown as written. Actogram day starts and clock phases can
		move. Undo reverses it. Until then, <strong>Show times in</strong> is unavailable.
	</p>

	<NoteBox title="Key Point">
		<p>
			Set each time column&rsquo;s zone to where its clock was: a named zone if the clock followed
			daylight saving, a fixed offset if it did not, or leave it as written. Clock readings follow
			the column&rsquo;s zone. <strong>Show times in</strong> only changes the labels.
		</p>
	</NoteBox>
</ChapterSection>
