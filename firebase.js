const firebaseConfig = {
    apiKey: "AIzaSyBBU2fUlkRf7VqVJmT-Vh7TfNpPgmQrqWU",
    authDomain: "kirya-e2248.firebaseapp.com",
    projectId: "kirya-e2248",
    storageBucket: "kirya-e2248.firebasestorage.app",
    messagingSenderId: "308339449512",
    appId: "1:308339449512:web:d2b1fb44c4ba36a505ac9d",
    measurementId: "G-YZ3NFWDS89",
    databaseURL: "https://kirya-e2248-default-rtdb.asia-southeast1.firebasedatabase.app"
};

window.db = null;
window.auth = null;
window.rtdb = null;
window.storage = null;
window.messaging = null;
// Store unsubscribe functions to prevent duplicate listeners

let lastVisibleDocs = {
    orders: null,
    restaurants: null,
    customers: null,
    logs: null
};
const PAGE_SIZE = 15;
let authListenerRegistered = false;
window._lastLoginUpdated = false;
window.isBootstrappingAdmin = false;

let firebaseUnsubs = { orders: null, riders: null, customers: null, restaurants: null, promotions: null, payments: null, support: null, accounts: null, logs: null, analytics: null, chat: null, profile: null };

function initFirebase() {
    if (typeof firebase === 'undefined') {
        if (window.showToast) window.showToast("⚠️ Firebase SDK not loaded. Check internet.");
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("Firebase Initialized");
        }
        
        // Ensure references exist
        if (!window.db) window.db = firebase.firestore();
        if (!window.auth) {
            window.auth = firebase.auth();
            window.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => console.error("Auth persistence error:", e));
        }
        if (!window.rtdb) window.rtdb = firebase.database();

        // 0. Register Service Worker for Messaging
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/firebase-messaging-sw.js')
                .then(reg => console.log("Firebase: Service Worker registered for Messaging."))
                .catch(err => console.warn("Firebase: Service Worker registration failed.", err));
        }
        
        window.auth.onAuthStateChanged(user => {
            if (user) {
                console.log("Firebase: Auth state changed ->", user.uid);
                
                if (!window.currentUser) window.currentUser = { id: user.uid };
                else window.currentUser.id = user.uid;
                
                window.setupUserProfileListener(user.uid);
            } else {
                window.clearUserSession();
                // Handle potential errors returning from a redirect login flow
                if (window.auth) {
                    window.auth.getRedirectResult().catch(error => {
                        console.error("Auth Redirect Error:", error);
                        if (window.showToast) window.showToast("🚫 Login Error: " + error.message);
                    });
                }
                if (window.showLoginScreen) window.showLoginScreen();
            }
        });

        if (!window.storage) window.storage = firebase.storage();
        if (!window.messaging && firebase.messaging.isSupported()) window.messaging = firebase.messaging();

        // 1. ENABLE OFFLINE PERSISTENCE (Local Sync) - MUST BE BEFORE ANY OTHER DB CALL
        if (window.db) {
            try {
                window.db.enablePersistence({ synchronizeTabs: true });
            } catch (e) {
                console.log('Firestore settings already configured or error:', e);
            }
        }

        // Helpers for Auth Providers
        window.signInWithGoogle = async function() {
            try {
                const provider = new firebase.auth.GoogleAuthProvider();
                // Switching to Redirect to bypass Cross-Origin-Opener-Policy (COOP) restrictions
                await window.auth.signInWithRedirect(provider);
            } catch (error) {
                if (error.code === 'auth/unauthorized-domain') {
                    if (window.showToast) window.showToast("🚫 Domain unauthorized. Please add " + window.location.hostname + " to your Firebase Console settings.");
                } else {
                    if (window.showToast) window.showToast("🚫 Login Denied: " + error.message);
                }
                throw error;
            }
        };

        window.sendPasswordResetEmail = async function(email) {
            if (!window.auth) throw new Error("Firebase Auth not initialized.");
            if (!email) throw new Error("Email is required for password reset.");

            try {
                await window.auth.sendPasswordResetEmail(email);
                if (window.showToast) window.showToast("✅ Password reset email sent! Check your inbox.");
                return true;
            } catch (error) {
                console.error("Password Reset Error:", error);
                if (window.showToast) window.showToast("🚫 Password Reset Failed: " + error.message);
                throw error;
            }
        };

        window.sendOtp = async function(phoneNumber) {
            if (!phoneNumber || phoneNumber.length < 10) {
                if (window.showToast) window.showToast("⚠️ Invalid Phone Number format.");
                throw new Error("Invalid phone number");
            }

            // 1. Clear existing verifier instance
            if (window.recaptchaVerifier) {
                try { window.recaptchaVerifier.clear(); } catch(e) { console.error("Verifier clear error", e); }
            }

            // 2. Nuclear Reset: Re-create the DOM element to kill any lingering internal styles/iframes
            const oldContainer = document.getElementById('recaptcha-container');
            if (oldContainer) {
                const newContainer = document.createElement('div');
                newContainer.id = 'recaptcha-container';
                oldContainer.parentNode.replaceChild(newContainer, oldContainer);
            }

            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'invisible'
            });
            return window.auth.signInWithPhoneNumber(phoneNumber, window.recaptchaVerifier);
        };

        // Start listeners only when Auth state is confirmed to prevent "Insufficient Permissions"
        // Ensure this listener is only registered once
        if (!authListenerRegistered) {
            console.log("Firebase: Initialized. Waiting for auth state to start listeners...");
            // setupFirebaseListeners() will now be triggered by onAuthStateChanged
            authListenerRegistered = true;
        }
        
        if (window.showToast) window.showToast("✅ Firebase Connected");
        updateNetworkStatusUI();
    } catch (e) {
        console.error("Firebase Init Error:", e);
    }
}

/**
 * Global Logout Function
 * Signs out of Firebase Auth. The onAuthStateChanged listener 
 * handles the subsequent UI reset and session clearing.
 */
window.logoutUser = async function() {
    if (!window.auth) return;
    try {
        if (window.showLoading) window.showLoading("Logging out...");
        await window.auth.signOut();
    } catch (error) {
        console.error("Logout Error:", error);
        if (window.showToast) showToast("❌ Error signing out.");
    } finally {
        if (window.hideLoading) window.hideLoading();
    }
};

/**
 * UI Helper: Show a loading overlay
 */
window.showLoading = function(message = "Loading...", progress = null) {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.9);
            display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:10000;font-family:sans-serif;">
                <div class="loader-spinner-container" style="display:flex; flex-direction:column; align-items:center;">
                    <div class="spinner" style="width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;animation:spin 1s linear infinite;"></div>
                </div>
                <p id="loader-text" style="margin-top:15px;color:#555;">${message}</p>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loader);
    } else {
        document.getElementById('loader-text').textContent = message;
        loader.style.display = 'flex';
    }

    let barContainer = document.getElementById('loader-progress-container');
    if (progress !== null) {
        if (!barContainer) {
            barContainer = document.createElement('div');
            barContainer.id = 'loader-progress-container';
            barContainer.style.cssText = 'width:200px; height:8px; background:#eee; border-radius:4px; margin-top:15px; overflow:hidden;';
            barContainer.innerHTML = '<div id="loader-progress-bar" style="width:0%; height:100%; background:#019E81; transition:width 0.2s;"></div>';
            loader.querySelector('.loader-spinner-container').appendChild(barContainer);
        }
        barContainer.style.display = 'block';
        document.getElementById('loader-progress-bar').style.width = Math.round(progress) + '%';
    } else if (barContainer) {
        barContainer.style.display = 'none';
    }
};

/**
 * UI Helper: Hide the loading overlay
 */
window.hideLoading = function() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
};

/**
 * Clears the current user session to prevent role leakage
 * between different login attempts.
 */
window.clearUserSession = function() {
    console.log("Firebase: Clearing user session...");
    window.currentUser = { role: 'user', points: 0, walletBalance: 0 };
    
    if (document.getElementById('verificationLoadingScreen')) {
        document.getElementById('verificationLoadingScreen').style.display = 'none';
    }

    if (firebaseUnsubs.profile) {
        firebaseUnsubs.profile();
        firebaseUnsubs.profile = null;
    }
};

/**
 * Returns the current user's role. 
 * Defaults to 'user' if not logged in or role is undefined.
 */
window.getCurrentRole = function() {
    if (!window.currentUser || !window.currentUser.id) return 'user';
    return window.currentUser.role || 'user';
};

function updateNetworkStatusUI() {
    const indicators = document.querySelectorAll('.network-indicator');
    const isOnline = navigator.onLine;
    indicators.forEach(el => {
        el.className = 'network-indicator ' + (isOnline ? 'online' : 'offline');
        el.title = isOnline ? 'System Online' : 'System Offline (Local Data Only)';
    });
}

function setupFirebaseListeners() {
    if(!db) return;
    
    // Get current auth state
    const user = window.auth ? window.auth.currentUser : null;
    const role = window.currentUser?.role || 'user';
    const isAdmin = role === 'admin' || role === 'Super Admin' || role === 'Manager';
    const isApproved = window.currentUser?.isApproved || false;

    // SECURITY: Postpone listeners until user is authenticated and approved by admin.
    // Firestore Security Rules likely block unapproved users, causing "Missing or insufficient permissions" errors.
    if (!user || !isApproved) {
        console.log("Firebase: Listeners postponed (User not authenticated or not approved).");
        return;
    }

    // Unsubscribe previous listeners if they exist (prevents duplicates on retry)
    if (firebaseUnsubs.orders) firebaseUnsubs.orders();
    if (firebaseUnsubs.riders) firebaseUnsubs.riders();
    if (firebaseUnsubs.analytics) firebaseUnsubs.analytics();
    if (firebaseUnsubs.chatsList) firebaseUnsubs.chatsList();

    let query = db.collection("orders");

    // SECURITY SYNC: Regular users MUST filter by their own ID in the query.
    // Without this filter, Firestore rejects the query as it could return other people's data.
    if (role === 'user') {
        query = query.where("userId", "==", user.uid); // Align with new rules
    } else if (role === 'vendor') {
        query = query.where("vendorId", "==", user.uid); // Align with new rules
    }

    firebaseUnsubs.orders = query.orderBy('timestamp', 'desc')
        .limit(isAdmin ? 50 : 5) 
        .onSnapshot((snapshot) => {
            const orders = [];
            snapshot.forEach(doc => orders.push({ id: doc.id, ...doc.data() }));
            window.allOrders = orders;
            window.adminOrders = orders;

            if (isAdmin && window.renderAdminDashboard) window.renderAdminDashboard();
            if (isAdmin && window.renderAdminOrders) window.renderAdminOrders();
        }, (error) => {
            console.error("Orders listener error:", error);
        });

    if (isAdmin) {
        firebaseUnsubs.riders = db.collection("riders").onSnapshot((snapshot) => {
            const riders = [];
            snapshot.forEach(doc => riders.push({ id: doc.id, ...doc.data() }));
            window.adminRiders = riders;
            if (window.renderAdminRiders) window.renderAdminRiders();
        }, (error) => {
            console.error("Riders listener error:", error);
        });
    }

    firebaseUnsubs.chatsList = db.collection("chats").onSnapshot((snapshot) => {
        // Global chat list listener for admin/support
    }, (error) => {
        console.error("Chats list listener error:", error);
        if(error.code === 'permission-denied') console.warn("Access to chats denied.");
    });
    
    
    // Listen for Analytics Summary
    firebaseUnsubs.analytics = db.collection("analytics").doc("summary").onSnapshot((doc) => {
        if (doc.exists) {
            adminAnalytics = doc.data();
            if (document.getElementById('admin-analytics').style.display !== 'none') renderAdminAnalytics();
            if (document.getElementById('admin-dashboard').style.display !== 'none') renderAdminDashboard();
        }
    });
}

// --- PAGINATION & ONE-TIME FETCH LOGIC ---
window.fetchPaginatedCollection = async function(collectionName, reset = false) {
    if(!window.db) return [];
    if(reset) lastVisibleDocs[collectionName] = null;
    
    let query = db.collection(collectionName);
    
    if (collectionName === 'logs') query = query.orderBy('time', 'desc');
    else if (collectionName === 'users') query = query.orderBy('createdAt', 'desc');
    else query = query.orderBy('name');

    if (!reset && lastVisibleDocs[collectionName]) {
        query = query.startAfter(lastVisibleDocs[collectionName]);
    }

    const snapshot = await query.limit(PAGE_SIZE).get();
    if (snapshot.empty) return [];

    lastVisibleDocs[collectionName] = snapshot.docs[snapshot.docs.length - 1];
    
    const items = [];
    snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    return items;
};

window.fetchCollectionOnce = async function(collectionName) {
    if(!window.db) return [];
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// --- AUTO-RECONNECT LOGIC ---
window.addEventListener('online', () => {
    showToast("🌐 Connection Restored. Reconnecting...");
    console.log("Network online. Retrying Firebase...");
    initFirebase();
    updateNetworkStatusUI();
});

window.addEventListener('offline', () => {
    showToast("⚠️ No Internet Connection. Working offline.");
    updateNetworkStatusUI();
});

async function seedDatabase() {
    if (window.showToast) window.showToast("⚠️ Manual seeding disabled. Use seedMasterAdmin via console for initial setup.");
}

/**
 * Promotes the currently logged-in user to Admin.
 * Useful for bypassing lockdowns if you already have an account.
 */
window.createMeToAdmin = window.promoteMeToAdmin = async function() {
    window.isBootstrappingAdmin = true;
    const user = window.auth ? window.auth.currentUser : null;
    if (!window.db) { console.error("Database not connected."); return; }
    if (!user) { if (window.showToast) window.showToast("❌ Error: You must be signed in to promote this account. Use seedMasterAdmin instead."); return; }
    
    try {
        window.showLoading("Self-Promoting to Admin...");
        const profile = {
            id: user.uid,
            name: window.currentUser?.name || "Main Admin",
            email: user.email,
            role: 'Super Admin',
            isApproved: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        // CLEANUP: Ensure this UID does not exist in the 'users' collection to avoid role confusion
        await window.db.collection('users').doc(user.uid).delete().catch(() => {});

        await window.db.collection('admin_accounts').doc(user.uid).set(profile);
        localStorage.removeItem('kirya_user_role_hint');
        window.setupUserProfileListener(user.uid); // Restart listener to find new collection
        window.hideLoading();
        if (window.showToast) window.showToast("✅ Self-Promotion Successful!");
    } catch(e) {
        window.isBootstrappingAdmin = false;
        window.hideLoading();
        console.error("Promotion Error:", e);
        if (window.showToast) window.showToast("❌ Promotion Error: " + e.message);
    }
};

/**
 * Master Admin Bootstrap Utility
 * Run this from the browser console: window.seedMasterAdmin('admin@mail.com', 'password123', 'Admin Name')
 */
window.seedMasterAdmin = async function(email, password, name = "Master Admin") {
    if (!window.auth || !window.db) { console.error("Firebase not connected."); return; }
    window.isBootstrappingAdmin = true;
    try {
        window.showLoading("Bootstrapping Master Admin...");
        
        let user;
        try {
            const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
            user = userCredential.user;
        } catch (authErr) {
            if (authErr.code === 'auth/email-already-in-use') {
                console.log("Email already exists. Attempting to sign in to update record...");
                let userCredential;
                try {
                    userCredential = await window.auth.signInWithEmailAndPassword(email, password);
                } catch (signInErr) {
                    if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/user-not-found') {
                        const msg = "❌ Password Mismatch: This email exists but the password provided is wrong. Use the correct password or delete the user from Auth Console to start fresh.";
                        if (window.showToast) window.showToast(msg);
                        throw new Error(msg);
                    }
                    throw signInErr;
                }
                user = userCredential.user;
            } else {
                throw authErr;
            }
        }

        const profile = {
            id: user.uid,
            name: name,
            email: email,
            role: 'Super Admin',
            isApproved: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        // CLEANUP: Ensure this UID does not exist in the 'users' collection
        await window.db.collection('users').doc(user.uid).delete().catch(() => {});

        await window.db.collection('admin_accounts').doc(user.uid).set(profile, { merge: true });
        localStorage.removeItem('kirya_user_role_hint');
        
        window.hideLoading();
        window.isBootstrappingAdmin = false;
        window.setupUserProfileListener(user.uid);
        if (window.showToast) window.showToast("✅ Master Admin Verified & Profile Updated!");
    } catch(e) {
        window.isBootstrappingAdmin = false;
        window.hideLoading();
        console.error(e);
        if (e.code === 'permission-denied') {
            const msg = "🚫 Permission Denied: Your Firestore rules block writing to 'admin_accounts'. Temporarily allow writes for this UID or use the Firebase Console.";
            if (window.showToast) window.showToast(msg);
        } else if (window.showToast) window.showToast("❌ Error: " + e.message);
    }
};

// 2. REAL-TIME USER PROFILE SYNC LISTENER
function setupUserProfileListener(userId) {
    // PERMANENT FIX: Skip Firestore operations for Mock/Demo users or unauthenticated sessions
    // This prevents "Missing or insufficient permissions" errors.
    const isMock = userId && (userId.toString().startsWith('mock_') || !isNaN(userId));

    if(!db || !userId || isMock) {
        console.log(`Firebase: Skipping Firestore listener for ${isMock ? 'Mock' : 'Invalid'} User ID: ${userId}`);
        return;
    }

    // Clear previous listener if it exists to avoid duplicates
    if (firebaseUnsubs.profile) firebaseUnsubs.profile();

    // Optimized check: Check both collections but handle permission errors gracefully.
    // We use a "Safe Check" strategy.
    console.log(`[Auth] Checking permissions for ID: ${userId}`);
    
    const collections = [
        { name: 'admin_accounts', role: 'admin' },
        { name: 'riders', role: 'rider' },
        { name: 'restaurants', role: 'vendor' },
        { name: 'users', role: 'user' }
    ];

    async function waterfallProfileLookup() {
        let foundCol = null;
        
        // Optimization: Check for a role hint to speed up lookup
        const roleHint = localStorage.getItem('kirya_user_role_hint');
        if (roleHint) {
            const hintMap = { 'admin': 'admin_accounts', 'rider': 'riders', 'vendor': 'restaurants', 'user': 'users' };
            const colName = hintMap[roleHint];
            try {
                const doc = await db.collection(colName).doc(userId.toString()).get();
                if (doc.exists) foundCol = { name: colName, role: roleHint };
            } catch (e) { console.warn("Profile hint check failed:", e.message); }
        }

        if (!foundCol) {
            // Sequential check to find which collection the user belongs to.
            // This avoids parallel permission errors if rules are strict.
            for (const col of collections) {
                try {
                    const doc = await db.collection(col.name).doc(userId.toString()).get();
                    if (doc.exists) { foundCol = { name: col.name, role: col.role }; break; }
                } catch (e) { /* Continue to next collection */ }
            }
        }

        if (foundCol) {
            localStorage.setItem('kirya_user_role_hint', foundCol.role);
            // Attach real-time listener to the identified document
            firebaseUnsubs.profile = db.collection(foundCol.name).doc(userId.toString())
                .onSnapshot((doc) => {
                    if (doc.exists) setupProfileFromDoc(doc, foundCol.role);
                }, handleProfileError);
        } else {
            // Brand new user registration
            const registered = await handleNewUserRegistration(userId);
            // Start listening to the newly created 'users' document
            if (registered) attachUserListener(userId);
        }
    }

    waterfallProfileLookup();

    function setupProfileFromDoc(doc, role) {
        const data = doc.data();
        const collectionName = doc.ref.parent.id;
        data.role = role;

        // NEW: Update last login for admins when they first sign in this session
        if (role === 'admin' && !window._lastLoginUpdated) {
            window._lastLoginUpdated = true;
            const now = new Date().toISOString();
            doc.ref.update({ lastLogin: now }).catch(e => console.error("Update lastLogin error", e));
        }

        // --- REAL-TIME APPROVAL DETECTION ---
        // Check if the user was unapproved and is now approved
        const wasApproved = window.currentUser ? window.currentUser.isApproved : false;
        const isNowApproved = data.isApproved;

        if (wasApproved === false && isNowApproved === true) {
            if (window.showToast) window.showToast("🎊 Congratulations! Your account has been approved.");
            if (window.playNotificationSound) window.playNotificationSound();
        }

        // ALWAYS show toast on successful role resolution
        if (window.showToast) {
            window.showToast(`✅ Verified: Welcome ${data.name || data.username || 'User'} (${data.role})`);
        }
        
        if (window.hideLoading) window.hideLoading();

        console.log(`%c[Verification] Fetched Role from ${collectionName}:`, "color: #007bff; font-weight: bold;", data.role);
            
            window.currentUser = { 
                ...window.currentUser, 
                ...data, 
                id: userId,
                _collection: collectionName // Remember the source collection
            };

            // Re-initialize listeners based on the resolved role and approval status
            setupFirebaseListeners();

            // --- AUTO-ROUTING LOGIC (Perfect Login) ---
            if (data.isApproved) {
                if (window.proceedToHome) window.proceedToHome(true);
            } else {
                if (window.proceedToHome) window.proceedToHome(true);
            }

            // Sync Notifications
            if(data.notifications) {
                notifications = data.notifications;
                updateBellDots();
                if(document.getElementById('notificationsScreen').classList.contains('active')) renderNotifications();
            }

            // Update UI
            updateCartView();
    }

    function attachUserListener(uid) {
        firebaseUnsubs.profile = db.collection('users').doc(uid.toString())
            .onSnapshot((doc) => {
                if (doc.exists) setupProfileFromDoc(doc, 'user');
            }, handleProfileError);
    }

    async function handleNewUserRegistration(userId) {
        console.log("First-time login detected. Creating default profile...");
        if (window.isBootstrappingAdmin) {
            console.log("Firebase: Admin bootstrap detected. Aborting auto-registration.");
            return false;
        }

        const authUser = window.auth.currentUser;
        if (!authUser) return false;

        const email = authUser.email;
        const phone = authUser.phoneNumber;

        try {
            const userRef = db.collection('users').doc(userId.toString());

            // Prepare default profile. If an admin pre-created it, this will merge safely.
            const finalProfile = {
                id: userId,
                name: authUser.displayName || "New User",
                email: email || "",
                phone: phone || "",
                role: 'user', 
                isApproved: false,
                points: 500,
                walletBalance: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                authRegistered: true
            };

            await userRef.set(finalProfile, { merge: true });
            if (window.showToast) window.showToast(`🎉 Welcome! Account registered as ${finalProfile.role}`);
            return true;
        } catch (err) {
            console.error("Error in registration flow:", err);
            if (window.showToast) window.showToast("❌ Registration Error: " + err.message);
            return false;
        }
    }

    function handleProfileError(error) {
        console.error("Profile sync error:", error);
        if (window.hideLoading) window.hideLoading();
        if (document.getElementById('verificationLoadingScreen')) {
            document.getElementById('verificationLoadingScreen').style.display = 'none';
        }
        
        if (window.showToast) {
            if (error.code === 'permission-denied') {
                window.showToast("🚫 Login Denied: Your account doesn't have permission to access this area.");
            } else {
                window.showToast("⚠️ System Error: " + error.message);
            }
        }
        if (window.hideLoading) window.hideLoading();
    }
}

window.setupChatListener = function(chatId) {
    if(!window.db) return;
    // Clear existing chat listener to prevent memory leaks/duplicate UI updates
    if (firebaseUnsubs.chat) firebaseUnsubs.chat();

    const chatMessages = document.getElementById('chatMessages');
    
    firebaseUnsubs.chat = window.db.collection('chats').doc(chatId).collection('messages')
        .orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            // Clear and re-render the view from the Firestore snapshot
            chatMessages.innerHTML = '<div class="chat-date">Today</div>';
            
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Determine message type: 'sent' if I am the sender, else 'received'
                const type = (data.senderId === window.currentUser.id) ? 'sent' : 'received';
                
                const time = data.timestamp 
                    ? new Date(data.timestamp.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
                    : 'Just now';
                
                if (window.addMessage) window.addMessage(type, data.text, time);
            });
        }, (error) => console.error("Chat listener error:", error));
};

window.uploadImageToStorage = async function(blob, path, onProgress = null) {
    if(!window.storage) throw new Error("Firebase Storage not initialized");
    try {
        const ref = window.storage.ref(path);
        const uploadTask = ref.put(blob);

        return new Promise((resolve, reject) => {
            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    if (onProgress) onProgress(progress);
                }, 
                (error) => {
                    console.error("Storage Upload Error:", error);
                    if (error.message && error.message.includes('CORS')) {
                        if (window.showToast) window.showToast("⚠️ Storage Error: Please configure CORS on your Firebase bucket.");
                    }
                    reject(error);
                }, 
                async () => {
                    try {
                        const url = await uploadTask.snapshot.ref.getDownloadURL();
                        resolve(url);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    } catch (e) {
        console.error("Storage Upload Error:", e);
        if (e.message && e.message.includes('CORS')) {
            if (window.showToast) window.showToast("⚠️ Storage Error: Please configure CORS on your Firebase bucket.");
            throw new Error("CORS configuration required on Firebase Storage bucket.");
        }
        throw e;
    }
};

window.deleteImageFromStorage = async function(url) {
    if(!window.storage || !url) return false;
    // Only attempt to delete if it's a Firebase Storage URL
    if (!url.includes('firebasestorage.googleapis.com')) return false;
    try {
        const ref = window.storage.refFromURL(url);
        await ref.delete();
        return true;
    } catch (e) {
        console.error("Storage Delete Error:", e);
        return false;
    }
};

window.requestNotificationPermission = async function() {
    if (!window.messaging) return;
    
    try {
        // Ensure Service Worker is active and controlling before proceeding
        const registration = await navigator.serviceWorker.ready;
        if (!registration) throw new Error("No active service worker found.");

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            
            // Get FCM Token
            const token = await window.messaging.getToken({
                vapidKey: 'BK2f6UhGePLF0PW_x4Nvwc3Bp86GEGOmKgFVd9bgtI7G4T_YS_NDZHgWqihO0u4WfCBHFzhZ4TlNgZLyx3sjU',
                serviceWorkerRegistration: registration
            });
            
            if (token && window.currentUser && window.currentUser.id) {
                await db.collection('users').doc(window.currentUser.id).update({
                    fcmToken: token,
                    notificationsEnabled: true
                });
                console.log('Firebase: FCM Token stored');
            }
        }
    } catch (error) {
        if (error.code === 'messaging/permission-denied' || error.message.includes('permission')) {
            console.warn('Firebase Messaging: Permission denied or missing config.');
        } else {
            console.error('Unable to get messaging token', error);
        }
    }
};

if (window.messaging) {
    window.messaging.onMessage((payload) => {
        console.log('Foreground Message received: ', payload);
        if (window.showToast) window.showToast(`🔔 ${payload.notification.title}: ${payload.notification.body}`);
        if (window.playNotificationSound) window.playNotificationSound();
    });
}

// --- REGISTRATION & ACCOUNT MANAGEMENT ---

/**
 * Public function for users to register via the frontend form.
 * Automatically handles registration without requiring a mode selection.
 */
window.registerUserAccount = async function(userData) {
    if (!window.db) throw new Error("Database not connected");
    
    // Strictly use the Authenticated UID for document creation
    const userId = (window.auth.currentUser ? window.auth.currentUser.uid : userData.phoneNumber) || "u_" + Date.now();
    
    const newUser = {
        ...userData,
        id: userId,
        role: 'user',
        isApproved: false, // Users start unapproved
        points: 0,
        walletBalance: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await window.db.collection("users").doc(userId.toString()).set(newUser);
    return newUser;
};

/**
 * Admin-only function to create Rider accounts.
 */
window.adminCreateRider = async function(riderData) {
    const role = window.getCurrentRole ? window.getCurrentRole() : '';
    if (role !== 'admin') throw new Error("Permission Denied: Admin only");

    const ref = window.db.collection("riders").doc(riderData.id?.toString() || Date.now().toString());
    await ref.set({ ...riderData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref.id;
};

/**
 * Admin-only function to create Vendor (Restaurant) accounts.
 */
window.adminCreateVendor = async function(vendorData) {
    const role = window.getCurrentRole ? window.getCurrentRole() : '';
    if (role !== 'admin') throw new Error("Permission Denied: Admin only");

    const ref = window.db.collection("restaurants").doc(vendorData.id?.toString() || Date.now().toString());
    await ref.set({ ...vendorData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref.id;
};

/**
 * Updates the current rider's location.
 * Restricted by Firestore rules to only allow 'location' and 'lastSeen' updates.
 */
window.updateRiderLocation = async function(latitude, longitude) {
    if (!window.auth.currentUser) return;
    
    const riderId = window.auth.currentUser.uid;
    const ref = window.db.collection("riders").doc(riderId);
    
    try {
        await ref.update({
            location: new firebase.firestore.GeoPoint(latitude, longitude),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to update location. Are you logged in as this rider?", error);
    }
};

/**
 * Utility to create a test order in Firestore.
 * Running this in the console will trigger the real-time listeners.
 */
window.createTestOrder = async function() {
    if (!window.db || !window.auth || !window.auth.currentUser) {
        if (window.showToast) window.showToast("❌ Error: You must be logged in to create a test order.");
        return;
    }

    const user = window.auth.currentUser;
    const orderId = 'TEST-' + Date.now();
    try {
        const testOrder = {
            userId: user.uid,
            customerName: user.displayName || "Test User",
            customerPhone: user.phoneNumber || "+000 000 0000",
            deliveryAddress: "Test Suite 101, Firebase Towers",
            items: [
                { title: "Double Burger", basePrice: 25.00, quantity: 1, image: "🍔" },
                { title: "Firestore Fries", basePrice: 15.00, quantity: 1, image: "🍟" }
            ],
            total: 45.00,
            tip: 5.00,
            status: "pending",
            statusText: "Order Placed",
            statusColor: "#FFBF42",
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            userLat: 24.47,
            userLng: 54.40,
            restaurantLat: 24.46,
            restaurantLng: 54.38
        };
        
        await window.db.collection("orders").doc(orderId).set(testOrder);
        if (window.showToast) window.showToast("✅ Test Order Created: " + orderId);
    } catch (e) {
        console.error("Test order error:", e);
        if (window.showToast) window.showToast("❌ Failed: " + e.message);
    }
};

/**
 * Creates *h account creation usually requires Cloud Functions for Admin.
 */
window.adminCreateUserRecord = async function(userData) {
    if (!window.db) throw new Error("Database not connected");
    const userId = userData.id || "u_" + Date.now();
    const newUser = {
        name: userData.name || "New User",
        email: userData.email || "",
        role: userData.role || 'user', // 'admin', 'rider', 'vendor', 'user'
        isApproved: userData.isApproved || false,
        points: 0,
        walletBalance: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await window.db.collection("users").doc(userId.toString()).set(newUser);
    return newUser;
};
/**
 * Admin Helper:sonsole to quickly fix account permissions.
 */
window.adminUpdateUserRole = async function(uid, role) {
    const validRoles = ['admin', 'rider', 'vendor', 'user'];
    if (!validRoles.includes(role)) {
        console.error("Invalid role selection");
        return;
    }
    try {
        await window.db.collection('users').doc(uid).update({ role: role, isApproved: true });
        console.log(`Updated user ID ${uid} to role: ${role}`);
    } catch (e) {
        console.error("Update role error:", e);
    }
};

window.seedSampleAuthUsers = async function() {
    if (!window.db) { if (window.showToast) window.showToast("❌ Firebase not connected!"); return; }
    const samples = [
        { uid: 'mICAaywZwya7n88y8d47fY2fnf82', collection: 'riders', data: { name: 'Sample Rider', username: 'rider123', email: 'rider@kirya.app', phone: '+256700000002', role: 'rider', accountStatus: 'active', isApproved: true } },
        { uid: 'bhIdEgujsdnXr6IOirk83g1', collection: 'admin_accounts', data: { name: 'Sample Admin', username: 'admin123', email: 'admin@kirya.app', phone: '+256700000004', role: 'admin', status: 'active', isApproved: true } }
    ];

    if (window.showLoading) window.showLoading("Seeding sample accounts...");
    try {
        const batch = window.db.batch();
        samples.forEach(s => {
            const ref = window.db.collection(s.collection).doc(s.uid);
            batch.set(ref, { ...s.data, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        });
        await batch.commit();
        if (window.showToast) window.showToast("✅ Seeding Complete!");
    } catch (e) {
        console.error("Seeding error:", e);
        if (window.showToast) window.showToast("❌ Seeding failed: " + e.message);
    } finally {
        if (window.hideLoading) window.hideLoading();
    }
};

/**
 * Listen to a single order's changes in real-time.
 */
window.listenToOrder = function(orderId, callback) {
    if (!window.db || !orderId) return null;
    return window.db.collection("orders").doc(orderId).onSnapshot((doc) => {
        if (doc.exists) {
            callback({ id: doc.id, ...doc.data() });
        }
    }, (error) => console.error("Order listener error:", error));
};
// --- FIREBASE INTEGRATION END ---