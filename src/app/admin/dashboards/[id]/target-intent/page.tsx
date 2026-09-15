import DashboardTargetIntentScreen from "@/components/admin/DashboardTargetIntentScreen";

export default async function DashboardTargetIntentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DashboardTargetIntentScreen dashboardId={id} />;
}
