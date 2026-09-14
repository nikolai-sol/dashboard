import { createAbbottExcelHandler } from "../../../../../lib/abbott-excel-handler";

export const dynamic = "force-dynamic";

const handleGet = createAbbottExcelHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGet(request, context);
}
