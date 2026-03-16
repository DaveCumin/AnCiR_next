<script module>
	// @ts-nocheck
	import { appConsts, core } from '$lib/core/core.svelte';

	let _counter = 0;
	let _linkedGroupCounter = 0;

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
				this.args = { error: `no function ${this.name}` };
				this.displayName = this.name;
			} else {
				const processInfo = appConsts.processMap.get(this.name);
				this.displayName = processInfo.displayName || this.name;

				//Now put in the args, if provided, or use defaults
				if (dataIN.args) {
					this.args = dataIN.args;
				} else {
					this.args = Object.fromEntries(
						Array.from(processInfo.defaults.entries()).map(([key, value]) => [key, value.val])
					);
				}
			}
			//set the type of data of the parent - for display purposes
			this.parentCol = parent;

			// Set linked group id if provided
			if (dataIN.linkedGroupId != null) {
				this.linkedGroupId = dataIN.linkedGroupId;
				_linkedGroupCounter = Math.max(dataIN.linkedGroupId + 1, _linkedGroupCounter);
			}
		}

		// Perform processes (add/filer etc)
		doProcess(data) {
			const proc = appConsts.processMap.get(this.name);
			if (!proc) return data;
			return proc.func(data, this.args);
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

		static fromJSON(json, column) {
			const { id, name, args, linkedGroupId } = json;
			return new Process({ name, args, linkedGroupId: linkedGroupId ?? null }, column, id);
		}
	}
</script>

<script>
	let { p } = $props();
	const ProcessComponent = appConsts.processMap.get(p.name)?.component ?? null;
</script>

{#if ProcessComponent}
	<ProcessComponent {p} />
{:else}
	<div>Error: No component found for process "{p.name}"</div>
{/if}
