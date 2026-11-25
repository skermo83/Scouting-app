// GPS helpers: field detection, distances, areas, and a position watcher
// that emits enter/exit events as you walk in and out of paddocks.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distance(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pointInPolygon([lat, lng], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Field shapes: 'polygon' {points}, 'circle' {center, radius},
// 'multipolygon' {polys: [[outerRing, hole, ...], ...]} (imported boundaries).
export function inField(pt, f) {
  if (f.shape === 'circle') return distance(pt, f.center) <= f.radius;
  if (f.shape === 'multipolygon') {
    return f.polys.some(([outer, ...holes]) => pointInPolygon(pt, outer) && !holes.some((h) => pointInPolygon(pt, h)));
  }
  return f.points?.length >= 3 && pointInPolygon(pt, f.points);
}

function ringAreaM2(pts) {
  if (!pts || pts.length < 3) return 0;
  const lat0 = rad(pts.reduce((s, p) => s + p[0], 0) / pts.length);
  const xy = pts.map(([la, ln]) => [rad(ln) * R * Math.cos(lat0), rad(la) * R]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// All vertices of a field (for bounds / centre).
export function fieldVertices(f) {
  if (f.shape === 'circle') {
    const dLat = f.radius / 111320;
    const dLng = f.radius / (111320 * Math.cos(rad(f.center[0])));
    return [[f.center[0] - dLat, f.center[1] - dLng], [f.center[0] + dLat, f.center[1] + dLng]];
  }
  if (f.shape === 'multipolygon') return f.polys.flatMap((p) => p[0]);
  return f.points || [];
}

export function fieldBBox(f) {
  const v = fieldVertices(f);
  return [[Math.min(...v.map((p) => p[0])), Math.min(...v.map((p) => p[1]))], [Math.max(...v.map((p) => p[0])), Math.max(...v.map((p) => p[1]))]];
}

export function fieldAt(pt, fields) {
  // If boundaries overlap, prefer the smallest field.
  const hits = fields.filter((f) => inField(pt, f));
  hits.sort((a, b) => areaHa(a) - areaHa(b));
  return hits[0] || null;
}

export function areaHa(f) {
  if (f.shape === 'circle') return (Math.PI * f.radius ** 2) / 10000;
  if (f.shape === 'multipolygon') {
    return f.polys.reduce((s, [outer, ...holes]) => s + ringAreaM2(outer) - holes.reduce((h, r) => h + ringAreaM2(r), 0), 0) / 10000;
  }
  return ringAreaM2(f.points) / 10000;
}

export function fieldCenter(f) {
  if (f.shape === 'circle') return f.center;
  const [[a, b], [c, d]] = fieldBBox(f);
  return [(a + c) / 2, (b + d) / 2];
}

// Continuous GPS watcher with simple hysteresis for field transitions.
export class Tracker {
  constructor({ getFields, onPosition, onTransition, onError }) {
    Object.assign(this, { getFields, onPosition, onTransition, onError });
    this.pos = null;
    this.field = null;
    this.pending = null;
    this.pendingCount = 0;
    this.watchId = null;
    this.initialized = false;
  }

  start() {
    if (!('geolocation' in navigator)) return this.onError?.('GPS not available on this device');
    if (this.watchId != null) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => this.handle(p),
      (e) => this.onError?.(e.message || 'GPS error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  // Re-evaluate the last fix immediately (after fields are added / changed).
  refresh() {
    if (!this.lastRaw) return;
    this.initialized = false;
    this.handle(this.lastRaw);
  }

  handle(p) {
    this.lastRaw = { coords: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }, timestamp: p.timestamp };
    const { latitude, longitude, accuracy } = p.coords;
    this.pos = { lat: latitude, lng: longitude, acc: accuracy, ts: p.timestamp };
    const f = fieldAt([latitude, longitude], this.getFields());
    const id = f?.id ?? null;
    if (id === (this.field?.id ?? null)) {
      this.pending = null;
      this.pendingCount = 0;
    } else if (accuracy <= 50) {
      // Require 2 consecutive fixes before switching, to avoid boundary jitter.
      if (this.pending === id) this.pendingCount++;
      else { this.pending = id; this.pendingCount = 1; }
      if (this.pendingCount >= 2 || !this.initialized) {
        const prev = this.field;
        this.field = f;
        this.pending = null;
        this.pendingCount = 0;
        this.onTransition?.(prev, f);
      }
    }
    this.initialized = true;
    this.onPosition?.(this.pos, this.field);
  }

  // One-off fix (used when the app is opened from Siri).
  static once(timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('GPS not available'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: p.timestamp }),
        (e) => reject(e),
        { enableHighAccuracy: true, maximumAge: 10000, timeout },
      );
    });
  }
}
