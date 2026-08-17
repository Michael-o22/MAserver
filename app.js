/**
 * Server Room Asset & Physical Inventory Audit Application Logic
 * Reference: Checklist MAserver70.xlsx
 * Real-time Firebase Cloud Sync & GitHub Pages Deployment Ready
 */

const STORAGE_KEY_AUDIT_DATA = 'SERVER_ROOM_AUDIT_DATA_V1';
const STORAGE_KEY_SESSION_META = 'SERVER_ROOM_SESSION_META_V1';
const STORAGE_KEY_AUTH_SESSION = 'SERVER_ROOM_AUTH_SESSION_V1';
const STORAGE_KEY_THEME = 'SERVER_ROOM_THEME';

// Authentication Configuration
const AUTH_CONFIG = {
  username: 'admin',
  password: 'admin1234',
  sessionDurationMs: 30 * 60 * 1000 // 30 minutes
};

// Auth State
let authState = {
  isLoggedIn: false,
  role: 'VISITOR', // 'ADMIN' or 'VISITOR'
  username: '',
  loginTime: null,
  expiresAt: null
};

let sessionTimerInterval = null;

// Firebase Cloud Sync State
let firebaseApp = null;
let db = null;
let storage = null;
let isFirebaseConnected = false;
let isSyncingFromCloud = false;

// Initial App State
let state = {
  inventory: [],
  sessionMeta: {
    sessionId: '',
    auditorName: 'Senior IT Auditor',
    auditDate: new Date().toISOString().split('T')[0],
    location: 'Server Room 70',
    notes: 'การตรวจเช็กครุภัณฑ์ประจำงวดบำรุงรักษาประจำปี',
    status: 'IN_PROGRESS'
  },
  activeTab: 'dashboard',
  selectedRackId: 'all',
  searchQuery: '',
  filterStatus: 'all',
  reportFilter: 'all',
  reportShowPhotos: false,
  editingItem: null,
  currentEditingImage: null,
  currentAddingImage: null,
  viewingItem: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initAuth();
  initData();
  initFirebase();
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
 * Initialize Firebase Cloud Real-time Database & Storage
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
      isFirebaseConnected = true;
      updateCloudSyncBadge(true);
      listenToCloudUpdates();
      console.log('Firebase Cloud Real-time Sync initialized successfully.');
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
 * Real-time Listener on Firestore Document
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

        // Cache locally
        try {
          localStorage.setItem(STORAGE_KEY_AUDIT_DATA, JSON.stringify(state.inventory));
          localStorage.setItem(STORAGE_KEY_SESSION_META, JSON.stringify(state.sessionMeta));
        } catch (e) {
          console.warn('Local cache save error', e);
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
        syncAllToCloud();
      }
    }
  }, (error) => {
    console.warn('Firestore real-time subscription error:', error);
  });
}

/**
 * Sync Local State to Cloud Firestore
 */
async function syncAllToCloud() {
  if (!db || !isFirebaseConnected) {
    showToast('ยังไม่ได้เชื่อมต่อ Firebase หรืออยู่ในโหมด Local');
    return;
  }

  try {
    await db.collection('audit_sessions').doc('current_session').set({
      inventory: state.inventory,
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString(),
      updatedBy: authState.isLoggedIn ? state.sessionMeta.auditorName : 'System'
    }, { merge: true });
    showToast('ซิงค์ข้อมูลขึ้น Cloud Database เรียบร้อยแล้ว');
  } catch (err) {
    console.error('Error writing to Firestore', err);
    showToast('ไม่สามารถซิงค์ขึ้น Cloud ได้ (กรุณาตรวจสอบ Firestore Security Rules)');
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
      if (parsedAuth && parsedAuth.isLoggedIn && parsedAuth.expiresAt > now) {
        authState = parsedAuth;
        startSessionCountdown();
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

function startSessionCountdown() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);

  updateSessionTimerDisplay();
  sessionTimerInterval = setInterval(() => {
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
  if (!timerEl || !authState.isLoggedIn || !authState.expiresAt) return;

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
    username: '',
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
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');

  if (errorMsg) errorMsg.classList.add('hidden');
  if (usernameInput) usernameInput.value = '';
  if (passwordInput) {
    passwordInput.value = '';
    passwordInput.type = 'password';
  }
  const eyeIcon = document.getElementById('login-password-eye');
  if (eyeIcon) eyeIcon.className = 'fa-solid fa-eye';

  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('modal-open');
    if (usernameInput) setTimeout(() => usernameInput.focus(), 150);
  }
};

window.handleLogout = function() {
  if (confirm('คุณต้องการออกจากระบบเจ้าหน้าที่ ใช่หรือไม่?')) {
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
      username: cleanUser,
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
    showToast('เข้าสู่ระบบในฐานะเจ้าหน้าที่ (Admin) เรียบร้อยแล้ว (Session 30 นาที)');
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

  if (authState.isLoggedIn) {
    if (userBadge) {
      userBadge.classList.remove('hidden');
      userBadge.classList.add('flex');
    }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (sidebarRoleBadge) {
      sidebarRoleBadge.textContent = 'เจ้าหน้าที่ (Admin)';
      sidebarRoleBadge.className = 'px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 font-semibold font-mono';
    }
  } else {
    if (userBadge) {
      userBadge.classList.add('hidden');
      userBadge.classList.remove('flex');
    }
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (sidebarRoleBadge) {
      sidebarRoleBadge.textContent = 'บุคคลทั่วไป (Viewer)';
      sidebarRoleBadge.className = 'px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold font-mono';
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

function loadMasterInventory() {
  if (typeof MASTER_INVENTORY === 'undefined' || !Array.isArray(MASTER_INVENTORY)) {
    console.error('MASTER_INVENTORY data is missing or invalid');
    state.inventory = [];
    return;
  }

  // Deep clone MASTER_INVENTORY and inject audit default fields
  state.inventory = JSON.parse(JSON.stringify(MASTER_INVENTORY)).map(rack => {
    rack.items = rack.items.map(item => {
      const parsedQty = parseQuantity(item.total_quantity);
      return {
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

function initNewSession() {
  state.sessionMeta = {
    sessionId: 'AUD-' + Date.now().toString().slice(-6),
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
      console.warn('Failed to sync sessionMeta to Firestore', err);
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

      if (confirm('คุณต้องการรีเซ็ตข้อมูลการตรวจเช็กทั้งหมดเป็นค่าเริ่มต้นจาก Checklist MAserver70.xlsx ใช่หรือไม่? (ข้อมูลบน Cloud จะถูกรีเซ็ตด้วย)')) {
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

window.openPhotoViewer = function(rackId, itemNo) {
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;
  const item = rack.items.find(i => i.item_no === itemNo);
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
  if (elWeight) elWeight.textContent = `${stats.totalWeight} tons`;

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
          </div>

          <div class="flex items-center gap-2 sm:gap-3 text-xs">
            <span class="hidden sm:inline text-slate-500 dark:text-slate-400 font-mono">หมายเลขตู้: ${rack.asset_no ? escapeHTML(rack.asset_no) : '-'}</span>
            <span class="px-2.5 py-1 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 font-semibold font-mono">${rack.qty ? escapeHTML(rack.qty) : '-'}</span>
            
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
                <th class="py-3 px-4 w-14 text-center">ลำดับ</th>
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
      const statusBadge = getStatusBadgeHTML(item.audit_status);
      const isDiscrepancy = item.audit_status !== 'PENDING' && Number(item.audited_qty) !== Number(item.system_qty);

      html += `
        <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${isDiscrepancy ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}">
          <td class="py-3.5 px-4 text-center font-semibold font-mono text-slate-400">${escapeHTML(item.item_no)}</td>
          <td class="py-3.5 px-4">
            <div class="font-medium text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed">${escapeHTML(item.name_description)}</div>
            ${item.ref_no ? `<div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">Ref No: ${escapeHTML(item.ref_no)} | Weight: ${item.weight ? escapeHTML(item.weight) : '-'}</div>` : ''}
            ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 mt-1 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}
            ${item.audit_image ? `
              <div class="mt-2 flex items-center gap-2">
                <img src="${item.audit_image}" onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')" class="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity shadow-sm" title="คลิกดูภาพขยาย">
                <span onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer hover:underline flex items-center gap-1">
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
              <button onclick="openAuditModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')"
                      class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-600/20 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40 transition-all flex items-center justify-center gap-1.5 mx-auto shadow-sm">
                <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
              </button>
            ` : `
              <button onclick="openViewItemModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')"
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
      const statusBadge = getStatusBadgeHTML(item.audit_status);
      const isDiscrepancy = item.audit_status !== 'PENDING' && Number(item.audited_qty) !== Number(item.system_qty);

      html += `
        <div class="pt-3 first:pt-0 space-y-2.5">
          <div class="flex justify-between items-center gap-2">
            <span class="px-2 py-0.5 text-xs font-bold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono border border-slate-200 dark:border-slate-700">
              ${escapeHTML(item.item_no)}
            </span>
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
              <span onclick="openPhotoViewer('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-camera"></i> ดูรูปภาพ
              </span>
            ` : ''}
          </div>

          ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}

          ${authState.isLoggedIn ? `
            <button onclick="openAuditModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')"
                    class="w-full py-2.5 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center justify-center gap-1.5 transition-all">
              <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
            </button>
          ` : `
            <button onclick="openViewItemModal('${escapeHTML(rack.rack_id)}', '${escapeHTML(item.item_no)}')"
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
        <span>น้ำหนักรวม: <strong>${stats.totalWeight} ตัน</strong></span>
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
        <td colspan="7" class="py-2 px-3 border border-slate-200 dark:border-slate-700">
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

  tableBody.innerHTML = html || `<tr><td colspan="7" class="py-6 text-center text-slate-400">ไม่พบรายการตามตัวกรองรายงานที่เลือก</td></tr>`;
}

/**
 * Open Audit Modal Dialog (Staff Only)
 */
window.openAuditModal = function(rackId, itemNo) {
  if (!requireAdmin('ตรวจเช็กและแก้ไขข้อมูลอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => i.item_no === itemNo);
  if (!item) return;

  state.editingItem = { rackId, itemNo };
  state.currentEditingImage = item.audit_image || null;

  document.getElementById('modal-item-no').textContent = item.item_no;
  document.getElementById('modal-item-sysqty').textContent = item.total_quantity;
  document.getElementById('modal-item-weight').textContent = item.weight || '-';

  // Populate Editable Device Info Fields
  document.getElementById('form-item-name').value = item.name_description || '';
  document.getElementById('form-item-sn').value = item.serial_number || '';
  document.getElementById('form-item-asset').value = item.official_asset_no || '';

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
  document.getElementById('form-add-ref').value = '';
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
  const weightStr = document.getElementById('form-add-weight').value.trim();
  const refNo = document.getElementById('form-add-ref').value.trim();
  const status = document.getElementById('form-add-status').value;
  const notes = document.getElementById('form-add-notes').value.trim();

  // Generate next item_no in rack (e.g., "1.9")
  let maxSub = 0;
  rack.items.forEach(item => {
    if (item.item_no) {
      const parts = item.item_no.split('.');
      if (parts.length >= 2) {
        const sub = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(sub) && sub > maxSub) maxSub = sub;
      }
    }
  });
  const nextItemNo = `${rack.rack_no}.${maxSub + 1}`;
  const systemQty = parseQuantity(qtyStr);

  const newItem = {
    item_no: nextItemNo,
    ref_no: refNo,
    name_description: nameDesc,
    serial_number: sn,
    official_asset_no: assetNo,
    total_quantity: qtyStr,
    weight: weightStr,
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
  saveData();
  closeAllModals();
  showToast(`เพิ่มอุปกรณ์ใหม่รายการ ${nextItemNo} เรียบร้อยแล้ว`);
  renderApp();
}

/**
 * Delete Item Function (Staff Only)
 */
function deleteItem(rackId, itemNo) {
  if (!requireAdmin('ลบอุปกรณ์')) return;

  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const itemIndex = rack.items.findIndex(i => i.item_no === itemNo);
  if (itemIndex === -1) return;

  const item = rack.items[itemIndex];
  if (!confirm(`คุณต้องการลบรายการ ${item.item_no} "${item.name_description.replace(/\n/g, ' ')}" ใช่หรือไม่?`)) {
    return;
  }

  rack.items.splice(itemIndex, 1);
  saveData();
  closeAllModals();
  showToast(`ลบรายการ ${itemNo} ออกจากระบบเรียบร้อยแล้ว`);
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
window.openViewItemModal = function(rackId, itemNo) {
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => i.item_no === itemNo);
  if (!item) return;

  state.viewingItem = { rackId, itemNo };

  document.getElementById('view-modal-item-no').textContent = item.item_no;
  document.getElementById('view-modal-rack-name').textContent = `${rack.rack_no}. ${rack.rack_name}`;
  document.getElementById('view-modal-status-badge').innerHTML = getStatusBadgeHTML(item.audit_status);
  document.getElementById('view-modal-item-name').textContent = item.name_description;
  document.getElementById('view-modal-item-sn').textContent = item.serial_number || '-';
  document.getElementById('view-modal-item-asset').textContent = item.official_asset_no || '-';
  document.getElementById('view-modal-sysqty').textContent = item.total_quantity;
  document.getElementById('view-modal-auditedqty').textContent = `${item.audited_qty} (${getStatusThaiName(item.audit_status)})`;
  document.getElementById('view-modal-weight').textContent = item.weight ? `${item.weight} tons` : '-';

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
      imgClick.onclick = () => openPhotoViewer(rackId, itemNo);
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

  const { rackId, itemNo } = state.editingItem;
  const rack = state.inventory.find(r => r.rack_id === rackId);
  if (!rack) return;

  const item = rack.items.find(i => i.item_no === itemNo);
  if (!item) return;

  // Extract edited device details
  const editedName = document.getElementById('form-item-name').value.trim();
  const editedSn = document.getElementById('form-item-sn').value.trim();
  const editedAsset = document.getElementById('form-item-asset').value.trim();

  const status = document.getElementById('form-audit-status').value;
  const auditedQty = parseInt(document.getElementById('form-audit-qty').value, 10) || 1;
  const notes = document.getElementById('form-audit-notes').value.trim();

  // Update item properties
  if (editedName) item.name_description = editedName;
  item.serial_number = editedSn;
  item.official_asset_no = editedAsset;

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
  csv += 'ตู้/หมวดหมู่,หมายเลขตู้,ลำดับที่,Ref No,รายการอุปกรณ์,Serial Number,หมายเลขครุภัณฑ์,จำนวนตามบัญชี,จำนวนตรวจนับจริง,สถานะตรวจเช็ก,น้ำหนัก(ตัน),หมายเหตุ,ผู้ตรวจเช็ก,วันที่ตรวจ,มีภาพถ่าย\n';

  state.inventory.forEach(rack => {
    rack.items.forEach(item => {
      const rackNameClean = `"${rack.rack_name.replace(/"/g, '""')}"`;
      const rackAssetClean = `"${(rack.asset_no || '').replace(/"/g, '""')}"`;
      const refNoClean = `"${(item.ref_no || '').replace(/"/g, '""')}"`;
      const nameClean = `"${item.name_description.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      const snClean = `"${(item.serial_number || '').replace(/"/g, '""')}"`;
      const assetClean = `"${(item.official_asset_no || '').replace(/"/g, '""')}"`;
      const weightClean = `"${(item.weight || '').replace(/"/g, '""')}"`;
      const notesClean = `"${(item.audit_notes || '').replace(/"/g, '""')}"`;
      const auditorClean = `"${(item.auditor || state.sessionMeta.auditorName).replace(/"/g, '""')}"`;
      const auditedDateClean = `"${item.audited_at ? new Date(item.audited_at).toLocaleDateString('th-TH') : '-'}"`;
      const statusThai = getStatusThaiName(item.audit_status);
      const hasPhoto = item.audit_image ? 'YES' : 'NO';

      csv += `${rackNameClean},${rackAssetClean},${item.item_no},${refNoClean},${nameClean},${snClean},${assetClean},${item.system_qty},${item.audited_qty},${statusThai},${weightClean},${notesClean},${auditorClean},${auditedDateClean},${hasPhoto}\n`;
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
window.saveData = saveData;
window.saveSessionMeta = saveSessionMeta;
window.saveItemAudit = saveItemAudit;
window.saveNewItem = saveNewItem;
window.deleteItem = deleteItem;
window.exportAuditJSON = exportAuditJSON;
window.exportAuditCSV = exportAuditCSV;
window.showToast = showToast;
window.escapeHTML = escapeHTML;
window.toggleTheme = toggleTheme;
