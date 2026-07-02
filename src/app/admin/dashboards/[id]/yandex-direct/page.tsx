import DashboardYandexDirectOpsScreen from "@/components/admin/DashboardYandexDirectOpsScreen";

export default async function DashboardYandexDirectOpsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DashboardYandexDirectOpsScreen dashboardId={id} />;
}
