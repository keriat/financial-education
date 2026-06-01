import type { Metadata, Viewport } from "next";
import { Comfortaa, Nunito } from "next/font/google";
import "./globals.css";

const display = Comfortaa({
  subsets: ["cyrillic", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const body = Nunito({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Копилка",
  description: "Учёт леев — только плюсы",
};

export const viewport: Viewport = {
  themeColor: "#1f6e5a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
