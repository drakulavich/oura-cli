import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from './migrations.js';
import { ensureSchema } from './open.js';
import { COLLECTIONS, ddl } from '../collections/index.js';

function describeTable(db: Database, table: string) {
  const columns = db.query(`PRAGMA table_info(${table})`).all();
  const indexes = (db.query(`PRAGMA index_list(${table})`).all() as { name: string; unique: number; origin: string }[])
    .map(i => ({ name: i.name, unique: i.unique, origin: i.origin, columns: db.query(`PRAGMA index_info(${i.name})`).all() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { columns, indexes };
}

describe('registry DDL vs shipped migrations', () => {
  it('produces identical tables and indexes for every registry collection', () => {
    const viaMigrations = new Database(':memory:');
    ensureSchema(viaMigrations, MIGRATIONS);
    const viaRegistry = new Database(':memory:');
    for (const c of COLLECTIONS) viaRegistry.exec(ddl(c));

    for (const c of COLLECTIONS) {
      expect(describeTable(viaRegistry, c.table)).toEqual(describeTable(viaMigrations, c.table));
    }
  });

  it('registers all nine collections', () => {
    expect(COLLECTIONS.map(c => c.name).sort()).toEqual(
      ['activity', 'cv-age', 'hr', 'readiness', 'sleep', 'sleep-periods', 'spo2', 'stress', 'workout'],
    );
  });
});
