import type { ReactNode } from "react";
import "./globals.css";
import NotificationRouteHandler from "@/app/components/NotificationRouteHandler";
import UserLanguageProvider from "@/app/components/UserLanguageProvider";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UserLanguageProvider>
          <NotificationRouteHandler />
          {children}
        </UserLanguageProvider>
      </body>
    </html>
  );
}
