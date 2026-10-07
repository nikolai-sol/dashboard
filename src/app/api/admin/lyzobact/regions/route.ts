import type {RowDataPacket} from 'mysql2';
import pool from '@/lib/db';
import {verifyAdminSession} from '@/lib/access-auth';
import {createRegionalAdminGetHandler} from '@/lib/lyzobact-regions-admin';
import {isRegionalModuleEnabled,loadRegionalModule} from '@/lib/lyzobact-regions-store';
export const dynamic='force-dynamic';
export const GET=createRegionalAdminGetHandler({verifySession:verifyAdminSession,resolve:async slug=>{
 const [rows]=await pool.execute<RowDataPacket[]>('SELECT id FROM dashboards WHERE client_id = ? AND is_active = TRUE ORDER BY id LIMIT 2',[slug]);
 return rows.length===1?Number(rows[0].id):null;
},enabled:isRegionalModuleEnabled,load:loadRegionalModule});
