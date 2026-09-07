import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * Customer mode: when a rep is sitting with a customer, sensitive internal
 * figures (product cost, margin %, low-margin warnings) are hidden from every
 * screen until the rep turns it back off. Persisted so it survives app
 * restarts mid-visit.
 */
const STORAGE_KEY = "@agriops:customer_mode_v1";

type PrivacyContextValue = {
  customerMode: boolean;
  setCustomerMode: (on: boolean) => void;
  toggleCustomerMode: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue>({
  customerMode: false,
  setCustomerMode: () => {},
  toggleCustomerMode: () => {},
});

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [customerMode, setCustomerModeState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === "1") setCustomerModeState(true);
      })
      .catch(() => {});
  }, []);

  const setCustomerMode = useCallback((on: boolean) => {
    setCustomerModeState(on);
    AsyncStorage.setItem(STORAGE_KEY, on ? "1" : "0").catch(() => {});
  }, []);

  const toggleCustomerMode = useCallback(() => {
    setCustomerModeState((prev) => {
      const next = !prev;
      AsyncStorage.setItem(STORAGE_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  }, []);

  return (
    <PrivacyContext.Provider value={{ customerMode, setCustomerMode, toggleCustomerMode }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
