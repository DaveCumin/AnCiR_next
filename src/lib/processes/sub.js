export const sub_defaults = new Map([
	['find', { val: 0, type: 'dataType' }],
	['replace', { val: 0, type: 'dataType' }]
]);

export function sub(x, args) {
	const find = args.find;
	const replace = args.replace;
	return x.map((i) => (i == find ? replace : i));
}
