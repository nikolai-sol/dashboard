import type {
  ZarukuSeoClusterRow,
  ZarukuSeoOpportunityRow,
  ZarukuSeoPositionTrendPoint,
  ZarukuSeoRunRow,
  ZarukuSeoSectionPattern,
} from "@/lib/types";

type IsoWeek = { year: number; week: number };

const ISO_WEEK_PATTERN = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

function parseIsoWeek(value: string): IsoWeek {
  const match = ISO_WEEK_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid ISO week: ${value}`);

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week > isoWeeksInYear(year)) throw new Error(`Invalid ISO week: ${value}`);
  return { year, week };
}

function isoWeeksInYear(year: number) {
  const januaryFirstDate = new Date(0);
  januaryFirstDate.setUTCFullYear(year, 0, 1);
  const januaryFirst = januaryFirstDate.getUTCDay() || 7;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return januaryFirst === 4 || (januaryFirst === 3 && isLeapYear) ? 53 : 52;
}

function formatIsoWeek({ year, week }: IsoWeek) {
  return `${String(year).padStart(4, "0")}-W${String(week).padStart(2, "0")}`;
}

function nextIsoWeek(value: IsoWeek): IsoWeek {
  const nextWeek = value.week + 1;
  return nextWeek > isoWeeksInYear(value.year) ? { year: value.year + 1, week: 1 } : { year: value.year, week: nextWeek };
}

function compareIsoWeeks(left: string, right: string) {
  const a = parseIsoWeek(left);
  const b = parseIsoWeek(right);
  return a.year - b.year || a.week - b.week;
}

function pathnameFromUrl(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return value.split(/[?#]/, 1)[0] || "/";
  }
}

export function sortIsoWeeks(weeks: string[]) {
  return [...weeks].sort(compareIsoWeeks);
}

export function previousAvailableWeek(weeks: string[], selectedWeek: string) {
  const sortedWeeks = sortIsoWeeks(weeks);
  const selectedIndex = sortedWeeks.indexOf(selectedWeek);
  return selectedIndex > 0 ? sortedWeeks[selectedIndex - 1] : null;
}

export function matchSectionPattern(url: string, patterns: ZarukuSeoSectionPattern[]) {
  const pathname = pathnameFromUrl(url);
  return patterns
    .map((pattern, index) => ({ pattern, index }))
    .filter(({ pattern }) => pathname.includes(pattern.url_pattern))
    .sort(
      (left, right) =>
        right.pattern.url_pattern.length - left.pattern.url_pattern.length ||
        left.pattern.priority - right.pattern.priority ||
        left.index - right.index,
    )[0]?.pattern;
}

export function buildSectionPositionTrend(
  rows: Array<Pick<ZarukuSeoClusterRow, "week" | "section" | "serp_position" | "status">>,
): ZarukuSeoPositionTrendPoint[] {
  const groups = new Map<string, { week: string; section: string; positions: number[]; foundRows: number; trackedRows: number }>();

  for (const row of rows) {
    const key = `${row.week}\u0000${row.section}`;
    const group = groups.get(key) ?? { week: row.week, section: row.section, positions: [], foundRows: 0, trackedRows: 0 };
    group.trackedRows += 1;
    if (row.status === "found") group.foundRows += 1;
    if (row.serp_position != null) group.positions.push(row.serp_position);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map(({ week, section, positions, foundRows, trackedRows }) => ({
      week,
      section,
      average_position: positions.length > 0 ? positions.reduce((total, position) => total + position, 0) / positions.length : null,
      coverage: trackedRows > 0 ? foundRows / trackedRows : 0,
      found_rows: foundRows,
      tracked_rows: trackedRows,
    }))
    .sort((left, right) => compareIsoWeeks(left.week, right.week) || left.section.localeCompare(right.section));
}

export function calculateApproveRate(rows: Array<Pick<ZarukuSeoOpportunityRow, "decision">>) {
  const decidedRows = rows.filter(({ decision }) => decision === "approved" || decision === "rejected");
  if (decidedRows.length === 0) return null;
  return (decidedRows.filter(({ decision }) => decision === "approved").length / decidedRows.length) * 100;
}

export function buildRhythmWeeks(runs: ZarukuSeoRunRow[]): ZarukuSeoRunRow[] {
  if (runs.length === 0) return [];

  const runsByWeek = new Map(runs.map((run) => [run.week, run]));
  const weeks = sortIsoWeeks([...runsByWeek.keys()]);
  const first = parseIsoWeek(weeks[0]);
  const last = parseIsoWeek(weeks[weeks.length - 1]);
  const rhythm: ZarukuSeoRunRow[] = [];

  for (let current = first; current.year < last.year || (current.year === last.year && current.week <= last.week); current = nextIsoWeek(current)) {
    const week = formatIsoWeek(current);
    rhythm.push(runsByWeek.get(week) ?? { week, status: "missing", serp_requests: 0, llm_tokens: 0, digest_count: 0 });
  }

  return rhythm;
}
