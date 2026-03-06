/**
 * Dataset Loader – reads JSON files from the corpora dataset and
 * returns normalized Sets of words for each game category.
 *
 * Pure Node.js – no Python needed.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'dataset', 'corpora-master', 'data');

/**
 * Safely read and parse a JSON file from the dataset.
 */
function loadJSON(relativePath) {
  try {
    const full = path.join(DATA_DIR, relativePath);
    const raw = fs.readFileSync(full, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[datasetLoader] Could not load ${relativePath}: ${err.message}`);
    return null;
  }
}

/**
 * Normalize a word: lowercase, strip leading/trailing whitespace.
 * We keep spaces inside so "new york" stays as "new york".
 */
function norm(w) {
  return String(w).trim().toLowerCase();
}

/**
 * Extract simple string arrays from various JSON structures.
 * Handles: plain arrays of strings, arrays of objects with a name/key field.
 */
function extractStrings(arr, key) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(item => {
      if (typeof item === 'string') return item;
      if (typeof item === 'object' && item !== null && key && item[key]) return item[key];
      if (typeof item === 'object' && item !== null && item.name) return item.name;
      return null;
    })
    .filter(Boolean);
}

/**
 * Build all category word-sets from the dataset.
 */
function loadAllCategories() {
  const categories = {};

  // ── Fruits ────────────────────────────────────────────────────────
  const fruitsData = loadJSON('foods/fruits.json');
  if (fruitsData && fruitsData.fruits) {
    categories.fruits = new Set(extractStrings(fruitsData.fruits).map(norm));
  }

  // ── Vegetables ────────────────────────────────────────────────────
  const vegData = loadJSON('foods/vegetables.json');
  if (vegData && vegData.vegetables) {
    categories.vegetables = new Set(extractStrings(vegData.vegetables).map(norm));
  }

  // ── Countries ─────────────────────────────────────────────────────
  const countriesData = loadJSON('geography/countries.json');
  if (countriesData && countriesData.countries) {
    categories.countries = new Set(extractStrings(countriesData.countries).map(norm));
  }

  // Also merge from countries_with_capitals for more coverage
  const cwc = loadJSON('geography/countries_with_capitals.json');
  if (cwc && cwc.countries) {
    if (!categories.countries) categories.countries = new Set();
    cwc.countries.forEach(c => {
      if (c.name) categories.countries.add(norm(c.name));
    });
  }

  // ── Capitals ──────────────────────────────────────────────────────
  if (cwc && cwc.countries) {
    categories.capitals = new Set();
    cwc.countries.forEach(c => {
      if (c.capital) categories.capitals.add(norm(c.capital));
    });
  }

  // ── Cities (US + English + Canadian) ──────────────────────────────
  categories.cities = new Set();
  const usCities = loadJSON('geography/us_cities.json');
  if (usCities && usCities.cities) {
    usCities.cities.forEach(c => {
      if (c.city) categories.cities.add(norm(c.city));
    });
  }
  const engCities = loadJSON('geography/english_towns_cities.json');
  if (engCities) {
    if (engCities.cities) extractStrings(engCities.cities).forEach(c => categories.cities.add(norm(c)));
    if (engCities.towns) extractStrings(engCities.towns).forEach(c => categories.cities.add(norm(c)));
  }
  const canMunic = loadJSON('geography/canadian_municipalities.json');
  if (canMunic && canMunic.municipalities) {
    extractStrings(canMunic.municipalities).forEach(c => categories.cities.add(norm(c)));
  }

  // ── US States (from state capitals file) ──────────────────────────
  const usStatesCap = loadJSON('geography/us_state_capitals.json');
  if (usStatesCap && usStatesCap.capitals) {
    categories.states = new Set();
    usStatesCap.capitals.forEach(s => {
      if (s.state) categories.states.add(norm(s.state));
    });
  }

  // Also add Canadian provinces & territories
  const canProv = loadJSON('geography/canada_provinces_and_territories.json');
  if (canProv) {
    if (!categories.states) categories.states = new Set();
    if (canProv.provinces) {
      canProv.provinces.forEach(name => categories.states.add(norm(name)));
    }
    if (canProv.territories) {
      canProv.territories.forEach(name => categories.states.add(norm(name)));
    }
  }

  // ── Rivers ────────────────────────────────────────────────────────
  const riversData = loadJSON('geography/rivers.json');
  if (riversData && riversData.rivers) {
    categories.rivers = new Set(
      riversData.rivers.map(r => norm(r.name || r)).filter(Boolean)
    );
  }

  // ── Animals (common) ──────────────────────────────────────────────
  const animalsData = loadJSON('animals/common.json');
  if (animalsData && animalsData.animals) {
    categories.animals = new Set(extractStrings(animalsData.animals).map(norm));
  }

  // ── Dinosaurs ─────────────────────────────────────────────────────
  const dinoData = loadJSON('animals/dinosaurs.json');
  if (dinoData && dinoData.dinosaurs) {
    categories.dinosaurs = new Set(extractStrings(dinoData.dinosaurs).map(norm));
  }

  // ── Dog Breeds ────────────────────────────────────────────────────
  const dogsData = loadJSON('animals/dogs.json');
  if (dogsData && dogsData.dogs) {
    categories.dogbreeds = new Set(extractStrings(dogsData.dogs).map(norm));
  }

  // ── Cat Breeds ────────────────────────────────────────────────────
  const catsData = loadJSON('animals/cats.json');
  if (catsData && catsData.cats) {
    categories.catbreeds = new Set(extractStrings(catsData.cats).map(norm));
  }

  // ── Birds ─────────────────────────────────────────────────────────
  const birdsNA = loadJSON('animals/birds_north_america.json');
  if (birdsNA && birdsNA.birds) {
    categories.birds = new Set();
    birdsNA.birds.forEach(family => {
      if (family.members && Array.isArray(family.members)) {
        family.members.forEach(bird => categories.birds.add(norm(bird)));
      } else if (typeof family === 'string') {
        categories.birds.add(norm(family));
      }
    });
  }

  // ── Colors (web + crayola) ────────────────────────────────────────
  categories.colors = new Set();
  const webColors = loadJSON('colors/web_colors.json');
  if (webColors && webColors.colors) {
    webColors.colors.forEach(c => {
      if (c.color) categories.colors.add(norm(c.color));
    });
  }
  const crayola = loadJSON('colors/crayola.json');
  if (crayola && crayola.colors) {
    crayola.colors.forEach(c => {
      if (c.color) categories.colors.add(norm(c.color));
    });
  }

  // ── Sports ────────────────────────────────────────────────────────
  const sportsData = loadJSON('sports/sports.json');
  if (sportsData && sportsData.sports) {
    categories.sports = new Set(extractStrings(sportsData.sports).map(norm));
  }

  // ── Flowers ───────────────────────────────────────────────────────
  const flowersData = loadJSON('plants/flowers.json');
  if (flowersData && flowersData.flowers) {
    categories.flowers = new Set(extractStrings(flowersData.flowers).map(norm));
  }

  // ── Musical Instruments ───────────────────────────────────────────
  const instrData = loadJSON('music/instruments.json');
  if (instrData && instrData.instruments) {
    categories.instruments = new Set(extractStrings(instrData.instruments).map(norm));
  }

  // ── Music Genres ──────────────────────────────────────────────────
  const genresData = loadJSON('music/genres.json');
  if (genresData && genresData.genres) {
    categories.musicgenres = new Set(extractStrings(genresData.genres).map(norm));
  }

  // ── Fish & Seafood ────────────────────────────────────────────────
  const fishData = loadJSON('foods/fish.json');
  if (fishData && fishData.fish) {
    categories.fish = new Set(extractStrings(fishData.fish).map(norm));
  }

  // ── Breads & Pastries ─────────────────────────────────────────────
  const breadData = loadJSON('foods/breads_and_pastries.json');
  if (breadData) {
    categories.breads = new Set();
    if (breadData.breads) extractStrings(breadData.breads).forEach(b => categories.breads.add(norm(b)));
    if (breadData.pastries) extractStrings(breadData.pastries).forEach(b => categories.breads.add(norm(b)));
  }

  // ── Condiments ────────────────────────────────────────────────────
  const condData = loadJSON('foods/condiments.json');
  if (condData && condData.condiments) {
    categories.condiments = new Set(extractStrings(condData.condiments).map(norm));
  }

  // ── Herbs & Spices ────────────────────────────────────────────────
  const herbData = loadJSON('foods/herbs_n_spices.json');
  if (herbData) {
    categories.herbs = new Set();
    if (herbData.herbs) extractStrings(herbData.herbs).forEach(h => categories.herbs.add(norm(h)));
    if (herbData.spices) extractStrings(herbData.spices).forEach(h => categories.herbs.add(norm(h)));
  }

  // ── Corporations / Car brands ─────────────────────────────────────
  const carsData = loadJSON('corporations/cars.json');
  if (carsData && carsData.cars) {
    categories.carbrands = new Set(extractStrings(carsData.cars).map(norm));
  }

  // ── Sandwiches ────────────────────────────────────────────────────
  const sandData = loadJSON('foods/sandwiches.json');
  if (sandData && sandData.sandwiches) {
    categories.sandwiches = new Set(extractStrings(sandData.sandwiches).map(norm));
  }

  // ── Nationalities ─────────────────────────────────────────────────
  const natData = loadJSON('geography/nationalities.json');
  if (natData && natData.nationalities) {
    categories.nationalities = new Set(
      natData.nationalities.map(n => norm(n.nationality || n)).filter(Boolean)
    );
  }

  // Log summary
  console.log('[datasetLoader] Loaded categories from dataset:');
  for (const [name, set] of Object.entries(categories)) {
    console.log(`  ${name}: ${set.size} words`);
  }

  return categories;
}

module.exports = { loadAllCategories, loadJSON, norm };
