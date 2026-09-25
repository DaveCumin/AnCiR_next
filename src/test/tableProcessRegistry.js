// Test-only front door to the table-process registry; warms it at import time so the cost is
// not charged to a hook budget. See plotRegistry.js for why.
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';

await loadTableProcesses();

export { loadTableProcesses };
