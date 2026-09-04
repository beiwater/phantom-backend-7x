import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
const RESOURCE_NAMES: Record<string, string> = {
  '1': 'Power',
  '2': 'Water',
  '3': 'Apples',
  '4': 'Oranges',
  '5': 'Grapes',
  '6': 'Grain',
  '7': 'Steak',
  '8': 'Sausages',
  '9': 'Eggs',
  '10': 'Crude Oil',
  '11': 'Petrol',
  '12': 'Diesel',
  '13': 'Transport',
  '14': 'Minerals',
  '15': 'Bauxite',
  '16': 'Silicon',
  '17': 'Chemicals',
  '18': 'Aluminium',
  '19': 'Plastic',
  '20': 'Processors',
  '21': 'Electronic Components',
  '22': 'Batteries',
  '23': 'Displays',
  '24': 'Smart Phones',
  '25': 'Tablets',
  '26': 'Laptops',
  '27': 'Monitors',
  '28': 'Televisions',
  '29': 'Plant Research',
  '30': 'Energy Research',
  '31': 'Mining Research',
  '32': 'Electronics Research',
  '33': 'Breeding Research',
  '34': 'Chemistry Research',
  '35': 'Software',
  '40': 'Cotton',
  '41': 'Fabric',
  '42': 'Iron Ore',
  '43': 'Steel',
  '44': 'Sand',
  '45': 'Glass',
  '46': 'Leather',
  '47': 'On Board Computer',
  '48': 'Electric Motor',
  '49': 'Luxury Car Interior',
  '50': 'Car Interior',
  '51': 'Car Body',
  '52': 'Combustion Engine',
  '53': 'Economy E Car',
  '54': 'Luxury E Car',
  '55': 'Economy Car',
  '56': 'Luxury Car',
  '57': 'Truck',
  '58': 'Automotive Research',
  '59': 'Fashion Research',
  '60': 'Underwear',
  '61': 'Gloves',
  '62': 'Dress',
  '63': 'Simmi Shoes',
  '64': 'Handbags',
  '65': 'Sneakers',
  '66': 'Seeds',
  '67': 'Xmas Crackers',
  '68': 'Gold Ore',
  '69': 'Golden Bars',
  '70': 'Gold Watch',
  '71': 'Necklace',
  '72': 'Sugarcane',
  '73': 'Ethanol',
  '74': 'Methane',
  '75': 'Carbon Fiber',
  '76': 'Carbon Composite',
  '77': 'Fuselage',
  '78': 'Wing',
  '79': 'High Grade E Components',
  '80': 'Flight Computer',
  '81': 'Cockpit',
  '82': 'Attitude Control',
  '83': 'Rocket Fuel',
  '84': 'Fuel Tank',
  '85': 'Solid Rocket',
  '86': 'Rocket Engine',
  '87': 'Heat Shield',
  '88': 'Ion Drive',
  '89': 'Jet Engine',
  '90': 'Sub Orbital Second Stage',
  '91': 'Sub Orbital Rocket2',
  '92': 'Orbital Booster',
  '93': 'Starship',
  '94': 'BFR',
  '95': 'Jumbojet2',
  '96': 'Private Jet',
  '97': 'Single Engine',
  '98': 'Quadcopter',
  '99': 'Satellite',
  '100': 'Aero Research',
  '101': 'Reinforced Concrete',
  '102': 'Bricks',
  '103': 'Cement',
  '104': 'Clay',
  '105': 'Limestone',
  '106': 'Wood',
  '107': 'Steel Beams',
  '108': 'Planks',
  '109': 'Windows',
  '110': 'Tools',
  '111': 'Construction Units',
  '112': 'Bulldozer',
  '113': 'Materials Research',
  '114': 'Robots',
  '115': 'Cow',
  '116': 'Pig',
  '117': 'Milk',
  '118': 'Coffee Beans',
  '119': 'Coffee Ground',
  '120': 'Vegetables',
  '121': 'Bread',
  '122': 'Cheese',
  '123': 'Apple Pie',
  '124': 'Orange Juice',
  '125': 'Apple Cider',
  '126': 'Ginger Beer',
  '127': 'Pizza',
  '128': 'Pasta',
  '129': 'Hamburger',
  '130': 'Lasagna',
  '131': 'Meatballs',
  '132': 'Cocktails',
  '133': 'Flour',
  '134': 'Butter',
  '135': 'Sugar',
  '136': 'Cocoa Beans',
  '137': 'Dough',
  '138': 'Gravy Boat',
  '139': 'Fodder',
  '140': 'Chocolate',
  '141': 'Vegetable Oil',
  '142': 'Salad',
  '143': 'Samosas',
  '144': 'Xmas Ornament',
  '145': 'Recipes',
  '146': 'Pumpkin',
  '147': 'Jack O Lantern',
  '148': 'Witch Costume',
  '149': 'Pumpkin Soup',
  '150': 'Tree',
  '151': 'Easter Bunny',
  '152': 'Ramadan Sweets',
  '153': 'Icecream Chocolate',
  '154': 'Icecream Apple',
  '155': 'Cream Egg'
};

export interface AccumulatorResourceMechanic {
  type: 'accumulator';
  accumulatorParameters?: {
    baseValue: number;
    max: number;
    amountPerLevel: number;
    bonusPerQuality: number;
  };
}

export interface ResourceDef {
  dbLetter: number;
  producedAt?: string;
  producedFrom?: Record<string, number>;
  producedPerHourRaw?: number;
  image: string;
  transportation: number;
  isExchangeTradable: boolean;
  unitsSoldAnHour?: number;
  isResearch?: boolean;
  decay?: number;
  productionMechanic?: AccumulatorResourceMechanic;
}

const resourcesPath = path.join(CONFIG.CONSTANTS_DIR, 'resources.json');
export const CANONICAL_RESOURCES: Record<string, ResourceDef> = JSON.parse(
  fs.readFileSync(resourcesPath, 'utf-8')
);

export function getResourceDef(kind: number | string): ResourceDef | undefined {
  return CANONICAL_RESOURCES[String(kind)];
}

export function getResourceName(kind: number | string): string {
  const key = String(kind);
  return RESOURCE_NAMES[key] || `Resource #${key}`;
}

export function isResourceExchangeTradable(kind: number | string): boolean {
  const def = getResourceDef(kind);
  return def ? def.isExchangeTradable !== false : false;
}

export function getAllResourceDefs(): Record<string, ResourceDef> {
  return CANONICAL_RESOURCES;
}
