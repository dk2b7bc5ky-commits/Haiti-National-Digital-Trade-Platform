/**
 * Arrival-notice classifier — the guardrail from ALIZE_AGENT_SCOPE §5.
 *
 * `traffic@` is a live human inbox: supplier threads, tax mail to the
 * accountant, newsletters. The agent must act ONLY on shipping arrival notices
 * and port/agency bills and leave everything else untouched. This is
 * intentionally rule-based (free, instant, auditable) rather than an LLM call —
 * we don't want to spend a model call, or take extraction risk, on every piece
 * of mail that lands.
 *
 * It is a *gate*, not the reader. Passing here only earns a message the right to
 * be read by the extractor, which applies its own per-field confidence.
 */

/** Haitian line agents / terminals / carriers that send notices and bills. */
const KNOWN_SENDER_FRAGMENTS = [
  'agemar', 'msc', 'mscgva', 'jbvital', 'vital', 'demsa', 'enmarcolda', 'adesky',
  'nadal', 'nadalsa', 'samar', 'adeko', 'seaboard', 'antillean', 'sontram',
  'rvam', 'hogarth', 'madsen', 'maersk', 'sealand', 'cma-cgm', 'cmacgm',
  'hapag', 'hapag-lloyd', 'crowley', 'evergreen', 'zim', 'cosco', 'kingocean',
  'king-ocean', 'one-line', 'nykline', 'marfret', 'caribbeanport', 'cps',
  'terminalvarreux', 'apn', 'douane', 'agd',
];

/** Subject / body cues, FR + EN + HT. Weighted: strong cues alone can pass. */
const STRONG_SUBJECT_CUES = [
  'arrival notice', "avis d'arrivee", "avis d'arrivée", 'avis darrivee',
  'notice of arrival', 'preavis', 'préavis', 'avi darive',
  'notice d arrivee', 'cargo arrival', 'nota de llegada',
];

const SUPPORTING_CUES = [
  'bill of lading', 'connaissement', 'b/l', 'bl no', 'bl number', 'blno',
  'container', 'conteneur', 'kontenè', 'vessel', 'navire', 'voyage',
  'last free day', 'dernier jour franc', 'jours francs', 'free time',
  'demurrage', 'surestarie', 'detention', 'storage', 'entreposage',
  'terminal handling', 'thc', 'manutention', 'port dues', 'droits de port',
  'facture', 'invoice', 'frais', 'charges', 'agency fee', "frais d'agence",
  'apn', 'agd', 'douane', 'customs', 'eta', 'discharge', 'déchargement',
];

/** If any of these dominate, it is not operational mail — never act on it. */
const NEGATIVE_CUES = [
  'unsubscribe', 'se désabonner', 'desabonner', 'newsletter', 'webinar',
  'promotional', 'marketing', 'no-reply@linkedin', 'password reset',
  'verify your email', 'out of office', 'absence du bureau',
  'salary', 'payroll', 'curriculum vitae', 'resume attached', 'candidature',
];

/** Container number: 4 letters + 7 digits (ISO 6346). A very strong signal. */
const CONTAINER_RE = /\b[A-Z]{4}\d{7}\b/;

export interface Classification {
  /** Should the reader look at this message at all? */
  accept: boolean;
  /** Short human-readable reason, shown in the review UI + audit trail. */
  reason: string;
  /** 0..1 — how confident the gate is. Only used for reporting. */
  score: number;
}

export interface ClassifierInput {
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentNames: string[];
}

const countHits = (haystack: string, needles: string[]): string[] =>
  needles.filter((n) => haystack.includes(n));

/**
 * Decides whether a message looks like an arrival notice or a port/agency bill.
 * Deliberately conservative: when in doubt, skip. A missed notice costs one
 * manual entry; a false accept writes a wrong bill onto a real container.
 */
export function classifyMessage(input: ClassifierInput): Classification {
  const subject = (input.subject ?? '').toLowerCase();
  const body = (input.bodyText ?? '').slice(0, 20_000).toLowerCase();
  const from = (input.fromAddress ?? '').toLowerCase();
  const names = input.attachmentNames.map((n) => n.toLowerCase());
  const haystack = `${subject}\n${body}`;

  const negatives = countHits(haystack, NEGATIVE_CUES);
  // An explicit arrival-notice subject outranks a stray "unsubscribe" footer,
  // which real agency mail sometimes carries.
  const strong = countHits(subject, STRONG_SUBJECT_CUES);
  if (negatives.length > 0 && strong.length === 0) {
    // Same "Skipped — …" voice as the other reject path, so the review list
    // reads consistently.
    return { accept: false, reason: `Skipped — looks like non-operational mail ("${negatives[0]}").`, score: 0 };
  }

  const senderKnown = KNOWN_SENDER_FRAGMENTS.some((f) => from.includes(f));
  const strongBody = countHits(body, STRONG_SUBJECT_CUES);
  const supporting = countHits(haystack, SUPPORTING_CUES);
  const hasContainerNumber = CONTAINER_RE.test(`${input.subject}\n${input.bodyText}`.toUpperCase());
  const hasDoc = names.some((n) => /\.(pdf|xlsx?|csv|png|jpe?g|tiff?)$/.test(n));

  let score = 0;
  if (strong.length > 0) score += 0.55;
  else if (strongBody.length > 0) score += 0.4;
  if (senderKnown) score += 0.2;
  if (hasContainerNumber) score += 0.25;
  if (hasDoc) score += 0.1;
  score += Math.min(supporting.length, 6) * 0.05;
  score = Math.min(score, 1);

  const why: string[] = [];
  if (strong.length > 0) why.push(`subject says "${strong[0]}"`);
  else if (strongBody.length > 0) why.push(`body says "${strongBody[0]}"`);
  if (senderKnown) why.push('sender is a known agent/terminal');
  if (hasContainerNumber) why.push('contains a container number');
  if (hasDoc) why.push('has a document attached');
  if (supporting.length > 0) why.push(`${supporting.length} shipping term(s)`);

  // Accept on an explicit arrival-notice phrase, or on a combination that is
  // unambiguous: a container number plus real shipping vocabulary.
  const accept =
    strong.length > 0 ||
    strongBody.length > 0 ||
    (hasContainerNumber && supporting.length >= 2) ||
    (senderKnown && hasDoc && supporting.length >= 3);

  return {
    accept,
    reason: accept
      ? `Read because ${why.join(', ')}.`
      : `Skipped — not enough signal that this is an arrival notice${why.length ? ` (only: ${why.join(', ')})` : ''}.`,
    score,
  };
}
