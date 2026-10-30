import type { ResumeDocument, ResumeSection } from "./documentModel.ts";
import { STUDIO_STYLES, type ResumeDesign } from "./designs.ts";

export type ResumeFont = "sans" | "serif";
export interface ResumeLayout {
  design?: ResumeDesign;
  font: ResumeFont;
  fontSize: number;
  lineHeight: number;
  margin: number;
  centeredHeader: boolean;
  sectionRule: boolean;
  sectionGap: number;
  nameSize: number;
  pageSize: "a4" | "letter";
}
export interface ResumeFormatInput {
  templateId?: string;
  fontSize?: number;
  lineHeight?: number;
  margin?: number;
  pageSize?: "a4" | "letter";
}
const BASE_STYLES = [
  { id: "classic", name: "Classic", font: "sans", centeredHeader: true, sectionRule: true, fontSize: 11, lineHeight: 1.32, margin: 54, sectionGap: 12, nameSize: 17 },
  { id: "modern", name: "Modern", font: "sans", centeredHeader: false, sectionRule: true, fontSize: 11, lineHeight: 1.32, margin: 50, sectionGap: 13, nameSize: 20 },
  { id: "editorial", name: "Editorial", font: "serif", centeredHeader: false, sectionRule: true, fontSize: 11.5, lineHeight: 1.3, margin: 54, sectionGap: 14, nameSize: 20 },
  { id: "compact", name: "Compact", font: "sans", centeredHeader: false, sectionRule: false, fontSize: 10.5, lineHeight: 1.2, margin: 44, sectionGap: 8, nameSize: 17 },
  { id: "spacious", name: "Spacious", font: "sans", centeredHeader: false, sectionRule: true, fontSize: 11.5, lineHeight: 1.45, margin: 60, sectionGap: 16, nameSize: 21 },
  { id: "minimal", name: "Minimal", font: "sans", centeredHeader: false, sectionRule: false, fontSize: 11, lineHeight: 1.35, margin: 54, sectionGap: 15, nameSize: 18 },
  { id: "traditional", name: "Traditional", font: "serif", centeredHeader: true, sectionRule: true, fontSize: 11.5, lineHeight: 1.3, margin: 54, sectionGap: 12, nameSize: 19 },
  { id: "scholar", name: "Scholar", font: "serif", centeredHeader: false, sectionRule: false, fontSize: 11.5, lineHeight: 1.4, margin: 58, sectionGap: 16, nameSize: 18 },
  { id: "precise", name: "Precise", font: "sans", centeredHeader: true, sectionRule: false, fontSize: 11, lineHeight: 1.25, margin: 48, sectionGap: 10, nameSize: 18 },
  { id: "formal", name: "Formal", font: "serif", centeredHeader: true, sectionRule: false, fontSize: 12, lineHeight: 1.35, margin: 60, sectionGap: 15, nameSize: 20 },
] as const;

// Additional single-column presets vary typography, header alignment, rules,
// whitespace and density. Section-priority arrangements remain separate.
const EXTRA_STYLE_NAMES = ["Professional", "Executive", "Graduate", "Analyst", "Engineer", "Consultant", "Researcher", "Associate", "Specialist", "Manager", "Director", "Academic", "Technical", "Corporate", "Concise", "Open", "Structured", "Essential", "Focused", "Contemporary", "Heritage", "Balanced", "Standard", "Refined", "Clean", "Simple", "Literary", "Practical", "Clear", "Organized", "Leadership", "Neutral", "Studio", "Campus", "Apprentice", "Commerce", "Operations", "Public Service", "Healthcare", "Teaching"];
export const LEGACY_RESUME_STYLES = [...BASE_STYLES, ...EXTRA_STYLE_NAMES.map((name, index) => ({
  id: name.toLowerCase().replace(/\s+/g, "-"), name, font: index % 2 ? "serif" as const : "sans" as const,
  centeredHeader: Math.floor(index / 2) % 2 === 1, sectionRule: Math.floor(index / 4) % 2 === 0,
  fontSize: 10.5 + Math.floor(index / 8) * 0.5, lineHeight: 1.25 + (index % 5) * 0.04,
  margin: 44 + (index % 7) * 3, sectionGap: 9 + index % 6, nameSize: 18 + index % 5,
}))];
export const RESUME_STYLES = [...LEGACY_RESUME_STYLES, ...STUDIO_STYLES];

export const RESUME_PRIORITIES = [
  { id: "original", name: "Keep my section order", groups: [] },
  { id: "experience", name: "Experience first", groups: ["summary", "experience", "skills", "projects", "education"] },
  { id: "graduate", name: "Education first", groups: ["summary", "education", "projects", "skills", "experience"] },
  { id: "skills", name: "Skills first", groups: ["summary", "skills", "experience", "projects", "education"] },
  { id: "projects", name: "Projects first", groups: ["summary", "projects", "skills", "experience", "education"] },
] as const;

/** 50 single-column layouts; five explicit section-priority arrangements each. */
export const RESUME_TEMPLATES = RESUME_STYLES.flatMap(style => RESUME_PRIORITIES.map(priority => ({
  id: `${style.id}-${priority.id}`,
  name: `${style.name} · ${priority.name}`,
  style: style.name,
  priority: priority.id,
  layout: { ...style, pageSize: "a4" } as ResumeLayout,
})));
export const DEFAULT_RESUME_TEMPLATE = "classic-original";

export function validateResumeFormat(value: unknown): ResumeFormatInput | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.templateId !== undefined && (typeof input.templateId !== "string" || !RESUME_TEMPLATES.some(item => item.id === input.templateId))) return null;
  for (const [key, min, max] of [["fontSize", 10.5, 12.5], ["lineHeight", 1.15, 1.5], ["margin", 40, 72]] as const) {
    const number = input[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max)) return null;
  }
  if (input.pageSize !== undefined && input.pageSize !== "a4" && input.pageSize !== "letter") return null;
  if (typeof input.fontSize === "number" && !Number.isInteger(input.fontSize * 2)) return null;
  if (typeof input.margin === "number" && !Number.isInteger(input.margin)) return null;
  return {
    ...(input.templateId !== undefined ? { templateId: input.templateId as string } : {}),
    ...(input.fontSize !== undefined ? { fontSize: input.fontSize as number } : {}),
    ...(input.lineHeight !== undefined ? { lineHeight: input.lineHeight as number } : {}),
    ...(input.margin !== undefined ? { margin: input.margin as number } : {}),
    ...(input.pageSize !== undefined ? { pageSize: input.pageSize as "a4" | "letter" } : {}),
  };
}

export function resumeLayout(input?: ResumeFormatInput): ResumeLayout {
  const validated = validateResumeFormat(input);
  if (!validated) throw new Error("Invalid resume formatting options.");
  const template = RESUME_TEMPLATES.find(item => item.id === (validated.templateId ?? DEFAULT_RESUME_TEMPLATE))!;
  return { ...template.layout, ...validated };
}

function sectionGroup(section: ResumeSection): string {
  const heading = section.heading.toLowerCase();
  if (/summary|profile|objective/.test(heading)) return "summary";
  if (/experience|employment|work history/.test(heading)) return "experience";
  if (/skill|competenc|technolog/.test(heading)) return "skills";
  if (/project|portfolio/.test(heading)) return "projects";
  if (/education|academic|qualification/.test(heading)) return "education";
  return "other";
}

/** Stable reorder only. Unknown sections and every content block are retained. */
export function formatResumeDocument(document: ResumeDocument, input?: ResumeFormatInput): ResumeDocument {
  const validated = validateResumeFormat(input);
  if (!validated) throw new Error("Invalid resume formatting options.");
  const template = RESUME_TEMPLATES.find(item => item.id === (validated.templateId ?? DEFAULT_RESUME_TEMPLATE))!;
  const groups: readonly string[] = RESUME_PRIORITIES.find(item => item.id === template.priority)!.groups;
  if (!groups.length) return document;
  const rank = (section: ResumeSection) => { const index = groups.indexOf(sectionGroup(section)); return index < 0 ? groups.length : index; };
  return { headerLines: [...document.headerLines], sections: [...document.sections].sort((a, b) => rank(a) - rank(b)) };
}

/** The same ordered content as the renderers, with no metadata or new facts. */
export function resumePlainText(document: ResumeDocument): string {
  return [document.headerLines.join("\n"), ...document.sections.map(section => [section.heading, ...section.blocks.flatMap(block => block.kind === "line" ? [block.text] : block.items.map(item => `- ${item}`))].join("\n"))].filter(Boolean).join("\n\n");
}
