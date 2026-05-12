import { Command } from 'commander';

export interface ManifestArg {
  name: string;
  type: string;
  required?: boolean;
  format?: string;
  description?: string;
  values?: string[];
}

export interface ManifestCommand {
  name: string;
  description: string;
  args: ManifestArg[];
  outputSchema?: string;
}

export interface Manifest {
  name: string;
  version: string;
  auth: {
    envVars: string[];
    tokenFile: string;
    loginCommand: string;
  };
  globalFlags: ManifestArg[];
  exitCodes: { code: number; meaning: string }[];
  commands: ManifestCommand[];
}

const DATE_ARGS: ManifestArg[] = [
  { name: '--start', type: 'date', format: 'YYYY-MM-DD', required: false, description: 'Range start (inclusive)' },
  { name: '--end',   type: 'date', format: 'YYYY-MM-DD', required: false, description: 'Range end (inclusive)' },
];

export function buildManifest(version: string): Manifest {
  return {
    name: 'oura-cli',
    version,
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
      { name: 'sleep',     description: 'Fetch daily sleep scores from Oura API.',     args: DATE_ARGS, outputSchema: 'docs/schemas/sleep.json' },
      { name: 'readiness', description: 'Fetch daily readiness scores from Oura API.', args: DATE_ARGS, outputSchema: 'docs/schemas/readiness.json' },
      { name: 'activity',  description: 'Fetch daily activity scores from Oura API.',  args: DATE_ARGS, outputSchema: 'docs/schemas/activity.json' },
      { name: 'hr',        description: 'Fetch heart rate samples from Oura API.',      args: DATE_ARGS, outputSchema: 'docs/schemas/hr.json' },
      { name: 'spo2',      description: 'Fetch blood oxygen (SpO2) data from Oura API.',args: DATE_ARGS, outputSchema: 'docs/schemas/spo2.json' },
      { name: 'stress',    description: 'Fetch daily stress data from Oura API.',       args: DATE_ARGS, outputSchema: 'docs/schemas/stress.json' },
      { name: 'workout',   description: 'Fetch workout data from Oura API.',            args: DATE_ARGS, outputSchema: 'docs/schemas/workout.json' },
      { name: 'sync',      description: 'Sync all Oura collections into the local database.', args: [] },
      { name: 'db',        description: 'Query the local SQLite cache.',               args: [] },
      { name: 'report',    description: 'Render a weekly or monthly summary report.',  args: [
          { name: '--week',  type: 'boolean', description: 'Render the last 7 days' },
          { name: '--month', type: 'boolean', description: 'Render the last 30 days' },
      ]},
    ],
  };
}

export function describeCommand(version: string): Command {
  return new Command('describe')
    .description('Emit a machine-readable manifest of commands, args, and outputs.')
    .action(() => {
      console.log(JSON.stringify(buildManifest(version), null, 2));
    });
}
