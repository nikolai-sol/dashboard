import type { ReactNode } from "react";
import ZarukuPeriodContext from "@/components/ZarukuPeriodContext";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  children: ReactNode;
};

export default function ZarukuOverviewTab({ data, children }: Props) {
  const search = [
    ...(data.gsc.latest_week && data.gsc.summary.length + data.gsc.queries.length > 0
      ? [{ label: "Google RF", period: data.gsc.latest_week }]
      : []),
    ...(data.webmaster.latest_week && data.webmaster.summary.length + data.webmaster.queries.length > 0
      ? [{ label: "Яндекс", period: data.webmaster.latest_week }]
      : []),
    ...(data.seo_os.latest_week && data.seo_os.position_trend.length > 0
      ? [{ label: "SEO OS", period: data.seo_os.latest_week }]
      : []),
  ];
  const aiRow = data.seo_intelligence.ai.rows.find((row) => row.period === data.seo_intelligence.ai.latest_period) ?? null;
  const onsiteMeta = data.dataset_meta.traffic_channels;

  return (
    <div className="space-y-5">
      <ZarukuPeriodContext
        onsite={{ requested: onsiteMeta.requested_period, actual: onsiteMeta.period }}
        search={search}
        ai={aiRow ? { period: aiRow.period, provenance: aiRow.provenance } : null}
      />
      {children}
    </div>
  );
}
