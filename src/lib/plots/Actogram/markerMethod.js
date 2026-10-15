// The one-line method note shown wherever the automatic onset/offset markers are set up
// (MarkerRuleBlock.svelte and PhaseMarker.svelte). It describes matchTemplateMarkers in
// onsetUnwrap.js: each row (with the next) is scored above or below the % percentile, and the
// marker goes where a template of N hours below then M hours above matches best (reversed for
// an offset).
//
// Reference. Template matching for activity onsets is the approach ClockLab (Actimetrics)
// implements. Its use is described in, for example:
//   Fernandez F, Nyhuis CC, Anand P, Demara BI, Ruby NF, Spanò G, Clark C, Edgin JO (2017).
//   Young children with Down syndrome show normal development of circadian rhythms, but poor
//   sleep efficiency: a cross-sectional study across the first 60 months of life.
//   Sleep Medicine 33:134-144. doi:10.1016/j.sleep.2016.12.026
// They found daily onsets in ClockLab v6 as the point where 5 h of relative immobility is
// followed by 5 h of vigorous movement, and offsets with the reciprocal 5 h template. That is
// an APPLICATION of ClockLab's method, not its origin, and AnCiR is not equivalent to it:
//   - the windows are user-set (N and M hours, default 3 h each, rounded to whole bins), not
//     fixed at 5 h;
//   - "immobility" and "movement" are AnCiR's own scoring: a bin is above or below the %
//     percentile (default 50) of the non-zero activity in this row and the next. The paper does
//     not describe how ClockLab scores activity, so nothing here reproduces that;
//   - one detection per actogram row, at the first bin after the best-matching transition.
// So the note says "as in ClockLab" for the idea and cites the paper as an example of its use.
export const TEMPLATE_METHOD_NOTE =
	'Method: template matching, the approach of ClockLab (Actimetrics); see Fernandez et al. (2017, Sleep Med 33:134) for its use with 5 h windows. Here activity is scored above or below the % percentile, and the marker goes where N h below then M h above fits best (the reverse for offsets).';
