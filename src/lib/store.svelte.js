import { writable } from 'svelte/store';

export const currentState = $state({ tab: 'data', context: 'none'});
export const data = $state([]);
