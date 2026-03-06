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
  any:           '📖 Any Word',
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

// Free Dictionary API – no key required
const DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

class WordValidator {
  constructor() {
    this.dictionary = WORDS;
  }

  /**
   * Check if a word is valid for a given category (sync – dataset categories).
   * Matching is case-insensitive.
   */
  isValid(word, category) {
    const cat = category.toLowerCase().replace(/[\s-]/g, '');
    const w = word.trim().toLowerCase();

    const set = this.dictionary[cat];
    if (!set) return false;
    return set.has(w);
  }

  /**
   * Async validation – supports the "any" category via dictionary API,
   * falls back to sync isValid for dataset categories.
   */
  async isValidAsync(word, category) {
    const cat = category.toLowerCase().replace(/[\s-]/g, '');
    if (cat === 'any') {
      return this._lookupDictionary(word.trim().toLowerCase());
    }
    return this.isValid(word, category);
  }

  /**
   * Lookup a word using the Free Dictionary API.
   * Returns true if the API returns a 200 (word exists).
   */
  async _lookupDictionary(word) {
    try {
      const res = await fetch(`${DICTIONARY_API}${encodeURIComponent(word)}`);
      return res.ok;   // 200 = valid, 404 = not found
    } catch (err) {
      console.error('Dictionary API error:', err.message);
      return false;
    }
  }

  /** Return list of available category keys (including 'any') */
  getCategories() {
    return ['any', ...Object.keys(this.dictionary)];
  }

  /** Return { key, label, count } for each category */
  getCategoryInfo() {
    return this.getCategories().map(key => {
      if (key === 'any') {
        return { key: 'any', label: CATEGORY_LABELS.any, count: '∞' };
      }
      return {
        key,
        label: CATEGORY_LABELS[key] || key,
        count: this.dictionary[key].size,
      };
    });
  }
}

module.exports = { WordValidator, WORDS, CATEGORY_LABELS };
