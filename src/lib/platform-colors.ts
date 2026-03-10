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
  vk: { hex: "#5181B8", label: "ВКонтакте", type: "social" },
  git: { hex: "#8B5CF6", label: "GetIntent", type: "programmatic" },
  dv360: { hex: "#0D9488", label: "DV360", type: "programmatic" },
  hybrid: { hex: "#EC4899", label: "Hybrid", type: "programmatic" },
};

export const ACTIVE_PLATFORM_IDS = ["linkedin", "reddit", "meta", "google", "git", "vk"];
