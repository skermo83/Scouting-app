// Local persistence. All data lives on the phone (localStorage); use
// Settings -> Backup to export/import.
import { DEFAULT_CROPS, DEFAULT_UNITS, DEFAULT_THRESHOLDS } from './defaults.js';

const KEY = 'cropscout.v1';

function fresh() {
  return {
    version: 1,
    scoutName: '',
    crops: structuredClone(DEFAULT_CROPS),
    units: { ...DEFAULT_UNITS },
    thresholds: structuredClone(DEFAULT_THRESHOLDS),
    lastUnit: {},          // item name -> unit last used
    fields: [],            // {id, name, cropId, shape:'polygon'|'circle', points:[[lat,lng]], center:[lat,lng], radius}
    records: [],           // {id, ts, fieldId, fieldName, cropId, cropName, category, item, count, unit, lat, lng, acc, note, source}
    events: [],            // {id, ts, type:'enter'|'exit', fieldId, fieldName}
    processedSiri: [],     // ids of Siri requests already saved (dedupe on reload)
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.version === 1) return { ...fresh(), ...s };
  } catch { /* fall through */ }
  return fresh();
}

export const state = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save — phone storage may be full. Export a backup and clear old records.');
    throw e;
  }
}

export function replaceAll(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.records)) throw new Error('Not a Crop Scout backup file');
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh(), data);
  save();
}

export function resetAll() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh());
  save();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const cropById = (id) => state.crops.find((c) => c.id === id);
export const fieldById = (id) => state.fields.find((f) => f.id === id);

// Ask the browser not to evict our data (important on iOS Safari).
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}
