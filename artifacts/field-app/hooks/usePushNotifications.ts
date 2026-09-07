import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { useRegisterPushToken } from "@workspace/api-client-react";

import { useAppAuth } from "@/context/AuthContext";

// In Expo Go (SDK 53+), remote push notifications were removed on Android and
// even importing expo-notifications throws. Lazy-require the module only when
// we know we are NOT in Expo Go, so the app still loads in the workspace preview.
const isExpoGo = Constants.appOwnership === "expo";

type NotificationsModule = typeof import("expo-notifications");

let cachedNotifications: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (cachedNotifications) return cachedNotifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    cachedNotifications = require("expo-notifications") as NotificationsModule;
    return cachedNotifications;
  } catch {
    return null;
  }
}

const Notifications = getNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowAlert: true,
    }),
  });
}

async function getProjectId(): Promise<string | undefined> {
  const easId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
  const easConfigId =
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return easId ?? easConfigId;
}

async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const N = getNotifications();
  if (!N) return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await N.setNotificationChannelAsync("default", {
      name: "default",
      importance: N.AndroidImportance.DEFAULT,
      lightColor: "#4ade80",
    });
  }

  const existing = await N.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await N.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  try {
    const projectId = await getProjectId();
    const tokenResp = await N.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenResp.data ?? null;
  } catch {
    return null;
  }
}

function handleNotificationResponse(response: any) {
  const data = response.notification.request.content.data as
    | {
        type?: string;
        threadId?: number | string;
        taskId?: number | string;
        customerId?: number | string;
        activityId?: number | string;
        workOrderId?: number | string;
        blanketId?: number | string;
        phone?: string;
      }
    | undefined;
  if (data?.type === "blanket_expiring") {
    const blanketId =
      typeof data.blanketId === "number"
        ? data.blanketId
        : data.blanketId
        ? Number(data.blanketId)
        : NaN;
    if (Number.isFinite(blanketId) && blanketId > 0) {
      router.push(`/blanket/${blanketId}` as never);
    }
  } else if (data?.type === "board_post") {
    const threadId =
      typeof data.threadId === "number"
        ? data.threadId
        : data.threadId
        ? Number(data.threadId)
        : NaN;
    if (Number.isFinite(threadId) && threadId > 0) {
      router.push(`/board?thread=${threadId}` as never);
    } else {
      router.push("/board" as never);
    }
  } else if (data?.type === "task_deployed") {
    const taskId =
      typeof data.taskId === "number"
        ? data.taskId
        : data.taskId
        ? Number(data.taskId)
        : NaN;
    // Tasks currently open in the tab view; keep the id in the URL so a future
    // task-detail screen can use the same notification payload.
    const suffix = Number.isFinite(taskId) && taskId > 0 ? `?task=${taskId}` : "";
    router.push(`/tasks${suffix}` as never);
  } else if (data?.type === "customer_activity") {
    const customerId =
      typeof data.customerId === "number"
        ? data.customerId
        : data.customerId
        ? Number(data.customerId)
        : NaN;
    const activityId =
      typeof data.activityId === "number"
        ? data.activityId
        : data.activityId
        ? Number(data.activityId)
        : NaN;
    if (Number.isFinite(customerId) && customerId > 0) {
      const activitySuffix =
        Number.isFinite(activityId) && activityId > 0 ? `&activity=${activityId}` : "";
      router.push(`/customer/${customerId}?tab=activity${activitySuffix}` as never);
    }
  } else if (data?.type === "sms_inbox") {
    const phone = typeof data.phone === "string" ? data.phone : undefined;
    if (phone) {
      router.push(`/more/inbox/${encodeURIComponent(phone)}` as never);
    } else {
      router.push(`/more/inbox` as never);
    }
  } else if (
    data?.type === "territory_decision" ||
    data?.type === "margin_decision" ||
    data?.type === "margin_floor_pending"
  ) {
    const workOrderId =
      typeof data.workOrderId === "number"
        ? data.workOrderId
        : data.workOrderId
        ? Number(data.workOrderId)
        : NaN;
    if (Number.isFinite(workOrderId) && workOrderId > 0) {
      // A below-floor "pending" alert deep-links straight to the margin
      // approval banner so the manager can approve/deny without hunting for it.
      const focus = data.type === "margin_floor_pending" ? "?focus=margin" : "";
      router.push(`/order/${workOrderId}${focus}` as never);
    }
  }
}

export function usePushNotifications() {
  const { currentMember } = useAppAuth();
  const registerMutation = useRegisterPushToken();
  const lastRegisteredFor = useRef<string | null>(null);

  // Register the device token whenever a member becomes active.
  useEffect(() => {
    if (!currentMember) return;
    const memberKey = String(currentMember.id);
    if (lastRegisteredFor.current === memberKey) return;

    let cancelled = false;
    (async () => {
      const token = await registerForPush();
      if (cancelled || !token) return;
      try {
        await registerMutation.mutateAsync({ data: { token } });
        lastRegisteredFor.current = memberKey;
      } catch {
        // best-effort; we'll retry next session
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMember?.id]);

  // Handle taps on the notification (both warm and cold start).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const N = getNotifications();
    if (!N) return;
    const sub = N.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );
    N.getLastNotificationResponseAsync().then((resp) => {
      if (resp) handleNotificationResponse(resp);
    });
    return () => sub.remove();
  }, []);

  // Clear the badge whenever the board screen is opened (the screen itself
  // already calls markBoardSeen). Best-effort: ignore failures.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const N = getNotifications();
    if (!N) return;
    N.setBadgeCountAsync(0).catch(() => {});
  }, []);
}
