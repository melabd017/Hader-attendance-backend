// End-to-end LOCAL TEST for Hader Attendance session creation.
// Run the Attendance server first (node server.js), then run:
//   node test-create-session.js
// Authenticates with an existing organizer account, verifies ownership and
// asks permission before inserting one test session in shared Supabase.
// Passwords and access tokens are never stored or printed.

require('dotenv').config();

const fs = require('fs');
const { createInterface } = require('readline/promises');
const pool = require('./db/pool');

const AUTH_URL = 'https://lydhdtlxodhyqjhvcfdu.supabase.co';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_RwEDDrJWI8dfQLh1k54qoQ_XduP2Bjv';
const API_URL = 'http://127.0.0.1:3002';

// Password hidden to avoid exposing credentials in PowerShell history/output.
function hiddenPassword(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this in an interactive VS Code PowerShell terminal.'));
      return;
    }

    let input = '';
    const oldRaw = !!stdin.isRaw;
    function cleanup() {
      stdin.off('data', onData);
      stdin.setRawMode(oldRaw);
      stdin.pause();
      process.stdout.write('\n');
    }
    function onData(chunk) {
      for (const c of chunk) {
        if (c === '\u0003') {
          cleanup();
          reject(new Error('Cancelled by user.'));
          return;
        } else if (c === '\r' || c === '\n') {
          cleanup();
          resolve(input);
          return;
        } else if (c === '\u0008' || c === '\u007f') {
          input = input.slice(0, -1);
        } else if (c >= ' ' && c !== '\u007f') {
          input += c;
        }
      }
    }
    process.stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function promptText(message) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(message)).trim();
  } finally {
    rl.close();
  }
}

async function main() {
  console.log('\nHader Attendance: organizer session creation test');
  console.log('Use an ORGANIZER account from HaderApp, not your PostgreSQL password.');
  console.log('Passwords and tokens will not appear on screen or be committed to GitHub.\n');

  const email = await promptText('Organizer email: ');
  if (!email) throw new Error('Organizer email is required.');

  const password = await hiddenPassword('Organizer login password (hidden): ');
  if (!password) throw new Error('Login password is required.');

  let response;
  try {
    response = await fetch(AUTH_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PUBLISHABLE_KEY },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (_) {
    throw new Error('Unable to reach Supabase Auth. Check your internet connection.');
  }

  const auth = await response.json().catch(() => ({}));
  if (!response.ok || !auth.access_token || !auth.user?.id) {
    throw new Error('Login rejected. Use the same email/password as the HaderApp ORGANIZER login.');
  }

  const organizerId = auth.user.id;
  const roleResult = await pool.query(
    'SELECT role FROM public.profiles WHERE id = $1', [organizerId]
  );
  if (roleResult.rows[0]?.role !== 'organizer') {
    throw new Error('This HaderApp account is not an organizer. No data was changed.');
  }
  console.log('SUCCESS: Authenticated organizer account.');

  const ownedResult = await pool.query(
    `SELECT workshop_id, title, workshop_date
     FROM public.workshops
     WHERE organizer_id = $1
     ORDER BY workshop_date ASC LIMIT 1`,
    [organizerId]
  );
  if (!ownedResult.rows.length) {
    throw new Error('This organizer owns no workshops. No data was changed.');
  }

  const workshop = ownedResult.rows[0];
  const start = new Date(workshop.workshop_date);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  console.log('Workshop:', workshop.workshop_id, '-', workshop.title);
  console.log('Proposed test session:', start.toISOString(), 'to', end.toISOString());
  console.log('A successful POST creates ONE real test row in shared public.sessions.');

  const answer = await promptText('Create this test session? Type YES to confirm: ');
  if (answer !== 'YES') {
    console.log('Cancelled. Nothing created.');
    return;
  }

  let createResponse;
  try {
    createResponse = await fetch(
      API_URL + '/workshops/' + workshop.workshop_id + '/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + auth.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Attendance API Smoke Test',
          startTime: start.toISOString(),
          endTime: end.toISOString()
        }),
        signal: AbortSignal.timeout(10000)
      }
    );
  } catch (_) {
    throw new Error('Cannot reach Attendance API on port 3002. Start node server.js in another terminal.');
  }

  const result = await createResponse.json().catch(() => ({}));
  console.log('API HTTP status:', createResponse.status);

  if (!createResponse.ok) {
    console.log('API response:', {
      code: result.code || result.status,
      message: result.error || result.message || 'Request rejected'
    });
    if (createResponse.status === 409) {
      console.log('There is already an overlapping session. This is an expected business-rule protection.');
    }
    return;
  }

  console.log('SUCCESS: Created session ID:', result.sessionId);
  console.log('Check-in status:', result.checkinStatus);

  const check = await pool.query(
    'SELECT session_id FROM public.sessions WHERE session_id = $1 AND workshop_id = $2',
    [result.sessionId, workshop.workshop_id]
  );
  console.log(check.rows.length
    ? 'VERIFIED: New session exists in Supabase.'
    : 'WARNING: API returned success but the session was not found by verification query.');
}

main()
  .catch(error => {
    console.error('FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
