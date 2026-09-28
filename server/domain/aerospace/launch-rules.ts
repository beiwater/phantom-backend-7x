// Existing launch rules; IO and transaction boundaries are in application.
export const LAUNCH_QUEUE_MAX = 30;

export function rocketKindForLaunchAmount(amount: number): number | null {
  for (const config of Object.values(ROCKET_CONFIGS)) {
    if (config.researchCost === amount) return config.kind;
  }
  return null;
}

export function rocketKindForLaunchRequest(resourceKind: number, amount: number): number | null {
  if (ROCKET_CONFIGS[resourceKind] && amount === 1) return resourceKind;
  return resourceKind === 100 ? rocketKindForLaunchAmount(amount) : null;
}

export interface RocketLaunchOutcome {
  success: boolean;
  message: string;
  patentsEarned: number;
}

export function computeRocketLaunchOutcome(rocketKind: number, quality: number, random: number): RocketLaunchOutcome {
  const success = random >= 0.5 / Math.pow(2, quality);
  return {
    success,
    message: success ? 'Rocket launched successfully!'
      : 'Rapid Unscheduled Disassembly (Rocket explosion on launchpad)',
    patentsEarned: success ? (rocketKind === 94 ? 28 : 4) : 0
  };
}

export interface RocketConfig {
  kind: number;
  name: string;
  minLevel: number;
  researchCost: number; // units of Aerospace Research (resource kind 100)
}

export const ROCKET_CONFIGS: Record<number, RocketConfig> = {
  91: {
    kind: 91,
    name: 'Sub-Orbital Rocket',
    minLevel: 1,
    researchCost: 400
  },
  94: {
    kind: 94,
    name: 'BFR',
    minLevel: 3,
    researchCost: 2800
  }
};

export interface QueuedLaunchItem {
  id: number;
  buildingId: number;
  companyId: number;
  rocketKind: number;
  quality: number;
  status: string;
  started: string;
  finishes: string;
  finishes_at: string;
  duration: number;
  createdAt: string;
}

export function calculateLaunchDurationSeconds(level: number, productionModifier: number = 0): number {
  const safeLevel = Math.max(1, level);
  const baseTimeSeconds = (128 * 3600) / (1 + (productionModifier / 100));
  const effectiveTimeSeconds = baseTimeSeconds / Math.pow(2, safeLevel - 1);
  return Math.round(effectiveTimeSeconds);
}

export interface QueueRocketLaunchOptions {
  consumeResearch?: boolean;
}
