import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.carecircle.app",
  appName: "CareCircle",
  webDir: "out",
  loggingBehavior: "debug",
  backgroundColor: "#e8f3ef",
  server: {
    url: "https://carecircletest.vercel.app",
    cleartext: false,
    allowNavigation: ["https://carecircletest.vercel.app"]
  },
  ios: {
    contentInset: "automatic"
  },
  android: {
    allowMixedContent: false
  }
};

export default config;