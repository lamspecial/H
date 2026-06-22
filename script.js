// ============================================================
//  script.js — AM Special Call Center — Fixed & Clean Version
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  writeBatch,
  where,
  enableMultiTabIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyCWVLIZMsWFeGvBjU69iQeHc4LkXx_TgLg",
  authDomain: "customer-service-ddb34.firebaseapp.com",
  projectId: "customer-service-ddb34",
  storageBucket: "customer-service-ddb34.firebasestorage.app",
  messagingSenderId: "109576870374",
  appId: "1:109576870374:web:e1a4c7dc726543ebc7de27"
};

// ===== FIREBASE INIT =====
let _firestore = null;
try {
  const app = initializeApp(firebaseConfig);
  _firestore = getFirestore(app);

  // Use multi-tab persistence (replaces deprecated enableIndexedDbPersistence)
  enableMultiTabIndexedDbPersistence(_firestore).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Multi-tab persistence unavailable, falling back.');
    } else if (err.code === 'unimplemented') {
      console.warn('Persistence not supported in this browser.');
    }
  });

  window._firestoreReady = true;
  console.log('Firebase initialized ✓');
} catch (e) {
  console.error('Firebase init error:', e);
  window._firestoreReady = false;
}

// ===== FIREBASE LAYER =====
window.FB = {
  ready: () => !!window._firestoreReady && !!_firestore,

  _col: () => collection(_firestore, 'calls'),
  _ref: (seq) => doc(collection(_firestore, 'calls'), seq),

  async save(rec) {
    if (!FB.ready()) { OfflineQ.add('save', rec); return; }
    const data = { ...rec, dt: rec.dt instanceof Date ? rec.dt.toISOString() : String(rec.dt) };
    try {
      await setDoc(FB._ref(rec.seq), data);
    } catch (e) {
      console.warn('FB.save failed, queuing:', e.message);
      OfflineQ.add('save', rec);
    }
  },

  async remove(seq) {
    if (!FB.ready()) { OfflineQ.add('delete', { seq }); return; }
    try {
      await deleteDoc(FB._ref(seq));
    } catch (e) {
      console.warn('FB.remove failed, queuing:', e.message);
      OfflineQ.add('delete', { seq });
    }
  },

  async getAll() {
    if (!FB.ready()) return null;
    try {
      const snap = await getDocs(FB._col());
      console.log(`Fetched ${snap.size} docs from Firestore`);
      const results = [];
      snap.forEach(d => {
        const data = d.data();
        results.push({ ...data, dt: new Date(data.dt) });
      });
      return results;
    } catch (e) {
      console.warn('FB.getAll failed:', e.message);
      return null;
    }
  },

  startListener(onUpdate) {
    if (!FB.ready()) return null;
    try {
      return onSnapshot(FB._col(), (snap) => {
        const results = [];
        snap.forEach(d => {
          const data = d.data();
          results.push({ ...data, dt: new Date(data.dt) });
        });
        onUpdate(results);
      }, (err) => {
        console.warn('onSnapshot error:', err.message);
      });
    } catch (e) {
      console.warn('startListener failed:', e.message);
      return null;
    }
  },

  async batchSave(recs) {
    if (!FB.ready() || !recs.length) return false;
    try {
      const CHUNK = 400;
      for (let i = 0; i < recs.length; i += CHUNK) {
        const chunk = recs.slice(i, i + CHUNK);
        const batch = writeBatch(_firestore);
        chunk.forEach(rec => {
          const data = { ...rec, dt: rec.dt instanceof Date ? rec.dt.toISOString() : String(rec.dt) };
          batch.set(FB._ref(rec.seq), data);
        });
        await batch.commit();
      }
      return true;
    } catch (e) {
      console.warn('FB.batchSave failed:', e.message);
      return false;
    }
  }
};

// ===== OFFLINE QUEUE =====
window.OfflineQ = {
  STORE: 'offlineQueue',
  _store(mode) {
    return window.db.transaction(this.STORE, mode).objectStore(this.STORE);
  },
  async get() {
    return new Promise((resolve) => {
      try {
        const req = this._store('readonly').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) { resolve([]); }
    });
  },
  async set(q) {
    return new Promise((resolve) => {
      try {
        const store = this._store('readwrite');
        store.clear();
        q.forEach(item => store.put(item));
        store.transaction.oncomplete = () => { this.updateBadge(); resolve(); };
        store.transaction.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  },
  async add(action, rec) {
    const q = await this.get();
    const seq = rec ? rec.seq : null;
    const filtered = seq ? q.filter(i => !(i.seq === seq && i.action === action)) : q;
    filtered.push({
      action, seq,
      rec: rec ? { ...rec, dt: rec.dt instanceof Date ? rec.dt.toISOString() : String(rec.dt) } : null,
      ts: Date.now()
    });
    await this.set(filtered);
  },
  updateBadge() {
    this.get().then(q => {
      const badge = document.getElementById('offlineQueueStatus');
      const count = document.getElementById('offlineQueueCount');
      if (!badge || !count) return;
      badge.style.display = q.length > 0 ? 'flex' : 'none';
      count.textContent = q.length + ' في الانتظار';
    });
  },
  async sync() {
    if (!FB.ready() || !navigator.onLine) return;
    const q = await this.get();
    if (!q.length) return;
    const remaining = [];
    let synced = 0;
    for (const item of q) {
      try {
        if (item.action === 'save' && item.rec) {
          const rec = { ...item.rec, dt: new Date(item.rec.dt) };
          const data = { ...rec, dt: rec.dt.toISOString() };
          await setDoc(FB._ref(rec.seq), data);
          synced++;
        } else if (item.action === 'delete' && item.seq) {
          await deleteDoc(FB._ref(item.seq));
          synced++;
        }
      } catch (e) {
        remaining.push(item);
      }
    }
    await this.set(remaining);
    if (synced > 0) window.toast(`✓ تمت مزامنة ${synced} سجل`, 'ok');
  }
};

// ===== INDEXEDDB =====
const DB_NAME = 'CS_DB';
const STORE_CALLS = 'calls';
const STORE_SETTINGS = 'settings';
const STORE_CHILD_NAMES = 'childNames';
const STORE_OFFLINE_QUEUE = 'offlineQueue';

window.db = undefined;

window.initDB = function () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_CALLS)) d.createObjectStore(STORE_CALLS, { keyPath: 'seq' });
      if (!d.objectStoreNames.contains(STORE_SETTINGS)) d.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      if (!d.objectStoreNames.contains(STORE_CHILD_NAMES)) d.createObjectStore(STORE_CHILD_NAMES, { keyPath: 'seq' });
      if (!d.objectStoreNames.contains(STORE_OFFLINE_QUEUE)) d.createObjectStore(STORE_OFFLINE_QUEUE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => { window.db = e.target.result; resolve(window.db); };
    req.onerror = e => reject(e.target.error);
  });
};

window.getAllCallsDB = function () {
  return new Promise((resolve, reject) => {
    if (!window.db) { resolve([]); return; }
    const tx = window.db.transaction(STORE_CALLS, 'readonly');
    const req = tx.objectStore(STORE_CALLS).getAll();
    req.onsuccess = () => resolve(req.result.map(c => ({ ...c, dt: new Date(c.dt) })));
    req.onerror = () => reject(req.error);
  });
};

window.saveCallDB = function (call) {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const tx = window.db.transaction(STORE_CALLS, 'readwrite');
    const rec = { ...call, dt: call.dt instanceof Date ? call.dt.toISOString() : String(call.dt) };
    tx.objectStore(STORE_CALLS).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

window.deleteCallDB = function (seq) {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const tx = window.db.transaction(STORE_CALLS, 'readwrite');
    tx.objectStore(STORE_CALLS).delete(seq);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
};

// ===== SETTINGS =====
const S_DEFAULT = {
  nat: ['سعودي', 'شامي', 'مصري', 'اسيوي', 'غربي'],
  branches: ['شرق بلازا', 'مركز المملكة', 'سلام مول', 'الرياض جاليري', 'القصر مول', 'ذافيو مول'],
  locs: ['المنزل', 'السيارة', 'المول', 'الخارج'],
  ctypes: ['استفسار', 'طلب', 'شكوى'],
  emos: ['طبيعي', 'مستعجل', 'إيجابي', 'غير حاسم', 'منزعج', 'كثير الإلحاح'],
  srcs: ['انستقرام', 'الخرائط', 'الذكاء الاصطناعي', 'بحث قوقل'],
  topicMap: {
    'استفسار': ['الأسعار', 'أوقات العمل', 'سعر بالساعة', 'سياسة المرافق', 'الأعمار', 'العروض', 'الاشتراك الشهري', 'الفعاليات', 'التعليم', 'الخدمة', 'الوجبة'],
    'شكوى': ['أسلوب الموظفات', 'قائمة الحظر', 'السلامة', 'الختم', 'شكوى قانونية', 'سياسة الإلغاء'],
    'طلب': ['مفقودات', 'التواصل', 'حفلة خاصة', 'مكان الفرع', 'الإطمئنان']
  },
  labels: {},
  branchPhones: {},
  adminPhone: ''
};
window.S = JSON.parse(JSON.stringify(S_DEFAULT));

window.loadSettings = async function () {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const tx = window.db.transaction(STORE_SETTINGS, 'readonly');
    const req = tx.objectStore(STORE_SETTINGS).get('main');
    req.onsuccess = () => {
      if (req.result && req.result.data) {
        window.S = { ...JSON.parse(JSON.stringify(S_DEFAULT)), ...req.result.data };
        // Merge topicMap keys
        window.S.topicMap = { ...S_DEFAULT.topicMap, ...(req.result.data.topicMap || {}) };
      } else {
        window.S = JSON.parse(JSON.stringify(S_DEFAULT));
      }
      resolve();
    };
    req.onerror = () => resolve();
  });
};

window.saveSettings = async function () {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const tx = window.db.transaction(STORE_SETTINGS, 'readwrite');
    tx.objectStore(STORE_SETTINGS).put({ key: 'main', data: window.S });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

// ===== CHILD NAMES =====
window.getChildNames = function (seq) {
  return new Promise((resolve) => {
    if (!window.db) { resolve([]); return; }
    const tx = window.db.transaction(STORE_CHILD_NAMES, 'readonly');
    const req = tx.objectStore(STORE_CHILD_NAMES).get(seq);
    req.onsuccess = () => resolve(req.result ? req.result.names : []);
    req.onerror = () => resolve([]);
  });
};

window.saveChildNames = function (seq, names) {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const cleaned = names.filter(n => n && n.trim() !== '');
    const tx = window.db.transaction(STORE_CHILD_NAMES, 'readwrite');
    if (cleaned.length > 0) tx.objectStore(STORE_CHILD_NAMES).put({ seq, names: cleaned });
    else tx.objectStore(STORE_CHILD_NAMES).delete(seq);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

window.deleteChildNames = function (seq) {
  return new Promise((resolve) => {
    if (!window.db) { resolve(); return; }
    const tx = window.db.transaction(STORE_CHILD_NAMES, 'readwrite');
    tx.objectStore(STORE_CHILD_NAMES).delete(seq);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
};

// ===== CONSTANTS =====
const CHILD_LABELS_DEF = { 'طفل': '1', 'طفلين': '2', 'ثلاثة': '3', 'أربعة': '4', 'خمسة': '5', 'أكثر': '6+' };
const CHILD_OPTS = ['طفل', 'طفلين', 'ثلاثة', 'أربعة', 'خمسة', 'أكثر'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// ===== STATE =====
window.calls = [];
window.editSeq = null;
window.callDT = null;
window.formStep = 1;
window.isEditMode = false;
window.tagsStepIndex = 0;
window.tagsPanelOpen = false;
window.groupMode = false;
window.textViewActive = false;
window.defaultDate = null;
window.dateSettingsOpen = false;
window.fontScale = 100;

// FIX: sel uses 'topics' (array) — TAGS_STEPS must use group:'topics' to match
// OR we keep group:'topic' but handle topics specially everywhere
// SOLUTION: unified sel object with correct key
window.sel = { gender: '', nat: '', branch: '', loc: '', src: '', topics: [], ctype: '', child: '', emo: '' };

const FONT_STEPS = [75, 85, 100, 115, 130];

// TAGS_STEPS — FIX: group for topic is kept as 'topic' but we read/write sel.topics in handlers
const TAGS_STEPS = [
   { id: 'gender',  label: '👤 الجنس',              group: 'gender',  items: ['ذكر', 'أنثى'], cssClass: 'tl-solid-teal', color: '#047857' },
  { id: 'branch',  label: '🏢 الفرع',             group: 'branch',  itemsKey: 'branches', cssClass: 'tl-wide-blue',     color: '#4338ca' },
  { id: 'ctype',   label: '📞 نوع المكالمة',       group: 'ctype',   items: ['استفسار', 'طلب', 'شكوى'], cssClass: 'tl-contrast-dark', color: '#1e293b' },
  { id: 'topic',   label: '📋 الموضوع',            group: 'topic',   itemsKey: null,       cssClass: 'tl-outline-red',   color: '#dc2626' },
  { id: 'nat',     label: '🌍 الجنسية (اللكنة)',   group: 'nat',     itemsKey: 'nat',      cssClass: 'tl-solid-blue',    color: '#1d4ed8' },
  { id: 'child',   label: '👶 عدد الأطفال',        group: 'child',   items: CHILD_OPTS,    cssClass: 'tl-pill-blue',     color: '#7c3aed' },
  { id: 'loc',     label: '📍 موقع العميل',        group: 'loc',     itemsKey: 'locs',     cssClass: 'tl-teal-text',     color: '#0f766e' },
  { id: 'emo',     label: '🎭 نبرة العميل',        group: 'emo',     itemsKey: 'emos',     cssClass: 'tl-bold-indigo',   color: '#3730a3' },
  { id: 'src',     label: '📡 مصدر التواصل',       group: 'src',     itemsKey: 'srcs',     cssClass: 'tl-wide-outline',  color: '#b45309' },
];

// ===== TOAST =====
window.toast = function (msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
};

// ===== FONT SIZE =====
window.changeFontSize = function (dir) {
  const idx = FONT_STEPS.indexOf(window.fontScale);
  const next = idx + dir;
  if (next < 0 || next >= FONT_STEPS.length) return;
  window.fontScale = FONT_STEPS[next];
  window.applyFontScale();
  const lbl = document.getElementById('fontSizeLabel');
  if (lbl) lbl.textContent = window.fontScale + '%';
};
window.applyFontScale = function () {
  const ratio = window.fontScale / 100;
  document.body.style.zoom = ratio;
};

// ===== CLOCK =====
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = window.fmtTime(new Date());
}, 1000);

// ===== TIME/DATE UTILS =====
window.fmtTime = function (d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
};
window.fmtDate = function (d) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
window.fmtDT = function (d) {
  return `${window.fmtDate(d)}  ${window.fmtTime(d)}`;
};
window.dayKey = function (d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
window.isSaudiPhone = function (v) {
  return /^05\d{8}$/.test(v);
};
window.monthLetter = function (d) {
  return String.fromCharCode(65 + (d || new Date()).getMonth());
};

// FIX: التسلسل القديم كان "حرف+يوم(رقمين)+رقم_المكالمة" بدون فاصل (مثل A051)،
// فكان استخراج "كل الأرقام الأخيرة" بالـ regex يخلط رقم اليوم مع رقم المكالمة
// (مثال: أول مكالمة باليوم 5 = "A051" تُقرأ خطأً كرقم 51 لا 1).
// الحل: فاصل "-" ثابت بين اليوم ورقم المكالمة، ويُستخرج رقم المكالمة من بعد الفاصل فقط.
window.dayCallCount = function (dt) {
  const k = window.dayKey(dt);
  let maxNum = 0;
  window.calls.forEach(c => {
    if (window.dayKey(c.dt) === k) {
      const dashIdx = c.seq.lastIndexOf('-');
      if (dashIdx !== -1) {
        const num = parseInt(c.seq.slice(dashIdx + 1), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    }
  });
  return maxNum + 1;
};

window.buildSeq = function (dt) {
  const d = dt || (window.defaultDate ? new Date(window.defaultDate) : new Date());
  const letter = window.monthLetter(d);
  const day = String(d.getDate()).padStart(2, '0');
  const num = String(window.dayCallCount(d));
  return letter + day + '-' + num;
};
window.nextSeq = function (dt) { return window.buildSeq(dt); };

// ===== TABS =====
window.switchTab = function (id, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + id);
  if (tab) tab.classList.add('active');
  if (btn) btn.classList.add('active');
  if (id === 'analytics') window.updateAnalytics();
  if (id === 'maint') window.renderMBody();
  if (id === 'log') window.renderFilteredLog();
  if (id === 'form' && !window.callDT && window.defaultDate) window.touchDT();
};

// ===== DATE SETTINGS =====
window.toggleDateSettings = function () {
  window.dateSettingsOpen = !window.dateSettingsOpen;
  const panel = document.getElementById('dateSettingsPanel');
  const gear = document.getElementById('dateSettingsBtn');
  if (panel) panel.style.display = window.dateSettingsOpen ? 'block' : 'none';
  const active = window.dateSettingsOpen || window.defaultDate;
  if (gear) {
    gear.style.borderColor = active ? 'var(--teal)' : 'var(--border)';
    gear.style.color = active ? 'var(--teal)' : 'var(--t2)';
    gear.style.background = active ? 'var(--tl)' : 'var(--white)';
  }
  window.updateFixedDateDisplay();
};
window.updateFixedDateDisplay = function () {
  const lbl = document.getElementById('fixedDateDisplay');
  if (lbl) lbl.textContent = window.defaultDate ? window.fmtDate(window.defaultDate) : '—';
};
window.onDefaultDatePick = function (v) {
  if (!v) return;
  const [y, m, d] = v.split('-').map(Number);
  const nd = new Date();
  nd.setFullYear(y, m - 1, d);
  window.defaultDate = nd;
  window.callDT = null;
  window.touchDT();
  window.updateDefaultDateUI();
  window.updateFixedDateDisplay();
};
window.resetDefaultDate = function () {
  window.defaultDate = null;
  window.callDT = null;
  window.updateDefaultDateUI();
  window.updateFixedDateDisplay();
  window.updateSeqLabel();
  const gear = document.getElementById('dateSettingsBtn');
  if (gear) {
    gear.style.borderColor = 'var(--border)';
    gear.style.color = 'var(--t2)';
    gear.style.background = 'var(--white)';
  }
};
window.updateDefaultDateUI = function () {
  const db = document.getElementById('dateBtnText');
  if (window.defaultDate) {
    if (db) db.textContent = window.callDT ? window.fmtDate(window.callDT) : window.fmtDate(window.defaultDate);
  } else {
    if (db && !window.callDT) db.textContent = 'التاريخ';
  }
  window.updateSeqLabel();
};
window.updateSeqLabel = function () {
  const lbl = document.getElementById('seqLabel');
  if (lbl) lbl.textContent = 'تسلسل ' + (window.editSeq !== null ? window.editSeq : window.buildSeq(window.callDT || new Date()));
};
window.updateDTBtns = function () {
  if (!window.callDT) return;
  const dbtn = document.getElementById('dateBtnText');
  const tb = document.getElementById('timeBtnText');
  if (dbtn) dbtn.textContent = window.fmtDate(window.callDT);
  if (tb) tb.textContent = window.fmtTime(window.callDT);
  const dp = document.getElementById('datePicker');
  const tp = document.getElementById('timePicker');
  if (dp) dp.value = window.callDT.toLocaleDateString('en-CA');
  if (tp) {
    const hh = String(window.callDT.getHours()).padStart(2, '0');
    const mm = String(window.callDT.getMinutes()).padStart(2, '0');
    tp.value = hh + ':' + mm;
  }
};
window.touchDT = function () {
  if (!window.callDT && !window.editSeq) {
    if (window.defaultDate) {
      const now = new Date();
      window.callDT = new Date(window.defaultDate);
      window.callDT.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), 0);
    } else {
      window.callDT = new Date();
    }
    window.updateDTBtns();
    window.updateSeqLabel();
  }
};
window.onDatePick = function (v) {
  if (!v) return;
  if (!window.callDT) window.callDT = new Date();
  const [y, m, d] = v.split('-').map(Number);
  window.callDT.setFullYear(y, m - 1, d);
  window.updateDTBtns();
  window.updateSeqLabel();
};
window.onTimePick = function (v) {
  if (!v) return;
  if (!window.callDT) window.callDT = new Date();
  const [h, m] = v.split(':').map(Number);
  window.callDT.setHours(h, m, 0, 0);
  window.updateDTBtns();
};

// ===== TAGS STEPS =====
window.getStepItems = function (step) {
  if (step.items) return step.items;
  if (step.itemsKey) return window.S[step.itemsKey] || [];
  if (step.id === 'topic') {
    if (window.sel.ctype) {
      if (!window.S.topicMap[window.sel.ctype] || window.S.topicMap[window.sel.ctype].length === 0) {
        window.S.topicMap[window.sel.ctype] = [...(S_DEFAULT.topicMap[window.sel.ctype] || [])];
      }
      return window.S.topicMap[window.sel.ctype] || [];
    }
    return [];
  }
  return [];
};

// FIX: getSelValue — correctly reads sel.topics (array) for topic group
window.getSelValue = function (group) {
  if (group === 'topic') return window.sel.topics; // array
  return window.sel[group] || '';
};

window.renderTagsStep = function () {
  const container = document.getElementById('tagsStepContainer');
  const nav = document.getElementById('tagsStepNav');
  const stepIndicator = document.getElementById('tagsStepIndicator');
  const prevBtn = document.getElementById('tagsPrevBtn');
  const skipBtn = document.getElementById('tagsSkipBtn');
  if (!container) return;

  if (window.isEditMode) {
    container.innerHTML = window.buildAllTagsHTML();
    if (nav) nav.style.display = 'flex';
    if (prevBtn) prevBtn.style.display = 'none';
    if (skipBtn) { skipBtn.textContent = 'إغلاق ×'; skipBtn.style.display = 'inline-block'; }
    if (stepIndicator) stepIndicator.textContent = 'وضع التعديل — جميع الأوسمة';
    window.updateCond();
    window.updateDimRows();
    return;
  }

  if (window.tagsStepIndex >= TAGS_STEPS.length) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--green);font-weight:800;font-size:15px;">✓ تم تحديد جميع الأوسمة</div>';
    if (nav) nav.style.display = 'flex';
    if (prevBtn) prevBtn.style.display = 'inline-block';
    if (skipBtn) skipBtn.style.display = 'none';
    if (stepIndicator) stepIndicator.textContent = 'اكتمل';
    window.updateCond();
    window.updateDimRows();
    return;
  }

  const step = TAGS_STEPS[window.tagsStepIndex];
  const items = window.getStepItems(step);
  // FIX: read current value correctly for topic (array) vs others (string)
  const currentVal = window.getSelValue(step.group);
  const isMulti = step.id === 'topic';

  let html = `<div class="tag-step-container">`;
  html += `<div class="tag-step-label" style="color:${step.color};border-right:3px solid ${step.color};padding-right:12px;">${step.label}</div>`;
  html += `<div class="tag-step-buttons">`;

  if (items.length === 0 && step.id === 'topic') {
    html += '<span style="font-size:13px;color:var(--tl2);padding:10px 14px;display:block;">اختر نوع المكالمة أولاً</span>';
  } else {
    items.forEach(item => {
      const isSel = isMulti ? currentVal.includes(item) : currentVal === item;
      const lbl = window.S.labels[item] || (step.id === 'child' ? (CHILD_LABELS_DEF[item] || item) : item);
      html += `<button class="ob ${step.cssClass}${isSel ? ' sel' : ''}" data-group="${step.group}" data-val="${item}" onclick="selectOptStep(this,'${step.group}','${step.id}')">${lbl}</button>`;
    });
  }
  html += `</div></div>`;
  container.innerHTML = html;

  if (nav) nav.style.display = 'flex';
  if (prevBtn) prevBtn.style.display = window.tagsStepIndex > 0 ? 'inline-block' : 'none';
  if (skipBtn) {
    skipBtn.style.display = 'inline-block';
    skipBtn.textContent = window.tagsStepIndex >= TAGS_STEPS.length - 1 ? 'إنهاء ' : 'التالي ';
  }
  if (stepIndicator) stepIndicator.textContent = `الخطوة ${window.tagsStepIndex + 1} من ${TAGS_STEPS.length}`;

  window.updateCond();
  window.updateDimRows();
};

// FIX: selectOptStep properly uses sel.topics (array) for topic group
window.selectOptStep = function (btn, grp, stepId) {
  if (grp === 'topic') {
    const v = btn.dataset.val;
    const idx = window.sel.topics.indexOf(v);
    if (idx >= 0) { window.sel.topics.splice(idx, 1); btn.classList.remove('sel'); }
    else { window.sel.topics.push(v); btn.classList.add('sel'); }
    window.touchDT();
    return;
  }

  const alreadySelected = btn.classList.contains('sel');
  document.querySelectorAll(`[data-group="${grp}"]`).forEach(b => b.classList.remove('sel'));

  if (alreadySelected) {
    window.sel[grp] = '';
  } else {
    btn.classList.add('sel');
    window.sel[grp] = btn.dataset.val;
  }

  if (grp === 'ctype') {
    window.sel.topics = [];
    window.updateCond();
    if (!window.S.topicMap[window.sel.ctype] || window.S.topicMap[window.sel.ctype].length === 0) {
      window.S.topicMap[window.sel.ctype] = [...(S_DEFAULT.topicMap[window.sel.ctype] || [])];
    }
  }

  window.touchDT();
  window.updateTagsBtnIndicator();

  // Auto-advance after selection (except for deselection)
  if (!alreadySelected && window.sel[grp] !== '') {
    if (grp === 'ctype') {
      // Immediately advance to show topic step for selected call type
      window.tagsStepNext();
    } else {
      setTimeout(() => window.tagsStepNext(), 280);
    }
  }
};

window.tagsStepNext = function () {
  if (window.isEditMode) return;
  if (window.tagsStepIndex < TAGS_STEPS.length) {
    window.tagsStepIndex++;
    window.renderTagsStep();
  }
};
window.tagsStepPrev = function () {
  if (window.isEditMode) return;
  if (window.tagsStepIndex > 0) {
    window.tagsStepIndex--;
    window.renderTagsStep();
  }
};
window.resetTagsSteps = function () {
  window.tagsStepIndex = 0;
  window.isEditMode = false;
  window.renderTagsStep();
};

// ===== BUILD ALL TAGS HTML (edit mode) =====
window.buildAllTagsHTML = function () {
  const makeRow = (color, label, cssClass, items, grp, getIsSelected, getLabel, onclick) => {
    let html = `<div class="tline-label" style="color:${color};border-right:3px solid ${color};">${label}</div>`;
    html += `<div class="tline ${cssClass}">`;
    if (items.length) {
      items.forEach(item => {
        const isSel = getIsSelected(item);
        const lbl = getLabel(item);
        html += `<button class="ob${isSel ? ' sel' : ''}" data-group="${grp}" data-val="${item}" onclick="${onclick}(this,'${grp}')">${lbl}</button>`;
      });
    } else {
      html += '<span style="font-size:12px;color:var(--tl2);padding:10px 14px;">اختر نوع المكالمة أولاً</span>';
    }
    html += '</div>';
    return html;
  };

  let html = '<div class="trow">';
  html += makeRow('#4338ca', '🏢 الفرع', 'tl-wide-blue', window.S.branches, 'branch',
    item => window.sel.branch === item, item => window.S.labels[item] || item, 'selectOptAll');
  html += makeRow('#1e293b', '📞 نوع المكالمة', 'tl-contrast-dark', ['استفسار', 'طلب', 'شكوى'], 'ctype',
    item => window.sel.ctype === item, item => item, 'selectOptAll');

  const topics = window.sel.ctype && window.S.topicMap[window.sel.ctype] ? window.S.topicMap[window.sel.ctype] : [];
  html += makeRow('#dc2626', '📋 الموضوع', 'tl-outline-red', topics, 'topic',
    item => window.sel.topics.includes(item), item => item, 'selectOptAll');
  html += makeRow('#7c3aed', '👶 عدد الأطفال', 'tl-pill-blue', CHILD_OPTS, 'child',
    item => window.sel.child === item, item => window.S.labels[item] || CHILD_LABELS_DEF[item] || item, 'selectOptAll');
  html += makeRow('#0f766e', '📍 موقع العميل', 'tl-teal-text', window.S.locs, 'loc',
    item => window.sel.loc === item, item => window.S.labels[item] || item, 'selectOptAll');
  html += makeRow('#1d4ed8', '🌍 الجنسية (اللكنة)', 'tl-solid-blue', window.S.nat, 'nat',
    item => window.sel.nat === item, item => window.S.labels[item] || item, 'selectOptAll');
  html += makeRow('#3730a3', '🎭 نبرة العميل', 'tl-bold-indigo', window.S.emos, 'emo',
    item => window.sel.emo === item, item => window.S.labels[item] || item, 'selectOptAll');
  html += makeRow('#b45309', '📡 مصدر التواصل', 'tl-wide-outline', window.S.srcs, 'src',
    item => window.sel.src === item, item => window.S.labels[item] || item, 'selectOptAll');
  html += makeRow('#047857', '👤 الجنس', 'tl-solid-teal', ['ذكر', 'أنثى'], 'gender',
    item => window.sel.gender === item, item => item, 'selectOptAll');
  html += '</div>';
  return html;
};

// FIX: selectOptAll properly handles topic (array) vs others (string)
window.selectOptAll = function (btn, grp) {
  if (grp === 'topic') {
    const v = btn.dataset.val;
    const idx = window.sel.topics.indexOf(v);
    if (idx >= 0) { window.sel.topics.splice(idx, 1); btn.classList.remove('sel'); }
    else { window.sel.topics.push(v); btn.classList.add('sel'); }
    window.touchDT();
    return;
  }
  const alreadySelected = btn.classList.contains('sel');
  document.querySelectorAll(`[data-group="${grp}"]`).forEach(b => b.classList.remove('sel'));
  if (alreadySelected) {
    window.sel[grp] = '';
  } else {
    btn.classList.add('sel');
    window.sel[grp] = btn.dataset.val;
  }
  if (grp === 'ctype') {
    window.sel.topics = [];
    window.updateCond();
    if (!window.S.topicMap[window.sel.ctype] || window.S.topicMap[window.sel.ctype].length === 0) {
      window.S.topicMap[window.sel.ctype] = [...(S_DEFAULT.topicMap[window.sel.ctype] || [])];
    }
    // Refresh topic row in edit mode
    if (window.isEditMode) {
      const container = document.getElementById('tagsStepContainer');
      if (container) container.innerHTML = window.buildAllTagsHTML();
    }
  }
  window.touchDT();
  window.updateTagsBtnIndicator();
};

// ===== TAGS PANEL TOGGLE =====
window.toggleTagsPanel = function () {
  window.tagsPanelOpen = !window.tagsPanelOpen;
  const panel = document.getElementById('tagsPanel');
  const btn = document.getElementById('tagsToggleBtn');
  if (panel) panel.style.display = window.tagsPanelOpen ? 'block' : 'none';
  if (btn) {
    btn.style.borderColor = window.tagsPanelOpen ? 'var(--accent)' : 'var(--border)';
    btn.style.color = window.tagsPanelOpen ? 'var(--accent)' : 'var(--t2)';
    btn.style.background = window.tagsPanelOpen ? 'var(--al)' : 'var(--white)';
  }
  if (window.tagsPanelOpen) {
    if (window.isEditMode) window.renderTagsStep();
    else window.resetTagsSteps();
  }
  window.updateTagsBtnIndicator();
};

window.updateTagsBtnIndicator = function () {
  const btn = document.getElementById('tagsToggleBtn');
  if (!btn) return;
  const hasAny = window.sel.topics.length > 0 ||
    ['gender', 'nat', 'branch', 'loc', 'src', 'ctype', 'child', 'emo'].some(k => window.sel[k] !== '');
  btn.style.borderColor = window.tagsPanelOpen ? 'var(--accent)' : (hasAny ? 'var(--green)' : 'var(--border)');
  btn.style.color = window.tagsPanelOpen ? 'var(--accent)' : (hasAny ? 'var(--green)' : 'var(--t2)');
};

// ===== PHONE INPUT =====
window.onPhoneInput = function (v) {
  window.touchDT();
  if (window.isSaudiPhone(v) && !window.editSeq) {
    const prev = window.calls.filter(c => c.phone === v);
    if (prev.length) {
      const lat = prev[0];
      if (!window.sel.nat) window.sel.nat = lat.nat;
      if (!window.sel.gender) window.sel.gender = lat.gender;
      const notice = document.getElementById('custNotice');
      if (notice) {
        notice.style.display = 'flex';
        const isFemale = lat.gender === 'أنثى';
        const verbMap = {
          'استفسار': isFemale ? 'تستفسر عن' : 'يستفسر عن',
          'شكوى': isFemale ? 'تشتكي' : 'يشتكي',
          'طلب': isFemale ? 'تطلب' : 'يطلب'
        };
        const verb = verbMap[lat.ctype] || (lat.ctype || '');
        const topicStr = lat.topic ? ` ${lat.topic}` : '';
        notice.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></div>
          <span style="flex:1;line-height:1.5;font-size:13px;">${prev.length} مكالمات سابقة، آخر مكالمة في ${window.fmtDT(lat.dt)} <span style="color:var(--accent);font-weight:700;">${verb}${topicStr}</span></span>
          <button type="button" onclick="viewCustomerHistory('${v}')" style="background:var(--white);border:1.5px solid var(--accent);border-radius:8px;padding:4px 10px;font-family:'Cairo',sans-serif;font-size:11px;font-weight:700;color:var(--accent);cursor:pointer;white-space:nowrap;">سجل العميل</button>`;
      }
      return;
    }
  }
  const notice = document.getElementById('custNotice');
  if (notice) notice.style.display = 'none';
};

window.viewCustomerHistory = function (phone) {
  const logTabBtn = document.querySelector('[data-tab="log"]');
  if (logTabBtn) window.switchTab('log', logTabBtn);
  if (!window.groupMode) window.toggleGroupMode();
  const searchInput = document.getElementById('logSearch');
  if (searchInput) { searchInput.value = phone; window.renderFilteredLog(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ===== FORM STEPS =====
window.goNextStep = function () {
  const phone = document.getElementById('phone').value.trim();
  if (window.formStep === 1) {
    if (window.editSeq === null && !window.isSaudiPhone(phone)) return window.toast('أدخل رقم جوال سعودي صحيح (05XXXXXXXX)', 'err');
    if (window.editSeq !== null && phone === '') return window.toast('الرجاء إدخال رقم الجوال', 'err');
    window.formStep = 2;
    const detailsSec = document.getElementById('step-details-section');
    if (detailsSec) detailsSec.style.display = 'block';
    const detailsEl = document.getElementById('details');
    if (detailsEl) detailsEl.focus();
    const btn = document.getElementById('nextStepBtn');
    if (btn) btn.innerHTML = 'التالي <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    return;
  }
  if (window.formStep === 2) {
    window.formStep = 3;
    const tagsPanel = document.getElementById('tagsPanel');
    if (tagsPanel) { tagsPanel.style.display = 'block'; window.tagsPanelOpen = true; }
    window.updateTagsBtnIndicator();
    if (!window.isEditMode) window.resetTagsSteps();
    else window.renderTagsStep();
    const btn = document.getElementById('nextStepBtn');
    if (btn) {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> حفظ';
      btn.onclick = window.submitCall;
    }
    if (tagsPanel) tagsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
};

window.resetFormSteps = function () {
  window.formStep = 1;
  const sec = document.getElementById('step-details-section');
  if (sec) sec.style.display = 'none';
  const btn = document.getElementById('nextStepBtn');
  if (btn) {
    btn.innerHTML = 'التالي <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
    btn.onclick = window.goNextStep;
  }
  const wrap = document.getElementById('nextBtnWrap');
  if (wrap) wrap.style.display = 'flex';
};

// ===== SUBMIT & DELETE =====
window.submitCall = async function () {
  const phone = document.getElementById('phone').value.trim();
  if (window.editSeq === null && !window.isSaudiPhone(phone)) return window.toast('أدخل رقم جوال سعودي صحيح (05XXXXXXXX)', 'err');
  if (window.editSeq !== null && phone === '') return window.toast('الرجاء إدخال رقم الجوال', 'err');
  if (!window.sel.ctype) return window.toast('الرجاء اختيار نوع المكالمة', 'err');
  if (window.sel.topics.length === 0) return window.toast('الرجاء اختيار موضوع المكالمة', 'err');
  if (!window.callDT) window.callDT = new Date();

  const rec = {
    seq: window.editSeq !== null ? window.editSeq : window.nextSeq(window.callDT),
    dt: window.callDT,
    phone,
    gender: window.sel.gender,
    nat: window.sel.nat,
    branch: window.sel.branch,
    loc: window.sel.loc,
    src: window.sel.src,
    topic: window.sel.topics.join('، '),
    ctype: window.sel.ctype,
    compNo: window.sel.ctype === 'شكوى' ? (document.getElementById('compNo').value.trim() || '') : '',
    reqNo: window.sel.ctype === 'طلب' ? (document.getElementById('reqNo').value.trim() || '') : '',
    child: window.sel.child,
    emo: window.sel.emo,
    notes: document.getElementById('details').value.trim() || ''
  };

  try {
    await window.persistCall(rec);

    if (window.editSeq !== null) {
      const idx = window.calls.findIndex(c => c.seq === window.editSeq);
      if (idx !== -1) window.calls[idx] = rec;
      const savedSeq = window.editSeq;
      window.editSeq = null;
      window.isEditMode = false;
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
      window.renderLog();
      window.updateBadge();
      window.clearForm();
      window.toast('تم تحديث المكالمة', 'ok');
      const logBtn = document.querySelector('[data-tab="log"]');
      window.switchTab('log', logBtn);
      requestAnimationFrame(() => {
        const card = document.getElementById('dtl-' + savedSeq);
        if (card) {
          if (!card.classList.contains('open')) window.togCard(savedSeq);
          const el = card.closest('.cc');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      window.showPostSaveModal(rec);
    } else {
      window.calls.unshift(rec);
      window.renderLog();
      window.updateBadge();
      window.clearForm();
      if (window.tagsPanelOpen) window.toggleTagsPanel();
      window.toast('تم حفظ المكالمة', 'ok');
      window.showPostSaveModal(rec);
    }
  } catch (err) {
    window.toast('حدث خطأ أثناء حفظ المكالمة', 'err');
    console.error(err);
  }
};

window.deleteCall = async function (seq) {
  if (!confirm('هل أنت متأكد من حذف هذه المكالمة تماماً؟')) return;
  try {
    await window.persistDelete(seq);
    await window.deleteChildNames(seq);
    window.calls = window.calls.filter(c => c.seq !== seq);
    window.renderFilteredLog();
    window.updateBadge();
    if (document.getElementById('tab-analytics').classList.contains('active')) window.updateAnalytics();
    window.toast('تم الحذف بنجاح', 'ok');
  } catch (err) {
    console.error(err);
    window.toast('حدث خطأ أثناء الحذف', 'err');
  }
};

window.clearForm = function () {
  ['phone', 'compNo', 'reqNo', 'details'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const notice = document.getElementById('custNotice');
  if (notice) notice.style.display = 'none';
  const condComp = document.getElementById('condComp');
  if (condComp) condComp.style.display = 'none';
  const condReq = document.getElementById('condReq');
  if (condReq) condReq.style.display = 'none';

  window.sel = { gender: '', nat: '', branch: '', loc: '', src: '', topics: [], ctype: '', child: '', emo: '' };
  window.callDT = null;
  window.editSeq = null;
  window.isEditMode = false;

  if (window.defaultDate) {
    window.touchDT();
  } else {
    window.updateSeqLabel();
    window.updateDTBtns();
    const db = document.getElementById('dateBtnText');
    if (db) db.textContent = 'التاريخ';
    const tb = document.getElementById('timeBtnText');
    if (tb) tb.textContent = 'الوقت';
  }

  window.updateTagsBtnIndicator();
  window.resetFormSteps();
  window.resetTagsSteps();
  if (window.tagsPanelOpen) window.toggleTagsPanel();

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  const wrap = document.getElementById('nextBtnWrap');
  if (wrap) wrap.style.display = 'flex';
};

window.editCall = function (seq) {
  const c = window.calls.find(x => x.seq === seq);
  if (!c) return;
  window.editSeq = seq;
  window.isEditMode = true;

  const phoneEl = document.getElementById('phone');
  if (phoneEl) phoneEl.value = c.phone;
  const detailsEl = document.getElementById('details');
  if (detailsEl) detailsEl.value = c.notes;
  const compNoEl = document.getElementById('compNo');
  if (compNoEl) compNoEl.value = c.compNo || '';
  const reqNoEl = document.getElementById('reqNo');
  if (reqNoEl) reqNoEl.value = c.reqNo || '';

  window.callDT = new Date(c.dt);
  window.updateSeqLabel();
  window.updateDTBtns();

  window.sel.gender = c.gender || '';
  window.sel.nat = c.nat || '';
  window.sel.branch = c.branch || '';
  window.sel.loc = c.loc || '';
  window.sel.src = c.src || '';
  window.sel.topics = c.topic ? c.topic.split('، ').filter(Boolean) : [];
  window.sel.ctype = c.ctype || '';
  window.sel.child = c.child || '';
  window.sel.emo = c.emo || '';

  window.updateCond();
  window.tagsStepIndex = TAGS_STEPS.length; // show all in edit mode

  const submitBtn = document.getElementById('submitBtn');
  if (submitBtn) submitBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  const notice = document.getElementById('custNotice');
  if (notice) notice.style.display = 'none';
  window.formStep = 3;

  const detailsSec = document.getElementById('step-details-section');
  if (detailsSec) detailsSec.style.display = 'block';
  const wrap = document.getElementById('nextBtnWrap');
  if (wrap) wrap.style.display = 'none';

  if (!window.tagsPanelOpen) window.toggleTagsPanel();
  else window.renderTagsStep();

  const formBtn = document.querySelector('[data-tab="form"]');
  window.switchTab('form', formBtn);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.persistCall = async function (rec) {
  await window.saveCallDB(rec).catch(e => console.warn('IndexedDB save error:', e));
  await FB.save(rec);
};
window.persistDelete = async function (seq) {
  await window.deleteCallDB(seq);
  await FB.remove(seq);
};

// ===== CONDITION FIELDS =====
window.updateCond = function () {
  const condComp = document.getElementById('condComp');
  const condReq = document.getElementById('condReq');
  if (condComp) condComp.style.display = window.sel.ctype === 'شكوى' ? 'block' : 'none';
  if (condReq) condReq.style.display = window.sel.ctype === 'طلب' ? 'block' : 'none';
  window.updateDimRows();
};

window.updateDimRows = function () {
  const isComp = window.sel.ctype === 'شكوى';
  ['tl-child', 'tl-loc', 'tl-src', 'tl-loc-label', 'tl-src-label'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    isComp ? el.classList.add('dim') : el.classList.remove('dim');
  });
};

// ===== POST SAVE MODAL =====
window.psCallRecord = null;
window.showPostSaveModalBySeq = function (seq) {
  const c = window.calls.find(x => x.seq === seq);
  if (c) window.showPostSaveModal(c);
};
window.showPostSaveModal = async function (rec) {
  window.psCallRecord = rec;
  const psType = document.getElementById('ps-type');
  if (psType) psType.textContent = rec.ctype;
  const psSumm = document.getElementById('ps-summary');
  if (psSumm) psSumm.textContent = window.genSummary(rec);
  const savedNames = await window.getChildNames(rec.seq);
  const container = document.getElementById('ps-children-container');
  if (container) {
    container.innerHTML = savedNames.length > 0
      ? savedNames.map((name, i) => `<input type="text" class="fi child-name-input" placeholder="اسم الطفل ${i + 1}" value="${name}" />`).join('')
      : '<input type="text" class="fi child-name-input" placeholder="اسم الطفل 1" />';
  }
  const modal = document.getElementById('post-save-modal');
  if (modal) modal.style.display = 'flex';
};

window.addPSChildInput = function () {
  const container = document.getElementById('ps-children-container');
  if (!container) return;
  const inputs = container.querySelectorAll('input');
  if (inputs.length >= 10) { window.toast('الحد الأقصى 10 أطفال', 'err'); return; }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fi child-name-input';
  input.placeholder = 'اسم الطفل ' + (inputs.length + 1);
  container.appendChild(input);
};

window.getPSChildNamesList = function () {
  return Array.from(document.querySelectorAll('.child-name-input')).map(inp => inp.value.trim()).filter(n => n !== '');
};
window.savePSChildNamesIfAny = async function () {
  if (!window.psCallRecord) return;
  const names = window.getPSChildNamesList();
  if (names.length > 0) {
    await window.saveChildNames(window.psCallRecord.seq, names);
    window.renderFilteredLog();
  }
};
window.psNotifyAdmin = async function () { await window.savePSChildNamesIfAny(); if (window.psCallRecord) window.notifyAdmin(window.psCallRecord.seq); };
window.psNotifyBranch = async function () { await window.savePSChildNamesIfAny(); if (window.psCallRecord) window.notifyBranch(window.psCallRecord.seq); };
window.psSendFollowUp = async function () { await window.savePSChildNamesIfAny(); if (window.psCallRecord) window.sendFollowUp(window.psCallRecord.seq); };
window.psRedirect1 = async function () { await window.savePSChildNamesIfAny(); window.toast('تم التوجيه', 'ok'); };
window.psRedirect2 = async function () { await window.savePSChildNamesIfAny(); window.toast('تم التوجيه مع الجوال', 'ok'); };

// ===== LOG =====
window.renderLog = function (subset) {
  const wrap = document.getElementById('logWrap');
  if (!wrap) return;
  const _calls = subset || window.calls;
  const logCount = document.getElementById('logCount');
  if (logCount) logCount.textContent = _calls.length;

  if (!_calls.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px;">
      <div style="width:50px;height:50px;background:#e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </div>
      <p style="color:var(--t2);font-weight:600;">لا توجد مكالمات مسجّلة بعد</p>
    </div>`;
    return;
  }

  const sortVal = (document.getElementById('logSort') || {}).value || 'newest';
  const sorted = [..._calls].sort((a, b) => {
    if (sortVal === 'oldest') return a.dt - b.dt;
    if (sortVal === 'branch') return (a.branch || '').localeCompare(b.branch || '') || b.dt - a.dt;
    if (sortVal === 'ctype') return (a.ctype || '').localeCompare(b.ctype || '') || b.dt - a.dt;
    if (sortVal === 'src') return (a.src || '').localeCompare(b.src || '') || b.dt - a.dt;
    return b.dt - a.dt;
  });

  let html = '';
  if (window.groupMode) {
    const phMap = {}, phOrd = [];
    sorted.forEach(c => {
      if (!phMap[c.phone]) { phMap[c.phone] = []; phOrd.push(c.phone); }
      phMap[c.phone].push(c);
    });
    phOrd.forEach(ph => {
      const pcs = phMap[ph];
      const latestDay = window.fmtDate(new Date(Math.max(...pcs.map(x => x.dt))));
      if (pcs.length === 1) {
        html += window.callCard(pcs[0], false);
      } else {
        html += `<div class="cust-block"><div class="cust-hdr"><span class="cust-ph">${ph}</span> · ${pcs.length} مكالمات · آخرها ${latestDay}</div>`;
        pcs.forEach(c => { html += window.callCard(c, true); });
        html += '</div>';
      }
    });
  } else {
    let currentDay = '';
    sorted.forEach(c => {
      const dayStr = window.fmtDate(c.dt);
      if (currentDay !== dayStr) {
        currentDay = dayStr;
        html += `<div style="font-family:'Tajawal',sans-serif;font-size:16px;font-weight:800;color:var(--accent);margin:24px 0 12px 0;border-bottom:2px solid var(--border);padding-bottom:8px;">(${dayStr})</div>`;
      }
      html += window.callCard(c, false);
    });
  }
  wrap.innerHTML = html;
};

window.cardSummary = function (c) {
  const f = c.gender === 'أنثى';
  const verb = { 'شكوى': f ? 'تشتكي' : 'يشتكي', 'استفسار': f ? 'تستفسر عن' : 'يستفسر عن', 'طلب': f ? 'تطلب' : 'يطلب' }[c.ctype] || c.ctype;
  const topics = c.topic ? c.topic.split('، ').filter(Boolean) : [];
  let topicPart = topics.length === 1 ? topics[0] : topics.length > 1 ? topics.slice(0, -1).join(' و') + ' و' + topics[topics.length - 1] : '';
  let s = verb;
  if (topicPart) s += ' ' + topicPart;
  if (c.branch) s += ` في فرع ${c.branch}`;
  return s;
};

window.buildChildDisplay = function (c) {
  const f = c.gender === 'أنثى';
  const parentLabel = f ? 'أم' : 'أب';
  if (!c.child) return '';
  return `${parentLabel} ${c.child}`;
};

window.callCard = function (c, nested) {
  const sa = nested ? '' : ' standalone';
  const childDisplay = window.buildChildDisplay(c);
  const fields = [
    { l: 'تاريخ المكالمة', v: `(${window.fmtDate(c.dt)})` },
    { l: 'جوال العميل', v: c.phone },
    { l: 'الجنس', v: c.gender || '—' },
    { l: 'اللكنة', v: c.nat || '—' },
    { l: 'الفرع', v: c.branch || '—' },
    { l: 'الموقع', v: c.loc || '—' },
    { l: 'عدد الأطفال', v: childDisplay || c.child || '—' },
    { l: 'نبرة العميل', v: c.emo || '—' },
    { l: 'المصدر', v: c.src || '—' },
    { l: 'الموضوع', v: c.topic || '—' },
    ...(c.compNo ? [{ l: 'رقم الشكوى', v: c.compNo }] : []),
    ...(c.reqNo ? [{ l: 'رقم الطلب', v: c.reqNo }] : [])
  ];
  const seqCls = c.ctype === 'شكوى' ? 'ct-complaint' : c.ctype === 'طلب' ? 'ct-request' : 'ct-inquiry';
  const waSVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

  return `<div class="cc${sa}">
    <div class="cc-top" onclick="togCard('${c.seq}')">
      <span class="cc-seq ${seqCls}">${c.seq}</span>
      <span class="cc-time" style="flex-shrink:0">${window.fmtTime(c.dt)}</span>
      <span class="cc-summary">${window.cardSummary(c)}</span>
      <span class="cc-tog" id="tog-${c.seq}" style="font-size:18px;font-weight:300;">＋</span>
    </div>
    <div class="cc-act-row" id="act-${c.seq}" style="display:none;padding:8px 18px;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border);background:#f8fafc;">
<button onclick="event.stopPropagation();showPostSaveModalBySeq('${c.seq}')" class="btn-wa" style="background:#128C7E;">${waSVG} واتساب</button>
<button id="summBtn-${c.seq}" onclick="event.stopPropagation();toggleSummDetail('${c.seq}')" style="color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;background:var(--white);cursor:pointer;margin-bottom:4px;">ملخص</button>
      <button onclick="event.stopPropagation();editCall('${c.seq}')" style="color:var(--t2);border:1px solid var(--border);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;background:var(--white);cursor:pointer;margin-bottom:4px;">تعديل</button>
      <button onclick="event.stopPropagation();deleteCall('${c.seq}')" style="color:var(--red);border:1px solid var(--rl);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;background:var(--white);cursor:pointer;margin-bottom:4px;margin-right:auto;">حذف</button>
      <button id="copy-${c.seq}" onclick="event.stopPropagation();copySumm('${c.seq}')" style="display:none;color:var(--purple);border:1px solid var(--pl);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;background:var(--white);cursor:pointer;margin-bottom:4px;">نسخ</button>
    </div>
    <div class="cc-dtl" id="dtl-${c.seq}">
      <div class="summ-box" id="summ-${c.seq}"></div>
      <div id="grid-${c.seq}" style="display:none;">
        <div class="dgrid">${fields.map(f => `<div class="di"><div class="dl">${f.l}</div><div class="dv">${f.v}</div></div>`).join('')}</div>
        ${c.notes ? `<div class="dnotes">${c.notes}</div>` : ''}
      </div>
    </div>
  </div>`;
};

// ===== SUMMARY =====
window.genSummary = function (c) {
  const f = c.gender === 'أنثى';
  const g = (m, fm) => f ? fm : m;
  const parts = [];
  const childLabel = { 'طفل': 'طفل واحد', 'طفلين': 'طفلين', 'ثلاثة': 'ثلاثة أطفال', 'أربعة': 'أربعة أطفال', 'خمسة': 'خمسة أطفال', 'أكثر': 'أكثر من خمسة أطفال' };
  let childPart = c.child && childLabel[c.child] ? `${g('أب', 'أم')} لـ${childLabel[c.child]}` : g('أب', 'أم');
  parts.push(childPart);
  if (c.nat) {
    const natF = c.nat.endsWith('ي') ? c.nat + 'ة' : c.nat;
    parts.push(`يظهر ${g('أنه', 'أنها')} ${g(c.nat, natF)}`);
  }
  const verb = { 'شكوى': g('يشتكي', 'تشتكي'), 'استفسار': g('يستفسر عن', 'تستفسر عن'), 'طلب': g('يطلب', 'تطلب') }[c.ctype] || c.ctype;
  let callPart = `${g('اتصل', 'اتصلت')} ${verb}`;
  if (c.topic) callPart += ` ${c.topic}`;
  if (c.branch) callPart += ` في ${c.branch}`;
  parts.push(callPart);
  if (c.compNo) parts.push(`رقم الشكوى: ${c.compNo}`);
  if (c.reqNo) parts.push(`رقم الطلب: ${c.reqNo}`);
  if (c.notes) parts.push(`في المكالمة: ${c.notes}`);
  parts.push(`رقم ${g('العميل', 'العميلة')} ${c.phone}`);
  return parts.join('، ');
};

window.copySumm = function (seq) {
  const box = document.getElementById('summ-' + seq);
  if (!box || !box.textContent) return;
  navigator.clipboard.writeText(box.textContent)
    .then(() => window.toast('تم نسخ النص', 'ok'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = box.textContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      window.toast('تم نسخ النص', 'ok');
    });
};

window.waLink = function (phone, msg) {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '966' + p.slice(1);
  window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.followUpText = function (c) {
  const f = c.gender === 'أنثى';
  const clientLabel = f ? 'أم' : 'أب';
  const verb = { 'شكوى': f ? 'تشتكي' : 'يشتكي', 'استفسار': f ? 'تستفسر عن' : 'يستفسر عن', 'طلب': f ? 'تطلب' : 'يطلب' }[c.ctype] || c.ctype;
  return `*جزء خاص بالادارة يوضح تفاصيل الحالة ، قم بحذفها*\n${clientLabel} ${verb} ${c.topic || c.ctype} في فرع ${c.branch || 'غير محدد'}، ${c.notes || 'لا يوجد'}`;
};

window.sendFollowUp = function (seq) {
  const c = window.calls.find(x => x.seq === seq);
  if (!c) return;
  window.waLink(c.phone, window.followUpText(c));
};
window.notifyBranch = function (seq) {
  const c = window.calls.find(x => x.seq === seq);
  if (!c) return;
  const phone = window.S.branchPhones[c.branch] || '';
  if (!phone) { window.toast('لم يتم إضافة رقم هذا الفرع في الصيانة', 'err'); return; }
  window.waLink(phone, window.genSummary(c));
};
window.notifyAdmin = function (seq) {
  const c = window.calls.find(x => x.seq === seq);
  if (!c) return;
  if (!window.S.adminPhone) { window.toast('لم يتم إضافة رقم الإدارة في الصيانة', 'err'); return; }
  let custPhone = c.phone.replace(/[^0-9]/g, '');
  if (custPhone.startsWith('0')) custPhone = '966' + custPhone.slice(1);
  const custWaLink = `https://wa.me/${custPhone}?text=${encodeURIComponent(window.followUpText(c))}`;
  window.waLink(window.S.adminPhone, window.genSummary(c) + '\n\n---\n' + custWaLink);
};

window.togCard = function (seq) {
  const d = document.getElementById('dtl-' + seq);
  const a = document.getElementById('act-' + seq);
  const t = document.getElementById('tog-' + seq);
  if (!d) return;
  const open = d.classList.toggle('open');
  if (a) a.style.display = open ? 'flex' : 'none';
  if (t) t.textContent = open ? '－' : '＋';
  if (open) window.showSummaryMode(seq);
};

window.showSummaryMode = function (seq) {
  const box = document.getElementById('summ-' + seq);
  const grid = document.getElementById('grid-' + seq);
  const btn = document.getElementById('summBtn-' + seq);
  const c = window.calls.find(x => x.seq === seq);
  if (!c || !box) return;
  box.textContent = window.genSummary(c);
  box.classList.add('open');
  if (grid) grid.style.display = 'none';
  if (btn) btn.textContent = 'تفاصيل';
};

window.toggleSummDetail = function (seq) {
  const box = document.getElementById('summ-' + seq);
  const grid = document.getElementById('grid-' + seq);
  const copy = document.getElementById('copy-' + seq);
  const btn = document.getElementById('summBtn-' + seq);
  const inSummary = box && box.classList.contains('open');
  if (inSummary) {
    if (box) { box.classList.remove('open'); box.textContent = ''; }
    if (grid) grid.style.display = '';
    if (copy) copy.style.display = 'none';
    if (btn) btn.textContent = 'ملخص';
  } else {
    const c = window.calls.find(x => x.seq === seq);
    if (!c) return;
    if (box) { box.textContent = window.genSummary(c); box.classList.add('open'); }
    if (grid) grid.style.display = 'none';
    if (copy) copy.style.display = 'inline-block';
    if (btn) btn.textContent = 'تفاصيل';
  }
};

window.updateBadge = function () {
  const b = document.getElementById('logBadge');
  if (!b) return;
  b.style.display = 'inline-block';
  b.textContent = window.calls.length;
};

// ===== GROUP MODE & TEXT VIEW =====
window.toggleGroupMode = function () {
  window.groupMode = !window.groupMode;
  const icon = document.getElementById('groupModeIcon');
  if (icon) icon.textContent = window.groupMode ? '✓' : '';
  window.renderFilteredLog();
};

window.toggleTextView = function () {
  window.textViewActive = !window.textViewActive;
  const panel = document.getElementById('textViewPanel');
  const icon = document.getElementById('textViewIcon');
  if (panel) panel.style.display = window.textViewActive ? 'block' : 'none';
  if (icon) icon.textContent = window.textViewActive ? '✓' : '';
  if (window.textViewActive) window.buildTextView();
};

window.buildTextView = function () {
  const body = document.getElementById('textViewBody');
  if (!body) return;
  const fc = window.filteredLogCalls();
  if (!fc.length) { body.textContent = 'لا توجد بيانات'; return; }
  const sorted = [...fc].sort((a, b) => b.dt - a.dt);
  body.textContent = sorted.map(c => window.genSummary(c)).join('\n\n---\n\n');
};

window.copyAllText = function () {
  const body = document.getElementById('textViewBody');
  if (!body || !body.textContent) return;
  navigator.clipboard.writeText(body.textContent)
    .then(() => window.toast('تم نسخ الكل', 'ok'))
    .catch(() => window.toast('فشل النسخ', 'err'));
};

// ===== EXPORT / IMPORT =====
window.exportCSV = function () {
  if (!window.calls.length) { window.toast('لا توجد بيانات للتصدير', 'err'); return; }
  const headers = ['التسلسل', 'التاريخ', 'الوقت', 'الجوال', 'الجنس', 'الجنسية', 'الفرع', 'الموقع', 'النوع', 'الموضوع', 'عدد الأطفال', 'النبرة', 'المصدر', 'رقم الشكوى', 'رقم الطلب', 'ملاحظات'];
  const rows = window.calls.map(c => [
    c.seq, window.fmtDate(c.dt), window.fmtTime(c.dt), c.phone, c.gender, c.nat, c.branch, c.loc,
    c.ctype, c.topic, c.child, c.emo, c.src, c.compNo, c.reqNo, c.notes
  ]);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'مكالمات');
  XLSX.writeFile(wb, `calls_${new Date().toLocaleDateString('en-CA')}.xlsx`);
  window.toast('تم التصدير بنجاح', 'ok');
};

window.exportTXT = function () {
  if (!window.calls.length) { window.toast('لا توجد بيانات', 'err'); return; }
  const sorted = [...window.calls].sort((a, b) => b.dt - a.dt);
  const text = sorted.map(c => window.genSummary(c)).join('\n\n---\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report_${new Date().toLocaleDateString('en-CA')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  window.toast('تم تصدير التقرير', 'ok');
};

// FIX: استيراد التاريخ/الوقت الفعليين من الملف بدل وقت الاستيراد دائماً.
// عمود التاريخ المُصدَّر بصيغة "5 يونيو" (بدون سنة) وعمود الوقت بصيغة "HH:MM".
// نفترض سنة الاستيراد الحالية لأن fmtDate لا يحفظ السنة؛ لو تعذّر التفسير نرجع لوقت الاستيراد كحل أخير.
window.parseImportedDateTime = function (dateStr, timeStr) {
  try {
    const dParts = String(dateStr || '').trim().split(/\s+/);
    const day = parseInt(dParts[0], 10);
    const monthIdx = MONTHS.indexOf(dParts[1]);
    if (isNaN(day) || monthIdx === -1) return new Date();

    const tParts = String(timeStr || '').trim().split(':');
    const hh = parseInt(tParts[0], 10);
    const mm = parseInt(tParts[1], 10);

    const now = new Date();
    const d = new Date(now.getFullYear(), monthIdx, day,
      isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm, 0, 0);
    if (isNaN(d.getTime())) return new Date();
    return d;
  } catch (e) {
    return new Date();
  }
};

window.handleImport = async function (event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (rows.length < 2) { window.toast('الملف فارغ', 'err'); return; }
    let imported = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[0]) continue;
      const rec = {
        seq: String(r[0]), dt: window.parseImportedDateTime(r[1], r[2]), phone: String(r[3] || ''), gender: String(r[4] || ''),
        nat: String(r[5] || ''), branch: String(r[6] || ''), loc: String(r[7] || ''),
        ctype: String(r[8] || ''), topic: String(r[9] || ''), child: String(r[10] || ''),
        emo: String(r[11] || ''), src: String(r[12] || ''), compNo: String(r[13] || ''),
        reqNo: String(r[14] || ''), notes: String(r[15] || '')
      };
      if (!window.calls.find(c => c.seq === rec.seq)) {
        window.calls.unshift(rec);
        await window.persistCall(rec);
        imported++;
      }
    }
    window.renderLog();
    window.updateBadge();
    window.toast(`تم استيراد ${imported} سجل`, 'ok');
  } catch (e) {
    console.error(e);
    window.toast('خطأ في استيراد الملف', 'err');
  }
  event.target.value = '';
};

// ===== TEXT IMPORT (لصق نصي لمكالمة واحدة أو عدة مكالمات) =====
// ترتيب الأسطر داخل كل كتلة: 0=الجوال 1=الجنس 2=الجنسية 3=نوع المكالمة
// 4=الموضوع 5=عدد الأطفال 6=الموقع 7=مشاعر العميل 8=ملخص المكالمة
window.TEXT_IMPORT_FIELD_COUNT = 9;

// مطابقة مرنة: نطابق النص المُدخل (بعد تطبيع المسافات والتشكيل البسيط)
// مع أقرب خيار من قائمة معتمدة في الإعدادات window.S، وإن لم نجد تطابقاً
// نُرجع القيمة الحرفية كما كتبها المستخدم بدل رفضها.
window.normalizeArabicText = function (s) {
  return String(s || '')
    .trim()
    .replace(/[\u064B-\u0652]/g, '') // إزالة التشكيل
    .replace(/أ|إ|آ/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

window.fuzzyMatchOption = function (input, options) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const norm = window.normalizeArabicText(raw);
  // تطابق تام أولاً
  let hit = options.find(o => window.normalizeArabicText(o) === norm);
  if (hit) return hit;
  // تطابق احتوائي (الإدخال يحتوي على الخيار أو العكس)
  hit = options.find(o => {
    const on = window.normalizeArabicText(o);
    return norm.includes(on) || on.includes(norm);
  });
  if (hit) return hit;
  return raw; // لا تطابق: نحتفظ بالنص كما كتبه المستخدم
};

// مطابقة الجنس: يدعم "رجل/ذكر/راجل" و "امرأة/مرأة/أنثى/ست" بالإضافة للقيم الرسمية
window.matchGender = function (input) {
  const norm = window.normalizeArabicText(input);
  if (!norm) return '';
  const maleWords = ['ذكر', 'رجل', 'راجل', 'ابو', 'اب', 'm', 'male'];
  const femaleWords = ['انثي', 'انثى', 'امراه', 'مراه', 'ست', 'سيده', 'ام', 'f', 'female'];
  if (maleWords.some(w => norm === window.normalizeArabicText(w) || norm.includes(window.normalizeArabicText(w)))) return 'ذكر';
  if (femaleWords.some(w => norm === window.normalizeArabicText(w) || norm.includes(window.normalizeArabicText(w)))) return 'أنثى';
  return '';
};

// مطابقة عدد الأطفال: يدعم أرقام ("3" أو "3 اطفال") والكلمات العربية (طفل/طفلين/ثلاثة...)
window.matchChildCount = function (input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const norm = window.normalizeArabicText(raw);
  const numMatch = norm.match(/\d+/);
  if (numMatch) {
    const n = parseInt(numMatch[0], 10);
    if (n === 1) return 'طفل';
    if (n === 2) return 'طفلين';
    if (n === 3) return 'ثلاثة';
    if (n === 4) return 'أربعة';
    if (n === 5) return 'خمسة';
    if (n >= 6) return 'أكثر';
  }
  // كلمات نصية مباشرة من CHILD_OPTS أو مرادفات شائعة
  const wordMap = {
    'طفل': 'طفل', 'واحد': 'طفل',
    'طفلين': 'طفلين', 'اثنين': 'طفلين',
    'ثلاثه': 'ثلاثة', 'ثلاثة': 'ثلاثة',
    'اربعه': 'أربعة', 'أربعة': 'أربعة',
    'خمسه': 'خمسة', 'خمسة': 'خمسة',
    'اكثر': 'أكثر', 'أكثر': 'أكثر'
  };
  // FIX: مطابقة تامة أولاً، ثم احتوائي مرتب من الأطول للأقصر — لمنع
  // تطابق "طفل" بالخطأ ضمن "طفلين" (لأن الأولى substring من الثانية)
  let exact = Object.keys(wordMap).find(k => window.normalizeArabicText(k) === norm);
  if (exact) return wordMap[exact];
  const sortedKeys = Object.keys(wordMap).sort((a, b) => b.length - a.length);
  for (const k of sortedKeys) {
    if (norm.includes(window.normalizeArabicText(k))) return wordMap[k];
  }
  return window.fuzzyMatchOption(raw, CHILD_OPTS);
};

// تحليل كتلة واحدة (9 أسطر) إلى رقم/تحقق + رصد الحقول المطابقة
window.parseTextImportBlock = function (lines) {
  while (lines.length < window.TEXT_IMPORT_FIELD_COUNT) lines.push('');
  const [phoneRaw, genderRaw, natRaw, ctypeRaw, topicRaw, childRaw, locRaw, emoRaw, notesRaw] = lines.map(l => (l || '').trim());

  const phone = phoneRaw.replace(/[^\d]/g, '');
  const notes = notesRaw;

  if (!phone || !notes) {
    return { ok: false, reason: !phone ? 'رقم الجوال مفقود' : 'ملخص المكالمة مفقود', raw: lines };
  }

  const gender = window.matchGender(genderRaw);
  const nat = natRaw ? window.fuzzyMatchOption(natRaw, window.S.nat) : '';
  const ctype = ctypeRaw ? window.fuzzyMatchOption(ctypeRaw, window.S.ctypes) : '';
  let topic = '';
  if (topicRaw) {
    const topicOptions = ctype && window.S.topicMap[ctype] ? window.S.topicMap[ctype] : [];
    topic = topicOptions.length ? window.fuzzyMatchOption(topicRaw, topicOptions) : topicRaw;
  }
  const child = childRaw ? window.matchChildCount(childRaw) : '';
  const loc = locRaw ? window.fuzzyMatchOption(locRaw, window.S.locs) : '';
  const emo = emoRaw ? window.fuzzyMatchOption(emoRaw, window.S.emos) : '';

  return {
    ok: true,
    rec: {
      phone, gender, nat, ctype, topic, child, loc, emo, notes,
      compNo: '', reqNo: ''
    }
  };
};

// تقسيم النص الكامل إلى كتل مفصولة بسطر/أسطر فارغة، كل كتلة = مكالمة واحدة
window.splitTextImportBlocks = function (text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let current = [];
  lines.forEach(line => {
    if (line.trim() === '' && current.some(l => l.trim() !== '')) {
      // سطر فارغ بعد محتوى فعلي = نهاية كتلة، لكن نسمح بأسطر فارغة داخلية
      // فقط إذا اكتملت الكتلة (9 أسطر فأكثر) أو وصلنا لفاصل صريح بين مكالمتين
      if (current.length >= window.TEXT_IMPORT_FIELD_COUNT) {
        blocks.push(current);
        current = [];
        return;
      }
    }
    if (line.trim() === '' && current.length === 0) return; // تجاهل الأسطر الفارغة بين الكتل
    current.push(line);
  });
  if (current.some(l => l.trim() !== '')) blocks.push(current);
  // FIX: لا نقطع الأسطر الزائدة عن 9 بصمت — ندمجها في حقل الملاحظات الأخير
  // (مفيد لو كتب المستخدم ملخص المكالمة على أكثر من سطر بدون قصد فصل جديد)
  return blocks.map(b => {
    if (b.length <= window.TEXT_IMPORT_FIELD_COUNT) return b;
    const head = b.slice(0, window.TEXT_IMPORT_FIELD_COUNT - 1);
    const mergedNotes = b.slice(window.TEXT_IMPORT_FIELD_COUNT - 1).join('\n');
    return [...head, mergedNotes];
  });
};

window.textImportParsedResults = [];

window.openTextImportModal = function () {
  const modal = document.getElementById('text-import-modal');
  const area = document.getElementById('textImportArea');
  const preview = document.getElementById('textImportPreview');
  const confirmBtn = document.getElementById('textImportConfirmBtn');
  if (area) area.value = '';
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  if (confirmBtn) confirmBtn.style.display = 'none';
  window.textImportParsedResults = [];
  if (modal) modal.style.display = 'flex';
};
window.closeTextImportModal = function () {
  const modal = document.getElementById('text-import-modal');
  if (modal) modal.style.display = 'none';
};

window.previewTextImport = function () {
  const area = document.getElementById('textImportArea');
  const preview = document.getElementById('textImportPreview');
  const confirmBtn = document.getElementById('textImportConfirmBtn');
  if (!area || !preview) return;
  const blocks = window.splitTextImportBlocks(area.value);
  if (!blocks.length) {
    preview.style.display = 'block';
    preview.innerHTML = '<div style="color:var(--red);font-weight:700;">لم يتم العثور على أي بيانات صالحة للمعاينة</div>';
    if (confirmBtn) confirmBtn.style.display = 'none';
    window.textImportParsedResults = [];
    return;
  }

  const results = blocks.map(b => window.parseTextImportBlock(b));
  window.textImportParsedResults = results;

  const validCount = results.filter(r => r.ok).length;
  const invalidCount = results.length - validCount;

  let html = `<div style="margin-bottom:8px;font-weight:800;color:var(--text);">سيتم استيراد ${validCount} مكالمة${invalidCount ? ` — تم تجاهل ${invalidCount} (بيانات ناقصة)` : ''}</div>`;
  results.forEach((r, i) => {
    if (r.ok) {
      const c = r.rec;
      const tagsLine = [c.gender, c.nat, c.ctype, c.topic, c.child, c.loc, c.emo].filter(Boolean).join(' · ');
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
        <div style="font-weight:700;color:var(--accent);">${i + 1}. ${c.phone}</div>
        ${tagsLine ? `<div style="color:var(--t2);margin-top:2px;">${tagsLine}</div>` : ''}
        <div style="color:var(--tl2);margin-top:2px;">${c.notes}</div>
      </div>`;
    } else {
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);color:var(--red);">
        ${i + 1}. تم التجاهل — ${r.reason}
      </div>`;
    }
  });
  preview.style.display = 'block';
  preview.innerHTML = html;
  if (confirmBtn) confirmBtn.style.display = validCount > 0 ? 'block' : 'none';
};

window.confirmTextImport = async function () {
  const validResults = window.textImportParsedResults.filter(r => r.ok);
  if (!validResults.length) return;

  let imported = 0;
  for (const r of validResults) {
    const dt = new Date();
    const rec = {
      seq: window.nextSeq(dt),
      dt,
      phone: r.rec.phone,
      gender: r.rec.gender,
      nat: r.rec.nat,
      branch: '',
      loc: r.rec.loc,
      src: '',
      topic: r.rec.topic,
      ctype: r.rec.ctype,
      compNo: '',
      reqNo: '',
      child: r.rec.child,
      emo: r.rec.emo,
      notes: r.rec.notes
    };
    window.calls.unshift(rec);
    await window.persistCall(rec);
    imported++;
  }

  window.renderLog();
  window.updateBadge();
  window.toast(`تم استيراد ${imported} مكالمة بنجاح`, 'ok');
  window.closeTextImportModal();
};

// ===== FILTER / SEARCH =====
window.filteredLogCalls = function () {
  const q = (document.getElementById('logSearch') || {}).value || '';
  const term = q.trim().toLowerCase();
  if (!term) return window.calls;
  return window.calls.filter(c => {
    const fields = [c.phone, c.seq, c.ctype, c.gender, c.nat, c.branch, c.loc, c.src, c.topic, c.emo, c.child, c.notes, c.compNo, c.reqNo].map(v => (v || '').toLowerCase());
    return fields.some(f => f.includes(term));
  });
};

window.renderFilteredLog = function () {
  window.renderLog(window.filteredLogCalls());
  if (window.textViewActive) window.buildTextView();
};

// ===== ANALYTICS =====
window.analyticsTerms = [];

window.filteredCalls = function () {
  const terms = window.analyticsTerms.map(t => t.toLowerCase());
  if (!terms.length) return window.calls;
  return window.calls.filter(c => {
    const fields = [c.phone, c.seq, c.ctype, c.gender, c.nat, c.branch, c.loc, c.src, c.topic, c.emo, c.child, c.notes, c.compNo, c.reqNo].map(v => (v || '').toLowerCase());
    return terms.every(t => fields.some(f => f.includes(t)));
  });
};

window.addAnalyticsTag = function () {
  const inp = document.getElementById('analyticsSearch');
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  if (!window.analyticsTerms.includes(v)) window.analyticsTerms.push(v);
  inp.value = '';
  window.renderAnalyticsTags();
  window.updateAnalytics();
  inp.focus();
};

window.addSuggestedTag = function (tag) {
  if (!window.analyticsTerms.includes(tag)) window.analyticsTerms.push(tag);
  window.renderAnalyticsTags();
  window.updateAnalytics();
};

window.renderAnalyticsTags = function () {
  const row = document.getElementById('filterTagsRow');
  if (!row) return;
  row.innerHTML = window.analyticsTerms.map(t =>
    `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--white);border:1.5px solid var(--accent);border-radius:20px;padding:6px 14px;font-size:13px;font-weight:700;color:var(--accent);box-shadow:var(--ss);">${t}<button onclick="removeAnalyticsTag('${t}')" style="background:none;border:none;cursor:pointer;color:var(--accent);font-size:16px;padding:0;line-height:1;margin-right:4px;">×</button></span>`
  ).join('');
};

window.removeAnalyticsTag = function (term) {
  window.analyticsTerms = window.analyticsTerms.filter(t => t !== term);
  window.renderAnalyticsTags();
  window.updateAnalytics();
};

window.clearFilters = function () {
  window.analyticsTerms = [];
  const inp = document.getElementById('analyticsSearch');
  if (inp) inp.value = '';
  const row = document.getElementById('filterTagsRow');
  if (row) row.innerHTML = '';
  window.updateAnalytics();
};

window.renderSuggestedTags = function () {
  const container = document.getElementById('suggestedTagsRow');
  if (!container) return;
  const fc = window.filteredCalls();
  const counts = {};
  fc.forEach(c => {
    const tags = [c.ctype, c.branch, c.loc, c.src, c.gender, c.nat, c.emo, c.child];
    if (c.topic) tags.push(...c.topic.split('، '));
    tags.filter(Boolean).forEach(tag => {
      if (!window.analyticsTerms.includes(tag)) counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  const topTags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(t => t[0]);
  if (!topTags.length) { container.innerHTML = ''; return; }
  container.innerHTML = `<span style="font-size:13px;color:var(--tl2);font-weight:800;margin-left:4px;">الأكثر ظهورا:</span> ` +
    topTags.map(tag => `<button onclick="addSuggestedTag('${tag}')" class="ob" style="padding:6px 14px;font-size:12px;border-radius:100px;background:var(--bg);border:1px solid var(--border);box-shadow:var(--ss);">${tag}</button>`).join('');
};

// ===== LINE CHART =====
window.lineChartInstance = null;
window.getISOWeek = function (d) {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};
window.getGroupKey = function (date, scale) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  if (scale === 'day') return `${y}-${m}-${d}`;
  if (scale === 'week') return `${y}-W${String(window.getISOWeek(date)).padStart(2, '0')}`;
  if (scale === 'month') return `${y}-${m}`;
  return `${y}`;
};
window.formatGroupKey = function (key, scale) {
  if (scale === 'day') {
    const [y, m, d] = key.split('-');
    return `${d} ${MONTHS[parseInt(m) - 1]}`;
  }
  if (scale === 'week') return `أسبوع ${key.split('-W')[1]} (${key.split('-')[0]})`;
  if (scale === 'month') {
    const [y, m] = key.split('-');
    return `${MONTHS[parseInt(m) - 1]} ${y}`;
  }
  return key;
};

window.updateLineChart = function () {
  const scaleEl = document.getElementById('timeScaleSelect');
  const scale = scaleEl ? scaleEl.value : 'day';
  const fc = window.filteredCalls();
  const sorted = [...fc].sort((a, b) => a.dt - b.dt);
  const grouped = {};
  sorted.forEach(c => {
    const k = window.getGroupKey(c.dt, scale);
    if (!grouped[k]) grouped[k] = 0;
    grouped[k]++;
  });
  const labels = Object.keys(grouped);
  const displayLabels = labels.map(k => window.formatGroupKey(k, scale));
  const dataTotal = labels.map(k => grouped[k]);
  const canvas = document.getElementById('timelineChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (window.lineChartInstance) window.lineChartInstance.destroy();
  window.lineChartInstance = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels: displayLabels,
      datasets: [{
        label: 'إجمالي النشاط',
        data: dataTotal,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99,102,241,0.1)',
        tension: 0.3,
        fill: true,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', rtl: true, labels: { font: { family: 'Cairo', weight: 'bold' } } },
        tooltip: { titleFont: { family: 'Cairo' }, bodyFont: { family: 'Cairo' }, rtl: true, textDirection: 'rtl' }
      },
      scales: {
        y: { beginAtZero: true, position: 'right', ticks: { stepSize: 1, font: { family: 'Cairo' } } },
        x: { ticks: { font: { family: 'Cairo' } } }
      }
    }
  });
};

// Simple bar chart renderer
window.renderBarChart = function (containerId, data, colorFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!Object.keys(data).length) { el.innerHTML = '<div style="text-align:center;color:var(--tl2);padding:20px;">لا توجد بيانات</div>'; return; }
  const max = Math.max(...Object.values(data));
  el.innerHTML = Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
    const pct = max ? (v / max * 100).toFixed(1) : 0;
    const color = colorFn ? colorFn(k) : 'var(--accent)';
    return `<div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:4px;">
        <span>${k || '—'}</span><span style="color:${color};">${v}</span>
      </div>
      <div style="background:var(--border);border-radius:4px;height:8px;">
        <div style="background:${color};width:${pct}%;height:100%;border-radius:4px;transition:width .4s;"></div>
      </div>
    </div>`;
  }).join('');
};

window.renderPieChart = function (containerId, data) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  if (!entries.length) { el.innerHTML = '<div style="text-align:center;color:var(--tl2);padding:20px;">لا توجد بيانات</div>'; return; }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors = ['#6366f1', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">` +
    entries.sort((a, b) => b[1] - a[1]).map(([k, v], i) => {
      const pct = ((v / total) * 100).toFixed(1);
      return `<div style="display:flex;align-items:center;gap:6px;background:var(--bg);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;">
        <span style="width:10px;height:10px;border-radius:50%;background:${colors[i % colors.length]};flex-shrink:0;"></span>
        <span>${k || '—'}</span><span style="color:var(--tl2);">${v} (${pct}%)</span>
      </div>`;
    }).join('') + '</div>';
};

window.updateAnalytics = function () {
  const fc = window.filteredCalls();
  const stTotal = document.getElementById('stTotal');
  const stComp = document.getElementById('stComp');
  const stInq = document.getElementById('stInq');
  const stReq = document.getElementById('stReq');
  if (stTotal) stTotal.textContent = fc.length;
  if (stComp) stComp.textContent = fc.filter(c => c.ctype === 'شكوى').length;
  if (stInq) stInq.textContent = fc.filter(c => c.ctype === 'استفسار').length;
  if (stReq) stReq.textContent = fc.filter(c => c.ctype === 'طلب').length;

  window.updateLineChart();
  window.renderSuggestedTags();

  // Branch grid
  const branchCounts = {};
  fc.forEach(c => { if (c.branch) branchCounts[c.branch] = (branchCounts[c.branch] || 0) + 1; });
  const branchGrid = document.getElementById('branchAnalyticsGrid');
  if (branchGrid) {
    branchGrid.innerHTML = Object.entries(branchCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
      `<div class="sc" style="padding:16px;"><div class="slbl" style="font-size:12px;">${k}</div><div style="font-family:'Tajawal',sans-serif;font-size:28px;font-weight:800;color:var(--accent);">${v}</div></div>`
    ).join('');
  }

  // Child chart
  const childCounts = {};
  fc.forEach(c => { if (c.child) childCounts[c.child] = (childCounts[c.child] || 0) + 1; });
  window.renderBarChart('chChild', childCounts, () => 'var(--purple)');

  // Emo chart
  const emoCounts = {};
  fc.forEach(c => { if (c.emo) emoCounts[c.emo] = (emoCounts[c.emo] || 0) + 1; });
  window.renderBarChart('chEmo', emoCounts, () => 'var(--teal)');

  // Loc chart
  const locCounts = {};
  fc.forEach(c => { if (c.loc) locCounts[c.loc] = (locCounts[c.loc] || 0) + 1; });
  window.renderBarChart('chLoc', locCounts, () => 'var(--green)');

  // Nat chart
  const natCounts = {};
  fc.forEach(c => { if (c.nat) natCounts[c.nat] = (natCounts[c.nat] || 0) + 1; });
  window.renderPieChart('chNat', natCounts);

  // Gender chart
  const genCounts = {};
  fc.forEach(c => { if (c.gender) genCounts[c.gender] = (genCounts[c.gender] || 0) + 1; });
  window.renderPieChart('chGen', genCounts);

  // Src chart
  const srcCounts = {};
  fc.forEach(c => { if (c.src) srcCounts[c.src] = (srcCounts[c.src] || 0) + 1; });
  window.renderBarChart('chSrc', srcCounts, () => 'var(--amber)');

  // Time slots
  const timeCounts = {};
  const slots = [
    [12, 14, '12:00~2:00م'], [14, 16, '2:00~4:00م'], [16, 18, '4:00~6:00م'],
    [18, 20, '6:00~8:00م'], [20, 22, '8:00~10:00م'], [22, 24, '10:00~12:00م'],
    [0, 2, '12:00~2:00ص'], [2, 4, '2:00~4:00ص'], [4, 6, '4:00~6:00ص'],
    [6, 8, '6:00~8:00ص'], [8, 10, '8:00~10:00ص'], [10, 12, '10:00~12:00ص']
  ];
  fc.forEach(c => {
    const h = c.dt.getHours();
    const slot = slots.find(([s, e]) => h >= s && h < e);
    if (slot) timeCounts[slot[2]] = (timeCounts[slot[2]] || 0) + 1;
  });
  window.renderBarChart('chTime', timeCounts, () => 'var(--accent)');
};

// ===== MAINTENANCE =====
const MSECS = [
  { key: 'nat', lbl: 'الجنسيات', ph: 'أضف جنسية...' },
  { key: 'branches', lbl: 'الفروع', ph: 'أضف فرعاً...' },
  { key: 'locs', lbl: 'مواقع العميل', ph: 'أضف موقعاً...' },
  { key: 'emos', lbl: 'مشاعر العميل', ph: 'أضف مشاعر...' },
  { key: 'srcs', lbl: 'مصادر الوصول', ph: 'أضف مصدراً...' }
];

window.renderMBody = function () {
  const el = document.getElementById('mBody');
  if (!el) return;

  // Topics by ctype
  const topicSecs = Object.keys(window.S.topicMap).map(ctype => {
    const items = window.S.topicMap[ctype] || [];
    return `<div style="margin-bottom:16px;">
      <div class="stitle">${ctype} — المواضيع</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        ${items.map((item, i) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:700;">${item}<button onclick="removeTopic('${ctype}',${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:0;">×</button></span>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" class="fi" id="topicInput_${ctype}" placeholder="أضف موضوعاً..." style="flex:1;" onkeydown="if(event.key==='Enter') addTopic('${ctype}')" />
        <button class="btn-p" onclick="addTopic('${ctype}')" style="padding:8px 16px;font-size:13px;">إضافة</button>
      </div>
    </div>`;
  }).join('');

  // General sections
  const generalSecs = MSECS.map(sec => {
    const items = window.S[sec.key] || [];
    return `<div style="margin-bottom:16px;">
      <div class="stitle">${sec.lbl}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
        ${items.map((item, i) => `<span style="display:inline-flex;align-items:center;gap:6px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:700;">${item}<button onclick="removeItem('${sec.key}',${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:0;">×</button></span>`).join('')}
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" class="fi" id="mInput_${sec.key}" placeholder="${sec.ph}" style="flex:1;" onkeydown="if(event.key==='Enter') addItem('${sec.key}')" />
        <button class="btn-p" onclick="addItem('${sec.key}')" style="padding:8px 16px;font-size:13px;">إضافة</button>
      </div>
    </div>`;
  }).join('');

  // Admin & Branch phones
  const branchPhones = window.S.branches.map(b =>
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="min-width:120px;font-size:13px;font-weight:700;">${b}</span>
      <input type="tel" class="fi" value="${window.S.branchPhones[b] || ''}" placeholder="رقم الفرع" onchange="setBranchPhone('${b}',this.value)" style="flex:1;" />
    </div>`
  ).join('');

  el.innerHTML = `
    <div class="fc" style="padding:20px;margin-bottom:16px;">
      <div class="stitle">أرقام التواصل</div>
      <div style="margin-bottom:12px;">
        <label class="flbl" style="margin-bottom:6px;display:block;">رقم الإدارة</label>
        <input type="tel" class="fi" value="${window.S.adminPhone || ''}" placeholder="05XXXXXXXX" onchange="setAdminPhone(this.value)" />
      </div>
      <div class="stitle" style="margin-top:16px;">أرقام الفروع</div>
      ${branchPhones}
    </div>
    <div class="fc" style="padding:20px;margin-bottom:16px;">
      <div class="stitle">مواضيع المكالمات</div>
      ${topicSecs}
    </div>
    <div class="fc" style="padding:20px;margin-bottom:16px;">
      <div class="stitle">الإعدادات العامة</div>
      ${generalSecs}
    </div>
    <div class="fc" style="padding:20px;margin-bottom:16px;">
      <div class="stitle">إدارة البيانات</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <button class="btn-p" onclick="OfflineQ.sync()" style="padding:10px 20px;">مزامنة البيانات</button>
        <button class="btn-s" onclick="forceRefreshFromServer()" style="padding:10px 20px;">تحديث من السيرفر</button>
      </div>
    </div>`;
};

window.addTopic = function (ctype) {
  const inp = document.getElementById('topicInput_' + ctype);
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  if (!window.S.topicMap[ctype]) window.S.topicMap[ctype] = [];
  window.S.topicMap[ctype].push(v);
  inp.value = '';
  window.saveSettings();
  window.renderMBody();
};
window.removeTopic = function (ctype, idx) {
  window.S.topicMap[ctype].splice(idx, 1);
  window.saveSettings();
  window.renderMBody();
};
window.addItem = function (key) {
  const inp = document.getElementById('mInput_' + key);
  if (!inp) return;
  const v = inp.value.trim();
  if (!v) return;
  window.S[key].push(v);
  inp.value = '';
  window.saveSettings();
  window.renderMBody();
};
window.removeItem = function (key, idx) {
  window.S[key].splice(idx, 1);
  window.saveSettings();
  window.renderMBody();
};
window.setAdminPhone = function (v) { window.S.adminPhone = v.trim(); window.saveSettings(); };
window.setBranchPhone = function (branch, v) { window.S.branchPhones[branch] = v.trim(); window.saveSettings(); };

window.forceRefreshFromServer = async function () {
  window.toast('جاري التحديث...', '');
  const remote = await FB.getAll();
  if (remote) {
    // FIX: دمج مع طابور المزامنة المعلّق بدل الاستبدال المباشر
    window.calls = await window.mergeWithPendingQueue(remote);
    // Sync to local DB
    for (const r of remote) await window.saveCallDB(r).catch(() => {});
    window.renderLog();
    window.updateBadge();
    window.toast(`تم تحديث ${remote.length} سجل`, 'ok');
  } else {
    window.toast('فشل التحديث من السيرفر', 'err');
  }
};

// FIX: قبل استبدال window.calls ببيانات السيرفر، نطبّق عمليات طابور
// المزامنة المعلّقة (حفظ/حذف لم تُرفع بعد) فوق نتيجة السيرفر، بدل تجاهلها
// مؤقتاً حتى تتم المزامنة في النهاية — هذا يمنع ضياع/إعادة ظهور سجلات
// محليّة عند انقطاع الشبكة أثناء بدء التشغيل أو "تحديث من السيرفر".
window.mergeWithPendingQueue = async function (remoteCalls) {
  const queue = await window.OfflineQ.get();
  if (!queue.length) return remoteCalls;
  const map = new Map(remoteCalls.map(c => [c.seq, c]));
  queue.forEach(item => {
    if (item.action === 'save' && item.rec) {
      map.set(item.rec.seq, { ...item.rec, dt: new Date(item.rec.dt) });
    } else if (item.action === 'delete' && item.seq) {
      map.delete(item.seq);
    }
  });
  return Array.from(map.values());
};

// ===== INIT APP =====
window.initApp = async function () {
  try {
    await window.initDB();
    await window.loadSettings();

    // Set Chart.js defaults after Chart.js is confirmed loaded
    if (window.Chart && window.Chart.defaults) {
      window.Chart.defaults.font.family = 'Cairo';
    }

    // Load from local DB first for fast startup
    const localData = await window.getAllCallsDB();
    if (localData.length) {
      window.calls = localData;
      window.renderLog();
      window.updateBadge();
    }

    // Then sync from Firebase
    const remoteData = await FB.getAll();
    if (remoteData) {
      // FIX: ندمج مع طابور المزامنة المعلّق بدل استبدال window.calls مباشرة،
      // لتفادي إخفاء سجلات محلية لم تُرفع للسيرفر بعد.
      window.calls = await window.mergeWithPendingQueue(remoteData);
      // Save remote to local DB
      for (const r of remoteData) await window.saveCallDB(r).catch(() => {});
      window.renderLog();
      window.updateBadge();
    }

    // Start real-time listener
    FB.startListener(async (remoteUpdated) => {
      // FIX: نطبّق الطابور المعلّق هنا أيضاً، فقد يصل تحديث لحظي من السيرفر
      // قبل اكتمال مزامنة العمليات المحلية غير المرفوعة بعد.
      window.calls = await window.mergeWithPendingQueue(remoteUpdated);
      window.renderLog();
      window.updateBadge();
      if (document.getElementById('tab-analytics').classList.contains('active')) {
        window.updateAnalytics();
      }
    });

    window.updateSeqLabel();
    window.updateDTBtns();
    window.OfflineQ.updateBadge();

    // Sync any pending offline ops
    await window.OfflineQ.sync();

    console.log('App initialized ✓');
  } catch (err) {
    console.error('initApp error:', err);
    window.toast('حدث خطأ في تهيئة التطبيق', 'err');
  }
};

// ===== BOOTSTRAP =====
document.addEventListener('DOMContentLoaded', () => {
  window.initApp();
});

// Online/offline events
window.addEventListener('online', () => {
  window.toast('تم الاتصال بالإنترنت', 'ok');
  window.OfflineQ.sync();
});
window.addEventListener('offline', () => {
  window.toast('لا يوجد اتصال — البيانات محفوظة محلياً', 'err');
});
