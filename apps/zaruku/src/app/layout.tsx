import type { Metadata } from "next";
import { RUNTIME_MANIFESTS } from "@reportingdash/runtime-contract";
import "./globals.css";

export const metadata: Metadata = {
  title: RUNTIME_MANIFESTS.zaruku.appName,
  description: "Zaruku reporting dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
