import { db } from '../db/database.ts';

// Repository for the wave-2 social surfaces. Application modules under
// application/social/ orchestrate through these methods only.

/**
 * #158: the original frontend maps the simboost spend action to a message
 * via a single-character code table (bundle Bhe): a-z / 0-9 / A-F. Any
 * other string makes formatMessage(undefined) and crashes the whole
 * SimBoosts page. Official codes (SimboostsSpendActions.*):
 *   c = Construction Speedup (api_v1_rush covers construction AND
 *       production queue rushes), k = Recreation Building Upkeep,
 *   q = HQ Building Unlock, D = Personal Assistant Unlock.
 */
const SIMBOOST_ACTION_CODES: Record<string, string> = {
  RUSH_CONSTRUCTION: 'c',
  RUSH_PRODUCTION: 'c',
  RECREATION_UPKEEP: 'k',
  HQ_UNLOCK: 'q',
  PA_UNLOCK: 'D'
};
export interface PollRow { [key: string]: unknown }

export class SocialRepository {
  private database: DatabaseSync;

  constructor(database: DatabaseSync = db) {
    this.database = database;
  }

  // --- Unlockables --------------------------------------------------------

  listUnlockedHqs(companyId: number): Array<{ idx: number }> {
    return this.database.prepare('SELECT idx FROM player_unlocked_hqs WHERE company_id = ? ORDER BY idx').all(companyId) as Array<{ idx: number }>;
  }

  isHqUnlocked(companyId: number, idx: number): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM player_unlocked_hqs WHERE company_id = ? AND idx = ?').get(companyId, idx));
  }

  insertUnlockedHq(companyId: number, idx: number): void {
    this.database.prepare('INSERT INTO player_unlocked_hqs (company_id, idx, created_at) VALUES (?, ?, ?)')
      .run(companyId, idx, new Date().toISOString());
  }

  listUnlockedPas(companyId: number): Array<{ kind: string }> {
    return this.database.prepare('SELECT kind FROM player_unlocked_pas WHERE company_id = ?').all(companyId) as Array<{ kind: string }>;
  }

  isPaUnlocked(companyId: number, kind: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM player_unlocked_pas WHERE company_id = ? AND kind = ?').get(companyId, kind));
  }

  insertUnlockedPa(companyId: number, kind: string): void {
    this.database.prepare('INSERT INTO player_unlocked_pas (company_id, kind, created_at) VALUES (?, ?, ?)')
      .run(companyId, kind, new Date().toISOString());
  }

  upsertCompanySetting(companyId: number, key: string, value: string): void {
    this.database.prepare('INSERT INTO company_settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO UPDATE SET value = excluded.value')
      .run(companyId, key, value);
  }

  getCompanySetting(companyId: number, key: string): string | null {
    const row = this.database.prepare('SELECT value FROM company_settings WHERE company_id = ? AND key = ?').get(companyId, key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }
  /**
   * #158: the original frontend maps the simboost spend action to a message
   * via a single-character code table (bundle Bhe): a-z / 0-9 / A-F. Any
   * other string makes formatMessage(undefined) and crashes the whole
   * SimBoosts page. Official codes (SimboostsSpendActions.*):
   *   c = Construction Speedup (api_v1_rush covers construction AND
   *       production queue rushes), k = Recreation Building Upkeep,
   *   q = HQ Building Unlock, D = Personal Assistant Unlock.
   */
  static readonly SIMBOOST_ACTION_CODES: Record<string, string> = {
    RUSH_CONSTRUCTION: 'c',
    RUSH_PRODUCTION: 'c',
    RECREATION_UPKEEP: 'k',
    HQ_UNLOCK: 'q',
    PA_UNLOCK: 'D'
  };

  private normalizeSimboostAction(action: string): string {
    return SIMBOOST_ACTION_CODES[action] ?? action;
  }

  recordSimboostSpend(companyId: number, action: string, spend: number): void {
    if (spend <= 0) return;
    this.database.prepare('INSERT INTO simboost_use_history (company_id, action, spend_simboosts, datetime) VALUES (?, ?, ?, ?)')
      .run(companyId, this.normalizeSimboostAction(action), -spend, new Date().toISOString());
  }

  listSimboostUse(companyId: number): Array<{ id: number; spendSimBoosts: number; action: string; datetime: string }> {
    const rows = this.database.prepare('SELECT id, spend_simboosts AS spendSimBoosts, action, datetime FROM simboost_use_history WHERE company_id = ? ORDER BY datetime DESC LIMIT 100')
      .all(companyId) as Array<{ id: number; spendSimBoosts: number; action: string; datetime: string }>;
    // Legacy rows written before the official code mapping.
    return rows.map(r => ({ ...r, action: this.normalizeSimboostAction(r.action) }));
  }

  // --- Building followers (logistics links) --------------------------------

  listBuildingFollowers(buildingId: number): Array<{ id: number }> {
    return this.database.prepare('SELECT follower_building_id AS id FROM building_followers WHERE building_id = ? ORDER BY follower_building_id')
      .all(buildingId) as Array<{ id: number }>;
  }

  /** Both buildings must belong to companyId; returns false otherwise. */
  buildingsOwnedByCompany(buildingId: number, followerBuildingId: number, companyId: number): boolean {
    const rows = this.database.prepare('SELECT company_id FROM buildings WHERE id IN (?, ?)').all(buildingId, followerBuildingId) as Array<{ company_id: number }>;
    return rows.length === 2 && rows.every(r => Number(r.company_id) === companyId);
  }

  linkBuildingFollower(buildingId: number, followerBuildingId: number): void {
    this.database.prepare('INSERT OR IGNORE INTO building_followers (building_id, follower_building_id, created_at) VALUES (?, ?, ?)')
      .run(buildingId, followerBuildingId, new Date().toISOString());
  }

  unlinkBuildingFollower(buildingId: number, followerBuildingId: number): void {
    this.database.prepare('DELETE FROM building_followers WHERE building_id = ? AND follower_building_id = ?')
      .run(buildingId, followerBuildingId);
  }

  // --- Polls --------------------------------------------------------------

  getActivePoll(realmId: number, nowIso: string): PollRow | undefined {
    return this.database.prepare('SELECT * FROM polls WHERE realm_id = ? AND active = 1 AND deadline > ? ORDER BY id DESC LIMIT 1')
      .get(realmId, nowIso) as PollRow | undefined;
  }

  getPollById(pollId: number): PollRow | undefined {
    return this.database.prepare('SELECT * FROM polls WHERE id = ?').get(pollId) as PollRow | undefined;
  }

  listPollQuestions(pollId: number): PollRow[] {
    return this.database.prepare('SELECT * FROM poll_questions WHERE poll_id = ? ORDER BY position, id').all(pollId) as PollRow[];
  }

  listPollChoices(questionId: number): Array<{ id: number; label: string }> {
    return this.database.prepare('SELECT id, label FROM poll_choices WHERE question_id = ? ORDER BY position, id').all(questionId) as Array<{ id: number; label: string }>;
  }

  countPollVotes(pollId: number): Array<{ questionId: number; choice: number; count: number }> {
    return this.database.prepare('SELECT question_id AS questionId, choice, COUNT(*) AS count FROM poll_votes WHERE poll_id = ? GROUP BY question_id, choice')
      .all(pollId) as Array<{ questionId: number; choice: number; count: number }>;
  }

  getMyVotes(pollId: number, companyId: number): Array<{ questionId: number; choice: number }> {
    return this.database.prepare('SELECT question_id AS questionId, choice FROM poll_votes WHERE poll_id = ? AND company_id = ?')
      .all(pollId, companyId) as Array<{ questionId: number; choice: number }>;
  }

  isPollQuestionInPoll(questionId: number, pollId: number): boolean {
    return Boolean(this.database.prepare('SELECT id FROM poll_questions WHERE id = ? AND poll_id = ?').get(questionId, pollId));
  }

  isChoiceInQuestion(choice: number, questionId: number): boolean {
    return Boolean(this.database.prepare('SELECT id FROM poll_choices WHERE id = ? AND question_id = ?').get(choice, questionId));
  }

  upsertPollVote(pollId: number, questionId: number, choice: number, companyId: number): void {
    this.database.prepare('INSERT INTO poll_votes (poll_id, question_id, choice, company_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (poll_id, question_id, company_id) DO UPDATE SET choice = excluded.choice, created_at = excluded.created_at')
      .run(pollId, questionId, choice, companyId, new Date().toISOString());
  }

  // --- Contests -----------------------------------------------------------

  getContestById(contestId: number, realmId: number): PollRow | undefined {
    return this.database.prepare('SELECT * FROM contests WHERE id = ? AND (realm_id = ? OR realm_id = 0)').get(contestId, realmId) as PollRow | undefined;
  }

  listContestParticipants(contestId: number): PollRow[] {
    return this.database.prepare('SELECT * FROM contest_participants WHERE contest_id = ? ORDER BY points DESC, amount DESC, rank IS NULL, rank').all(contestId) as PollRow[];
  }

  refreshContestAmounts(contestId: number): void {
    this.database.prepare("UPDATE contest_participants SET amount = COALESCE((SELECT SUM(amount) FROM cash_ledger l WHERE l.company_id = contest_participants.company_id AND l.amount > 0 AND l.created_at >= datetime('now', '-1 day')), 0) WHERE contest_id = ?")
      .run(contestId);
  }

  rerankContest(contestId: number): void {
    this.database.prepare('UPDATE contest_participants SET rank = (SELECT COUNT(*) FROM contest_participants higher WHERE higher.contest_id = contest_participants.contest_id AND (higher.points > contest_participants.points OR (higher.points = contest_participants.points AND higher.amount > contest_participants.amount))) + 1 WHERE contest_id = ?')
      .run(contestId);
  }

  // --- Challenges ---------------------------------------------------------

  getActiveChallenge(nowIso: string): PollRow | undefined {
    return this.database.prepare('SELECT * FROM challenges WHERE active = 1 AND end > ? ORDER BY id DESC LIMIT 1').get(nowIso) as PollRow | undefined;
  }

  getChallengeById(challengeId: number): PollRow | undefined {
    return this.database.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId) as PollRow | undefined;
  }

  listChallengeMilestones(challengeId: number): Array<{ id: number; kind: string; value: number | null; buildingKind: number | null }> {
    return this.database.prepare('SELECT id, kind, value, building_kind AS buildingKind FROM challenge_milestones WHERE challenge_id = ? ORDER BY position, id')
      .all(challengeId) as Array<{ id: number; kind: string; value: number | null; buildingKind: number | null }>;
  }

  getAttempt(challengeId: number, companyId: number): PollRow | undefined {
    return this.database.prepare('SELECT * FROM challenge_attempts WHERE challenge_id = ? AND company_id = ?').get(challengeId, companyId) as PollRow | undefined;
  }

  insertAttemptIfAbsent(challengeId: number, companyId: number, companyName: string, logo: string | null, realmId: number): void {
    this.database.prepare('INSERT INTO challenge_attempts (challenge_id, company_id, company_name, company_logo, company_realm_id, started) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (challenge_id, company_id) DO NOTHING')
      .run(challengeId, companyId, companyName, logo, realmId, new Date().toISOString());
  }

  restartAttempt(challengeId: number, companyId: number): void {
    const existing = this.database.prepare('SELECT best_goal_duration_s FROM challenge_attempts WHERE challenge_id = ? AND company_id = ?')
      .get(challengeId, companyId) as { best_goal_duration_s: number | null } | undefined;
    this.database.prepare('DELETE FROM challenge_attempts WHERE challenge_id = ? AND company_id = ?').run(challengeId, companyId);
    this.database.prepare('INSERT INTO challenge_attempts (challenge_id, company_id, started, best_goal_duration_s) VALUES (?, ?, ?, ?)')
      .run(challengeId, companyId, new Date().toISOString(), existing?.best_goal_duration_s ?? null);
  }

  listAttempts(challengeId: number): PollRow[] {
    return this.database.prepare('SELECT * FROM challenge_attempts WHERE challenge_id = ? ORDER BY COALESCE(goal_duration_s, 1e18), goal_completed_at IS NULL, started').all(challengeId) as PollRow[];
  }

  // Challenge goal progress reads authoritative production/ledger state.
  sumProducedSince(companyId: number, resourceKind: number, startedIso: string): number {
    const row = this.database.prepare('SELECT COALESCE(SUM(amount), 0) AS produced FROM production_queues WHERE company_id = ? AND kind = ? AND resolved = 1 AND finishes_at >= ?')
      .get(companyId, resourceKind, startedIso) as { produced: number };
    return Number(row.produced);
  }

  sumIncomeSince(companyId: number, startedIso: string): number {
    const row = this.database.prepare('SELECT COALESCE(SUM(amount), 0) AS revenue FROM cash_ledger WHERE company_id = ? AND amount > 0 AND created_at >= ?')
      .get(companyId, startedIso) as { revenue: number };
    return Number(row.revenue);
  }

  // --- Courses ------------------------------------------------------------

  getCourseById(courseId: number): PollRow | undefined {
    return this.database.prepare('SELECT * FROM courses WHERE id = ?').get(courseId) as PollRow | undefined;
  }

  listCourses(): PollRow[] {
    return this.database.prepare('SELECT * FROM courses ORDER BY id DESC').all() as PollRow[];
  }

  insertCourse(teacherCompanyId: number | null, teacher: string, name: string, start: string | null): void {
    this.database.prepare('INSERT INTO courses (teacher_company_id, teacher_name, name, start, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(teacherCompanyId, teacher, name, start, new Date().toISOString());
  }

  setCourseStarted(courseId: number, started: boolean): void {
    this.database.prepare('UPDATE courses SET started = ?, start = COALESCE(start, ?) WHERE id = ?')
      .run(started ? 1 : 0, new Date().toISOString(), courseId);
  }

  updateCourseFields(courseId: number, maxStudents?: number, studentsPaying?: boolean, publicChatroomsDisabled?: boolean, html?: string): void {
    if (maxStudents !== undefined) this.database.prepare('UPDATE courses SET max_students = ? WHERE id = ?').run(maxStudents, courseId);
    if (studentsPaying !== undefined) this.database.prepare('UPDATE courses SET students_paying = ? WHERE id = ?').run(studentsPaying ? 1 : 0, courseId);
    if (publicChatroomsDisabled !== undefined) this.database.prepare('UPDATE courses SET public_chatrooms_disabled = ? WHERE id = ?').run(publicChatroomsDisabled ? 1 : 0, courseId);
    if (html !== undefined) this.database.prepare('UPDATE courses SET html = ? WHERE id = ?').run(html, courseId);
  }

  deleteCourseById(courseId: number): boolean {
    return Number(this.database.prepare('DELETE FROM courses WHERE id = ?').run(courseId).changes) > 0;
  }

  listCourseStudents(courseId: number): PollRow[] {
    return this.database.prepare('SELECT company_id, company_name, company_logo, company_realm_id FROM course_students WHERE course_id = ? ORDER BY joined_at').all(courseId) as PollRow[];
  }

  addCourseStudentIfAbsent(courseId: number, companyId: number, companyName: string, logo: string | null, realmId: number): void {
    this.database.prepare('INSERT INTO course_students (course_id, company_id, company_name, company_logo, company_realm_id, joined_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (course_id, company_id) DO NOTHING')
      .run(courseId, companyId, companyName, logo, realmId, new Date().toISOString());
    this.database.prepare('UPDATE courses SET indicated_students = indicated_students + 1 WHERE id = ?').run(courseId);
  }
}

export const socialRepository = new SocialRepository();
