import { describe, expect, it } from "vitest";
import {
  assignmentFromTask,
  deriveVisibilityAndAssignee,
  canChangeAssignment,
  isMineOrTeam,
  assignmentLabel,
  type AssignmentMode,
} from "./taskAssignment";

// ---------------------------------------------------------------------------
// assignmentFromTask
// ---------------------------------------------------------------------------
describe("assignmentFromTask", () => {
  it("defaults to self-assigned when creating a new task with a known member", () => {
    const result = assignmentFromTask(null, 7);
    expect(result).toEqual({ kind: "member", memberId: 7 });
  });

  it("defaults to unassigned when creating a new task without a current member", () => {
    const result = assignmentFromTask(null, undefined);
    expect(result).toEqual({ kind: "unassigned" });
  });

  it("maps organization visibility to 'team' kind", () => {
    const task = { visibility: "organization" as const, assigneeId: null, ownerId: 1 };
    expect(assignmentFromTask(task, 1)).toEqual({ kind: "team" });
  });

  it("maps private visibility with an assignee to 'member' kind", () => {
    const task = { visibility: "private" as const, assigneeId: 5, ownerId: 1 };
    expect(assignmentFromTask(task, 1)).toEqual({ kind: "member", memberId: 5 });
  });

  it("maps private visibility without an assignee to 'unassigned' kind", () => {
    const task = { visibility: "private" as const, assigneeId: null, ownerId: 1 };
    expect(assignmentFromTask(task, 1)).toEqual({ kind: "unassigned" });
  });
});

// ---------------------------------------------------------------------------
// deriveVisibilityAndAssignee
// ---------------------------------------------------------------------------
describe("deriveVisibilityAndAssignee", () => {
  it("maps 'team' kind to organization visibility with null assigneeId", () => {
    const result = deriveVisibilityAndAssignee({ kind: "team" });
    expect(result).toEqual({ visibility: "organization", assigneeId: null });
  });

  it("maps 'unassigned' kind to private visibility with null assigneeId", () => {
    const result = deriveVisibilityAndAssignee({ kind: "unassigned" });
    expect(result).toEqual({ visibility: "private", assigneeId: null });
  });

  it("maps 'member' kind to private visibility with the correct memberId as assigneeId", () => {
    const result = deriveVisibilityAndAssignee({ kind: "member", memberId: 42 });
    expect(result).toEqual({ visibility: "private", assigneeId: 42 });
  });
});

// ---------------------------------------------------------------------------
// canChangeAssignment
// ---------------------------------------------------------------------------
describe("canChangeAssignment", () => {
  it("always allows assignment change when creating a new task (no existing task)", () => {
    expect(canChangeAssignment(null, 1)).toBe(true);
    expect(canChangeAssignment(undefined, undefined)).toBe(true);
  });

  it("allows the owner to change assignment on an existing task", () => {
    const task = { visibility: "private" as const, assigneeId: 3, ownerId: 5 };
    expect(canChangeAssignment(task, 5)).toBe(true);
  });

  it("prevents non-owners from changing assignment on an existing task", () => {
    const task = { visibility: "private" as const, assigneeId: 3, ownerId: 5 };
    expect(canChangeAssignment(task, 99)).toBe(false);
  });

  it("prevents assignees who are not the owner from changing assignment", () => {
    const task = { visibility: "private" as const, assigneeId: 3, ownerId: 5 };
    expect(canChangeAssignment(task, 3)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMineOrTeam  — mine-only filter logic
// ---------------------------------------------------------------------------
describe("isMineOrTeam", () => {
  const myId = 10;

  it("includes organization-visibility tasks regardless of assigneeId", () => {
    expect(isMineOrTeam({ visibility: "organization", assigneeId: null }, myId)).toBe(true);
    expect(isMineOrTeam({ visibility: "organization", assigneeId: 99 }, myId)).toBe(true);
  });

  it("includes private tasks assigned to the current member", () => {
    expect(isMineOrTeam({ visibility: "private", assigneeId: myId }, myId)).toBe(true);
  });

  it("excludes private tasks assigned to someone else", () => {
    expect(isMineOrTeam({ visibility: "private", assigneeId: 99 }, myId)).toBe(false);
  });

  it("excludes unassigned private tasks when filtering mine-only", () => {
    expect(isMineOrTeam({ visibility: "private", assigneeId: null }, myId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assignmentLabel
// ---------------------------------------------------------------------------
describe("assignmentLabel", () => {
  const memberName = (id: number) => (id === 7 ? "Alice" : undefined);

  it("returns 'Entire team' for team kind", () => {
    expect(assignmentLabel({ kind: "team" }, memberName)).toBe("Entire team");
  });

  it("returns 'Unassigned' for unassigned kind", () => {
    expect(assignmentLabel({ kind: "unassigned" }, memberName)).toBe("Unassigned");
  });

  it("returns the member name for a known member id", () => {
    expect(assignmentLabel({ kind: "member", memberId: 7 }, memberName)).toBe("Alice");
  });

  it("returns 'Unknown member' when the member id is not found", () => {
    expect(assignmentLabel({ kind: "member", memberId: 999 }, memberName)).toBe("Unknown member");
  });
});
