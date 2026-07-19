export interface MapMarkerInput {
  id: string;
  x: number;
  y: number;
  radius: number;
}

export interface MapMarkerLayout extends MapMarkerInput {
  anchorX: number;
  anchorY: number;
}

type LayoutOptions = {
  width: number;
  height: number;
  gap?: number;
  maxDisplacement?: number;
};

function overlaps(candidate: MapMarkerLayout, placed: MapMarkerLayout[], gap: number) {
  return placed.some((marker) => {
    const minimumDistance = candidate.radius + marker.radius + gap;
    return Math.hypot(candidate.x - marker.x, candidate.y - marker.y) < minimumDistance;
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function separateMapMarkers(markers: MapMarkerInput[], options: LayoutOptions): MapMarkerLayout[] {
  const gap = options.gap ?? 4;
  const maxDisplacement = options.maxDisplacement ?? 72;
  const placed: MapMarkerLayout[] = [];

  markers.forEach((marker) => {
    const anchored: MapMarkerLayout = {
      ...marker,
      anchorX: marker.x,
      anchorY: marker.y,
    };

    if (!overlaps(anchored, placed, gap)) {
      placed.push(anchored);
      return;
    }

    let resolved = anchored;
    let found = false;
    for (let distance = 8; distance <= maxDisplacement && !found; distance += 4) {
      for (let angle = 0; angle < 360; angle += 24) {
        const radians = (angle * Math.PI) / 180;
        const candidate: MapMarkerLayout = {
          ...anchored,
          x: clamp(marker.x + Math.cos(radians) * distance, marker.radius + 6, options.width - marker.radius - 6),
          y: clamp(marker.y + Math.sin(radians) * distance, marker.radius + 6, options.height - marker.radius - 6),
        };
        if (!overlaps(candidate, placed, gap)) {
          resolved = candidate;
          found = true;
          break;
        }
      }
    }

    placed.push(resolved);
  });

  return placed;
}
