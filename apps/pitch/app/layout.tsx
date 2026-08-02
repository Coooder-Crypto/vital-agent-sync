import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import appIcon from "../../ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vital Agent Sync | Competition Deck",
  description: "A presentation about private, user-owned context for AI agents.",
  icons: {
    icon: [{ url: appIcon.src, type: "image/png", sizes: "1024x1024" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
