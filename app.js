// Express app shared by the AWS Lambda handler.
// Local demo-server.js remains unchanged, and server.js on your PC stays working.
const express = require('express');
const pool = require('./db/pool');
const sessionsRouter = require('./routes/sessions');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Allow only your explicitly listed frontend origins to call the API in browsers.
// No wildcard CORS for the authenticated organizer/attendee endpoints.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3003')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Public health check verifies PostgreSQL is reachable without exposing records.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'Hader Attendance', database: 'connected' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'database_health_failed', message: error.message }));
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

// JWT verification and workshop ownership occur inside the sessions router.
app.use('/workshops', sessionsRouter);

app.use((req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Route not found.' }));
app.use((error, req, res, next) => {
  console.error(JSON.stringify({ event: 'attendance_api_error', message: error.message }));
  res.status(error.status || 500).json({
    code: error.status ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
    error: error.status ? error.message : 'Internal server error.'
  });
});

module.exports = app;
