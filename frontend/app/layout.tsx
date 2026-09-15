import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Classroom AI Agent",
  description: "AI 智能课堂复现项目",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}