// Test-only front door to the plot registry.
//
// `loadPlots()` dynamically imports every plot component, which pulls in the whole
// plotbits/core graph: roughly three seconds of compilation and evaluation in a fresh module
// registry, and every test file gets a fresh one. Paid inside `beforeAll`/`beforeEach` that
// one-off cost is charged against the 10s hook budget, so under machine load a different
// handful of plot test files failed each run with "Hook timed out in 10000ms".
//
// Importing through this module puts the work in the test file's import graph instead, which
// is where it belongs: the registry is a dependency of the file, not setup for one test. The
// loader memoises, so the call left in the hook returns immediately and the hook budget goes
// back to measuring what the hook actually does.
//
// See also processRegistry.js and tableProcessRegistry.js, which do the same for the other
// two node registries; a hook that builds all three used to cost six or seven seconds.
import { loadPlots } from '$lib/plots/plotMap.js';

await loadPlots();

export { loadPlots };
