/* global onTelegramAuth */
'use strict';

const API = {
  get: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error((await res.json()).error || 'Xatolik');
    return res.json();
  },
  post: async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Xatolik');
    return res.json();
  },
  put: async (url, body) => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Xatolik');
    return res.json();
  },
  delete: async (url) => {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Xatolik');
    return res.json();
  },
};

const state = {
  config: null,
  user: null,
  isMember: false,
  currentTest: null,
  currentIndex: 0,
  answers: [],
  result: null,
  editingTestId: null,
  testEndsAt: null,
};

let timerInterval = null;

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function startTimer() {
  stopTimer();
  if (!state.currentTest || !state.currentTest.duration || !state.testEndsAt) return;
  timerInterval = setInterval(() => {
    const remain = Math.max(0, Math.floor((state.testEndsAt - Date.now()) / 1000));
    const el = $('testTimer');
    if (el) {
      el.textContent = '⏱ ' + fmtTime(remain);
      el.classList.toggle('low', remain <= 60 && remain > 0);
      el.classList.toggle('times-up', remain <= 0);
    }
    if (remain <= 0) {
      stopTimer();
      if (!$('testModal').hidden) {
        toast('Vaqt tugadi — test yakunlandi');
        submitTest();
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

const $ = (id) => document.getElementById(id);

function fallbackAvatar(name) {
  const ch = encodeURIComponent((name || '?')[0] || '?');
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="%232a9d8f"/><text x="50" y="68" font-size="44" text-anchor="middle" fill="#fff">' + ch + '</text></svg>'
  );
}

/* ---------------- Theme ---------------- */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeBtn(saved);
}
function updateThemeBtn(theme) {
  $('themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  document.documentElement.setAttribute('data-theme', next);
  updateThemeBtn(next);
}

/* ---------------- Toast ---------------- */
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------------- Views ---------------- */
function showView(name) {
  ['view-login', 'view-join', 'view-app', 'view-admin'].forEach((v) => { $(v).hidden = v !== name; });
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'stats') loadStats();
  if (name === 'leaderboard') loadLeaderboard();
}
function showAdminTab(name) {
  document.querySelectorAll('[data-atab]').forEach((t) => t.classList.toggle('active', t.dataset.atab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'atab-' + name));
}

/* ---------------- Telegram auth ---------------- */
async function loadTelegramWidget() {
  const cfg = state.config;
  if (cfg.dev) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.id = 'devLoginBtn';
    btn.textContent = '🔓 Sinov rejimida kirish (Telegram widgetisiz)';
    btn.addEventListener('click', () => {
      onTelegramAuth({
        id: Math.floor(1000 + Math.random() * 8999),
        first_name: 'Sinov',
        username: 'sinov_foydalanuvchi',
        photo_url: null,
      });
    });
    $('tgWidget').innerHTML = '';
    $('tgWidget').appendChild(btn);
    return;
  }
  if (!cfg.botUsername) {
    $('tgWidget').innerHTML = '<p style="color:var(--text-muted);font-size:13px">Bot username sozlanmagan</p>';
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://telegram.org/js/telegram-widget.js?22';
  s.setAttribute('data-telegram-login', cfg.botUsername);
  s.setAttribute('data-size', 'large');
  s.setAttribute('data-radius', '12');
  s.setAttribute('data-onauth', 'onTelegramAuth(user)');
  s.onerror = () => {
    $('tgWidget').innerHTML = '<p style="color:var(--danger);font-size:13px">Telegram vidjeti yuklanmadi. Sayt HTTPS yoki localhost orqali ochilganiga ishonch hosil qiling.</p>';
  };
  $('tgWidget').innerHTML = '';
  $('tgWidget').appendChild(s);
}

window.onTelegramAuth = async function (user) {
  try {
    const res = await API.post('/api/auth', user);
    state.user = res.user;
    state.isMember = res.isMember;
    renderHeader();
    if (res.isMember) {
      showView('view-app');
      loadTests();
    } else {
      $('channelName').textContent = '@' + String(state.config.channelUsername).replace('@', '');
      $('joinHint').textContent = res.error || '';
      showView('view-join');
    }
  } catch (e) {
    toast('Kirish amalga oshmadi: ' + e.message);
  }
};

function renderHeader() {
  if (!state.user) { $('userChip').hidden = true; return; }
  const chip = $('userChip');
  chip.hidden = false;
  $('userName').textContent = state.user.firstName || state.user.username || 'User';
  $('userAvatar').src = state.user.photoUrl || fallbackAvatar(state.user.firstName);
}

/* ---------------- Tests list ---------------- */
async function loadTests() {
  try {
    const tests = await API.get('/api/tests');
    const grid = $('testsGrid');
    grid.innerHTML = '';
    for (const t of tests) {
      const card = document.createElement('div');
      card.className = 'test-card';
      card.innerHTML =
        '<div class="test-icon">' + (t.icon || '📝') + '</div>' +
        '<div class="test-title">' + t.title + '</div>' +
        '<div class="test-desc">' + t.description + '</div>' +
        '<div class="test-meta">' +
          '<span>❓ ' + t.questionCount + ' savol</span>' +
          (t.duration ? '<span>⏱ ' + t.duration + ' daqiqa</span>' : '') +
        '</div>';
      card.addEventListener('click', () => startTest(t.id));
      grid.appendChild(card);
    }
  } catch (e) {
    $('testsGrid').innerHTML = '<p class="auth-note">Testlar yuklanmadi: ' + e.message + '</p>';
  }
}

/* ---------------- Test runner ---------------- */
async function startTest(testId) {
  try {
    const test = await API.get('/api/tests/' + testId);
    state.currentTest = test;
    state.currentIndex = 0;
    state.answers = new Array(test.questions.length).fill(null);
    state.result = null;
    state.testEndsAt = test.duration ? Date.now() + test.duration * 60 * 1000 : null;
    openModal(renderTestQuestion());
    startTimer();
  } catch (e) {
    if (e.message.includes('a\'zo') || e.message.includes('kir')) {
      toast('Bu test uchun a\'zolik kerak. Qayta tekshirib ko\'ring.');
      await refreshMembership();
    } else {
      toast('Xato: ' + e.message);
    }
  }
}

function openModal(html) {
  $('testModalBody').innerHTML = html;
  $('testModal').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  stopTimer();
  $('testModal').hidden = true;
  document.body.style.overflow = '';
}

function renderTestQuestion() {
  const t = state.currentTest;
  const q = t.questions[state.currentIndex];
  const answered = state.answers.filter((a) => a !== null).length;
  const total = t.questions.length;
  const pct = Math.round(((state.currentIndex + 1) / total) * 100);

  let opts = '';
  const letters = ['A', 'B', 'C', 'D'];
  q.options.forEach((opt, i) => {
    const sel = state.answers[state.currentIndex] === i ? ' selected' : '';
    opts += '<button class="option' + sel + '" data-i="' + i + '">' +
      '<span class="option-letter">' + letters[i] + '</span><span>' + opt + '</span></button>';
  });

  const allAnswered = answered === total;
  const btnRow =
    '<div class="btn-row">' +
      '<button class="btn btn-outline" id="prevBtn"' + (state.currentIndex === 0 ? ' disabled' : '') + '>← Orqaga</button>' +
      (state.currentIndex < total - 1
        ? '<button class="btn btn-primary" id="nextBtn">Keyingi →</button>'
        : '<button class="btn btn-primary" id="submitBtn"' + (allAnswered ? '' : ' disabled') + '>Yakunlash ✅</button>') +
    '</div>';

  return (
    '<div class="modal-header"><h2>📚 ' + t.title + '</h2>' +
      (t.duration && state.testEndsAt
        ? '<div class="test-timer" id="testTimer">⏱ ' + fmtTime(Math.max(0, Math.floor((state.testEndsAt - Date.now()) / 1000))) + '</div>'
        : '') +
      '<button class="close-btn" id="closeTest">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="progress-row">' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-text">' + (state.currentIndex + 1) + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="q-counter">Savol ' + (state.currentIndex + 1) + ' · Javob berildi: ' + answered + '/' + total + '</div>' +
      '<div class="q-text">' + q.q + '</div>' +
      '<div class="options">' + opts + '</div>' +
      btnRow +
    '</div>'
  );
}

function bindTestHandlers() {
  $('closeTest').addEventListener('click', closeModal);

  const options = document.querySelectorAll('#testModalBody .option');
  options.forEach((opt) => {
    opt.addEventListener('click', () => {
      state.answers[state.currentIndex] = Number(opt.dataset.i);
      document.querySelectorAll('#testModalBody .option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      const allAnswered = state.answers.every((a) => a !== null);
      const sb = $('submitBtn');
      if (sb && allAnswered) sb.disabled = false;
    });
  });

  const prev = $('prevBtn');
  if (prev) prev.addEventListener('click', () => {
    state.currentIndex--;
    openModal(renderTestQuestion());
  });

  const next = $('nextBtn');
  if (next) next.addEventListener('click', () => {
    state.currentIndex++;
    openModal(renderTestQuestion());
  });

  const submit = $('submitBtn');
  if (submit) submit.addEventListener('click', submitTest);
}

/* ---------------- Submit & result ---------------- */
async function submitTest() {
  stopTimer();
  const t = state.currentTest;
  try {
    const res = await API.post('/api/tests/' + t.id + '/submit', { answers: state.answers });
    state.result = res;
    openModal(renderResult());
  } catch (e) {
    toast('Natija saqlanmadi: ' + e.message);
  }
}

function gradeColor(percent) {
  if (percent >= 90) return '#2a9d8f';
  if (percent >= 75) return '#2a9d8f';
  if (percent >= 60) return '#f4a261';
  return '#e76f51';
}

function renderResult() {
  const r = state.result;
  const msg = r.percent >= 90 ? 'Zo\'r natija! 🏆' : r.percent >= 75 ? 'Yaxshi natija! 👍' : r.percent >= 60 ? 'Yaxshi, lekin yana mashq qiling 💪' : 'Natija qoniqarsiz, qayta urinib ko\'ring 📚';
  let analysis = '';
  r.analysis.forEach((a) => {
    const letters = ['A', 'B', 'C', 'D'];
    let rows = '';
    a.options.forEach((opt, i) => {
      let cls = '';
      if (i === a.correct) cls = ' correct';
      else if (a.userAnswer !== null && i === a.userAnswer && !a.isCorrect) cls = ' wrong';
      else if (a.userAnswer === null) cls = '';
      const mark = i === a.correct ? ' ✓' : i === a.userAnswer && !a.isCorrect ? ' ✗' : '';
      rows += '<div class="analysis-row' + cls + '">' + letters[i] + ') ' + opt + mark + '</div>';
    });
    if (a.userAnswer === null) {
      rows += '<div class="analysis-row unanswered">Javob berilmadi</div>';
    }
    analysis += '<div class="analysis-item' + (a.isCorrect ? '' : ' wrong') + '">' +
      '<div class="analysis-q">' + a.index + '. ' + a.q + '</div>' +
      rows +
      (a.explanation ? '<div class="analysis-exp">💡 ' + a.explanation + '</div>' : '') +
    '</div>';
  });

  return (
    '<div class="modal-header"><h2>📊 Natija</h2><button class="close-btn" id="closeTest">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="result-hero">' +
        '<div class="result-score" style="color:' + gradeColor(r.percent) + '">' + r.percent + '%</div>' +
        '<div class="result-grade" style="background:' + gradeColor(r.percent) + '">' + r.grade + ' · ' + r.score + '/' + r.total + '</div>' +
        '<div class="result-msg">' + msg + '</div>' +
        '<div style="margin-top:14px;font-size:13px;color:var(--text-muted)">✅ To\'g\'ri: ' + r.correctCount + ' · ❌ Noto\'g\'ri: ' + r.wrongCount + '</div>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-outline" id="restartBtn">🔄 Qayta yechish</button>' +
        '<button class="btn btn-primary" id="analysisBtn">📖 Tahlil</button>' +
      '</div>' +
      '<div id="analysisBlock" hidden>' +
        '<h3 style="margin-top:20px">Savollar tahlili</h3>' +
        '<div class="analysis-list">' + analysis + '</div>' +
      '</div>' +
    '</div>'
  );
}

/* ---------------- Stats ---------------- */
async function loadStats() {
  try {
    const s = await API.get('/api/stats');
    const letters = ['A', 'B', 'C', 'D'];
    $('statsContent').innerHTML = renderStats(s);
  } catch (e) {
    $('statsContent').innerHTML = '<p class="auth-note">Statistika yuklanmadi: ' + e.message + '</p>';
  }
}

function renderStats(s) {
  let byTest = '';
  for (const t of s.byTest) {
    const cls = t.avg >= 75 ? 'good' : t.avg >= 60 ? 'ok' : 'bad';
    byTest += '<tr><td>' + t.title + '</td><td>' + t.attempts + '</td><td>' + t.best + '/' + (s.attempts[0] ? s.attempts[0].total : 20) + '</td><td>' + t.avg.toFixed(1) + '</td><td><span class="badge ' + cls + '">' + Math.round((t.avg / 20) * 100) + '%</span></td></tr>';
  }

  let history = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Hali test yechilmagan</td></tr>';
  if (s.attempts.length) {
    history = s.attempts.map((a) => {
      const cls = a.percent >= 75 ? 'good' : a.percent >= 60 ? 'ok' : 'bad';
      return '<tr><td>' + a.title + '</td><td>' + a.score + '/' + a.total + '</td><td><span class="badge ' + cls + '">' + a.percent + '%</span></td><td>' + new Date(a.date).toLocaleString('uz') + '</td></tr>';
    }).join('');
  }

  return (
    '<div class="stat-cards">' +
      '<div class="stat-card"><div class="stat-value">' + s.totalAttempts + '</div><div class="stat-label">Jami testlar</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + s.avgPercent + '%</div><div class="stat-label">O\'rtacha natija</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + (s.bestAttempt ? s.bestAttempt.percent + '%' : '—') + '</div><div class="stat-label">Eng yaxshi natija</div></div>' +
    '</div>' +
    '<div class="panel">' +
      '<h3>📈 Testlar bo\'yicha statistikangiz</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Test</th><th>Urinishlar</th><th>Eng yaxshi</th><th>O\'rtacha</th><th>Foiz</th></tr></thead><tbody>' + byTest + '</tbody></table></div>' +
    '</div>' +
    '<div class="panel">' +
      '<h3>🕘 Test tarixi</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Test</th><th>Natija</th><th>Foiz</th><th>Sana</th></tr></thead><tbody>' + history + '</tbody></table></div>' +
    '</div>'
  );
}

/* ---------------- Leaderboard ---------------- */
async function loadLeaderboard() {
  try {
    const board = await API.get('/api/leaderboard');
    let html = '';
    if (!board.length) {
      html = '<p class="auth-note">Hali hech kim test yechmagan</p>';
    } else {
      board.forEach((b, i) => {
        html += '<div class="rank-item">' +
          '<div class="rank-num">' + (i + 1) + '</div>' +
          '<img class="rank-avatar" src="' + (b.photoUrl || fallbackAvatar(b.name)) + '" alt="" />' +
          '<div><div class="rank-name">' + b.name + '</div><div class="rank-meta">' + b.attempts + ' ta test</div></div>' +
          '<div class="rank-score">' + b.avgScore.toFixed(1) + '</div>' +
        '</div>';
      });
    }
    $('leaderboardContent').innerHTML = '<div class="panel"><h3>🏆 Eng yaxshi natijalar</h3>' + html + '</div>';
  } catch (e) {
    $('leaderboardContent').innerHTML = '<p class="auth-note">Reyting yuklanmadi: ' + e.message + '</p>';
  }
}

/* ---------------- Membership refresh ---------------- */
async function refreshMembership() {
  try {
    const res = await API.post('/api/verify-membership');
    state.isMember = res.isMember;
    if (res.isMember) {
      showView('view-app');
      loadTests();
      toast('A\'zolik tasdiqlandi! ✅');
    } else {
      toast('Hali a\'zo emassiz. Kanalga qo\'shiling.');
    }
  } catch (e) {
    toast('A\'zolikni tekshirib bo\'lmadi: ' + e.message);
  }
}

/* ---------------- Web App (avtomatik kirish) ---------------- */
function isWebAppContext() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('tgWebAppPlatform')) return true;
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) return true;
  return false;
}

function getWebAppInitData() {
  if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) {
    return window.Telegram.WebApp.initData;
  }
  const params = new URLSearchParams(window.location.search);
  const d = params.get('tgWebAppData');
  if (d) return d;
  if (params.get('hash')) return window.location.search.replace(/^\?/, '');
  return null;
}

async function tryWebAppLogin() {
  const initData = getWebAppInitData();
  if (!initData) return { attempted: false };
  try {
    const res = await API.post('/api/auth/webapp', { initData });
    state.user = res.user;
    state.isMember = res.isMember;
    renderHeader();
    if (res.isMember) {
      showView('view-app');
      loadTests();
    } else {
      $('channelName').textContent = '@' + String(state.config.channelUsername).replace('@', '');
      $('joinHint').textContent = res.error || '';
      showView('view-join');
    }
    return { attempted: true, ok: true };
  } catch (e) {
    return { attempted: true, ok: false, error: e.message };
  }
}

/* ---------------- O'qituvchi (Admin) paneli ---------------- */
let adminTestsCache = [];

async function openAdminPanel() {
  try {
    const me = await API.get('/api/admin/me');
    if (me.isAdmin) {
      showView('view-admin');
      loadAdminData();
      return;
    }
  } catch (e) { /* sessiya yo'q - parol so'raymiz */ }
  openAdminPassword();
}

function openAdminPassword() {
  openModal(
    '<div class="modal-header"><h2>🔒 O\'qituvchi paneli</h2><button class="close-btn" id="closeTest">✕</button></div>' +
    '<div class="modal-body">' +
      '<p class="auth-note" style="margin-top:0;text-align:left">Panelga kirish uchun parolni kiriting:</p>' +
      '<input type="password" id="adminPassword" class="admin-pass-input" placeholder="Parol" autocomplete="current-password" />' +
      '<button class="btn btn-primary btn-block" id="adminLoginBtn" style="margin-top:12px">Kirish</button>' +
      '<p class="auth-note" id="adminPassError" style="color:var(--danger);display:none">Parol noto\'g\'ri</p>' +
    '</div>'
  );
  $('adminPassword').focus();
  const tryLogin = () => doAdminLogin();
  $('adminLoginBtn').addEventListener('click', tryLogin);
  $('adminPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
}

async function doAdminLogin() {
  const pass = $('adminPassword').value;
  try {
    await API.post('/api/admin/login', { password: pass });
    closeModal();
    showView('view-admin');
    loadAdminData();
  } catch (e) {
    $('adminPassError').style.display = 'block';
  }
}

async function adminLogout() {
  try { await API.post('/api/admin/logout'); } catch (e) { /* ignore */ }
  showView('view-app');
  loadTests();
}

async function loadAdminData() {
  loadAdminResults();
  loadAdminTests();
}

/* ---- Natijalar ---- */
async function loadAdminResults() {
  try {
    const results = await API.get('/api/admin/results');
    let testsHtml = '<option value="">Barcha testlar</option>';
    const seen = {};
    for (const r of results) {
      if (!seen[r.testId]) { seen[r.testId] = true; testsHtml += '<option value="' + r.testId + '">' + r.title + '</option>'; }
    }
    $('adminResults').innerHTML =
      '<div class="panel">' +
        '<div class="admin-bar" style="margin-bottom:12px">' +
          '<h3>📊 Natijalar (' + results.length + ')</h3>' +
          '<select id="resultFilter" class="admin-select">' + testsHtml + '</select>' +
        '</div>' +
        '<div class="table-wrap"><table id="resultsTable"><thead><tr><th>Foydalanuvchi</th><th>Test</th><th>Natija</th><th>Foiz</th><th>Sana</th></tr></thead><tbody id="resultsTbody">' + renderResultsRows(results) + '</tbody></table></div>' +
      '</div>';
    $('resultFilter').addEventListener('change', (e) => {
      const v = e.target.value;
      const rows = v ? results.filter((r) => r.testId === v) : results;
      $('resultsTbody').innerHTML = renderResultsRows(rows);
    });
  } catch (e) {
    $('adminResults').innerHTML = '<p class="admin-empty">Natijalar yuklanmadi: ' + e.message + '</p>';
  }
}

function renderResultsRows(rows) {
  if (!rows.length) return '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">Natijalar yo\'q</td></tr>';
  return rows.map((r) => {
    const cls = r.percent >= 75 ? 'good' : r.percent >= 60 ? 'ok' : 'bad';
    return '<tr>' +
      '<td><strong>' + r.name + '</strong>' + (r.username ? '<div class="rank-meta">@' + r.username + '</div>' : '') + '</td>' +
      '<td>' + r.testTitle + '</td>' +
      '<td>' + r.score + '/' + r.total + '</td>' +
      '<td><span class="badge ' + cls + '">' + r.percent + '%</span></td>' +
      '<td>' + new Date(r.date).toLocaleString('uz') + '</td>' +
    '</tr>';
  }).join('');
}

/* ---- Testlar boshqaruvi ---- */
async function loadAdminTests() {
  try {
    adminTestsCache = await API.get('/api/admin/tests');
    if (!adminTestsCache.length) {
      $('adminTests').innerHTML = '<div class="panel"><h3>📝 Testlar</h3><p class="admin-empty">Testlar yo\'q</p></div>';
      return;
    }
    const rows = adminTestsCache.map((t) =>
      '<div class="test-row">' +
        '<div class="t-icon">' + (t.icon || '📝') + '</div>' +
        '<div class="t-info">' +
          '<div class="t-title">' + t.title + (t.builtIn ? ' <span class="badge ok">standart</span>' : '') + '</div>' +
          '<div class="t-meta">❓ ' + t.questionCount + ' savol' + (t.duration ? ' · ⏱ ' + t.duration + ' daq' : '') + '</div>' +
        '</div>' +
        '<button class="btn btn-outline btn-sm" data-edit="' + t.id + '">✏️ Tahrirlash</button>' +
        (t.builtIn ? '' : '<button class="btn btn-danger btn-sm" data-del="' + t.id + '">🗑 O\'chirish</button>') +
      '</div>'
    ).join('');

    $('adminTests').innerHTML =
      '<div class="panel">' +
        '<div class="admin-bar" style="margin-bottom:12px">' +
          '<h3>📝 Testlar</h3>' +
          '<button class="btn btn-primary btn-sm" id="newTestBtn">➕ Yangi test</button>' +
        '</div>' + rows +
      '</div>';

    $('newTestBtn').addEventListener('click', () => openTestEditor(null));

    document.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const t = adminTestsCache.find((x) => x.id === b.dataset.edit);
        if (t) loadTestForEdit(t.id);
      });
    });
    document.querySelectorAll('[data-del]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!confirm('Bu testni o\'chirishni tasdiqlaysizmi?')) return;
        try {
          await API.delete('/api/admin/tests/' + b.dataset.del);
          loadAdminTests();
          toast('Test o\'chirildi');
        } catch (e) { toast('Xato: ' + e.message); }
      });
    });
  } catch (e) {
    $('adminTests').innerHTML = '<p class="admin-empty">Xato: ' + e.message + '</p>';
  }
}

async function loadTestForEdit(id) {
  try {
    const test = await API.get('/api/admin/tests/' + id + '/full');
    openTestEditor(test);
  } catch (e) {
    toast('Xato: ' + e.message);
  }
}

const LETTERS = ['A', 'B', 'C', 'D'];

function emptyQuestions(n) {
  return Array.from({ length: n }, () => ({ q: '', options: ['', '', '', ''], correct: 0, explanation: '' }));
}

function renderEditorQuestions(questions) {
  return questions.map((q, i) => {
    const correctBtns = LETTERS.map((L, ci) =>
      '<button type="button" class="correct-btn' + (q.correct === ci ? ' active' : '') + '" data-opt="' + ci + '">' + L + '</button>'
    ).join('');
    return '<div class="q-block">' +
      '<div class="q-block-head"><span class="q-num">Savol ' + (i + 1) + '</span>' +
        '<span class="q-block-actions"><span class="q-expl">To\'g\'ri javobni tanlang</span>' +
        '<button type="button" class="q-del" title="Savolni o\'chirish">🗑</button></span></div>' +
      '<textarea class="edit-q" placeholder="Savol matni..." rows="2">' + q.q + '</textarea>' +
      '<div class="q-options">' + LETTERS.map((L, oi) =>
        '<input class="edit-opt" data-opt="' + oi + '" placeholder="' + L + ') variant" value="' + (q.options[oi] || '').replace(/"/g, '&quot;') + '" />'
      ).join('') + '</div>' +
      '<div class="q-correct-row">To\'g\'ri: ' + correctBtns + '</div>' +
      '<input class="edit-expl" placeholder="Izoh (ixtiyoriy)" value="' + (q.explanation || '').replace(/"/g, '&quot;') + '" />' +
    '</div>';
  }).join('');
}

function renumberEditor() {
  document.querySelectorAll('#testModalBody .q-block .q-num').forEach((el, i) => {
    el.textContent = 'Savol ' + (i + 1);
  });
}

function collectEditorQuestions() {
  const blocks = document.querySelectorAll('#testModalBody .q-block');
  return Array.from(blocks).map((b) => ({
    q: b.querySelector('.edit-q').value.trim(),
    options: Array.from(b.querySelectorAll('.edit-opt')).map((inp) => inp.value.trim()),
    correct: Number(b.dataset.correct || 0),
    explanation: b.querySelector('.edit-expl').value.trim(),
  }));
}

function openTestEditor(test) {
  const isEdit = !!test;
  const questions = isEdit ? test.questions : emptyQuestions(3);
  state.editingTestId = isEdit ? test.id : null;

  openModal(
    '<div class="modal-header"><h2>' + (isEdit ? '✏️ Testni tahrirlash' : '➕ Yangi test') + '</h2><button class="close-btn" id="closeTest">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="editor-grid">' +
        '<div class="form-field full"><label>Test nomi *</label><input id="editTitle" value="' + (test ? test.title.replace(/"/g, '&quot;') : '') + '" placeholder="Masalan: Sitologiya" /></div>' +
        '<div class="form-field full"><label>Tavsif</label><textarea id="editDesc" rows="2" placeholder="Qisqacha tavsif...">' + (test ? test.description : '') + '</textarea></div>' +
        '<div class="form-field"><label>Belgi (emoji)</label><input id="editIcon" value="' + (test ? test.icon : '📝') + '" /></div>' +
        '<div class="form-field"><label>Daqiqa (ixtiyoriy)</label><input id="editDuration" type="number" min="0" value="' + (test && test.duration ? test.duration : '') + '" placeholder="20" /></div>' +
      '</div>' +
      '<h3 style="font-size:15px;margin:8px 0" id="editorQuestionsHead">Savollar (' + questions.length + ')</h3>' +
      '<div id="editorQuestions">' + renderEditorQuestions(questions) + '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-outline" id="addQuestionBtn">➕ Savol qo\'shish</button>' +
        '<button class="btn btn-primary" id="saveTestBtn">💾 Saqlash</button>' +
      '</div>' +
    '</div>'
  );
}

function addQuestionToEditor() {
  $('editorQuestions').insertAdjacentHTML('beforeend', renderEditorQuestions(emptyQuestions(1)));
  renumberEditor();
  $('editorQuestions').scrollIntoView({ block: 'end', behavior: 'smooth' });
}

async function saveTestFromEditor() {
  const title = $('editTitle').value.trim();
  if (!title) { toast('Test nomi kerak'); return; }
  const questions = collectEditorQuestions();
  if (!questions.length) { toast('Kamida bitta savol kerak'); return; }
  const emptyIdx = questions.findIndex((q) => !q.q || q.options.some((o) => !o));
  if (emptyIdx >= 0) { toast('Savol ' + (emptyIdx + 1) + ' to\'liq emas'); return; }

  const payload = {
    title,
    description: $('editDesc').value.trim(),
    icon: $('editIcon').value.trim() || '📝',
    duration: $('editDuration').value ? Number($('editDuration').value) : null,
    questions,
  };

  try {
    if (state.editingTestId) {
      await API.put('/api/admin/tests/' + state.editingTestId, payload);
      toast('Test yangilandi');
    } else {
      await API.post('/api/admin/tests', payload);
      toast('Test yaratildi');
    }
    closeModal();
    loadAdminTests();
  } catch (e) {
    toast('Xato: ' + e.message);
  }
}

/* ---------------- Init ---------------- */
async function init() {
  initTheme();
  $('themeToggle').addEventListener('click', toggleTheme);
  $('brand').addEventListener('click', () => { showView('view-app'); loadTests(); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.querySelectorAll('[data-atab]').forEach((t) => t.addEventListener('click', () => showAdminTab(t.dataset.atab)));
  $('joinChannelBtn').addEventListener('click', () => { window.open(state.config.channelUrl, '_blank'); });
  $('recheckBtn').addEventListener('click', refreshMembership);

  $('adminBtn').addEventListener('click', openAdminPanel);
  $('backToSiteBtn').addEventListener('click', () => { showView('view-app'); loadTests(); });
  $('adminLogoutBtn').addEventListener('click', adminLogout);

  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
    window.Telegram.WebApp.disableVerticalSwipes && window.Telegram.WebApp.disableVerticalSwipes();
  }

  $('testModal').addEventListener('click', (e) => {
    if (e.target.id === 'closeTest') { closeModal(); return; }
    if (e.target.id === 'restartBtn') { startTest(state.currentTest.id); return; }
    if (e.target.id === 'analysisBtn') {
      $('analysisBlock').hidden = false;
      e.target.style.display = 'none';
      return;
    }
    if (e.target.id === 'saveTestBtn') { saveTestFromEditor(); return; }
    if (e.target.id === 'addQuestionBtn') { addQuestionToEditor(); return; }
    const del = e.target.closest('.q-del');
    if (del) {
      const blocks = document.querySelectorAll('#testModalBody .q-block');
      if (blocks.length <= 1) { toast('Kamida bitta savol qolishi kerak'); return; }
      del.closest('.q-block').remove();
      renumberEditor();
      $('editorQuestionsHead').textContent = 'Savollar (' + (blocks.length - 1) + ')';
      return;
    }
    const cb = e.target.closest('.correct-btn');
    if (cb) {
      const block = cb.closest('.q-block');
      block.querySelectorAll('.correct-btn').forEach((b) => b.classList.remove('active'));
      cb.classList.add('active');
      block.dataset.correct = cb.dataset.opt;
      return;
    }
    if (e.target === $('testModal')) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('testModal').hidden) closeModal();
  });

  try {
    state.config = await API.get('/api/config');
    $('joinChannelBtn').href = state.config.channelUrl;
    $('channelName').textContent = '@' + String(state.config.channelUsername).replace('@', '');
  } catch (e) {
    toast('Server bilan bog\'lanib bo\'lmadi');
    return;
  }

  // Telegram Web App orqali ochilganda HAR DOIM joriy hisobni qayta tekshiramiz.
  // Bu ikkita Telegram hisobi bo'lgan qurilmada muhim: eski sessiya yangi hisobni bloklamasligi kerak.
  if (getWebAppInitData()) {
    const webAppLogged = await tryWebAppLogin();
    if (webAppLogged.ok) return;
    showView('view-login');
    $('tgWidget').innerHTML =
      '<p style="color:var(--danger);font-size:13px;line-height:1.5">Avtomatik kirish amalga oshmadi' +
      (webAppLogged.error ? ': ' + webAppLogged.error : '') +
      '</p>' +
      '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">Botdagi "🌐 Sayt" tugmasini qayta bosib ko\'ring.</p>';
    return;
  }

  // Web App emas (oddiy brauzer): mavjud sessiya yoki Login Widget
  try {
    const me = await API.get('/api/me');
    state.user = me.user;
    state.isMember = me.isMember;
    renderHeader();
    if (me.isMember) {
      showView('view-app');
      loadTests();
    } else {
      showView('view-join');
    }
  } catch (e) {
    showView('view-login');
    loadTelegramWidget();
  }
}

// Test modal ichidagi hodisalar: har safar HTML yangilanganda qayta biriktiramiz
const observer = new MutationObserver(() => {
  if (!$('testModal').hidden && $('testModalBody').querySelector('.option')) bindTestHandlers();
});
observer.observe($('testModalBody'), { childList: true, subtree: false });

init();
