import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import htm from "https://esm.sh/htm@3.1.1";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "https://esm.sh/recharts@2.12.7";

const html = htm.bind(React.createElement);

const PLAT = {
  linkedin: { label: "LinkedIn", color: "#0A66C2", bg: "#eef4fb", icon: "in" },
  reddit: { label: "Reddit", color: "#FF4500", bg: "#fff1ec", icon: "r/" },
};

const fmtInt = (n) => Number(n || 0).toLocaleString("ru-RU");
const fmtMoney = (n) =>
  "€" +
  Number(n || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

function sum(list, field) {
  return list.reduce((acc, row) => acc + Number(row[field] || 0), 0);
}

function TooltipCard({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return html`
    <div style=${{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 10,
      padding: "8px 12px",
      boxShadow: "0 6px 24px rgba(0,0,0,.08)",
      fontSize: 12,
    }}>
      <div style=${{ color: "#9ca3af", marginBottom: 4 }}>${label}</div>
      ${payload.map(
        (p, idx) => html`<div key=${idx} style=${{ color: p.color, fontWeight: 600 }}>
          ${p.name}: ${fmtInt(p.value)}
        </div>`
      )}
    </div>
  `;
}

function App() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(["linkedin", "reddit"]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetch("/api/data?days=120")
      .then((r) => r.json())
      .then((data) => {
        const loaded = Array.isArray(data.rows) ? data.rows : [];
        setRows(loaded);
        if (loaded.length) {
          const dates = [...new Set(loaded.map((r) => r.date))].sort();
          setDateFrom(dates[0] || "");
          setDateTo(dates[dates.length - 1] || "");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const minDate = useMemo(() => {
    if (!rows.length) return "";
    return [...new Set(rows.map((r) => r.date))].sort()[0] || "";
  }, [rows]);

  const maxDate = useMemo(() => {
    if (!rows.length) return "";
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    return dates[dates.length - 1] || "";
  }, [rows]);

  const safeFrom = useMemo(() => {
    if (!dateFrom) return "";
    if (!dateTo) return dateFrom;
    return dateFrom <= dateTo ? dateFrom : dateTo;
  }, [dateFrom, dateTo]);

  const safeTo = useMemo(() => {
    if (!dateTo) return "";
    if (!dateFrom) return dateTo;
    return dateTo >= dateFrom ? dateTo : dateFrom;
  }, [dateFrom, dateTo]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        const p = (r.platform || "").toLowerCase();
        if (!selected.includes(p)) return false;
        if (safeFrom && r.date < safeFrom) return false;
        if (safeTo && r.date > safeTo) return false;
        return true;
      }),
    [rows, selected, safeFrom, safeTo]
  );

  const platformSummary = useMemo(() => {
    const map = new Map();
    for (const row of filtered) {
      const p = row.platform.toLowerCase();
      if (!map.has(p)) {
        map.set(p, {
          platform: p,
          impressions: 0,
          clicks: 0,
          spend: 0,
          conversions: 0,
        });
      }
      const item = map.get(p);
      item.impressions += Number(row.impressions || 0);
      item.clicks += Number(row.clicks || 0);
      item.spend += Number(row.spend || 0);
      item.conversions += Number(row.conversions || 0);
    }
    return [...map.values()];
  }, [filtered]);

  const daily = useMemo(() => {
    const map = {};
    for (const row of filtered) {
      const d = row.date;
      const p = row.platform.toLowerCase();
      if (!map[d]) map[d] = { date: d };
      map[d][`${p}_impressions`] = (map[d][`${p}_impressions`] || 0) + Number(row.impressions || 0);
      map[d][`${p}_clicks`] = (map[d][`${p}_clicks`] || 0) + Number(row.clicks || 0);
      map[d][`${p}_conversions`] = (map[d][`${p}_conversions`] || 0) + Number(row.conversions || 0);
    }
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  const campaigns = useMemo(() => {
    const map = new Map();
    for (const row of filtered) {
      const key = `${row.platform}:${row.account_id}:${row.campaign_id}`;
      if (!map.has(key)) {
        map.set(key, {
          platform: row.platform.toLowerCase(),
          account_id: row.account_id,
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name || "",
          impressions: 0,
          clicks: 0,
          spend: 0,
          conversions: 0,
        });
      }
      const item = map.get(key);
      item.impressions += Number(row.impressions || 0);
      item.clicks += Number(row.clicks || 0);
      item.spend += Number(row.spend || 0);
      item.conversions += Number(row.conversions || 0);
    }
    return [...map.values()].sort((a, b) => b.spend - a.spend);
  }, [filtered]);

  const totalImpressions = sum(filtered, "impressions");
  const totalClicks = sum(filtered, "clicks");
  const totalSpend = sum(filtered, "spend");
  const totalConv = sum(filtered, "conversions");
  const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

  const pieData = platformSummary
    .filter((p) => p.impressions > 0)
    .map((p) => ({
      name: PLAT[p.platform]?.label || p.platform,
      value: p.impressions,
      color: PLAT[p.platform]?.color || "#9ca3af",
    }));

  const togglePlatform = (pk) => {
    setSelected((prev) => {
      if (prev.includes(pk)) {
        const next = prev.filter((x) => x !== pk);
        return next.length ? next : ["linkedin", "reddit"];
      }
      return [...prev, pk];
    });
  };

  const setPresetDays = (days) => {
    if (!maxDate || !minDate) return;
    const end = new Date(`${maxDate}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const from = start.toISOString().slice(0, 10);
    setDateFrom(from < minDate ? minDate : from);
    setDateTo(maxDate);
  };

  if (loading) {
    return html`<div style=${{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#6b7280",
      fontSize: "15px",
    }}>Загружаю дашборд…</div>`;
  }

  return html`
    <div className="wrap">
      <div style=${{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 18,
        gap: 12,
        flexWrap: "wrap",
      }}>
        <div>
          <h1 style=${{ margin: 0, fontSize: "30px", letterSpacing: "-0.02em" }}>Ads Dashboard</h1>
          <div style=${{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
            LinkedIn + Reddit · фактические данные из MySQL
          </div>
        </div>
        <div style=${{ display: "flex", gap: 8 }}>
          ${Object.keys(PLAT).map((pk) => {
            const m = PLAT[pk];
            const on = selected.includes(pk);
            return html`<button
              key=${pk}
              onClick=${() => togglePlatform(pk)}
              style=${{
                border: on ? `1px solid ${m.color}66` : "1px solid #e5e7eb",
                background: on ? m.bg : "#fff",
                borderRadius: 12,
                padding: "8px 14px",
                cursor: "pointer",
                color: on ? "#111827" : "#6b7280",
                fontWeight: 600,
              }}
            >
              ${m.label}
            </button>`;
          })}
        </div>
      </div>

      <div className="card" style=${{
        padding: 14,
        marginBottom: 18,
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style=${{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style=${{ fontSize: 12, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Даты
          </span>
          <input
            type="date"
            min=${minDate}
            max=${maxDate}
            value=${safeFrom}
            onChange=${(e) => setDateFrom(e.target.value)}
            style=${{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "6px 10px",
              fontFamily: "inherit",
            }}
          />
          <span style=${{ color: "#9ca3af", fontSize: 12 }}>—</span>
          <input
            type="date"
            min=${minDate}
            max=${maxDate}
            value=${safeTo}
            onChange=${(e) => setDateTo(e.target.value)}
            style=${{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              padding: "6px 10px",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick=${() => {
              setDateFrom(minDate);
              setDateTo(maxDate);
            }}
            style=${{
              border: "1px solid #e5e7eb",
              background: "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              cursor: "pointer",
              color: "#374151",
            }}
          >
            Все
          </button>
        </div>
        <div style=${{ display: "flex", gap: 8 }}>
          ${[
            [2, "2 дня"],
            [7, "7 дней"],
            [30, "30 дней"],
          ].map(
            ([days, label]) => html`<button
              key=${days}
              onClick=${() => setPresetDays(days)}
              style=${{
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                color: "#374151",
                fontWeight: 600,
              }}
            >
              ${label}
            </button>`
          )}
        </div>
      </div>

      <div className="row kpi-grid" style=${{ marginBottom: 18 }}>
        ${[
          { label: "Spend", value: fmtMoney(totalSpend), color: "#0ea5e9", bg: "#ecfeff" },
          { label: "Impressions", value: fmtInt(totalImpressions), color: "#2563eb", bg: "#eff6ff" },
          { label: "Clicks", value: fmtInt(totalClicks), color: "#7c3aed", bg: "#f5f3ff" },
          { label: "CTR", value: `${ctr.toFixed(2)}%`, color: "#16a34a", bg: "#f0fdf4" },
          { label: "Conversions", value: fmtInt(totalConv), color: "#ea580c", bg: "#fff7ed" },
        ].map(
          (k) => html`<div key=${k.label} className="card" style=${{
            padding: "16px 18px",
            background: k.bg,
            borderLeft: `4px solid ${k.color}`,
          }}>
            <div style=${{
              fontSize: 11,
              color: "#6b7280",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 5,
            }}>${k.label}</div>
            <div className="mono" style=${{ fontSize: 28, fontWeight: 700 }}>${k.value}</div>
          </div>`
        )}
      </div>

      <div className="row" style=${{ gridTemplateColumns: "2fr 1fr", marginBottom: 18 }}>
        <div className="card" style=${{ padding: 18, minHeight: 320 }}>
          <div style=${{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Показы по дням</div>
          <div style=${{ width: "100%", height: 260 }}>
            <${ResponsiveContainer} width="100%" height="100%">
              <${AreaChart} data=${daily}>
                <${CartesianGrid} strokeDasharray="3 3" stroke="#f1f5f9" />
                <${XAxis} dataKey="date" tickFormatter=${(v) => v.slice(5)} tick=${{ fontSize: 10, fill: "#9ca3af" }} axisLine=${false} tickLine=${false} />
                <${YAxis} tick=${{ fontSize: 10, fill: "#9ca3af" }} axisLine=${false} tickLine=${false} />
                <${Tooltip} content=${React.createElement(TooltipCard)} />
                ${selected.map(
                  (pk) => html`<${Area}
                    key=${pk}
                    type="monotone"
                    dataKey=${`${pk}_impressions`}
                    name=${PLAT[pk].label}
                    stroke=${PLAT[pk].color}
                    fill=${PLAT[pk].color}
                    fillOpacity=${0.08}
                    strokeWidth=${2}
                    dot=${false}
                  />`
                )}
              </${AreaChart}>
            </${ResponsiveContainer}>
          </div>
        </div>

        <div className="card" style=${{ padding: 18 }}>
          <div style=${{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Доля показов</div>
          <div style=${{ width: "100%", height: 220 }}>
            <${ResponsiveContainer} width="100%" height="100%">
              <${PieChart}>
                <${Pie} data=${pieData} dataKey="value" cx="50%" cy="50%" innerRadius=${46} outerRadius=${78}>
                  ${pieData.map((entry, i) => html`<${Cell} key=${i} fill=${entry.color} />`)}
                </${Pie}>
                <${Tooltip} formatter=${(v) => fmtInt(v)} />
              </${PieChart}>
            </${ResponsiveContainer}>
          </div>
          <div style=${{ display: "grid", gap: 8, marginTop: 8 }}>
            ${pieData.map(
              (p) => html`<div key=${p.name} style=${{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style=${{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style=${{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: p.color,
                    display: "inline-block",
                  }}></span>
                  ${p.name}
                </span>
                <span className="mono">${fmtInt(p.value)}</span>
              </div>`
            )}
          </div>
        </div>
      </div>

      <div className="card table-wrap" style=${{ padding: 16, marginBottom: 18 }}>
        <div style=${{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Сводка по площадкам</div>
        <table>
          <thead>
            <tr>
              <th>Площадка</th>
              <th>Spend</th>
              <th>Impr.</th>
              <th>Clicks</th>
              <th>CTR</th>
              <th>Conv.</th>
            </tr>
          </thead>
          <tbody>
            ${platformSummary.map((p) => {
              const ctrPlatform = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
              return html`<tr key=${p.platform}>
                <td style=${{ fontWeight: 600 }}>
                  <span style=${{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 24,
                    height: 24,
                    borderRadius: 7,
                    background: PLAT[p.platform].color,
                    color: "#fff",
                    fontSize: 11,
                    marginRight: 8,
                  }}>${PLAT[p.platform].icon}</span>
                  ${PLAT[p.platform].label}
                </td>
                <td className="mono">${fmtMoney(p.spend)}</td>
                <td>${fmtInt(p.impressions)}</td>
                <td>${fmtInt(p.clicks)}</td>
                <td>${ctrPlatform.toFixed(2)}%</td>
                <td>${fmtInt(p.conversions)}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap" style=${{ padding: 16 }}>
        <div style=${{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Кампании</div>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Platform</th>
              <th>Account</th>
              <th>Spend</th>
              <th>Impr.</th>
              <th>Clicks</th>
              <th>Conv.</th>
            </tr>
          </thead>
          <tbody>
            ${campaigns.map(
              (c) => html`<tr key=${`${c.platform}-${c.account_id}-${c.campaign_id}`}>
                <td>${c.campaign_name || c.campaign_id}</td>
                <td>${PLAT[c.platform]?.label || c.platform}</td>
                <td className="mono">${c.account_id}</td>
                <td className="mono">${fmtMoney(c.spend)}</td>
                <td>${fmtInt(c.impressions)}</td>
                <td>${fmtInt(c.clicks)}</td>
                <td>${fmtInt(c.conversions)}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
