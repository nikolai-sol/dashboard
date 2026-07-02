import Image from "next/image";
import Link from "next/link";
import { cookies } from "next/headers";
import ViewerPortalLogin from "@/components/ViewerPortalLogin";
import {
  VIEWER_PORTAL_SESSION_COOKIE,
  verifyViewerPortalSession,
} from "@/lib/access-auth";
import { listViewerPortalDashboards } from "@/lib/dashboard-access";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const token = cookieStore.get(VIEWER_PORTAL_SESSION_COOKIE)?.value;
  const session = verifyViewerPortalSession(token);
  const dashboards = session ? await listViewerPortalDashboards(session.dashboard_ids) : [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1100px] px-4 py-12 sm:px-6 lg:px-8">
      <section className="grid gap-8 rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8 lg:grid-cols-[1fr_minmax(0,28rem)] lg:items-center">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Dashboard Portal</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 sm:text-4xl">Личный кабинет</h1>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            Здесь видны только те дашборды, к которым у пользователя есть viewer-доступ. Редактирование остаётся только в admin части.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <Image
            src="/images/portal-hero-natural.png"
            alt="Две стеклянные чашки с маслом на льняной ткани"
            width={1024}
            height={682}
            className="h-auto w-full max-w-md rounded-2xl border border-slate-200/80 shadow-sm"
            sizes="(max-width: 1024px) 100vw, 28rem"
            priority
          />
        </div>
      </section>

      {session && dashboards.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Доступные дашборды</h2>
              <p className="mt-1 text-sm text-slate-600">{session.email}</p>
            </div>
            <form action="/api/viewer-portal/logout" method="post">
              <button type="submit" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Выйти
              </button>
            </form>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {dashboards.map((dashboard) => (
              <Link
                key={dashboard.id}
                href={dashboard.url}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{dashboard.client_name}</p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{dashboard.dashboard_name}</h3>
                <p className="mt-2 text-sm text-slate-600">{dashboard.url}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-8">
          <ViewerPortalLogin />
        </div>
      )}
    </main>
  );
}

