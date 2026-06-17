# Composite nodes — design

**Date:** 2026-06-17
**Author:** David Cumin
**Branch:** `composite-nodes` (off `main`, which now includes the compact-node view)
**Status:** Approved design, pending spec review

## Goal

Let the user select two or more **operation nodes** (column-processes + table-processes / analyses) and **combine** them into a single **composite node** that exposes only its boundary inputs/outputs. Collapsed, it's a compact node; expanded, it becomes an auto-sized bordered container on the same canvas showing the internal sub-graph. Composites can be duplicated, copy-pasted (within and across sessions), and shared as a file — each a fully independent copy. This declutters complex pipelines and makes reusable sub-pipelines portable.

This is the second node-view feature on this branch (the first, compact nodes, is merged to `main`).

## Core decisions (from brainstorming)

- **Contents:** operation nodes only — column-processes and table-processes. No data sources, no plots, no nested composites in v1.
- **Reuse semantics:** copies are **fully independent** (own structure + parameters). **Nothing auto-propagates** between copies. A future "swap/update many" action and "add to palette" are designed-for (via a shared `originId`) but out of v1 scope.
- **Edit model:** **inline expand** — collapsed = compact node; expanded = auto-sized container on the same canvas.
- **Portability:** a composite is a self-contained, portable unit, enabling duplicate / copy-paste / file-share from one primitive.

## Architecture — a view, not an engine change

The central choice: **member nodes stay as real process / table-process objects in the existing `core` arrays**, tagged with a `compositeId` (exactly how Groups absorb columns today). The compute engine runs them unchanged. A composite is purely a **canvas-bundling + edge-rerouting** layer over those tagged members — the same shape as Groups plus the compact-node rendering already built. This keeps the feature non-invasive: no changes to `core` compute, refs, or how analyses run.

### Data model

`core.composites: Composite[]`, each:

```
Composite = {
  id: string,            // e.g. "composite_<n>"
  name: string,
  x: number, y: number,  // canvas position
  collapsed: boolean,    // compact (true) vs inline-expanded (false); default true after combine
  originId: string,      // shared by duplicates/pastes of the same source; for future "swap many" / palette
  interface: {
    inputs:  Port[],     // boundary inputs
    outputs: Port[]      // boundary outputs
  }
}
Port = { id: string, name: string, member: string, port: string }
  // member = the member node id; port = that node's input/output port name (e.g. 'xIN', or a 'col_<id>' output)
```

Membership: each member operation-node carries `compositeId` (mirrors how columns carry group membership). Members are NOT removed from `core`; they're tagged.

### Portable form (the one primitive behind duplicate / copy-paste / share)

`extractComposite(compositeId) -> blob` produces a self-contained object: the composite meta + deep copies of its member nodes + any internal-only columns and their `rawData` + the interface, with all ids expressed so they can be remapped. `insertComposite(blob) -> compositeId` allocates fresh ids for every contained node/column (avoiding collisions), re-links internal wiring and the interface to the new ids, pushes everything into `core`, and returns the new composite id. Duplicate, paste, and file-import all call `insertComposite`; copy and file-export call `extractComposite`.

Session save/load needs no special handling beyond serializing `core.composites` and the `compositeId` tags: members already round-trip through `outputCoreAsJson` / `importJson` because they live in the normal `core` arrays. Load rebuilds membership and interface from the serialized data.

## Creation & interface auto-detection

- **Trigger:** select ≥2 operation nodes, then **Combine** (canvas context menu + a toolbar action + a keyboard shortcut). Combine is rejected (with a notification) if the selection contains non-operation nodes (data/plot/group/note) or fewer than 2 operations.
- **Interface auto-detection** (`computeInterface(memberIds) -> {inputs, outputs}`):
  - **Inputs:** for every member input port whose source is a node *outside* the member set, create one input port. Dedupe identical external sources feeding the same member port. Default name = the member's input-port label (or the external column name).
  - **Outputs:** every member-produced column consumed by a node *outside* the member set becomes an output port (default name = the column's name). The user can additionally expose any other member output as a port. (Default = externally-consumed only.)
- On combine: tag members with the new `compositeId`, create the `Composite` (collapsed) at the selection centroid, assign a fresh `originId`.

## Collapsed rendering + edge rerouting

- Collapsed composite renders via the compact-node style (reuse `CompactNode` or a thin variant): a composite glyph centered, one input dot per interface input (left), one output dot per interface output (right), node name on hover, `"<composite name> — <port name>"` on port hover.
- The graph builder (`getProcessNodeGraph`), when a composite is collapsed:
  - omits member nodes and member↔member internal edges from the rendered graph;
  - reroutes boundary edges: an `external → member.port` edge renders as `external → composite.inputPort`; a `member.port → external` edge renders as `composite.outputPort → external`, using the interface map.
- This is display-only; underlying column refs and the compute graph are unchanged (mirrors how absorbed columns reroute through a group's `col_<id>` ports).

## Inline-expanded container

- Expanded composite renders as a bordered container on the canvas, **auto-sized** to its member nodes' bounding box (plus padding), positioned at the composite's `x/y`. Members render inside in their own compact/detailed states; their relative positions are stored (per-member offset within the container, or absolute positions offset by the container origin).
- Interface ports sit on the container's edges and wire through to the internal member ports; internal member↔member edges render normally inside.
- While expanded, the container is raised above neighbouring nodes (z-index), matching the compact-node expanded behaviour.
- Expand/collapse uses the **same hover toggle button** introduced for compact nodes (composites are `canToggleCompact`; `collapsed` is the composite's own persisted flag, like a group's).

## Duplicate / copy-paste / share

- **Duplicate:** `insertComposite(extractComposite(id))`, preserving `originId`, placed offset from the original. Fully independent.
- **Copy / paste:** Copy serializes `extractComposite(id)` to the clipboard (JSON). Paste detects a composite blob on the clipboard and calls `insertComposite` (works in the same session or another open session/tab). Preserves `originId`.
- **Share (file):** Export writes the blob to a `.ancomp` JSON file; Import reads such a file and calls `insertComposite`. Same primitive.

## Uncombine

`uncombine(compositeId)`: clears `compositeId` from all members (returning them to the canvas as individual nodes at their last-known positions), removes the `Composite` and its interface. The exact inverse of Combine. Members and their data are untouched.

## Non-goals (v1) / future

- **Future:** composites as **custom palette items** (register a composite blob as a reusable palette entry that instantiates via `insertComposite`); **"swap/update many"** bulk action (find composites sharing an `originId` and replace their internals); promotable per-instance parameters; a **drill-in sub-canvas** edit model (fallback if inline gets cramped for large composites).
- **v1 non-goals:** auto-propagation between copies; nested composites (composite-inside-composite); composites containing data sources or plots.

## Testing

- **Unit (vitest, pure functions):**
  - `computeInterface(memberIds)` — given members + the connection graph, returns the correct boundary inputs/outputs (external-in, external-out, dedupe, ignore internal edges).
  - `extractComposite` → `insertComposite` round-trip — ids fully remapped (no collision with existing ids, no dangling refs), internal wiring + interface preserved, independent from the source.
- **Browser (preview tools):** combine a 2–3 node selection; collapsed shows correct boundary ports; external wiring routes through the boundary ports; expand shows the auto-sized container with internals wired; duplicate is independent (edit one, other unchanged); copy-paste round-trip; file export/import; uncombine restores individual nodes; session save/load preserves composites.

## Implementation phasing (for the plan)

- **Phase A — core:** data model (`core.composites` + `compositeId`), `computeInterface`, Combine / Uncombine, collapsed rendering + edge rerouting in the graph builder, inline-expanded container, session save/load.
- **Phase B — portability:** `extractComposite` / `insertComposite`, Duplicate, copy-paste, file export/import.

Same spec; the plan sequences A then B so each phase is independently shippable.
