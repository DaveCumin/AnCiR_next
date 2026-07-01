// SessionManager — true multi-session isolation via process-per-session.
//
// AnCiR's `core` is a module singleton (one session per process), so concurrent
// isolated sessions each get their own worker process (src/worker.js) with its own
// engine state. This is the foundation for a multi-tenant deployment (e.g. an app
// where each user's natural-language request builds its own AnCiR session): give
// each user/session a stable id and route all calls through here.
//
// Each worker boots vite-node + the full registry (~a few seconds), so workers are
// reused across calls and reaped after an idle timeout.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));
// Spawn the vite-node binary directly (not via `npx`), so the IPC channel attaches
// to the process that actually runs the worker — `npx` would add a layer in between
// and `process.send` would be undefined in the worker.
const VITE_NODE = fileURLToPath(new URL('../node_modules/.bin/vite-node', import.meta.url));

export class SessionManager {
	/** @param {{idleMs?:number, cwd?:string}} [opts] */
	constructor({ idleMs = 10 * 60 * 1000, cwd } = {}) {
		this.idleMs = idleMs;
		this.cwd = cwd ?? fileURLToPath(new URL('..', import.meta.url));
		/** @type {Map<string, {child:import('node:child_process').ChildProcess, ready:Promise<void>, pending:Map<number,{resolve:Function,reject:Function}>, rid:number, lastUsed:number, timer:any}>} */
		this.workers = new Map();
	}

	/** Spawn (or reuse) the worker for a session id; resolves once it is ready. */
	async ensure(sessionId) {
		let w = this.workers.get(sessionId);
		if (w) return w;

		const child = spawn(VITE_NODE, [WORKER], {
			cwd: this.cwd,
			stdio: ['ignore', 'ignore', 'inherit', 'ipc'] // ipc = the JSON channel; stderr inherited for logs
		});

		w = { child, pending: new Map(), rid: 0, lastUsed: Date.now(), timer: null, ready: null };
		w.ready = new Promise((resolve, reject) => {
			const onReady = (msg) => {
				if (msg?.type === 'ready') {
					child.off('message', onReady);
					resolve();
				}
			};
			child.on('message', onReady);
			child.once('error', reject);
			child.once('exit', (code) => {
				if (code !== 0) reject(new Error(`worker exited (${code}) before ready`));
			});
		});

		child.on('message', (msg) => {
			if (msg?.type === 'ready' || msg?.rid == null) return;
			const p = w.pending.get(msg.rid);
			if (!p) return;
			w.pending.delete(msg.rid);
			if (msg.ok) p.resolve(msg.result);
			else p.reject(new Error(msg.error));
		});
		child.on('exit', () => {
			for (const p of w.pending.values()) p.reject(new Error('worker exited'));
			w.pending.clear();
			if (this.workers.get(sessionId) === w) this.workers.delete(sessionId);
		});

		this.workers.set(sessionId, w);
		await w.ready;
		this._touch(sessionId);
		return w;
	}

	/** Call a worker method for a session, spawning the worker on first use. */
	async call(sessionId, method, args = {}) {
		const w = await this.ensure(sessionId);
		this._touch(sessionId);
		const rid = ++w.rid;
		return new Promise((resolve, reject) => {
			w.pending.set(rid, { resolve, reject });
			w.child.send({ rid, method, args });
		});
	}

	_touch(sessionId) {
		const w = this.workers.get(sessionId);
		if (!w) return;
		w.lastUsed = Date.now();
		clearTimeout(w.timer);
		w.timer = setTimeout(() => this.destroy(sessionId), this.idleMs);
		w.timer.unref?.();
	}

	destroy(sessionId) {
		const w = this.workers.get(sessionId);
		if (!w) return;
		clearTimeout(w.timer);
		this.workers.delete(sessionId);
		w.child.kill();
	}

	destroyAll() {
		for (const id of [...this.workers.keys()]) this.destroy(id);
	}

	get size() {
		return this.workers.size;
	}
}
