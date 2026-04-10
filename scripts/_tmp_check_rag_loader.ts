import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const { loadDashboardData } = await import('../src/lib/dashboard-data-loader');
  const req = new Request('https://dashboards.adreports.ru/api/dashboard/rag_mp?from=2026-02-01&to=2026-03-18');
  const loaded = await loadDashboardData(req, 'rag_mp');
  const data = loaded.data;
  console.log(JSON.stringify({
    dashboard: data.dashboard,
    kpi: data.kpi,
    platforms: data.platforms,
    plan_vs_fact: data.plan_vs_fact?.map((r:any)=>({channel:r.channel,instrument:r.instrument,buy_type:r.buy_type,budget_plan:r.budget_plan,budget_fact:r.budget_fact,impressions_fact:r.impressions_fact,clicks_fact:r.clicks_fact,views_fact:r.views_fact,conversions_fact:r.conversions_fact,campaign_count:r.campaign_count,platforms:r.platforms})),
    channel_performance: data.channel_performance?.map((r:any)=>({channel:r.channel,instrument:r.instrument,spend_fact:r.metrics?.spend?.fact,spend_plan:r.metrics?.spend?.plan,status:r.metrics?.spend?.status}))
  }, null, 2));
}
main().catch((err)=>{console.error(err);process.exit(1)});
