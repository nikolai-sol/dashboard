import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";

function adminRequest(pathname: string, cookieValue: string) {
  return new NextRequest(`http://dashboard.test${pathname}`, {
    headers: {
      cookie: `dashboard_admin_session=${cookieValue}`,
    },
  });
}

for (const malformedToken of [
  "payload.%",
  "payload.%25",
  "%E0%A4%A.signature",
  "payload.signature.trailing-segment",
]) {
  test(`malformed admin cookie ${JSON.stringify(malformedToken)} fails closed without throwing`, async () => {
    const response = await middleware(
      adminRequest("/api/admin/dashboards/28/shared-password", malformedToken),
    );

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  });
}

test("middleware-generated admin API unauthorized responses are never cacheable", async () => {
  const response = await middleware(
    new NextRequest("http://dashboard.test/api/admin/dashboards", {
      headers: { cookie: "dashboard_admin_session=unsigned" },
    }),
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
