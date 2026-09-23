import { withReadOnlyAbbottExecutor } from "@/lib/abbott-private-store";

type HealthDependencies = {
  query: () => Promise<unknown>;
};

const PRIVATE_HEADERS = { "cache-control": "private, no-store" };

async function queryCanonicalDatabase(): Promise<void> {
  await withReadOnlyAbbottExecutor("embed", async (executor) => {
    await executor.query("SELECT 1 AS ok", []);
  });
}

export function createHealthHandler(
  dependencies: HealthDependencies = { query: queryCanonicalDatabase },
) {
  return async function healthHandler(): Promise<Response> {
    try {
      await dependencies.query();
      return Response.json(
        { ok: true, scope: "abbott", database: "connected" },
        { headers: PRIVATE_HEADERS },
      );
    } catch {
      return Response.json(
        { ok: false, scope: "abbott", database: "disconnected" },
        { status: 503, headers: PRIVATE_HEADERS },
      );
    }
  };
}
