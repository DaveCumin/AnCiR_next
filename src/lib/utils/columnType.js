// @ts-nocheck
// Shared helper for in-place column type changes. When a column is switched to
// 'time' and has no format yet, sniff one from its first rows so it renders as
// dates rather than raw numbers. Used by every TypeSelector that can retype a raw
// column (control panel Column.svelte, WorkflowNode, TableProcessNode, GroupNode).
import { core } from '$lib/core/core.svelte.js';
import { addNotification } from '$lib/core/notifications.svelte.js';
import { guessDateofArray, hasTimeFormat } from '$lib/utils/time/TimeUtils.js';

export function sniffTimeFormatOnTypeChange(col, newType) {
	if (!col || newType !== 'time') return;
	if (hasTimeFormat(col.timeFormat)) return;
	const rawData = core.rawData.get(col.data);
	if (!Array.isArray(rawData) || rawData.length === 0) return;
	// Numeric data is already epoch-ms and needs no parse format.
	if (!rawData.some((v) => typeof v === 'string' && v.trim() !== '')) return;
	const sample = rawData.slice(0, 10);
	const guessed = guessDateofArray(sample);
	if (hasTimeFormat(guessed)) {
		col.timeFormat = guessed;
		return;
	}
	addNotification(
		`Could not recognise a time format for "${col.name}". Enter one in its Time Format field (for example YYYY-MM-DD H:mm:ss); until then its values are blank.`,
		'warning',
		10000
	);
}
