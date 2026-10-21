// Colour by / Size by in a session DRAFT (colour-by plan 2026-10-20, section 3.9: "MCP").
//
// The rules live in the app's src/lib/components/plotbits/encodingSpec.js (pure, Worker-safe,
// like overlaySpec.js), so a draft, the app's AI edit (src/lib/utils/aiEdit.js) and the MCP
// engine's add_plot (src/engine/session.js) accept the same syntax and refuse the same things
// with the same words. This module is the Worker's door to them: the normalizer passes the
// generated facts (`ENCODINGS`, built by gen-schema.js with the same `encodingFacts`).
export {
	draftEncoding,
	draftSeriesEncodings,
	draftAsksForEncoding,
	applySeriesEncodings,
	describePlotEncodings,
	encodingsText,
	encodingFacts,
	encodingCapsOf
} from '../../../src/lib/components/plotbits/encodingSpec.js';
