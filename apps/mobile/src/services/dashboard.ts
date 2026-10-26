import { getCategoryTimeTotals } from '../data/database';
import { listCategories } from './categories';
import { buildDashboardSummary, dashboardDates } from '../utils/dashboard';

export type { DashboardSummary, DashboardCategoryMetric, DashboardPercentageBasis, DashboardMetric } from '../utils/dashboard';

function checkCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error('Dashboard preparation was cancelled.');
  error.name = 'AbortError';
  throw error;
}

/** The database already counts each actual minute cell once, including color-only
 * cells and blank group members. Plans and calendar providers are never read. */
export async function getDashboardSummary(value: readonly string[], options: { signal?: AbortSignal } = {}) {
  const dates = dashboardDates(value);
  checkCancelled(options.signal);
  const [rows, categories] = await Promise.all([
    getCategoryTimeTotals(dates[0]!, dates.at(-1)!), listCategories(),
  ]);
  checkCancelled(options.signal);
  return buildDashboardSummary(dates, rows, categories);
}
