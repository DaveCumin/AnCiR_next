// The standalone presentation pages built into <build>/animations/ by
// scripts/build-animations.mjs, one page per entry, plus an index.
//
// Each entry mounts the SAME component the handbook chapter mounts, with the
// same props the chapter passes, so a standalone page cannot drift from the
// handbook: there is no second copy of any animation's code. `props` mirror
// the chapter's usage (the height is the handbook's; the standalone shell
// measures the handbook layout at that height, then lets the graphic fill the
// window while keeping those proportions).
//
// Every component in src/lib/animations/ must either appear here or be listed
// in NOT_ANIMATIONS; the build fails otherwise, so a new animation cannot
// silently miss its presentation page.

export const ANIMATIONS = [
	{
		slug: 'sine',
		component: 'SineAnim',
		props: { height: '500px' },
		title: 'Components of a sinusoidal rhythm',
		where: 'Chapter 1: Introduction',
		blurb: 'Mesor, amplitude, period and phase, drawn onto a 48 h sine curve one at a time.'
	},
	{
		slug: 'molecular',
		component: 'MolecularAnim',
		props: {},
		title: 'The molecular clock',
		where: 'Chapter 1: Introduction',
		blurb: 'The mammalian transcription-translation feedback loop, step by step.'
	},
	{
		slug: 'nyquist',
		component: 'NyquistAnim',
		props: { height: '600px' },
		title: 'Sampling and aliasing (Nyquist)',
		where: 'Chapter 2: Data Collection',
		blurb: 'A 24 h rhythm sampled ever more sparsely, and the false period that appears.'
	},
	{
		slug: 'interpolation',
		component: 'InterpolationAnim',
		props: {},
		title: 'Interpolating across gaps',
		where: 'Chapter 4: Preprocessing',
		blurb: 'Linear interpolation error grows with the length of the gap.'
	},
	{
		slug: 'detrend',
		component: 'DetrendAnim',
		props: {},
		title: 'Detrending',
		where: 'Chapter 4: Preprocessing',
		blurb: 'Fitting and removing a slow trend so the rhythm stands out.'
	},
	{
		slug: 'actogram',
		component: 'ActogramAnim',
		props: { height: '400px' },
		title: 'Building a double-plotted actogram',
		where: 'Chapter 5: Actograms',
		blurb: 'A 7-day recording cut into days and stacked, with a drifting free-running onset.'
	},
	{
		slug: 'folding',
		component: 'FoldingPeriodogramAnim',
		props: {},
		title: 'Folding periodogram (Enright and chi-squared)',
		where: 'Chapter 6: Periodograms',
		blurb: 'Fold, bin, compute the statistic, then sweep the trial period.'
	},
	{
		slug: 'periodogram',
		component: 'PeriodogramAnim',
		props: { height: '600px' },
		title: 'Least-squares periodogram',
		where: 'Chapter 6: Periodograms',
		blurb: 'A test sine swept across trial periods; the fit quality traces the periodogram.'
	},
	{
		slug: 'fft',
		component: 'FftAnim',
		props: {},
		title: 'Discrete Fourier transform',
		where: 'Chapter 8: Fourier Analysis',
		blurb:
			'Test frequencies compared against a 24 h + 12 h signal, building the magnitude spectrum.'
	},
	{
		slug: 'wavelet',
		component: 'WaveletAnim',
		props: { height: '560px' },
		title: 'Continuous wavelet transform',
		where: 'Chapter 8: Fourier Analysis',
		blurb: 'A wavelet slid along the signal at each scale, building the scalogram.'
	},
	{
		slug: 'correlogram',
		component: 'CorrelogramAnim',
		props: {},
		title: 'Autocorrelation (correlogram)',
		where: 'Chapter 9: Correlograms',
		blurb: 'The signal compared with a lagged copy of itself, lag by lag.'
	},
	{
		slug: 'prc',
		component: 'PRCAnim',
		props: { height: '520px' },
		title: 'Constructing a phase response curve',
		where: 'Chapter 10: Phase Response Curves',
		blurb: 'Light pulses at different circadian times, and the phase shifts they cause.'
	},
	{
		slug: 'chi-squared',
		component: 'ChiSquaredAnim',
		props: { stage: 'test' },
		title: 'The chi-squared test',
		where: 'Statistical Foundations',
		blurb: 'Observed against expected counts, and the statistic that measures the gap.'
	},
	{
		slug: 'permutation',
		component: 'PermutationAnim',
		props: { height: '520px' },
		title: 'Permutation test',
		where: 'Statistical Foundations',
		blurb: 'Relabelling the data at random to build the null distribution.'
	},
	{
		slug: 'fdr',
		component: 'FDRAnim',
		props: { height: '500px' },
		title: 'False discovery rate (Benjamini-Hochberg)',
		where: 'Statistical Foundations',
		blurb: 'Sort the p-values, compare each with its rank threshold, and cut.'
	},
	{
		slug: 'sound',
		component: 'SoundSpectrumAnim',
		props: {},
		title: 'Sound spectrum and spectrogram',
		where: 'Standalone extra (not in a chapter)',
		blurb: 'Three tones as a waveform, an FFT bar graph and a spectrogram, or your microphone live.'
	}
];

// Components in src/lib/animations/ that deliberately get no standalone page.
export const NOT_ANIMATIONS = {
	WiringDiagram: 'a static SVG diagram of AnCiR node wiring (Quick Start), not an animation'
};
