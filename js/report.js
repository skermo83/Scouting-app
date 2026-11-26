// Summary report: per field, the average count and severity of every weed,
// pest and disease over the chosen dates (optionally broken down by day).
import { CATEGORIES, DEFAULT_THRESHOLDS, DENSITY_UNIT } from './defaults.js';
import { areaHa, distance } from './geo.js';

export const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const fmtDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const round = (n) => Math.round(n * 10) / 10;
const CAT_LABEL = Object.fromEntries([...CATEGORIES.map((c) => [c.key, c.label]), ['other', 'Other']]);
const CAT_ORDER = [...CATEGORIES.map((c) => c.key), 'other'];

export const LEVELS = ['Nil', 'Low', 'Moderate', 'High'];

// A "stop" is one scouting location: records within 30 m and 10 minutes of each other.
const STOP_RADIUS_M = 30;
const STOP_GAP_MS = 10 * 60000;

export function assignStops(records) {
  const sorted = [...records].sort((a, b) => a.ts - b.ts);
  const stops = [];
  let cur = null;
  for (const r of sorted) {
    const far = cur && r.lat != null && cur.lat != null && distance([cur.lat, cur.lng], [r.lat, r.lng]) > STOP_RADIUS_M;
    if (!cur || r.ts - cur.lastTs > STOP_GAP_MS || far) {
      cur = { id: stops.length + 1, lat: r.lat, lng: r.lng, ts: r.ts, lastTs: r.ts, records: [] };
      stops.push(cur);
    }
    if (cur.lat == null && r.lat != null) { cur.lat = r.lat; cur.lng = r.lng; }
    cur.lastTs = r.ts;
    cur.records.push(r);
  }
  return stops;
}

export function severity(value, unit, thresholds = DEFAULT_THRESHOLDS) {
  if (!(value > 0)) return 0;
  const [mod, high] = thresholds[unit] || DEFAULT_THRESHOLDS[unit] || [5, 20];
  return value >= high ? 3 : value >= mod ? 2 : 1;
}

// Plant metrics: numbers -> mean of readings (no zero-fill), range, CV%;
// stages -> predominant stage on the latest day scouted, and the range.
export function plantStats(records) {
  const groups = new Map();
  for (const r of records) {
    if (r.category !== 'plant') continue;
    const isStage = r.stage != null;
    const k = isStage ? `stage|${r.item}` : `num|${r.item}|${r.unit}`;
    if (!groups.has(k)) groups.set(k, { item: r.item, unit: isStage ? '' : r.unit, type: isStage ? 'stage' : 'number', recs: [] });
    groups.get(k).recs.push(r);
  }
  return [...groups.values()].map((g) => {
    if (g.type === 'number') {
      const v = g.recs.map((r) => Number(r.count) || 0);
      const mean = v.reduce((s, x) => s + x, 0) / v.length;
      const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.length - 1)) : 0;
      return { ...g, n: v.length, avg: round(mean), min: Math.min(...v), max: Math.max(...v), cv: mean ? Math.round((sd / mean) * 100) : null };
    }
    const latestDay = g.recs.map((r) => dayKey(r.ts)).sort().pop();
    const latest = g.recs.filter((r) => dayKey(r.ts) === latestDay);
    const tally = new Map();   // stage -> {n, lastTs}
    latest.forEach((r) => { const t = tally.get(r.stage) || { n: 0, lastTs: 0 }; tally.set(r.stage, { n: t.n + 1, lastTs: Math.max(t.lastTs, r.ts) }); });
    const byCode = [...latest].sort((a, b) => a.count - b.count);
    // Most common stage; ties go to the most recently recorded one.
    const mode = [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].lastTs - a[1].lastTs)[0][0];
    const codeOf = (s) => String(s).split(/\s+/)[0];
    const lo = byCode[0].stage, hi = byCode[byCode.length - 1].stage;
    return {
      ...g, n: g.recs.length, latestDay, stage: mode,
      range: lo === hi ? '' : `${codeOf(lo)}–${codeOf(hi)}`,
      pct: Math.round((tally.get(mode).n / latest.length) * 100),
    };
  }).sort((a, b) => (a.type === 'stage' ? -1 : 0) - (b.type === 'stage' ? -1 : 0));
}

// Weed density ratings: usual (most common) density where found, the highest seen,
// usual size, and whether any were flowering. Severity comes from the usual density.
function densityStats(g, n, thresholds) {
  const wordFor = new Map(g.recs.map((r) => [r.count, r.density]));   // score -> word as recorded
  const present = g.values.filter((v) => v > 0);
  const tally = new Map();
  present.forEach((v) => tally.set(v, (tally.get(v) || 0) + 1));
  const modeScore = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const maxScore = present.length ? Math.max(...present) : 0;
  const sizes = new Map();
  g.recs.filter((r) => r.size).forEach((r) => sizes.set(r.size, (sizes.get(r.size) || 0) + 1));
  const size = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return {
    category: g.category, item: g.item, unit: DENSITY_UNIT, isDensity: true,
    mostly: wordFor.get(modeScore) || '', upTo: maxScore > modeScore ? wordFor.get(maxScore) : '',
    size, flowering: g.recs.some((r) => /flower/i.test(r.size || '')),
    avg: modeScore, avgPresent: '', max: maxScore,
    found: present.length, stops: n, freq: n ? Math.round((present.length / n) * 100) : 0,
    level: severity(modeScore, DENSITY_UNIT, thresholds),
  };
}

// "Patchy (up to Thick), large 🌼" or "avg 12 plants/m²"
export function itemValue(r, { withUnit = true } = {}) {
  if (r.isDensity) return `${r.mostly}${r.upTo ? ` (up to ${r.upTo})` : ''}${r.size ? `, ${r.size.toLowerCase()}` : ''}${r.flowering && !/flower/i.test(r.size) ? ', some flowering' : ''}`;
  return `avg ${r.avg}${withUnit && r.unit ? ` ${r.unit}` : ''}`;
}

// Per-item statistics over a set of stops.
function itemStats(stops, thresholds) {
  const n = stops.length;
  const groups = new Map();
  stops.forEach((stop) => {
    // If an item was recorded twice at one stop, use the higher count.
    const seen = new Map();
    for (const r of stop.records) {
      if (r.category === 'plant') continue;   // plant metrics are summarised separately
      const k = `${r.category}|${r.item}|${r.unit}`;
      seen.set(k, Math.max(seen.get(k) ?? 0, Number(r.count) || 0));
      if (!groups.has(k)) groups.set(k, { category: r.category, item: r.item, unit: r.unit, values: [] });
    }
    for (const [k, v] of seen) groups.get(k).values.push(v);
    for (const r of stop.records) if (r.density != null) groups.get(`${r.category}|${r.item}|${r.unit}`).recs ||= [];
    for (const r of stop.records) if (r.density != null) groups.get(`${r.category}|${r.item}|${r.unit}`).recs.push(r);
  });
  return [...groups.values()].map((g) => {
    if (g.unit === DENSITY_UNIT) return densityStats(g, n, thresholds);
    const total = g.values.reduce((s, v) => s + v, 0);
    const found = g.values.filter((v) => v > 0).length;
    const avg = n ? total / n : 0;
    return {
      category: g.category, item: g.item, unit: g.unit,
      avg: round(avg),                                   // field average (stops without it count as 0)
      avgPresent: found ? round(total / found) : 0,      // average where present
      max: Math.max(...g.values),
      found, stops: n,
      freq: n ? Math.round((found / n) * 100) : 0,
      level: severity(avg, g.unit, thresholds),
    };
  }).sort((a, b) => b.level - a.level || b.freq - a.freq || b.avg - a.avg);
}

function byCategory(items) {
  const out = {};
  for (const c of CAT_ORDER) {
    const list = items.filter((r) => r.category === c);
    if (list.length) out[c] = list;
  }
  return out;
}

function visitsFor(events) {
  const visits = [];
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.type === 'enter') visits.push({ in: e.ts, out: null });
    else {
      const open = [...visits].reverse().find((v) => v.out == null);
      if (open) open.out = e.ts; else visits.push({ in: null, out: e.ts });
    }
  }
  return visits;
}

export function buildReport(state, { from, to, fieldId = 'all', byDay = false }) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(state.thresholds || {}) };
  const inRange = (ts) => { const k = dayKey(ts); return k >= from && k <= to; };
  const recs = state.records.filter((r) => inRange(r.ts) && (fieldId === 'all' || (r.fieldId || 'none') === fieldId));
  const evs = state.events.filter((e) => inRange(e.ts) && (fieldId === 'all' || e.fieldId === fieldId));

  const keys = new Set([...recs.map((r) => r.fieldId || 'none'), ...evs.map((e) => e.fieldId)]);
  const fields = [...keys].map((key) => {
    const f = state.fields.find((x) => x.id === key);
    const fr = recs.filter((r) => (r.fieldId || 'none') === key);
    const fe = evs.filter((e) => e.fieldId === key);
    const stops = assignStops(fr);
    const items = itemStats(stops, thresholds);
    const cats = {};
    for (const c of CATEGORIES) {
      const list = items.filter((i) => i.category === c.key);
      cats[c.key] = list.length ? { level: list[0].level, top: list[0] } : null;
    }
    const days = [...new Set([...fr.map((r) => dayKey(r.ts)), ...fe.map((e) => dayKey(e.ts))])].sort().reverse();
    return {
      id: key,
      name: f?.name || fr[0]?.fieldName || fe[0]?.fieldName || 'Outside mapped fields',
      crop: (f && state.crops.find((c) => c.id === f.cropId)?.name) || fr.find((r) => r.cropName)?.cropName || '',
      ha: f ? round(areaHa(f)) : null,
      records: fr,
      stops: stops.length,
      items,
      byCat: byCategory(items),
      cats,
      plant: plantStats(fr),
      days,
      daily: byDay ? days.map((d) => {
        const dr = fr.filter((r) => dayKey(r.ts) === d);
        const ds = assignStops(dr);
        return { key: d, stops: ds.length, byCat: byCategory(itemStats(ds, thresholds)), plant: plantStats(dr), visits: visitsFor(fe.filter((e) => dayKey(e.ts) === d)) };
      }) : [],
    };
  }).filter((f) => f.records.length || f.days.length);
  fields.sort((a, b) => (a.id === 'none') - (b.id === 'none') || a.name.localeCompare(b.name));
  return { from, to, byDay, scout: state.scoutName, fields, total: recs.length, records: recs, thresholds, generated: Date.now() };
}

// ---- Output formats --------------------------------------------------------
const visitText = (v) => `${v.in ? fmtTime(v.in) : '?'}–${v.out ? fmtTime(v.out) : '…'}`;
const rangeText = (rep) => (rep.from === rep.to ? fmtDay(rep.from) : `${fmtDay(rep.from)} – ${fmtDay(rep.to)}`);
const datesText = (f) => f.days.slice().reverse().map((d) => fmtDay(d).replace(/,? \d{4}$/, '')).join(', ');
const itemLine = (r) => (r.isDensity
  ? `${r.item}: ${itemValue(r)}${r.flowering ? ' 🌼' : ''} (found at ${r.found}/${r.stops} stops = ${r.freq}%) — ${LEVELS[r.level].toUpperCase()}`
  : `${r.item}: avg ${r.avg} ${r.unit} (max ${r.max}, found at ${r.found}/${r.stops} stops = ${r.freq}%) — ${LEVELS[r.level].toUpperCase()}`);
const shortDay = (k) => fmtDay(k).replace(/,? \d{4}$/, '');
const plantLine = (p) => (p.type === 'stage'
  ? `${p.item}: ${p.stage}${p.range ? ` (range ${p.range})` : ''} — ${p.pct}% of readings on ${shortDay(p.latestDay)}`
  : `${p.item}: avg ${p.avg} ${p.unit} (range ${p.min}–${p.max}, ${p.n} reading${p.n === 1 ? '' : 's'}${p.cv != null && p.n > 1 ? `, CV ${p.cv}%` : ''})`);
const stageOf = (f) => f.plant.find((p) => p.type === 'stage');

export function reportText(rep) {
  const L = ['CROP SCOUTING REPORT', rangeText(rep)];
  if (rep.scout) L.push(`Scout: ${rep.scout}`);
  L.push(`${rep.total} observations · ${rep.fields.length} field(s)`);
  if (!rep.fields.length) return [...L, '', 'No observations recorded in this period.'].join('\n');

  L.push('', 'FIELD OVERVIEW (highest severity per category)');
  for (const f of rep.fields) {
    L.push(`• ${f.name}${f.crop ? ` — ${f.crop}` : ''}${f.ha ? ` (${f.ha} ha)` : ''}, ${f.stops} stops`);
    if (stageOf(f)) L.push(`   Stage: ${stageOf(f).stage}`);
    for (const c of CATEGORIES) {
      const x = f.cats[c.key];
      L.push(`   ${c.label}: ${x ? `${LEVELS[x.level].toUpperCase()} – ${x.top.item} ${itemValue(x.top)}${x.top.flowering ? ' 🌼' : ''}` : 'none recorded'}`);
    }
  }
  for (const f of rep.fields) {
    L.push('', `=== ${f.name}${f.crop ? ` — ${f.crop}` : ''}${f.ha ? ` (${f.ha} ha)` : ''} ===`);
    L.push(`${f.stops} stops · ${f.records.length} obs · scouted ${datesText(f)}`);
    if (f.plant.length) {
      L.push('  PLANT');
      f.plant.forEach((p) => L.push(`   • ${plantLine(p)}`));
    }
    for (const [cat, rows] of Object.entries(f.byCat)) {
      L.push(`  ${CAT_LABEL[cat].toUpperCase()}`);
      rows.forEach((r) => L.push(`   • ${itemLine(r)}`));
    }
    for (const d of f.daily) {
      L.push(`  -- ${fmtDay(d.key)}: ${d.stops} stops${d.visits.length ? `, in/out ${d.visits.map(visitText).join(', ')}` : ''}`);
      d.plant.forEach((p) => L.push(`     Plant · ${plantLine(p)}`));
      for (const [cat, rows] of Object.entries(d.byCat)) rows.forEach((r) => L.push(`     ${CAT_LABEL[cat]} · ${r.item}: ${itemValue(r)}${r.flowering ? ' 🌼' : ''} (${r.isDensity ? '' : `max ${r.max}, `}${r.freq}% of stops)`));
    }
  }
  L.push('', 'Weeds: "mostly" = most common density where found, "up to" = densest seen; 🌼 = flowering seen. Found = % of stops.');
  L.push('Pests/diseases: field avg = total count ÷ stops in the field (stops where not recorded count as 0).');
  L.push('Plant: average of readings taken; CV = variability between readings; stage = most common on the latest day.');
  L.push(`Generated ${new Date(rep.generated).toLocaleString()} by Crop Scout`);
  return L.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badge = (lvl) => `<span class="lvl lvl-${lvl}">${LEVELS[lvl]}</span>`;

function plantTable(plant) {
  if (!plant.length) return '';
  let h = '<table class="rep-table"><thead><tr><th>🌱 Plant</th><th>Avg / stage</th><th>Range</th><th>n</th><th>CV</th></tr></thead><tbody>';
  for (const p of plant) {
    h += p.type === 'stage'
      ? `<tr><td>${esc(p.item)}<div class="unit">on ${esc(shortDay(p.latestDay))}</div></td><td colspan="1"><b>${esc(p.stage)}</b><div class="unit">${p.pct}% of readings</div></td><td>${esc(p.range || '—')}</td><td>${p.n}</td><td></td></tr>`
      : `<tr><td>${esc(p.item)}<div class="unit">${esc(p.unit)}</div></td><td><b>${p.avg}</b></td><td>${p.min}–${p.max}</td><td>${p.n}</td><td>${p.cv != null && p.n > 1 ? `${p.cv}%` : ''}</td></tr>`;
  }
  return `${h}</tbody></table>`;
}

function itemTable(byCat, { compact = false } = {}) {
  let h = '';
  for (const [cat, rows] of Object.entries(byCat)) {
    const allDensity = rows.every((r) => r.isDensity);
    h += `<table class="rep-table"><thead><tr><th>${esc(CAT_LABEL[cat])}</th><th>${allDensity ? 'Mostly' : 'Field avg'}</th><th>${allDensity ? 'Up to' : 'Max'}</th><th>Found</th>${compact ? '' : '<th>Level</th>'}</tr></thead><tbody>`;
    for (const r of rows) {
      const found = `<td>${r.freq}%<div class="unit">${r.found}/${r.stops}</div></td>${compact ? '' : `<td>${badge(r.level)}</td>`}`;
      h += r.isDensity
        ? `<tr><td>${esc(r.item)}<div class="unit">${esc(r.size || '')}${r.flowering ? ' 🌼' : ''}</div></td><td><b>${esc(r.mostly)}</b></td><td>${esc(r.upTo || r.mostly)}</td>${found}</tr>`
        : `<tr><td>${esc(r.item)}<div class="unit">${esc(r.unit)}</div></td><td><b>${r.avg}</b></td><td>${r.max}</td>${found}</tr>`;
    }
    h += '</tbody></table>';
  }
  return h;
}

export function reportHTML(rep) {
  let h = `<div class="report"><h2>Crop Scouting Report</h2>
    <p class="muted">${esc(rangeText(rep))}${rep.scout ? ` · Scout: ${esc(rep.scout)}` : ''} · ${rep.total} observations</p>`;
  if (!rep.fields.length) return `${h}<p>No observations recorded in this period.</p></div>`;

  const anyStage = rep.fields.some(stageOf);
  h += `<table class="rep-table overview"><thead><tr><th>Field</th>${anyStage ? '<th>Stage</th>' : ''}${CATEGORIES.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>`;
  for (const f of rep.fields) {
    h += `<tr><td><b>${esc(f.name)}</b><div class="unit">${esc(f.crop || '')}${f.ha ? ` · ${f.ha} ha` : ''} · ${f.stops} stops</div></td>`;
    if (anyStage) h += stageOf(f) ? `<td><b>${esc(String(stageOf(f).stage).split(/\s+/)[0])}</b><div class="unit">${esc(String(stageOf(f).stage).split(/\s+/).slice(1).join(' '))}</div></td>` : '<td class="muted">—</td>';
    for (const c of CATEGORIES) {
      const x = f.cats[c.key];
      h += x ? `<td>${badge(x.level)}<div class="unit">${esc(x.top.item)} ${esc(x.top.isDensity ? `${x.top.mostly}${x.top.flowering ? ' 🌼' : ''}` : x.top.avg)}</div></td>` : '<td class="muted">—</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';

  for (const f of rep.fields) {
    h += `<section class="rep-field"><h3>${esc(f.name)} <small>${esc(f.crop || '')}${f.ha ? ` · ${f.ha} ha` : ''}</small></h3>
      <p class="muted">${f.stops} stops · ${f.records.length} obs · ${esc(datesText(f))}</p>
      ${(plantTable(f.plant) + itemTable(f.byCat)) || '<p class="muted">Visited — nothing recorded.</p>'}`;
    for (const d of f.daily) {
      h += `<div class="rep-day"><div class="rep-day-head"><strong>${esc(fmtDay(d.key))}</strong>
        <span class="muted">${d.stops} stops${d.visits.length ? ` · in/out ${d.visits.map(visitText).join(', ')}` : ''}</span></div>
        ${(plantTable(d.plant) + itemTable(d.byCat, { compact: true })) || '<p class="muted">Visited — nothing recorded.</p>'}</div>`;
    }
    h += '</section>';
  }
  h += '<p class="muted" style="margin-top:12px">Weeds: Mostly = most common density where found; Up to = densest seen; 🌼 = flowering (seed set risk); level comes from the usual density. Counts: field avg = total count ÷ stops in the field (stops where it was not recorded count as 0); Found = % of stops where present; levels use the thresholds in Settings. Plant: average of the readings taken; CV = variability between readings; stage = most common stage on the latest day scouted.</p>';
  return `${h}</div>`;
}

const csvq = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function summaryCSV(rep) {
  const cols = ['from', 'to', 'field', 'crop', 'hectares', 'stops', 'category', 'item', 'unit', 'field_avg', 'avg_where_present', 'min', 'max', 'stops_found', 'percent_stops', 'severity', 'readings', 'cv_percent', 'stage', 'stage_range', 'stage_date', 'density_mostly', 'density_up_to', 'size_mostly', 'flowering'];
  const rows = rep.fields.flatMap((f) => [
    ...f.plant.map((p) => (p.type === 'stage'
      ? [rep.from, rep.to, f.name, f.crop, f.ha ?? '', f.stops, 'plant', p.item, '', '', '', '', '', '', '', '', p.n, '', p.stage, p.range, p.latestDay, '', '', '', '']
      : [rep.from, rep.to, f.name, f.crop, f.ha ?? '', f.stops, 'plant', p.item, p.unit, p.avg, '', p.min, p.max, '', '', '', p.n, p.cv ?? '', '', '', '', '', '', '', ''])),
    ...f.items.map((r) => (r.isDensity
      ? [rep.from, rep.to, f.name, f.crop, f.ha ?? '', f.stops, r.category, r.item, '', '', '', '', '', r.found, r.freq, LEVELS[r.level], '', '', '', '', '', r.mostly, r.upTo || r.mostly, r.size, r.flowering ? 'yes' : 'no']
      : [rep.from, rep.to, f.name, f.crop, f.ha ?? '', f.stops, r.category, r.item, r.unit, r.avg, r.avgPresent, '', r.max, r.found, r.freq, LEVELS[r.level], '', '', '', '', '', '', '', '', ''])),
  ]);
  return [cols, ...rows].map((r) => r.map(csvq).join(',')).join('\n');
}

export function recordsCSV(records) {
  const cols = ['date', 'time', 'field', 'crop', 'stop', 'category', 'item', 'count', 'unit', 'stage', 'density', 'size', 'latitude', 'longitude', 'gps_accuracy_m', 'source', 'note'];
  const stopOf = new Map();
  const byField = new Map();
  records.forEach((r) => { const k = `${r.fieldId || 'none'}|${dayKey(r.ts)}`; if (!byField.has(k)) byField.set(k, []); byField.get(k).push(r); });
  for (const list of byField.values()) assignStops(list).forEach((s) => s.records.forEach((r) => stopOf.set(r.id, s.id)));
  const rows = [...records].sort((a, b) => a.ts - b.ts).map((r) => [
    dayKey(r.ts), fmtTime(r.ts), r.fieldName || 'Outside mapped fields', r.cropName, stopOf.get(r.id), r.category, r.item,
    r.stage != null || r.density != null ? '' : r.count, r.density != null ? '' : r.unit, r.stage ?? '', r.density ?? '', r.size ?? '',
    r.lat?.toFixed(6), r.lng?.toFixed(6), r.acc != null ? Math.round(r.acc) : '', r.source, r.note,
  ]);
  return [cols, ...rows].map((r) => r.map(csvq).join(',')).join('\n');
}
