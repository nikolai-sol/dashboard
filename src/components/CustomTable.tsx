"use client";

import type { CustomTableData } from "@/lib/types";

type CustomTableProps = {
  data: CustomTableData;
  locale?: string;
  pdfMode?: boolean;
};

function isNumeric(value: string): boolean {
  const trimmed = value.trim().replace(/[€$£₽%\s]/g, "").replace(/,/g, ".");
  return /^-?\d+(\.\d+)?$/.test(trimmed) || /^-?\d+(\.\d+)?%?$/.test(trimmed);
}

function parseNumber(value: string): number {
  const cleaned = value.trim().replace(/[€$£₽%\s]/g, "").replace(/,/g, ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCell(value: string, locale = "en-US"): string {
  if (!value.trim()) return "";
  if (isNumeric(value)) {
    const num = parseNumber(value);
    if (value.includes("%")) {
      return `${num.toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
    }
    return num.toLocaleString(locale, {
      maximumFractionDigits: 2,
      minimumFractionDigits: num % 1 !== 0 ? 2 : 0,
    });
  }
  return value;
}

export default function CustomTable({ data, locale = "en-US", pdfMode = false }: CustomTableProps) {
  const { title, headers, rows } = data;
  if (!headers.length && !rows.length) return null;

  return (
    <section className="mb-6">
      <h3
        className={`mb-3 text-base font-semibold text-slate-900 ${pdfMode ? "" : "transition-colors"}`}
      >
        {title}
      </h3>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead>
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="bg-slate-50 px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={
                  pdfMode
                    ? ""
                    : "transition-colors hover:bg-slate-50"
                }
              >
                {headers.map((_, colIndex) => {
                  const cell = row[colIndex] ?? "";
                  const numeric = isNumeric(cell);
                  return (
                    <td
                      key={colIndex}
                      className={`whitespace-nowrap px-4 py-2 text-slate-700 ${
                        numeric ? "text-right font-mono tabular-nums" : "text-left"
                      }`}
                    >
                      {formatCell(cell, locale)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
