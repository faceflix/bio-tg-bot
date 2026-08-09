require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');

const { verifyLoginData, checkChannelMembership, verifyWebAppData } = require('./lib/telegram');
const store = require('./lib/store');

const app = express();
const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const BOT_USERNAME = process.env.BOT_USERNAME || '';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '';
const CHANNEL_URL = process.env.CHANNEL_URL || `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Testlar endi bazadan o'qiladi (admin yaratgan testlar ham shu yerda)
async function getTests() {
  return store.getTests();
}
async function getTestById(id) {
  return store.getTestById(id);
}

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'bio-test-tg-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Avval Telegram orqali kiring' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Avval parol kiriting' });
  }
  next();
}

// ---------------- O'QITUVCHI (ADMIN) PANELI ----------------
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD sozlanmagan' });
  }
  const password = (req.body || {}).password;
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Parol noto\'g\'ri' });
  }
  req.session.isAdmin = true;
  req.session.save(() => res.json({ ok: true }));
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.isAdmin = false;
  req.session.save(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// Barcha natijalar (foydalanuvchi ma'lumotlari bilan)
app.get('/api/admin/results', requireAdmin, async (req, res) => {
  const [attempts, users, tests] = await Promise.all([
    store.getAllAttempts(),
    store.getUsers(),
    store.getTests(),
  ]);
  const testTitle = {};
  for (const t of tests) testTitle[t.id] = t.title;
  const enriched = attempts
    .map((a) => {
      const u = users[String(a.userId)] || {};
      return {
        id: a.id,
        userId: a.userId,
        name: u.firstName || u.username || String(a.userId),
        username: u.username || null,
        photoUrl: u.photoUrl || null,
        testId: a.testId,
        testTitle: testTitle[a.testId] || a.testId,
        score: a.score,
        total: a.total,
        percent: a.percent,
        date: a.createdAt,
        answers: a.answers,
      };
    })
    .sort((x, y) => new Date(y.date) - new Date(x.date));
  res.json(enriched);
});

// Testlar ro'yxati (boshqaruv uchun, savollarsiz)
app.get('/api/admin/tests', requireAdmin, async (req, res) => {
  const tests = await store.getTests();
  res.json(
    tests.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      icon: t.icon,
      duration: t.duration,
      questionCount: t.questions.length,
      builtIn: t.builtIn,
    }))
  );
});

function validateTestPayload(body) {
  const { title, description, icon, duration, questions } = body || {};
  if (!title || !String(title).trim()) return { error: 'Test nomi kerak' };
  if (!Array.isArray(questions) || questions.length === 0) return { error: 'Kamida bitta savol kerak' };
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] || {};
    if (!q.q || !String(q.q).trim()) return { error: `${i + 1}-savol matni bo'sh` };
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some((o) => !String(o || '').trim())) {
      return { error: `${i + 1}-savolda 4 ta to'liq variant bo'lishi kerak` };
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
      return { error: `${i + 1}-savolning to'g'ri javobi noto'g'ri` };
    }
  }
  return {
    data: {
      title: String(title).trim(),
      description: String(description || '').trim(),
      icon: String(icon || '📝').trim(),
      duration: Number(duration) || null,
      questions: questions.map((q) => ({
        q: String(q.q).trim(),
        options: q.options.map((o) => String(o).trim()),
        correct: q.correct,
        explanation: String(q.explanation || '').trim(),
        image: String(q.image || ''),
      })),
    },
  };
}

// To'liq test (savollari bilan) - tahrirlash uchun
app.get('/api/admin/tests/:id/full', requireAdmin, async (req, res) => {
  const test = await store.getTestById(req.params.id);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });
  res.json({
    id: test.id,
    title: test.title,
    description: test.description,
    icon: test.icon,
    duration: test.duration,
    builtIn: test.builtIn,
    questions: test.questions,
  });
});

app.post('/api/admin/tests', requireAdmin, async (req, res) => {
  const v = validateTestPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const created = await store.createTest(v.data);
  res.json({ ok: true, id: created.id, title: created.title, questionCount: created.questions.length });
});

app.put('/api/admin/tests/:id', requireAdmin, async (req, res) => {
  const v = validateTestPayload(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const updated = await store.updateTest(req.params.id, v.data);
  if (!updated) return res.status(404).json({ error: 'Test topilmadi' });
  res.json({ ok: true });
});

app.delete('/api/admin/tests/:id', requireAdmin, async (req, res) => {
  const test = await store.getTestById(req.params.id);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });
  if (test.builtIn) return res.status(400).json({ error: 'Standart testlarni o\'chirib bo\'lmaydi' });
  await store.deleteTest(req.params.id);
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    botUsername: BOT_USERNAME,
    channelUsername: CHANNEL_USERNAME,
    channelUrl: CHANNEL_URL,
    dev: DEV_AUTH,
  });
});

// DEV_AUTH=1 bo'lsa, Telegram tokensiz sinash rejimi (faqat lokal test uchun!)
const DEV_AUTH = process.env.DEV_AUTH === '1';

// Telegram Login Widget'dan kelgan ma'lumotni tekshiramiz
app.post('/api/auth', async (req, res) => {
  try {
    const data = req.body || {};

    if (DEV_AUTH) {
      const devUser = {
        id: Number(data.id) || 12345,
        first_name: data.first_name || 'Sinov',
        last_name: data.last_name || null,
        username: data.username || 'sinov_foydalanuvchi',
        photo_url: data.photo_url || null,
      };
      const user = await store.upsertUser(devUser);
      req.session.user = {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
      };
      req.session.isMember = true;
      await new Promise((resolve) => req.session.save(resolve));
      return res.json({ user: req.session.user, isMember: true, dev: true });
    }

    if (!verifyLoginData({ ...data }, BOT_TOKEN)) {
      return res.status(400).json({ error: 'Telegram ma\'lumotlari tasdiqlanmadi' });
    }

    const user = await store.upsertUser(data);
    const membership = await checkChannelMembership(BOT_TOKEN, CHANNEL_USERNAME, data.id);

    req.session.user = {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      photoUrl: user.photoUrl,
    };
    req.session.isMember = membership.isMember;
    await new Promise((resolve) => req.session.save(resolve));

    res.json({
      user: req.session.user,
      isMember: membership.isMember,
      status: membership.status,
      error: membership.error,
      channelUrl: CHANNEL_URL,
    });
  } catch (e) {
    console.error('auth error:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Kirilmagan' });
  res.json({ user: req.session.user, isMember: !!req.session.isMember });
});

// Telegram Web App (botdagi tugma orqali) - avtomatik kirish
app.post('/api/auth/webapp', async (req, res) => {
  try {
    const hasInitData = !!req.body.initData;
    const user = verifyWebAppData(req.body.initData, BOT_TOKEN);
    if (!user) {
      console.warn(`[webapp-auth] rad etildi (initData=${hasInitData ? 'bor' : 'yoq'}, token=${BOT_TOKEN ? 'bor' : 'YOQ'})`);
      return res.status(400).json({ error: 'Telegram ma\'lumotlari tasdiqlanmadi' });
    }

    const stored = await store.upsertUser({
      id: user.id,
      first_name: user.first_name || '',
      last_name: user.last_name || null,
      username: user.username || null,
      photo_url: user.photo_url || null,
    });
    const membership = await checkChannelMembership(BOT_TOKEN, CHANNEL_USERNAME, user.id);
    console.log(`[webapp-auth] OK user=${user.id} isMember=${membership.isMember} status=${membership.status}`);

    req.session.user = {
      id: stored.id,
      username: stored.username,
      firstName: stored.firstName,
      lastName: stored.lastName,
      photoUrl: stored.photoUrl,
    };
    req.session.isMember = membership.isMember;
    await new Promise((resolve) => req.session.save(resolve));

    res.json({
      user: req.session.user,
      isMember: membership.isMember,
      status: membership.status,
      error: membership.error,
    });
  } catch (e) {
    console.error('webapp auth error:', e);
    res.status(500).json({ error: 'Server xatosi' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// A'zolikni qayta tekshirish
app.post('/api/verify-membership', requireAuth, async (req, res) => {
  const membership = await checkChannelMembership(BOT_TOKEN, CHANNEL_USERNAME, req.session.user.id);
  req.session.isMember = membership.isMember;
  await new Promise((resolve) => req.session.save(resolve));
  res.json({ isMember: membership.isMember, status: membership.status, error: membership.error });
});

// Testlar ro'yxati (a'zo bo'lmasa ham ko'rinadi, lekin ishlatib bo'lmaydi)
app.get('/api/tests', async (req, res) => {
  const list = (await getTests()).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    icon: t.icon || '📝',
    questionCount: t.questions.length,
    duration: t.duration || null,
  }));
  res.json(list);
});

// Test savollari - faqat a'zo uchun
app.get('/api/tests/:id', requireAuth, async (req, res) => {
  if (!req.session.isMember) {
    return res.status(403).json({ error: 'Kanalga a\'zo bo\'lishingiz kerak' });
  }
  const test = await getTestById(req.params.id);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });

  res.json({
    id: test.id,
    title: test.title,
    description: test.description,
    duration: test.duration || null,
    questions: test.questions.map((q) => ({
      q: q.q,
      options: q.options,
      correct: q.correct,
      explanation: q.explanation || '',
      image: q.image || '',
    })),
  });
});

// Javoblarni qabul qilib, natijani hisoblaymiz va saqlaymiz
app.post('/api/tests/:id/submit', requireAuth, async (req, res) => {
  if (!req.session.isMember) {
    return res.status(403).json({ error: 'Kanalga a\'zo bo\'lishingiz kerak' });
  }
  const test = await getTestById(req.params.id);
  if (!test) return res.status(404).json({ error: 'Test topilmadi' });

  const answers = req.body.answers;
  if (!Array.isArray(answers) || answers.length !== test.questions.length) {
    return res.status(400).json({ error: 'Noto\'g\'ri javoblar formati' });
  }

  let score = 0;
  const analysis = test.questions.map((q, i) => {
    const userAnswer = answers[i];
    const isCorrect = userAnswer === q.correct;
    if (isCorrect) score++;
    return {
      index: i + 1,
      q: q.q,
      options: q.options,
      correct: q.correct,
      userAnswer: typeof userAnswer === 'number' ? userAnswer : null,
      isCorrect,
      explanation: q.explanation || '',
    };
  });

  const total = test.questions.length;
  const percent = Math.round((score / total) * 100);

  const attempt = await store.addAttempt({
    userId: req.session.user.id,
    testId: test.id,
    answers,
    score,
    total,
    percent,
  });

  const grade = percent >= 90 ? 'A' : percent >= 80 ? 'B' : percent >= 70 ? 'C' : percent >= 60 ? 'D' : 'F';

  res.json({
    attemptId: attempt.id,
    score,
    total,
    percent,
    grade,
    correctCount: score,
    wrongCount: total - score,
    analysis,
  });
});

// Foydalanuvchining statistikasi
app.get('/api/stats', requireAuth, async (req, res) => {
  const attempts = await store.getUserAttempts(req.session.user.id);
  const tests = await getTests();
  const testMap = {};
  for (const t of tests) testMap[t.id] = t.title;

  const byTest = {};
  for (const a of attempts) {
    if (!byTest[a.testId]) {
      byTest[a.testId] = { testId: a.testId, title: testMap[a.testId] || a.testId, attempts: 0, totalScore: 0, best: 0, last: 0 };
    }
    byTest[a.testId].attempts++;
    byTest[a.testId].totalScore += a.score;
    byTest[a.testId].best = Math.max(byTest[a.testId].best, a.score);
    byTest[a.testId].last = a.score;
  }
  const byTestArr = Object.values(byTest).map((t) => ({ ...t, avg: t.totalScore / t.attempts }));

  const totalAttempts = attempts.length;
  const avgPercent = totalAttempts ? Math.round(attempts.reduce((s, a) => s + a.percent, 0) / totalAttempts) : 0;
  const bestAttempt = attempts.length ? attempts.reduce((b, a) => (a.percent > b.percent ? a : b)) : null;

  res.json({
    totalAttempts,
    avgPercent,
    bestAttempt: bestAttempt ? { testId: bestAttempt.testId, title: testMap[bestAttempt.testId] || '', percent: bestAttempt.percent, score: bestAttempt.score, date: bestAttempt.createdAt } : null,
    byTest: byTestArr,
    attempts: attempts.map((a) => ({ id: a.id, testId: a.testId, title: testMap[a.testId] || a.testId, score: a.score, total: a.total, percent: a.percent, date: a.createdAt })),
  });
});

// Birinchi 10 talik reyting (umumiy)
app.get('/api/leaderboard', async (req, res) => {
  const attempts = await store.getAllAttempts();
  const users = await store.getUsers();
  const scores = {};
  for (const a of attempts) {
    if (!scores[a.userId]) scores[a.userId] = { userId: a.userId, attempts: 0, totalScore: 0 };
    scores[a.userId].attempts++;
    scores[a.userId].totalScore += a.score;
  }
  const board = Object.values(scores)
    .map((s) => {
      const u = users[String(s.userId)] || {};
      return {
        name: u.firstName || u.username || String(s.userId),
        username: u.username || null,
        photoUrl: u.photoUrl || null,
        attempts: s.attempts,
        avgScore: Math.round((s.totalScore / s.attempts) * 100) / 100,
      };
    })
    .sort((x, y) => y.avgScore - x.avgScore || x.attempts - y.attempts)
    .slice(0, 10);
  res.json(board);
});

// SPA - har qanday noma'lum GET frontend qaytarsin
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

store
  .init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server http://localhost:${PORT} da ishlamoqda (DB: ${process.env.DATABASE_URL || 'file:data/db.sqlite'})`);
    });
  })
  .catch((err) => {
    console.error('DB ishga tushmadi:', err);
    process.exit(1);
  });
