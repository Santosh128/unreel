import 'dotenv/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';

const app = express();
app.set('trust proxy', true);
// CORS_ORIGIN: comma-separated list of allowed web origins; unset allows all (the Android app
// sends requests from http://localhost, so keep that in the list if you restrict it)
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true }));
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Every request identifies the phone with an X-Device-Id header. Each device has its own
// counts, limit and history; on Android the id comes from ANDROID_ID so it survives reinstalls.
// The day comes from the client so "today" follows the phone's timezone.
app.use('/api', (req, res, next) => {
  const deviceId = req.get('X-Device-Id');
  if (!deviceId || deviceId.length > 64) {
    return res.status(400).json({ error: 'Missing X-Device-Id header' });
  }
  req.deviceId = deviceId;
  next();
});

function getDay(req, res) {
  const day = req.query.day ?? req.body?.day;
  if (!DAY_RE.test(day ?? '')) {
    res.status(400).json({ error: 'day must be YYYY-MM-DD' });
    return null;
  }
  return day;
}

async function readCount(deviceId, day) {
  const [rows] = await pool.query(
    'SELECT CAST(COALESCE(SUM(count), 0) AS UNSIGNED) AS count FROM reel_counts WHERE device_id = ? AND day = ?',
    [deviceId, day],
  );
  return Number(rows[0].count);
}

async function readSources(deviceId, day) {
  const [rows] = await pool.query(
    `SELECT source, count FROM reel_counts
     WHERE device_id = ? AND day = ? AND count > 0 ORDER BY count DESC`,
    [deviceId, day],
  );
  return rows;
}

async function readLimit(deviceId) {
  const [rows] = await pool.query('SELECT daily_limit FROM settings WHERE device_id = ?', [deviceId]);
  return rows[0]?.daily_limit ?? 20;
}

app.get('/api/today', async (req, res) => {
  const day = getDay(req, res);
  if (!day) return;
  // The app loads "today" on every open, so this keeps the device list current
  const model = req.get('X-Device-Model')?.slice(0, 100) || null;
  await pool.query(
    `INSERT INTO devices (device_id, model) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE model = COALESCE(VALUES(model), model), last_seen = CURRENT_TIMESTAMP`,
    [req.deviceId, model],
  );
  res.json({
    day,
    count: await readCount(req.deviceId, day),
    limit: await readLimit(req.deviceId),
    sources: await readSources(req.deviceId, day),
  });
});

// Add reels (default 1). The Android auto-counter sends source = app name.
app.post('/api/reels', async (req, res) => {
  const day = getDay(req, res);
  if (!day) return;
  const amount = Math.min(Math.max(parseInt(req.body.amount ?? 1, 10) || 1, 1), 500);
  const source = String(req.body.source ?? 'manual').trim().slice(0, 64) || 'manual';
  await pool.query(
    `INSERT INTO reel_counts (device_id, day, source, count) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE count = count + VALUES(count)`,
    [req.deviceId, day, source, amount],
  );
  res.json({ day, count: await readCount(req.deviceId, day) });
});

// Undo one reel from the most recently updated source
app.post('/api/reels/undo', async (req, res) => {
  const day = getDay(req, res);
  if (!day) return;
  await pool.query(
    `UPDATE reel_counts SET count = count - 1
     WHERE device_id = ? AND day = ? AND count > 0
     ORDER BY updated_at DESC LIMIT 1`,
    [req.deviceId, day],
  );
  res.json({ day, count: await readCount(req.deviceId, day) });
});

// Move another device id's data onto this one (used once when an app install switches from a
// random id to its stable Android id). Counts for the same day and app are added together.
app.post('/api/device/merge', async (req, res) => {
  const from = String(req.body.from ?? '');
  if (!from || from.length > 64 || from === req.deviceId) {
    return res.status(400).json({ error: 'from must be a different device id' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [moved] = await conn.query(
      `INSERT INTO reel_counts (device_id, day, source, count)
       SELECT ?, s.day, s.source, s.count
       FROM (SELECT day, source, count FROM reel_counts WHERE device_id = ?) s
       ON DUPLICATE KEY UPDATE count = reel_counts.count + s.count`,
      [req.deviceId, from],
    );
    await conn.query('DELETE FROM reel_counts WHERE device_id = ?', [from]);
    // Keep this device's limit if it has one, otherwise take the old one
    await conn.query(
      `INSERT IGNORE INTO settings (device_id, daily_limit)
       SELECT ?, daily_limit FROM settings WHERE device_id = ?`,
      [req.deviceId, from],
    );
    await conn.query('DELETE FROM settings WHERE device_id = ?', [from]);
    await conn.query('DELETE FROM devices WHERE device_id = ?', [from]);
    await conn.commit();
    res.json({ merged: moved.affectedRows > 0 });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// Clear a day's counts for every source
app.post('/api/reels/reset', async (req, res) => {
  const day = getDay(req, res);
  if (!day) return;
  await pool.query('DELETE FROM reel_counts WHERE device_id = ? AND day = ?', [req.deviceId, day]);
  res.json({ day, count: 0 });
});

// Daily totals with a per-app breakdown, newest first
app.get('/api/history', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days ?? 30, 10) || 30, 1), 365);
  const [rows] = await pool.query(
    `SELECT r.day, r.source, r.count FROM reel_counts r
     JOIN (SELECT DISTINCT day FROM reel_counts
           WHERE device_id = ? AND count > 0 ORDER BY day DESC LIMIT ?) d ON d.day = r.day
     WHERE r.device_id = ? AND r.count > 0
     ORDER BY r.day DESC, r.count DESC`,
    [req.deviceId, days, req.deviceId],
  );
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, count: 0, sources: [] });
    const entry = byDay.get(r.day);
    entry.count += r.count;
    entry.sources.push({ source: r.source, count: r.count });
  }
  res.json([...byDay.values()]);
});

app.put('/api/settings', async (req, res) => {
  const limit = parseInt(req.body.limit, 10);
  if (!(limit >= 1 && limit <= 1000)) {
    return res.status(400).json({ error: 'limit must be 1-1000' });
  }
  await pool.query(
    `INSERT INTO settings (device_id, daily_limit) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE daily_limit = VALUES(daily_limit)`,
    [req.deviceId, limit],
  );
  res.json({ limit });
});

// Serve the built Angular app (app/dist/app/browser) when it exists, so one server hosts both
const webDir = process.env.WEB_DIR ?? fileURLToPath(new URL('../app/dist/app/browser', import.meta.url));
if (existsSync(webDir)) {
  app.use(express.static(webDir));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile('index.html', { root: webDir }));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const port = Number(process.env.PORT ?? 3000);
// 0.0.0.0 so an Android phone on the same Wi-Fi can reach it; set HOST=127.0.0.1 behind a proxy
const host = process.env.HOST ?? '0.0.0.0';
app.listen(port, host, () => console.log(`Unreel API on http://${host}:${port}`));
