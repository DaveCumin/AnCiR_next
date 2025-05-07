import { writable } from "svelte/store";


export const currentTab = writable('data');
export const data = writable([]);