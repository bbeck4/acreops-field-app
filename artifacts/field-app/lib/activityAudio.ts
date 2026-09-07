interface AudioBackedActivity {
  audioPath?: string | null;
}

export function isAudioBackedActivity(activity: AudioBackedActivity): boolean {
  return typeof activity.audioPath === "string" && activity.audioPath.trim().length > 0;
}

export function activityNotesLineLimit(
  activity: AudioBackedActivity,
  expanded: boolean,
): number | undefined {
  if (isAudioBackedActivity(activity) || expanded) return undefined;
  return 4;
}