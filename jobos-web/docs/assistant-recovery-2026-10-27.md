# Career Assistant recovery and readable controls

## Reported failure

The user reported `Unexpected token 'A', "An error o"... is not valid JSON`
after searching for `BBF Racer`. The former client unconditionally parsed API
responses with `response.json()` and displayed the resulting exception message.
Plain-text hosting errors can therefore escape directly into the interface.
The exact original hosting failure could not be traced: the connected Vercel
account returned 403 for the existing production team. No account access or
credential configuration was changed to work around that limitation.

## Focused changes

- Job-search response parsing rejects plaintext, HTML, empty/non-object/oversized
  JSON and parser diagnostics with readable recovery text. Detail, action,
  preference and resume-list consumers use the same guard. Grounded responses
  also need a complete safe result/citation structure before rendering. Original
  valid grounded text and Google Search Suggestions are preserved unchanged.
- The full intent handler, including authentication, has a 17-second response
  deadline, provider deadlines inside it and a 22-second browser timeout. Errors
  return JSON without request contents or credentials in logs. Auth, same-origin
  and public-input checks remain. No resume text enters these requests.
- Short ambiguous terms such as `BBF Racer` produce a transparent clarification
  locally and on the API, with an explicit exact-words search option. The term
  is never silently converted into a different role or a fictitious vacancy.
- Qualification/experience-only requests ask for the role. Bounded public-search
  context accompanies genuine model follow-ups so city/experience are retained.
  Clear requests proceed to the real Find Jobs flow without an extra review step;
  the existing guided choice/review flow remains available.
- Immediate conversational replies are permitted after a finished response. A
  bounded per-user four-model-turn/minute window replaces the 15-second spacing
  guard, retaining that approximate model-call allowance and blocking concurrent
  requests. This is still a per-process guard, not a distributed billing cap.
- Clarification API replies use 422 with a readable question so previously loaded
  clients show that question instead of trying to render a missing intent.
- The primary search control is at the top, with a visible label, bordered
  multiline field and filled blue action. Page/card separation and shared input
  boundaries are stronger across the application, public search and auth forms.
  Secondary text is more readable in light and dark themes. No theme storage key,
  navigation destinations, OAuth, Gmail logic, schema/RLS or job sources changed.

## Observed verification before release

- Ten new focused tests cover the reported error body, HTML/empty/malformed JSON,
  safe result structures, complete-operation timeout, ambiguity, freshers,
  conversational quota, schema validation and measured theme contrast. Shared
  text contrast is at least 4.5:1 on the principal surfaces; input boundaries
  and button text meet their tested 3:1 / 4.5:1 thresholds respectively.
- Browser: `BBF Racer` → clarification → `Fresher jobs` → role suggestions →
  Sales Executive search with entry-level filter. A configured provider rejected
  its first reply; the existing fallback successfully served it in about 1.55s.
  This observation is not a general production performance claim.
- Browser: `BBA fresher in Kolkata` asked for a role; choosing Sales Executive
  retained both Kolkata and entry-level experience in the actual jobs URL.
- A temporary localhost-only fault proxy deliberately returned HTTP 502 with
  `An error occurred...` for the intent endpoint. The real UI showed readable
  recovery text and Retry / exact-words actions. Exact-words navigation still
  opened Find Jobs while that endpoint was failing. The fixture was stopped.
- Light and dark desktop layouts were visually inspected. A 390px iframe layout
  was visually inspected (381px content width after its scrollbar), with equal
  document/scroll widths and a stacked full-width action. Browser automation of
  the frame's button was limited; desktop interaction, text entry and the actual
  responsive rendering were observed. The original local light theme was restored.
- Anonymous intent requests returned JSON 401; foreign-origin requests JSON 403.
- Local Gmail live testing remains unavailable without its server-only service
  key; this task does not change that integration or claim a new Gmail PASS.

Rollback before this release: `eb71aeca857a306cd45369ecc93fbb47a3d0ecf5`.
Release through the existing Git-to-Vercel workflow only after final checks.
Production completion is verified separately after deployment.
