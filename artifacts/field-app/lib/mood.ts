// Quick pre-set "mood" tags a sender can stamp onto a note to signal tone in
// one tap. There's no backend column — the chosen emoji is stored as a prefix
// on the message content (e.g. "🚨 Tank is leaking"). Storing the bare emoji
// (not an opaque marker) means the tone degrades gracefully anywhere content
// shows without mood-aware parsing. This module is the single source of truth
// so every surface that shows a note (board, home feed) renders the same badge
// and strips the same prefix from the body.
export const MOOD_OPTIONS = [
  { value: "urgent", emoji: "🚨", label: "Urgent" },
  { value: "done", emoji: "✅", label: "Done" },
  { value: "fyi", emoji: "📋", label: "FYI" },
  { value: "question", emoji: "❓", label: "Question" },
  { value: "win", emoji: "🎉", label: "Win" },
  { value: "idea", emoji: "💡", label: "Idea" },
] as const;

export type MoodOption = (typeof MOOD_OPTIONS)[number];

// Pull a leading mood emoji off the content so a surface can render it as a
// badge and show the message body on its own.
export function splitMood(content: string): { mood: MoodOption | null; body: string } {
  for (const m of MOOD_OPTIONS) {
    if (content.startsWith(m.emoji + " ")) {
      return { mood: m, body: content.slice(m.emoji.length + 1) };
    }
    if (content === m.emoji) {
      return { mood: m, body: "" };
    }
  }
  return { mood: null, body: content };
}

// Re-attach the selected mood emoji as a prefix when saving.
export function withMood(moodValue: string | null, body: string): string {
  if (!moodValue) return body;
  const m = MOOD_OPTIONS.find((o) => o.value === moodValue);
  return m ? `${m.emoji} ${body}` : body;
}
