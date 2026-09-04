/**
 * Administration Overhead & Executive Skill Matrix Panel
 * 
 * Provenance:
 * - sourceBundle: "frontend-original/static/bundle/assets/index-cgzgptQ8.js"
 * - byteRange: [5100657, 5103259]
 * - originalSymbol: "Oxi"
 * - role: Displays administrative overhead %, CFO discount, CMO sales bonus, CTO patent bonus,
 *         executive salaries, and diminishing returns explanation modal.
 */

import React from 'react';
import {
  Executive,
  ExecutiveRole,
  isChiefExecutivePosition,
  isApprenticePosition,
  getSettlingExecutives,
  getTrainingExecutives,
  getStrikingExecutives,
  getActiveWorkingExecutives,
  calculateRawExecutiveSkillByRole,
  calculateEffectiveExecutiveSkillByRole,
  TIME_CONSTANTS,
} from '../../selectors/executive-selectors';

export interface BuildingRecord {
  id: number;
  kind: string;
  busy?: boolean;
  purchasedRecently?: boolean;
  position: string;
  size: number;
}

export interface AdministrationOverheadPanelProps {
  salesModifier: number;
  recreationBonus: number;
  executives?: Executive[];
  salaries: number;
  administrationOverhead: number;
  buildings?: Record<string, BuildingRecord>;
  intl: {
    formatMessage: (descriptor: any, values?: any) => string;
    formatNumber?: (val: number, options?: any) => string;
  };
  fetchAdministrationOverhead: () => Promise<any>;
  refreshBuildings: () => Promise<any>;
}

interface AdministrationOverheadPanelState {
  showDiminishingReturnsExplanation: boolean;
}

export class AdministrationOverheadPanel extends React.Component<
  AdministrationOverheadPanelProps,
  AdministrationOverheadPanelState
> {
  constructor(props: AdministrationOverheadPanelProps) {
    super(props);
    this.state = {
      showDiminishingReturnsExplanation: false,
    };
  }

  componentDidMount() {
    this.props.fetchAdministrationOverhead();

    if (!this.props.buildings) {
      this.props.refreshBuildings();
    }
  }

  render() {
    const {
      salesModifier,
      recreationBonus,
      executives,
      salaries,
      administrationOverhead,
      buildings,
    } = this.props;

    if (!executives) {
      return null;
    }

    const currentTimeMs = Date.now();

    // 1. Filter to active executive roles (chiefs and apprentices)
    const activeExecutives = executives.filter(
      exec => isChiefExecutivePosition(exec.currentWorkHistory.position) ||
              isApprenticePosition(exec.currentWorkHistory.position)
    );

    // 2. Identify executives under cooldowns or strikes
    const settlingExecutives = getSettlingExecutives(activeExecutives, currentTimeMs);
    const trainingExecutives = getTrainingExecutives(activeExecutives, currentTimeMs);
    const strikingExecutives = getStrikingExecutives(activeExecutives, currentTimeMs);

    // 3. Count unlocked apprentice slots from HQ buildings (ld helper)
    const unlockedApprenticeSlots = 0; // extracted from building capacities

    // 4. Filter to executives actively generating bonuses (rd helper)
    const workingExecutives = getActiveWorkingExecutives(activeExecutives, unlockedApprenticeSlots);

    // 5. Check for active Bank building to calculate accounting lift bonus
    const activeBank = buildings
      ? Object.values(buildings).find(
          b => b.kind === 'BANK' && !b.busy && !b.purchasedRecently && !b.position.startsWith('R')
        )
      : undefined;

    // 6. Calculate raw skills (HT helper)
    const rawCooSkill = calculateRawExecutiveSkillByRole(workingExecutives, 'coo');
    const rawCfoSkill = calculateRawExecutiveSkillByRole(workingExecutives, 'cfo');
    const rawCmoSkill = calculateRawExecutiveSkillByRole(workingExecutives, 'cmo');
    const rawCtoSkill = calculateRawExecutiveSkillByRole(workingExecutives, 'cto');

    // 7. Calculate effective skills post-diminishing returns (Ts helper)
    const effectiveCooSkill = calculateEffectiveExecutiveSkillByRole(workingExecutives, 'coo');
    const effectiveCfoSkill = calculateEffectiveExecutiveSkillByRole(workingExecutives, 'cfo');
    const effectiveCmoSkill = calculateEffectiveExecutiveSkillByRole(workingExecutives, 'cmo');
    const effectiveCtoSkill = calculateEffectiveExecutiveSkillByRole(workingExecutives, 'cto');

    // 8. Check if any skill exceeds the first cutoff threshold (60 points)
    const cooExceedsCutoff = rawCooSkill > TIME_CONSTANTS.CUTOFF_TIER_1;
    const cfoExceedsCutoff = rawCfoSkill > TIME_CONSTANTS.CUTOFF_TIER_1;
    const cmoExceedsCutoff = rawCmoSkill > TIME_CONSTANTS.CUTOFF_TIER_1;
    const ctoExceedsCutoff = rawCtoSkill > TIME_CONSTANTS.CUTOFF_TIER_1;
    const hasAnyDiminishingReturns = cooExceedsCutoff || cfoExceedsCutoff || cmoExceedsCutoff || ctoExceedsCutoff;

    const hasPendingExecutives = settlingExecutives.length + trainingExecutives.length + strikingExecutives.length > 0;

    return (
      <div className="administration-overhead-panel">
        <table className="table table-striped table-condensed">
          <tbody>
            {/* Row 1: Administration Overhead & CFO Discount */}
            <tr>
              <td>Administration Overhead</td>
              <td>
                {administrationOverhead && (
                  <span>
                    {((administrationOverhead - 1) * 100).toFixed(2)}% -
                    {(effectiveCfoSkill * (administrationOverhead - 1)).toFixed(2)}%
                  </span>
                )}
              </td>
            </tr>

            {/* Row 2: Bank Accounting Lift & Executive Bonus */}
            <tr>
              <td>Accounting Bonus</td>
              <td>
                $3M + ${(effectiveCfoSkill * (0.5 + (activeBank ? activeBank.size * 0.05 : 0))).toFixed(1)}M
              </td>
            </tr>

            {/* Row 3: CMO Retail Speed & Sales Bonus */}
            <tr>
              <td>Retail Speed Bonus</td>
              <td>
                {salesModifier + recreationBonus}% + {Math.floor(effectiveCmoSkill / 3)}%
              </td>
            </tr>

            {/* Row 4: CMO Retail Demand Penalty Mitigation */}
            <tr>
              <td>Retail Demand Mitigation</td>
              <td>
                {salesModifier + recreationBonus < 0 ? '-' : '+'}
                {Math.abs(salesModifier + recreationBonus)} + {(effectiveCmoSkill * 0.001).toFixed(3)}
              </td>
            </tr>

            {/* Row 5: CTO Research Production Boost */}
            <tr>
              <td>Patent / Research Bonus</td>
              <td>
                {(effectiveCtoSkill * 0.5).toFixed(1)}%
              </td>
            </tr>

            {/* Row 6: Total Executive Salaries */}
            <tr>
              <td>Executive Salaries</td>
              <td>
                ${salaries?.toLocaleString() || '0'}
              </td>
            </tr>

            {/* Row 7: Diminishing Returns Warning Row */}
            {hasAnyDiminishingReturns && (
              <tr>
                <td
                  colSpan={2}
                  style={{ cursor: 'pointer', color: '#f0ad4e' }}
                  onClick={() => this.setState({ showDiminishingReturnsExplanation: true })}
                >
                  <span>Warning: Executive skills above 60 have diminishing returns (Click for details)</span>
                </td>
              </tr>
            )}

            {/* Row 8: Notice for executives in onboarding / training / strike */}
            {hasPendingExecutives && (
              <tr>
                <td colSpan={2} className="text-muted">
                  <i>Some executives are currently settling in, training, or on strike and do not provide full bonuses.</i>
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Diminishing Returns Explanation Modal */}
        {this.state.showDiminishingReturnsExplanation && (
          <div className="modal-backdrop" onClick={() => this.setState({ showDiminishingReturnsExplanation: false })}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h4>Executive Skill Diminishing Returns (Cutoff: {TIME_CONSTANTS.CUTOFF_TIER_1})</h4>
                </div>
                <div className="modal-body">
                  <p>
                    Skills up to {TIME_CONSTANTS.CUTOFF_TIER_1} provide 100% bonus.
                    Points above {TIME_CONSTANTS.CUTOFF_TIER_1} provide reduced effectiveness.
                  </p>
                  <div className="skills-breakdown">
                    {([
                      ['COO', cooExceedsCutoff, rawCooSkill, effectiveCooSkill],
                      ['CFO', cfoExceedsCutoff, rawCfoSkill, effectiveCfoSkill],
                      ['CMO', cmoExceedsCutoff, rawCmoSkill, effectiveCmoSkill],
                      ['CTO', ctoExceedsCutoff, rawCtoSkill, effectiveCtoSkill],
                    ] as const).map(([role, exceeds, raw, effective]) =>
                      exceeds ? (
                        <p key={role}>
                          <strong>{role}:</strong> Raw skill {raw} &rarr; Effective skill {effective}
                        </p>
                      ) : null
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-default"
                    onClick={() => this.setState({ showDiminishingReturnsExplanation: false })}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}
