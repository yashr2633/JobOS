import type { ResumeDocument } from "./documentModel.ts";
/** Illustrative content only. Selecting a design never imports these candidate facts. */
export const GALLERY_SAMPLE: ResumeDocument = {
  headerLines: ["AARAV MEHTA", "Business Analyst", "aarav@example.com | Bengaluru, India", "linkedin.com/in/example"],
  sections: [
    { heading: "PROFILE", blocks: [{ kind: "line", text: "Business analyst focused on clear reporting, practical research and thoughtful operational improvements.", emphasized: false }] },
    { heading: "EXPERIENCE", blocks: [
      { kind: "line", text: "Business Analyst | Example Company", emphasized: true },
      { kind: "line", text: "2023 - Present | Bengaluru", emphasized: false },
      { kind: "bullets", items: ["Built clear weekly reporting for the operations team.", "Translated stakeholder requirements into documented workflows.", "Reviewed sales data and presented actionable findings."] },
      { kind: "line", text: "Operations Intern | Sample Organisation", emphasized: true },
      { kind: "line", text: "2022 - 2023 | Bengaluru", emphasized: false },
      { kind: "bullets", items: ["Maintained accurate records and supported monthly reporting.", "Worked with cross-functional teams on process documentation."] },
    ] },
    { heading: "PROJECTS", blocks: [{ kind: "line", text: "Sales Reporting Dashboard", emphasized: true }, { kind: "bullets", items: ["Created a structured dashboard using sample data in SQL and Excel.", "Documented metric definitions and presented the analysis."] }] },
    { heading: "EDUCATION", blocks: [{ kind: "line", text: "Bachelor of Business Administration", emphasized: true }, { kind: "line", text: "Example University | 2023", emphasized: false }] },
    { heading: "SKILLS", blocks: [{ kind: "bullets", items: ["SQL and Excel", "Business reporting", "Stakeholder research", "Process documentation"] }] },
    { heading: "CERTIFICATIONS", blocks: [{ kind: "line", text: "Business Analytics - Sample Course", emphasized: false }] },
  ],
};
export const GALLERY_LETTER: ResumeDocument = { headerLines: GALLERY_SAMPLE.headerLines, sections: [{ heading: "", blocks: [
  { kind: "line", text: "Dear Hiring Team,", emphasized: false },
  { kind: "line", text: "I am applying for the Business Analyst position at Example Company. My background combines practical reporting, stakeholder research and process documentation.", emphasized: false },
  { kind: "line", text: "In my previous work, I built weekly reports, documented operational workflows and communicated findings to cross-functional teams. My academic projects include a sales reporting dashboard using SQL and Excel.", emphasized: false },
  { kind: "line", text: "I would welcome the opportunity to discuss how my experience can support your team. Thank you for considering my application.", emphasized: false },
  { kind: "line", text: "Kind regards,", emphasized: false }, { kind: "line", text: "Aarav Mehta", emphasized: false },
] }] };
