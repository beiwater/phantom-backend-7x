import type { DailySchedule } from '../../domain/scheduler/schedule.ts';
import {
  settleDailyFinance,
  chargeDailyBondInterest,
  chargeDailyAccountingOverhead,
  debitExecutiveSalaries,
  publishGovernmentOrders,
  awardGovernmentBids,
  rollEconomyPhase,
  recalculateRetailSaturation,
  getEconomyPhase
} from './daily-jobs.ts';
import { backupEngine } from '../../db/backup.ts';

export interface SchedulerTaskDefinition extends DailySchedule {
  name: string;
  description: string;
  transactional?: boolean;
  run(occurrence: Date): void | Promise<void>;
}

export const TASK_BOND_INTEREST_AND_OVERHEAD = 'bond_interest_and_admin_overhead';
export const TASK_EXECUTIVE_SALARIES = 'executive_salaries';
export const TASK_DATABASE_BACKUP = 'database_daily_hot_backup';
export const TASK_GOVERNMENT_ORDERS_PUBLISH = 'government_orders_publish';
export const TASK_GOVERNMENT_ORDERS_AWARD = 'government_orders_award';
export const TASK_ECONOMY_PHASE_ROLL = 'economy_phase_roll';
export const TASK_RETAIL_SATURATION_REFRESH = 'retail_saturation_refresh';

export const SCHEDULED_TASKS: readonly SchedulerTaskDefinition[] = [
  {
    name: TASK_BOND_INTEREST_AND_OVERHEAD,
    description: 'Bond interest deduction + accounting overhead charge per company',
    hourUtc: 0,
    minuteUtc: 0,
    run: async () => {
      await settleDailyFinance();
      chargeDailyBondInterest();
      chargeDailyAccountingOverhead();
    }
  },
  {
    name: TASK_DATABASE_BACKUP,
    description: 'Daily automated SQLite hot backup and checksum verification (Issue #148)',
    hourUtc: 3,
    minuteUtc: 0,
    transactional: false,
    run: () => {
      backupEngine.createBackup({ retentionCount: 14 });
    }
  },
  {
    name: TASK_EXECUTIVE_SALARIES,
    description: 'Executive daily salary debit (cash ledger category e)',
    hourUtc: 4,
    minuteUtc: 0,
    run: () => debitExecutiveSalaries()
  },
  {
    name: TASK_GOVERNMENT_ORDERS_AWARD,
    description: 'Government Orders award fulfillment (lowest bid wins)',
    hourUtc: 13,
    minuteUtc: 0,
    daysOfWeek: [1],
    run: occurrence => awardGovernmentBids(occurrence)
  },
  {
    name: TASK_GOVERNMENT_ORDERS_PUBLISH,
    description: 'Government Orders weekly publication',
    hourUtc: 13,
    minuteUtc: 0,
    daysOfWeek: [3],
    run: occurrence => publishGovernmentOrders(occurrence)
  },
  {
    name: TASK_ECONOMY_PHASE_ROLL,
    description: 'Economy phase roll (Recession/Normal/Boom)',
    hourUtc: 15,
    minuteUtc: 0,
    daysOfWeek: [5],
    run: occurrence => rollEconomyPhase(occurrence)
  },
  {
    name: TASK_RETAIL_SATURATION_REFRESH,
    description: 'Daily retail market saturation recalculation',
    hourUtc: 23,
    minuteUtc: 30,
    run: occurrence => recalculateRetailSaturation(occurrence)
  }
];
