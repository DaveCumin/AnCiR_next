<script>
	import { notifications, removeNotification } from '$lib/core/notifications.svelte.js';
	import { fly } from 'svelte/transition';

	const icons = {
		error: '✕',
		warning: '⚠',
		info: 'ℹ'
	};
</script>

<div class="notifications-container">
	{#each notifications.list as notif (notif.id)}
		<div
			class="toast toast--{notif.type}"
			transition:fly={{ y: 20, duration: 260 }}
		>
			<span class="toast-icon">{icons[notif.type] ?? icons.info}</span>
			<span class="toast-message">{notif.message}</span>
			<button class="toast-close" onclick={() => removeNotification(notif.id)}>✕</button>
		</div>
	{/each}
</div>

<style>
	.notifications-container {
		position: fixed;
		bottom: 1.5rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 9999;
		pointer-events: none;
		width: max-content;
		max-width: min(42rem, 90vw);
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius-md);
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.15),
			0 1px 4px rgba(0, 0, 0, 0.08);
		font-size: 0.875rem;
		line-height: 1.4;
		pointer-events: all;
		border-left: 4px solid transparent;
	}

	.toast--error {
		background: #fff5f5;
		border-left-color: #c0392b;
		color: #5f1c18;
	}

	.toast--warning {
		background: #fffbf0;
		border-left-color: #e67e22;
		color: #5c3a00;
	}

	.toast--info {
		background: #f0f6ff;
		border-left-color: #3e7295;
		color: #1a3a52;
	}

	.toast-icon {
		font-size: 0.85rem;
		flex-shrink: 0;
		margin-top: 0.05rem;
	}

	.toast-message {
		flex: 1;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.toast-close {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		font-size: 0.75rem;
		opacity: 0.5;
		flex-shrink: 0;
		line-height: 1;
		color: inherit;
		border-radius: 0;
	}

	.toast-close:hover {
		opacity: 1;
	}
</style>
