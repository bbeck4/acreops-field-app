// Permission-based gating for the field app. Mirror of the web helper at
// artifacts/agri-platform/src/lib/permissions.ts. Reads the signed-in member's
// effective permission set (computed server-side from the role → permission
// matrix and delivered on the member profile) and exposes convenient checks.
//
// Superuser roles (admin, senior_manager) receive every permission key from
// the server, and managers receive all-but-matrix-edit, so `has(...)` returns
// true for them without any special-casing here.
//
// Permission keys are `${area}.${action}` strings matching the shared catalog
// in lib/api-zod/src/permissions.ts. The field app does not depend on that
// package, so the keys it needs are referenced as literals below.

import { useMemo } from "react";

import { useAppAuth } from "@/context/AuthContext";

// Tab name (file under app/(tabs)) → the permission that unlocks it. A member
// sees a tab only if they hold this permission. Tabs without an entry are
// always visible (e.g. the dashboard home).
export const TAB_PERMISSIONS: Record<string, string | undefined> = {
  index: undefined, // Dashboard always visible
  customers: "customers.view",
  "my-day": "service.view",
  tasks: "tasks.view",
  inventory: "inventory.view",
  routes: "routes.view",
  loads: "dispatch.view",
  map: "map.view",
  orders: "work_orders.view",
  inbox: "sms.view",
};

export function usePermissions() {
  const { currentMember, isLoading } = useAppAuth();

  return useMemo(() => {
    const permissions = currentMember?.permissions ?? [];
    const roleKeys = currentMember?.roleKeys ?? [];
    const permSet = new Set(permissions);
    const has = (key: string): boolean => permSet.has(key);
    const hasAny = (...keys: string[]): boolean => keys.some((k) => permSet.has(k));
    const hasAll = (...keys: string[]): boolean => keys.every((k) => permSet.has(k));
    // Profile carries permissions once loaded. Until then the permission set is
    // empty, so gating is default-deny while the profile resolves — matching the
    // web hook (artifacts/agri-platform/src/lib/permissions.ts), which reads an
    // empty set as "no access" rather than briefly exposing restricted UI.
    const ready = !!currentMember && !isLoading;
    return {
      ready,
      permissions,
      roleKeys,
      has,
      hasAny,
      hasAll,
      // Tab visibility: a member sees a mapped tab only if they hold the
      // permission. Unmapped tabs (e.g. the dashboard home) are always visible.
      canSeeTab: (name: string): boolean => {
        const required = TAB_PERMISSIONS[name];
        if (!required) return true;
        return permSet.has(required);
      },
      // Action gating: strict — the control is shown only when the member holds
      // the permission. Before the profile loads the set is empty (deny).
      canDo: (key: string): boolean => permSet.has(key),
    };
  }, [currentMember, isLoading]);
}
