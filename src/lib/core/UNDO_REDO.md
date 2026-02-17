# Undo/Redo System

The app now has automatic undo/redo functionality that tracks all changes to your data, tables, and plots.

## How It Works

The system automatically watches the `core` state using Svelte's `$effect` and creates snapshots whenever changes are detected. No manual wrapping of functions needed!

### Smart Debouncing

- **Structural changes** (add/remove items): Snapshot after 100ms
- **Property changes** (rename, resize, etc.): Snapshot after 500ms
- This prevents creating too many snapshots during rapid changes

### Memory Management

- Maintains up to **50 snapshots** in the undo stack
- Older snapshots are automatically removed when limit is reached
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

### Automatic Change Detection

The system watches these properties:
- `core.data` - All columns
- `core.tables` - All tables
- `core.plots` - All plots

For each item, it tracks:
- Count changes (add/remove)
- Property changes (name, refs, etc.)

### Preventing Infinite Loops

During undo/redo, the `isRestoring` flag prevents the system from creating new snapshots of the restoration itself.

### Performance

- Snapshots use JSON serialization (already optimized in your app)
- Debouncing prevents excessive snapshots
- Smart structural change detection for faster snapshots

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
