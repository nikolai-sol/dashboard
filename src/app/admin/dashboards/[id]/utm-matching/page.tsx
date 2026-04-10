import DashboardUtmSourceMatching from "@/components/admin/DashboardUtmSourceMatching";

export default async function DashboardUtmMatchingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">UTM Matching for Dashboard #{id}</h1>
      <DashboardUtmSourceMatching dashboardId={id} />
    </section>
  );
}
