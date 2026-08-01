import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay · Multi-agent control plane",
  description: "Coordinate, review, and operate continuous multi-agent AI sessions."
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#090a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
