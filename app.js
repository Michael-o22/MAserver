/**
 * Server Room Asset & Physical Inventory Audit Application Logic
 * Real-time Firebase Cloud Sync & GitHub Pages Deployment Ready
 */

const STORAGE_KEY_AUDIT_DATA = 'SERVER_ROOM_AUDIT_DATA_V1';
const STORAGE_KEY_SESSION_META = 'SERVER_ROOM_SESSION_META_V1';
const STORAGE_KEY_AUTH_SESSION = 'SERVER_ROOM_AUTH_SESSION_V1';
const STORAGE_KEY_HISTORY = 'SERVER_ROOM_AUDIT_HISTORY_V1';
const STORAGE_KEY_THEME = 'SERVER_ROOM_THEME';

// Admin Gmail Whitelist (Authorized Admins)
const ADMIN_GMAIL_LIST = [
  'suphalerk.chur@gmail.com'
];

// Fallback Local Authentication Configuration
const AUTH_CONFIG = {
  username: 'admin',
  password: 'admin1234',
  sessionDurationMs: 30 * 60 * 1000 // 30 minutes
};

// Auth State
let authState = {
  isLoggedIn: false,
  role: 'VISITOR', // 'ADMIN' or 'VISITOR'
  authType: 'NONE', // 'FIREBASE_GOOGLE' or 'LOCAL_PASSWORD'
  username: '',
  email: '',
  photoURL: null,
  uid: null,
  loginTime: null,
  expiresAt: null
};

let sessionTimerInterval = null;

// Firebase Cloud Sync State
let firebaseApp = null;
let firebaseAuth = null;
let db = null;
let storage = null;
let isFirebaseConnected = false;
let isSyncingFromCloud = false;

// PWA Install Prompt State
let deferredPwaPrompt = null;

// Initial App State
let state = {
  inventory: [],
  sessionMeta: {
    sessionId: '',
    periodTitle: 'รอบตรวจรับครุภัณฑ์ ประจำปีงบประมาณ 2567',
    auditorName: 'Senior IT Auditor',
    auditDate: new Date().toISOString().split('T')[0],
    location: 'Server Room 70',
    notes: 'การตรวจเช็กครุภัณฑ์ประจำงวดบำรุงรักษาประจำปี',
    status: 'IN_PROGRESS'
  },
  history: [],
  activeTab: 'dashboard',
  selectedRackId: 'all',
  searchQuery: '',
  filterStatus: 'all',
  reportFilter: 'all',
  reportShowPhotos: false,
  editingItem: null,
  currentEditingImage: null,
  currentAddingImage: null,
  viewingItem: null,
  viewingHistoryId: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initData();
  initHistory();
  initFirebase();
  initPWA();
  setupEventListeners();
  renderApp();
});

/**
 * Initialize Theme & Sync with LocalStorage / System Preference
 */
function initTheme() {
  const btnThemeToggle = document.getElementById('theme-toggle');
  let isDark = false;

  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);
    if (savedTheme) {
      isDark = savedTheme === 'dark';
    } else {
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch (e) {
    isDark = false;
  }

  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  updateThemeButtonUI(isDark);
}

function updateThemeButtonUI(isDark) {
  const btnThemeToggle = document.getElementById('theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.innerHTML = isDark
      ? '<i class="fa-solid fa-sun text-amber-400"></i>'
      : '<i class="fa-solid fa-moon text-indigo-600"></i>';
    btnThemeToggle.setAttribute('title', isDark ? 'สลับเป็นโหมดสว่าง (Light)' : 'สลับเป็นโหมดมืด (Dark)');
  }
}

function toggleTheme() {
  const isDarkNow = document.documentElement.classList.toggle('dark');
  try {
    localStorage.setItem(STORAGE_KEY_THEME, isDarkNow ? 'dark' : 'light');
  } catch (e) {
    console.warn('Unable to save theme to localStorage', e);
  }
  updateThemeButtonUI(isDarkNow);
}

/**
 * Initialize Firebase Cloud Real-time Database & Storage & Auth
 */
function initFirebase() {
  if (typeof firebase !== 'undefined' && typeof isFirebaseConfigured === 'function' && isFirebaseConfigured()) {
    try {
      if (!firebase.apps.length) {
        firebaseApp = firebase.initializeApp(firebaseConfig);
      } else {
        firebaseApp = firebase.app();
      }
      db = firebase.firestore();
      storage = firebase.storage();
      firebaseAuth = typeof firebase.auth === 'function' ? firebase.auth() : null;
      isFirebaseConnected = true;
      updateCloudSyncBadge(true);
      listenToCloudUpdates();
      listenToCloudHistory();
      initFirebaseAuthListener();
      console.log('Firebase Cloud Real-time Sync & Auth initialized successfully.');
    } catch (err) {
      console.error('Firebase initialization error', err);
      isFirebaseConnected = false;
      updateCloudSyncBadge(false);
    }
  } else {
    isFirebaseConnected = false;
    updateCloudSyncBadge(false);
    console.log('Firebase is not configured or in offline mode. Using LocalStorage fallback.');
  }
}

/**
 * Real-time Listener on Firestore Current Session Document
 */
function listenToCloudUpdates() {
  if (!db || !isFirebaseConnected) return;

  db.collection('audit_sessions').doc('current_session').onSnapshot((docSnapshot) => {
    if (docSnapshot.exists) {
      const cloudData = docSnapshot.data();
      if (cloudData && cloudData.inventory && Array.isArray(cloudData.inventory)) {
        isSyncingFromCloud = true;
        state.inventory = cloudData.inventory;
        if (cloudData.sessionMeta) {
          state.sessionMeta = cloudData.sessionMeta;
        }

        const hadFixes = sanitizeInventoryData();

        // Cache locally
        try {
          localStorage.setItem(STORAGE_KEY_AUDIT_DATA, JSON.stringify(state.inventory));
          localStorage.setItem(STORAGE_KEY_SESSION_META, JSON.stringify(state.sessionMeta));
        } catch (e) {
          console.warn('Local cache save error', e);
        }

        if (hadFixes) {
          syncAllToCloud(true);
        }

        // Re-render views while avoiding disruptive form reset if modal is open
        if (!state.editingItem) {
          renderApp();
        } else {
          updateHeaderSessionInfo();
        }
        isSyncingFromCloud = false;
      }
    } else {
      // If doc does not exist yet on cloud, upload current inventory
      if (state.inventory && state.inventory.length > 0) {
        syncAllToCloud(true);
      }
    }
  }, (error) => {
    console.warn('Firestore real-time subscription error:', error);
  });
}

/**
 * Real-time Listener on Firestore History Document
 */
function listenToCloudHistory() {
  if (!db || !isFirebaseConnected) return;

  db.collection('audit_sessions').doc('history_index').onSnapshot((docSnapshot) => {
    if (docSnapshot.exists) {
      const historyData = docSnapshot.data();
      if (historyData && Array.isArray(historyData.snapshots)) {
        state.history = historyData.snapshots;
        try {
          localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(state.history));
        } catch (e) {}
        renderHistory();
      }
    } else {
      // If no history on cloud yet, upload local history if exists
      if (state.history && state.history.length > 0) {
        saveHistoryToCloud();
      }
    }
  }, (err) => {
    console.warn('Firestore history subscription error:', err);
  });
}

/**
 * Sync Local State to Cloud Firestore
 */
async function syncAllToCloud(silent = false) {
  if (!db || !isFirebaseConnected) {
    if (!silent) showToast('ยังไม่ได้เชื่อมต่อ Firebase หรืออยู่ในโหมด Local');
    return;
  }

  try {
    await db.collection('audit_sessions').doc('current_session').set({
      inventory: state.inventory,
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString(),
      updatedBy: authState.isLoggedIn ? state.sessionMeta.auditorName : 'System'
    }, { merge: true });
    if (!silent) showToast('ซิงค์ข้อมูลขึ้น Cloud Database เรียบร้อยแล้ว');
  } catch (err) {
    console.warn('Error writing to Firestore', err);
    if (!silent) showToast('ไม่สามารถซิงค์ขึ้น Cloud ได้ (กรุณาตรวจสอบ Firestore Security Rules)');
  }
}

function updateCloudSyncBadge(isConnected) {
  const syncBadge = document.getElementById('cloud-sync-badge');
  const syncDot = document.getElementById('cloud-sync-dot');
  const syncText = document.getElementById('cloud-sync-text');

  const settingBadge = document.getElementById('setting-cloud-status-badge');
  const settingDesc = document.getElementById('setting-cloud-status-desc');

  if (isConnected) {
    if (syncBadge) {
      syncBadge.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-xs';
    }
    if (syncDot) syncDot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    if (syncText) syncText.textContent = 'Cloud Real-time';

    if (settingBadge) {
      settingBadge.textContent = 'Connected (Real-time)';
      settingBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300';
    }
    if (settingDesc) {
      const projId = (typeof firebaseConfig !== 'undefined' && firebaseConfig.projectId) ? firebaseConfig.projectId : 'Active';
      settingDesc.innerHTML = `<span class="text-emerald-600 dark:text-emerald-400 font-semibold"><i class="fa-solid fa-circle-check mr-1"></i>เชื่อมต่อ Cloud Firestore เรียบร้อยแล้ว (Project: ${escapeHTML(projId)})</span> ข้อมูลและภาพจะซิงค์แบบ Real-time ข้ามอุปกรณ์ทุกเครื่องทันที`;
    }
  } else {
    if (syncBadge) {
      syncBadge.className = 'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-xs';
    }
    if (syncDot) syncDot.className = 'w-2 h-2 rounded-full bg-slate-400';
    if (syncText) syncText.textContent = 'Local Mode';

    if (settingBadge) {
      settingBadge.textContent = 'Local Mode';
      settingBadge.className = 'px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300';
    }
    if (settingDesc) {
      settingDesc.innerHTML = `ขณะนี้กำลังใช้งานในโหมด LocalStorage (ข้อมูลบันทึกในเครื่อง) หากต้องการซิงค์ Real-time ข้ามอุปกรณ์ กรุณาระบุ Config ในไฟล์ <code class="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-mono text-blue-600 dark:text-blue-400">firebase-config.js</code>`;
    }
  }
}

/**
 * Initialize Authentication & Session Management
 */
function initAuth() {
  const savedAuth = localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
  if (savedAuth) {
    try {
      const parsedAuth = JSON.parse(savedAuth);
      const now = Date.now();
      if (parsedAuth && parsedAuth.isLoggedIn) {
        if (parsedAuth.authType === 'FIREBASE_GOOGLE') {
          authState = parsedAuth;
        } else if (parsedAuth.expiresAt && parsedAuth.expiresAt > now) {
          authState = parsedAuth;
          startSessionCountdown();
        } else {
          clearAuthSession();
        }
      } else {
        clearAuthSession();
      }
    } catch (e) {
      console.error('Failed to parse auth session', e);
      clearAuthSession();
    }
  } else {
    clearAuthSession();
  }
}

/**
 * Firebase Authentication State Listener (Google Sign-In Auto-Restore)
 */
function initFirebaseAuthListener() {
  if (typeof firebase !== 'undefined' && firebase.auth) {
    try {
      firebase.auth().onAuthStateChanged((user) => {
        if (user) {
          const email = (user.email || '').toLowerCase().trim();
          const isAuthorized = ADMIN_GMAIL_LIST.some(e => e.toLowerCase().trim() === email);

          if (isAuthorized) {
            authState = {
              isLoggedIn: true,
              role: 'ADMIN',
              authType: 'FIREBASE_GOOGLE',
              username: user.displayName || email,
              email: user.email,
              photoURL: user.photoURL || null,
              uid: user.uid,
              loginTime: Date.now()
            };

            // Update current auditor name to real Google account name if default
            if (user.displayName && (!state.sessionMeta.auditorName || state.sessionMeta.auditorName === 'Senior IT Auditor')) {
              state.sessionMeta.auditorName = user.displayName;
              saveSessionMeta();
            }

            try {
              localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(authState));
            } catch (e) {}
          } else {
            console.warn(`[Auth] User ${email} is not in ADMIN_GMAIL_LIST.`);
            firebase.auth().signOut().catch(() => {});
            clearAuthSession();
          }
        }
        updateAuthUI();
      });
    } catch (e) {
      console.warn('Firebase Auth listener initialization error', e);
    }
  }
}

/**
 * Admin Login via Google (Gmail)
 */
window.loginWithGoogleAdmin = async function() {
  const errorMsg = document.getElementById('login-error-msg');
  const errorText = document.getElementById('login-error-text');
  if (errorMsg) errorMsg.classList.add('hidden');

  // Check if running on file:/// protocol
  if (window.location.protocol === 'file:') {
    if (errorMsg && errorText) {
      errorText.innerHTML = `<div class="space-y-1">
        <p class="font-bold">⚠️ Google Sign-In จำเป็นต้องรันผ่าน Web Server (http:// หรือ https://)</p>
        <p class="text-[11px] leading-relaxed">เบราว์เซอร์ไม่อนุญาตให้เปิด Google OAuth จากการดับเบิ้ลคลิกไฟล์ (file:///) ตรงๆ เนื่องจากนโยบายความปลอดภัย</p>
        <p class="text-[11px] font-semibold text-blue-600 dark:text-blue-400 mt-1">💡 วิธีแก้ไข: เปิดโฟลเดอร์นี้ใน VS Code แล้วคลิก "Go Live" (Live Server) หรือรัน <code>npx serve</code> หรือเปิดผ่าน URL บน Firebase Hosting / GitHub Pages</p>
      </div>`;
      errorMsg.classList.remove('hidden');
    }
    showToast('กรุณาเปิดแอปผ่าน Web Server (http://) เพื่อเข้าสู่ระบบด้วย Google');
    return;
  }

  if (typeof firebase === 'undefined' || !firebase.auth) {
    if (errorMsg && errorText) {
      errorText.textContent = 'Firebase Authentication SDK ยังไม่ได้เริ่มต้น หรือระบบอยู่ในโหมด Offline';
      errorMsg.classList.remove('hidden');
    }
    showToast('Firebase Authentication ยังไม่ได้เริ่มต้น หรือระบบอยู่ในโหมด Offline');
    return;
  }

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await firebase.auth().signInWithPopup(provider);
    const user = result.user;
    const email = (user.email || '').toLowerCase().trim();

    const isAuthorized = ADMIN_GMAIL_LIST.some(e => e.toLowerCase().trim() === email);

    if (isAuthorized) {
      authState = {
        isLoggedIn: true,
        role: 'ADMIN',
        authType: 'FIREBASE_GOOGLE',
        username: user.displayName || email,
        email: user.email,
        photoURL: user.photoURL || null,
        uid: user.uid,
        loginTime: Date.now()
      };

      if (user.displayName) {
        state.sessionMeta.auditorName = user.displayName;
        saveSessionMeta();
      }

      try {
        localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(authState));
      } catch (e) {}

      closeAllModals();
      updateAuthUI();
      renderApp();
      showToast(`เข้าสู่ระบบสำเร็จ: คุณ ${user.displayName || email} (ผู้ดูแลระบบ)`);
    } else {
      // User is not in admin whitelist
      await firebase.auth().signOut();
      clearAuthSession();
      updateAuthUI();
      renderApp();

      if (errorMsg && errorText) {
        errorText.textContent = `บัญชี ${email} ไม่ได้รับสิทธิ์ผู้ดูแลระบบ (Admin: suphalerk.chur@gmail.com)`;
        errorMsg.classList.remove('hidden');
      }
      showToast(`บัญชี ${email} ไม่มีสิทธิ์เป็น Admin`);
    }
  } catch (err) {
    console.error('Google Sign-In Error', err);
    if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
      return;
    }
    if (errorMsg && errorText) {
      if (err.code === 'auth/operation-not-supported-in-this-environment') {
        errorText.innerHTML = `<div class="space-y-1">
          <p class="font-bold text-amber-700 dark:text-amber-300">⚠️ สภาพแวดล้อมไม่รองรับ Google OAuth แบบไฟล์ตรง (file:///)</p>
          <p class="text-[11px]">กรุณาเปิดแอปผ่าน Local Web Server (เช่น http://localhost:5500 หรือ http://127.0.0.1:8000) หรือโฮสต์บน Firebase / GitHub Pages</p>
        </div>`;
      } else if (err.code === 'auth/unauthorized-domain') {
        const currentHostname = window.location.hostname || 'โดเมนปัจจุบัน';
        errorText.innerHTML = `<div class="space-y-2 text-left">
          <p class="font-bold text-red-700 dark:text-red-300">🔒 โดเมน (${escapeHTML(currentHostname)}) ยังไม่ได้รับอนุญาตใน Firebase</p>
          <p class="text-[11px] leading-relaxed">Firebase จำกัดให้ Login ด้วย Google ได้เฉพาะโดเมนที่ระบุไว้ใน <strong>Authorized domains</strong></p>
          <div class="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-red-200 dark:border-red-800 text-[11px] text-slate-700 dark:text-slate-200 space-y-1">
            <span class="font-semibold text-blue-600 dark:text-blue-400 block">💡 วิธีแก้ (ทำครั้งเดียวใน Firebase Console):</span>
            <span>1. ไปที่ <strong>Authentication</strong> > <strong>Settings</strong> > <strong>Authorized domains</strong></span><br>
            <span>2. กด <strong>Add domain</strong> แล้วใส่: <code class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-mono font-bold">${escapeHTML(currentHostname)}</code></span>
          </div>
        </div>`;
      } else {
        errorText.textContent = `ไม่สามารถเข้าสู่ระบบด้วย Google ได้: ${err.message}`;
      }
      errorMsg.classList.remove('hidden');
    }
    showToast(`เข้าสู่ระบบไม่สำเร็จ: โดเมนยังไม่ได้รับอนุญาตใน Firebase Console`);
  }
};

function startSessionCountdown() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);

  updateSessionTimerDisplay();
  sessionTimerInterval = setInterval(() => {
    if (!authState.expiresAt) return;
    const remaining = authState.expiresAt - Date.now();
    if (remaining <= 0) {
      clearInterval(sessionTimerInterval);
      clearAuthSession();
      updateAuthUI();
      renderApp();
      showToast('Session การใช้งาน 30 นาทีหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    } else {
      updateSessionTimerDisplay();
    }
  }, 1000);
}

function updateSessionTimerDisplay() {
  const timerEl = document.getElementById('auth-session-timer');
  if (!timerEl) return;

  if (authState.authType === 'FIREBASE_GOOGLE') {
    timerEl.textContent = 'Google Auth (Active)';
    return;
  }

  if (!authState.isLoggedIn || !authState.expiresAt) return;

  const remainingMs = Math.max(0, authState.expiresAt - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  timerEl.textContent = formattedTime;
}

function clearAuthSession() {
  authState = {
    isLoggedIn: false,
    role: 'VISITOR',
    authType: 'NONE',
    username: '',
    email: '',
    photoURL: null,
    uid: null,
    loginTime: null,
    expiresAt: null
  };
  localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

window.openLoginModal = function() {
  const modal = document.getElementById('login-modal');
  const errorMsg = document.getElementById('login-error-msg');

  if (errorMsg) errorMsg.classList.add('hidden');

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

window.handleLogout = async function() {
  if (confirm('คุณต้องการออกจากระบบเจ้าหน้าที่ ใช่หรือไม่?')) {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      try {
        await firebase.auth().signOut();
      } catch (e) {
        console.warn('Firebase sign out error', e);
      }
    }
    clearAuthSession();
    updateAuthUI();
    renderApp();
    showToast('ออกจากระบบเรียบร้อยแล้ว (สิทธิ์: บุคคลทั่วไป)');
  }
};

function performLogin(username, password) {
  const cleanUser = (username || '').trim();
  const cleanPass = (password || '').trim();

  if (cleanUser === AUTH_CONFIG.username && cleanPass === AUTH_CONFIG.password) {
    const now = Date.now();
    authState = {
      isLoggedIn: true,
      role: 'ADMIN',
      authType: 'LOCAL_PASSWORD',
      username: cleanUser,
      email: '',
      photoURL: null,
      uid: null,
      loginTime: now,
      expiresAt: now + AUTH_CONFIG.sessionDurationMs
    };

    try {
      localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(authState));
    } catch (e) {}

    startSessionCountdown();
    closeAllModals();
    updateAuthUI();
    renderApp();
    showToast('เข้าสู่ระบบในฐานะเจ้าหน้าที่ (Local Admin) เรียบร้อยแล้ว');
    return true;
  } else {
    const errorMsg = document.getElementById('login-error-msg');
    const errorText = document.getElementById('login-error-text');
    if (errorMsg && errorText) {
      errorText.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (Username: admin / Password: admin1234)';
      errorMsg.classList.remove('hidden');
    }
    return false;
  }
}

function updateAuthUI() {
  const userBadge = document.getElementById('auth-user-badge');
  const loginBtn = document.getElementById('btn-header-login');
  const sidebarRoleBadge = document.getElementById('sidebar-role-badge');
  const userNameEl = document.getElementById('auth-user-name');
  const userRoleLabelEl = document.getElementById('auth-user-role-label');
  const userPhoto = document.getElementById('auth-user-photo');
  const userIcon = document.getElementById('auth-user-icon');

  if (authState.isLoggedIn) {
    if (userBadge) {
      userBadge.classList.remove('hidden');
      userBadge.classList.add('flex');
    }
    if (loginBtn) loginBtn.classList.add('hidden');

    if (userNameEl) {
      userNameEl.textContent = authState.username || 'Admin';
    }
    if (userRoleLabelEl) {
      userRoleLabelEl.textContent = authState.email || 'เจ้าหน้าที่ (Admin)';
    }

    if (userPhoto && userIcon) {
      if (authState.photoURL) {
        userPhoto.src = authState.photoURL;
        userPhoto.classList.remove('hidden');
        userIcon.classList.add('hidden');
      } else {
        userPhoto.classList.add('hidden');
        userIcon.classList.remove('hidden');
      }
    }

    if (sidebarRoleBadge) {
      if (authState.email) {
        sidebarRoleBadge.textContent = `Admin (${authState.email})`;
        sidebarRoleBadge.title = authState.email;
      } else {
        sidebarRoleBadge.textContent = 'เจ้าหน้าที่ (Admin)';
      }
      sidebarRoleBadge.className = 'px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold font-mono text-[11px] truncate max-w-[200px] block';
    }
  } else {
    if (userBadge) {
      userBadge.classList.add('hidden');
      userBadge.classList.remove('flex');
    }
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (sidebarRoleBadge) {
      sidebarRoleBadge.textContent = 'บุคคลทั่วไป (Viewer)';
      sidebarRoleBadge.className = 'px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold font-mono text-xs';
    }
  }

  // Update Settings page permissions
  updateSettingsInputs();
}

/**
 * Check if user has admin permission before performing an action
 */
function requireAdmin(actionName = 'ทำการแก้ไขข้อมูล') {
  if (authState.isLoggedIn && authState.role === 'ADMIN') {
    return true;
  }

  showToast(`ต้องใช้สิทธิ์เจ้าหน้าที่เพื่อ ${actionName}`);
  openLoginModal();
  return false;
}

/**
 * Load or initialize inventory data from LocalStorage
 */
function initData() {
  const savedData = localStorage.getItem(STORAGE_KEY_AUDIT_DATA);
  const savedSession = localStorage.getItem(STORAGE_KEY_SESSION_META);

  if (savedData) {
    try {
      state.inventory = JSON.parse(savedData);
      sanitizeInventoryData();
    } catch (e) {
      console.error('Failed to parse saved data, loading default MASTER_INVENTORY', e);
      loadMasterInventory();
    }
  } else {
    loadMasterInventory();
  }

  if (savedSession) {
    try {
      state.sessionMeta = JSON.parse(savedSession);
      if (!state.sessionMeta.periodTitle) {
        state.sessionMeta.periodTitle = 'รอบตรวจรับครุภัณฑ์ ประจำปีงบประมาณ 2567';
      }
    } catch (e) {
      console.error('Failed to parse saved session meta', e);
      initNewSession();
    }
  } else {
    initNewSession();
  }

  updateSettingsInputs();
  updateAuthUI();
}

/**
 * Sanitize and migrate legacy or cached inventory data
 */
function sanitizeInventoryData() {
  if (!state.inventory || !Array.isArray(state.inventory)) return false;

  let hasChanges = false;
  state.inventory.forEach(rack => {
    if (!Array.isArray(rack.items)) rack.items = [];
    const rackNoStr = String(rack.rack_no);

    rack.items.forEach((item, idx) => {
      // Ensure unique ID
      if (!item.id) {
        item.id = 'it_' + (rack.rack_id || 'rk') + '_' + idx + '_' + Math.random().toString(36).substr(2, 6);
        hasChanges = true;
      }

      // If item has an erroneous rack prefix (e.g., 5.10 inside rack 2 or rack 10), fix it to this rack's number
      if (item.item_no && !item.item_no.startsWith(rackNoStr + '.')) {
        item.item_no = `${rackNoStr}.${idx + 1}`;
        hasChanges = true;
      }

      // Specifically in Rack 5: fix duplicate 5.1 on item 10 (SmartPower UPS) if needed
      if (rackNoStr === '5') {
        if (idx === 9 && item.item_no !== '5.10' && item.name_description && item.name_description.includes('SmartPower')) {
          item.item_no = '5.10';
          hasChanges = true;
        }
      }

      // Fix double dot typo in weight
      if (item.weight === '0..25') {
        item.weight = '0.25';
        hasChanges = true;
      }

      // Fix Rack 4 skipped 4.3 if legacy
      if (rackNoStr === '4' && item.item_no === '4.7' && rack.items.length === 6) {
        const expected = ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6'];
        rack.items.forEach((it, i) => {
          if (expected[i] && it.item_no !== expected[i]) {
            it.item_no = expected[i];
            hasChanges = true;
          }
        });
      }

      // Ensure rack reference fields
      if (!item.rack_id) { item.rack_id = rack.rack_id; hasChanges = true; }
      if (!item.rack_name) { item.rack_name = rack.rack_name; hasChanges = true; }
    });
  });

  if (hasChanges) {
    saveData();
  }
  return hasChanges;
}

/**
 * Initialize Audit History from LocalStorage
 */
function initHistory() {
  const savedHistory = localStorage.getItem(STORAGE_KEY_HISTORY);
  if (savedHistory) {
    try {
      state.history = JSON.parse(savedHistory);
      if (!Array.isArray(state.history)) state.history = [];
    } catch (e) {
      console.error('Failed to parse saved history data', e);
      state.history = [];
    }
  } else {
    state.history = [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(state.history));
  } catch (e) {
    console.warn('Failed to save history to localStorage', e);
  }
  saveHistoryToCloud();
}

function saveHistoryToCloud() {
  if (isFirebaseConnected && db) {
    db.collection('audit_sessions').doc('history_index').set({
      snapshots: state.history,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(err => {
      console.warn('Failed to sync history snapshots to Firestore', err);
    });
  }
}

function loadMasterInventory() {
  if (typeof MASTER_INVENTORY === 'undefined' || !Array.isArray(MASTER_INVENTORY)) {
    console.error('MASTER_INVENTORY data is missing or invalid');
    state.inventory = [];
    return;
  }

  // Deep clone MASTER_INVENTORY and inject audit default fields and unique IDs
  state.inventory = JSON.parse(JSON.stringify(MASTER_INVENTORY)).map(rack => {
    rack.items = rack.items.map((item, idx) => {
      const parsedQty = parseQuantity(item.total_quantity);
      return {
        id: 'it_' + rack.rack_id + '_' + idx + '_' + Math.random().toString(36).substr(2, 6),
        ...item,
        rack_id: rack.rack_id,
        rack_name: rack.rack_name,
        system_qty: parsedQty,
        audited_qty: parsedQty, // Default to system qty
        audit_status: 'PENDING', // PENDING, PASS, DAMAGED, MISSING, MAINTENANCE, UNUSED
        audit_notes: '',
        audit_image: null, // Compressed base64 data URL or server/cloud path
        audited_at: null,
        auditor: ''
      };
    });
    return rack;
  });
  saveData();
}

function initNewSession(customTitle = null) {
  state.sessionMeta = {
    sessionId: 'AUD-' + Date.now().toString().slice(-6),
    periodTitle: customTitle || 'รอบตรวจรับครุภัณฑ์ ประจำปีงบประมาณ 2568',
    auditorName: 'Senior IT Auditor',
    auditDate: new Date().toISOString().split('T')[0],
    location: 'Server Room 70',
    notes: 'การตรวจเช็กครุภัณฑ์ประจำงวดบำรุงรักษาประจำปี',
    status: 'IN_PROGRESS'
  };
  saveSessionMeta();
  updateSettingsInputs();
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY_AUDIT_DATA, JSON.stringify(state.inventory));
  } catch (e) {
    console.warn('Failed to save data to localStorage (Storage quota warning)', e);
    showToast('LocalStorage เต็ม แนะนำเชื่อมต่อ Firebase เพื่อบันทึกภาพถ่ายบน Cloud');
  }

  // If Firebase is active and not receiving cloud snapshot, sync to cloud
  if (isFirebaseConnected && db && !isSyncingFromCloud) {
    db.collection('audit_sessions').doc('current_session').set({
      inventory: state.inventory,
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString(),
      updatedBy: state.sessionMeta.auditorName || 'Admin'
    }, { merge: true }).catch(err => {
      console.warn('Failed to sync to Firestore on saveData', err);
    });
  }
}

function saveSessionMeta() {
  try {
    localStorage.setItem(STORAGE_KEY_SESSION_META, JSON.stringify(state.sessionMeta));
  } catch (e) {
    console.error('Failed to save session meta to localStorage', e);
  }

  if (isFirebaseConnected && db && !isSyncingFromCloud) {
    db.collection('audit_sessions').doc('current_session').set({
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch(err => {
    });
  }
}

function parseQuantity(qtyStr) {
  if (typeof qtyStr === 'number') return qtyStr;
  if (!qtyStr) return 1;
  const match = String(qtyStr).match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

/**
 * Client-Side Image Compression using HTML5 Canvas (Optimized for Mobile & Quota)
 */
async function compressImageFile(file, maxWidth = 800, maxHeight = 800, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = readerEvent.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload Image Helper (Uploads to Firebase Storage / local server / compressed Base64 fallback)
 */
async function uploadImageToServer(file) {
  try {
    const compressedBase64 = await compressImageFile(file);

    // 1. If Firebase Storage is active, upload to cloud storage
    if (isFirebaseConnected && storage) {
      try {
        const cleanFileName = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`;
        const storageRef = storage.ref(`device_photos/${cleanFileName}`);
        const snapshot = await storageRef.putString(compressedBase64, 'data_url');
        const downloadUrl = await snapshot.ref.getDownloadURL();
        showToast('อัปโหลดรูปภาพขึ้น Firebase Cloud Storage สำเร็จ');
        return downloadUrl;
      } catch (storageErr) {
        console.warn('Firebase storage upload failed, fallback to local', storageErr);
      }
    }

    // 2. Try POST to local server API (if running with node server.js)
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: compressedBase64,
          filename: file.name
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.url) {
          showToast('อัปโหลดรูปภาพไปยังโฟลเดอร์ image เรียบร้อย');
          return data.url;
        }
      }
    } catch (apiErr) {
      console.warn('Upload API unavailable, using compressed Base64 inline', apiErr);
    }

    // 3. Fallback to compressed Base64
    showToast('แนบรูปถ่ายอุปกรณ์เรียบร้อย (บันทึกแบบออฟไลน์)');
    return compressedBase64;
  } catch (err) {
    console.error('Error processing image upload', err);
    showToast('ไม่สามารถประมวลผลไฟล์รูปภาพได้');
    return null;
  }
}

/**
 * Event Listeners Registration
 */
function setupEventListeners() {
  // Tab Navigation
  document.querySelectorAll('[data-tab-target]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-tab-target');
      switchTab(target);
    });
  });

  // Search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      renderChecklist();
      renderRackMap();
    });
  }

  // Status Filter
  const statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      state.filterStatus = e.target.value;
      renderChecklist();
      renderRackMap();
    });
  }

  // Category/Rack Filter
  const rackFilter = document.getElementById('rack-filter');
  if (rackFilter) {
    rackFilter.addEventListener('change', (e) => {
      state.selectedRackId = e.target.value;
      renderChecklist();
    });
  }

  // Report Filters
  const reportFilter = document.getElementById('report-filter');
  if (reportFilter) {
    reportFilter.addEventListener('change', (e) => {
      state.reportFilter = e.target.value;
      renderReports();
    });
  }

  const reportShowPhotos = document.getElementById('report-show-photos');
  if (reportShowPhotos) {
    reportShowPhotos.addEventListener('change', (e) => {
      state.reportShowPhotos = e.target.checked;
      renderReports();
    });
  }

  // Force Cloud Sync Button
  const btnCloudSync = document.getElementById('btn-cloud-sync-now');
  if (btnCloudSync) {
    btnCloudSync.addEventListener('click', () => {
      if (isFirebaseConnected) {
        syncAllToCloud();
      } else {
        showToast('ยังไม่ได้เปิดใช้งาน Firebase กรุณาใส่ Config ใน firebase-config.js');
      }
    });
  }

  // Login Form Submission
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      performLogin(usernameInput.value, passwordInput.value);
    });
  }

  // Password Visibility Toggle
  const btnTogglePassword = document.getElementById('btn-toggle-password');
  if (btnTogglePassword) {
    btnTogglePassword.addEventListener('click', () => {
      const passwordInput = document.getElementById('login-password');
      const eyeIcon = document.getElementById('login-password-eye');
      if (passwordInput && eyeIcon) {
        if (passwordInput.type === 'password') {
          passwordInput.type = 'text';
          eyeIcon.className = 'fa-solid fa-eye-slash';
        } else {
          passwordInput.type = 'password';
          eyeIcon.className = 'fa-solid fa-eye';
        }
      }
    });
  }

  // Settings Auto-Save & Manual Save
  const settingAuditor = document.getElementById('setting-auditor-name');
  const settingLoc = document.getElementById('setting-location');
  const settingDate = document.getElementById('setting-audit-date');
  const btnSaveSettings = document.getElementById('btn-save-settings');

  const saveSettingsHandler = () => {
    if (!requireAdmin('แก้ไขการตั้งค่าเซสชัน')) return;

    if (settingAuditor) state.sessionMeta.auditorName = settingAuditor.value.trim() || 'Senior IT Auditor';
    if (settingLoc) state.sessionMeta.location = settingLoc.value.trim() || 'Server Room 70';
    if (settingDate && settingDate.value) state.sessionMeta.auditDate = settingDate.value;

    saveSessionMeta();
    updateHeaderSessionInfo();
    renderReports();

    const indicator = document.getElementById('settings-save-indicator');
    if (indicator) {
      indicator.classList.remove('hidden');
      setTimeout(() => indicator.classList.add('hidden'), 2500);
    }
  };

  if (settingAuditor) settingAuditor.addEventListener('input', saveSettingsHandler);
  if (settingLoc) settingLoc.addEventListener('input', saveSettingsHandler);
  if (settingDate) settingDate.addEventListener('change', saveSettingsHandler);
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      if (requireAdmin('บันทึกการตั้งค่าเซสชัน')) {
        saveSettingsHandler();
        showToast('บันทึกการตั้งค่าเซสชันเรียบร้อยแล้ว');
      }
    });
  }

  // Quick Action Buttons: Reset Data
  const btnResetData = document.getElementById('btn-reset-data');
  if (btnResetData) {
    btnResetData.addEventListener('click', () => {
      if (!requireAdmin('รีเซ็ตข้อมูลระบบ')) return;

      if (confirm('คุณต้องการรีเซ็ตข้อมูลการตรวจเช็กทั้งหมดเป็นค่าเริ่มต้น ใช่หรือไม่? (ข้อมูลบน Cloud จะถูกรีเซ็ตด้วย)')) {
        loadMasterInventory();
        initNewSession();
        if (isFirebaseConnected) {
          syncAllToCloud();
        }
        showToast('รีเซ็ตข้อมูลเป็นค่าเริ่มต้นเรียบร้อยแล้ว');
        renderApp();
      }
    });
  }

  // Theme Toggle Button
  const btnThemeToggle = document.getElementById('theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', toggleTheme);
  }

  // Modal Close buttons
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Modal Backdrop Click to close
  document.querySelectorAll('.modal-window').forEach(modalEl => {
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) {
        closeAllModals();
      }
    });
  });

  // Global ESC Key to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
      closeMobileSidebar();
    }
  });

  // Device Image File Upload (Audit Item Modal)
  const imgInput = document.getElementById('form-audit-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', async (e) => {
      if (!requireAdmin('อัปโหลดภาพถ่ายอุปกรณ์')) return;
      const file = e.target.files[0];
      if (!file) return;
      
      const uploadedUrl = await uploadImageToServer(file);
      if (uploadedUrl) {
        state.currentEditingImage = uploadedUrl;
        showImagePreview(uploadedUrl);
      }
    });
  }

  const btnRemoveImg = document.getElementById('btn-remove-image');
  if (btnRemoveImg) {
    btnRemoveImg.addEventListener('click', () => {
      state.currentEditingImage = null;
      hideImagePreview();
      if (imgInput) imgInput.value = '';
    });
  }

  // Save Audit Form
  const auditForm = document.getElementById('audit-item-form');
  if (auditForm) {
    auditForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveItemAudit();
    });
  }

  // Delete Item from Modal
  const btnDeleteItem = document.getElementById('btn-delete-item');
  if (btnDeleteItem) {
    btnDeleteItem.addEventListener('click', () => {
      if (state.editingItem) {
        deleteItem(state.editingItem.rackId, state.editingItem.itemNo);
      }
    });
  }

  // Add-Item Image File Upload
  const addImgInput = document.getElementById('form-add-image-input');
  if (addImgInput) {
    addImgInput.addEventListener('change', async (e) => {
      if (!requireAdmin('อัปโหลดภาพถ่ายอุปกรณ์')) return;
      const file = e.target.files[0];
      if (!file) return;
      
      const uploadedUrl = await uploadImageToServer(file);
      if (uploadedUrl) {
        state.currentAddingImage = uploadedUrl;
        showAddImagePreview(uploadedUrl);
      }
    });
  }

  const btnAddRemoveImg = document.getElementById('btn-add-remove-image');
  if (btnAddRemoveImg) {
    btnAddRemoveImg.addEventListener('click', () => {
      state.currentAddingImage = null;
      hideAddImagePreview();
      if (addImgInput) addImgInput.value = '';
    });
  }

  // Save Add Item Form
  const addItemForm = document.getElementById('add-item-form');
  if (addItemForm) {
    addItemForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveNewItem();
    });
  }

  // Switch to edit from View-Only Modal
  const btnSwitchEdit = document.getElementById('btn-view-switch-edit');
  if (btnSwitchEdit) {
    btnSwitchEdit.addEventListener('click', () => {
      if (state.viewingItem) {
        const { rackId, itemNo } = state.viewingItem;
        closeAllModals();
        if (requireAdmin('ตรวจเช็กและแก้ไขข้อมูล')) {
          openAuditModal(rackId, itemNo);
        }
      }
    });
  }

  // Print button & Print Lifecycle Event Handlers
  let isPrintingDarkMode = false;
  window.addEventListener('beforeprint', () => {
    isPrintingDarkMode = document.documentElement.classList.contains('dark');
    if (isPrintingDarkMode) {
      document.documentElement.classList.remove('dark');
    }
    renderReports();
  });

  window.addEventListener('afterprint', () => {
    if (isPrintingDarkMode) {
      document.documentElement.classList.add('dark');
    }
  });

  const btnPrintReport = document.getElementById('btn-print-report');
  if (btnPrintReport) {
    btnPrintReport.addEventListener('click', () => {
      switchTab('reports');
      renderReports();
      setTimeout(() => {
        window.print();
      }, 150);
    });
  }

  // Export JSON/CSV
  const btnExportJson = document.getElementById('btn-export-json');
  if (btnExportJson) {
    btnExportJson.addEventListener('click', exportAuditJSON);
  }

  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', exportAuditCSV);
  }

  // New Period Form Submission
  const newPeriodForm = document.getElementById('new-period-form');
  if (newPeriodForm) {
    newPeriodForm.addEventListener('submit', (e) => {
      e.preventDefault();
      saveNewPeriod();
    });
  }

  // Historical Snapshot Modal Actions
  const btnHistRestore = document.getElementById('btn-history-restore');
  if (btnHistRestore) {
    btnHistRestore.addEventListener('click', () => {
      if (state.viewingHistoryId) {
        restoreHistoricalSession(state.viewingHistoryId);
      }
    });
  }

  const btnHistExportCsv = document.getElementById('btn-history-export-csv');
  if (btnHistExportCsv) {
    btnHistExportCsv.addEventListener('click', () => {
      if (state.viewingHistoryId) {
        exportHistoricalSessionCSV(state.viewingHistoryId);
      }
    });
  }

  const btnHistExportJson = document.getElementById('btn-history-export-json');
  if (btnHistExportJson) {
    btnHistExportJson.addEventListener('click', () => {
      if (state.viewingHistoryId) {
        exportHistoricalSessionJSON(state.viewingHistoryId);
      }
    });
  }

  // PWA Install Button Handlers
  const btnHeaderPwa = document.getElementById('btn-header-pwa-install');
  if (btnHeaderPwa) {
    btnHeaderPwa.addEventListener('click', handlePwaInstall);
  }

  const btnSidebarPwa = document.getElementById('btn-sidebar-pwa-install');
  if (btnSidebarPwa) {
    btnSidebarPwa.addEventListener('click', handlePwaInstall);
  }

  const btnBannerPwa = document.getElementById('btn-banner-pwa-install');
  if (btnBannerPwa) {
    btnBannerPwa.addEventListener('click', handlePwaInstall);
  }
}

/**
 * Image Upload Helper Functions
 */
function showImagePreview(src) {
  const dropzone = document.getElementById('image-upload-dropzone');
  const wrapper = document.getElementById('image-preview-wrapper');
  const img = document.getElementById('form-audit-image-preview');
  if (dropzone && wrapper && img) {
    img.src = src;
    dropzone.classList.add('hidden');
    wrapper.classList.remove('hidden');
  }
}

function hideImagePreview() {
  const dropzone = document.getElementById('image-upload-dropzone');
  const wrapper = document.getElementById('image-preview-wrapper');
  const img = document.getElementById('form-audit-image-preview');
  if (dropzone && wrapper && img) {
    img.src = '';
    dropzone.classList.remove('hidden');
    wrapper.classList.add('hidden');
  }
}

function showAddImagePreview(src) {
  const dropzone = document.getElementById('add-image-upload-dropzone');
  const wrapper = document.getElementById('add-image-preview-wrapper');
  const img = document.getElementById('form-add-image-preview');
  if (dropzone && wrapper && img) {
    img.src = src;
    dropzone.classList.add('hidden');
    wrapper.classList.remove('hidden');
  }
}

function hideAddImagePreview() {
  const dropzone = document.getElementById('add-image-upload-dropzone');
  const wrapper = document.getElementById('add-image-preview-wrapper');
  const img = document.getElementById('form-add-image-preview');
  if (dropzone && wrapper && img) {
    img.src = '';
    dropzone.classList.remove('hidden');
    wrapper.classList.add('hidden');
  }
}

window.openPhotoViewer = function(rackId, itemIdOrNo) {
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;
  const item = rack.items.find(i => (i.id && i.id === itemIdOrNo) || i.item_no === itemIdOrNo);
  if (!item || !item.audit_image) return;

  const modal = document.getElementById('photo-viewer-modal');
  const title = document.getElementById('photo-viewer-title');
  const img = document.getElementById('photo-viewer-img');

  if (modal && title && img) {
    title.innerHTML = `<i class="fa-solid fa-camera text-blue-600 mr-2"></i>ภาพถ่ายอุปกรณ์ ${escapeHTML(item.item_no)} (${escapeHTML(item.name_description.replace(/\n/g, ' '))})`;
    img.src = item.audit_image;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

/**
 * Switch Active Tab
 */
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.add('hidden');
  });

  const activePanel = document.getElementById(`tab-${tabName}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
  }

  document.querySelectorAll('[data-tab-target]').forEach(navBtn => {
    const isTarget = navBtn.getAttribute('data-tab-target') === tabName;
    if (navBtn.classList.contains('mobile-nav-item')) {
      if (isTarget) {
        navBtn.classList.add('text-blue-600', 'dark:text-blue-400', 'font-bold');
        navBtn.classList.remove('text-slate-500', 'dark:text-slate-400', 'font-medium');
      } else {
        navBtn.classList.remove('text-blue-600', 'dark:text-blue-400', 'font-bold');
        navBtn.classList.add('text-slate-500', 'dark:text-slate-400', 'font-medium');
      }
    } else {
      if (isTarget) {
        navBtn.classList.add('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-600/20');
        navBtn.classList.remove('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-100', 'dark:hover:bg-slate-800');
      } else {
        navBtn.classList.remove('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-600/20');
        navBtn.classList.add('text-slate-600', 'dark:text-slate-400', 'hover:bg-slate-100', 'dark:hover:bg-slate-800');
      }
    }
  });

  closeMobileSidebar();
  renderApp();
}

/**
 * Mobile Sidebar Drawer Controllers
 */
window.toggleMobileSidebar = function() {
  const sidebar = document.getElementById('sidebar-menu');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar || !backdrop) return;

  const isClosed = sidebar.classList.contains('-translate-x-full');
  if (isClosed) {
    sidebar.classList.remove('-translate-x-full');
    backdrop.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-100', 'pointer-events-auto');
  } else {
    closeMobileSidebar();
  }
};

window.closeMobileSidebar = function() {
  const sidebar = document.getElementById('sidebar-menu');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar || !backdrop) return;

  sidebar.classList.add('-translate-x-full');
  backdrop.classList.remove('opacity-100', 'pointer-events-auto');
  backdrop.classList.add('opacity-0', 'pointer-events-none');
  setTimeout(() => {
    backdrop.classList.add('hidden');
  }, 200);
};

/**
 * Render All Views
 */
function renderApp() {
  updateHeaderSessionInfo();
  updateAuthUI();
  renderDashboard();
  renderChecklist();
  renderRackMap();
  renderReports();
  renderHistory();
  populateRackFilterOptions();
}

function updateSettingsInputs() {
  const settingAuditor = document.getElementById('setting-auditor-name');
  const settingLoc = document.getElementById('setting-location');
  const settingDate = document.getElementById('setting-audit-date');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnResetData = document.getElementById('btn-reset-data');

  if (settingAuditor) {
    settingAuditor.value = state.sessionMeta.auditorName || 'Senior IT Auditor';
    settingAuditor.disabled = !authState.isLoggedIn;
  }
  if (settingLoc) {
    settingLoc.value = state.sessionMeta.location || 'Server Room 70';
    settingLoc.disabled = !authState.isLoggedIn;
  }
  if (settingDate) {
    settingDate.value = state.sessionMeta.auditDate || new Date().toISOString().split('T')[0];
    settingDate.disabled = !authState.isLoggedIn;
  }

  if (btnSaveSettings) {
    btnSaveSettings.disabled = !authState.isLoggedIn;
    if (!authState.isLoggedIn) {
      btnSaveSettings.classList.add('opacity-60', 'cursor-not-allowed');
    } else {
      btnSaveSettings.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }

  if (btnResetData) {
    btnResetData.disabled = !authState.isLoggedIn;
    if (!authState.isLoggedIn) {
      btnResetData.classList.add('opacity-60', 'cursor-not-allowed');
    } else {
      btnResetData.classList.remove('opacity-60', 'cursor-not-allowed');
    }
  }
}

function updateHeaderSessionInfo() {
  const sessionEl = document.getElementById('header-session-id');
  if (sessionEl) sessionEl.textContent = state.sessionMeta.sessionId;
  
  const stats = calculateOverallStats();
  const progressBadge = document.getElementById('header-progress-badge');
  if (progressBadge) {
    progressBadge.textContent = `ตรวจแล้ว ${stats.checkedItems}/${stats.totalItems} (${stats.progressPct}%)`;
  }
}

function populateRackFilterOptions() {
  const rackFilter = document.getElementById('rack-filter');
  if (!rackFilter || rackFilter.options.length > 1) return;

  rackFilter.innerHTML = '<option value="all">-- ทุกหมวดหมู่ / ตู้ Rack --</option>';
  state.inventory.forEach(rack => {
    const opt = document.createElement('option');
    opt.value = rack.rack_id;
    opt.textContent = `${rack.rack_no}. ${rack.rack_name}`;
    rackFilter.appendChild(opt);
  });
}

/**
 * Statistics Calculator
 */
function calculateOverallStats() {
  let totalItems = 0;
  let passCount = 0;
  let damagedCount = 0;
  let missingCount = 0;
  let maintenanceCount = 0;
  let unusedCount = 0;
  let pendingCount = 0;
  let totalWeight = 0;
  let discrepancyCount = 0;

  state.inventory.forEach(rack => {
    rack.items.forEach(item => {
      totalItems++;
      if (item.weight && !isNaN(parseFloat(item.weight))) {
        totalWeight += parseFloat(item.weight);
      }

      if (item.audit_status === 'PASS') passCount++;
      else if (item.audit_status === 'DAMAGED') damagedCount++;
      else if (item.audit_status === 'MISSING') missingCount++;
      else if (item.audit_status === 'MAINTENANCE') maintenanceCount++;
      else if (item.audit_status === 'UNUSED') unusedCount++;
      else pendingCount++;

      if (item.audit_status !== 'PENDING' && Number(item.audited_qty) !== Number(item.system_qty)) {
        discrepancyCount++;
      }
    });
  });

  const checkedItems = totalItems - pendingCount;
  const progressPct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;

  return {
    totalItems,
    checkedItems,
    pendingCount,
    passCount,
    damagedCount,
    missingCount,
    maintenanceCount,
    unusedCount,
    progressPct,
    totalWeight: totalWeight.toFixed(2),
    discrepancyCount
  };
}

/**
 * Render Dashboard View
 */
function renderDashboard() {
  const stats = calculateOverallStats();

  const elTotal = document.getElementById('stat-total-items');
  const elProgressPct = document.getElementById('stat-progress-pct');
  const elProgressBar = document.getElementById('stat-progress-bar');
  const elPass = document.getElementById('stat-pass-count');
  const elDamaged = document.getElementById('stat-damaged-count');
  const elMissing = document.getElementById('stat-missing-count');
  const elMaintenance = document.getElementById('stat-maintenance-count');
  const elUnused = document.getElementById('stat-unused-count');
  const elDiscrepancy = document.getElementById('stat-discrepancy-count');
  const elWeight = document.getElementById('stat-total-weight');

  if (elTotal) elTotal.textContent = stats.totalItems;
  if (elProgressPct) elProgressPct.textContent = `${stats.progressPct}%`;
  if (elProgressBar) elProgressBar.style.width = `${stats.progressPct}%`;
  if (elPass) elPass.textContent = stats.passCount;
  if (elDamaged) elDamaged.textContent = stats.damagedCount;
  if (elMissing) elMissing.textContent = stats.missingCount;
  if (elMaintenance) elMaintenance.textContent = stats.maintenanceCount;
  if (elUnused) elUnused.textContent = stats.unusedCount;
  if (elDiscrepancy) elDiscrepancy.textContent = stats.discrepancyCount;
  if (elWeight) elWeight.textContent = `${stats.totalWeight}`;

  renderCategoryProgressList();
  renderRecentAuditLogs();
}

function renderCategoryProgressList() {
  const container = document.getElementById('dashboard-category-progress');
  if (!container) return;

  let html = '';
  state.inventory.forEach(rack => {
    const total = rack.items.length;
    const checked = rack.items.filter(i => i.audit_status !== 'PENDING').length;
    const pct = total > 0 ? Math.round((checked / total) * 100) : 0;

    let badgeColor = 'bg-blue-600';
    if (pct === 100) badgeColor = 'bg-emerald-500';
    else if (pct === 0) badgeColor = 'bg-slate-400 dark:bg-slate-600';

    html += `
      <div class="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/50 flex flex-col gap-2 transition-all hover:border-slate-300">
        <div class="flex justify-between items-center text-sm">
          <span class="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[240px]" title="${escapeHTML(rack.rack_name)}">
            <i class="fa-solid fa-server text-blue-600 dark:text-blue-400 mr-2"></i>${escapeHTML(rack.rack_no)}. ${escapeHTML(rack.rack_name)}
          </span>
          <span class="text-xs text-slate-500 dark:text-slate-400 font-mono font-medium">${checked}/${total} (${pct}%)</span>
        </div>
        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
          <div class="${badgeColor} h-2 rounded-full transition-all duration-300" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function renderRecentAuditLogs() {
  const container = document.getElementById('recent-audit-logs');
  if (!container) return;

  const auditedItems = [];
  state.inventory.forEach(rack => {
    rack.items.forEach(item => {
      if (item.audited_at) {
        auditedItems.push(item);
      }
    });
  });

  auditedItems.sort((a, b) => new Date(b.audited_at) - new Date(a.audited_at));
  const recent = auditedItems.slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-slate-400 dark:text-slate-500 text-sm">ยังไม่มีประวัติการบันทึกตรวจเช็กในเซสชันนี้</div>`;
    return;
  }

  let html = '';
  recent.forEach(item => {
    const statusBadge = getStatusBadgeHTML(item.audit_status);
    const dateStr = item.audited_at ? new Date(item.audited_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';

    html += `
      <div class="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between gap-3 text-sm">
        <div class="flex items-center gap-3 overflow-hidden">
          ${item.audit_image ? `
            <img src="${item.audit_image}" onclick="openPhotoViewer('${escapeHTML(item.rack_id)}', '${escapeHTML(item.item_no)}')" class="w-9 h-9 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 flex-shrink-0" title="ดูภาพถ่าย">
          ` : `
            <div class="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 text-slate-700 dark:text-slate-300 font-semibold text-xs font-mono">
              ${escapeHTML(item.item_no)}
            </div>
          `}
          <div class="truncate">
            <div class="font-medium text-slate-800 dark:text-slate-200 truncate" title="${escapeHTML(item.name_description.replace(/\n/g, ' '))}">${escapeHTML(item.name_description.replace(/\n/g, ' '))}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">S/N: ${item.serial_number ? escapeHTML(item.serial_number) : '-'} | ครุภัณฑ์: ${item.official_asset_no ? escapeHTML(item.official_asset_no) : '-'}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          ${statusBadge}
          <span class="text-xs text-slate-400 font-mono">${dateStr}</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Natural Sort, Reordering & Auto-Renumbering Helpers
 */
function naturalCompareItemNo(aNo, bNo) {
  if (!aNo && !bNo) return 0;
  if (!aNo) return 1;
  if (!bNo) return -1;
  return aNo.localeCompare(bNo, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Move item within a rack up or down
 */
window.moveItem = function(rackId, itemIndex, direction) {
  if (!requireAdmin('สลับหรือเปลี่ยนลำดับอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack || !Array.isArray(rack.items)) return;

  const newIndex = itemIndex + direction;
  if (newIndex < 0 || newIndex >= rack.items.length) return;

  // Swap items
  const item = rack.items.splice(itemIndex, 1)[0];
  rack.items.splice(newIndex, 0, item);

  // Auto renumber sequentially to keep natural numbering
  autoRenumberRackItems(rackId, false);

  saveData();
  renderApp();
  showToast(`ย้ายลำดับ "${item.name_description.replace(/\n/g, ' ')}" เป็นข้อ ${item.item_no} เรียบร้อยแล้ว`);
};

/**
 * Auto renumber all items in a rack (e.g., 5.1, 5.2, 5.3 ... 5.10, 5.11)
 */
window.autoRenumberRackItems = function(rackId, showFeedback = true) {
  if (showFeedback && !requireAdmin('รันเลขลำดับใหม่อัตโนมัติ')) return;

  if (rackId === 'all') {
    state.inventory.forEach(rack => {
      rack.items.forEach((item, idx) => {
        item.item_no = `${rack.rack_no}.${idx + 1}`;
      });
    });
  } else {
    const rack = state.inventory.find(r => r.rack_id === rackId);
    if (!rack) return;
    rack.items.forEach((item, idx) => {
      item.item_no = `${rack.rack_no}.${idx + 1}`;
    });
  }

  saveData();
  renderApp();
  if (showFeedback) {
    showToast(`รันหมายเลขลำดับใหม่อัตโนมัติเรียบร้อยแล้ว`);
  }
};

/**
 * Auto sort items in a rack naturally by item_no
 */
window.autoSortRackItemsNaturally = function(rackId) {
  if (!requireAdmin('จัดเรียงลำดับอุปกรณ์')) return;

  if (rackId === 'all') {
    state.inventory.forEach(rack => {
      rack.items.sort((a, b) => naturalCompareItemNo(a.item_no, b.item_no));
    });
  } else {
    const rack = state.inventory.find(r => r.rack_id === rackId);
    if (!rack) return;
    rack.items.sort((a, b) => naturalCompareItemNo(a.item_no, b.item_no));
  }

  saveData();
  renderApp();
  showToast(`จัดเรียงลำดับตามตัวเลขแบบธรรมชาติเรียบร้อยแล้ว`);
};

// Drag & Drop State
let dragSrcRackId = null;
let dragSrcIndex = null;

window.handleRowDragStart = function(e, rackId, index) {
  if (!authState.isLoggedIn) {
    e.preventDefault();
    return false;
  }
  dragSrcRackId = rackId;
  dragSrcIndex = index;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', JSON.stringify({ rackId, index }));
  const target = e.currentTarget || e.target;
  if (target) {
    target.classList.add('is-dragging');
  }
};

window.handleRowDragOver = function(e, element, rackId, index) {
  if (!authState.isLoggedIn || dragSrcRackId !== rackId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const rect = element.getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const isBottom = relY > rect.height / 2;

  element.classList.remove('drag-over-top', 'drag-over-bottom');
  if (isBottom) {
    element.classList.add('drag-over-bottom');
  } else {
    element.classList.add('drag-over-top');
  }
};

window.handleRowDragLeave = function(e, element) {
  element.classList.remove('drag-over-top', 'drag-over-bottom');
};

window.handleRowDrop = function(e, targetRackId, targetIndex) {
  if (!authState.isLoggedIn || dragSrcRackId !== targetRackId) return;
  e.preventDefault();

  const targetEl = e.currentTarget;
  const rect = targetEl.getBoundingClientRect();
  const isBottom = (e.clientY - rect.top) > rect.height / 2;

  targetEl.classList.remove('drag-over-top', 'drag-over-bottom');

  const rack = state.inventory.find(r => r.rack_id === targetRackId);
  if (!rack || dragSrcIndex === null || dragSrcIndex === undefined) return;

  const item = rack.items.splice(dragSrcIndex, 1)[0];
  let insertIndex = targetIndex;
  if (isBottom && dragSrcIndex < targetIndex) {
    insertIndex = targetIndex;
  } else if (isBottom && dragSrcIndex > targetIndex) {
    insertIndex = targetIndex + 1;
  } else if (!isBottom && dragSrcIndex < targetIndex) {
    insertIndex = targetIndex - 1;
  }

  if (insertIndex < 0) insertIndex = 0;
  if (insertIndex > rack.items.length) insertIndex = rack.items.length;

  rack.items.splice(insertIndex, 0, item);

  // Auto renumber to maintain natural sequence
  autoRenumberRackItems(targetRackId, false);

  saveData();
  renderApp();
  showToast(`ย้ายลำดับ "${item.name_description.replace(/\n/g, ' ')}" เป็นข้อ ${item.item_no} เรียบร้อยแล้ว`);
};

window.handleRowDragEnd = function(e) {
  document.querySelectorAll('.checklist-row, .checklist-card').forEach(el => {
    el.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom');
  });
  dragSrcRackId = null;
  dragSrcIndex = null;
};

/**
 * Render Physical Audit Checklist View
 */
function renderChecklist() {
  const container = document.getElementById('checklist-items-container');
  if (!container) return;

  // Add Item Button State (Admin vs Visitor)
  const btnAdd = document.getElementById('btn-open-add-modal');
  if (btnAdd) {
    if (authState.isLoggedIn) {
      btnAdd.innerHTML = '<i class="fa-solid fa-plus"></i> เพิ่มเนื้อหา / อุปกรณ์ใหม่';
      btnAdd.className = 'w-full sm:w-auto px-4 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-600/25 flex items-center justify-center gap-2 transition-all';
      btnAdd.onclick = openAddItemModal;
    } else {
      btnAdd.innerHTML = '<i class="fa-solid fa-lock text-[11px]"></i> เพิ่มอุปกรณ์ใหม่ (ต้อง Login)';
      btnAdd.className = 'w-full sm:w-auto px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all';
      btnAdd.onclick = () => {
        showToast('กรุณาเข้าสู่ระบบด้วยสิทธิ์เจ้าหน้าที่เพื่อเพิ่มอุปกรณ์ใหม่');
        openLoginModal();
      };
    }
  }

  let filteredRacks = state.inventory;
  if (state.selectedRackId !== 'all') {
    filteredRacks = state.inventory.filter(r => r.rack_id === state.selectedRackId);
  }

  let totalMatched = 0;
  let html = '';

  filteredRacks.forEach(rack => {
    const matchingItems = rack.items.filter(item => {
      if (state.filterStatus !== 'all' && item.audit_status !== state.filterStatus) {
        return false;
      }
      if (state.searchQuery) {
        const name = (item.name_description || '').toLowerCase();
        const sn = (item.serial_number || '').toLowerCase();
        const asset = (item.official_asset_no || '').toLowerCase();
        const itemNo = (item.item_no || '').toLowerCase();
        const refNo = (item.ref_no || '').toLowerCase();

        return name.includes(state.searchQuery) ||
               sn.includes(state.searchQuery) ||
               asset.includes(state.searchQuery) ||
               itemNo.includes(state.searchQuery) ||
               refNo.includes(state.searchQuery);
      }
      return true;
    });

    if (matchingItems.length === 0) return;
    totalMatched += matchingItems.length;

    const pendingCountInRack = rack.items.filter(i => i.audit_status === 'PENDING').length;

    html += `
      <div class="glass-panel rounded-2xl overflow-hidden mb-6 border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900 shadow-sm">
        <!-- Rack Category Header -->
        <div class="bg-slate-100/90 dark:bg-slate-800/90 px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/70 flex flex-wrap justify-between items-center gap-3">
          <div class="flex items-center gap-2 sm:gap-3">
            <span class="px-2.5 py-1 text-xs font-bold rounded-md bg-blue-50 dark:bg-blue-600/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 font-mono">
              ข้อ ${escapeHTML(rack.rack_no)}
            </span>
            <h3 class="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">${escapeHTML(rack.rack_name)}</h3>
            <span class="text-xs text-slate-400 font-mono hidden sm:inline">(${rack.items.length} รายการ)</span>
          </div>

          <div class="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
            <span class="hidden md:inline text-slate-500 dark:text-slate-400 font-mono">หมายเลขตู้: ${rack.asset_no ? escapeHTML(rack.asset_no) : '-'}</span>
            <span class="px-2.5 py-1 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 font-semibold font-mono">${rack.qty ? escapeHTML(rack.qty) : '-'}</span>
            
            ${authState.isLoggedIn ? `
              <button onclick="autoRenumberRackItems('${escapeHTML(rack.rack_id)}')" class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 transition-all flex items-center gap-1 shadow-xs" title="รันหมายเลขข้อใหม่อัตโนมัติตามลำดับ (เช่น ${escapeHTML(rack.rack_no)}.1, ${escapeHTML(rack.rack_no)}.2...)">
                <i class="fa-solid fa-arrow-down-1-9"></i> รันเลขลำดับ
              </button>
            ` : ''}

            ${authState.isLoggedIn && pendingCountInRack > 0 ? `
              <button onclick="batchPassRack('${escapeHTML(rack.rack_id)}')" class="px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 transition-all flex items-center gap-1.5 shadow-sm" title="ทำเครื่องหมายว่าปกติทั้งหมดในหมวดหมู่นี้">
                <i class="fa-solid fa-check-double"></i> ตรวจผ่านทั้งตู้ (${pendingCountInRack})
              </button>
            ` : pendingCountInRack === 0 ? `
              <span class="px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <i class="fa-solid fa-circle-check"></i> ตรวจครบแล้ว
              </span>
            ` : ''}
          </div>
        </div>

        <!-- Desktop Table View (md:block) -->
        <div class="hidden md:block overflow-x-auto modal-scrollable">
          <table class="w-full text-left text-xs sm:text-sm min-w-[760px]">
            <thead class="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[11px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th class="py-3 px-3 w-28 text-center">${authState.isLoggedIn ? 'ลำดับ / ย้าย' : 'ลำดับ'}</th>
                <th class="py-3 px-4">รายการอุปกรณ์ / ยี่ห้อ - รุ่น</th>
                <th class="py-3 px-4 w-36">Serial Number</th>
                <th class="py-3 px-4 w-36">หมายเลขครุภัณฑ์</th>
                <th class="py-3 px-4 w-28 text-center">จำนวนในระบบ</th>
                <th class="py-3 px-4 w-32 text-center">สถานะตรวจเช็ก</th>
                <th class="py-3 px-4 w-32 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
    `;

    matchingItems.forEach(item => {
      const realIndex = rack.items.findIndex(i => (i.id && i.id === item.id) || i.item_no === item.item_no);
      const statusBadge = getStatusBadgeHTML(item.audit_status);
      const isDiscrepancy = item.audit_status !== 'PENDING' && Number(item.audited_qty) !== Number(item.system_qty);

      html += `
        <tr class="checklist-row hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${isDiscrepancy ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}"
            data-rack-id="${escapeHTML(rack.rack_id)}"
            data-item-index="${realIndex}"
            data-item-id="${escapeHTML(item.id || '')}"
            ${authState.isLoggedIn ? `draggable="true" ondragstart="handleRowDragStart(event, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragover="handleRowDragOver(event, this, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragleave="handleRowDragLeave(event, this)" ondrop="handleRowDrop(event, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragend="handleRowDragEnd(event)"` : ''}>
          <td class="py-3.5 px-3 text-center">
            <div class="flex items-center justify-center gap-1.5">
              ${authState.isLoggedIn ? `
                <span class="drag-handle text-slate-300 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 cursor-grab" title="ลากเพื่อสลับลำดับ">
                  <i class="fa-solid fa-grip-vertical text-xs"></i>
                </span>
              ` : ''}
              <span class="font-semibold font-mono text-slate-600 dark:text-slate-300 text-xs">${escapeHTML(item.item_no)}</span>
              ${authState.isLoggedIn ? `
                <div class="inline-flex flex-col gap-0.5 ml-0.5">
                  <button type="button" onclick="moveItem('${escapeHTML(rack.rack_id)}', ${realIndex}, -1)" ${realIndex === 0 ? 'disabled' : ''} class="btn-move-arrow" title="เลื่อนขึ้น">
                    <i class="fa-solid fa-chevron-up"></i>
                  </button>
                  <button type="button" onclick="moveItem('${escapeHTML(rack.rack_id)}', ${realIndex}, 1)" ${realIndex === rack.items.length - 1 ? 'disabled' : ''} class="btn-move-arrow" title="เลื่อนลง">
                    <i class="fa-solid fa-chevron-down"></i>
                  </button>
                </div>
              ` : ''}
            </div>
          </td>
          <td class="py-3.5 px-4">
            <div class="font-medium text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed">${escapeHTML(item.name_description)}</div>
            ${item.weight ? `<div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">ค่าตัวถ่วงน้ำหนัก: ${escapeHTML(item.weight)}</div>` : ''}
            ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 mt-1 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}
            ${item.audit_image ? `
              <div class="mt-2 flex items-center gap-2">
                <img src="${item.audit_image}" onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')" class="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity shadow-sm" title="คลิกดูภาพขยาย">
                <span onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer hover:underline flex items-center gap-1">
                  <i class="fa-solid fa-camera"></i> ดูภาพถ่ายอุปกรณ์
                </span>
              </div>
            ` : ''}
          </td>
          <td class="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 text-xs">${item.serial_number ? escapeHTML(item.serial_number) : '<span class="text-slate-400">-</span>'}</td>
          <td class="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 text-xs">${item.official_asset_no ? escapeHTML(item.official_asset_no) : '<span class="text-slate-400">-</span>'}</td>
          <td class="py-3.5 px-4 text-center font-mono font-medium">
            <span class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">${item.total_quantity ? escapeHTML(item.total_quantity) : '1'}</span>
            ${isDiscrepancy ? `<div class="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-1">นับได้: ${item.audited_qty}</div>` : ''}
          </td>
          <td class="py-3.5 px-4 text-center">${statusBadge}</td>
          <td class="py-3.5 px-4 text-center">
            ${authState.isLoggedIn ? `
              <button onclick="openAuditModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')"
                      class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-600/20 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40 transition-all flex items-center justify-center gap-1.5 mx-auto shadow-sm">
                <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
              </button>
            ` : `
              <button onclick="openViewItemModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')"
                      class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all flex items-center justify-center gap-1.5 mx-auto">
                <i class="fa-solid fa-eye"></i> ดูรายละเอียด
              </button>
            `}
          </td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>

        <!-- Mobile Touch Cards View (md:hidden) -->
        <div class="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60 p-3 space-y-3">
    `;

    matchingItems.forEach(item => {
      const realIndex = rack.items.findIndex(i => (i.id && i.id === item.id) || i.item_no === item.item_no);
      const statusBadge = getStatusBadgeHTML(item.audit_status);
      const isDiscrepancy = item.audit_status !== 'PENDING' && Number(item.audited_qty) !== Number(item.system_qty);

      html += `
        <div class="checklist-card pt-3 first:pt-0 space-y-2.5 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-800/40"
             data-rack-id="${escapeHTML(rack.rack_id)}"
             data-item-index="${realIndex}"
             data-item-id="${escapeHTML(item.id || '')}"
             ${authState.isLoggedIn ? `draggable="true" ondragstart="handleRowDragStart(event, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragover="handleRowDragOver(event, this, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragleave="handleRowDragLeave(event, this)" ondrop="handleRowDrop(event, '${escapeHTML(rack.rack_id)}', ${realIndex})" ondragend="handleRowDragEnd(event)"` : ''}>
          <div class="flex justify-between items-center gap-2">
            <div class="flex items-center gap-1.5">
              ${authState.isLoggedIn ? `
                <span class="drag-handle text-slate-400 dark:text-slate-500 hover:text-blue-600 p-1 cursor-grab" title="ลากเพื่อสลับลำดับ">
                  <i class="fa-solid fa-grip-vertical text-xs"></i>
                </span>
              ` : ''}
              <span class="px-2 py-0.5 text-xs font-bold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono border border-slate-200 dark:border-slate-700">
                ${escapeHTML(item.item_no)}
              </span>
              ${authState.isLoggedIn ? `
                <div class="flex items-center gap-1 ml-1">
                  <button type="button" onclick="moveItem('${escapeHTML(rack.rack_id)}', ${realIndex}, -1)" ${realIndex === 0 ? 'disabled' : ''} class="btn-move-arrow" title="เลื่อนขึ้น">
                    <i class="fa-solid fa-chevron-up"></i>
                  </button>
                  <button type="button" onclick="moveItem('${escapeHTML(rack.rack_id)}', ${realIndex}, 1)" ${realIndex === rack.items.length - 1 ? 'disabled' : ''} class="btn-move-arrow" title="เลื่อนลง">
                    <i class="fa-solid fa-chevron-down"></i>
                  </button>
                </div>
              ` : ''}
            </div>
            <div>${statusBadge}</div>
          </div>
          
          <div class="font-medium text-slate-900 dark:text-slate-100 text-xs leading-relaxed whitespace-pre-line">
            ${escapeHTML(item.name_description)}
          </div>

          <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div class="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg border border-slate-200/70 dark:border-slate-700/60">
              <span class="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-sans font-semibold">Serial Number</span>
              <span class="text-slate-800 dark:text-slate-200 truncate block">${item.serial_number ? escapeHTML(item.serial_number) : '-'}</span>
            </div>
            <div class="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg border border-slate-200/70 dark:border-slate-700/60">
              <span class="text-slate-400 dark:text-slate-500 block text-[10px] uppercase font-sans font-semibold">หมายเลขครุภัณฑ์</span>
              <span class="text-slate-800 dark:text-slate-200 truncate block">${item.official_asset_no ? escapeHTML(item.official_asset_no) : '-'}</span>
            </div>
          </div>

          <div class="flex justify-between items-center text-xs font-mono">
            <span class="text-slate-500 dark:text-slate-400">ระบุ: <strong class="text-slate-800 dark:text-slate-200">${item.total_quantity ? escapeHTML(item.total_quantity) : '1'}</strong> ${isDiscrepancy ? `<span class="text-amber-600 dark:text-amber-400 font-bold ml-1">(นับ: ${item.audited_qty})</span>` : ''}</span>
            ${item.audit_image ? `
              <span onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-camera"></i> ดูรูปภาพ
              </span>
            ` : ''}
          </div>

          ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}

          ${authState.isLoggedIn ? `
            <button onclick="openAuditModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')"
                    class="w-full py-2.5 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center justify-center gap-1.5 transition-all">
              <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
            </button>
          ` : `
            <button onclick="openViewItemModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.id || item.item_no)}')"
                    class="w-full py-2.5 px-3 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-all">
              <i class="fa-solid fa-eye"></i> ดูรายละเอียด
            </button>
          `}
        </div>
      `;
    });

    html += `
        </div>

      </div>
    `;
  });

  if (totalMatched === 0) {
    container.innerHTML = `
      <div class="glass-panel p-12 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <i class="fa-solid fa-folder-open text-4xl text-slate-400 dark:text-slate-600 mb-3"></i>
        <h4 class="text-lg font-semibold text-slate-700 dark:text-slate-300">ไม่พบรายการอุปกรณ์ตามเงื่อนไขที่เลือก</h4>
        <p class="text-sm text-slate-500 dark:text-slate-500 mt-1">ลองเปลี่ยนคำค้นหา หรือเลือกตัวกรองสถานะเป็น "ทั้งหมด"</p>
      </div>
    `;
    return;
  }

  container.innerHTML = html;
}

/**
 * Render 2D Rack Elevation Map with Search & Filter highlighting
 */
function renderRackMap() {
  const container = document.getElementById('rack-elevation-grid');
  if (!container) return;

  let html = '';

  state.inventory.forEach(rack => {
    const totalItems = rack.items.length;
    const passCount = rack.items.filter(i => i.audit_status === 'PASS').length;
    const damagedCount = rack.items.filter(i => i.audit_status === 'DAMAGED' || i.audit_status === 'MISSING' || i.audit_status === 'MAINTENANCE').length;
    const pendingCount = rack.items.filter(i => i.audit_status === 'PENDING').length;

    html += `
      <div class="rack-container glass-panel flex flex-col justify-between">
        <!-- Rack Header -->
        <div class="rack-header mb-3">
          <div class="flex justify-between items-center">
            <span class="font-bold text-xs uppercase text-blue-600 dark:text-blue-400 font-mono">ZONE ${escapeHTML(rack.rack_no)}</span>
            <div class="flex items-center gap-1.5">
              <span class="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">${totalItems} รายการ</span>
              ${authState.isLoggedIn && pendingCount > 0 ? `
                <button onclick="batchPassRack('${escapeHTML(rack.rack_id)}')" class="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 font-semibold transition-all" title="ตรวจผ่านทั้งตู้">
                  <i class="fa-solid fa-check"></i> ผ่านทั้งหมด
                </button>
              ` : ''}
            </div>
          </div>
          <div class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate mt-1" title="${escapeHTML(rack.rack_name)}">${escapeHTML(rack.rack_name)}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">Asset: ${rack.asset_no ? escapeHTML(rack.asset_no) : 'N/A'}</div>
        </div>

        <!-- Rack Slot Items -->
        <div class="flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-[380px] pr-1 modal-scrollable">
    `;

    rack.items.forEach(item => {
      let isMatch = true;

      // Status filter check
      if (state.filterStatus !== 'all' && item.audit_status !== state.filterStatus) {
        isMatch = false;
      }

      // Search query check
      if (state.searchQuery) {
        const query = state.searchQuery;
        const name = (item.name_description || '').toLowerCase();
        const sn = (item.serial_number || '').toLowerCase();
        const asset = (item.official_asset_no || '').toLowerCase();
        const itemNo = (item.item_no || '').toLowerCase();
        const refNo = (item.ref_no || '').toLowerCase();

        if (!name.includes(query) && !sn.includes(query) && !asset.includes(query) && !itemNo.includes(query) && !refNo.includes(query)) {
          isMatch = false;
        }
      }

      let statusClass = 'status-pending';
      let ledClass = 'led-pending';
      if (item.audit_status === 'PASS') { statusClass = 'status-pass'; ledClass = 'led-pass'; }
      else if (item.audit_status === 'DAMAGED') { statusClass = 'status-damaged'; ledClass = 'led-damaged'; }
      else if (item.audit_status === 'MISSING') { statusClass = 'status-missing'; ledClass = 'led-missing'; }
      else if (item.audit_status === 'MAINTENANCE') { statusClass = 'status-maintenance'; ledClass = 'led-maintenance'; }
      else if (item.audit_status === 'UNUSED') { statusClass = 'status-unused'; ledClass = 'led-unused'; }

      const opacityStyle = isMatch ? '' : 'opacity-25 grayscale';

      html += `
        <div onclick="openViewItemModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')"
             class="rack-slot ${statusClass} cursor-pointer group ${opacityStyle}"
             title="คลิกเพื่อดูรายละเอียด: ${escapeHTML(item.name_description)}">
          <span class="${ledClass}"></span>
          <div class="flex-1 overflow-hidden">
            <div class="flex justify-between items-center text-xs">
              <span class="font-mono font-bold text-slate-800 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-300">${escapeHTML(item.item_no)}</span>
              <span class="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-semibold flex items-center gap-1">
                ${item.audit_image ? `<i class="fa-solid fa-camera text-blue-600 dark:text-blue-400"></i>` : ''}
                ${item.total_quantity ? escapeHTML(item.total_quantity) : '1'}
              </span>
            </div>
            <div class="text-[11px] text-slate-700 dark:text-slate-200 truncate font-medium group-hover:text-slate-900 dark:group-hover:text-white">${escapeHTML(item.name_description.replace(/\n/g, ' '))}</div>
          </div>
        </div>
      `;
    });

    html += `
        </div>

        <!-- Rack Footer Stats -->
        <div class="mt-3 pt-2.5 border-t border-slate-200 dark:border-slate-700/60 flex justify-between items-center text-[11px] text-slate-500 dark:text-slate-400 font-medium">
          <span>ผ่าน: <strong class="text-emerald-600 dark:text-emerald-400">${passCount}</strong></span>
          <span>ปัญหา: <strong class="text-red-600 dark:text-red-400">${damagedCount}</strong></span>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Render Reports & Official Printable View
 */
function renderReports() {
  const elReportDate = document.getElementById('report-date');
  const elAuditor = document.getElementById('report-auditor');
  const elSessionId = document.getElementById('report-session-id');
  const elLocation = document.getElementById('report-location');
  const elSigAuditor = document.getElementById('report-sig-auditor');

  if (elReportDate) elReportDate.textContent = state.sessionMeta.auditDate;
  if (elAuditor) elAuditor.textContent = state.sessionMeta.auditorName;
  if (elSessionId) elSessionId.textContent = state.sessionMeta.sessionId;
  if (elLocation) elLocation.textContent = state.sessionMeta.location;
  if (elSigAuditor) elSigAuditor.textContent = state.sessionMeta.auditorName;

  // Render Print & Screen Summary KPIs Bar
  const summaryBar = document.getElementById('report-summary-bar');
  if (summaryBar) {
    const stats = calculateOverallStats();
    const issueCount = stats.damagedCount + stats.missingCount + stats.maintenanceCount;
    summaryBar.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>สรุปตรวจนับ:</span>
        <span>รวม <strong>${stats.totalItems}</strong> รายการ</span>
        <span>| ปกติ: <strong class="text-emerald-600 dark:text-emerald-400 status-text-pass">${stats.passCount}</strong></span>
        <span>| ปัญหา: <strong class="text-red-600 dark:text-red-400 status-text-damaged">${issueCount}</strong></span>
        <span>| รอตรวจ: <strong class="text-slate-500 status-text-pending">${stats.pendingCount}</strong></span>
        <span>| ยอดคลาดเคลื่อน: <strong class="text-amber-600 status-text-missing">${stats.discrepancyCount}</strong></span>
      </div>
      <div>
        <span>ค่าตัวถ่วงน้ำหนักรวม: <strong>${stats.totalWeight}</strong></span>
        <span class="ml-1 font-mono">(${stats.progressPct}%)</span>
      </div>
    `;
  }

  const tableBody = document.getElementById('report-table-body');
  if (!tableBody) return;

  let html = '';

  state.inventory.forEach(rack => {
    let itemsToRender = rack.items;

    if (state.reportFilter === 'issues') {
      itemsToRender = rack.items.filter(i => i.audit_status === 'DAMAGED' || i.audit_status === 'MISSING' || i.audit_status === 'MAINTENANCE');
    } else if (state.reportFilter === 'discrepancies') {
      itemsToRender = rack.items.filter(i => i.audit_status !== 'PENDING' && Number(i.audited_qty) !== Number(i.system_qty));
    }

    if (itemsToRender.length === 0 && state.reportFilter !== 'all') return;

    // Section Header Row (with rack-section-row class for page-break-after: avoid)
    html += `
      <tr class="rack-section-row bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-200">
        <td colspan="8" class="py-2 px-3 border border-slate-200 dark:border-slate-700">
          ข้อ ${escapeHTML(rack.rack_no)}. ${escapeHTML(rack.rack_name)} (หมายเลขตู้: ${rack.asset_no ? escapeHTML(rack.asset_no) : '-'})
        </td>
      </tr>
    `;

    itemsToRender.forEach(item => {
      const statusThai = getStatusThaiName(item.audit_status);
      let statusClass = 'status-text-pending';
      if (item.audit_status === 'PASS') statusClass = 'status-text-pass';
      else if (item.audit_status === 'DAMAGED') statusClass = 'status-text-damaged';
      else if (item.audit_status === 'MISSING') statusClass = 'status-text-missing';
      else if (item.audit_status === 'MAINTENANCE') statusClass = 'status-text-maintenance';
      else if (item.audit_status === 'UNUSED') statusClass = 'status-text-unused';

      html += `
        <tr class="border-b border-slate-200 dark:border-slate-800 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/30">
          <td class="py-2 px-2 text-center border border-slate-200 dark:border-slate-700 font-mono col-print-no">${escapeHTML(item.item_no)}</td>
          <td class="py-2 px-3 border border-slate-200 dark:border-slate-700 font-medium whitespace-pre-line col-print-name">${escapeHTML(item.name_description)}</td>
          <td class="py-2 px-2 border border-slate-200 dark:border-slate-700 font-mono col-print-sn">${item.serial_number ? escapeHTML(item.serial_number) : '-'}</td>
          <td class="py-2 px-2 border border-slate-200 dark:border-slate-700 font-mono col-print-asset">${item.official_asset_no ? escapeHTML(item.official_asset_no) : '-'}</td>
          <td class="py-2 px-2 border border-slate-200 dark:border-slate-700 text-center font-mono col-print-qty">${item.total_quantity ? escapeHTML(item.total_quantity) : '1'}</td>
          <td class="py-1.5 px-2 border border-slate-200 dark:border-slate-700 text-center font-mono col-print-weight">
            ${authState.isLoggedIn && authState.role === 'ADMIN' ? `
              <div class="inline-flex items-center justify-center gap-1">
                <input type="number" step="0.001" min="0" 
                       value="${item.weight !== undefined && item.weight !== null ? escapeHTML(item.weight) : ''}" 
                       placeholder="0.00"
                       title="คลิกเพื่อแก้ไขค่าตัวถ่วงน้ำหนัก"
                       onchange="updateItemWeight('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}', this.value)"
                       class="w-16 px-1.5 py-0.5 text-xs text-center font-mono bg-blue-50/60 dark:bg-slate-800 border border-blue-200 dark:border-blue-700/60 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-900 dark:text-slate-100 font-semibold shadow-xs">
              </div>
            ` : `
              <span>${item.weight ? `${escapeHTML(item.weight)}` : '-'}</span>
            `}
          </td>
          <td class="py-2 px-2 border border-slate-200 dark:border-slate-700 text-center font-semibold ${statusClass} col-print-status">${statusThai}</td>
          <td class="py-2 px-2 border border-slate-200 dark:border-slate-700 text-xs col-print-notes">
            <div>${escapeHTML(item.audit_notes || '-')}</div>
            ${item.audit_image && state.reportShowPhotos ? `
              <div class="mt-1">
                <img src="${item.audit_image}" class="report-photo-thumb" alt="ภาพถ่าย">
              </div>
            ` : item.audit_image ? `<div class="mt-0.5 font-semibold text-blue-600 dark:text-blue-400 text-[10px]">[มีรูปถ่าย]</div>` : ''}
          </td>
        </tr>
      `;
    });
  });

  tableBody.innerHTML = html || `<tr><td colspan="8" class="py-6 text-center text-slate-400">ไม่พบรายการตามตัวกรองรายงานที่เลือก</td></tr>`;
}

/**
 * Open Audit Modal Dialog (Staff Only)
 */
/**
 * Open Audit Modal Dialog (Staff Only)
 */
window.openAuditModal = function(rackId, itemIdOrNo) {
  // if (!requireAdmin('ตรวจเช็กและแก้ไขข้อมูลอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => (i.id && i.id === itemIdOrNo) || i.item_no === itemIdOrNo);
  if (!item) return;

  state.editingItem = { rackId, itemId: item.id, itemNo: item.item_no };
  state.currentEditingImage = item.audit_image || null;

  document.getElementById('modal-item-no').textContent = item.item_no;
  document.getElementById('modal-item-sysqty').textContent = item.total_quantity;
  document.getElementById('modal-item-weight').textContent = (item.weight !== '' && item.weight !== null && item.weight !== undefined) ? `${item.weight}` : '-';

  // Populate Editable Device Info Fields
  document.getElementById('form-item-name').value = item.name_description || '';
  document.getElementById('form-item-sn').value = item.serial_number || '';
  document.getElementById('form-item-asset').value = item.official_asset_no || '';
  const weightInput = document.getElementById('form-item-weight');
  if (weightInput) {
    weightInput.value = (item.weight !== undefined && item.weight !== null) ? item.weight : '';
  }

  // Form Audit Status Fields
  document.getElementById('form-audit-status').value = item.audit_status;
  document.getElementById('form-audit-qty').value = item.audited_qty;
  document.getElementById('form-audit-notes').value = item.audit_notes || '';

  // Handle Image Preview
  const imgInput = document.getElementById('form-audit-image-input');
  if (imgInput) imgInput.value = '';
  
  if (item.audit_image) {
    showImagePreview(item.audit_image);
  } else {
    hideImagePreview();
  }

  const modal = document.getElementById('audit-item-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

function closeAllModals() {
  document.querySelectorAll('.modal-window').forEach(m => {
    m.classList.add('hidden');
    m.classList.remove('flex');
  });
  document.body.classList.remove('modal-open');
  state.editingItem = null;
  state.currentEditingImage = null;
  state.currentAddingImage = null;
  state.viewingItem = null;
}

/**
 * Open Add New Item Modal (Staff Only)
 */
window.openAddItemModal = function() {
  if (!requireAdmin('เพิ่มอุปกรณ์ใหม่')) return;

  const rackSelect = document.getElementById('form-add-rack-id');
  if (rackSelect) {
    rackSelect.innerHTML = '';
    state.inventory.forEach(rack => {
      const opt = document.createElement('option');
      opt.value = rack.rack_id;
      opt.textContent = `${rack.rack_no}. ${rack.rack_name}`;
      rackSelect.appendChild(opt);
    });
    if (state.selectedRackId !== 'all') {
      rackSelect.value = state.selectedRackId;
    }
  }

  // Reset inputs
  document.getElementById('form-add-name').value = '';
  document.getElementById('form-add-sn').value = '';
  document.getElementById('form-add-asset').value = '';
  document.getElementById('form-add-qty-str').value = '1 หน่วย';
  document.getElementById('form-add-weight').value = '';
  document.getElementById('form-add-status').value = 'PASS';
  document.getElementById('form-add-notes').value = '';

  state.currentAddingImage = null;
  hideAddImagePreview();
  const imgInput = document.getElementById('form-add-image-input');
  if (imgInput) imgInput.value = '';

  const modal = document.getElementById('add-item-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

function saveNewItem() {
  if (!requireAdmin('เพิ่มอุปกรณ์ใหม่')) return;

  const rackId = document.getElementById('form-add-rack-id').value;
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) {
    alert('กรุณาเลือกหมวดหมู่ / ตู้ Rack');
    return;
  }

  const nameDesc = document.getElementById('form-add-name').value.trim();
  if (!nameDesc) {
    alert('กรุณาระบุชื่อรายการอุปกรณ์');
    return;
  }

  const sn = document.getElementById('form-add-sn').value.trim();
  const assetNo = document.getElementById('form-add-asset').value.trim();
  const qtyStr = document.getElementById('form-add-qty-str').value.trim() || '1 หน่วย';
  const weightVal = document.getElementById('form-add-weight').value.trim();
  const status = document.getElementById('form-add-status').value;
  const notes = document.getElementById('form-add-notes').value.trim();

  // Generate next item_no in rack (e.g., "5.13")
  const nextItemNo = `${rack.rack_no}.${rack.items.length + 1}`;
  const systemQty = parseQuantity(qtyStr);

  const newItem = {
    id: 'it_' + rack.rack_id + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
    item_no: nextItemNo,
    name_description: nameDesc,
    serial_number: sn,
    official_asset_no: assetNo,
    total_quantity: qtyStr,
    weight: weightVal ? (isNaN(Number(weightVal)) ? weightVal : Number(weightVal)) : '',
    rack_id: rack.rack_id,
    rack_name: rack.rack_name,
    system_qty: systemQty,
    audited_qty: systemQty,
    audit_status: status,
    audit_notes: notes,
    audit_image: state.currentAddingImage || null,
    audited_at: status !== 'PENDING' ? new Date().toISOString() : null,
    auditor: status !== 'PENDING' ? state.sessionMeta.auditorName : ''
  };

  rack.items.push(newItem);
  autoRenumberRackItems(rackId, false);
  saveData();
  closeAllModals();
  showToast(`เพิ่มอุปกรณ์ใหม่รายการ ${newItem.item_no} เรียบร้อยแล้ว`);
  renderApp();
}

/**
 * Delete Item Function (Staff Only)
 */
function deleteItem(rackId, itemIdOrNo) {
  if (!requireAdmin('ลบอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const itemIndex = rack.items.findIndex(i => (i.id && i.id === itemIdOrNo) || i.item_no === itemIdOrNo);
  if (itemIndex === -1) return;

  const item = rack.items[itemIndex];
  if (!confirm(`คุณต้องการลบรายการ ${item.item_no} "${item.name_description.replace(/\n/g, ' ')}" ใช่หรือไม่?`)) {
    return;
  }

  const deletedNo = item.item_no;
  rack.items.splice(itemIndex, 1);
  autoRenumberRackItems(rackId, false);
  saveData();
  closeAllModals();
  showToast(`ลบรายการ ${deletedNo} ออกจากระบบเรียบร้อยแล้ว`);
  renderApp();
}

/**
 * Batch Pass Rack (Staff Only)
 */
window.batchPassRack = function(rackId) {
  if (!requireAdmin('ตรวจผ่านทั้งตู้')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const pendingItems = rack.items.filter(i => i.audit_status === 'PENDING');
  if (pendingItems.length === 0) {
    showToast(`รายการใน ${rack.rack_name} ตรวจครบหมดแล้ว`);
    return;
  }

  if (!confirm(`คุณต้องการบันทึกว่าอุปกรณ์ใน "${rack.rack_name}" ทั้งหมด (${pendingItems.length} รายการที่รอตรวจ) สภาพปกติ (Pass) ใช่หรือไม่?`)) {
    return;
  }

  const now = new Date().toISOString();
  rack.items.forEach(item => {
    if (item.audit_status === 'PENDING') {
      item.audit_status = 'PASS';
      item.audited_qty = item.system_qty;
      item.audited_at = now;
      item.auditor = state.sessionMeta.auditorName;
    }
  });

  saveData();
  showToast(`บันทึกสถานะปกติให้กับ ${rack.rack_name} เรียบร้อยแล้ว`);
  renderApp();
};

/**
 * Open View Item Read-Only Modal (Available for all)
 */
window.openViewItemModal = function(rackId, itemIdOrNo) {
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => (i.id && i.id === itemIdOrNo) || i.item_no === itemIdOrNo);
  if (!item) return;

  state.viewingItem = { rackId, itemId: item.id, itemNo: item.item_no };

  document.getElementById('view-modal-item-no').textContent = item.item_no;
  document.getElementById('view-modal-rack-name').textContent = `${rack.rack_no}. ${rack.rack_name}`;
  document.getElementById('view-modal-status-badge').innerHTML = getStatusBadgeHTML(item.audit_status);
  document.getElementById('view-modal-item-name').textContent = item.name_description;
  document.getElementById('view-modal-item-sn').textContent = item.serial_number || '-';
  document.getElementById('view-modal-item-asset').textContent = item.official_asset_no || '-';
  document.getElementById('view-modal-sysqty').textContent = item.total_quantity;
  document.getElementById('view-modal-auditedqty').textContent = `${item.audited_qty} (${getStatusThaiName(item.audit_status)})`;
  document.getElementById('view-modal-weight').textContent = (item.weight !== '' && item.weight !== null && item.weight !== undefined) ? `${item.weight}` : '-';

  const notesEl = document.getElementById('view-modal-notes');
  const notesContainer = document.getElementById('view-modal-notes-container');
  if (notesEl && notesContainer) {
    if (item.audit_notes && item.audit_notes.trim()) {
      notesEl.textContent = item.audit_notes;
      notesContainer.classList.remove('hidden');
    } else {
      notesContainer.classList.add('hidden');
    }
  }

  const imgContainer = document.getElementById('view-modal-image-container');
  const imgImg = document.getElementById('view-modal-image-img');
  const imgClick = document.getElementById('view-modal-image-click');
  if (imgContainer && imgImg && imgClick) {
    if (item.audit_image) {
      imgImg.src = item.audit_image;
      imgClick.onclick = () => openPhotoViewer(rackId, item.id || item.item_no);
      imgContainer.classList.remove('hidden');
    } else {
      imgContainer.classList.add('hidden');
    }
  }

  // Update Edit button text based on role
  const btnSwitchEdit = document.getElementById('btn-view-switch-edit');
  if (btnSwitchEdit) {
    if (authState.isLoggedIn) {
      btnSwitchEdit.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไขข้อมูล';
      btnSwitchEdit.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-600/20 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40 transition-all flex items-center gap-1.5';
    } else {
      btnSwitchEdit.innerHTML = '<i class="fa-solid fa-lock text-[11px]"></i> เข้าสู่ระบบเพื่อแก้ไข';
      btnSwitchEdit.className = 'px-4 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all flex items-center gap-1.5';
    }
  }

  const modal = document.getElementById('view-item-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

function saveItemAudit() {
  if (!requireAdmin('บันทึกผลการตรวจเช็ก')) return;
  if (!state.editingItem) return;

  const { rackId, itemId, itemNo } = state.editingItem;
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => (itemId && i.id === itemId) || i.item_no === itemNo);
  if (!item) return;

  // Extract edited device details
  const editedName = document.getElementById('form-item-name').value.trim();
  const editedSn = document.getElementById('form-item-sn').value.trim();
  const editedAsset = document.getElementById('form-item-asset').value.trim();
  const weightInput = document.getElementById('form-item-weight');
  const editedWeight = weightInput ? weightInput.value.trim() : '';

  const status = document.getElementById('form-audit-status').value;
  const auditedQty = parseInt(document.getElementById('form-audit-qty').value, 10) || 1;
  const notes = document.getElementById('form-audit-notes').value.trim();

  // Update item properties
  if (editedName) item.name_description = editedName;
  item.serial_number = editedSn;
  item.official_asset_no = editedAsset;
  item.weight = editedWeight ? (isNaN(Number(editedWeight)) ? editedWeight : Number(editedWeight)) : '';

  item.audit_status = status;
  item.audited_qty = auditedQty;
  item.audit_notes = notes;
  item.audit_image = state.currentEditingImage || null;
  item.audited_at = new Date().toISOString();
  item.auditor = state.sessionMeta.auditorName;

  saveData();
  closeAllModals();
  showToast(`บันทึกผลการตรวจเช็กและอัปเดตข้อมูลรายการ ${item.item_no} สำเร็จ`);
  renderApp();
}

/**
 * Update Item Weight directly (Staff/Admin Only)
 */
window.updateItemWeight = function(rackId, itemIdOrNo, newWeight) {
  if (!requireAdmin('แก้ไขค่าตัวถ่วงน้ำหนักอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => (i.id && i.id === itemIdOrNo) || i.item_no === itemIdOrNo);
  if (!item) return;

  const trimmedWeight = String(newWeight).trim();
  item.weight = trimmedWeight ? (isNaN(Number(trimmedWeight)) ? trimmedWeight : Number(trimmedWeight)) : '';

  saveData();

  // Update summary stats
  const summaryBar = document.getElementById('report-summary-bar');
  if (summaryBar) {
    const stats = calculateOverallStats();
    const issueCount = stats.damagedCount + stats.missingCount + stats.maintenanceCount;
    summaryBar.innerHTML = `
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>สรุปตรวจนับ:</span>
        <span>รวม <strong>${stats.totalItems}</strong> รายการ</span>
        <span>| ปกติ: <strong class="text-emerald-600 dark:text-emerald-400 status-text-pass">${stats.passCount}</strong></span>
        <span>| ปัญหา: <strong class="text-red-600 dark:text-red-400 status-text-damaged">${issueCount}</strong></span>
        <span>| รอตรวจ: <strong class="text-slate-500 status-text-pending">${stats.pendingCount}</strong></span>
        <span>| ยอดคลาดเคลื่อน: <strong class="text-amber-600 status-text-missing">${stats.discrepancyCount}</strong></span>
      </div>
      <div>
        <span>ค่าตัวถ่วงน้ำหนักรวม: <strong>${stats.totalWeight}</strong></span>
        <span class="ml-1 font-mono">(${stats.progressPct}%)</span>
      </div>
    `;
  }
  showToast(`อัปเดตค่าตัวถ่วงน้ำหนักรายการ ${item.item_no} เป็น ${item.weight ? item.weight : '-'} เรียบร้อยแล้ว`);
};

/**
 * Export Audit Data Functions
 */
function exportAuditJSON() {
  const exportPayload = {
    sessionMeta: state.sessionMeta,
    stats: calculateOverallStats(),
    inventory: state.inventory
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `server_audit_${state.sessionMeta.sessionId}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('ส่งออกไฟล์ JSON สำเร็จ');
}

function exportAuditCSV() {
  let csv = '\uFEFF'; // UTF-8 BOM for Excel Thai language compatibility
  csv += 'ตู้/หมวดหมู่,หมายเลขตู้,ลำดับที่,รายการอุปกรณ์,Serial Number,หมายเลขครุภัณฑ์,จำนวนตามบัญชี,จำนวนตรวจนับจริง,สถานะตรวจเช็ก,ค่าตัวถ่วงน้ำหนัก,หมายเหตุ,ผู้ตรวจเช็ก,วันที่ตรวจ,มีภาพถ่าย\n';

  state.inventory.forEach(rack => {
    rack.items.forEach(item => {
      const rackNameClean = `"${rack.rack_name.replace(/"/g, '""')}"`;
      const rackAssetClean = `"${(rack.asset_no || '').replace(/"/g, '""')}"`;
      const nameClean = `"${item.name_description.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      const snClean = `"${(item.serial_number || '').replace(/"/g, '""')}"`;
      const assetClean = `"${(item.official_asset_no || '').replace(/"/g, '""')}"`;
      const weightClean = `"${(item.weight || '').replace(/"/g, '""')}"`;
      const notesClean = `"${(item.audit_notes || '').replace(/"/g, '""')}"`;
      const auditorClean = `"${(item.auditor || state.sessionMeta.auditorName).replace(/"/g, '""')}"`;
      const auditedDateClean = `"${item.audited_at ? new Date(item.audited_at).toLocaleDateString('th-TH') : '-'}"`;
      const statusThai = getStatusThaiName(item.audit_status);
      const hasPhoto = item.audit_image ? 'YES' : 'NO';

      csv += `${rackNameClean},${rackAssetClean},${item.item_no},${nameClean},${snClean},${assetClean},${item.system_qty},${item.audited_qty},${statusThai},${weightClean},${notesClean},${auditorClean},${auditedDateClean},${hasPhoto}\n`;
    });
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", url);
  downloadAnchor.setAttribute("download", `server_audit_${state.sessionMeta.sessionId}.csv`);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('ส่งออกไฟล์ CSV สำเร็จ');
}

/**
 * ==========================================================================
 * Audit History & Versioning Logic
 * ==========================================================================
 */

/**
 * Render Audit History Tab View
 */
function renderHistory() {
  // Update Active Period Summary Card
  const activeSessionId = document.getElementById('history-active-session-id');
  const activeTitle = document.getElementById('history-active-title');
  const activeAuditorDate = document.getElementById('history-active-auditor-date');
  const activeProgress = document.getElementById('history-active-progress');
  const activeKpi = document.getElementById('history-active-kpi');
  const totalCountBadge = document.getElementById('history-total-count-badge');

  const stats = calculateOverallStats();
  const issueCount = stats.damagedCount + stats.missingCount + stats.maintenanceCount;

  if (activeSessionId) activeSessionId.textContent = state.sessionMeta.sessionId;
  if (activeTitle) activeTitle.textContent = state.sessionMeta.periodTitle || 'รอบตรวจรับครุภัณฑ์';
  if (activeAuditorDate) activeAuditorDate.textContent = `${state.sessionMeta.auditorName} (${state.sessionMeta.auditDate})`;
  if (activeProgress) activeProgress.textContent = `ตรวจแล้ว ${stats.checkedItems}/${stats.totalItems} (${stats.progressPct}%)`;
  if (activeKpi) activeKpi.textContent = `ปกติ ${stats.passCount} | ปัญหา ${issueCount} | รอตรวจ ${stats.pendingCount}`;
  if (totalCountBadge) totalCountBadge.textContent = `${state.history.length} รอบที่บันทึก`;

  // Render Archived Snapshots List
  const container = document.getElementById('history-snapshots-list');
  if (!container) return;

  if (!state.history || state.history.length === 0) {
    container.innerHTML = `
      <div class="glass-panel p-8 text-center rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3">
        <div class="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl mx-auto shadow-xs">
          <i class="fa-solid fa-box-archive"></i>
        </div>
        <div class="space-y-1">
          <h4 class="font-bold text-slate-800 dark:text-slate-200 text-sm sm:text-base">ยังไม่มีประวัติรอบงวดที่ถูกจัดเก็บ (Archive)</h4>
          <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            คุณสามารถกดปุ่ม "บันทึก Snapshot งวดปัจจุบัน" เพื่อสำเนาผลการตรวจเช็กเก็บเป็นประวัติย้อนหลัง หรือกด "สร้างรอบตรวจใหม่" เมื่อเริ่มต้นงวดถัดไป
          </p>
        </div>
        ${authState.isLoggedIn ? `
          <button onclick="archiveCurrentSessionPrompt()" class="px-4 py-2 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 transition-all inline-flex items-center gap-1.5">
            <i class="fa-solid fa-box-archive"></i> บันทึก Snapshot งวดปัจจุบันเลย
          </button>
        ` : ''}
      </div>
    `;
    return;
  }

  let html = '';
  state.history.forEach((snapshot, idx) => {
    const sStats = snapshot.stats || { totalItems: 78, checkedItems: 78, progressPct: 100, passCount: 0, damagedCount: 0, missingCount: 0, maintenanceCount: 0, unusedCount: 0 };
    const sIssues = (sStats.damagedCount || 0) + (sStats.missingCount || 0) + (sStats.maintenanceCount || 0);
    const archivedDateStr = snapshot.archivedAt ? new Date(snapshot.archivedAt).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : snapshot.auditDate;

    let progressBg = 'bg-blue-600';
    if (sStats.progressPct === 100) progressBg = 'bg-emerald-500';

    html += `
      <div class="history-card glass-panel p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3.5">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div class="space-y-0.5">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 text-xs font-bold rounded-md bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-mono">
                งวดที่ #${state.history.length - idx}
              </span>
              <h4 class="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">${escapeHTML(snapshot.periodTitle || 'รอบตรวจครุภัณฑ์')}</h4>
            </div>
            <p class="text-xs text-slate-500 dark:text-slate-400 font-mono">
              รหัส: ${escapeHTML(snapshot.sessionId)} | วันที่ตรวจ: ${escapeHTML(snapshot.auditDate || '-')} | บันทึกเมื่อ: ${escapeHTML(archivedDateStr)}
            </p>
          </div>

          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button onclick="viewHistoricalSession('${escapeHTML(snapshot.historyId)}')" class="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-600 hover:text-white text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-700/50 transition-all flex items-center gap-1.5">
              <i class="fa-solid fa-file-lines"></i> ดูรายงาน
            </button>
            <button onclick="exportHistoricalSessionCSV('${escapeHTML(snapshot.historyId)}')" class="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all" title="Export CSV">
              <i class="fa-solid fa-file-csv text-emerald-600"></i>
            </button>
            <button onclick="exportHistoricalSessionJSON('${escapeHTML(snapshot.historyId)}')" class="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all" title="Export JSON">
              <i class="fa-solid fa-file-code text-blue-600"></i>
            </button>
            ${authState.isLoggedIn ? `
              <button onclick="restoreHistoricalSession('${escapeHTML(snapshot.historyId)}')" class="px-2.5 py-1.5 text-xs font-semibold rounded-xl bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-600 hover:text-white text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50 transition-all flex items-center gap-1" title="สลับงวดนี้กลับมาเป็นปัจจุบัน">
                <i class="fa-solid fa-rotate-left"></i> สลับใช้
              </button>
              <button onclick="deleteHistoricalSession('${escapeHTML(snapshot.historyId)}')" class="p-1.5 rounded-xl bg-red-50 dark:bg-red-900/20 hover:bg-red-600 hover:text-white text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/40 transition-all" title="ลบประวัติงวดนี้">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
          <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span class="text-[11px] text-slate-400 font-medium block">ผู้ตรวจเช็ก</span>
            <span class="font-bold text-slate-800 dark:text-slate-200 truncate block">${escapeHTML(snapshot.auditorName || '-')}</span>
          </div>
          <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span class="text-[11px] text-slate-400 font-medium block">ความคืบหน้า</span>
            <span class="font-mono font-bold text-blue-600 dark:text-blue-400 block">${sStats.checkedItems || 0}/${sStats.totalItems || 78} (${sStats.progressPct || 0}%)</span>
          </div>
          <div class="p-2.5 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
            <span class="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium block">อุปกรณ์ปกติ</span>
            <span class="font-mono font-bold text-emerald-700 dark:text-emerald-300 block">${sStats.passCount || 0} รายการ</span>
          </div>
          <div class="p-2.5 rounded-xl bg-red-50/50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/40">
            <span class="text-[11px] text-red-600 dark:text-red-400 font-medium block">รายการพบปัญหา</span>
            <span class="font-mono font-bold text-red-700 dark:text-red-300 block">${sIssues} รายการ</span>
          </div>
        </div>

        ${snapshot.notes ? `
          <p class="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 italic">
            <i class="fa-solid fa-quote-left text-slate-400 mr-1 text-[10px]"></i>${escapeHTML(snapshot.notes)}
          </p>
        ` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Open Create New Period Modal Dialog
 */
window.openNewPeriodModal = function() {
  if (!requireAdmin('สร้างรอบตรวจใหม่')) return;

  const titleInput = document.getElementById('new-period-title');
  const dateInput = document.getElementById('new-period-date');
  const auditorInput = document.getElementById('new-period-auditor');
  const locInput = document.getElementById('new-period-location');
  const notesInput = document.getElementById('new-period-notes');

  const currentYearBE = new Date().getFullYear() + 543;
  if (titleInput) titleInput.value = `รอบตรวจรับครุภัณฑ์ ประจำปีงบประมาณ ${currentYearBE}`;
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  if (auditorInput) auditorInput.value = state.sessionMeta.auditorName || 'Senior IT Auditor';
  if (locInput) locInput.value = state.sessionMeta.location || 'Server Room 70';
  if (notesInput) notesInput.value = '';

  const modal = document.getElementById('new-period-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
    if (titleInput) setTimeout(() => titleInput.focus(), 150);
  }
};

/**
 * Save New Period Form
 */
function saveNewPeriod() {
  if (!requireAdmin('สร้างรอบตรวจใหม่')) return;

  const title = document.getElementById('new-period-title').value.trim();
  const date = document.getElementById('new-period-date').value;
  const auditor = document.getElementById('new-period-auditor').value.trim() || 'Senior IT Auditor';
  const location = document.getElementById('new-period-location').value.trim() || 'Server Room 70';
  const notes = document.getElementById('new-period-notes').value.trim();
  const autoArchive = document.getElementById('new-period-auto-archive').checked;
  const initModeRadio = document.querySelector('input[name="new-period-init-mode"]:checked');
  const initMode = initModeRadio ? initModeRadio.value : 'clean';

  if (!title) {
    alert('กรุณาระบุชื่อรอบงวดการตรวจเช็ก');
    return;
  }

  // 1. Auto archive current session if requested
  if (autoArchive) {
    archiveCurrentSession(state.sessionMeta.periodTitle || 'รอบตรวจก่อนหน้า');
  }

  // 2. Setup new session meta
  state.sessionMeta = {
    sessionId: 'AUD-' + Date.now().toString().slice(-6),
    periodTitle: title,
    auditDate: date || new Date().toISOString().split('T')[0],
    auditorName: auditor,
    location: location,
    notes: notes,
    status: 'IN_PROGRESS'
  };

  // 3. Reset device inventory statuses if clean mode is selected
  if (initMode === 'clean') {
    state.inventory.forEach(rack => {
      rack.items.forEach(item => {
        item.audit_status = 'PENDING';
        item.audited_qty = item.system_qty;
        item.audited_at = null;
        item.auditor = '';
        item.audit_notes = '';
        item.audit_image = null;
      });
    });
  }

  saveData();
  saveSessionMeta();
  closeAllModals();
  switchTab('checklist');
  showToast(`สร้างรอบตรวจใหม่ "${title}" เรียบร้อยแล้ว`);
  renderApp();
}

/**
 * Archive Current Session to History
 */
function archiveCurrentSession(customTitle = null, customNotes = null) {
  const stats = calculateOverallStats();
  const snapshot = {
    historyId: 'HIST-' + Date.now(),
    sessionId: state.sessionMeta.sessionId,
    periodTitle: customTitle || state.sessionMeta.periodTitle || 'รอบตรวจรับครุภัณฑ์',
    auditDate: state.sessionMeta.auditDate,
    archivedAt: new Date().toISOString(),
    auditorName: state.sessionMeta.auditorName,
    location: state.sessionMeta.location,
    notes: customNotes || state.sessionMeta.notes || '',
    stats: stats,
    inventory: JSON.parse(JSON.stringify(state.inventory))
  };

  state.history.unshift(snapshot);
  saveHistory();
  renderHistory();
  return snapshot;
}

window.archiveCurrentSessionPrompt = function() {
  if (!requireAdmin('บันทึก Snapshot งวดปัจจุบัน')) return;

  const currentTitle = state.sessionMeta.periodTitle || 'รอบตรวจรับครุภัณฑ์';
  const customTitle = prompt('ระบุชื่อรอบงวดสำหรับจัดเก็บ Snapshot นี้:', currentTitle);
  if (customTitle === null) return; // User cancelled

  archiveCurrentSession(customTitle.trim() || currentTitle);
  showToast('บันทึก Snapshot งวดปัจจุบันเก็บเข้าประวัติเรียบร้อยแล้ว');
  renderHistory();
};

/**
 * View Historical Snapshot Modal
 */
window.viewHistoricalSession = function(historyId) {
  const snapshot = state.history.find(h => h.historyId === historyId);
  if (!snapshot) return;

  state.viewingHistoryId = historyId;

  document.getElementById('history-modal-title').textContent = snapshot.periodTitle || 'รอบตรวจในอดีต';
  const dateStr = snapshot.archivedAt ? new Date(snapshot.archivedAt).toLocaleDateString('th-TH') : snapshot.auditDate;
  document.getElementById('history-modal-subtitle').textContent = `รหัสเซสชัน: ${snapshot.sessionId} | วันที่ตรวจ: ${snapshot.auditDate} | ผู้ตรวจ: ${snapshot.auditorName}`;
  document.getElementById('history-modal-items-count').textContent = snapshot.inventory ? snapshot.inventory.reduce((acc, r) => acc + r.items.length, 0) : 78;

  // Render KPIs Box
  const kpiBar = document.getElementById('history-modal-kpi-bar');
  if (kpiBar) {
    const sStats = snapshot.stats || { totalItems: 78, progressPct: 100, passCount: 0, damagedCount: 0, missingCount: 0, maintenanceCount: 0 };
    const issues = (sStats.damagedCount || 0) + (sStats.missingCount || 0) + (sStats.maintenanceCount || 0);

    kpiBar.innerHTML = `
      <div class="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700">
        <span class="text-slate-400 dark:text-slate-500 block text-[11px]">ความคืบหน้า</span>
        <strong class="text-sm font-mono text-blue-600 dark:text-blue-400">${sStats.progressPct || 0}% (${sStats.checkedItems || 0}/${sStats.totalItems || 78})</strong>
      </div>
      <div class="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
        <span class="text-emerald-600 dark:text-emerald-400 block text-[11px]">ปกติ (Pass)</span>
        <strong class="text-sm font-mono text-emerald-700 dark:text-emerald-300">${sStats.passCount || 0} รายการ</strong>
      </div>
      <div class="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
        <span class="text-red-600 dark:text-red-400 block text-[11px]">พบปัญหา</span>
        <strong class="text-sm font-mono text-red-700 dark:text-red-300">${issues} รายการ</strong>
      </div>
      <div class="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
        <span class="text-purple-600 dark:text-purple-400 block text-[11px]">ค่าตัวถ่วงน้ำหนักรวม</span>
        <strong class="text-sm font-mono text-purple-700 dark:text-purple-300">${sStats.totalWeight || '0'}</strong>
      </div>
    `;
  }

  // Render Table Body
  const tableBody = document.getElementById('history-modal-table-body');
  if (tableBody && snapshot.inventory) {
    let rowsHtml = '';
    snapshot.inventory.forEach(rack => {
      rowsHtml += `
        <tr class="bg-slate-100/80 dark:bg-slate-800/80 font-bold text-slate-800 dark:text-slate-200 text-[11px]">
          <td colspan="6" class="py-1.5 px-3">ข้อ ${escapeHTML(rack.rack_no)}. ${escapeHTML(rack.rack_name)}</td>
        </tr>
      `;
      rack.items.forEach(item => {
        const statusBadge = getStatusBadgeHTML(item.audit_status);
        rowsHtml += `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
            <td class="py-2 px-3 text-center font-mono text-slate-400">${escapeHTML(item.item_no)}</td>
            <td class="py-2 px-3 font-medium">${escapeHTML(item.name_description.replace(/\n/g, ' '))}</td>
            <td class="py-2 px-3 font-mono text-slate-500">${item.serial_number ? escapeHTML(item.serial_number) : '-'}</td>
            <td class="py-2 px-3 font-mono text-slate-500">${item.official_asset_no ? escapeHTML(item.official_asset_no) : '-'}</td>
            <td class="py-2 px-3 text-center">${statusBadge}</td>
            <td class="py-2 px-3 text-slate-500 italic">${escapeHTML(item.audit_notes || '-')}</td>
          </tr>
        `;
      });
    });
    tableBody.innerHTML = rowsHtml;
  }

  const modal = document.getElementById('history-viewer-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
  }
};

/**
 * Restore Historical Session as Active Session
 */
window.restoreHistoricalSession = function(historyId) {
  if (!requireAdmin('กู้คืนหรือสลับรอบตรวจ')) return;

  const snapshot = state.history.find(h => h.historyId === historyId);
  if (!snapshot) return;

  if (!confirm(`คุณต้องการนำข้อมูลของ "${snapshot.periodTitle}" กลับมาเป็นรอบตรวจที่ใช้งานปัจจุบัน (Active Session) ใช่หรือไม่?`)) {
    return;
  }

  // Restore inventory & session meta
  state.inventory = JSON.parse(JSON.stringify(snapshot.inventory));
  state.sessionMeta = {
    sessionId: snapshot.sessionId || ('AUD-' + Date.now().toString().slice(-6)),
    periodTitle: snapshot.periodTitle,
    auditorName: snapshot.auditorName || 'Senior IT Auditor',
    auditDate: snapshot.auditDate || new Date().toISOString().split('T')[0],
    location: snapshot.location || 'Server Room 70',
    notes: snapshot.notes || '',
    status: 'IN_PROGRESS'
  };

  saveData();
  saveSessionMeta();
  closeAllModals();
  renderApp();
  switchTab('dashboard');
  showToast(`กู้คืนรอบตรวจ "${snapshot.periodTitle}" เป็นงวดปัจจุบันเรียบร้อยแล้ว`);
};

/**
 * Delete Historical Session Snapshot
 */
window.deleteHistoricalSession = function(historyId) {
  if (!requireAdmin('ลบประวัติรอบตรวจ')) return;

  const snapshot = state.history.find(h => h.historyId === historyId);
  if (!snapshot) return;

  if (!confirm(`คุณต้องการลบประวัติรอบตรวจ "${snapshot.periodTitle}" ออกจากระบบ ใช่หรือไม่?`)) {
    return;
  }

  state.history = state.history.filter(h => h.historyId !== historyId);
  saveHistory();
  renderHistory();
  showToast(`ลบประวัติรอบตรวจเรียบร้อยแล้ว`);
};

/**
 * Export Historical Snapshot
 */
window.exportHistoricalSessionCSV = function(historyId) {
  const snapshot = state.history.find(h => h.historyId === historyId);
  if (!snapshot || !snapshot.inventory) return;

  let csv = '\uFEFF';
  csv += 'รอบงวด,ตู้/หมวดหมู่,หมายเลขตู้,ลำดับที่,รายการอุปกรณ์,Serial Number,หมายเลขครุภัณฑ์,จำนวนตามบัญชี,จำนวนตรวจนับจริง,สถานะตรวจเช็ก,ค่าตัวถ่วงน้ำหนัก,หมายเหตุ,ผู้ตรวจเช็ก,วันที่ตรวจ\n';

  snapshot.inventory.forEach(rack => {
    rack.items.forEach(item => {
      const periodClean = `"${(snapshot.periodTitle || '').replace(/"/g, '""')}"`;
      const rackNameClean = `"${rack.rack_name.replace(/"/g, '""')}"`;
      const rackAssetClean = `"${(rack.asset_no || '').replace(/"/g, '""')}"`;
      const nameClean = `"${item.name_description.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      const snClean = `"${(item.serial_number || '').replace(/"/g, '""')}"`;
      const assetClean = `"${(item.official_asset_no || '').replace(/"/g, '""')}"`;
      const weightClean = `"${(item.weight || '').replace(/"/g, '""')}"`;
      const notesClean = `"${(item.audit_notes || '').replace(/"/g, '""')}"`;
      const auditorClean = `"${(item.auditor || snapshot.auditorName).replace(/"/g, '""')}"`;
      const auditedDateClean = `"${item.audited_at ? new Date(item.audited_at).toLocaleDateString('th-TH') : snapshot.auditDate}"`;
      const statusThai = getStatusThaiName(item.audit_status);

      csv += `${periodClean},${rackNameClean},${rackAssetClean},${item.item_no},${nameClean},${snClean},${assetClean},${item.system_qty},${item.audited_qty},${statusThai},${weightClean},${notesClean},${auditorClean},${auditedDateClean}\n`;
    });
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", url);
  downloadAnchor.setAttribute("download", `audit_history_${snapshot.sessionId}.csv`);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('ส่งออกไฟล์ประวัติ CSV สำเร็จ');
};

window.exportHistoricalSessionJSON = function(historyId) {
  const snapshot = state.history.find(h => h.historyId === historyId);
  if (!snapshot) return;

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snapshot, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `audit_history_${snapshot.sessionId}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('ส่งออกไฟล์ประวัติ JSON สำเร็จ');
};

/**
 * ==========================================================================
 * Progressive Web App (PWA) Handler Logic
 * ==========================================================================
 */
function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }

  // Handle beforeinstallprompt Event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaPrompt = e;
    showPwaInstallUI(true);
    console.log('[PWA] beforeinstallprompt event captured');
  });

  // Handle appinstalled Event
  window.addEventListener('appinstalled', () => {
    deferredPwaPrompt = null;
    showPwaInstallUI(false);
    showToast('ติดตั้งแอป MAserver สำเร็จแล้ว!');
  });
}

function showPwaInstallUI(show) {
  const headerBtn = document.getElementById('btn-header-pwa-install');
  const sidebarBox = document.getElementById('sidebar-pwa-install-box');
  const banner = document.getElementById('pwa-install-banner');

  if (show) {
    if (headerBtn) {
      headerBtn.classList.remove('hidden');
      headerBtn.classList.add('flex');
    }
    if (sidebarBox) sidebarBox.classList.remove('hidden');
    // Show banner after 3 seconds if not in standalone mode
    if (banner && !window.matchMedia('(display-mode: standalone)').matches) {
      setTimeout(() => {
        banner.classList.remove('hidden');
      }, 3000);
    }
  } else {
    if (headerBtn) {
      headerBtn.classList.add('hidden');
      headerBtn.classList.remove('flex');
    }
    if (sidebarBox) sidebarBox.classList.add('hidden');
    if (banner) banner.classList.add('hidden');
  }
}

async function handlePwaInstall() {
  if (!deferredPwaPrompt) {
    showToast('แอปพร้อมใช้งานแบบ PWA แล้ว คุณสามารถติดตั้งผ่านเมนูของเบราว์เซอร์ได้');
    return;
  }

  deferredPwaPrompt.prompt();
  const { outcome } = await deferredPwaPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('กำลังติดตั้งแอปลงอุปกรณ์...');
  }
  deferredPwaPrompt = null;
  dismissPwaBanner();
}

window.dismissPwaBanner = function() {
  const banner = document.getElementById('pwa-install-banner');
  if (banner) {
    banner.classList.add('hidden');
  }
};

/**
 * Helper Utilities
 */
function getStatusBadgeHTML(status) {
  switch (status) {
    case 'PASS':
      return `<span class="badge-pass px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-circle-check"></i> ปกติ (Pass)</span>`;
    case 'DAMAGED':
      return `<span class="badge-damaged px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-triangle-exclamation"></i> ชำรุด</span>`;
    case 'MISSING':
      return `<span class="badge-missing px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-circle-xmark"></i> สูญหาย</span>`;
    case 'MAINTENANCE':
      return `<span class="badge-maintenance px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-wrench"></i> รอซ่อมแซม</span>`;
    case 'UNUSED':
      return `<span class="badge-unused px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-ban"></i> ไม่ใช้งาน</span>`;
    default:
      return `<span class="badge-pending px-2.5 py-1 text-xs rounded-full flex items-center gap-1 w-max"><i class="fa-solid fa-clock"></i> รอตรวจ</span>`;
  }
}

function getStatusThaiName(status) {
  switch (status) {
    case 'PASS': return 'ปกติ';
    case 'DAMAGED': return 'ชำรุด';
    case 'MISSING': return 'สูญหาย';
    case 'MAINTENANCE': return 'รอซ่อมแซม';
    case 'UNUSED': return 'ไม่ใช้งาน';
    default: return 'รอตรวจ';
  }
}

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item glass-panel px-4 py-3 rounded-xl shadow-lg border border-blue-500/30 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm flex items-center gap-3 transition-all duration-300';
  toast.innerHTML = `<i class="fa-solid fa-circle-info text-blue-600 dark:text-blue-400"></i> <span>${escapeHTML(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Global scope bindings for inline HTML event handlers
window.switchTab = switchTab;
window.closeAllModals = closeAllModals;
window.performLogin = performLogin;
window.loginWithGoogleAdmin = loginWithGoogleAdmin;
window.handleLogout = handleLogout;
window.openLoginModal = openLoginModal;
window.saveData = saveData;
window.saveSessionMeta = saveSessionMeta;
window.saveItemAudit = saveItemAudit;
window.updateItemWeight = updateItemWeight;
window.saveNewItem = saveNewItem;
window.deleteItem = deleteItem;
window.exportAuditJSON = exportAuditJSON;
window.exportAuditCSV = exportAuditCSV;
window.showToast = showToast;
window.escapeHTML = escapeHTML;
window.toggleTheme = toggleTheme;
window.renderHistory = renderHistory;
window.saveNewPeriod = saveNewPeriod;
window.archiveCurrentSession = archiveCurrentSession;
window.handlePwaInstall = handlePwaInstall;
window.moveItem = moveItem;
window.autoRenumberRackItems = autoRenumberRackItems;
window.autoSortRackItemsNaturally = autoSortRackItemsNaturally;
window.handleRowDragStart = handleRowDragStart;
window.handleRowDragOver = handleRowDragOver;
window.handleRowDragLeave = handleRowDragLeave;
window.handleRowDrop = handleRowDrop;
window.handleRowDragEnd = handleRowDragEnd;

