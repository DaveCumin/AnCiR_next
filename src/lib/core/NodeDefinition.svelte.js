// @ts-nocheck

function asArray(v) {
	return Array.isArray(v) ? v : [];
}

function isMeaningfulInputKey(key) {
	return key && key.endsWith('IN');
}

function inferProcessNodeSpec(def, fileName) {
	if (def?.nodeSpec) return def.nodeSpec;
	return {
		id: `process.${fileName}`,
		inputs: [{ name: 'input', kind: 'column', cardinality: 'one' }],
		outputs: [{ name: 'output', kind: 'column', cardinality: 'one' }]
	};
}

function inferTableProcessNodeSpec(def, fileName) {
	if (def?.nodeSpec) return def.nodeSpec;

	const scalarIns = asArray(def?.columnIdFields?.scalar).filter(isMeaningfulInputKey);
	const arrayIns = asArray(def?.columnIdFields?.array).filter(isMeaningfulInputKey);

	const inputs = [
		...scalarIns.map((name) => ({ name, kind: 'column', cardinality: 'one' })),
		...arrayIns.map((name) => ({ name, kind: 'column', cardinality: 'many' }))
	];

	const outputs = [];
	if (def?.xOutKey) {
		outputs.push({ name: def.xOutKey, kind: 'column', cardinality: 'one' });
	}
	if (def?.yOutKeyPrefix) {
		outputs.push({
			name: def.yOutKeyPrefix + '*',
			kind: 'column',
			cardinality: 'many',
			dynamicPrefix: def.yOutKeyPrefix
		});
	}

	if (outputs.length === 0) {
		const outDefault = def?.defaults?.get?.('out');
		const outShape = outDefault?.val ?? outDefault ?? {};
		for (const key of Object.keys(outShape)) {
			outputs.push({ name: key, kind: 'column', cardinality: 'one' });
		}
	}

	return {
		id: `tableprocess.${fileName}`,
		inputs,
		outputs
	};
}

export function normalizeNodeDefinition(kind, fileName, def) {
	if (kind === 'process') return inferProcessNodeSpec(def, fileName);
	if (kind === 'tableprocess') return inferTableProcessNodeSpec(def, fileName);
	return { id: `${kind}.${fileName}`, inputs: [], outputs: [] };
}
