"use client";

import { useState, type FormEvent } from "react";

export function siteLoginPath(siteSlug: string) {
  return `/api/dashboard/${encodeURIComponent(siteSlug)}/login`;
}

export function LoginForm({ dashboardId, siteSlug }: Readonly<{ dashboardId: number; siteSlug: string }>) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch(siteLoginPath(siteSlug), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dashboard_id: dashboardId, password }) });
    if (!response.ok) { setError("Не удалось войти"); return; }
    window.location.reload();
  }
  return <form onSubmit={submit}><label>Пароль <input name="password" type="password" required autoComplete="current-password" /></label><button type="submit">Войти</button>{error && <p role="alert">{error}</p>}</form>;
}
