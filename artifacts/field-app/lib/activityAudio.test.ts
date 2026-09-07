import { describe, expect, it } from "vitest";

import { activityNotesLineLimit, isAudioBackedActivity } from "./activityAudio";

describe("audio-backed activities", () => {
  it("treats an AI-classified call with audio as a voice memo", () => {
    expect(isAudioBackedActivity({ audioPath: "/objects/voice-notes/call.m4a" })).toBe(true);
  });

  it("shows the complete transcript without a line limit", () => {
    expect(activityNotesLineLimit({ audioPath: "/objects/voice-notes/call.m4a" }, false)).toBeUndefined();
  });

  it("keeps ordinary activity notes collapsed until expanded", () => {
    expect(activityNotesLineLimit({ audioPath: null }, false)).toBe(4);
    expect(activityNotesLineLimit({ audioPath: null }, true)).toBeUndefined();
  });
});