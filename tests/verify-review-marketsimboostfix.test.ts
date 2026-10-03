import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '../server/db/connection.ts';
import { registerPlayer } from '../server/db/seed/index.ts';
import { createGameContext } from '../server/context/game-context.ts';
import { companyRepository } from '../server/repositories/company-repository.ts';
import { warehouseRepository } from '../server/repositories/warehouse-repository.ts';
import { marketRepository, marketTradeRepository } from '../server/repositories/market-repository.ts';
import { placeBuyOrder, cancelBuyOrder, sellToBids } from '../server/application/market/buy-orders.ts';
import { cancelMarketOrder } from '../server/application/market/cancel-order.ts';
import { takeMarketOrder } from '../server/application/market/take-order.ts';
import { purchasePaymentPackage, realignProductionSalesBonus, getCompanyBonusModifiers } from '../server/game/simboosts.ts';
import { realignCost } from '../server/game/simboost-settings.ts';
import { unlockHq } from '../server/application/social/unlockables.ts';
import { withdrawBid } from '../server/game/building-auctions.ts';
import { handleSimboostRoutes } from '../server/routes/simboost-routes.ts';
import { setPreparsedBody } from '../server/routes/utils.ts';

async function main() {
  const buyer = registerPlayer('review-buyer@test.local', 'password123', 'Review Buyer');
  const seller = registerPlayer('review-seller@test.local', 'password123', 'Review Seller');
  const buyerCtx = createGameContext(buyer.companyId, buyer.playerId);
  const sellerCtx = createGameContext(seller.companyId, seller.playerId);
  db.prepare('UPDATE market_orders SET active = 0').run();
  const starting = companyRepository.findById(buyer.companyId)!.money;
  const bid = await placeBuyOrder(buyerCtx, { kind: 24, quality: 12, quantity: 1000000, price: 1e-12 });
  const beforeStock = warehouseRepository.findByCompanyAndResource(buyer.companyId, 24, 12)?.amount ?? 0;
  await assert.rejects(cancelMarketOrder(buyerCtx, bid.id));
  assert.equal(warehouseRepository.findByCompanyAndResource(buyer.companyId, 24, 12)?.amount ?? 0, beforeStock);
  assert.equal(marketRepository.findById(bid.id), null);
  assert.equal(marketRepository.findFillableAsks(24, 1, 0).length, 0);
  assert.equal(marketRepository.findActiveSellOrdersForBook(0, 24).length, 0);
  assert.equal(marketRepository.findLowestActivePrice(24, 0), null);
  assert.equal(marketRepository.deactivateOwnedActiveOrder(bid.id, buyer.companyId), false);
  await cancelBuyOrder(buyerCtx, bid.id);
  assert.equal(companyRepository.findById(buyer.companyId)!.money, starting);
  console.log('PASS 1: bids cannot mint inventory or enter ask books');

  const refundBid = await placeBuyOrder(buyerCtx, { kind: 1, quantity: 2, price: 3 });
  const refund = await cancelBuyOrder(buyerCtx, refundBid.id);
  assert.equal(refund.moneyDelta, 6);
  assert.equal(refund.money, starting);
  console.log('PASS 2: buy cancellation refunds escrow with ledger category');

  warehouseRepository.addResource(seller.companyId, 1, 0, 4, { market: 0.005 });
  const centsBid = await placeBuyOrder(buyerCtx, { kind: 1, quantity: 2, price: 0.005 });
  const sellerBefore = companyRepository.findById(seller.companyId)!.money;
  const first = await sellToBids(sellerCtx, { resource: 1, quantity: 1 });
  const second = await sellToBids(sellerCtx, { resource: 1, quantity: 1 });
  assert.equal(first.moneyDelta + second.moneyDelta, 0.01);
  assert.ok(Math.abs(companyRepository.findById(seller.companyId)!.money - sellerBefore - 0.01) < 1e-8);
  assert.equal(marketTradeRepository.findActiveBuyOrder(centsBid.id), undefined);
  const partialBid = await placeBuyOrder(buyerCtx, { kind: 1, quantity: 2, price: 0.005 });
  const partial = await sellToBids(sellerCtx, { resource: 1, quantity: 1 });
  const remainder = await cancelBuyOrder(buyerCtx, partialBid.id);
  assert.equal(partial.moneyDelta + remainder.moneyDelta, 0.01);
  console.log('PASS 3: partial bid payouts and refunds conserve rounded escrow');

  const ask = marketRepository.insert({ sellerId: seller.companyId, kind: 1, quality: 0, quantity: 1, price: 0.2, postedAt: new Date().toISOString(), costWorkers: 0, costAdmin: 0, costMaterial1: 0, costMaterial2: 0, costMarket: 0.2 });
  const small = await takeMarketOrder(buyerCtx, { resource: 1, quantity: 1, maxPrice: 0.2 });
  assert.equal(small.amountBought, 1);
  assert.equal(marketRepository.findById(ask.id)!.active, false);
  console.log('PASS 4: sub-dollar asks settle without negative credit');

  db.prepare('UPDATE companies SET money = 10 WHERE company_id = ?').run(buyer.companyId);
  marketRepository.insert({ sellerId: seller.companyId, kind: 1, quality: 0, quantity: 100, price: 1, postedAt: new Date().toISOString(), costWorkers: 0, costAdmin: 0, costMaterial1: 0, costMaterial2: 0, costMarket: 1 });
  const markerRow = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM cash_ledger').get();
  assert.ok(markerRow && typeof markerRow.id === 'number');
  const ledgerMarker = markerRow.id;
  const beforeSale = companyRepository.findById(seller.companyId)!.money;
  const affordable = await takeMarketOrder(buyerCtx, { resource: 1, quantity: 100, maxPrice: 1 });
  assert.equal(affordable.amountBought, 10);
  assert.equal(affordable.money, 0);
  const cashDelta = companyRepository.findById(seller.companyId)!.money - beforeSale;
  const journal = db.prepare('SELECT SUM(amount) AS total FROM cash_ledger WHERE company_id = ? AND id > ?').get(seller.companyId, ledgerMarker) as { total: number };
  assert.ok(Math.abs(cashDelta - journal.total) < 1e-8);
  console.log('PASS 5–6: affordable partial fills and gross-plus-fee journal');

  for (const production of [0.5, NaN, Infinity, -4, 4, 'invalid']) {
    const req = {} as IncomingMessage;
    setPreparsedBody(req, { production });
    let status = 200;
    const res = { writeHead(code: number) { status = code; }, setHeader() {}, getHeader() { return undefined; }, end() {} } as unknown as ServerResponse;
    await handleSimboostRoutes(req, res, '/api/v2/companies/me/bonus/', 'POST', buyer.playerId, buyer.companyId);
    assert.equal(status, 400);
  }
  assert.throws(() => realignCost(0, 0, 0.5));
  console.log('PASS 7: invalid bonus targets reject before cost loops');

  db.prepare('UPDATE companies SET simboosts = 1000 WHERE company_id = ?').run(buyer.companyId);
  const results = await Promise.all([realignProductionSalesBonus(buyer.companyId, 1), realignProductionSalesBonus(buyer.companyId, 1)]);
  assert.equal(getCompanyBonusModifiers(buyer.companyId).productionModifier, 1);
  assert.equal(results[1].cost, 0);
  assert.equal(companyRepository.findById(buyer.companyId)!.simboosts, 900);
  console.log('PASS 8: repeated absolute bonus target charges once');

  const purchases = await Promise.all([purchasePaymentPackage(buyer.companyId, 'sb-sb330'), purchasePaymentPackage(buyer.companyId, 'sb-sb330')]);
  assert.equal(purchases[0], purchases[1]);
  assert.equal(companyRepository.findById(buyer.companyId)!.simboosts, 1230);
  console.log('PASS 9: overlapping package purchases grant once');
  await Promise.all([unlockHq(buyer.companyId, 1), unlockHq(buyer.companyId, 1)]);
  assert.equal(companyRepository.findById(buyer.companyId)!.simboosts, 1130);
  assert.throws(() => withdrawBid(buyer.companyId, 999999), /not found/);
  console.log('PASS 10–11: HQ unlock charges once and missing withdrawal throws');
  console.log('PASS review marketsimboostfix regression suite');
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
