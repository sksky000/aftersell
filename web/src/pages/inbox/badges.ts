import type { EmailStatus, EvidenceStatus, Urgency } from '@aftersell/shared';

export const URGENCY_BADGE_CLASS: Record<Urgency, string> = {
  urgent: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  normal: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const STATUS_BADGE_CLASS: Record<EmailStatus, string> = {
  pending_review: 'bg-amber-100 text-amber-700 border-amber-200',
  replied: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ignored: 'bg-gray-100 text-gray-500 border-gray-200',
};

export const EVIDENCE_BADGE_CLASS: Record<EvidenceStatus, string> = {
  complete: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-100 text-amber-700 border-amber-200',
  missing: 'bg-red-100 text-red-700 border-red-200',
  unknown: 'bg-gray-100 text-gray-500 border-gray-200',
};

export const SAFETY_HAZARD_BADGE_CLASS = 'bg-red-50 text-red-700 border-red-300';
export const THREAD_BADGE_CLASS = 'border-blue-200 bg-blue-50 text-blue-700';
export const FOLLOW_UP_BADGE_CLASS = 'border-amber-200 bg-amber-50 text-amber-700';
export const UNCLASSIFIED_BADGE_CLASS = 'border-violet-200 bg-violet-50 text-violet-700';
