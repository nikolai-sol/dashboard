import { createAbbottAdminUsersHandlers } from "../../../../../lib/abbott-admin-users-handler";

export const dynamic = "force-dynamic";

const handlers = createAbbottAdminUsersHandlers();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.GET(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.POST(request, context);
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handlers.DELETE(request, context);
}
