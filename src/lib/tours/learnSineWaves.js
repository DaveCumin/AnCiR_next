// learnSineWaves.js — classroom lesson 4. Loads a rhythm and walks the student
// through fitting a cosine (amplitude/phase/midline/period, R²). Curriculum: NZC
// M8-7/M7-2; NCEA AS91575. See curriculum-plan.md.
import { loadLesson } from '$lib/core/classroomTour.js';

export const tour = {
	id: 'learn-sine-waves',
	name: 'Lesson: Sine waves are everywhere',
	description: 'Fit a single cosine to a rhythm and read its amplitude, phase, midline, period and R².',
	estMinutes: 5,
	order: 6,
	steps: [
		{
			target: null,
			title: 'Sine waves are everywhere',
			body: 'The smoothest possible rhythm is a cosine wave: <span style="white-space:nowrap">y = M + A·cos(2π(t−φ)/τ)</span>. Four numbers describe it — midline <strong>M</strong>, amplitude <strong>A</strong>, phase <strong>φ</strong>, period <strong>τ</strong>. (Loading the lesson…)',
			beforeShow: () => loadLesson('learn-sine-waves.json'),
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Fit a cosine',
			body: 'Open the <strong>Cosinor</strong> node. It finds the values of midline, amplitude and phase that best match the data, and reports <strong>R²</strong> — how much of the pattern the cosine explains (near 1 = a great fit).',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Read the parameters on the graph',
			body: 'On the scatter: the <strong>midline</strong> is the level it oscillates around; the <strong>amplitude</strong> is how far it swings; the <strong>phase</strong> is where the peak falls. Match each number to what you see.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Check against the truth',
			body: 'Open the <strong>For teachers</strong> note to see the true amplitude, midline, period and peak time used to build the data. How close did the fit get?',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Try this',
			body: 'Add noise and watch R² fall. Then add a faster (12 h) component on top: a single cosine can no longer fit it well and R² drops — a clue the real signal is more complex than one wave. Reopen anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
