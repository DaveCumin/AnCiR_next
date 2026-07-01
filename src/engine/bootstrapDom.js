// AnCiR's core (core.svelte.js) reads `window.innerWidth` at module-load time
// and its columns/plots assume a DOM. Under Vitest the `happy-dom` environment
// provides this automatically, but when the MCP server runs as a plain process
// (vite-node) there is no DOM. `ensureDom()` registers a happy-dom Window on the
// global scope *before* any AnCiR module is imported. It is idempotent and a
// no-op when a DOM already exists (e.g. in tests).

let installed = false;

export async function ensureDom() {
	if (installed || globalThis.window) {
		installed = true;
		return;
	}
	const { Window } = await import('happy-dom');
	const win = new Window({ url: 'http://localhost/' });

	// Some globals (e.g. `navigator` in Node 22) are read-only getters and cannot
	// be reassigned directly, so define each defensively and skip what's locked.
	const set = (key, value) => {
		if (value === undefined) return;
		try {
			Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
		} catch {
			/* read-only global (already provided by Node) — leave it */
		}
	};

	set('window', win);
	set('document', win.document);
	set('location', win.location);
	set('HTMLElement', win.HTMLElement);
	set('Node', win.Node);
	set('customElements', win.customElements);
	if (typeof win.getComputedStyle === 'function') set('getComputedStyle', win.getComputedStyle.bind(win));
	installed = true;
}
