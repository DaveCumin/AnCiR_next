<script>
	// @ts-nocheck
	// "AI" — describe an analysis in words, get a session.
	//
	// The prompt goes to our Worker, which asks a model for a session *draft*, turns it into a
	// real session and stores it briefly; we then just load that session URL. No key lives in
	// this app: the default model's key is a Worker-side secret (anything here would be
	// readable from the browser bundle). A user may supply their own under Advanced — it's
	// passed through for that one request and never stored.
	import Modal from '$lib/components/reusables/Modal.svelte';
	import { buildNlSession } from '$lib/utils/nlSession.js';

	let { showModal = $bindable(false) } = $props();

	let tab = $state('prompt');
	let prompt = $state('');
	let busy = $state(false);
	let error = $state('');

	// Bring-your-own model (optional). Blank ⇒ the Worker uses its configured default.
	let baseUrl = $state('');
	let apiKey = $state('');
	let model = $state('');

	const SUGGESTIONS = [
		'Simulate 4 days of a 24 h rhythm with noise, fit a cosinor, and plot the data with the fit.',
		'Simulate 7 days of activity and show a Lomb-Scargle periodogram to find the period.',
		'Simulate a rhythm and show its actogram.',
		'Simulate two days of data, bin it into 1 h bins, and plot the binned profile.'
	];

	function reset() {
		error = '';
		busy = false;
		// Don't leave a key sitting in memory once the dialog is closed.
		apiKey = '';
	}

	async function submit() {
		const text = prompt.trim();
		if (!text || busy) return;

		// Catch a bad endpoint here rather than letting the server answer with
		// "llm.baseUrl: Invalid url", which means nothing to the person reading it. This also
		// traps the classic case: a browser autofilling an email into the endpoint box.
		const url = baseUrl.trim();
		if (url && !/^https?:\/\/.+/i.test(url)) {
			tab = 'advanced';
			error = `"${url}" isn't a valid endpoint URL. It should look like https://api.groq.com/openai/v1 — or leave it blank to use the default model.`;
			return;
		}

		busy = true;
		error = '';
		try {
			// Send llm{} only if the user actually filled it in.
			const llm = {};
			if (url) llm.baseUrl = url;
			if (apiKey.trim()) llm.apiKey = apiKey.trim();
			if (model.trim()) llm.model = model.trim();

			const res = await buildNlSession({
				prompt: text,
				llm: Object.keys(llm).length ? llm : undefined
			});

			// Load the session into THIS deployment rather than following the Worker's `url`
			// (which points at the configured production AnCiR — following it from a dev or
			// self-hosted build would bounce the user somewhere else). Reloading with
			// ?loadFromURL= is the same path a shared link takes, so the session gets tidied
			// and the AI warning shown.
			const here = `${window.location.origin}${window.location.pathname}`;
			window.location.href = `${here}?loadFromURL=${encodeURIComponent(res.sessionUrl)}`;
		} catch (e) {
			// Never fail silently — the message from the Worker is the useful part.
			error = e?.message ?? String(e);
			busy = false;
		}
	}

	function onKeydown(e) {
		// ⌘/Ctrl+Enter submits; plain Enter keeps making newlines.
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
	}
</script>

<Modal bind:showModal onclose={reset} width="42rem" max_height="80vh">
	{#snippet header()}
		<div class="heading"><h2>Build with AI</h2></div>
	{/snippet}

	<div class="tabs" role="tablist">
		<button role="tab" class:active={tab === 'prompt'} onclick={() => (tab = 'prompt')}>
			Prompt
		</button>
		<button role="tab" class:active={tab === 'advanced'} onclick={() => (tab = 'advanced')}>
			Advanced
		</button>
	</div>

	{#if tab === 'prompt'}
		<p class="hint">
			Describe the analysis you want. A session is built for you to check and edit — it is a
			starting point, not an answer.
		</p>

		<textarea
			bind:value={prompt}
			onkeydown={onKeydown}
			rows="4"
			disabled={busy}
			placeholder="e.g. Simulate 4 days of a 24 h rhythm, fit a cosinor, and plot the fit over the data."
		></textarea>

		<div class="suggestions">
			{#each SUGGESTIONS as s}
				<button class="chip" disabled={busy} onclick={() => (prompt = s)}>{s}</button>
			{/each}
		</div>
	{:else}
		<p class="hint">
			By default your prompt is answered by the model this site is configured with. To use your own
			instead, fill these in — they're sent with this one request and never stored.
		</p>

		<!--
			These are credentials-shaped, so browsers and password managers try to treat them as
			a login form and autofill a saved email/username into the first text box — which then
			gets sent as `baseUrl` and rejected ("Invalid url"). `autocomplete="off"` is not
			enough (Chrome ignores it on password fields), hence `new-password` on the key,
			non-guessable names, and the password-manager opt-outs.
		-->
		<label>
			Endpoint (OpenAI-compatible)
			<input
				bind:value={baseUrl}
				name="ancir-llm-endpoint"
				placeholder="https://api.groq.com/openai/v1"
				disabled={busy}
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				data-1p-ignore
				data-lpignore="true"
				data-bwignore
			/>
		</label>
		<label>
			API key
			<input
				bind:value={apiKey}
				name="ancir-llm-key"
				type="password"
				placeholder="leave blank to use the default"
				disabled={busy}
				autocomplete="new-password"
				spellcheck="false"
				data-1p-ignore
				data-lpignore="true"
				data-bwignore
			/>
		</label>
		<label>
			Model
			<input
				bind:value={model}
				name="ancir-llm-model"
				placeholder="openai/gpt-oss-120b"
				disabled={busy}
				autocomplete="off"
				autocapitalize="off"
				autocorrect="off"
				spellcheck="false"
				data-1p-ignore
				data-lpignore="true"
				data-bwignore
			/>
		</label>
		<p class="note">
			The key is sent once to build your session and is never stored, logged, or saved by this site.
			It is cleared when you close this dialog.
		</p>

		<h3>Use it from your own tools</h3>
		<p class="hint">
			The same engine is available as an MCP server, so an agent (Claude Desktop/Code, or any MCP
			client) can build sessions directly — with live results, which this button can't give you. Run
			it from the repo:
		</p>
		<pre class="code">cd mcp &amp;&amp; npm start        # stdio
npm run start:http           # HTTP transport</pre>
		<p class="hint">
			See <code>mcp/AGENTS.md</code> for the tool contract, or <code>mcp/worker/README.md</code>
			to call this same <code>/build</code> endpoint yourself.
		</p>
	{/if}

	<!-- Error + actions sit OUTSIDE the tabs: a bad endpoint is reported on the Advanced tab,
	     and you shouldn't have to switch back to Prompt to find the Build button. -->
	{#if error}
		<div class="error" role="alert">
			<strong>Couldn't build that session.</strong>
			<pre>{error}</pre>
		</div>
	{/if}

	<div class="actions">
		<span class="note">Prompts are logged so the analyses can be reviewed and improved.</span>
		<button class="primary" disabled={busy || !prompt.trim()} onclick={submit}>
			{busy ? 'Building…' : 'Build session'}
		</button>
	</div>
</Modal>

<style>
	.heading h2 {
		margin: 0;
	}
	.tabs {
		display: flex;
		gap: var(--space-2);
		border-bottom: 1px solid var(--color-lightness-85);
		margin-bottom: var(--space-3);
	}
	.tabs button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		padding: var(--space-2) var(--space-3);
		cursor: pointer;
		font: inherit;
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}
	.tabs button.active {
		border-bottom-color: var(--color-accent);
		color: var(--color-lightness-25);
		font-weight: 600;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--font-sm);
		margin: 0 0 var(--space-3);
	}
	textarea,
	input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: var(--font-sm);
		padding: var(--space-2);
		color: var(--color-lightness-25);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		background: var(--color-lightness-99);
	}
	textarea:focus,
	input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: var(--shadow-focus-soft);
	}
	label {
		display: block;
		margin-bottom: var(--space-3);
		font-size: var(--font-sm);
		color: var(--color-text-muted);
	}
	.suggestions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: var(--space-3) 0;
	}
	.chip {
		text-align: left;
		font: inherit;
		font-size: var(--font-xs);
		color: var(--color-text-muted);
		background: var(--color-lightness-97);
		border: 1px solid var(--color-lightness-85);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}
	.chip:hover:not(:disabled) {
		border-color: var(--color-accent);
		background: var(--color-hover);
	}
	.error {
		background: var(--color-error-bg);
		border: 1px solid var(--color-error-border);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		margin: var(--space-3) 0;
		font-size: var(--font-sm);
		color: var(--color-error);
	}
	.error pre {
		margin: var(--space-1) 0 0;
		white-space: pre-wrap;
		font-size: var(--font-xs);
	}
	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-3);
	}
	.note {
		font-size: var(--font-2xs);
		color: var(--color-text-muted);
	}
	.primary {
		font: inherit;
		font-size: var(--font-sm);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid var(--color-accent);
		background: var(--color-accent);
		color: var(--color-lightness-99);
		cursor: pointer;
	}
	.primary:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.code {
		background: var(--color-lightness-97);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		font-size: var(--font-xs);
		overflow-x: auto;
	}
	h3 {
		margin: var(--space-4) 0 var(--space-2);
		font-size: var(--font-md);
	}
</style>
