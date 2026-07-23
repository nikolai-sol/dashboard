import type { ReactNode } from "react";
import type { ZarukuDatasetMeta } from "@/lib/types";

type Props = {
  meta: ZarukuDatasetMeta;
  hasRows: boolean;
  children?: ReactNode;
};

export default function ZarukuPanelState({ meta, hasRows, children }: Props) {
  if (meta.state === "unavailable") {
    return (
      <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-900">
        <div className="font-semibold">Источник недоступен</div>
        <div className="mt-1 text-amber-800">{meta.message ?? "Повторите попытку позже."}</div>
      </div>
    );
  }
  if (meta.state === "empty" || !hasRows) {
    return (
      <div role="status" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
        Нет данных за выбранный период.
      </div>
    );
  }
  return (
    <>
      {meta.state === "partial" ? (
        <div role="status" className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <span className="font-semibold">Частичные данные.</span>{meta.message ? ` ${meta.message}` : ""}
        </div>
      ) : null}
      {children}
    </>
  );
}
