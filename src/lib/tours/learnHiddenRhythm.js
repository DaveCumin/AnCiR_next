// learnHiddenRhythm.js — classroom lesson 1. Loads a noisy ~24 h signal and walks
// the student through reading the period off the periodogram. Curriculum: NZC
// M7-2/M8-7/S8-1; NCEA AS91575/AS91580. See docs/classroom/curriculum-plan.md.
import { loadLesson } from '$lib/core/classroomTour.js';

export const tour = {
	id: 'learn-hidden-rhythm',
	kind: 'lesson',
	name: 'Lesson: Find the hidden rhythm',
	description: 'There is a cycle hidden in this data — use the periodogram to find how long it is.',
	estMinutes: 4,
	order: 3,
	steps: [
		{
			target: null,
			title: 'Find the hidden rhythm',
			body: 'A <strong>rhythm</strong> is a pattern that repeats; the time for one full repeat is its <strong>period</strong>. This data hides a daily cycle under noise. Let’s find its period. (Loading the lesson…)',
			beforeShow: () => loadLesson('learn-hidden-rhythm.json'),
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Look at the raw signal first',
			body: 'Look at the <strong>Raw signal</strong> scatter: 7 days of activity, sampled every hour. Can you see a clean 24-hour cycle just by eye? It’s hard — the <strong>noise</strong> hides it. That’s exactly the problem real scientists face.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Read the periodogram',
			body: 'The <strong>periodogram</strong> tests many candidate periods and scores how well each fits. The x-axis is the period (in hours); the y-axis is the score. The best period shows up as a <strong>peak</strong> — read the period under the tallest peak.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Check your answer',
			body: 'Open the <strong>For teachers</strong> note on the canvas to reveal the true period that was used to build the data. How close was the peak? This is the power of simulated data: you can always check.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Try this',
			body: 'Open the <strong>Simulate data</strong> node and drag its <strong>Noise</strong> slider up, then watch the periodogram peak shrink and broaden. How much noise can you add before you can no longer find the rhythm? Reopen this lesson anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
