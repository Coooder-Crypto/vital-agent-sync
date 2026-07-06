import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HealthLink - Private health context for local AI agents",
  description:
    "Pair your iPhone once, sync authorized Apple Health summaries locally, and let MCP-compatible agents read fresh personal context without a cloud data warehouse.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
