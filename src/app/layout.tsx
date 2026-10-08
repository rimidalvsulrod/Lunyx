import type { Metadata, Viewport } from "next";
import "./editor.css";

export const metadata: Metadata = {
  title: "Lunyx · Video Editor",
  description: "A full video editor that runs in your browser. Cinematic filters, auto captions, silence removal, background cutout and lighting. Everything stays on your device.",
  applicationName: "Lunyx",
  manifest: "/cut/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Lunyx", statusBarStyle: "black-translucent" },
  icons: { apple: "/cut/icon-180.png", icon: [{ url: "/cut/logo.svg", type: "image/svg+xml" }, { url: "/cut/icon-32.png", sizes: "32x32" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#000" }}>{children}</body>
    </html>
  );
}
