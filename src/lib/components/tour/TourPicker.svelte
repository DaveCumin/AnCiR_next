<script>
	// @ts-nocheck
	// Modal launched from the navbar Help (?) menu. Lists the available guided
	// tours (loaded lazily) and starts the chosen one. Shows a ✓ for tours the
	// user has completed before.
	import { tourState, closePicker, startTour, loadTourList, completedSet } from '$lib/core/tourRunner.svelte.js';

	let tours = $state([]);
	let loading = $state(false);
	let loadError = $state('');
	let done = $state(new Set());
	let requested = false;

	// Lessons are hidden until revealed by the admin keystroke (see tourRunner).
	const visibleTours = $derived(
		tourState.showLessons ? tours : tours.filter((t) => t.kind !== 'lesson')
	);

	$effect(() => {
		if (tourState.pickerOpen && !requested) {
			requested = true;
			loading = true;
			loadError = '';
			done = completedSet();
			loadTourList()
				.then((list) => {
					tours = list;
				})
				.catch((err) => {
					loadError = err?.message ?? String(err);
				})
				.finally(() => {
					loading = false;
				});
		}
		if (!tourState.pickerOpen) requested = false;
	});

	function pick(t) {
		startTour(t);
	}
</script>

{#if tourState.pickerOpen}
	<div
		class="tp-backdrop"
		role="presentation"
		onclick={(e) => {
			if (e.target === e.currentTarget) closePicker();
		}}
	>
		<div class="tp-card" role="dialog" aria-label="Take a tour">
			<div class="tp-head">
				<h2>Take a tour</h2>
				<button class="tp-close" type="button" aria-label="Close" onclick={closePicker}>✕</button>
			</div>
			<p class="tp-sub">Short, hands-on walkthroughs. You drive — they guide.</p>

			{#if loading}
				<div class="tp-empty">Loading tours…</div>
			{:else if loadError || visibleTours.length === 0}
				<div class="tp-empty">No tours available.</div>
			{:else}
				<div class="tp-list">
					{#each visibleTours as t (t.id)}
						<button
							class="tp-item"
							type="button"
							data-testid={`tour-item-${t.id}`}
							onclick={() => pick(t)}
						>
							<div class="tp-item-main">
								<span class="tp-item-name">
									{t.name}
									{#if t.kind === 'lesson'}<span class="tp-badge" title="Hidden lesson (admin)">lesson</span>{/if}
									{#if done.has(t.id)}<span class="tp-done" title="Completed before">✓</span>{/if}
								</span>
								<span class="tp-item-desc">{t.description}</span>
							</div>
							{#if t.estMinutes}<span class="tp-item-time">~{t.estMinutes} min</span>{/if}
						</button>
					{/each}
				</div>
				{#if tourState.showLessons}
					<p class="tp-admin-note">Lessons shown (admin) — press the shortcut again to hide.</p>
				{/if}
			{/if}
		</div>
	</div>
{/if}

<style>
	.tp-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100002;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
		backdrop-filter: blur(2px);
	}

	.tp-card {
		width: 30rem;
		max-width: calc(100vw - 24px);
		background: var(--surface-card);
		border-radius: 10px;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.25);
		padding: var(--space-6) 1.1rem 1.1rem;
		box-sizing: border-box;
	}

	.tp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.tp-head h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.tp-close {
		border: none;
		background: transparent;
		font-size: 1rem;
		cursor: pointer;
		color: var(--color-text-muted, #666);
	}
	.tp-close:hover {
		color: var(--color-lightness-20, #2a2a2a);
	}

	.tp-sub {
		margin: var(--space-2) 0 0.9rem;
		color: var(--color-text-muted, #666);
		font-size: 0.85rem;
	}

	.tp-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.tp-item {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		text-align: left;
		padding: 0.7rem 0.8rem;
		border: 1px solid var(--color-lightness-85, #ddd);
		border-radius: var(--radius-lg);
		background: var(--surface-card);
		cursor: pointer;
		font: inherit;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}

	.tp-item:hover {
		background: var(--color-lightness-97, #f7f7f7);
		border-color: var(--color-accent);
	}

	.tp-item-main {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
		flex: 1 1 auto;
	}

	.tp-item-name {
		font-weight: 600;
		color: var(--color-lightness-20, #2a2a2a);
	}

	.tp-done {
		color: #1f8c4f;
		margin-left: 0.35rem;
		font-size: 0.85em;
	}

	.tp-badge {
		margin-left: 0.4rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
		background: var(--color-lightness-90, #e8e8e8);
		color: var(--color-text-muted, #666);
		font-size: 0.68rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		vertical-align: middle;
	}

	.tp-admin-note {
		margin: 0.9rem 0 0;
		color: var(--color-text-muted, #666);
		font-size: 0.76rem;
		font-style: italic;
	}

	.tp-item-desc {
		font-size: 0.82rem;
		color: var(--color-text-muted, #666);
	}

	.tp-item-time {
		flex: 0 0 auto;
		font-size: 0.78rem;
		color: var(--color-text-muted, #666);
	}

	.tp-empty {
		padding: var(--space-6) 0.3rem;
		color: var(--color-text-muted, #666);
		font-size: 0.9rem;
	}
</style>
