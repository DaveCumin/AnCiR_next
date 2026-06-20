<script module>
	// @ts-nocheck
	import { core, getStoredValue } from '$lib/core/core.svelte';
	import NumberWithUnits from '$lib/components/inputs/NumberWithUnits.svelte';

	const displayName = 'Stored Value Group';
	const defaults = new Map([
		['groups', { val: [] }],
		['out', {}],
		['valid', { val: false }]
	]);

	function safeGroupName(group, idx) {
		const raw = String(group?.name ?? '').trim();
		return raw || `Group ${idx + 1}`;
	}

	export function storedvaluegroup(argsIN) {
		const groups = Array.isArray(argsIN.groups) ? argsIN.groups : [];
		const result = { groups: {}, category: [], value: [] };
		let anyValid = false;

		for (let i = 0; i < groups.length; i++) {
			const group = groups[i] ?? {};
			const groupId = group.id ?? `idx_${i}`;
			const groupName = safeGroupName(group, i);
			const keys = Array.isArray(group.keys) ? group.keys : [];
			const vals = [];

			for (const key of keys) {
				if (!(key in core.storedValues)) continue;
				const v = getStoredValue(key);
				if (Number.isFinite(v)) vals.push(v);
			}

			result.groups[groupId] = { name: groupName, keys: [...keys], values: vals };
			for (const v of vals) {
				result.category.push(groupName);
				result.value.push(v);
			}
			if (vals.length > 0) anyValid = true;
		}

		const hasAnyOut = Object.entries(argsIN.out ?? {}).some(
			([key, id]) => key.startsWith('group_') && Number(id) >= 0
		);
		if (hasAnyOut) {
			const processHash = crypto.randomUUID();

			for (const group of groups) {
				const groupId = group?.id;
				if (!groupId) continue;
				const outKey = `group_${groupId}`;
				const outId = Number(argsIN.out?.[outKey]);
				if (outId < 0) continue;
				const outCol = getColumnById(outId);
				if (!outCol) continue;
				const vals = result.groups[groupId]?.values ?? [];
				core.rawData.set(outId, vals);
				outCol.data = outId;
				outCol.type = 'number';
				outCol.tableProcessGUId = processHash;
			}
		}

		return [result, anyValid];
	}

	export const definition = {
		displayName,
		defaults,
		func: storedvaluegroup,
		columnIdFields: {},
		nodeSpec: {
			id: 'tableprocess.storedvaluegroup',
			inputs: [],
			outputs: [
				{ name: 'category', kind: 'column', cardinality: 'one' },
				{ name: 'value', kind: 'column', cardinality: 'one' }
			]
		}
	};
</script>

<script>
	// @ts-nocheck
	import Table from '$lib/components/plotbits/Table.svelte';
	import ColumnComponent from '$lib/core/Column.svelte';
	import { Column, getColumnById, removeColumn } from '$lib/core/Column.svelte';
	import { core as coreState, pushObj } from '$lib/core/core.svelte.js';
	import { onMount, untrack } from 'svelte';

	let { p = $bindable() } = $props();

	let result = $state({ groups: {}, category: [], value: [] });
	let mounted = $state(false);
	let previewStart = $state(1);
	let lastHash = '';

	function cleanupLegacyCombinedOutputs() {
		for (const key of ['value', 'category']) {
			const outId = Number(p.args.out?.[key]);
			if (outId >= 0) {
				coreState.rawData.delete(outId);
				removeColumn(outId);
			}
			if (p.args.out && key in p.args.out) {
				delete p.args.out[key];
			}
		}
	}

	function ensureGroupOutputColumn(group) {
		if (!group?.id || !p.parent) return;
		const outKey = `group_${group.id}`;
		if (Number(p.args.out?.[outKey]) >= 0) {
			const existing = getColumnById(p.args.out[outKey]);
			if (existing) existing.name = `${group.name || 'group'}_${p.id}`;
			return;
		}
		const col = new Column({});
		col.name = `${group.name || 'group'}_${p.id}`;
		pushObj(col);
		p.parent.columnRefs = [col.id, ...p.parent.columnRefs];
		p.args.out[outKey] = col.id;
	}

	function cleanupGroupOutputColumn(groupId) {
		const outKey = `group_${groupId}`;
		const outId = Number(p.args.out?.[outKey]);
		if (outId >= 0) {
			coreState.rawData.delete(outId);
			removeColumn(outId);
		}
		delete p.args.out[outKey];
	}

	function doGroup() {
		previewStart = 1;
		for (const g of p.args.groups ?? []) ensureGroupOutputColumn(g);
		[result, p.args.valid] = storedvaluegroup(p.args);
	}

	let sourceGroups = $derived.by(() => {
		const map = new Map();
		for (const [key, entry] of Object.entries(coreState.storedValues ?? {})) {
			const source = String(entry?.source || 'Other');
			if (!map.has(source)) map.set(source, []);
			map.get(source).push({ key, value: coreState.storedValues[key] ? getStoredValue(key) : NaN });
		}
		return Array.from(map.entries())
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([source, items]) => ({
				source,
				items: items.sort((a, b) => a.key.localeCompare(b.key))
			}));
	});

	let getHash = $derived.by(() => {
		const keysHash = Object.keys(coreState.storedValues ?? {})
			.sort()
			.join('|');
		const selectionHash = JSON.stringify(
			(p.args.groups ?? []).map((g) => ({
				id: g.id,
				name: g.name,
				keys: [...(g.keys ?? [])].sort()
			}))
		);
		const selectedValuesHash = (p.args.groups ?? [])
			.flatMap((g) => g.keys ?? [])
			.filter((k, i, arr) => arr.indexOf(k) === i)
			.sort()
			.map((k) => `${k}:${getStoredValue(k)}`)
			.join('|');
		return `${keysHash}::${selectionHash}::${selectedValuesHash}`;
	});

	$effect(() => {
		const h = getHash;
		if (!mounted) return;
		if (h !== lastHash) {
			untrack(() => doGroup());
			lastHash = h;
		}
	});

	function addGroup() {
		const idx = (p.args.groups?.length ?? 0) + 1;
		const group = { id: crypto.randomUUID(), name: `Group ${idx}`, keys: [] };
		p.args.groups = [...(p.args.groups ?? []), group];
		ensureGroupOutputColumn(group);
		doGroup();
	}

	function removeGroup(groupId) {
		cleanupGroupOutputColumn(groupId);
		p.args.groups = (p.args.groups ?? []).filter((g) => g.id !== groupId);
		doGroup();
	}

	function renameGroup(groupId, name) {
		p.args.groups = (p.args.groups ?? []).map((g) =>
			g.id === groupId ? { ...g, name: String(name || '').trim() || 'Group' } : g
		);
		const group = p.args.groups.find((g) => g.id === groupId);
		if (group) ensureGroupOutputColumn(group);
		doGroup();
	}

	function hasKey(group, key) {
		return (group?.keys ?? []).includes(key);
	}

	function toggleKey(groupId, key) {
		p.args.groups = (p.args.groups ?? []).map((g) => {
			if (g.id !== groupId) return g;
			const keys = new Set(g.keys ?? []);
			if (keys.has(key)) keys.delete(key);
			else keys.add(key);
			return { ...g, keys: Array.from(keys) };
		});
		doGroup();
	}

	function setSourceSelection(groupId, sourceKeys, checked) {
		p.args.groups = (p.args.groups ?? []).map((g) => {
			if (g.id !== groupId) return g;
			const keys = new Set(g.keys ?? []);
			for (const k of sourceKeys) {
				if (checked) keys.add(k);
				else keys.delete(k);
			}
			return { ...g, keys: Array.from(keys) };
		});
		doGroup();
	}

	function sourceSelectionState(group, sourceKeys) {
		const keys = new Set(group?.keys ?? []);
		let selected = 0;
		for (const k of sourceKeys) {
			if (keys.has(k)) selected++;
		}
		return { selected, all: selected > 0 && selected === sourceKeys.length };
	}

	onMount(() => {
		if (!p.args.groups) p.args.groups = [];
		if (!p.args.out) p.args.out = {};
		cleanupLegacyCombinedOutputs();
		for (const group of p.args.groups) {
			if (!group.id) group.id = crypto.randomUUID();
			if (!group.name) group.name = 'Group';
			if (!Array.isArray(group.keys)) group.keys = [];
			ensureGroupOutputColumn(group);
		}
		mounted = true;
		doGroup();
		lastHash = getHash;
	});
</script>

<div class="section-row">
	<div class="tableProcess-label">
		<span>Stored value groups</span>
	</div>
	<div class="control-input-vertical">
		<button class="tp-stat-btn" onclick={addGroup}>+ Add group</button>
	</div>
</div>

{#if (p.args.groups?.length ?? 0) === 0}
	<p>Add a group to start selecting stored values.</p>
{:else}
	<div class="section-row">
		<div class="tableProcess-label"><span>Group selection</span></div>
		<div class="control-input-vertical">
			{#each p.args.groups as group (group.id)}
				<div class="group-card">
					<div class="group-header">
						<input
							type="text"
							value={group.name}
							oninput={(e) => renameGroup(group.id, e.target.value)}
							placeholder="Group name"
						/>
						<button class="remove-btn" onclick={() => removeGroup(group.id)} title="Remove"
							>×</button
						>
					</div>

					{#if sourceGroups.length === 0}
						<p class="hint">No stored values available.</p>
					{:else}
						<div class="source-tree">
							{#each sourceGroups as src}
								{@const keys = src.items.map((it) => it.key)}
								{@const sel = sourceSelectionState(group, keys)}
								<div class="source-block">
									<label class="source-title">
										<input
											type="checkbox"
											checked={sel.all}
											onchange={(e) => setSourceSelection(group.id, keys, e.target.checked)}
										/>
										{src.source} ({sel.selected}/{keys.length})
									</label>
									<div class="source-items">
										{#each src.items as item (item.key)}
											<label class="sv-item">
												<input
													type="checkbox"
													checked={hasKey(group, item.key)}
													onchange={() => toggleKey(group.id, item.key)}
												/>
												<span class="sv-name">{item.key}</span>
												<span class="sv-value"
													>{Number.isFinite(item.value) ? item.value.toPrecision(6) : 'NaN'}</span
												>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if Number(p.args.out?.[`group_${group.id}`]) >= 0}
						<div class="group-output">
							<ColumnComponent col={getColumnById(Number(p.args.out?.[`group_${group.id}`]))} />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<details open>
	<summary class="section-details-summary">Output</summary>
	<div class="section-row">
		<div class="section-content">
			{#if p.args.valid}
				{@const groupCols = (p.args.groups ?? []).map((g, i) => ({
					name: result.groups?.[g.id]?.name ?? safeGroupName(g, i),
					values: result.groups?.[g.id]?.values ?? []
				}))}
				{@const totalRows = Math.max(0, ...groupCols.map((c) => c.values.length))}
				{#if totalRows > 0}
					<Table
						headers={groupCols.map((c) => c.name)}
						data={groupCols.map((c) =>
							c.values
								.slice(previewStart - 1, previewStart + 5)
								.map((v) => (Number.isFinite(v) ? v.toFixed(4) : 'NaN'))
						)}
					/>
					<p>
						Row <NumberWithUnits
							min={1}
							max={Math.max(1, totalRows - 5)}
							step={1}
							bind:value={previewStart}
						/> to {Math.min(previewStart + 5, totalRows)} of {totalRows}
					</p>
				{/if}
			{:else}
				<p>Select at least one finite stored value in a group.</p>
			{/if}
		</div>
	</div>
</details>

<style>
	.hint {
		font-size: var(--font-xs);
		color: var(--color-lightness-55, #888);
	}

	.group-card {
		border: 1px solid var(--color-lightness-90, #e5e5e5);
		border-radius: var(--radius-sm);
		padding: 0.45rem;
		margin-bottom: 0.45rem;
	}

	.group-header {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		margin-bottom: 0.35rem;
	}

	.group-header input {
		flex: 1;
	}

	.remove-btn {
		border: 1px solid var(--color-lightness-80, #ccc);
		background: transparent;
		border-radius: 3px;
		cursor: pointer;
		line-height: 1;
		padding: 0.05rem 0.35rem;
	}

	.source-tree {
		max-height: 260px;
		overflow: auto;
		border-top: 1px solid var(--color-lightness-95, #f0f0f0);
		padding-top: 0.25rem;
	}

	.source-block {
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--color-lightness-95, #f1f1f1);
	}

	.source-title {
		display: flex;
		gap: 0.35rem;
		align-items: center;
		font-weight: 600;
	}

	.source-items {
		padding-left: 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.sv-item {
		display: grid;
		grid-template-columns: 18px 1fr auto;
		gap: 0.35rem;
		align-items: center;
		font-size: var(--font-sm);
	}

	.sv-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.sv-value {
		font-family: monospace;
		font-size: var(--font-xs);
		color: var(--color-lightness-45, #666);
	}

	.group-output {
		margin-top: 0.35rem;
	}

	.tp-stat-btn {
		font-size: var(--font-xs);
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-lightness-75, #aaa);
		border-radius: 3px;
		background: none;
		cursor: pointer;
		color: var(--color-lightness-35, #555);
	}

	.tp-stat-btn:hover {
		background: var(--color-lightness-95);
		border-color: var(--color-lightness-55, #888);
	}
</style>
