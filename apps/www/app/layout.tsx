import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "lenis/dist/lenis.css";
import appIcon from "../../ios/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png";
import "./globals.css";
import { githubUrl, npmUrl, productSummary, siteUrl, skillHubUrl } from "./site-config";

export const metadata: Metadata = {
  title: {
    default: "Vital Agent Sync | Private Apple Health context for AI agents",
    template: "%s | Vital Agent Sync",
  },
  description: productSummary,
  applicationName: "Vital Agent Sync",
  category: "technology",
  keywords: [
    "Apple Health",
    "HealthKit",
    "AI agent",
    "MCP",
    "Model Context Protocol",
    "local-first",
    "personal context",
    "context scaling",
    "WorkBuddy",
  ],
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: appIcon.src, type: "image/png", sizes: "1024x1024" }],
    apple: [{ url: appIcon.src, type: "image/png", sizes: "1024x1024" }],
  },
  openGraph: {
    title: "Vital Agent Sync | Apple Health context. Private by design.",
    description: productSummary,
    type: "website",
    url: "/",
    siteName: "Vital Agent Sync",
    images: [{ url: "/og.png", width: 1730, height: 909, alt: "Vital Agent Sync private Apple Health context" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vital Agent Sync | Apple Health context. Private by design.",
    description: productSummary,
    images: ["/og.png"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl}/#website`,
      url: siteUrl,
      name: "Vital Agent Sync",
      description: productSummary,
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteUrl}/#software`,
      name: "Vital Agent Sync",
      url: siteUrl,
      description: productSummary,
      applicationCategory: "HealthApplication",
      operatingSystem: "iOS and macOS",
      isAccessibleForFree: true,
      license: `${githubUrl}/blob/main/LICENSE`,
      downloadUrl: npmUrl,
      sameAs: [githubUrl, skillHubUrl, npmUrl],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "User-authorized Apple Health summaries",
        "Encrypted iPhone pairing and sync",
        "User-controlled local SQLite receiver",
        "Scoped Model Context Protocol tools",
        "Freshness and source metadata",
        "Revocable source-device access",
        "Trusted LAN and optional user-managed Tailscale routes",
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
