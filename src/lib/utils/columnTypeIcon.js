// Column type -> icon, shared by the type selector and every canvas node that lists columns,
// so a type looks the same everywhere. Numeric columns use '#' (UI-21): the old 'math' glyph
// read as a percent sign. Unknown or older types fall back to the numeric icon.

/** @type {Record<string, {icon: string, label: string}>} */
export const COLUMN_TYPE_META = Object.freeze({
	number: { icon: 'hash', label: 'Numeric' },
	category: { icon: 'list', label: 'Category' },
	time: { icon: 'clock', label: 'Time' },
	bin: { icon: 'table', label: 'Bin' }
});

const FALLBACK_ICON = COLUMN_TYPE_META.number.icon;

/** Icon name for a column type. */
export function columnTypeIcon(type) {
	return COLUMN_TYPE_META[type]?.icon ?? FALLBACK_ICON;
}

/** Icon and label for a column (labelled with its raw type when the type is unknown). */
export function columnTypeMeta(col) {
	return COLUMN_TYPE_META[col?.type] ?? { icon: FALLBACK_ICON, label: col?.type || 'value' };
}
