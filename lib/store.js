const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lokal: file:data/db.sqlite | Bulut: libsql://... (Turso)
const DATABASE_URL = process.env.DATABASE_URL || 'file:' + path.join(__dirname, '..', 'data', 'db.sqlite');
const AUTH_TOKEN = process.env.DATABASE_AUTH_TOKEN || undefined;

const client = createClient({ url: DATABASE_URL, authToken: AUTH_TOKEN });

async function init() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      photo_url TEXT,
      joined_at TEXT,
      last_active TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      test_id TEXT,
      answers TEXT,
      score INTEGER,
      total INTEGER,
      percent INTEGER,
      created_at TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      duration INTEGER,
      questions TEXT,
      built_in INTEGER DEFAULT 0,
      created_at TEXT
    )
  `);

  // Standart testlarni (tests.json) faqat jadval bo'sh bo'lsa yuklaymiz
  const count = await client.execute('SELECT COUNT(*) AS c FROM tests');
  if (count.rows[0].c === 0) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tests.json'), 'utf8'));
    const now = new Date().toISOString();
    for (const t of seed) {
      await client.execute({
        sql: 'INSERT INTO tests (id, title, description, icon, duration, questions, built_in, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
        args: [t.id, t.title, t.description || '', t.icon || '📝', t.duration || null, JSON.stringify(t.questions), now],
      });
    }
  }
}

async function upsertUser(user) {
  const now = new Date().toISOString();
  const existing = await client.execute({ sql: 'SELECT joined_at FROM users WHERE id = ?', args: [user.id] });
  const joinedAt = existing.rows.length ? existing.rows[0].joined_at : now;

  await client.execute({
    sql: `
      INSERT INTO users (id, username, first_name, last_name, photo_url, joined_at, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        photo_url = excluded.photo_url,
        last_active = excluded.last_active
    `,
    args: [user.id, user.username || null, user.first_name || '', user.last_name || null, user.photo_url || null, joinedAt, now],
  });

  return {
    id: user.id,
    username: user.username || null,
    firstName: user.first_name || '',
    lastName: user.last_name || null,
    photoUrl: user.photo_url || null,
    joinedAt,
  };
}

async function addAttempt({ userId, testId, answers, score, total, percent }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await client.execute({
    sql: 'INSERT INTO attempts (id, user_id, test_id, answers, score, total, percent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id, userId, testId, JSON.stringify(answers), score, total, percent, createdAt],
  });
  return { id, userId, testId, answers, score, total, percent, createdAt };
}

function rowToAttempt(r) {
  return {
    id: r.id,
    userId: r.user_id,
    testId: r.test_id,
    answers: JSON.parse(r.answers || '[]'),
    score: r.score,
    total: r.total,
    percent: r.percent,
    createdAt: r.created_at,
  };
}

async function getUserAttempts(userId) {
  const rs = await client.execute({
    sql: 'SELECT * FROM attempts WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return rs.rows.map(rowToAttempt);
}

async function getAllAttempts() {
  const rs = await client.execute('SELECT * FROM attempts');
  return rs.rows.map(rowToAttempt);
}

async function getUsers() {
  const rs = await client.execute('SELECT * FROM users');
  const map = {};
  for (const r of rs.rows) {
    map[String(r.id)] = {
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
      photoUrl: r.photo_url,
      joinedAt: r.joined_at,
      lastActive: r.last_active,
    };
  }
  return map;
}

/* ---------------- Tests ---------------- */

function rowToTest(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description || '',
    icon: r.icon || '📝',
    duration: r.duration,
    builtIn: !!r.built_in,
    createdAt: r.created_at,
    questions: JSON.parse(r.questions || '[]'),
  };
}

async function getTests() {
  const rs = await client.execute('SELECT * FROM tests ORDER BY built_in DESC, created_at ASC');
  return rs.rows.map(rowToTest);
}

async function getTestById(id) {
  const rs = await client.execute({ sql: 'SELECT * FROM tests WHERE id = ?', args: [id] });
  return rs.rows.length ? rowToTest(rs.rows[0]) : null;
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'test';
}

async function createTest({ title, description, icon, duration, questions, id }) {
  const newId = id || `${slugify(title)}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  await client.execute({
    sql: 'INSERT INTO tests (id, title, description, icon, duration, questions, built_in, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    args: [newId, title, description || '', icon || '📝', duration || null, JSON.stringify(questions), now],
  });
  return getTestById(newId);
}

async function updateTest(id, { title, description, icon, duration, questions }) {
  const rs = await client.execute({
    sql: 'UPDATE tests SET title = ?, description = ?, icon = ?, duration = ?, questions = ? WHERE id = ?',
    args: [title, description || '', icon || '📝', duration || null, JSON.stringify(questions), id],
  });
  if (rs.rowsAffected === 0) return null;
  return getTestById(id);
}

async function deleteTest(id) {
  await client.execute({ sql: 'DELETE FROM tests WHERE id = ? AND built_in = 0', args: [id] });
}

module.exports = {
  init,
  upsertUser,
  addAttempt,
  getUserAttempts,
  getAllAttempts,
  getUsers,
  getTests,
  getTestById,
  createTest,
  updateTest,
  deleteTest,
};
