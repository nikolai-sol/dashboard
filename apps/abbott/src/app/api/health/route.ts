import { createHealthHandler } from "../../../lib/abbott-health-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createHealthHandler();
