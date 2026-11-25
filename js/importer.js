// Field boundary import: Shapefile (.zip, or .shp + .dbf + .prj picked together),
// KML / KMZ (Google Earth) and GeoJSON. Shapefiles in projected coordinates
// (e.g. MGA / UTM) are reprojected to lat/lng using the .prj file.

let shpLoader = null;
function loadShp() {
  if (window.shp) return Promise.resolve(window.shp);
  shpLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/shpjs/shp.min.js';
    s.onload = () => resolve(window.shp);
    s.onerror = () => { shpLoader = null; reject(new Error('Could not load the shapefile reader (are you offline on first use?)')); };
    document.head.appendChild(s);
  });
  return shpLoader;
}

const ext = (name) => name.toLowerCase().split('.').pop();

/** Read the chosen files and return [{name, props, polys}] with polys in [[lat,lng]] rings. */
export async function readBoundaryFiles(fileList) {
  const files = [...fileList];
  const out = [];
  const byExt = {};
  for (const f of files) (byExt[ext(f.name)] ||= []).push(f);

  for (const f of byExt.zip || []) {
    const shp = await loadShp();
    out.push(...fromGeoJSON(await shp(await f.arrayBuffer()), f.name));
  }
  for (const f of byExt.shp || []) {
    const base = f.name.replace(/\.shp$/i, '').toLowerCase();
    const sib = (e) => files.find((x) => x.name.toLowerCase() === `${base}.${e}`);
    const shp = await loadShp();
    const parts = { shp: await f.arrayBuffer() };
    if (sib('dbf')) parts.dbf = await sib('dbf').arrayBuffer();
    if (sib('prj')) parts.prj = await sib('prj').text();
    if (sib('cpg')) parts.cpg = await sib('cpg').text();
    out.push(...fromGeoJSON(await shp(parts), f.name));
  }
  if ((byExt.dbf || byExt.prj) && !byExt.shp && !byExt.zip) {
    throw new Error('Pick the .shp file too (select .shp, .dbf and .prj together), or choose the zipped shapefile.');
  }
  for (const f of [...(byExt.geojson || []), ...(byExt.json || [])]) out.push(...fromGeoJSON(JSON.parse(await f.text()), f.name));
  for (const f of byExt.kml || []) out.push(...fromKML(await f.text()));
  for (const f of byExt.kmz || []) {
    const entries = await unzip(await f.arrayBuffer());
    const kml = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!kml) throw new Error(`${f.name}: no .kml inside`);
    out.push(...fromKML(new TextDecoder().decode(entries[kml])));
  }
  if (!files.length) return out;
  if (!out.length) throw new Error('No field boundaries (polygons) found in the selected file(s).');
  return out;
}

// ---- GeoJSON --------------------------------------------------------------
const toLatLngRing = (ring) => {
  const pts = ring.map((c) => [c[1], c[0]]);
  const [a, b] = [pts[0], pts[pts.length - 1]];
  if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
};

export function fromGeoJSON(gj, source = '') {
  const layers = Array.isArray(gj) ? gj : [gj];
  const out = [];
  for (const layer of layers) {
    const feats = layer.type === 'FeatureCollection' ? layer.features : layer.type === 'Feature' ? [layer] : [{ type: 'Feature', properties: {}, geometry: layer }];
    for (const ft of feats) {
      const polys = geomPolys(ft.geometry);
      if (polys.length) out.push({ name: '', props: { ...(ft.properties || {}) }, polys, source: layer.fileName || source });
    }
  }
  return out;
}

function geomPolys(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates.map(toLatLngRing)];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p.map(toLatLngRing));
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(geomPolys);
  return [];
}

// ---- KML ------------------------------------------------------------------
export function fromKML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const ringOf = (el) => (el?.textContent || '').trim().split(/\s+/).map((t) => t.split(',').map(Number))
    .filter((c) => c.length >= 2 && c.every(Number.isFinite)).map((c) => [c[1], c[0]]);
  const out = [];
  for (const pm of doc.getElementsByTagName('Placemark')) {
    const polys = [];
    for (const pg of pm.getElementsByTagName('Polygon')) {
      const outer = ringOf(pg.getElementsByTagName('outerBoundaryIs')[0]?.getElementsByTagName('coordinates')[0]);
      const holes = [...pg.getElementsByTagName('innerBoundaryIs')].map((ib) => ringOf(ib.getElementsByTagName('coordinates')[0]));
      if (outer.length >= 3) {
        const close = (r) => { const a = r[0], b = r[r.length - 1]; if (a[0] === b[0] && a[1] === b[1]) r.pop(); return r; };
        polys.push([close(outer), ...holes.filter((h) => h.length >= 3).map(close)]);
      }
    }
    if (!polys.length) continue;
    const props = { name: pm.getElementsByTagName('name')[0]?.textContent?.trim() || '' };
    for (const d of pm.getElementsByTagName('Data')) props[d.getAttribute('name')] = d.getElementsByTagName('value')[0]?.textContent?.trim();
    for (const d of pm.getElementsByTagName('SimpleData')) props[d.getAttribute('name')] = d.textContent.trim();
    out.push({ name: props.name, props, polys, source: 'kml' });
  }
  return out;
}

// ---- Minimal ZIP reader (for KMZ) -------------------------------------------
async function unzip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid zip/kmz file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(buf, dataStart, csize);
    if (method === 0) out[name] = raw;
    else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Pick the attribute most likely to hold the paddock name.
export function guessNameKey(features) {
  const keys = [...new Set(features.flatMap((f) => Object.keys(f.props)))];
  const score = (k) => {
    const l = k.toLowerCase();
    const named = /^(field|paddock|pdk|block|name|field_?name|fieldname|paddock_?name|fld_?name|label|title)$/.test(l) ? 10
      : /(field|paddock|pdk|name|block)/.test(l) ? 6 : 0;
    const vals = features.map((f) => f.props[k]).filter((v) => v != null && v !== '');
    const texty = vals.length && vals.every((v) => typeof v === 'string' && /[a-z]/i.test(v)) ? 3 : 0;
    const unique = new Set(vals.map(String)).size === features.length ? 2 : 0;
    return named + texty + unique;
  };
  return keys.sort((a, b) => score(b) - score(a))[0] || null;
}

export function guessCropKey(features) {
  const keys = [...new Set(features.flatMap((f) => Object.keys(f.props)))];
  return keys.find((k) => /^(crop|crop_?type|crop_?name|commodity|variety|product)$/i.test(k)) || null;
}
