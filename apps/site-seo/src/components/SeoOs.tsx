import type { DatasetMeta } from "@reportingdash/site-seo-contract";
export function SeoOs({ id, meta }: Readonly<{ id: string; meta?: DatasetMeta }>) { return <section id={id}><h2>SEO OS</h2><p>{meta?.state === "ready" ? "Сигналы доступны" : "Недостаточно сигналов для рекомендаций"}</p></section>; }
