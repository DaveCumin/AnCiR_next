<<<<<<< HEAD
import { writable } from 'svelte/store';

export const currentTab = writable('data');
export const data = $state([]);
=======
export const currentTab = $state({ tab: 'data' });
export const data = $state({ data: [] });
>>>>>>> 03e8777f39b5e39551fdae22c973edfb318b4082
