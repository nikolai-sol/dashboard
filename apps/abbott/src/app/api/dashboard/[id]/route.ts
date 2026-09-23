import { createAbbottJsonHandler } from "../../../../lib/abbott-json-handler";

export const dynamic = "force-dynamic";

const handleGet = createAbbottJsonHandler();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGet(request, context);
}
