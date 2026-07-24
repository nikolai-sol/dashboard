import type { ReactNode } from "react";
import type { ZarukuSeoData } from "@/lib/types";

type Props = {
  data: ZarukuSeoData;
  children: ReactNode;
};

export default function ZarukuOverviewTab({ data, children }: Props) {
  void data;

  return (
    <div className="space-y-5">
      {children}
    </div>
  );
}
