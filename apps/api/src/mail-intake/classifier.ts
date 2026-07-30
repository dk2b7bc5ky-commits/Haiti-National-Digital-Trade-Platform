/**
 * Relevance filter — the cheap first pass from ALIZE_AGENT_SCOPE §5.
 *
 * `traffic@` is a live human inbox: agency mail, supplier threads, tax mail to
 * the accountant, newsletters. This decides only ONE thing: is this piece of
 * mail plausibly about moving goods, and therefore worth spending a model call
 * on? It is rule-based (free, instant, auditable) precisely because it runs on
 * every message that lands.
 *
 * It is deliberately BROAD. Arrival notices, invoices, booking confirmations,
 * release orders, customs paperwork, delay notices, and ordinary shipment
 * correspondence should all get through — the reader then classifies what each
 * one actually is and, crucially, whether it demands payment. Being too strict
 * here is how a real notice gets silently skipped.
 *
 * What it does keep out is mail with no bearing on trade at all: newsletters,
 * recruitment, password resets, calendar spam. The reader has the final say and
 * can still mark something `not_relevant` after looking.
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

/**
 * Phrases that on their own identify operational shipping mail. Widened well
 * beyond arrival notices: a booking confirmation or an invoice is just as much
 * something the agent should read and file.
 */
const STRONG_SUBJECT_CUES = [
  // Arrival
  'arrival notice', "avis d'arrivee", "avis d'arrivée", 'avis darrivee',
  'notice of arrival', 'preavis', 'préavis', 'avi darive',
  'notice d arrivee', 'cargo arrival', 'nota de llegada',
  // Booking / documentation
  'booking confirmation', 'booking confirmed', 'e-booking', 'ebooking',
  'confirmation de réservation', 'confirmation de reservation', 'booking request',
  'shipping instruction', 'instructions de chargement', 'draft b/l', 'draft bl',
  'bill of lading', 'connaissement', 'telex release', 'original b/l',
  // Money
  'invoice', 'facture', 'statement of account', 'relevé de compte',
  'releve de compte', 'proforma', 'debit note', 'note de débit',
  // Release / customs
  'release order', 'bon de sortie', 'delivery order', 'gate release',
  'customs clearance', 'dédouanement', 'dedouanement', 'declaration en douane',
  // Schedule
  'vessel delay', 'eta update', 'schedule change', 'blank sailing',
  'retard du navire', 'changement eta', 'roll over', 'rollover',
];

const SUPPORTING_CUES = [
  'bill of lading', 'connaissement', 'b/l', 'bl no', 'bl number', 'blno',
  'container', 'conteneur', 'kontenè', 'vessel', 'navire', 'voyage',
  'last free day', 'dernier jour franc', 'jours francs', 'free time',
  'demurrage', 'surestarie', 'detention', 'storage', 'entreposage',
  'terminal handling', 'thc', 'manutention', 'port dues', 'droits de port',
  'facture', 'invoice', 'frais', 'charges', 'agency fee', "frais d'agence",
  'apn', 'agd', 'douane', 'customs', 'eta', 'etd', 'discharge', 'déchargement',
  // Wider shipment vocabulary — these are what ordinary agency threads use.
  'shipment', 'cargaison', 'expédition', 'expedition', 'booking', 'réservation',
  'freight', 'fret', 'consignee', 'destinataire', 'shipper', 'expéditeur',
  'port-au-prince', 'cap-haitien', 'cap-haïtien', 'terminal', 'quai', 'berth',
  'seal number', 'plomb', 'manifest', 'manifeste', 'cut-off', 'cutoff',
  'pickup', 'ramassage', 'delivery', 'livraison', 'clearance', 'mainlevée',
  'tracking', 'suivi', 'transit', 'transbordement', 'transshipment',
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
 * Decides whether a message is plausibly about moving goods, and so worth
 * reading. Leans towards reading: a false accept costs one model call and gets
 * filed as `not_relevant`, whereas a false skip means a real notice is silently
 * missed. The decision about whether anything becomes MONEY is made later, by
 * the reader's `demandsPayment` — not here.
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

  // Accept generously — the reader decides what each one actually is.
  const accept =
    strong.length > 0 ||              // an unambiguous operational subject
    strongBody.length > 0 ||          // …or the same phrase in the body
    hasContainerNumber ||             // a real container number is decisive
    (senderKnown && supporting.length >= 1) || // known agent talking shop
    supporting.length >= 3;           // or clearly shipment vocabulary

  return {
    accept,
    reason: accept
      ? `Read because ${why.join(', ')}.`
      : `Skipped — nothing to suggest this is about a shipment${why.length ? ` (only: ${why.join(', ')})` : ''}.`,
    score,
  };
}
