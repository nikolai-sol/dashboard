import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import pool from '@/lib/db';
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from '@/lib/access-auth';
import { loadCreativePerformance } from '@/lib/creative-performance';
import { validateMappings, isMediaCreativeDashboard } from '@/lib/creative-performance-contract';
import { loadSchema } from '@/lib/schema-parser';
import { resolveSourceKey } from '@/lib/source-mapping';
type Context = {
    params: Promise<{
        id: string;
    }> | {
        id: string;
    };
};
function configObject(v: unknown): Record<string, unknown> { return typeof v === 'string' ? JSON.parse(v) : v as Record<string, unknown> ?? {}; }
async function handle(request: Request, context: Context, save: boolean) {
    if (!verifyAdminSession(parseCookieValue(request.headers.get('cookie'), ADMIN_SESSION_COOKIE)))
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1)
        return NextResponse.json({ error: 'Invalid dashboard id' }, { status: 400 });
    const conn = await pool.getConnection();
    try {
        if (save)
            await conn.beginTransaction();
        const [ds] = await conn.execute<RowDataPacket[]>(`SELECT config,dashboard_type FROM dashboards WHERE id=?${save ? ' FOR UPDATE' : ''}`, [id]);
        if (!ds.length)
            return NextResponse.json({ error: 'Dashboard not found' }, { status: 404 });
        if (!isMediaCreativeDashboard(String(ds[0].dashboard_type)))
            return NextResponse.json({ error: 'Creative mappings are available for Media dashboards' }, { status: 400 });
        const config = configObject(ds[0].config);
        const [sources] = await conn.execute<RowDataPacket[]>('SELECT platform,schema_file,source_config,role FROM dashboard_sources WHERE dashboard_id=?', [id]);
        const counters = [...new Set(sources.flatMap(s => {
                if (s.role === 'custom_table')
                    return [];
                if ((loadSchema(String(s.schema_file)).source_key ?? resolveSourceKey(String(s.platform))) !== 'yandex_metrika')
                    return [];
                const ids = configObject(s.source_config).account_ids;
                return Array.isArray(ids) ? ids.map(String) : typeof ids === 'string' ? ids.split(',').map(v => v.trim()).filter(Boolean) : [];
            }))];
        const data = await loadCreativePerformance(id, String(config.period_from), String(config.period_to), [], undefined, [], { executor: conn });
        if (!save)
            return NextResponse.json({ creatives: data.rows, counters, mappings: config.creative_utm_bindings ?? [] });
        const bodyText = await request.text();
        if (bodyText.length > 2000000)
            throw new Error("Mapping payload exceeds 2 MB");
        const body = JSON.parse(bodyText);
        const mappings = validateMappings(body.mappings, data.rows, counters);
        config.creative_utm_bindings = mappings;
        await conn.execute('UPDATE dashboards SET config=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [JSON.stringify(config), id]);
        await conn.commit();
        return NextResponse.json({ mappings });
    }
    catch (error) {
        if (save)
            await conn.rollback();
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load creative mappings' }, { status: 400 });
    }
    finally {
        if (save)
            await conn.rollback();
        conn.release();
    }
}
export async function GET(request: Request, context: Context) { return handle(request, context, false); }
export async function PUT(request: Request, context: Context) { return handle(request, context, true); }
