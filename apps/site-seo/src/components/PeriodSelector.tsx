import type { Period } from "@reportingdash/site-seo-contract";
export function PeriodSelector({ primary, comparison }: Readonly<{ primary: Period; comparison: Period | null }>) { return <p>Период: {primary.key} ({primary.from} — {primary.to}){comparison ? `; сравнение ${comparison.key}` : ""}</p>; }
