<script>
	// @ts-nocheck
	import '../app.css';
	import Navbar from '$lib/components/Navbar.svelte';
	import DisplayPanel from '$lib/components/DisplayPanel.svelte';
	import ControlPanel from '$lib/components/ControlPanel.svelte';
	import PlotDisplay from '$lib/components/views/PlotDisplay.svelte';

	import AreYouSure from '$lib/components/views/modals/AreYouSure.svelte';
	import TourOverlay from '$lib/components/tour/TourOverlay.svelte';
	import TourPicker from '$lib/components/tour/TourPicker.svelte';
	import { toggleLessons } from '$lib/core/tourRunner.svelte.js';
	import ImportData, {
		loadFromURL,
		openImportModal,
		openImportModalWithFiles,
		openImportModalWithUrl
	} from '$lib/components/views/modals/ImportData.svelte';
	import Notifications from '$lib/components/reusables/Notifications.svelte';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { registerDataSourceActions } from '$lib/core/dataSourceActions.js';
	import { importJson } from '$lib/components/iconActions/Setting.svelte';

	import { loadProcesses } from '$lib/processes/processMap.js';
	import { loadPlots } from '$lib/plots/plotMap.js';
	import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
	import { onMount, untrack } from 'svelte';
	import { fade } from 'svelte/transition';

	import { dev } from '$app/environment';

	import {
		core,
		pushObj,
		appConsts,
		appState,
		snapToGrid,
		outputCoreAsJson,
		createGroup,
		absorbColumnIntoGroup,
		createOrphanProcess
	} from '$lib/core/core.svelte';
	import { Column } from '$lib/core/Column.svelte';
	import { Plot, selectAllPlots, reconcileAllFacets } from '$lib/core/Plot.svelte';
	import { TableProcess } from '$lib/core/TableProcess.svelte';

	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { history } from '$lib/core/history.svelte';
	import { mutationService } from '$lib/core/mutationService.js';
	import { paramDiffWatcher } from '$lib/core/paramDiffWatcher.svelte.js';

	import WorkflowEditor from '$lib/components/workflow/WorkflowEditor.svelte';

	// Initialize history watching (must be in component context)
	history.init();
	paramDiffWatcher.init();

	// Dev-only: expose the history manager (and the core + mutation service) on
	// window so the undo/redo stacks and live graph can be inspected/driven from
	// the browser console, e.g.
	//   __history.undoStack.map((e) => e.forward.kind)   // list recorded ops
	//   __history.redoStack.map((e) => e.forward.kind)
	//   __history.undoCount / __history.redoCount
	//   __mutationService.setPlotProperty(id, 'name', 'x')  // drive a real op
	//   __core.plots / __core.data                          // inspect state
	// Stripped from production builds by the import.meta.env.DEV guard.
	if (import.meta.env.DEV && typeof window !== 'undefined') {
		window.__history = history;
		window.__core = core;
		window.__mutationService = mutationService;
	}

	// Keep facet generators' child plots in sync with their wired series. We track
	// only the generators' geometry + series refIds; reconciliation runs untracked
	// and is idempotent, so it won't re-trigger itself in the steady state.
	$effect(() => {
		const gens = core.plots.filter((p) => p.facet);
		for (const g of gens) {
			void g.x;
			void g.y;
			void g.width;
			void g.height;
			void g.type;
			for (const s of g.plot?.data ?? []) {
				void s?.x?.refId;
				void s?.y?.refId;
			}
		}
		// Also react to children being added/removed (membership changes).
		void core.plots.length;
		untrack(() => reconcileAllFacets());
	});

	// Single ImportData modal instance for the whole app (mounted below). Its
	// open/close state lives in module scope, so empty-state prompts, the node
	// palette, and canvas file-drop open it through the dataSourceActions registry
	// rather than mounting their own copy.
	function loadSessionFromFile(file) {
		const reader = new FileReader();
		reader.onload = async (e) => {
			let parsed;
			try {
				parsed = JSON.parse(e.target.result);
			} catch (err) {
				addNotification('Invalid JSON session file: ' + (err?.message ?? err));
				return;
			}
			appState.loadingState.isLoading = true;
			appState.loadingState.loadingMsg = `Loading session from ${file.name}…`;
			try {
				await importJson(parsed, (msg) => (appState.loadingState.loadingMsg = msg));
			} catch (err) {
				addNotification('Failed to load session: ' + (err?.message ?? err));
			} finally {
				appState.loadingState.isLoading = false;
				appState.loadingState.loadingMsg = '';
			}
		};
		reader.onerror = () => addNotification('Failed to read dropped file.');
		reader.readAsText(file);
	}
	registerDataSourceActions({
		openImport: openImportModal,
		openImportFiles: openImportModalWithFiles,
		openImportUrl: openImportModalWithUrl,
		loadSessionFile: loadSessionFromFile
	});

	// const timesToTest = ['2025/10/01', '2025/12/01', '2025/13/01'];
	// console.log('times to test: ', timesToTest);
	// console.log('d3 guess: ', guessFormatD3(timesToTest));
	// console.log('guess: ', guessFormat(timesToTest[0]));
	// import { timeParse, utcParse } from 'd3-time-format';
	// import { faL } from '@fortawesome/free-solid-svg-icons';
	// console.log(
	// 	'parse: ',
	// 	timeParse('%Y/%m/%d')(timesToTest[0]),
	// 	timeParse('%Y/%m/%d')(timesToTest[1]),
	// 	timeParse('%Y/%m/%d')(timesToTest[2])
	// );

	// const timesToTest2 = [
	// 	'2025-04-06T02:45:29.833Z',
	// 	'2025-04-06T04:45:29.833Z',
	// 	'2025-04-06T06:45:29.833Z'
	// ];
	// console.log('times to test: ', timesToTest2);
	// console.log('d3 guess: ', guessFormatD3(timesToTest2));
	// console.log('guess: ', guessFormat(timesToTest2[0]));

	// console.log(
	// 	'parse: ',
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0]),
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1]),
	// 	timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2])
	// );
	// console.log(
	// 	'parse: ',
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
	// 	Number(timeParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	// );
	// console.log(
	// 	'parse utc: ',
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[0])),
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[1])),
	// 	Number(utcParse('%Y-%m-%dT%H:%M:%S.%LZ')(timesToTest2[2]))
	// );

	//------------------------------------
	const N = 2_000;
	//------------------------------------

	onMount(async () => {
		if (dev) {
			console.log('moutning app in dev mode');
			performance.mark('load-start');
		}
		//load the maps
		appState.loadingState.loadingMsg = 'Loading maths ...';
		appConsts.processMap = await loadProcesses();
		appState.loadingState.loadingMsg = 'Loading plots ...';
		appConsts.plotMap = await loadPlots();
		appState.loadingState.loadingMsg = 'Loading more maths ...';
		appConsts.tableProcessMap = await loadTableProcesses();

		appState.loadingState.isLoading = false;

		//add event listeners
		const updateWidth = () => {
			appState.windowWidth = window.innerWidth;
			appState.windowHeight = window.innerHeight;
		};
		window.addEventListener('resize', updateWidth);

		document.addEventListener('keydown', (event) => {
			const ISMAC =
				navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
				navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
			const MODIFIER = ISMAC ? event.metaKey : event.ctrlKey;

			// When the user is typing in a text field, let the browser handle
			// shortcuts like Cmd/Ctrl+A natively (select the field's text) rather
			// than running app-level shortcuts (e.g. select-all-plots).
			const el = event.target;
			const editableFocused =
				!!el &&
				(el.tagName === 'INPUT' ||
					el.tagName === 'TEXTAREA' ||
					el.tagName === 'SELECT' ||
					el.isContentEditable === true);

			if (!appState.loadingState.isLoading) {
				// Don't allow keypresses if loading

				// UNDO
				if (MODIFIER && !event.shiftKey && event.key.toLowerCase() === 'z') {
					event.preventDefault();
					history.undo();
				}
				// REDO
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'z') {
					event.preventDefault();
					history.redo();
				}

				// Print out info - DEGUGGING
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'i') {
					event.preventDefault();
					console.log($state.snapshot(core));
					console.log($state.snapshot(appState));
					console.log($state.snapshot(appConsts));
				}
				// Create sample data quickly - FOR TESTING
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 's') {
					refresh();
				}

				//load the test json
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'a') {
					const test = new URL(window.location.href);
					window.location.href =
						test.href +
						'?loadFromURL=https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/test/testJSON.json';
				}

				// CHANGE SCALE - ZOOM IN
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'p') {
					appState.canvasScale = Math.min(appState.canvasScale + 0.1, 4);
				}
				// CHANGE SCALE - ZOOM OUT
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'o') {
					appState.canvasScale = Math.max(appState.canvasScale - 0.1, 0.15);
				}
				// SELECT ALL PLOTS — but if a text field is focused, let the browser
				// select the field's text instead.
				if (MODIFIER && event.key.toLowerCase() === 'a' && !editableFocused) {
					event.preventDefault();
					selectAllPlots();
				}
				// visualise
				if (MODIFIER && event.shiftKey && event.key.toLowerCase() === 'x') {
					event.preventDefault();
					appState.showWorkflow = !appState.showWorkflow;
				}
				// ADMIN: reveal/hide the classroom lessons in the tour picker.
				if (MODIFIER && event.shiftKey && event.code === 'Space' && !editableFocused) {
					event.preventDefault();
					toggleLessons();
				}
				// SAVE THE SESSION
				if (!event.shiftKey && MODIFIER && event.key.toLowerCase() === 's') {
					event.preventDefault();
					//TODO: Can this be put into the Setting module? I tried before and had issues
					try {
						// Get JSON string and validate
						const jsonStr = outputCoreAsJson();
						if (typeof jsonStr !== 'string' || !jsonStr) {
							throw new Error('Invalid or empty JSON string returned by outputCoreAsJson');
						}

						// Validate JSON content
						try {
							JSON.parse(jsonStr); // Ensure it's valid JSON
						} catch (e) {
							throw new Error('Invalid JSON format: ' + e.message);
						}

						// Create Blob with JSON content
						const blob = new Blob([jsonStr], { type: 'application/json' });
						const url = URL.createObjectURL(blob);

						// Create temporary <a> element
						const a = document.createElement('a');
						a.innerText = 'download';
						a.href = url;
						a.download = 'session.json'; // File name for download
						document.body.appendChild(a);

						// Programmatically trigger click
						a.click();

						console.log(
							'should have started download of ',
							JSON.parse(jsonStr),
							' from ',
							url,
							' : ',
							blob
						);
						// Clean up
						setTimeout(() => {
							document.body.removeChild(a);
							URL.revokeObjectURL(url);
						}, 10); // Delay cleanup to ensure download starts
					} catch (error) {
						console.error('Failed to export JSON:', error.message);
						addNotification('Error exporting JSON: ' + error.message);
					}
				}
			}
		});

		//Check for query url
		// Get query string from URL - for fetching external data
		const urlParams = new URLSearchParams(window.location.search);
		const query = urlParams.get('loadFromURL') || 'No query parameter found';

		if (query != 'No query parameter found') {
			loadFromURL(query);
			window.history.replaceState({}, document.title, window.location.pathname);
		}

		if (dev) {
			performance.mark('load-end');
			const m = performance.measure('loading time', 'load-start', 'load-end');
			console.log('[loading time load', m.duration.toFixed(1), 'ms');
		}

		//remove the listeners on close
		return () => {
			window.removeEventListener('resize', updateWidth);
			document.removeEventListener('keydown');
		};
	});

	// async function loadTestJson() {
	// 	// const jsonData = JSON.parse(`${testJson}`);
	// 	const jsonData = JSON.parse(`${testJsonDC}`);
	// 	appState.loadingState.isLoading = true;
	// 	appState.loadingState.loadingMsg = 'Loading test data...';
	// 	await new Promise((resolve) => setTimeout(resolve, 10));
	// 	await importJson(jsonData, (msg) => {
	// 		appState.loadingState.loadingMsg = msg;
	// 	});
	// 	appState.loadingState.isLoading = false;
	// }

	function addData(dataIN, type, name, provenance) {
		let newDataEntry;
		if (dataIN != null) {
			newDataEntry = new Column({ type, data: -1, name, provenance });
			core.rawData.set(newDataEntry.id, dataIN);
			newDataEntry.data = newDataEntry.id;

			if (type == 'time') {
				newDataEntry.timeFormat = '';
			}
			core.data.push(newDataEntry);
		} else {
			core.rawData.push([
				Math.round(10 * Math.random()),
				Math.round(10 * Math.random()),
				Math.round(10 * Math.random()),
				Math.round(10 * Math.random())
			]);
			newDataEntry = new Column({
				type,
				data: core.rawData.length - 1,
				name,
				provenance
			});
			if (type == 'time') {
				newDataEntry.timeFormat = 1;
			}
			core.data.push(newDataEntry);
		}
		return newDataEntry.id;
	}

	function makeArray(N, from, step) {
		let out = [];
		for (let i = 0; i < N; i++) {
			out.push(from + i * step);
		}
		return out;
	}
	function makeRhythmic(N, period, low = 10, high = 100) {
		let out = [];
		for (let i = 0; i < N; i++) {
			const mult = i % period < period / 2 ? low : high;
			out.push(Math.round(Math.random() * mult));
		}
		return out;
	}

	function makeDateTimeArray(N, from = new Date(), step_hrs = 1) {
		let out = [];
		for (let i = 0; i < N; i++) {
			out.push(new Date(Number(from) + i * step_hrs * 3600000)); //step_hrs is in hours, so convert to milliseconds
		}
		//now convert to timestamps
		//out = out.map((d) => d.getTime()); // this makes the UNIX timestamps
		out = out.map((d) => d.toISOString()); // this makes the ISO strings
		return out;
	}

	async function refresh() {
		//Clear everything
		core.data = [];
		core.tableProcesses = [];
		core.groups = [];
		core.notes = [];
		core.plots = [];
		core.rawData = new Map();
		await new Promise((resolve) => setTimeout(resolve, 10));

		//Show the loading message
		appState.loadingState.isLoading = true;
		appState.loadingState.loadingMsg = 'Making data...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		//simulate importing data
		let d0id = addData(makeArray(N, 5, 0.15), 'number', 'the time', 'just made this up');

		let d1id = addData(makeRhythmic(N, 24 / 0.15), 'number', 'val1', 'imported from thin air');
		// Dataflow model: demonstrate operations as free nodes producing derived
		// columns (the new model), rather than legacy inline col.addProcess(). One
		// Add node fed by val1 → a "val1 → Add" derived column the user can edit and
		// wire further. (No migration-on-load needed for the demo this way.)
		{
			const addNode = createOrphanProcess('Add', { value: 0, inIN: [d1id] });
			if (addNode) {
				core.data.push(
					new Column({
						type: 'number',
						producerNodeId: `process_${addNode.id}`,
						producerPort: `out_${d1id}`,
						producerArtifactKind: 'column'
					})
				);
			}
		}

		let d2id = addData(['a', 'b', 'b', 'c'], 'category', 'mycat', 'imported from Egypt');

		let testawd = new Column({
			type: 'number',
			data: -1,
			compression: 'awd',
			name: 'AWD',
			provenance: 'another manufactured column'
		});
		testawd.data = testawd.id;
		core.data.push(testawd);
		core.rawData.set(testawd.id, { start: 10, step: 1, length: N });

		let testref = new Column({
			type: 'number',
			data: -1,
			name: 'more',
			provenance: 'testing'
		});
		testref.data = testref.id;
		core.data.push(testref);
		core.rawData.set(testref.id, makeRhythmic(N, 22 / 0.15));

		let testrefref = new Column({
			type: 'number',
			data: core.rawData.length - 1,
			compression: 'awd',
			name: 'steps',
			provenance: 'some data'
		});
		testrefref.data = testrefref.id;
		core.data.push(testrefref);
		core.rawData.set(testrefref.id, { start: 5, step: 12, length: N });

		let testtimestring = addData(
			makeDateTimeArray(N, new Date(), 0.15),
			'time',
			'REALTIME',
			'Just made up'
		);
		// dayjs token syntax: literals in [], `Z` is the offset token so it
		// must be escaped to be matched literally as the trailing "Z" of an
		// ISO-8601 UTC timestamp like "2026-04-30T05:38:03.894Z".
		core.data[core.data.length - 1].timeFormat = 'YYYY-MM-DD[T]HH:mm:ss.SSS[Z]';

		appState.loadingState.loadingMsg = 'Putting data into tables...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		const g1 = createGroup({ name: 'my first table' });
		for (const cid of [testtimestring, testawd.id, testref.id, testrefref.id]) {
			absorbColumnIntoGroup(cid, g1);
		}
		const g2 = createGroup({ name: 'table too' });
		for (const cid of [d1id, d0id, d2id]) {
			absorbColumnIntoGroup(cid, g2);
		}

		appState.loadingState.loadingMsg = 'Putting binned data...';
		await new Promise((resolve) => setTimeout(resolve, 10));
		core.tableProcesses.push(
			new TableProcess(
				{
					name: 'BinnedData',
					args: {
						xIN: d0id,
						yIN: [d1id],
						binSize: 2,
						binStart: 0,
						stepSize: 2,
						aggFunction: 'mean',
						out: { binnedx: -1 }
					}
				},
				null
			)
		);

		appState.loadingState.loadingMsg = 'Making scatterplot...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		//Scatter plot
		pushObj(new Plot({ name: 'A Scatterplot', type: 'scatterplot' }));

		core.plots[0].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[0].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = 15;
		core.plots[core.plots.length - 1].y = 15;

		appState.loadingState.loadingMsg = 'Making actogram...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		// //Actogram
		pushObj(new Plot({ name: 'An Actogram', type: 'actogram' }));
		core.plots[core.plots.length - 1].height = snapToGrid(700);
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].plot.data[1].colour = '#bf796b91';
		core.plots[core.plots.length - 1].x = snapToGrid(15);
		core.plots[core.plots.length - 1].y = snapToGrid(335);

		appState.loadingState.loadingMsg = 'Making periodogram...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		//Periodogram
		pushObj(new Plot({ name: 'A Periodogram', type: 'periodogram' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(15);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		appState.loadingState.loadingMsg = 'Making table...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		//Table
		core.plots.push(new Plot({ name: 'a table', type: 'tableplot' }));
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(330);
		core.plots[core.plots.length - 1].plot.columnRefs = [
			core.data[0].id,
			core.data[1].id,
			core.data[core.data.length - 2].id,
			core.data[core.data.length - 1].id
		];
		core.plots[core.plots.length - 1].plot.showCol = [true, true, true, true];

		appState.loadingState.loadingMsg = 'Making correlogram...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		//Correlogram
		pushObj(new Plot({ name: 'An Autocorrelogram', type: 'correlogram' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(645);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		appState.loadingState.loadingMsg = 'Making Fourier analysis...';
		await new Promise((resolve) => setTimeout(resolve, 10));

		// FFT
		pushObj(new Plot({ name: 'A Fourier Analysis', type: 'fft' }));
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[0].id },
			y: { refId: core.data[1].id }
		});
		core.plots[core.plots.length - 1].plot.addData({
			x: { refId: core.data[core.data.length - 2].id },
			y: { refId: core.data[core.data.length - 1].id }
		});
		core.plots[core.plots.length - 1].x = snapToGrid(555);
		core.plots[core.plots.length - 1].y = snapToGrid(960);
		core.plots[core.plots.length - 1].width = snapToGrid(510);

		core.plots[0].plot.data[1].y.refId = core.data[core.data.length - 1].id;

		appState.loadingState.isLoading = false;

		// Auto-tidy the freshly-seeded nodes (WorkflowEditor watches this counter
		// and re-runs the layered layout once they've rendered + been measured).
		appState.tidyLayoutRequest = (appState.tidyLayoutRequest ?? 0) + 1;
	}

	// TODO: Key Handling accessibility, e.g. ctrl+i == import
</script>

<svelte:head>
	<title>AnCiR {appConsts.version}</title>
</svelte:head>

{#if appState.showWorkflow}
	<!-- Legacy fullscreen-modal entry retained for callers that still set
	     appState.showWorkflow; the canvas-default view below replaces normal use. -->
	<WorkflowEditor />
{/if}
{#if !appState.loadingState.isLoading || core.data.length > 0}
	{#if appState.showNavbar}
		<Navbar />
	{/if}

	<DisplayPanel />

	{#if appState.view === 'canvas'}
		<WorkflowEditor inline={true} />
	{:else}
		<PlotDisplay />
	{/if}

	<ControlPanel />
{/if}

<AreYouSure
	bind:showModal={appState.showAYSModal}
	text={appState.AYStext}
	callback={appState.AYScallback}
	options={appState.AYSoptions}
/>
<ImportData />
<TourPicker />
<TourOverlay />
<Notifications />
{#if appState.loadingState.isLoading}
	<div class="backdrop" transition:fade={{ duration: 360 }}>
		<div class="loading-container">
			<LoadingSpinner message={appState.loadingState.loadingMsg} />
		</div>
	</div>
{/if}

<style>
	:global(body) {
		font-family: system-ui, sans-serif;
		font-size: var(--font-lg);
	}

	:global(button) {
		font-family: system-ui, sans-serif;
		font-size: var(--font-lg);
	}

	:global(button.icon) {
		background-color: transparent;
		border: none;
		margin: 0;
		padding: 0;
		text-align: inherit;
		font: inherit;
		border-radius: 0;
		appearance: none;
		display: flex;
		justify-content: center;
		align-items: center;
	}

	/* :global(input:focus) {
		background-color: blue;
	} */

	/* resizer style */
	:global(.resizer) {
		cursor: col-resize;
		width: 4px;
		height: 100%;
		position: absolute;
		top: 0;
		right: 0;
		background-color: transparent;
	}

	/* TODO: scroll down, resizer not working */

	/* dialog button style */
	:global(.dialog-button-container) {
		display: flex;
		justify-content: flex-end;
		gap: 0.5em;
	}

	:global(button.dialog-button) {
		margin-top: 10px;
		background-color: var(--color-lightness-95);
		border: transparent;
		border-radius: var(--radius-sm);
		padding: 10px;
		padding-right: 12px;

		font-size: var(--font-lg);
		text-align: center;

		cursor: pointer;
	}

	:global(button.dialog-button:hover) {
		background-color: var(--color-hover);
	}

	/* space filler */
	:global(.div-line) {
		height: 1px;
		width: 100%;
		background-color: var(--color-lightness-85);
		margin-top: var(--space-6);
		margin-bottom: var(--space-4);
	}

	:global(.div-block) {
		height: 150px;
		width: 100%;
		background-color: transparent;
	}

	/* dropdown */
	:global(.dropdown-action button) {
		display: flex;
		margin: 0.6em;

		font-size: var(--font-lg);
		font: inherit;
		text-align: inherit;

		background-color: transparent;
		border: none;
		border-radius: 0;
		appearance: none;

		cursor: pointer;
	}

	:global(.dropdown-action:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.dropdown-item) {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
	}

	:global(.dropdown-item:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.dropdown-item.has-submenu::after) {
		content: '▶';
		font-size: 0.8em;
		color: var(--color-lightness-35);
	}

	:global(.submenu) {
		position: fixed;
		min-width: 150px;
		background-color: var(--surface-card);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-lightness-85);
		box-shadow:
			0 4px 8px 0 rgba(0, 0, 0, 0.2),
			0 6px 10px 0 rgba(0, 0, 0, 0.1);
		z-index: 1001; /* Above dialog */
	}

	:global(.submenu-item) {
		display: block;
		padding: 0.6em;
		cursor: pointer;
		border: none;
		background: transparent;
		text-align: left;
		font: inherit;
		width: 100%;
		font-size: var(--font-lg);
	}

	:global(.submenu-item:hover) {
		background-color: var(--color-lightness-95);
	}

	/* display collapsible */
	:global(details) {
		margin: var(--space-2) var(--space-4);
		padding: 0;
	}

	:global(summary) {
		list-style: none;

		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;
	}

	:global(summary p) {
		margin: 0;
		padding: 0;
	}

	:global(summary button) {
		margin: 0;
		padding: 0;
	}

	:global(.clps-title) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		gap: var(--space-4);
	}

	:global(.clps-title-button) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		margin-left: var(--space-4);
		gap: var(--space-2);
	}

	:global(.clps-icon-container) {
		display: flex;
		align-items: center;
		justify-content: center;

		padding: var(--space-4) var(--space-4);
		padding-left: var(--space-6);
	}

	:global(.clps-icon) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;

		width: 100%;
		padding: var(--space-4) 0;

		background-color: var(--surface-card);
		border-radius: var(--radius-sm);
		border: solid 1px var(--color-lightness-85);

		border-color: none;
		appearance: none;
	}

	:global(.clps-icon p) {
		margin: 0 0 0 0.2rem;
		padding: 0;
		color: var(--color-lightness-35);
	}

	:global(.clps-icon:hover) {
		background-color: var(--color-lightness-98);
		cursor: pointer;
	}

	:global(.second-clps) {
		width: 100%;
		padding: 0 0 0 var(--space-2);
	}

	/* plot control */
	:global(.control-banner) {
		position: sticky;
		top: 0;

		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;

		font-weight: bold;
		background-color: var(--surface-card);
		z-index: 99;
	}

	:global(.control-banner-title) {
		width: 100%;
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
	}

	:global(.control-banner-icons) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;

		margin: 0;
		padding: 0;
	}

	:global(.control-tab) {
		width: 100%;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap; /* Prevent buttons from wrapping */
		align-items: center;
		justify-content: flex-start;
		gap: 0.4rem;
		overflow-x: auto;
	}

	:global(.control-tab::-webkit-scrollbar) {
		display: none;
	}

	:global(.control-tab button) {
		font-size: var(--font-lg);
		margin: 0;
		padding: var(--space-2) var(--space-4);
		color: var(--color-lightness-35);
		background-color: transparent;
		border-radius: var(--radius-sm);
		border: none;
		appearance: none;
		white-space: nowrap; /* Prevent text wrapping within buttons */
	}

	:global(.control-tab button.active) {
		color: black;
		background-color: var(--color-lightness-95);
	}

	:global(.control-tab button:hover) {
		background-color: var(--color-lightness-95);
	}

	:global(.control-data-add) {
		position: fixed;
		top: 4.2rem;
		width: 100%;
		z-index: 100;
		left: calc(100% - 2rem);
	}

	:global(.control-component) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;

		width: 100%;
		/* margin-bottom: var(--space-4); */
	}

	:global(.control-component-title) {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		/* font-weight: bold; */
	}

	:global(.control-component-title button) {
		margin: 0;
		margin-left: var(--space-4);
		padding: 0;
	}

	:global(.control-component-title-colour) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		gap: var(--space-4);
	}

	:global(.control-component-title-icons) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: flex-end;
	}

	:global(.control-input-vertical) {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	:global(.control-input-horizontal) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		width: 100%;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}

	:global(.control-input-square) {
		width: 100%;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-4);

		margin-bottom: var(--space-4);
	}

	:global(.control-input-color) {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		width: 100%;
		gap: var(--space-4);
	}

	:global(.control-input-color button) {
		margin: 0;
		padding: 0;
	}

	:global(.control-input) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	:global(.control-input-checkbox) {
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		text-align: center;
		width: 100%;
		min-width: 0;

		margin: 0;
	}

	:global(.control-input p),
	:global(.control-input > .ci-label) {
		font-size: var(--font-sm);
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0 0 4px 0;
	}

	:global(.data-warning) {
		width: 100%;
		padding: 6px 8px;
		margin-bottom: var(--space-4);
		background: #fff8e1;
		border: 1px solid #f9a825;
		border-radius: var(--radius-sm);
	}

	:global(.data-warning p) {
		font-size: var(--font-xs);
		color: #795548;
		margin: 2px 0;
		line-height: 1.4;
	}

	:global(.control-input-checkbox p),
	:global(.control-input-checkbox > .ci-label) {
		font-size: var(--font-sm);
		text-align: left;
		color: var(--color-lightness-35);
		margin: 0 0 0 0.2rem;
	}

	:global(.control-input select, .control-input input) {
		width: 100%;

		height: var(--control-input-height);
		box-sizing: border-box;

		font-size: var(--font-lg);
		font-weight: lighter;
		padding: 0.2rem var(--space-4);
		border: solid 1px transparent;
		background-color: var(--color-lightness-97);
		border: solid 1px var(--color-lightness-85);
		border-radius: 2px;
		transition: border-color 0.2s;
	}

	:global(.control-input select) {
		padding: 0.2rem var(--space-2);
	}

	:global(.control-input select:hover, .control-input input:hover) {
		border: solid 1px var(--color-lightness-35);
	}

	:global(.control-color) {
		display: flex;
		align-items: baseline;
		justify-content: baseline;

		box-sizing: border-box;
		border: solid 1px transparent;

		margin-top: 1.2rem;
	}

	:global(button.control-block-add) {
		width: 100%;

		border: solid 1px var(--color-lightness-85);
		background-color: var(--color-lightness-97);
		border-radius: var(--radius-sm);

		padding: var(--space-4) 0;

		cursor: pointer;
	}

	:global(button.control-block-add:hover) {
		border: solid 1px var(--color-lightness-90);
		background-color: var(--color-lightness-90);
	}

	/* plot control (data) */
	:global(.control-data-container) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;

		width: 100%;
		min-width: 0;

		margin: 0;
		gap: var(--space-2);
	}

	:global(.control-data) {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		width: 100%;
		min-width: 0;
	}

	:global(.control-data-title) {
		display: flex;
		flex: 1 1 0;
		flex-direction: row;
		align-items: center;
		justify-content: flex-start;

		width: 100%;
		min-width: 0;

		margin: 0;
		padding: 0;

		gap: var(--space-4);
	}

	:global(.control-data-title p) {
		margin: 0;
		padding: 0;
	}

	:global(.with-icon) {
		justify-content: space-between;
	}

	/* process */
	:global(.process) {
		width: 100%;
		flex: 1 1 0;
		margin: 0;
	}

	:global(.process-title) {
		width: 100%;
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;

		margin: 0;
		padding: 0;

		font-weight: bold;
	}

	:global(.process-title button) {
		margin: 0;
		padding: 0;
	}

	/* table process outputs */
	:global(.tp-outputs) {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}

	:global(.tp-output-row) {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding-left: var(--space-4);
	}

	:global(.tp-output-label) {
		font-size: var(--font-xs);
		color: var(--color-text-muted, #666);
		font-style: italic;
	}

	:global(input[type='checkbox']) {
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-lightness-97);
		cursor: pointer;
	}

	:global(.column-indicator) {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;

		width: 4px;
		height: 100%;
		background-color: var(--color-lightness-90);

		border-radius: var(--radius-sm);
	}

	:global(.tooltip) {
		position: fixed;
		background-color: rgba(0, 0, 0, 0.75);
		color: white;
		padding: 0.4rem 0.6rem;
		border-radius: var(--radius-md);
		pointer-events: none;
		font-size: 0.78rem;
		line-height: 1.4;
		z-index: 9999;
		white-space: nowrap;
		backdrop-filter: blur(4px);
	}

	:global(.tableProcess-container) {
		display: flex;
		flex-direction: column;

		border: 0.1rem solid var(--color-lightness-85);
		padding: 0 var(--space-2) 0 0.4rem;
		margin-left: -var(--space-2);
		margin-right: var(--space-4);
		border-radius: 0.25rem;
		overflow: hidden;
		box-sizing: border-box;
	}

	:global(.section-row) {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		padding-left: var(--space-2);
		margin-top: var(--space-4);
	}
	:global(.tableProcess-label) {
		display: flex;
		align-items: center;
		margin-bottom: 0rem;
		margin-left: -var(--space-2);
		background: var(--surface-card);
		padding: var(--space-2);
	}

	:global(.tableProcess-label span) {
		color: #555;
	}

	.backdrop {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(4px);
		z-index: 9999;
	}
	.loading-container {
		display: flex;
		position: absolute;
		justify-content: center;
		align-items: center;
		width: 100%;
		height: 100vh;
		z-index: 999999;
	}
</style>
