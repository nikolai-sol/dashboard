import type { SharedPasswordAdminState } from "./dashboard-shared-access";
import { validateSharedPasswordChange } from "./shared-password-policy";

export type SharedPasswordAdminResponse = {
  status: number;
  body: {
    ok?: true;
    supported?: boolean;
    configured?: boolean;
    updated_at?: string | null;
    error?: string;
  };
};

type RotateSharedPassword = (
  dashboardId: number,
  password: string,
  updatedBy: string,
) => Promise<SharedPasswordAdminState>;

type GetSharedPasswordState = (
  dashboardId: number,
) => Promise<SharedPasswordAdminState>;

function missingDashboardResponse(): SharedPasswordAdminResponse {
  return { status: 404, body: { error: "Дашборд не найден" } };
}

function unsupportedDashboardResponse(): SharedPasswordAdminResponse {
  return {
    status: 400,
    body: { error: "Смена пароля недоступна для этого дашборда" },
  };
}

function invalidDashboardResponse(): SharedPasswordAdminResponse {
  return {
    status: 400,
    body: { error: "Некорректный идентификатор дашборда" },
  };
}

function isValidDashboardId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

export async function readSharedPasswordState(
  input: { dashboardId: number },
  dependencies: { getState: GetSharedPasswordState },
): Promise<SharedPasswordAdminResponse> {
  if (!isValidDashboardId(input.dashboardId)) {
    return invalidDashboardResponse();
  }

  const state = await dependencies.getState(input.dashboardId);
  if (state.client_id === null) return missingDashboardResponse();

  return {
    status: 200,
    body: {
      supported: state.supported,
      configured: state.supported && state.configured,
      updated_at: state.supported ? state.updated_at : null,
    },
  };
}

export async function changeSharedPassword(
  input: {
    dashboardId: number;
    body: unknown;
    adminEmail: string;
  },
  dependencies: {
    getState?: GetSharedPasswordState;
    rotate: RotateSharedPassword;
  },
): Promise<SharedPasswordAdminResponse> {
  if (!isValidDashboardId(input.dashboardId)) {
    return invalidDashboardResponse();
  }

  const body =
    input.body !== null && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  const validation = validateSharedPasswordChange({
    new_password: body.new_password,
    confirm_password: body.confirm_password,
  });
  if (!validation.ok) {
    return { status: 400, body: { error: validation.error } };
  }

  if (dependencies.getState) {
    const currentState = await dependencies.getState(input.dashboardId);
    if (currentState.client_id === null) return missingDashboardResponse();
    if (!currentState.supported) return unsupportedDashboardResponse();
  }

  const state = await dependencies.rotate(
    input.dashboardId,
    validation.password,
    input.adminEmail.trim().toLowerCase(),
  );
  if (state.client_id === null) return missingDashboardResponse();
  if (!state.supported) return unsupportedDashboardResponse();

  return {
    status: 200,
    body: {
      ok: true,
      configured: state.configured,
      updated_at: state.updated_at,
    },
  };
}
