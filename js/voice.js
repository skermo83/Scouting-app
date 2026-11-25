// Speech: turns phrases like "ryegrass 12 wild oats three aphids 5 per plant"
// into structured counts matched against the crop's scouting menu.
import { CATEGORIES } from './defaults.js';

const SMALL = {
  zero: 0, nil: 0, none: 0, nothing: 0, oh: 0, one: 1, won: 1, a: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4,
  five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Homophones like "to"/"for"/"a" only count as numbers when they are the last word or followed by a unit.
const AMBIGUOUS = new Set(['a', 'to', 'too', 'for', 'won', 'ate', 'oh']);

const FILLER = new Set(['um', 'uh', 'er', 'the', 'of', 'is', 'at', 'and', 'count', 'counted', 'record', 'add', 'log',
  'weed', 'weeds', 'pest', 'pests', 'disease', 'diseases', 'found', 'there', 'are', 'about', 'roughly', 'approximately',
  'scout', 'scouting', 'crop']);

const UNIT_PATTERNS = [
  [/\bper (square )?(metre|meter|m2|m²)\b|\bper square\b|\bsquare (metre|meter)s?\b/g, 'm2'],
  [/\bper plant\b|\bplants? each\b/g, 'per plant'],
  [/\bper (10|ten) sweeps?\b|\bsweeps?\b/g, 'per 10 sweeps'],
  [/\bpercent\b|\bper cent\b|%/g, '% plants affected'],
  [/\bseverity\b/g, 'severity 0-9'],
];

export function normalize(s) {
  return s.toLowerCase().replace(/[-_/]/g, ' ').replace(/[^\p{L}\p{N}%.\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

const singular = (w) => (w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss)es$/.test(w) ? w.slice(0, -2)
  : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length, 1);

// How well a spoken phrase matches a menu item name (0..1).
export function matchScore(phrase, item) {
  const p = normalize(phrase).split(' ').filter(Boolean).map(singular);
  const t = normalize(item).split(' ').filter(Boolean).map(singular);
  if (!p.length || !t.length) return 0;
  const joinedP = p.join(''), joinedT = t.join('');
  // Acronyms, e.g. "RLEM" -> Red-legged earth mite
  if (p.length === 1 && t.length >= 2 && p[0] === t.map((w) => w[0]).join('')) return 0.95;
  const whole = sim(joinedP, joinedT);
  let hit = 0;
  const used = new Set();
  for (const w of p) {
    let best = 0, bi = -1;
    t.forEach((tw, i) => {
      if (used.has(i)) return;
      const s = Math.max(sim(w, tw), tw.startsWith(w) && w.length >= 4 ? 0.9 : 0);
      if (s > best) { best = s; bi = i; }
    });
    if (best >= 0.75) { hit += best; used.add(bi); }
  }
  const phraseCover = hit / p.length;
  const itemCover = used.size / t.length;
  const tokenScore = phraseCover * (0.75 + 0.25 * itemCover);
  // "ryegrass" vs "annual ryegrass": joined substring is a strong signal.
  const contains = joinedT.includes(joinedP) && joinedP.length >= 4 ? 0.85 + 0.15 * (joinedP.length / joinedT.length) : 0;
  return Math.max(whole, tokenScore, contains);
}

function bestItem(phrase, crops, preferCropId) {
  let best = null;
  for (const crop of crops) {
    for (const cat of CATEGORIES) {
      for (const item of crop[cat.key] || []) {
        let s = matchScore(phrase, item);
        if (crop.id === preferCropId) s += 0.05; // prefer the current crop's menu
        if (!best || s > best.score) best = { score: s, item, category: cat.key, cropId: crop.id };
      }
    }
  }
  return best;
}

// Split words into [{words:[...], number}] using number words and digits.
function segment(words) {
  const segs = [];
  let cur = [];
  let i = 0;
  const unitNext = (k) => ['per', 'percent', 'plants', 'plant', 'square', 'sweeps', '%'].includes(words[k]);
  while (i < words.length) {
    const w = words[i];
    let num = null, used = 0;
    if (/^\d+(\.\d+)?%?$/.test(w)) { num = parseFloat(w); used = 1; }
    else if (w in TENS) {
      num = TENS[w]; used = 1;
      if (words[i + 1] in SMALL && SMALL[words[i + 1]] > 0 && SMALL[words[i + 1]] < 10 && !AMBIGUOUS.has(words[i + 1])) { num += SMALL[words[i + 1]]; used = 2; }
    } else if (w in SMALL && (!AMBIGUOUS.has(w) || i === words.length - 1 || unitNext(i + 1))) { num = SMALL[w]; used = 1; }
    if (num !== null && (words[i + used] === 'hundred')) { num *= 100; used++; }
    if (num !== null && cur.length) {
      segs.push({ words: cur, number: num });
      cur = [];
      i += used;
      // Trailing unit words belong to this segment.
      const rest = [];
      while (i < words.length && ['per', 'plant', 'plants', 'square', 'metre', 'meter', 'metres', 'meters', 'm2', 'sweep', 'sweeps', 'percent', 'cent', 'severity', '%'].includes(words[i])) rest.push(words[i++]);
      if (rest.length) segs[segs.length - 1].unitText = rest.join(' ');
      continue;
    }
    if (num !== null && !cur.length && segs.length === 0) {
      // Number spoken before the name, e.g. "12 ryegrass"
      cur.push(`#${num}`);
      i += used;
      continue;
    }
    cur.push(w);
    i++;
  }
  if (cur.length) {
    const lead = cur[0]?.startsWith('#') ? parseFloat(cur.shift().slice(1)) : null;
    if (cur.length) segs.push({ words: cur, number: lead, noNumber: lead === null });
  }
  // Fix up "#12 ryegrass" leading-number segments that ended up glued in.
  for (const s of segs) {
    if (s.words[0]?.startsWith('#')) { s.number = parseFloat(s.words.shift().slice(1)); }
  }
  return segs;
}

function detectUnit(text) {
  for (const [re, u] of UNIT_PATTERNS) if (new RegExp(re.source).test(text)) return u === 'm2' ? null : u;
  return null;
}
function detectUnitM2(text, category) {
  if (new RegExp(UNIT_PATTERNS[0][0].source).test(text)) return category === 'weeds' ? 'plants/m²' : 'per m²';
  return null;
}

/**
 * Parse a spoken phrase.
 * @returns {{command?:string, entries:Array<{category,item,count,unit,matched,score,heard}>}}
 */
export function parseSpeech(text, crops, preferCropId) {
  const norm = normalize(text);
  if (/^(undo|delete last|scratch that|cancel last|remove last)\b/.test(norm)) return { command: 'undo', entries: [] };
  const words = norm.replace(/%/g, ' % ').split(' ').filter(Boolean);
  const segs = segment(words);
  const entries = [];
  for (const s of segs) {
    const nameWords = s.words.filter((w) => !FILLER.has(w) && !['per', 'plant', 'plants', 'square', 'metre', 'meter', 'percent', '%'].includes(w));
    if (!nameWords.length) continue;
    const heard = nameWords.join(' ');
    const best = bestItem(heard, crops, preferCropId);
    const matched = best && best.score >= 0.62;
    const unitText = `${s.words.join(' ')} ${s.unitText || ''}`;
    const category = matched ? best.category : 'other';
    entries.push({
      heard,
      matched,
      score: best?.score ?? 0,
      category,
      item: matched ? best.item : heard.replace(/\b\w/g, (c) => c.toUpperCase()),
      cropId: matched ? best.cropId : null,
      count: s.number ?? 1,
      noNumber: s.number == null,
      unit: detectUnitM2(unitText, category) || detectUnit(unitText),
    });
  }
  return { entries };
}

// ---- Speech recognition wrapper -------------------------------------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = !!SR;

export class Listener {
  constructor({ onText, onState, onError }) {
    Object.assign(this, { onText, onState, onError });
    this.rec = null;
    this.continuous = false;
    this.active = false;
  }

  start(continuous = false) {
    if (!SR) return this.onError?.('Voice recognition is not supported in this browser. Use Safari on iPhone or Chrome on Android.');
    this.stop(true);
    this.continuous = continuous;
    const rec = new SR();
    rec.lang = navigator.language || 'en-AU';
    rec.interimResults = false;
    rec.continuous = continuous;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) this.onText?.(e.results[i][0].transcript.trim());
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.onError?.(e.error === 'not-allowed' ? 'Microphone permission denied' : `Voice error: ${e.error}`);
      if (e.error === 'not-allowed') this.continuous = false;
    };
    rec.onend = () => {
      // Keep listening in hands-free mode (browsers stop after silence).
      if (this.continuous && this.rec === rec) {
        setTimeout(() => { if (this.continuous && this.rec === rec) try { rec.start(); } catch { /* already started */ } }, 250);
      } else {
        this.active = false;
        this.onState?.(false, false);
      }
    };
    this.rec = rec;
    try {
      rec.start();
      this.active = true;
      this.onState?.(true, continuous);
    } catch (e) {
      this.onError?.(e.message);
    }
  }

  stop(silent = false) {
    this.continuous = false;
    const r = this.rec;
    this.rec = null;
    this.active = false;
    if (r) try { r.abort(); } catch { /* ignore */ }
    if (!silent) this.onState?.(false, false);
  }
}

export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
