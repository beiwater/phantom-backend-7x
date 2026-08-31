export interface StartingConditions {
  money: number;
  simboosts: number;
  level: number;
}

export interface ChallengePolicy {
  enabled: boolean;
  title?: string;
  ruleset?: string;
  durationDays?: number;
}

export interface RealmRules {
  realmId: number;
  name: string;
  exchangeEnabled: boolean;
  contractsEnabled: boolean;
  bondsEnabled: boolean;
  resourcePurchaseLimits?: Record<number, number>;
  startingConditions: StartingConditions;
  challenge?: ChallengePolicy;
}

export const DEFAULT_REALM_RULES: RealmRules = {
  realmId: 0,
  name: 'Magnates Realm',
  exchangeEnabled: true,
  contractsEnabled: true,
  bondsEnabled: true,
  startingConditions: {
    money: 100000,
    simboosts: 250,
    level: 5
  },
  challenge: {
    enabled: false
  }
};

export const CHALLENGE_REALM_RULES: RealmRules = {
  realmId: 1,
  name: 'Challenge Realm (Speedrun)',
  exchangeEnabled: false,
  contractsEnabled: false,
  bondsEnabled: false,
  resourcePurchaseLimits: {
    1: 50000,  // Water purchase limit
    2: 50000,  // Power purchase limit
    3: 10000   // Apples purchase limit
  },
  startingConditions: {
    money: 50000,
    simboosts: 100,
    level: 1
  },
  challenge: {
    enabled: true,
    title: 'Self-Sufficient Industry Challenge',
    ruleset: 'no-market-no-contracts',
    durationDays: 14
  }
};

export function getRealmRules(realmId: number): RealmRules {
  if (realmId === 1) {
    return CHALLENGE_REALM_RULES;
  }
  return {
    ...DEFAULT_REALM_RULES,
    realmId
  };
}

export function isExchangeAllowed(rules: RealmRules): boolean {
  return rules.exchangeEnabled;
}

export function isContractsAllowed(rules: RealmRules): boolean {
  return rules.contractsEnabled;
}

export function isBondsAllowed(rules: RealmRules): boolean {
  return rules.bondsEnabled;
}

export function getResourcePurchaseLimit(rules: RealmRules, resourceKind: number): number | undefined {
  return rules.resourcePurchaseLimits?.[resourceKind];
}
