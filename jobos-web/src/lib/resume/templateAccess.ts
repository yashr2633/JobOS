import { STUDIO_STYLES } from "./designs.ts";

export const FREE_TEMPLATE_STYLES = ["classic", "modern", ...STUDIO_STYLES.slice(0, 8).map(style => style.id)] as const;

export function isFreeTemplate(templateId?: string) {
  const id = templateId ?? "classic-original";
  return FREE_TEMPLATE_STYLES.some(style => id.startsWith(`${style}-`));
}
