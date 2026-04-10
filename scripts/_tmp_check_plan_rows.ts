import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { fetchMediaPlanFromSourceConfig } from '../src/lib/gsheet-fetcher';

const sourceConfig = {
  sheet_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtDG9r25mTOsH6beNZ18ELF46TYzvT0Rz6BTxs5mxjqacOWq1VFAMoDV_EsVuLEBQNk_sNOcLyTE7q/pub?gid=0&single=true&output=csv'
};

async function main(){
  const rows = await fetchMediaPlanFromSourceConfig(sourceConfig as any);
  console.log(JSON.stringify(rows.map((r:any)=>({line_key:r.line_key,channel:r.channel,instrument:r.instrument,buy_type:r.buy_type,budget_plan:r.budget_plan,impressions_plan:r.impressions_plan,clicks_plan:r.clicks_plan,cpc_plan:r.cpc_plan,cpm_plan:r.cpm_plan,cpv_plan:r.cpv_plan,cpa_plan:r.cpa_plan,platform:r.platform,format:r.format})),null,2));
}
main().catch(e=>{console.error(e);process.exit(1)})
