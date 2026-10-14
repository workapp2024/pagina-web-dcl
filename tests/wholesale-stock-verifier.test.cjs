const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('stock migration wrapper preserves SQL, verifies generated functions and commits only its version', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id UUID PRIMARY KEY); ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]);');
    const files = fs.readdirSync('supabase/migrations').filter(f => /^\d{14}_/.test(f) && f.slice(0,14) <= '20261012010000' && !f.includes('storage_setup')).sort();
    for (const file of files) await db.exec(fs.readFileSync('supabase/migrations/' + file, 'utf8'));
    await db.exec("INSERT INTO supabase_migrations.schema_migrations(version) SELECT lpad(n::text,14,'0') FROM generate_series(1,48) n; INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20261012010000');");
    const source = fs.readFileSync('supabase/migrations/20261013010000_wholesale_stock_deliveries.sql','utf8');
    const wrapper = fs.readFileSync('scripts/maintenance/apply-20261013010000-only.sql','utf8');
    assert.equal(wrapper.match(/ARRAY\[\$migration\$([\s\S]*?)\$migration\$\]/)[1], source);
    await db.exec(wrapper);
    for (const m of source.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/g)) {
      const rows = (await db.query('SELECT prosrc FROM pg_proc WHERE proname=$1', [m[1]])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].prosrc, m[2]);
    }
    assert.equal((await db.query('SELECT count(*)::int n FROM supabase_migrations.schema_migrations')).rows[0].n,50);
    // A genuine body discrepancy must still fail the exact comparison.
    const actual = (await db.query("SELECT prosrc FROM pg_proc WHERE proname='record_wholesale_delivery'")).rows[0].prosrc;
    assert.notEqual(actual, actual.replace('{0,2}$', '{0,2}'));
  } finally { await db.close(); }
});
