import { verifyAdminSession } from "@/lib/access-auth";
import {
  getSharedPasswordAdminState,
  rotateSharedDashboardPassword,
} from "@/lib/dashboard-shared-access";
import {
  changeSharedPassword,
  readSharedPasswordState,
} from "@/lib/shared-password-admin";
import { createSharedPasswordAdminRouteHandlers } from "@/lib/shared-password-admin-route";

export const runtime = "nodejs";

const handlers = createSharedPasswordAdminRouteHandlers({
  verifySession: verifyAdminSession,
  readState: (dashboardId) =>
    readSharedPasswordState(
      { dashboardId },
      { getState: getSharedPasswordAdminState },
    ),
  changePassword: ({ dashboardId, body, adminEmail }) =>
    changeSharedPassword(
      { dashboardId, body, adminEmail },
      {
        getState: getSharedPasswordAdminState,
        rotate: rotateSharedDashboardPassword,
      },
    ),
  logFailure: (operation, dashboardId) =>
    console.error(operation, dashboardId),
});

export const GET = handlers.GET;
export const PUT = handlers.PUT;
