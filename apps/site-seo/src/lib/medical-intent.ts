import type { DatasetMeta, GscView, Period } from "@reportingdash/site-seo-contract";
import type { WebmasterCanonicalData } from "./db.ts";
import seed from "./rules/medroche-intent-core.json";

export const MEDICAL_INTENT_VERSION = "medroche-medical-intent-v1";
export type IntentClassification = Readonly<{
  category: "medical" | "noise";
  reason: "expert_seed" | "expert_phrase" | "medical_term" | "medical_context" | "nonmedical_context" | "outside_core";
  group: string | null;
}>;

function normalize(query: string): string {
  return query.normalize("NFKC").toLowerCase().replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ").replace(/her 2/g, "her2");
}
const exact = new Map(seed.queries.map(row => [normalize(row.query), row.group]));
const phrases = [...exact].filter(([query]) => query.includes(" "));

// Deliberate morphological stems, not arbitrary substring/fuzzy matching.
// Generic seed groups (статьи, форум, исследование, конференция) are NOT keywords.
const families: readonly (readonly [string, string])[] = [
  ["онколог онкогематолог канцер карцином метастаз химиотерап иммунотерап противоопухол опухол", "онкология"],
  ["меланом", "меланома"], ["лимфом", "фолликулярная лимфома"], ["сарком", "саркома"],
  ["ангиомиксом", "ангиомиксома"], ["ангиомиолипом", "ангиомиолипома"], ["ангиосарком", "ангиосаркома"],
  ["гемангиом", "гемангиома"], ["гиберном", "гибернома"], ["лейомиом", "лейомиома"],
  ["лейомиосарком", "лейомиосаркома"], ["липосарком", "липосаркома"], ["менингиом", "менингиома"],
  ["миксом", "миксома"], ["миоэпителиом", "миоэпителиома"], ["нейрофибром", "нейрофибромы"],
  ["хондром", "хондрома"], ["шванном", "шваннома"], ["рабдоидн", "рабдоидная опухоль"],
  ["гемофил", "гемофилия а"], ["волчан", "волчанка"], ["грипп", "грипп"],
  ["оптиконевромиелит", "оптиконевромиелит"], ["макулярн", "диабетический макулярный отек"],
  ["дюшенн", "дистрофия дюшенна"], ["секвенирован геномн", "геномное профилирование"],
  ["прецизионн", "прецизионная медицина"], ["фармакотерап", "инновационная фармакотерапия"],
  ["гематолог", "гематология литература"], ["маммолог", "рак молочной железы"],
  ["марбоксил", "балоксавир"],
  ["bevacizumab авастин", "бевацизумаб"], ["alectinib алекенза", "алектиниб"],
  ["atezolizumab тецентрик", "атезолизумаб"], ["trastuzumab герцептин", "трастузумаб"],
  ["pertuzumab пертузумаб", "трастузумаб"], ["entrectinib энтректиниб розлитрек", "розлитрек"],
  ["rituximab ритуксимаб", "онкогематология"], ["faricimab вабисмо", "фарицимаб"],
  ["emicizumab гемлибра", "эмицизумаб"], ["ocrelizumab окрелизумаб окревус", "рассеянный склероз"],
  ["risdiplam рисдиплам эврисди", "сма"], ["baloxavir ксофлюза", "балоксавир"],
  ["obinutuzumab газива", "обинутузумаб"], ["glofitamab", "глофитамаб"],
  ["mosunetuzumab", "мосунетузумаб"], ["polatuzumab", "полатузумаб"],
  ["vemurafenib зелбораф", "вемурафениб"], ["cobimetinib котеллик", "кобиметиниб"],
  ...seed.queries.map(row => row.group).filter((group, index, all) =>
    all.indexOf(group) === index && /^[а-я]+(?:маб|ниб|вир)$/.test(group)).map(group => [group, group] as const),
];
const stems = families.flatMap(([words, group]) => words.split(" ").map(stem => ({ stem, group })));
const abbreviations = new Set("braf esmo foundationone her2 rcb ros1 russco tnm ntrk ngs двккл дрщж нмрл рмж зсонм скв сма вмд орви vegf pubmed t2nomo".split(" "));

export function classifyMedicalQuery(query: string): IntentClassification {
  const normalized = normalize(query);
  const group = exact.get(normalized);
  if (group) return { category: "medical", reason: "expert_seed", group };
  const tokens = normalized.split(" ");
  const phrase = phrases.find(([query]) => (" " + normalized + " ").includes(" " + query + " "));
  if (phrase) return { category: "medical", reason: "expert_phrase", group: phrase[1] };
  const match = stems.find(({ stem }) => tokens.some(token => token.startsWith(stem)));
  if (match) return { category: "medical", reason: "medical_term", group: match.group };
  // Ambiguous short abbreviations and рак require context-aware exclusions.
  const unrelated = tokens.some(token => /^(?:гороскоп\p{L}*|зодиак\p{L}*|укроп\p{L}*|варить|варены[йехми]+|вареного|пиво|пиве)$/u.test(token))
    || (tokens.some(token => ["ros1", "сма"].includes(token))
      && tokens.some(token => /^(?:разъем\p{L}*|коннектор\p{L}*|robot|robotics|робот|роботы|робота)$/u.test(token)))
    || /^(?:her2|ros1|сма) (?:файл|файлы)$|^(?:файл|файлы) (?:her2|ros1|сма)$/.test(normalized);
  if (unrelated) return { category: "noise", reason: "nonmedical_context", group: null };
  const abbreviation = tokens.find(token => abbreviations.has(token) || /^(?:[cpyra]?t[0-4xis][a-c]?n[0-3x][a-c]?m[01x])$/.test(token));
  if (abbreviation) return { category: "medical", reason: "medical_context", group: abbreviation };
  if (tokens.some(token => /^(рак|рака|раку|раком|раке|раковая|раковые|раковый|раковых)$/.test(token))) {
    return { category: "medical", reason: "medical_context", group: "онкология" };
  }
  if (/(рассеян\p{L}* склероз|мышечн\p{L}* атроф|спинальн\p{L}* атроф|эндотелиальн\p{L}* фактор|таргетн\p{L}* терап|окклюзи\p{L}* (?:центральн\p{L}* )?вен\p{L}* сетчатк)/u.test(normalized)) {
    return { category: "medical", reason: "medical_context", group: "медицинский контекст" };
  }
  return { category: "noise", reason: "outside_core", group: null };
}

type QueryFact = Readonly<{ query: string; metrics: Readonly<{ impressions: number; clicks: number }> }>;
type IntentSource = Readonly<{
  source: "google" | "yandex"; included: boolean; meta: DatasetMeta | null;
  reason: "available" | "complete_empty" | "missing" | "failed" | "different_period" | "no_queries" | "invalid_metrics";
}>;
type IntentCard = Readonly<{ impressions: number | null; clicks: number | null; sharePct: number | null }>;
export type MedicalIntentView = Readonly<{
  version: string; sourceSha256: string; period: Period;
  sources: readonly IntentSource[];
  medical: IntentCard; noise: IntentCard;
  queries: readonly (QueryFact & IntentClassification & { source: "google" | "yandex" })[];
}>;

export function sameIntentPeriod(left: Period | null | undefined, right: Period): boolean {
  return left?.kind === right.kind && left.key === right.key && left.from === right.from && left.to === right.to
    && left.sourceTimezone === right.sourceTimezone;
}

export function buildMedicalIntent(input: Readonly<{ period: Period; gsc: GscView; webmaster: WebmasterCanonicalData | null; webmasterMeta?: DatasetMeta | null }>): MedicalIntentView {
  const queries: MedicalIntentView["queries"][number][] = [];
  const candidates = [
    { source: "google" as const, meta: input.gsc.meta.state === "failed" ? input.gsc.meta : input.gsc.dimensionMeta.query ?? null, rows: input.gsc.dimensions.filter(row => row.dimension === "query").map(row => ({ query: row.value, metrics: row.metrics })) },
    { source: "yandex" as const, meta: input.webmaster ?? input.webmasterMeta ?? null, rows: input.webmaster?.queryFacts },
  ];
  const sources: IntentSource[] = candidates.map(({ source, meta, rows }) => {
    let reason: IntentSource["reason"] = "available";
    if (!meta || meta.state === "missing") reason = "missing";
    else if (meta.state === "failed") reason = "failed";
    else if (!sameIntentPeriod(meta.period, input.period)) reason = "different_period";
    else if (!rows?.length) reason = rows && meta.state === "complete_empty" ? "complete_empty" : "no_queries";
    else if (rows.some(row => !row.query.trim() || !Number.isFinite(row.metrics.impressions) || row.metrics.impressions < 0 || !Number.isFinite(row.metrics.clicks) || row.metrics.clicks < 0)) reason = "invalid_metrics";
    const included = reason === "available" || reason === "complete_empty";
    if (included) for (const row of rows ?? []) queries.push({ ...row, source, ...classifyMedicalQuery(row.query) });
    // Keep provenance, not a second copy of the entire Webmaster payload.
    const provenance = meta ? Object.fromEntries(["sourceKey", "period", "state", "collectionMode", "completeness", "importId", "exportedAt", "loadedAt", "freshness", "latestAttempt"].map(key => [key, meta[key as keyof DatasetMeta]])) as DatasetMeta : null;
    return { source, included, reason, meta: provenance };
  });
  const available = sources.some(source => source.included);
  const total = queries.reduce((sum, row) => sum + row.metrics.impressions, 0);
  const card = (category: IntentClassification["category"]): IntentCard => {
    const rows = queries.filter(row => row.category === category);
    const impressions = rows.reduce((sum, row) => sum + row.metrics.impressions, 0);
    return {
      impressions: available ? impressions : null,
      clicks: available ? rows.reduce((sum, row) => sum + row.metrics.clicks, 0) : null,
      sharePct: total > 0 ? impressions / total * 100 : null,
    };
  };
  return { version: MEDICAL_INTENT_VERSION, sourceSha256: seed.sourceSha256, period: input.period, sources, medical: card("medical"), noise: card("noise"), queries };
}
