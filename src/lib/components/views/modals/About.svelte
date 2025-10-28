<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { appConsts } from '$lib/core/core.svelte';
	import { tick } from 'svelte';
	import { buildInfo } from '$lib/utils/build-info.js';
</script>

<script>
	let { showModal = $bindable(false) } = $props();

	async function displaySvg(containerId) {
		const logo = document.querySelector('link[rel="icon"]').href;
		// Replace placeholders with sample colors (replace with actual colors if available)
		let svgString = logo
			.replace('${appState.appColours[0].slice(1, 8)}', 'FF0000')
			.replace('${appState.appColours[1].slice(1, 8)}', '0000FF');

		// Extract the SVG content from the data URI (remove "data:image/svg+xml," prefix)
		svgString = svgString.replace('data:image/svg+xml,', '');

		// Decode the URL-encoded SVG string
		svgString = decodeURIComponent(svgString);

		// Display as an inline SVG element
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');
		const svgElement = svgDoc.documentElement;

		await tick();

		// Get the container element
		const container = document.getElementById(containerId);
		if (!container) {
			console.error('Container element not found');
			return;
		}

		container.appendChild(svgElement); // Append as inline SVG
	}
	$effect(() => {
		if (showModal) {
			displaySvg('logo-container');
		}
	});
</script>

<Modal bind:showModal width="63vw" max_height="80vh">
	{#snippet header()}
		<div class="heading">
			<h2>About</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<div class="title-container">
			<div id="logo-container" style="width: 36px; height: 36px;"></div>
			<h3>Analysis of Circadian Rhythms (AnCiR) v{appConsts.version}</h3>
		</div>
		<p>
			This is our 'AnCiR' to the need for a simple-to-use (GUI; no coding) tool for analysis of
			circadian rhythms.
		</p>

		<p>
			This version was financially supported by a University of Auckland Teaching and Learning
			Development and Innovation Grant (2024) and is written in <a href="https://svelte.dev/"
				>Svelte</a
			>
			by
			<a href="https://github.com/davecumin">DaveCumin</a>
			and <a href="https://github.com/yz-329">yz-329</a>.
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
			Icons are from <a href="https://github.com/FortAwesome/Font-Awesome">FontAwesome</a> (CC BY
			4.0 Licensed) and the <a href="https://icon-sets.iconify.design/tabler">Tabler set</a> (MIT Licensed).
		</p>
		<p>
			Default colours for the plots are taken from the <a
				href="https://www.fabiocrameri.ch/colourmaps/">maps designed and curated by Fabio Crameri</a
			>
			(MIT licensed). See
			<a href="https://doi.org/10.1038/s41467-020-19160-7"
				>Crameri, F., G.E. Shephard, and P.J. Heron (2020), The misuse of colour in science
				communication, Nature Communications, 11, 5444</a
			>.
		</p>
		<p>
			As such, this software is licensed under the stricter of the above - the GPL-3.0 license (<a
				href="http://fsf.org/">http://fsf.org/</a
			>).
		</p>
		<p style="font-size:8px;">Build Number: {buildInfo.buildNumber}</p>
	{/snippet}
</Modal>

<style>
	.title-container {
		display: flex;
		justify-content: left; /* Left horizontally */
		align-items: center; /* Center vertically */
		gap: 10px; /* Space between logo and text */
	}
	#logo img,
	#logo svg {
		width: 100%;
		height: 100%;
		display: block; /* Remove any extra spacing */
	}
</style>
