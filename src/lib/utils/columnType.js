// @ts-nocheck
// Shared helper for in-place column type changes. When a column is switched to
// 'time' and has no format yet, sniff one from its first rows so it renders as
// dates rather than raw numbers. Mirrors the control panel's onTypeChange so the
// node-row TypeSelector (TableProcessNode / GroupNode) behaves identically.
import { core } from '$lib/core/core.svelte.js';
import { guessDateofArray } from '$lib/utils/time/TimeUtils.js';

export function sniffTimeFormatOnTypeChange(col, newType) {
	if (!col || newType !== 'time') return;
	const fmt = col.timeFormat;
	const isEmpty = !fmt || (Array.isArray(fmt) ? fmt.length === 0 : fmt === '');
	if (!isEmpty) return;
	const rawData = core.rawData.get(col.data);
	if (!Array.isArray(rawData) || rawData.length === 0) return;
	const sample = rawData.slice(0, 10);
	const guessed = guessDateofArray(sample);
	if (guessed !== -1 && guessed.length > 0) col.timeFormat = guessed;
}
