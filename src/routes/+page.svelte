<!-- +page.svelte -->

<script>
	// import { version } from "../../package.json";
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import ViewDisplay from '../lib/components/ViewDisplay.svelte';

</script>

<!-- <svelte:head>
  <title>AnCiR v β.{version}</title>
</svelte:head> 
-->

<Navbar />
<div class="view-container">
	<ViewDisplay />
</div>


<style>
	.view-container {
		z-index: -1;
		overflow-y: auto;
		width: 300px;
		height: 100%;
		display: flex;
		flex-direction: column;
		justify-content: start;
		align-items: start;

		position: fixed;
		top: 0;
		left: 56px;

		border-right: 1px solid #d9d9d9;
	}

	.view-container::-webkit-scrollbar {
		display: none; /* Chrome, Safari */
	}

</style>

