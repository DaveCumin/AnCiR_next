// A node component (process or analysis) binds its inputs into its own model object, e.g.
// <ColumnSelector bind:value={p.args.yIN} multiple />. Svelte's dev ownership check then
// wants every renderer of that node to pass `p` as a binding too, or it warns
// ownership_invalid_binding ("... did not declare `p` as a binding"). The renderers pass a
// function binding (getter plus a no-op setter) because p is a shared model object mutated
// in place; a member binding on a $derived node list would warn
// binding_property_non_reactive instead. This guard keeps a new renderer from regressing
// to a plain p={...}.
import { describe, it, expect } from 'vitest';

const sources = import.meta.glob('/src/**/*.svelte', { query: '?raw', import: 'default' });
// The dynamic node-component variables the renderers use.
const NODE_COMPONENT = /<(PComp|TPComp|Comp|Processcomponent)\s+p=\{/;

describe('node renderers', () => {
	it('pass p as a binding, not a plain prop', async () => {
		const offenders = [];
		for (const [path, load] of Object.entries(sources)) {
			if (path.includes('[conflicted]')) continue;
			const src = /** @type {string} */ (await load());
			src.split('\n').forEach((line, i) => {
				if (NODE_COMPONENT.test(line)) offenders.push(`${path}:${i + 1}`);
			});
		}
		expect(offenders).toEqual([]);
	});
});
