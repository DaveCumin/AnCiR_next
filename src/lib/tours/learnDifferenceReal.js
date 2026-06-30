// learnDifferenceReal.js — classroom lesson 3. Loads two groups (weekday vs
// weekend) and walks the student through deciding whether the difference is real.
// Curriculum: NZC S7-1/S8-1; NCEA AS91264/AS91582. See curriculum-plan.md.
import { loadLesson } from '$lib/core/classroomTour.js';

export const tour = {
	id: 'learn-difference-real',
	kind: 'lesson',
	name: 'Lesson: Is the difference real?',
	description:
		'Compare weekday vs weekend activity and decide if the difference is real or chance.',
	estMinutes: 5,
	order: 5,
	steps: [
		{
			target: null,
			title: 'Is the difference real?',
			body: 'Two groups almost never have exactly equal averages — random variation alone makes gaps. The big question of statistics is: <strong>is this gap bigger than chance would produce?</strong> (Loading the lesson…)',
			beforeShow: () => loadLesson('learn-difference-real.json'),
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Compare the boxes first',
			body: 'Look at the <strong>boxplot</strong>: weekday vs weekend. Compare the medians and how spread out each box is. Make a guess <em>before</em> any test — does the difference look real to you?',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Run the comparison',
			body: 'Open the <strong>Compare groups</strong> node. It picks an appropriate test and tells you whether the difference is <strong>statistically significant</strong> — i.e. bigger than chance alone would usually give.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Reveal the truth',
			body: 'Open the <strong>For teachers</strong> note to see whether a real difference was actually built in. Remember the key idea: <em>a visible gap is not automatically a real one.</em>',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Try this',
			body: 'Here’s the idea to take away: the same gap can be “significant” with a large sample yet not with a small one — more data lets you detect smaller real effects. Try it on your own data: compare two groups and see what the test says. Reopen anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
