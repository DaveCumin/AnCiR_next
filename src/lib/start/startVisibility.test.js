import { describe, it, expect } from 'vitest';
import { startOverlayState } from './startVisibility.js';

const base = {
	sessionIsEmpty: true,
	startDismissed: false,
	deepLinkPending: false,
	welcomeSummoned: false
};

describe('startOverlayState', () => {
	it('an empty session shows the start screen and NOT the add-data prompt beneath it', () => {
		expect(startOverlayState(base)).toEqual({ showStartScreen: true, offerAddData: false });
	});

	it('dismissing the start screen on an empty session hands over to the add-data prompt', () => {
		expect(startOverlayState({ ...base, startDismissed: true })).toEqual({
			showStartScreen: false,
			offerAddData: true
		});
	});

	it('a summoned welcome screen over an empty session hides the prompt while it is up', () => {
		const s = startOverlayState({ ...base, startDismissed: true, welcomeSummoned: true });
		expect(s.offerAddData).toBe(false);
	});

	it('a deep-linked load in flight shows neither, so nothing flashes before the session lands', () => {
		expect(startOverlayState({ ...base, deepLinkPending: true })).toEqual({
			showStartScreen: false,
			offerAddData: false
		});
	});

	it('a session with anything in it shows neither', () => {
		expect(startOverlayState({ ...base, sessionIsEmpty: false, startDismissed: true })).toEqual({
			showStartScreen: false,
			offerAddData: false
		});
	});
});
