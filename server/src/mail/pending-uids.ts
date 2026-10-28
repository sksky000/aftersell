/** Apply the body batch limit after excluding already imported unread messages. */
export function selectPendingUids(rows: Array<{ uid: number; messageId: string | null }>, importedIds: ReadonlySet<string>, limit: number): number[] {
  return [...new Set(rows.filter(row => !row.messageId || !importedIds.has(row.messageId)).map(row => row.uid))]
    .sort((a, b) => a - b).slice(0, Math.max(0, limit));
}
