import { expect, test } from '@playwright/test';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { attachDiagnostics, type DiagnosticsController } from './support/diagnostics.ts';
import {
  ALL_BUILDING_KINDS,
  BUILDING_PARTITIONS,
  PRODUCTION_KINDS,
  SALES_KINDS,
  SEASONAL_KINDS,
  apiJson,
  assertHealthyBuildingPage,
  assertHealthyBuildingPages,
  createIsolatedAccount,
  openBuildingFromMapOrRoute,
  password,
  signIn,
  startGenericSale,
  startLaunch,
  startProduction,
  startRestaurantSales,
  startSalesOfficeContract,
  type Building,
  type ResourceDefinition,
} from './support/building-matrix-helpers.ts';

test.setTimeout(600_000);

async function assertInProgressState(
  page: Page,
  productionBuildings: Building[],
  genericSalesBuildings: Building[],
  salesOffice?: Building,
  restaurant?: Building,
  launchpad?: Building,
): Promise<void> {
  for (const building of [...productionBuildings, ...(launchpad ? [launchpad] : [])]) {
    const queue = await apiJson<Array<{ finishes?: string }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${building.id}/queue/`,
    );
    expect(queue.status, `queue for ${building.kind}: ${queue.text}`).toBe(200);
    expect(queue.body.length, `${building.kind} must have an in-progress queue`).toBeGreaterThan(0);
  }

  for (const building of genericSalesBuildings) {
    const orders = await apiJson<Array<{ finishedAt?: string }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${building.id}/sales-orders/`,
    );
    expect(orders.status, `sales orders for ${building.kind}: ${orders.text}`).toBe(200);
    expect(orders.body.length, `${building.kind} must have an in-progress order`).toBeGreaterThan(0);
  }

  if (salesOffice) {
    const orders = await apiJson<SalesOfficeOrderDTO[]>(
      page,
      'GET',
      `/api/v2/companies/buildings/${salesOffice.id}/sales-orders/`,
    );
    expect(orders.status, `sales orders for ${salesOffice.kind}: ${orders.text}`).toBe(200);
    expect(orders.body.length, `${salesOffice.kind} must have an in-progress order`).toBeGreaterThan(0);
    expect(orders.body[0]).toMatchObject({
      resources: expect.any(Array),
      datetime: expect.any(String),
      qualityBonus: expect.any(Number),
      searchCost: expect.any(Number),
    });
  }

  if (restaurant) {
    const runs = await apiJson<Array<{ resolved?: boolean }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${restaurant.id}/restaurant-runs/`,
    );
    expect(runs.status, `restaurant runs: ${runs.text}`).toBe(200);
    expect(runs.body.some(run => run.resolved === false), 'restaurant must have an active run').toBe(true);
  }
}

async function assertCompletedState(
  page: Page,
  productionBuildings: Building[],
  genericSalesBuildings: Building[],
  salesOffice?: Building,
  restaurant?: Building,
  launchpad?: Building,
): Promise<void> {
  const state = await apiJson<{ virtualNow?: string }>(page, 'GET', '/api/v2/debug/state/');
  expect(state.status, `debug state: ${state.text}`).toBe(200);
  const virtualNow = Date.parse(state.body.virtualNow ?? '');
  expect(virtualNow).toBeGreaterThan(0);

  for (const building of [...productionBuildings, ...(launchpad ? [launchpad] : [])]) {
    const queue = await apiJson<Array<{ finishes?: string }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${building.id}/queue/`,
    );
    expect(queue.status, `completed queue for ${building.kind}: ${queue.text}`).toBe(200);
    expect(
      queue.body.some(item => Date.parse(item.finishes ?? '') <= virtualNow),
      `${building.kind} must expose a completed queue item`,
    ).toBe(true);
  }

  for (const building of genericSalesBuildings) {
    const orders = await apiJson<Array<{ finishedAt?: string }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${building.id}/sales-orders/`,
    );
    expect(orders.status, `completed sales orders for ${building.kind}: ${orders.text}`).toBe(200);
    expect(
      orders.body.some(order => Date.parse(order.finishedAt ?? '') <= virtualNow),
      `${building.kind} must expose a completed order`,
    ).toBe(true);
  }

  if (salesOffice) {
    const orders = await apiJson<SalesOfficeOrderDTO[]>(
      page,
      'GET',
      `/api/v2/companies/buildings/${salesOffice.id}/sales-orders/`,
    );
    expect(orders.status, `completed sales orders for ${salesOffice.kind}: ${orders.text}`).toBe(200);
    expect(
      orders.body.some(order => Date.parse(order.finishedAt ?? '') <= virtualNow),
      `${salesOffice.kind} must expose a completed order`,
    ).toBe(true);
    expect(orders.body[0]).toMatchObject({
      resources: expect.any(Array),
      datetime: expect.any(String),
      qualityBonus: expect.any(Number),
      searchCost: expect.any(Number),
    });
  }

  if (restaurant) {
    const runs = await apiJson<Array<{ resolved?: boolean }>>(
      page,
      'GET',
      `/api/v2/companies/buildings/${restaurant.id}/restaurant-runs/`,
    );
    expect(runs.status, `completed restaurant runs: ${runs.text}`).toBe(200);
    expect(runs.body.some(run => run.resolved === true), 'restaurant run must be resolved').toBe(true);
  }
}

interface PartitionSession {
  context: BrowserContext;
  page: Page;
  diagnostics: DiagnosticsController;
  buildings: Building[];
  productionBuildings: Building[];
  genericSalesBuildings: Building[];
  salesOffice?: Building;
  restaurant?: Building;
  launchpad?: Building;
}

async function writePageDiagnostics(
  diagnostics: DiagnosticsController,
  testInfo: TestInfo,
  partitionIndex: number,
): Promise<void> {
  await diagnostics.flush();
  await testInfo.attach(`browser-diagnostics-partition-${partitionIndex}.json`, {
    body: JSON.stringify(diagnostics.data, null, 2),
    contentType: 'application/json',
  });
}

function assertDiagnosticHealth(diagnostics: DiagnosticsController, partitionIndex: number): void {
  expect(diagnostics.data.pageErrors, `partition ${partitionIndex} page errors`).toEqual([]);
  expect(
    diagnostics.data.failedRequests.filter(request => request.localApi),
    `partition ${partitionIndex} failed local requests`,
  ).toEqual([]);
  expect(
    diagnostics.data.apiResponses.filter(response => response.status >= 500),
    `partition ${partitionIndex} local 5xx responses`,
  ).toEqual([]);
}

test('all canonical buildings survive production, sales, and completed-page flows', async ({ browser }, testInfo) => {
  const activeSessions: PartitionSession[] = [];
  const runPartition = async (
    partition: readonly string[],
    partitionIndex: number,
  ): Promise<PartitionSession> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const diagnostics = attachDiagnostics(page);
    try {
      const suffix = `${Date.now()}_${partitionIndex}_${Math.floor(Math.random() * 10_000)}`;
      const email = `dom_building_matrix_${suffix}@example.local`;
      const companyName = `BuildingMatrix${Date.now()}${partitionIndex}${Math.floor(Math.random() * 10_000)}`;
      await createIsolatedAccount(page, email, companyName);

      const fixture = await apiJson<{ fixture?: { buildingsCount?: number; warehouseRows?: number } }>(
        page,
        'POST',
        '/api/v2/debug/fixture/',
        {
          email,
          password,
          companyName,
          money: 100_000_000,
          simboosts: 50_000,
          level: 60,
          rating: 'AAA',
          realmId: 0,
          extraBuildingSlots: 60,
          clearExistingBuildings: true,
          clearExistingWarehouse: true,
          buildings: partition.map((kind, slot) => ({
            kind,
            size: 1,
            slot,
            ...(kind === 'M' || kind === 'O' || kind === 'Q' ? { abundance: 100 } : {}),
          })),
          warehouse: Array.from(
            { length: 155 },
            (_, index) => ({ kind: index + 1, quality: 0, amount: 100_000_000 }),
          ),
        },
      );
      expect(fixture.status, `partition ${partitionIndex} fixture response: ${fixture.text}`).toBe(200);
      expect(fixture.body.fixture).toMatchObject({ buildingsCount: partition.length, warehouseRows: 155 });
      await signIn(page, email);

      const buildingResponse = await apiJson<Building[]>(page, 'GET', '/api/v2/companies/me/buildings/');
      expect(buildingResponse.status).toBe(200);
      const buildings = buildingResponse.body;
      expect(buildings).toHaveLength(partition.length);
      expect(new Set(buildings.map(building => building.kind))).toEqual(new Set(partition));
      expect(buildings.filter(building => building.category === 'production')).toHaveLength(
        partition.filter(kind => PRODUCTION_KINDS.has(kind)).length,
      );
      expect(buildings.filter(building => building.category === 'sales')).toHaveLength(
        partition.filter(kind => SALES_KINDS.has(kind)).length,
      );

      const resourcesResponse = await apiJson<Record<string, ResourceDefinition>>(
        page,
        'GET',
        '/api/v2/constants/resources/',
      );
      expect(resourcesResponse.status).toBe(200);
      const resources = Object.values(resourcesResponse.body);
      const outputs = new Map<string, ResourceDefinition>();
      for (const building of buildings) {
        if (!PRODUCTION_KINDS.has(building.kind)) continue;
        const output = resources.find(resource => resource.producedAt === building.kind
          && Number(resource.producedPerHourRaw) > 0);
        expect(output, `missing canonical output for ${building.kind}`).toBeDefined();
        outputs.set(building.kind, output!);
      }
      const productionBuildings = buildings.filter(building => PRODUCTION_KINDS.has(building.kind));
      expect(outputs.size).toBe(productionBuildings.length);

      await openBuildingFromMapOrRoute(page, buildings[0]);

      for (const [index, building] of productionBuildings.entries()) {
        const bonusTarget = (index + partitionIndex) % 3 === 0
          ? 3
          : (index + partitionIndex) % 3 === 1 ? -3 : 0;
        await startProduction(page, building, outputs.get(building.kind)!, bonusTarget);
      }

      const genericSalesBuildings = buildings.filter(
        building => SALES_KINDS.has(building.kind) && building.kind !== 'B' && building.kind !== 'r',
      );
      for (const building of genericSalesBuildings) {
        expect(await startGenericSale(page, building), `${building.kind} must expose a retail form`).toBe(true);
      }

      const salesOffice = buildings.find(building => building.kind === 'B');
      if (salesOffice) await startSalesOfficeContract(page, salesOffice);

      const restaurant = buildings.find(building => building.kind === 'r');
      if (restaurant) await startRestaurantSales(page, restaurant);

      const launchpad = buildings.find(building => building.kind === 'l');
      if (launchpad) await startLaunch(page, launchpad);

      // Seasonal stores can be inactive for the current virtual date. If a
      // seasonal page exposes a live form, exercise it exactly like a normal
      // store; either way every seasonal renderer must remain healthy.
      for (const building of buildings.filter(entry => SEASONAL_KINDS.has(entry.kind))) {
        const exposed = await startGenericSale(page, building);
        if (!exposed) await assertHealthyBuildingPage(page, building);
      }
      await assertInProgressState(
        page,
        productionBuildings,
        genericSalesBuildings,
        salesOffice,
        restaurant,
        launchpad,
      );

      // Every partition reaches this barrier with durable queues and orders.
      // The shared time warp is issued only after Promise.all resolves.
      const session: PartitionSession = {
        context,
        page,
        diagnostics,
        buildings,
        productionBuildings,
        genericSalesBuildings,
        salesOffice,
        restaurant,
        launchpad,
      };
      activeSessions.push(session);
      return session;
    } catch (error) {
      await writePageDiagnostics(diagnostics, testInfo, partitionIndex).catch(() => undefined);
      await context.close().catch(() => undefined);
      throw error;
    }
  };
  let sessions: PartitionSession[];
  try {
    sessions = await Promise.all(
      BUILDING_PARTITIONS.map((partition, partitionIndex) => runPartition(partition, partitionIndex)),
    );
  } catch (error) {
    await Promise.all(activeSessions.map(async (session, partitionIndex) => {
      await writePageDiagnostics(session.diagnostics, testInfo, partitionIndex).catch(() => undefined);
      await session.context.close().catch(() => undefined);
    }));
    throw error;
  }
  try {
    const allBuildings = sessions.flatMap(session => session.buildings);
    expect(allBuildings).toHaveLength(ALL_BUILDING_KINDS.length);
    expect(new Set(allBuildings.map(building => building.kind))).toEqual(new Set(ALL_BUILDING_KINDS));
    expect(allBuildings.filter(building => building.category === 'production')).toHaveLength(PRODUCTION_KINDS.size);
    expect(allBuildings.filter(building => building.category === 'sales')).toHaveLength(SALES_KINDS.size);

    const warped = await apiJson(sessions[0].page, 'POST', '/api/v2/debug/time-warp/', {
      hours: 200,
      resolveCycles: true,
    });
    expect(warped.status, `time warp response: ${warped.text}`).toBe(200);
    const resolvedCycles = (warped.body as {
      resolvedCycles?: {
        completedProductions?: number;
        completedRetailOrders?: number;
        resolvedRestaurants?: number;
      } | null;
    }).resolvedCycles;
    const productionCount = sessions.reduce((count, session) => count + session.productionBuildings.length, 0);
    const retailOrderCount = sessions.reduce(
      (count, session) => count + session.genericSalesBuildings.length + (session.salesOffice ? 1 : 0),
      0,
    );
    const restaurantCount = sessions.filter(session => session.restaurant).length;
    expect(resolvedCycles?.completedProductions).toBeGreaterThanOrEqual(productionCount);
    expect(resolvedCycles?.completedRetailOrders).toBeGreaterThanOrEqual(retailOrderCount);
    expect(resolvedCycles?.resolvedRestaurants).toBeGreaterThanOrEqual(restaurantCount);

    await Promise.all(sessions.map(async (session, partitionIndex) => {
      await assertCompletedState(
        session.page,
        session.productionBuildings,
        session.genericSalesBuildings,
        session.salesOffice,
        session.restaurant,
        session.launchpad,
      );

      // Resolve the same matrix after production, retail, restaurant, and
      // launch queues have completed. This catches completion-only DTO paths.
      await session.page.goto(`/zh-cn/b/${session.buildings[0].id}/`);
      await assertHealthyBuildingPage(session.page, session.buildings[0]);
      await session.page.screenshot({
        path: testInfo.outputPath(`building-matrix-partition-${partitionIndex}-completed.png`),
        fullPage: false,
      });
      await assertHealthyBuildingPages(session.context, session.diagnostics, session.buildings);
    }));
  } finally {
    await Promise.all(sessions.map(async (session, partitionIndex) => {
      try {
        await writePageDiagnostics(session.diagnostics, testInfo, partitionIndex);
        assertDiagnosticHealth(session.diagnostics, partitionIndex);
      } finally {
        await session.context.close();
      }
    }));
  }
});
