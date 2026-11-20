// @ts-nocheck
// Test stand-ins for the recent-files store (recentSessions.svelte.js): a by-reference
// IndexedDB and FileSystemFileHandle. fake-indexeddb structured-clones what it stores, which a
// fake handle with methods cannot survive.

// A minimal in-memory IndexedDB, just enough for the handle store (open / put / get / delete), so
// the one-click reopen path can run here. Each request resolves on a microtask, like the real one.
export function fakeIndexedDB() {
	const stores = new Map();
	const later = (fn) => queueMicrotask(fn);
	const request = (compute) => {
		const req = {};
		later(() => {
			req.result = compute();
			req.onsuccess?.();
		});
		return req;
	};
	const db = {
		objectStoreNames: { contains: (n) => stores.has(n) },
		createObjectStore: (n) => stores.set(n, new Map()),
		close() {},
		transaction(name) {
			const map = stores.get(name);
			const t = {};
			const done = (v) => {
				later(() => later(() => t.oncomplete?.()));
				return v;
			};
			t.objectStore = () => ({
				put: (v, k) => done(request(() => map.set(k, v) && k)),
				get: (k) => done(request(() => map.get(k))),
				delete: (k) => done(request(() => map.delete(k))),
				clear: () => done(request(() => map.clear()))
			});
			return t;
		}
	};
	return {
		open() {
			const req = {};
			later(() => {
				req.result = db;
				req.onupgradeneeded?.();
				req.onsuccess?.();
			});
			return req;
		}
	};
}

/** A stand-in FileSystemFileHandle: `file` is what getFile returns; `key` is its identity. */
export function fileHandle(name, { key = name, perm = 'granted', request = perm, getFile } = {}) {
	return {
		kind: 'file',
		name,
		key,
		queryPermission: async () => perm,
		requestPermission: async () => request,
		getFile: getFile ?? (async () => ({ name, text: async () => '{"data":[]}' })),
		isSameEntry: async (other) => other?.key === key
	};
}
