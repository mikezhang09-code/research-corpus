import type { Metadata, Viewport } from "next";
import {
  Cormorant_Garamond,
  Source_Serif_4,
  Inter_Tight,
  JetBrains_Mono,
} from "next/font/google";
import "./globals.css";

// Four font families exposed as CSS variables so globals.css can chain
// each with CJK fallbacks (Noto Sans SC / PingFang SC / Microsoft YaHei).
// Without the fallback, Chinese filenames and content render as tofu.
const serifDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif-display",
});
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-serif",
});
const sans = Inter_Tight({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Research Portal",
  description: "NotebookLM & Library research hub",
};

// viewport-fit=cover lets env(safe-area-inset-*) resolve on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full ${serifDisplay.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-full bg-paper text-ink font-serif antialiased">
        {children}
      </body>
    </html>
  );
}
