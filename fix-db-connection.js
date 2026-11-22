// Fix and verify the local Supabase Session Pooler connection without printing secrets.
// Run: node fix-db-connection.js
// Uses the existing .env, the public CA certificate, pg, and dotenv.
// The updated DATABASE_URL is written ONLY after successful authentication.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PROJECT_REF = 'lydhdtlxodhyqjhvcfdu';
const ROOT = __dirname;
const ENV_FILE = path.join(ROOT, '.env');
const CA_FILE = path.join(ROOT, 'certs', 'prod-ca-2021.crt');

function readPasswordHidden(message) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('Run this from the VS Code terminal (not a non-interactive console).'));
      return;
    }

    let password = '';
    const stream = process.stdin;
    const oldRawMode = Boolean(stream.isRaw);

    function finish() {
      stream.removeListener('data', handleInput);
      stream.setRawMode(oldRawMode);
      stream.pause();
      process.stdout.write('\n');
    }

    function handleInput(input) {
      for (const character of input) {
        if (character === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(password);
          return;
        }
        if (character === '\b' || character === '\u007f') {
          password = password.slice(0, -1);
        } else if (character >= ' ' && character !== '\u007f') {
          password += character;
        }
      }
    }

    process.stdout.write(message);
    stream.setEncoding('utf8');
    stream.setRawMode(true);
    stream.resume();
    stream.on('data', handleInput);
  });
}

async function run() {
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error('The .env file is missing from the project folder.');
  }
  if (!fs.existsSync(CA_FILE)) {
    throw new Error('The certs/prod-ca-2021.crt file is missing. Run git pull origin main.');
  }
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing from your .env file.');
  }

  let url;
  try {
    url = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error('DATABASE_URL is not a valid URI. Copy the Session pooler URI from Supabase Connect.');
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must start with postgresql://');
  }
  if (!url.hostname.endsWith('.pooler.supabase.com')) {
    throw new Error('Connection host is not a Supabase pooler. Copy the Session pooler URI from Supabase Connect.');
  }

  // The pooler login must include this project's ref. Only the PASSWORD is secret.
  url.username = 'postgres.' + PROJECT_REF;
  url.port = '5432';
  url.pathname = '/postgres';
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    url.searchParams.delete(key);
  }

  console.log('Supabase project: HaderApp');
  console.log('Method: Session pooler (port 5432)');
  console.log('Username format checked: postgres.<project-ref>');
  console.log('Paste the actual DATABASE password, not your Supabase account password or project ID.');
  console.log('Typing/pasting will be invisible. Press Enter when done.');

  const password = await readPasswordHidden('Database password: ');
  if (!password || password === PROJECT_REF || password.includes('[YOUR-DATABASE-PASSWORD]')) {
    throw new Error('That is blank or a placeholder/project ID, not a database password.');
  }

  // WHATWG URL percent-encodes @, #, %, / etc correctly.
  url.password = password;
  const connectionString = url.toString();

  const client = new Client({
    connectionString,
    ssl: {
      ca: fs.readFileSync(CA_FILE, 'utf8'),
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();
    await client.query('SELECT 1'); // Read-only; does not touch Hader data.
  } catch (error) {
    if (error.code === '28P01' || /password authentication failed|invalid password/i.test(error.message)) {
      throw new Error('Supabase rejected that database password. Confirm it was copied exactly from the team\'s database credentials. If no one knows the correct password, coordinate a password reset with the team.');
    }
    if (/certificate|self.signed|SSL/i.test(error.message)) {
      throw new Error('SSL verification failed. The database certificate needs checking.');
    }
    throw new Error('Connection failed (' + (error.code || 'network/error') + '). Check Session pooler host, network, and project connection settings.');
  } finally {
    await client.end().catch(() => {});
  }

  const original = fs.readFileSync(ENV_FILE, 'utf8');
  const normalized = original.replace(/^DATABASE_URL=.*$/m, 'DATABASE_URL=' + connectionString);
  if (normalized === original && !original.includes('DATABASE_URL=' + connectionString)) {
    throw new Error('Connected, but could not find the DATABASE_URL line to update in .env.');
  }
  fs.writeFileSync(ENV_FILE, normalized, { encoding: 'utf8', mode: 0o600 });

  console.log('SUCCESS: Supabase accepted the password and verified a secure connection.');
  console.log('Updated your local .env. No passwords were printed or sent to GitHub.');
  console.log('You can now run: node test-db.js');
}

run().catch((error) => {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
});
