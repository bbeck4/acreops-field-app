import { describe, expect, it } from "vitest";

import {
  OFFLINE_DATA_OWNER_KEY,
  isSensitiveOfflineKey,
  offlineKeysToClear,
  offlineOwnerIdentity,
} from "./offlineDataIsolation";

describe("offline data identity isolation", () => {
  it("separates signed-in Clerk identities from signed-out state", () => {
    expect(offlineOwnerIdentity(true, "user_a")).toBe("clerk:user_a");
    expect(offlineOwnerIdentity(true, "user_b")).toBe("clerk:user_b");
    expect(offlineOwnerIdentity(false, "user_a")).toBe("signed-out");
    expect(offlineOwnerIdentity(true, null)).toBe("signed-out");
  });

  it("classifies operational caches and pending writes as sensitive", () => {
    expect(isSensitiveOfflineKey("@agriops:pending_writes")).toBe(true);
    expect(isSensitiveOfflineKey("@agriops:cust_ctx:42")).toBe(true);
    expect(isSensitiveOfflineKey("@cache:customers")).toBe(true);
    expect(isSensitiveOfflineKey("clerk-token-cache")).toBe(false);
  });

  it("clears all sensitive keys but preserves auth and owner markers", () => {
    expect(
      offlineKeysToClear([
        OFFLINE_DATA_OWNER_KEY,
        "@agriops:pending_writes",
        "@agriops:svcjob_labor_start_map",
        "@cache:customers",
        "clerk-token-cache",
      ]),
    ).toEqual([
      "@agriops:pending_writes",
      "@agriops:svcjob_labor_start_map",
      "@cache:customers",
    ]);
  });
});