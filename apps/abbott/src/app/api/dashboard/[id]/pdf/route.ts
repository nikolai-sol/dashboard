import { createAbbottPdfHandler } from "../../../../../lib/abbott-pdf-handler";

export const dynamic = "force-dynamic";

const handleGet = createAbbottPdfHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGet(request, context);
}
