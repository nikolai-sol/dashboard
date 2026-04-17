import DashboardMediaPlanAliasesScreen from "@/components/admin/DashboardMediaPlanAliasesScreen";

export default async function DashboardMediaPlanAliasesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DashboardMediaPlanAliasesScreen dashboardId={id} />;
}
