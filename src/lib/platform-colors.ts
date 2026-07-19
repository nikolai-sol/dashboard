export const PLATFORM_COLORS: Record<
  string,
  { hex: string; label: string; type: string }
> = {
  linkedin: { hex: "#0A66C2", label: "LinkedIn", type: "social" },
  reddit: { hex: "#FF4500", label: "Reddit", type: "social" },
  meta: { hex: "#1877F2", label: "Meta", type: "social" },
  x: { hex: "#1DA1F2", label: "X", type: "social" },
  google: { hex: "#34A853", label: "Google Ads", type: "search" },
  yandex: { hex: "#FC3F1D", label: "Яндекс.Директ", type: "search" },
  yandex_promopages: { hex: "#E11D48", label: "Яндекс.ПромоСтраницы", type: "content" },
  vk: { hex: "#5181B8", label: "ВКонтакте", type: "social" },
  git: { hex: "#8B5CF6", label: "GetIntent", type: "programmatic" },
  dv360: { hex: "#0D9488", label: "DV360", type: "programmatic" },
  hybrid: { hex: "#EC4899", label: "Hybrid", type: "programmatic" },
  between: { hex: "#94A3B8", label: "Between", type: "programmatic" },
  brevo: { hex: "#0B7285", label: "Brevo", type: "email" },
  telegram: { hex: "#26A5E4", label: "Telegram", type: "social" },
  google_ads: { hex: "#34A853", label: "Google Ads", type: "search" },
  manual: { hex: "#64748B", label: "Manual", type: "manual" },
};

export const ACTIVE_PLATFORM_IDS = ["linkedin", "reddit", "meta", "google", "git", "vk", "between"];
