import type { DatasetMeta } from "@reportingdash/site-seo-contract";
export function Wordstat({ id, meta }: Readonly<{ id: string; meta?: DatasetMeta }>) { return <section id={id}><h2>Wordstat</h2><p>{meta?.state === "missing" ? "Нужна выгрузка" : meta?.state ?? "нет данных"}</p></section>; }
