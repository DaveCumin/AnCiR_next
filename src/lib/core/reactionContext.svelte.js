// src/lib/core/reactionContext.svelte.js
//
// Whether the code running now is the app REACTING to a change (an $effect or a template
// expression) rather than handling a user's gesture. Lives in a .svelte.js module because
// $effect.tracking() is a rune; operations.js is plain JS. See recordGraphMutation.
export function inReaction() {
	return $effect.tracking();
}
