/* ==================================================================
   XQD716 NEXUS 6.0 — Multi-Tenant Cloud Architecture & Real-Time Sync
   ================================================================== */

(function () {
    'use strict';

    const firebaseConfig = {
        apiKey: "AIzaSyAK2yXStkDdOLHpsjhbk10HfVj3O2wvMvE",
        authDomain: "xc-f6b4d.firebaseapp.com",
        projectId: "xc-f6b4d",
        storageBucket: "xc-f6b4d.firebasestorage.app",
        messagingSenderId: "263052117008",
        appId: "1:263052117008:web:f7049b65d8d8009bbe7695",
        measurementId: "G-E0BECTY393"
    };

    // Firebase Core References
    let fbApp = null;
    let fbDb = null;
    let fbAuth = null;
    let fbReady = false;

    // Multi-Tenant Collections
    const COLL_BRANCHES = 'nexus_branches';
    const COLL_TENANT_DATA = 'nexus_tenants_data';
    const COLL_AUDIT_LOGS = 'nexus_audit_logs';

    // Unique Session Identifier
    const CLIENT_ID = Math.random().toString(36).slice(2, 10);
    const AUTO_SAVE_INTERVAL = 10 * 60 * 1000; // 10 Minutes
    const SESSION_BRANCH_KEY = 'qx716_active_branch';
    const LAST_SAVE_KEY = 'qx716_last_save_ts';

    // Runtime Tenant Context
    let currentTenant = null; // { id, name, username }
    let realtimeUnsubscribe = null;
    let autoSaveTimer = null;
    let debounceSaveTimer = null;
    let lastLocalWriteTs = 0;
    let onCloudUpdateCallback = null;

    // Initialize Firebase
    try {
        fbApp = firebase.initializeApp(firebaseConfig);
        fbDb = firebase.firestore();
        fbAuth = firebase.auth();
        fbDb.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('Firestore offline persistence warning:', err.code);
        });
        try { firebase.analytics(); } catch (e) {}
        fbReady = true;
        console.log('%c🔥 Firebase Multi-Tenant Infrastructure Active', 'color:#00FFFF;font-weight:bold');
    } catch (err) {
        console.error('Firebase initialization error:', err);
        fbReady = false;
    }

    // Header Status Pill
    function setFbStatus(state, text) {
        const el = document.getElementById('fb-status');
        const txt = document.getElementById('fb-status-text');
        if (!el || !txt) return;
        el.classList.remove('online', 'sync', 'offline');
        el.classList.add(state);
        txt.textContent = text;
    }

    // Default Seed Branches
    const DEFAULT_BRANCHES = [
        { id: 'branch_zayouni', name: 'زیوني', username: 'zayouni', password: '716', status: 'active', createdAt: new Date().toISOString() },
        { id: 'branch_mohammed', name: 'محمد', username: 'mohammed', password: '716', status: 'active', createdAt: new Date().toISOString() }
    ];

    // Seed Default Branches If Not Exists
    async function seedDefaultBranchesIfNeeded() {
        if (!fbReady || !fbDb) return;
        try {
            const snap = await fbDb.collection(COLL_BRANCHES).limit(1).get();
            if (snap.empty) {
                console.log('Seeding initial branch tenants...');
                const batch = fbDb.batch();
                DEFAULT_BRANCHES.forEach(b => {
                    const ref = fbDb.collection(COLL_BRANCHES).doc(b.id);
                    batch.set(ref, b);
                });
                await batch.commit();
                await logAuditEvent('SYSTEM', 'Initial default branches seeded (زیوني, محمد)');
            }
        } catch (e) {
            console.warn('Branch seeding check failed:', e);
        }
    }

    // Anonymous Auth Check
    async function ensureAuth() {
        if (!fbReady || !fbAuth) return false;
        try {
            if (!fbAuth.currentUser) {
                await fbAuth.signInAnonymously();
            }
            return true;
        } catch (e) {
            console.warn('Anonymous auth failed:', e);
            return false;
        }
    }

    // Central Audit Logging
    async function logAuditEvent(action, details) {
        if (!fbReady || !fbDb) return;
        try {
            const logEntry = {
                id: 'LOG_' + Date.now().toString(36),
                branchId: currentTenant ? currentTenant.id : 'SYSTEM',
                branchName: currentTenant ? currentTenant.name : 'SYSTEM',
                branchUser: currentTenant ? currentTenant.username : 'SYSTEM',
                action: action,
                details: details,
                clientId: CLIENT_ID,
                timestamp: new Date().toISOString(),
                epoch: Date.now()
            };
            await fbDb.collection(COLL_AUDIT_LOGS).doc(logEntry.id).set(logEntry);
        } catch (e) {
            console.warn('Failed to record audit log:', e);
        }
    }

    // Branch Login Authentication
    async function authenticateBranch(username, password) {
        const cleanUser = String(username || '').trim().toLowerCase();
        const cleanPass = String(password || '').trim();

        if (!cleanUser || !cleanPass) {
            throw new Error('يرجى إدخال اسم المستخدم وكلمة المرور');
        }

        setFbStatus('sync', 'AUTH');

        if (fbReady && fbDb) {
            await ensureAuth();
            const snap = await fbDb.collection(COLL_BRANCHES)
                .where('username', '==', cleanUser)
                .where('password', '==', cleanPass)
                .get();

            if (!snap.empty) {
                const branchDoc = snap.docs[0].data();
                if (branchDoc.status === 'frozen') {
                    setFbStatus('offline', 'FROZEN');
                    throw new Error('هذا الفرع معطل أو مجمد حالياً من قبل الإدارة المركزية.');
                }

                currentTenant = {
                    id: branchDoc.id,
                    name: branchDoc.name,
                    username: branchDoc.username
                };

                localStorage.setItem(SESSION_BRANCH_KEY, JSON.stringify(currentTenant));
                await logAuditEvent('LOGIN', `تسجيل دخول ناجح للفرع: ${branchDoc.name}`);
                setFbStatus('online', 'ONLINE');
                updateBranchUI();
                return currentTenant;
            }
        }

        // Fallback check against default local credentials
        const fallback = DEFAULT_BRANCHES.find(b => b.username.toLowerCase() === cleanUser && b.password === cleanPass);
        if (fallback) {
            currentTenant = { id: fallback.id, name: fallback.name, username: fallback.username };
            localStorage.setItem(SESSION_BRANCH_KEY, JSON.stringify(currentTenant));
            updateBranchUI();
            setFbStatus('online', 'LOCAL_AUTH');
            return currentTenant;
        }

        setFbStatus('offline', 'AUTH_ERR');
        throw new Error('بيانات الدخول غير صحيحة. تأكد من اسم الفرع وكلمة المرور.');
    }

    // Logout & Tenant Switching
    async function logoutBranch() {
        if (currentTenant) {
            await logAuditEvent('LOGOUT', `تسجيل خروج الفرع: ${currentTenant.name}`);
        }
        if (realtimeUnsubscribe) {
            realtimeUnsubscribe();
            realtimeUnsubscribe = null;
        }
        currentTenant = null;
        localStorage.removeItem(SESSION_BRANCH_KEY);
        updateBranchUI();
        setFbStatus('sync', 'STANDBY');
    }

    // Header & Drawer Tenant UI Bindings
    function updateBranchUI() {
        const badge = document.getElementById('branch-badge');
        const drawerName = document.getElementById('drawer-branch-name');
        if (currentTenant) {
            if (badge) badge.textContent = `فرع: ${currentTenant.name}`;
            if (drawerName) drawerName.textContent = currentTenant.name;
        } else {
            if (badge) badge.textContent = 'فرع: غير محدد';
            if (drawerName) drawerName.textContent = 'غير مسجل';
        }
    }

    // Tenant Isolated Storage Key
    function getTenantStorageKey() {
        const tenantId = currentTenant ? currentTenant.id : 'default';
        return `qx716_nexus_data_${tenantId}`;
    }

    // Local Storage Operations
    function loadTenantLocal(defaultFactory) {
        try {
            const raw = localStorage.getItem(getTenantStorageKey());
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (e) {
            console.warn('Error reading tenant localStorage:', e);
        }
        return defaultFactory();
    }

    function saveTenantLocal(state) {
        try {
            localStorage.setItem(getTenantStorageKey(), JSON.stringify(state));
        } catch (e) {}
    }

    // Real-Time Cloud Listener
    function attachTenantSync(onUpdateCallback) {
        onCloudUpdateCallback = onUpdateCallback;
        if (!fbReady || !fbDb || !currentTenant) return;

        if (realtimeUnsubscribe) {
            realtimeUnsubscribe();
        }

        const tenantDocRef = fbDb.collection(COLL_TENANT_DATA).doc(currentTenant.id);

        realtimeUnsubscribe = tenantDocRef.onSnapshot(docSnap => {
            if (!docSnap.exists) return;
            const data = docSnap.data();

            // Ignore self-emitted sync events
            if (data._client === CLIENT_ID) return;
            if ((data._lastWrite || 0) <= lastLocalWriteTs) return;

            console.log('⚡ Realtime update received for isolated branch:', currentTenant.name);

            const cleanState = Object.assign({}, data);
            delete cleanState._client;
            delete cleanState._lastWrite;
            delete cleanState._savedAt;
            delete cleanState._savedReason;

            saveTenantLocal(cleanState);

            if (data._savedAt) {
                localStorage.setItem(LAST_SAVE_KEY, String(new Date(data._savedAt).getTime()));
                updateLastSavedDisplay();
            }

            if (typeof onCloudUpdateCallback === 'function') {
                onCloudUpdateCallback(cleanState);
            }

            setFbStatus('online', 'SYNCED');
            setTimeout(() => setFbStatus('online', 'ONLINE'), 1200);
        }, err => {
            console.warn('Realtime sync subscription error:', err);
            setFbStatus('offline', 'SYNC_ERR');
        });
    }

    // Debounced Local & Cloud Save
    function debouncedSave(stateGetter) {
        const state = stateGetter();
        saveTenantLocal(state);

        if (!fbReady || !fbDb || !currentTenant) return;
        lastLocalWriteTs = Date.now();
        clearTimeout(debounceSaveTimer);
        setFbStatus('sync', 'SAVING');

        debounceSaveTimer = setTimeout(() => {
            forceSaveCloud(stateGetter(), 'edit');
        }, 900);
    }

    // Immediate Cloud Save
    async function forceSaveCloud(state, reason = 'manual') {
        if (!currentTenant) return false;

        saveTenantLocal(state);
        clearTimeout(debounceSaveTimer);

        if (!fbReady || !fbDb) {
            setFbStatus('offline', 'LOCAL_SAVED');
            return false;
        }

        try {
            setFbStatus('sync', 'SAVING');
            lastLocalWriteTs = Date.now();

            const payload = JSON.parse(JSON.stringify(state));
            payload._lastWrite = lastLocalWriteTs;
            payload._client = CLIENT_ID;
            payload._savedAt = new Date().toISOString();
            payload._savedReason = reason;
            payload._branchId = currentTenant.id;
            payload._branchName = currentTenant.name;

            await fbDb.collection(COLL_TENANT_DATA).doc(currentTenant.id).set(payload);

            localStorage.setItem(LAST_SAVE_KEY, String(Date.now()));
            updateLastSavedDisplay();
            flashSaveIndicator();

            setFbStatus('online', 'SAVED');
            setTimeout(() => setFbStatus('online', 'ONLINE'), 1200);
            return true;
        } catch (e) {
            console.error('Force save cloud error:', e);
            setFbStatus('offline', 'SAVE_FAILED');
            return false;
        }
    }

    // Last Saved Display
    function updateLastSavedDisplay() {
        const el = document.getElementById('last-saved-text');
        if (!el) return;
        const ts = Number(localStorage.getItem(LAST_SAVE_KEY) || 0);
        if (!ts) { el.textContent = 'آخر حفظ: —'; return; }
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        el.textContent = `آخر حفظ: ${hh}:${mm}:${ss}`;
    }

    function flashSaveIndicator() {
        const el = document.getElementById('save-indicator');
        if (!el) return;
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1200);
    }

    // 10-Minute Auto-Save
    function startAutoSaveLoop(stateGetter) {
        if (autoSaveTimer) clearInterval(autoSaveTimer);
        autoSaveTimer = setInterval(() => {
            if (currentTenant && fbReady && fbDb) {
                console.log('⏱️ 10-Minute Auto-Save running for branch:', currentTenant.name);
                forceSaveCloud(stateGetter(), '10min');
            }
        }, AUTO_SAVE_INTERVAL);
    }

    // System Background & Unload Listeners
    function bindSystemSyncListeners(stateGetter) {
        window.addEventListener('beforeunload', () => {
            if (currentTenant) {
                const s = stateGetter();
                saveTenantLocal(s);
                if (fbReady && fbDb) {
                    const payload = JSON.parse(JSON.stringify(s));
                    payload._lastWrite = Date.now();
                    payload._client = CLIENT_ID;
                    payload._savedAt = new Date().toISOString();
                    payload._savedReason = 'beforeunload';
                    fbDb.collection(COLL_TENANT_DATA).doc(currentTenant.id).set(payload).catch(() => {});
                }
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && currentTenant) {
                const s = stateGetter();
                saveTenantLocal(s);
                if (fbReady && fbDb) {
                    const payload = JSON.parse(JSON.stringify(s));
                    payload._lastWrite = Date.now();
                    payload._client = CLIENT_ID;
                    payload._savedAt = new Date().toISOString();
                    payload._savedReason = 'hidden';
                    fbDb.collection(COLL_TENANT_DATA).doc(currentTenant.id).set(payload).catch(() => {});
                }
            }
        });

        window.addEventListener('online', () => {
            setFbStatus('sync', 'ONLINE_SYNC');
            if (currentTenant) {
                forceSaveCloud(stateGetter(), 'reconnected');
            }
        });

        window.addEventListener('offline', () => {
            setFbStatus('offline', 'OFFLINE');
        });
    }

    // ==================== MASTER ADMIN CLOUD OPERATIONS ====================

    // Load Branches List
    async function adminLoadBranches() {
        if (!fbReady || !fbDb) return DEFAULT_BRANCHES;
        try {
            await ensureAuth();
            const snap = await fbDb.collection(COLL_BRANCHES).orderBy('createdAt', 'desc').get();
            return snap.docs.map(d => d.data());
        } catch (e) {
            console.warn('Failed to load branches from cloud:', e);
            return DEFAULT_BRANCHES;
        }
    }

    // 🆕 Create Branch (Fixed & Guaranteed Cloud Persistence)
    async function adminCreateBranch(name, username, password) {
        const cleanName = String(name || '').trim();
        const cleanUser = String(username || '').trim().toLowerCase();
        const cleanPass = String(password || '').trim();

        if (!cleanName || !cleanUser || !cleanPass) {
            throw new Error('يرجى ملء جميع حقول الفرع الجديد');
        }
        if (!fbReady || !fbDb) {
            throw new Error('الاتصال السحابي بقاعدة البيانات غير متوفر حالياً');
        }

        await ensureAuth();

        // Check if username already exists
        const existsCheck = await fbDb.collection(COLL_BRANCHES).where('username', '==', cleanUser).get();
        if (!existsCheck.empty) {
            throw new Error('اسم المستخدم هذا مسجل بالفعل لفرع آخر، اختر اسماً مختلفاً');
        }

        const branchId = 'branch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const branchData = {
            id: branchId,
            name: cleanName,
            username: cleanUser,
            password: cleanPass,
            status: 'active',
            createdAt: new Date().toISOString()
        };

        // Write branch configuration to Firestore
        await fbDb.collection(COLL_BRANCHES).doc(branchId).set(branchData);

        // Initialize empty tenant data document to guarantee isolation
        await fbDb.collection(COLL_TENANT_DATA).doc(branchId).set({
            tables: [],
            debts: [],
            invoices: [],
            categories: [
                { id: 'c1', name: 'صالات البليستيشن', icon: '🎮' },
                { id: 'c2', name: 'المشروبات الباردة والساخنة', icon: '🥤' },
                { id: 'c3', name: 'الوجبات السريعة', icon: '🍕' },
                { id: 'c4', name: 'قسم الأراجيل الفاخرة', icon: '💨' }
            ],
            products: [
                { id: 'p1', catId: 'c1', name: 'نصف ساعة PS5', icon: '⏱', type: 'countdown', duration: 30, price: 2000 },
                { id: 'p2', catId: 'c1', name: 'ساعة كاملة PS5', icon: '🕐', type: 'countdown', duration: 60, price: 4000 },
                { id: 'p3', catId: 'c1', name: 'وقت مفتوح PS5', icon: '♾', type: 'open', duration: 0, price: 4000 }
            ],
            revenue: { daily: 0, yesterday: 0, monthly: 0 },
            _branchId: branchId,
            _branchName: cleanName,
            _createdAt: new Date().toISOString()
        });

        await logAuditEvent('BRANCH_CREATED', `تم إنشاء وتفعيل فرع جديد: ${cleanName} (${cleanUser})`);
        return branchData;
    }

    // 🆕 Delete Branch (Purges branch config and tenant data)
    async function adminDeleteBranch(branchId) {
        if (!fbReady || !fbDb) throw new Error('الاتصال بقاعدة البيانات غير متوفر');
        await ensureAuth();

        // 1. Delete branch from branches collection
        await fbDb.collection(COLL_BRANCHES).doc(branchId).delete();

        // 2. Delete tenant data document
        await fbDb.collection(COLL_TENANT_DATA).doc(branchId).delete();

        // 3. Clear local storage cache if this branch was cached
        localStorage.removeItem(`qx716_nexus_data_${branchId}`);

        await logAuditEvent('BRANCH_DELETED', `تم حذف الفرع وبياناته نهائياً: ID ${branchId}`);
        return true;
    }

    // Freeze / Unfreeze Branch
    async function adminToggleBranchStatus(branchId, currentStatus) {
        if (!fbReady || !fbDb) return false;
        await ensureAuth();

        const newStatus = currentStatus === 'active' ? 'frozen' : 'active';
        await fbDb.collection(COLL_BRANCHES).doc(branchId).update({ status: newStatus });
        await logAuditEvent('BRANCH_STATUS_CHANGE', `تغيير حالة الفرع ${branchId} إلى: ${newStatus}`);
        return newStatus;
    }

    // Load Audit Logs
    async function adminLoadAuditLogs() {
        if (!fbReady || !fbDb) return [];
        try {
            await ensureAuth();
            const snap = await fbDb.collection(COLL_AUDIT_LOGS).orderBy('epoch', 'desc').limit(45).get();
            return snap.docs.map(d => d.data());
        } catch (e) {
            console.warn('Failed to load audit logs:', e);
            return [];
        }
    }

    // Expose Backend Engine Globally
    window.BackendEngine = {
        init: async function () {
            await ensureAuth();
            await seedDefaultBranchesIfNeeded();
            const cached = localStorage.getItem(SESSION_BRANCH_KEY);
            if (cached) {
                try {
                    currentTenant = JSON.parse(cached);
                    updateBranchUI();
                } catch (e) {}
            }
            updateLastSavedDisplay();
        },
        authenticateBranch,
        logoutBranch,
        getCurrentTenant: () => currentTenant,
        loadTenantLocal,
        saveTenantLocal,
        debouncedSave,
        forceSaveCloud,
        attachTenantSync,
        startAutoSaveLoop,
        bindSystemSyncListeners,
        updateLastSavedDisplay,
        flashSaveIndicator,
        setFbStatus,
        logAuditEvent,
        adminLoadBranches,
        adminCreateBranch,
        adminDeleteBranch,
        adminToggleBranchStatus,
        adminLoadAuditLogs
    };

    // Global manual save trigger
    window.manualSave = function (showToast = true) {
        if (window.AppEngine && typeof window.AppEngine.triggerManualSave === 'function') {
            window.AppEngine.triggerManualSave(showToast);
        }
    };
})();
