<script>
	import ChapterSection from '$lib/components/ChapterSection.svelte';
	import AnCiRBox from '$lib/components/AnCiRBox.svelte';
	import ParamTable from '$lib/components/ParamTable.svelte';
	import WiringDiagram from '$lib/animations/WiringDiagram.svelte';
</script>

<ChapterSection id="ancir-start" num="Quick Start" title="AnCiR Quick Start">
	<p>
		AnCiR (Analysis of Chronobiological Rhythms) runs entirely in the browser at
		<a href="https://ancir.pages.dev" target="_blank">ancir.pages.dev</a>. No installation, no
		account, no programming required.
	</p>

	<AnCiRBox title="First steps in AnCiR">
		<ol>
			<li>
				Open <strong>ancir.pages.dev</strong> in any modern browser (Chrome, Firefox, Edge, Safari).
				A new session opens on the <strong>Start a session</strong> screen: import data, load a
				session, or pick one of the <strong>Example sessions</strong>. Close it to reach the
				<strong>workflow canvas</strong>.
			</li>
			<li>
				To explore without your own data: pick an example on the start screen, or click the
				<strong>Load a session</strong> icon on the toolbar down the left edge and choose the
				<strong>Examples</strong> tab.
			</li>
			<li>
				To import your own data: open the <strong>node palette</strong> (the <strong>+</strong>
				button at the top-right of the canvas, tooltip <em>Add to canvas</em>), and under
				<strong>Sources</strong>
				choose <strong>Import file</strong>, or drag a CSV, Excel (.xlsx) or AWD file onto the
				canvas.
			</li>
			<li>
				Each step is a <strong>node</strong>. Connect nodes by dragging from one node's
				<strong>output port</strong>
				to the next node's <strong>input port</strong>. Hover over a port to see what it takes or
				gives. <strong>Double-click</strong> a node to open its settings in the control panel on the
				right; the <strong>Collapse</strong> / <strong>Expand</strong> button on the node card switches
				it between the full and the compact view.
			</li>
			<li>
				The general workflow is: a <strong>Source</strong> (your data) → <strong>processes</strong>
				(clean / transform) → a <strong>Plot</strong> or <strong>fit</strong>, all added from the
				palette and wired together.
			</li>
			<li>
				Save your work with the <strong>Save this session</strong> icon on the left toolbar; it
				produces a session file (<code>.json</code>) you can reload later with
				<strong>Load a session</strong> or by dropping it onto the canvas. Session files named
				<code>.ancir</code> open the same way.
			</li>
			<li>
				Undo/redo with the <strong>Undo</strong> / <strong>Redo</strong> buttons on the left toolbar
				(under the session buttons) or <strong>Cmd+Z / Cmd+Shift+Z</strong> (Mac) /
				<strong>Ctrl+Z / Ctrl+Shift+Z</strong> (Windows). Undo covers settings too: each edit in a node's
				or plot's control panel is one undo step.
			</li>
		</ol>
	</AnCiRBox>

	<h3 class="section-head">Core concepts</h3>
	<ParamTable
		headers={['Concept', 'What it is']}
		rows={[
			[
				'<strong>Node &amp; canvas</strong>',
				'Every analysis lives on the workflow canvas as a chain of nodes you add from the palette (the + button) and wire together. Change a setting early in the chain and every downstream plot updates.'
			],
			[
				'<strong>Process</strong>',
				'A node that cleans or transforms your data on the way through (Remove Outliers, Remove Trend, Bin Data, Smooth Data, Normalize, Cosinor, and so on). Processes are non-destructive: your original data is always preserved, so you can change or remove a step at any time.'
			],
			[
				'<strong>Plot</strong>',
				'Visualises data from columns (Actogram, Scatterplot, Periodogram, Correlogram, Fourier analysis, Boxplot, Table).'
			],
			[
				'<strong>Stored Values</strong>',
				'Single numbers produced by analyses (e.g., fitted period, amplitude). Each is registered automatically under a default name and belongs to its node; type # in a Formula Column to use one, and click the pencil icon beside it to rename it.'
			]
		]}
	/>

	<h3 class="section-head">Wiring nodes together</h3>
	<p>
		An analysis in AnCiR is just nodes joined into a chain. Every node has an
		<strong>output port</strong> on its right and (except for Sources) an
		<strong>input port</strong> on its left. To connect two nodes, drag from the output port of one to
		the input port of the next (or click the output port, then the input port); a wire appears, and the
		data flows along it from left to right. Hovering over a port shows a short description of what it
		takes or gives.
	</p>

	<WiringDiagram height="210px" />

	<p>
		You build a whole workflow this way, one wire at a time: a
		<strong>Source</strong> feeds a <strong>Process</strong> or two, which feed a
		<strong>Plot</strong> or a <strong>fit</strong>. Because the wires carry live data, changing a
		setting early in the chain re-runs everything downstream, so you can experiment freely. To
		remove a connection, click the wire and press <strong>Delete</strong>, or
		<strong>Shift+click</strong> the input port; the nodes stay put.
	</p>

	<p>
		Wiring also works from the keyboard. Tab to an output port and press <strong>Enter</strong> (or
		<strong>Space</strong>) to start a wire; <strong>Tab</strong> or the arrow keys move between the
		inputs it can connect to, <strong>Enter</strong> connects and <strong>Escape</strong> cancels.
		On a focused input port, <strong>Enter</strong> opens its column list and
		<strong>Delete</strong>
		removes its wires.
	</p>

	<AnCiRBox title="See it done for you">
		<p>
			The quickest way to get the feel of wiring is AnCiR's built-in walkthrough. Open <a
				href="https://ancir.pages.dev"
				target="_blank"
				rel="noopener">ancir.pages.dev</a
			>, then click the <strong>?</strong> (<em>Help</em>) button at the bottom of the left toolbar
			&rarr;
			<strong>&ldquo;Take a tour&hellip;&rdquo;</strong> and pick
			<strong>Getting started</strong>. It walks you through adding a Source, wiring on a Plot, and
			reading the result, step by step on the real canvas.
		</p>
	</AnCiRBox>
</ChapterSection>
