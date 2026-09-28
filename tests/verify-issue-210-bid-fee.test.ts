import assert from 'node:assert/strict';
import { createGameContext } from '../server/context/game-context.ts';
import { db } from '../server/db/database.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { marketTradeRepository } from '../server/repositories/market-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { placeBuyOrder, sellToBids } from '../server/application/market/buy-orders.ts';

async function verifyBidSideExchangeFee() {
  const buyer = registerPlayer(`issue210-buyer-${Date.now()}@test.local`, 'password123', `Issue 210 buyer ${Date.now()}`);
  const seller = registerPlayer(`issue210-seller-${Date.now()}@test.local`, 'password123', `Issue 210 seller ${Date.now()}`);
  const buyerCtx = createGameContext(buyer.companyId, buyer.playerId);
  const sellerCtx = createGameContext(seller.companyId, seller.playerId);
  const kind = 3;
  const quality = 0;
  const price = 2.55;

  const bid = await placeBuyOrder(buyerCtx, { kind, quality, quantity: 1, price });
  warehouseRepository.addResource(seller.companyId, kind, quality, 1, { market: 1 });
  const moneyBeforeSale = companyRepository.findById(seller.companyId)?.money;

  const result = await sellToBids(sellerCtx, { resource: kind, quality, quantity: 1 });
  const trade = db.prepare(`
    SELECT fee FROM market_trades WHERE buyer_id = ? AND seller_id = ? AND kind = ? AND quality = ?
    ORDER BY id DESC LIMIT 1
  `).get(buyer.companyId, seller.companyId, kind, quality) as { fee: number } | undefined;

  assert.equal(result.filledBids[0]?.orderId, bid.id);
  assert.equal(trade?.fee, 1, 'Bid fills use the canonical ceil(2.55 × 4%) fee of $1');
  assert.equal(result.moneyDelta, 1.55, 'Seller receives gross proceeds less the canonical fee');
  assert.equal(companyRepository.findById(seller.companyId)?.money, Number(moneyBeforeSale) + 1.55);
}

verifyBidSideExchangeFee().then(() => {
  console.log('Issue #210 bid-side exchange fee regression passed');
}).catch(error => {
  console.error('Issue #210 bid-side exchange fee regression failed:', error);
  process.exitCode = 1;
});
