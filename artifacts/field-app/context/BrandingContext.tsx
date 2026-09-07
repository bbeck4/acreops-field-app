import React, { createContext, useContext, useEffect, useState } from "react";

// White-label company branding for the app shell (sign-in / sign-up logo + name
// and in-app headers). Fetched from the PUBLIC branding endpoint — no auth token
// required — so the pre-auth sign-in screens can show operator branding too. The
// company logo + name are already public (rendered on no-login document links).
// Best-effort: on any failure the fields stay null and callers render the
// platform defaults.
interface Branding {
  name: string | null;
  logoUrl: string | null;
}

const BrandingContext = createContext<Branding>({ name: null, logoUrl: null });

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<Branding>({ name: null, logoUrl: null });

  useEffect(() => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) return;
    let cancelled = false;
    fetch(`https://${domain}/api/settings/company-branding/public`)
      .then((res) => (res.ok ? res.json() : null))
      .then((d: { name?: string | null; logoUrl?: string | null } | null) => {
        if (cancelled || !d) return;
        setBranding({
          name: d.name ?? null,
          // The endpoint returns a relative logo path; make it absolute so
          // React Native's <Image> can load it over the network.
          logoUrl: d.logoUrl ? `https://${domain}${d.logoUrl}` : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
