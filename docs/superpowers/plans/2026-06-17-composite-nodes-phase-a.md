# Composite Nodes — Phase A (core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine selected operation-nodes into a collapsible composite node that exposes auto-detected boundary input/output ports, expands inline to an auto-sized container, and round-trips through session save/load.

**Architecture:** Members stay as real process/table-process nodes in `core`; a `core.composites` entry owns `memberIds` + an auto-detected `interface`. The graph builder hides members and reroutes their boundary edges through the composite node when collapsed (mirroring how Groups reroute absorbed columns through `col_<id>` ports). Pure logic (`computeInterface`) lives in a testable module; rendering reuses the compact-node machinery.

**Tech Stack:** Svelte 5 (runes), Vitest + happy-dom. Phase B (duplicate / copy-paste / file-share via `extractComposite`/`insertComposite`) is a separate plan after this lands.

## Global Constraints

- Members are **operation nodes only**: graph node ids beginning `process_` or `tableprocess_`. Combine rejects selections with any other kind or fewer than 2 members.
- Membership source of truth = `composite.memberIds` (array of graph-node-id strings). Do NOT tag the underlying objects.
- Composite collapse state = `composite.collapsed` (own persisted flag), consistent with how groups drive `isCompact`.
- Rerouting is **display-only**: never mutate column refs or analysis args. Mirror `columnSourceRef` / `absorbedColToGroup` in `ProcessNode.svelte.js`.
- No auto-propagation, no nested composites, no data/plot members (v1).

---

### Task 1: Composite core state + lifecycle

**Files:**
- Modify: `src/lib/core/core.svelte.js` (add `composites: []` to the `core` $state ~line 33; add `_nextCompositeId` + `createComposite`/`removeComposite` near `createGroup` ~line 54)
- Test: covered via Task 2's module test (state shape is trivial; lifecycle verified in browser)

**Interfaces:**
- Produces:
  - `core.composites: Composite[]` where `Composite = { id, name, x, y, collapsed, originId, memberIds: string[], interface: { inputs: Port[], outputs: Port[] } }` and `Port = { id, name, member, port }`.
  - `createComposite({ memberIds, interface, x, y, name, originId }): string` — pushes a composite (collapsed: true), returns its id.
  - `removeComposite(id): void` — removes the composite (members become un-bundled automatically; this is also "uncombine").

- [ ] **Step 1: Add state + lifecycle**

In `core.svelte.js`, add `composites: []` to the `core` $state object (next to `groups: []`). Then near `createGroup`:

```js
let _nextCompositeId = 1;

export function createComposite({ memberIds, interface: iface, x = 80, y = 80, name = 'Composite', originId = null } = {}) {
	const id = `composite_${_nextCompositeId++}`;
	core.composites.push({
		id,
		name,
		x,
		y,
		collapsed: true,
		originId: originId ?? id,
		memberIds: [...(memberIds ?? [])],
		interface: iface ?? { inputs: [], outputs: [] }
	});
	return id;
}

export function removeComposite(id) {
	core.composites = core.composites.filter((c) => c.id !== id);
}
```

- [ ] **Step 2: Ensure serialization includes composites**

Confirm `outputCoreAsJson` serializes `core.composites` and `importJson` restores it. Grep `outputCoreAsJson` in `core.svelte.js`; if it builds an explicit object, add `composites: core.composites`; if it spreads/whitelists keys, add `composites`. (Members already round-trip — they're in the normal arrays.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/core.svelte.js
git commit -m "feat(composite): core.composites state + create/remove lifecycle"
```

---

### Task 2: `computeInterface` (pure boundary detection)

**Files:**
- Create: `src/lib/core/composite.js`
- Test: `src/lib/core/composite.test.js`

**Interfaces:**
- Consumes: a connection list shaped like `getProcessNodeGraph().connections` — `{ fromId, fromPort, toId, toPort }[]`.
- Produces: `computeInterface(memberIds: Set<string>|string[], connections): { inputs: Port[], outputs: Port[] }` where `Port = { id, name, member, port }`. `id = "in:" + member + "|" + port` (outputs `"out:"+...`); `name` defaults to `port`. Inputs = edges entering the member set from outside (deduped by member+toPort); outputs = member edges leaving to outside (deduped by member+fromPort); internal member↔member edges ignored.

- [ ] **Step 1: Write the failing test**

Create `src/lib/core/composite.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { computeInterface } from './composite.js';

const members = ['tableprocess_1'];
const conns = [
	{ fromId: 'data_5', fromPort: 'column', toId: 'tableprocess_1', toPort: 'xIN' },
	{ fromId: 'data_6', fromPort: 'column', toId: 'tableprocess_1', toPort: 'yIN' },
	{ fromId: 'tableprocess_1', fromPort: 'col_9', toId: 'plot_2', toPort: 'y1' },
	{ fromId: 'tableprocess_1', fromPort: 'col_9', toId: 'plot_3', toPort: 'y1' }, // 2nd consumer, same port
	{ fromId: 'process_8', fromPort: 'output', toId: 'process_9', toPort: 'input' } // unrelated
];

describe('computeInterface', () => {
	it('finds external inputs (deduped by member+port)', () => {
		const { inputs } = computeInterface(members, conns);
		expect(inputs.map((p) => `${p.member}|${p.port}`).sort()).toEqual([
			'tableprocess_1|xIN',
			'tableprocess_1|yIN'
		]);
	});
	it('finds external outputs, deduped across multiple consumers', () => {
		const { outputs } = computeInterface(members, conns);
		expect(outputs.map((p) => `${p.member}|${p.port}`)).toEqual(['tableprocess_1|col_9']);
	});
	it('ignores internal member<->member edges', () => {
		const m = ['process_3', 'tableprocess_1'];
		const c = [{ fromId: 'process_3', fromPort: 'output', toId: 'tableprocess_1', toPort: 'xIN' }];
		const { inputs, outputs } = computeInterface(m, c);
		expect(inputs).toEqual([]);
		expect(outputs).toEqual([]);
	});
	it('assigns stable unique ids and default names', () => {
		const { inputs } = computeInterface(members, conns);
		const x = inputs.find((p) => p.port === 'xIN');
		expect(x.id).toBe('in:tableprocess_1|xIN');
		expect(x.name).toBe('xIN');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/core/composite.test.js`
Expected: FAIL — cannot resolve `./composite.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/core/composite.js`:

```js
// Pure composite-node helpers. No Svelte state here — unit-testable.

/**
 * Boundary inputs/outputs of a member set, given the workflow connection list.
 * Inputs  = edges entering the set from outside (one per member input port).
 * Outputs = edges leaving the set to outside (one per member output port).
 * Internal member<->member edges are ignored.
 */
export function computeInterface(memberIds, connections) {
	const members = memberIds instanceof Set ? memberIds : new Set(memberIds);
	const inMap = new Map(); // key member|toPort -> Port
	const outMap = new Map(); // key member|fromPort -> Port
	for (const c of connections ?? []) {
		const fromIn = members.has(c.fromId);
		const toIn = members.has(c.toId);
		if (toIn && !fromIn) {
			const key = `${c.toId}|${c.toPort}`;
			if (!inMap.has(key))
				inMap.set(key, { id: `in:${key}`, name: c.toPort, member: c.toId, port: c.toPort });
		} else if (fromIn && !toIn) {
			const key = `${c.fromId}|${c.fromPort}`;
			if (!outMap.has(key))
				outMap.set(key, { id: `out:${key}`, name: c.fromPort, member: c.fromId, port: c.fromPort });
		}
	}
	return { inputs: [...inMap.values()], outputs: [...outMap.values()] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/core/composite.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/composite.js src/lib/core/composite.test.js
git commit -m "feat(composite): computeInterface boundary detection + tests"
```

---

### Task 3: Combine / Uncombine actions in WorkflowEditor

**Files:**
- Modify: `src/lib/components/workflow/WorkflowEditor.svelte` (imports; add `combineSelection()` and `uncombine(node)`; wire a trigger)

**Interfaces:**
- Consumes: `createComposite`, `removeComposite`, `computeInterface`, `processGraph.connections`, `multiSelectedNodeIds`, `stablePositions`.
- Produces: `combineSelection()` — validates ≥2 operation members, computes interface, creates a composite at the selection centroid, selects it. `uncombine(node)` — `removeComposite(node.id)`.

- [ ] **Step 1: Add imports**

Add `createComposite, removeComposite` to the existing `core.svelte.js` import; `import { computeInterface } from '$lib/core/composite.js';`.

- [ ] **Step 2: Implement combine/uncombine**

```js
const COMPOSABLE = (id) => id?.startsWith('process_') || id?.startsWith('tableprocess_');

function combineSelection() {
	const ids = [...multiSelectedNodeIds].filter(COMPOSABLE);
	if (ids.length < 2) {
		addNotification('Select at least two analysis/process nodes to combine.');
		return;
	}
	const conns = processGraph.connections ?? [];
	const iface = computeInterface(new Set(ids), conns);
	// centroid of member positions
	const ps = ids.map((id) => stablePositions[id] ?? defaultPositions.positions[id]).filter(Boolean);
	const cx = Math.round(ps.reduce((s, p) => s + p.x, 0) / (ps.length || 1));
	const cy = Math.round(ps.reduce((s, p) => s + p.y, 0) / (ps.length || 1));
	const cid = createComposite({ memberIds: ids, interface: iface, x: cx, y: cy, name: 'Composite' });
	stablePositions[cid] = { x: cx, y: cy };
	focusedNodeId = cid;
	multiSelectedNodeIds = new Set([cid]);
}

function uncombine(node) {
	if (node?.type !== 'composite') return;
	removeComposite(node.id);
}
```

- [ ] **Step 3: Wire a trigger**

Add a keyboard shortcut in the existing canvas keydown handling (or a small toolbar button): combine on the multi-select toolbar. Minimal: in `+page.svelte`'s keydown (guard `!editableFocused`), `Cmd/Ctrl+G` → call a combine handler exposed by WorkflowEditor (or move combine into the canvas keydown in WorkflowEditor where `multiSelectedNodeIds` lives). Prefer WorkflowEditor-local keydown if one exists; otherwise expose `combineSelection` via a bound prop.

- [ ] **Step 4: Verify (browser)** — multi-select two TP/process nodes, trigger combine, confirm a `composite_*` appears in `core.composites` with the expected interface (via `preview_eval` on `core`). Commit.

```bash
git add src/lib/components/workflow/WorkflowEditor.svelte src/routes/+page.svelte
git commit -m "feat(composite): combine selection into a composite + uncombine"
```

---

### Task 4: Graph builder — composite node + collapsed edge rerouting

**Files:**
- Modify: `src/lib/core/ProcessNode.svelte.js`

**Interfaces:**
- Consumes: `core.composites`. Produces: a `composite`-kind node per composite, and (when collapsed) rerouted boundary edges + suppressed members.

- [ ] **Step 1: Build member maps (mirror `absorbedColToGroup`)**

Near the absorbed-column maps (~line 308), build:
```js
// memberNodeId -> { compositeId, collapsed }
const memberToComposite = new Map();
for (const comp of core.composites ?? []) {
	for (const mid of comp.memberIds ?? []) memberToComposite.set(mid, comp);
}
```

- [ ] **Step 2: Emit composite nodes + hash**

Add to `makeProcessNodeHash` a composite segment (id, name, collapsed, memberIds, interface ids) so the graph re-derives on change. In the node-building section (near the group block ~line 627), push one node per composite:
```js
for (const comp of core.composites ?? []) {
	nodeMap.set(comp.id, {
		id: comp.id, type: 'composite', kind: 'composite', label: comp.name,
		refId: comp.id,
		ports: {
			inputs: comp.interface.inputs.map((p) => ({ name: p.id, display: p.name })),
			outputs: comp.interface.outputs.map((p) => ({ name: p.id, display: p.name }))
		},
		meta: { type: 'composite', refId: comp.id, compositeObj: comp }
	});
}
```

- [ ] **Step 3: Suppress collapsed members + reroute edges**

When emitting member nodes, skip them if their composite is collapsed (like `if (absorbedColToGroup.has(col.id)) continue;`). In `addConnection`, before pushing, remap endpoints that fall inside a collapsed composite to the composite's boundary port id (look up the interface Port whose `{member,port}` matches the edge endpoint; use its `id` as the composite port). Internal edges (both endpoints in the same collapsed composite) are dropped.

- [ ] **Step 4: Verify (browser)** — collapsed composite shows boundary dots; external wires connect to them; `getProcessNodeGraph().connections` shows rerouted edges. Commit.

```bash
git add src/lib/core/ProcessNode.svelte.js
git commit -m "feat(composite): graph node + collapsed edge rerouting"
```

---

### Task 5: Collapsed rendering + expand toggle

**Files:**
- Modify: `src/lib/components/workflow/WorkflowEditor.svelte` (render branch + `isCompact`/`canToggleCompact`); `src/lib/components/workflow/CompactNode.svelte` (composite icon)

**Interfaces:** Consumes the composite node + `nodeGeometry`. Produces collapsed composite rendering reusing `CompactNode`.

- [ ] **Step 1: isCompact + toggle for composites**

In `WorkflowEditor.svelte`: `isCompact(node)` returns `node.compositeObj.collapsed` for `type === 'composite'` (mirror the group branch). `canToggleCompact` includes `'composite'`. `handleNodeToggleExpand` toggles `node.compositeObj.collapsed` for composites.

- [ ] **Step 2: Render**

In the render chain, a collapsed composite (`compact`) renders `CompactNode` (already handles any node with `ports`). Add `if (node.type === 'composite') return 'layer';` (or a dedicated glyph) to `CompactNode`'s `iconName`. Expanded composite → Task 6's container.

- [ ] **Step 3: Verify (browser)** — collapse/expand toggles via the hover button; port hover shows `"<name> — <port>"`. Commit.

```bash
git add src/lib/components/workflow/WorkflowEditor.svelte src/lib/components/workflow/CompactNode.svelte
git commit -m "feat(composite): collapsed compact rendering + expand toggle"
```

---

### Task 6: Inline-expanded container

**Files:**
- Create: `src/lib/components/workflow/CompositeContainer.svelte`
- Modify: `src/lib/components/workflow/WorkflowEditor.svelte` (render expanded composite)

**Interfaces:** Renders an auto-sized bordered box at the composite's position containing its member nodes (their existing positions), with interface ports on the edges. Members render via the existing node components inside.

- [ ] **Step 1: Implement container**

When a composite is expanded, the graph builder shows its member nodes (Step 3 of Task 4 only suppresses members when collapsed). Render a `CompositeContainer` behind the members: compute the bounding box of member `stablePositions` (+ padding), draw a bordered, labelled box at that rect, and draw the interface ports on its left/right edges (wired to the internal member ports). Raise z-index of the container + members above neighbours while expanded.

- [ ] **Step 2: Verify (browser)** — expand shows the box around the members, auto-sized; internal wiring intact; collapse hides them again. Commit.

```bash
git add src/lib/components/workflow/CompositeContainer.svelte src/lib/components/workflow/WorkflowEditor.svelte
git commit -m "feat(composite): inline auto-sized expanded container"
```

---

### Task 7: Session round-trip + combine/uncombine UX polish

**Files:** Modify: `src/lib/components/workflow/WorkflowEditor.svelte` (context-menu/toolbar entries for Combine/Uncombine)

- [ ] **Step 1:** Add "Combine" to the multi-select affordance and "Uncombine" to a selected composite (context menu or toolbar). 
- [ ] **Step 2: Verify (browser)** — combine → save session (`outputCoreAsJson`) → reload (`importJson`) → composite + members restored, collapsed, ports correct; uncombine restores individual nodes.
- [ ] **Step 3: Commit**

```bash
git add src/lib/components/workflow/WorkflowEditor.svelte
git commit -m "feat(composite): combine/uncombine UX + verified session round-trip"
```

---

## Self-review

**Spec coverage:** data model → T1; computeInterface → T2; creation/auto-interface → T3; collapsed rendering + rerouting → T4/T5; inline container → T6; uncombine → T3/T7; session save/load → T1/T7. Duplicate/copy-paste/share = **Phase B** (separate plan, deliberately not here). Palette/swap-many/nested = future (out of scope).

**Placeholder scan:** Tasks 1–2 have complete code. Tasks 3–7 give concrete code/specifics for the foundation and exact patterns/anchors for the graph-builder + rendering integration, which require browser iteration against the live graph (acknowledged); they intentionally lean on the named existing patterns (`absorbedColToGroup`, `columnSourceRef`, `CompactNode`, `isCompact`) rather than guessing exact line-level diffs that depend on runtime DOM.

**Type consistency:** `Port = {id,name,member,port}`, `computeInterface(memberIds, connections)`, `createComposite({memberIds, interface, x, y, name, originId})`, `composite.collapsed`, node `type:'composite'` used consistently across tasks.
