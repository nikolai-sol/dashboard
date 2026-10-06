import { isDashboardAccessAuthorized } from '@/lib/dashboard-access';
import { createRegionalGetHandler } from '@/lib/lyzobact-regions-http';
import { isRegionalModuleEnabled, loadRegionalModule } from '@/lib/lyzobact-regions-store';
export const dynamic='force-dynamic';
export const GET=createRegionalGetHandler({authorize:isDashboardAccessAuthorized,enabled:isRegionalModuleEnabled,load:loadRegionalModule});
