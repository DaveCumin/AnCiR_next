// @ts-nocheck
/**
 * Shared stats-builder for nested table processes (used by LongToWide & CollectColumns).
 * Single source of truth: edit stats formatting here and it applies everywhere.
 */

export const TP_LABELS = {
	cosinor: 'Cosinor fit',
	bin: 'Bin data',
	smooth: 'Smooth data',
	trend: 'Trend fit',
	rectwave: 'Rectangular wave fit',
	dlog: 'Double logistic fit'
};

/** Table-process types that produce viewable / downloadable stats */
export const STATS_TYPES = ['cosinor', 'trend', 'rectwave', 'dlog'];

/**
 * Build a { headers, rows } summary table from the stored stats for one
 * nested table process.
 */
export function getTableProcessStatsData(tp, results, getColumnById) {
	const validResults = (results ?? []).filter((r) => r.valid && r.stats);
	if (!validResults.length) return { headers: [], rows: [] };

	const colNames = validResults.map((r) => getColumnById(Number(r.colId))?.name ?? String(r.colId));

	switch (tp.type) {
		case 'cosinor': {
			if (tp.args?.useFixedPeriod) {
				const maxH = Math.max(...validResults.map((r) => r.stats.harmonics?.length ?? 0));
				const headers = [
					'column',
					'rmse',
					'r2',
					'mesor',
					'mesor_ci_lo',
					'mesor_ci_hi',
					'F_stat',
					'p_value'
				];
				for (let h = 1; h <= maxH; h++) {
					headers.push(
						`H${h}_amplitude`,
						`H${h}_amp_ci_lo`,
						`H${h}_amp_ci_hi`,
						`H${h}_acrophase_hrs`,
						`H${h}_acro_ci_lo`,
						`H${h}_acro_ci_hi`
					);
				}
				const rows = validResults.map((r, i) => {
					const s = r.stats;
					const row = [
						colNames[i],
						s.rmse,
						s.r2,
						s.mesor,
						s.mesor_ci_lo,
						s.mesor_ci_hi,
						s.F_stat,
						s.p_value
					];
					for (let h = 0; h < maxH; h++) {
						const hd = s.harmonics?.[h];
						row.push(
							hd?.amplitude ?? null,
							hd?.amplitude_ci_lo ?? null,
							hd?.amplitude_ci_hi ?? null,
							hd?.acrophase_hrs ?? null,
							hd?.acrophase_ci_lo ?? null,
							hd?.acrophase_ci_hi ?? null
						);
					}
					return row;
				});
				return { headers, rows };
			} else {
				const maxC = Math.max(...validResults.map((r) => r.stats.cosines?.length ?? 0));
				const headers = ['column', 'rmse', 'r2'];
				for (let c = 1; c <= maxC; c++) {
					headers.push(`curve${c}_period`, `curve${c}_amplitude`, `curve${c}_phase`);
				}
				const rows = validResults.map((r, i) => {
					const s = r.stats;
					const row = [colNames[i], s.rmse, s.r2];
					for (let c = 0; c < maxC; c++) {
						const cd = s.cosines?.[c];
						row.push(cd?.period ?? null, cd?.amplitude ?? null, cd?.phase ?? null);
					}
					return row;
				});
				return { headers, rows };
			}
		}
		case 'trend': {
			const model = validResults[0]?.stats?.model ?? tp.args?.model ?? 'linear';
			let paramHeaders;
			if (model === 'linear') {
				paramHeaders = ['slope', 'intercept'];
			} else if (model === 'exponential' || model === 'logarithmic') {
				paramHeaders = ['a', 'b'];
			} else {
				const maxCoeffs = Math.max(
					...validResults.map((r) => r.stats.parameters?.coeffs?.length ?? 0)
				);
				paramHeaders = Array.from({ length: maxCoeffs }, (_, idx) => `c${idx}`);
			}
			const headers = ['column', 'rmse', 'r2', ...paramHeaders];
			const rows = validResults.map((r, i) => {
				const s = r.stats;
				const row = [colNames[i], s.rmse, s.r2];
				if (model === 'linear') {
					row.push(s.parameters?.slope ?? null, s.parameters?.intercept ?? null);
				} else if (model === 'exponential' || model === 'logarithmic') {
					row.push(s.parameters?.a ?? null, s.parameters?.b ?? null);
				} else {
					const coeffs = s.parameters?.coeffs ?? [];
					for (const c of coeffs) row.push(c);
					while (row.length < headers.length) row.push(null);
				}
				return row;
			});
			return { headers, rows };
		}
		case 'rectwave': {
			const headers = [
				'column',
				'rmse',
				'r2',
				'period',
				'acrophase',
				'duty_cycle',
				'kappa',
				'M',
				'A'
			];
			const rows = validResults.map((r, i) => {
				const s = r.stats;
				return [colNames[i], s.rmse, s.r2, s.period, s.acrophase, s.dutyCycle, s.kappa, s.M, s.A];
			});
			return { headers, rows };
		}
		case 'dlog': {
			const headers = ['column', 'rmse', 'r2', 'period', 'M', 'A', 'k1', 'onset', 'k2', 'offset'];
			const rows = validResults.map((r, i) => {
				const s = r.stats;
				return [colNames[i], s.rmse, s.r2, s.period, s.M, s.A, s.k1, s.t1, s.k2, s.t2];
			});
			return { headers, rows };
		}
		default:
			return { headers: [], rows: [] };
	}
}
