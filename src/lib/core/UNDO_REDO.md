# Undo/Redo System

The app has automatic undo/redo functionality that tracks all changes to your data, tables, and plots using a **JSON Patch (RFC 6902) diff-based approach**.

## How It Works

The system automatically watches the `core` state using Svelte's `$effect` and creates patch-based snapshots whenever changes are detected. Instead of storing full JSON snapshots, it stores compact **forward and reverse patches** (diffs between states) computed with [`fast-json-patch`](https://github.com/Starcounter-Jack/JSON-Patch).

When undoing or redoing, the patch is applied **in-place** to `core` via `applyPatchToCore()`, so Svelte's fine-grained reactivity only re-renders the components that actually changed — not everything.

### Smart Debouncing

- **Structural changes** (add/remove items): Snapshot after 100ms
- **Property changes** (rename, resize, etc.): Snapshot after 500ms
- This prevents creating too many snapshots during rapid changes

### Memory Management

- Maintains up to **50 patch entries** in the undo stack
- Each entry stores a forward patch and a reverse patch (tiny for small edits)
- Older entries are automatically removed when limit is reached
- Redo stack is cleared when new changes are made

## Usage

### Keyboard Shortcuts

- **Undo**: `Cmd+Z` (Mac) or `Ctrl+Z` (Windows/Linux)
- **Redo**: `Cmd+Shift+Z` (Mac) or `Ctrl+Shift+Z` (Windows/Linux)

### UI Buttons

Undo and redo buttons are in the left navbar:
- Buttons are disabled when no undo/redo is available
- Hover for keyboard shortcut tooltips

## What Can Be Undone?

Everything that modifies core state:
- ✅ Adding/removing columns, tables, plots
- ✅ Creating/deleting processes and table processes
- ✅ Renaming items
- ✅ Modifying data
- ✅ Changing plot positions and sizes
- ✅ All property changes

## What Cannot Be Undone?

- ❌ UI state (panel open/closed, selected tab)
- ❌ View preferences (zoom level, canvas scale)
- ❌ File imports (creates a snapshot before import)

## Manual Snapshots

For critical operations, you can force an immediate snapshot:

```javascript
import { history } from '$lib/core/history.svelte';

// Take snapshot immediately (bypasses debouncing)
history.takeSnapshotNow();
```

## API

```javascript
import { history } from '$lib/core/history.svelte';

// Undo last action
await history.undo();

// Redo last undone action
await history.redo();

// Check if undo/redo available
history.canUndo // boolean
history.canRedo // boolean

// Get stack sizes
history.undoCount // number
history.redoCount // number

// Clear history
history.clear();

// Force immediate snapshot
history.takeSnapshotNow();
```

## Technical Details

### Patch-Based Storage

Each undo stack entry stores **two patches** (plain JSON arrays of RFC 6902 operations):
- `reversePatch` — applied when undoing (current → previous state)
- `forwardPatch` — applied when redoing (previous → current state)

Patches are computed via `jsonpatch.compare(before, after)` from `fast-json-patch`. For small edits (rename, resize, single property change), patches are very compact. Only structural changes (add/remove columns/plots) produce larger patches.

### In-Place Reconciliation

`applyPatchToCore(patch)` in `core.svelte.js` applies a patch to a plain-object snapshot of `core`, then reconciles the live `core` state in-place:
- **`core.rawData`**: Add/remove Map entries as needed.
- **`core.data`** (columns): Reconcile by ID — update matching items' properties, remove stale items, add new ones via `Column.fromJSON()`.
- **`core.tables`**: Same reconciliation by ID using `Table.fromJSON()`.
- **`core.plots`**: Same reconciliation by ID using `Plot.fromJSON()`.

This means Svelte only re-renders components watching the changed objects, not everything.

### Automatic Change Detection

The system watches these properties:
- `core.data` — All columns
- `core.tables` — All tables
- `core.plots` — All plots

For each item, it tracks:
- Count changes (add/remove)
- Property changes (name, refs, etc.)

### Preventing Infinite Loops

During undo/redo, the `isRestoring` flag prevents the system from creating new snapshots of the restoration itself.

### Loading Overlay

The loading overlay (`isLoading`) is only shown when the patch is large (`patch.length > 10`), keeping simple undo/redo instant with no visible spinner.

## Configuration

To adjust behavior, edit `/src/lib/core/history.svelte.js`:

```javascript
maxStackSize = 50;  // Max number of undo steps
```

Debounce times:
- Structural changes: 100ms
- Property changes: 500ms

## Troubleshooting

**Problem**: Undo doesn't work
- Check if the change modifies `core.data`, `core.tables`, or `core.plots`
- UI-only changes are not tracked

**Problem**: Too many snapshots
- Increase debounce time
- Reduce max stack size

**Problem**: Not enough snapshots
- Decrease debounce time
- Use `takeSnapshotNow()` for critical operations

## Future Improvements

Potential enhancements:
- Action descriptions in history ("Added column", "Deleted plot")
- History panel showing list of actions
- Branching history (like Git)
- Save undo stack to localStorage for session recovery
- Selective undo (undo specific actions, not just last)
