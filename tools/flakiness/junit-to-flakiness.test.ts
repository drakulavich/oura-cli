import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Schema } from '@flakiness/flakiness-report';
import { junitToFlakiness } from './junit-to-flakiness';

const FIXTURE = readFileSync('tools/flakiness/fixtures/junit-sample.xml', 'utf8');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const RUN_START = new Date('2026-05-13T18:00:00Z');
const OS = { name: 'darwin', version: '25.0', arch: 'arm64' } as const;

const transform = (overrides?: Partial<Parameters<typeof junitToFlakiness>[0]>) =>
  junitToFlakiness({
    junitXml: FIXTURE,
    commitId: COMMIT,
    runStartTime: RUN_START,
    os: OS,
    ...overrides,
  });

describe('junitToFlakiness', () => {
  it('produces a report that satisfies the upstream Zod schema', () => {
    expect(() => Schema.Report.parse(transform())).not.toThrow();
  });

  it('preserves the canonical metadata so flakiness.io can attribute the run', () => {
    const report = transform({ flakinessProject: 'drakulavich/oura-cli', ciRunUrl: 'https://example/ci/1' });
    expect(report.commitId).toBe(COMMIT);
    expect(report.category).toBe('junit');
    expect(report.flakinessProject).toBe('drakulavich/oura-cli');
    expect(report.url).toBe('https://example/ci/1');
    expect(report.startTimestamp).toBe(RUN_START.getTime());
    expect(report.environments).toHaveLength(1);
    expect(report.environments[0].systemData?.osArch).toBe('arm64');
  });

  it('records a failed testcase with at least one error so flake review has something to read', () => {
    const failed = findTest(transform(), 'records a failure with a useful message');
    const attempt = failed.attempts[0];
    expect(attempt.status).toBe('failed');
    expect(attempt.errors?.length ?? 0).toBeGreaterThan(0);
    expect(attempt.errors?.[0].message).toBeTruthy();
  });

  it('flags a skipped testcase so flakiness.io renders it as skipped, not as a phantom pass', () => {
    const skipped = findTest(transform(), 'is skipped on purpose');
    expect(skipped.attempts[0].status).toBe('skipped');
    expect(skipped.attempts[0].errors).toBeUndefined();
  });

  it("converts the testcase 'time' attribute from seconds to milliseconds", () => {
    // fixture: 'takes a moment' has time="0.015236" → 15ms after rounding
    const slow = findTest(transform(), 'takes a moment');
    expect(slow.attempts[0].duration).toBe(15);
  });

  it('rejects XML without a <testsuites> root rather than emitting a phantom report', () => {
    expect(() => junitToFlakiness({
      junitXml: '<not-a-junit-report/>',
      commitId: COMMIT,
      runStartTime: RUN_START,
      os: OS,
    })).toThrow(/testsuites/);
  });
});

function findTest(report: import('@flakiness/flakiness-report').FlakinessReport.Report, title: string) {
  const all: import('@flakiness/flakiness-report').FlakinessReport.Test[] = [];
  const walk = (suites?: import('@flakiness/flakiness-report').FlakinessReport.Suite[]) => {
    for (const s of suites ?? []) {
      if (s.tests) all.push(...s.tests);
      walk(s.suites);
    }
  };
  walk(report.suites);
  const test = all.find((t) => t.title === title);
  if (!test) throw new Error(`Fixture missing test ${title}`);
  return test;
}
