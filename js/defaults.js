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
