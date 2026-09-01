import { CANONICAL_BUILDINGS } from '../game-data/buildings.ts';
import { getResourceDef } from '../game-data/resources.ts';
import type { BuildingEntity } from '../repositories/building-repository.ts';
import { DomainError } from '../errors/domain-error.ts';

/**
 * Issue #96 — Robotics & specialization (decompiled robotics guide).
 *
 * Installing industrial robots on a production building:
 *  - consumes `ceil(robotUnits(building) * size)` robots (resource kind 114)
 *    from the company warehouse at a minimum quality of `floor(size / 4)`;
 *  - locks the building to a single specialized product;
 *  - reduces worker wages by 3% (wageMultiplier 0.97);
 *  - blocks upgrades/downgrades while robots are installed;
 *  - is reversible: uninstalling returns 50% of the installed robots to the
 *    warehouse at quality 0.
 */

/** Warehouse resource kind of industrial robots (dbLetter 114). */
export const ROBOT_RESOURCE_KIND = 114;

/** Canonical unit cost of one robot (`ROBOT_COST`, chunk_oX.js:4855). */
export const ROBOT_UNIT_COST = 940;

/** Wage multiplier applied to a robotized building (3% wage reduction). */
export const ROBOTICS_WAGE_MULTIPLIER = 0.97;

/** Share of installed robots returned to the warehouse at quality 0 on uninstall. */
export const ROBOTICS_UNINSTALL_RETURN_RATIO = 0.5;

/** Error thrown when structural work is attempted on a robotized building. */
export class RoboticsLockedError extends DomainError {
  constructor(message: string = "You can't upgrade or downgrade with robots installed.") {
    super(message, 400, 'ROBOTICS_LOCKED');
  }
}

/** Error thrown when production of a non-locked product is attempted on a robotized building. */
export class RoboticsSpecializationError extends DomainError {
  constructor(message: string) {
    super(message, 400, 'ROBOTICS_SPECIALIZED');
  }
}

/**
 * Robot units required per building size unit (decompiled `J9`, chunk_lg_2.js:22-25):
 *
 *   raw = salaryModifier * (345 * 24 * 7 * 5 * 0.03) / ROBOT_UNIT_COST
 *       = salaryModifier * 8694 / 940
 *   robotUnits = max(1, ceil(raw + (raw - 4.5) * 1.2))
 */
export function robotUnits(buildingKind: string): number {
  const salaryModifier = Number(CANONICAL_BUILDINGS[buildingKind]?.salaryModifier ?? 0);
  const raw = (salaryModifier * (345 * 24 * 7 * 5 * 0.03)) / ROBOT_UNIT_COST;
  return Math.max(1, Math.ceil(raw + (raw - 4.5) * 1.2));
}

/** Required robot count for a robotization: `ceil(robotUnits(building) * size)`. */
export function requiredRobotCount(buildingKind: string, size: number): number {
  return Math.max(1, Math.ceil(robotUnits(buildingKind) * size));
}

/** Required robot quality for a robotization: `floor(size / 4)`. */
export function requiredRobotQuality(size: number): number {
  return Math.max(0, Math.floor(size / 4));
}

/** Robots returned to the warehouse (at quality 0) when uninstalling: 50% of installed. */
export function uninstallRobotReturnCount(installedRobots: number): number {
  return Math.max(0, Math.floor(installedRobots * ROBOTICS_UNINSTALL_RETURN_RATIO));
}

/** True when the building currently has robots installed. */
export function hasRobotsInstalled(building: Pick<BuildingEntity, 'robotsInstalled'>): boolean {
  return Number(building.robotsInstalled) > 0;
}

/** Effective wage multiplier for a building: 0.97 when robotized, 1 otherwise. */
export function effectiveWageMultiplier(building: Pick<BuildingEntity, 'robotsInstalled'>): number {
  return hasRobotsInstalled(building) ? ROBOTICS_WAGE_MULTIPLIER : 1;
}

/**
 * Guard for structural work (upgrade/downgrade): a robotized building cannot
 * change size until the robots are uninstalled.
 */
export function assertNotRoboticsLocked(
  building: Pick<BuildingEntity, 'robotsInstalled' | 'id'>
): void {
  if (hasRobotsInstalled(building)) {
    throw new RoboticsLockedError(
      `Building ${building.id} has robots installed and cannot be upgraded or downgraded`
    );
  }
}

/**
 * Guard for production: a robotized building only accepts orders for the
 * product it was specialized to at installation time.
 */
export function assertAllowedProduct(
  building: Pick<BuildingEntity, 'robotsInstalled' | 'lockedProduct' | 'id'>,
  resourceKind: number
): void {
  if (!hasRobotsInstalled(building)) return;
  if (Number(building.lockedProduct) === Number(resourceKind)) return;
  throw new RoboticsSpecializationError(
    `Building ${building.id} is robotized and specialized to product ${building.lockedProduct}; ` +
    `cannot produce ${resourceKind}`
  );
}

/** Validate that a product can be locked as the building's specialization. */
export function assertSpecializableProduct(buildingKind: string, resourceKind: number): void {
  const def = getResourceDef(resourceKind);
  if (!def || !def.producedAt || def.producedAt !== buildingKind) {
    throw new DomainError(
      `Resource ${resourceKind} cannot be produced in building type '${buildingKind}'`,
      400,
      'ROBOTICS_INVALID_PRODUCT'
    );
  }
}
