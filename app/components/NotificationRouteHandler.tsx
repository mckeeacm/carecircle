"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

type NotificationExtra = {
  url?: unknown;
  patientId?: unknown;
};

function resolveNotificationUrl(extra: NotificationExtra | null | undefined) {
  if (typeof extra?.url === "string" && extra.url.startsWith("/")) {
    return extra.url;
  }

  if (typeof extra?.patientId === "string" && extra.patientId.trim()) {
    return `/app/patients/${extra.patientId}/today`;
  }

  return null;
}

export default function NotificationRouteHandler() {
  const router = useRouter();

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    let active = true;

    const setup = async () => {
      const listener = await LocalNotifications.addListener(
        "localNotificationActionPerformed",
        (event) => {
          if (!active) return;

          const url = resolveNotificationUrl(
            (event.notification?.extra as NotificationExtra | null | undefined) ?? null
          );

          if (url) {
            router.push(url);
          }
        }
      );

      return listener;
    };

    const listenerPromise = setup();

    return () => {
      active = false;
      void listenerPromise.then((listener) => listener.remove()).catch(() => undefined);
    };
  }, [router]);

  return null;
}
