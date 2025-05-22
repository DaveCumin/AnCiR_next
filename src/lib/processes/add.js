export const add_defaults = new Map([['value', { val: 4, type: 'number' }]]);

export function add(x, args) {
	const value = args.value;
	return x.map((i) => i + value);
}
