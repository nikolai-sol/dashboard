/** Offline visual fixture only. Not a Next route, DB connection, or production auth bypass. */
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {prepareRegionalImport} from '../src/lib/lyzobact-regions-import';
async function main(){
const output=process.argv[2];
const input=process.argv[3];
if(!output||!input)throw Error('Usage: preview-lyzobact-regions.ts OUTPUT_DIR VERIFIED_WORKBOOK_DIR');
fs.mkdirSync(output,{recursive:true});
const normalized=prepareRegionalImport(fs.readFileSync(path.join(input,'register-85.json'),'utf8'),fs.readFileSync(path.join(input,'source-pages.csv'),'utf8'),{snapshotId:'audit-20261006',label:'Проверка источников 05–06.10.2026'});
const data={dashboardId:0,status:'ready',snapshots:[{id:normalized.snapshotId,label:normalized.label,checkedAt:normalized.checkedAt}],selectedSnapshotId:normalized.snapshotId,rows:normalized.rows,sourcePages:normalized.sourcePages};
fs.writeFileSync(path.join(output,'fixture.json'),JSON.stringify(data));
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import RegionalDashboard from ${JSON.stringify(path.resolve('src/components/lyzobact/RegionalDashboard.tsx'))};const data=${JSON.stringify(data)};const geometry=${fs.readFileSync('public/lyzobact/regions.geojson','utf8')};createRoot(document.getElementById('root')).render(React.createElement(RegionalDashboard,{data,initialGeometry:geometry,onSnapshotChange:()=>{}}));`;
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},outfile:path.join(output,'preview.js'),bundle:true,platform:'browser',minify:true});
const chunks=fs.readdirSync('.next/static/chunks').filter(f=>f.endsWith('.css'));
const css=chunks.map(f=>fs.readFileSync(path.join('.next/static/chunks',f),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'index.html'),`<!doctype html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Лизобакт — локальный просмотр проверенного снимка</title><style>${css}</style><body style="font-family:Arial,sans-serif;background:#f6f8fa"><div style="padding:8px 24px;background:#fff3dd;font-size:12px">Локальный просмотр · не подключён к рабочей базе · данные проверки 05–06.10.2026</div><div id="root"></div><script src="preview.js"></script></body></html>`);
console.log(JSON.stringify({output,rows:data.rows.length,sources:data.sourcePages.length}));

}
main().catch(error=>{console.error(error);process.exitCode=1;});
