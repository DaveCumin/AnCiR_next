// node --test src/emit/columnRefParams.test.js
//
// Guard for src/lib/core/columnRefParams.js: every path that takes a column NAME (this
// normalizer, the MCP engine, the app's AI-edit planner) resolves a node's input ports
// (columnIdFields) plus the params listed there. A node that gains a column-valued param in
// neither list would take only numeric ids again, silently: a name would pass through as a
// string the node ignores. So any param that LOOKS like a column reference must be listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA } from './schema.js';
import { COLUMN_REF_PARAMS } from '../../../src/lib/core/columnRefParams.js';

const LOOKS_LIKE_COLUMN = /(IN|Id|Ids)$|^outputX$/;

test('every column-like param is an input port or a listed column param', () => {
	const unlisted = [];
	for (const [name, node] of Object.entries(SCHEMA)) {
		for (const k of Object.keys(node.params ?? {}))
			if (LOOKS_LIKE_COLUMN.test(k) && !COLUMN_REF_PARAMS.includes(k))
				unlisted.push(`${name}.${k}`);
	}
	assert.deepEqual(unlisted, []);
});

test('every listed column param exists on some node (no stale entries)', () => {
	const params = new Set(Object.values(SCHEMA).flatMap((n) => Object.keys(n.params ?? {})));
	for (const k of COLUMN_REF_PARAMS) assert.ok(params.has(k), `${k} is on no node`);
});
