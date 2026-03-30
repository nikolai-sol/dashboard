import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-slate-900 px-4 py-3 text-slate-100 md:hidden">
        <details>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
            Dashboard Admin
            <span aria-hidden>☰</span>
          </summary>
          <nav className="mt-3 space-y-2 text-sm">
            <Link href="/admin/dashboards" className="block rounded px-3 py-2 hover:bg-slate-800">
              Dashboards
            </Link>
            <Link href="/admin/platforms" className="block rounded px-3 py-2 hover:bg-slate-800">
              Platforms
            </Link>
            <Link href="/admin/collection" className="block rounded px-3 py-2 hover:bg-slate-800">
              Collection
            </Link>
            <Link href="/admin/settings" className="block rounded px-3 py-2 hover:bg-slate-800">
              Settings
            </Link>
            <form action="/api/admin/auth/logout" method="post" className="px-3 py-2">
              <button type="submit" className="text-left text-slate-300 hover:text-white">
                Logout
              </button>
            </form>
          </nav>
        </details>
      </div>

      <div className="mx-auto grid min-h-screen max-w-[1400px] grid-cols-1 md:grid-cols-[240px_1fr]">
        <aside className="hidden bg-slate-900 px-4 py-6 text-slate-100 md:block md:min-h-screen">
          <h1 className="text-lg font-semibold">Dashboard Admin</h1>
          <nav className="mt-6 space-y-2 text-sm">
            <Link href="/admin/dashboards" className="block rounded px-3 py-2 hover:bg-slate-800">
              Dashboards
            </Link>
            <Link href="/admin/platforms" className="block rounded px-3 py-2 hover:bg-slate-800">
              Platforms
            </Link>
            <Link href="/admin/collection" className="block rounded px-3 py-2 hover:bg-slate-800">
              Collection
            </Link>
            <Link href="/admin/settings" className="block rounded px-3 py-2 hover:bg-slate-800">
              Settings
            </Link>
            <form action="/api/admin/auth/logout" method="post" className="px-3 py-2">
              <button type="submit" className="text-left text-slate-300 hover:text-white">
                Logout
              </button>
            </form>
          </nav>
        </aside>

        <main className="px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
