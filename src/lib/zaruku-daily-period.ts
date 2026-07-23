const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string, label: string) {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid ISO date in YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid ISO date in YYYY-MM-DD format`);
  }
  return date;
}

export function resolveZarukuDailyPeriod(input: {
  requestedFrom: string;
  requestedTo: string;
  today: string;
}) {
  parseIsoDate(input.requestedFrom, "requestedFrom");
  parseIsoDate(input.requestedTo, "requestedTo");
  const today = parseIsoDate(input.today, "today");
  const expectedTo = new Date(today.getTime() - 2 * DAY_MS).toISOString().slice(0, 10);
  const effectiveTo = input.requestedTo < expectedTo ? input.requestedTo : expectedTo;

  if (input.requestedFrom > effectiveTo) {
    throw new Error(`requestedFrom ${input.requestedFrom} is after effectiveTo ${effectiveTo}`);
  }

  return {
    requested: { from: input.requestedFrom, to: input.requestedTo },
    expectedTo,
    effective: { from: input.requestedFrom, to: effectiveTo },
  };
}
