import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "lenis/dist/lenis.css";
import appIcon from "../../ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: "Vital Agent Sync | Private Apple Health context for AI agents",
  description:
    "Run Vital Agent Sync on your machine, pair over trusted LAN, and optionally use your own Tailscale network for private remote access.",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [{ url: appIcon.src, type: "image/png", sizes: "1024x1024" }],
    apple: [{ url: appIcon.src, type: "image/png", sizes: "1024x1024" }],
  },
  openGraph: {
    title: "Vital Agent Sync | Apple Health context. Private by design.",
    description:
      "Fresh, scoped Apple Health context for your AI agent through a user-owned LAN or Tailscale receiver.",
    type: "website",
    images: [{ url: "/og.png", width: 1730, height: 909, alt: "Vital Agent Sync private Apple Health context" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vital Agent Sync | Apple Health context. Private by design.",
    description: "Fresh, scoped Apple Health context for your AI agent.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
