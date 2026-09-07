/**
 * Pure helpers for task assignment / visibility derivation.
 *
 * "Entire team" → visibility='organization', assigneeId=null
 * Individual or unassigned → visibility='private', assigneeId=<id>|null
 *
 * Only the task owner may change visibility on edit.
 */

export type AssignmentMode =
  | { kind: "team" }
  | { kind: "unassigned" }
  | { kind: "member"; memberId: number };

export interface TaskLike {
  visibility: "organization" | "private";
  assigneeId?: number | null;
  ownerId: number | null;
}

/** Derive AssignmentMode from an existing task or create defaults. */
export function assignmentFromTask(
  task: TaskLike | null | undefined,
  currentMemberId: number | undefined,
): AssignmentMode {
  if (!task) {
    return currentMemberId != null
      ? { kind: "member", memberId: currentMemberId }
      : { kind: "unassigned" };
  }
  if (task.visibility === "organization") return { kind: "team" };
  if (task.assigneeId != null) return { kind: "member", memberId: task.assigneeId };
  return { kind: "unassigned" };
}

/** Derive API-level visibility and assigneeId from current assignment state. */
export function deriveVisibilityAndAssignee(assignment: AssignmentMode): {
  visibility: "organization" | "private";
  assigneeId: number | null;
} {
  if (assignment.kind === "team") {
    return { visibility: "organization", assigneeId: null };
  }
  if (assignment.kind === "member") {
    return { visibility: "private", assigneeId: assignment.memberId };
  }
  return { visibility: "private", assigneeId: null };
}

/** Whether the current user can change the assignment / visibility field. */
export function canChangeAssignment(
  task: TaskLike | null | undefined,
  currentMemberId: number | undefined,
): boolean {
  if (!task) return true; // creating a new task
  return task.ownerId === currentMemberId;
}

/**
 * In "mine-only" mode, a task should be visible if:
 *  - it is assigned to the entire team (visibility='organization'), OR
 *  - it is explicitly assigned to the current member.
 */
export function isMineOrTeam(
  task: { visibility: string; assigneeId?: number | null },
  currentMemberId: number,
): boolean {
  return task.visibility === "organization" || task.assigneeId === currentMemberId;
}

/** Human-readable label for the assignment state shown in the form row. */
export function assignmentLabel(
  assignment: AssignmentMode,
  memberName: (id: number) => string | undefined,
): string {
  if (assignment.kind === "team") return "Entire team";
  if (assignment.kind === "unassigned") return "Unassigned";
  return memberName(assignment.memberId) ?? "Unknown member";
}
