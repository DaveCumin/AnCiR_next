// @ts-nocheck
// The one zone picker (import row, Properties row, Settings "Show times in").
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import TimeZoneSelect from './TimeZoneSelect.svelte';
import { localZone } from '$lib/utils/time/zones.js';

afterEach(() => cleanup());

const options = (select) => [...select.querySelectorAll('option')];
const optionValues = (select) => options(select).map((o) => o.value);

describe('TimeZoneSelect', () => {
	it('Settings: "Each column\'s own zone" first, then UTC, fixed offsets and IANA zones', () => {
		const { getByLabelText } = render(TimeZoneSelect, {
			value: 'column',
			columnOption: true,
			ariaLabel: 'Show times in'
		});
		const select = getByLabelText('Show times in');
		const vals = optionValues(select);
		expect(vals[0]).toBe('column');
		expect(options(select)[0].textContent).toBe("Each column's own zone");
		expect(vals[1]).toBe('utc');
		expect(vals).toContain('+05:30');
		expect(vals).toContain('+12:45');
		expect(vals).toContain('Pacific/Auckland');
		expect(vals).toContain('Asia/Kolkata');
		expect(select.value).toBe('column');
		const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
		expect(groups).toEqual([
			'Fixed offset (no daylight saving)',
			'Time zone (follows daylight saving)'
		]);
	});

	it('a column: no column option; utc reads "As written"; the computer zone is offered by name', () => {
		const { getByLabelText } = render(TimeZoneSelect, {
			value: 'utc',
			utcLabel: 'As written (no zone, UTC)',
			ariaLabel: 'Zone'
		});
		const select = getByLabelText('Zone');
		expect(optionValues(select)).not.toContain('column');
		expect(options(select)[0].textContent).toBe('As written (no zone, UTC)');
		const mine = localZone();
		if (mine !== 'utc') {
			expect(options(select)[1].value).toBe(mine);
			expect(options(select)[1].textContent).toBe(`${mine} (this computer)`);
		}
	});

	it('selects a normalised value, keeps an unknown one visible, marks the detected one', () => {
		const a = render(TimeZoneSelect, { value: '+0530', ariaLabel: 'A' });
		expect(a.getByLabelText('A').value).toBe('+05:30');
		const b = render(TimeZoneSelect, { value: 'Mars/Olympus', ariaLabel: 'B' });
		expect(b.getByLabelText('B').value).toBe('Mars/Olympus');
		const c = render(TimeZoneSelect, { value: '+13:00', suggested: '+13:00', ariaLabel: 'C' });
		const opt = options(c.getByLabelText('C')).find((o) => o.value === '+13:00');
		expect(opt.textContent).toBe('UTC+13:00 (detected)');
	});

	it('reports the new value', async () => {
		const onChange = vi.fn();
		const { getByLabelText } = render(TimeZoneSelect, { value: 'utc', onChange, ariaLabel: 'Z' });
		const select = getByLabelText('Z');
		select.value = 'Asia/Kolkata';
		await fireEvent.change(select);
		expect(onChange).toHaveBeenCalledWith('Asia/Kolkata');
	});
});
