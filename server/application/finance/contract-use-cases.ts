/**
 * Contract lifecycle application layer (Issue #179 vertical slice).
 * Command/query orchestration moved verbatim from game/contracts.ts
 * (Strangler rule: architecture migration does not rewrite economy rules).
 * Money moves go through CompanyRepository.updateMoney — the authoritative
 * signed mutation shared with the legacy engine (generic 'g' ledger row +
 * daily snapshot refresh, matching the old updateCompanyMoney defaults).
 */
import { virtualClock } from '../../core/virtual-clock.ts';
import type { GameContext } from '../../context/game-context.ts';
import { runInTransaction } from '../../db/transaction.ts';
import { contractRepository, type ContractRow } from '../../repositories/contract-repository.ts';
import { companyRepository } from '../../repositories/company-repository.ts';
import { consumeResourceExactWithTransactions, addResource, getWarehouseItemExact } from '../../game/warehouse.ts';
import { getResourceDef } from '../../game/constants.ts';

// --- DTO mapping ---------------------------------------------------------------

/** Legacy contract DTO shape (game/contracts.ts::formatContract), preserved as-is. */
export function formatContract(c: ContractRow) {
  const sender = companyRepository.findById(c.sender_company_id);
  const recipient = companyRepository.findById(c.recipient_company_id);
  const resDef = getResourceDef(c.kind);

  return {
    id: c.id,
    kind: c.kind,
    quality: c.quality,
    amount: c.amount,
    quantity: c.amount,
    price: c.price,
    total: Math.round(c.amount * c.price * 100) / 100,
    created: c.created_at,
    status: c.status,
    sender: {
      id: c.sender_company_id,
      company: sender?.name || `Company #${c.sender_company_id}`,
      logo: sender?.logo || ''
    },
    recipient: {
      id: c.recipient_company_id,
      company: recipient?.name || `Company #${c.recipient_company_id}`,
      logo: recipient?.logo || ''
    },
    resource: resDef ? {
      name: `Resource #${c.kind}`,
      image: resDef.image
    } : null
  };
}

// --- Contract queries ----------------------------------------------------------

export function getIncomingContracts(companyId: number) {
  return {
    incomingContracts: contractRepository.listIncomingRows(companyId).map(formatContract),
    incomingContractsOtherRealms: []
  };
}

export function getOutgoingContracts(companyId: number) {
  return contractRepository.listOutgoingRows(companyId).map(formatContract);
}

export function getContractHistory(companyId: number, direction: 'incoming' | 'outgoing') {
  return contractRepository.listHistoryRows(companyId, direction).map(formatContract);
}

export function getWarehouseContractsSummary(companyId: number) {
  return contractRepository.warehouseContractsSummaryRows(companyId);
}

// --- Contract commands ---------------------------------------------------------

export interface SendContractInput {
  buyerCompanyId: number;
  resourceKind: number;
  quality: number;
  amount: number;
  price: number;
}

export async function sendContractUseCase(ctx: GameContext, input: SendContractInput) {
  const senderCompanyId = ctx.companyId;
  const recipientCompanyId = input.buyerCompanyId;
  const kind = input.resourceKind;
  const quality = input.quality;
  const amount = input.amount;
  const price = input.price;

  if (senderCompanyId === recipientCompanyId) {
    throw new Error('Cannot send contract to yourself');
  }
  if (!companyRepository.findById(recipientCompanyId)) {
    throw new Error('Recipient company not found');
  }
  if (!Number.isSafeInteger(kind) || kind <= 0 || !Number.isInteger(quality) || quality < 0 || quality > 12 ||
      !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(price) || price < 0) {
    throw new Error('Invalid contract terms');
  }

  const stock = getWarehouseItemExact(senderCompanyId, kind, quality);
  if (!stock || stock.amount < amount) {
    throw new Error('Not enough resources in warehouse to send contract');
  }

  return runInTransaction(async () => {
    const consumed = consumeResourceExactWithTransactions(senderCompanyId, kind, quality, amount);
    if (!consumed) {
      throw new Error('Not enough resources in warehouse to send contract');
    }

    const now = virtualClock.nowIso();
    const contractId = contractRepository.insertPending(senderCompanyId, recipientCompanyId, kind, quality, amount, price, now);

    const row = contractRepository.findPendingById(contractId);
    if (!row) {
      throw new Error('Contract not found');
    }
    return formatContract(row);
  });
}

export async function acceptContractUseCase(ctx: GameContext, contractId: number) {
  const buyerCompanyId = ctx.companyId;
  const c = contractRepository.findPendingById(contractId);
  if (!c) {
    throw new Error('Contract is no longer available');
  }
  if (c.recipient_company_id !== buyerCompanyId) {
    throw new Error('Unauthorized to accept this contract');
  }

  const totalCost = Math.round(c.amount * c.price * 100) / 100;
  const buyer = companyRepository.findById(buyerCompanyId);
  if (!buyer || buyer.money < totalCost) {
    throw new Error('Not enough money to accept contract');
  }

  return runInTransaction(async () => {
    const accepted = contractRepository.markAccepted(contractId, buyerCompanyId);
    if (accepted !== 1) {
      throw new Error('Contract is no longer available');
    }

    const newBuyerMoney = companyRepository.updateMoney(buyerCompanyId, -totalCost);
    companyRepository.updateMoney(c.sender_company_id, totalCost);
    addResource(buyerCompanyId, c.kind, c.quality, c.amount, { market: c.price });

    return {
      success: true,
      money: newBuyerMoney,
      moneyDelta: -totalCost,
      resource: {
        kind: c.kind,
        quality: c.quality,
        amount: c.amount
      }
    };
  });
}

export async function rejectContractUseCase(ctx: GameContext, contractId: number) {
  return runInTransaction(async () => {
    const c = contractRepository.findPendingById(contractId);
    if (!c) {
      throw new Error('Contract not found');
    }
    if (c.recipient_company_id !== ctx.companyId && c.sender_company_id !== ctx.companyId) {
      throw new Error('Unauthorized');
    }

    const rejected = contractRepository.markRejected(contractId);
    if (rejected !== 1) {
      throw new Error('Contract is no longer available');
    }
    addResource(c.sender_company_id, c.kind, c.quality, c.amount);
    return { success: true };
  }, { immediate: true });
}

export async function cancelContractUseCase(ctx: GameContext, contractId: number) {
  return runInTransaction(async () => {
    const c = contractRepository.findPendingById(contractId);
    if (!c || c.sender_company_id !== ctx.companyId) {
      throw new Error('Contract not found');
    }

    const cancelled = contractRepository.markCancelled(contractId, ctx.companyId);
    if (cancelled !== 1) {
      throw new Error('Contract is no longer available');
    }
    addResource(ctx.companyId, c.kind, c.quality, c.amount);
    return { success: true };
  }, { immediate: true });
}
