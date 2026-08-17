"use client";

interface SkillGapListProps {
  /** Skills the candidate has. Only read by the `matched` variant. */
  candidateSkills?: string[];
  /** Skills the JD requires */
  requiredSkills: string[];
  /** Skills the JD requires but candidate doesn't have */
  missingRequiredSkills: string[];
  /** Nice-to-haves the JD mentions */
  preferredSkills: string[];
  /** Nice-to-haves the candidate doesn't have */
  missingPreferredSkills: string[];
  variant?: "missing-required" | "missing-preferred" | "matched";
}

function formatSkill(skill: string): string {
  // Capitalize and replace common abbreviations for display
  const map: Record<string, string> = {
    js: "JavaScript",
    ts: "TypeScript",
    node: "Node.js",
    react: "React",
    next: "Next.js",
    vue: "Vue",
    postgresql: "PostgreSQL",
    "google cloud platform": "Google Cloud",
    cicd: "CI/CD",
    rest: "REST",
    tailwindcss: "Tailwind CSS",
    csharp: "C#",
    dotnet: ".NET",
    kubernetes: "Kubernetes",
    go: "Go",
  };
  const lower = skill.toLowerCase();
  if (lower in map) return map[lower];
  return skill.charAt(0).toUpperCase() + skill.slice(1);
}

export default function SkillGapList({ candidateSkills = [], requiredSkills, missingRequiredSkills, preferredSkills, missingPreferredSkills, variant = "missing-required" }: SkillGapListProps) {
  let items: string[];
  let title: string;

  switch (variant) {
    case "missing-required":
      items = missingRequiredSkills;
      title = "Required skills missing";
      break;
    case "missing-preferred":
      items = missingPreferredSkills;
      title = "Preferred skills missing";
      break;
    case "matched":
      items = requiredSkills.filter(skill => candidateSkills.some(s => s.toLowerCase().includes(skill.toLowerCase())));
      title = "Matched required skills";
      break;
    default:
      items = [];
      title = "";
  }

  if (items.length === 0 && variant !== "matched") {
    return (
      <div className="rounded-md border border-success/20 bg-success-bg p-4 text-center">
        <p className="text-sm text-success">No missing required skills</p>
      </div>
    );
  }

  if (items.length === 0 && variant === "matched") {
    return (
      <div className="rounded-md border border-success/20 bg-success-bg p-4 text-center">
        <p className="text-sm text-success">No matched required skills yet</p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-text-secondary">{title}</h4>
      <ul className="space-y-2">
        {items.map((skill) => (
          <li key={skill} className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-xs font-medium text-text-secondary">
              {formatSkill(skill).charAt(0)}
            </span>
            <span className="truncate">{formatSkill(skill)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
