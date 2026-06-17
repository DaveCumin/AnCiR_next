# Compact Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every data / process / table-process / plot node render as a compact square (centered icon + edge ports, name-on-hover) by default, double-click to expand to today's detailed view.

**Architecture:** A new `nodeGeometry.js` module holds compact sizing/port math as pure, unit-testable functions plus a column-type→icon map. A new `CompactNode.svelte` renders the square body, reusing the exact port-dot markup/handlers the existing nodes use so wiring and edges keep working. `WorkflowEditor.svelte` branches its three geometry helpers on a new "is this node compact?" predicate, renders `CompactNode` when a squared-kind node is not expanded, gates the plot preview / editor panels on expansion, and toggles expand on double-click.

**Tech Stack:** Svelte 5 (runes), Vitest + happy-dom + @testing-library/svelte.

## Global Constraints

- Compact applies to node kinds `data`, `process`, `tableprocess`, `plot` only. `note` and `group` are unchanged.
- Compact ↔ detailed state is **ephemeral** (the existing `expandedNodeIds` Set in `WorkflowEditor`); not serialized. Default (id absent from set) = compact.
- Process/tableprocess "detailed" goes straight to the editor panel (the existing `isExpanded` path); no intermediate state is added.
- Compact square: `COMPACT_W = 56`px wide; `COMPACT_PORT_H = 18`px per port; `COMPACT_V_PAD = 12`px; height = `max(COMPACT_W, max(nInputs, nOutputs) * COMPACT_PORT_H + COMPACT_V_PAD)`.
- Port dots in compact must keep the same `data-node-id` / `data-port-name` / `data-port-dir` attributes, the `dot-input`/`dot-output` classes, and the `portstart`/`portend`/`portdisconnect` dispatch contract used by `WorkflowNode.svelte` (lines 67–84, 169–201) so `WorkflowEditor`'s port handlers and `WorkflowEdges` are unaffected.
- No changes to the data model, the graph builder (`ProcessNode.svelte.js`), connection derivation, or `.ancir` serialization.

---

### Task 1: Compact geometry module (pure functions)

**Files:**
- Create: `src/lib/components/workflow/nodeGeometry.js`
- Test: `src/lib/components/workflow/nodeGeometry.test.js`

**Interfaces:**
- Produces:
  - `COMPACT_W: number` (56), `COMPACT_PORT_H: number` (18), `COMPACT_V_PAD: number` (12)
  - `SQUARED_KINDS: Set<string>` = `{'data','process','tableprocess','plot'}`
  - `compactNodeHeight(nInputs: number, nOutputs: number): number`
  - `compactPortAnchorY(slot: number, sideCount: number, height: number): number` — Y (px from node top) of the center of port `slot` of `sideCount` ports, vertically centered as a stack.
  - `COLUMN_TYPE_ICON: Record<string,string>` and `columnTypeIcon(type: string): string` — icon name for a column type (`number`→`math`, `category`→`list`, `time`→`clock`, `bin`→`table`, fallback `math`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/workflow/nodeGeometry.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
	COMPACT_W,
	COMPACT_PORT_H,
	COMPACT_V_PAD,
	SQUARED_KINDS,
	compactNodeHeight,
	compactPortAnchorY,
	columnTypeIcon
} from './nodeGeometry.js';

describe('compact node geometry', () => {
	it('1-2 ports per side stay a square', () => {
		expect(compactNodeHeight(1, 1)).toBe(COMPACT_W);
		expect(compactNodeHeight(0, 2)).toBe(COMPACT_W); // 2*18+12 = 48 < 56
	});

	it('grows vertically only when a side has many ports', () => {
		// 3 ports: 3*18+12 = 66 > 56
		expect(compactNodeHeight(2, 3)).toBe(3 * COMPACT_PORT_H + COMPACT_V_PAD);
		// uses the busier side
		expect(compactNodeHeight(5, 1)).toBe(5 * COMPACT_PORT_H + COMPACT_V_PAD);
	});

	it('distributes ports as a centered stack within the body height', () => {
		const h = compactNodeHeight(0, 1); // square, 1 output
		expect(compactPortAnchorY(0, 1, h)).toBe(h / 2); // single port centered
		const h3 = compactNodeHeight(0, 3); // 66
		// 3 ports occupy 3*18=54; top pad = (66-54)/2 = 6; centers at 6+9, 6+27, 6+45
		expect(compactPortAnchorY(0, 3, h3)).toBe(6 + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(1, 3, h3)).toBe(6 + COMPACT_PORT_H + COMPACT_PORT_H / 2);
		expect(compactPortAnchorY(2, 3, h3)).toBe(6 + 2 * COMPACT_PORT_H + COMPACT_PORT_H / 2);
	});

	it('maps column types to icons with a fallback', () => {
		expect(columnTypeIcon('number')).toBe('math');
		expect(columnTypeIcon('category')).toBe('list');
		expect(columnTypeIcon('time')).toBe('clock');
		expect(columnTypeIcon('bin')).toBe('table');
		expect(columnTypeIcon('weird')).toBe('math');
		expect(columnTypeIcon(undefined)).toBe('math');
	});

	it('exposes the squared kinds set', () => {
		expect([...SQUARED_KINDS].sort()).toEqual(['data', 'plot', 'process', 'tableprocess']);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/components/workflow/nodeGeometry.test.js`
Expected: FAIL — `Failed to resolve import "./nodeGeometry.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/components/workflow/nodeGeometry.js`:

```js
// Pure compact-node geometry + icon mapping. Imported by both WorkflowEditor
// (port anchoring / sizing) and CompactNode (rendering) so the rendered dot and
// the edge anchor agree. No Svelte/runtime state here — keep it unit-testable.

export const COMPACT_W = 56; // px — compact square width (fixed)
export const COMPACT_PORT_H = 18; // px — vertical step per port in compact mode
export const COMPACT_V_PAD = 12; // px — total vertical padding around the port stack

// Node kinds that collapse to a compact square. Notes and groups are excluded.
export const SQUARED_KINDS = new Set(['data', 'process', 'tableprocess', 'plot']);

/** Compact body height: a square unless one side has enough ports to need more. */
export function compactNodeHeight(nInputs = 0, nOutputs = 0) {
	const sideMax = Math.max(nInputs, nOutputs, 1);
	return Math.max(COMPACT_W, sideMax * COMPACT_PORT_H + COMPACT_V_PAD);
}

/** Center-Y of port `slot` of `sideCount` ports, as a vertically centered stack. */
export function compactPortAnchorY(slot, sideCount, height) {
	const count = Math.max(1, sideCount);
	const stack = count * COMPACT_PORT_H;
	const topPad = (height - stack) / 2;
	return topPad + slot * COMPACT_PORT_H + COMPACT_PORT_H / 2;
}

// Column-type → icon name. Mirrors TableProcessNode's TYPE_ICON, plus 'category'
// (which TypeSelector renders with the 'list' glyph).
export const COLUMN_TYPE_ICON = {
	number: 'math',
	category: 'list',
	time: 'clock',
	bin: 'table'
};

export function columnTypeIcon(type) {
	return COLUMN_TYPE_ICON[type] ?? 'math';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/components/workflow/nodeGeometry.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/workflow/nodeGeometry.js src/lib/components/workflow/nodeGeometry.test.js
git commit -m "feat(workflow): compact node geometry helpers + tests"
```

---

### Task 2: CompactNode component

**Files:**
- Create: `src/lib/components/workflow/CompactNode.svelte`
- Test: `src/lib/components/workflow/CompactNode.test.js`

**Interfaces:**
- Consumes: `nodeGeometry.js` (`COMPACT_W`, `compactNodeHeight`, `compactPortAnchorY`, `columnTypeIcon`); `Icon.svelte`; `tooltip` action; `appConsts`, `getColumnById`.
- Produces: a Svelte component with props `{ node, selected = false, spliceTargetPort = null }` that dispatches `portstart` / `portend` / `portdisconnect` with the same payloads as `WorkflowNode.svelte` (`{ nodeId, port, direction }`). Renders one `.port-dot.dot-input[data-port-dir="in"]` per `node.ports.inputs` and one `.port-dot.dot-output[data-port-dir="out"]` per `node.ports.outputs`, plus a centered `Icon`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/components/workflow/CompactNode.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CompactNode from './CompactNode.svelte';

const node = {
	id: 'process_1',
	type: 'process',
	label: 'Add',
	processName: 'Add',
	ports: {
		inputs: [{ name: 'input', direction: 'input' }],
		outputs: [{ name: 'output', direction: 'output' }]
	}
};

describe('CompactNode', () => {
	it('renders one dot per input and per output', () => {
		const { container } = render(CompactNode, { props: { node } });
		expect(container.querySelectorAll('.port-dot.dot-input').length).toBe(1);
		expect(container.querySelectorAll('.port-dot.dot-output').length).toBe(1);
	});

	it('tags dots with node id, port name and direction', () => {
		const { container } = render(CompactNode, { props: { node } });
		const inDot = container.querySelector('.port-dot.dot-input');
		expect(inDot.getAttribute('data-node-id')).toBe('process_1');
		expect(inDot.getAttribute('data-port-name')).toBe('input');
		expect(inDot.getAttribute('data-port-dir')).toBe('in');
	});

	it('renders the node icon', () => {
		const { container } = render(CompactNode, { props: { node } });
		expect(container.querySelector('svg')).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/components/workflow/CompactNode.test.js`
Expected: FAIL — cannot resolve `./CompactNode.svelte`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/components/workflow/CompactNode.svelte`:

```svelte
<script>
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import Icon from '$lib/icons/Icon.svelte';
	import { tooltip } from '$lib/utils/tooltip.js';
	import { appConsts } from '$lib/core/core.svelte.js';
	import { getColumnById } from '$lib/core/Column.svelte';
	import {
		COMPACT_W,
		compactNodeHeight,
		compactPortAnchorY,
		columnTypeIcon
	} from './nodeGeometry.js';

	let { node, selected = false, spliceTargetPort = null } = $props();
	const dispatch = createEventDispatcher();

	let inputs = $derived(node.ports?.inputs ?? []);
	let outputs = $derived(node.ports?.outputs ?? []);
	let height = $derived(compactNodeHeight(inputs.length, outputs.length));

	// Icon name by kind, falling back to a neutral glyph.
	let iconName = $derived.by(() => {
		if (node.type === 'data') {
			const col = node.refId != null ? getColumnById(node.refId) : null;
			return columnTypeIcon(col?.type);
		}
		if (node.type === 'process') return appConsts.processMap?.get(node.processName)?.nodeIcon || 'gear';
		if (node.type === 'tableprocess')
			return appConsts.tableProcessMap?.get(node.tpName)?.nodeIcon || 'gear';
		if (node.type === 'plot') return appConsts.plotMap?.get(node.plotObj?.type)?.nodeIcon || 'gear';
		return 'gear';
	});

	const dotTop = (slot, count) => compactPortAnchorY(slot, count, height) - 5; // dot is 10px

	function startFromOutput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portstart', { nodeId: node.id, port: portName, direction: 'out' });
	}
	function endAtInput(e, portName) {
		e.stopPropagation();
		e.preventDefault();
		dispatch('portend', { nodeId: node.id, port: portName, direction: 'in' });
	}
	function disconnectInput(e, portName) {
		e.stopPropagation();
		if (!e.shiftKey && e.button !== 2) return;
		e.preventDefault();
		dispatch('portdisconnect', { nodeId: node.id, port: portName, direction: 'in' });
	}
</script>

<div
	class="compact-node"
	class:selected
	style="width:{COMPACT_W}px; height:{height}px;"
	role="button"
	tabindex="0"
	{@attach tooltip(node.label ?? '')}
>
	<span class="compact-icon"><Icon name={iconName} width={22} height={22} /></span>

	{#each inputs as port, i (`in_${port.name}_${i}`)}
		<div
			class="port-dot dot-input"
			style="top:{dotTop(i, inputs.length)}px;"
			data-node-id={node.id}
			data-port-name={port.name}
			data-port-dir="in"
			title={`Input: ${port.name}${port.dynamic ? ' (many)' : ''}`}
			onmousedown={(e) => disconnectInput(e, port.name)}
			onmouseup={(e) => endAtInput(e, port.name)}
			oncontextmenu={(e) => disconnectInput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
	{#each outputs as port, i (`out_${port.name}_${i}`)}
		<div
			class="port-dot dot-output"
			class:splice-target={spliceTargetPort === port.name}
			style="top:{dotTop(i, outputs.length)}px;"
			data-node-id={node.id}
			data-port-name={port.name}
			data-port-dir="out"
			title={`Output: ${port.name}${port.dynamic ? ' (many)' : ''}`}
			onmousedown={(e) => startFromOutput(e, port.name)}
			role="button"
			tabindex="-1"
		></div>
	{/each}
</div>

<style>
	.compact-node {
		position: relative;
		border-radius: 8px;
		border: 1px solid rgba(0, 0, 0, 0.18);
		background: #ffffff;
		cursor: grab;
		user-select: none;
		box-sizing: border-box;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	.compact-node:hover {
		border-color: rgba(0, 0, 0, 0.35);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12);
	}
	.compact-node.selected {
		border-color: var(--color-accent, #4d9fe3);
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
			0 0 0 2px rgba(77, 159, 227, 0.28);
	}
	.compact-icon {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-lightness-35, #555);
		pointer-events: none;
	}
	/* Port dots — mirror WorkflowNode.svelte so wiring/handlers behave identically. */
	.port-dot {
		position: absolute;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--color-lightness-95, #ececec);
		border: 1px solid var(--color-lightness-60, #8a8a8a);
		cursor: crosshair;
		padding: 0;
		overflow: visible;
		pointer-events: auto;
	}
	.port-dot::before {
		content: '';
		position: absolute;
		inset: -6px -10px;
		border-radius: 8px;
	}
	.port-dot.dot-input {
		left: 0;
		transform: translateX(-150%);
	}
	.port-dot.dot-output {
		right: 0;
		transform: translateX(150%);
	}
	.port-dot:hover {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
	}
	.port-dot.splice-target {
		background: var(--color-accent, #4d9fe3);
		border-color: var(--color-accent, #4d9fe3);
		box-shadow: 0 0 0 4px rgba(77, 159, 227, 0.35);
	}
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/components/workflow/CompactNode.test.js`
Expected: PASS (3 tests). If happy-dom struggles to mount (no prior component-render test in this repo), keep the geometry assertions and drop the render test — the browser verification in Task 4 is the real gate — but try the render test first.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/workflow/CompactNode.svelte src/lib/components/workflow/CompactNode.test.js
git commit -m "feat(workflow): CompactNode square component (icon + edge ports)"
```

---

### Task 3: Make compact the default in WorkflowEditor

**Files:**
- Modify: `src/lib/components/workflow/WorkflowEditor.svelte` (imports ~line 39; constants ~44–56; `getPortAnchorY` 92–123; `getNodeWidth` 130–144; `getNodePortAreaHeight` 147–167; `handleNodeDblClick` 1846–1850; `handleNodeToggleExpand` 1855–1861; node render loop 2435–2557)

**Interfaces:**
- Consumes: `nodeGeometry.js` exports; `CompactNode.svelte`.
- Produces: nodes of squared kinds render compact unless in `expandedNodeIds`; double-click toggles.

- [ ] **Step 1: Add imports and a compact predicate**

After the existing imports (near line 40), add:

```js
import CompactNode from './CompactNode.svelte';
import { COMPACT_W, SQUARED_KINDS, compactNodeHeight, compactPortAnchorY } from './nodeGeometry.js';
```

Then, just above `getPortAnchorY` (line 92), add:

```js
// A squared-kind node is compact unless it's been expanded (double-click).
function isCompact(node) {
	return SQUARED_KINDS.has(node?.type) && !expandedNodeIds.has(node?.id);
}
```

- [ ] **Step 2: Branch the three geometry helpers**

At the very top of `getPortAnchorY(node, portName, direction)` body (before the `group`/`tableprocess` published-position block at line 97), insert:

```js
	if (isCompact(node)) {
		const ports = direction === 'out' ? (node.ports?.outputs ?? []) : (node.ports?.inputs ?? []);
		const h = compactNodeHeight(node.ports?.inputs?.length ?? 0, node.ports?.outputs?.length ?? 0);
		let idx = ports.findIndex((p) => p.name === portName);
		if (idx < 0) idx = 0;
		return compactPortAnchorY(idx, ports.length, h);
	}
```

At the top of `getNodeWidth(node)` body (before line 131), insert:

```js
	if (isCompact(node)) return COMPACT_W;
```

At the top of `getNodePortAreaHeight(node)` body (before line 148), insert:

```js
	if (isCompact(node)) {
		return compactNodeHeight(node?.ports?.inputs?.length ?? 0, node?.ports?.outputs?.length ?? 0);
	}
```

- [ ] **Step 3: Toggle expand on double-click for all squared kinds**

Replace `handleNodeToggleExpand` (lines 1855–1861) body guard so it accepts squared kinds:

```js
	function handleNodeToggleExpand(node) {
		if (!SQUARED_KINDS.has(node.type)) return;
		const next = new Set(expandedNodeIds);
		if (next.has(node.id)) next.delete(node.id);
		else next.add(node.id);
		expandedNodeIds = next;
	}
```

Replace `handleNodeDblClick` (lines 1846–1850) so double-click also toggles compact/detailed:

```js
	function handleNodeDblClick(node) {
		focusedNodeId = node.id;
		multiSelectedNodeIds = new Set([node.id]);
		appState.showControlPanel = true;
		handleNodeToggleExpand(node);
	}
```

- [ ] **Step 4: Render CompactNode when compact; gate previews/editor on expand**

In the node render loop, add a compact flag after line 2437 (`{@const isExpanded = ...}`):

```svelte
				{@const compact = isCompact(node)}
```

Change the `tableprocess` branch (line 2483) to render compact when compact:

```svelte
						{:else if node.type === 'tableprocess'}
							{#if compact}
								<CompactNode
									{node}
									selected={isSelected}
									spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
										? dropTargetPortKey.slice(node.id.length + 1)
										: null}
									on:portstart={handlePortStart}
									on:portend={handlePortEnd}
									on:portdisconnect={handlePortDisconnect}
								/>
							{:else}
								<TableProcessNode
									{node}
									selected={isSelected}
									expanded={isExpanded}
									width={getNodeWidth(node)}
									spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
										? dropTargetPortKey.slice(node.id.length + 1)
										: null}
									on:portstart={handlePortStart}
									on:portend={handlePortEnd}
									on:portdisconnect={handlePortDisconnect}
									on:toggleexpand={() => handleNodeToggleExpand(node)}
									on:cardmousedown={(ev) => handleNodeWrapperMouseDown(ev.detail, node)}
								/>
							{/if}
```

Change the final `{:else}` branch (the `WorkflowNode`, line 2498) so squared-kind compact nodes render `CompactNode` while `note` keeps `WorkflowNode`:

```svelte
						{:else if compact}
							<CompactNode
								{node}
								selected={isSelected}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
							/>
						{:else}
							<WorkflowNode
								{node}
								selected={isSelected}
								expanded={isExpanded}
								width={getNodeWidth(node)}
								isDropTarget={false}
								spliceTargetPort={dropTargetPortKey?.startsWith(`${node.id}|`)
									? dropTargetPortKey.slice(node.id.length + 1)
									: null}
								on:portstart={handlePortStart}
								on:portend={handlePortEnd}
								on:portdisconnect={handlePortDisconnect}
								on:toggleexpand={() => handleNodeToggleExpand(node)}
								on:resizestart={(ev) => handleNoteResizeMouseDown(ev.detail, node)}
							/>
						{/if}
```

Gate the plot preview (line 2547) so compact plots show no chart — change the condition to require expansion:

```svelte
						{#if node.type === 'plot' && node.plotObj && isExpanded}
```

(The process/tableprocess editor panels at 2516 and 2535 are already gated on `isExpanded`, so they correctly stay hidden while compact.)

- [ ] **Step 5: Verify nothing regressed and dev server compiles**

Run: `npx vitest run src/lib/components/workflow/nodeGeometry.test.js src/lib/components/workflow/CompactNode.test.js`
Expected: PASS.

Then start the preview and load a demo session that has several node kinds (e.g. `sessions/demos/demo-tp-cosinor.json`): confirm the canvas renders small squares with icons and edge dots, wires still connect to the dots, double-clicking a node expands it to the detailed view (table / chart / editor) and double-clicking again collapses it. (Use the preview tools per the verification workflow.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/workflow/WorkflowEditor.svelte
git commit -m "feat(workflow): compact nodes by default, double-click to expand"
```

---

### Task 4: Cross-kind browser verification + polish

**Files:**
- Modify (only if verification surfaces issues): `src/lib/components/workflow/CompactNode.svelte`, `src/lib/components/workflow/nodeGeometry.js`, `src/lib/components/workflow/WorkflowEditor.svelte`

**Interfaces:**
- Consumes: everything from Tasks 1–3. Produces: no new API.

- [ ] **Step 1: Verify each squared kind in the browser**

Load demo/classroom sessions covering all kinds and confirm, via the preview tools:
- A 1-in/1-out node (e.g. a column process) is a ~56×56 square with one dot per side, icon centered.
- A multi-port node (Cosinor: 2 inputs, ≥3 outputs) grows taller, every port has its own dot, and hovering a dot shows the port name (native title).
- Hovering the square shows the node name (tooltip).
- A plot node is a square showing its plot glyph; double-click reveals the chart; collapse returns to the square.
- Wiring: drag from a compact output dot to a compact input dot creates an edge that anchors on the dots.
- Notes still render as text; groups still render as today.

- [ ] **Step 2: Fix any issues found, re-running the relevant check after each fix**

For each defect: read the source, edit `CompactNode.svelte` / `nodeGeometry.js` / `WorkflowEditor.svelte`, re-verify in the browser. (No placeholder — concrete fixes depend on what's observed; the geometry/render contract above is the spec to hold to.)

- [ ] **Step 3: Screenshot proof + commit**

Capture a before/after-style screenshot of a compact graph and one expanded node. Then:

```bash
git add -A src/lib/components/workflow
git commit -m "fix(workflow): compact-node verification fixes"
```

(Skip the commit if Step 2 found nothing to change.)

---

## Self-review

**Spec coverage:**
- Compact square (icon + edge ports, name on hover) → Task 2 (`CompactNode`) + Task 1 (geometry/icon). ✅
- Grow vertically for many ports → `compactNodeHeight` (Task 1), used everywhere (Task 3). ✅
- Per-node, compact default, double-click toggle → `isCompact` + `handleNodeDblClick`/`handleNodeToggleExpand` (Task 3). ✅
- Scope = data/process/tp/plot; notes & groups unchanged → `SQUARED_KINDS`, render branches keep `note`/`group` on existing components (Task 3). ✅
- Process/TP expand → editor (no middle state); compact ephemeral → reuses `expandedNodeIds`, editor panels already gated on `isExpanded` (Task 3). ✅
- Port-dot contract preserved (data-attrs/classes/dispatch) → CompactNode mirrors WorkflowNode (Task 2), asserted in tests. ✅
- No data-model / graph-builder / serialization changes → only geometry + render layer touched. ✅
- Testing: unit (geometry) + render smoke + browser → Tasks 1, 2, 4. ✅

**Placeholder scan:** Task 4 Step 2 is intentionally open (fixes depend on observed defects) but states the contract to hold; all code steps contain complete code. No TBD/TODO.

**Type consistency:** `compactNodeHeight(nInputs, nOutputs)`, `compactPortAnchorY(slot, sideCount, height)`, `columnTypeIcon(type)`, `SQUARED_KINDS`, `COMPACT_W` used identically in Tasks 1→2→3. Port dispatch payload `{ nodeId, port, direction }` matches `WorkflowNode`'s existing `handlePortStart/End/Disconnect`.
