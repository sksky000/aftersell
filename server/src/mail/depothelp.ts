import { senderDirectory } from './sender-directory';

export interface DepothelpContact {
  customerName: string;
  phone: string;
}

const DEPOTHELP_TICKET_FIELD_LABELS = [
  'NAME',
  'PHONE',
  'Brand Name',
  'Where is the bike purchased?',
  'Product Description',
  'Call Summary',
  'Email Address (Validation Required)',
  'Shipping Address',
  'May I ask if you have registered your bike?',
  'Owner Name',
  'Address(City/State)',
  'Date of Purchase',
  'Place of Purchase',
  'Bicycle Serial Number',
  'Is the issue resolved?',
  'Note (if any)',
  'Message Taken',
  'Message',
  'Caller Details',
  'Previous Calls',
  'View More',
  'Answered by',
].sort((a, b) => b.length - a.length);

const DEPOTHELP_TICKET_FIELD_PATTERN = new RegExp(
  ` (?=(${DEPOTHELP_TICKET_FIELD_LABELS.map((label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?= |$))`,
  'g',
);

export function normalizeDepothelpTicketText(text: string | null | undefined): string {
  if (!text) return '';
  const normalized = text.replace(DEPOTHELP_TICKET_FIELD_PATTERN, '\n');
  return normalized.replace(/\n{3,}/g, '\n\n').trim();
}

export function isDepothelpSender(fromAddress: string | null | undefined): boolean {
  if (!fromAddress) return false;
  return senderDirectory().hotline.has(fromAddress.trim().toLowerCase());
}

const DEPOTHELP_SUBJECT_PATTERN = /^(.+?)\s*[:：]\s*(\+?\d[\d\s-]{6,}\d)\s*(?:\(\s*Account\s*:\s*Phoenix\s*\))?/i;

export function parseDepothelpSubject(subject: string | null | undefined): DepothelpContact | null {
  if (!subject) return null;
  let cleaned = subject.trim();
  while (/^re\s*[:：]/i.test(cleaned)) {
    cleaned = cleaned.replace(/^re\s*[:：]\s*/i, '').trim();
  }
  const match = cleaned.match(DEPOTHELP_SUBJECT_PATTERN);
  if (!match) return null;
  const customerName = match[1].trim();
  const phone = match[2].replace(/[^\d+]/g, '');
  if (customerName.length < 2 || phone.replace(/\D/g, '').length < 7) return null;
  return { customerName, phone };
}

export function depothelpContactKey(contact: DepothelpContact): string {
  let digits = contact.phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return `${contact.customerName.trim().toLowerCase()}|${digits}`;
}

export function formatDepothelpContact(contact: DepothelpContact): string {
  return `${contact.customerName} (${contact.phone})`;
}

const DEPOTHELP_EMAIL_PATTERN =
  /Email Address \(Validation Required\)\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;

export function extractDepothelpCustomerEmail(
  bodyText: string | null | undefined,
): string | null {
  if (!bodyText) return null;
  const match = bodyText.match(DEPOTHELP_EMAIL_PATTERN);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}
