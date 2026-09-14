// @ts-nocheck
/**
 * dataEnteringProcess(p): the array a column-process sees as its input — the
 * data as it stands JUST BEFORE this process runs.
 *
 * Two shapes of process exist (Process.svelte):
 *  - FREE dataflow nodes (no parentCol): the input is simply the wired input
 *    column's processed data (p.inputCol resolves args.inIN).
 *  - INLINE legacy processes (owned by a column): the input must be
 *    reconstructed — raw data (or the referenced column's data), time/bin
 *    coercion, then every process BEFORE this one applied in order.
 *
 * Extracted from RemoveTrend.svelte's trendStats (where the reconstruction
 * lived inline) so process editors AND the definitions' derived-warning hooks
 * (`definition.getWarnings`) share ONE copy. OutlierRemoval.svelte carries a
 * sibling of this logic; candidates for the same refactor.
 *
 * Reads reactive state (columns, core.rawData), so calling it inside a
 * $derived tracks the right dependencies. Returns null when the input cannot
 * be resolved (nothing wired, missing raw data).
 */
import { core } from '$lib/core/core.svelte.js';
import { getUNIXDate } from '$lib/utils/time/TimeUtils.js';

export function dataEnteringProcess(p) {
	const col = p?.parentCol;
	if (!col) {
		// Free dataflow node: data entering = the input column's data.
		const inData = p?.inputCol?.getData();
		return inData ? [...inData] : null;
	}

	if (!col.processes) return null;
	const processIndex = col.processes.findIndex((proc) => proc.id === p.id);
	if (processIndex < 0) return null;

	// Reconstruct data as it enters this process (legacy inline path)
	let data;
	if (col.isReferencial()) {
		const refData = col.refColumn?.getData();
		if (!refData) return null;
		data = [...refData];
	} else {
		const rawData = core.rawData.get(col.data);
		if (!rawData) return null;
		if (col.compression === 'awd') {
			data = new Array(rawData.length);
			for (let i = 0; i < rawData.length; i++) data[i] = rawData.start + i * rawData.step;
		} else {
			data = [...rawData];
		}
		if (col.type === 'time' && col.compression !== 'awd') {
			try {
				data = data.map((v) => Number(getUNIXDate(v, col.timeFormat)));
			} catch {
				/* ignore */
			}
		}
		if (col.type === 'bin') data = data.map((v) => v + col.binWidth / 2);
	}
	for (let i = 0; i < processIndex; i++) data = col.processes[i].doProcess(data);
	return data;
}
