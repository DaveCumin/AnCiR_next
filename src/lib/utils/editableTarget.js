// Which keyboard events belong to a form field rather than to the app around it.
//
// App-wide shortcuts listen on the window or the document, so they also hear keys typed into a
// box. Each one asks here first:
//
//   isEditableTarget   any input, textarea, select or contenteditable. Cmd/Ctrl+A, C, V, G and
//                      Delete/Backspace leave these alone (the field has its own meaning for them,
//                      or the key would delete a node from under a focused control).
//   isTextEntryTarget  a field the user types text into (not a checkbox, radio, slider, button,
//                      colour or file input, and not a select). These have their own text undo.
//   yieldEscapeToField Escape in a text field or a select cancels that field's edit (the field's
//                      own handler, or the plot panel's recorder, does the cancelling) and moves
//                      focus out of it; nothing else happens. The NEXT Escape, with focus no
//                      longer in a field, reaches the app (deselect, stop the tour, ...).

const NON_TEXT_INPUT = new Set([
	'checkbox',
	'radio',
	'range',
	'button',
	'submit',
	'reset',
	'color',
	'file',
	'image',
	'hidden'
]);

/** @param {EventTarget | Element | null | undefined} target */
export function isEditableTarget(target) {
	const el = /** @type {any} */ (target);
	if (!el) return false;
	const tag = el.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/** @param {EventTarget | Element | null | undefined} target */
export function isTextEntryTarget(target) {
	const el = /** @type {any} */ (target);
	if (!el) return false;
	if (el.tagName === 'TEXTAREA' || el.isContentEditable === true) return true;
	return el.tagName === 'INPUT' && !NON_TEXT_INPUT.has(String(el.type ?? '').toLowerCase());
}

/**
 * For a window or document Escape handler: true when this Escape belongs to the focused field
 * (a text field or a select), in which case the caller does nothing else. The field is blurred
 * so the next Escape reaches the app.
 *
 * Runs after the field's own handlers (a window or document listener hears the key last), so a
 * field that restores its value on Escape has done so; an editor that removes its input on
 * Escape (an inline rename) leaves a detached target, which still counts as the field's.
 *
 * @param {KeyboardEvent} e
 */
export function yieldEscapeToField(e) {
	if (e?.key !== 'Escape') return false;
	const el = /** @type {any} */ (e.target);
	if (!isTextEntryTarget(el) && el?.tagName !== 'SELECT') return false;
	if (el.isConnected && typeof el.blur === 'function') el.blur();
	return true;
}
