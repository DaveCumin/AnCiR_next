<script module>
	// @ts-nocheck
	import Modal from '$lib/components/reusables/Modal.svelte';
</script>

<script>
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';
	import ControlInput from '$lib/components/inputs/ControlInput.svelte';
	import { appConsts, appState, core } from '$lib/core/core.svelte';
	import ColourPaletteSelect from '$lib/components/inputs/ColourPaletteSelect.svelte';
	import FigureStyleControls from '$lib/components/inputs/FigureStyleControls.svelte';
	import { applyStyleToAll, applyFigureWidthToAll } from '$lib/plots/figureStyle.js';
	import { clearSeriesColourOverrides } from '$lib/plots/appearanceIdentity.js';
	import AppearanceMapEditor from '$lib/components/inputs/AppearanceMapEditor.svelte';
	import {
		applyAppearanceToAll,
		pinnedColourSnapshot,
		repaintPinnedSeries
	} from '$lib/plots/seriesAppearance.js';
	import { exportPython, exportR } from '$lib/components/iconActions/Setting.svelte';
	import { privacy, setEphemeral, clearLocalData } from '$lib/core/localData.svelte.js';
	import { addNotification } from '$lib/core/notifications.svelte.js';
	import { loadRecents } from '$lib/start/recentSessions.svelte.js';
	let { showModal = $bindable(false) } = $props();

	// --- Privacy -------------------------------------------------------------
	let clearing = $state(false);

	async function toggleEphemeral(on) {
		await setEphemeral(on);
		loadRecents(); // the list on the start screen must reflect what is actually stored now
		addNotification(
			on
				? 'Ephemeral mode on. Nothing is written to this browser, and what was there has been cleared.'
				: 'Ephemeral mode off. Recent sessions will be remembered on this browser again.',
			'info'
		);
	}

	async function clearNow() {
		clearing = true;
		try {
			const { keys } = await clearLocalData();
			loadRecents();
			// Report the count rather than a bare "done": a number is checkable, and zero is a
			// meaningful answer the user is entitled to see.
			addNotification(
				`Cleared ${keys} stored item${keys === 1 ? '' : 's'} and the saved file handles.`
			);
		} finally {
			clearing = false;
		}
	}

	// Build the IANA zone list once on first render. `supportedValuesOf` is in
	// every modern browser; if it's missing we fall back to UTC + browser-local
	// so the picker still does something useful.
	const allZones =
		typeof Intl?.supportedValuesOf === 'function'
			? Intl.supportedValuesOf('timeZone')
			: [Intl.DateTimeFormat().resolvedOptions().timeZone];

	// Local mirror of the displayed string so the user can type freely without
	// each keystroke clobbering appState. Commit to appState only when a valid
	// zone is selected/typed.
	let zoneInput = $state(appState.displayTimezone ?? 'utc');
	let zoneError = $state('');

	function isValidZone(z) {
		if (!z) return false;
		const norm = String(z).trim();
		if (norm.toLowerCase() === 'utc') return true;
		// Intl will throw on invalid zones; cheaper than scanning allZones.
		try {
			new Intl.DateTimeFormat('en-US', { timeZone: norm });
			return true;
		} catch {
			return false;
		}
	}

	function applyZone(z) {
		const norm = String(z ?? '').trim();
		if (!isValidZone(norm)) {
			zoneError = `Unknown timezone: "${norm}"`;
			return;
		}
		zoneError = '';
		appState.displayTimezone = norm.toLowerCase() === 'utc' ? 'utc' : norm;
		zoneInput = appState.displayTimezone;
	}

	function detectLocalZone() {
		const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
		applyZone(local);
	}

	function changeDefaultPalette(palette) {
		// Snapshot what each pinned column resolves to BEFORE the swap. That is the only
		// way to tell, afterwards, which series were following the palette and which the
		// user had overridden — see repaintPinnedSeries.
		const before = pinnedColourSnapshot();
		appState.appColours = appConsts.colourPalettes[palette];
		// Most series resolve their colour on READ and so follow the palette unaided; this
		// reaches the values derived from it once and stored (Box's fillColour).
		repaintPinnedSeries(before);
		//update the favicon
		const link = document.querySelector('link[rel="icon"]');
		link.href = `data:image/svg+xml, %3Csvg data-v-6805eed4='' version='1.0' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' width='100%25' height='100%25' viewBox='0 0 70.000000 70.000000' preserveAspectRatio='xMidYMid meet' color-interpolation-filters='sRGB' style='margin: auto;'%3E%3Cg data-v-6805eed4='' fill='%23333' class='icon-text-wrapper icon-svg-group iconsvg' transform='translate(71.40499877929688,97.81155776977539)'%3E%3Cg class='iconsvg-imagesvg' transform='matrix(1,0,0,1,0,0)' opacity='1'%3E%3Cg%3E%3Crect fill='%23333' fill-opacity='0' stroke-width='2' x='0' y='0' width='60' height='54.37688619824' class='image-rect'%3E%3C/rect%3E%3Csvg x='-120' y='-95' width='160' height='54.37688619824' filtersec='colorsb2791788449' class='image-svg-svg primary' style='overflow: visible;'%3E%3Csvg xmlns='http://www.w3.org/2000/svg' xlink='http://www.w3.org/1999/xlink' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='ae8194c03-b976-4110-a715-bc6a7dcd8efe' x1='127.09' y1='100.34' x2='11.24' y2='19.22' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0' stop-color='%23${appState.appColours[0].slice(1, 8)}'%3E%3C/stop%3E%3Cstop offset='1' stop-color='%23${appState.appColours[1].slice(1, 8)}'%3E%3C/stop%3E%3C/linearGradient%3E%3ClinearGradient id='b74247629-084e-4695-a572-5323a7fe49da' x1='12.79' y1='-21.54' x2='83.81' y2='101.47' href='%23ae8194c03-b976-4110-a715-bc6a7dcd8efe'%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M108.13 58.27L88.82 91.72A16.56 16.56 0 0 1 74.49 100H35.86a16.54 16.54 0 0 1-8.72-2.49C86.56 97.51 82.65 50 82.65 50a8.59 8.59 0 0 0-2.52-6.09L61.26 25a8.62 8.62 0 0 0-12.18 0L30.22 43.91a8.51 8.51 0 0 0-2.41 4.69c-.06-8.11 2.5-46 55.56-46a16.43 16.43 0 0 1 5.43 5.68l19.31 33.45a16.51 16.51 0 0 1 .02 16.54z' fill='url(%23ae8194c03-b976-4110-a715-bc6a7dcd8efe)'%3E%3C/path%3E%3Cpath d='M27.81 48.6a8.61 8.61 0 0 0 2.41 7.49L49.08 75a8.62 8.62 0 0 0 12.18 0l18.87-18.91A8.59 8.59 0 0 0 82.65 50s3.91 47.51-55.51 47.51a16.48 16.48 0 0 1-5.61-5.79L2.22 58.27a16.51 16.51 0 0 1 0-16.54L21.53 8.28A16.56 16.56 0 0 1 35.86 0h38.63a16.54 16.54 0 0 1 8.9 2.6c-53.08 0-55.64 37.89-55.58 46z' fill='url(%23b74247629-084e-4695-a572-5323a7fe49da)'%3E%3C/path%3E%3C/svg%3E%3C/svg%3E%3C!----%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cdefs v-gra='od'%3E%3C/defs%3E%3C/svg%3E`;
	}
</script>

<Modal bind:showModal>
	{#snippet header()}
		<div class="settings-heading">
			<h2>Settings</h2>
		</div>
	{/snippet}

	{#snippet children()}
		<!-- Reuses the control-panel patterns (control-component / control-input /
		     div-line) so the modal matches the rest of the app. -->
		<!-- The session TEMPLATE. Copied into each new plot; existing plots are only
		     changed by the button inside these controls. FigureStyleControls already
		     renders its own control-component wrapper, matching the sections below.
		     The palette rides along as a top control: it reads as one of these defaults,
		     but it is app-wide state rather than a per-figure field, so it is passed in
		     here rather than living in the component. -->
		{#snippet paletteControl()}
			<div class="control-input">
				<p>Default colour palette</p>
				<ColourPaletteSelect onSelect={(palette) => changeDefaultPalette(palette)} />
			</div>
		{/snippet}

		<FigureStyleControls
			topControls={paletteControl}
			onResetToMap={() => clearSeriesColourOverrides(core.plots)}
			style={core.figureStyle}
			showApplyToAll={true}
			onApplyToAll={() => {
				const n = applyStyleToAll(core.plots, core.figureStyle);
				// The style fields alone do not move monochrome/marker state into series
				// that already exist, so push those too or "Apply to all" would leave the
				// two flags visibly ignored.
				applyAppearanceToAll(core.plots);
				applyFigureWidthToAll(core.plots);
				return n;
			}}
			title="Figure defaults"
		/>

		<div class="div-line"></div>

		<!-- The identity map, made visible. Session-scoped like the template above, and
		     the reason it sits here rather than in a plot's panel: it governs every
		     figure, not one. -->
		<AppearanceMapEditor />

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Canvas</p></div>
			<div class="control-input-horizontal">
				<ControlInput label="Grid size">
					<NumberWithUnits bind:value={appState.gridSize} min="1" max="100" />
				</ControlInput>
				<ControlInput label="Zoom">
					<NumberWithUnits bind:value={appState.canvasScale} min="0.01" max="10" step="0.05" />
				</ControlInput>
			</div>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Time</p></div>
			<ControlInput label="Timezone">
				<div class="tz-row">
					<input
						type="text"
						list="ancir-timezone-list"
						bind:value={zoneInput}
						onchange={() => applyZone(zoneInput)}
						onblur={() => applyZone(zoneInput)}
						onkeydown={(e) => {
							if (e.key === 'Enter') applyZone(zoneInput);
						}}
						placeholder="utc"
					/>
					<button class="tz-detect" type="button" onclick={detectLocalZone}>
						Detect from browser
					</button>
					<datalist id="ancir-timezone-list">
						<option value="utc"></option>
						{#each allZones as z (z)}
							<option value={z}></option>
						{/each}
					</datalist>
				</div>
				{#if zoneError}
					<p class="zone-error">{zoneError}</p>
				{/if}
			</ControlInput>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title"><p>Privacy</p></div>
			<label class="privacy-row">
				<input
					type="checkbox"
					checked={privacy.ephemeral}
					onchange={(e) => toggleEphemeral(e.currentTarget.checked)}
				/>
				<span>Ephemeral mode (shared or clinic machine)</span>
			</label>
			<p class="privacy-note">
				Keeps everything in the tab: no recent-session list, no saved file handles, nothing left in
				this browser once the tab is closed. Your data itself is never uploaded in either mode; this
				is about what stays behind on the machine.
			</p>
			<button class="export-py-btn" type="button" disabled={clearing} onclick={clearNow}>
				{clearing ? 'Clearing…' : 'Clear data stored in this browser'}
			</button>
			<p class="privacy-note">
				Removes the recent-session list, the saved file handles and the remembered canvas layout.
				Your saved session files on disk are untouched.
			</p>
		</div>

		<div class="div-line"></div>

		<div class="control-component">
			<div class="control-component-title">
				<p>Experimental <span class="exp-badge">experimental</span></p>
			</div>
			<button class="export-py-btn" type="button" onclick={exportPython}>
				Export session as Python
			</button>
			<p class="experimental-note">
				Downloads a standalone Python script that reproduces this session's analyses. Requires
				<code>numpy</code>, <code>pandas</code> and <code>scipy</code>. Some processes may not yet
				be implemented in the Python runtime — the script prints a warning when run.
			</p>
			<button class="export-py-btn" type="button" onclick={exportR}> Export session as R </button>
			<p class="experimental-note">
				Downloads a standalone R script that reproduces this session's analyses. Needs
				<strong>no extra packages</strong> — base R only. The R runtime does not cover every node yet,
				so a session using one it lacks is refused here, naming the node, rather than exported as a script
				that would stop partway.
			</p>
		</div>
	{/snippet}
</Modal>

<style>
	.privacy-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		cursor: pointer;
	}
	.privacy-note {
		color: var(--color-text-muted);
		font-size: 0.85rem;
		margin: var(--space-1) 0 var(--space-2);
	}
	.settings-heading h2 {
		margin: 0 0 var(--space-5);
		padding-bottom: var(--space-3);
		border-bottom: 1px solid var(--color-lightness-85);
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-lightness-25);
	}

	/* Timezone input + "Detect" button on one row; the input inherits the global
	   .control-input input styling, the button matches it. */
	.tz-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
	}
	.tz-row > input {
		flex: 1;
		width: auto;
		min-width: 0;
	}
	.tz-detect {
		flex: 0 0 auto;
		height: var(--control-input-height);
		padding: 0 var(--space-4);
		font-size: var(--font-sm);
		white-space: nowrap;
		color: var(--color-lightness-35);
		background: var(--color-lightness-97);
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		cursor: pointer;
		transition: border-color 0.2s;
	}
	.tz-detect:hover {
		border-color: var(--color-lightness-35);
	}
	.zone-error {
		margin: var(--space-2) 0 0;
		font-size: var(--font-sm);
		color: var(--color-error);
	}

	.exp-badge {
		margin-left: var(--space-2);
		padding: 1px 6px;
		font-size: var(--font-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-error);
		border: 1px solid var(--color-error);
		border-radius: 999px;
		vertical-align: middle;
	}

	.export-py-btn {
		align-self: flex-start;
		height: var(--control-input-height);
		padding: 0 var(--space-4);
		font-size: var(--font-md);
		white-space: nowrap;
		color: var(--color-lightness-25);
		background: var(--color-lightness-97);
		border: 1px solid var(--color-lightness-85);
		border-radius: 2px;
		cursor: pointer;
		transition: border-color 0.2s;
	}
	.export-py-btn:hover {
		border-color: var(--color-lightness-35);
	}

	.experimental-note {
		margin: var(--space-2) 0 0;
		font-size: var(--font-sm);
		color: var(--color-lightness-35);
	}
	.experimental-note code {
		font-size: 0.95em;
	}
</style>
