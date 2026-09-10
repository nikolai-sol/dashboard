import type { ReactNode } from "react";

export default function SiteSeoLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
