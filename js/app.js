import { CATEGORIES, UNITS, DEFAULT_CROPS, PLANT_CAT, METRIC_TYPES, stageCode, DEFAULT_PLANT_METRICS, GENERIC_PLANT_METRICS, WEED_DENSITY, WEED_SIZE, DENSITY_UNIT } from './defaults.js';
import { state, save, uid, cropById, fieldById, replaceAll, requestPersistence } from './store.js';
import { Tracker, fieldAt, areaHa, fieldCenter, distance, fieldBBox } from './geo.js';
import { readBoundaryFiles, guessNameKey, guessCropKey } from './importer.js';
import { parseSpeech, Listener, speak, speechSupported } from './voice.js';
import { buildReport, reportText, reportHTML, recordsCSV, summaryCSV, dayKey, fmtDay, fmtTime } from './report.js';
import { DEFAULT_THRESHOLDS } from './defaults.js';

// ---------------------------------------------------------------------------
// Helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => dayKey(Date.now());
const daysAgo = (n) => dayKey(Date.now() - n * 86400000);
const SCOUT_TABS = [...CATEGORIES, PLANT_CAT];
const CAT = Object.fromEntries([...SCOUT_TABS.map((c) => [c.key, c]), ['other', { key: 'other', label: 'Other', icon: '❓' }]]);
const CAT_COLOR = { weeds: '#2f7d4a', pests: '#b7591f', diseases: '#7b4bb3', plant: '#0e7c86', other: '#6b7280' };
const hasMap = () => typeof window.L !== 'undefined';

const UI_KEY = 'cropscout.ui';
const ui = Object.assign({
  tab: 'scout',
  category: 'weeds',
  fieldMode: 'auto',              // 'auto' or a fieldId
  cropId: state.crops[0]?.id,
  recordsDate: today(),
  recordsField: 'all',
  recordsMap: false,
  reportFrom: today(),
  reportTo: today(),
  reportField: 'all',
  settingsCrop: state.crops[0]?.id,
}, (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })());
ui.tab = 'scout';
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ } };

let lastPos = null;          // latest GPS fix {lat,lng,acc,ts}
let gpsError = null;
let visitReconciled = false;
const undoStack = [];        // ids of records created this session
let activeMaps = [];         // Leaflet maps to clean up on re-render

// ---------------------------------------------------------------------------
// GPS tracking + paddock enter/exit
const tracker = new Tracker({
  getFields: () => state.fields,
  onPosition: (pos, field) => {
    // Close a visit left open when the app was last closed (once, on the first good fix).
    if (!visitReconciled && pos.acc <= 50) { visitReconciled = true; reconcileVisit(field); }
    lastPos = pos;
    gpsError = null;
    renderStatus();
  },
  onTransition: (prev, next) => {
    if (!reconcileVisit(next)) return;
    if (next?.cropId && ui.fieldMode === 'auto') { ui.cropId = next.cropId; saveUI(); }
    if (next) { toast(`➡️ Entered ${next.name}`); buzz([80, 60, 80]); }
    else if (prev) { toast(`⬅️ Left ${prev.name}`); buzz(150); }
    if (ui.tab === 'scout') renderScout();
  },
  onError: (msg) => { gpsError = msg; renderStatus(); },
});

// Keeps the enter/exit log consistent, including across app restarts (e.g. a Siri launch
// reloads the page while you are still in the same paddock). Returns true if anything changed.
function reconcileVisit(fieldNow) {
  const lastEv = state.events[state.events.length - 1];
  const openId = lastEv?.type === 'enter' ? lastEv.fieldId : null;
  const nowId = fieldNow?.id || null;
  if (openId === nowId) return false;
  const now = Date.now();
  if (openId) {
    // If the visit is stale (app was closed), end it at the last activity in that field.
    const lastAct = state.records.filter((r) => r.fieldId === openId && r.ts >= lastEv.ts).reduce((m, r) => Math.max(m, r.ts), lastEv.ts);
    const exitTs = now - lastAct > 30 * 60000 ? lastAct : now;
    state.events.push({ id: uid(), ts: exitTs, type: 'exit', fieldId: openId, fieldName: lastEv.fieldName });
  }
  if (fieldNow) state.events.push({ id: uid(), ts: now, type: 'enter', fieldId: fieldNow.id, fieldName: fieldNow.name });
  save();
  return true;
}

const currentField = () => (ui.fieldMode === 'auto' ? tracker.field : fieldById(ui.fieldMode)) || null;
const currentCrop = () => cropById(ui.cropId) || state.crops[0];

function renderStatus() {
  const g = $('#gpsPill');
  if (gpsError && !lastPos) { g.className = 'pill pill-bad'; g.textContent = 'No GPS'; g.title = gpsError; }
  else if (!lastPos) { g.className = 'pill pill-off'; g.textContent = 'GPS…'; }
  else {
    const a = Math.round(lastPos.acc);
    g.className = `pill ${a <= 10 ? 'pill-good' : a <= 30 ? 'pill-ok' : 'pill-bad'}`;
    g.textContent = `GPS ±${a}m`;
  }
  const f = currentField();
  const fp = $('#fieldPill');
  fp.className = `pill pill-field ${f ? 'in' : ''}`;
  fp.textContent = f ? `${ui.fieldMode === 'auto' ? '' : '📌 '}${f.name}` : 'Outside fields';
}

// ---------------------------------------------------------------------------
// Records
function addRecord({ category, item, count, unit, stage, density, size, note = '', source = 'tap', pos = lastPos, field }) {
  const f = field !== undefined ? field : currentField();
  const crop = (f && cropById(f.cropId)) || currentCrop();
  const r = {
    id: uid(), ts: Date.now(),
    fieldId: f?.id || null, fieldName: f?.name || null,
    cropId: crop?.id || null, cropName: crop?.name || null,
    category, item, count: Number(count) || 0, unit: unit || '', note, source,
    lat: pos?.lat ?? null, lng: pos?.lng ?? null, acc: pos?.acc ?? null,
  };
  if (stage != null) { r.stage = stage; r.count = stageCode(stage) ?? 0; }
  if (density != null) {
    r.density = density;
    r.size = size || null;
    r.count = densityScore(density);
    r.unit = DENSITY_UNIT;
    if (size) state.lastSize[item] = size;
  }
  state.records.push(r);
  if (category !== 'plant' && density == null) state.lastUnit[item] = unit;
  save();
  undoStack.push(r.id);
  return r;
}

function deleteRecord(id) {
  const i = state.records.findIndex((r) => r.id === id);
  if (i >= 0) state.records.splice(i, 1);
  save();
}

function undoLast() {
  const id = undoStack.pop();
  const r = state.records.find((x) => x.id === id);
  if (!r) return toast('Nothing to undo');
  deleteRecord(id);
  toast(`Removed ${recordLabel(r)}`);
  speak(`Removed ${r.item}`);
  rerender();
}

const unitFor = (category, item) => state.lastUnit[item] || state.units[category] || 'count';
const weedScale = () => ({ density: state.weedScale?.density?.length ? state.weedScale.density : WEED_DENSITY, size: state.weedScale?.size?.length ? state.weedScale.size : WEED_SIZE });
const densityScore = (d) => Math.max(1, weedScale().density.indexOf(d) + 1);
const densitySize = (r) => `${r.density}${r.size ? `, ${r.size.toLowerCase()}` : ''}`;
const recordLabel = (r) => (r.density != null ? `${r.item}: ${densitySize(r)}` : r.stage != null ? `${r.item}: ${r.stage}` : `${r.item} ${r.count} ${r.unit}`.trim());
const recordShort = (r) => (r.density != null ? `${r.item} ${densitySize(r)}` : r.stage != null ? `${r.item} ${r.stage}` : `${r.item} ${r.count}`);
const metricsOf = (crop) => crop?.plant || [];
const findMetric = (cropId, name) => metricsOf(cropById(cropId)).find((m) => m.name === name)
  || state.crops.flatMap(metricsOf).find((m) => m.name === name) || null;

// ---------------------------------------------------------------------------
// Toast, sheet, misc
let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<div class="grow">${esc(msg)}</div>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.fn(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2600);
}
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* ignore */ } };

let sheetCleanup = null;
function openSheet(html, { full = false, onMount, onClose } = {}) {
  closeSheet();
  const s = $('#sheet');
  s.className = `sheet${full ? ' full' : ''}`;
  s.onclick = null;
  s.innerHTML = html;
  $('#sheetWrap').hidden = false;
  sheetCleanup = onClose || null;
  onMount?.(s);
}
function closeSheet() {
  if (sheetCleanup) { const fn = sheetCleanup; sheetCleanup = null; fn(); }
  $('#sheetWrap').hidden = true;
  $('#sheet').innerHTML = '';
}

function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function cropOptions(selected, { includeNone = false } = {}) {
  return (includeNone ? '<option value="">— none —</option>' : '')
    + state.crops.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function fieldOptions(selected, first) {
  return first + state.fields.map((f) => `<option value="${f.id}" ${f.id === selected ? 'selected' : ''}>${esc(f.name)}</option>`).join('');
}
const unitOptions = (selected) => [...new Set([...UNITS, selected].filter(Boolean))]
  .map((u) => `<option ${u === selected ? 'selected' : ''}>${esc(u)}</option>`).join('');

function recordItemHTML(r, { showField = false } = {}) {
  return `<li data-act="edit-record" data-id="${r.id}">
    <span class="tag cat-${r.category}"></span>
    <div class="grow"><div class="title">${esc(r.item)}${r.source === 'voice' || r.source === 'siri' ? ' 🎤' : ''}</div>
      <div class="sub">${fmtTime(r.ts)}${showField ? ` · ${esc(r.fieldName || 'Outside fields')}` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</div></div>
    ${r.density != null ? `<div class="val stage-val">${esc(r.density)}<small>${esc(r.size || '')}</small></div>` : r.stage != null ? `<div class="val stage-val">${esc(r.stage)}</div>` : `<div class="val">${r.count}<small>${esc(r.unit)}</small></div>`}</li>`;
}

function destroyMaps() {
  activeMaps.forEach((m) => { try { m.remove(); } catch { /* ignore */ } });
  activeMaps = [];
}

function baseMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, ...opts });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, attribution: 'Imagery © Esri',
  }).addTo(map);
  return map;
}
// Bounds from geometry (L.circle.getBounds() needs a map view, which we may not have yet).
const fieldBounds = (f) => L.latLngBounds(fieldBBox(f));

function drawField(map, f, style = {}) {
  const st = { color: '#e9b949', weight: 3, fillOpacity: 0.12, ...style };
  const layer = f.shape === 'circle' ? L.circle(f.center, { radius: f.radius, ...st })
    : L.polygon(f.shape === 'multipolygon' ? f.polys : f.points, st);
  layer.addTo(map).bindTooltip(f.name, { permanent: false });
  return layer;
}

// ---------------------------------------------------------------------------
// Views
function rerender() {
  destroyMaps();
  ({ scout: renderScout, fields: renderFields, records: renderRecords, report: renderReport, settings: renderSettings })[ui.tab]();
  renderStatus();
}

function setTab(tab) {
  ui.tab = tab;
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  rerender();
}

// ----- Scout ---------------------------------------------------------------
let listener;
let heardText = '';
let wakeLock = null;

function renderScout() {
  const crop = currentCrop();
  const f = currentField();
  if (!CAT[ui.category] || ui.category === 'other') ui.category = 'weeds';
  const items = crop && ui.category !== 'plant' ? crop[ui.category] || [] : [];
  const todays = state.records.filter((r) => dayKey(r.ts) === today() && (r.fieldId || null) === (f?.id || null));
  const countsToday = {};
  todays.forEach((r) => { countsToday[r.item] = (countsToday[r.item] || 0) + 1; });
  const evs = state.events.filter((e) => dayKey(e.ts) === today()).slice(-4).reverse();
  const listening = listener?.active;
  const hf = listener?.continuous;

  $('#main').innerHTML = `
    <div class="card stack">
      <div class="row">
        <div><label class="lbl">Field</label>
          <select id="fieldSelect">${fieldOptions(ui.fieldMode, `<option value="auto">📍 Auto (GPS)${ui.fieldMode === 'auto' ? `: ${esc(tracker.field?.name || 'outside fields')}` : ''}</option>`)}</select></div>
        <div><label class="lbl">Crop</label><select id="cropSelect">${cropOptions(crop?.id)}</select></div>
      </div>
      ${!state.fields.length ? '<div class="muted">Tip: add your paddocks in <b>Fields</b> so counts are tagged automatically as you walk in and out.</div>' : ''}
    </div>

    <div class="voice-bar">
      <button class="mic ${listening ? 'listening' : ''}" data-act="mic">${listening ? (hf ? '🎙️ Listening… (tap to stop)' : '🎙️ Listening…') : '🎤 Tap & speak a count'}</button>
      <button class="btn hf ${hf ? 'on' : ''}" data-act="handsfree">Hands-free<br>${hf ? 'ON' : 'off'}</button>
    </div>
    <div class="heard" id="heard">${heardText || (!speechSupported ? 'Voice entry needs Safari (iPhone) or Chrome (Android).'
      : ui.category === 'plant' ? 'Say e.g. <b>“plant stand 12”</b>, <b>“nodes 16 NAWF 4”</b> or <b>“stage first flower”</b> / <b>“stage 31”</b>.'
        : ui.category === 'weeds' ? 'Say e.g. <b>“ryegrass patchy large”</b> or <b>“wild radish thick flowering”</b>. Say <b>“undo”</b> to remove the last one.'
          : 'Say e.g. <b>“aphids 5 per plant”</b> or <b>“stripe rust 10 percent”</b>. Say <b>“undo”</b> to remove the last one.')}</div>

    <div class="seg seg4">${SCOUT_TABS.map((c) => `<button data-act="cat" data-cat="${c.key}" class="${ui.category === c.key ? 'active' : ''}"><span>${c.icon}</span>${c.label}</button>`).join('')}</div>

    <div class="items">
      ${ui.category === 'plant' ? metricsOf(crop).map((m, i) => {
        const recs = todays.filter((r) => r.category === 'plant' && r.item === m.name);
        const last = recs[recs.length - 1];
        let info = m.type === 'stage' ? 'tap to pick stage' : esc(m.unit || '');
        if (last) {
          info = m.type === 'stage' ? `<b>${esc(last.stage)}</b>`
            : `${recs.length > 1 ? 'avg ' : ''}<b>${Math.round((recs.reduce((s, r) => s + r.count, 0) / recs.length) * 10) / 10}</b> ${esc(m.unit || '')}`;
        }
        return `<button class="item-btn" data-act="metric" data-i="${i}">${m.type === 'stage' ? '📈 ' : ''}${esc(m.name)}
          <small>${info}</small>
          ${recs.length ? `<span class="dot cat-plant">${recs.length}</span>` : ''}</button>`;
      }).join('') : items.map((it) => `<button class="item-btn" data-act="count" data-item="${esc(it)}">${esc(it)}
          <small>${ui.category === 'weeds' ? (() => {
            const last = todays.filter((r) => r.item === it && r.category === 'weeds').pop();
            return last?.density ? `<b>${esc(last.density)}</b>${last.size ? ` · ${esc(last.size.toLowerCase())}` : ''}` : last ? `<b>${last.count}</b> ${esc(last.unit)}` : 'density · size';
          })() : esc(unitFor(ui.category, it))}</small>
          ${countsToday[it] ? `<span class="dot cat-${ui.category}">${countsToday[it]}</span>` : ''}</button>`).join('')}
      <button class="item-btn add" data-act="${ui.category === 'plant' ? 'add-metric' : 'add-item'}">＋ Add ${ui.category === 'plant' ? 'metric' : CAT[ui.category].label.toLowerCase().replace(/s$/, '')}</button>
    </div>

    <h3>Today${f ? ` in ${esc(f.name)}` : ' outside fields'} (${todays.length})</h3>
    <div class="card" style="padding:4px 12px">
      <ul class="list">
        ${evs.map((e) => `<li class="event">${e.type === 'enter' ? '➡️ Entered' : '⬅️ Left'} ${esc(e.fieldName)} · ${fmtTime(e.ts)}</li>`).join('')}
        ${todays.slice().reverse().slice(0, 30).map((r) => recordItemHTML(r)).join('') || '<li class="empty">No counts yet. Tap an item or use the mic.</li>'}
      </ul>
    </div>`;

  $('#fieldSelect').onchange = (e) => {
    ui.fieldMode = e.target.value;
    const fl = currentField();
    if (fl?.cropId) ui.cropId = fl.cropId;
    saveUI();
    rerender();
  };
  $('#cropSelect').onchange = (e) => { ui.cropId = e.target.value; saveUI(); renderScout(); };
}

// Weed: pick a density (Odd … Carpet) and a size (Small … Large flowering).
function openWeedSheet({ item, record }) {
  const editing = !!record;
  const { density: D, size: Z } = weedScale();
  const f = editing ? { name: record.fieldName } : currentField();
  let density = record?.density ?? null;
  let size = editing ? record.size ?? null : state.lastSize[item] ?? null;
  const dots = (i) => '●'.repeat(i + 1);
  openSheet(`
    <h2>🌿 ${esc(item)}</h2>
    <div class="muted">${esc(f?.name || 'Outside fields')}${editing ? ` · ${fmtDay(dayKey(record.ts))} ${fmtTime(record.ts)}` : lastPos ? ` · GPS ±${Math.round(lastPos.acc)}m` : ' · no GPS fix yet'}</div>
    <label class="lbl" style="margin-top:14px">Density</label>
    <div class="pick-grid density">${D.map((d, i) => `<button class="pick ${d === density ? 'active' : ''}" data-d="${i}"><span class="dots">${dots(i)}</span>${esc(d)}</button>`).join('')}</div>
    <label class="lbl" style="margin-top:12px">Size</label>
    <div class="pick-grid size">${Z.map((z, i) => `<button class="pick ${z === size ? 'active' : ''}" data-z="${i}">${/flower/i.test(z) ? '🌼 ' : ''}${esc(z)}</button>`).join('')}</div>
    <div class="stack" style="margin-top:12px">
      <div><label class="lbl">Note (optional)</label><input id="note" type="text" value="${esc(record?.note || '')}" placeholder="e.g. along fence line"></div>
      <div class="row">
        ${editing ? '<button class="btn danger" data-w="delete">Delete</button>' : '<button class="btn" data-w="count">Enter a count instead</button>'}
        <button class="btn primary" data-w="save" ${density ? '' : 'disabled'}>Save</button>
      </div>
    </div>`, {
    onMount: (s) => {
      const refresh = () => {
        $$('[data-d]', s).forEach((b) => b.classList.toggle('active', D[b.dataset.d] === density));
        $$('[data-z]', s).forEach((b) => b.classList.toggle('active', Z[b.dataset.z] === size));
        $('[data-w=save]', s).disabled = !density;
      };
      s.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.d != null) { density = D[b.dataset.d]; buzz(15); refresh(); return; }
        if (b.dataset.z != null) { size = Z[b.dataset.z] === size ? null : Z[b.dataset.z]; buzz(15); refresh(); return; }
        if (b.dataset.w === 'count') { closeSheet(); openCountSheet({ category: 'weeds', item }); return; }
        if (b.dataset.w === 'delete') {
          if (confirm('Delete this record?')) { deleteRecord(record.id); closeSheet(); rerender(); }
          return;
        }
        if (b.dataset.w === 'save' && density) {
          const note = $('#note', s).value.trim();
          if (editing) {
            Object.assign(record, { density, size, count: densityScore(density), unit: DENSITY_UNIT, note });
            if (size) state.lastSize[item] = size;
            save();
            toast('Updated');
          } else {
            const r = addRecord({ category: 'weeds', item, density, size, note });
            toast(`Saved ${recordLabel(r)}`, { label: 'Undo', fn: () => { deleteRecord(r.id); rerender(); } });
            buzz(40);
          }
          closeSheet();
          rerender();
        }
      };
    },
  });
}

// Growth stage (or any pick-list metric): one tap on an option saves it.
function openStageSheet({ metric, record }) {
  const editing = !!record;
  const f = editing ? { name: record.fieldName } : currentField();
  const options = [...new Set([...(metric?.options || []), ...(record?.stage ? [record.stage] : [])])];
  const name = metric?.name || record?.item || 'Growth stage';
  openSheet(`
    <h2>🌱 ${esc(name)}</h2>
    <div class="muted">${esc(f?.name || 'Outside fields')}${editing ? ` · ${fmtDay(dayKey(record.ts))} ${fmtTime(record.ts)}` : lastPos ? ` · GPS ±${Math.round(lastPos.acc)}m` : ' · no GPS fix yet'}</div>
    <div class="stage-grid">${options.map((o, i) => `<button class="stage-opt ${record?.stage === o ? 'active' : ''}" data-opt="${i}">${esc(o)}</button>`).join('') || '<p class="muted">No options — add some in Settings → Plant metrics.</p>'}</div>
    <div class="stack" style="margin-top:10px">
      <div><label class="lbl">Note (optional)</label><input id="note" type="text" value="${esc(record?.note || '')}"></div>
      <div class="row">
        ${editing ? '<button class="btn danger" data-sheet="delete">Delete</button>' : ''}
        <button class="btn" data-sheet="cancel">${editing ? 'Close' : 'Cancel'}</button>
      </div>
    </div>`, {
    onMount: (s) => {
      s.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.sheet === 'cancel') closeSheet();
        if (b.dataset.sheet === 'delete' && confirm('Delete this record?')) { deleteRecord(record.id); closeSheet(); rerender(); }
        if (b.dataset.opt != null) {
          const opt = options[Number(b.dataset.opt)];
          const note = $('#note', s).value.trim();
          if (editing) {
            Object.assign(record, { stage: opt, count: stageCode(opt) ?? 0, note });
            save();
            toast('Updated');
          } else {
            const r = addRecord({ category: 'plant', item: name, stage: opt, note });
            toast(`Saved ${recordLabel(r)}`, { label: 'Undo', fn: () => { deleteRecord(r.id); rerender(); } });
            buzz(40);
          }
          closeSheet();
          rerender();
        }
      };
      s.querySelector('.stage-opt.active')?.scrollIntoView({ block: 'center' });
    },
  });
}

function openCountSheet({ category, item, record, unit: presetUnit }) {
  const editing = !!record;
  const unit = record?.unit || presetUnit || unitFor(category, item);
  const f = editing ? { name: record.fieldName } : currentField();
  openSheet(`
    <h2>${CAT[category].icon} ${esc(item)}</h2>
    <div class="muted">${esc(CAT[category].label)} · ${esc(f?.name || 'Outside fields')}${editing ? ` · ${fmtDay(dayKey(record.ts))} ${fmtTime(record.ts)}` : lastPos ? ` · GPS ±${Math.round(lastPos.acc)}m` : ' · no GPS fix yet'}</div>
    <div class="counter">
      <button data-d="-1" aria-label="minus">−</button>
      <input id="cnt" type="number" inputmode="decimal" min="0" step="any" value="${record?.count ?? 0}">
      <button data-d="1" aria-label="plus">+</button>
    </div>
    <div class="quick">${[0, 1, 2, 3, 5, 10, 15, 20, 50, 100].map((n) => `<button data-q="${n}">${n}</button>`).join('')}</div>
    <div class="stack">
      <div><label class="lbl">Unit</label><select id="unit">${unitOptions(unit)}</select></div>
      ${editing ? `<div><label class="lbl">Item</label><input id="itemName" type="text" value="${esc(item)}"></div>
        <div><label class="lbl">Category</label><select id="catSel">${Object.values(CAT).map((c) => `<option value="${c.key}" ${c.key === category ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div>
        <div><label class="lbl">Field</label><select id="recField">${fieldOptions(record.fieldId, '<option value="">Outside fields</option>')}</select></div>` : ''}
      <div><label class="lbl">Note (optional)</label><input id="note" type="text" value="${esc(record?.note || '')}" placeholder="e.g. patchy near dam"></div>
      <div class="row">
        ${editing ? '<button class="btn danger" data-sheet="delete">Delete</button>' : '<button class="btn" data-sheet="cancel">Cancel</button>'}
        <button class="btn primary" data-sheet="save">Save</button>
      </div>
    </div>`, {
    onMount: (s) => {
      const cnt = $('#cnt', s);
      s.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.d) { cnt.value = Math.max(0, (parseFloat(cnt.value) || 0) + Number(b.dataset.d)); buzz(15); }
        if (b.dataset.q) { cnt.value = b.dataset.q; buzz(15); }
        if (b.dataset.sheet === 'cancel') closeSheet();
        if (b.dataset.sheet === 'delete') {
          if (confirm('Delete this record?')) { deleteRecord(record.id); closeSheet(); rerender(); }
        }
        if (b.dataset.sheet === 'save') {
          const count = parseFloat(cnt.value) || 0;
          const u = $('#unit', s).value;
          const note = $('#note', s).value.trim();
          if (editing) {
            const fid = $('#recField', s).value || null;
            Object.assign(record, {
              count, unit: u, note,
              item: $('#itemName', s).value.trim() || record.item,
              category: $('#catSel', s).value,
              fieldId: fid, fieldName: fid ? fieldById(fid)?.name : null,
            });
            save();
            toast('Updated');
          } else {
            const r = addRecord({ category, item, count, unit: u, note });
            toast(`Saved ${recordLabel(r)}`, { label: 'Undo', fn: () => { deleteRecord(r.id); rerender(); } });
            buzz(40);
          }
          closeSheet();
          rerender();
        }
      };
      if (!editing) setTimeout(() => cnt.select(), 50);
    },
  });
}

function handleSpeech(text) {
  const crop = currentCrop();
  const { command, entries } = parseSpeech(text, state.crops, crop?.id, weedScale());
  if (command === 'undo') { heardText = `Heard: <b>${esc(text)}</b>`; undoLast(); return; }
  if (!entries.length) {
    heardText = `Heard: <b>${esc(text)}</b> — no count recognised`;
    if (ui.tab === 'scout') $('#heard').innerHTML = heardText;
    speak('Sorry, say the name then the count');
    return;
  }
  const saved = entries.map((e) => addRecord({
    category: e.category, item: e.item, count: e.count, stage: e.stage, density: e.density, size: e.size,
    unit: e.category === 'plant' ? e.unit : e.unit || unitFor(e.category, e.item),
    note: e.matched ? '' : `Voice: "${e.heard}" (not in menu)`, source: 'voice',
  }));
  heardText = `Heard: <b>${esc(text)}</b> → saved ${saved.map((r) => esc(recordShort(r))).join(', ')}`;
  const unmatched = entries.filter((e) => !e.matched).length;
  toast(`🎤 Saved ${saved.map(recordLabel).join(', ')}${unmatched ? ' (check unmatched)' : ''}`, { label: 'Undo', fn: undoLast });
  speak(saved.map(recordShort).join(', '));
  buzz(60);
  if (ui.tab === 'scout') renderScout();
}

async function setWakeLock(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported */ }
}

function ensureListener() {
  if (listener) return listener;
  listener = new Listener({
    onText: handleSpeech,
    onState: (active, continuous) => { setWakeLock(active && continuous); if (ui.tab === 'scout') renderScout(); },
    onError: (msg) => toast(msg),
  });
  return listener;
}

// ----- Fields --------------------------------------------------------------
function renderFields() {
  $('#main').innerHTML = `
    <h2>Fields / paddocks</h2>
    <div class="row">
      <button class="btn primary" data-act="new-field">＋ Draw field</button>
      <button class="btn" data-act="import-fields">⬆️ Import boundaries</button>
    </div>
    <input type="file" id="importFile" multiple hidden accept=".zip,.shp,.dbf,.prj,.cpg,.shx,.kml,.kmz,.geojson,.json">
    <div class="muted" style="margin-top:6px">Import shapefiles (.zip, or .shp + .dbf + .prj together), KML/KMZ or GeoJSON exported from your farm mapping or yield software.</div>
    ${hasMap() && state.fields.length ? '<div id="fieldsMap" class="map" style="margin-top:12px"></div>' : ''}
    <div class="card" style="padding:4px 12px;margin-top:12px">
      <ul class="list">
        ${state.fields.map((f) => {
          const n = state.records.filter((r) => r.fieldId === f.id).length;
          const last = state.records.filter((r) => r.fieldId === f.id).reduce((m, r) => Math.max(m, r.ts), 0);
          return `<li data-act="edit-field" data-id="${f.id}"><span class="tag" style="background:#e9b949"></span>
            <div class="grow"><div class="title">${esc(f.name)}</div>
              <div class="sub">${esc(cropById(f.cropId)?.name || 'No crop')} · ${areaHa(f).toFixed(1)} ha · ${n} records${last ? ` · last ${fmtDay(dayKey(last))}` : ''}</div></div>
            <div class="val">›</div></li>`;
        }).join('') || '<li class="empty">No fields yet. Add one by tapping corners on the map, walking the boundary, or dropping a circle where you stand.</li>'}
      </ul>
    </div>`;
  $('#importFile').onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    try {
      toast('Reading boundaries…');
      openImportSheet(await readBoundaryFiles(files));
    } catch (err) { alert(`Import failed: ${err.message}`); }
    e.target.value = '';
  };
  if (hasMap() && state.fields.length) {
    const map = baseMap($('#fieldsMap'));
    activeMaps.push(map);
    state.fields.forEach((f) => drawField(map, f).on('click', () => openFieldEditor(f)));
    const bounds = state.fields.reduce((b, f) => b.extend(fieldBounds(f)), fieldBounds(state.fields[0]));
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 17 });
    if (lastPos) L.circleMarker([lastPos.lat, lastPos.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7cf6', fillOpacity: 1 }).addTo(map);
  }
}

function openFieldEditor(existing) {
  const f = existing ? structuredClone(existing) : { id: uid(), name: '', cropId: ui.cropId, shape: 'polygon', points: [], center: null, radius: 100 };
  let mode = f.shape === 'circle' ? 'circle' : f.shape === 'multipolygon' ? 'imported' : 'draw';
  f.points ||= [];
  let map, layer, vertexLayer, walkId = null;

  const html = `
    <div class="row" style="flex:none"><h2 style="margin:0">${existing ? 'Edit field' : 'New field'}</h2>
      <button class="btn small" style="flex:none" data-fe="cancel">✕</button></div>
    <div class="row" style="margin:10px 0;flex:none">
      <div><label class="lbl">Name</label><input id="feName" type="text" value="${esc(f.name)}" placeholder="e.g. North Paddock"></div>
      <div><label class="lbl">Crop</label><select id="feCrop">${cropOptions(f.cropId, { includeNone: true })}</select></div>
    </div>
    <div class="seg" style="flex:none;margin-bottom:6px">
      <button data-mode="draw">✏️ Tap map</button><button data-mode="walk">🚶 Walk it</button><button data-mode="circle">⭕ Circle</button>
    </div>
    <div id="feHelp" class="muted" style="flex:none"></div>
    <div class="map-tools" id="feTools" style="flex:none"></div>
    ${hasMap() ? '<div id="feMap" class="map"></div>' : '<div class="card muted">Map unavailable offline — you can still walk the boundary or drop a circle using GPS.</div>'}
    <div class="row" style="margin-top:10px;flex:none">
      ${existing ? '<button class="btn danger" data-fe="delete">Delete</button>' : ''}
      <button class="btn primary" data-fe="save">Save field</button>
    </div>`;

  const redraw = () => {
    const sz = $('#feHelp');
    if (sz) {
      const ha = areaHa(f);
      const help = {
        draw: 'Tap the map at each corner of the paddock.',
        walk: 'Start, then walk (or drive) the fence line. Points are added every ~8 m.',
        circle: 'Stand in the middle of the area and set a radius — handy for trial plots or quick sites.',
        imported: 'Imported boundary. Change the name or crop here, or pick a method above to redraw it.',
      }[mode];
      sz.innerHTML = `${help}${ha ? ` <b>${ha.toFixed(1)} ha</b>` : ''}`;
    }
    const tools = $('#feTools');
    if (tools) {
      tools.innerHTML = mode === 'imported' ? '' : mode === 'draw'
        ? `<button class="btn small" data-fe="undo-pt">↶ Undo point</button><button class="btn small" data-fe="clear">Clear</button><span class="muted">${f.points.length} points</span>`
        : mode === 'walk'
          ? `${walkId == null ? '<button class="btn small primary" data-fe="walk-start">▶ Start walking</button>' : '<button class="btn small danger" data-fe="walk-stop">■ Stop</button>'}<button class="btn small" data-fe="clear">Clear</button><span class="muted">${f.points.length} points${lastPos ? ` · GPS ±${Math.round(lastPos.acc)}m` : ''}</span>`
          : `<button class="btn small primary" data-fe="circle-here">📍 Centre on me</button>
             <label class="row" style="flex:1;min-width:150px"><span class="muted" style="flex:none">Radius m</span><input id="feRadius" type="number" inputmode="numeric" value="${f.radius || 100}" style="min-height:36px"></label>`;
      const rad = $('#feRadius');
      if (rad) rad.oninput = () => { f.radius = Math.max(5, Number(rad.value) || 100); redrawShape(); redrawHelpOnly(); };
    }
    $$('#sheet .seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $$('#sheet .seg button').forEach((b) => { b.style.background = b.dataset.mode === mode ? 'var(--accent)' : ''; });
    redrawShape();
  };
  const redrawHelpOnly = () => { const ha = areaHa(f); const b = $('#feHelp b'); if (b) b.textContent = `${ha.toFixed(1)} ha`; };
  const redrawShape = () => {
    if (!map) return;
    layer?.remove(); vertexLayer?.remove();
    if (mode === 'imported') layer = L.polygon(f.polys, { color: '#e9b949', weight: 3, fillOpacity: 0.15 }).addTo(map);
    else if (mode === 'circle' && f.center) layer = L.circle(f.center, { radius: f.radius, color: '#e9b949', weight: 3, fillOpacity: 0.15 }).addTo(map);
    else if (mode !== 'circle' && f.points.length) {
      layer = (f.points.length >= 3 ? L.polygon(f.points, { color: '#e9b949', weight: 3, fillOpacity: 0.15 }) : L.polyline(f.points, { color: '#e9b949', weight: 3 })).addTo(map);
      vertexLayer = L.layerGroup(f.points.map((p) => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#e9b949', fillOpacity: 1 }))).addTo(map);
    }
  };
  const stopWalk = () => { if (walkId != null) navigator.geolocation.clearWatch(walkId); walkId = null; };

  openSheet(html, {
    full: true,
    onClose: () => { stopWalk(); map?.remove(); },
    onMount: (s) => {
      if (hasMap()) {
        map = baseMap($('#feMap', s));
        // Show other fields faintly for reference
        state.fields.filter((o) => o.id !== f.id).forEach((o) => drawField(map, o, { color: '#ffffff', weight: 1, fillOpacity: 0.05 }));
        const center = (existing && fieldCenter(existing)) || (lastPos && [lastPos.lat, lastPos.lng]);
        if (existing) map.fitBounds(fieldBounds(existing), { padding: [30, 30] });
        else if (center) map.setView(center, 16);
        else if (state.fields.length) map.setView(fieldCenter(state.fields[0]), 15);
        else map.setView([-31.5, 147], 5);
        if (lastPos) L.circleMarker([lastPos.lat, lastPos.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7cf6', fillOpacity: 1 }).addTo(map);
        map.on('click', (e) => {
          if (mode === 'draw') { f.points.push([e.latlng.lat, e.latlng.lng]); redraw(); }
          else if (mode === 'circle') { f.center = [e.latlng.lat, e.latlng.lng]; redraw(); }
        });
        setTimeout(() => map.invalidateSize(), 200);
      }
      s.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.mode) {
          if (b.dataset.mode !== mode) { stopWalk(); mode = b.dataset.mode; redraw(); }
          return;
        }
        switch (b.dataset.fe) {
          case 'cancel': closeSheet(); break;
          case 'undo-pt': f.points.pop(); redraw(); break;
          case 'clear': f.points = []; redraw(); break;
          case 'circle-here':
            if (!lastPos) return toast('Waiting for GPS fix…');
            f.center = [lastPos.lat, lastPos.lng];
            map?.setView(f.center, 17);
            redraw();
            break;
          case 'walk-start':
            if (!('geolocation' in navigator)) return toast('GPS not available');
            f.points = [];
            walkId = navigator.geolocation.watchPosition((p) => {
              const { latitude: la, longitude: ln, accuracy } = p.coords;
              lastPos = { lat: la, lng: ln, acc: accuracy, ts: p.timestamp };
              if (accuracy > 30) return redraw();
              const prev = f.points[f.points.length - 1];
              const dist = prev ? distance(prev, [la, ln]) : 999;
              if (!prev || dist >= 8) { f.points.push([la, ln]); map?.panTo([la, ln]); }
              redraw();
            }, (err) => toast(err.message), { enableHighAccuracy: true, maximumAge: 0 });
            setWakeLock(true);
            redraw();
            break;
          case 'walk-stop': stopWalk(); setWakeLock(false); redraw(); toast(`Boundary captured: ${f.points.length} points`); break;
          case 'delete': {
            const n = state.records.filter((r) => r.fieldId === f.id).length;
            if (!confirm(`Delete ${f.name}? ${n ? `Its ${n} records are kept (they keep the field name).` : ''}`)) return;
            state.fields = state.fields.filter((x) => x.id !== f.id);
            if (ui.fieldMode === f.id) ui.fieldMode = 'auto';
            save(); saveUI(); tracker.refresh(); closeSheet(); rerender();
            break;
          }
          case 'save': {
            f.name = $('#feName', s).value.trim();
            f.cropId = $('#feCrop', s).value || null;
            f.shape = mode === 'circle' ? 'circle' : mode === 'imported' ? 'multipolygon' : 'polygon';
            if (!f.name) return toast('Give the field a name');
            if (f.shape === 'polygon' && f.points.length < 3) return toast('Need at least 3 boundary points');
            if (f.shape === 'circle' && !f.center) return toast('Set the circle centre (tap map or “Centre on me”)');
            if (f.shape === 'circle') f.points = []; else f.center = null;
            if (f.shape !== 'multipolygon') delete f.polys;
            const i = state.fields.findIndex((x) => x.id === f.id);
            if (i >= 0) {
              state.fields[i] = f;
              // keep record names in sync with renamed field
              state.records.forEach((r) => { if (r.fieldId === f.id) r.fieldName = f.name; });
            } else state.fields.push(f);
            save();
            tracker.refresh();
            closeSheet();
            toast(`Saved ${f.name}`);
            rerender();
            break;
          }
          default:
        }
      };
      redraw();
    },
  });
}

// ----- Boundary import -----------------------------------------------------
function matchCrop(value) {
  if (value == null || value === '') return null;
  const v = String(value).toLowerCase();
  return state.crops.find((c) => v.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(v))?.id || null;
}

function openImportSheet(feats) {
  const keys = [...new Set(feats.flatMap((ft) => Object.keys(ft.props)))];
  let nameKey = guessNameKey(feats);
  const cropKey = guessCropKey(feats);
  const rows = feats.map((ft, i) => ({
    ft, idx: i, include: true, name: '',
    cropId: matchCrop(cropKey ? ft.props[cropKey] : null) || '',
    ha: areaHa({ shape: 'multipolygon', polys: ft.polys }),
  }));
  const applyNames = () => rows.forEach((r) => {
    const v = nameKey ? r.ft.props[nameKey] : '';
    r.name = (v != null && String(v).trim()) || r.ft.name || `Field ${r.idx + 1}`;
  });
  applyNames();
  const exists = (name) => state.fields.some((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  let map;

  const body = () => `
    <div class="row" style="flex:none"><h2 style="margin:0">Import ${rows.length} boundar${rows.length === 1 ? 'y' : 'ies'}</h2>
      <button class="btn small" style="flex:none" data-im="cancel">✕</button></div>
    ${hasMap() ? '<div id="imMap" class="map" style="height:220px;flex:none;margin:10px 0"></div>' : ''}
    <div class="row" style="flex:none">
      <div><label class="lbl">Name from attribute</label><select id="imNameKey">${keys.map((k) => `<option ${k === nameKey ? 'selected' : ''}>${esc(k)}</option>`).join('') || '<option value="">(none)</option>'}</select></div>
      <div><label class="lbl">Set all crops</label><select id="imAllCrop"><option value="">—</option>${cropOptions(null)}</select></div>
    </div>
    <label class="row muted" style="margin:8px 0;flex:none"><input type="checkbox" id="imReplace" checked style="flex:none;width:22px;height:22px"> Update existing fields with the same name (keeps their records)</label>
    <div style="overflow:auto;flex:1">
      <ul class="list">${rows.map((r) => `
        <li style="flex-wrap:wrap">
          <input type="checkbox" data-inc="${r.idx}" ${r.include ? 'checked' : ''} style="width:22px;height:22px;flex:none">
          <input type="text" data-name="${r.idx}" value="${esc(r.name)}" style="flex:1 1 140px;min-height:40px">
          <select data-crop="${r.idx}" style="flex:1 1 110px;min-height:40px">${cropOptions(r.cropId, { includeNone: true })}</select>
          <span class="muted" style="flex:none">${r.ha.toFixed(1)} ha${exists(r.name) ? ' · exists' : ''}</span>
        </li>`).join('')}</ul>
    </div>
    <button class="btn primary block" data-im="go" style="flex:none;margin-top:10px">Import selected</button>`;

  const mount = (s) => {
    if (hasMap()) {
      map?.remove();
      map = baseMap($('#imMap', s));
      let bounds = null;
      rows.forEach((r) => {
        L.polygon(r.ft.polys, { color: '#e9b949', weight: 2, fillOpacity: 0.15 }).bindTooltip(r.name).addTo(map)
          .on('click', () => $(`[data-name="${r.idx}"]`, s)?.focus());
        const b = L.latLngBounds(fieldBBox({ shape: 'multipolygon', polys: r.ft.polys }));
        bounds = bounds ? bounds.extend(b) : b;
      });
      map.fitBounds(bounds, { padding: [10, 10] });
      setTimeout(() => map?.invalidateSize(), 200);
    }
    $('#imNameKey', s).onchange = (e) => { nameKey = e.target.value; applyNames(); s.innerHTML = body(); mount(s); };
    $('#imAllCrop', s).onchange = (e) => {
      rows.forEach((r) => { r.cropId = e.target.value; });
      $$('[data-crop]', s).forEach((sel) => { sel.value = e.target.value; });
    };
    s.oninput = (e) => {
      const t = e.target;
      if (t.dataset.name) rows[t.dataset.name].name = t.value;
      if (t.dataset.crop) rows[t.dataset.crop].cropId = t.value;
      if (t.dataset.inc) rows[t.dataset.inc].include = t.checked;
    };
    s.onchange = s.oninput;
    s.onclick = (e) => {
      const b = e.target.closest('[data-im]');
      if (!b) return;
      if (b.dataset.im === 'cancel') { closeSheet(); return; }
      const replace = $('#imReplace', s).checked;
      let added = 0, updated = 0;
      for (const r of rows.filter((x) => x.include)) {
        const name = r.name.trim() || `Field ${r.idx + 1}`;
        const existing = replace && state.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          Object.assign(existing, { shape: 'multipolygon', polys: r.ft.polys, points: [], center: null, cropId: r.cropId || existing.cropId });
          updated++;
        } else {
          state.fields.push({ id: uid(), name, cropId: r.cropId || null, shape: 'multipolygon', polys: r.ft.polys, points: [], center: null, radius: null });
          added++;
        }
      }
      save();
      tracker.refresh();
      closeSheet();
      toast(`Imported ${added} new field${added === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}`);
      rerender();
    };
  };
  openSheet(body(), { full: true, onMount: mount, onClose: () => { map?.remove(); map = null; } });
}

// ----- Records -------------------------------------------------------------
function renderRecords() {
  const recs = state.records
    .filter((r) => (!ui.recordsDate || dayKey(r.ts) === ui.recordsDate) && (ui.recordsField === 'all' || (r.fieldId || 'none') === ui.recordsField))
    .sort((a, b) => b.ts - a.ts);
  $('#main').innerHTML = `
    <h2>Records</h2>
    <div class="card">
      <div class="row">
        <div><label class="lbl">Date</label><input id="recDate" type="date" value="${ui.recordsDate}"></div>
        <div><label class="lbl">Field</label><select id="recField">${fieldOptions(ui.recordsField, '<option value="all">All fields</option><option value="none" ' + (ui.recordsField === 'none' ? 'selected' : '') + '>Outside fields</option>')}</select></div>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn small ${!ui.recordsDate ? 'on' : ''}" data-act="rec-all-dates">All dates</button>
        ${hasMap() ? `<button class="btn small ${ui.recordsMap ? 'on' : ''}" data-act="rec-map">🗺️ Map</button>` : ''}
      </div>
    </div>
    ${ui.recordsMap && hasMap() ? '<div id="recMap" class="map" style="margin-bottom:12px"></div>' : ''}
    <div class="muted" style="margin:0 4px 6px">${recs.length} record${recs.length === 1 ? '' : 's'}</div>
    <div class="card" style="padding:4px 12px"><ul class="list">
      ${recs.slice(0, 300).map((r) => recordItemHTML(r, { showField: true }).replace('<div class="sub">', `<div class="sub">${ui.recordsDate ? '' : `${fmtDay(dayKey(r.ts))} `}`)).join('') || '<li class="empty">No records for this filter.</li>'}
    </ul></div>`;
  $('#recDate').onchange = (e) => { ui.recordsDate = e.target.value; saveUI(); rerender(); };
  $('#recField').onchange = (e) => { ui.recordsField = e.target.value; saveUI(); rerender(); };

  if (ui.recordsMap && hasMap()) {
    const map = baseMap($('#recMap'));
    activeMaps.push(map);
    let bounds = null;
    const grow = (b) => { bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest ? [b.getSouthWest(), b.getNorthEast()] : [b, b]); };
    state.fields.forEach((f) => { drawField(map, f); grow(fieldBounds(f)); });
    recs.filter((r) => r.lat != null).forEach((r) => {
      grow(L.latLng(r.lat, r.lng));
      (L.circleMarker([r.lat, r.lng], { radius: 7, color: '#fff', weight: 1.5, fillColor: CAT_COLOR[r.category] || '#666', fillOpacity: 0.95 })
        .bindPopup(`<b>${esc(r.item)}</b>: ${r.count} ${esc(r.unit)}<br>${fmtDay(dayKey(r.ts))} ${fmtTime(r.ts)}${r.note ? `<br>${esc(r.note)}` : ''}`)
        .addTo(map));
    });
    if (bounds) map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
    else map.setView(lastPos ? [lastPos.lat, lastPos.lng] : [-31.5, 147], lastPos ? 15 : 5);
  }
}

// ----- Report --------------------------------------------------------------
let lastReport = null;
function renderReport() {
  const rep = buildReport(state, { from: ui.reportFrom, to: ui.reportTo, fieldId: ui.reportField, byDay: !!ui.reportByDay });
  lastReport = rep;
  $('#main').innerHTML = `
    <h2>Summary report</h2>
    <div class="card stack">
      <div class="row">
        <div><label class="lbl">From</label><input id="repFrom" type="date" value="${ui.reportFrom}"></div>
        <div><label class="lbl">To</label><input id="repTo" type="date" value="${ui.reportTo}"></div>
      </div>
      <div class="range-btns">
        <button class="btn small" data-act="rep-range" data-days="0">Today</button>
        <button class="btn small" data-act="rep-range" data-days="1">Yesterday</button>
        <button class="btn small" data-act="rep-range" data-days="7">7 days</button>
        <button class="btn small" data-act="rep-range" data-days="30">30 days</button>
      </div>
      <div class="row">
        <div><label class="lbl">Field</label><select id="repField">${fieldOptions(ui.reportField, '<option value="all">All fields</option><option value="none" ' + (ui.reportField === 'none' ? 'selected' : '') + '>Outside fields</option>')}</select></div>
        <div style="flex:none"><label class="lbl">&nbsp;</label><button class="btn ${ui.reportByDay ? 'on' : ''}" data-act="rep-byday">📅 By day</button></div>
      </div>
      <div class="row">
        <button class="btn primary" data-act="rep-share">📤 Share</button>
        <button class="btn" data-act="rep-email">✉️ Email</button>
        <button class="btn" data-act="rep-print">🖨️ PDF</button>
      </div>
      <div class="row">
        <button class="btn small" data-act="rep-csv">⬇️ Field summary CSV</button>
        <button class="btn small" data-act="rep-raw">⬇️ All counts CSV</button>
      </div>
    </div>
    <div class="card">${reportHTML(rep)}</div>`;
  $('#repFrom').onchange = (e) => { ui.reportFrom = e.target.value; if (ui.reportTo < ui.reportFrom) ui.reportTo = ui.reportFrom; saveUI(); rerender(); };
  $('#repTo').onchange = (e) => { ui.reportTo = e.target.value; if (ui.reportFrom > ui.reportTo) ui.reportFrom = ui.reportTo; saveUI(); rerender(); };
  $('#repField').onchange = (e) => { ui.reportField = e.target.value; saveUI(); rerender(); };
}

const reportFileBase = (rep) => `scouting-report_${rep.from}${rep.to !== rep.from ? `_to_${rep.to}` : ''}`;
const reportSubject = (rep) => `Crop scouting report ${rep.from === rep.to ? fmtDay(rep.from) : `${fmtDay(rep.from)} – ${fmtDay(rep.to)}`}`;

async function shareReport() {
  const rep = lastReport;
  const text = reportText(rep);
  const files = [
    new File([summaryCSV(rep)], `${reportFileBase(rep)}_field-summary.csv`, { type: 'text/csv' }),
    new File([recordsCSV(rep.records)], `${reportFileBase(rep)}_all-counts.csv`, { type: 'text/csv' }),
  ];
  try {
    if (navigator.canShare?.({ files })) return await navigator.share({ title: reportSubject(rep), text, files });
    if (navigator.share) return await navigator.share({ title: reportSubject(rep), text });
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  emailReport();
}
function emailReport() {
  const rep = lastReport;
  let body = reportText(rep);
  if (body.length > 6000) body = `${body.slice(0, 6000)}\n…(truncated — use Share or CSV for the full report)`;
  location.href = `mailto:${encodeURIComponent(state.reportEmail || '')}?subject=${encodeURIComponent(reportSubject(rep))}&body=${encodeURIComponent(body)}`;
}

// Add / edit a plant metric for a crop. index = null to add a new one.
function openMetricEditor(crop, index, after) {
  if (!crop) return;
  crop.plant ||= [];
  const m = index == null ? { name: '', type: 'number', unit: '', options: [] } : structuredClone(crop.plant[index]);
  openSheet(`
    <h2>${index == null ? 'New' : 'Edit'} plant metric <small class="muted">· ${esc(crop.name)}</small></h2>
    <div class="stack">
      <div><label class="lbl">Name</label><input id="mName" type="text" value="${esc(m.name)}" placeholder="e.g. NAWF, Nodes, Plant stand"></div>
      <div><label class="lbl">Type</label><select id="mType">${METRIC_TYPES.map((t) => `<option value="${t.key}" ${t.key === m.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></div>
      <div id="mUnitWrap"><label class="lbl">Unit</label><input id="mUnit" type="text" value="${esc(m.unit || '')}" placeholder="e.g. plants/m², nodes, cm, %"></div>
      <div id="mOptsWrap"><label class="lbl">Options — one per line, in order</label>
        <textarea id="mOpts" rows="8" placeholder="Z31 1st node&#10;Z32 2nd node">${esc((m.options || []).join('\n'))}</textarea>
        <div class="muted">Start a line with a number or code (e.g. “Z31”, “6”, “1.05”) so the report can show the stage range.</div></div>
      <div class="row">
        ${index != null ? '<button class="btn danger" data-m="delete">Delete</button>' : '<button class="btn" data-m="cancel">Cancel</button>'}
        <button class="btn primary" data-m="save">Save</button>
      </div>
    </div>`, {
    onMount: (s) => {
      const sync = () => {
        const stage = $('#mType', s).value === 'stage';
        $('#mUnitWrap', s).hidden = stage;
        $('#mOptsWrap', s).hidden = !stage;
      };
      $('#mType', s).onchange = sync;
      sync();
      s.onclick = (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        if (b.dataset.m === 'cancel') return closeSheet();
        if (b.dataset.m === 'delete') {
          if (confirm(`Remove “${m.name}” from ${crop.name}? Existing records are kept.`)) { crop.plant.splice(index, 1); save(); closeSheet(); after?.(); }
          return;
        }
        const name = $('#mName', s).value.trim();
        const type = $('#mType', s).value;
        if (!name) return toast('Give the metric a name');
        if (crop.plant.some((x, i) => i !== index && x.name.toLowerCase() === name.toLowerCase())) return toast('That name is already used');
        const options = $('#mOpts', s).value.split('\n').map((x) => x.trim()).filter(Boolean);
        if (type === 'stage' && !options.length) return toast('Add at least one option');
        const next = type === 'stage' ? { name, type, unit: '', options } : { name, type, unit: $('#mUnit', s).value.trim() };
        if (index == null) crop.plant.push(next); else crop.plant[index] = next;
        save();
        closeSheet();
        toast(`Saved ${name}`);
        after?.();
      };
    },
  });
}

// ----- Settings ------------------------------------------------------------
function appUrl() { return `${location.origin}${location.pathname}`; }

function renderSettings() {
  if (!cropById(ui.settingsCrop)) ui.settingsCrop = state.crops[0]?.id;
  const crop = cropById(ui.settingsCrop);
  const siriUrl = `${appUrl()}?say=`;
  $('#main').innerHTML = `
    <h2>Settings</h2>

    <div class="card stack">
      <h3 style="margin-top:0">Scouting menus</h3>
      <div class="row">
        <select id="setCrop">${cropOptions(crop?.id)}</select>
        <button class="btn small" style="flex:none" data-act="crop-add">＋ Crop</button>
      </div>
      ${crop ? `
        <div class="row">
          <button class="btn small" data-act="crop-rename">Rename</button>
          <button class="btn small danger" data-act="crop-delete">Delete crop</button>
        </div>
        ${CATEGORIES.map((c) => `
          <div>
            <label class="lbl">${c.icon} ${c.label} (${crop[c.key].length})</label>
            <div class="chips">${crop[c.key].map((it, i) => `<span class="chip">${esc(it)}<button data-act="item-del" data-cat="${c.key}" data-i="${i}" aria-label="remove">✕</button></span>`).join('')}</div>
            <div class="row"><input type="text" id="new-${c.key}" placeholder="Add ${c.label.toLowerCase().replace(/s$/, '')}…"><button class="btn small" style="flex:none" data-act="item-add" data-cat="${c.key}">Add</button></div>
          </div>`).join('')}
        <div>
          <label class="lbl">🌱 Plant metrics (${metricsOf(crop).length})</label>
          <ul class="list metric-list">${metricsOf(crop).map((m, i) => `
            <li><div class="grow"><div class="title">${esc(m.name)}</div>
              <div class="sub">${m.type === 'stage' ? `Stage · ${m.options.length} options` : `Number${m.unit ? ` · ${esc(m.unit)}` : ''}`}</div></div>
              <button class="btn small" style="flex:none" data-act="metric-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="move up">↑</button>
              <button class="btn small" style="flex:none" data-act="metric-edit" data-i="${i}">Edit</button></li>`).join('')}</ul>
          <div class="row">
            <button class="btn small" data-act="add-metric-settings">＋ Add metric</button>
            <button class="btn small" data-act="metric-defaults">Restore defaults</button>
          </div>
        </div>` : '<p class="muted">No crops — add one.</p>'}
    </div>

    <div class="card stack">
      <h3 style="margin-top:0">🌿 Weed density &amp; size</h3>
      <div class="row" style="align-items:flex-start">
        <div><label class="lbl">Density (lightest first)</label><textarea id="wsDensity" rows="5">${esc(weedScale().density.join('\n'))}</textarea></div>
        <div><label class="lbl">Size (smallest first)</label><textarea id="wsSize" rows="5">${esc(weedScale().size.join('\n'))}</textarea></div>
      </div>
      ${(() => {
        const [mod, high] = (state.thresholds || {})[DENSITY_UNIT] || DEFAULT_THRESHOLDS[DENSITY_UNIT];
        const opts = (sel) => weedScale().density.map((d, i) => `<option value="${i + 1}" ${i + 1 === sel ? 'selected' : ''}>${esc(d)}</option>`).join('');
        return `<div class="row"><div><label class="lbl">Moderate from</label><select data-dthr="0">${opts(mod)}</select></div>
          <div><label class="lbl">High from</label><select data-dthr="1">${opts(high)}</select></div></div>`;
      })()}
      <div class="muted">One per line. The report rates each weed by its usual density in the field. Any “flowering” size is flagged 🌼.</div>
      <button class="btn small" data-act="ws-reset">Reset to defaults</button>
    </div>

    <div class="card stack">
      <h3 style="margin-top:0">Default count units</h3>
      ${CATEGORIES.map((c) => `<div class="row"><span style="flex:0 0 90px">${c.label}</span><select data-unit="${c.key}">${unitOptions(state.units[c.key])}</select></div>`).join('')}
      <div class="muted">Each item remembers the last unit you used for it.</div>
    </div>

    <div class="card stack">
      <h3 style="margin-top:0">Severity levels (report)</h3>
      <div class="muted">Field average at or above these values is rated Moderate / High. Anything above 0 but below Moderate is Low.</div>
      <table class="rep-table"><thead><tr><th>Unit</th><th>Moderate ≥</th><th>High ≥</th></tr></thead><tbody>
        ${UNITS.map((u) => { const [m, h] = (state.thresholds || {})[u] || DEFAULT_THRESHOLDS[u] || [5, 20]; return `<tr><td>${esc(u)}</td>
          <td><input type="number" inputmode="decimal" step="any" data-thr="${esc(u)}" data-i="0" value="${m}" style="min-height:38px;max-width:90px"></td>
          <td><input type="number" inputmode="decimal" step="any" data-thr="${esc(u)}" data-i="1" value="${h}" style="min-height:38px;max-width:90px"></td></tr>`; }).join('')}
      </tbody></table>
      <button class="btn small" data-act="thr-reset">Reset to defaults</button>
    </div>

    <div class="card stack">
      <h3 style="margin-top:0">Report</h3>
      <div><label class="lbl">Scout name</label><input id="setScout" type="text" value="${esc(state.scoutName || '')}" placeholder="Shown on reports"></div>
      <div><label class="lbl">Email report to</label><input id="setEmail" type="email" value="${esc(state.reportEmail || '')}" placeholder="agronomist@example.com"></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">🗣️ “Hey Siri” set-up (iPhone)</h3>
      <p class="muted">Make a Shortcut so you can say <b>“Hey Siri, scout”</b> then <b>“ryegrass twelve”</b> without touching the screen.</p>
      <ol class="steps">
        <li>Tap <b>Copy link</b>: <code class="url">${esc(siriUrl)}</code>
          <button class="btn small" data-act="copy-siri">Copy link</button></li>
        <li>Open the <b>Shortcuts</b> app → <b>＋</b> (top right).</li>
        <li><b>Search for actions</b> → <b>Dictate Text</b>.</li>
        <li>Search → <b>URL Encode</b>. It links to <i>Dictated Text</i> automatically.</li>
        <li>Search → <b>Text</b>. In the box, long-press → <b>Paste</b>, then tap <b>Variable</b> above the keyboard (or the <b>Select Variable</b> button) → <i>URL Encoded Text</i>, so it reads <code class="url">${esc(siriUrl)}[URL Encoded Text]</code></li>
        <li>Search → <b>Open URLs</b>. It links to <i>Text</i> automatically.</li>
        <li>Tap the name at the top → <b>Rename</b> → <b>Scout</b> → <b>Done</b>.</li>
      </ol>
      <p class="muted">Test it by tapping the shortcut once, say “ryegrass twelve”, and allow Safari to use your location. Then try “Hey Siri, Scout”.</p>
      <p class="muted">Siri opens this app in <b>Safari</b>. On iPhone, Safari and a home-screen app keep separate data, so if you use Siri, run Crop Scout from Safari (bookmark it) rather than the home-screen icon. The in-app 🎤 and <b>Hands-free</b> mode work either way.</p>
    </div>

    <div class="card stack">
      <h3 style="margin-top:0">Data &amp; backup</h3>
      <div class="muted">${state.records.length} records · ${state.fields.length} fields · stored on this phone only. Back up regularly.</div>
      <div class="row">
        <button class="btn" data-act="backup">⬇️ Export backup</button>
        <button class="btn" data-act="restore">⬆️ Import backup</button>
      </div>
      <input type="file" id="restoreFile" accept=".json,application/json" hidden>
      <button class="btn small" data-act="reset-menus">Restore default crop menus</button>
      <button class="btn small danger" data-act="clear-records">Delete all records</button>
    </div>
    <p class="muted" style="text-align:center">Crop Scout · works offline once loaded</p>`;

  $('#setCrop').onchange = (e) => { ui.settingsCrop = e.target.value; saveUI(); renderSettings(); };
  $('#setScout').onchange = (e) => { state.scoutName = e.target.value.trim(); save(); };
  $('#setEmail').onchange = (e) => { state.reportEmail = e.target.value.trim(); save(); };
  $$('[data-unit]').forEach((sel) => { sel.onchange = () => { state.units[sel.dataset.unit] = sel.value; save(); }; });
  const wsSave = (key, el) => {
    const list = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!list.length) { toast('Keep at least one option'); return; }
    state.weedScale = { ...weedScale(), [key]: list };
    save();
    renderSettings();
  };
  $('#wsDensity').onchange = (e) => wsSave('density', e.target);
  $('#wsSize').onchange = (e) => wsSave('size', e.target);
  $$('[data-dthr]').forEach((sel) => {
    sel.onchange = () => {
      state.thresholds ||= {};
      const t = [...((state.thresholds[DENSITY_UNIT]) || DEFAULT_THRESHOLDS[DENSITY_UNIT])];
      t[Number(sel.dataset.dthr)] = Number(sel.value);
      state.thresholds[DENSITY_UNIT] = t;
      save();
    };
  });
  $$('[data-thr]').forEach((inp) => {
    inp.onchange = () => {
      const u = inp.dataset.thr;
      state.thresholds ||= {};
      const t = [...(state.thresholds[u] || DEFAULT_THRESHOLDS[u] || [5, 20])];
      t[Number(inp.dataset.i)] = Math.max(0, parseFloat(inp.value) || 0);
      state.thresholds[u] = t;
      save();
    };
  });
  $$('input[id^="new-"]').forEach((inp) => {
    inp.onkeydown = (e) => { if (e.key === 'Enter') $(`[data-act="item-add"][data-cat="${inp.id.slice(4)}"]`).click(); };
  });
  $('#restoreFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm(`Replace all data on this phone with the backup (${data.records?.length ?? 0} records, ${data.fields?.length ?? 0} fields)?`)) return;
      replaceAll(data);
      toast('Backup restored');
      rerender();
    } catch (err) { alert(`Import failed: ${err.message}`); }
  };
}

// ---------------------------------------------------------------------------
// Click handling (event delegation)
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('.tabbar button');
  if (tabBtn) return setTab(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const crop = /^(crop|item-|metric-|add-metric-settings)/.test(act) ? cropById(ui.settingsCrop) : null;

  switch (act) {
    case 'close-sheet': closeSheet(); break;
    case 'cat': ui.category = el.dataset.cat; saveUI(); renderScout(); break;
    case 'count':
      if (ui.category === 'weeds') openWeedSheet({ item: el.dataset.item });
      else openCountSheet({ category: ui.category, item: el.dataset.item });
      break;
    case 'add-item': {
      const name = prompt(`Add a ${CAT[ui.category].label.toLowerCase().replace(/s$/, '')} to the ${currentCrop().name} menu:`);
      if (name?.trim()) { currentCrop()[ui.category].push(name.trim()); save(); renderScout(); }
      break;
    }
    case 'edit-record': {
      const r = state.records.find((x) => x.id === el.dataset.id);
      if (!r) break;
      if (r.density != null) openWeedSheet({ item: r.item, record: r });
      else if (r.stage != null) openStageSheet({ metric: findMetric(r.cropId, r.item), record: r });
      else openCountSheet({ category: r.category, item: r.item, record: r });
      break;
    }
    case 'metric': {
      const m = metricsOf(currentCrop())[Number(el.dataset.i)];
      if (!m) break;
      if (m.type === 'stage') openStageSheet({ metric: m });
      else openCountSheet({ category: 'plant', item: m.name, unit: m.unit });
      break;
    }
    case 'add-metric': openMetricEditor(currentCrop(), null, renderScout); break;
    case 'add-metric-settings': openMetricEditor(crop, null, renderSettings); break;
    case 'metric-edit': openMetricEditor(crop, Number(el.dataset.i), renderSettings); break;
    case 'metric-up': {
      const i = Number(el.dataset.i);
      if (i > 0) { [crop.plant[i - 1], crop.plant[i]] = [crop.plant[i], crop.plant[i - 1]]; save(); renderSettings(); }
      break;
    }
    case 'metric-defaults':
      if (confirm(`Replace the ${crop.name} plant metrics with the defaults?`)) {
        crop.plant = structuredClone(DEFAULT_PLANT_METRICS[crop.id] || GENERIC_PLANT_METRICS());
        save(); renderSettings();
      }
      break;
    case 'mic': {
      const l = ensureListener();
      if (l.active) l.stop(); else l.start(false);
      break;
    }
    case 'handsfree': {
      const l = ensureListener();
      if (l.continuous) { l.stop(); toast('Hands-free off'); } else { l.start(true); toast('Hands-free on — just say “item count” as you walk'); }
      break;
    }
    case 'new-field': openFieldEditor(null); break;
    case 'import-fields': $('#importFile').click(); break;
    case 'edit-field': openFieldEditor(fieldById(el.dataset.id)); break;
    case 'rec-all-dates': ui.recordsDate = ui.recordsDate ? '' : today(); saveUI(); rerender(); break;
    case 'rec-map': ui.recordsMap = !ui.recordsMap; saveUI(); rerender(); break;
    case 'rep-range': {
      const d = Number(el.dataset.days);
      if (d === 0) { ui.reportFrom = today(); ui.reportTo = today(); }
      else if (d === 1) { ui.reportFrom = daysAgo(1); ui.reportTo = daysAgo(1); }
      else { ui.reportFrom = daysAgo(d - 1); ui.reportTo = today(); }
      saveUI(); rerender();
      break;
    }
    case 'rep-share': shareReport(); break;
    case 'rep-email': emailReport(); break;
    case 'rep-csv': download(`${reportFileBase(lastReport)}_field-summary.csv`, summaryCSV(lastReport), 'text/csv'); break;
    case 'rep-raw': download(`${reportFileBase(lastReport)}_all-counts.csv`, recordsCSV(lastReport.records), 'text/csv'); break;
    case 'rep-byday': ui.reportByDay = !ui.reportByDay; saveUI(); rerender(); break;
    case 'thr-reset': state.thresholds = structuredClone(DEFAULT_THRESHOLDS); save(); renderSettings(); break;
    case 'ws-reset':
      state.weedScale = { density: [...WEED_DENSITY], size: [...WEED_SIZE] };
      state.thresholds = { ...(state.thresholds || {}), [DENSITY_UNIT]: [...DEFAULT_THRESHOLDS[DENSITY_UNIT]] };
      save(); renderSettings();
      break;
    case 'rep-print': $('#printArea').innerHTML = reportHTML(lastReport); window.print(); break;
    case 'crop-add': {
      const name = prompt('New crop name (e.g. Lentil, Oats, Cotton):');
      if (!name?.trim()) break;
      const copy = state.crops.length && confirm(`Copy weeds/pests/diseases from ${cropById(ui.settingsCrop)?.name}?`) ? cropById(ui.settingsCrop) : null;
      const c = { id: uid(), name: name.trim(), weeds: [...(copy?.weeds || [])], pests: [...(copy?.pests || [])], diseases: [...(copy?.diseases || [])], plant: copy ? structuredClone(copy.plant || []) : GENERIC_PLANT_METRICS() };
      state.crops.push(c); ui.settingsCrop = c.id; save(); saveUI(); renderSettings();
      break;
    }
    case 'crop-rename': {
      const name = prompt('Rename crop:', crop.name);
      if (name?.trim()) { crop.name = name.trim(); save(); renderSettings(); }
      break;
    }
    case 'crop-delete':
      if (state.crops.length <= 1) return toast('Keep at least one crop');
      if (confirm(`Delete the ${crop.name} menu? Existing records are kept.`)) {
        state.crops = state.crops.filter((c) => c.id !== crop.id);
        if (ui.cropId === crop.id) ui.cropId = state.crops[0].id;
        ui.settingsCrop = state.crops[0].id; save(); saveUI(); renderSettings();
      }
      break;
    case 'item-del': crop[el.dataset.cat].splice(Number(el.dataset.i), 1); save(); renderSettings(); break;
    case 'item-add': {
      const inp = $(`#new-${el.dataset.cat}`);
      const v = inp.value.trim();
      if (!v) break;
      if (crop[el.dataset.cat].some((x) => x.toLowerCase() === v.toLowerCase())) { toast('Already in the list'); break; }
      crop[el.dataset.cat].push(v); save(); renderSettings();
      $(`#new-${el.dataset.cat}`)?.focus();
      break;
    }
    case 'copy-siri':
      try { await navigator.clipboard.writeText(`${appUrl()}?say=`); toast('Copied'); } catch { prompt('Copy this URL:', `${appUrl()}?say=`); }
      break;
    case 'backup': download(`crop-scout-backup_${today()}.json`, JSON.stringify(state, null, 1), 'application/json'); break;
    case 'restore': $('#restoreFile').click(); break;
    case 'reset-menus':
      if (confirm('Replace all crop menus with the defaults? Custom items will be lost.')) {
        state.crops = structuredClone(DEFAULT_CROPS); ui.settingsCrop = state.crops[0].id; ui.cropId = state.crops[0].id;
        state.fields.forEach((f) => { if (!cropById(f.cropId)) f.cropId = null; });
        save(); saveUI(); renderSettings();
      }
      break;
    case 'clear-records':
      if (confirm(`Delete ALL ${state.records.length} records? Export a backup first if unsure.`) && confirm('Really delete everything?')) {
        state.records = []; state.events = []; save(); renderSettings();
      }
      break;
    default:
  }
});

// ---------------------------------------------------------------------------
// "Hey Siri" entry: the Shortcut opens  ?say=<dictation>&lat=..&lon=..
async function handleSiriLaunch() {
  const params = new URLSearchParams(location.search);
  const say = params.get('say');
  if (say == null) return;
  history.replaceState(null, '', location.pathname);
  const text = say.trim();
  if (!text) return toast('Siri: nothing heard');

  const lat = parseFloat(params.get('lat') ?? params.get('latitude'));
  const lon = parseFloat(params.get('lon') ?? params.get('lng') ?? params.get('longitude'));
  const key = `${text}|${params.get('lat')}|${params.get('lon')}|${Math.floor(Date.now() / 60000)}`;
  if (state.processedSiri.includes(key)) return;          // page reloaded with same link
  state.processedSiri = [...state.processedSiri.slice(-30), key];

  let pos = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lng: lon, acc: null, ts: Date.now() } : null;
  if (!pos) { try { pos = await Tracker.once(10000); } catch { pos = lastPos; } }
  const field = ui.fieldMode === 'auto' ? (pos ? fieldAt([pos.lat, pos.lng], state.fields) : null) : fieldById(ui.fieldMode);
  if (field?.cropId) ui.cropId = field.cropId;

  const { command, entries } = parseSpeech(text, state.crops, (field && field.cropId) || ui.cropId, weedScale());
  if (command === 'undo') {
    const last = state.records.slice().sort((a, b) => b.ts - a.ts)[0];
    if (last && confirm(`Remove last record: ${recordLabel(last)}?`)) { deleteRecord(last.id); toast('Removed'); }
    save();
    return rerender();
  }
  const saved = entries.map((en) => addRecord({
    category: en.category, item: en.item, count: en.count, stage: en.stage, density: en.density, size: en.size,
    unit: en.category === 'plant' ? en.unit : en.unit || unitFor(en.category, en.item),
    note: en.matched ? '' : `Siri: "${en.heard}" (not in menu)`, source: 'siri', pos, field,
  }));
  save();
  rerender();
  openSheet(`
    <h2>🗣️ Siri entry</h2>
    <p class="muted">Heard “${esc(text)}” · ${esc(field?.name || 'Outside fields')}${pos ? '' : ' · no GPS'}</p>
    ${saved.length ? `<ul class="list">${saved.map((r) => recordItemHTML(r)).join('')}</ul>` : '<p>No count recognised — try “ryegrass twelve”.</p>'}
    <div class="row" style="margin-top:12px">
      ${saved.length ? '<button class="btn danger" id="siriUndo">Undo</button>' : ''}
      <button class="btn primary" data-act="close-sheet">OK</button>
    </div>`, {
    onMount: (s) => {
      const u = $('#siriUndo', s);
      if (u) u.onclick = () => { saved.forEach((r) => deleteRecord(r.id)); closeSheet(); rerender(); toast('Siri entry removed'); };
    },
  });
}

// ---------------------------------------------------------------------------
// Boot
function boot() {
  requestPersistence();
  setTab('scout');
  tracker.start();
  handleSiriLaunch();
  // Leaflet loads with `defer`; re-render map views once it is ready.
  if (!hasMap()) window.addEventListener('load', () => { if (['fields', 'records'].includes(ui.tab)) rerender(); }, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tracker.start();
      if (listener?.continuous) setWakeLock(true);
    }
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  }
}

boot();
