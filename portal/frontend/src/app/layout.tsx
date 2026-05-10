import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SideNav } from "@/components/side-nav";

// Expose Inter as a CSS variable so we can chain it with CJK fallbacks
// (Noto Sans SC on Linux/Android, PingFang SC on macOS, Microsoft YaHei on
// Windows) in globals.css. Inter has no CJK glyphs on its own so Chinese
// filenames and content would render as tofu boxes without the fallback.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Research Portal",
  description: "NotebookLM & Library research hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${inter.variable} h-full bg-background text-foreground`}>
        <div className="flex h-full">
          <SideNav />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
