import DashboardGoogleAdsOpsScreen from "@/components/admin/DashboardGoogleAdsOpsScreen";

export default async function DashboardGoogleAdsOpsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DashboardGoogleAdsOpsScreen dashboardId={id} />;
}
