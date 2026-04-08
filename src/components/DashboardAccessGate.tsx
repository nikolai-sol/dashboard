"use client";

import { useState } from "react";

type DashboardAccessGateProps = {
  dashboardId: string;
  dashboardName: string;
  clientName: string;
  authMode?: "email_password" | "password_only";
  onSuccess: (accessToken?: string) => void;
};

export default function DashboardAccessGate({
  dashboardId,
  dashboardName,
  clientName,
  authMode = "email_password",
  onSuccess,
}: DashboardAccessGateProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dashboard_id: dashboardId,
          email: authMode === "password_only" ? "" : email,
          password,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(json?.error ?? "Login failed"));
      }
      onSuccess(typeof json?.access_token === "string" ? json.access_token : undefined);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center justify-center px-4">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{dashboardName}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {authMode === "password_only"
            ? `${clientName} dashboard is protected. Enter the password to continue.`
            : `${clientName} dashboard is protected. Enter your login and password to continue.`}
        </p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {authMode === "password_only" ? null : (
            <label className="block text-sm text-slate-700">
              Email
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>
          )}
          <label className="block text-sm text-slate-700">
            Password
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Open dashboard"}
          </button>
        </form>
      </section>
    </div>
  );
}
