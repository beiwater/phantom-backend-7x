/**
 * Restored Modern React Application Entry Point
 */

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppLayout } from './features/navigation/AppLayout.tsx';
import type { ResourceDefinition, BuildingDefinition } from './shared/types.ts';

const DEFAULT_RESOURCES: ResourceDefinition[] = [
  { id: 1, name: 'Electricity', category: 'energy', exchangePrice: 0.24 },
  { id: 2, name: 'Water', category: 'resources', exchangePrice: 0.38 },
  { id: 3, name: 'Apples', category: 'agriculture', exchangePrice: 2.10 },
  { id: 4, name: 'Oranges', category: 'agriculture', exchangePrice: 2.35 },
  { id: 5, name: 'Grapes', category: 'agriculture', exchangePrice: 2.80 },
  { id: 6, name: 'Grain', category: 'agriculture', exchangePrice: 0.85 },
  { id: 7, name: 'Sugar cane', category: 'agriculture', exchangePrice: 1.15 }
];

const DEFAULT_BUILDINGS: BuildingDefinition[] = [
  { kind: 'P', name: 'Plantation', category: 'production', baseCost: 13800, productionQueue: [] },
  { kind: 'F', name: 'Factory', category: 'production', baseCost: 17250, productionQueue: [] },
  { kind: 'G', name: 'Grocery Store', category: 'sales', baseCost: 10350, productionQueue: [] },
  { kind: 'A', name: 'Gas Station', category: 'sales', baseCost: 24150, productionQueue: [] },
  { kind: 'B', name: 'Sales Offices', category: 'sales', baseCost: 62100, productionQueue: [] },
  { kind: 'r', name: 'Restaurant', category: 'sales', baseCost: 89700, productionQueue: [] }
];

const RootApp: React.FC = () => {
  const [resources, setResources] = useState<ResourceDefinition[]>(DEFAULT_RESOURCES);
  const [buildings, setBuildings] = useState<BuildingDefinition[]>(DEFAULT_BUILDINGS);
  const [companyName, setCompanyName] = useState<string>('Phantom Enterprise');
  const [companyId, setCompanyId] = useState<number>(1);

  useEffect(() => {
    // Attempt to load live company profile & resources if backend is responding
    fetch('/api/v2/companies/me/')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.company) {
          setCompanyName(data.company.name || 'Phantom Enterprise');
          setCompanyId(data.company.id || 1);
        }
      })
      .catch(() => {
        // Fallback to defaults
      });
  }, []);

  return (
    <AppLayout
      companyId={companyId}
      companyName={companyName}
      initialResources={resources}
      initialBuildings={buildings}
    />
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>
  );
}
