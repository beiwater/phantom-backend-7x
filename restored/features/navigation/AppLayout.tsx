/**
 * Root Application Shell & Orchestrator Layout
 */

import React, { useState } from 'react';
import { TopNavigationBar, type NavigationTab } from './TopNavigationBar.tsx';
import { LandscapeMapPage } from '../landscape/LandscapeMapPage.tsx';
import { WarehousePage } from '../warehouse/WarehousePage.tsx';
import { MarketExchangePage } from '../market/MarketExchangePage.tsx';
import { EncyclopediaPage } from '../encyclopedia/EncyclopediaPage.tsx';
import { NewspaperPage } from '../newspaper/NewspaperPage.tsx';
import { ChatroomPage } from '../chat/ChatroomPage.tsx';
import { MessagesPage } from '../messages/MessagesPage.tsx';
import { FinancialStatementsPage } from '../finances/FinancialStatementsPage.tsx';
import { SeasonalEventsPage } from '../events/SeasonalEventsPage.tsx';
import { PlayerProfilePage } from '../profile/PlayerProfilePage.tsx';
import { AccountPreferencesPage } from '../profile/AccountPreferencesPage.tsx';
import { SalesBuildingPage } from '../sales/SalesBuildingPage.tsx';
import { PersonalAssistantModal } from '../assistant/PersonalAssistantModal.tsx';
import { usePersonalAssistant } from '../assistant/usePersonalAssistant.ts';
import type { PlayerBuilding, ResourceDefinition, BuildingDefinition } from '../../shared/types.ts';

export interface AppLayoutProps {
  companyId: number;
  companyName: string;
  initialResources: ResourceDefinition[];
  initialBuildings: BuildingDefinition[];
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  companyId,
  companyName,
  initialResources,
  initialBuildings
}) => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('landscape');
  const [activeBuilding, setActiveBuilding] = useState<PlayerBuilding | null>(null);

  // Corporate live numbers
  const [money] = useState(150000);
  const [simboosts] = useState(250);
  const [level] = useState(12);

  // Personal Assistant Modal state
  const pa = usePersonalAssistant();

  const handleOpenBuilding = (building: PlayerBuilding) => {
    setActiveBuilding(building);
  };

  const handleBackToLandscape = () => {
    setActiveBuilding(null);
    setActiveTab('landscape');
  };

  return (
    <div className="app-shell min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
      <TopNavigationBar
        companyName={companyName}
        level={level}
        money={money}
        simboosts={simboosts}
        activeTab={activeTab}
        onSelectTab={tab => {
          setActiveBuilding(null);
          setActiveTab(tab);
        }}
        onOpenAssistant={pa.openAssistant}
      />

      <main className="py-4">
        {/* Active Facility Inspector Modal / View */}
        {activeBuilding ? (
          <div>
            <div className="max-w-5xl mx-auto px-4 mb-2">
              <button
                type="button"
                onClick={handleBackToLandscape}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                ← Back to Territory Map
              </button>
            </div>
            <SalesBuildingPage building={activeBuilding} />
          </div>
        ) : (
          <>
            {activeTab === 'landscape' && (
              <LandscapeMapPage companyId={companyId} onOpenBuilding={handleOpenBuilding} />
            )}
            {activeTab === 'warehouse' && <WarehousePage companyId={companyId} />}
            {activeTab === 'market' && <MarketExchangePage />}
            {activeTab === 'encyclopedia' && (
              <EncyclopediaPage
                initialResources={initialResources}
                initialBuildings={initialBuildings}
              />
            )}
            {activeTab === 'newspaper' && <NewspaperPage />}
            {activeTab === 'chat' && <ChatroomPage currentCompanyId={companyId} />}
            {activeTab === 'messages' && <MessagesPage myCompanyId={companyId} />}
            {activeTab === 'finances' && <FinancialStatementsPage companyId={companyId} />}
            {activeTab === 'events' && <SeasonalEventsPage />}
            {activeTab === 'profile' && <PlayerProfilePage companyId={companyId} />}
            {activeTab === 'preferences' && <AccountPreferencesPage />}
          </>
        )}
      </main>

      <PersonalAssistantModal
        isOpen={pa.state.isOpen}
        quest={pa.state.currentQuest}
        onClose={pa.closeAssistant}
        onClaimReward={() => pa.executeAction('claim')}
        isExecuting={pa.state.actionExecuting}
        rewardEarned={pa.state.lastReward}
      />
    </div>
  );
};
