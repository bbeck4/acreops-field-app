// Centralised role helpers for the field app. Mirror of the web app helper
// at artifacts/agri-platform/src/lib/roles.ts — keep the role keys in sync
// between the two so a member sees a consistent role-aware UX across web and
// mobile. NOTE: the PRIORITY order below intentionally differs from web (see
// the comment on PRIORITY) so multi-role members land on the full dashboard.

export const ROLE_KEYS = {
  admin: "admin",
  manager: "manager",
  rep: "rep",
  agronomist: "agronomist",
  serviceTech: "service_tech",
  warehouse: "warehouse",
  fulfillment: "fulfillment",
  deliveryDriver: "delivery_driver",
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

const LEGACY: Record<string, RoleKey> = {
  admin: "admin",
  manager: "manager",
  "sales rep": "rep",
  rep: "rep",
  agronomist: "agronomist",
  warehouse: "warehouse",
  fulfillment: "fulfillment",
  "service tech": "service_tech",
  service_tech: "service_tech",
  driver: "delivery_driver",
  "delivery driver": "delivery_driver",
  delivery_driver: "delivery_driver",
};

export function normaliseRole(role: string | null | undefined): RoleKey {
  if (!role) return "rep";
  const key = role.toLowerCase().trim();
  return LEGACY[key] ?? "rep";
}

// Priority order used to pick a single "primary" home for a multi-role member.
// Management (admin/manager) and the specialty service-tech track win first.
// Then the *full-dashboard* CRM roles (agronomist, rep) outrank the operational
// stub roles (warehouse, fulfillment, delivery_driver): a member only lands on
// an operational stub when they hold NO full-dashboard role. This intentionally
// diverges from the web helper's order (web ranks operational roles above
// agronomist/rep) because the mobile home collapses a member down to a single
// track, and a rep/agronomist who also does warehouse work must still get the
// rich dashboard — they reach operational tools via the permission-gated tabs.
const PRIORITY: RoleKey[] = [
  "admin",
  "manager",
  "service_tech",
  "agronomist",
  "rep",
  "warehouse",
  "fulfillment",
  "delivery_driver",
];

export function pickPrimaryRole(roles: RoleKey[], fallback: RoleKey = "rep"): RoleKey {
  for (const r of PRIORITY) if (roles.includes(r)) return r;
  return fallback;
}

// Operational tracks, highest-priority first. These are the roles that render
// a dedicated operational day-runner home (warehouse/fulfillment/delivery)
// rather than the full dashboard. service_tech is intentionally excluded — it
// has its own real day-runner screen too, handled separately.
const OPERATIONAL_PRIORITY: RoleKey[] = [
  "warehouse",
  "fulfillment",
  "delivery_driver",
];

// Returns the member's single operational track (if any), respecting the same
// priority order used elsewhere. null when the member holds no operational role.
export function pickOperationalRole(roles: RoleKey[]): RoleKey | null {
  for (const r of OPERATIONAL_PRIORITY) if (roles.includes(r)) return r;
  return null;
}

export function isManager(roles: RoleKey[]): boolean {
  return roles.includes("admin") || roles.includes("manager");
}

// Tab-bar gating. Same contract as the web helper: admin and manager always
// see every tab; otherwise the tab is visible if it is unrestricted or the
// user has at least one of the allowed roles. Adding a new role = list it
// on whichever tabs it should see — no per-tab branching needed.
export function canSeeTab(
  allowed: RoleKey[] | undefined,
  userRoles: RoleKey[],
): boolean {
  if (isManager(userRoles)) return true;
  if (!allowed || allowed.length === 0) return true;
  return allowed.some((r) => userRoles.includes(r));
}
