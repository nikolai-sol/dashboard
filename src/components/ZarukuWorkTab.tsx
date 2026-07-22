import type { ReactNode } from "react";
import { hasHistoricalZeroTelemetry } from "@/components/zaruku-work-state";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  primaryWeek: string | null;
  comparisonWeek: string | null;
  children: ReactNode;
};

export default function ZarukuWorkTab({ data, primaryWeek, comparisonWeek, children }: Props) {
  const hasIncompleteTelemetry = hasHistoricalZeroTelemetry(data.seo_os.runs);
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div><h3 className="text-base font-semibold text-slate-900">Работы и задачи</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">Управленческий контур SEO OS: решения, медицинская проверка, задачи и ритм выполнения.</p></div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-md bg-slate-50 px-2.5 py-1.5"><strong className="text-slate-800">Основная неделя:</strong> {primaryWeek ?? "не выбрана"}</span>{comparisonWeek ? <span className="rounded-md bg-slate-50 px-2.5 py-1.5"><strong className="text-slate-800">Неделя сравнения:</strong> {comparisonWeek}</span> : null}</div>
        </div>
      </section>
      {hasIncompleteTelemetry ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"><strong>Историческая телеметрия неполная.</strong> В ранних запусках SEO OS счётчики могли сохраняться нулевыми; ноль не означает, что работ не было. Статусы задач и решений показаны отдельно и остаются источником операционного факта.</div> : null}
      {children}
    </div>
  );
}
