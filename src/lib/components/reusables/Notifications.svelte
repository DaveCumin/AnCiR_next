<script>
	import {
		notifications,
		removeNotification,
		dismissNotification,
		setActionable,
		isActionable,
		holdNotification,
		isToastKey,
		TOAST_KEYSHORTCUTS
	} from '$lib/core/notifications.svelte.js';
	import Icon from '$lib/icons/Icon.svelte';
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';

	const icons = {
		// Not a cross: that is the close button's glyph, so an error toast read as two close buttons.
		error: '!',
		warning: '⚠',
		info: 'ℹ'
	};

	let container = $state(null);
	// Where focus was before the user came into the toasts (by Alt+T / F8, or by Tab), so
	// closing a toast from the keyboard puts them back where they were working.
	let returnTo = null;

	// A working action stops its toast's clock; a stale one (an Undo buried by later edits)
	// starts it. `enabled()` reads $state (the undo stack), so this re-runs when that changes.
	$effect(() => {
		for (const n of notifications.list) setActionable(n.id, isActionable(n));
	});

	const toastEl = (id) => container?.querySelector(`[data-toast-id="${id}"]`);

	/** The newest toast with a working action, else the newest toast. */
	function newestTarget() {
		const list = notifications.list;
		for (let i = list.length - 1; i >= 0; i--) if (isActionable(list[i])) return list[i];
		return list[list.length - 1] ?? null;
	}

	function onWindowKeydown(e) {
		if (!isToastKey(e) || notifications.list.length === 0) return;
		const target = newestTarget();
		const el = target && toastEl(target.id);
		const button = el?.querySelector('.toast-action') ?? el?.querySelector('.toast-close');
		if (!button) return;
		e.preventDefault();
		if (!container.contains(document.activeElement)) returnTo = document.activeElement;
		button.focus();
	}

	function onFocusIn(e) {
		// Came in by Tab (or a click) from elsewhere: remember where from.
		const from = e.relatedTarget;
		if (from instanceof HTMLElement && !container.contains(from)) returnTo = from;
	}

	// Escape on a focused toast closes it, as its close button would. Not for a toast whose
	// close means "throw this away" (onDismiss: the crash-copy offer): a stray Escape must not
	// discard a session, so there it only takes the user back.
	function onToastKeydown(e, n) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		if (n.onDismiss) {
			restoreFocus(null);
			return;
		}
		closeToast(n.id, () => dismissNotification(n.id));
	}

	/** Remove toast `id` (via `remove`) and, if focus was in it, put focus somewhere sensible. */
	async function closeToast(id, remove) {
		const el = toastEl(id);
		const hadFocus = !!el?.contains(document.activeElement);
		const idx = notifications.list.findIndex((n) => n.id === id);
		remove();
		if (!hadFocus) return;
		await tick();
		const next = notifications.list[Math.min(idx, notifications.list.length - 1)];
		restoreFocus(next ? toastEl(next.id) : null);
	}

	// Pointer and focus on a toast pause the timers (they are not controls: the toast's
	// controls are its buttons, and Escape is a shortcut for its close button). An attachment,
	// so the toast stays a plain element rather than a static one with handlers.
	function toastEvents(notif) {
		return (el) => {
			const hover = (on) => () => holdNotification(notif.id, 'hover', on);
			const enter = hover(true);
			const leave = hover(false);
			const focusIn = () => holdNotification(notif.id, 'focus', true);
			const focusOut = (e) => {
				if (!el.contains(e.relatedTarget)) holdNotification(notif.id, 'focus', false);
			};
			const key = (e) => onToastKeydown(e, notif);
			el.addEventListener('pointerenter', enter);
			el.addEventListener('pointerleave', leave);
			el.addEventListener('focusin', focusIn);
			el.addEventListener('focusout', focusOut);
			el.addEventListener('keydown', key);
			return () => {
				el.removeEventListener('pointerenter', enter);
				el.removeEventListener('pointerleave', leave);
				el.removeEventListener('focusin', focusIn);
				el.removeEventListener('focusout', focusOut);
				el.removeEventListener('keydown', key);
			};
		};
	}

	// Back where the user was working; else the next toast's first button; else nowhere in
	// particular (the body), which is what the browser does for a removed element anyway.
	function restoreFocus(fallbackToast) {
		if (returnTo?.isConnected && returnTo.getClientRects().length) {
			returnTo.focus();
			return;
		}
		fallbackToast?.querySelector('button')?.focus();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- The toasts are read aloud through the app's live regions when they are added
     (notifications.svelte.js, utils/announce.js), so this is NOT a live region itself (that
     would read every toast twice); this landmark lets a keyboard or screen reader user find a
     toast's buttons (Undo, Restore, Close) while one is showing. Alt+T or F8 jumps to the newest
     one; Escape closes the focused one. -->
<div
	class="notifications-container"
	bind:this={container}
	role={notifications.list.length ? 'region' : undefined}
	aria-label={notifications.list.length ? 'Notifications' : undefined}
	onfocusin={onFocusIn}
>
	{#each notifications.list as notif (notif.id)}
		<div
			class="toast toast--{notif.type}"
			data-toast-id={notif.id}
			transition:fly={{ y: 20, duration: 260 }}
			{@attach toastEvents(notif)}
		>
			<span class="toast-icon" aria-hidden="true">{icons[notif.type] ?? icons.info}</span>
			<span class="toast-message">{notif.message}</span>
			{#if isActionable(notif)}
				<!-- `enabled` is read during render, so any $state it consults (e.g. the
				     undo stack) re-evaluates reactively and a stale action hides itself. -->
				<button
					class="toast-action"
					aria-keyshortcuts={TOAST_KEYSHORTCUTS}
					onclick={() => {
						notif.action.run();
						closeToast(notif.id, () => removeNotification(notif.id));
					}}
				>
					{notif.action.label}
				</button>
			{/if}
			<button
				class="icon toast-close"
				aria-label={notif.onDismiss ? 'Dismiss' : 'Close'}
				title={notif.onDismiss ? 'Dismiss' : 'Close'}
				onclick={() => closeToast(notif.id, () => dismissNotification(notif.id))}
			>
				<Icon name="close" width={16} height={16} />
			</button>
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
		gap: var(--space-4);
		z-index: 9999;
		pointer-events: none;
		width: max-content;
		max-width: min(42rem, 90vw);
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
		border-radius: var(--radius-md);
		box-shadow:
			0 4px 12px rgba(0, 0, 0, 0.15),
			0 1px 4px rgba(0, 0, 0, 0.08);
		font-size: var(--font-body);
		line-height: 1.5;
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

	.toast-action {
		background: none;
		border: none;
		padding: 0;
		margin: 0 0.2rem;
		cursor: pointer;
		font-size: var(--font-body);
		font-weight: 600;
		flex-shrink: 0;
		line-height: 1.5;
		/* Inherits the toast type's text colour so it reads as part of the toast;
		   the underline is what marks it as actionable. */
		color: inherit;
		text-decoration: underline;
		border-radius: var(--radius-xs);
	}

	.toast-action:hover {
		opacity: 0.75;
	}

	/* The close button: a 22 px square centred on the first line of text (1.5 line height),
	   so it lines up with the message and the action whatever the toast's height. Its
	   pointer target is the app's 24 px button.icon box. The glyph takes the toast type's text
	   colour at rest (muted grey on the tinted toasts was under 4.5:1 on some of them), with
	   a tinted square on hover. */
	.toast-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		margin: calc((1.5em - 22px) / 2) 0 0;
		padding: 0;
		border: none;
		border-radius: var(--radius-xs);
		background: none;
		color: inherit;
		opacity: 0.8;
		cursor: pointer;
	}

	.toast-close:hover {
		opacity: 1;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}

	.toast-close:focus-visible {
		opacity: 1;
		outline-offset: 1px;
	}
</style>
