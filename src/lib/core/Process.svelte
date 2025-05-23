<script module>
	import { processMap } from '$lib/processes/processMap';

	let processidCounter = 0;

	export class Process {
		static processFuncMap;
		processid;
		name = '';
		processFunc;
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
			//set the function and return an error if it doesn't exist
			const funcEntry = processMap.get(this.name);
			if (!funcEntry) {
				this.processFunc = (x) => {
					return x;
				};
				this.args = { error: `no function ${this.name}` };
			} else {
				this.processFunc = funcEntry.func;
				//Now put in the args
				if (dataIN.args) {
					this.args = dataIN.args;
				} else {
					this.args = Object.fromEntries(
						Array.from(funcEntry.defaults.entries()).map(([key, value]) => [key, value.val])
					);
				}
			}
			//set the type of data of the parent - for display purposes
			this.parentCol = parent;
		}

		doProcess(data) {
			return this.processFunc(data, this.args);
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
	const Process = processMap.get(p.name).component ?? null;
</script>

{#if Process}
	<Process {p} />
{:else}
	<div>Error: No component found for process "{p.name}"</div>
{/if}
