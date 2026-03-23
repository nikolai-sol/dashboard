"use client";

import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

type KPICardProps = {
  title: string;
  value: number;
  prevValue: number;
  color: string;
  format: (value: number) => string;
  trend: number[];
  pdfMode?: boolean;
  deltaOverride?: number | null;
};

export default function KPICard({
  title,
  value,
  prevValue,
  color,
  format,
  trend,
  pdfMode = false,
  deltaOverride,
}: KPICardProps) {
  const [animatedValue, setAnimatedValue] = useState(() => (pdfMode ? value : 0));

  useEffect(() => {
    if (pdfMode) return;
    const duration = 1200;
    const start = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      setAnimatedValue(value * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pdfMode, value]);

  const displayedValue = pdfMode ? value : animatedValue;
  void prevValue;
  void deltaOverride;

  const trendData = trend.map((item, idx) => ({ x: idx, value: item }));

  return (
    <article className="card-surface flex min-h-[180px] flex-col justify-between p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
          {title}
        </p>
        <p className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl" title={format(value)}>
          {format(displayedValue)}
        </p>
      </div>

      <div className="mt-4 h-14 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trendData}>
            <RechartsTooltip
              contentStyle={{
                borderRadius: "10px",
                borderColor: "#e2e8f0",
                fontSize: "12px",
              }}
              labelStyle={{ display: "none" }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={!pdfMode}
              animationDuration={pdfMode ? 0 : 900}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
