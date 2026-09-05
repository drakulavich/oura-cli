import { defineCommand } from 'citty';

export interface ManifestArg {
  name: string;
  type: string;
  required?: boolean;
  format?: string;
  description?: string;
  values?: string[];
}

export interface ManifestSubcommand {
  name: string;
  description: string;
  args: ManifestArg[];
}

export interface ManifestCommand {
  name: string;
  description: string;
  args: ManifestArg[];
  outputSchema?: string;
  subcommands?: ManifestSubcommand[];
}

export interface Manifest {
  name: string;
  version: string;
  compatManifestCommand?: string;
  auth: {
    envVars: string[];
    tokenFile: string;
    loginCommand: string;
  };
  globalFlags: ManifestArg[];
  exitCodes: { code: number; meaning: string }[];
  commands: ManifestCommand[];
}


export function buildManifest(version: string): Manifest {
  return {
    name: 'oura-cli',
    version,
    compatManifestCommand: 'oura-cli manifest',
    auth: {
      envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH'],
      tokenFile: '~/.oura-token',
      loginCommand: 'oura-cli login',
    },
    globalFlags: [
      { name: '--format', type: 'enum', values: ['table', 'json'], description: 'Output format (auto-detected by TTY when omitted)' },
      { name: '--db',     type: 'string', description: 'Override SQLite database path (env: OURA_DB_PATH)' },
      { name: '--tz',     type: 'string', description: 'Display timezone (env: OURA_TZ; default auto-detected)' },
      { name: '--token',  type: 'string', description: 'Inline access token (prefer env vars or `login`)' },
      { name: '--no-color', type: 'boolean', description: 'Disable ANSI colors in human output' },
    ],
    exitCodes: [
      { code: 0, meaning: 'success' },
      { code: 1, meaning: 'user error (bad arguments)' },
      { code: 2, meaning: 'auth error (missing or invalid token)' },
      { code: 3, meaning: 'API or network error' },
      { code: 4, meaning: 'database or local storage error' },
    ],
    commands: [
      { name: 'login',    description: 'Save an Oura Personal Access Token for future commands.', args: [
          { name: '--token', type: 'string', required: false, description: 'Pass token non-interactively' },
          { name: '--path',  type: 'string', required: false, description: 'Override token file path' },
      ]},
      { name: 'describe', description: 'Emit a machine-readable manifest of commands, args, and outputs.', args: [] },
      {
        name: 'doctor',
        description: 'Diagnose token, database, and sync health, and suggest the next command to run.',
        args: [
          { name: '--offline', type: 'boolean', required: false, description: 'Skip the live Oura API token-validation call' },
        ],
        outputSchema: 'docs/schemas/doctor.json',
      },
      {
        name: 'sleep',
        description: 'Fetch daily sleep scores from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/sleep.json',
        subcommands: [
          { name: 'today', description: "Today's sleep data.", args: [] },
          { name: 'date',  description: 'Sleep data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of sleep data.', args: [] },
        ],
      },
      {
        name: 'readiness',
        description: 'Fetch daily readiness scores from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/readiness.json',
        subcommands: [
          { name: 'today', description: "Today's readiness data.", args: [] },
          { name: 'date',  description: 'Readiness data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of readiness data.', args: [] },
        ],
      },
      {
        name: 'activity',
        description: 'Fetch daily activity scores from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/activity.json',
        subcommands: [
          { name: 'today', description: "Today's activity data.", args: [] },
          { name: 'date',  description: 'Activity data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of activity data.', args: [] },
        ],
      },
      {
        name: 'hr',
        description: 'Fetch heart rate samples from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/hr.json',
        subcommands: [
          { name: 'today', description: "Today's heart rate data.", args: [] },
          { name: 'date',  description: 'Heart rate data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of heart rate data.', args: [] },
        ],
      },
      {
        name: 'spo2',
        description: 'Fetch blood oxygen (SpO2) data from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/spo2.json',
        subcommands: [
          { name: 'today', description: "Today's SpO2 data.", args: [] },
          { name: 'date',  description: 'SpO2 data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of SpO2 data.', args: [] },
        ],
      },
      {
        name: 'stress',
        description: 'Fetch daily stress data from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/stress.json',
        subcommands: [
          { name: 'today', description: "Today's stress data.", args: [] },
          { name: 'date',  description: 'Stress data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of stress data.', args: [] },
        ],
      },
      {
        name: 'workout',
        description: 'Fetch workout data from Oura API. Pick a subcommand: today | date <day> | week.',
        args: [],
        outputSchema: 'docs/schemas/workout.json',
        subcommands: [
          { name: 'today', description: "Today's workout data.", args: [] },
          { name: 'date',  description: 'Workout data for a specific date.', args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',  description: 'Last 7 days of workout data.', args: [] },
        ],
      },
      { name: 'sync', description: 'Sync all Oura collections into the local database.', args: [] },
      {
        name: 'db',
        description: 'Query and manage the local SQLite cache. Pick a subcommand.',
        args: [],
        subcommands: [
          { name: 'today',  description: "Today's summary from local DB.",                       args: [] },
          { name: 'date',   description: 'Summary for a specific date.',                          args: [{ name: '<day>', type: 'date', format: 'YYYY-MM-DD', required: true, description: 'Target date.' }] },
          { name: 'week',   description: 'Last 7 days from local DB.',                            args: [] },
          { name: 'trends', description: 'Score and metric trends over N days (default 30).',     args: [{ name: '[days]', type: 'number', required: false, description: 'Window size in days.' }] },
          { name: 'stats',  description: 'Row counts, date range, record highs.',                 args: [] },
        ],
      },
      {
        name: 'report',
        description: 'Generate a narrative health report from local data.',
        args: [
          { name: '--period', type: 'enum', values: ['week', 'month'], description: 'Report window (default week).' },
        ],
      },
    ],
  };
}

export function describeCommand(version: string) {
  return defineCommand({
    meta: { name: 'describe', description: 'Emit a machine-readable manifest of commands, args, and outputs.' },
    args: {},
    run() {
      console.log(JSON.stringify(buildManifest(version), null, 2));
    },
  });
}
