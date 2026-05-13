#!/usr/bin/env bun
// Runs `bun test --reporter=junit`, transforms the XML into a Flakiness JSON
// Report (validated against @flakiness/flakiness-report's Zod schema), and
// optionally uploads it to flakiness.io when FLAKINESS_ACCESS_TOKEN is set.
//
// Exit code mirrors `bun test`. Upload errors do NOT override the test verdict.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { junitToFlakiness } from './junit-to-flakiness';

const outDir = process.env.FLAKINESS_OUTPUT_DIR || 'flakiness-report';
const xmlPath = join(outDir, '_junit.xml');

mkdirSync(join(outDir, 'attachments'), { recursive: true });

const runStart = new Date();
const bunTest = Bun.spawnSync(
  ['bun', 'test', '--reporter=junit', `--reporter-outfile=${xmlPath}`],
  { stdout: 'inherit', stderr: 'inherit' },
);

const xml = await Bun.file(xmlPath).text();

const ghEnv = process.env;
const ciRunUrl =
  ghEnv.GITHUB_SERVER_URL && ghEnv.GITHUB_REPOSITORY && ghEnv.GITHUB_RUN_ID
    ? `${ghEnv.GITHUB_SERVER_URL}/${ghEnv.GITHUB_REPOSITORY}/actions/runs/${ghEnv.GITHUB_RUN_ID}`
    : undefined;

const commitId = ghEnv.GITHUB_SHA ?? execSync('git rev-parse HEAD').toString().trim();

const report = junitToFlakiness({
  junitXml: xml,
  commitId,
  flakinessProject: ghEnv.FLAKINESS_PROJECT,
  title: ghEnv.FLAKINESS_TITLE,
  runStartTime: runStart,
  os: {
    name: process.platform,
    version: process.version,
    arch: process.arch,
  },
  ciRunUrl,
});

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

if (ghEnv.FLAKINESS_ACCESS_TOKEN && !ghEnv.FLAKINESS_DISABLE_UPLOAD) {
  Bun.spawnSync(['npx', '--yes', '@flakiness/cli', 'upload', outDir], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

process.exit(bunTest.exitCode ?? 0);
