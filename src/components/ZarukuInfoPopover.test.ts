import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ZarukuInfoPopover, { positionZarukuInfoPopover } from "@/components/ZarukuInfoPopover";

test("popover placement clamps to the viewport and flips above", () => {
  assert.deepEqual(
    positionZarukuInfoPopover(
      { left: 0, top: 100, width: 20, height: 20 },
      { width: 288, height: 160 },
      { width: 430, height: 900 },
    ),
    { left: 16, top: 128, placement: "below" },
  );
  assert.deepEqual(
    positionZarukuInfoPopover(
      { left: 1400, top: 820, width: 20, height: 20 },
      { width: 288, height: 180 },
      { width: 1440, height: 900 },
    ),
    { left: 1136, top: 632, placement: "above" },
  );
});

test("closed trigger is accessible and does not render content inline", () => {
  const ServerRenderablePopover = ZarukuInfoPopover as ComponentType<{ label: string; children?: ReactNode }>;
  const html = renderToStaticMarkup(createElement(
    ServerRenderablePopover,
    { label: "О периоде" },
    createElement("p", null, "Независимый недельный срез"),
  ));

  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="О периоде"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /size-5/);
  assert.doesNotMatch(html, /Независимый недельный срез/);
});
