// learnNightOwl.js — classroom lesson 2. Loads a week of activity and walks the
// student through reading phase off an actogram. Curriculum: NZC Living World
// (Life processes); NCEA AS91604 (homeostasis). See curriculum-plan.md.
import { loadLesson } from '$lib/core/classroomTour.js';

export const tour = {
	id: 'learn-night-owl',
	name: 'Lesson: Am I a night owl?',
	description: 'Read a week of activity on an actogram and decide: morning lark or evening owl?',
	estMinutes: 4,
	order: 4,
	steps: [
		{
			target: null,
			title: 'Am I a night owl?',
			body: 'Your body runs an internal clock — an example of <strong>homeostasis</strong>, keeping you in step with the day. It sets <em>when</em> you’re most active. Let’s read one person’s week. (Loading the lesson…)',
			beforeShow: () => loadLesson('learn-night-owl.json'),
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'How an actogram works',
			body: 'An <strong>actogram</strong> stacks each day in a row, one under the next, so a daily pattern lines up into a vertical band. Find the busy band (activity) and the quiet band (rest).',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Lark or owl?',
			body: 'When does activity start and peak each day? Early = a <strong>morning type (lark)</strong>; late = an <strong>evening type (owl)</strong>. Make your call, then open the <strong>For teachers</strong> note to reveal the truth.',
			advance: { on: 'next' }
		},
		{
			target: null,
			title: 'Try this',
			body: 'Add a scatter of activity against hour-of-day — the same rhythm appears as a single hump. Which display makes the timing easier to read? Reopen this lesson anytime from the <strong>?</strong> menu.',
			advance: { on: 'next' }
		}
	]
};
