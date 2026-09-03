/**
 * Executive persistence (Issue #179 vertical migration).
 *
 * All raw SQL for the executive lifecycle, executive trainings and executive
 * offers (poaching + hostile) lives here. Row shapes mirror the DDL in
 * db/migrations/runner.ts; orchestration (transactions, money moves,
 * validations) belongs to application/executives/executive-use-cases.ts.
 */
import { db } from '../db/connection.ts';
import { virtualClock } from '../core/virtual-clock.ts';

export interface ExecutiveRow {
  id: number;
  company_id: number | null;
  name: string;
  avatar: string | null;
  position: string | null;
  skill_management: number;
  skill_accounting: number;
  skill_science: number;
  skill_communication: number;
  salary: number;
  status: string | null;
  training_finish_at: string | null;
  work_history_accelerated: number;
  plans_to_retire: number;
  strike_until: string | null;
  created_at: string | null;
}

export interface ExecutiveTrainingRow {
  id: number;
  executive_id: number;
  company_id: number;
  datetime: string;
  accelerated: number;
  skills_applied: number;
  created_at: string;
}

export interface ExecutiveOfferRow {
  id: number;
  poacher_company_id: number;
  target_company_id: number;
  target_executive_id: number;
  slot_position: string | null;
  skill_position: string | null;
  agency: number;
  status: string;
  expected_salary: number;
  salary: number | null;
  agency_fee: number;
  accelerated: number;
  research_poacher: string | null;
  research_employer: string | null;
  extended_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- Executives --------------------------------------------------------------

export const executiveRepository = {
  listByCompany(companyId: number): ExecutiveRow[] {
    return db.prepare(`
      SELECT * FROM executives
      WHERE company_id = ? AND status != 'candidate'
      ORDER BY id ASC
    `).all(companyId) as unknown as ExecutiveRow[];
  },

  listCandidates(companyId: number): ExecutiveRow[] {
    return db.prepare(`
      SELECT * FROM executives
      WHERE company_id = ? AND status = 'candidate'
      ORDER BY id DESC LIMIT 5
    `).all(companyId) as unknown as ExecutiveRow[];
  },

  findByIdAndCompany(executiveId: number, companyId: number): ExecutiveRow | undefined {
    return db.prepare('SELECT * FROM executives WHERE id = ? AND company_id = ?').get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  },

  findById(executiveId: number): ExecutiveRow | undefined {
    return db.prepare('SELECT * FROM executives WHERE id = ?').get(executiveId) as unknown as ExecutiveRow | undefined;
  },

  findEmployed(executiveId: number, companyId: number): ExecutiveRow | undefined {
    return db.prepare("SELECT * FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").get(executiveId, companyId) as unknown as ExecutiveRow | undefined;
  },

  countEmployed(companyId: number): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM executives WHERE company_id = ? AND status = 'employed'").get(companyId) as { count: number };
    return row.count;
  },

  hireCandidate(candidateId: number, companyId: number, position: string, startingBonus: number): number {
    const updated = startingBonus > 0
      ? db.prepare(`UPDATE executives SET status = 'employed', position = ?,
          skill_management = skill_management + ?,
          skill_accounting = skill_accounting + ?,
          skill_science = skill_science + ?,
          skill_communication = skill_communication + ?
          WHERE id = ? AND company_id = ? AND status = 'candidate'`)
        .run(position, startingBonus, startingBonus, startingBonus, startingBonus, candidateId, companyId)
      : db.prepare("UPDATE executives SET status = 'employed', position = ? WHERE id = ? AND company_id = ? AND status = 'candidate'")
        .run(position, candidateId, companyId);
    return updated.changes;
  },

  deleteEmployed(executiveId: number, companyId: number): number {
    return db.prepare("DELETE FROM executives WHERE id = ? AND company_id = ? AND status = 'employed'").run(executiveId, companyId).changes;
  },

  assignPosition(executiveId: number, companyId: number, position: string): number {
    return db.prepare("UPDATE executives SET position = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(position, executiveId, companyId).changes;
  },

  updateSalary(executiveId: number, companyId: number, salary: number): void {
    db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(salary, executiveId, companyId);
  },

  updatePosition(executiveId: number, companyId: number, position: string): void {
    db.prepare("UPDATE executives SET position = ? WHERE id = ? AND company_id = ? AND status = 'employed'").run(position, executiveId, companyId);
  },

  markWorkHistoryAccelerated(executiveId: number): void {
    db.prepare('UPDATE executives SET work_history_accelerated = 1 WHERE id = ?').run(executiveId);
  },

  updateStrikeUntil(executiveId: number, iso: string | null): void {
    db.prepare('UPDATE executives SET strike_until = ? WHERE id = ?').run(iso, executiveId);
  },

  updatePlansToRetire(executiveId: number, plans: boolean): void {
    db.prepare('UPDATE executives SET plans_to_retire = ? WHERE id = ?').run(plans ? 1 : 0, executiveId);
  },

  addFourSkills(executiveId: number, gain: number): number {
    return db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + ?, skill_accounting = skill_accounting + ?,
          skill_science = skill_science + ?, skill_communication = skill_communication + ?
      WHERE id = ?
    `).run(gain, gain, gain, gain, executiveId).changes;
  },

  addFourSkillsInCompany(executiveId: number, companyId: number, gain: number): number {
    return db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + ?,
          skill_accounting = skill_accounting + ?,
          skill_science = skill_science + ?,
          skill_communication = skill_communication + ?
      WHERE id = ? AND company_id = ? AND status = 'employed'
    `).run(gain, gain, gain, gain, executiveId, companyId).changes;
  },

  /** Hostile-offer accept: transfer the executive to the poacher company. */
  transferToCompany(executiveId: number, poacherCompanyId: number, salary: number): void {
    db.prepare("UPDATE executives SET company_id = ?, salary = ?, position = 'unassigned', status = 'employed' WHERE id = ?").run(
      poacherCompanyId,
      salary,
      executiveId
    );
  },

  setSalaryById(executiveId: number, salary: number): void {
    db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ?").run(salary, executiveId, db.prepare('SELECT company_id FROM executives WHERE id = ?').get(executiveId)?.company_id);
  },

  insertForeignTarget(foreignCompanyId: number, slotPos: string, baseSkill: number, salaryByTier: number, nowIso: string): ExecutiveRow {
    const insertResult = db.prepare(`
      INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
      VALUES (?, ?, 'images/avatars/male_01.png', ?, ?, ?, ?, ?, ?, 'employed', ?)
    `).run(
      foreignCompanyId,
      `Executive ${Math.floor(1000 + Math.random() * 9000)}`,
      slotPos,
      baseSkill,
      baseSkill,
      baseSkill,
      baseSkill,
      salaryByTier,
      nowIso
    );
    return db.prepare('SELECT * FROM executives WHERE id = ?').get(insertResult.lastInsertRowid) as unknown as ExecutiveRow;
  },

  listRandomEmployedElsewhere(poacherCompanyId: number): ExecutiveRow[] {
    return db.prepare(`
      SELECT * FROM executives
      WHERE company_id != ? AND status = 'employed'
      ORDER BY RANDOM() LIMIT 1
    `).all(poacherCompanyId) as unknown as ExecutiveRow[];
  },

  findAnyOtherCompany(poacherCompanyId: number): { company_id: number } | undefined {
    return db.prepare('SELECT company_id FROM companies WHERE company_id != ? LIMIT 1').get(poacherCompanyId) as { company_id: number } | undefined;
  },

  // --- Academy (#154) --------------------------------------------------------

  listAcademies(companyId: number): Array<{ id: number; size: number; position: string; busy_until: string | null }> {
    return db.prepare(
      "SELECT id, size, position, busy_until FROM buildings WHERE company_id = ? AND kind = 'y'"
    ).all(companyId) as Array<{ id: number; size: number; position: string; busy_until: string | null }>;
  },

  academyHasProduction(buildingId: number): unknown {
    return db.prepare(
      'SELECT 1 FROM production_queues WHERE building_id = ? AND resolved = 0 LIMIT 1'
    ).get(buildingId);
  },

  // --- Trainings -------------------------------------------------------------

  findActiveTraining(executiveId: number): ExecutiveTrainingRow | undefined {
    return db.prepare(`
      SELECT * FROM executive_trainings
      WHERE executive_id = ? AND skills_applied = 0
      ORDER BY id DESC LIMIT 1
    `).get(executiveId) as unknown as ExecutiveTrainingRow | undefined;
  },

  listDueTrainings(companyId: number, cutoff: string): Array<{ id: number; executive_id: number }> {
    return db.prepare(`
      SELECT id, executive_id FROM executive_trainings
      WHERE company_id = ? AND skills_applied = 0
        AND datetime <= ?
    `).all(companyId, cutoff) as Array<{ id: number; executive_id: number }>;
  },

  applyTrainingSkillUp(executiveId: number): number {
    return db.prepare(`
      UPDATE executives
      SET skill_management = skill_management + 1, skill_accounting = skill_accounting + 1,
          skill_science = skill_science + 1, skill_communication = skill_communication + 1
      WHERE id = ?
    `).run(executiveId).changes;
  },

  /** Hostile-offer counter: raise the executive's salary (retention). */
  setSalaryForCompany(executiveId: number, companyId: number, salary: number): void {
    db.prepare("UPDATE executives SET salary = ? WHERE id = ? AND company_id = ?").run(salary, executiveId, companyId);
  },

  markTrainingApplied(trainingId: number): void {
    db.prepare('UPDATE executive_trainings SET skills_applied = 1 WHERE id = ?').run(trainingId);
  },

  countTrainings(executiveId: number): number {
    const row = db.prepare('SELECT COUNT(*) AS n FROM executive_trainings WHERE executive_id = ?').get(executiveId) as { n: number };
    return row.n;
  },

  insertTraining(executiveId: number, companyId: number, datetimeIso: string): ExecutiveTrainingRow {
    const inserted = db.prepare(`
      INSERT INTO executive_trainings (executive_id, company_id, datetime, accelerated, skills_applied, created_at)
      VALUES (?, ?, ?, 0, 0, ?)
    `).run(executiveId, companyId, datetimeIso, datetimeIso);
    return db.prepare('SELECT * FROM executive_trainings WHERE id = ?').get(inserted.lastInsertRowid) as unknown as ExecutiveTrainingRow;
  },

  findUnfinishedTraining(trainingId: number, executiveId: number, companyId: number): ExecutiveTrainingRow | undefined {
    return db.prepare('SELECT * FROM executive_trainings WHERE id = ? AND executive_id = ? AND company_id = ? AND skills_applied = 0')
      .get(trainingId, executiveId, companyId) as unknown as ExecutiveTrainingRow | undefined;
  },

  markTrainingAccelerated(trainingId: number): void {
    db.prepare('UPDATE executive_trainings SET accelerated = 1, skills_applied = 1 WHERE id = ?').run(trainingId);
  },

  deleteTraining(trainingId: number): void {
    db.prepare('DELETE FROM executive_trainings WHERE id = ?').run(trainingId);
  },

  // --- Offers (poaching + hostile) --------------------------------------------

  findOfferForPoacher(offerId: number, poacherCompanyId: number): ExecutiveOfferRow | undefined {
    return db.prepare('SELECT * FROM executive_offers WHERE id = ? AND poacher_company_id = ?').get(offerId, poacherCompanyId) as unknown as ExecutiveOfferRow | undefined;
  },
  findOpenOfferForTarget(
    poacherCompanyId: number,
    targetExecutiveId: number,
    agency: number,
    slotPosition: string,
    skillPosition: string,
    expectedSalary: number
  ): ExecutiveOfferRow | undefined {
    return db.prepare(`
      SELECT * FROM executive_offers
      WHERE poacher_company_id = ? AND target_executive_id = ?
        AND agency = ? AND slot_position = ? AND skill_position = ?
        AND expected_salary = ?
        AND status IN ('f', 's', 'FOUND', 'STANDING')
      ORDER BY id DESC
      LIMIT 1
    `).get(
      poacherCompanyId,
      targetExecutiveId,
      agency,
      slotPosition,
      skillPosition,
      expectedSalary
    ) as unknown as ExecutiveOfferRow | undefined;
  },

  findOpenOfferForSearch(
    poacherCompanyId: number,
    agency: number,
    slotPosition: string,
    skillPosition: string
  ): ExecutiveOfferRow | undefined {
    return db.prepare(`
      SELECT * FROM executive_offers
      WHERE poacher_company_id = ? AND agency = ?
        AND slot_position = ? AND skill_position = ?
        AND status IN ('f', 's', 'FOUND', 'STANDING')
      ORDER BY id DESC
      LIMIT 1
    `).get(poacherCompanyId, agency, slotPosition, skillPosition) as unknown as ExecutiveOfferRow | undefined;
  },

  findOfferForTarget(offerId: number, targetCompanyId: number): ExecutiveOfferRow | undefined {
    return db.prepare('SELECT * FROM executive_offers WHERE id = ? AND target_company_id = ?').get(offerId, targetCompanyId) as unknown as ExecutiveOfferRow | undefined;
  },

  listOffersByPoacher(poacherCompanyId: number): ExecutiveOfferRow[] {
    return db.prepare(`
      SELECT * FROM executive_offers
      WHERE poacher_company_id = ?
      ORDER BY id DESC
    `).all(poacherCompanyId) as unknown as ExecutiveOfferRow[];
  },

  listHostileOffers(targetCompanyId: number): ExecutiveOfferRow[] {
    return db.prepare(`
      SELECT * FROM executive_offers
      WHERE target_company_id = ? AND status IN ('s', 'f', 'STANDING', 'FOUND')
      ORDER BY id DESC
    `).all(targetCompanyId) as unknown as ExecutiveOfferRow[];
  },

  findOfferById(offerId: number): ExecutiveOfferRow | undefined {
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow | undefined;
  },

  insertOffer(input: {
    poacherCompanyId: number;
    targetCompanyId: number;
    targetExecutiveId: number;
    slotPos: string;
    skillPos: string;
    agencyTier: number;
    expectedSalary: number;
    agencyFee: number;
    now: string;
  }): ExecutiveOfferRow {
    const result = db.prepare(`
      INSERT INTO executive_offers (
        poacher_company_id, target_company_id, target_executive_id,
        slot_position, skill_position, agency, status,
        expected_salary, salary, agency_fee, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'f', ?, NULL, ?, ?, ?)
    `).run(
      input.poacherCompanyId,
      input.targetCompanyId,
      input.targetExecutiveId,
      input.slotPos,
      input.skillPos,
      input.agencyTier,
      input.expectedSalary,
      input.agencyFee,
      input.now,
      input.now
    );
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(result.lastInsertRowid) as unknown as ExecutiveOfferRow;
  },

  updateOfferState(offerId: number, poacherCompanyId: number, nextStatus: string, salary: number | null, extendedAt: string | null, accelerated: number, now: string): void {
    db.prepare(`
      UPDATE executive_offers
      SET status = ?, salary = ?, extended_at = ?, accelerated = ?, updated_at = ?
      WHERE id = ? AND poacher_company_id = ?
    `).run(nextStatus, salary, extendedAt, accelerated, now, offerId, poacherCompanyId);
  },

  refreshOffer(offerId: number, poacherCompanyId: number, now: string): ExecutiveOfferRow {
    db.prepare("UPDATE executive_offers SET status = 'f', updated_at = ? WHERE id = ? AND poacher_company_id = ?").run(now, offerId, poacherCompanyId);
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
  },

  deleteOffer(offerId: number, poacherCompanyId: number): void {
    db.prepare('DELETE FROM executive_offers WHERE id = ? AND poacher_company_id = ?').run(offerId, poacherCompanyId);
  },

  setResearchPoacher(offerId: number, researchJson: string, now: string): ExecutiveOfferRow {
    db.prepare('UPDATE executive_offers SET research_poacher = ?, updated_at = ? WHERE id = ?').run(researchJson, now, offerId);
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
  },

  setResearchEmployer(offerId: number, researchJson: string, now: string): ExecutiveOfferRow {
    db.prepare('UPDATE executive_offers SET research_employer = ?, updated_at = ? WHERE id = ?').run(researchJson, now, offerId);
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
  },

  setOfferStatus(offerId: number, status: string, now: string): ExecutiveOfferRow {
    db.prepare("UPDATE executive_offers SET status = ?, updated_at = ? WHERE id = ?").run(status, now, offerId);
    return db.prepare('SELECT * FROM executive_offers WHERE id = ?').get(offerId) as unknown as ExecutiveOfferRow;
  },

  // --- Seeding ----------------------------------------------------------------

  /**
   * Seed the default executives for a fresh company (idempotent). Takes an
   * explicit database handle because the seeder may run against a secondary
   * connection during migrations/tests.
   */
  seedDefaults(companyId: number, database: DatabaseSync = db): void {
    const existingCount = (database.prepare('SELECT COUNT(*) as count FROM executives WHERE company_id = ?').get(companyId) as { count: number })?.count || 0;
    if (existingCount > 0) return;

    const now = virtualClock.nowIso();
    const defaults = [
      { name: 'Alexander Wright', avatar: 'images/avatars/male_01.png', pos: 'coo', mgmt: 12, acc: 4, sci: 3, comm: 6, sal: 450 },
      { name: 'Elena Rostova', avatar: 'images/avatars/female_01.png', pos: 'cfo', mgmt: 4, acc: 14, sci: 2, comm: 5, sal: 480 },
      { name: 'David Chen', avatar: 'images/avatars/male_02.png', pos: 'cto', mgmt: 5, acc: 3, sci: 15, comm: 4, sal: 500 }
    ];
    for (const d of defaults) {
      database.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'employed', ?)
      `).run(companyId, d.name, d.avatar, d.pos, d.mgmt, d.acc, d.sci, d.comm, d.sal, now);
    }

    const candidates = [
      { name: 'Marcus Vance', avatar: 'images/avatars/male_03.png', mgmt: 8, acc: 6, sci: 7, comm: 9, sal: 320 },
      { name: 'Sophia Sterling', avatar: 'images/avatars/female_02.png', mgmt: 11, acc: 5, sci: 4, comm: 10, sal: 360 },
      { name: 'Lucas Meyer', avatar: 'images/avatars/male_04.png', mgmt: 4, acc: 10, sci: 11, comm: 5, sal: 340 }
    ];
    for (const c of candidates) {
      database.prepare(`
        INSERT INTO executives (company_id, name, avatar, position, skill_management, skill_accounting, skill_science, skill_communication, salary, status, created_at)
        VALUES (?, ?, ?, 'unassigned', ?, ?, ?, ?, ?, 'candidate', ?)
      `).run(companyId, c.name, c.avatar, c.mgmt, c.acc, c.sci, c.comm, c.sal, now);
    }
  }
};
