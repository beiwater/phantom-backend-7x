/**
 * Executive use-case input contracts (moved verbatim from the legacy
 * game/executives.ts engine during the #179 vertical migration).
 */

export interface UpdateExecutiveInput {
  salary?: number;
  position?: string;
  strikeUntil?: string | null;
  plansToRetire?: boolean;
  rushSettle?: boolean;
}

export interface CreatePoachingOfferInput {
  slotPosition?: string;
  skillPosition?: string;
  agency?: number | string;
  targetExecutiveId?: number;
  targetCompanyId?: number;
  expectedSalary?: number;
  ageRange?: unknown;
  hasTrainings?: boolean;
  onlyUnemployed?: boolean;
}

export interface CounterHostileOfferInput {
  salary?: number;
  action?: 'counter' | 'accept' | 'decline';
  accept?: boolean;
}
