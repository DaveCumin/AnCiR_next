<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
</script>

<script>
	let { showModal = $bindable(false) } = $props();
</script>

<Modal bind:showModal width="80vw" max_height="80vh">
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
			This version is written in Svelte with huge input from <a href="https://github.com/yz-329"
				>yz-329</a
			>.
		</p>

		<p>
			Please feel free to send any bug reports, feature requests, or offers of support to <a
				href="mailto:d.cumin@auckland.ac.nz?subject=AnCiR">d.cumin@auckland.ac.nz</a
			>
		</p>

		The following packages were used in this project:
		<ul>
			<li>
				<a href="https://svelte.dev/">Svelte</a> is used as the framework/library/compiler of the code.
			</li>
			<li>
				<a href="https://d3js.org/">D3</a> is used for plotting (ISC licenced).
			</li>
			<li>
				<a href="https://www.papaparse.com/">Papaparse</a> is used for importing the data (MIT licenced).
			</li>
			<li>
				<a href="https://www.npmjs.com/package/moment-guess">Moment-guess</a>
				was adapted to guess the time format of data (MIT licenced).
			</li>

			<li>
				<a href="https://github.com/ytliu0/p-value_calculators/blob/master/statFunctions.js"
					>Stats functions from</a
				> <a href="https://github.com/ytliu0">@ytliu0</a> (GPL-3.0 licensed).
			</li>
			<li>
				<a href="https://www.npmjs.com/package/luxon">Luxon</a> is used for date manipulation and caluclations
				(MIT licenced).
			</li>
		</ul>
		<p>
			As such, the code is ISC licenced. Permission to use, copy, modify, and/or distribute this
			software for any purpose with or without fee is hereby granted, provided that the above
			copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS
			IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
			WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
			SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
			LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
			ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
		</p>
	{/snippet}
</Modal>
