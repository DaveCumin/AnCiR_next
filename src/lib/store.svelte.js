import { writable } from 'svelte/store';

export const currentState = $state({ tab: 'data', });
export const data = $state([]);
