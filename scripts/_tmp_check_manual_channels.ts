import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import {
  fetchManualDataFromSourceConfig,
  aggregateByChannel,
  type ManualDataRow,
  type ManualDataSourceConfig,
} from '../src/lib/manual-data-fetcher';

type SourceConfigRow = RowDataPacket & {
  source_config: string | ManualDataSourceConfig | null;
};

async function main(){
 const pool = await mysql.createPool({host:process.env.DB_HOST!,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER!,password:process.env.DB_PASSWORD!,database:process.env.DB_NAME||'report_bd',dateStrings:true});
 const [rows] = await pool.query<SourceConfigRow[]>("SELECT platform, source_config FROM dashboard_sources WHERE dashboard_id=1 AND platform='manual_data' ORDER BY id");
 const all: ManualDataRow[] = [];
 for(const row of rows){
   const cfg = typeof row.source_config==='string'? JSON.parse(row.source_config) as ManualDataSourceConfig : row.source_config;
   if (!cfg) continue;
   const data = await fetchManualDataFromSourceConfig(cfg);
   all.push(...data.filter((r)=>!r.date || (r.date>='2026-02-01' && r.date<='2026-03-18')));
 }
 const by = aggregateByChannel(all);
 console.log(JSON.stringify(by,null,2));
 await pool.end();
}
main().catch(e=>{console.error(e);process.exit(1)})
