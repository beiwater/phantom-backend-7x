import { runInTransaction } from '../../db/transaction.ts';
import { socialRepository, type PollRow } from '../../repositories/social-repository.ts';
import { virtualClock } from '../../core/virtual-clock.ts';

// --- Polls ------------------------------------------------------------------

export interface PollQuestion {
  id: number;
  label: string;
  description: string | null;
  questionType: string;
  choices: Array<{ id: number; label: string; votes: number }>;
}

export interface PollView {
  id: number;
  name: string;
  realmId: number;
  description: string | null;
  image: string | null;
  active: boolean;
  supportersOnly: boolean;
  deadline: string;
  questions: PollQuestion[];
  results: Array<{ questionId: number; responses: number; votes: Array<{ choice: number; count: number }> }>;
  myVotes: Array<{ questionId: number; choice: number }>;
}

export function getActivePoll(realmId: number): PollRow | undefined {
  return socialRepository.getActivePoll(realmId, virtualClock.nowIso());
}

export function getPollById(pollId: number): PollRow | undefined {
  return socialRepository.getPollById(pollId);
}

export function getPollView(poll: PollRow, companyId: number | null): PollView {
  const pollId = Number(poll.id);
  const votes = socialRepository.countPollVotes(pollId);
  const myVotes = companyId ? socialRepository.getMyVotes(pollId, companyId) : [];
  const questions = socialRepository.listPollQuestions(pollId).map(q => {
    const questionId = Number(q.id);
    return {
      id: questionId,
      label: String(q.label),
      description: (q.description as string | null) ?? null,
      questionType: String(q.question_type ?? 'SINGLE_CHOICE'),
      choices: socialRepository.listPollChoices(questionId).map(c => ({
        id: c.id,
        label: c.label,
        votes: votes.filter(v => v.questionId === questionId && v.choice === c.id).reduce((sum, v) => sum + v.count, 0)
      }))
    };
  });
  const byQuestion = new Map<number, Array<{ choice: number; count: number }>>();
  for (const v of votes) {
    if (!byQuestion.has(v.questionId)) byQuestion.set(v.questionId, []);
    byQuestion.get(v.questionId)!.push({ choice: v.choice, count: v.count });
  }
  return {
    id: pollId,
    name: String(poll.name),
    realmId: Number(poll.realm_id),
    description: (poll.description as string | null) ?? null,
    image: (poll.image as string | null) ?? null,
    active: Boolean(poll.active),
    supportersOnly: Boolean(poll.supporters_only),
    deadline: String(poll.deadline),
    questions,
    results: questions.map(q => ({
      questionId: q.id,
      responses: q.choices.reduce((sum, c) => sum + c.votes, 0),
      votes: byQuestion.get(q.id) ?? []
    })),
    myVotes
  };
}

/** Cast a vote; one vote per company per question (official semantics:
 * re-voting updates the choice). */
export function votePoll(pollId: number, questionId: number, choice: number, companyId: number): void {
  if (!socialRepository.isPollQuestionInPoll(questionId, pollId)) throw new Error('Unknown poll question');
  if (!socialRepository.isChoiceInQuestion(choice, questionId)) throw new Error('Unknown poll choice');
  runInTransaction(() => {
    socialRepository.upsertPollVote(pollId, questionId, choice, companyId);
  });
}

// --- Contests ----------------------------------------------------------------

export interface ContestView {
  contest: { id: number; name: string; rules: string; end: string | null };
  participants: Array<{
    company: { id: number; company: string; realmId: number; logo: string | null; deleted: boolean; certificates: number; contestWins: number };
    points: number;
    amount: number;
    datetime: string | null;
    rank: number | null;
  }>;
}

export function getContestView(realmId: number, contestId: number): ContestView | null {
  const contest = socialRepository.getContestById(contestId, realmId);
  if (!contest) return null;
  const participants = socialRepository.listContestParticipants(contestId);
  return {
    contest: {
      id: Number(contest.id),
      name: String(contest.name),
      rules: String(contest.rules),
      end: (contest.end as string | null) ?? null
    },
    participants: participants.map((p, index) => ({
      company: {
        id: Number(p.company_id),
        company: String(p.company_name ?? ''),
        realmId: Number(p.company_realm_id ?? 0),
        logo: (p.company_logo as string | null) ?? null,
        deleted: Boolean(p.company_deleted),
        certificates: Number(p.certificates ?? 0),
        contestWins: Number(p.contest_wins ?? 0)
      },
      points: Number(p.points ?? 0),
      amount: Number(p.amount ?? 0),
      datetime: (p.datetime as string | null) ?? null,
      rank: Number(p.rank ?? index + 1)
    }))
  };
}

/** Recompute contest standings (amount from last-24h income; rerank). */
export function refreshContestStandings(contestId: number): void {
  const contest = socialRepository.getContestById(contestId, 0);
  if (!contest) return;
  runInTransaction(() => {
    if (String(contest.rules) === 't') socialRepository.refreshContestAmounts(contestId);
    socialRepository.rerankContest(contestId);
  });
}
