import { loadDashboardData } from '../src/lib/dashboard-data-loader';
const req = new Request('https://dashboards.adreports.ru/api/dashboard/leovit26_rub?from=2026-03-28&to=2026-04-03');
const result = await loadDashboardData(req, 'leovit26_rub');
const data = result.data as any;
console.log(JSON.stringify({
  dashboard: data.dashboard,
  platforms: data.platforms,
  timeseries: data.timeseries,
  channel_performance: data.channel_performance,
}, null, 2));
