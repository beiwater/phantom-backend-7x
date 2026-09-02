import { runInTransaction } from '../../db/transaction.ts';
import { socialRepository, type PollRow } from '../../repositories/social-repository.ts';

export interface CourseView {
  id: number;
  name: string;
  teacher: { id: number; company: string; realmId: number; level: number; logo: string | null; email: string | null } | null;
  start: string | null;
  started: boolean;
  maxStudents: number;
  indicatedStudents: number;
  monthsPaid: number;
  paidUsd: number;
  studentsPaying: boolean;
  publicChatroomsDisabled: boolean;
  html: string | null;
  students: Array<{ id: number; company: string; realmId: number; logo: string | null }>;
  invites: Array<unknown>;
}

function toView(row: PollRow, withStudents: boolean): CourseView {
  const courseId = Number(row.id);
  const students = withStudents
    ? socialRepository.listCourseStudents(courseId).map(s => ({
        id: Number(s.company_id),
        company: String(s.company_name ?? ''),
        realmId: Number(s.company_realm_id ?? 0),
        logo: (s.company_logo as string | null) ?? null
      }))
    : [];
  return {
    id: courseId,
    name: String(row.name),
    teacher: row.teacher_company_id ? {
      id: Number(row.teacher_company_id),
      company: String(row.teacher_name ?? ''),
      realmId: 0,
      level: Number(row.teacher_level ?? 0),
      logo: null,
      email: (row.teacher_email as string | null) ?? null
    } : null,
    start: (row.start as string | null) ?? null,
    started: Boolean(row.started),
    maxStudents: Number(row.max_students ?? 10),
    indicatedStudents: Number(row.indicated_students ?? 0),
    monthsPaid: Number(row.months_paid ?? 0),
    paidUsd: Number(row.paid_usd ?? 0),
    studentsPaying: Boolean(row.students_paying),
    publicChatroomsDisabled: Boolean(row.public_chatrooms_disabled),
    html: (row.html as string | null) ?? null,
    students,
    invites: []
  };
}

/** Player-facing course detail. */
export function getCourse(courseId: number): CourseView | null {
  const row = socialRepository.getCourseById(courseId);
  return row ? toView(row, true) : null;
}

/** Admin course list (the courses console replaces its state with it). */
export function listCourses(): CourseView[] {
  return socialRepository.listCourses().map(row => toView(row, false));
}

/** Create a course request: POST {teacher, name, start}. Response is the
 * refreshed list (the console replaces its state with it). */
export function createCourse(teacher: string, name: string, start: string, teacherCompanyId?: number | null): CourseView[] {
  runInTransaction(() => {
    socialRepository.insertCourse(teacherCompanyId ?? null, teacher, name, start || null);
  });
  return listCourses();
}

export function updateCourse(courseId: number, patch: {
  start?: boolean; maxStudents?: number; studentsPaying?: boolean;
  publicChatroomsDisabled?: boolean; requestEmailChange?: boolean; html?: string;
}): CourseView | null {
  if (!socialRepository.getCourseById(courseId)) return null;
  runInTransaction(() => {
    if (patch.start !== undefined) socialRepository.setCourseStarted(courseId, patch.start);
    socialRepository.updateCourseFields(
      courseId,
      patch.maxStudents,
      patch.studentsPaying,
      patch.publicChatroomsDisabled,
      patch.html
    );
  });
  return getCourse(courseId);
}

export function deleteCourse(courseId: number): boolean {
  return socialRepository.deleteCourseById(courseId);
}

export function joinCourse(courseId: number, companyId: number, companyName: string, logo: string | null, realmId: number): void {
  runInTransaction(() => {
    socialRepository.addCourseStudentIfAbsent(courseId, companyId, companyName, logo, realmId);
  });
}
