import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Копилка",
  appleWebApp: {
    capable: true,
    title: "Копилка",
    statusBarStyle: "default",
  },
};

export default function KidLayout({ children }: { children: React.ReactNode }) {
  return children;
}
