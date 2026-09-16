import type { ReactNode } from "react";
import "./globals.css";

export default function SiteSeoLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
