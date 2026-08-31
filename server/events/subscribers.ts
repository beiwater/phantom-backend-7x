import { eventBus } from './event-bus.ts';
import { broadcastToCompany } from '../ws/websocket.ts';

export function setupDomainEventSubscribers(): void {
  // 1. Production Collected Subscriber
  eventBus.subscribe('ProductionCollected', async payload => {
    console.log(`[DomainEvent:ProductionCollected] Company ${payload.companyId} collected ${payload.amount} of #${payload.kind} Q${payload.quality}`);
  });

  // 2. Production Started Subscriber
  eventBus.subscribe('ProductionStarted', async payload => {
    console.log(`[DomainEvent:ProductionStarted] Company ${payload.companyId} started production in building ${payload.buildingId}`);
  });

  // 3. Building Constructed Subscriber
  eventBus.subscribe('BuildingConstructed', async payload => {
    console.log(`[DomainEvent:BuildingConstructed] Company ${payload.companyId} constructed building ${payload.buildingId} (${payload.kind}) at position ${payload.position}`);
  });

  // 4. Building Upgraded Subscriber
  eventBus.subscribe('BuildingUpgraded', async payload => {
    console.log(`[DomainEvent:BuildingUpgraded] Company ${payload.companyId} upgraded building ${payload.buildingId} to size ${payload.newSize}`);
  });

  // 5. Building Demolished Subscriber
  eventBus.subscribe('BuildingDemolished', async payload => {
    console.log(`[DomainEvent:BuildingDemolished] Company ${payload.companyId} demolished building ${payload.buildingId} with refund $${payload.refund}`);
  });
}

// Auto-initialize default subscribers
setupDomainEventSubscribers();
