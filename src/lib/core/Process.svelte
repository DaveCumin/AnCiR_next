<script module>
	// @ts-nocheck
	import { appConsts } from '$lib/core/core.svelte';

	let _counter = 0;

	export class Process {
		id;
		name = '';
		args = $state({});
		parentCol = $state();

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
			} else {
				//Now put in the args, if provided, or use defaults
				if (dataIN.args) {
					this.args = dataIN.args;
				} else {
					this.args = Object.fromEntries(
						Array.from(appConsts.processMap.get(this.name).defaults.entries()).map(
							([key, value]) => [key, value.val]
						)
					);
				}
			}
			//set the type of data of the parent - for display purposes
			this.parentCol = parent;
		}

		// Perform processes (add/filer etc)
		doProcess(data) {
			return appConsts.processMap.get(this.name).func(data, this.args);
		}

		toJSON() {
			return {
				id: this.id,
				name: this.name,
				args: this.args
			};
		}

		static fromJSON(json, column) {
			const { id, name, args } = json;
			return new Process({ name, args }, column, id);
		}
	}
</script>

<script>
	let { p } = $props();
	console.log(p);
	console.log(appConsts.processMap.get(p.name));
	const Process = appConsts.processMap.get(p.name).component ?? null;
</script>

{#if Process}
	<Process {p} />
{:else}
	<div>Error: No component found for process "{p.name}"</div>
{/if}
