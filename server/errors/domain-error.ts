export class DomainError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode: number = 400, code: string = 'DOMAIN_ERROR', details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string = 'Entity not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class InsufficientFundsError extends DomainError {
  constructor(message: string = 'Insufficient funds') {
    super(message, 400, 'INSUFFICIENT_FUNDS');
  }
}

export class InsufficientInventoryError extends DomainError {
  constructor(message: string = 'Insufficient inventory') {
    super(message, 400, 'INSUFFICIENT_INVENTORY');
  }
}

export class InvariantViolationError extends DomainError {
  constructor(message: string = 'Invariant violation') {
    super(message, 400, 'INVARIANT_VIOLATION');
  }
}

/**
 * Issue #94: demolishing (or scrapping) a building would push the company's
 * remaining building valuation below the 80% bond-collateral floor relative
 * to its outstanding bond liability. Serialized as 400 with
 * code 'BOND_COLLATERAL_VIOLATION'.
 */
export class BondCollateralViolationError extends DomainError {
  constructor(message: string = 'Demolition would leave building value below the bond collateral floor', details?: unknown) {
    super(message, 400, 'BOND_COLLATERAL_VIOLATION', details);
  }
}

/**
 * Issue #85: a company must not fill its own (or its owner player's)
 * resting exchange order. Serialized as 400 with code
 * 'SELF_TRADE_PROHIBITED' (contract asserted by verify-issue-85).
 */
export class SelfTradeProhibitedError extends DomainError {
  constructor(message: string = 'Cannot purchase your own market order') {
    super(message, 400, 'SELF_TRADE_PROHIBITED');
  }
}
