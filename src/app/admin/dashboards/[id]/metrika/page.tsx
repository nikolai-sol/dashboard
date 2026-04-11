import DashboardMetrikaSettingsScreen from "@/components/admin/DashboardMetrikaSettingsScreen";

export default async function DashboardMetrikaSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DashboardMetrikaSettingsScreen dashboardId={id} />;
}
