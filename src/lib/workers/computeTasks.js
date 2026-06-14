// @ts-nocheck
// src/lib/workers/computeTasks.js
// A simple registry mapping task names to compute functions.
// Heavy compute modules self-register by calling registerComputeTask() on import.

/** @type {Map<string, Function>} */
const registry = new Map();

/**
 * Register a named compute task.
 * @param {string} name
 * @param {Function} fn
 * @throws if `name` is already registered
 */
export function registerComputeTask(name, fn) {
	if (registry.has(name)) {
		throw new Error(`Compute task "${name}" is already registered`);
	}
	registry.set(name, fn);
}

/**
 * Retrieve a registered compute task by name.
 * @param {string} name
 * @returns {Function}
 * @throws if `name` is not found
 */
export function getComputeTask(name) {
	const fn = registry.get(name);
	if (!fn) {
		throw new Error(`Compute task "${name}" not found in registry`);
	}
	return fn;
}

/**
 * Return an array of all registered task names.
 * @returns {string[]}
 */
export function listComputeTasks() {
	return Array.from(registry.keys());
}

/**
 * Clear the registry. For use in tests only.
 */
export function _resetComputeTasks() {
	registry.clear();
}
