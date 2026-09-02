import { runInTransaction } from '../../db/transaction.ts';
import { socialRepository, type PollRow } from '../../repositories/social-repository.ts';

export interface ChallengeView {
  challenge: {
    id: number;
    narrativeTitle: string;
    end: string;
    goal: { kind: string; target: number; resourceKind: number | null; buildingKind: number | null };
    milestones: Array<{ id: number; kind: string; value: number | null; buildingKind: number | null }>;
  } | null;
  attempt: {
    goalProgress: { goal: number };
    durationS: number;
    started: string;
    goalCompletedAt: string | null;
  } | null;
}

export function getActiveChallenge(): PollRow | undefined {
  return socialRepository.getActiveChallenge(new Date().toISOString());
}

function challengeDto(challenge: PollRow) {
  return {
    id: Number(challenge.id),
    narrativeTitle: String(challenge.narrative_title),
    end: String(challenge.end),
    goal: {
      kind: String(challenge.goal_kind),
      target: Number(challenge.goal_target),
      resourceKind: (challenge.goal_resource_kind as number | null) ?? null,
      buildingKind: (challenge.goal_building_kind as number | null) ?? null
    },
    milestones: socialRepository.listChallengeMilestones(Number(challenge.id))
  };
}

/** Live goal progress for a company, computed from authoritative state.
 * kind 'p' = units produced of resourceKind since attempt start,
 * kind 'r' = revenue earned since attempt start. */
export function getCurrentChallengeState(companyId: number): ChallengeView {
  const challenge = getActiveChallenge();
  if (!challenge) return { challenge: null, attempt: null };
  const attempt = socialRepository.getAttempt(Number(challenge.id), companyId);
  if (!attempt) return { challenge: challengeDto(challenge), attempt: null };
  const started = String(attempt.started);
  const progress = String(challenge.goal_kind) === 'p'
    ? socialRepository.sumProducedSince(companyId, Number(challenge.goal_resource_kind), started)
    : String(challenge.goal_kind) === 'r'
      ? socialRepository.sumIncomeSince(companyId, started)
      : 0;
  return {
    challenge: challengeDto(challenge),
    attempt: {
      goalProgress: { goal: progress },
      durationS: (Date.now() - Date.parse(started)) / 1000,
      started,
      goalCompletedAt: (attempt.goal_completed_at as string | null) ?? null
    }
  };
}

/** Start (or resume) the challenge attempt for a company. Idempotent. */
export function startAttempt(challengeId: number, companyId: number, companyName: string, logo: string | null, realmId: number): void {
  runInTransaction(() => {
    socialRepository.insertAttemptIfAbsent(challengeId, companyId, companyName, logo, realmId);
  });
}

/** Restart: begin a fresh attempt; best completed duration is retained. */
export function restartAttempt(challengeId: number, companyId: number): void {
  runInTransaction(() => {
    socialRepository.restartAttempt(challengeId, companyId);
  });
}

export function getChallengeLeaderboard(challengeId: number, viewerCompanyId: number): {
  challenge: ReturnType<typeof challengeDto>;
  columns: Array<{
    company: { id: number; company: string; realmId: number; logo: string | null } | null;
    rank: number | null;
    isYou: boolean;
    goalDurationS: number | null;
    milestones: Record<string, number | null>;
  }>;
} | null {
  const challenge = socialRepository.getChallengeById(challengeId);
  if (!challenge) return null;
  const rows = socialRepository.listAttempts(challengeId);
  return {
    challenge: challengeDto(challenge),
    columns: rows.map((r, index) => ({
      company: {
        id: Number(r.company_id),
        company: String(r.company_name ?? ''),
        realmId: Number(r.company_realm_id ?? 0),
        logo: (r.company_logo as string | null) ?? null
      },
      rank: Number(r.goal_duration_s) ? index + 1 : null,
      isYou: Number(r.company_id) === viewerCompanyId,
      goalDurationS: (r.goal_duration_s as number | null) ?? null,
      milestones: safeMilestones(r.milestone_durations_json)
    }))
  };
}

function safeMilestones(json: unknown): Record<string, number | null> {
  try { return JSON.parse(String(json || '{}')) as Record<string, number | null>; } catch { return {}; }
}
