import { Children, type ReactNode } from "react";
import ZarukuPanelGrid, { ZarukuPanelSlot } from "@/components/ZarukuPanelGrid";
import ZarukuInfoPopover from "@/components/ZarukuInfoPopover";
import { resolveZarukuPanels } from "@/components/zaruku-panel-layout";
import { ZARUKU_CLIENT_COPY } from "@/components/zaruku-client-copy";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  children?: ReactNode;
};

function formatDailyDate(value: string) {
  const normalized = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  return `${normalized.slice(8, 10)}.${normalized.slice(5, 7)}.${normalized.slice(0, 4)}`;
}

export default function ZarukuOverviewTab({ data, children }: Props) {
  void data;
  const panels = resolveZarukuPanels("overview");
  const panelChildren = Children.toArray(children);
  const dailyPeriod = data.dataset_meta.traffic_channels.period;
  const seoWeek = data.seo_os.latest_week;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Ежедневные данные: {formatDailyDate(dailyPeriod.from)}–{formatDailyDate(dailyPeriod.to)} · стандартный лаг 48 часов</span>
          {seoWeek ? (
            <span className="inline-flex items-center gap-1 font-medium text-slate-700">
              <span>{seoWeek} · недельный срез позиций</span>
              <ZarukuInfoPopover label={ZARUKU_CLIENT_COPY.weeklyPeriod.label}>
                <p className="text-xs leading-relaxed text-slate-600">
                  {ZARUKU_CLIENT_COPY.weeklyPeriod.note}
                </p>
              </ZarukuInfoPopover>
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-slate-500">Метрика, Google Search Console и Яндекс Вебмастер показаны за единый ежедневный период.</p>
      </section>
      <ZarukuPanelGrid className="zaruku-overview-grid">
        {panels.map((panel, index) => (
          <ZarukuPanelSlot key={panel.panelId} panel={panel}>
            {panelChildren[index] ?? null}
          </ZarukuPanelSlot>
        ))}
      </ZarukuPanelGrid>
    </div>
  );
}
