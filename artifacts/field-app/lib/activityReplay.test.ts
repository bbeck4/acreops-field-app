import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postActivity } from "@/lib/activityReplay";
import { PermanentSyncError } from "@/lib/offlineSyncError";

const DOMAIN = "test.example.com";
const TOKEN = "test-token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("postActivity replay", () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DOMAIN = DOMAIN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXPO_PUBLIC_DOMAIN;
  });

  it("posts the queued activity with its bearer token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(201, { id: 42 }));
    const payload = { customerId: 7, type: "visit", subject: "Checked north field" };

    await expect(postActivity(payload, TOKEN)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      `https://${DOMAIN}/api/activities`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` }),
        body: JSON.stringify(payload),
      }),
    );
  });

  it("classifies a 409 as a visible permanent conflict", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(409, { error: "The customer record changed." }),
    );

    const error = await postActivity({ customerId: 7 }, TOKEN).catch((cause) => cause);

    expect(error).toBeInstanceOf(PermanentSyncError);
    expect((error as PermanentSyncError).serverMessage).toMatch(/conflict.*409/i);
    expect((error as PermanentSyncError).serverMessage).toMatch(/customer record changed/i);
  });

  it("classifies other 4xx responses as permanent rejections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad Request", { status: 400 }),
    );

    const error = await postActivity({ customerId: 7 }, TOKEN).catch((cause) => cause);

    expect(error).toBeInstanceOf(PermanentSyncError);
    expect((error as PermanentSyncError).serverMessage).toMatch(/HTTP 400/i);
  });

  it("keeps 5xx responses transient so they can auto-retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(503, { error: "Try again later" }),
    );

    const error = await postActivity({ customerId: 7 }, TOKEN).catch((cause) => cause);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentSyncError);
  });

  it("does not send when no domain is configured", async () => {
    delete process.env.EXPO_PUBLIC_DOMAIN;
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(postActivity({ customerId: 7 }, TOKEN)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});