// @ts-nocheck
// Worker wrapper for the MovingAnalysis windowed loop (many periodograms/fits).
// Offloaded as ONE task (not per-window) so a single dispatch covers the whole
// loop; the table process gates on aggregate work (windows × y-series).
import { computeMovingWindows } from './movinganalysis.js';
import { registerComputeTask } from '$lib/workers/computeTasks.js';

export function movingAnalysisCompute(params) {
	return computeMovingWindows(params);
}

registerComputeTask('movingAnalysis.compute', movingAnalysisCompute);
