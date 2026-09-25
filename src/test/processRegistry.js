// Test-only front door to the column-process registry; warms it at import time so the cost
// is not charged to a hook budget. See plotRegistry.js for why.
import { loadProcesses } from '$lib/processes/processMap.js';

await loadProcesses();

export { loadProcesses };
