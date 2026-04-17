import DashboardWizard from "@/components/admin/DashboardWizard";
import Link from "next/link";

export default async function EditDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Edit Dashboard #{id}</h1>
        <div className="flex gap-2">
          <Link
            href={`/admin/dashboards/${id}/media-plan`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Media Plan
          </Link>
          <Link
            href={`/admin/dashboards/${id}/media-plan-aliases`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Plan Aliases
          </Link>
          <Link
            href={`/admin/dashboards/${id}/metrika`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Yandex Metrika
          </Link>
        </div>
      </div>
      <DashboardWizard dashboardId={id} />
    </section>
  );
}
