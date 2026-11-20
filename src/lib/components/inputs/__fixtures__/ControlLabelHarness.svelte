<script>
	// Test harness for controlLabels.svelte.test.js: one of each way a panel field is labelled.
	import ControlInput from '../ControlInput.svelte';
	import AttributeSelect from '../AttributeSelect.svelte';
	import ColumnSelector from '../ColumnSelector.svelte';
	import ColourPicker from '../ColourPicker.svelte';
	import NumberWithUnits from '../NumberWithUnits.svelte';
	import Toggle from '../Toggle.svelte';
	import DateTimeHrs from '../DateTimeHrs.svelte';
	import Column from '$lib/core/Column.svelte';

	let { col } = $props();
	const uid = $props.id();
</script>

<ControlInput label="Method">
	<AttributeSelect value="a" options={['a', 'b']} optionsDisplay={['A', 'B']} />
</ControlInput>
<ControlInput label="Time (x)" associate={false}>
	<ColumnSelector value={-1} />
</ControlInput>
<ControlInput label="Fill" associate={false}>
	<ColourPicker value="#ff0000" />
</ControlInput>
<ControlInput label="Frequency step" associate={false}>
	<NumberWithUnits value={1} />
	<p>A note that is not part of the name</p>
</ControlInput>
<ControlInput label="Noise" associate={false}>
	<Toggle />
</ControlInput>
<ControlInput label="Start" associate={false}>
	<DateTimeHrs value={0} />
</ControlInput>
<ControlInput label="Width">
	<NumberWithUnits value={2} />
</ControlInput>
<ControlInput label="Values (y)" associate={false} id="{uid}-y"></ControlInput>
<Column {col} labelledby="{uid}-y" canChange={true} />
