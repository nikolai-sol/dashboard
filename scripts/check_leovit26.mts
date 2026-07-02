import { loadDashboardData } from '../src/lib/dashboard-data-loader';
import type { DashboardData } from '../src/lib/types';

const req = new Request('https://dashboards.adreports.ru/api/dashboard/leovit26_rub?from=2026-03-28&to=2026-04-03');
const result = await loadDashboardData(req, 'leovit26_rub');
if (!result.data) throw new Error('Dashboard data is empty');
const data: DashboardData = result.data;
console.log(JSON.stringify({
  dashboard: data.dashboard,
  platforms: data.platforms,
  timeseries: data.timeseries,
  channel_performance: data.channel_performance,
}, null, 2));
