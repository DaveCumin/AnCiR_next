import { describe, it, expect, afterEach } from 'vitest';
import { tooltip } from './tooltip.js';

function overlay() {
	return document.querySelector('.app-tooltip');
}

function mount(html) {
	const host = document.createElement('div');
	host.innerHTML = html;
	document.body.appendChild(host);
	return host.firstElementChild;
}

afterEach(() => {
	document.body.querySelectorAll('div:not(.app-tooltip)').forEach((d) => d.remove());
});

describe('UI-5: tooltip() gives icon-only controls a name and shows on focus', () => {
	it('names an icon-only button after its tooltip, and removes the name on teardown', () => {
		const btn = mount('<button><svg></svg></button>');
		const teardown = tooltip('Save this session')(btn);
		expect(btn.getAttribute('aria-label')).toBe('Save this session');
		teardown();
		expect(btn.hasAttribute('aria-label')).toBe(false);
	});

	it('never replaces a name the control already has', () => {
		const labelled = mount('<button aria-label="Undo"><svg></svg></button>');
		tooltip('Undo (Cmd/Ctrl+Z)')(labelled);
		expect(labelled.getAttribute('aria-label')).toBe('Undo');

		const texted = mount('<button>Apply</button>');
		tooltip('Apply to all plots')(texted);
		expect(texted.hasAttribute('aria-label')).toBe(false);
	});

	it('names role="button" hosts but not plain containers', () => {
		const port = mount('<div role="button" tabindex="-1"></div>');
		tooltip('Input: x')(port);
		expect(port.getAttribute('aria-label')).toBe('Input: x');

		const wrap = mount('<div><button></button></div>');
		tooltip('Open control panel')(wrap);
		expect(wrap.hasAttribute('aria-label')).toBe(false);
	});

	it('shows on keyboard focus and hides on blur and Escape', () => {
		const btn = mount('<button><svg></svg></button>');
		tooltip('Settings')(btn);
		btn.focus(); // keyboard-style focus (no pointer involved)
		expect(overlay().style.visibility).toBe('visible');
		expect(overlay().textContent).toBe('Settings');
		btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(overlay().style.visibility).toBe('hidden');

		btn.blur();
		btn.focus();
		expect(overlay().style.visibility).toBe('visible');
		btn.blur();
		expect(overlay().style.visibility).toBe('hidden');
	});
});
