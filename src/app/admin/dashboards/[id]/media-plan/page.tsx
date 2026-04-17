import DashboardMediaPlanEditorScreen from "@/components/admin/DashboardMediaPlanEditorScreen";

export default async function DashboardMediaPlanEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DashboardMediaPlanEditorScreen dashboardId={id} />;
}
