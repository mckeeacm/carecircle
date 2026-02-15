/* global self */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Notification", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "CareCircle";
  const body = payload.body || "You have an update.";
  const url = payload.url || "/app/today";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.png", // optional
      badge: "/badge.png", // optional
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/app/today";

  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => "focus" in c);

      if (existing) {
        existing.focus();
        existing.navigate(url);
        return;
      }
      await clients.openWindow(url);
    })()
  );
});
