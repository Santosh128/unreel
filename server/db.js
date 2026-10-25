import 'dotenv/config';
import mysql from 'mysql2/promise';

export const config = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 8889),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? 'root',
};

export const pool = mysql.createPool({
  ...config,
  database: process.env.DB_NAME ?? 'unreel',
  dateStrings: true,
  connectionLimit: 10,
});
