// Default crop scouting menus. Fully editable in Settings -> Crop menus.
export const CATEGORIES = [
  { key: 'weeds', label: 'Weeds', icon: '🌿' },
  { key: 'pests', label: 'Pests', icon: '🐛' },
  { key: 'diseases', label: 'Diseases', icon: '🍂' },
];

export const UNITS = [
  'plants/m²',
  'per m²',
  'per plant',
  'per 10 sweeps',
  '% plants affected',
  'severity 0-9',
  'count',
];

export const DEFAULT_UNITS = {
  weeds: 'plants/m²',
  pests: 'per m²',
  diseases: '% plants affected',
};

const cerealWeeds = ['Annual ryegrass', 'Wild oats', 'Wild radish', 'Brome grass', 'Barley grass',
  'Capeweed', 'Fleabane', 'Sowthistle', 'Wireweed', 'Marshmallow', 'Turnip weed'];
const cerealPests = ['Red-legged earth mite', 'Blue oat mite', 'Lucerne flea', 'Aphids',
  'Cutworm', 'Armyworm', 'Snails', 'Slugs', 'Mice'];

export const DEFAULT_CROPS = [
  {
    id: 'wheat', name: 'Wheat',
    weeds: [...cerealWeeds],
    pests: [...cerealPests, 'Brown wheat mite'],
    diseases: ['Stripe rust', 'Leaf rust', 'Stem rust', 'Yellow leaf spot', 'Septoria tritici blotch',
      'Powdery mildew', 'Crown rot', 'Take-all', 'Rhizoctonia', 'Common root rot'],
  },
  {
    id: 'barley', name: 'Barley',
    weeds: [...cerealWeeds],
    pests: [...cerealPests, 'Russian wheat aphid'],
    diseases: ['Net form net blotch', 'Spot form net blotch', 'Scald', 'Powdery mildew',
      'Leaf rust', 'Ramularia', 'Crown rot'],
  },
  {
    id: 'canola', name: 'Canola',
    weeds: ['Wild radish', 'Annual ryegrass', 'Wild oats', 'Capeweed', 'Wild turnip', 'Fumitory',
      'Volunteer cereals', 'Sowthistle'],
    pests: ['Red-legged earth mite', 'Diamondback moth', 'Green peach aphid', 'Cabbage aphid',
      'Turnip aphid', 'Native budworm', 'Lucerne flea', 'Rutherglen bug', 'Snails', 'Slugs', 'Mice'],
    diseases: ['Blackleg', 'Upper canopy blackleg', 'Sclerotinia stem rot', 'Powdery mildew',
      'White leaf spot', 'Downy mildew', 'Alternaria'],
  },
  {
    id: 'chickpea', name: 'Chickpea',
    weeds: ['Annual ryegrass', 'Wild oats', 'Sowthistle', 'Fleabane', 'Bladder ketmia',
      'Volunteer cereals', 'Wild radish'],
    pests: ['Helicoverpa', 'Native budworm', 'Aphids', 'Cutworm', 'Red-legged earth mite'],
    diseases: ['Ascochyta blight', 'Botrytis grey mould', 'Phytophthora root rot', 'Virus'],
  },
  {
    id: 'fababean', name: 'Faba bean',
    weeds: ['Annual ryegrass', 'Wild oats', 'Wild radish', 'Sowthistle', 'Volunteer cereals', 'Capeweed'],
    pests: ['Native budworm', 'Aphids', 'Red-legged earth mite', 'Lucerne flea', 'Snails'],
    diseases: ['Chocolate spot', 'Ascochyta blight', 'Cercospora leaf spot', 'Rust', 'Virus'],
  },
];

// Severity thresholds per unit, applied to the field average: [moderate from, high from].
// Above 0 but below "moderate" = Low. Editable in Settings.
export const DEFAULT_THRESHOLDS = {
  'plants/m²': [5, 20],
  'per m²': [10, 50],
  'per plant': [2, 10],
  'per 10 sweeps': [5, 20],
  '% plants affected': [10, 30],
  'severity 0-9': [3, 6],
  count: [5, 20],
};

// ---- Plant metrics ("Plant" tab) -------------------------------------------
// type 'number': a measured value with a unit (stand count, nodes, NAWF, height…)
// type 'stage' : pick one option from a list (growth stage scales). The leading
//                number in an option (e.g. "Z31", "1.05") is used for averages/ranges.
export const PLANT_CAT = { key: 'plant', label: 'Plant', icon: '🌱' };
export const METRIC_TYPES = [
  { key: 'number', label: 'Number' },
  { key: 'stage', label: 'Stage / choice' },
];

export const ZADOKS = [
  'Z10 1st leaf emerged', 'Z11 1 leaf', 'Z12 2 leaves', 'Z13 3 leaves', 'Z14 4 leaves', 'Z15 5 leaves',
  'Z21 Main shoot + 1 tiller', 'Z22 + 2 tillers', 'Z23 + 3 tillers', 'Z25 + 5 tillers',
  'Z30 Pseudostem erect', 'Z31 1st node', 'Z32 2nd node', 'Z33 3rd node', 'Z37 Flag leaf visible', 'Z39 Flag leaf ligule',
  'Z41 Flag leaf sheath extending', 'Z45 Boots swollen', 'Z49 First awns visible',
  'Z55 Half head emerged', 'Z59 Head fully emerged', 'Z61 Start flowering', 'Z65 Mid flowering', 'Z69 Flowering complete',
  'Z71 Grain watery ripe', 'Z75 Medium milk', 'Z85 Soft dough', 'Z87 Hard dough', 'Z92 Grain hard (harvest ripe)',
];
export const CANOLA_STAGES = [
  '0.0 Emergence', '1.0 Cotyledon', '1.02 2 leaves', '1.04 4 leaves', '1.06 6 leaves', '1.08 8+ leaves',
  '2.0 Stem elongation', '3.1 Bud visible', '3.3 Buds above leaves', '4.1 First flower', '4.5 50% flowering',
  '4.9 Flowering finished', '5.1 Pods forming', '5.5 Seed colour change', '5.9 Harvest ripe',
];
export const COTTON_STAGES = [
  '0 Emergence', '1 Cotyledon', '2 1–3 true leaves', '3 4–6 true leaves', '4 Pinhead square', '5 Squaring',
  '6 First flower', '7 Peak flowering', '8 Cutout (NAWF ≤ 4)', '9 First open boll', '10 20% open bolls',
  '11 60% open bolls', '12 Defoliation ready', '13 Picked',
];
export const PULSE_STAGES = [
  '0 Emergence', '1 1–3 nodes', '2 4–6 nodes', '3 7–10 nodes', '4 10+ nodes', '5 First flower',
  '6 Early pod', '7 Pod fill', '8 Physiological maturity', '9 Harvest ripe',
];

const stand = (unit = 'plants/m²') => ({ name: 'Plant stand', type: 'number', unit });
const stage = (options) => ({ name: 'Growth stage', type: 'stage', unit: '', options: [...options] });
const num = (name, unit) => ({ name, type: 'number', unit });

const cerealMetrics = () => [stand(), stage(ZADOKS), num('Tillers per plant', 'tillers'), num('Heads', 'heads/m²'), num('Plant height', 'cm')];
export const DEFAULT_PLANT_METRICS = {
  wheat: cerealMetrics(),
  barley: cerealMetrics(),
  canola: [stand(), stage(CANOLA_STAGES), num('Plant height', 'cm'), num('Biomass score', '1–5')],
  chickpea: [stand(), stage(PULSE_STAGES), num('Nodes', 'nodes'), num('Plant height', 'cm'), num('Pods per plant', 'pods')],
  fababean: [stand(), stage(PULSE_STAGES), num('Nodes', 'nodes'), num('Plant height', 'cm'), num('Pods per plant', 'pods')],
  cotton: [
    stand('plants/m'), stage(COTTON_STAGES), num('Nodes', 'nodes'), num('NAWF', 'nodes'), num('NAWS', 'nodes'),
    num('Fruit retention', '%'), num('Squares', 'per m'), num('Bolls', 'per m'), num('Plant height', 'cm'),
    num('Height:node ratio', 'cm/node'), num('Open bolls', '%'),
  ],
};
export const GENERIC_PLANT_METRICS = () => [stand(), { name: 'Growth stage', type: 'stage', unit: '', options: ['Emergence', 'Vegetative', 'Flowering', 'Grain / pod fill', 'Maturity'] }, num('Plant height', 'cm')];

DEFAULT_CROPS.push({
  id: 'cotton', name: 'Cotton',
  weeds: ['Feathertop Rhodes grass', 'Fleabane', 'Sowthistle', 'Barnyard grass', 'Liverseed grass', 'Nutgrass',
    'Volunteer cotton', 'Bellvine', 'Thornapple', 'Sesbania pea', 'Polymeria (take-all)'],
  pests: ['Helicoverpa eggs', 'Helicoverpa small larvae', 'Helicoverpa medium/large larvae', 'Green mirids',
    'Silverleaf whitefly', 'Cotton aphid', 'Two-spotted mite', 'Thrips', 'Green vegetable bug', 'Mealybug', 'Wireworm'],
  diseases: ['Verticillium wilt', 'Fusarium wilt', 'Black root rot', 'Alternaria leaf spot', 'Boll rot',
    'Cotton bunchy top', 'Seedling disease'],
});
for (const c of DEFAULT_CROPS) c.plant = structuredClone(DEFAULT_PLANT_METRICS[c.id] || GENERIC_PLANT_METRICS());

// Number used to average / sort stage options: "Z31 1st node" -> 31, "1.05 ..." -> 1.05.
export const stageCode = (label) => {
  const m = String(label).match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};
