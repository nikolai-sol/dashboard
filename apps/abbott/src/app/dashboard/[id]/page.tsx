import { notFound } from "next/navigation";
import { normalizeAbbottIdentifier } from "@reportingdash/runtime-contract";
import AbbottDashboardPage from "../../../components/AbbottDashboardPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!normalizeAbbottIdentifier(id)) notFound();
  const dashboardId = id.trim().toLowerCase() === "18" ? "18" : "abbott";
  return <AbbottDashboardPage dashboardId={dashboardId} />;
}
