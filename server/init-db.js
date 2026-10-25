// Creates the database (if allowed) and tables from schema.sql
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { config } from './db.js';

const dbName = process.env.DB_NAME ?? 'unreel';
const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const conn = await mysql.createConnection({ ...config, multipleStatements: true });

try {
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
} catch (err) {
  // Shared hosts often create the database for you and deny CREATE DATABASE
  console.log(`Could not create database (${err.code}); using existing \`${dbName}\``);
}
await conn.changeUser({ database: dbName });
await conn.query(sql);

// Upgrade tables created before per-app sources existed
const [cols] = await conn.query(
  `SELECT 1 FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'reel_counts' AND column_name = 'source'`,
);
if (!cols.length) {
  await conn.query(`ALTER TABLE reel_counts
    ADD COLUMN source VARCHAR(64) NOT NULL DEFAULT 'manual' AFTER day,
    DROP PRIMARY KEY, ADD PRIMARY KEY (device_id, day, source)`);
  console.log('Added source column');
}
await conn.end();
console.log(`Database \`${dbName}\` ready`);
