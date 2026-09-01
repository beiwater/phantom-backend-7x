/**
 * Canonical Research Domain Rules (Issue #86)
 *
 * Grounded in research_tree.json:
 * 1. Cumulative patent thresholds:
 *    [12, 62, 562, 2562, 7562, 17562, 27562, 37562, 47562, 57562, 107562, 157562]
 * 2. Discipline-to-Resource canonical mapping for all 12 research disciplines.
 * 3. CTO science skill multiplier: points * (1 + ctoScience / 100).
 */

import { getResourceDef } from '../../game/constants.ts';

export const MAX_RESEARCH_QUALITY = 12;

export const BASE_POINTS_PER_PATENT = 50;

/**
 * Cumulative patents required to reach quality tiers Q1 through Q12.
 * Q0 is default (0 patents).
 */
export const CUMULATIVE_PATENT_THRESHOLDS: readonly number[] = [
  12, 62, 562, 2562, 7562, 17562, 27562, 37562, 47562, 57562, 107562, 157562
];

export const DISCIPLINES: Record<number, string> = {
  1: 'Plant research',
  2: 'Energy research',
  3: 'Mining research',
  4: 'Electronics research',
  5: 'Breeding research',
  6: 'Chemistry research',
  7: 'Software research',
  8: 'Automotive research',
  9: 'Aerospace research',
  10: 'Materials research',
  11: 'Fashion research',
  12: 'Recipes research'
};

export const RESEARCH_RESOURCE_BY_DISCIPLINE: Record<number, number> = {
  1: 29,   // Plant Research
  2: 30,   // Energy Research
  3: 31,   // Mining Research
  4: 32,   // Electronics Research
  5: 33,   // Breeding Research
  6: 34,   // Chemistry Research
  7: 35,   // Software
  8: 58,   // Automotive Research
  9: 100,  // Aerospace Research
  10: 113, // Materials Research
  11: 59,  // Fashion Research
  12: 145  // Recipes
};

export const DEFAULT_DISCIPLINE = 10; // Materials research fallback

/**
 * Canonical resourceId -> research discipline mapping extracted from research_tree.json.
 */
export const RESOURCE_TO_DISCIPLINE: Record<number, number> = {
  1: 2,   // Power -> Energy
  2: 3,   // Water -> Mining
  3: 1,   // Apples -> Plant
  4: 1,   // Oranges -> Plant
  5: 1,   // Grapes -> Plant
  6: 1,   // Grain -> Plant
  7: 5,   // Steak -> Breeding
  8: 5,   // Sausages -> Breeding
  9: 5,   // Eggs -> Breeding
  10: 3,  // Crude Oil -> Mining
  11: 2,  // Petrol -> Energy
  12: 2,  // Diesel -> Energy
  14: 3,  // Minerals -> Mining
  15: 3,  // Bauxite -> Mining
  16: 6,  // Silicon -> Chemistry
  17: 6,  // Chemicals -> Chemistry
  18: 6,  // Aluminium -> Chemistry
  19: 6,  // Plastic -> Chemistry
  20: 4,  // Processors -> Electronics
  21: 4,  // Electronic Components -> Electronics
  22: 2,  // Batteries -> Energy
  23: 4,  // Displays -> Electronics
  24: 7,  // Smart Phones -> Software
  25: 7,  // Tablets -> Software
  26: 7,  // Laptops -> Software
  27: 7,  // Monitors -> Software
  28: 7,  // Televisions -> Software
  40: 1,  // Cotton -> Plant
  41: 11, // Fabric -> Fashion
  42: 3,  // Iron Ore -> Mining
  43: 6,  // Steel -> Chemistry
  44: 3,  // Sand -> Mining
  45: 6,  // Glass -> Chemistry
  46: 5,  // Leather -> Breeding
  47: 7,  // On-Board Computer -> Software
  48: 2,  // Electric Motor -> Energy
  49: 11, // Luxury Car Interior -> Fashion
  50: 11, // Car Interior -> Fashion
  51: 8,  // Car Body -> Automotive
  52: 2,  // Combustion Engine -> Energy
  53: 8,  // Economy E-Car -> Automotive
  54: 8,  // Luxury E-Car -> Automotive
  55: 8,  // Economy Car -> Automotive
  56: 8,  // Luxury Car -> Automotive
  57: 8,  // Truck -> Automotive
  60: 11, // Underwear -> Fashion
  61: 11, // Gloves -> Fashion
  62: 11, // Dress -> Fashion
  63: 11, // Simmi Shoes -> Fashion
  64: 11, // Handbags -> Fashion
  65: 11, // Sneakers -> Fashion
  66: 1,  // Seeds -> Plant
  67: 6,  // Xmas Crackers -> Chemistry
  68: 3,  // Gold Ore -> Mining
  69: 6,  // Golden Bars -> Chemistry
  70: 4,  // Gold Watch -> Electronics
  71: 11, // Necklace -> Fashion
  72: 1,  // Sugarcane -> Plant
  73: 6,  // Ethanol -> Chemistry
  74: 3,  // Methane -> Mining
  75: 6,  // Carbon Fiber -> Chemistry
  76: 10, // Carbon Composite -> Materials
  77: 9,  // Fuselage -> Aerospace
  78: 9,  // Wing -> Aerospace
  79: 4,  // High Grade E-Components -> Electronics
  80: 7,  // Flight Computer -> Software
  81: 9,  // Cockpit -> Aerospace
  82: 4,  // Attitude Control -> Electronics
  83: 2,  // Rocket Fuel -> Energy
  84: 9,  // Fuel Tank -> Aerospace
  85: 2,  // Solid Rocket -> Energy
  86: 2,  // Rocket Engine -> Energy
  87: 10, // Heat Shield -> Materials
  88: 2,  // Ion Drive -> Energy
  89: 2,  // Jet Engine -> Energy
  90: 9,  // Sub-Orbital 2nd Stage -> Aerospace
  91: 9,  // Sub-Orbital Rocket -> Aerospace
  92: 9,  // Orbital Booster -> Aerospace
  93: 9,  // Starship -> Aerospace
  94: 9,  // BFR -> Aerospace
  95: 9,  // Jumbo Jet -> Aerospace
  96: 9,  // Luxury Jet -> Aerospace
  97: 9,  // Single-Engine Plane -> Aerospace
  98: 4,  // Quadcopter -> Electronics
  99: 4,  // Satellite -> Electronics
  101: 10, // Reinforced Concrete -> Materials
  102: 10, // Bricks -> Materials
  103: 6,  // Cement -> Chemistry
  104: 3,  // Clay -> Mining
  105: 3,  // Limestone -> Mining
  106: 1,  // Wood -> Plant
  107: 10, // Steel Beams -> Materials
  108: 10, // Planks -> Materials
  109: 10, // Windows -> Materials
  110: 10, // Tools -> Materials
  112: 8,  // Bulldozer -> Automotive
  114: 7,  // Robots -> Software
  115: 5,  // Cows -> Breeding
  116: 5,  // Pigs -> Breeding
  117: 5,  // Milk -> Breeding
  118: 1,  // Coffee Beans -> Plant
  119: 12, // Coffee Grounds -> Recipes
  120: 1,  // Vegetables -> Plant
  121: 12, // Bread -> Recipes
  122: 12, // Cheese -> Recipes
  123: 12, // Apple Pie -> Recipes
  124: 12, // Orange Juice -> Recipes
  125: 12, // Apple Cider -> Recipes
  126: 12, // Ginger Beer -> Recipes
  127: 12, // Pizza -> Recipes
  128: 12, // Pasta -> Recipes
  129: 12, // Hamburger -> Recipes
  130: 12, // Lasagna -> Recipes
  131: 12, // Meatballs -> Recipes
  132: 12, // Cocktails -> Recipes
  133: 12, // Flour -> Recipes
  134: 12, // Butter -> Recipes
  135: 12, // Sugar -> Recipes
  136: 1,  // Cocoa Beans -> Plant
  137: 12, // Dough -> Recipes
  138: 12, // Gravy Boat -> Recipes
  139: 1,  // Fodder -> Plant
  140: 12, // Chocolate -> Recipes
  141: 12, // Vegetable Oil -> Recipes
  142: 12, // Salad -> Recipes
  143: 12, // Samosas -> Recipes
  144: 11, // Xmas Ornament -> Fashion
  146: 1,  // Pumpkin -> Plant
  147: 4,  // Jack O'Lantern -> Electronics
  148: 11, // Witch Costume -> Fashion
  149: 12, // Pumpkin Soup -> Recipes
  150: 1,  // Tree -> Plant
  151: 12, // Easter Bunny -> Recipes
  152: 12, // Ramadan Sweets -> Recipes
  153: 12, // Icecream Chocolate -> Recipes
  154: 12, // Icecream Apple -> Recipes
  155: 12  // Cream Egg -> Recipes
};

export const DISCIPLINE_BY_PRODUCED_AT: Record<string, number> = {
  E: 2,  // Power Plant -> Energy
  W: 3,  // Water Reservoir -> Mining
  P: 1,  // Farm -> Plant
  e: 1,  // Orchard -> Plant
  F: 5,  // Ranch -> Breeding
  O: 3,  // Oil Rig -> Mining
  R: 2,  // Refinery -> Energy (Rocket fuel / Petrol / Diesel)
  S: 6,  // Shipping Depot -> Chemistry
  M: 3,  // Mine -> Mining
  Y: 10, // Factory -> Materials
  L: 4,  // Electronics Factory -> Electronics
  T: 11, // Clothes Factory -> Fashion
  Q: 3,  // Quarry -> Mining
  '1': 8,// Car Factory -> Automotive
  '6': 12,// Beverage Factory -> Recipes
  j: 11, // Jewelry -> Fashion
  k: 12, // Food Processing -> Recipes
  m: 5,  // Meat Factory -> Breeding
  A: 2,  // Gas Station -> Energy
  a: 8,  // Race Track -> Automotive
  '0': 9,// Horizontal Integration -> Aerospace
  '7': 9,// Aerospace Factory -> Aerospace
  '8': 4,// Aerospace Electronics -> Electronics
  '9': 9,// Vertical Integration -> Aerospace
  D: 2,  // Propulsion Factory -> Energy
  o: 10, // Concrete Plant -> Materials
  x: 10, // Construction Factory -> Materials
  g: 10, // General Contractor -> Materials
  i: 3,  // Iron Mine -> Mining
  v: 1   // Forest Nursery -> Plant
};

/**
 * Calculates the researched quality level (0..12) given a patent count.
 * Uses canonical cumulative thresholds:
 * 0-11 -> Q0
 * 12-61 -> Q1
 * 62-561 -> Q2
 * 562-2561 -> Q3
 * 2562-7561 -> Q4
 * 7562-17561 -> Q5
 * 17562-27561 -> Q6
 * 27562-37561 -> Q7
 * 37562-47561 -> Q8
 * 47562-57561 -> Q9
 * 57562-107561 -> Q10
 * 107562-157561 -> Q11
 * >= 157562 -> Q12
 */
export function getQualityFromPatents(patents: number): number {
  if (!Number.isFinite(patents) || patents < CUMULATIVE_PATENT_THRESHOLDS[0]) {
    return 0;
  }
  for (let q = CUMULATIVE_PATENT_THRESHOLDS.length - 1; q >= 0; q--) {
    if (patents >= CUMULATIVE_PATENT_THRESHOLDS[q]) {
      return q + 1;
    }
  }
  return 0;
}

/**
 * Returns the cumulative patents needed to unlock the next quality tier.
 */
export function getPatentsNeededForNextQuality(quality: number): number {
  const q = Math.max(0, Math.min(MAX_RESEARCH_QUALITY, Math.floor(quality)));
  if (q >= MAX_RESEARCH_QUALITY) {
    return CUMULATIVE_PATENT_THRESHOLDS[CUMULATIVE_PATENT_THRESHOLDS.length - 1];
  }
  return CUMULATIVE_PATENT_THRESHOLDS[q];
}

/**
 * Maps a resource kind to its canonical research discipline.
 */
export function getDisciplineForResource(resourceKind: number): number {
  if (RESOURCE_TO_DISCIPLINE[resourceKind] !== undefined) {
    return RESOURCE_TO_DISCIPLINE[resourceKind];
  }
  const def = getResourceDef(resourceKind);
  const letter = def?.producedAt != null ? String(def.producedAt) : undefined;
  return (letter && DISCIPLINE_BY_PRODUCED_AT[letter]) || DEFAULT_DISCIPLINE;
}

/**
 * Calculates patents yielded from research points incorporating CTO science skill.
 * Multiplier formula: points * (1 + ctoScience / 100)
 * Base conversion: 50 effective points per patent.
 */
export function calculatePatentsFromPoints(points: number, ctoScience: number = 0): number {
  if (!Number.isFinite(points) || points <= 0) {
    return 0;
  }
  const safeCtoScience = Math.max(0, Number.isFinite(ctoScience) ? ctoScience : 0);
  const effectivePoints = points * (1 + safeCtoScience / 100);
  return Math.floor(effectivePoints / BASE_POINTS_PER_PATENT);
}
