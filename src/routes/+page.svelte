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
<ViewDisplay />


