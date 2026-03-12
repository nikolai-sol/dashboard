import DashboardWizard from "@/components/admin/DashboardWizard";

export default async function EditDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Edit Dashboard #{id}</h1>
      <DashboardWizard dashboardId={id} />
    </section>
  );
}
