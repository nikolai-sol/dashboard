const SHARED_PASSWORD_CLIENT_IDS = new Set(["abbott", "zaruku"]);

export const MIN_SHARED_PASSWORD_LENGTH = 10;
export const MAX_SHARED_PASSWORD_LENGTH = 256;

export function normalizeSharedPasswordClientId(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

export function isSharedPasswordClient(value: string) {
  return SHARED_PASSWORD_CLIENT_IDS.has(normalizeSharedPasswordClientId(value));
}

export function validateSharedPasswordChange(input: {
  new_password: unknown;
  confirm_password: unknown;
}) {
  if (typeof input.new_password !== "string" || typeof input.confirm_password !== "string") {
    return { ok: false as const, error: "Пароль должен быть строкой" };
  }

  const password = input.new_password;
  const confirmation = input.confirm_password;

  if (password !== confirmation) {
    return { ok: false as const, error: "Пароли не совпадают" };
  }
  if (password.length < MIN_SHARED_PASSWORD_LENGTH) {
    return { ok: false as const, error: "Пароль должен содержать не менее 10 символов" };
  }
  if (password.length > MAX_SHARED_PASSWORD_LENGTH) {
    return { ok: false as const, error: "Пароль слишком длинный" };
  }

  return { ok: true as const, password };
}
