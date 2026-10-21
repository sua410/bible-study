// =========================================================
// 성경 문제집 · 앱 동작
// 문제 데이터는 questions.js, 디자인은 style.css 에 있어요.
// =========================================================

// ===========================
// Firebase 로그인 + 클라우드 동기화
// ===========================
const firebaseConfig = {
  apiKey: "AIzaSyDI_UVyeDktoBDdEqmIdpO93uH_CubM4rs",
  authDomain: "bible-study-c0d21.firebaseapp.com",
  projectId: "bible-study-c0d21",
  storageBucket: "bible-study-c0d21.firebasestorage.app",
  messagingSenderId: "86562874923",
  appId: "1:86562874923:web:79cd7df6631d552bd2ec6e"
};
let fbAuth = null, fbDb = null, fbReady = false, fbSaveTimer = null;
function firebaseConfigured() {
  return !!firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf("PASTE") !== 0;
}
function initFirebase() {
  if (!firebaseConfigured() || typeof firebase === "undefined") return;
  try {
    firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbReady = true;
    fbAuth.onAuthStateChanged(handleAuthChange);
  } catch (e) {
    console.error("Firebase 초기화 실패", e);
  }
}
function setUserInfoText(t) { /* 새 디자인에서는 설정 탭에 표시 */ }
async function handleAuthChange(user) {
  if (user) {
    state.user = { uid: user.uid, name: user.displayName, email: user.email };
    setUserInfoText(state.user.name || state.user.email || '로그인됨');
    await syncOnLogin();
  } else {
    state.user = null;
    setUserInfoText('로그아웃');
  }
  if (route.view === 'settings' || route.view === 'home') render();
}
// 로컬/원격 진도 병합
// - resetAt(초기화/가져오기 시각) 이전에 기록된 카드는 버린다 → 다른 기기에서 초기화한 진도가 되살아나지 않음
// - 둘 다 있으면 더 최근에 푼 쪽(t: 실제 시각, 없으면 lastSession) 우선
function mergeProgress(localP, remoteP, resetAt) {
  const cut = resetAt || 0;
  const keep = (p) => p && (cut === 0 || (p.t || 0) >= cut);
  const out = {};
  const rp = remoteP || {}, lp = localP || {};
  for (const qid in rp) if (keep(rp[qid])) out[qid] = rp[qid];
  for (const qid in lp) {
    const a = lp[qid];
    if (!keep(a)) continue;
    const b = out[qid];
    if (!b) { out[qid] = a; continue; }
    let localNewer;
    if (a.t || b.t) localNewer = (a.t || 0) > (b.t || 0);
    else {
      const as = (a.lastSession == null ? -1 : a.lastSession);
      const bs = (b.lastSession == null ? -1 : b.lastSession);
      localNewer = as > bs || (as === bs && (a.totalReviews || 0) > (b.totalReviews || 0));
    }
    if (localNewer) out[qid] = a;
  }
  return out;
}
let lastSyncAt = 0;
async function syncOnLogin(silent) {
  if (!fbReady || !state.user) return;
  try {
    const ref = fbDb.collection("users").doc(state.user.uid);
    const snap = await ref.get();
    const remote = snap.exists ? (snap.data() || {}) : {};
    const resetAt = Math.max(state.resetAt || 0, remote.resetAt || 0);
    state.progress = mergeProgress(state.progress, remote.progress || {}, resetAt);
    state.sessionCount = Math.max(state.sessionCount || 0, remote.sessionCount || 0);
    state.resetAt = resetAt;
    state.meta = mergeMeta(state.meta, remote.meta);
    lastSyncAt = Date.now();
    saveLocal();
    pushToCloud({ all: true });
    if (!silent) showToast("진도를 동기화했어요 ☁️");
    if (route.view === 'home' || route.view === 'settings') render();
  } catch (e) {
    console.error("동기화 실패", e);
    if (!silent) showToast("동기화 실패 (오프라인일 수 있어요)");
  }
}
// 클라우드 저장
// - 평소: 이번에 푼 카드만 보낸다(merge) → 다른 기기에서 푼 기록을 덮어쓰지 않음
// - all: 전체 진도를 merge로 보냄 (로그인 동기화 직후)
// - full: 문서를 통째로 교체 (초기화/가져오기)
let dirtyIds = new Set();
function pushToCloud(opts) {
  opts = opts || {};
  if (!fbReady || !state.user) return;
  const uid = state.user.uid;
  if (opts.full) {
    if (fbSaveTimer) { clearTimeout(fbSaveTimer); fbSaveTimer = null; }
    dirtyIds.clear();
    fbDb.collection("users").doc(uid).set({
      progress: state.progress,
      sessionCount: state.sessionCount,
      resetAt: state.resetAt || 0,
      meta: state.meta,
      updatedAt: Date.now()
    }).catch(function (e) { console.error("클라우드 저장 실패", e); });
    return;
  }
  if (opts.all) Object.keys(state.progress).forEach(id => dirtyIds.add(id));
  if (fbSaveTimer) clearTimeout(fbSaveTimer);
  fbSaveTimer = setTimeout(function () {
    fbSaveTimer = null;
    const part = {};
    dirtyIds.forEach(id => { if (state.progress[id]) part[id] = state.progress[id]; });
    dirtyIds.clear();
    fbDb.collection("users").doc(uid).set({
      progress: part,
      sessionCount: state.sessionCount,
      meta: state.meta,
      updatedAt: Date.now()
    }, { merge: true }).catch(function (e) { console.error("클라우드 저장 실패", e); });
  }, 1500);
}

// ===========================
// 문제 데이터 색인
// ===========================
const NT_BOOKS = new Set([
  "마태복음","마가복음","누가복음","요한복음","사도행전","로마서",
  "고린도전서","고린도후서","갈라디아서","에베소서","빌립보서","골로새서",
  "데살로니가전서","데살로니가후서","디모데전서","디모데후서","디도서","빌레몬서",
  "히브리서","야고보서","베드로전서","베드로후서","요한일서","요한이서","요한삼서",
  "유다서","요한계시록"
]);
function isNT(book) { return NT_BOOKS.has(book); }

const QMAP = {};            // id → 문제
const QBY = {};             // 책 → 문제 목록 (암송 제외, 문제집 순서)
const VBY = {};             // 책 → 암송 구절 목록
const BOOKS = [];           // 문제가 있는 책 (성경 순서)
const VERSES = [];          // 전체 암송 구절
QUESTIONS.forEach(q => {
  QMAP[q.id] = q;
  if (q.type === 'verse') {
    VERSES.push(q);
    (VBY[q.book] = VBY[q.book] || []).push(q);
  } else {
    if (!QBY[q.book]) { QBY[q.book] = []; BOOKS.push(q.book); }
    QBY[q.book].push(q);
  }
});
const VBOOKS = BOOKS.filter(b => VBY[b]).concat(Object.keys(VBY).filter(b => !QBY[b]));
// 책 안에서의 번호 (1번부터, 문제집 순서)
const QNUM = {};
BOOKS.forEach(b => QBY[b].forEach((q, i) => { QNUM[q.id] = i + 1; }));

const TYPE_LABEL = { multiple: "객관식", fill: "빈칸", short: "주관식", verse: "암송" };
const QUIZ_SIZE = 10;

// ===========================
// 상태
// ===========================
const STORAGE_KEY = "bible_workbook_v2";
const STORAGE_KEY_OLD = "bible_workbook_v1";
const SETTINGS_KEY = "bible_workbook_settings";
const SESS_KEY = "bible_workbook_quiz_sessions";
const STUDY_DAY_KEY = "bible_workbook_study_day";

// 세션 기반 복습 간격 (퀴즈 세트 단위, 화면에는 표시하지 않음)
const INTERVALS = { again: 1, hard: 3, good: 7, easy: 14 };
const GRADE_NAME = { again: "다시", hard: "어려움", good: "보통", easy: "쉬움" };

let state = {
  progress: {},     // {qId: {nextSession, lastSession, totalReviews, lapses, isNew, lastGrade, t}}
  sessionCount: 0,  // 누적 세트 수 (복습 시점 계산용)
  resetAt: 0,       // 마지막 초기화/가져오기 시각(ms)
  user: null,
  meta: {           // 기기 간 동기화되는 설정
    range: { books: null, u: 0 },      // 오늘의 퀴즈 범위 (null = 전체)
    vrange: { ids: null, u: 0 },       // 암송 퀴즈 범위: 구절 id 목록 (null = 전체, 빈칸연습·테스트 공통)
    dday: { title: "", date: "", u: 0 },
    streak: { last: "", count: 0 }      // 연속 공부
  }
};
let settings = { reminderTime: "", notificationEnabled: false };
let sessions = {};  // 진행 중인 퀴즈 세트 (기기별)
let route = { view: 'home' };

function defaultMeta() {
  return { range: { books: null, u: 0 }, vrange: { ids: null, u: 0 }, dday: { title: "", date: "", u: 0 }, streak: { last: "", count: 0 } };
}
function mergeMeta(local, remote) {
  const a = Object.assign(defaultMeta(), local || {});
  const b = Object.assign(defaultMeta(), remote || {});
  const pick = (x, y) => ((y && y.u || 0) > (x && x.u || 0) ? y : x);
  const sa = a.streak || {}, sb = b.streak || {};
  let streak = sa;
  if ((sb.last || "") > (sa.last || "") || (sb.last === sa.last && (sb.count || 0) > (sa.count || 0))) streak = sb;
  return { range: pick(a.range, b.range), vrange: pick(a.vrange, b.vrange), dday: pick(a.dday, b.dday), streak: streak };
}

// ===========================
// 날짜 도우미 (기기 현지 시간 기준)
// ===========================
function dayKey(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dayNum(key) { // "YYYY-MM-DD" → 날짜 번호
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function todayNum() { return dayNum(dayKey()); }
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function todayLabel() {
  const d = new Date();
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
}

// ===========================
// 진도 기록
// ===========================
function initProgress() {
  return { nextSession: state.sessionCount, lastSession: -1, totalReviews: 0, lapses: 0, isNew: true, lastGrade: null, consecutiveEasy: 0 };
}
function applyGrade(prog, g) {
  prog.totalReviews += 1;
  prog.lastSession = state.sessionCount;
  prog.isNew = false;
  if (g === "again") { prog.lapses += 1; prog.consecutiveEasy = 0; }
  else if (g === "easy") { prog.consecutiveEasy = (prog.consecutiveEasy || 0) + 1; }
  else prog.consecutiveEasy = 0;
  prog.lastGrade = g;
  prog.nextSession = state.sessionCount + INTERVALS[g];
  prog.t = Date.now();
  return prog;
}

// ===========================
// 연속 공부
// - 퀴즈 한 세트를 끝까지 풀었거나
// - 공부하기에서 문제/구절을 10개 이상(3초 이상 머문 것) 본 날
// ===========================
function streakCount() {
  const s = state.meta.streak || {};
  if (!s.last) return 0;
  const gap = todayNum() - dayNum(s.last);
  return (gap === 0 || gap === 1) ? (s.count || 0) : 0;
}
function creditToday() {
  const today = dayKey();
  const s = state.meta.streak || { last: "", count: 0 };
  if (s.last === today) return false;
  const count = (s.last && todayNum() - dayNum(s.last) === 1) ? (s.count || 0) + 1 : 1;
  state.meta.streak = { last: today, count: count };
  saveLocal(); pushToCloud();
  setTimeout(() => showToast(`🔥 오늘 공부 ${count}일째!`, 'fire', 2600), 350);
  return true;
}
let studyDay = { date: "", ids: [] };
function loadStudyDay() {
  try { studyDay = JSON.parse(localStorage.getItem(STUDY_DAY_KEY)) || studyDay; } catch (e) {}
  if (studyDay.date !== dayKey()) studyDay = { date: dayKey(), ids: [] };
}
function markStudied(id) {
  loadStudyDay();
  if (studyDay.ids.indexOf(id) >= 0) return;
  studyDay.ids.push(id);
  try { localStorage.setItem(STUDY_DAY_KEY, JSON.stringify(studyDay)); } catch (e) {}
  if (studyDay.ids.length >= 10) creditToday();
}

// ===========================
// 오늘의 말씀 (모든 사용자에게 같은 날 같은 구절, 한 바퀴 돌 때까지 겹치지 않음)
// ===========================
function seededShuffle(arr, seed) {
  const a = arr.slice();
  let t = seed >>> 0;
  const rnd = () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function todayVerse() {
  if (!VERSES.length) return null;
  const n = todayNum();
  const cycle = Math.floor(n / VERSES.length);
  const order = seededShuffle(VERSES, 20261021 + cycle * 7919);
  return order[((n % VERSES.length) + VERSES.length) % VERSES.length];
}
function fullRef(v) { // "시 127:1" → "시편 127:1"
  const m = (v.reference || "").match(/^\S+\s+(.*)$/);
  return v.book + " " + (m ? m[1] : (v.reference || ""));
}

// ===========================
// D-day
// ===========================
function ddayInfo() {
  const d = state.meta.dday || {};
  if (!d.date) return null;
  const diff = dayNum(d.date) - todayNum();
  if (diff < 0) return null; // 지난 시험은 표시하지 않음
  return { title: d.title || "시험", label: diff === 0 ? "D-DAY" : "D-" + diff, diff };
}

// ===========================
// 퀴즈 범위
// ===========================
// kind: 'q' = 오늘의 퀴즈 (성경문제), 'v' = 암송 퀴즈 (빈칸연습·테스트 공통)
function rangeKey(kind) { return kind === 'v' ? 'vrange' : 'range'; }
function rangeAll(kind) { return kind === 'v' ? VBOOKS : BOOKS; }
function rangeBooks(kind) {
  const all = rangeAll(kind);
  const r = state.meta[rangeKey(kind)];
  const b = r && r.books ? r.books.filter(x => all.indexOf(x) >= 0) : null;
  return (b && b.length) ? b : all.slice();
}
// 암송 범위: 선택한 구절 목록 (예전 형식 books → 구절로 변환)
function rangeVerses() {
  const r = state.meta.vrange || {};
  let ids = r.ids;
  if (!ids && r.books && r.books.length) ids = [].concat(...r.books.filter(b => VBY[b]).map(b => VBY[b].map(v => v.id)));
  const list = ids ? VERSES.filter(v => ids.indexOf(v.id) >= 0) : null;
  return (list && list.length) ? list : VERSES.slice();
}
function verseRangeLabel(ids) {
  const sel = ids ? VERSES.filter(v => ids.indexOf(v.id) >= 0) : rangeVerses();
  if (sel.length === VERSES.length) return "전체";
  const set = new Set(sel.map(v => v.id));
  const fullBooks = VBOOKS.filter(b => VBY[b].every(v => set.has(v.id)));
  const anyPartial = VBOOKS.some(b => !fullBooks.includes(b) && VBY[b].some(v => set.has(v.id)));
  const ot = VBOOKS.filter(b => !isNT(b)), nt = VBOOKS.filter(isNT);
  const sameBooks = (x) => !anyPartial && x.length === fullBooks.length && x.every(b => fullBooks.includes(b));
  if (sameBooks(ot)) return "구약";
  if (sameBooks(nt)) return "신약";
  if (!anyPartial && fullBooks.length) return fullBooks.length === 1 ? fullBooks[0] : `${fullBooks[0]} 외 ${fullBooks.length - 1}권`;
  return sel.length + "구절";
}
function rangeLabel(kind, books) {
  if (kind === 'v') return verseRangeLabel();
  const all = rangeAll(kind);
  if (!books) { const r = state.meta[rangeKey(kind)]; books = r && r.books; }
  books = books ? books.filter(x => all.indexOf(x) >= 0) : null;
  if (!books || !books.length || books.length === all.length) return "전체";
  const ot = all.filter(b => !isNT(b)), nt = all.filter(isNT);
  const same = (x) => x.length === books.length && x.every(b => books.indexOf(b) >= 0);
  if (same(ot)) return "구약";
  if (same(nt)) return "신약";
  const sorted = all.filter(b => books.indexOf(b) >= 0);
  return sorted.length === 1 ? sorted[0] : `${sorted[0]} 외 ${sorted.length - 1}권`;
}

// ===========================
// 퀴즈 세트 만들기
// ===========================
const QUIZ_MODES = {
  random: { title: "오늘의 퀴즈" },
  book: { title: "성경 별 문제 풀기" },
  vblank: { title: "암송 빈칸연습" },
  vtest: { title: "암송 테스트" }
};
function sessKey(mode, book) { return mode === 'book' ? 'book:' + book : mode; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function buildSet(mode, book) {
  const upcoming = state.sessionCount + 1;
  let pool;
  if (mode === 'random') pool = [].concat(...rangeBooks('q').map(b => QBY[b]));
  else if (mode === 'book') pool = (QBY[book] || []).slice();
  else pool = rangeVerses();
  const due = [], fresh = [], rest = [];
  pool.forEach((q, i) => {
    const p = state.progress[q.id];
    if (!p || p.isNew) fresh.push(q);
    else if (p.nextSession <= upcoming) due.push({ q, p, i });
    else rest.push({ q, p, i });
  });
  if (mode === 'book') {
    // 책 별: 문제집 순서대로, 안 푼 문제 먼저
    due.sort((a, b) => a.i - b.i);
    rest.sort((a, b) => (a.p.nextSession - b.p.nextSession) || (a.i - b.i));
    return [...fresh, ...due.map(x => x.q), ...rest.map(x => x.q)].slice(0, QUIZ_SIZE).map(q => q.id);
  }
  due.sort((a, b) => a.p.nextSession - b.p.nextSession);
  shuffle(fresh);
  rest.sort((a, b) => a.p.nextSession - b.p.nextSession);
  return [...due.map(x => x.q), ...fresh, ...rest.map(x => x.q)].slice(0, QUIZ_SIZE).map(q => q.id);
}

function loadSessions() {
  try { sessions = JSON.parse(localStorage.getItem(SESS_KEY)) || {}; } catch (e) { sessions = {}; }
  // 문제 데이터에서 사라진 문제는 정리
  Object.keys(sessions).forEach(k => {
    const s = sessions[k];
    if (!s || !Array.isArray(s.ids)) { delete sessions[k]; return; }
    s.ids = s.ids.filter(id => QMAP[id]);
    if (!s.ids.length) delete sessions[k];
  });
}
function saveSessions() { try { localStorage.setItem(SESS_KEY, JSON.stringify(sessions)); } catch (e) {} }
function answeredCount(s) { return s.ids.filter(id => s.results[id]).length; }
function activeSession(key) {
  const s = sessions[key];
  return (s && answeredCount(s) < s.ids.length) ? s : null;
}
function newSession(mode, book) {
  const ids = buildSet(mode, book);
  if (!ids.length) return null;
  const s = { mode, book: book || null, ids, results: {}, view: 0, counted: false, created: Date.now() };
  sessions[sessKey(mode, book)] = s;
  saveSessions();
  return s;
}
function startQuiz(mode, book, from) {
  const key = sessKey(mode, book);
  let s = activeSession(key);
  if (!s) s = newSession(mode, book);
  if (!s) { showToast("풀 문제가 없어요"); return; }
  s.view = answeredCount(s); // 이어서: 아직 안 푼 문제부터
  saveSessions();
  go({ view: 'quizRun', key, from: from || 'quizHome' });
}
function continueQuiz(key, from) {
  const old = sessions[key];
  if (!old) return go({ view: 'quizHome' });
  delete sessions[key];
  const s = newSession(old.mode, old.book);
  if (!s) { showToast("더 풀 문제가 없어요"); return go({ view: from || 'quizHome' }); }
  showToast("다음 10문제 시작");
  go({ view: 'quizRun', key, from });
}

// ===========================
// 저장 / 불러오기
// ===========================
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      progress: state.progress,
      sessionCount: state.sessionCount,
      resetAt: state.resetAt || 0,
      meta: state.meta
    }));
  } catch (e) { console.error('저장 실패', e); }
}
function saveProgress(changedId) {
  saveLocal();
  if (changedId) dirtyIds.add(changedId);
  pushToCloud();
}
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      state.progress = data.progress || {};
      state.sessionCount = data.sessionCount || 0;
      state.resetAt = data.resetAt || 0;
      state.meta = mergeMeta(data.meta, null);
    } else {
      const oldRaw = localStorage.getItem(STORAGE_KEY_OLD);
      if (oldRaw) {
        const oldProgress = JSON.parse(oldRaw);
        const migrated = {};
        Object.entries(oldProgress).forEach(([qid, p]) => {
          migrated[qid] = { nextSession: 0, lastSession: -1, totalReviews: p.repetitions || 0, lapses: p.lapses || 0, isNew: false, lastGrade: null, consecutiveEasy: 0 };
        });
        state.progress = migrated;
        saveLocal();
      }
    }
    const settingsRaw = localStorage.getItem(SETTINGS_KEY);
    if (settingsRaw) settings = { ...settings, ...JSON.parse(settingsRaw) };
  } catch (e) { console.error('불러오기 실패', e); }
}
function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }

// ===========================
// 화면 전환
// ===========================
const TAB_OF = { home: 'home', studyHome: 'study', studyList: 'study', studyView: 'study', quizHome: 'quiz', quizBooks: 'quiz', quizRun: 'quiz', quizDone: 'quiz', settings: 'settings' };
const NO_TAB = { studyView: 1, quizRun: 1 };
let studyMode = 'q';       // 공부하기: 'q' 성경문제 / 'v' 성경암송
let studyTestament = 'all';
let quizTestament = 'all';

function go(r, opts) {
  route = r;
  render();
  if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
}
function goTab(tab) {
  const root = { home: 'home', study: 'studyHome', quiz: 'quizHome', settings: 'settings' }[tab];
  go({ view: root });
}
function render() {
  clearStudyTimer();
  const app = document.getElementById('app');
  const fn = VIEWS[route.view] || VIEWS.home;
  app.innerHTML = fn(route);
  app.classList.toggle('no-tab', !!NO_TAB[route.view]);
  const tabbar = document.getElementById('tabbar');
  if (NO_TAB[route.view]) { tabbar.style.display = 'none'; }
  else {
    tabbar.style.display = '';
    const t = TAB_OF[route.view];
    tabbar.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  }
  if (AFTER[route.view]) AFTER[route.view](route);
}
const VIEWS = {}, AFTER = {};

// ===========================
// 홈
// ===========================
VIEWS.home = function () {
  let s = activeSession('random');
  if (s && !answeredCount(s)) s = null; // 열어보기만 한 세트는 '시작하기'로 표시
  const done = s ? answeredCount(s) : 0;
  const quiz = `
    <div class="card qz">
      <div class="qz-top">
        <div><div class="qz-lab">TODAY'S QUIZ</div><div class="qz-t">오늘의 퀴즈</div></div>
        <button class="chip" onclick="openRangeSheet('q')">범위 · ${escapeHtml(rangeLabel('q'))} ›</button>
      </div>
      <div class="qz-s">${QUIZ_SIZE}문제 · 복습할 문제를 먼저 내드려요</div>
      ${s ? `<div class="qz-prog"><div class="bar"><i style="width:${Math.round(done / s.ids.length * 100)}%"></i></div><span>${done} / ${s.ids.length} 풀었어요</span></div>` : ''}
      <button class="btn" onclick="startQuiz('random', null, 'home')">${s ? '이어 풀기' : '시작하기'}</button>
    </div>`;

  const sc = streakCount();
  const dd = ddayInfo();
  const half = `
    <div class="half">
      <div class="hc">
        <div class="k">연속 공부</div>
        ${sc > 0 ? `<div class="v">🔥 ${sc}일<small>째</small></div>` : `<div class="v soft">🔥 오늘 시작해요</div>`}
      </div>
      <button class="hc dd" onclick="openDdaySheet()">
        <span class="arr">›</span>
        ${dd ? `<div class="k">${escapeHtml(dd.title)}</div><div class="v">${dd.label}</div>`
             : `<div class="k">시험 D-day</div><div class="v add">＋ 날짜 정하기</div>`}
      </button>
    </div>`;

  const v = todayVerse();
  const verse = v ? `
    <div class="vc">
      <div class="vc-top">
        <div class="vc-lab">✦ 오늘의 말씀</div>
        <div class="vc-acts">
          <button onclick="shareVerse()" title="공유" aria-label="말씀 공유">🔗</button>
          <button onclick="openVerseInStudy('${v.id}')" title="공부하기에서 보기" aria-label="공부하기에서 보기">📗</button>
        </div>
      </div>
      <div class="vc-txt clamp" id="vcTxt">${escapeHtml(v.answer)}</div>
      <div class="vc-bot"><div class="vc-ref">${escapeHtml(fullRef(v))}</div><button class="vc-more" id="vcMore" style="display:none" onclick="toggleVerse()">전체 보기 ›</button></div>
    </div>` : '';

  return `
    <div class="page-hd">
      <div><div class="date">${todayLabel()}</div><h1>성경 문제집</h1></div>
      <button class="avatar-btn" onclick="goTab('settings')" aria-label="설정">👤</button>
    </div>
    ${quiz}${half}${verse}`;
};
AFTER.home = function () {
  const t = document.getElementById('vcTxt');
  if (t && t.scrollHeight > t.clientHeight + 2) document.getElementById('vcMore').style.display = '';
};
function toggleVerse() {
  const t = document.getElementById('vcTxt'), b = document.getElementById('vcMore');
  const open = t.classList.toggle('clamp');
  b.textContent = open ? '전체 보기 ›' : '접기';
}
function shareVerse() {
  const v = todayVerse(); if (!v) return;
  const text = `${v.answer}\n— ${fullRef(v)}`;
  if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showToast("말씀을 복사했어요"), () => showToast("복사하지 못했어요"));
  else showToast("이 브라우저는 공유를 지원하지 않아요");
}
function openVerseInStudy(id) {
  const v = QMAP[id]; if (!v) return;
  studyMode = 'v';
  go({ view: 'studyView', kind: 'v', book: v.book, pos: VBY[v.book].indexOf(v), from: 'home' });
}

// ---------- 바텀 시트 ----------
function openSheet(html) {
  closeSheet();
  const dim = document.createElement('div'); dim.className = 'sheet-dim'; dim.id = 'sheetDim'; dim.onclick = closeSheet;
  const sh = document.createElement('div'); sh.className = 'sheet'; sh.id = 'sheet'; sh.innerHTML = '<div class="grab"></div>' + html;
  document.body.appendChild(dim); document.body.appendChild(sh);
}
function closeSheet() { ['sheetDim', 'sheet'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); }

// 범위 설정 (kind: 'q' 오늘의 퀴즈 / 'v' 암송)
let rangeDraft = [], rangeKind = 'q';
function openRangeSheet(kind) {
  if (kind === 'v') return openVerseRangeSheet();
  rangeKind = kind === 'v' ? 'v' : 'q';
  rangeDraft = rangeBooks(rangeKind).slice();
  const head = rangeKind === 'v'
    ? `<h3>암송 범위</h3><div class="desc">선택한 책의 구절로 ${QUIZ_SIZE}개씩 나와요 · 빈칸연습과 테스트에 함께 적용돼요</div>`
    : `<h3>오늘의 퀴즈 범위</h3><div class="desc">선택한 책에서 ${QUIZ_SIZE}문제씩 나와요 · 홈과 퀴즈 탭에 함께 적용돼요</div>`;
  openSheet(head + '<div id="rangeBody"></div>');
  drawRange();
}
function drawRange() {
  const ALL = rangeAll(rangeKind);
  const ot = ALL.filter(b => !isNT(b)), nt = ALL.filter(isNT);
  const all = rangeDraft.length === ALL.length;
  const only = (x) => x.length === rangeDraft.length && x.every(b => rangeDraft.indexOf(b) >= 0);
  const chips = (list) => list.map(b => `<button class="${rangeDraft.indexOf(b) >= 0 ? 'on' : ''}" onclick="toggleRangeBook(${ALL.indexOf(b)})">${rangeDraft.indexOf(b) >= 0 ? '✓ ' : ''}${b}</button>`).join('');
  document.getElementById('rangeBody').innerHTML = `
    <div class="quick3">
      <button class="${all ? 'on' : ''}" onclick="setRangeQuick('all')">전체</button>
      <button class="${only(ot) ? 'on' : ''}" onclick="setRangeQuick('ot')">구약</button>
      <button class="${only(nt) ? 'on' : ''}" onclick="setRangeQuick('nt')">신약</button>
      <button class="${rangeDraft.length ? '' : 'on'}" onclick="setRangeQuick('none')">선택 해제</button>
    </div>
    <div class="bchips-lab">구약</div><div class="bchips">${chips(ot)}</div>
    <div class="bchips-lab">신약</div><div class="bchips">${chips(nt)}</div>
    <button class="btn" style="margin-top:18px" ${rangeDraft.length ? '' : 'disabled'} onclick="saveRange()">${rangeDraft.length ? (all ? '전체 범위 · 저장' : rangeDraft.length + '권 선택 · 저장') : '책을 1권 이상 골라 주세요'}</button>`;
}
function setRangeQuick(k) {
  const ALL = rangeAll(rangeKind);
  rangeDraft = k === 'all' ? ALL.slice() : k === 'none' ? [] : ALL.filter(b => k === 'nt' ? isNT(b) : !isNT(b));
  drawRange();
}
function toggleRangeBook(i) {
  const b = rangeAll(rangeKind)[i], at = rangeDraft.indexOf(b);
  if (at >= 0) rangeDraft.splice(at, 1); else rangeDraft.push(b);
  drawRange();
}
function saveRange() {
  if (!rangeDraft.length) return;
  const ALL = rangeAll(rangeKind);
  const books = rangeDraft.length === ALL.length ? null : ALL.filter(b => rangeDraft.indexOf(b) >= 0);
  state.meta[rangeKey(rangeKind)] = { books, u: Date.now() };
  saveLocal(); pushToCloud();
  closeSheet();
  const running = rangeKind === 'v' ? (activeSession('vblank') || activeSession('vtest')) : activeSession('random');
  showToast(running ? "범위를 저장했어요 · 다음 세트부터 적용돼요" : "범위를 저장했어요");
  render();
}

// 암송 범위: 책 단위 체크 + ▾ 를 눌러 구절 단위 세부 체크
let vDraft = new Set(), vOpen = new Set();
function openVerseRangeSheet() {
  vDraft = new Set(rangeVerses().map(v => v.id));
  vOpen = new Set();
  openSheet(`<h3>암송 범위</h3><div class="desc">책을 통째로 고르거나, ▾ 를 눌러 구절을 하나씩 고를 수 있어요 · 빈칸연습과 테스트에 함께 적용돼요</div><div id="vrBody"></div>`);
  drawVerseRange();
}
function drawVerseRange() {
  const ids = (list) => list.map(v => v.id);
  const count = (b) => VBY[b].filter(v => vDraft.has(v.id)).length;
  const otV = [].concat(...VBOOKS.filter(b => !isNT(b)).map(b => ids(VBY[b])));
  const ntV = [].concat(...VBOOKS.filter(isNT).map(b => ids(VBY[b])));
  const only = (x) => x.length === vDraft.size && x.every(id => vDraft.has(id));
  const box = (state) => `<span class="cb ${state}">${state === 'on' ? '✓' : state === 'part' ? '−' : ''}</span>`;
  const bookRow = (b) => {
    const n = count(b), m = VBY[b].length, bi = VBOOKS.indexOf(b);
    const st = n === 0 ? '' : n === m ? 'on' : 'part';
    const open = vOpen.has(b);
    let h = `<div class="vr-row">
      <button class="vr-main" onclick="vrToggleBook(${bi})">${box(st)}<span class="vr-name">${b}</span><span class="vr-cnt">${n ? n + ' / ' : ''}${m}구절</span></button>
      <button class="vr-exp ${open ? 'open' : ''}" onclick="vrExpand(${bi})" aria-label="구절 보기">▾</button></div>`;
    if (open) {
      h += '<div class="vr-verses">' + VBY[b].map((v, i) => `
        <button class="vr-v" onclick="vrToggleVerse(${bi}, ${i})">${box(vDraft.has(v.id) ? 'on' : '')}
          <span class="vr-vt"><b>${escapeHtml(fullRef(v).replace(b + ' ', ''))}</b><span>${escapeHtml(v.answer)}</span></span></button>`).join('') + '</div>';
    }
    return h;
  };
  const total = vDraft.size, all = total === VERSES.length;
  document.getElementById('vrBody').innerHTML = `
    <div class="quick3">
      <button class="${all ? 'on' : ''}" onclick="vrQuick('all')">전체</button>
      <button class="${only(otV) ? 'on' : ''}" onclick="vrQuick('ot')">구약</button>
      <button class="${only(ntV) ? 'on' : ''}" onclick="vrQuick('nt')">신약</button>
      <button class="${total ? '' : 'on'}" onclick="vrQuick('none')">선택 해제</button>
    </div>
    <div class="bchips-lab">구약</div>${VBOOKS.filter(b => !isNT(b)).map(bookRow).join('')}
    <div class="bchips-lab" style="margin-top:18px">신약</div>${VBOOKS.filter(isNT).map(bookRow).join('')}
    <div class="sheet-foot"><button class="btn" ${total ? '' : 'disabled'} onclick="saveVerseRange()">${total ? (all ? '전체 범위 · 저장' : total + '구절 선택 · 저장') : '구절을 1개 이상 골라 주세요'}</button></div>`;
}
function vrQuick(k) {
  if (k === 'none') vDraft = new Set();
  else vDraft = new Set(VERSES.filter(v => k === 'all' || (k === 'nt' ? isNT(v.book) : !isNT(v.book))).map(v => v.id));
  drawVerseRange();
}
function vrToggleBook(bi) {
  const list = VBY[VBOOKS[bi]];
  const allOn = list.every(v => vDraft.has(v.id));
  list.forEach(v => allOn ? vDraft.delete(v.id) : vDraft.add(v.id));
  drawVerseRange();
}
function vrExpand(bi) {
  const b = VBOOKS[bi];
  if (vOpen.has(b)) vOpen.delete(b); else vOpen.add(b);
  drawVerseRange();
}
function vrToggleVerse(bi, i) {
  const id = VBY[VBOOKS[bi]][i].id;
  if (vDraft.has(id)) vDraft.delete(id); else vDraft.add(id);
  drawVerseRange();
}
function saveVerseRange() {
  if (!vDraft.size) return;
  const ids = vDraft.size === VERSES.length ? null : VERSES.filter(v => vDraft.has(v.id)).map(v => v.id);
  state.meta.vrange = { ids, u: Date.now() };
  saveLocal(); pushToCloud();
  closeSheet();
  showToast((activeSession('vblank') || activeSession('vtest')) ? "범위를 저장했어요 · 다음 세트부터 적용돼요" : "범위를 저장했어요");
  render();
}

// D-day 설정
function openDdaySheet() {
  const d = state.meta.dday || {};
  openSheet(`<h3>시험 D-day</h3>
    <div class="fl">시험 이름</div><input class="inp" id="ddTitle" maxlength="20" placeholder="예: 2026 성경고사" value="${escapeHtml(d.title || '')}" oninput="ddPreview()">
    <div class="fl">시험 날짜</div><input class="inp" id="ddDate" type="date" value="${d.date || ''}" oninput="ddPreview()" onchange="ddPreview()">
    <div class="preview" id="ddPrev"></div>
    <button class="btn" style="margin-top:16px" onclick="saveDday()">저장</button>
    ${d.date ? '<button class="link-danger" onclick="clearDday()">D-day 지우기</button>' : ''}`);
  ddPreview();
}
function ddPreview() {
  const t = document.getElementById('ddTitle').value.trim() || '시험';
  const date = document.getElementById('ddDate').value;
  const el = document.getElementById('ddPrev');
  if (!date) { el.innerHTML = '<span style="font-weight:600;color:var(--sub)">날짜를 골라 주세요</span>'; return; }
  const diff = dayNum(date) - todayNum();
  el.innerHTML = diff < 0 ? '<span style="font-weight:600;color:var(--again)">이미 지난 날짜예요</span>'
    : `${escapeHtml(t)} <b>${diff === 0 ? 'D-DAY' : 'D-' + diff}</b>`;
}
function saveDday() {
  const title = document.getElementById('ddTitle').value.trim();
  const date = document.getElementById('ddDate').value;
  if (!date) { showToast("날짜를 골라 주세요"); return; }
  if (dayNum(date) < todayNum()) { showToast("오늘 이후 날짜를 골라 주세요"); return; }
  state.meta.dday = { title: title || "시험", date, u: Date.now() };
  saveLocal(); pushToCloud(); closeSheet(); render();
}
function clearDday() {
  state.meta.dday = { title: "", date: "", u: Date.now() };
  saveLocal(); pushToCloud(); closeSheet(); render();
}

// ===========================
// 공부하기 (보고 외우는 탭 · 기록 없음)
// ===========================
function testamentPills(cur, fnName) {
  return `<div class="pills">
    <button class="${cur === 'all' ? 'on' : ''}" onclick="${fnName}('all')">전체</button>
    <button class="${cur === 'old' ? 'on' : ''}" onclick="${fnName}('old')">구약</button>
    <button class="${cur === 'new' ? 'on' : ''}" onclick="${fnName}('new')">신약</button></div>`;
}
function byTestament(list, t) { return list.filter(b => t === 'all' || (t === 'new' ? isNT(b) : !isNT(b))); }
function setStudyMode(m) { studyMode = m; render(); }
function setStudyTestament(t) { studyTestament = t; render(); }

VIEWS.studyHome = function () {
  const books = byTestament(studyMode === 'q' ? BOOKS : VBOOKS, studyTestament);
  const grid = books.map(b => {
    const n = studyMode === 'q' ? QBY[b].length : VBY[b].length;
    const click = studyMode === 'q' ? `go({view:'studyList', book:BOOKS[${BOOKS.indexOf(b)}], chapter:null})`
                                    : `go({view:'studyView', kind:'v', book:VBOOKS[${VBOOKS.indexOf(b)}], pos:0, from:'studyHome'})`;
    return `<button class="bk" onclick="${click}"><div class="nm">${b}</div><div class="ct">${n}${studyMode === 'q' ? '문제' : '구절'}</div></button>`;
  }).join('');
  return `
    <div class="page-hd"><div><h1>공부하기</h1></div></div>
    <div class="seg">
      <button class="${studyMode === 'q' ? 'on' : ''}" onclick="setStudyMode('q')">📖 성경문제</button>
      <button class="${studyMode === 'v' ? 'on' : ''}" onclick="setStudyMode('v')">🙏 성경암송</button>
    </div>
    ${testamentPills(studyTestament, 'setStudyTestament')}
    <div class="grid2">${grid || '<div class="empty">책이 없어요</div>'}</div>`;
};

function studyList(book, chapter) {
  return (QBY[book] || []).filter(q => chapter == null || q.chapter === chapter);
}
function previewText(q) {
  return (q.type === 'fill' && q.body) ? q.body : q.question;
}
VIEWS.studyList = function (r) {
  const book = r.book;
  const all = QBY[book] || [];
  const chapters = [...new Set(all.map(q => q.chapter))].sort((a, b) => a - b);
  const list = studyList(book, r.chapter);
  const bi = BOOKS.indexOf(book);
  const pills = `<div class="pills">
      <button class="${r.chapter == null ? 'on' : ''}" onclick="go({view:'studyList', book:BOOKS[${bi}], chapter:null}, {keepScroll:true})">전체</button>
      ${chapters.map(c => `<button class="${r.chapter === c ? 'on' : ''}" onclick="go({view:'studyList', book:BOOKS[${bi}], chapter:${c}}, {keepScroll:true})">${c}장</button>`).join('')}
    </div>`;
  const rows = list.map((q, i) => `
    <button class="qrow" onclick="go({view:'studyView', kind:'q', book:BOOKS[${bi}], chapter:${r.chapter == null ? 'null' : r.chapter}, pos:${i}})">
      <div class="num">${QNUM[q.id]}</div>
      <div class="qr-main"><div class="qr-tag">${TYPE_LABEL[q.type] || ''} · ${q.chapter}장</div><div class="qr-txt">${escapeHtml(previewText(q))}</div></div>
    </button>`).join('');
  return `
    <button class="back" onclick="go({view:'studyHome'})">‹ 공부하기</button>
    <div class="title-lg">${book}</div>
    <div class="subtitle">${all.length}문제 · 누르면 그 번호부터 넘겨보며 공부해요</div>
    ${pills}${rows}`;
};

// 빈칸 문제: 본문 ( ) 자리에 정답을 채워서 보여줌
function blankParts(q) {
  const target = q.body || q.question;
  const n = (target.match(/\(\s*\)/g) || []).length;
  const answers = String(q.answer).split('/').map(s => s.trim());
  return { target, ok: n > 0 && n === answers.length, answers };
}
function renderFilled(text, answers) {
  let i = 0;
  return escapeHtml(text).replace(/\(\s*\)/g, () => `<span class="fill">${escapeHtml(answers[i++] || '')}</span>`);
}
function correctIndex(q) {
  return typeof q.answer === 'number' ? q.answer : q.options.findIndex(o => o === q.answer);
}
const MARKS = ['①', '②', '③', '④', '⑤', '⑥'];

function studyQuestionCard(q) {
  let h = `<span class="tag">${TYPE_LABEL[q.type]} · ${q.chapter}장</span>`;
  if (q.type === 'fill') {
    const bp = blankParts(q);
    if (q.body) {
      h += `<div class="q-text">${escapeHtml(q.question)}</div>`;
      h += `<div class="q-body">${bp.ok ? renderFilled(q.body, bp.answers) : escapeHtml(q.body)}</div>`;
    } else {
      h += `<div class="q-text">${bp.ok ? renderFilled(q.question, bp.answers) : escapeHtml(q.question)}</div>`;
    }
    if (!bp.ok) h += `<div class="ans"><span class="lab">정답</span>${escapeHtml(q.answer)}</div>`;
  } else if (q.type === 'multiple') {
    const ci = correctIndex(q);
    h += `<div class="q-text">${escapeHtml(q.question)}</div>`;
    if (q.body) h += `<div class="q-body">${escapeHtml(q.body)}</div>`;
    h += q.options.map((o, i) => `<div class="opt ${i === ci ? 'correct' : ''}">${MARKS[i] || (i + 1) + '.'} ${escapeHtml(o)}</div>`).join('');
  } else {
    h += `<div class="q-text">${escapeHtml(q.question)}</div>`;
    if (q.body) h += `<div class="q-body">${escapeHtml(q.body)}</div>`;
    h += `<div class="ans"><span class="lab">정답</span>${escapeHtml(q.answer)}</div>`;
  }
  return h;
}

VIEWS.studyView = function (r) {
  if (r.kind === 'v') {
    const list = VBY[r.book] || [];
    const pos = Math.max(0, Math.min(r.pos || 0, list.length - 1));
    const v = list[pos];
    const back = r.from === 'home' ? `<button class="back" onclick="goTab('home')">‹ 홈</button>`
                                   : `<button class="back" onclick="go({view:'studyHome'})">‹ 성경암송</button>`;
    const dots = list.length > 1 && list.length <= 14 ? `<div class="dots">${list.map((_, i) => `<i class="${i === pos ? 'on' : ''}"></i>`).join('')}</div>` : '';
    return `${back}
      <div class="viewer-meta"><span>${r.book} 암송</span><span>${pos + 1} / ${list.length}</span></div>
      <div class="swipe-area" id="swipeArea">
        <div class="vbig"><div class="vref">${escapeHtml(fullRef(v))}</div><div class="vtxt">${escapeHtml(v.answer)}</div></div>
        ${dots}
      </div>
      <div class="swipe-hint">← 좌우로 밀어서 넘기기 →</div>
      ${viewerNav(pos, list.length)}`;
  }
  const list = studyList(r.book, r.chapter);
  const pos = Math.max(0, Math.min(r.pos || 0, list.length - 1));
  const q = list[pos];
  return `<button class="back" onclick="go({view:'studyList', book:BOOKS[${BOOKS.indexOf(r.book)}], chapter:${r.chapter == null ? 'null' : r.chapter}})">‹ ${r.book} 목록</button>
    <div class="viewer-meta"><span>${r.book} ${QNUM[q.id]}번</span><span>${pos + 1} / ${list.length}</span></div>
    <div class="swipe-area" id="swipeArea"><div class="card">${studyQuestionCard(q)}</div></div>
    <div class="swipe-hint">← 좌우로 밀어서 넘기기 →</div>
    ${viewerNav(pos, list.length)}`;
};
function viewerNav(pos, len) {
  return `<div class="bottom-nav"><div class="bottom-nav-in">
    <button onclick="studyStep(-1)" ${pos <= 0 ? 'disabled' : ''}>‹ 이전</button>
    <button class="primary" onclick="studyStep(1)" ${pos >= len - 1 ? 'disabled' : ''}>다음 ›</button></div></div>`;
}
function studyStep(d) {
  const r = route;
  const len = r.kind === 'v' ? (VBY[r.book] || []).length : studyList(r.book, r.chapter).length;
  const pos = (r.pos || 0) + d;
  if (pos < 0 || pos >= len) return;
  go(Object.assign({}, r, { pos }));
}
let studyTimer = null;
function clearStudyTimer() { if (studyTimer) { clearTimeout(studyTimer); studyTimer = null; } }
AFTER.studyView = function (r) {
  // 3초 이상 본 문제/구절만 "공부함"으로 셈 (연속 공부용)
  const id = r.kind === 'v' ? (VBY[r.book] || [])[r.pos || 0] : studyList(r.book, r.chapter)[r.pos || 0];
  if (id) studyTimer = setTimeout(() => markStudied(id.id), 3000);
  bindSwipe(document.getElementById('swipeArea'), studyStep);
};
function bindSwipe(el, step) {
  if (!el) return;
  let x0 = null, y0 = null;
  el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
  }, { passive: true });
}
document.addEventListener('keydown', e => {
  if (document.getElementById('sheet')) return;
  if (route.view === 'studyView') {
    if (e.key === 'ArrowRight') studyStep(1);
    if (e.key === 'ArrowLeft') studyStep(-1);
  }
});

// ===========================
// 퀴즈
// ===========================
VIEWS.quizHome = function () {
  const s = activeSession('random');
  const sb = activeSession('vblank'), st = activeSession('vtest');
  const resume = (x) => (x && answeredCount(x) > 0) ? `<br><b>이어 풀기 ${answeredCount(x)}/${x.ids.length}</b>` : '';
  return `
    <div class="page-hd"><div><h1>퀴즈</h1></div></div>
    <div class="menu" role="button" tabindex="0" onclick="startQuiz('random', null, 'quizHome')"><div class="mi">📝</div>
      <div style="min-width:0"><div class="tt">오늘의 퀴즈</div><div class="dd">범위 안에서 ${QUIZ_SIZE}문제씩 · 홈과 같은 퀴즈예요${resume(s)}</div>
        <button class="chip" style="margin-top:8px" onclick="event.stopPropagation(); openRangeSheet('q')">범위 · ${escapeHtml(rangeLabel('q'))} ›</button></div><div class="ar">›</div></div>
    <button class="menu" onclick="go({view:'quizBooks'})"><div class="mi">📚</div>
      <div><div class="tt">성경 별 문제 풀기</div><div class="dd">한 권을 골라 순서대로 ${QUIZ_SIZE}문제씩</div></div><div class="ar">›</div></button>
    <div class="sec-title" style="display:flex;justify-content:space-between;align-items:center;margin-top:24px">
      <span>암송</span><button class="chip" onclick="openRangeSheet('v')">암송 범위 · ${escapeHtml(rangeLabel('v'))} ›</button></div>
    <button class="menu" onclick="startQuiz('vblank', null, 'quizHome')"><div class="mi warm">✏️</div>
      <div><div class="tt">암송 빈칸연습</div><div class="dd">빈칸을 채워가며 외우기${resume(sb)}</div></div><div class="ar">›</div></button>
    <button class="menu" onclick="startQuiz('vtest', null, 'quizHome')"><div class="mi warm">🅰️</div>
      <div><div class="tt">암송 테스트</div><div class="dd">첫 글자만 보고 떠올리기${resume(st)}</div></div><div class="ar">›</div></button>`;
};
function setQuizTestament(t) { quizTestament = t; render(); }
VIEWS.quizBooks = function () {
  const grid = byTestament(BOOKS, quizTestament).map(b => {
    const list = QBY[b];
    const seen = list.filter(q => state.progress[q.id] && !state.progress[q.id].isNew).length;
    let s = activeSession(sessKey('book', b));
    if (s && !answeredCount(s)) s = null;
    return `<button class="bk" onclick="startQuiz('book', BOOKS[${BOOKS.indexOf(b)}], 'quizBooks')">
      <div class="nm">${b}</div><div class="ct">${s ? `<b>이어 풀기 ${answeredCount(s)}/${s.ids.length}</b>` : `${seen} / ${list.length} 풀었어요`}</div></button>`;
  }).join('');
  return `<button class="back" onclick="go({view:'quizHome'})">‹ 퀴즈</button>
    <div class="title-lg">성경 별 문제 풀기</div>
    <div class="subtitle">문제집 순서대로, 안 푼 문제부터 ${QUIZ_SIZE}문제씩 나와요</div>
    ${testamentPills(quizTestament, 'setQuizTestament')}
    <div class="grid2">${grid}</div>`;
};

let selectedOption = -1;
let revealed = false;
function quizTitle(s) { return s.mode === 'book' ? s.book : QUIZ_MODES[s.mode].title; }
function exitQuiz() {
  const from = route.from || 'quizHome';
  go({ view: from === 'home' ? 'home' : from });
}

VIEWS.quizRun = function (r) {
  const s = sessions[r.key];
  if (!s) return VIEWS.quizHome();
  const total = s.ids.length, cur = answeredCount(s);
  const vi = Math.max(0, Math.min(s.view, cur, total - 1));
  s.view = vi;
  const q = QMAP[s.ids[vi]];
  const res = s.results[q.id];
  const pct = Math.round(cur / total * 100);
  let h = `
    <div class="qbar">
      <button class="ib" onclick="quizPrev()" ${vi <= 0 ? 'disabled' : ''} aria-label="이전 문제">‹</button>
      <div class="c">${escapeHtml(quizTitle(s))} · ${vi + 1} / ${total}</div>
      <button class="ib" onclick="exitQuiz()" aria-label="나가기">✕</button>
    </div>
    <div class="bar" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>`;
  if (res) {
    // 이미 푼 문제 다시 보기 (보기만 가능)
    h += `<div class="review">이미 푼 문제예요 · 내 평가: ${GRADE_NAME[res.g] || ''}</div>`;
    h += `<div class="card">${reviewCard(q, res, s.mode)}</div>`;
    h += `<div class="bottom-nav"><div class="bottom-nav-in">
      <button onclick="quizPrev()" ${vi <= 0 ? 'disabled' : ''}>‹ 이전</button>
      <button class="primary" onclick="quizNext()">${vi + 1 === cur ? '풀던 문제로 ›' : '다음 ›'}</button></div></div>`;
    return h;
  }
  selectedOption = -1; revealed = false;
  h += `<div class="card">${liveCard(q, s.mode)}<div id="answerArea"></div></div>`;
  return h;
};
function quizPrev() { const s = sessions[route.key]; if (!s || s.view <= 0) return; s.view--; saveSessions(); render(); }
function quizNext() { const s = sessions[route.key]; if (!s) return; s.view = Math.min(s.view + 1, answeredCount(s)); saveSessions(); render(); }

function liveCard(q, mode) {
  let h = '';
  if (q.type === 'verse') {
    h += `<span class="tag">${mode === 'vtest' ? '암송 · 테스트' : '암송 · 빈칸연습'}</span>`;
    h += `<div class="q-text">${escapeHtml(fullRef(q))}</div>`;
    if (mode === 'vtest') {
      h += `<div class="hint">첫 글자만 보고 구절 전체를 떠올려 보세요.</div><div class="verse-hint">${escapeHtml((q.answer || '').trim().charAt(0))}</div>`;
    } else {
      h += `<div class="hint">빈칸을 마음속으로 채워가며 외워 보세요.</div><div class="verse-blank">${makeBlankVerse(q.answer)}</div>`;
    }
    h += `<button class="btn" style="margin-top:14px" onclick="revealAnswer()">정답 보기</button>`;
    return h;
  }
  h += `<span class="tag">${TYPE_LABEL[q.type]} · ${q.book} ${q.chapter}장</span>`;
  h += `<div class="q-text">${escapeHtml(q.question)}</div>`;
  if (q.body) h += `<div class="q-body">${escapeHtml(q.body)}</div>`;
  if (q.type === 'multiple') {
    h += '<div id="optionsBox">' + q.options.map((o, i) => `<button class="opt" data-idx="${i}" onclick="selectOption(${i})">${MARKS[i] || (i + 1) + '.'} ${escapeHtml(o)}</button>`).join('') + '</div>';
    h += `<button id="checkBtn" class="btn" style="margin-top:6px" onclick="checkMultiple()" disabled>정답 확인</button>`;
  } else {
    h += `<textarea class="ua" id="userAnswer" placeholder="답을 적어 보세요 (선택 · 머릿속으로 떠올려도 돼요)"></textarea>`;
    h += `<button class="btn" onclick="revealAnswer()">정답 보기</button>`;
  }
  return h;
}
function reviewCard(q, res, mode) {
  let h = '';
  if (q.type === 'verse') {
    h += `<span class="tag">${mode === 'vtest' ? '암송 · 테스트' : '암송 · 빈칸연습'}</span><div class="q-text">${escapeHtml(fullRef(q))}</div>`;
    h += `<div class="ans"><span class="lab">구절</span>${escapeHtml(q.answer)}</div>`;
    return h;
  }
  h += `<span class="tag">${TYPE_LABEL[q.type]} · ${q.book} ${q.chapter}장</span><div class="q-text">${escapeHtml(q.question)}</div>`;
  if (q.body) h += `<div class="q-body">${escapeHtml(q.body)}</div>`;
  if (q.type === 'multiple') {
    const ci = correctIndex(q);
    h += q.options.map((o, i) => {
      const cls = i === ci ? 'correct' : (i === res.pick ? 'wrong' : '');
      return `<div class="opt ${cls}">${MARKS[i] || (i + 1) + '.'} ${escapeHtml(o)}${i === res.pick && i !== ci ? ' · 내 답' : ''}</div>`;
    }).join('');
  } else {
    if (res.typed) h += `<div class="hint" style="margin-top:4px">내가 적은 답: ${escapeHtml(res.typed)}</div>`;
    h += `<div class="ans"><span class="lab">정답</span>${escapeHtml(q.answer)}</div>`;
  }
  return h;
}
function makeBlankVerse(text) {
  const words = String(text).split(/\s+/).filter(w => w.length > 0);
  return words.map((w, i) => (i % 3 === 2 && w.length >= 2) ? `<span class="blank">${escapeHtml(w)}</span>` : escapeHtml(w)).join(' ');
}
function selectOption(i) {
  selectedOption = i;
  document.querySelectorAll('#optionsBox .opt').forEach((el, idx) => el.classList.toggle('sel', idx === i));
  document.getElementById('checkBtn').disabled = false;
}
function checkMultiple() {
  const s = sessions[route.key], q = QMAP[s.ids[s.view]];
  const ci = correctIndex(q);
  document.querySelectorAll('#optionsBox .opt').forEach((el, idx) => {
    el.disabled = true; el.classList.remove('sel');
    if (idx === ci) el.classList.add('correct');
    else if (idx === selectedOption) el.classList.add('wrong');
  });
  document.getElementById('checkBtn').style.display = 'none';
  const ok = selectedOption === ci;
  showGradeButtons(ok ? '<div class="result ok">✓ 맞았어요!</div>' : '<div class="result no">✗ 틀렸어요. 정답을 확인하고 평가해 주세요.</div>');
}
function revealAnswer() {
  if (revealed) return;
  revealed = true;
  const s = sessions[route.key], q = QMAP[s.ids[s.view]];
  const btn = document.querySelector('#answerArea') && document.querySelector('.card .btn');
  if (btn) btn.style.display = 'none';
  const ta = document.getElementById('userAnswer');
  if (ta) ta.readOnly = true;
  let ans;
  if (q.type === 'verse') {
    ans = `<div class="ans" style="margin-top:12px"><span class="lab">구절</span>${escapeHtml(q.answer)}</div>`;
  } else {
    ans = `<div class="ans" style="margin-top:4px"><span class="lab">정답</span>${escapeHtml(q.answer)}</div>`;
  }
  showGradeButtons(ans);
}
function showGradeButtons(prefix) {
  document.getElementById('answerArea').innerHTML = (prefix || '') + `
    <div class="grade-help">얼마나 잘 알고 있었나요? 솔직하게 고르면 복습 순서가 더 정확해져요.</div>
    <div class="grades">
      <button class="g-again" onclick="gradeQ('again')">다시</button>
      <button class="g-hard" onclick="gradeQ('hard')">어려움</button>
      <button class="g-good" onclick="gradeQ('good')">보통</button>
      <button class="g-easy" onclick="gradeQ('easy')">쉬움</button>
    </div>`;
}
function gradeQ(g) {
  const key = route.key, s = sessions[key];
  if (!s) return;
  const q = QMAP[s.ids[s.view]];
  if (s.results[q.id]) return;
  if (!s.counted) { state.sessionCount += 1; s.counted = true; }
  let p = state.progress[q.id] || initProgress();
  state.progress[q.id] = applyGrade(p, g);
  const ta = document.getElementById('userAnswer');
  s.results[q.id] = { g, pick: q.type === 'multiple' ? selectedOption : undefined, typed: ta && ta.value.trim() ? ta.value.trim().slice(0, 200) : undefined };
  s.view = answeredCount(s);
  saveSessions();
  saveProgress(q.id);
  if (answeredCount(s) >= s.ids.length) {
    creditToday();
    go({ view: 'quizDone', key, from: route.from });
  } else {
    go(Object.assign({}, route));
  }
}

VIEWS.quizDone = function (r) {
  const s = sessions[r.key];
  if (!s) return VIEWS.quizHome();
  const c = { easy: 0, good: 0, hard: 0, again: 0 };
  Object.values(s.results).forEach(x => { if (c[x.g] !== undefined) c[x.g]++; });
  return `
    <div class="qbar"><span style="width:40px"></span><div class="c">${escapeHtml(quizTitle(s))}</div><button class="ib" onclick="finishQuiz()" aria-label="닫기">✕</button></div>
    <div class="done">
      <div class="e">🎉</div>
      <h2>${s.ids.length}문제 완료!</h2>
      <p>${s.mode === 'random' ? '오늘의 퀴즈를 마쳤어요' : '한 세트를 마쳤어요'}</p>
      <div class="sum">
        <div><b style="color:var(--easy)">${c.easy}</b>쉬움</div>
        <div><b style="color:#5f8f6c">${c.good}</b>보통</div>
        <div><b style="color:#c39345">${c.hard}</b>어려움</div>
        <div><b style="color:var(--again)">${c.again}</b>다시</div>
      </div>
      <button class="btn" onclick="continueQuiz('${r.key.replace(/'/g, "\\'")}', '${r.from || 'quizHome'}')">계속 풀기 (${QUIZ_SIZE}문제 더)</button>
      <button class="btn secondary" onclick="finishQuiz()">완료</button>
    </div>`;
};
function finishQuiz() {
  delete sessions[route.key];
  saveSessions();
  exitQuiz();
}

// ===========================
// 설정
// ===========================
VIEWS.settings = function () {
  const authHtml = state.user
    ? `<p>로그인됨: <b>${escapeHtml(state.user.name || state.user.email || '')}</b></p>
       <p class="muted" style="margin-top:4px">진도가 폰·PC에 자동으로 동기화돼요.</p>
       <button class="btn secondary sm" style="margin-top:12px" onclick="signOut()">로그아웃</button>`
    : `<p>지금은 진도가 이 기기에만 저장되고 있어요.</p>
       <p class="muted" style="margin:4px 0 12px">구글로 로그인하면 폰·PC에서 진도를 함께 쓸 수 있어요.</p>
       <button class="btn sm" onclick="signIn()">🔐 구글로 로그인</button>`;
  const dd = ddayInfo();
  return `
    <div class="page-hd"><div><h1>설정</h1></div></div>
    <div class="card set-card"><h3>계정</h3>${authHtml}</div>
    <div class="card set-card"><h3>시험 D-day</h3>
      <p class="muted" style="margin-bottom:12px">${dd ? `${escapeHtml(dd.title)} · <b style="color:var(--primary-dark)">${dd.label}</b>` : '설정된 D-day가 없어요'}</p>
      <button class="btn light sm" onclick="openDdaySheet()">${dd ? 'D-day 수정' : 'D-day 정하기'}</button></div>
    <div class="card set-card"><h3>매일 알림</h3>
      <p class="muted" style="margin-bottom:12px">정해진 시간에 공부 알림을 받아요. (앱이 열려 있거나 백그라운드에 있을 때)</p>
      <div class="set-row"><input type="time" id="reminderTime" value="${settings.reminderTime || ''}">
        <button class="btn sm" style="width:auto;padding:10px 14px" onclick="saveReminderTime()">켜기 / 저장</button>
        <button class="btn secondary sm" style="width:auto;padding:10px 14px;margin:0" onclick="disableReminder()">끄기</button></div>
      <div id="notifStatus" class="muted" style="margin-top:10px"></div>
      <p class="muted" style="margin:14px 0 10px">앱이 닫혀 있을 때도 알림을 받으려면 휴대폰 캘린더에 매일 반복 일정으로 넣는 게 가장 확실해요.</p>
      <button class="btn secondary sm" onclick="downloadICS()">📅 캘린더에 매일 일정 추가 (.ics)</button></div>
    <div class="card set-card"><h3>데이터</h3>
      <button class="btn secondary sm" onclick="exportData()">내 진도 내보내기 (JSON)</button>
      <button class="btn secondary sm" onclick="document.getElementById('importFile').click()">진도 가져오기</button>
      <button class="btn danger sm" onclick="resetProgress()">진도 초기화</button></div>`;
};
AFTER.settings = function () { updateNotifStatus(); };

function signIn() {
  if (!firebaseConfigured()) { showToast("Firebase 설정이 필요해요"); return; }
  if (!fbReady) { showToast("로그인 준비 중이에요. 잠시 후 다시 시도해 주세요."); return; }
  const provider = new firebase.auth.GoogleAuthProvider();
  fbAuth.signInWithPopup(provider).catch(err => { console.error(err); showToast("로그인 실패: " + (err.message || err.code || "")); });
}
function signOut() {
  if (fbReady && fbAuth) fbAuth.signOut();
  state.user = null;
  if (route.view === 'settings') render();
}

function exportData() {
  const data = JSON.stringify({ progress: state.progress, sessionCount: state.sessionCount, meta: state.meta, settings, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bible-progress-${dayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || typeof data.progress !== 'object') throw new Error('progress 없음');
      const now = Date.now();
      const imported = data.progress || {};
      let maxSeen = 0;
      Object.values(imported).forEach(p => { if (p) { p.t = now; maxSeen = Math.max(maxSeen, (p.lastSession || 0) + 1); } });
      state.progress = imported;
      state.sessionCount = typeof data.sessionCount === 'number' ? data.sessionCount : Math.max(state.sessionCount, maxSeen);
      state.resetAt = now;
      if (data.meta) state.meta = mergeMeta(state.meta, data.meta);
      if (data.settings) settings = { ...settings, ...data.settings };
      saveLocal(); saveSettings();
      pushToCloud({ full: true });
      sessions = {}; saveSessions();
      showToast("진도를 가져왔어요");
      goTab('home');
    } catch (err) { showToast("파일이 올바르지 않아요"); }
  };
  reader.readAsText(file);
  event.target.value = '';
}
function resetProgress() {
  if (!confirm('정말 모든 진도를 초기화할까요? 되돌릴 수 없어요.')) return;
  state.progress = {};
  state.sessionCount = 0;
  state.resetAt = Date.now();
  saveLocal();
  pushToCloud({ full: true });
  sessions = {}; saveSessions();
  showToast("초기화 완료");
  goTab('home');
}

// ===========================
// 유틸
// ===========================
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer = null;
function showToast(msg, kind, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast' + (kind ? ' ' + kind : ''); }, ms || 2200);
}

// ===========================
// 알림 기능
// ===========================
let reminderTimeoutId = null;

function scheduleNextReminder() {
  if (reminderTimeoutId) clearTimeout(reminderTimeoutId);
  if (!settings.reminderTime || !settings.notificationEnabled) return;
  if (Notification.permission !== "granted") return;

  const [hh, mm] = settings.reminderTime.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const msUntil = next - now;
  reminderTimeoutId = setTimeout(() => {
    showStudyNotification();
    scheduleNextReminder(); // 다음 날도 예약
  }, msUntil);

  console.log(`다음 알림: ${next.toLocaleString('ko-KR')}`);
}

function showStudyNotification() {
  if (Notification.permission !== "granted") return;
  const due = QUESTIONS.filter(q => {
    const p = state.progress[q.id];
    return !p || p.nextSession <= state.sessionCount + 1;
  }).length;
  new Notification("📖 성경 문제집 공부 시간!", {
    body: due > 0 ? `오늘 풀 문제가 ${due}개 있어요.` : "오늘의 학습을 시작해보세요.",
    icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%234a7c59'/><text x='50%25' y='65%25' font-size='60' text-anchor='middle' fill='white'>📖</text></svg>",
    tag: "bible-study-daily"
  });
}

async function saveReminderTime() {
  const t = document.getElementById('reminderTime').value;
  if (!t) { showToast("시간을 선택해주세요"); return; }

  settings.reminderTime = t;

  if (!("Notification" in window)) {
    showToast("이 브라우저는 알림을 지원하지 않아요");
    document.getElementById('notifStatus').textContent =
      "이 브라우저는 알림을 지원하지 않아요. 캘린더 등록을 이용해주세요.";
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return;
  }

  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      showToast("알림 권한이 거부되었어요");
      document.getElementById('notifStatus').textContent =
        "브라우저 알림 권한이 차단되어 있어요. 브라우저 설정에서 이 사이트의 알림을 허용해주세요.";
      return;
    }
  }
  if (Notification.permission === "denied") {
    document.getElementById('notifStatus').textContent =
      "브라우저 알림 권한이 차단되어 있어요. 주소창 좌측 자물쇠 아이콘 → 알림 허용으로 바꿔주세요.";
    return;
  }

  settings.notificationEnabled = true;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  scheduleNextReminder();
  document.getElementById('notifStatus').textContent =
    `✓ 매일 ${t}에 알림을 보내드릴게요. (앱이 열려있거나 백그라운드에 있을 때 동작)`;
  showToast("알림이 설정되었어요");
}

function disableReminder() {
  settings.notificationEnabled = false;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (reminderTimeoutId) clearTimeout(reminderTimeoutId);
  document.getElementById('notifStatus').textContent = "알림이 꺼졌어요.";
  showToast("알림 꺼짐");
}

function downloadICS() {
  const t = document.getElementById('reminderTime').value || settings.reminderTime || "07:00";
  const [hh, mm] = t.split(':').map(Number);
  // 오늘 날짜에 시작, 매일 반복
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + 10 * 60 * 1000); // 10분 일정

  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const url = location.href;
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Bible Workbook//Daily Reminder//KO
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:bible-study-${Date.now()}@local
DTSTAMP:${fmt(new Date())}
DTSTART:${fmt(start)}
DTEND:${fmt(end)}
RRULE:FREQ=DAILY
SUMMARY:📖 성경 문제집 공부
DESCRIPTION:오늘의 성경 문제 공부 시간이에요.\\n앱 열기: ${url}
URL:${url}
BEGIN:VALARM
TRIGGER:-PT0M
ACTION:DISPLAY
DESCRIPTION:📖 성경 문제집 공부 시간!
END:VALARM
END:VEVENT
END:VCALENDAR`;

  const blob = new Blob([ics], {type: 'text/calendar'});
  const dlUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = dlUrl;
  a.download = '성경공부-매일알림.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(dlUrl);
  showToast("캘린더 파일을 받았어요. 열면 매일 알림이 등록됩니다");
}

function updateNotifStatus() {
  const el = document.getElementById('notifStatus');
  if (!el) return;
  if (!("Notification" in window)) {
    el.textContent = "이 브라우저는 알림 미지원. 캘린더 등록을 이용해주세요.";
  } else if (Notification.permission === "denied") {
    el.textContent = "브라우저 알림이 차단되어 있어요. 사이트 설정에서 허용해주세요.";
  } else if (settings.notificationEnabled && settings.reminderTime) {
    el.textContent = `✓ 매일 ${settings.reminderTime}에 알림 (앱이 열려있거나 백그라운드일 때)`;
  } else {
    el.textContent = "알림이 꺼져 있어요.";
  }
}
// ===========================
// 시작
// ===========================
loadProgress();
loadSessions();
initFirebase();  // 로그인 상태 감지 + 동기화
document.querySelectorAll('#tabbar button').forEach(b => b.addEventListener('click', () => goTab(b.dataset.tab)));
render();

if (settings.notificationEnabled && settings.reminderTime && "Notification" in window && Notification.permission === "granted") {
  scheduleNextReminder();
}
let lastRenderDay = dayKey();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (settings.notificationEnabled) scheduleNextReminder();
  // 날짜가 바뀌었으면 홈(오늘의 말씀·D-day·연속 공부) 새로 그리기
  if (dayKey() !== lastRenderDay) { lastRenderDay = dayKey(); if (route.view === 'home') render(); }
  // 다른 기기에서 공부했을 수 있으니 다시 열면 조용히 동기화 (5분 간격)
  if (state.user && Date.now() - lastSyncAt > 5 * 60 * 1000) syncOnLogin(true);
});
