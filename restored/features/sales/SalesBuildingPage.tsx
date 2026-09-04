/**
 * Main Sales Building Page
 * Routes to GenericRetailBuilding, SalesOfficeBuilding, or RestaurantBuilding
 */

import React from 'react';
import { useSalesBuilding } from './useSalesBuilding.ts';
import { GenericRetailBuilding } from './GenericRetailBuilding.tsx';
import { SalesOfficeBuilding } from './SalesOfficeBuilding.tsx';
import { RestaurantBuilding } from './RestaurantBuilding.tsx';
import type { PlayerBuilding } from '../../shared/types.ts';

export interface SalesBuildingPageProps {
  building: PlayerBuilding;
}

export const SalesBuildingPage: React.FC<SalesBuildingPageProps> = ({ building }) => {
  const { state, retail, salesOffice, restaurant } = useSalesBuilding(building);

  if (state.loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading sales facility data...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="p-8 text-center text-red-500">
        {state.error}
      </div>
    );
  }

  return (
    <div className="sales-building-page max-w-5xl mx-auto py-6 px-4">
      {state.category === 'generic_retail' && (
        <GenericRetailBuilding
          building={building}
          queue={state.retailQueue}
          onStartSale={retail.startRetailTask}
          onCancelSale={retail.cancelRetailTask}
        />
      )}

      {state.category === 'sales_office' && (
        <SalesOfficeBuilding
          building={building}
          orders={state.salesOrders}
          isSearching={state.isSearchingCustomer}
          onFindCustomer={salesOffice.findCustomer}
          onDeliverOrder={salesOffice.deliverSalesOrder}
          onRejectOrder={salesOffice.rejectSalesOrder}
        />
      )}

      {state.category === 'restaurant' && (
        <RestaurantBuilding
          building={building}
          properties={state.restaurantProperties}
          runs={state.restaurantRuns}
          onUpdateProperties={restaurant.updateProperties}
          onToggleRun={restaurant.toggleRun}
        />
      )}
    </div>
  );
};
