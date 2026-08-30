import { defineCommand } from 'citty';

export function manifestCommand(version: string) {
  return defineCommand({
    meta: { name: 'manifest', description: 'Print openclaw-tool-registry-compatible manifest as JSON.' },
    args: {},
    run() {
      console.log(JSON.stringify({
        id: 'oura-cli',
        version,
        runtime: 'bun',
        bin: 'oura-cli',
        description: 'Oura Ring CLI — query and analyze Oura Ring health data. Designed for humans and agents.',
        commands: [
          { name: 'login',       description: 'Save an Oura Personal Access Token.',           examples: ['oura-cli login'] },
          { name: 'describe',    description: 'Emit a machine-readable manifest of commands.', examples: ['oura-cli describe'] },
          { name: 'sleep',       description: 'Fetch daily sleep scores from Oura API.',       examples: ['oura-cli sleep --start 2026-05-01'] },
          { name: 'readiness',   description: 'Fetch daily readiness scores from Oura API.',   examples: ['oura-cli readiness --start 2026-05-01'] },
          { name: 'activity',    description: 'Fetch daily activity scores from Oura API.',    examples: ['oura-cli activity --start 2026-05-01'] },
          { name: 'hr',          description: 'Fetch heart rate samples from Oura API.',       examples: ['oura-cli hr --start 2026-05-01'] },
          { name: 'spo2',        description: 'Fetch blood oxygen (SpO2) data from Oura API.', examples: ['oura-cli spo2 --start 2026-05-01'] },
          { name: 'stress',      description: 'Fetch daily stress data from Oura API.',        examples: ['oura-cli stress --start 2026-05-01'] },
          { name: 'workout',     description: 'Fetch workout data from Oura API.',             examples: ['oura-cli workout --start 2026-05-01'] },
          { name: 'sync',        description: 'Sync all Oura collections into the local DB.',  examples: ['oura-cli sync'] },
          { name: 'db',          description: 'Query the local SQLite cache.',                 examples: ['oura-cli db today'] },
          { name: 'report',      description: 'Render a weekly or monthly summary report.',    examples: ['oura-cli report --period week'] },
          { name: 'healthcheck', description: 'Quick local DB health probe.',                  examples: ['oura-cli healthcheck'] },
          { name: 'doctor',      description: 'Diagnose token, database, and sync health.',    examples: ['oura-cli doctor'] },
          { name: 'manifest',    description: 'Print openclaw-tool-registry-compatible manifest as JSON.', examples: ['oura-cli manifest'] },
        ],
        envVars: ['OURA_TOKEN', 'OURA_TOKEN_PATH', 'OURA_DB_PATH', 'OURA_TZ'],
        healthcheck: { command: 'healthcheck', expects: { ok: 'boolean', version: 'string', latencyMs: 'number' } },
      }, null, 2));
    },
  });
}
