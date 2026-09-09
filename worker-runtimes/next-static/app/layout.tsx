import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Demo" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-surface text-text">{children}</body>
    </html>
  );
}
