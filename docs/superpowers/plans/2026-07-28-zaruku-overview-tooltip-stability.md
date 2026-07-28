# Zaruku Overview Tooltip Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Zaruku Overview information controls unclipped, non-duplicated, non-overlapping, and stable on hover, keyboard focus, and tap, then deploy and verify the change.

**Architecture:** Add one focused `ZarukuInfoPopover` client component that renders explanatory content through a `document.body` portal and positions it with a pure viewport-clamping helper. Replace the divergent inline and native tooltip implementations while preserving copy, source data, and the fixed Overview panel composition.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Lucide React, Node test runner, browser verification, PM2 deployment script

## Global Constraints

- Triggers have a minimum `20 × 20 px` hit area and a visible focus ring.
- Hover, focus, click/tap, outside-click, and `Escape` work without moving layout.
- Popovers remain inside a 16 px viewport margin and cannot be clipped by panel overflow.
- Keep one information trigger beside each north-star metric and remove the heading-level duplicate.
- Keep period text permanently stable; only its dedicated button opens extra information.
- Preserve metric values, periods, provenance, source data, and fixed Overview sizing.
- Add no dependency.
- Deploy only after tests, type checking, lint, build, and local UI checks pass.
- No API mutation, database migration, collector run, cron edit, secret installation, or Telegram send is in scope.

---

### Task 1: Shared viewport-aware information popover

**Files:**
- Create: `src/components/ZarukuInfoPopover.tsx`
- Create: `src/components/ZarukuInfoPopover.test.ts`

**Interfaces:**
- Produces: `positionZarukuInfoPopover(trigger, surface, viewport, margin?, gap?)`
- Produces: `ZarukuInfoPopover({ label, children, triggerClassName? })`

- [ ] **Step 1: Write the failing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuInfoPopover, { positionZarukuInfoPopover } from "@/components/ZarukuInfoPopover";

test("popover placement clamps and flips", () => {
  assert.deepEqual(positionZarukuInfoPopover(
    { left: 0, top: 100, width: 20, height: 20 },
    { width: 288, height: 160 },
    { width: 430, height: 900 },
  ), { left: 16, top: 128, placement: "below" });
  assert.deepEqual(positionZarukuInfoPopover(
    { left: 1400, top: 820, width: 20, height: 20 },
    { width: 288, height: 180 },
    { width: 1440, height: 900 },
  ), { left: 1136, top: 632, placement: "above" });
});

test("closed trigger is accessible and content is not inline", () => {
  const html = renderToStaticMarkup(createElement(
    ZarukuInfoPopover,
    { label: "О периоде" },
    createElement("p", null, "Независимый недельный срез"),
  ));
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="О периоде"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /size-5/);
  assert.doesNotMatch(html, /Независимый недельный срез/);
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run `node --import tsx --test src/components/ZarukuInfoPopover.test.ts`.

Expected: FAIL because `ZarukuInfoPopover` does not exist.

- [ ] **Step 3: Implement the component**

Create `ZarukuInfoPopover.tsx` with the following exact public behavior:

```tsx
"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
type Position = { left: number; top: number; placement: "above" | "below" };

export function positionZarukuInfoPopover(
  trigger: Box,
  surface: Size,
  viewport: Size,
  margin = 16,
  gap = 8,
): Position {
  const centeredLeft = trigger.left + trigger.width / 2 - surface.width / 2;
  const maxLeft = Math.max(margin, viewport.width - margin - surface.width);
  const left = Math.min(Math.max(centeredLeft, margin), maxLeft);
  const below = trigger.top + trigger.height + gap;
  return below + surface.height <= viewport.height - margin
    ? { left, top: below, placement: "below" }
    : { left, top: Math.max(margin, trigger.top - gap - surface.height), placement: "above" };
}

export default function ZarukuInfoPopover({
  label,
  children,
  triggerClassName = "",
}: {
  label: string;
  children: ReactNode;
  triggerClassName?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const open = hovered || focused || pinned;
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 80);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const surface = surfaceRef.current?.getBoundingClientRect();
      if (!trigger || !surface) return;
      setPosition(positionZarukuInfoPopover(trigger, surface, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setPinned(false);
      setHovered(false);
      setFocused(false);
      triggerRef.current?.blur();
    };
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !surfaceRef.current?.contains(target)) close();
    };
    const keyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", pointerDown);
    document.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("keydown", keyDown);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  const surface = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={surfaceRef}
      id={id}
      role="tooltip"
      onPointerEnter={() => { cancelClose(); setHovered(true); }}
      onPointerLeave={scheduleClose}
      className="fixed z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-3 text-left text-slate-700 shadow-xl"
      style={{ left: position?.left ?? 16, top: position?.top ?? 16, visibility: position ? "visible" : "hidden" }}
      data-placement={position?.placement}
    >
      {children}
    </div>, document.body,
  ) : null;

  return (
    <span
      className="inline-flex shrink-0"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") { cancelClose(); setHovered(true); }
      }}
      onPointerLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !surfaceRef.current?.contains(next)) setFocused(false);
        }}
        onClick={() => {
          if (pinned) {
            setPinned(false);
            setFocused(false);
            triggerRef.current?.blur();
          } else setPinned(true);
        }}
        className={`inline-flex size-5 items-center justify-center rounded-full text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${triggerClassName}`}
      >
        <Info className="size-3.5" aria-hidden="true" />
      </button>
      {surface}
    </span>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
node --import tsx --test src/components/ZarukuInfoPopover.test.ts
npm run typecheck
npx eslint src/components/ZarukuInfoPopover.tsx src/components/ZarukuInfoPopover.test.ts
git add src/components/ZarukuInfoPopover.tsx src/components/ZarukuInfoPopover.test.ts
git commit -m "feat(zaruku): add stable information popover"
```

Expected: tests, type checking, and lint PASS before the commit.

---

### Task 2: Stabilize both period summaries

**Files:**
- Modify: `src/components/ZarukuOverviewTab.tsx`
- Modify: `src/components/ZarukuOverviewTab.test.ts`
- Modify: `src/components/ZarukuPeriodContext.tsx`
- Modify: `src/components/zaruku-dashboard-primitives.test.ts`

**Interfaces:**
- Consumes: `ZarukuInfoPopover` from Task 1
- Produces: static period labels with one dedicated trigger and no inline hover expansion

- [ ] **Step 1: Add failing source assertions**

```ts
assert.match(overviewSource, /<ZarukuInfoPopover/);
assert.match(overviewSource, /label="О недельном срезе позиций"/);
assert.doesNotMatch(overviewSource, /group-hover:block|<span role="tooltip"/);
assert.match(periodContextSource, /<ZarukuInfoPopover/);
assert.doesNotMatch(periodContextSource, /group-hover:block|group-focus-within:block/);
```

Change the Overview static-markup test to require the visible weekly label but not closed popover copy.

- [ ] **Step 2: Run tests and confirm failure**

Run `node --import tsx --test src/components/ZarukuOverviewTab.test.ts src/components/zaruku-dashboard-primitives.test.ts`.

Expected: FAIL because old inline tooltip markup remains.

- [ ] **Step 3: Replace both tooltip implementations**

Import `ZarukuInfoPopover` and render this after the weekly label in both components:

```tsx
<ZarukuInfoPopover label="О недельном срезе позиций">
  <p className="text-xs leading-relaxed text-slate-600">
    Этот срез не относится к выбранному ежедневному периоду и не ограничивает данные Метрики, GSC или Вебмастера.
  </p>
</ZarukuInfoPopover>
```

The parent is `inline-flex items-center gap-1`; the explanatory content is no longer a child revealed by `group-hover`.

- [ ] **Step 4: Verify and commit**

```bash
node --import tsx --test src/components/ZarukuOverviewTab.test.ts src/components/zaruku-dashboard-primitives.test.ts
npx eslint src/components/ZarukuOverviewTab.tsx src/components/ZarukuOverviewTab.test.ts src/components/ZarukuPeriodContext.tsx src/components/zaruku-dashboard-primitives.test.ts
git add src/components/ZarukuOverviewTab.tsx src/components/ZarukuOverviewTab.test.ts src/components/ZarukuPeriodContext.tsx src/components/zaruku-dashboard-primitives.test.ts
git commit -m "fix(zaruku): stabilize period explanations"
```

Expected: tests and lint PASS; period rows do not contain hover-revealed inline content.

---

### Task 3: Remove duplicate KPI controls and protect value spacing

**Files:**
- Modify: `src/components/ZarukuSeoDashboard.tsx`
- Modify: `src/components/ZarukuSeoDashboard.ui.test.ts`

**Interfaces:**
- Consumes: `ZarukuInfoPopover` from Task 1
- Produces: one information trigger per KPI and a wrapping-safe value row

- [ ] **Step 1: Add failing UI source assertions**

```ts
assert.match(source, /import ZarukuInfoPopover/);
assert.doesNotMatch(source, /function InfoTooltip/);
assert.doesNotMatch(source, /aria-label="Описание основных показателей"/);
assert.match(source, /data-zaruku-kpi-value-row/);
assert.match(source, /flex min-w-0 flex-wrap items-baseline gap-x-1\.5 gap-y-1/);
```

- [ ] **Step 2: Run the UI test and confirm failure**

Run `node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts`.

Expected: FAIL on the old local tooltip, duplicate icon, and value row.

- [ ] **Step 3: Migrate KPI and technical-tail content**

Remove `useId`, remove the local `InfoTooltip`, import `ZarukuInfoPopover`, and render existing title/description/importance/details inside it:

```tsx
<ZarukuInfoPopover label={`${item.label}: что это и почему важно`}>
  <div className="text-sm font-semibold text-slate-900">{item.tooltipTitle}</div>
  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{item.tooltipDescription}</p>
  <p className="mt-2 text-xs leading-relaxed text-slate-700">{item.tooltipImportance}</p>
  <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-400">{item.tooltip}</p>
</ZarukuInfoPopover>
```

Delete the heading icon span after `Цель: целевой органический трафик + ИИ-выдача`. Change the value row to:

```tsx
<div data-zaruku-kpi-value-row className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-1">
  <span className="zaruku-kpi-value min-w-0 text-3xl font-semibold leading-none text-slate-950">
    {formatPercent(item.value, locale, 1)}
  </span>
  <span className="shrink-0 text-sm font-medium text-slate-400">{item.arrow}</span>
  {item.showDelta ? (
    <span className={`shrink-0 text-xs font-medium ${item.deltaTone === "good" ? "text-teal-700" : "text-red-700"}`}>
      {formatSignedPercent(item.delta, locale, 1)}
    </span>
  ) : null}
</div>
```

Use the same popover component for the technical-tail call while preserving its current copy and formatted details.

- [ ] **Step 4: Verify and commit**

```bash
node --import tsx --test src/components/ZarukuSeoDashboard.ui.test.ts src/components/zaruku-overview-layout.test.ts
npm run typecheck
npx eslint src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git add src/components/ZarukuSeoDashboard.tsx src/components/ZarukuSeoDashboard.ui.test.ts
git commit -m "fix(zaruku): prevent overview tooltip overlap"
```

Expected: tests, type checking, and lint PASS.

---

### Task 4: Full verification and memory update

**Files:**
- Modify: `DASHBOARDS-MEMORY.md`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: verified build and current dashboard behavior memory

- [ ] **Step 1: Run the full gates**

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 2: Browser-check the first tab**

Start `npm run dev` and verify widths `430`, `768`, `1280`, and `1440`:

```text
one info button per KPI; no heading duplicate; hover/focus/tap work;
outside-click and Escape close; period row never moves; popovers remain
16 px inside viewport; no clipped text; no KPI overlap; no page overflow.
```

Save screenshots at 430 and 1440 px when the local authorized/demo route is available.

- [ ] **Step 3: Update memory**

Add to Zaruku UI contract item 18 in `DASHBOARDS-MEMORY.md`:

```markdown
- Zaruku explanatory info controls use one shared portal-rendered popover: Overview KPI and period explanations are not clipped by panels, do not reflow their rows, support hover/focus/tap, and remain viewport-contained. The north-star heading has no duplicate general info icon.
```

- [ ] **Step 4: Commit memory**

```bash
git add DASHBOARDS-MEMORY.md
git commit -m "docs: record Zaruku popover contract"
```

---

### Task 5: Deploy and production verification

**Files:**
- No source changes expected

**Interfaces:**
- Consumes: clean verified release commit
- Produces: deployed PM2 release and public health confirmation

- [ ] **Step 1: Confirm clean release state**

```bash
git status --short
git log -1 --oneline
```

Expected: status prints nothing and log shows the final tooltip work.

- [ ] **Step 2: Deploy with the repository workflow**

Run `npm run deploy`.

Expected: build, staged upload, swap, PM2 restart, and deploy health check succeed without rollback.

- [ ] **Step 3: Verify server and public health**

```bash
ssh beget 'pm2 status'
ssh beget 'curl -fsS http://127.0.0.1:3001/api/health'
curl -fsS https://dashboards.adreports.ru/api/health
```

Expected: `dashboard-next` is `online`; both health requests exit 0 with healthy responses.

- [ ] **Step 4: Smoke-check production Overview**

Repeat the 430 and 1440 px checks for unclipped KPI popovers, stable period popover, no duplicate icon, and no value/icon overlap.

Expected: production matches local verification. If the release-specific smoke check fails, run `npm run deploy:rollback`, verify both health endpoints again, and report the failed interaction and rollback result.

