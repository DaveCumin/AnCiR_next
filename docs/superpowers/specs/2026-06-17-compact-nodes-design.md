# Compact nodes — design

**Date:** 2026-06-17
**Author:** David Cumin
**Branch:** `node-view-rework` (compact nodes first; composite nodes follow on the same branch as a later cycle)
**Status:** Approved design, pending spec review

## Goal

Make the workflow canvas far more compact. Every data, process, table‑process (analysis), and plot node defaults to a **small square** showing only its icon plus its input/output ports; the node name and port names appear on hover. Double‑clicking a node expands it to today's full ("detailed") view and collapses it back. This declutters dense graphs while keeping wiring fully usable without expanding.

This is the first of two related features on this branch. The second (combining nodes into one composite node with an internal sub‑graph) is **out of scope here** and will be designed separately once this lands.

## States

Each node has two visual states:

- **Compact** (new default) — a small rounded square: centered icon, input port dots on the left edge, output port dots on the right edge, name-on-hover. Applies to kinds: `data`, `process`, `tableprocess`, `plot`.
- **Detailed** (on double‑click) — exactly today's full rendering for that kind:
  - `data` → header + `MiniDataTable` preview
  - `plot` → header + `EmbeddedPlot` chart preview
  - `process` / `tableprocess` → header + ports + **the config editor panel** (we go straight to the editor; the old intermediate "collapsed-with-ports / collapsed-with-rows" middle state is removed, so there are exactly two states everywhere).

`note` and `group` nodes are **unchanged** (notes always show their text; groups keep their current collapse/row behavior). Both still pick up the new shared sizing constants but otherwise render as today. Groups are deliberately untouched because Feature B will rework them.

## Compact node anatomy

- **Shape/size:** rounded square, `COMPACT_W ≈ 56px` wide. Height = `max(COMPACT_W, maxPortsPerSide × COMPACT_PORT_H + COMPACT_V_PAD)` where `COMPACT_PORT_H ≈ 18px` and `COMPACT_V_PAD ≈ 12px`. So 1–2 port nodes are true ~56×56 squares; a node with many ports (e.g. Cosinor: 2 inputs, 3 outputs → 3 ports/side → ~66px) becomes a slightly taller rounded rectangle. Width is fixed.
- **Icon:** centered in the body via the existing `Icon` component.
  - `process` / `tableprocess` / `plot`: the node's `nodeMeta` glyph, resolved exactly as the palette does (`resolveIcon(entry.nodeIcon)`).
  - `data` (column): the column's **type glyph** — number / category / time — reusing the existing `TYPE_ICON` map already used for column-type icons in `TableProcessNode`.
- **Ports:** input dots on the left edge, output dots on the right edge, evenly distributed over the body height. Same dot visuals and hit-targets as today, so wiring, splice-on-drag, and edge anchoring behave identically. Each port shows its **port name on hover** (existing `tooltip` util).
- **Name on hover:** the node name shows as a hover tooltip (existing `tooltip` util). No always-visible label in compact state.
- **No header, no preview, no editor** in compact state.

```
 ┌──────┐          ○┤      ├○
○┤  ∿   ├○         ○┤  ∿   ├○      hover → "Cosinor"
 └──────┘          ○┤      ├○
 1-in/1-out         2 in / 3 out
 56 × 56            ~56 × 66 (icon still centered)
```

## Interaction

- **Single click** selects; **drag** moves; **double‑click** toggles Compact ↔ Detailed for that node. Multi‑select, marquee select, wiring, and orphan-process splice-on-drag are unchanged.
- Double‑click‑to‑rename still works on the editable title that lives **inside** the Detailed view (a different DOM target than the compact body).
- Hover surfaces the node name and, per port, the port name.

## Architecture / implementation

All node geometry already flows through a small set of helpers in `WorkflowEditor.svelte`; compact mode is mostly a branch in those helpers plus a new lightweight body component.

- **New component `CompactNode.svelte`** (`src/lib/components/workflow/`): renders the square body — icon + port dots + hover tooltips — given a `ProcessNode` (the graph node with `inputs`/`outputs`/`nodeIcon`/`label`/`kind`). It does **not** re-implement wiring; it renders the same port dot markup/classes the detailed nodes use so `WorkflowEditor`'s existing port event handlers and `WorkflowEdges` keep working.
- **State:** today's per-node `expandedNodeIds: Set` in `WorkflowEditor` is repurposed to mean "this node is **Detailed**." Default (id absent) = Compact. `handleNodeToggleExpand` is wired to double‑click. The set stays **ephemeral** (not serialized), matching today — sessions open clean and compact. (Pruning-on-delete logic already exists and is kept.)
- **Sizing helpers** (`WorkflowEditor.svelte`) branch on compact vs detailed:
  - `getNodeWidth(node)` → `COMPACT_W` when compact (all four kinds); existing widths when detailed.
  - `getNodePortAreaHeight(node)` → compact height formula above when compact; existing per-kind logic when detailed.
  - `getPortAnchorY(node, port)` → compact: distribute ports over the body (`COMPACT_V_PAD/2 + slot × COMPACT_PORT_H + COMPACT_PORT_H/2`), using the same slot ordering source of truth (`plotPortRows` / `plotPortSlotIndex` for grouped plot inputs). Detailed: existing formula + the existing DOM‑measured `groupPortPositions` override.
- **New constants** in `WorkflowEditor.svelte`: `COMPACT_W`, `COMPACT_PORT_H`, `COMPACT_V_PAD` (alongside the existing `NODE_WIDTH`, `HEADER_H`, `PORT_H`, …).
- **Render switch:** in `WorkflowEditor`'s node loop, render `CompactNode` when the node is compact and of a squared kind; otherwise render today's `WorkflowNode` / `TableProcessNode` / `EmbeddedPlot` exactly as now. `note` and `group` always render their current components.

### Data flow

No change to the data model, the graph builder (`getProcessNodeGraph` / `ProcessNode.svelte.js`), connection derivation, or serialization. Compact vs detailed is a pure presentation concern layered on top of the existing node graph. Port identities and counts are unchanged, so edges connect to the same ports in either state.

## Edge cases

- **Nodes with zero ports on a side** (e.g. a source TP with no inputs): that side simply has no dots; square still renders with centered icon.
- **Many ports** (multi‑series scatter, multi‑output TP, group-fed plots): node grows vertically per the formula; ports remain individually hover-named and wireable.
- **Selection styling** (selected / multi‑selected / dimmed / changed) applies to the compact wrapper the same way it does today.
- **Layout/auto-position:** default positions come from the graph builder using `getNodePortAreaHeight`; compact heights feed in automatically, so freshly laid-out graphs pack tighter. Existing saved positions in `stablePositions` are unaffected.
- **Toggling while wired:** expanding/collapsing changes a node's height; edges re-anchor via the existing `getPortAnchorY` path (and DOM-measured override in detailed state) — no special handling needed.

## Non-goals

- No changes to notes or to Group internals/behavior.
- No changes to wiring logic, the graph builder, connection types, or `.ancir` serialization.
- No composite/sub-graph nodes (Feature B, separate cycle).
- No global density toggle (we chose per-node expand) and no persistence of expanded state.

## Testing

- **Unit (vitest):** the geometry helpers — compact `getNodeWidth` returns `COMPACT_W` for all four kinds; compact `getNodePortAreaHeight` returns a square for ≤2 ports/side and the grown height for more; compact `getPortAnchorY` distributes N ports without overlap and matches the slot order from `plotPortRows`.
- **Render smoke test:** mounting `CompactNode` for a node with N inputs / M outputs renders N left dots + M right dots with the expected port `data-` attributes/classes the editor's handlers rely on.
- **Manual / browser (preview tools):** default compact render across kinds; double‑click expand/collapse; node-name and port-name tooltips on hover; wiring a specific port from a compact node; a grown multi-port node; select/drag still work.

## Open items confirmed during design

1. Process/TP expand jumps **straight to the editor** (no middle state). ✅
2. Compact/detailed state is **ephemeral**, not saved with the session. ✅
