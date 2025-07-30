<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
</script>

<script>
	let { showModal = $bindable(false) } = $props();
</script>

<Modal bind:showModal width="63vw" max_height="80vh">
	{#snippet header()}
		<div class="heading">
			<h2>About</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<h3>Analysis of Circadian Rhythms (AnCiR) v4.0.0</h3>

		<p>
			This is our 'AnCiR' to the need for a simple-to-use (GUI; no coding) tool for analysis of
			circadian rhythms.
		</p>

		<p>
			This version is written in <a href="https://svelte.dev/">Svelte</a> by
			<a href="https://github.com/davecumin">DaveCumin</a>
			and <a href="https://github.com/yz-329">yz-329</a>. The
			<a href="https://github.com/DaveCumin/ancir_svelte">previous</a>
			version was also written in Svelte, and the
			<a href="https://github.com/DaveCumin/AnCiR">version before that</a> was written in Javascript
			without Svelte.
		</p>
		<p>
			<strong
				>Please feel free to send any bug reports, feature requests, or offers of support to <a
					href="mailto:d.cumin@auckland.ac.nz?subject=AnCiR">d.cumin@auckland.ac.nz</a
				></strong
			>
		</p>

		The following packages were used in this project:
		<ul>
			<li>
				<a href="https://d3js.org/">D3</a> is used for plotting (ISC licensed).
			</li>
			<li>
				<a href="https://www.papaparse.com/">Papaparse</a> is used for importing the data (MIT licensed).
			</li>
			<li>
				<a href="https://www.npmjs.com/package/moment-guess">Moment-guess</a>
				was adapted to guess the time format of data (MIT licensed).
			</li>

			<li>
				<a href="https://github.com/ytliu0/p-value_calculators/blob/master/statFunctions.js"
					>Stats functions from</a
				> <a href="https://github.com/ytliu0">@ytliu0</a> (GPL-3.0 licensed).
			</li>
			<li>
				<a href="https://www.npmjs.com/package/luxon">Luxon</a> is used for date manipulation and caluclations
				(MIT licensed).
			</li>
		</ul>
		<p>
			Default colours for the plots are taken from the <a
				href="https://www.fabiocrameri.ch/colourmaps/">maps designed and curated by Fabio Crameri</a
			> (MIT licensed).
		</p>
		<p>
			As such, this software is licensed under the stricter of the above - the GPL-3.0 license (<a
				href="http://fsf.org/">http://fsf.org/</a
			>).
		</p>
	{/snippet}
</Modal>
