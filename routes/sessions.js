const express = require('express');
const pool = require('../db/pool');
const { requireLogin, requireOrganizer } = require('../middleware/auth');

const router = express.Router();

const isoWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseSession(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send a JSON object with title, startTime, and endTime.' };
  }

  const { title, startTime, endTime } = body;
  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120) {
    return { error: 'title must be between 3 and 120 characters.' };
  }

  for (const [field, value] of [['startTime', startTime], ['endTime', endTime]]) {
    if (typeof value !== 'string' || !isoWithZone.test(value) || !Number.isFinite(Date.parse(value))) {
      return { error: field + ' must be an ISO 8601 date/time with Z or timezone offset.' };
    }
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (end <= start) {
    return { error: 'endTime must be after startTime.' };
  }

  return { data: { title: title.trim(), start, end } };
}

// POST /workshops/:workshopId/sessions
// Logged-in organizer creates a non-overlapping session for their own workshop.
router.post('/:workshopId/sessions', requireLogin, requireOrganizer, async (req, res, next) => {
  const workshopId = Number(req.params.workshopId);
  if (!Number.isInteger(workshopId) || workshopId < 1 || workshopId > 2147483647) {
    return res.status(400).json({ code: 'INVALID_WORKSHOP_ID', error: 'workshopId must be a positive integer.' });
  }

  const parsed = parseSession(req.body);
  if (parsed.error) {
    return res.status(400).json({ code: 'INVALID_SESSION', error: parsed.error });
  }

  const { title, start, end } = parsed.data;
  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    // Lock the workshop row: concurrent session creations for this workshop
    // cannot both pass the overlap check and insert conflicting sessions.
    const workshop = await client.query(
      'SELECT organizer_id FROM public.workshops WHERE workshop_id = $1 FOR UPDATE',
      [workshopId]
    );
    if (workshop.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({ code: 'WORKSHOP_NOT_FOUND', error: 'Workshop not found.' });
    }

    if (workshop.rows[0].organizer_id !== req.user.userId) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(403).json({ code: 'NOT_WORKSHOP_OWNER', error: 'You do not own this workshop.' });
    }

    // Endpoints that only touch are allowed; real overlap is forbidden.
    const overlapping = await client.query(
      `SELECT session_id FROM public.sessions
       WHERE workshop_id = $1 AND start_time < $3 AND end_time > $2
       LIMIT 1`,
      [workshopId, start.toISOString(), end.toISOString()]
    );
    if (overlapping.rows.length) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(409).json({ code: 'SESSION_OVERLAP', error: 'This workshop already has a session during that time.' });
    }

    const { rows } = await client.query(
      `INSERT INTO public.sessions (workshop_id, title, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       RETURNING session_id, workshop_id, title, start_time, end_time, checkin_status, created_at`,
      [workshopId, title, start.toISOString(), end.toISOString()]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const s = rows[0];
    console.log(JSON.stringify({
      event: 'session_created',
      workshopId,
      sessionId: s.session_id,
      userId: req.user.userId
    }));

    return res.status(201).json({
      sessionId: s.session_id,
      workshopId: s.workshop_id,
      title: s.title,
      startTime: s.start_time,
      endTime: s.end_time,
      checkinStatus: s.checkin_status,
      createdAt: s.created_at
    });
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    next(error);
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
