export type OutreachContact = { name: string | null; company: string; email: string };

export type DraftDetails = {
  role: string;
  vacancy: boolean;
  requirement: string;
  evidence: string;
  name: string;
  portfolio: string;
};

function sentence(text: string) {
  const value = text.trim();
  return /[.!?]$/.test(value) ? value : value + ".";
}

export function buildOutreachDraft(contact: OutreachContact, details: DraftDetails) {
  const role = details.role.trim() || "[target role]";
  const firstName = contact.name?.trim().split(/\s+/)[0];
  const opening = details.vacancy
    ? "I’m reaching out about the " + role + " opening at " + contact.company + "."
    : "I’m exploring " + role + " opportunities at " + contact.company + ".";
  const fit = details.requirement.trim()
    ? sentence(details.requirement)
    : "[Say why the role or team interests you, using one detail from the job description.]";
  const proof = details.evidence.trim()
    ? sentence(details.evidence)
    : "[Describe one relevant project or achievement, the tools you used, and the result.]";
  const ask = details.vacancy
    ? "Would you be open to reviewing my profile for this role?"
    : "Would you be open to reviewing my profile for a current or upcoming role on your team?";

  return {
    subject: role + (details.vacancy ? " application" : " enquiry") + " | " + (details.name.trim() || "[your name]"),
    message: [
      firstName ? "Hi " + firstName + "," : "Hello,",
      opening + " " + fit,
      proof,
      ask + (details.portfolio.trim() ? "\nWork sample: " + details.portfolio.trim() : ""),
      "Thank you,\n" + (details.name.trim() || "[your name]"),
    ].join("\n\n"),
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
