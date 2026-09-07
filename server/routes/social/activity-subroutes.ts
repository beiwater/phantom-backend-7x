import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../utils.ts";
import { referralsRepository } from "../../repositories/referrals-repository.ts";
import { getCompanyById } from "../../game/company.ts";
import {
  NotPurchasableError,
  listSimboostUse,
  listUnlockedHqs,
  listUnlockedPas,
  selectPa,
  unlockHq,
  unlockPa
} from "../../application/social/unlockables.ts";
import { getActivePoll, getContestView, getPollById, getPollView, votePoll } from "../../application/social/polls.ts";
import {
  getActiveChallenge,
  getChallengeLeaderboard,
  getCurrentChallengeState,
  restartAttempt,
  startAttempt
} from "../../application/social/challenges.ts";
import {
  createCourse,
  deleteCourse,
  getCourse,
  joinCourse,
  listCourses,
  updateCourse
} from "../../application/social/courses.ts";

export async function handleActivitySubroutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  currentCompanyId: number | null
): Promise<boolean> {
  // Referrals & Royalties
  if (pathname.startsWith("/api/") && pathname.includes("/referrals/")) {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    sendJson(res, referralsRepository.findReferredBy(currentCompanyId).map(r => ({
      company: { id: r.referredCompanyId },
      code: r.code,
      created: r.createdAt,
      rewardsPaid: r.rewardsPaid
    })));
    return true;
  }
  if (pathname.startsWith("/api/") && pathname.includes("/royalties/")) {
    sendJson(res, { royalties: 0 });
    return true;
  }

  // Unlocked HQ skins (GET list / POST unlock with SimBoost debit).
  if (pathname === "/api/v2/players/unlocked-hqs/" || pathname === "/api/v2/players/unlocked-hqs") {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "GET") {
      sendJson(res, listUnlockedHqs(currentCompanyId));
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(req);
      try {
        sendJson(res, await unlockHq(currentCompanyId, Number(body.idx)));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: message }, err instanceof NotPurchasableError ? 400 : 402);
      }
      return true;
    }
  }

  // Unlocked personal assistants (GET list / POST unlock with SimBoost debit).
  if (pathname === "/api/v2/players/unlocked-pas/" || pathname === "/api/v2/players/unlocked-pas") {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    if (method === "GET") {
      sendJson(res, { unlockedPAs: listUnlockedPas(currentCompanyId) });
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(req);
      const kind = String(body.personalAssistant ?? "");
      try {
        const unlocked = await unlockPa(currentCompanyId, kind);
        await selectPa(currentCompanyId, kind);
        sendJson(res, { unlockedPAs: unlocked });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: message }, err instanceof NotPurchasableError ? 400 : 402);
      }
      return true;
    }
  }

  // Per-company SimBoost spend history.
  const simboostsUseMatch = pathname.match(/^\/api\/v2\/players\/simboosts-use\/(\d+|me)\/?$/);
  if (simboostsUseMatch && method === "GET") {
    const targetId = simboostsUseMatch[1] === "me" ? currentCompanyId : Number(simboostsUseMatch[1]);
    if (!targetId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    sendJson(res, listSimboostUse(targetId));
    return true;
  }
  if (pathname.startsWith("/api/") && (pathname.includes("/unlocked-hqs/") || pathname.includes("/unlocked-pas/"))) {
    sendJson(res, []);
    return true;
  }

  const unsupportedSimboostActionMatch = pathname.match(/^\/api\/v2\/players\/simboosts-use\/([^/]+)\/?$/);
  if (unsupportedSimboostActionMatch) {
    sendJson(res, { error: "SimBoost spend action contract unavailable" }, 404);
    return true;
  }

  // Polls: GET /api/v3/:realm/polls/:id/ and POST /api/v2/polls/:pollId/:questionId/vote/
  const pollGetMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/polls\/(\d+)\/$/);
  if (pollGetMatch && method === "GET") {
    const poll = getPollById(Number(pollGetMatch[2])) ?? getActivePoll(Number(pollGetMatch[1]));
    if (!poll) {
      sendJson(res, { error: "Poll not found" }, 404);
      return true;
    }
    sendJson(res, getPollView(poll, currentCompanyId));
    return true;
  }
  const pollVoteMatch = pathname.match(/^\/api\/v2\/polls\/(\d+)\/(\d+)\/vote\/$/);
  if (pollVoteMatch && method === "POST") {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    const body = await readJsonBody(req);
    try {
      votePoll(Number(pollVoteMatch[1]), Number(pollVoteMatch[2]), Number(body.choice), currentCompanyId);
      sendJson(res, { success: true });
    } catch (err) {
      sendJson(res, { error: err instanceof Error ? err.message : String(err) }, 400);
    }
    return true;
  }

  // Challenges (v1): current / attempt / restart / leaderboard.
  if (pathname === "/api/v1/challenges/current/" && method === "GET") {
    if (!currentCompanyId) {
      sendJson(res, { challenge: null, attempt: null });
      return true;
    }
    sendJson(res, getCurrentChallengeState(currentCompanyId));
    return true;
  }
  if ((pathname === "/api/v1/challenges/attempt/" || pathname === "/api/v1/challenges/restart/") && method === "POST") {
    if (!currentCompanyId) {
      sendJson(res, { error: "Unauthorized" }, 401);
      return true;
    }
    const challenge = getActiveChallenge();
    if (!challenge) {
      sendJson(res, { error: "No challenge running" }, 404);
      return true;
    }
    const company = getCompanyById(currentCompanyId);
    if (pathname.includes("/attempt/")) {
      startAttempt(challenge.id, currentCompanyId, company?.name ?? "", company?.logo ?? null, company?.realm_id ?? 0);
    } else {
      restartAttempt(challenge.id, currentCompanyId);
    }
    sendJson(res, { success: true });
    return true;
  }
  const challengeBoardMatch = pathname.match(/^\/api\/v1\/challenges\/(\d+)\/leaderboard\/$/);
  if (challengeBoardMatch && method === "GET") {
    const board = getChallengeLeaderboard(Number(challengeBoardMatch[1]), currentCompanyId ?? -1);
    if (!board) {
      sendJson(res, { error: "Challenge not found" }, 404);
      return true;
    }
    sendJson(res, board);
    return true;
  }

  // Courses & Education: /api/courses/
  if ((pathname === "/api/courses/" || pathname === "/api/courses") && method === "GET") {
    sendJson(res, listCourses());
    return true;
  }
  if ((pathname === "/api/courses/" || pathname === "/api/courses") && method === "POST") {
    const body = await readJsonBody(req);
    if (!body.name || !String(body.name).trim()) {
      sendJson(res, { error: "Course name required" }, 400);
      return true;
    }
    sendJson(res, createCourse(String(body.teacher ?? ""), String(body.name), String(body.start ?? ""), currentCompanyId));
    return true;
  }
  const courseMatch = pathname.match(/^\/api\/courses\/(\d+)\/$/);
  if (courseMatch) {
    const courseId = Number(courseMatch[1]);
    if (method === "GET") {
      const course = getCourse(courseId);
      if (!course) {
        sendJson(res, { error: "Course not found" }, 404);
        return true;
      }
      sendJson(res, course);
      return true;
    }
    if (method === "PATCH") {
      const body = await readJsonBody(req);
      const updated = updateCourse(courseId, {
        start: body.start === true ? true : undefined,
        maxStudents: typeof body.maxStudents === "number" ? body.maxStudents : undefined,
        studentsPaying: typeof body.studentsPaying === "boolean" ? body.studentsPaying : undefined,
        publicChatroomsDisabled: typeof body.publicChatroomsDisabled === "boolean" ? body.publicChatroomsDisabled : undefined,
        html: typeof body.html === "string" ? body.html : undefined
      });
      if (!updated) {
        sendJson(res, { error: "Course not found" }, 404);
        return true;
      }
      sendJson(res, updated);
      return true;
    }
    if (method === "DELETE") {
      sendJson(res, { success: deleteCourse(courseId) });
      return true;
    }
  }
  if (currentCompanyId && pathname.match(/^\/api\/courses\/\d+\/join\/$/) && method === "POST") {
    const courseId = Number(pathname.match(/^\/api\/courses\/(\d+)\/join\/$/)![1]);
    const company = getCompanyById(currentCompanyId);
    if (!company) {
      sendJson(res, { error: "Company not found" }, 404);
      return true;
    }
    joinCourse(courseId, currentCompanyId, company.name, company.logo ?? null, company.realm_id ?? 0);
    sendJson(res, { success: true });
    return true;
  }
  if (pathname.startsWith("/api/courses/")) {
    sendJson(res, { courses: [], invitations: [], students: [] });
    return true;
  }

  // Contests: GET /api/v3/:realm/contest/:id/
  const contestMatch = pathname.match(/^\/api\/v3\/[^/]+\/(\d+)\/contest\/(\d+)\/$/);
  if (contestMatch && method === "GET") {
    const contest = getContestView(Number(contestMatch[1]), Number(contestMatch[2]));
    if (!contest) {
      sendJson(res, { error: "Contest not found" }, 404);
      return true;
    }
    sendJson(res, contest);
    return true;
  }

  return false;
}
