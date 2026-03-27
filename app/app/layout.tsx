import type { ReactNode } from "react";
import "./globals.css";
import NotificationRouteHandler from "@/app/components/NotificationRouteHandler";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NotificationRouteHandler />
        {children}
      </body>
    </html>
  );
}
