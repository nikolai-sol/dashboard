import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { parseMediaPlanSource, type MediaPlanRow, type MediaPlanSourceConfig } from '../src/lib/gsheet-fetcher';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

type SourceConfigRow = RowDataPacket & {
  source_config: string | MediaPlanSourceConfig;
};

async function main(){
  const pool = await mysql.createPool({host:process.env.DB_HOST!,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER!,password:process.env.DB_PASSWORD!,database:process.env.DB_NAME||'report_bd',dateStrings:true});
  const [rows] = await pool.query<SourceConfigRow[]>("SELECT source_config FROM dashboard_sources WHERE dashboard_id=1 AND platform='media_plan' LIMIT 1");
  const sourceConfig = typeof rows[0].source_config === 'string' ? JSON.parse(rows[0].source_config) as MediaPlanSourceConfig : rows[0].source_config;
  const parsed = await parseMediaPlanSource(sourceConfig);
  console.log(JSON.stringify({format: parsed.format, rowCount: parsed.rows.length, sample: parsed.rows.map((r: MediaPlanRow)=>({line_key:r.line_key,channel:r.channel,platform:r.platform,buy_type:r.buy_type,budget_plan:r.budget_plan,cpc_plan:r.cpc_plan})).slice(0,20)}, null, 2));
  await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)})
