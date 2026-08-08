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
};

const state = {
  config: null,
  user: null,
  isMember: false,
  currentTest: null,
  currentIndex: 0,
  answers: [],
  result: null,
};

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
  ['view-login', 'view-join', 'view-app'].forEach((v) => { $(v).hidden = v !== name; });
}
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'stats') loadStats();
  if (name === 'leaderboard') loadLeaderboard();
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
    openModal(renderTestQuestion());
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
    '<div class="modal-header"><h2>📚 ' + t.title + '</h2><button class="close-btn" id="closeTest">✕</button></div>' +
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

/* ---------------- Init ---------------- */
async function init() {
  initTheme();
  $('themeToggle').addEventListener('click', toggleTheme);
  $('brand').addEventListener('click', () => { showView('view-app'); loadTests(); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('joinChannelBtn').addEventListener('click', () => { window.open(state.config.channelUrl, '_blank'); });
  $('recheckBtn').addEventListener('click', refreshMembership);

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
    return;
  } catch (e) {
    /* sessiya yo'q - davom etamiz */
  }

  const webAppLogged = await tryWebAppLogin();
  if (!webAppLogged.attempted) {
    showView('view-login');
    loadTelegramWidget();
  } else if (!webAppLogged.ok) {
    showView('view-login');
    $('tgWidget').innerHTML =
      '<p style="color:var(--danger);font-size:13px;line-height:1.5">Avtomatik kirish amalga oshmadi' +
      (webAppLogged.error ? ': ' + webAppLogged.error : '') +
      '</p>' +
      (isWebAppContext() ? '<p style="color:var(--text-muted);font-size:12px;margin-top:8px">Botdagi "🌐 Sayt" tugmasini qayta bosib ko\'ring.</p>' : '');
  }
}

// Test modal ichidagi hodisalar: har safar HTML yangilanganda qayta biriktiramiz
const observer = new MutationObserver(() => {
  if (!$('testModal').hidden && $('testModalBody').querySelector('.option')) bindTestHandlers();
});
observer.observe($('testModalBody'), { childList: true, subtree: false });

init();
