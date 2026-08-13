/* global onTelegramAuth */
'use strict';

const API = {
  async _handle(res) {
    if (res.ok) return res.json();
    let data = null;
    try { data = await res.json(); } catch (e) { /* ignore */ }
    const err = new Error((data && data.error) || 'Xatolik');
    err.data = data;
    throw err;
  },
  get: async (url) => API._handle(await fetch(url)),
  post: async (url, body) => API._handle(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
  ),
  put: async (url, body) => API._handle(
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  ),
  delete: async (url, body) => API._handle(
    await fetch(url, {
      method: 'DELETE',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  ),
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
  if (!state.user) { $('userChip').hidden = true; renderUserIdBar(); return; }
  const chip = $('userChip');
  chip.hidden = false;
  $('userName').textContent = state.user.firstName || state.user.username || 'User';
  $('userAvatar').src = state.user.photoUrl || fallbackAvatar(state.user.firstName);
  renderUserIdBar();
}

function renderUserIdBar() {
  const bar = $('userIdBar');
  if (!bar) return;
  if (!state.user || !state.user.code) { bar.hidden = true; return; }
  $('userCode').textContent = state.user.code;
  bar.hidden = false;
}

/* ---------------- Tests list ---------------- */
async function loadTests() {
  try {
    const tests = await API.get('/api/tests');
    const grid = $('testsGrid');
    grid.innerHTML = '';
    for (const t of tests) {
      const card = document.createElement('div');
      card.className = 'test-card' + ((t.price && !t.unlocked) ? ' locked' : '');
      card.innerHTML =
        '<div class="test-icon">' + (t.icon || '📝') + '</div>' +
        '<div class="test-title">' + t.title + '</div>' +
        '<div class="test-desc">' + t.description + '</div>' +
        '<div class="test-meta">' +
          '<span>❓ ' + t.questionCount + ' savol</span>' +
          (t.duration ? '<span>⏱ ' + t.duration + ' daqiqa</span>' : '') +
          (t.price ? '<span class="price-tag">' + (t.unlocked ? '💳 ochiq' : '🔒 ' + t.price + ' so\'m') + '</span>' : '') +
        '</div>';
      card.addEventListener('click', () => {
        if (t.price && !t.unlocked) openPaymentModal(t);
        else startTest(t.id);
      });
      grid.appendChild(card);
    }
  } catch (e) {
    $('testsGrid').innerHTML = '<p class="auth-note">Testlar yuklanmadi: ' + e.message + '</p>';
  }
}

/* ---------------- Test runner ---------------- */
async function startTest(testId) {
  try {
    clearDraft();
    hideDraftBar();
    resumeDraft = null;
    const test = await API.get('/api/tests/' + testId);
    state.currentTest = test;
    state.currentIndex = 0;
    state.answers = new Array(test.questions.length).fill(null);
    state.result = null;
    state.testEndsAt = test.duration ? Date.now() + test.duration * 60 * 1000 : null;
    openModal(renderTestQuestion());
    startTimer();
  } catch (e) {
    if (e.data && e.data.error === 'TO_LOV') {
      openPaymentModal(e.data);
      return;
    }
    if (e.message.includes('a\'zo') || e.message.includes('kir')) {
      toast('Bu test uchun a\'zolik kerak. Qayta tekshirib ko\'ring.');
      await refreshMembership();
    } else {
      toast('Xato: ' + e.message);
    }
  }
}

/* ---------------- Pullik test (to'lov modali) ---------------- */
let payTestId = null;

function openPaymentModal(t) {
  payTestId = t.id;
  const card = (state.config && state.config.paymentCard) || 'Ustozdan karta raqamini so\'rang';
  const idCode = state.user ? state.user.code : '—';
  openModal(
    '<div class="modal-header"><h2>🔒 ' + t.title + '</h2><button class="close-btn" id="closeTest">✕</button></div>' +
    '<div class="modal-body">' +
      '<div class="pay-box">' +
        '<div class="pay-price">To\'lov: <strong>' + t.price + ' so\'m</strong></div>' +
        '<div class="pay-card">Karta: <strong>' + card + '</strong></div>' +
        '<div class="pay-note">' +
          '<b>Qadamlar:</b><br>' +
          '1) Ko\'rsatilgan kartaga pul o\'tkazing yoki naqd to\'lang<br>' +
          '2) Ustozga <b style="font-size:15px">ID ( ' + idCode + ' )</b> va test nomini ayting<br>' +
          '3) Ustoz tasdiqlagach, quyidagi tugmani bosing' +
        '</div>' +
        '<button class="btn btn-primary btn-block" id="payRecheckBtn">✅ To\'lov qildim — tekshirish</button>' +
      '</div>' +
    '</div>'
  );
}

async function recheckPayment() {
  if (!payTestId) { closeModal(); loadTests(); return; }
  try {
    const tests = await API.get('/api/tests');
    const t = tests.find((x) => x.id === payTestId);
    closeModal();
    loadTests();
    if (t && t.price && !t.unlocked) {
      toast('Hali tasdiqlanmagan — ustozga ID-ingizni aytganingizni tekshiring');
    } else {
      toast('To\'lov tasdiqlandi! Test ochildi 🎉');
    }
  } catch (e) {
    closeModal();
    toast('Xato: ' + e.message);
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

  let nav = '';
  t.questions.forEach((_, i) => {
    const cls = 'qn' +
      (state.answers[i] !== null ? ' answered' : '') +
      (i === state.currentIndex ? ' current' : '');
    nav += '<button type="button" class="' + cls + '" data-nav="' + i + '">' + (i + 1) + '</button>';
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
      '<span class="header-actions">' +
        '<button class="close-btn" id="minimizeBtn" title="Kichraytirish (panelga saqlash)">—</button>' +
        '<button class="close-btn" id="closeTest">✕</button>' +
      '</span></div>' +
    '<div class="modal-body">' +
      '<div class="progress-row">' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="progress-text">' + (state.currentIndex + 1) + ' / ' + total + '</div>' +
      '</div>' +
      '<div class="q-nav">' + nav + '</div>' +
      '<div class="q-counter">Savol ' + (state.currentIndex + 1) + ' · Javob berildi: ' + answered + '/' + total + '</div>' +
      '<div class="q-text">' + q.q + '</div>' +
      (q.image ? '<img class="test-q-img" src="' + q.image + '" alt="rasm" />' : '') +
      '<div class="options">' + opts + '</div>' +
      '<div class="objection-wrap">' +
        '<button type="button" class="btn btn-outline btn-sm objection-btn" id="objectionBtn">⚠️ E\'tiroz</button>' +
        '<div class="objection-form" id="objectionForm" hidden>' +
          '<textarea id="objectionText" placeholder="Savolda xato yoki muammo bo\'lsa yozing..." rows="2" maxlength="1000"></textarea>' +
          '<div class="btn-row">' +
            '<button class="btn btn-outline btn-sm" id="objectionCancel">Bekor</button>' +
            '<button class="btn btn-primary btn-sm" id="objectionSend">Yuborish</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
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
      saveDraft();
    });
  });

  const prev = $('prevBtn');
  if (prev) prev.addEventListener('click', () => {
    state.currentIndex--;
    openModal(renderTestQuestion());
    saveDraft();
  });

  const next = $('nextBtn');
  if (next) next.addEventListener('click', () => {
    state.currentIndex++;
    openModal(renderTestQuestion());
    saveDraft();
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
    clearDraft();
    state.result = res;
    openModal(renderResult());
  } catch (e) {
    toast('Natija saqlanmadi: ' + e.message);
  }
}

async function sendObjection() {
  const t = state.currentTest;
  const message = $('objectionText').value.trim();
  if (!message) { toast('E\'tiroz matnini yozing'); return; }
  try {
    await API.post('/api/tests/' + t.id + '/objection', {
      questionIndex: state.currentIndex,
      message,
    });
    $('objectionForm').hidden = true;
    $('objectionText').value = '';
    toast('E\'tiroz yuborildi, rahmat!');
  } catch (e) {
    toast('Xato: ' + e.message);
  }
}

/* ---------------- Test holatini saqlash (uzilsa davom etish) ---------------- */
const DRAFT_KEY = 'bioTestDraft';
const DRAFT_GRACE = 5 * 60 * 1000;

let resumeDraft = null;
let draftBarTimer = null;

function saveDraft() {
  if (!state.currentTest) return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      userId: state.user ? state.user.id : null,
      testId: state.currentTest.id,
      currentIndex: state.currentIndex,
      answers: state.answers,
      endsAt: state.testEndsAt,
      leftAt: Date.now(),
    }));
  } catch (e) { /* ignore */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
}

function getDraftFromStorage() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function stopDraftBarTimer() {
  if (draftBarTimer) { clearInterval(draftBarTimer); draftBarTimer = null; }
}

function hideDraftBar() {
  stopDraftBarTimer();
  const b = $('draftBar');
  if (b) b.hidden = true;
}

async function showDraftBar() {
  stopDraftBarTimer();
  const bar = $('draftBar');
  if (!bar) return;
  const draft = getDraftFromStorage();
  if (!draft) { bar.hidden = true; return; }

  const now = Date.now();
  const five = draft.leftAt + DRAFT_GRACE;
  const deadline = draft.endsAt ? Math.min(draft.endsAt, five) : five;

  if (now >= deadline) {
    clearDraft();
    bar.hidden = true;
    await draftFinalize();
    return;
  }

  let test = (resumeDraft && resumeDraft.test && resumeDraft.test.id === draft.testId) ? resumeDraft.test : null;
  if (!test) {
    try { test = await API.get('/api/tests/' + draft.testId); } catch (e) { clearDraft(); bar.hidden = true; return; }
    if (!Array.isArray(draft.answers) || draft.answers.length !== test.questions.length) { clearDraft(); bar.hidden = true; return; }
  }
  resumeDraft = { draft, test };

  bar.innerHTML =
    '<div class="draft-bar">' +
      '<span class="draft-ico">⏸</span>' +
      '<div class="draft-info">' +
        '<div class="draft-title">Testning davomi bor: <strong>' + String(test.title).replace(/</g, '&lt;') + '</strong></div>' +
        '<div class="draft-timer" id="draftTimer">⏱ ' + fmtTime(Math.max(0, Math.floor((deadline - Date.now()) / 1000))) + ' qoldi</div>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="draftResumeBtn">▶ Davom etish</button>' +
      '<button class="btn btn-danger btn-sm" id="draftDiscardBtn">✖</button>' +
    '</div>';
  bar.hidden = false;

  $('draftResumeBtn').addEventListener('click', resumeFromBar);
  $('draftDiscardBtn').addEventListener('click', discardDraftBar);

  draftBarTimer = setInterval(() => {
    const remain = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    const el = $('draftTimer');
    if (el) el.textContent = '⏱ ' + fmtTime(remain) + ' qoldi';
    if (remain <= 0) {
      stopDraftBarTimer();
      const b = $('draftBar');
      if (b) b.hidden = true;
      clearDraft();
      draftFinalize();
    }
  }, 1000);
}

function resumeFromBar() {
  hideDraftBar();
  if (!resumeDraft) return;
  const { draft, test } = resumeDraft;
  state.currentTest = test;
  state.answers = draft.answers;
  state.currentIndex = draft.currentIndex || 0;
  state.result = null;
  state.testEndsAt = draft.endsAt;
  openModal(renderTestQuestion());
  startTimer();
}

function discardDraftBar() {
  hideDraftBar();
  clearDraft();
  resumeDraft = null;
  toast('Draft bekor qilindi');
}

function confirmDiscardDraft(onYes) {
  const ov = document.createElement('div');
  ov.className = 'confirm-overlay';
  ov.innerHTML =
    '<div class="confirm-box">' +
      '<div class="confirm-title">⚠️ Testni yopish</div>' +
      '<div class="confirm-text">Testni yopishni tasdiqlaysizmi? Javoblaringiz saqlanmaydi (draft o\'chadi).</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-outline" id="confirmNo">Bekor</button>' +
        '<button class="btn btn-danger" id="confirmYes">Ha, yopish</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.querySelector('#confirmYes').addEventListener('click', () => { ov.remove(); onYes(); });
  ov.querySelector('#confirmNo').addEventListener('click', () => ov.remove());
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
}

function reloadAppView() {
  showView('view-app');
  loadTests();
}

async function draftFinalize() {
  clearDraft();
  if (!resumeDraft) return;
  const { draft, test } = resumeDraft;
  state.currentTest = test;
  state.answers = draft.answers;
  state.currentIndex = draft.currentIndex || 0;
  state.result = null;
  state.testEndsAt = null;
  reloadAppView();
  toast('Vaqt tugashi sababli test avtomatik yakunlandi');
  try {
    const res = await API.post('/api/tests/' + test.id + '/submit', { answers: state.answers });
    state.result = res;
    openModal(renderResult());
  } catch (e) {
    toast('Natija saqlanmadi: ' + e.message);
  }
}

async function resumeTest() {
  const draft = getDraftFromStorage();
  if (!draft) return;
  if (draft.userId && state.user && draft.userId !== state.user.id) { clearDraft(); return; }

  const now = Date.now();
  const five = draft.leftAt + DRAFT_GRACE;
  const deadline = draft.endsAt ? Math.min(draft.endsAt, five) : five;

  let test;
  try { test = await API.get('/api/tests/' + draft.testId); } catch (e) { clearDraft(); return; }
  if (!Array.isArray(draft.answers) || draft.answers.length !== test.questions.length) { clearDraft(); return; }

  resumeDraft = { draft, test };
  if (now >= deadline) {
    await draftFinalize();
  } else {
    showDraftBar();
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
      resumeTest();
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
    resumeTest();
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
  loadAdminObjections();
  loadAdminPayments();
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

/* ---- E'tirozlar ---- */
async function loadAdminObjections() {
  try {
    const objections = await API.get('/api/admin/objections');
    const rows = objections.length
      ? objections.map((o) => {
          const str = o.message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const qstr = o.question.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return '<tr>' +
            '<td><strong>' + o.name + '</strong>' + (o.username ? '<div class="rank-meta">@' + o.username + '</div>' : '') + '</td>' +
            '<td>' + o.testId + '</td>' +
            '<td>' + (o.questionIndex + 1) + '</td>' +
            '<td><div class="obj-question">' + qstr + '</div><div class="obj-message">' + str + '</div></td>' +
            '<td>' + new Date(o.createdAt).toLocaleString('uz') + '</td>' +
            '<td><button class="btn btn-danger btn-sm" data-odel="' + o.id + '">🗑</button></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">E\'tirozlar yo\'q</td></tr>';

    $('adminObjections').innerHTML =
      '<div class="panel">' +
        '<div class="admin-bar" style="margin-bottom:12px">' +
          '<h3>⚠️ E\'tirozlar (' + objections.length + ')</h3>' +
        '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Foydalanuvchi</th><th>Test</th><th>Savol</th><th>Xabar</th><th>Sana</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>';

    document.querySelectorAll('[data-odel]').forEach((b) => {
      b.addEventListener('click', async () => {
        const o = objections.find((x) => x.id === b.dataset.odel);
        if (o && !confirm('E\'tirozni o\'chirasizmi?')) return;
        try {
          await API.delete('/api/admin/objections/' + b.dataset.odel);
          loadAdminObjections();
          toast('E\'tiroz o\'chirildi');
        } catch (e) { toast('Xato: ' + e.message); }
      });
    });
  } catch (e) {
    $('adminObjections').innerHTML = '<p class="admin-empty">Xato: ' + e.message + '</p>';
  }
}

/* ---- To'lovlar / Ruxsatlar ---- */
async function loadAdminPayments() {
  try {
    const data = await API.get('/api/admin/payments');
    if (!data.paidTests.length) {
      $('adminPayments').innerHTML = '<div class="panel"><h3>💳 To\'lovlar / Ruxsatlar</h3><p class="admin-empty">Hozircha pullik test yo\'q. Testni tahrirlab <b>narx</b> belgilang.</p></div>';
      return;
    }
    const testOpts = data.paidTests.map((t) =>
      '<option value="' + t.id + '">' + t.title + ' — ' + t.price + ' so\'m</option>'
    ).join('');
    const rows = data.payments.length
      ? data.payments.map((p) => {
          const exp = p.expiresAt ? '<span class="badge ok">' + new Date(p.expiresAt).toLocaleDateString('uz') + ' gacha</span>' : '<span class="badge ok">🕐 Umrbod</span>';
          return '<tr>' +
            '<td><strong>' + p.name + '</strong>' + (p.code ? '<div class="rank-meta">ID: ' + p.code + '</div>' : '') + '</td>' +
            '<td>' + p.testTitle + '</td>' +
            '<td>' + (p.price ? p.price + ' so\'m' : '—') + '</td>' +
            '<td>' + exp + '</td>' +
            '<td>' + new Date(p.createdAt).toLocaleString('uz') + '</td>' +
            '<td><button class="btn btn-danger btn-sm" data-prevoke="' + p.userId + ':' + p.testId + '">🗑</button></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Hozircha ruxsat berilmagan</td></tr>';

    $('adminPayments').innerHTML =
      '<div class="panel">' +
        '<h3 style="margin-bottom:14px">💳 To\'lovlar / Ruxsatlar</h3>' +
        '<div class="pay-grant">' +
          '<div class="form-field"><label>Talaba ID kodi</label>' +
            '<input id="payUserCode" placeholder="Masalan: P76R86" autocomplete="off" />' +
            '<div class="form-hint">Talaba o\'z ID kodini aytadi (uy sahifada ko\'rinadi)</div></div>' +
          '<div class="form-field"><label>Test</label>' +
            '<select id="payTestSelect">' + testOpts + '</select></div>' +
          '<div class="form-field"><label>Muddat</label>' +
            '<select id="payExpireType">' +
              '<option value="forever">🕐 Umrbod</option>' +
              '<option value="date">📅 Muddatgacha</option>' +
            '</select>' +
            '<input type="date" id="payExpireDate" hidden /></div>' +
          '<div class="pay-grant-btn"><button class="btn btn-primary btn-sm" id="payGrantBtn">Ruxsat berish</button></div>' +
        '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Foydalanuvchi</th><th>Test</th><th>Narx</th><th>Muddat</th><th>Sana</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div>';

    const sel = $('payExpireType');
    $('payExpireType').addEventListener('change', (e) => { $('payExpireDate').hidden = e.target.value !== 'date'; });
    $('payGrantBtn').addEventListener('click', grantPayment);

    document.querySelectorAll('[data-prevoke]').forEach((b) => {
      b.addEventListener('click', async () => {
        const [userId, testId] = b.dataset.prevoke.split(':');
        if (!confirm('Ruxsatni bekor qilasizmi?')) return;
        try {
          await API.delete('/api/admin/payments', { userId: Number(userId), testId });
          loadAdminPayments();
          toast('Ruxsat bekor qilindi');
        } catch (err) { toast('Xato: ' + err.message); }
      });
    });
  } catch (e) {
    $('adminPayments').innerHTML = '<p class="admin-empty">Xato: ' + e.message + '</p>';
  }
}

async function grantPayment() {
  const code = $('payUserCode').value.trim();
  const testId = $('payTestSelect').value;
  const expireType = $('payExpireType').value;
  if (!code) { toast('Talaba ID kodini kiriting'); return; }
  let expiresAt = null;
  if (expireType === 'date') {
    expiresAt = $('payExpireDate').value;
    if (!expiresAt) { toast('Muddat sanasini kiriting'); return; }
  }
  try {
    await API.post('/api/admin/payments', { code, testId, expiresAt });
    toast('Ruxsat berildi ✅');
    loadAdminPayments();
  } catch (e) {
    toast('Xato: ' + e.message);
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
  return Array.from({ length: n }, () => ({ q: '', options: ['', '', '', ''], correct: 0, explanation: '', image: '' }));
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
      '<div class="q-img-wrap">' +
        '<img class="q-img-preview"' + (q.image ? ' src="' + q.image + '" style="display:block"' : '') + ' alt="rasm" />' +
        '<input type="hidden" class="edit-img" value="' + (q.image || '').replace(/"/g, '&quot;') + '" />' +
        '<input type="file" class="q-img-file" accept="image/*" hidden />' +
        '<div class="q-img-actions">' +
          '<button type="button" class="q-img-add"' + (q.image ? ' style="display:none"' : '') + '>🖼 Rasm qo\'shish</button>' +
          '<button type="button" class="q-img-del"' + (q.image ? '' : ' style="display:none"') + '>🗑 Rasmni olib tashlash</button>' +
        '</div>' +
      '</div>' +
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
    image: b.querySelector('.edit-img').value,
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
        '<div class="form-field"><label>Narx, so\'m (bo\'sh = bepul)</label><input id="editPrice" type="number" min="0" value="' + (test && test.price ? test.price : '') + '" placeholder="5000" /></div>' +
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
    price: $('editPrice').value !== '' ? Number($('editPrice').value) : null,
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

  $('copyIdBtn').addEventListener('click', () => {
    const code = state.user && state.user.code;
    if (!code) return;
    const done = () => toast('ID nusxalandi: ' + code);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(() => { window.prompt('ID-ingiz:', code); });
    } else {
      window.prompt('ID-ingiz:', code);
    }
  });

  if (window.Telegram && window.Telegram.WebApp) {
    window.Telegram.WebApp.ready();
    window.Telegram.WebApp.expand();
    window.Telegram.WebApp.disableVerticalSwipes && window.Telegram.WebApp.disableVerticalSwipes();
  }

  $('testModal').addEventListener('click', (e) => {
    if (e.target.id === 'closeTest') {
      const isActiveTest = !$('testModal').hidden && !!document.querySelector('#testModalBody .option');
      if (isActiveTest) {
        confirmDiscardDraft(() => { clearDraft(); closeModal(); });
        return;
      }
      closeModal();
      return;
    }
    if (e.target.id === 'minimizeBtn') {
      saveDraft();
      closeModal();
      const d = getDraftFromStorage();
      if (d) resumeDraft = { draft: d, test: state.currentTest };
      showDraftBar();
      return;
    }
    if (e.target.id === 'restartBtn') { startTest(state.currentTest.id); return; }
    if (e.target.id === 'analysisBtn') {
      $('analysisBlock').hidden = false;
      e.target.style.display = 'none';
      return;
    }
    if (e.target.id === 'saveTestBtn') { saveTestFromEditor(); return; }
    if (e.target.id === 'addQuestionBtn') { addQuestionToEditor(); return; }
    if (e.target.id === 'objectionBtn') {
      $('objectionForm').hidden = false;
      $('objectionText').focus();
      return;
    }
    if (e.target.id === 'objectionCancel') {
      $('objectionForm').hidden = true;
      $('objectionText').value = '';
      return;
    }
    if (e.target.id === 'objectionSend') {
      sendObjection();
      return;
    }
    if (e.target.id === 'payRecheckBtn') {
      recheckPayment();
      return;
    }
    const qnav = e.target.closest('.qn');
    if (qnav) {
      state.currentIndex = Number(qnav.dataset.nav);
      openModal(renderTestQuestion());
      saveDraft();
      return;
    }
    const imgAdd = e.target.closest('.q-img-add');
    if (imgAdd) {
      imgAdd.closest('.q-block').querySelector('.q-img-file').click();
      return;
    }
    const imgDel = e.target.closest('.q-img-del');
    if (imgDel) {
      const block = imgDel.closest('.q-block');
      block.querySelector('.edit-img').value = '';
      block.querySelector('.q-img-preview').src = '';
      block.querySelector('.q-img-preview').style.display = 'none';
      block.querySelector('.q-img-add').style.display = '';
      block.querySelector('.q-img-del').style.display = 'none';
      return;
    }
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

  $('testModal').addEventListener('change', (e) => {
    if (!e.target.classList || !e.target.classList.contains('q-img-file')) return;
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      toast('Rasm 1.5 MB dan katta bo\'lmasin');
      e.target.value = '';
      return;
    }
    const block = e.target.closest('.q-block');
    const reader = new FileReader();
    reader.onload = () => {
      block.querySelector('.edit-img').value = reader.result;
      block.querySelector('.q-img-preview').src = reader.result;
      block.querySelector('.q-img-preview').style.display = 'block';
      block.querySelector('.q-img-add').style.display = 'none';
      block.querySelector('.q-img-del').style.display = '';
    };
    reader.readAsDataURL(file);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ov = document.querySelector('.confirm-overlay');
    if (ov) { ov.remove(); return; }
    if (!$('testModal').hidden) {
      const isActiveTest = !!document.querySelector('#testModalBody .option');
      if (isActiveTest) {
        confirmDiscardDraft(() => { clearDraft(); closeModal(); });
      } else {
        closeModal();
      }
    }
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
      resumeTest();
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
