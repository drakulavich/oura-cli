import { XMLParser } from 'fast-xml-parser';
import { FlakinessReport, Schema } from '@flakiness/flakiness-report';

export interface TransformInput {
  junitXml: string;
  commitId: string;
  flakinessProject?: string;
  title?: string;
  runStartTime: Date | string;
  os: { name: string; version?: string; arch: string };
  ciRunUrl?: string;
  configPath?: string;
}

interface JUnitTestSuite {
  '@_name'?: string;
  '@_file'?: string;
  '@_line'?: string | number;
  '@_time'?: string | number;
  '@_tests'?: string | number;
  testsuite?: JUnitTestSuite | JUnitTestSuite[];
  testcase?: JUnitTestCase | JUnitTestCase[];
}

interface JUnitFailure {
  '@_type'?: string;
  '@_message'?: string;
  '#text'?: string;
}

interface JUnitTestCase {
  '@_name': string;
  '@_classname'?: string;
  '@_time'?: string | number;
  '@_file'?: string;
  '@_line'?: string | number;
  failure?: JUnitFailure | JUnitFailure[];
  error?: JUnitFailure | JUnitFailure[];
  skipped?: object | object[];
}

interface ParsedJUnit {
  testsuites?: {
    '@_time'?: string | number;
    testsuite?: JUnitTestSuite | JUnitTestSuite[];
  };
}

const toMs = (seconds: string | number | undefined): number => {
  const n = typeof seconds === 'string' ? parseFloat(seconds) : (seconds ?? 0);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
};

const asArray = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

const toFailures = (tc: JUnitTestCase): FlakinessReport.ReportError[] => {
  const all = [...asArray(tc.failure), ...asArray(tc.error)];
  return all.map((f) => {
    const message = f['@_message'] || f['@_type'] || f['#text'] || 'Test failed';
    const err: FlakinessReport.ReportError = { message };
    const text = f['#text'];
    if (text && text !== message) err.stack = text;
    return err;
  });
};

const caseStatus = (tc: JUnitTestCase): FlakinessReport.TestStatus => {
  if (tc.skipped !== undefined) return 'skipped';
  if (tc.failure !== undefined || tc.error !== undefined) return 'failed';
  return 'passed';
};

const buildTest = (tc: JUnitTestCase, startTimestampMs: number, fallbackFile?: string): FlakinessReport.Test => {
  const status = caseStatus(tc);
  const errors = status === 'failed' ? toFailures(tc) : undefined;
  const file = tc['@_file'] ?? fallbackFile;
  const line = tc['@_line'] != null ? Number(tc['@_line']) : undefined;
  const attempt: FlakinessReport.RunAttempt = {
    startTimestamp: startTimestampMs as FlakinessReport.UnixTimestampMS,
    duration: toMs(tc['@_time']) as FlakinessReport.DurationMS,
    status,
    ...(errors && errors.length ? { errors } : {}),
  };
  const test: FlakinessReport.Test = { title: tc['@_name'], attempts: [attempt] };
  if (file && line) {
    test.location = {
      file: file as FlakinessReport.GitFilePath,
      line: line as FlakinessReport.Number1Based,
      column: 1 as FlakinessReport.Number1Based,
    };
  }
  return test;
};

const buildSuite = (
  raw: JUnitTestSuite,
  isFile: boolean,
  startTimestampMs: number,
): FlakinessReport.Suite => {
  const tests = asArray(raw.testcase).map((tc) => buildTest(tc, startTimestampMs, raw['@_file']));
  const childSuites = asArray(raw.testsuite).map((s) => buildSuite(s, false, startTimestampMs));
  const suite: FlakinessReport.Suite = {
    type: isFile ? 'file' : 'suite',
    title: raw['@_name'] ?? (isFile ? raw['@_file'] ?? 'unnamed' : 'unnamed'),
  };
  if (childSuites.length) suite.suites = childSuites;
  if (tests.length) suite.tests = tests;
  if (raw['@_file'] && raw['@_line']) {
    suite.location = {
      file: raw['@_file'] as FlakinessReport.GitFilePath,
      line: Number(raw['@_line']) as FlakinessReport.Number1Based,
      column: 1 as FlakinessReport.Number1Based,
    };
  }
  return suite;
};

export function junitToFlakiness(input: TransformInput): FlakinessReport.Report {
  const parser = new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, allowBooleanAttributes: true });
  const parsed = parser.parse(input.junitXml) as ParsedJUnit;
  const root = parsed.testsuites;
  if (!root) throw new Error('JUnit XML is missing the <testsuites> root element');

  const startMs = (typeof input.runStartTime === 'string' ? new Date(input.runStartTime) : input.runStartTime).getTime();
  const fileSuites = asArray(root.testsuite).map((s) => buildSuite(s, true, startMs));

  const env: FlakinessReport.Environment = {
    name: input.os.name,
    systemData: {
      osName: input.os.name,
      ...(input.os.version ? { osVersion: input.os.version } : {}),
      osArch: input.os.arch,
    },
  };

  const report: FlakinessReport.Report = {
    category: FlakinessReport.CATEGORY_JUNIT,
    commitId: input.commitId as FlakinessReport.CommitId,
    environments: [env],
    suites: fileSuites,
    startTimestamp: startMs as FlakinessReport.UnixTimestampMS,
    duration: toMs(root['@_time']) as FlakinessReport.DurationMS,
    ...(input.flakinessProject ? { flakinessProject: input.flakinessProject } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.ciRunUrl ? { url: input.ciRunUrl } : {}),
    ...(input.configPath ? { configPath: input.configPath as FlakinessReport.GitFilePath } : {}),
  };

  return Schema.Report.parse(report) as FlakinessReport.Report;
}
