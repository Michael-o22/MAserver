// Firebase Project Configuration
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA0DTYjcyc91mbK8PJJb_RyrwRJ5CvqsN0",
  authDomain: "masever-f8d93.firebaseapp.com",
  databaseURL: "https://masever-f8d93-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "masever-f8d93",
  storageBucket: "masever-f8d93.firebasestorage.app",
  messagingSenderId: "872818324942",
  appId: "1:872818324942:web:dd2238dd7726a40af9e79f",
  measurementId: "G-M386NGW7DC"
};

let db = null;
let rtdb = null;
let storage = null;
let isFirebaseEnabled = false;
let isRemoteUpdating = false;

const STORAGE_KEY_AUDIT_DATA = 'SERVER_ROOM_AUDIT_DATA_V1';
const STORAGE_KEY_SESSION_META = 'SERVER_ROOM_SESSION_META_V1';

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
  editingItem: null,
  currentEditingImage: null,
  currentAddingImage: null,
  viewingItem: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initData();
  initFirebase();
  setupEventListeners();
  initHashRouting();
  renderApp();
});

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
}

function loadMasterInventory() {
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
        audit_image: null, // Base64 data URL for uploaded image
        audited_at: null,
        auditor: ''
      };
    });
    return rack;
  });
  saveData();
}

function getUrlSessionId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || 'AUD-SERVER70';
}

function initNewSession() {
  state.sessionMeta = {
    sessionId: getUrlSessionId(),
    auditorName: 'Senior IT Auditor',
    auditDate: new Date().toISOString().split('T')[0],
    location: 'Server Room 70',
    notes: 'การตรวจเช็กครุภัณฑ์ประจำงวดบำรุงรักษาประจำปี',
    status: 'IN_PROGRESS'
  };
  saveSessionMeta();
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY_AUDIT_DATA, JSON.stringify(state.inventory));
  } catch (e) {
    console.error('Failed to save audit data to LocalStorage', e);
    showToast('ไม่สามารถบันทึกข้อมูลได้ พื้นที่จัดเก็บในบราวเซอร์อาจเต็ม (QuotaExceededError)');
  }

  if (isFirebaseEnabled && !isRemoteUpdating) {
    const docId = state.sessionMeta.sessionId || 'current_session';
    const payload = {
      inventory: state.inventory,
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString()
    };

    if (db) {
      db.collection('audit_sessions').doc(docId).set(payload, { merge: true }).catch(err => {
        console.warn('Firestore sync failed:', err);
      });
    }

    if (rtdb) {
      rtdb.ref('audit_sessions/' + docId).set(payload).catch(err => {
        console.warn('Realtime Database sync failed:', err);
      });
    }
  }
}

function saveSessionMeta() {
  localStorage.setItem(STORAGE_KEY_SESSION_META, JSON.stringify(state.sessionMeta));
  if (isFirebaseEnabled && !isRemoteUpdating) {
    const docId = state.sessionMeta.sessionId || 'current_session';
    const payload = {
      sessionMeta: state.sessionMeta,
      updatedAt: new Date().toISOString()
    };

    if (db) {
      db.collection('audit_sessions').doc(docId).set(payload, { merge: true }).catch(err => {
        console.warn('Firestore sessionMeta sync failed:', err);
      });
    }

    if (rtdb) {
      rtdb.ref('audit_sessions/' + docId + '/sessionMeta').set(state.sessionMeta).catch(err => {
        console.warn('Realtime Database sessionMeta sync failed:', err);
      });
    }
  }
}

function initFirebase() {
  if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      if (firebase.firestore) db = firebase.firestore();
      if (firebase.database) rtdb = firebase.database();
      if (firebase.storage) storage = firebase.storage();
      isFirebaseEnabled = true;

      updateFirebaseBadge(true);
      console.log('Firebase initialized successfully!');
      setupFirebaseRealtimeSync();
    } catch (e) {
      console.warn('Firebase initialization error, fallback to LocalStorage:', e);
      updateFirebaseBadge(false, 'Firebase Init Error');
    }
  } else {
    updateFirebaseBadge(false, 'LocalStorage Mode');
  }
}

function updateFirebaseBadge(enabled, text) {
  const badge = document.getElementById('firebase-status-badge');
  if (!badge) return;

  if (enabled) {
    badge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700';
    badge.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-600 mr-1"></i>Firebase Cloud Active (masever-f8d93)';
  } else {
    badge.className = 'px-2.5 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border border-amber-300 dark:border-amber-700';
    badge.textContent = text || 'LocalStorage Mode';
  }
}

function setupFirebaseRealtimeSync() {
  if (!isFirebaseEnabled) return;

  const docId = state.sessionMeta.sessionId || 'AUD-SERVER70';

  if (db) {
    db.collection('audit_sessions').doc(docId).onSnapshot((doc) => {
      if (doc.exists) {
        applyRemoteData(doc.data());
      } else {
        // Document doesn't exist on Cloud yet -> Seed initial local state to Firebase
        console.log('Seeding initial audit inventory to Firestore...');
        saveData();
      }
    }, (err) => {
      console.warn('Firestore onSnapshot error:', err);
      if (err.code === 'permission-denied') {
        showToast('Firebase Permission Denied: กรุณาเปิดสิทธิ์ Read/Write ใน Firebase Rules');
        updateFirebaseBadge(false, 'Firebase Rules Blocked');
      }
    });
  }

  if (rtdb) {
    rtdb.ref('audit_sessions/' + docId).on('value', (snapshot) => {
      const data = snapshot.val();
      if (data) {
        applyRemoteData(data);
      } else {
        // Path doesn't exist on RTDB yet -> Seed initial local state to Firebase
        console.log('Seeding initial audit inventory to Realtime Database...');
        saveData();
      }
    }, (err) => {
      console.warn('Realtime Database listener error:', err);
      if (err.message && err.message.includes('permission_denied')) {
        showToast('Firebase Permission Denied: กรุณาเปิดสิทธิ์ Read/Write ใน Realtime Database Rules');
        updateFirebaseBadge(false, 'Firebase Rules Blocked');
      }
    });
  }
}

function applyRemoteData(data) {
  if (!data || !data.inventory || !Array.isArray(data.inventory)) return;
  isRemoteUpdating = true;
  state.inventory = data.inventory;
  if (data.sessionMeta) {
    state.sessionMeta = { ...state.sessionMeta, ...data.sessionMeta };
  }
  localStorage.setItem(STORAGE_KEY_AUDIT_DATA, JSON.stringify(state.inventory));
  localStorage.setItem(STORAGE_KEY_SESSION_META, JSON.stringify(state.sessionMeta));
  renderApp();
  isRemoteUpdating = false;
}

function parseQuantity(qtyStr) {
  if (!qtyStr) return 1;
  const match = qtyStr.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
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

  // Settings Input Listeners
  const settingAuditor = document.getElementById('setting-auditor-name');
  if (settingAuditor) {
    settingAuditor.value = state.sessionMeta.auditorName || '';
    settingAuditor.addEventListener('input', (e) => {
      state.sessionMeta.auditorName = e.target.value;
      saveSessionMeta();
      updateHeaderSessionInfo();
      renderReports();
    });
  }

  const settingLocation = document.getElementById('setting-location');
  if (settingLocation) {
    settingLocation.value = state.sessionMeta.location || '';
    settingLocation.addEventListener('input', (e) => {
      state.sessionMeta.location = e.target.value;
      saveSessionMeta();
    });
  }

  // Quick Action Buttons
  const btnResetData = document.getElementById('btn-reset-data');
  if (btnResetData) {
    btnResetData.addEventListener('click', () => {
      if (confirm('คุณต้องการรีเซ็ตข้อมูลการตรวจเช็กทั้งหมดเป็นค่าเริ่มต้นจาก Checklist MAserver70.xlsx ใช่หรือไม่?')) {
        loadMasterInventory();
        initNewSession();
        showToast('รีเซ็ตข้อมูลเป็นค่าเริ่มต้นเรียบร้อยแล้ว');
        renderApp();
      }
    });
  }

  // Theme Toggle (Default is Light)
  const btnThemeToggle = document.getElementById('theme-toggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      document.documentElement.classList.toggle('dark');
      const isDark = document.documentElement.classList.contains('dark');
      btnThemeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun text-amber-400"></i>' : '<i class="fa-solid fa-moon text-indigo-600"></i>';
    });
  }

  // Modal Close buttons
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });

  // Device Image File Upload
  const imgInput = document.getElementById('form-audit-image-input');
  if (imgInput) {
    imgInput.addEventListener('change', async (e) => {
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

  // Add-Item Image File Upload
  const addImgInput = document.getElementById('form-add-image-input');
  if (addImgInput) {
    addImgInput.addEventListener('change', async (e) => {
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
        openAuditModal(rackId, itemNo);
      }
    });
  }

  // Print button
  const btnPrintReport = document.getElementById('btn-print-report');
  if (btnPrintReport) {
    btnPrintReport.addEventListener('click', () => {
      window.print();
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
  }
};

/**
 * Switch Active Tab
 */
function switchTab(tabName, updateHash = true) {
  state.activeTab = tabName;
  if (updateHash && window.location.hash !== `#${tabName}`) {
    history.replaceState(null, '', `#${tabName}`);
  }

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

function initHashRouting() {
  const hash = window.location.hash.replace('#', '');
  if (['dashboard', 'checklist', 'rack-map', 'reports', 'settings'].includes(hash)) {
    switchTab(hash, false);
  }
  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash.replace('#', '');
    if (['dashboard', 'checklist', 'rack-map', 'reports', 'settings'].includes(newHash)) {
      switchTab(newHash, false);
    }
  });
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
  renderDashboard();
  renderChecklist();
  renderRackMap();
  renderReports();
  populateRackFilterOptions();
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

      if (item.audit_status !== 'PENDING' && item.audited_qty !== item.system_qty) {
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

/**
 * Upload Image Helper
 */
async function uploadImageToServer(file) {
  if (isFirebaseEnabled && storage) {
    try {
      showToast('กำลังอัปโหลดรูปภาพไปยัง Firebase Storage...');
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `img_${Date.now()}_${Math.floor(Math.random() * 10000)}_${cleanName}`;
      const storageRef = storage.ref().child(`images/${fileName}`);
      const snapshot = await storageRef.put(file);
      const downloadUrl = await snapshot.ref.getDownloadURL();
      showToast('อัปโหลดรูปภาพไปยัง Firebase Storage สำเร็จ');
      return downloadUrl;
    } catch (err) {
      console.error('Firebase Storage upload failed, fallback to local/base64', err);
      showToast('อัปโหลดไปยัง Firebase ล้มเหลว สลับใช้โหมดสำรอง');
    }
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const base64Data = evt.target.result;
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: base64Data,
            filename: file.name
          })
        });
        const data = await res.json();
        if (data.success && data.url) {
          showToast('อัปโหลดรูปภาพไปยังโฟลเดอร์ image เรียบร้อย');
          resolve(data.url);
        } else {
          console.warn('Upload API error, fallback to base64', data);
          resolve(base64Data);
        }
      } catch (err) {
        console.warn('Upload fetch failed, fallback to base64', err);
        resolve(base64Data);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
          <span class="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[240px]" title="${rack.rack_name}">
            <i class="fa-solid fa-server text-blue-600 dark:text-blue-400 mr-2"></i>${rack.rack_no}. ${rack.rack_name}
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
            <img src="${item.audit_image}" onclick="openPhotoViewer('${item.rack_id}', '${item.item_no}')" class="w-9 h-9 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 flex-shrink-0" title="ดูภาพถ่าย">
          ` : `
            <div class="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 text-slate-700 dark:text-slate-300 font-semibold text-xs font-mono">
              ${item.item_no}
            </div>
          `}
          <div class="truncate">
            <div class="font-medium text-slate-800 dark:text-slate-200 truncate" title="${item.name_description.replace(/\n/g, ' ')}">${item.name_description.replace(/\n/g, ' ')}</div>
            <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">S/N: ${item.serial_number || '-'} | ครุภัณฑ์: ${item.official_asset_no || '-'}</div>
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

    html += `
      <div class="glass-panel rounded-2xl overflow-hidden mb-6 border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900">
        <!-- Rack Category Header -->
        <div class="bg-slate-100/80 dark:bg-slate-800/80 px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-700/70 flex flex-wrap justify-between items-center gap-2">
          <div class="flex items-center gap-2 sm:gap-3">
            <span class="px-2.5 py-1 text-xs font-bold rounded-md bg-blue-50 dark:bg-blue-600/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 font-mono">
              ข้อ ${rack.rack_no}
            </span>
            <h3 class="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">${rack.rack_name}</h3>
          </div>
          <div class="flex items-center gap-2 sm:gap-3 text-xs text-slate-500 dark:text-slate-400 font-mono">
            <span class="hidden sm:inline">หมายเลขตู้: ${rack.asset_no || '-'}</span>
            <span class="px-2.5 py-1 rounded-md bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 font-semibold">${rack.qty || '-'}</span>
          </div>
        </div>

        <!-- Desktop Table View (md:block) -->
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-left text-xs sm:text-sm">
            <thead class="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 uppercase font-semibold text-[11px] border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th class="py-3 px-4 w-14 text-center">ลำดับ</th>
                <th class="py-3 px-4">รายการอุปกรณ์ / ยี่ห้อ - รุ่น</th>
                <th class="py-3 px-4 w-36">Serial Number</th>
                <th class="py-3 px-4 w-36">หมายเลขครุภัณฑ์</th>
                <th class="py-3 px-4 w-28 text-center">จำนวนในระบบ</th>
                <th class="py-3 px-4 w-32 text-center">สถานะตรวจเช็ก</th>
                <th class="py-3 px-4 w-28 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
    `;

    matchingItems.forEach(item => {
      const statusBadge = getStatusBadgeHTML(item.audit_status);
      const isDiscrepancy = item.audit_status !== 'PENDING' && item.audited_qty !== item.system_qty;

      html += `
        <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${isDiscrepancy ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}">
          <td class="py-3.5 px-4 text-center font-semibold font-mono text-slate-400">${item.item_no}</td>
          <td class="py-3.5 px-4">
            <div class="font-medium text-slate-900 dark:text-slate-100 whitespace-pre-line leading-relaxed">${escapeHTML(item.name_description)}</div>
            ${item.ref_no ? `<div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono">Ref No: ${item.ref_no} | Weight: ${item.weight || '-'}</div>` : ''}
            ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 mt-1 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}
            ${item.audit_image ? `
              <div class="mt-2 flex items-center gap-2">
                <img src="${item.audit_image}" onclick="openPhotoViewer('${rack.rack_id}', '${item.item_no}')" class="w-10 h-10 object-cover rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer hover:opacity-80 transition-opacity shadow-sm" title="คลิกดูภาพขยาย">
                <span onclick="openPhotoViewer('${rack.rack_id}', '${item.item_no}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer hover:underline flex items-center gap-1">
                  <i class="fa-solid fa-camera"></i> ดูภาพถ่ายอุปกรณ์
                </span>
              </div>
            ` : ''}
          </td>
          <td class="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 text-xs">${item.serial_number ? escapeHTML(item.serial_number) : '<span class="text-slate-400">-</span>'}</td>
          <td class="py-3.5 px-4 font-mono text-slate-600 dark:text-slate-300 text-xs">${item.official_asset_no ? escapeHTML(item.official_asset_no) : '<span class="text-slate-400">-</span>'}</td>
          <td class="py-3.5 px-4 text-center font-mono font-medium">
            <span class="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">${item.total_quantity}</span>
            ${isDiscrepancy ? `<div class="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-1">นับได้: ${item.audited_qty}</div>` : ''}
          </td>
          <td class="py-3.5 px-4 text-center">${statusBadge}</td>
          <td class="py-3.5 px-4 text-center">
            <button onclick="openAuditModal('${rack.rack_id}', '${item.item_no}')"
                    class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-50 dark:bg-blue-600/20 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40 transition-all flex items-center justify-center gap-1.5 mx-auto shadow-sm">
              <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
            </button>
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
      const isDiscrepancy = item.audit_status !== 'PENDING' && item.audited_qty !== item.system_qty;

      html += `
        <div class="pt-3 first:pt-0 space-y-2.5">
          <div class="flex justify-between items-center gap-2">
            <span class="px-2 py-0.5 text-xs font-bold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono border border-slate-200 dark:border-slate-700">
              ${item.item_no}
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
            <span class="text-slate-500 dark:text-slate-400">ระบุ: <strong class="text-slate-800 dark:text-slate-200">${item.total_quantity}</strong> ${isDiscrepancy ? `<span class="text-amber-600 dark:text-amber-400 font-bold ml-1">(นับ: ${item.audited_qty})</span>` : ''}</span>
            ${item.audit_image ? `
              <span onclick="openPhotoViewer('${rack.rack_id}', '${item.item_no}')" class="text-xs font-semibold text-blue-600 dark:text-blue-400 cursor-pointer flex items-center gap-1">
                <i class="fa-solid fa-camera"></i> ดูรูปภาพ
              </span>
            ` : ''}
          </div>

          ${item.audit_notes ? `<div class="text-xs text-amber-600 dark:text-amber-400 italic font-medium"><i class="fa-solid fa-comment-dots mr-1"></i>${escapeHTML(item.audit_notes)}</div>` : ''}

          <button onclick="openAuditModal('${rack.rack_id}', '${item.item_no}')"
                  class="w-full py-2 px-3 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm flex items-center justify-center gap-1.5 transition-all">
            <i class="fa-solid fa-pen-to-square"></i> ตรวจเช็ก / แก้ไข
          </button>
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
 * Render 2D Rack Elevation Map
 */
function renderRackMap() {
  const container = document.getElementById('rack-elevation-grid');
  if (!container) return;

  let html = '';

  state.inventory.forEach(rack => {
    const totalItems = rack.items.length;
    const passCount = rack.items.filter(i => i.audit_status === 'PASS').length;
    const damagedCount = rack.items.filter(i => i.audit_status === 'DAMAGED' || i.audit_status === 'MISSING').length;

    html += `
      <div class="rack-container glass-panel flex flex-col justify-between">
        <!-- Rack Header -->
        <div class="rack-header mb-3">
          <div class="flex justify-between items-center">
            <span class="font-bold text-xs uppercase text-blue-600 dark:text-blue-400 font-mono">ZONE ${rack.rack_no}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700">${totalItems} รายการ</span>
          </div>
          <div class="text-sm font-bold text-slate-900 dark:text-slate-100 truncate mt-1" title="${rack.rack_name}">${rack.rack_name}</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">Asset: ${rack.asset_no || 'N/A'}</div>
        </div>

        <!-- Rack Slot Items -->
        <div class="flex-1 flex flex-col gap-1.5 overflow-y-auto max-h-[380px] pr-1">
    `;

    rack.items.forEach(item => {
      let statusClass = 'status-pending';
      let ledClass = 'led-pending';
      if (item.audit_status === 'PASS') { statusClass = 'status-pass'; ledClass = 'led-pass'; }
      else if (item.audit_status === 'DAMAGED') { statusClass = 'status-damaged'; ledClass = 'led-damaged'; }
      else if (item.audit_status === 'MISSING') { statusClass = 'status-missing'; ledClass = 'led-missing'; }
      else if (item.audit_status === 'MAINTENANCE') { statusClass = 'status-maintenance'; ledClass = 'led-maintenance'; }
      else if (item.audit_status === 'UNUSED') { statusClass = 'status-unused'; ledClass = 'led-unused'; }

      let matchSearchClass = '';
      if (state.searchQuery) {
        const name = (item.name_description || '').toLowerCase();
        const sn = (item.serial_number || '').toLowerCase();
        const asset = (item.official_asset_no || '').toLowerCase();
        const itemNo = (item.item_no || '').toLowerCase();
        const refNo = (item.ref_no || '').toLowerCase();

        const isMatched = name.includes(state.searchQuery) ||
                          sn.includes(state.searchQuery) ||
                          asset.includes(state.searchQuery) ||
                          itemNo.includes(state.searchQuery) ||
                          refNo.includes(state.searchQuery);

        if (isMatched) {
          matchSearchClass = 'ring-2 ring-blue-500 scale-[1.02] shadow-md z-10';
        } else {
          matchSearchClass = 'opacity-30 grayscale-[50%]';
        }
      }

      html += `
        <div onclick="openViewItemModal('${rack.rack_id}', '${item.item_no}')"
             class="rack-slot ${statusClass} ${matchSearchClass} cursor-pointer group transition-all duration-200"
             title="คลิกเพื่อดูรายละเอียด: ${escapeHTML(item.name_description)}">
          <span class="${ledClass}"></span>
          <div class="flex-1 overflow-hidden">
            <div class="flex justify-between items-center text-xs">
              <span class="font-mono font-bold text-slate-800 dark:text-slate-300 group-hover:text-blue-600 dark:group-hover:text-blue-300">${item.item_no}</span>
              <span class="text-[10px] text-slate-500 dark:text-slate-400 font-mono font-semibold flex items-center gap-1">
                ${item.audit_image ? `<i class="fa-solid fa-camera text-blue-600 dark:text-blue-400"></i>` : ''}
                ${item.total_quantity}
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
          <span>ชำรุด/มีปัญหา: <strong class="text-red-600 dark:text-red-400">${damagedCount}</strong></span>
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
  const stats = calculateOverallStats();
  
  const elReportDate = document.getElementById('report-date');
  const elAuditor = document.getElementById('report-auditor');
  const elSessionId = document.getElementById('report-session-id');

  if (elReportDate) elReportDate.textContent = state.sessionMeta.auditDate;
  if (elAuditor) elAuditor.textContent = state.sessionMeta.auditorName;
  if (elSessionId) elSessionId.textContent = state.sessionMeta.sessionId;

  const tableBody = document.getElementById('report-table-body');
  if (!tableBody) return;

  let html = '';

  state.inventory.forEach(rack => {
    // Section Header Row
    html += `
      <tr class="bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-200">
        <td colspan="7" class="py-2.5 px-3 border border-slate-200 dark:border-slate-700">
          ข้อ ${rack.rack_no}. ${rack.rack_name} (หมายเลขตู้: ${rack.asset_no || '-'})
        </td>
      </tr>
    `;

    rack.items.forEach(item => {
      const statusThai = getStatusThaiName(item.audit_status);

      html += `
        <tr class="border-b border-slate-200 dark:border-slate-800 text-xs sm:text-sm hover:bg-slate-50 dark:hover:bg-slate-800/30">
          <td class="py-2.5 px-3 text-center border border-slate-200 dark:border-slate-700 font-mono">${item.item_no}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 font-medium whitespace-pre-line">${escapeHTML(item.name_description)}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 font-mono">${item.serial_number || '-'}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 font-mono">${item.official_asset_no || '-'}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 text-center font-mono">${item.total_quantity}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 text-center font-semibold">${statusThai}</td>
          <td class="py-2.5 px-3 border border-slate-200 dark:border-slate-700 text-xs">
            <div>${escapeHTML(item.audit_notes || '-')}</div>
            ${item.audit_image ? `<div class="mt-1 font-semibold text-blue-600">[แนบรูปถ่ายแล้ว]</div>` : ''}
          </td>
        </tr>
      `;
    });
  });

  tableBody.innerHTML = html;
}

/**
 * Open Audit Modal Dialog
 */
window.openAuditModal = function(rackId, itemNo) {
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
  const weightInput = document.getElementById('form-item-weight');
  if (weightInput) weightInput.value = item.weight || '';

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
  }
};

function closeAllModals() {
  document.querySelectorAll('.modal-window').forEach(m => {
    m.classList.add('hidden');
    m.classList.remove('flex');
  });
  state.editingItem = null;
  state.currentEditingImage = null;
  state.currentAddingImage = null;
  state.viewingItem = null;
}

/**
 * Open Add New Item Modal
 */
window.openAddItemModal = function() {
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
  }
};

function saveNewItem() {
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
 * Open View Item Read-Only Modal
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

  const modal = document.getElementById('view-item-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
};

function saveItemAudit() {
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
  const editedWeight = document.getElementById('form-item-weight') ? document.getElementById('form-item-weight').value.trim() : item.weight;

  const status = document.getElementById('form-audit-status').value;
  const auditedQty = parseInt(document.getElementById('form-audit-qty').value, 10) || 1;
  const notes = document.getElementById('form-audit-notes').value.trim();

  // Update item properties
  if (editedName) item.name_description = editedName;
  item.serial_number = editedSn;
  item.official_asset_no = editedAsset;
  item.weight = editedWeight;

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
  csv += 'ตู้/หมวดหมู่,ลำดับที่,รายการอุปกรณ์,Serial Number,หมายเลขครุภัณฑ์,จำนวนตามบัญชี,จำนวนตรวจนับจริง,สถานะตรวจเช็ก,หมายเหตุ,มีภาพถ่าย,ผู้ตรวจเช็ก,เวลาบันทึก\n';

  state.inventory.forEach(rack => {
    rack.items.forEach(item => {
      const rackNameClean = `"${rack.rack_name.replace(/"/g, '""')}"`;
      const nameClean = `"${item.name_description.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
      const snClean = `"${(item.serial_number || '').replace(/"/g, '""')}"`;
      const assetClean = `"${(item.official_asset_no || '').replace(/"/g, '""')}"`;
      const notesClean = `"${(item.audit_notes || '').replace(/"/g, '""')}"`;
      const statusThai = getStatusThaiName(item.audit_status);
      const hasPhoto = item.audit_image ? 'YES' : 'NO';
      const auditorClean = `"${(item.auditor || '').replace(/"/g, '""')}"`;
      const auditedAtClean = `"${(item.audited_at || '').replace(/"/g, '""')}"`;

      csv += `${rackNameClean},${item.item_no},${nameClean},${snClean},${assetClean},${item.system_qty},${item.audited_qty},${statusThai},${notesClean},${hasPhoto},${auditorClean},${auditedAtClean}\n`;
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
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'glass-panel px-4 py-3 rounded-xl shadow-lg border border-blue-500/30 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm flex items-center gap-3 animate-bounce';
  toast.innerHTML = `<i class="fa-solid fa-circle-info text-blue-600 dark:text-blue-400"></i> ${escapeHTML(message)}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}
