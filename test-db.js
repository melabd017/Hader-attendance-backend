// Local, read-only test of the Hader Supabase database connection.
// Usage: node test-db.js
// Requires .env (DATABASE_URL), pg, dotenv, and the Supabase root certificate.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL in .env');
    process.exitCode = 1;
    return;
  }

  const caPath = path.join(__dirname, 'certs', 'prod-ca-2021.crt');
  if (!fs.existsSync(caPath)) {
    console.error('Missing Supabase root certificate: certs/prod-ca-2021.crt');
    console.error('Download it from Supabase Dashboard -> Database Settings -> SSL Configuration.');
    process.exitCode = 1;
    return;
  }

  // pg connection-string SSL query parameters may override the secure CA configuration.
  // Keep the URI otherwise unchanged.
  let connectionString;
  try {
    const uri = new URL(process.env.DATABASE_URL);
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
      uri.searchParams.delete(key);
    }
    connectionString = uri.toString();
  } catch (_) {
    console.error('Invalid DATABASE_URL. Copy the Session pooler URI from Supabase Connect.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({
    connectionString,
    ssl: {
      ca: fs.readFileSync(caPath, 'utf8'),
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1'); // Read-only. Does not modify team data.
    console.log('SUCCESS: Supabase connection and database credentials work.');
  } catch (error) {
    console.error('FAILED:', error.message); // Never print the password or URI.
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
