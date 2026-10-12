const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ignore = require('ignore');

test('Vercel excludes root database tooling while retaining application Supabase modules', () => {
  const rules = fs.readFileSync('.vercelignore', 'utf8');
  const filter = ignore().add(rules);
  for (const file of fs.readdirSync('lib/supabase')) {
    assert.equal(filter.ignores('lib/supabase/' + file), false, file);
  }
  for (const file of ['supabase/migrations/example.sql', '.env.local', '.local-postgres/cluster/PG_VERSION', 'scripts/maintenance/database.dump', 'backup.dump', 'backup.zip', 'certificate.crt']) {
    assert.equal(filter.ignores(file), true, file);
  }
  // Reproduce the exact defect: the old unanchored rule excludes runtime modules.
  assert.equal(ignore().add(rules.replace('/supabase/', 'supabase/')).ignores('lib/supabase/storage.ts'), true);
});
