/**
 * WordValidator – validates whether a given word belongs to a category.
 *
 * Loads real data from the corpora dataset (Node.js, no Python).
 */

const { loadAllCategories } = require('./datasetLoader');

// Load all category word-sets once at startup
const WORDS = loadAllCategories();

// Display-friendly labels for each category key
const CATEGORY_LABELS = {
  fruits:        '🍎 Fruits',
  vegetables:    '🥦 Vegetables',
  countries:     '🌍 Countries',
  capitals:      '🏛️ Capitals',
  cities:        '🏙️ Cities',
  states:        '🗺️ States / Provinces',
  rivers:        '🌊 Rivers',
  animals:       '🐾 Animals',
  dinosaurs:     '🦕 Dinosaurs',
  dogbreeds:     '🐕 Dog Breeds',
  catbreeds:     '🐈 Cat Breeds',
  birds:         '🐦 Birds',
  colors:        '🎨 Colors',
  sports:        '⚽ Sports',
  flowers:       '🌸 Flowers',
  instruments:   '🎸 Instruments',
  musicgenres:   '🎵 Music Genres',
  fish:          '🐟 Fish & Seafood',
  breads:        '🥐 Breads & Pastries',
  condiments:    '🫙 Condiments',
  herbs:         '🌿 Herbs & Spices',
  carbrands:     '🚗 Car Brands',
  sandwiches:    '🥪 Sandwiches',
  nationalities: '🏳️ Nationalities',
};

class WordValidator {
  constructor() {
    this.dictionary = WORDS;
  }

  /**
   * Check if a word is valid for a given category.
   * Matching is case-insensitive.
   */
  isValid(word, category) {
    const cat = category.toLowerCase().replace(/[\s-]/g, '');
    const w = word.trim().toLowerCase();

    const set = this.dictionary[cat];
    if (!set) return false;
    return set.has(w);
  }

  /** Return list of available category keys */
  getCategories() {
    return Object.keys(this.dictionary);
  }

  /** Return { key, label, count } for each category */
  getCategoryInfo() {
    return this.getCategories().map(key => ({
      key,
      label: CATEGORY_LABELS[key] || key,
      count: this.dictionary[key].size,
    }));
  }
}

module.exports = { WordValidator, WORDS, CATEGORY_LABELS };
