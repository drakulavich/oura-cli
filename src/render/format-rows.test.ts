import { describe, it, expect } from 'bun:test';
import chalk from 'chalk';
import { formatRows, MAX_CELL, MIN_CELL } from './format-rows.js';
import { byName } from '../collections/index.js';
import type { CachedRow } from '../db/rows.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const HINT = 'Run sync.';

function withColor<T>(fn: () => T): T {
  const prev = chalk.level;
  chalk.level = 1;
  try { return fn(); } finally { chalk.level = prev; }
}

const battery = byName('battery')!;
const batteryRows: CachedRow[] = [
  { timestamp: '2026-09-01T07:00:00+00:00', level: 100, charging: 0, in_charger: 1, day: '2026-09-01' },
  { timestamp: '2026-09-01T19:30:00+00:00', level: 7, charging: null, in_charger: 0, day: '2026-09-01' },
];

describe('formatRows (#73)', () => {
  it('returns the rows untouched as JSON', () => {
    expect(JSON.parse(formatRows(battery, batteryRows, ' for 2026-09-01', 'json', HINT))).toEqual(batteryRows);
  });

  it('lays out one column per stored column, numbers right-aligned and text left, with the rules at the body indent', () => {
    const lines = stripAnsi(withColor(() => formatRows(battery, batteryRows, ' for 2026-09-01', 'table', HINT))).split('\n');
    expect(lines[1]).toBe('  battery (ring_battery_level): 2 rows for 2026-09-01');
    expect(lines[3]).toBe('  timestamp                  level  charging  in_charger  day');
    expect(lines[5]).toBe('  2026-09-01T07:00:00+00:00    100         0           1  2026-09-01');
    expect(lines[6]).toBe('  2026-09-01T19:30:00+00:00      7         —           0  2026-09-01');
    const rules = lines.filter(l => l.includes('─'));
    const widest = Math.max(...lines.filter(l => !l.includes('─')).slice(3).map(l => l.length));
    expect(rules).toHaveLength(2);
    expect(rules[0]).toBe(`  ${'─'.repeat(widest - 2)}`); // as wide as the widest row, not the header
    for (const l of lines) expect(l).toBe(l.trimEnd());
  });

  it('cuts a long text cell at MAX_CELL in the table but not in the JSON', () => {
    const sleep = byName('sleep')!;
    const blob = JSON.stringify({ deep_sleep: 90, efficiency: 88, latency: 70, rem_sleep: 80, restfulness: 60, timing: 95, total_sleep: 85 });
    const rows: CachedRow[] = [{ id: 's1', day: '2026-09-01', score: 82, contributors: blob, timestamp: '2026-09-01T00:00:00+00:00' }];
    const table = stripAnsi(formatRows(sleep, rows, ' for 2026-09-01', 'table', HINT));
    expect(table).toContain(`${blob.slice(0, MAX_CELL - 1)}…`);
    expect(table).not.toContain(blob);
    expect(JSON.parse(formatRows(sleep, rows, '', 'json', HINT))[0].contributors).toBe(blob);
  });

  it('right-aligns REAL columns too, not only INTEGER ones', () => {
    const vo2 = byName('vo2max')!;
    const rows: CachedRow[] = [
      { id: 'a', day: '2026-01-02', vo2_max: 48.5, timestamp: '2026-01-02T11:41:14+04:00' },
      { id: 'b', day: '2026-01-03', vo2_max: 9, timestamp: '2026-01-03T09:00:00+04:00' },
    ];
    const lines = stripAnsi(formatRows(vo2, rows, '', 'table', HINT)).split('\n');
    expect(lines[3]).toBe('  id  day         vo2_max  timestamp');
    expect(lines[5]).toBe('  a   2026-01-02     48.5  2026-01-02T11:41:14+04:00');
    expect(lines[6]).toBe('  b   2026-01-03        9  2026-01-03T09:00:00+04:00');
  });

  it('keeps a newline or a tab in user text from breaking the row', () => {
    const tags = byName('tags')!;
    const rows: CachedRow[] = [{ id: 't1', day: '2026-09-01', end_day: null, start_time: null, end_time: null, tag_type_code: null, comment: 'line one\nline\ttwo\r\nthree', custom_name: 'x' }];
    const lines = stripAnsi(formatRows(tags, rows, '', 'table', HINT)).split('\n');
    expect(lines).toHaveLength(6); // blank, title, rule, header, rule, one row
    expect(lines[5]).toContain('line one⏎line two⏎three');
    expect(JSON.parse(formatRows(tags, rows, '', 'json', HINT))[0].comment).toBe('line one\nline\ttwo\r\nthree');
  });

  it('squeezes the widest columns until the table fits the screen, never below MIN_CELL', () => {
    const wide = withColor(() => formatRows(battery, batteryRows, '', 'table', HINT, 60));
    const lines = stripAnsi(wide).split('\n');
    for (const l of lines.slice(2)) expect(l.length, l).toBeLessThanOrEqual(60);
    expect(lines[5]).toMatch(/^  2026-09-01T0[^ ]*…\s+100/); // the timestamp column gave way, the numbers did not
    expect(lines[2]).toBe(`  ${'─'.repeat(58)}`);
    // Too narrow to fit: every column stops at MIN_CELL and the table overflows rather than vanishing.
    const tiny = stripAnsi(formatRows(battery, batteryRows, '', 'table', HINT, 20)).split('\n');
    expect(tiny[3]!.length).toBeGreaterThan(20);
    expect(tiny[3]).toContain(`${'timesta'}…`);
    expect(MIN_CELL).toBe(8);
  });

  it('says "1 row" for one row', () => {
    expect(stripAnsi(formatRows(battery, batteryRows.slice(0, 1), '', 'table', HINT))).toContain('battery (ring_battery_level): 1 row\n');
  });

  it('explains an empty result and carries the hint, with the scope it was asked for', () => {
    const out = stripAnsi(formatRows(byName('tags')!, [], ' for 2026-09-01 → 2026-09-07', 'table', HINT)).split('\n');
    expect(out[1]).toBe('  tags (enhanced_tags): 0 rows for 2026-09-01 → 2026-09-07');
    expect(out[2]).toBe(`  ${'─'.repeat(50)}`);
    expect(out[3]).toBe('  No cached tags rows for 2026-09-01 → 2026-09-07.');
    expect(out[4]).toBe(`  ${HINT}`);
  });
});
