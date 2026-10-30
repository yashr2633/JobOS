/** Original compositions. Five structural treatments per family; never imported Canva artwork. */
export const DESIGN_FAMILIES = [
  { id: "summit", name: "Summit", category: "Professional", composition: "banner", columns: 1 },
  { id: "folio", name: "Folio", category: "Creative", composition: "sidebar-left", columns: 2 },
  { id: "meridian", name: "Meridian", category: "Professional", composition: "split-header", columns: 1 },
  { id: "harbor", name: "Harbor", category: "Minimal", composition: "topline", columns: 1 },
  { id: "axis", name: "Axis", category: "Professional", composition: "rail", columns: 1 },
  { id: "ledger", name: "Ledger", category: "Editorial", composition: "labels", columns: 1 },
  { id: "contour", name: "Contour", category: "Creative", composition: "frame", columns: 1 },
  { id: "studio", name: "Studio", category: "Creative", composition: "blocks", columns: 1 },
  { id: "beacon", name: "Beacon", category: "Professional", composition: "underline", columns: 1 },
  { id: "archive", name: "Archive", category: "Editorial", composition: "masthead", columns: 1 },
  { id: "vector", name: "Vector", category: "Minimal", composition: "timeline", columns: 1 },
  { id: "canvas", name: "Canvas", category: "Creative", composition: "sidebar-right", columns: 2 },
] as const;
export type DesignComposition = typeof DESIGN_FAMILIES[number]["composition"];
export interface ResumeDesign {
  family: string; category: string; composition: DesignComposition;
  treatment: "signature" | "line" | "panel" | "outline" | "split";
  sectionStyle: "rule" | "bar" | "tab" | "underline" | "label";
  accent: string; columns: 1 | 2;
}
const treatments = ["Signature", "Line", "Panel", "Outline", "Split"] as const;
const accents = ["183A60", "20635E", "5E394F", "654B27", "293F79"];
const sections = ["rule", "bar", "tab", "underline", "label"] as const;
export const STUDIO_STYLES = DESIGN_FAMILIES.flatMap((family, familyIndex) => treatments.map((treatment, index) => ({
  id: `design-${family.id}-${treatment.toLowerCase()}`,
  name: `${family.name} ${treatment}`,
  font: family.category === "Editorial" || index === 3 ? "serif" as const : "sans" as const,
  centeredHeader: family.composition === "masthead" || index === 3,
  sectionRule: index === 0 || index === 3,
  fontSize: 10.5 + (index === 2 ? .5 : 0), lineHeight: 1.3,
  margin: family.composition === "frame" ? 52 : 44,
  sectionGap: 13, nameSize: [27, 24, 28, 25, 26][index],
  design: {
    family: family.name, category: family.category, composition: family.composition,
    treatment: treatment.toLowerCase() as ResumeDesign["treatment"],
    sectionStyle: sections[(index + familyIndex) % sections.length],
    accent: accents[(index + familyIndex) % accents.length], columns: family.columns,
  } satisfies ResumeDesign,
}))).sort((a, b) => treatments.findIndex(name => name.toLowerCase() === a.design.treatment) - treatments.findIndex(name => name.toLowerCase() === b.design.treatment));
export const DEFAULT_STUDIO_TEMPLATE = "design-summit-signature-original";
