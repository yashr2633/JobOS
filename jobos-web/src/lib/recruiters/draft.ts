export type OutreachContact = { name: string | null; company: string; email: string };

export function buildOutreachDraft(contact: OutreachContact, role: string, name: string, skills: string[] = []) {
  const target = role.trim();
  const firstName = contact.name?.trim().split(/\s+/)[0];
  const focus = /\b(data analyst|business intelligence|analytics)\b/i.test(target) ? "turning data into reports that support business decisions"
    : /\b(software|developer|frontend|backend)\b/i.test(target) ? "building and improving software that people rely on"
    : /\b(marketing|seo)\b/i.test(target) ? "understanding what drives campaign results and improving them"
    : /\b(support|customer service)\b/i.test(target) ? "resolving customer issues and making the next interaction easier"
    : "";
  const motivation = focus ? "I’m particularly interested in work that involves " + focus + "." : "";
  const evidence = skills.length ? "My resume highlights " + new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(skills) + "." : "";

  return {
    subject: target + " opportunities at " + contact.company + (name ? " | " + name : ""),
    message: [
      firstName ? "Hi " + firstName + "," : "Hello,",
      "I’m reaching out to express my interest in " + target + " opportunities at " + contact.company + ".",
      [motivation, evidence].filter(Boolean).join(" "),
      "If your team is hiring for this role, would you be open to reviewing my profile? I’d be happy to share a relevant work sample or discuss how I could contribute.",
      name ? "Best regards,\n" + name : "Thank you for your time.",
    ].filter(Boolean).join("\n\n"),
  };
}

export const RESUME_SIZE_LIMIT = 10 * 1024 * 1024;

export function resumeAttachmentType(name: string) {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  if (/\.docx$/i.test(name)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(""));
}

function wrap(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export async function createOutreachEmail(to: string, subject: string, message: string, resume: File) {
  if (!/^[^\s<>,;@]+@[^\s<>,;@]+\.[^\s<>,;@]+$/.test(to)) throw new Error("Check the recruiter’s email address.");
  const mimeType = resumeAttachmentType(resume.name);
  if (!mimeType || resume.size === 0 || resume.size > RESUME_SIZE_LIMIT) throw new Error("Choose a PDF or DOCX resume up to 10 MB.");

  const boundary = "jobtrackos-" + crypto.randomUUID();
  const fileName = resume.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(-120);
  const subjectHeader = (subject.replace(/[\r\n]+/g, " ").trim().match(/.{1,14}/gu) ?? [])
    .map(chunk => "=?UTF-8?B?" + base64(new TextEncoder().encode(chunk)) + "?=")
    .join("\r\n ");
  const bytes = new Uint8Array(await resume.arrayBuffer());

  return new Blob([[
    "To: " + to,
    "Subject: " + subjectHeader,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(base64(new TextEncoder().encode(message))),
    "--" + boundary,
    'Content-Type: ' + mimeType + '; name="' + fileName + '"',
    'Content-Disposition: attachment; filename="' + fileName + '"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(base64(bytes)),
    "--" + boundary + "--",
    "",
  ].join("\r\n")], { type: "message/rfc822" });
}
