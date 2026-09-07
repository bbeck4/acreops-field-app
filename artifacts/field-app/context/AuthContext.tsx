import { useAuth } from "@clerk/expo";
import { setDeactivatedHandler } from "@workspace/api-client-react";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

interface Member {
  id: number;
  name: string;
  email?: string | null;
  role?: string | null;
  planId?: number | null;
  // Canonical role keys and the member's effective permission keys, computed
  // server-side from the role → permission matrix. Drive permission-based
  // gating of tabs and actions (mirrors the web platform).
  roleKeys?: string[];
  permissions?: string[];
}

interface AuthContextValue {
  currentMember: Member | null;
  claimMember: (memberId: number) => Promise<Member | null>;
  isLoading: boolean;
  // True when the member-profile fetch returned a 403 (account deactivated).
  // A final state: the app shows a deactivation screen, not the claim flow.
  isDeactivated: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  currentMember: null,
  claimMember: async () => null,
  isLoading: true,
  isDeactivated: false,
});

// Result of a member-profile fetch. `deactivated` distinguishes a server 403
// (account turned off) from a plain "no linked profile" / transient miss, so
// the navigation can route a deactivated user to a clear final screen instead
// of the claim flow.
type ProfileResult = { member: Member | null; deactivated: boolean };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn, getToken, userId } = useAuth();
  const [currentMember, setCurrentMember] = useState<Member | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeactivated, setIsDeactivated] = useState(false);
  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);

  // Mid-session revocation: when an admin deactivates a signed-in rep, their
  // next data call returns a 403 "Account deactivated". Flip isDeactivated so
  // the root navigation gate routes the live session to the deactivation
  // screen — the same final state the launch-time member-profile gate uses,
  // without needing a relaunch.
  useEffect(() => {
    setDeactivatedHandler(() => setIsDeactivated(true));
    return () => setDeactivatedHandler(null);
  }, []);

  // Fetch the full member profile (includes roleKeys + effective permissions).
  const fetchProfile = useCallback(async (): Promise<ProfileResult> => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return { member: null, deactivated: false };
    const token = await getTokenRef.current();
    if (!token) return { member: null, deactivated: false };
    const res = await fetch(`https://${domain}/api/auth/member-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 403 means the account is deactivated — a final answer. Mirror the web
    // MemberGate, which shows a clear "Your account has been deactivated"
    // screen rather than the claim flow.
    if (res.status === 403) return { member: null, deactivated: true };
    if (!res.ok) return { member: null, deactivated: false };
    return { member: (await res.json()) as Member, deactivated: false };
  }, []);

  useEffect(() => {
    if (!isSignedIn || !userId) {
      setCurrentMember(null);
      setIsDeactivated(false);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    fetchProfile()
      .then(({ member, deactivated }) => {
        if (!cancelled) {
          setCurrentMember(member);
          setIsDeactivated(deactivated);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, userId, fetchProfile]);

  const claimMember = useCallback(
    async (memberId: number): Promise<Member | null> => {
      const domain = process.env.EXPO_PUBLIC_DOMAIN;
      if (!domain) return null;
      const token = await getTokenRef.current();
      if (!token) return null;
      const res = await fetch(`https://${domain}/api/auth/claim-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ memberId }),
      });
      if (!res.ok) return null;
      // The claim response carries only basic fields; re-fetch the profile so
      // roleKeys + permissions are populated for gating right after claiming.
      // If that refetch fails (transient network), fall back to the claim
      // response so a successful server-side claim never traps the user — the
      // background effect will repopulate permissions on its next run.
      let profile: Member | null = null;
      try {
        profile = (await fetchProfile()).member;
      } catch {
        profile = null;
      }
      if (!profile) profile = (await res.json()) as Member;
      setCurrentMember(profile);
      setIsDeactivated(false);
      return profile;
    },
    [fetchProfile],
  );

  return (
    <AuthContext.Provider value={{ currentMember, claimMember, isLoading, isDeactivated }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAppAuth = () => useContext(AuthContext);
