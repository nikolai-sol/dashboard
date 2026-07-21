import assert from "node:assert/strict";
import test from "node:test";
import { separateMapMarkers } from "./zaruku-russia-map-layout";

test("keeps isolated markers on their geographic anchors", () => {
  const [marker] = separateMapMarkers([{ id: "moscow", x: 100, y: 100, radius: 12 }], {
    width: 300,
    height: 200,
  });

  assert.deepEqual(marker, {
    id: "moscow",
    x: 100,
    y: 100,
    anchorX: 100,
    anchorY: 100,
    radius: 12,
  });
});

test("separates overlapping markers while retaining their geographic anchors", () => {
  const markers = separateMapMarkers([
    { id: "moscow", x: 100, y: 100, radius: 18 },
    { id: "kubinka", x: 102, y: 101, radius: 9 },
    { id: "domodedovo", x: 103, y: 102, radius: 9 },
  ], { width: 300, height: 200, gap: 5 });

  for (let index = 0; index < markers.length; index += 1) {
    for (let comparison = index + 1; comparison < markers.length; comparison += 1) {
      const a = markers[index];
      const b = markers[comparison];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance >= a.radius + b.radius + 4.9);
    }
  }

  assert.deepEqual(markers.map(({ anchorX, anchorY }) => [anchorX, anchorY]), [[100, 100], [102, 101], [103, 102]]);
});
