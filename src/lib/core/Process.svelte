<script module>
	import { appConsts } from '$lib/core/theCore.svelte';

	let processidCounter = 0;

	export class Process {
		processid;
		name = '';
		args = $state({});
		parentCol = $state();

		constructor({ ...dataIN }, parent, id = null) {
			if (id === null) {
				this.processid = id ?? processidCounter;
				processidCounter++;
			} else {
				this.processid = id;
				processidCounter = Math.max(id + 1, processidCounter + 1);
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

		doProcess(data) {
			return appConsts.processMap.get(this.name).func(data, this.args);
		}

		toJSON() {
			return {
				processid: this.processid,
				name: this.name,
				args: this.args
			};
		}
		static fromJSON(json, column) {
			const { processid, name, args } = json;
			return new Process({ name, args }, column, processid);
		}
	}
</script>

<script>
	let { p } = $props();
	const Process = appConsts.processMap.get(p.name).component ?? null;
</script>

{#if Process}
	<Process {p} />
{:else}
	<div>Error: No component found for process "{p.name}"</div>
{/if}
