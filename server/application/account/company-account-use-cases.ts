import { runInTransaction } from '../../db/transaction.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import type { CompanyEntity } from '../../repositories/company-repository.ts';
import {
  companyRealmRepository,
  type CompanyRealmMigrationResult
} from '../../repositories/company-realm-repository.ts';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../errors/domain-error.ts';
const REALM_ZERO = 0;
const LEGACY_REALM = 1;
const MAX_REALM_ZERO_SELECTOR_COMPANIES = 2;
const COMPANY_NAME_MIN_LENGTH = 4;
const COMPANY_NAME_MAX_LENGTH = 64;

function normalizeCompanyName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (name.length < COMPANY_NAME_MIN_LENGTH) {
    throw new ValidationError('Try a longer company name, this is too short');
  }
  if (name.length > COMPANY_NAME_MAX_LENGTH) {
    throw new ValidationError(`Company name must be at most ${COMPANY_NAME_MAX_LENGTH} characters`);
  }
  if (!/^[a-zA-Z0-9 .]+$/.test(name)) {
    throw new ValidationError('Please use only letters, numbers, or dots');
  }
  return name;
}

/**
 * Company creation from the local same-login selector is deliberately separate
 * from the official realm-create endpoint. The official endpoint accepts a
 * realm index; this flow always creates a new company in realm 0 and never a
 * new player identity.
 */
export function createRealmZeroCompanyUseCase(playerId: number, rawName: unknown): CompanyEntity {
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    throw new ValidationError('A valid player session is required');
  }
  const name = normalizeCompanyName(rawName);
  if (companyRepository.findByName(name)) {
    throw new ConflictError('Company name already taken');
  }
  return companyRepository.createCompany(
    playerId,
    name,
    REALM_ZERO,
    MAX_REALM_ZERO_SELECTOR_COMPANIES
  );
}

/**
 * Move one explicitly selected, authenticated player's legacy realm-1 company
 * to realm 0. Only company-owned realm columns are rewritten; global realm
 * rows (economy phases, realm catalogs and shared market/chat state) remain
 * untouched. The repository performs all row updates under the caller's
 * transaction, preserving company/player IDs and company-scoped assets.
 */
export async function migrateOwnedCompanyToRealmZeroUseCase(
  playerId: number,
  companyId: number,
  confirmed: boolean
): Promise<CompanyRealmMigrationResult> {
  if (!Number.isSafeInteger(playerId) || playerId <= 0) {
    throw new ValidationError('A valid player session is required');
  }
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new ValidationError('A valid companyId is required');
  }
  if (!confirmed) {
    throw new ValidationError('Explicit confirmation is required to move this company to realm 0');
  }

  return runInTransaction(() => {
    const company = companyRepository.findById(companyId);
    if (!company) {
      throw new NotFoundError('Company not found');
    }
    if (company.playerId !== playerId) {
      throw new ForbiddenError('Company does not belong to the authenticated player');
    }
    if (company.realmId === REALM_ZERO) {
      return {
        company,
        fromRealmId: REALM_ZERO,
        toRealmId: REALM_ZERO,
        updatedRows: {}
      };
    }
    if (company.realmId !== LEGACY_REALM) {
      throw new ConflictError(
        `Only an explicitly selected realm 1 company can be moved to realm 0; this company is in realm ${company.realmId}`
      );
    }

    const blockers = companyRealmRepository.listRealmMigrationBlockers(companyId);
    if (blockers.length > 0) {
      throw new ConflictError(
        'Move blocked while this company has active realm-sensitive obligations',
        { blockers }
      );
    }

    return companyRealmRepository.migrateOwnedRealm(companyId, playerId, LEGACY_REALM, REALM_ZERO);
  }, { immediate: true });
}
