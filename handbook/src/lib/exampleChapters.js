// Pure helpers that map bundled AnCiR example sessions to handbook chapters.
//
// Composition (see gallery spec): a session showcases one or more nodes; each
// node's curated entry in nodeReference.json carries `crosslinks` to chapters.
// The union of those crosslinks (minus "glossary") is the set of chapters a
// session belongs in. No hand-authored placement list — placement is derived.
//
// Kept as a framework-free module (mirrors nodeGeometry.js precedent) so it can
// be unit-tested and reused by both the per-chapter blocks and the gallery.
import nodeRef from "$lib/nodeReference.json";
// AnCiR's full session index (same repo). Datasets are filtered out here — the
// gallery/chapters only show workflow/plot/process sessions — which reproduces
// the trim the old cross-repo sync used to bake into a bundled file.
import sessionIndex from "$ancir/static/sessions/demos/index.json";

const allSessions = Array.isArray(sessionIndex)
  ? sessionIndex
  : (sessionIndex.sessions ?? sessionIndex.demos ?? []);
export const SESSIONS = allSessions.filter((s) => s.kind !== "dataset");

export const CHAPTER_TITLES = {
  ch1: "Introduction to Chronobiology",
  ch2: "Data Collection",
  ch3: "Simulating Data",
  ch4: "Preprocessing",
  ch5: "Actograms",
  ch6: "Periodograms",
  ch7: "Cosinor Analysis",
  ch8: "Fourier Analysis",
  ch9: "Correlograms",
  ch10: "Phase Response Curves",
  ch11: "Linear & Additive Models",
  ch12: "Circular Statistics",
  ch13: "Best Practices",
};

// Richest-first ordering of node kinds, used as a ranking tie-break.
const KIND_RANK = { workflow: 0, tableProcess: 1, plot: 2, process: 3 };

// Chapters a single node crosslinks to (excluding the glossary).
function chaptersForNode(nodeId) {
  const links = nodeRef[nodeId]?.crosslinks ?? [];
  return links.filter((c) => c !== "glossary");
}

// The set of chapters a session belongs in, with a per-chapter relevance score
// = how many of the session's showcased nodes point at that chapter.
export function chapterScores(session) {
  const scores = {};
  for (const nodeId of session.showcases ?? []) {
    for (const ch of chaptersForNode(nodeId)) {
      scores[ch] = (scores[ch] ?? 0) + 1;
    }
  }
  return scores;
}

// Sessions relevant to a chapter, ranked: most "about" this chapter first
// (highest score), then richest kind, then name. `limit` caps the list; the
// caller can show a "see all" tail when more exist.
export function sessionsForChapter(chId, limit = Infinity) {
  const ranked = SESSIONS.map((s) => ({ session: s, score: chapterScores(s)[chId] ?? 0 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ka = KIND_RANK[a.session.kind] ?? 9;
      const kb = KIND_RANK[b.session.kind] ?? 9;
      if (ka !== kb) return ka - kb;
      return (a.session.name ?? "").localeCompare(b.session.name ?? "");
    })
    .map((r) => r.session);
  return {
    shown: ranked.slice(0, limit),
    total: ranked.length,
  };
}
