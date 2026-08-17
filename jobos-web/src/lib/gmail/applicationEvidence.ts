/**
 * The Evidence Gate — the single authority on whether a Gmail message evidences
 * a stage of an application THIS USER actually made.
 *
 * Pure: no network, no AI, no database, no clock. One `ParsedEmail` in, one
 * `EvidenceVerdict` out, always the same answer for the same input.
 *
 * Why this exists: the previous escalation rule accepted a message on either of
 * two signals — an ATS/job-board sender domain, or one of seven job-ish words in
 * the subject. Both are present in essentially every job-board notification, so
 * job alerts, feed notifications, course promotions and loan mail all reached the
 * review queue and the classifier. A sender domain is a routing fact about who
 * relayed the mail; by itself it is NEVER evidence.
 *
 * Precision is ranked above recall throughout. Fabricating an application the
 * user never made destroys trust in the tracker; missing one is recoverable with
 * a wider scan window or a manual add. Every rule below fails toward
 * "not tracked", never toward "invented".
 *
 * Evaluation order is normative, not incidental — see `evaluateApplicationEvidence`.
 */

import { isAtsDomain, type EmailCategory } from "./heuristics.ts";
import type { ParsedEmail } from "./parse.ts";

export type EvidenceStrength = "strong" | "weak" | "none";

export type EvidenceReason =
  // --- negative tier (hard exclusions) ---
  | "excluded_gmail_label"
  | "excluded_job_alert"
  | "excluded_social_notification"
  | "excluded_financial_application"
  | "excluded_marketing"
  | "excluded_hiring_announcement"
  // --- strong tier ---
  | "lifecycle_subject_match"
  | "lifecycle_body_match"
  // --- medium tier (resolves to weak) ---
  | "ats_sender_with_candidate_language"
  | "application_url_with_candidate_language"
  | "application_url_only"
  // --- weak/none tier ---
  | "keyword_only"
  | "no_application_evidence";

export interface EvidenceVerdict {
  strength: EvidenceStrength;
  /** A Lifecycle_Category when strength is "strong"; null otherwise. */
  category: EmailCategory | null;
  /** True only for strong lifecycle evidence. */
  isLifecycleEvent: boolean;
  /** 0.95 subject match, 0.8 body match, 0.9 hard exclusion, 0.6 no signal, 0 weak. */
  confidence: number;
  /** Non-content reason code. Safe to log and safe to show the user. */
  reason: EvidenceReason;
}

/** The `EmailCategory` values that denote a real stage of the user's application. */
export const LIFECYCLE_CATEGORIES: ReadonlySet<EmailCategory> = new Set<EmailCategory>([
  "APPLICATION_CONFIRMATION",
  "APPLICATION_RECEIVED",
  "APPLICATION_UPDATE",
  "INTERVIEW_INVITATION",
  "INTERVIEW_UPDATE",
  "REJECTION",
  "OFFER",
  "WITHDRAWAL",
]);

/** True when `category` denotes a Lifecycle_Event. Null is never a lifecycle. */
export function isLifecycleCategory(category: EmailCategory | null): boolean {
  if (category === null) return false;
  return LIFECYCLE_CATEGORIES.has(category);
}

/** Fixed confidence scale. Kept in one place so the tiers stay comparable. */
const CONFIDENCE = {
  lifecycleSubject: 0.95,
  lifecycleBody: 0.8,
  exclusion: 0.9,
  noSignal: 0.6,
  /** A weak verdict asserts nothing; the model decides. */
  ambiguous: 0,
} as const;

const EXCLUDED_LABELS: readonly string[] = ["CATEGORY_PROMOTIONS", "SPAM", "TRASH"];

type ExclusionReason = Extract<EvidenceReason, `excluded_${string}`>;

/**
 * Hard exclusions, evaluated in order; the first matching class names the reason.
 *
 * These are matched against subject + snippet ONLY — never the full body. Real
 * ATS mail routinely carries unsubscribe links and marketing boilerplate below
 * the signature, and matching down there would reject genuine interview
 * invitations.
 *
 * Every class is pattern-based rather than sender-based. LinkedIn and Naukri
 * relay real lifecycle mail ("Your application was sent to Acme"), so excluding
 * by sender would throw away genuine applications.
 */
const HARD_EXCLUSIONS: ReadonlyArray<{
  reason: ExclusionReason;
  patterns: readonly RegExp[];
}> = [
  {
    // Job alerts, digests, recommendations, saved searches. High volume, zero
    // evidence: the user has not applied to anything in these.
    reason: "excluded_job_alert",
    patterns: [
      /\bjob (?:alert|alerts|digest|recommendations?)\b/i,
      /\b\d+\s+new jobs?\b/i,
      /\bnew jobs?\b[\s\S]{0,40}\b(?:for you|matching|near you|in your area)\b/i,
      /\bjobs? (?:you )?(?:might|may) (?:like|be interested)\b/i,
      /\brecommended (?:jobs?|for you)\b/i,
      /\bjobs? (?:matching|matches) your\b/i,
      /\bsimilar jobs?\b/i,
      /\bsaved (?:search|jobs?)\b/i,
      /\btop job picks\b/i,
      /\bjobs? of the (?:day|week)\b/i,
      /\bview (?:jobs|all jobs)\b/i,
      /\bapply (?:now )?to these\b/i,
    ],
  },
  {
    // Social-network notifications. Pattern-based on purpose: the sender is
    // often the same domain that relays real application confirmations.
    reason: "excluded_social_notification",
    patterns: [
      /\b(?:wants to|would like to) connect\b/i,
      /\b(?:connection|invitation) (?:request|to connect)\b/i,
      /\baccept(?:ed)? your invitation\b/i,
      /\bviewed your profile\b/i,
      /\bprofile views?\b/i,
      /\bappeared in \d+ search(?:es)?\b/i,
      /\bpeople you may know\b/i,
      /\bpeople in your network\b/i,
      /\b(?:liked|commented on|shared|reacted to) your (?:post|update|comment|article)\b/i,
      /\bposted an? (?:update|article|photo)\b/i,
      /\bnew follower\b/i,
      /\bendorsed (?:you|your)\b/i,
      /\bmentioned you\b/i,
      // "Your application was viewed by 3 recruiters" is an engagement metric,
      // not a lifecycle event, and must not be laundered into a confirmation.
      /\byour application (?:was|has been) viewed\b/i,
      /\brecruiters? (?:have )?viewed\b/i,
      /\btrending (?:in|among)\b/i,
    ],
  },
  {
    // Financial applications. "Loan application received" is the exact phrase
    // shape of a genuine job confirmation, so this must run first.
    reason: "excluded_financial_application",
    patterns: [
      /\b(?:personal |home |car |auto |education |business )?loan\b/i,
      /\b(?:credit|debit) card\b/i,
      /\bcredit (?:score|report|limit)\b/i,
      /\bmortgage\b/i,
      // Case-sensitive on purpose: "Emi" and "Kyc" occur as personal names, and
      // an interview invitation from a recruiter named Emi must not be excluded.
      /\bEMI\b/,
      /\bKYC\b/,
      /\boverdraft\b/i,
      /\bpre-?approved\b/i,
      /\b(?:insurance|policy) (?:application|quote|renewal|premium)\b/i,
      /\b(?:premium|instal?ment) (?:due|payment)\b/i,
      /\b(?:bank|banking|demat|savings) account\b/i,
      /\bmutual funds?\b/i,
    ],
  },
  {
    // Newsletters, promotions, courses, webinars, salary reports.
    reason: "excluded_marketing",
    patterns: [
      /\bnewsletter\b/i,
      /\bdigest\b/i,
      /\bwebinar\b/i,
      /\bmasterclass\b/i,
      /\bworkshop\b/i,
      /\bbootcamp\b/i,
      // Deliberately not a bare /\bcourse\b/: "of course, happy to schedule"
      // appears in genuine interview mail.
      /\b(?:online|free|certification|training|crash) courses?\b/i,
      /\benrol?l\w*\b[\s\S]{0,40}\bcourse\b/i,
      /\bcertification\b/i,
      /\benrol?l (?:now|today)\b/i,
      /\bsalary (?:report|guide|insights|benchmark)\b/i,
      /\bsurvey\b/i,
      /\b\d+%\s*off\b/i,
      /\blimited time\b/i,
      /\bfree trial\b/i,
      /\bupgrade to (?:premium|pro|plus)\b/i,
      /\b(?:flash |mega )?sale\b/i,
      /\bearly bird\b/i,
    ],
  },
  {
    // "Acme is hiring" / "Priya posted a job" is an announcement about an
    // opening, not evidence that the user applied to it. Excluded even from an
    // employer's own domain.
    reason: "excluded_hiring_announcement",
    patterns: [
      /\bposted a (?:new )?(?:job|position|opening|role)\b/i,
      /\bis hiring\b/i,
      /\bare hiring\b/i,
      /\bwe(?:'re| are) hiring\b/i,
      /\b(?:now|currently) hiring\b/i,
      /\bhiring now\b/i,
    ],
  },
];

/**
 * Strong lifecycle patterns, ordered FURTHEST-ALONG-FIRST.
 *
 * The ordering is the tie-break rule: one email that mentions both an offer and
 * an earlier confirmation resolves to `OFFER`, regardless of which phrase sits
 * in the subject and which in the body. Rank is offer > rejection > interview
 * invitation > interview update > confirmation/received > update > withdrawal.
 */
const LIFECYCLE_PATTERNS: ReadonlyArray<{
  category: EmailCategory;
  patterns: readonly RegExp[];
}> = [
  {
    category: "OFFER",
    patterns: [
      /\boffer of employment\b/i,
      /\bemployment offer\b/i,
      /\bjob offer\b/i,
      /\byour offer letter\b/i,
      /\boffer letter (?:is )?(?:attached|enclosed)\b/i,
      /\bwe(?:'| a)re (?:delighted|pleased|excited|happy) to offer\b/i,
      /\b(?:would like|are able|want) to (?:formally )?offer you\b/i,
      /\bcongratulations\b[\s\S]{0,80}\boffer\b/i,
    ],
  },
  {
    category: "REJECTION",
    patterns: [
      /\bunfortunately\b[\s\S]{0,120}\b(?:not|other candidates|unable)\b/i,
      /\bwe (?:have )?decided (?:not to|to not) (?:move|proceed|continue)\b/i,
      /\bwe will not be moving forward\b/i,
      /\bnot (?:be )?(?:moving|progressing) (?:forward|ahead) with your application\b/i,
      /\bmoving forward with (?:other|another) candidates?\b/i,
      /\b(?:pursue|pursuing|going with) other candidates\b/i,
      /\bwe regret to inform\b/i,
      /\byour application (?:was|has been) (?:unsuccessful|declined|rejected)\b/i,
      /\bno longer under consideration\b/i,
      /\byou (?:have|were) not (?:been )?(?:selected|shortlisted)\b/i,
      /\b(?:position|role) has been filled\b/i,
    ],
  },
  {
    category: "INTERVIEW_INVITATION",
    patterns: [
      /\binvit(?:e|ation|ing) (?:you )?(?:to|for) (?:an? )?(?:interview|call|conversation|chat)\b/i,
      /\bschedule (?:an? )?(?:interview|call|screen)\b/i,
      /\bwould (?:you )?(?:be )?(?:available|like) (?:to|for) (?:an? )?(?:interview|call|chat)\b/i,
      /\binterview (?:invitation|request)\b/i,
      /\bnext step[s]?\b[\s\S]{0,80}\binterview\b/i,
      /\bphone screen\b/i,
      /\btechnical (?:interview|screen|assessment)\b/i,
      // Online assessments, coding challenges and take-homes are the assessment
      // stage of an application. There is no ASSESSMENT category (the ledger's
      // CHECK constraint is frozen), and INTERVIEW_INVITATION already resolves
      // to the correct `Interview` status.
      /\b(?:online|coding|technical|skills?) (?:assessment|challenge|test)\b/i,
      /\bcoding (?:challenge|exercise)\b/i,
      /\btake[- ]home (?:assignment|exercise|challenge|test)\b/i,
      /\bassessment (?:invitation|invite|link|deadline)\b/i,
      /\b(?:complete|take) (?:your |the )?(?:online )?assessment\b/i,
    ],
  },
  {
    category: "INTERVIEW_UPDATE",
    patterns: [
      /\binterview (?:confirmed|confirmation|scheduled|rescheduled|reminder|details|cancelled|canceled)\b/i,
      /\byour (?:upcoming )?interview\b/i,
      /\breschedul(?:e|ing) (?:your|the) interview\b/i,
    ],
  },
  {
    category: "APPLICATION_CONFIRMATION",
    patterns: [
      /\bthank you for (?:your )?(?:applying|application|your interest in)\b/i,
      /\bthanks for applying\b/i,
      // LinkedIn/Naukri relay this exact phrasing for a real application.
      /\byour application was sent to\b/i,
      /\byour application (?:has been|was) (?:sent|submitted|successfully submitted)\b/i,
      /\bapplication (?:submitted|confirmation)\b/i,
      /\byou (?:have )?applied (?:to|for)\b/i,
      /\bwe(?:'ve| have) got your application\b/i,
    ],
  },
  {
    category: "APPLICATION_RECEIVED",
    patterns: [
      /\bwe(?:'| ha)ve received your application\b/i,
      /\byour application (?:has been|was) received\b/i,
      /\bapplication received\b/i,
      /\breceived your (?:job )?application\b/i,
    ],
  },
  {
    category: "APPLICATION_UPDATE",
    patterns: [
      /\bupdate on your application\b/i,
      /\byour application status\b/i,
      /\bstatus of your (?:application|candidacy)\b/i,
      /\bapplication (?:is )?under review\b/i,
      /\bstill (?:reviewing|considering)\b/i,
      // A reference id paired with a status statement is a status update.
      /\bapplication (?:id|reference)\b[\s\S]{0,80}\b(?:status|update|review|progress)\b/i,
    ],
  },
  {
    category: "WITHDRAWAL",
    patterns: [
      /\bwithdraw(?:n|ing)? (?:your |my )?application\b/i,
      /\byour application (?:has been )?withdrawn\b/i,
      /\byou (?:have )?withdrawn\b/i,
    ],
  },
];

/**
 * Candidate-facing possessive language: the message addresses the reader as
 * someone who has an application in flight. This is the partner signal that
 * makes an ATS sender or an application URL worth a model call.
 */
const CANDIDATE_LANGUAGE_PATTERNS: readonly RegExp[] = [
  /\byour application\b/i,
  /\byour candidacy\b/i,
  /\byour submission\b/i,
  /\byou applied\b/i,
  /\byour (?:resume|résumé|cv)\b/i,
  /\bapplication (?:id|no\.?|number|reference)\b/i,
  /\bcandidate (?:id|number|portal|profile|dashboard)\b/i,
  /\bthe (?:position|role) you applied\b/i,
];

/**
 * The bare job-ish words that used to escalate a message on their own. They are
 * kept only to distinguish `keyword_only` from `no_application_evidence` in the
 * reason code — both resolve to `none`.
 */
const BARE_KEYWORD_PATTERN =
  /\b(?:applications?|applied|candidates?|candidacy|positions?|roles?|hiring|recruit(?:er|ers|ing|ment)?)\b/i;

function reject(reason: ExclusionReason): EvidenceVerdict {
  return {
    strength: "none",
    category: "NOT_JOB_RELATED",
    isLifecycleEvent: false,
    confidence: CONFIDENCE.exclusion,
    reason,
  };
}

function ambiguous(reason: EvidenceReason): EvidenceVerdict {
  return {
    strength: "weak",
    category: null,
    isLifecycleEvent: false,
    confidence: CONFIDENCE.ambiguous,
    reason,
  };
}

/** True when Gmail itself has already filed the message away from the inbox. */
function hasExcludedLabel(labelIds: readonly string[]): boolean {
  return labelIds.some((label) => EXCLUDED_LABELS.includes(label));
}

/** Subject + snippet: the exclusion surface. Never the body footer. */
function exclusionText(email: ParsedEmail): string {
  return `${email.subject}\n${email.snippet}`;
}

/** Subject + snippet + body: the evidence surface. */
function evidenceText(email: ParsedEmail): string {
  return [email.subject, email.snippet, email.bodyText]
    .filter((part) => part.trim() !== "")
    .join("\n");
}

/**
 * First hard-exclusion class that matches, or null.
 *
 * Exported so `heuristics.ts` can delegate its bulk-mail check here instead of
 * keeping a second copy of these patterns.
 */
export function findHardExclusion(email: ParsedEmail): ExclusionReason | null {
  if (hasExcludedLabel(email.labelIds)) return "excluded_gmail_label";

  const haystack = exclusionText(email);
  for (const { reason, patterns } of HARD_EXCLUSIONS) {
    if (patterns.some((pattern) => pattern.test(haystack))) return reason;
  }
  return null;
}

/**
 * Strongest lifecycle match, ignoring hard exclusions.
 *
 * Category rank dominates placement: the furthest-along category wins even when
 * a less advanced phrase sits in the subject. Placement then only sets the
 * confidence — a subject hit is materially stronger evidence than a body hit.
 *
 * Exported so `heuristics.ts` can delegate `detectCategory` here.
 */
export function detectLifecycleEvidence(email: ParsedEmail): {
  category: EmailCategory;
  confidence: number;
  inSubject: boolean;
} | null {
  const haystack = evidenceText(email);
  if (haystack.trim() === "") return null;

  for (const { category, patterns } of LIFECYCLE_PATTERNS) {
    for (const pattern of patterns) {
      if (!pattern.test(haystack)) continue;

      const inSubject = pattern.test(email.subject);
      return {
        category,
        confidence: inSubject ? CONFIDENCE.lifecycleSubject : CONFIDENCE.lifecycleBody,
        inSubject,
      };
    }
  }
  return null;
}

/** True when the message addresses the reader as an applicant. */
export function hasCandidateLanguage(email: ParsedEmail): boolean {
  const haystack = evidenceText(email);
  return CANDIDATE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(haystack));
}

/**
 * Classify one parsed message into an evidence verdict.
 *
 * The order below is the contract:
 *
 *  1. Gmail label exclusion — cheapest, and Gmail's own filing is trustworthy.
 *  2. Hard-exclusion patterns over subject + snippet. These run BEFORE lifecycle
 *     detection so "Loan application received" and "Your application was viewed
 *     by 3 recruiters" cannot be laundered into lifecycle evidence.
 *  3. Strong lifecycle detection, furthest-along-first.
 *  4. (ATS/portal sender OR application URL) AND candidate-facing language →
 *     genuinely ambiguous, worth one model call.
 *  5. An application URL alone → ambiguous. Narrow by construction: `findJobUrl`
 *     only matches known ATS URL shapes, and every alert/promotional shape has
 *     already been excluded. It can never create an application on its own,
 *     because auto-import requires a strong evidence row.
 *  6. Otherwise nothing. A bare job-ish keyword, an unsubscribe header, or an
 *     ATS sender with no candidate language all land here.
 */
export function evaluateApplicationEvidence(email: ParsedEmail): EvidenceVerdict {
  const excluded = findHardExclusion(email);
  if (excluded) return reject(excluded);

  const lifecycle = detectLifecycleEvidence(email);
  if (lifecycle) {
    return {
      strength: "strong",
      category: lifecycle.category,
      isLifecycleEvent: true,
      confidence: lifecycle.confidence,
      reason: lifecycle.inSubject ? "lifecycle_subject_match" : "lifecycle_body_match",
    };
  }

  const candidateLanguage = hasCandidateLanguage(email);
  const fromAts = isAtsDomain(email.senderRootDomain);
  const hasApplicationUrl = email.jobUrl !== null;

  if (candidateLanguage && fromAts) {
    return ambiguous("ats_sender_with_candidate_language");
  }
  if (candidateLanguage && hasApplicationUrl) {
    return ambiguous("application_url_with_candidate_language");
  }
  if (hasApplicationUrl) {
    return ambiguous("application_url_only");
  }

  return {
    strength: "none",
    category: "NOT_JOB_RELATED",
    isLifecycleEvent: false,
    confidence: CONFIDENCE.noSignal,
    reason: BARE_KEYWORD_PATTERN.test(evidenceText(email))
      ? "keyword_only"
      : "no_application_evidence",
  };
}
