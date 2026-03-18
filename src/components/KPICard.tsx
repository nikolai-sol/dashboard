"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

type KPICardProps = {
  title: string;
  value: number;
  prevValue: number;
  color: string;
  format: (value: number) => string;
  trend: number[];
  pdfMode?: boolean;
};

export default function KPICard({
  title,
  value,
  prevValue,
  color,
  format,
  trend,
  pdfMode = false,
}: KPICardProps) {
  const [animatedValue, setAnimatedValue] = useState(0);

  useEffect(() => {
    if (pdfMode) {
      setAnimatedValue(value);
      return;
    }
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

  const delta = useMemo(() => {
    if (prevValue === 0) {
      return 0;
    }
    return ((value - prevValue) / prevValue) * 100;
  }, [prevValue, value]);

  const trendData = trend.map((item, idx) => ({ x: idx, value: item }));
  const positive = delta >= 0;

  return (
    <article className="card-surface flex min-h-[180px] flex-col justify-between p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
            {title}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900 sm:text-3xl" title={format(value)}>
            {format(animatedValue)}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
            positive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
          }`}
        >
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {Math.abs(delta).toFixed(1)}%
        </div>
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
