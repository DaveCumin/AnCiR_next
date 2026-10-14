// @ts-nocheck
// Live result tables published by analysis nodes (plan 2026-10-15 "fold Data View into
// Table", 2.3).
//
// An analysis node keeps its results (Cosinor's fits, a permutation test's distribution) in
// its component's $state; they are not saved and live only in whichever instance of the node
// is mounted (on the canvas, in the control panel, or hidden in NodeComputeHost, which keeps
// exactly one instance of every table process mounted). A node publishes its tables here
// with `useNodeResultTables`, and a Table in "Node results" mode reads them with
// `readNodeResultTable`. The read calls the node's own getter, so a Table's derived depends
// on the node's state directly and follows every recompute, mounted or not.
//
// Two instances of one node can be mounted at once (expanded on the canvas and selected in
// the control panel), so a node id holds a LIST of registrations; each instance removes only
// its own on teardown. Both follow the same memo payload, so either answers.
import { SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';

/** nodeId -> [{ tables }] (replaced wholesale, never mutated, so reads stay reactive). */
const registry = new SvelteMap();

/**
 * Publish `tables` for `nodeId` until the returned function is called.
 * `tables` is `{ [key]: { title: string, get: () => ({ headers, rows }) } }`.
 */
export function registerNodeResultTables(nodeId, tables) {
	const reg = { tables };
	untrack(() => registry.set(nodeId, [...(registry.get(nodeId) ?? []), reg]));
	return () =>
		untrack(() => {
			const next = (registry.get(nodeId) ?? []).filter((r) => r !== reg);
			if (next.length) registry.set(nodeId, next);
			else registry.delete(nodeId);
		});
}

/**
 * Component hook: publish this node instance's result tables while it is mounted.
 * Call once in the node component's instance script, e.g.
 * `useNodeResultTables(() => \`tableprocess_${p.id}\`, { stats: { title, get } })`.
 */
export function useNodeResultTables(getNodeId, tables) {
	$effect(() => {
		const id = getNodeId();
		if (id == null) return;
		return registerNodeResultTables(id, tables);
	});
}

/**
 * The live `{ headers, rows }` of one of a node's result tables, or null when no mounted
 * instance publishes it or none has a result yet (empty headers). Reactive: it reads the
 * registry and runs the node's getter.
 */
export function readNodeResultTable(nodeId, key) {
	if (nodeId == null || key == null) return null;
	for (const reg of registry.get(nodeId) ?? []) {
		const t = reg.tables?.[key];
		if (typeof t?.get !== 'function') continue;
		let v;
		try {
			v = t.get();
		} catch (e) {
			console.warn(`Result table ${key} of ${nodeId} failed:`, e?.message ?? e);
			continue;
		}
		if (Array.isArray(v?.headers) && v.headers.length > 0) {
			return { headers: v.headers, rows: Array.isArray(v.rows) ? v.rows : [] };
		}
	}
	return null;
}

/** The tables a node publishes, as `[{ key, title }]` (for the Table's source picker). */
export function listNodeResultTables(nodeId) {
	const out = [];
	for (const reg of registry.get(nodeId) ?? []) {
		for (const [key, t] of Object.entries(reg.tables ?? {})) {
			if (!out.some((x) => x.key === key)) out.push({ key, title: t?.title ?? key });
		}
	}
	return out;
}

/** The title a node gives one of its tables, or null when it does not publish it. */
export function nodeResultTableTitle(nodeId, key) {
	return listNodeResultTables(nodeId).find((t) => t.key === key)?.title ?? null;
}

/** Every node id that currently publishes at least one result table. */
export function publishingNodeIds() {
	return [...registry.keys()];
}

/** Forget every registration (session reset). Mounted instances re-register on remount. */
export function clearNodeResultTables() {
	registry.clear();
}
