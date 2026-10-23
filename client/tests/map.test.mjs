// In-memory map readability checks; no images, browser profile or test output files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localMapPlaces, mapLabelLayout } from '../src/map.js';

const data = Object.fromEntries(['world', 'npcs'].map(n => [n, JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url)))]));

test('local directories include contacts, records and vertical access in each quest area', () => {
  for (const place of [...data.npcs, ...data.world.landmarks]) {
    const nearby = localMapPlaces(data, place.position);
    assert.equal(nearby[0].id, place.id);
    assert.ok(nearby.every(p => Math.hypot(p.position[0] - place.position[0], p.position[2] - place.position[2]) <= 160));
  }
  const skyway = localMapPlaces(data, [320, 24, 320]);
  for (const id of ['ivo', 'night-platform', 'service-counter', 'last-connection', 'transit-lift', 'transit-ramp']) assert.ok(skyway.some(p => p.id === id));
  assert.ok(!localMapPlaces(data, [0, 0, 0]).some(p => p.id === 'mara'));
});

test('dense map labels remain inside the canvas without overlapping or inventing edge locations', () => {
  for (const center of [[0, 0, 0], [320, 24, 320], [1440, 0, 320]]) {
    const places = localMapPlaces(data, center), saved = structuredClone(places);
    const labels = mapLabelLayout(places, p => [450 + (p[0] - center[0]) * 2, 360 + (p[2] - center[2]) * 2], text => text.length * 7.2, 900, 720);
    assert.ok(labels.length >= 3);
    assert.deepEqual(places, saved);
    for (const [i, a] of labels.entries()) {
      assert.ok(a.x >= 6 && a.y >= 24 && a.x + a.w <= 894 && a.y + a.h <= 714);
      for (const b of labels.slice(i + 1)) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }
  }
  assert.deepEqual(mapLabelLayout([{ name: 'Distant place', position: [1000, 0, 0] }], p => [p[0], 100], text => text.length * 7, 180, 180), []);
});
