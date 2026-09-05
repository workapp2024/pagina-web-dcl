/* eslint-disable @typescript-eslint/no-require-imports */
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');

// Ephemeral database only: no .env, connection URL, sockets or persisted data.
module.exports = async function database() {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  // Supabase platform defaults (not repository migrations). Start permissive
  // so the corrective migration must actually revoke these inherited grants.
  await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;');
  const directory = path.resolve('supabase/migrations');
  try {
    for (const file of fs.readdirSync(directory).filter(f => /^\d{14}_/.test(f) && !f.includes('storage_setup')).sort()) {
      await db.exec(fs.readFileSync(path.join(directory, file), 'utf8'));
    }
  } catch (error) { await db.close(); throw error; }
  await db.exec("INSERT INTO site_settings(id,transfer_alias,transfer_holder,transfer_institution) VALUES(1,'test.alias','Test','Test') ON CONFLICT(id) DO UPDATE SET transfer_alias=EXCLUDED.transfer_alias,transfer_holder=EXCLUDED.transfer_holder,transfer_institution=EXCLUDED.transfer_institution");
  return db;
};
