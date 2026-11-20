<script module>
	// @ts-nocheck
	import { appConsts, core } from '$lib/core/core.svelte';
	import { reportUnknownNode } from '$lib/core/unknownNode.js';
	import { loadKeepingUnknown } from '$lib/core/unknownFields.js';
	import { refusesInputType } from '$lib/core/processInputRules.js';

	let _counter = 0;
	let _linkedGroupCounter = 0;

	// Only for a store that has just been emptied (the headless engine's fresh session,
	// mcp/src/engine/session.js): ids then restart at 0 so the same build gives the same ids.
	// Never call it while any column process is still live: it would hand out a held id again.
	export function resetProcessIdCounters() {
		_counter = 0;
		_linkedGroupCounter = 0;
	}

	export function nextLinkedGroupId() {
		return _linkedGroupCounter++;
	}

	/**
	 * Find all processes that share the same linkedGroupId.
	 */
	export function getLinkedProcesses(linkedGroupId) {
		if (linkedGroupId == null) return [];
		const result = [];
		for (const col of core.data) {
			for (const p of col.processes) {
				if (p.linkedGroupId === linkedGroupId) {
					result.push(p);
				}
			}
		}
		return result;
	}

	export class Process {
		id;
		name = '';
		displayName = $state('');
		args = $state({});
		parentCol = $state();
		linkedGroupId = $state(null);

		constructor({ ...dataIN }, parent, id = null) {
			if (id === null) {
				this.id = id ?? _counter;
				_counter++;
			} else {
				this.id = id;
				_counter = Math.max(id + 1, _counter + 1);
			}
			//set the name
			this.name = dataIN.name;

			//return an error if the function doesn't exist
			if (!appConsts.processMap.has(this.name)) {
				// Was marked in args but never logged, so a session referring to a
				// removed column process looked merely inert.
				this.args = { error: reportUnknownNode('column process', this.name) };
				this.displayName = this.name;
			} else {
				const processInfo = appConsts.processMap.get(this.name);
				this.displayName = processInfo.displayName || this.name;

				// Start from the registry defaults, then let any provided args
				// override. (Provided args alone could omit keys with defaults — e.g.
				// a palette-spawned Add passing only { inIN } would otherwise have no
				// `value` and compute NaN.)
				const defaults = Object.fromEntries(
					Array.from(processInfo.defaults?.entries() ?? []).map(([key, value]) => [key, value.val])
				);
				this.args = { ...defaults, ...(dataIN.args ?? {}) };
			}
			//set the type of data of the parent - for display purposes
			this.parentCol = parent;

			// Set linked group id if provided
			if (dataIN.linkedGroupId != null) {
				this.linkedGroupId = dataIN.linkedGroupId;
				_linkedGroupCounter = Math.max(dataIN.linkedGroupId + 1, _linkedGroupCounter);
			}
		}

		// The column this process operates on. Inline (legacy) processes carry a
		// real parentCol; free dataflow nodes don't — their input is the first
		// column in args.inIN. Editors should read p.inputCol (not p.parentCol) so
		// they work the same whether the node is free or owned by a column.
		get inputCol() {
			if (this.parentCol) return this.parentCol;
			const raw = this.args?.inIN;
			const id = Array.isArray(raw) ? raw[0] : raw;
			if (id == null || id < 0) return null;
			return core.data.find((c) => c.id === id) ?? null;
		}

		// Perform processes (add/filer etc). `inputColId` names the column `data` came from
		// when a FREE node runs one of its several inputs (producerRuntime): the func then sees
		// it as args.parentColId (Filter reads `data` for a condition on that column), not the
		// node's first input, which is all the editor can write.
		doProcess(data, inputColId = null) {
			const proc = appConsts.processMap.get(this.name);
			if (!proc) {
				reportUnknownNode('column process', this.name);
				return data;
			}
			// A column of a type the process refuses (`disallowTypes`), wired before the rule
			// existed (a saved session), passes through unchanged; the node says why
			// (processInputRules.refusedInputWarnings). Computing on it would treat a time
			// column's epoch milliseconds as numbers.
			const inCol =
				inputColId != null ? (core.data ?? []).find((c) => c.id === inputColId) : this.parentCol;
			if (refusesInputType(proc, inCol?.type)) return data;
			const args = inputColId == null ? this.args : { ...this.args, parentColId: inputColId };
			return proc.func(data, args);
		}

		toJSON() {
			const out = {
				id: this.id,
				name: this.name,
				args: this.args
			};
			if (this.linkedGroupId != null) {
				out.linkedGroupId = this.linkedGroupId;
			}
			return out;
		}

		// Fields of the saved process this version does not read are kept and saved again (ROB-22).
		static fromJSON(json, column) {
			return loadKeepingUnknown(json, (saved) => {
				const { id, name, args, linkedGroupId } = saved;
				return new Process({ name, args, linkedGroupId: linkedGroupId ?? null }, column, id);
			});
		}
	}
</script>

<script>
	let { p } = $props();
	const ProcessComponent = $derived(appConsts.processMap.get(p.name)?.component ?? null);
</script>

{#if ProcessComponent}
	<ProcessComponent {p} />
{:else}
	<div>Error: No component found for process "{p.name}"</div>
{/if}
