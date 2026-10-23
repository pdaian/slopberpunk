// Geographic labels and local directories, independent of quest progress.
// GPL-3.0-or-later.
export function localMapPlaces(data, center) {
  const distance = place => Math.hypot(place.position[0] - center[0], place.position[2] - center[2]);
  const routes = (data.world.routes || []).filter(r => r.kind !== 'street').map(r => ({ ...r, position: r.start,
    location: `${r.name} connects ${r.start[1] === 0 ? 'street level' : r.start[1] + ' m'} to ${r.end[1]} m. Walk along the path to reach the other end.` }));
  const lifts = data.world.lifts.map(l => ({ ...l,
    location: `${l.name} connects street level and ${l.stops.filter(y => y > 0).join(' / ')} m. Select the lift and use it to change floors.` }));
  return [...data.npcs, ...data.world.landmarks, ...lifts, ...routes]
    .filter(place => distance(place) <= 160)
    .sort((a, b) => distance(a) - distance(b));
}

// Omit crowded names instead of drawing labels over one another or moving an
// off-map destination to the edge. The text directory retains every local name.
export function mapLabelLayout(places, project, measure, width, height) {
  const labels = [];
  for (const place of places) {
    const [x, y] = project(place.position), w = measure(place.name) + 10, h = 18;
    if (x < 0 || x > width || y < 24 || y > height) continue;
    for (const offset of [-20, 4, -40, 24]) {
      const rect = { x: x - w / 2, y: y + offset, w, h };
      if (rect.x < 6 || rect.x + w > width - 6 || rect.y < 24 || rect.y + h > height - 6) continue;
      if (labels.some(l => rect.x < l.x + l.w + 4 && rect.x + w + 4 > l.x && rect.y < l.y + l.h + 4 && rect.y + h + 4 > l.y)) continue;
      labels.push({ ...rect, text: place.name, color: place.color || '#c4d9d4' });
      break;
    }
  }
  return labels;
}
