import type { Database } from './open.js';
import type { AnyCollection, Piece } from '../collections/index.js';
import { shiftDay } from '../lib/time.js';

/**
 * When an incremental sync re-reads the days behind a collection's watermark (`syncLookbackDays`).
 *
 * Every sync used to re-fetch the fortnight: about twenty of a no-op run's 37 requests, and most of
 * its nine seconds, replacing ~18,000 heart-rate rows with themselves (#135). The lookback
 * exists because Oura appends `source='workout'` samples to days already stored, but those samples
 * come off the ring like every other one, so they can only appear once the ring has uploaded. The
 * tail request already tells us whether it has: it holds a sample newer than any stored. That is the
 * first trigger. The second is a daily safety net, in case Oura ever publishes a day's samples later
 * than the upload that carried them: the lookback runs at least once per local day regardless, and
 * `_sync_state` remembers the day it last ran.
 *
 * Considered and rejected: re-reading only days whose workout records changed. On a live cache
 * 30,226 of 37,300 workout-source samples over four months lay outside every workout record, so
 * workouts do not predict where the late samples land.
 */
export interface LookbackRange { start: string; end: string }

/** The days a lookback would re-read: up to and excluding the watermark day, which the tail covers. Null when there is none. */
export function lookbackRange(c: AnyCollection, last: string | null, explicitFrom: string | undefined): LookbackRange | null {
  if (explicitFrom !== undefined || last === null || !c.syncLookbackDays) return null;
  return { start: shiftDay(last, -c.syncLookbackDays), end: shiftDay(last, -1) };
}

function stateKey(c: AnyCollection): string {
  return `lookback:${c.table}`;
}

/**
 * True when the tail response holds a sample newer than any stored: the ring has uploaded since the
 * last sync. "Stored" is MAX over the identity instant as text, unclipped, unlike the day watermark
 * `lastDay` bounds to `end`: a future-dated sample in the cache would keep this trigger quiet and
 * leave the daily safety net, and mixed offsets could pick a lexical rather than chronological
 * maximum and fire once too often. Both harmless; neither has been seen in real data.
 */
function uploadedSince(db: Database, c: AnyCollection, tail: readonly Piece[]): boolean {
  const field = c.identity.find(i => i.format === 'date-time')?.field;
  if (field === undefined) return false;
  const stored = (db.query(`SELECT MAX(${field}) AS t FROM ${c.table}`).get() as { t: string | null }).t;
  const watermark = stored === null ? -Infinity : Date.parse(stored);
  return tail.some(piece => piece.rows.some(r => {
    const t = Date.parse(String((r as Record<string, unknown>)[field] ?? ''));
    return t > watermark; // NaN compares false: a sample with no usable instant proves nothing
  }));
}

/** Whether this run should re-read the lookback range: the ring has uploaded since, or it has not run yet today. */
export function lookbackDue(db: Database, c: AnyCollection, tail: readonly Piece[], today: string): boolean {
  const ran = (db.query('SELECT value FROM _sync_state WHERE key = ?').get(stateKey(c)) as { value: string } | null)?.value;
  return ran !== today || uploadedSince(db, c, tail);
}

/** Remember that the lookback ran today, so the daily safety net does not fire again until tomorrow. */
export function markLookbackRan(db: Database, c: AnyCollection, today: string): void {
  db.query('INSERT INTO _sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(stateKey(c), today);
}
