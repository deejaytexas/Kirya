  // --- INITIALIZE ALL STATE VARIABLES AT TOP TO PREVENT TDZ ERRORS ---
  let map, marker;
  let cart = [];
  let notifications = [];
  let favorites = new Set();
  let appReady = false;
  let isRouted = false;
  window.appReady = false;
  const previewLatestUpdateIds = {};
  let adminChartUpdateInterval = null;
  let adminChartsInstances = {};
  let adminMap;
  let adminLayers = { riders: null, vendors: null, customers: null, zones: null, heatmap: null };
  let adminDraw = { active: false, center: null, circle: null };
  let adminOrderSearchTerm = '';
  let adminOrderCurrentStatus = 'all';
  let editingAdminId = null;
  let adminFilters = {
      restaurants: { status: 'all', search: '', category: 'all' },
      riders: { status: 'all', search: '' },
      customers: { status: 'all', search: '' }
  };
  let sortState = {
      orders: { col: 'id', asc: false },
      restaurants: { col: 'name', asc: true },
      riders: { col: 'name', asc: true },
      customers: { col: 'name', asc: true, missingPhoto: false }
  };
  let currentOrderUnsub = null;

  // --- SYSTEM HEALTH TRACKING ---
  const libStatus = { Leaflet: 'pending', 'Chart.js': 'pending', html2canvas: 'pending' };

  // --- ROBUST EXTERNAL LIBRARY LOADER ---
  const loadExternalLibrary = (name, checkFn, fallbackUrl) => {
      return new Promise((resolve, reject) => {
          if (checkFn()) { libStatus[name] = 'ready'; return resolve(); }
          
          let attempts = 0;
          const maxAttempts = 50; 
          const interval = setInterval(() => {
              attempts++;
              if (checkFn()) {
                  clearInterval(interval);
                  libStatus[name] = 'ready';
                  resolve();
              } else if (attempts === 25) {
                  console.warn(`Primary ${name} source slow or failed. Attempting fallback injection...`);
                  const script = document.createElement('script');
                  script.src = fallbackUrl;
                  script.onerror = () => console.error(`Fallback ${name} injection also failed.`);
                  document.head.appendChild(script);
              } else if (attempts >= maxAttempts) {
                  clearInterval(interval);
                  libStatus[name] = 'failed';
                  reject(new Error(`${name} library failed to load. Please check your connection or ad-blocker.`));
              }
          }, 200);
      });
  };

  const loadLeaflet = () => {
      // Ensure Leaflet CSS is loaded
      if (!document.querySelector('link[href*="leaflet.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'leaflet.css';
          document.head.appendChild(link);
      }
      // Inject Leaflet script immediately if not present to avoid loading delays
      if (!window.L && !document.querySelector('script[src*="leaflet.js"]')) {
          const script = document.createElement('script');
          script.src = 'leaflet.js';
          script.async = true;
          document.head.appendChild(script);
      }
      return loadExternalLibrary('Leaflet', () => window.L && typeof window.L.map === 'function', "leaflet.js");
  };
  const loadCharts = () => loadExternalLibrary('Chart.js', () => typeof window.Chart !== 'undefined', "https://cdn.jsdelivr.net/npm/chart.js");
  const loadHtml2Canvas = () => loadExternalLibrary('html2canvas', () => typeof window.html2canvas !== 'undefined', "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");

  // --- ASSET LIBRARY REGISTRY ---
  // Since JS cannot scan your local folders, add your filenames here
  const ASSET_LIBRARY = {
      "Vendors/Logos": [
          "assets/vendors/logos/bk_logo.png",
          "assets/vendors/logos/kfc_logo.png",
          "assets/vendors/logos/pharmacy_logo.png"
      ],
      "Vendors/Covers": [
          "assets/vendors/covers/bk_cover.jpg",
          "assets/vendors/covers/grocery_cover.jpg",
          "assets/vendors/covers/health_cover.jpg"
      ],
      "Menu/Items": [
          "assets/menu/items/whopper.jpg",
          "assets/menu/items/pizza.jpg",
          "assets/menu/items/medicine.jpg"
      ],
      "Users": [
          "assets/users/user1.jpg"
      ],
      "Riders": [
          "assets/riders/rider1.jpg"
      ],
      "Admins": [
          "assets/admins/admin1.jpg"
      ]
  };

  // Helper to manage dynamic recent uploads in LocalStorage
  function addToRecentUploads(url) {
      if (!url || typeof url !== 'string' || url.startsWith('assets/')) return;
      try {
          let recents = JSON.parse(localStorage.getItem('kirya_recent_uploads') || '[]');
          // Limit to 15 items, moving the newest to the front
          recents = [url, ...recents.filter(u => u !== url)].slice(0, 15);
          localStorage.setItem('kirya_recent_uploads', JSON.stringify(recents));
      } catch(e) { console.error("Recent uploads sync error", e); }
  }

  // --- GLOBAL STATE & FUNCTIONS FOR FIREBASE AND CROSS-SCRIPT ACCESS ---
  // These must be attached to window to be visible to firebase.js (standard script)
  window.cart = [];
  window.notifications = [];
  window.favorites = new Set();

  // Expose functions to global scope for firebase.js
  window.showToast = showToast;
  window.renderAdminDashboard = renderAdminDashboard;
  window.renderAdminOrders = renderAdminOrders;
  window.renderAdminRestaurants = renderAdminRestaurants;
  window.renderAdminRiders = renderAdminRiders;
  window.renderAdminCustomers = renderAdminCustomers;
  window.renderAdminPromotions = renderAdminPromotions;
  window.renderAdminPayments = renderAdminPayments;
  window.renderAdminSupport = renderAdminSupport;
  window.renderAdminAccounts = renderAdminAccounts;
  window.renderAdminLogs = renderAdminLogs;
  window.renderAdminAnalytics = renderAdminAnalytics;
  window.updateAdminSidebarBadges = updateAdminSidebarBadges;
  window.updateRiderNearbyOrders = updateRiderNearbyOrders;
  window.proceedToHome = proceedToHome;
  window.updateCartView = updateCartView;
  window.updateBellDots = updateBellDots;
  window.renderNotifications = renderNotifications;
  window.playNotificationSound = playNotificationSound;
  window.getCurrentRole = getCurrentRole;
  window.addMessage = addMessage;
  window.openTrackOrderById = (orderId) => {
      const order = (window.currentUser.orders || []).find(o => o.id === orderId);
      if(order) openTrackOrder(order);
  };
  window.reorder = (orderId) => {
      const order = (window.currentUser.orders || []).find(o => o.id === orderId);
      if (!order) return;
      order.items.forEach(item => window.cart.push({...item}));
      saveCart();
      showToast("Items added back to cart!");
      openCart();
  };
  window.setRating = setRating;
  window.submitRating = submitRating;

  // Helper to detect URL vs Emoji and return appropriate HTML
  window.getImageHtml = function(src, fallback = '🍽️', customStyle = '') {
      const isUrl = typeof src === 'string' && src.trim() !== '' && (src.includes('assets/') || 
          src.includes('://') || 
          src.startsWith('assets/') || 
          src.startsWith('./assets/') || 
          src.startsWith('/') || 
          src.startsWith('data:image/') || 
          /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(src)
      );
      if (isUrl) {
          return `<img src="${src}" style="width:100%;height:100%;object-fit:cover;${customStyle}" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML='<span style=\\'${customStyle}\\'>${fallback}</span>'">`;
      }
      return `<span style="${customStyle}">${src || fallback}</span>`;
  };

  window.validateImageUrl = function(url) {
      if (!url || typeof url !== 'string' || url.trim() === '') return Promise.resolve(false);
      if (url.startsWith('data:image/')) return Promise.resolve(true);
      return new Promise(resolve => {
          const img = new Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
          setTimeout(() => resolve(false), 5000); // 5s timeout safety
      });
  };

  // --- DATE FORMATTING HELPER ---
  window.formatRelativeTime = function(dateStr) {
      if (!dateStr || dateStr === 'Never') return '<span style="color:#999; font-style:italic;">Never</span>';
      try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return dateStr;
          
          if (window.dateFns) {
              return dateFns.formatDistanceToNow(date, { addSuffix: true });
          }
          // Fallback if library fails
          const seconds = Math.floor((new Date() - date) / 1000);
          if (seconds < 60) return "Just now";
          const minutes = Math.floor(seconds / 60);
          if (minutes < 60) return minutes + "m ago";
          const hours = Math.floor(minutes / 60);
          if (hours < 24) return hours + "h ago";
          return date.toLocaleDateString();
      } catch (e) { return dateStr; }
  };

  window.processExistingUser = processExistingUser; // Expose for completeAuthFlow
  // Role selection state and function
  let selectedLoginRole = 'user';
  window.selectRole = function(role) {
      window.fillDemo(role);
  }

  // --- IMAGE PICKER ENGINE ---
  window.openImagePicker = function(targetInputId) {
      const modal = document.getElementById('imagePickerModal');
      const grid = document.getElementById('imagePickerGrid');
      const filterBar = document.getElementById('imagePickerFilter');
      
      modal.style.display = 'flex';
      filterBar.innerHTML = '';
      
      // Merge ASSET_LIBRARY with dynamic Recent Uploads from LocalStorage
      const recentUploads = JSON.parse(localStorage.getItem('kirya_recent_uploads') || '[]');
      const combinedLibrary = { ...ASSET_LIBRARY };
      if (recentUploads.length > 0) combinedLibrary["Recent Uploads"] = recentUploads;

      const renderGrid = (category) => {
          grid.innerHTML = '';
          combinedLibrary[category].forEach(path => {
              const item = document.createElement('div');
              item.className = 'picker-item';
              item.innerHTML = window.getImageHtml(path);
              item.onclick = () => {
                  const input = document.getElementById(targetInputId);
                  if(input) {
                      input.value = path;
                      input.dispatchEvent(new Event('input')); // Trigger preview
                  }
                  modal.style.display = 'none';
              };
              grid.appendChild(item);
          });
      };

      Object.keys(combinedLibrary).forEach((cat, idx) => {
          const btn = document.createElement('button');
          btn.textContent = cat;
          btn.style.cssText = 'padding:5px 12px; border-radius:15px; border:1px solid #ddd; background:#fff; cursor:pointer; white-space:nowrap;';
          btn.onclick = () => renderGrid(cat);
          filterBar.appendChild(btn);
          // Default to Recent Uploads if available, otherwise the first category
          if(cat === "Recent Uploads" || (idx === 0 && !combinedLibrary["Recent Uploads"])) renderGrid(cat);
      });
  };

  // --- GLOBAL EXPORTS (TOP-LEVEL) ---
  // We attach these to window so they are available to HTML 'onclick' attributes.
  // In a module script, top-level functions are not global by default.
  window.handleLogout = handleLogout;
  window.confirmLogout = confirmLogout;

  // Missing UI/Firebase Exports
  window.switchRiderTab = switchRiderTab;
  window.switchAdminTab = switchAdminTab;
  window.toggleAdminSidebar = toggleAdminSidebar;
  window.sendAdminBroadcast = sendAdminBroadcast;
  window.sendAdminNotificationToUser = sendAdminNotificationToUser;
  window.openNotifications = openNotifications;
  window.toggleRiderStatus = toggleRiderStatus;
  window.adminSubmitOrderToVendor = adminSubmitOrderToVendor;
  window.viewOrderPath = viewOrderPath;
  window.viewOrderDetails = viewOrderDetails;
  window.triggerAdminPhotoUpload = triggerAdminPhotoUpload;
  window.adminBroadcastToRiders = adminBroadcastToRiders;
  window.exportDashboardImage = exportDashboardImage;
  window.triggerRestaurantImport = triggerRestaurantImport;
  window.handleRestaurantImport = handleRestaurantImport;
  window.openAssignRiderModal = openAssignRiderModal;
  window.confirmAssignRider = confirmAssignRider;
  window.requestRiderGPSAccess = requestRiderGPSAccess;
  window.closeAdminAddModal = closeAdminAddModal;
  window.saveAdminData = saveAdminData;
  window.openMerchantMenu = openMerchantMenu;
  window.openMerchantOrders = openMerchantOrders;
  window.toggleMenuItemActive = toggleMenuItemActive;
  window.openEditItemScreen = openEditItemScreen;
  window.updateOrderStatus = updateOrderStatus;
  window.togglePromotionStatus = togglePromotionStatus;
  window.openAdminNotificationModal = openAdminNotificationModal;
  window.closeAdminNotificationModal = closeAdminNotificationModal;
  window.editRider = editRider;
  window.openAdminMenuManager = openAdminMenuManager;
  window.chatWithRider = chatWithRider;
  window.addNewPromotion = addNewPromotion;
  window.editPromotion = editPromotion;
  window.filterAdminPayments = filterAdminPayments;
  window.filterAdminSupport = filterAdminSupport;
  window.assignSupportTicket = assignSupportTicket;
  window.viewSupportTicket = viewSupportTicket;
  window.openAdminModal = openAdminModal;
  window.deleteAdminItem = deleteAdminItem;
  window.toggleAdminItemStatus = toggleAdminItemStatus;
  window.toggleRiderAccountStatus = toggleRiderAccountStatus;
  window.approveCustomer = approveCustomer;
  window.processPayment = processPayment;
  window.refundPayment = refundPayment;
  window.contactCustomer = contactCustomer;
  window.contactRider = contactRider;
  window.verifyCustomerWhatsApp = verifyCustomerWhatsApp;
  window.updateAdminAnalyticsDate = updateAdminAnalyticsDate;
  window.sortAdminTable = sortAdminTable;
  window.toggleMissingPhotoFilter = toggleMissingPhotoFilter;
  window.toggleAdminMapActiveOnly = toggleAdminMapActiveOnly;
  window.toggleAdminReadyOnly = toggleAdminReadyOnly;
  window.toggleAdminHeatmap = toggleAdminHeatmap;
  window.enableAdminZoneDraw = enableAdminZoneDraw;
  window.exportAdminMap = exportAdminMap;
  window.toggleAdminMapFullscreen = toggleAdminMapFullscreen;
  window.toggleAdminLayer = toggleAdminLayer;
  window.exportTipReportPDF = exportTipReportPDF;
  window.closeAdminPathModal = closeAdminPathModal;
  window.deleteSelectedAdminOrders = deleteSelectedAdminOrders;
  window.toggleSelectAllAdminOrders = toggleSelectAllAdminOrders;
  window.searchAdminOrders = searchAdminOrders;
  window.filterAdminOrders = filterAdminOrders;
  window.filterAdminRestaurants = filterAdminRestaurants;
  window.filterAdminRiders = filterAdminRiders;
  window.filterAdminCustomers = filterAdminCustomers;
  window.loadMoreAdminData = loadMoreAdminData;
  window.openChat = openChat;
  window.showLoginScreen = () => {
      window.toggleAuthMode('login');
      document.getElementById('loginScreen')?.classList.add('active');
      // MAINTENANCE: Restrict UI entry points to Admin only as requested
      if(document.getElementById('guestLoginBtn')) document.getElementById('guestLoginBtn').style.display = 'none';
      // Hide the Signup option container to prevent new user attempts
      const signupToggle = document.querySelector('#loginFields .auth-toggle-btn');
      if(signupToggle && signupToggle.parentElement) signupToggle.parentElement.style.display = 'none';
  };
  window.loginAsGuest = loginAsGuest;
  
  window.showVerificationScreen = (message = "Securing Session...") => {
      let screen = document.getElementById('verificationLoadingScreen');
      if (!screen) {
          screen = document.createElement('div');
          screen.id = 'verificationLoadingScreen';
          screen.className = 'approval-gate';
          screen.style.zIndex = '15000';
          screen.innerHTML = `<div class="spinner" style="width:50px; height:50px; border:5px solid #f3f3f3; border-top:5px solid #019E81; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:20px;"></div><h2 style="color:#333;">${message}</h2><p style="color:#666; margin-top:10px;">Please wait while we verify your credentials.</p><style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>`;
          document.body.appendChild(screen);
      } else {
          screen.querySelector('h2').textContent = message;
          screen.style.display = 'flex';
      }
  };

  window.fillDemo = function(role) {
    const nameInput = document.getElementById('loginName');
    const phoneInput = document.getElementById('loginPhone');

    // Update the active role button and global selected role
    document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.role-btn[data-role="${role}"]`).classList.add('active');
    selectedLoginRole = role; // Update the global selected role

    // Clear all fields first to ensure only relevant ones are filled
    nameInput.value = "";
    if (phoneInput) phoneInput.value = "";

    // Fill common fields based on role
    if(role === 'user') {
        nameInput.value = "John Doe";
        if (phoneInput) phoneInput.value = "+971 50 123 4567";
    } else if(role === 'rider') {
        nameInput.value = "Ahmed Hassan";
        if (phoneInput) phoneInput.value = "+971 50 111 2222";
    } else if(role === 'vendor') {
        nameInput.value = "Burger King";
        if (phoneInput) phoneInput.value = "+971 4 123 4567";
    } else if(role === 'admin') {
        nameInput.value = "Sadik";
        if (phoneInput) phoneInput.value = "+971 56 288 9428";
    }
  };

  window.toggleAuthMode = function(mode) {
    const loginFields = document.getElementById('loginFields');
    const signupFields = document.getElementById('signupFields');
    const title = document.querySelector('.login-title');
    const subtitle = document.querySelector('.login-subtitle');
    const authStatusMsg = document.getElementById('authStatusMsg');

    // If an account is currently under verification, prevent showing input fields
    if (authStatusMsg && authStatusMsg.style.display === 'block') {
        if (mode === 'signup') {
            if(loginFields) loginFields.style.display = 'none';
            if(signupFields) signupFields.style.display = 'block';
            signupFields.querySelectorAll('.login-input-group, .strength-container').forEach(el => el.style.display = 'none');
        } else {
            if(loginFields) loginFields.style.display = 'block';
            if(signupFields) signupFields.style.display = 'none';
            loginFields.querySelectorAll('.login-input-group').forEach(el => el.style.display = 'none');
            if(document.getElementById('loginExtraLinks')) document.getElementById('loginExtraLinks').style.display = 'none';
        }
        return;
    }

    if (mode === 'signup') {
        if(loginFields) loginFields.style.display = 'none';
        if(signupFields) signupFields.style.display = 'block';
        if(title) title.textContent = 'Create Account';
        if(subtitle) subtitle.textContent = 'Join Kirya and enjoy fast deliveries.';
    } else {
        if(loginFields) loginFields.style.display = 'block';
        if(signupFields) signupFields.style.display = 'none';
        if(title) title.textContent = 'Welcome to Kirya';
        if(subtitle) subtitle.textContent = 'Delivery made simple. Sign in to continue.';
    }
  };

  window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    const btn = input.nextElementSibling;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '👁️';
    } else {
        input.type = 'password';
        btn.textContent = '🙈';
    }
  };

  window.checkPasswordStrength = function(val) {
    const meter = document.getElementById('passwordStrength');
    if(!meter) return;
    let strength = 0;
    if(val.length > 0) strength++;
    if(val.length >= 6) strength++;
    if(val.match(/[0-9]/)) strength++;
    if(val.match(/[A-Z]/) || val.match(/[^a-zA-Z0-9]/)) strength++;
    const colors = ['#eee', '#ff4757', '#ffa502', '#7ec6ff', '#2ed573'];
    const widths = ['0%', '25%', '50%', '75%', '100%'];
    meter.style.backgroundColor = colors[strength];
    meter.style.width = widths[strength];
  };

let merchantMenuItems = [
    {
        name: "Main Courses",
        items: [
            { id: 1, name: "Double Cheese Burger", price: 25.00, img: "🍔", active: true },
            { id: 2, name: "Spicy Chicken Wings", price: 30.00, img: "🍗", active: true },
        ]
    },
    {
        name: "Sides & Drinks",
        items: [
            { id: 3, name: "Coca Cola", price: 5.00, img: "🥤", active: true },
            { id: 4, name: "French Fries", price: 15.00, img: "🍟", active: false }
        ]
    }
];

// --- CONFIGURATION ---
const OSRM_SERVER_URL = "https://router.project-osrm.org"; // REPLACE WITH YOUR PRIVATE OSRM URL

// --- USER PROFILE INTEGRATION START ---
window.currentUser = {
    name: '',
    phone: '',
    points: 500, // Welcome bonus
    isApproved: false,
    walletBalance: 0,
    favorites: [], // Stores restaurant names,
    rememberMe: true,
    savedAddresses: [],
    orders: [],
    cart: [],
    notifications: [],
    settings: {}, 
    isGuest: true
};


// New function to update all profile-related UI elements
function updateProfileUI() {
    if (currentUser.isGuest) {
        document.getElementById('profileNameDisplay').textContent = 'Guest User';
        document.getElementById('profilePhoneDisplay').textContent = 'Log in to see your details';
        return;
    }

    document.getElementById('profileNameDisplay').textContent = currentUser.name;
    document.getElementById('profilePhoneDisplay').textContent = currentUser.phone;
    
    const walletStat = document.querySelector('#profileScreen .stat-item:nth-child(2) .stat-value');
    const pointsStat = document.querySelector('#profileScreen .stat-item:nth-child(3) .stat-value');
    const ordersStat = document.querySelector('#profileScreen .stat-item:nth-child(1) .stat-value');

    if(walletStat) walletStat.textContent = `UGX ${(currentUser.walletBalance || 0).toLocaleString()}`;
    if(pointsStat) pointsStat.textContent = (currentUser.points || 0).toLocaleString();
    if(ordersStat) ordersStat.textContent = (currentUser.orders?.length || 0);

    // Update profile picture if available
    // ... (logic for profile pic can be added here) ...
}

// Initialize User
function loadUserProfile() {
    try {
        const storedProfile = localStorage.getItem('kirya_user_profile') || sessionStorage.getItem('kirya_user_profile');
        if (storedProfile) {
            const parsed = JSON.parse(storedProfile);
            // Merge to ensure structure integrity if schema changes
            currentUser = { ...currentUser, ...parsed, isGuest: false };
            
            // Sync Favorites Set from Array
            favorites = new Set(currentUser.favorites || []);
            
            // Sync Global Vars (Backward Compatibility)
            userPoints = currentUser.points || 0;
            userWalletBalance = currentUser.walletBalance || 0;
            recipientDetails = { name: currentUser.name, phone: currentUser.phone };
            userPhoneNumber = currentUser.phone;
            
            // Sync Cart
            if (currentUser.cart && Array.isArray(currentUser.cart)) {
                cart = currentUser.cart;
                window.cart = currentUser.cart;
            }

            // Sync Notifications
            if (currentUser.notifications && Array.isArray(currentUser.notifications)) {
                notifications = currentUser.notifications;
                window.notifications = currentUser.notifications;
            }

            // Sync Settings
            if (currentUser.settings) {
                const s = currentUser.settings;
                if(s.allergyNotes) allergyNotes = s.allergyNotes;
                if(s.address) {
                    document.getElementById('selectedAddressText').textContent = s.address;
                    document.getElementById('selectedAddress').textContent = s.addressFull || s.address;
                }
                // Other settings (push, loc) are UI toggles handled in startApp or when screen opens
            }

            updateProfileUI(); // Update all profile UI elements

            return true; // User loaded
        }
    } catch (e) { console.error('Profile load error', e); }
    return false; // No user
}

function saveUserProfile(syncToDb = true) {
    // Sync Global Vars back to Object
    currentUser.favorites = Array.from(window.favorites || favorites);
    currentUser.points = userPoints;
    currentUser.walletBalance = userWalletBalance;
    currentUser.cart = window.cart || cart;
    currentUser.notifications = window.notifications || notifications;
    
    // currentUser.settings is updated via saveUserSettings
    // currentUser.orders is updated via placeOrder logic
    
    if (currentUser.rememberMe) {
        localStorage.setItem('kirya_user_profile', JSON.stringify(currentUser));
        sessionStorage.removeItem('kirya_user_profile');
    } else {
        sessionStorage.setItem('kirya_user_profile', JSON.stringify(currentUser));
        localStorage.removeItem('kirya_user_profile');
    }
    
    // 3. PUSH LOCAL CHANGES TO DATABASE
    const isMockId = currentUser.id && (currentUser.id.toString().startsWith('mock_') || !isNaN(currentUser.id));

    if (syncToDb && db && currentUser.id && !currentUser.isGuest && !isMockId) {
        const col = currentUser._collection || 'users';
        db.collection(col).doc(currentUser.id.toString()).set(currentUser, { merge: true })
            .catch(e => console.error("User profile sync error", e));
    }
}

function proceedToHome(skipSave = false) {
    isRouted = true;
    if (!skipSave) saveUserProfile(true); 

    const loginScreen = document.getElementById('loginScreen');
    const home = document.getElementById('home');
    const waitScreen = document.getElementById('waitingApprovalScreen');
    const statusMsg = document.getElementById('authStatusMsg');

    const loginFields = document.getElementById('loginFields');
    const signupFields = document.getElementById('signupFields');
    const socialLoginRow = document.getElementById('socialLoginRow');
    const guestLoginBtn = document.getElementById('guestLoginBtn');

    // --- CRITICAL: ADMIN-ONLY LOCKDOWN ---
    // The user requested to only allow 'Main Admin' access for now.
    // This check stops non-admins from bypassing the login page via auto-login or guest mode.
    const role = window.currentUser?.role;
    const isAdmin = role === 'admin' || role === 'Super Admin' || role === 'Manager';
    
    if (!isAdmin) {
        if (window.hideLoading) window.hideLoading();
        loginScreen?.classList.add('active');
        if (statusMsg) {
            statusMsg.innerHTML = `🚫 <b>Admin Access Only</b><br>The platform is currently limited to administrator accounts. Access for regular users and guests is temporarily disabled.`;
            statusMsg.style.display = 'block';
        }
        if (guestLoginBtn) guestLoginBtn.style.display = 'none';
        return; // HALT: Block entry to home or admin portals for non-admin roles
    }

    // --- ACCOUNT APPROVAL CHECK ---

    // CRITICAL SECURITY: If the account is not approved, clear restoration memory 
    // to prevent the app from bypassing the gate on the next refresh.
    if (!window.currentUser.isGuest && window.currentUser.isApproved !== true) {
        sessionStorage.removeItem('kirya_last_screen');
    }
    if (document.getElementById('verificationLoadingScreen')) {
        document.getElementById('verificationLoadingScreen').style.display = 'none';
    }

    // If account is not approved, stay on login page with a verification message
    if (!window.currentUser.isGuest && window.currentUser.isApproved !== true) {
        if (window.hideLoading) window.hideLoading();

        // --- ABSOLUTE GATEKEEPER: Hide ALL app screens ---
        if (home) home.style.display = 'none';
        if (document.getElementById('mapScreen')) document.getElementById('mapScreen').style.display = 'none';
        document.querySelectorAll('.generic-screen, #newHomeScreen, #adminScreen, #riderScreen, #shopPortalScreen').forEach(s => {
            s.classList.remove('active');
        });

        // Show the waiting screen or login screen with status
        loginScreen?.classList.add('active');
        if (statusMsg) {
            statusMsg.innerHTML = `✨ <b>Account Under Verification</b><br>Thank you for joining Kirya! Our team is reviewing your details. We will notify you once your account is ready.
            <br><br>
            <button onclick="window.open('https://wa.me/971562889428', '_blank')" style="background:none; border:1px solid #019E81; color:#019E81; padding:10px 20px; border-radius:25px; font-weight:bold; cursor:pointer; font-size:0.95em; display:flex; align-items:center; gap:8px; justify-content:center; margin:10px auto; width:100%;"><span>💬</span> Contact Support Center</button>
            <button onclick="window.confirmLogout()" style="background:none; border:none; color:#666; font-size:0.85em; font-weight:bold; cursor:pointer; margin-top:5px; text-decoration:underline;">Logout / Switch Account</button>`;
            statusMsg.style.display = 'block';
        }
        
        // Hide input boxes and credential links but keep main action and toggle buttons
        if (loginFields) {
            loginFields.querySelectorAll('.login-input-group').forEach(el => el.style.display = 'none');
            if(document.getElementById('loginExtraLinks')) document.getElementById('loginExtraLinks').style.display = 'none';
            loginFields.style.display = 'block';
        }
        if (signupFields) {
            signupFields.querySelectorAll('.login-input-group, .strength-container').forEach(el => el.style.display = 'none');
            signupFields.style.display = 'none';
        }

        if (socialLoginRow) socialLoginRow.style.display = 'flex';
        if (guestLoginBtn) guestLoginBtn.style.display = 'block';
        return; // Halt routing to prevent showing app content
    }

    if (statusMsg) statusMsg.style.display = 'none';
    // Ensure any full-screen pending overlays are deactivated upon approval
    if (waitScreen) waitScreen.classList.remove('active');
    
    // If approved or guest, ensure login fields and inputs are visible
    if (loginFields) {
        loginFields.style.display = 'block';
        loginFields.querySelectorAll('.login-input-group').forEach(el => el.style.display = 'flex');
        if(document.getElementById('loginExtraLinks')) document.getElementById('loginExtraLinks').style.display = 'flex';
    }
    if (signupFields) {
        signupFields.querySelectorAll('.login-input-group, .strength-container').forEach(el => el.style.display = 'flex');
    }
    // --- RESTORE PREVIOUS SESSION SCREEN ---
    try {
        const lastScreenId = sessionStorage.getItem('kirya_last_screen');
        const noRestoreScreens = ['merchantMenuScreen', 'merchantEditItemScreen', 'merchantOrdersScreen', 'loginScreen', 'splash', 'notificationsScreen', 'waitingApprovalScreen'];
        
        if (lastScreenId && !noRestoreScreens.includes(lastScreenId) && lastScreenId !== 'home') {
            // Requirement: Guests always start at the initial address selection screen
            if (currentUser.isGuest && (lastScreenId === 'newHomeScreen' || lastScreenId.includes('Screen'))) {
                sessionStorage.removeItem('kirya_last_screen');
            } else {
            const screen = document.getElementById(lastScreenId);
            if (screen) {
                if (home) home.style.display = 'none';
                loginScreen?.classList.remove('active');
                
                if (lastScreenId === 'mapScreen') {
                    screen.style.display = 'block';
                    setTimeout(() => document.getElementById('bottomCard').classList.add('show'), 200);
                    if(typeof showMap === 'function') showMap();
                } else {
                    screen.classList.add('active');
                    if(lastScreenId === 'adminScreen') setTimeout(() => switchAdminTab('dashboard'), 100);
                    if(lastScreenId === 'riderScreen') setTimeout(initRiderMap, 300);
                    if(lastScreenId === 'shopPortalScreen') setTimeout(initMerchantCharts, 300);
                }
                updateProfileUI();
                return; // Session restored, exit default routing
            }
            }
        }
    } catch(e) { console.error("Restore screen error", e); }
    // --- END RESTORE ---

    if (!currentUser.isGuest) {
        showToast(`Login successful! Welcome back, ${currentUser.username || currentUser.name}`);
    }

    recipientDetails = { name: currentUser.username || currentUser.name, phone: currentUser.phone };
    userPhoneNumber = currentUser.phone;
    
    loginScreen?.classList.remove('active');
    if (socialLoginRow) socialLoginRow.style.display = 'flex';
    if (guestLoginBtn) guestLoginBtn.style.display = 'block';

    // Clear all portal screens to prevent overlap before routing
    document.querySelectorAll('#adminScreen, #riderScreen, #shopPortalScreen').forEach(s => s.classList.remove('active'));

    if (role === 'admin' || role === 'Super Admin' || role === 'Manager') openAdmin();
    else if (window.currentUser.role === 'rider') openRider();
    else if (window.currentUser.role === 'vendor') openShopPortal();
    else {
        // Regular User Logic: Jump to Categories if address is already known
        const hasAddress = currentUser.settings?.address && currentUser.settings.address !== 'Selected address not set';
        if (!currentUser.isGuest && hasAddress) {
            // Logged in with a saved address: Show Home with Categories
            if(home) home.style.display = 'none';
            document.getElementById('newHomeScreen').classList.add('active');
            if(typeof renderCategoryContent === 'function') renderCategoryContent('Food');
        } else {
            // Guest or Logged in without address: Start at Address Selection
            if (home) home.style.display = 'block';
            document.getElementById('newHomeScreen').classList.remove('active');
        }
    }

    // --- WHITE SCREEN SAFETY ---
    // If after routing no screen is visible, force back to home/login
    setTimeout(() => {
        const anyActive = document.querySelector('.generic-screen.active, #newHomeScreen.active, #mapScreen[style*="block"], #home[style*="block"]');
        if (!anyActive) {
            if (home) home.style.display = 'block';
            else loginScreen?.classList.add('active');
        }
    }, 200);

    // Request push notifications if approved and NOT a mock user (requires valid Firebase Auth context)
    const isMockId = currentUser.id && (currentUser.id.toString().startsWith('mock_') || !isNaN(currentUser.id));
    const isAuthenticated = window.auth && window.auth.currentUser;
    if (currentUser.isApproved && !currentUser.isGuest && isAuthenticated && !isMockId) {
        setTimeout(() => window.requestNotificationPermission(), 2000);
    }
    updateProfileUI();
}

window.handleLogin = async function() {
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const rememberMeEl = document.getElementById('loginRememberMe');
    const rememberMe = rememberMeEl ? rememberMeEl.checked : true;

    const statusMsg = document.getElementById('authStatusMsg');
    if (statusMsg) statusMsg.style.display = 'none';

    if (!identifier) { await window.customPopup({ title: 'Missing Information', message: "Please enter your username, email, or phone number to sign in.", type: 'alert' }); return; }
    if (!password) { await window.customPopup({ title: 'Missing Information', message: "Please enter your password.", type: 'alert' }); return; }

    // --- INPUT VALIDATION ---
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isEmail = identifier.includes('@');

    if (isEmail) {
        if (!emailRegex.test(identifier)) { window.customPopup({ title: 'Format Error', message: "The email address you entered is not in a valid format.", type: 'alert' }); return; }
    }

    // --- FIREBASE UNIVERSAL LOGIN ---
    if (window.auth && window.db) {
        try {
            if (window.showLoading) window.showLoading("Identifying Account...");

            let emailToSignIn = identifier.trim();

            // 1. If identifier is NOT an email, look it up in Firestore
            if (!isEmail) {
                const collections = ['admin_accounts', 'riders', 'restaurants', 'users'];
                const cleanIdentifier = identifier.trim();

                // Perform all identity lookups in parallel for maximum speed
                const searchPromises = collections.flatMap(col => [
                    window.db.collection(col).where('username', '==', cleanIdentifier).limit(1).get(),
                    window.db.collection(col).where('phone', '==', cleanIdentifier).limit(1).get()
                ]);

                const snapshots = await Promise.all(searchPromises);
                const match = snapshots.find(snap => !snap.empty);

                if (match) {
                    emailToSignIn = match.docs[0].data().email;
                } else {
                    if (window.hideLoading) window.hideLoading();
                    await window.customPopup({ title: 'Account Not Found', message: "No account found with '" + cleanIdentifier + "'. Please check your spelling or register a new account.", type: 'alert' });
                    return;
                }
            }

            // 2. Sign in with the resolved email
            if (window.showLoading) window.showLoading("Verifying Password...");
            await window.auth.signInWithEmailAndPassword(emailToSignIn, password);
            
            // Role-based routing is handled automatically by onAuthStateChanged in firebase.js
            return;

        } catch (e) {
            console.error("Login Error:", e.message);
            if (window.hideLoading) window.hideLoading();
            
            let title = 'Login Failed';
            let message = e.message;

            // Map Firebase error codes to friendly messages
            if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
                title = 'Incorrect Password';
                message = 'Incorrect credentials. If this is a new account, ensure it is created in the Firebase Auth console or use the bootstrap tool.';
            } else if (e.code === 'auth/user-not-found') {
                title = 'Account Not Found';
                message = 'We couldn\'t find an account matching that email address.';
            } else if (e.code === 'auth/too-many-requests') {
                title = 'Security Lock';
                message = 'Too many failed login attempts. Access has been temporarily disabled. Please try again in a few minutes.';
            }

            await window.customPopup({ title, message, type: 'alert' });
            return;
        }
    }

    // --- FALLBACK: DATABASE LOOKUP (If Firebase Auth fails/is missing) ---
    if (db) {
        try {
            // Placeholder: Search 'users' collection by username/email for Firestore
            const snapshot = await db.collection('users').where('username', '==', identifier).limit(1).get();
            
            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                await processExistingUser(userData, snapshot.docs[0].id, userData.role || 'user', rememberMe);
                return;
            }

            if (await showRegistrationConfirmation("Account not found. Would you like to register?")) {
                await registerNewUser(identifier, identifier, 'user', rememberMe);
            }
        } catch (e) {
            if (e.code === 'permission-denied') {
                console.warn("Firestore access denied. Ensure security rules allow unauthenticated 'users' reads.");
                showToast("⚠️ Access Denied. Please use Google Login or contact support to white-list your account.");
            } else {
                console.error("Login Error", e);
                showToast("Login failed. Check connection.");
            }
        }
    } else {
        showToast("Offline: Demo account not found.");
    }
};

window.handleSignUp = async function() {
    // MAINTENANCE LOCK: Disable new user registration
    if (window.showToast) window.showToast("🚫 Registration is currently disabled.");
    return;

    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const password = document.getElementById('signupPassword').value.trim();
    const rememberMeEl = document.getElementById('loginRememberMe');
    const rememberMe = rememberMeEl ? rememberMeEl.checked : true;

    if (!name || !email || !password || !phone) {
        await window.customPopup({ title: 'Missing Information', message: "Please fill in all fields to sign up.", type: 'alert' });
        return;
    }

    // Country Format Validation (+256 followed by 9 digits)
    let cleanPhone = phone.replace(/\s+/g, '');
    // Auto-fix common local formats to international standard
    if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
        cleanPhone = '+256' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('256') && cleanPhone.length === 12) {
        cleanPhone = '+' + cleanPhone;
    }

    const ugPhoneRegex = /^\+256\d{9}$/;
    if (!ugPhoneRegex.test(cleanPhone)) {
        await window.customPopup({ title: 'Invalid Phone Number', message: "Please enter a valid Ugandan phone number starting with +256 followed by 9 digits (e.g., +256 700 000 000).", type: 'alert' });
        return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { await window.customPopup({ title: 'Invalid Email', message: "Sign up requires a valid email address.", type: 'alert' }); return; }
    if (password.length < 6) { await window.customPopup({ title: 'Weak Password', message: "For your security, password must be at least 6 characters.", type: 'alert' }); return; }

    if (window.auth && window.db) {
        try {
            if (window.showLoading) window.showLoading("Creating Your Account...");
            
            // 1. Create Auth User
            const userCredential = await window.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // 2. Prepare Profile Data
            const profile = {
                id: user.uid,
                name: name,
                email: email,
                phone: phone,
                role: 'user',
                isApproved: false, // Default state for new users
                points: 500, // Sign-up bonus
                walletBalance: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                authRegistered: true
            };

            // 3. Connect to Database (Save to Firestore)
            await window.db.collection('users').doc(user.uid).set(profile);
            if (window.hideLoading) window.hideLoading();
            const statusMsg = document.getElementById('authStatusMsg');
            if (statusMsg) {
                statusMsg.innerHTML = "🎉 <b>Account Created Successfully!</b><br>Your account is now under verification. You'll gain access once approved.";
                statusMsg.style.display = 'block';
            }
        } catch (e) {
            if (window.hideLoading) window.hideLoading();
            console.error("Sign Up Error:", e);
            await window.customPopup({ title: 'Sign Up Failed', message: e.message, type: 'alert' });
        }
    }
};

function loginAsGuest() {
    showToast("Entering as Guest...");
    window.currentUser = { ...window.currentUser, isGuest: true, isApproved: true, role: 'user', name: 'Guest User' };
    proceedToHome();
}

async function registerNewUser(username, phone, role, rememberMe) {
    if (db) {
        try {
            const newUser = {
                username: username,
                phone: phone,
                role: role,
                isApproved: true, // Grant immediate approval for development/sample data
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                orders: [],
                walletBalance: 0,
                points: 500
            };
            const docRef = db.collection('users').doc(); 
            await docRef.set(newUser);
            currentUser = { ...currentUser, ...newUser, id: docRef.id, isGuest: false };
            currentUser.rememberMe = rememberMe;
            setupUserProfileListener(docRef.id);

            showToast("Registration successful! Awaiting approval.");
            proceedToHome();
            
        } catch(e) {
            showToast("Registration failed: " + e.message);
        }
    }
}

// This function is called by completeAuthFlow when an existing user is found
async function processExistingUser(userData, docId, role, rememberMe) {
    // Role Authorization Check: Prevent users from logging into roles they don't possess in the database
    if (userData.role && userData.role !== role && !(role === 'admin' && (userData.role === 'Super Admin' || userData.role === 'Manager'))) {
        showToast(`Access Denied: Your account is registered as "${userData.role}", not "${role}".`);
        if (window.auth.currentUser) await window.auth.signOut();
        
        // Re-enable the login button to allow the user to try again
        const loginBtn = document.getElementById('mainLoginBtn');
        if (loginBtn) { loginBtn.disabled = false; loginBtn.style.opacity = '1'; }
        return;
    }

    window.currentUser = {
        ...window.currentUser, // Keep existing guest data if any
        ...userData,
        id: docId,
        role: role, // Use selected role for routing consistency
        isGuest: false,
        rememberMe: rememberMe,
        isApproved: userData.isApproved || false 
    };
    
    showToast(`Welcome, ${window.currentUser.username || window.currentUser.name}!`);
    setupUserProfileListener(window.currentUser.id); // Start listening for profile changes
    proceedToHome();
}

window.approveUser = async function(userId) {
    if(db) {
        try {
            await db.collection('users').doc(userId).update({ isApproved: true });
            showToast("User approved!");
        } catch(e) {
            showToast("Error: " + e.message);
        }
    }
};

// --- GENERIC CUSTOM POPUP ENGINE ---
window.customPopup = function({ title = '', message = '', type = 'alert', defaultValue = '', placeholder = '' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'custom-popup-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);display:flex;justify-content:center;align-items:center;z-index:30000;animation:fadeIn 0.2s ease;';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:20px;padding:25px;max-width:350px;width:90%;box-shadow:0 15px 50px rgba(0,0,0,0.3);text-align:center;animation:slideUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);';
        
        let inputHtml = '';
        if (type === 'prompt') {
            inputHtml = `<input type="text" id="popupInput" value="${defaultValue}" placeholder="${placeholder}" style="width:100%;padding:12px;margin:15px 0;border:1px solid #ddd;border-radius:10px;font-size:1em;outline:none;border-color:#019E81;">`;
        }

        modal.innerHTML = `
            <h3 style="margin-bottom:10px;color:#333;">${title}</h3>
            <p style="color:#666;font-size:0.95em;line-height:1.5;margin-bottom:20px;">${message}</p>
            ${inputHtml}
            <div style="display:flex;gap:10px;justify-content:center;">
                ${type !== 'alert' ? `<button id="popupCancel" style="flex:1;padding:12px;border:1px solid #ddd;background:#f5f5f5;border-radius:10px;font-weight:bold;cursor:pointer;">Cancel</button>` : ''}
                <button id="popupConfirm" style="flex:1;padding:12px;background:#019E81;color:#fff;border:none;border-radius:10px;font-weight:bold;cursor:pointer;">OK</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        const cleanup = (val) => {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if(document.body.contains(overlay)) document.body.removeChild(overlay);
                resolve(val);
            }, 200);
        };

        const input = modal.querySelector('#popupInput');
        if(input) {
            input.focus();
            input.onkeypress = (e) => { if(e.key === 'Enter') cleanup(input.value); };
        }

        modal.querySelector('#popupConfirm').onclick = () => cleanup(type === 'prompt' ? input.value : true);
        if (type !== 'alert') {
            modal.querySelector('#popupCancel').onclick = () => cleanup(type === 'prompt' ? null : false);
        }
    });
};

window.rejectUser = async function(userId) {
    if(await customPopup({ title: 'Confirm Action', message: "Are you sure you want to reject and delete this user?", type: 'confirm' })) {
        if(db) {
            try {
                await db.collection('users').doc(userId).delete();
                showToast("User rejected and removed.");
            } catch(e) {
                showToast("Error: " + e.message);
            }
        }
    }
};
// --- USER PROFILE INTEGRATION END ---

// Custom Registration Confirmation Modal
async function showRegistrationConfirmation(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('registrationConfirmModal');
        const msgParagraph = modal.querySelector('p');
        msgParagraph.textContent = message;

        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('regConfirmRegisterBtn');
        const cancelBtn = document.getElementById('regConfirmCancelBtn');

        // Clear previous listeners to prevent multiple calls
        const newConfirmHandler = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', newConfirmHandler);
            cancelBtn.removeEventListener('click', newCancelHandler);
            resolve(true);
        };

        const newCancelHandler = () => {
            modal.style.display = 'none';
            confirmBtn.removeEventListener('click', newConfirmHandler);
            cancelBtn.removeEventListener('click', newCancelHandler);
            resolve(false);
        };

        confirmBtn.addEventListener('click', newConfirmHandler);
        cancelBtn.addEventListener('click', newCancelHandler);
    });
}


try {
    // Cart loaded via loadUserProfile now
} catch (e) { console.error(e); }

let cartSaveTimeout = null;
function saveCart() {
    currentUser.cart = cart;
    updateCartView();
    
    // Debounce profile save to improve performance
    if (cartSaveTimeout) clearTimeout(cartSaveTimeout);
    cartSaveTimeout = setTimeout(() => {
        saveUserProfile();
    }, 500);
}

function saveUserSettings() {
    try {
        // const existing = JSON.parse(localStorage.getItem('kirya_user_settings') || '{}');
        const settings = {
            ...currentUser.settings,
            recipientDetails,
            address: document.getElementById('selectedAddressText')?.textContent,
            addressFull: document.getElementById('selectedAddress')?.textContent,
            push: document.getElementById('settingPushToggle')?.checked,
            loc: document.getElementById('settingLocToggle')?.checked,
            biometric: document.getElementById('settingBiometricToggle')?.checked,
            allergyNotes: allergyNotes
        };
        if (typeof marker !== 'undefined' && marker) {
            const ll = marker.getLatLng();
            settings.coords = { lat: ll.lat, lng: ll.lng };
        }
        currentUser.settings = settings;
        saveUserProfile();
    } catch(e) { console.error('Error saving settings', e); }
}

let suggestedScrollInterval;
favorites = new Set(); // Initialized in loadUserProfile
let isCheckoutAccordionOpen = false; let allergyNotes = ''; let recipientDetails = { name: '', phone: '' }; let userPhoneNumber = '+971 50 123 4567'; let selectedPaymentMethod = { value: 'cod', icon: '💵', text: 'Cash on Delivery' }; let tipPercentage = 0;
let riderMarker, riderRoutePolyline, riderProgressPolyline, routeAnimationFrame;
let dailySalesChartInstance, topItemsChartInstance;
let trackMap, trackRiderMarker;
let trackRouteAnimationFrame;

// --- GLOBAL ADMIN & SYSTEM STATE ---
window.adminOrders = [];
window.adminRestaurants = [];
window.adminRiders = [];
window.adminCustomers = [];
window.adminPromotions = [];
window.adminPayments = [];
window.adminSupportTickets = [];
window.adminAccounts = [];
window.adminLogs = [];
window.adminAnalytics = { totalOrders: 0, totalRevenue: 0, totalCustomers: 0, totalRiders: 0, totalRestaurants: 0, topCategories: [], peakHours: [] };

// Local references for convenience
let adminOrders = window.adminOrders;
let adminRestaurants = window.adminRestaurants;
let adminRiders = window.adminRiders;
let adminCustomers = window.adminCustomers;
let adminPromotions = window.adminPromotions;
let adminPayments = window.adminPayments;
let adminSupportTickets = window.adminSupportTickets;
let adminAccounts = window.adminAccounts;
let adminLogs = window.adminLogs;
let adminAnalytics = window.adminAnalytics;

let userPoints = 1250;
let userWalletBalance = 0;

// Load persisted restaurants to enable saving
try {
    const savedRes = localStorage.getItem('kirya_restaurants');
    if(savedRes) adminRestaurants = JSON.parse(savedRes);
} catch(e) { console.error(e); }

// Settings State
let settingSoundEnabled = true;
try {
    const savedSound = localStorage.getItem('kirya_sound_enabled');
    if (savedSound !== null) {
        settingSoundEnabled = JSON.parse(savedSound);
    }
} catch (e) { console.error(e); }

const availableCoupons = [
    { id: 'C1', title: 'UGX 5.00 Off Delivery', desc: 'Valid on any order above UGX 20.00', cost: 500, icon: '🛵' },
    { id: 'C2', title: '10% Off Food Order', desc: 'Max discount UGX 15.00', cost: 1000, icon: '🍔' },
    { id: 'C3', title: 'Free Drink', desc: 'Get a free soft drink from participating stores', cost: 750, icon: '🥤' }
];

let pointsHistory = [ 
    { title: 'Order #9899', date: '2 days ago', points: 25, type: 'earned' },
    { title: 'Redeemed Coupon', date: '5 days ago', points: -500, type: 'spent' },
    { title: 'Order #9850', date: '1 week ago', points: 45, type: 'earned' },
    { title: 'Welcome Bonus', date: '2 weeks ago', points: 100, type: 'earned' }
];

let walletTransactions = [
    { title: 'Refund: Order #8818', date: 'Yesterday, 7:15 PM', amount: 5000, type: 'credit' },
    { title: 'Payment: Order #8817', date: '22 Oct, 1:00 PM', amount: -22000, type: 'debit' },
    { title: 'Top Up: Mobile Money', date: '20 Oct, 10:00 AM', amount: 50000, type: 'credit' }
];

function logActivity(action, details, user = 'System') {
    const time = new Date().toLocaleString();
    adminLogs.unshift({ time, action, user, details });
    if(adminLogs.length > 100) adminLogs.pop();
    if(document.getElementById('admin-logs') && document.getElementById('admin-logs').style.display === 'block') renderAdminLogs();
}

// --- SYNC LOGIC START ---
// Initialize from LocalStorage or use Mock Data
try {
    const savedOrders = localStorage.getItem('kirya_orders');
    if (savedOrders) {
        window.allOrders = JSON.parse(savedOrders);
        adminOrders = window.allOrders; // Keep references synced
    } else {
        window.allOrders = [];
    }
} catch (e) {
    console.error("Sync Init Error", e);
    window.allOrders = [];
}

function syncOrders() {
    localStorage.setItem('kirya_orders', JSON.stringify(window.allOrders));
    adminOrders = window.allOrders; // Ensure adminOrders ref stays updated
}

try {
    const savedRiders = localStorage.getItem('kirya_riders');
    if(savedRiders) {
        window.adminRiders = JSON.parse(savedRiders);
        adminRiders = window.adminRiders;
    } else localStorage.setItem('kirya_riders', JSON.stringify(window.adminRiders));
} catch(e) { console.error(e); }

function syncRiders() {
    localStorage.setItem('kirya_riders', JSON.stringify(adminRiders));
    localStorage.setItem('kirya_riders', JSON.stringify(window.adminRiders));
}

// --- SYNC LOGIC END ---


function hideMap(){ const m=document.getElementById('map'); if(m) m.style.display='none'; }
function showMap(){ const m=document.getElementById('map'); if(m) m.style.display='block'; }
function updateAddAddressBtn(){
  const btn = document.getElementById('addAddressBtn');
  if(!btn) return;
  const newHome = document.getElementById('newHomeScreen');
  const cat = document.getElementById('categoryScreen');
  if((newHome && newHome.classList.contains('active')) ||
     (cat && cat.classList.contains('active'))){
    btn.style.display='none';
  } else {
    btn.style.display='block';
  }
}

function playNotificationSound() {
    if (!settingSoundEnabled) return;
    const audio = document.getElementById('orderNotificationSound');
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log('Audio play prevented:', e));
    }
}

function handleLogout() {
    console.log("Logout initiated...");
    const modal = document.getElementById('logoutModal');
    if (modal) {
        modal.style.display = 'flex';
    } else {
        console.error("Logout modal element not found!");
        // Fallback: immediate logout if modal is missing
        if(confirm("Are you sure you want to sign out?")) confirmLogout();
    }
}


async function confirmLogout() {
    // Clear User Data
    localStorage.removeItem('kirya_user_profile');
    localStorage.removeItem('kirya_cart');
    localStorage.removeItem('kirya_user_settings');
    localStorage.removeItem('kirya_last_screen');
    localStorage.removeItem('kirya_notifications');
    sessionStorage.clear();
    
    // Sign out from Firebase Auth to clear the persistent session
    if (window.auth) {
        try { await window.auth.signOut(); } catch(e) { console.error("Firebase signout error", e); }
    }

    // Reset variables
    window.currentUser = { name: '', phone: '', points: 500, walletBalance: 0, favorites: [], savedAddresses: [], isGuest: true, isApproved: false };
    favorites = new Set();
    cart = [];
    notifications = [];
    
    // UI Reset
    updateCartView();
    updateBellDots();
    
    // Close Modal
    const logoutModal = document.getElementById('logoutModal');
    if (logoutModal) logoutModal.style.display = 'none';

    // Force Reload to clear state cleanly and show Login screen
    window.location.reload();
}

/* Merchant Menu Logic */
const merchantManageMenuBtn = document.getElementById('merchantManageMenuBtn');
const merchantMenuScreen = document.getElementById('merchantMenuScreen');
const merchantMenuBackBtn = document.getElementById('merchantMenuBackBtn');
const merchantAddMenuBtn = document.getElementById('merchantAddMenuBtn');
const merchantEditItemScreen = document.getElementById('merchantEditItemScreen');

function toggleMenuItemActive(itemId, categoryName) {
    const resId = document.getElementById('merchantMenuScreen').dataset.restaurantId;
    let menuSource;
    if (resId === 'current_vendor') {
        menuSource = merchantMenuItems;
    } else {
        const restaurant = adminRestaurants.find(r => r.id == resId);
        menuSource = restaurant ? restaurant.menu : null;
    }

    if (menuSource) {
        const category = menuSource.find(c => c.name === categoryName);
        if (category && category.items) {
            const item = category.items.find(i => i.id === itemId);
            if (item) {
                item.active = !item.active;
                showToast(`${item.name} is now ${item.active ? 'In Stock' : 'Out of Stock'}`);
                renderMerchantMenuItems(menuSource);
                if (resId !== 'current_vendor') {
                    localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
                }
            }
        }
    }
}

function renderMerchantMenuItems(menuData) {
    const list = document.getElementById('merchantMenuList');
    if(!list) return;
    list.innerHTML = '';
    
    if (!menuData || menuData.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">No menu categories found. Add one using the ➕ button.</div>';
        return;
    }

    // Normalize data: If it's a flat array of items, wrap it in a category
    let normalizedData = menuData;
    if (menuData.length > 0 && !menuData[0].items) {
        normalizedData = [{ name: "General Menu", items: menuData }];
    }

    normalizedData.forEach(category => {
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'dashboard-card';
        categoryDiv.style.marginBottom = '20px';

        let itemsHtml = (category.items || []).map(item => `
            <div class="menu-mgmt-item" style="cursor:pointer;" onclick="window.openEditItemScreen('${item.id}', '${category.name}')">
                <div class="menu-mgmt-info">
                    <div class="menu-mgmt-img" style="position:relative; width:50px; height:50px;">
                        ${window.getImageHtml(item.img, '🍽️', 'border-radius:10px;')}
                        <div style="position:absolute; bottom:-4px; right:-4px; background:#fff; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 5px rgba(0,0,0,0.15); font-size:10px; border:1px solid #eee;">✏️</div>
                    </div>
                    <div class="menu-mgmt-text">
                        <div class="menu-mgmt-name">${item.name} <span style="font-size:0.8em; opacity:0.5; margin-left:5px;">✏️</span></div>
                        <div class="menu-mgmt-price">UGX ${item.price.toFixed(2)}</div>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:center;" onclick="event.stopPropagation();">
                    <div class="menu-mgmt-toggle ${item.active ? 'active' : ''}" onclick="window.toggleMenuItemActive('${item.id}', '${category.name}')"></div>
                    <div style="font-size:0.7em; margin-top:4px; font-weight:bold; color:${item.active ? '#019E81' : '#aaa'};">${item.active ? 'In Stock' : 'Out of Stock'}</div>
                </div>
            </div>
        `).join('');

        if (!itemsHtml) {
            itemsHtml = '<div style="font-size:0.9em; color:#888; padding:10px;">No items in this category.</div>';
        }

        categoryDiv.innerHTML = `
            <h4 style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <span>${category.name}</span>
                <button onclick="openEditItemScreen(null, '${category.name}')" style="background:none; border:none; font-size:1.2em; cursor:pointer; color:#019E81;">➕</button>
            </h4>
            ${itemsHtml}
        `;
        list.appendChild(categoryDiv);
    });
}

function openEditItemScreen(itemId, categoryName) {
    const resId = document.getElementById('merchantMenuScreen').dataset.restaurantId;
    let menuSource;
    let restaurant;

    if (resId === 'current_vendor') {
        menuSource = merchantMenuItems;
    } else {
        restaurant = adminRestaurants.find(r => r.id == resId);
        menuSource = restaurant ? (restaurant.menu || []) : [];
    }

    const categoryContainer = document.getElementById('editItemCategoryContainer');
    categoryContainer.innerHTML = `
        <label for="editItemCategory" class="admin-form-label">Category</label>
        <select id="editItemCategory" class="admin-form-input">
            ${(menuSource || []).map(cat => `<option value="${cat.name}" ${cat.name === categoryName ? 'selected' : ''}>${cat.name}</option>`).join('')}
        </select>
    `;

    const titleEl = document.getElementById('editItemTitle');
    const nameInput = document.getElementById('editItemName');
    const priceInput = document.getElementById('editItemPrice');
    const imgInput = document.getElementById('editItemImg');
    const idInput = document.getElementById('editItemId');
    const deleteBtn = document.getElementById('deleteItemBtn');

    if (itemId === null) { // Add mode
        titleEl.textContent = 'Add New Item';
        nameInput.value = '';
        priceInput.value = '';
        imgInput.value = '';
        idInput.value = '';
        deleteBtn.style.display = 'none';
        if (categoryName) {
            document.getElementById('editItemCategory').value = categoryName;
        }
    } else { // Edit mode
        let item = null;
        const category = menuSource.find(c => c.name === categoryName);
        if (category && category.items) {
            item = category.items.find(i => i.id === itemId);
        }
        if (!item) return;
        titleEl.textContent = 'Edit Item';
        nameInput.value = item.name;
        priceInput.value = item.price;
        imgInput.value = item.img;
        idInput.value = item.id;
        deleteBtn.style.display = 'block';
        document.getElementById('editItemCategory').value = categoryName;
    }
    merchantEditItemScreen.classList.add('active');
    
    // Setup preview listeners
    setupPreview(['editItemURL', 'editItemImg', 'editItemPhoto'], 'editItemPreview', '🍽️');
}

// New Global Functions for Robust Navigation
function openMerchantMenu() {
    const screen = document.getElementById('merchantMenuScreen');
    if(screen) {
        screen.dataset.restaurantId = 'current_vendor';
        screen.classList.add('active');
        renderMerchantMenuItems(merchantMenuItems);
    }
}

function openMerchantOrders() {
    const screen = document.getElementById('merchantOrdersScreen');
    if(screen) {
        renderMerchantOrders();
        screen.classList.add('active');
    }
}

// Listeners for the Edit Item Screen
document.getElementById('saveItemBtn')?.addEventListener('click', async () => {
    const resId = document.getElementById('merchantMenuScreen').dataset.restaurantId;
    let targetMenuArray;

    if (resId === 'current_vendor') {
        targetMenuArray = merchantMenuItems;
    } else {
        const restaurant = adminRestaurants.find(r => r.id == resId);
        if (restaurant) {
            if (!restaurant.menu) restaurant.menu = [];
            targetMenuArray = restaurant.menu;
        } else {
            showToast('Error: Could not find restaurant to save menu item.');
            return;
        }
    }
    const id = document.getElementById('editItemId').value;
    const name = document.getElementById('editItemName').value;
    const price = parseFloat(document.getElementById('editItemPrice').value);
    const img = document.getElementById('editItemImg').value;
    const urlLink = document.getElementById('editItemURL').value.trim();
    const photoFile = document.getElementById('editItemPhoto').files[0];
    const categoryName = document.getElementById('editItemCategory').value;

    if (!name || isNaN(price) || !categoryName) { showToast('Please fill required fields.'); return; }
    
    const confirmed = await customPopup({ title: 'Confirm Save', message: `Save changes to "${name}"?`, type: 'confirm' });
    if (!confirmed) return;

    const saveProcess = (imageSource = null) => {
        if (id) { // Edit
        let item, oldCategoryName;
        // Find item and its original category
        for (const cat of targetMenuArray) {
            const foundItem = cat.items?.find(i => i.id == id);
            if (foundItem) {
                item = foundItem;
                oldCategoryName = cat.name;
                break;
            }
        }

        if (item) {
            Object.assign(item, { name, price, img: imageSource || urlLink || img });
            if(imageSource || urlLink) item.isCustomImage = true;
            if (oldCategoryName !== categoryName) {
                // remove from old category
                const oldCat = targetMenuArray.find(c => c.name === oldCategoryName);
                if(oldCat && oldCat.items) oldCat.items = oldCat.items.filter(i => i.id != id);
                // add to new category
                const newCat = targetMenuArray.find(c => c.name === categoryName);
                if (newCat) {
                    if (!newCat.items) newCat.items = [];
                    newCat.items.push(item);
                }
            }
        }
    } else { // Add new
        const newId = Date.now();
        const category = targetMenuArray.find(c => c.name === categoryName);
        const newItem = { id: newId, name, price, img: imageSource || urlLink || img, active: true };
        if(imageSource || urlLink) newItem.isCustomImage = true;

        if (category) {
            if (!category.items) category.items = [];
            category.items.push(newItem);
        } else {
            // If category somehow doesn't exist, create it
            targetMenuArray.push({ name: categoryName, items: [newItem] });
        }
    }
    
    if (resId !== 'current_vendor') {
        localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
        // Fix: Sync menu changes to Firebase so they persist after refresh
        if (window.db) {
            const restaurant = adminRestaurants.find(r => r.id == resId);
            if (restaurant) {
                window.db.collection('restaurants').doc(resId.toString()).set(restaurant, { merge: true });
            }
        }
    }

    renderMerchantMenuItems(targetMenuArray);
    merchantEditItemScreen.classList.remove('active');
    showToast('Menu item saved.');
    };

    if (photoFile) {
        try {
            showToast("Optimizing & Uploading...");
            const blob = await compressImage(photoFile);
            const path = `menu/${Date.now()}_item.jpg`;
            const url = await uploadImageToStorage(blob, path);
            addToRecentUploads(url);
            saveProcess(url);
        } catch(e) { console.error(e); showToast("Upload failed"); }
    } else {
        saveProcess();
    }
});

document.getElementById('deleteItemBtn')?.addEventListener('click', async () => {
    const resId = document.getElementById('merchantMenuScreen').dataset.restaurantId;
    let targetMenuArray;
    if (resId === 'current_vendor') {
        targetMenuArray = merchantMenuItems;
    } else {
        const restaurant = adminRestaurants.find(r => r.id == resId);
        targetMenuArray = restaurant ? restaurant.menu : null;
    }
    if (!targetMenuArray) return;

    const id = document.getElementById('editItemId').value;
    if (id && await customPopup({ title: 'Delete Item', message: 'Are you sure you want to delete this item?', type: 'confirm' })) {
        let found = false;
        for (const cat of targetMenuArray) {
            const index = cat.items?.findIndex(i => i.id == id);
            if (index > -1) {
                cat.items.splice(index, 1);
                found = true;
                break;
            }
        }
        if (found) {
            if (resId !== 'current_vendor') {
                localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
            }
            renderMerchantMenuItems(targetMenuArray);
            merchantEditItemScreen.classList.remove('active');
            showToast('Item deleted.');
        }
    }
});

/* Merchant Past Orders Logic */
const merchantOrdersBtn = document.getElementById('merchantOrdersBtn');
const merchantOrdersScreen = document.getElementById('merchantOrdersScreen');
const merchantOrdersBackBtn = document.getElementById('merchantOrdersBackBtn');
const merchantOrdersList = document.getElementById('merchantOrdersList');

const dummyPastOrders = [
    { id: '#8820', date: 'Today, 10:30 AM', items: '2x Cheese Burger, 1x Cola', total: 'UGX 55.00', status: 'Delivered', statusColor: '#019E81' },
    { id: '#8819', date: 'Yesterday, 8:15 PM', items: '1x Family Pizza Feast', total: 'UGX 85.00', status: 'Delivered', statusColor: '#019E81' },
    { id: '#8818', date: 'Yesterday, 7:00 PM', items: '3x Spicy Wings (6pcs)', total: 'UGX 90.00', status: 'Cancelled', statusColor: '#ff4757' },
    { id: '#8817', date: '22 Oct, 1:00 PM', items: '1x Zinger Wrap', total: 'UGX 22.00', status: 'Delivered', statusColor: '#019E81' },
    { id: '#8816', date: '21 Oct, 9:45 PM', items: '2x Milkshakes', total: 'UGX 36.00', status: 'Delivered', statusColor: '#019E81' }
];

function renderMerchantOrders() {
    merchantOrdersList.innerHTML = '';
    dummyPastOrders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        card.style.gap = '8px';
        card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:800; color:#333;">${order.id}</span>
                <span style="font-size:0.85em; color:#666;">${order.date}</span>
            </div>
            <div style="font-size:0.95em; color:#555; line-height:1.4;">${order.items}</div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                <span style="font-weight:bold; color:#333;">${order.total}</span>
                <span style="background:${order.statusColor}20; color:${order.statusColor}; padding:4px 8px; border-radius:6px; font-size:0.85em; font-weight:700;">${order.status}</span>
            </div>
        `;
        merchantOrdersList.appendChild(card);
    });
}

// Initialize app after DOM is loaded
function startApp() {
  // Handle Portal URL parameters for direct access testing
  const urlParams = new URLSearchParams(window.location.search);
  const portalParam = urlParams.get('portal');
  if (portalParam) {
      const target = portalParam === 'admin' ? 'adminScreen' : (portalParam === 'rider' ? 'riderScreen' : (portalParam === 'vendor' ? 'shopPortalScreen' : 'home'));
      localStorage.setItem('kirya_last_screen', target);
  }

  console.log('Initializing app...');
  
  try {
  if (typeof initFirebase === 'function') {
    initFirebase(); // Try to connect to Firebase on startup
  }
  // Ensure admin screen is hidden on start
  const adminScreen = document.getElementById('adminScreen');
  if(adminScreen) adminScreen.classList.remove('active');

  // Load Profile Logic
  const userExists = loadUserProfile();

  // Safe initialization of updateAddAddressBtn calls
  try {
    updateAddAddressBtn();
    
    // Load User Settings
    try {
        if (currentUser.settings) {
            const s = currentUser.settings;
            if(s.push !== undefined && document.getElementById('settingPushToggle')) document.getElementById('settingPushToggle').checked = s.push;
            if(s.loc !== undefined && document.getElementById('settingLocToggle')) document.getElementById('settingLocToggle').checked = s.loc;
            if(s.biometric !== undefined && document.getElementById('settingBiometricToggle')) document.getElementById('settingBiometricToggle').checked = s.biometric;
            
            const catAddr = document.getElementById('catAddressText');
            if(catAddr && s.address) catAddr.textContent = s.address;
            // Coordinates are set when map initializes
        }
    } catch(e) { console.error('Error loading UI settings', e); }
    
    // Fix: Hydrate orders with missing coordinates to prevent animation errors
    if(window.allOrders) {
        window.allOrders.forEach(o => {
            if(!o.restaurantLat && o.lat) o.restaurantLat = o.lat;
            if(!o.restaurantLng && o.lng) o.restaurantLng = o.lng;
            if(!o.userLat) o.userLat = (o.restaurantLat || 24.45) + 0.01;
            if(!o.userLng) o.userLng = (o.restaurantLng || 54.38) + 0.01;
        });
    }
    
    // initWebSocket(); // WebSocket disabled to prevent connection errors without backend
  } catch (error) {
    console.error('Error in updateAddAddressBtn:', error);
  }
  
  // Splash screen transition
  console.log('Starting splash transition...');
  setTimeout(()=>{
    try {
      const splash = document.getElementById('splash');
      const home = document.getElementById('home');
      if (splash && home) {
        console.log('Hiding splash screen...');
        splash.style.opacity='0';
        setTimeout(()=>{
          splash.style.display='none';
          
          console.log('Splash finished. Initializing login gate...');
          appReady = true;
          window.appReady = true;
          
          setTimeout(() => {
              // If auth is present but hasn't finished routing yet, show verification
              const isFirebaseAuthenticating = window.auth && window.auth.currentUser;
              if (!isRouted && isFirebaseAuthenticating) {
                  window.showVerificationScreen("Verifying Profile...");
                  return;
              }
              if (!isRouted) {
                  window.showLoginScreen();
              }
          }, 100);
        },500);
      } else {
        console.error('Splash or home element not found:', {splash, home});
      }
    } catch (error) {
      console.error('Error during splash transition:', error);
      // Emergency fallback
      const splash = document.getElementById('splash');
      if(splash) splash.style.display='none';
      window.showLoginScreen();
      appReady = true;
      window.appReady = true;
    }

    // Add Storage Event Listener for Cross-Tab Sync
    window.addEventListener('storage', (e) => {
        if (e.key === 'kirya_orders' && e.newValue) {
            const oldOrdersCount = window.allOrders ? window.allOrders.length : 0;
            const newOrders = JSON.parse(e.newValue);
            if (newOrders.length > oldOrdersCount) {
                 playNotificationSound();
                 showToast("🔔 New Order Received!");
                 if (typeof notifications !== 'undefined') {
                    notifications.unshift({
                        type: 'order',
                        title: 'New Order Received',
                        body: 'A new order has been placed on the platform.',
                        time: 'Just now',
                        unread: true
                    });
                    updateBellDots();
                    saveNotifications();
                 }
            }
            window.allOrders = newOrders;
            adminOrders = newOrders;
            
            // Refresh Active Screens
            if (document.getElementById('adminScreen').classList.contains('active')) {
                updateAdminDashboard();
                if (document.getElementById('admin-orders').style.display !== 'none') renderAdminOrders();
                if (document.getElementById('admin-riders').style.display !== 'none') renderAdminRiders();
            }
            if (document.getElementById('trackOrderScreen').classList.contains('active')) {
                const activeOrder = window.allOrders.find(o => o.id === (window.lastTrackedOrderId || (window.allOrders.length > 0 ? window.allOrders[window.allOrders.length-1].id : null)));
                if(activeOrder) updateTrackOrderScreen(activeOrder);
            }
            // Refresh Chat if active
            if (document.getElementById('chatScreen').classList.contains('active')) {
                renderChatMessages();
            }
            // Update Rider Map Orders
            if (document.getElementById('riderScreen').classList.contains('active')) updateRiderNearbyOrders();
            // Update Rider UI if active
            updateRiderPendingBadge();
            
            // showToast("Data synced from other tab");
        }
        if (e.key === 'kirya_user_profile' && e.newValue) {
            // Optionally sync profile changes across tabs if needed
            // loadUserProfile();
            updateCartView();
        }
        if (e.key === 'kirya_riders' && e.newValue) {
            adminRiders = JSON.parse(e.newValue);
            if (document.getElementById('adminScreen').classList.contains('active')) {
                if (document.getElementById('admin-riders').style.display !== 'none') {
                    renderAdminRiders();
                }
                if (document.getElementById('admin-dashboard').style.display !== 'none') {
                    renderAdminDashboard();
                }
                updateAdminSidebarBadges();
                showToast("Rider data synced from another tab.");
            }
        }
        if (e.key === 'kirya_vendor_orders' && e.newValue) {
            const oldOrders = e.oldValue ? JSON.parse(e.oldValue) : [];
            const newOrders = JSON.parse(e.newValue);
            vendorOrders = newOrders;

            if (document.getElementById('shopPortalScreen').classList.contains('active')) {
                const activeTab = document.querySelector('.vendor-tab.active');
                if(activeTab) renderVendorOrders(activeTab.dataset.tab);
                updateVendorTabsCounts();
            }
            
            if (newOrders.length > oldOrders.length) {
                playNotificationSound();
                showToast("🔔 New Order Received!");
            }
        }
        /* if (e.key === 'kirya_notifications' && e.newValue) {
            // Notifs are now in profile, sync handled above if we add loadUserProfile call
            const newNotifs = JSON.parse(e.newValue);
            const oldNotifs = notifications;
            notifications = newNotifs;
            renderNotifications();
            updateBellDots();
            
            if (newNotifs.length > oldNotifs.length) {
                const latest = newNotifs[0];
                if (latest.role === 'rider' && document.getElementById('riderScreen').classList.contains('active')) {
                    showToast(`📢 Admin Broadcast: ${latest.body}`);
                    playNotificationSound();
                }
            }
        } */
    });
  },300); // Minimal delay for splash screen

  // Init cart view if items exist
  setTimeout(updateCartView, 500);
  setTimeout(updateRiderPendingBadge, 1000);
  
  // Scheduler for future orders
  setInterval(() => {
    if(!window.allOrders) return;
    const now = new Date();
    window.allOrders.forEach(order => {
        if(order.status === 'scheduled' && order.scheduledTime && new Date(order.scheduledTime) <= now) {
            // Release order to vendor
            updateOrderStatus(order.id, 'pending', 'Order Released to Restaurant', '#FFBF42');
            
            // Add to Vendor Orders
            if(typeof vendorOrders !== 'undefined' && !vendorOrders.find(v => v.id === order.id)) {
                vendorOrders.unshift({
                    id: order.id,
                    time: 'Scheduled Release',
                    items: order.items.map(i => `${i.quantity}x ${i.title}`),
                    total: order.total.toFixed(2),
                    status: 'new'
                });
                syncVendorOrders();
                showToast(`Scheduled Order ${order.id} released!`);
            }
        }
    });
  }, 10000); // Check every 10 seconds
  
  // Rider Broadcast Poller
  setInterval(() => {
      if (isRiderOnline && window.allOrders) { 
          const availableOrder = window.allOrders.find(o => o.status === 'rider_assigned');
          if (availableOrder && currentRiderOrderId !== availableOrder.id) {
              // Found an order assigned by admin (broadcast)
              // In a real app, check if availableOrder.rider matches current user
              triggerRiderOrder(availableOrder.id);
          }
      }
  }, 5000);

  // Initialize Auto-Updating Sidebar Badges
  setInterval(updateAdminSidebarBadges, 2000);
  updateAdminSidebarBadges();

  // Persistence Observer
  const screenObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
              const target = mutation.target;
              if (target.classList.contains('active') || (target.id === 'mapScreen' && target.style.display === 'block')) {
                  sessionStorage.setItem('kirya_last_screen', target.id);
              } else if (target.id === 'home' && target.style.display === 'block') {
                  sessionStorage.setItem('kirya_last_screen', 'home');
              }
          }
      });
  });

  document.querySelectorAll('.generic-screen, #home, #mapScreen, #newHomeScreen').forEach(el => {
      screenObserver.observe(el, { attributes: true });
  });

  // Listeners for the Edit Item Screen
  const editItemBackBtn = document.getElementById('editItemBackBtn');
  if(editItemBackBtn) {
    editItemBackBtn.addEventListener('click', () => {
        const screen = document.getElementById('merchantEditItemScreen');
        if(screen) screen.classList.remove('active');
    });
  }

  // Add listeners for merchant menu screen
  const merchantMenuBackBtn = document.getElementById('merchantMenuBackBtn');
  if (merchantMenuBackBtn) {
    merchantMenuBackBtn.addEventListener('click', () => {
        document.getElementById('merchantMenuScreen').classList.remove('active');
    });
  }
  const merchantAddMenuBtn = document.getElementById('merchantAddMenuBtn');
  if (merchantAddMenuBtn) {
    merchantAddMenuBtn.addEventListener('click', () => {
        // When adding from header, the first category will be selected by default.
        openEditItemScreen(null, null);
    });
  }

  // Add listener for merchant orders back button
  const merchantOrdersBackBtn = document.getElementById('merchantOrdersBackBtn');
  if (merchantOrdersBackBtn) {
      merchantOrdersBackBtn.addEventListener('click', () => {
          document.getElementById('merchantOrdersScreen').classList.remove('active');
      });
  }
  } catch (e) {
    console.error("Critical error in startApp:", e);
    const splash = document.getElementById('splash');
    if(splash) splash.style.display='none';
    document.getElementById('home').style.display='block';
    appReady = true;
  }
}


// Delay application startup until all window resources (scripts, styles) are fully loaded
// This prevents "L is not defined" errors during early map initialization
window.addEventListener('load', () => {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }
});

/* Open Map */
document.getElementById('openMapBtn')?.addEventListener('click', async ()=>{
  document.getElementById('home').style.display='none';
  document.getElementById('mapScreen').style.display='block';
  setTimeout(()=> document.getElementById('bottomCard').classList.add('show'),200);

  try { await loadLeaflet(); } catch(e) { showToast("Map library failed to load."); return; }

  if(!map){
    map=window.L.map('map').setView([24.4539,54.3773],13);
    const deliveryPinIcon = window.L.divIcon({
        html: '📍',
        className: 'delivery-pin-icon',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);
    marker=window.L.marker([24.4539,54.3773],{draggable:true, icon: deliveryPinIcon}).addTo(map);
    marker.on('dragend', ()=>{
      reverseGeocode(marker.getLatLng());
      showSearchCard();
    });
    map.on('click', (e) => {
      marker.setLatLng(e.latlng);
      reverseGeocode(e.latlng);
      showSearchCard();
      saveUserSettings();
    });
    // Load saved coords if available
    try {
        const s = currentUser.settings || {};
        if(s.coords) { marker.setLatLng(s.coords); map.setView(s.coords, 15); }
    } catch(e){}
  }
  setTimeout(()=>map.invalidateSize(),300);
});

/* Reverse geocoding */
function reverseGeocode(latlng){
  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latlng.lat}&lon=${latlng.lng}&format=json&accept-language=en`)
    .then(res=>res.json())
    .then(data=>{
      if(data && data.display_name){
        document.getElementById('selectedAddress').textContent = data.display_name;
        updateSelectedAddressCard();
      }
    });
}

function updateSelectedAddressCard(){
  const addrText = document.getElementById('selectedAddress').textContent;
  if(addrText && addrText !== 'Select a location on the map'){
    document.getElementById('selectedAddressText').textContent = addrText;
  } else {
    document.getElementById('selectedAddressText').textContent = 'Set delivery address';
  }
  saveUserSettings();
}

// Consolidated back navigation logic
function navigateBack() {
    const homeScreen = document.getElementById('home');
    const mapScreen = document.getElementById('mapScreen');
    const newHomeScreen = document.getElementById('newHomeScreen');
    const categoryScreen = document.getElementById('categoryScreen');
    const restaurantScreen = document.getElementById('restaurantScreen');
    const contentSearchScreen = document.getElementById('contentSearchScreen');
    const searchCard = document.getElementById('searchCard');

    // From Content Search, go back to New Home Screen
    if (contentSearchScreen && contentSearchScreen.classList.contains('active')) {
        contentSearchScreen.classList.remove('active');
        return;
    }

    // From Restaurant screen, go back to Category screen
    if (restaurantScreen.classList.contains('active')) {
        restaurantScreen.classList.remove('active');
        return;
    }

    // From Category screen, go back to New Home screen
    if (categoryScreen.classList.contains('active')) {
        categoryScreen.classList.remove('active');
        updateAddAddressBtn();
        return;
    }

    // From New Home screen, go back to Map screen
    if (newHomeScreen.classList.contains('active')) {
        // Wait for the screen transition to fully complete before redrawing the map.
        // This is more reliable than a fixed setTimeout.
        newHomeScreen.addEventListener('transitionend', function onTransitionEnd(e) {
            // Ensure we only act when the main 'bottom' transition is complete
            if (e.target === newHomeScreen && e.propertyName === 'bottom' && map) {
                map.invalidateSize();
            }
        }, { once: true }); // The listener will automatically remove itself after firing once.

        newHomeScreen.classList.remove('active');
        mapScreen.style.display = 'block';
        showMap();
        homeScreen.style.display = 'none';
        document.getElementById('bottomCard').classList.add('show');
        searchCard.classList.remove('show');
        searchCard.classList.remove('expanded');
        updateAddAddressBtn();
        document.getElementById('backBtn').style.opacity = '1';
        document.getElementById('currentLocationBtn').style.opacity = '1';
        document.querySelector('.leaflet-control-zoom').style.opacity = '1';
        return;
    }

    // From Map screen, go back to Home screen
    if (mapScreen.style.display === 'block') {
        mapScreen.style.display = 'none';
        homeScreen.style.display = 'block';
        document.getElementById('bottomCard').classList.remove('show');
        searchCard.classList.remove('show');
        searchCard.classList.remove('expanded');
        return;
    }
}

/* Search Error on Home */
document.querySelector('#home nav .nav-item:nth-child(2)')?.addEventListener('click', () => {
  showSearchErrorState();
});

function showSearchErrorState() {
  document.getElementById('home').style.display = 'none';
  document.getElementById('mapScreen').style.display = 'block';
  hideMap();
  document.getElementById('bottomCard').classList.remove('show');

  // Hide floating buttons on map screen since we are in error state
  document.getElementById('backBtn').style.display = 'none';
  document.getElementById('currentLocationBtn').style.display = 'none';

  const searchCard = document.getElementById('searchCard');
  document.getElementById('searchNormalContent').style.display = 'none';
  document.getElementById('searchErrorContent').classList.add('active');

  searchCard.classList.add('show');
  searchCard.classList.add('expanded');
  
  // Back button in error state
  document.getElementById('errorBackBtn').onclick = function() {
    searchCard.classList.remove('show');
    searchCard.classList.remove('expanded');
    document.getElementById('mapScreen').style.display = 'none';
    document.getElementById('home').style.display = 'block';
    
    // Restore buttons for normal map usage
    document.getElementById('backBtn').style.display = 'flex';
    document.getElementById('currentLocationBtn').style.display = 'flex';

    setTimeout(() => {
        document.getElementById('searchNormalContent').style.display = 'flex';
        document.getElementById('searchErrorContent').classList.remove('active');
    }, 400);
  };
}

/* Show search card */
function showSearchCard(){
  document.getElementById('searchNormalContent').style.display = 'flex';
  document.getElementById('searchErrorContent').classList.remove('active');
  const searchCard = document.getElementById('searchCard');
  const bottomCard = document.getElementById('bottomCard');
  searchCard.classList.add('show');
  bottomCard.classList.remove('show');
  updateAddAddressBtn();
}

function closeSearchUI() {
    const searchCard = document.getElementById('searchCard');
    const bottomCard = document.getElementById('bottomCard');

    if (!searchCard.classList.contains('show')) return;

    const handleTransitionEnd = (e) => {
        // Ensure we only act when the main 'bottom' transition is complete
        if (e.target === searchCard && e.propertyName === 'bottom') {
            if (map) map.invalidateSize();
            bottomCard.classList.add('show');
            updateAddAddressBtn();
            searchCard.removeEventListener('transitionend', handleTransitionEnd);
        }
    };
    searchCard.addEventListener('transitionend', handleTransitionEnd);

    showMap(); // Show map immediately behind the closing card
    searchCard.classList.remove('expanded');
    searchCard.classList.remove('show');

    document.getElementById('backBtn').style.opacity = '1';
    document.getElementById('currentLocationBtn').style.opacity = '1';
    document.querySelector('.leaflet-control-zoom').style.opacity = '1';
}

/* Expand search card when input focused */
const searchInput = document.getElementById('searchInput');
searchInput?.addEventListener('focus',()=>{
  const searchCard = document.getElementById('searchCard');
  searchCard.classList.add('expanded');
  document.getElementById('backBtn').style.opacity='0';
  document.getElementById('currentLocationBtn').style.opacity='0';
  document.querySelector('.leaflet-control-zoom').style.opacity='0';
});

/* Collapse search card */
document.getElementById('closeSearch')?.addEventListener('click', closeSearchUI);

/* Current Location */
document.getElementById('currentLocationBtn')?.addEventListener('click',()=>{
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      const lat=pos.coords.latitude, lng=pos.coords.longitude;
      marker.setLatLng([lat,lng]);
      reverseGeocode({lat,lng});
      map.setView([lat,lng],15);
    },()=>customPopup({ title: 'Location Error', message: "Unable to access your location." }));
  } else { customPopup({ title: 'Not Supported', message: "Geolocation not supported." }); }
});

/* Back button */
document.getElementById('backBtn')?.addEventListener('click', navigateBack);

/* Show address on newHomeScreen when returning from map */
document.getElementById('addAddressBtn')?.addEventListener('click',()=>{
  const newScreen = document.getElementById('newHomeScreen');
  newScreen.classList.add('active');
  updateSelectedAddressCard();
  hideMap();
  updateAddAddressBtn();
});

/* Click on header to go to map if no address selected */
/* This is now handled by the click on selectedAddressCard itself. */

/* Back navigation from newHomeScreen */
document.getElementById('newHomeBackBtn')?.addEventListener('click', navigateBack);

/* Autocomplete */
const suggList = document.getElementById('autocompleteSuggestions');
searchInput?.addEventListener('input',()=>{
  const value = searchInput.value.trim();
  if(!value){ suggList.innerHTML=''; return; }

  fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&addressdetails=1&limit=5&accept-language=en`)
    .then(res=>res.json())
    .then(data=>{
      suggList.innerHTML='';
      data.forEach(place=>{
        const li=document.createElement('li');
        li.textContent=place.display_name;
        li.addEventListener('click',()=>{
          searchInput.value=place.display_name;
          suggList.innerHTML='';
          const lat=parseFloat(place.lat), lng=parseFloat(place.lon);
          marker.setLatLng([lat,lng]);
          map.setView([lat,lng],15);
          document.getElementById('selectedAddress').textContent = place.display_name;
          document.getElementById('selectedAddressText').textContent = place.display_name;
          updateSelectedAddressCard();
          closeSearchUI();
        });
        suggList.appendChild(li);
      });
    });
});

// Draggable grid items inside newHomeScreen
const draggables = document.querySelectorAll('#newHomeScreen .grid-item');
const newHomeScreen = document.getElementById('newHomeScreen');

newHomeScreen.addEventListener('dragover', (event) => {
  event.preventDefault();
});

newHomeScreen.addEventListener('drop', (event) => {
  event.preventDefault();
  const tileId = event.dataTransfer.getData('text/plain');
  const tile = document.getElementById(tileId);
  if (tile) {
    tile.classList.remove('dragging');
    tile.style.transform = '';
  }
});

draggables.forEach((tile, index)=>{
  tile.setAttribute('draggable','true');
  tile.setAttribute('id', `grid-item-${index}`);
  const initial = {x:0,y:0};

  tile.addEventListener('dragstart', (event)=>{
    tile.classList.add('dragging');
    initial.x = tile.offsetLeft;
    initial.y = tile.offsetTop;
    event.dataTransfer.setData('text/plain', tile.id);
    event.dataTransfer.effectAllowed = 'move';
  });

  tile.addEventListener('dragend', ()=>{
    tile.classList.remove('dragging');
    tile.style.transform = `translate(0, 0)`;
  });
});

function openContentSearch() {
    const screen = document.getElementById('contentSearchScreen');
    screen.classList.add('active');
    
    // Populate if empty
    const grid = document.getElementById('searchCategoriesGrid');
    if(grid.innerHTML.trim() === '') {
        grid.innerHTML = document.querySelector('#newHomeScreen .top-grid').innerHTML;
        document.getElementById('searchShopsScroll').innerHTML = document.querySelector('#newHomeScreen .shop-scroll').innerHTML;
        
        // Add listeners to cloned items
        grid.querySelectorAll('.grid-item').forEach(item => {
            item.addEventListener('click', () => showDetailScreen(item.querySelector('.grid-label').textContent));
        });
        document.getElementById('searchShopsScroll').querySelectorAll('.shop-item').forEach(item => {
            item.addEventListener('click', () => showDetailScreen(`Shop: ${item.textContent}`));
        });
        
        populateSearchAllItems();
    }
}

function populateSearchAllItems() {
    const container = document.getElementById('searchAllItemsContainer');
    if(!container || container.innerHTML.trim() !== '') return;

    const categories = [
        {
            title: "Trending Dishes 🔥",
            items: [
                { name: "Double Cheese Burger", price: 25.00, emoji: "🍔", res: "Burger King" },
                { name: "Pepperoni Pizza", price: 45.00, emoji: "🍕", res: "Pizza Hut" },
                { name: "Spicy Chicken Wings", price: 30.00, emoji: "🍗", res: "KFC" }
            ]
        },
        {
            title: "Healthy Options 🥗",
            items: [
                { name: "Caesar Salad", price: 22.00, emoji: "🥗", res: "Healthy Bites" },
                { name: "Grilled Chicken", price: 35.00, emoji: "🍖", res: "Grill House" },
                { name: "Fresh Fruit Bowl", price: 15.00, emoji: "🍇", res: "Fresh & Co" }
            ]
        },
        {
            title: "Sweet Cravings 🍩",
            items: [
                { name: "Choco Glazed Donut", price: 8.00, emoji: "🍩", res: "Dunkin" },
                { name: "Strawberry Cheesecake", price: 18.00, emoji: "🍰", res: "Bakery One" },
                { name: "Vanilla Ice Cream", price: 10.00, emoji: "🍦", res: "Cold Stone" }
            ]
        }
    ];

    categories.forEach(cat => {
        const section = document.createElement('div');
        section.className = 'search-category-section';
        section.innerHTML = `<div class="search-cat-title">${cat.title}</div>`;
        const scroll = document.createElement('div');
        scroll.className = 'search-item-scroll';
        cat.items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'search-item-card';
            card.innerHTML = `<div class="search-item-img">${window.getImageHtml(item.emoji)}</div><div class="search-item-details"><div class="search-item-name">${item.name}</div><div class="search-item-res">${item.res}</div><div class="search-item-row"><div class="search-item-price">${item.price.toFixed(2)}</div><div class="search-add-btn">+</div></div></div>`;
            card.querySelector('.search-add-btn').addEventListener('click', (e) => { e.stopPropagation(); cart.push({ title: item.name, basePrice: item.price, quantity: 1, addons: [], image: item.emoji }); showToast(`${item.name} added!`); saveCart(); });
            scroll.appendChild(card);
        });
        section.appendChild(scroll);
        container.appendChild(section);
    });
    initAutoScroll();
}

// Back button for Content Search Screen
const csBackBtn = document.getElementById('csBackBtn');
if(csBackBtn) {
    csBackBtn.addEventListener('click', () => {
        document.getElementById('contentSearchScreen').classList.remove('active');
    });
}

/* Category Screen Logic */
const categoryScreen = document.getElementById('categoryScreen');
const catTitle = document.getElementById('catTitle');
const catBackBtn = document.getElementById('catBackBtn');

/* Category Configuration */
const categoryConfig = {
  "Food": {
    filters: [
      {icon: "🏷️", name: "Promotions"}, {icon: "🍟", name: "Fast Food"}, {icon: "🍗", name: "Chicken"},
      {icon: "🍔", name: "Burgers"}, {icon: "🥩", name: "Halal"}, {icon: "🍕", name: "Pizza"},
      {icon: "🥘", name: "Local"}, {icon: "🍰", name: "Desserts"}
    ],
    brands: [
      {icon: "🍔", name: "McDonald's"}, {icon: "🍗", name: "KFC"}, {icon: "🍕", name: "Pizza Hut"},
      {icon: "☕", name: "Starbucks"}, {icon: "🥪", name: "Subway"}
    ],
    items: [
      {name: "Tasty Restaurant", image: "🍽️", rating: "4.8", time: "20-30 Mins", delivery: "Free"},
      {name: "Burger King", image: "🍔", rating: "4.5", time: "25-35 Mins", delivery: "500"},
      {name: "Pizza Hut", image: "🍕", rating: "4.7", time: "30-40 Mins", delivery: "Free"},
      {name: "KFC", image: "🍗", rating: "4.6", time: "20-30 Mins", delivery: "Free"}
    ],
    menu: [
      {
        name: "Promotions",
        items: [
          { title: "Family Feast", desc: "2 Large Pizzas, Garlic Bread & Coke", price: "85.00", oldPrice: "120.00", image: "🍕" },
          { title: "Mega Burger Box", desc: "2 Burgers, Fries & Nuggets", price: "45.00", oldPrice: "60.00", image: "🍔" }
        ]
      },
      {
        name: "Best Sellers",
        items: [
          { title: "Crispy Chicken", desc: "3pcs Fried Chicken with Coleslaw", price: "25.00", image: "🍗" },
          { title: "Cheese Burger", desc: "Beef patty, Cheddar, Lettuce", price: "18.00", image: "🍔" },
          { title: "Pepperoni Pizza", desc: "Mozzarella & Beef Pepperoni", price: "40.00", image: "🍕" }
        ]
      },
      {
        name: "Drinks",
        items: [
          { title: "Cola", desc: "Regular Ice Cold", price: "5.00", image: "🥤" },
          { title: "Orange Juice", desc: "Freshly squeezed", price: "12.00", image: "🍊" }
        ]
      }
    ]
  },
  "Groceries": {
    filters: [
      {icon: "🥬", name: "Vegetables"}, {icon: "🍎", name: "Fruits"}, {icon: "🥛", name: "Dairy"},
      {icon: "🥩", name: "Meat"}, {icon: "🥖", name: "Bakery"}, {icon: "🥫", name: "Pantry"}
    ],
    brands: [
      {icon: "🛒", name: "Carrefour"}, {icon: "🛍️", name: "Lulu"}, {icon: "🏪", name: "Spinneys"},
      {icon: "🍏", name: "Viva"}, {icon: "🧺", name: "Choithrams"}
    ],
    items: [
      {name: "Carrefour City", image: "🛒", rating: "4.8", time: "30-60 Mins", delivery: "1500"},
      {name: "Lulu Hypermarket", image: "🛍️", rating: "4.7", time: "45-90 Mins", delivery: "2000"},
      {name: "Spinneys", image: "🏪", rating: "4.9", time: "30-60 Mins", delivery: "Free"},
      {name: "Local Grocery", image: "🧺", rating: "4.5", time: "15-30 Mins", delivery: "Free"}
    ],
    menu: [
      {
        name: "Fresh Produce",
        items: [
          { title: "Bananas (1kg)", desc: "Fresh Ecuador Bananas", price: "6.00", image: "🍌" },
          { title: "Red Apples (1kg)", desc: "Sweet Royal Gala Apples", price: "8.50", image: "🍎" },
          { title: "Tomatoes (1kg)", desc: "Local Fresh Tomatoes", price: "4.00", image: "🍅" }
        ]
      },
      {
        name: "Dairy & Eggs",
        items: [
          { title: "Fresh Milk (1L)", desc: "Full Cream Milk", price: "6.50", image: "🥛" },
          { title: "Eggs (30pcs)", desc: "Large White Eggs", price: "22.00", image: "🥚" },
          { title: "Cheddar Cheese", desc: "Block 200g", price: "15.00", image: "🧀" }
        ]
      },
      {
        name: "Bakery",
        items: [
          { title: "Sliced Bread", desc: "White Toast Bread", price: "5.00", image: "🍞" },
          { title: "Croissants (4pcs)", desc: "Butter Croissants", price: "12.00", image: "🥐" }
        ]
      }
    ]
  },
  "Shops": {
    filters: [
      {icon: "👗", name: "Clothes"}, {icon: "👠", name: "Shoes"}, {icon: "📱", name: "Electronics"},
      {icon: "💄", name: "Beauty"}, {icon: "🎁", name: "Gifts"}, {icon: "⚽", name: "Sports"}
    ],
    brands: [
      {icon: "🏬", name: "H&M"}, {icon: "👟", name: "Nike"}, {icon: "💄", name: "Sephora"},
      {icon: "📱", name: "Sharaf DG"}, {icon: "🧸", name: "Toys R Us"}
    ],
    items: [
      {name: "Zara", image: "👗", rating: "4.8", time: "60-90 Mins", delivery: "5000"},
      {name: "Sharaf DG", image: "📱", rating: "4.7", time: "60-120 Mins", delivery: "Free"},
      {name: "Sephora", image: "💄", rating: "4.9", time: "45-60 Mins", delivery: "2500"},
      {name: "Virgin Megastore", image: "💿", rating: "4.8", time: "60-90 Mins", delivery: "3000"}
    ],
    menu: [
      {
        name: "Clothing",
        items: [
          { title: "Cotton T-Shirt", desc: "100% Cotton Basic Tee", price: "45.00", image: "👕" },
          { title: "Denim Jeans", desc: "Slim Fit Blue Jeans", price: "120.00", image: "👖" },
          { title: "Running Shoes", desc: "Sports Sneakers", price: "250.00", image: "👟" }
        ]
      },
      {
        name: "Electronics",
        items: [
          { title: "Wireless Earbuds", desc: "Bluetooth 5.0 with Case", price: "150.00", image: "🎧" },
          { title: "USB-C Cable", desc: "Fast Charging 1m", price: "35.00", image: "🔌" }
        ]
      }
    ]
  },
  "Pharmacies": {
    filters: [
      {icon: "💊", name: "Medicine"}, {icon: "🧴", name: "Skincare"}, {icon: "🩹", name: "First Aid"},
      {icon: "💪", name: "Vitamins"}, {icon: "👶", name: "Baby Care"}, {icon: "🧼", name: "Hygiene"}
    ],
    brands: [
      {icon: "⚕️", name: "Life Pharmacy"}, {icon: "🏥", name: "Aster"}, {icon: "💊", name: "Boots"},
      {icon: "🩺", name: "Supercare"}, {icon: "🌿", name: "Bin Sina"}
    ],
    items: [
      {name: "Life Pharmacy", image: "⚕️", rating: "4.9", time: "30-45 Mins", delivery: "Free"},
      {name: "Aster Pharmacy", image: "🏥", rating: "4.8", time: "30-45 Mins", delivery: "Free"},
      {name: "Boots", image: "💊", rating: "4.7", time: "45-60 Mins", delivery: "1000"},
      {name: "Supercare", image: "🩺", rating: "4.6", time: "20-40 Mins", delivery: "500"}
    ],
    menu: [
      {
        name: "Medicines",
        items: [
          { title: "Panadol Extra", desc: "Pain Relief 24 Tablets", price: "12.00", image: "💊" },
          { title: "Vitamin C", desc: "Effervescent 20 Tabs", price: "25.00", image: "🍊" },
          { title: "Cough Syrup", desc: "Herbal Relief 100ml", price: "18.00", image: "🥄" }
        ]
      },
      {
        name: "Personal Care",
        items: [
          { title: "Face Mask", desc: "Surgical Masks 50pcs", price: "15.00", image: "😷" },
          { title: "Hand Sanitizer", desc: "Gel 500ml", price: "20.00", image: "🧴" }
        ]
      }
    ]
  },
  "Packages": {
    filters: [
      {icon: "📦", name: "Send"}, {icon: "📬", name: "Receive"}, {icon: "🏙️", name: "Local"},
      {icon: "✈️", name: "International"}, {icon: "🚚", name: "Moving"}
    ],
    brands: [
      {icon: "🟨", name: "DHL"}, {icon: "🟧", name: "FedEx"}, {icon: "🟥", name: "Aramex"},
      {icon: "🟦", name: "UPS"}, {icon: "🛵", name: "Careem Box"}
    ],
    items: [
      {name: "DHL Express", image: "🟨", rating: "4.9", time: "Pickup: 15m", delivery: "Var"},
      {name: "Local Courier", image: "🛵", rating: "4.5", time: "Pickup: 10m", delivery: "5000"},
      {name: "Aramex", image: "🟥", rating: "4.7", time: "Pickup: 20m", delivery: "Var"},
      {name: "Fetchr", image: "📦", rating: "4.4", time: "Pickup: 30m", delivery: "3000"}
    ],
    menu: [
      {
        name: "Delivery Services",
        items: [
          { title: "Standard Delivery", desc: "Within City (Same Day)", price: "15.00", image: "🛵" },
          { title: "Express Delivery", desc: "Within City (2 Hours)", price: "30.00", image: "🚀" },
          { title: "Document Service", desc: "Secure document handling", price: "20.00", image: "📄" }
        ]
      }
    ]
  },
  "Drinks": {
    filters: [
      {icon: "💧", name: "Water"}, {icon: "🥤", name: "Juices"}, {icon: "☕", name: "Coffee"},
      {icon: "🍵", name: "Tea"}, {icon: "🥛", name: "Milkshakes"}, {icon: "🧉", name: "Smoothies"}
    ],
    brands: [
      {icon: "🧜‍♀️", name: "Starbucks"}, {icon: "☕", name: "Costa"}, {icon: "🍩", name: "Tim Hortons"},
      {icon: "🥤", name: "Juice Time"}, {icon: "💧", name: "Mai Dubai"}
    ],
    items: [
      {name: "Starbucks", image: "☕", rating: "4.8", time: "20-30 Mins", delivery: "Free"},
      {name: "Mai Dubai Water", image: "💧", rating: "4.9", time: "60-120 Mins", delivery: "Free"},
      {name: "Juice World", image: "🥤", rating: "4.6", time: "25-35 Mins", delivery: "1500"},
      {name: "Tea Corner", image: "🍵", rating: "4.5", time: "15-25 Mins", delivery: "500"}
    ],
    menu: [
      {
        name: "Coffee & Tea",
        items: [
          { title: "Iced Latte", desc: "Espresso with milk & ice", price: "18.00", image: "🥤" },
          { title: "Hot Cappuccino", desc: "Frothy milk coffee", price: "16.00", image: "☕" },
          { title: "Green Tea", desc: "Hot brewed tea", price: "10.00", image: "🍵" }
        ]
      },
      {
        name: "Cold Drinks",
        items: [
          { title: "Fresh Orange Juice", desc: "No sugar added", price: "20.00", image: "🍊" },
          { title: "Mineral Water", desc: "6 x 1.5L Case", price: "12.00", image: "💧" },
          { title: "Mango Smoothie", desc: "Thick & Sweet", price: "22.00", image: "🥭" }
        ]
      }
    ]
  }
};

function renderCategoryContent(category) {
  const config = categoryConfig[category] || categoryConfig["Food"]; 
  // Store current category for use in opening restaurants
  window.currentCategoryConfig = config;

  // Render Filters
  const filterScroll = document.querySelector('.filter-scroll');
  if(filterScroll) {
    filterScroll.innerHTML = '';
    config.filters.forEach(f => {
      const item = document.createElement('div');
      item.className = 'filter-item';
      item.innerHTML = `<div class="filter-box">${f.icon}</div><div class="filter-name">${f.name}</div>`;
      item.addEventListener('click', () => showDetailScreen(f.name)); 
      filterScroll.appendChild(item);
    });
  }

  // Render Brands
  const brandsScroll = document.getElementById('brandsScroll');
  if(brandsScroll) {
    brandsScroll.innerHTML = '';
    config.brands.forEach(b => {
      const container = document.createElement('div');
      container.className = 'brand-container';
      container.innerHTML = `
          <div class="brand-item">
            <div class="brand-image"><span>${b.icon}</span></div>
          </div>
          <div class="brand-name">${b.name}</div>
          <div class="brand-delivery-info"><span class="bike-icon">🚴‍♂️</span><span>Free delivery</span></div>
      `;
      container.addEventListener('click', () => openRestaurant(b.name, config.menu));
      brandsScroll.appendChild(container);
    });
  }

  // Render Restaurants / Items
  const generateCardHTML = (item) => {
      const liveRes = adminRestaurants.find(r => item.name.includes(r.name));
      const displayRating = (liveRes && liveRes.rating) ? liveRes.rating.toFixed(1) : (item.rating || 'New');
      const isFav = favorites.has(item.name);
      
      return `
      <div class="res-image">
        ${window.getImageHtml(item.image, '🍽️')}
        <button class="heart-btn ${isFav ? 'liked' : ''}">${isFav ? '♥' : '♡'}</button>
      </div>
      <div class="res-name">${item.name}</div>
      <div class="pref-info">
        <span class="pref-stat"><span>⭐</span>(${displayRating})</span>
        <span class="pref-stat"><span style="display:inline-block; transform:scaleX(-1);">🚴‍♂️</span>${item.delivery}</span>
        <span class="pref-stat">${item.time}</span>
      </div>
  `;
  };

  const restaurantList = document.getElementById('restaurantList');
  if(restaurantList) {
    restaurantList.innerHTML = '';
    for(let i=0; i<10; i++) {
        const item = config.items[i % config.items.length];
        const card = document.createElement('div');
        card.className = 'res-card animate-entry';
        card.style.animationDelay = `${i * 0.05}s`;
        card.innerHTML = generateCardHTML({...item, name: item.name + " " + (i+1)});
        
        card.querySelector('.heart-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(card.querySelector('.res-name').textContent, e.target);
        });
        card.addEventListener('click', (e) => {
             if(e.target.classList.contains('heart-btn')) return;
             openRestaurant(card.querySelector('.res-name').textContent);
        });
        restaurantList.appendChild(card);
    }
  }

  // Render "For You" Section
  const prefScroll = document.getElementById('prefScroll');
  if(prefScroll) {
    prefScroll.innerHTML = '';
    for(let i=0; i<5; i++) {
        const item = config.items[i % config.items.length];
        const card = document.createElement('div');
        card.className = 'pref-card';
        card.innerHTML = generateCardHTML({...item, name: item.name + (i>0 ? " " + (i+1) : "")}); 
        
        card.addEventListener('click', (e) => {
             if(e.target.classList.contains('heart-btn')) return;
             openRestaurant(card.querySelector('.res-name').textContent, config.menu);
        });
        prefScroll.appendChild(card);
    }
    // Re-init pagination dots
    const prefPagination = document.getElementById('prefPagination');
    if(prefPagination) {
        prefPagination.innerHTML = '';
        for(let i=0; i<5; i++) {
            const dot = document.createElement('div');
            dot.className = 'pref-dot';
            if(i===0) dot.classList.add('active');
            prefPagination.appendChild(dot);
        }
    }
    // Re-bind intersection observer if necessary, but simplicity suggests CSS scroll snap works mostly.
    // We'll re-add a simple observer logic here
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          const index = Array.from(prefScroll.children).indexOf(entry.target);
          Array.from(prefScroll.children).forEach(c => c.classList.remove('in-focus'));
          entry.target.classList.add('in-focus');
          const dots = document.getElementById('prefPagination').querySelectorAll('.pref-dot');
          dots.forEach(d => d.classList.remove('active'));
          if(dots[index]) dots[index].classList.add('active');
        }
      });
    }, { root: prefScroll, threshold: 0.6 });
    Array.from(prefScroll.children).forEach(card => observer.observe(card));
  }
  
  // Re-init auto scroll if applicable
  initAutoScroll();
}

function showDetailScreen(title) {
  // Update content
  catTitle.textContent = title;
  
  // Render dynamic content
  renderCategoryContent(title);

  // Update address in category screen
  const addrText = document.getElementById('selectedAddressText').textContent;
  document.getElementById('catAddressText').textContent = addrText;

  // Hide map and add button
  hideMap();
  updateAddAddressBtn();

  // Add 'active' class to show the screen
  categoryScreen.classList.add('active');
}

document.querySelectorAll('.grid-item').forEach(item => {
  item.addEventListener('click', (e) => {
    const label = item.querySelector('.grid-label').textContent;
    showDetailScreen(label);
  });
});

document.querySelectorAll('.shop-item').forEach(item => {
  item.addEventListener('click', (e) => {
    const emoji = item.textContent;
    showDetailScreen(`Shop: ${emoji}`);
  });
});

// Category Filter Bubbles
document.querySelectorAll('.filter-item').forEach(item => {
  item.addEventListener('click', () => {
    const name = item.querySelector('.filter-name').textContent;
    showDetailScreen(name);
  });
});

// Text Filters
document.querySelectorAll('.text-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showDetailScreen(btn.textContent.trim());
  });
});

// Popular Brands
document.querySelectorAll('.brand-container').forEach(container => {
  container.addEventListener('click', () => {
    const name = container.querySelector('.brand-name').textContent;
    openRestaurant(name);
  });
});

/* Visual feedback for centered shop item */
const shopScrollContainer = document.getElementById('shopScroll');
if (shopScrollContainer) {
    const shopItems = shopScrollContainer.querySelectorAll('.shop-item');
    let scrollTimeout;

    const findCenteredItem = () => {
        const containerRect = shopScrollContainer.getBoundingClientRect();
        if (containerRect.width === 0) return; // Do nothing if not visible

        const containerCenter = containerRect.left + containerRect.width / 2;

        let closestItem = null;
        let minDistance = Infinity;

        shopItems.forEach(item => {
            const itemRect = item.getBoundingClientRect();
            const itemCenter = itemRect.left + itemRect.width / 2;
            const distance = Math.abs(containerCenter - itemCenter);

            if (distance < minDistance) {
                minDistance = distance;
                closestItem = item;
            }
        });

        if (closestItem) {
            shopItems.forEach(item => item.classList.remove('is-active'));
            closestItem.classList.add('is-active');
        }
    };

    shopScrollContainer.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(findCenteredItem, 100);
    });

    // Use MutationObserver to detect when the screen becomes visible and set initial active item
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class' && mutation.target.classList.contains('active')) {
                setTimeout(findCenteredItem, 50); // Delay to ensure layout is ready
            }
        });
    });
    observer.observe(document.getElementById('newHomeScreen'), { attributes: true });
}

catBackBtn.addEventListener('click', navigateBack);

/* Restaurant Screen Logic */
const restaurantScreen = document.getElementById('restaurantScreen');
const resBackBtn = document.getElementById('resBackBtn');
const resCloseBtn = document.getElementById('resCloseBtn');
const resShareBtn = document.getElementById('resShareBtn');

function openRestaurant(name, menuData) {
  document.getElementById('resScreenName').textContent = name;
  
  // Display Rating
  const restaurant = adminRestaurants.find(r => r.name === name);
  const ratingEl = document.getElementById('resRating');
  if (ratingEl) {
      ratingEl.textContent = (restaurant && restaurant.rating) ? restaurant.rating.toFixed(1) : 'New';
  }
  
  // Default to Food menu if no menuData provided
  const menu = menuData || categoryConfig["Food"].menu;
  
  // Render Menu Nav and Content
  const navContainer = document.getElementById('resMenuNav');
  const contentContainer = document.getElementById('resMenuContent');
  
  navContainer.innerHTML = '';
  contentContainer.innerHTML = '';
  
  menu.forEach((category, index) => {
      // Nav Item
      const navItem = document.createElement('div');
      navItem.className = `res-menu-item ${index === 0 ? 'active' : ''}`;
      navItem.textContent = category.name;
      navContainer.appendChild(navItem);
      
      // Content Category Title
      const catTitle = document.createElement('div');
      catTitle.className = 'res-category-title';
      catTitle.textContent = category.name;
      contentContainer.appendChild(catTitle);
      
      // Content Items
      category.items.forEach(item => {
          const itemCard = document.createElement('div');
          itemCard.className = 'res-item-card';
          itemCard.innerHTML = `
            <div class="res-item-info">
                <div class="res-item-title">${item.title}</div>
                <div class="res-item-desc">${item.desc}</div>
                <div class="res-item-price-row">
                    ${item.oldPrice ? `<span class="res-item-old-price">${item.oldPrice}</span>` : ''}
                    <span class="res-item-current-price">${item.price}</span>
                </div>
            </div>
            <div class="res-item-img-box">
                ${window.getImageHtml(item.image, '🍽️')}
                <div class="res-item-add-btn"><span class="initial-plus">+</span><div class="quantity-selector"><span class="quantity-btn minus">-</span><span class="quantity-value">1</span><span class="quantity-btn plus">+</span></div></div>
            </div>
          `;
          contentContainer.appendChild(itemCard);
      });
  });

  restaurantScreen.classList.add('active');
  // Reset scroll and parallax on open
  restaurantScreen.scrollTop = 0;
  const bg = restaurantScreen.querySelector('.res-cover-bg');
  if (bg) bg.style.transform = 'translateY(0px)';
  updateCartView();
}

// Parallax effect for restaurant header & Back to Top Logic
const resCoverBg = restaurantScreen.querySelector('.res-cover-bg');
const resBackToTopBtn = document.getElementById('resBackToTopBtn');
const resMenuNavSticky = document.getElementById('resMenuNav');

if (restaurantScreen && resCoverBg) {
    restaurantScreen.addEventListener('scroll', () => {
        const scrollTop = restaurantScreen.scrollTop;
        resCoverBg.style.transform = `translateY(${scrollTop * 0.5}px)`;
        
        if (resBackToTopBtn && resMenuNavSticky) {
            // Check if navbar is stuck (at top). getBoundingClientRect().top will be <= 0 (or close to 0 due to borders)
            const navRect = resMenuNavSticky.getBoundingClientRect();
            // Using 1px buffer
            if (navRect.top <= 1) resBackToTopBtn.classList.add('visible');
            else resBackToTopBtn.classList.remove('visible');
        }
    }, { passive: true }); // Use passive listener for scroll performance
}

if (resBackToTopBtn) { resBackToTopBtn.addEventListener('click', () => restaurantScreen.scrollTo({ top: 0, behavior: 'smooth' })); }

if (resBackBtn) {
  resBackBtn.addEventListener('click', () => {
    restaurantScreen.classList.remove('active');
  });
}

if (resCloseBtn) {
  resCloseBtn.addEventListener('click', () => {
    restaurantScreen.classList.remove('active');
  });
}

if (resShareBtn) {
  resShareBtn.addEventListener('click', () => {
    customPopup({ title: 'Coming Soon', message: 'Share functionality is under development.' });
  });
}

/* Populate Preferences */
// Pref logic moved to renderCategoryContent
const prefScroll = document.getElementById('prefScroll'); // Just reference

  // See All Button Logic
  const prefSeeAllBtn = document.getElementById('prefSeeAllBtn');
  if(prefSeeAllBtn){
    prefSeeAllBtn.addEventListener('click', () => {
      prefScroll.classList.toggle('expanded');
      prefPagination.classList.toggle('hidden');
      if(prefScroll.classList.contains('expanded')){
        prefSeeAllBtn.textContent = 'Show Less';
      } else {
        prefSeeAllBtn.textContent = 'See All';
        prefScroll.scrollTo({left: 0});
      }
    });
  }

  // See All Button Logic for Brands
  const brandsSeeAllBtn = document.getElementById('brandsSeeAllBtn');
  const brandsScrollForSeeAll = document.getElementById('brandsScroll');
  const brandsPaginationForSeeAll = document.getElementById('brandsPagination');
  if(brandsSeeAllBtn && brandsScrollForSeeAll && brandsPaginationForSeeAll){
    brandsSeeAllBtn.addEventListener('click', () => {
      brandsScrollForSeeAll.classList.toggle('expanded');
      brandsPaginationForSeeAll.classList.toggle('hidden');
      if(brandsScrollForSeeAll.classList.contains('expanded')){
        brandsSeeAllBtn.textContent = 'Show Less';
      } else {
        brandsSeeAllBtn.textContent = 'See All';
        brandsScrollForSeeAll.scrollTo({left: 0});
      }
    });
  }
  // Add click listener for pref items
  prefScroll.addEventListener('click', (e) => {
    const card = e.target.closest('.pref-card');
    if(card){
      const name = card.querySelector('.res-name').textContent;
      openRestaurant(name, window.currentCategoryConfig?.menu);
    }
  });

/* Initialize Popular Brands Carousel */
const brandsScroll = document.querySelector('.brands-scroll');
const brandsPagination = document.getElementById('brandsPagination');
if(brandsScroll && brandsPagination) {
  const brands = brandsScroll.querySelectorAll('.brand-container');
  
  // Create dots
  brands.forEach((brand, index) => {
    const dot = document.createElement('div');
    dot.className = 'brands-dot';
    if(index === 0) { dot.classList.add('active'); brand.classList.add('in-focus'); }
    brandsPagination.appendChild(dot);
  });

  // Center Tracking for Brands
  const updateActiveBrand = () => {
    const containerRect = brandsScroll.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    
    let closestBrand = null;
    let minDistance = Infinity;
    let closestIndex = 0;

    brands.forEach((brand, index) => {
      const rect = brand.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(center - containerCenter);
      if(dist < minDistance) {
        minDistance = dist;
        closestBrand = brand;
        closestIndex = index;
      }
    });

    brands.forEach(b => b.classList.remove('in-focus'));
    if(closestBrand) closestBrand.classList.add('in-focus');
    
    const dots = brandsPagination.querySelectorAll('.brands-dot');
    dots.forEach(d => d.classList.remove('active'));
    if(dots[closestIndex]) dots[closestIndex].classList.add('active');
  };

  brandsScroll.addEventListener('scroll', () => {
    window.requestAnimationFrame(updateActiveBrand);
  });
  
  // Init
  setTimeout(updateActiveBrand, 100);
}

/* Populate Vertical Restaurant List */
// Restaurant List population logic moved to renderCategoryContent
const restaurantList = document.getElementById('restaurantList');
if(restaurantList){
  restaurantList.classList.add('restaurant-list');
  restaurantList.addEventListener('click', function(e) {
    const heartBtn = e.target.closest('.heart-btn');
    if (heartBtn) {
      e.preventDefault(); e.stopPropagation();
      const card = heartBtn.closest('.res-card');
      const resName = card.querySelector('.res-name').textContent;
      toggleFavorite(resName, heartBtn);
    }
    else {
      const card = e.target.closest('.res-card');
      if(card){
        const name = card.querySelector('.res-name').textContent;
        openRestaurant(name, window.currentCategoryConfig?.menu);
      }
    }
  });
}

/* Sticky Search Bar Logic */
const catContent = document.querySelector('.cat-content');
const catHeader = document.querySelector('.cat-header');
const searchWrapper = document.querySelector('.cat-search-wrapper');
const headerSearchInput = document.getElementById('headerSearchInput');
const mainCatSearchInput = document.getElementById('mainCatSearchInput');

if(catContent && catHeader && searchWrapper){
  catContent.addEventListener('scroll', () => {
    const wrapperTop = searchWrapper.getBoundingClientRect().top;
    const headerBottom = catHeader.getBoundingClientRect().bottom;
    // If search wrapper scrolls up behind header, stick the header search
    if (wrapperTop < headerBottom - 20) { 
      catHeader.classList.add('stuck');
    } else {
      catHeader.classList.remove('stuck');
    }
  });
}
// Sync inputs
if(headerSearchInput && mainCatSearchInput){
  const filterRestaurants = (query) => {
    const cards = document.querySelectorAll('#restaurantList .res-card');
    cards.forEach(card => {
        const name = card.querySelector('.res-name').textContent.toLowerCase();
        if(name.includes(query.toLowerCase())) card.style.display = 'flex';
        else card.style.display = 'none';
    });
  };
  headerSearchInput.addEventListener('input', (e) => { mainCatSearchInput.value = e.target.value; filterRestaurants(e.target.value); });
  mainCatSearchInput.addEventListener('input', (e) => { headerSearchInput.value = e.target.value; filterRestaurants(e.target.value); });
}

/* Restaurant Menu Nav Logic */
const resMenuNav = document.getElementById('resMenuNav');
if (resMenuNav) {
    resMenuNav.addEventListener('click', (e) => {
        if (e.target.classList.contains('res-menu-item')) {
            resMenuNav.querySelectorAll('.res-menu-item').forEach(item => item.classList.remove('active'));
            e.target.classList.add('active');

            // Auto-scroll the navigation bar to center the clicked item.
            // This ensures the active item is always visible.
            e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            
            const targetName = e.target.textContent.trim();
            const titles = document.querySelectorAll('.res-category-title');
            for (const title of titles) {
                if (title.textContent.trim() === targetName) {
                    title.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
            }
        }
    });
}

/* Restaurant Menu Item Add/Quantity Logic & Dish Detail */
const resMenuContent = document.getElementById('resMenuContent');
const dishDetailScreen = document.getElementById('dishDetailScreen');
const dishCloseBtn = document.getElementById('dishCloseBtn');

const viewCartBtn = document.getElementById('viewCartBtn');
function updateCartView() {
    if (!viewCartBtn) return;

    const restaurantScreen = document.getElementById('restaurantScreen');
    if (cart.length === 0 || !restaurantScreen.classList.contains('active')) {
        viewCartBtn.classList.remove('active');
        // Using display none via class logic, ensuring it hides
        viewCartBtn.style.display = 'none'; 
    }

    let totalItems = 0;
    let totalPrice = 0;
    cart.forEach(item => {
        totalItems += item.quantity;
        let itemPrice = item.basePrice;
        if (item.addons) {
            item.addons.forEach(addon => {
                itemPrice += addon.price;
            });
        }
        totalPrice += itemPrice * item.quantity;
    });

    if (totalItems > 0 && restaurantScreen.classList.contains('active')) {
        document.getElementById('cartItemCount').textContent = totalItems;
        viewCartBtn.style.display = 'flex';
        setTimeout(() => viewCartBtn.classList.add('active'), 10);
    } else {
        viewCartBtn.classList.remove('active');
        viewCartBtn.style.display = 'none';
    }
}

function updateDishDetailTotal() {
    if (!dishDetailScreen || !dishDetailScreen.classList.contains('active')) return;

    const priceEl = document.getElementById('dishDetailPrice');
    const quantityEl = dishDetailScreen.querySelector('.quantity-value-large');
    const addToCartBtn = dishDetailScreen.querySelector('.add-to-cart-large-btn');

    const basePrice = parseFloat(priceEl.dataset.basePrice);
    const quantity = parseInt(quantityEl.textContent, 10);

    let addonsPrice = 0;
    const selectedAddons = dishDetailScreen.querySelectorAll('.addon-checkbox:checked');
    selectedAddons.forEach(checkbox => {
        const priceText = checkbox.closest('.addon-item').querySelector('.addon-price').dataset.price;
        if (priceText) addonsPrice += parseFloat(priceText);
    });

    if (!isNaN(basePrice) && !isNaN(quantity)) {
        const total = (basePrice + addonsPrice) * quantity;
        priceEl.textContent = `UGX ${total.toFixed(2)}`;
        addToCartBtn.textContent = `Add to cart`;
    }
}

function openDishDetail(itemCard) {
    if (!dishDetailScreen) return;

    // Extract data from the clicked card
    const title = itemCard.querySelector('.res-item-title').textContent;
    const desc = itemCard.querySelector('.res-item-desc').textContent;
    const price = itemCard.querySelector('.res-item-current-price').textContent;
    // Clone the node to safely get the emoji without the button
    const imgBoxClone = itemCard.querySelector('.res-item-img-box').cloneNode(true);
    imgBoxClone.querySelector('.res-item-add-btn').remove();
    const image = imgBoxClone.innerHTML.trim();

    // Populate the detail screen
    document.getElementById('dishDetailTitle').textContent = title;
    document.getElementById('dishDetailDesc').textContent = desc;
    const priceEl = document.getElementById('dishDetailPrice');
    priceEl.textContent = `UGX ${price}`;
    priceEl.dataset.basePrice = price;
    document.getElementById('dishDetailImage').innerHTML = image;

    // Reset quantity
    dishDetailScreen.querySelector('.quantity-value-large').textContent = '1';

    // Uncheck all addons
    dishDetailScreen.querySelectorAll('.addon-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });

    // Show the screen
    dishDetailScreen.classList.add('active');

    // Reset image transform for parallax
    const dishImage = document.getElementById('dishDetailImage');
    if(dishImage) {
        dishImage.style.transform = '';
        dishImage.style.transition = ''; 
    }

    // Update total after screen is active and populated
    updateDishDetailTotal();
}

function closeDishDetail() {
    if (dishDetailScreen) {
        dishDetailScreen.classList.remove('active');
    }
}

if (dishCloseBtn) {
    dishCloseBtn.addEventListener('click', closeDishDetail);
}

// Dish Detail Parallax
const dishContent = document.querySelector('.dish-content');
const dishImage = document.getElementById('dishDetailImage');
if (dishContent && dishImage) {
    dishContent.addEventListener('scroll', () => {
        const sc = dishContent.scrollTop;
        if (dishDetailScreen.classList.contains('active')) {
             if (sc > 5) dishImage.style.transition = 'none'; // Disable transition during scroll to avoid jank
             dishImage.style.transform = `translateY(${sc * 0.4}px) scale(1)`;
        }
    }, { passive: true });
}

const addonsContainer = document.getElementById('dishDetailAddons');
if (addonsContainer) {
    addonsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('addon-checkbox')) {
            updateDishDetailTotal();
        }
    });
}


// Add event listener to the footer for quantity changes
const dishFooter = dishDetailScreen.querySelector('.dish-footer');
if (dishFooter) {
    dishFooter.addEventListener('click', (e) => {
        const quantityEl = dishFooter.querySelector('.quantity-value-large');
        if (!quantityEl) return;
        let quantity = parseInt(quantityEl.textContent, 10);

        if (e.target.classList.contains('plus')) {
            quantityEl.textContent = quantity + 1;
            updateDishDetailTotal();
        } else if (e.target.classList.contains('minus')) {
            if (quantity > 1) {
                quantityEl.textContent = quantity - 1;
                updateDishDetailTotal();
            }
        } else if (e.target.classList.contains('add-to-cart-large-btn')) {
            const title = document.getElementById('dishDetailTitle').textContent;
            const priceEl = document.getElementById('dishDetailPrice');
            const basePrice = parseFloat(priceEl.dataset.basePrice);
            const currentQuantity = parseInt(quantityEl.textContent, 10);
            const image = document.getElementById('dishDetailImage').innerHTML;
            
            const selectedAddons = [];
            dishDetailScreen.querySelectorAll('.addon-checkbox:checked').forEach(checkbox => {
                const item = checkbox.closest('.addon-item');
                selectedAddons.push({
                    name: item.querySelector('.addon-name').textContent,
                    price: parseFloat(item.querySelector('.addon-price').dataset.price)
                });
            });

            cart.push({
                title,
                basePrice,
                quantity: currentQuantity,
                addons: selectedAddons,
                image
            });
            saveCart();
            closeDishDetail();
        }
    });
}

if (resMenuContent) {
    resMenuContent.addEventListener('click', (e) => {
        const itemCard = e.target.closest('.res-item-card');

        // If a card was clicked (including its add button), open the detail screen
        if (itemCard) {
            openDishDetail(itemCard);
        }
    });
}

/* Toast Function */
function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.className = "show";
    setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

function triggerConfetti() {
    // create simple celebration effect
    const confettiContainer = document.createElement('div');
    confettiContainer.style.position = 'fixed';
    confettiContainer.style.top = '0';
    confettiContainer.style.left = '0';
    confettiContainer.style.width = '100%';
    confettiContainer.style.height = '100%';
    confettiContainer.style.pointerEvents = 'none';
    confettiContainer.style.zIndex = '9999';
    document.body.appendChild(confettiContainer);

    const colors = ['#ffcc00', '#ff4d4d', '#49c9ba', '#0077ff', '#ff66b3'];
    for (let i = 0; i < 80; i++) {
        const conf = document.createElement('div');
        const size = Math.random() * 8 + 4;
        conf.style.position = 'absolute';
        conf.style.width = `${size}px`;
        conf.style.height = `${size * 0.4}px`;
        conf.style.background = colors[Math.floor(Math.random() * colors.length)];
        conf.style.left = `${Math.random() * 100}%`;
        conf.style.top = '-10px';
        conf.style.opacity = '0.9';
        conf.style.transform = `rotate(${Math.random() * 360}deg)`;
        conf.style.borderRadius = '2px';
        conf.style.transition = 'transform 2.5s ease-out, top 2.5s ease-out, opacity 2.5s ease-out';
        confettiContainer.appendChild(conf);

        setTimeout(() => {
            conf.style.top = `${80 + Math.random() * 20}%`;
            conf.style.transform = `translateY(0) rotate(${Math.random() * 720}deg)`;
            conf.style.opacity = '0';
        }, 50);
    }

    setTimeout(() => {
        document.body.removeChild(confettiContainer);
    }, 2800);
}

/* Cart Screen Logic */
const cartScreen = document.getElementById('cartScreen');
const cartBackBtn = document.getElementById('cartBackBtn');

function openCart() {
    const cartContent = document.getElementById('cartContent');
    const cartTotalAmount = document.getElementById('cartTotalAmount');
    
    clearInterval(suggestedScrollInterval);
    cartContent.innerHTML = '';
    let grandTotal = 0;

    if (cart.length === 0) {
        cartContent.innerHTML = '<div style="text-align:center; margin-top:50px; color:#999; font-size: 1.1em;">Your cart is empty</div>';
    } else {
        cart.forEach((item, index) => {
            let itemTotal = item.basePrice;
            let detailsHtml = '';
            
            if (item.addons && item.addons.length > 0) {
                item.addons.forEach(addon => {
                    itemTotal += addon.price;
                    detailsHtml += `<div>+ ${addon.name} (${addon.price.toFixed(2)})</div>`;
                });
            }
            
            itemTotal *= item.quantity;
            grandTotal += itemTotal;

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <div class="cart-item-img-box">${window.getImageHtml(item.image, '🍽️')}</div>
                <div class="cart-item-info" style="flex:1;">
                    <div class="cart-item-header">${item.title}</div>
                    <div class="cart-item-details">${detailsHtml}</div>
                    <div class="cart-item-price" style="margin-top: 8px; font-weight: bold; color: #019E81;">UGX ${itemTotal.toFixed(2)}</div>
                    <div class="cart-controls" style="margin-top: 10px;">
                        <div class="cart-control-btn minus" data-index="${index}">-</div>
                        <div class="cart-quantity-text">${item.quantity}</div>
                        <div class="cart-control-btn plus" data-index="${index}">+</div>
                    </div>
                </div>
                <div style="display:flex; flex-direction:column; align-items:flex-end; justify-content:space-between; gap:10px;">
                    <div class="cart-control-btn delete" data-index="${index}">🗑️</div>
                </div>
            `;
            cartContent.appendChild(div);
        });

        const addMoreBtn = document.createElement('div');
        addMoreBtn.className = 'add-more-items-btn';
        addMoreBtn.textContent = 'Add More Items';
        addMoreBtn.addEventListener('click', () => {
            cartScreen.classList.remove('active');
            clearInterval(suggestedScrollInterval);
        });
        cartContent.appendChild(addMoreBtn);

        // Suggested Items Section
        const suggestedSection = document.createElement('div');
        suggestedSection.className = 'suggested-section';
        suggestedSection.innerHTML = '<div class="suggested-title">You may also like</div>';
        
        const suggestedScroll = document.createElement('div');
        suggestedScroll.className = 'suggested-scroll';
        
        const suggestedItems = [
            { title: 'French Fries', price: 15.00, emoji: '🍟' },
            { title: 'Coca Cola', price: 5.00, emoji: '🥤' },
            { title: 'Choco Ice Cream', price: 12.00, emoji: '🍦' },
            { title: 'Fresh Salad', price: 20.00, emoji: '🥗' },
            { title: 'Onion Rings', price: 18.00, emoji: '🧅' }
        ];

        suggestedItems.forEach(sItem => {
            const itemEl = document.createElement('div');
            itemEl.className = 'suggested-item';
            itemEl.innerHTML = `
                <div class="suggested-img-box">
                    ${sItem.emoji}
                    <div class="suggested-add-btn">+</div>
                </div>
                <div class="suggested-name">${sItem.title}</div>
                <div class="suggested-price">${sItem.price.toFixed(2)}</div>
            `;
            
            itemEl.querySelector('.suggested-add-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                cart.push({ title: sItem.title, basePrice: sItem.price, quantity: 1, addons: [], image: sItem.emoji });
                showToast(`${sItem.title} added!`);
                saveCart();
                setTimeout(openCart, 50); // Refresh cart UI
            });
            suggestedScroll.appendChild(itemEl);
        });
        
        suggestedSection.appendChild(suggestedScroll);
        cartContent.appendChild(suggestedSection);

        suggestedScrollInterval = setInterval(() => {
            if (suggestedScroll.scrollLeft + suggestedScroll.clientWidth >= suggestedScroll.scrollWidth - 10) {
                suggestedScroll.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                suggestedScroll.scrollBy({ left: 160, behavior: 'smooth' });
            }
        }, 2500);
    }

    cartTotalAmount.textContent = `UGX ${grandTotal.toFixed(2)}`;
    cartScreen.classList.add('active');
}

/* Cart Actions (Delegation) */
document.getElementById('cartContent').addEventListener('click', (e) => {
    const btn = e.target.closest('.cart-control-btn');
    if (!btn) return;
    
    const index = parseInt(btn.dataset.index, 10);
    
    if (btn.classList.contains('plus')) {
        cart[index].quantity++;
    } else if (btn.classList.contains('minus')) {
        if (cart[index].quantity > 1) {
            cart[index].quantity--;
        }
    } else if (btn.classList.contains('delete')) {
        cart.splice(index, 1);
    }
    
    saveCart();
    setTimeout(openCart, 50);
});

/* Checkout Action */
document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('checkout-btn')) {
        if (cart.length > 0) {
            const checkoutScreen = document.getElementById('checkoutActionScreen');
            const checkoutContent = checkoutScreen.querySelector('.checkout-content');
            
            // Calculate totals
            let grandTotal = 0;
            let totalItems = 0;
            cart.forEach(item => {
                let itemTotal = item.basePrice;
                if (item.addons) item.addons.forEach(a => itemTotal += a.price);
                grandTotal += itemTotal * item.quantity;
                totalItems += item.quantity;
            });
            const resName = document.getElementById('resScreenName').textContent || 'Restaurant';

            checkoutContent.innerHTML = '';

            // 1. "Your Order" Subtitle
            const yourOrderTitle = document.createElement('h3');
            yourOrderTitle.textContent = 'Your Order';
            yourOrderTitle.style.cssText = 'margin: 5px 0 15px 0; font-size: 1.1em; font-weight: 800; color: #333;';
            checkoutContent.appendChild(yourOrderTitle);

            // 2. Accordion for Items
            const accordionHeader = document.createElement('div');
            accordionHeader.className = 'cart-accordion-header';
            if (isCheckoutAccordionOpen) accordionHeader.classList.add('active');
            accordionHeader.innerHTML = `
                <div class="header-text">
                    <div class="header-title">${totalItems} Items from</div>
                    <div class="header-subtitle">${resName}</div>
                </div>
                <div class="cart-accordion-icon">v</div>
            `;

            const accordionBody = document.createElement('div');
            accordionBody.className = 'cart-accordion-body';
            if (isCheckoutAccordionOpen) accordionBody.classList.add('open');

            // Populate Accordion Body with simple list
            cart.forEach((item) => {
                const div = document.createElement('div');
                div.style.cssText = 'padding: 10px 0; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; font-size: 0.9em;';
                div.innerHTML = `<span>${item.quantity}x ${item.title}</span> <span>${(item.basePrice * item.quantity).toFixed(2)}</span>`;
                accordionBody.appendChild(div);
            });

            accordionHeader.addEventListener('click', () => {
                isCheckoutAccordionOpen = !isCheckoutAccordionOpen;
                accordionHeader.classList.toggle('active');
                if (isCheckoutAccordionOpen) {
                    accordionBody.classList.add('open');
                    accordionBody.style.maxHeight = accordionBody.scrollHeight + "px";
                } else {
                    accordionBody.classList.remove('open');
                    accordionBody.style.maxHeight = null;
                }
            });

            checkoutContent.appendChild(accordionHeader);
            checkoutContent.appendChild(accordionBody);
            if (isCheckoutAccordionOpen) { setTimeout(() => { accordionBody.style.maxHeight = accordionBody.scrollHeight + "px"; }, 0); }

            // Allergy Section
            const allergySection = document.createElement('div');
            allergySection.style.cssText = 'margin-top: 25px; cursor: pointer; padding: 0 5px;';
            allergySection.id = 'checkoutAllergySection';
            allergySection.innerHTML = `
                <div class="address-details">
                    <span class="address-icon">⚠️</span>
                    <div style="flex: 1;">
                        <span style="font-weight: bold;">Any Allergies?</span>
                        <div id="allergyNotesDisplay" style="font-size: 0.8em; color: #666; margin-top: 4px; white-space: pre-wrap; word-break: break-word; display: none;"></div>
                    </div>
                </div>
            `;
            allergySection.addEventListener('click', () => {
                document.getElementById('allergyInput').value = allergyNotes;
                document.getElementById('allergyScreen').classList.add('active');
            });
            checkoutContent.appendChild(allergySection);
            updateAllergyDisplay();

            // Cutlery Section
            const cutlerySection = document.createElement('div');
            cutlerySection.className = 'cutlery-section';
            cutlerySection.innerHTML = `
                <div class="cutlery-header">
                    <div class="cutlery-title">
                        <span>🍴</span>
                        <b>Need Cutlery?</b>
                    </div>
                    <label class="cutlery-switch">
                        <input type="checkbox" id="cutlerySwitch">
                        <span class="slider"></span>
                    </label>
                </div>
                <div class="cutlery-description" id="cutleryDescription">
                    Help us minimize waste. Only ask for cutley when you need it.
                </div>
            `;
            checkoutContent.appendChild(cutlerySection);

            const cutlerySwitch = cutlerySection.querySelector('#cutlerySwitch');
            const cutleryDescription = cutlerySection.querySelector('#cutleryDescription');
            cutlerySwitch.addEventListener('change', () => {
                if (cutlerySwitch.checked) {
                    cutleryDescription.textContent = 'Cutlery will be requested from the restaurant for this order.';
                } else {
                    cutleryDescription.textContent = 'Help us minimize waste. Only ask for cutley when you need it.';
                }
            });

            // 3. Delivery Address Section
            const addressSection = document.createElement('div');
            addressSection.className = 'checkout-section';
            addressSection.style.marginTop = '20px';
            const currentAddress = document.getElementById('selectedAddressText').textContent || 'No address selected';
            addressSection.innerHTML = `
                <div class="checkout-section-header">
                    <h4>Delivery Address</h4>
                    <button class="change-btn">Change</button>
                </div>
                <div class="address-details">
                    <span class="address-icon">🏠</span>
                    <span class="address-text" style="line-height: 1.4;">${currentAddress}</span>
                </div>
                <div id="checkoutMiniMap" class="checkout-mini-map"></div>
                <div class="recipient-details-section" id="checkoutRecipientSection"></div>
                <div class="user-phone-section" id="checkoutUserPhoneSection"></div>
            `;
            addressSection.querySelector('.change-btn').addEventListener('click', () => {
                document.getElementById('checkoutActionScreen').classList.remove('active');
            });
            checkoutContent.appendChild(addressSection);

            const recipientSection = document.getElementById('checkoutRecipientSection');
            recipientSection.addEventListener('click', () => {
                const recipientScreen = document.getElementById('recipientScreen');
                document.getElementById('recipientName').value = recipientDetails.name;
                const phoneParts = recipientDetails.phone.split(' ');
                if (phoneParts.length > 1) {
                    document.getElementById('phonePrefix').value = phoneParts[0];
                    document.getElementById('phoneNumber').value = phoneParts.slice(1).join(' ');
                } else {
                    document.getElementById('phoneNumber').value = recipientDetails.phone;
                }
                recipientScreen.classList.add('active');
            });
            updateRecipientDisplay();

            const userPhoneSection = document.getElementById('checkoutUserPhoneSection');
            userPhoneSection.addEventListener('click', () => {
                const userPhoneScreen = document.getElementById('userPhoneScreen');
                const phoneParts = userPhoneNumber.split(' ');
                if (phoneParts.length > 1) {
                    document.getElementById('userPhonePrefix').value = phoneParts[0];
                    document.getElementById('userPhoneNumberInput').value = phoneParts.slice(1).join(' ');
                } else {
                    document.getElementById('userPhoneNumberInput').value = userPhoneNumber;
                    document.getElementById('userPhonePrefix').value = '+971'; // Default prefix
                }
                userPhoneScreen.classList.add('active');
            });
            updateUserPhoneDisplay();

            setTimeout(async () => {
                if(!document.getElementById('checkoutMiniMap')) return;
                try { await loadLeaflet(); } catch(e) { return; }
                const center = marker ? marker.getLatLng() : [24.4539,54.3773];
                const miniMap = window.L.map('checkoutMiniMap', { zoomControl:false, dragging:false, scrollWheelZoom:false, doubleClickZoom:false, touchZoom:false, attributionControl:false }).setView(center, 16);
                window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
                const pinIcon = window.L.divIcon({ html: '📍', className: 'delivery-pin-icon', iconSize: [30, 30], iconAnchor: [15, 30] });
                window.L.marker(center, {icon: pinIcon}).addTo(miniMap);
            }, 300);

            // Delivery Options Section
            const deliveryOptSection = document.createElement('div');
            deliveryOptSection.className = 'checkout-section';
            deliveryOptSection.style.marginTop = '20px';

            const deliveryOptHeader = document.createElement('div');
            deliveryOptHeader.className = 'checkout-section-header';
            deliveryOptHeader.style.marginBottom = '0';
            deliveryOptHeader.style.cursor = 'pointer';
            deliveryOptHeader.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.5em;">⏰</span>
                    <h4>Delivery Options</h4>
                </div>
                <div class="cart-accordion-icon">v</div>
            `;

            const deliveryOptBody = document.createElement('div');
            deliveryOptBody.className = 'cart-accordion-body';
            deliveryOptBody.innerHTML = `
                <div style="padding-top: 15px; border-top: 1px solid #eee; margin-top: 10px;">
                    <label style="display:flex; align-items:center; gap:10px; margin-bottom:15px; cursor:pointer;">
                        <input type="radio" name="deliveryType" value="standard" checked style="accent-color: #019E81; width: 18px; height: 18px;">
                        <div>
                            <div style="font-weight:bold; color:#333; font-size: 1em;">Standard Delivery</div>
                            <div style="font-size:0.85em; color:#666;">20 - 30 mins</div>
                        </div>
                    </label>
                    <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                        <input type="radio" name="deliveryType" value="schedule" style="accent-color: #019E81; width: 18px; height: 18px;">
                        <div>
                            <div style="font-weight:bold; color:#333; font-size: 1em;">Schedule Order</div>
                            <div style="font-size:0.85em; color:#666;">Choose a specific time</div>
                        </div>
                    </label>
                    <div id="scheduleTimeContainer" style="max-height: 0; overflow: hidden; transition: max-height 0.3s ease; padding-left: 30px;">
                        <input type="datetime-local" id="scheduleTimeInput" style="margin-top: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 8px; width: 100%; font-family: inherit;">
                    </div>
                </div>
            `;
            
            let isDeliveryOptOpen = false;
            deliveryOptHeader.addEventListener('click', () => {
                isDeliveryOptOpen = !isDeliveryOptOpen;
                const icon = deliveryOptHeader.querySelector('.cart-accordion-icon');
                if (isDeliveryOptOpen) {
                    deliveryOptBody.classList.add('open');
                    deliveryOptBody.style.maxHeight = deliveryOptBody.scrollHeight + "px";
                    icon.style.transform = 'rotate(180deg)';
                } else {
                    deliveryOptBody.classList.remove('open');
                    deliveryOptBody.style.maxHeight = null;
                    icon.style.transform = 'rotate(0deg)';
                }
            });

            const radioBtns = deliveryOptBody.querySelectorAll('input[name="deliveryType"]');
            const timeContainer = deliveryOptBody.querySelector('#scheduleTimeContainer');
            radioBtns.forEach(btn => {
                btn.addEventListener('change', (e) => {
                    if (e.target.value === 'schedule') {
                        timeContainer.style.maxHeight = '100px';
                        if(isDeliveryOptOpen) deliveryOptBody.style.maxHeight = (deliveryOptBody.scrollHeight + 100) + "px";
                    } else {
                        timeContainer.style.maxHeight = '0';
                    }
                });
            });

            deliveryOptSection.appendChild(deliveryOptHeader);
            deliveryOptSection.appendChild(deliveryOptBody);
            checkoutContent.appendChild(deliveryOptSection);

            // Driver Notes Section
            const driverNotesSection = document.createElement('div');
            driverNotesSection.className = 'checkout-section';
            driverNotesSection.style.marginTop = '20px';
            driverNotesSection.innerHTML = `
                <div class="checkout-section-header">
                    <h4>📝 Driver Instructions</h4>
                </div>
                <textarea id="driverNotesInput" placeholder="e.g. Call when near, leave at door, gate code..." style="width:100%; padding:12px; border:1px solid #ddd; border-radius:8px; font-family:inherit; resize:vertical; min-height:60px; font-size:0.95em;"></textarea>
            `;
            checkoutContent.appendChild(driverNotesSection);

            // 4. Payment Method
            const paymentSection = document.createElement('div');
            paymentSection.className = 'checkout-section';
            paymentSection.id = 'paymentSection';
            paymentSection.innerHTML = `
                <div class="checkout-section-header">
                    <h4>Payment Method</h4>
                    <button class="change-btn">Select</button>
                </div>
                <div class="address-details">
                    <span class="address-icon">${selectedPaymentMethod.icon}</span>
                    <span>${selectedPaymentMethod.text}</span>
                </div>
            `;
            paymentSection.querySelector('.change-btn').addEventListener('click', () => {
                const currentPayment = selectedPaymentMethod.value;
                const radioToCheck = document.querySelector(`#paymentSheet input[value="${currentPayment}"]`);
                if (radioToCheck) {
                    radioToCheck.checked = true;
                }
                document.getElementById('paymentOverlay').classList.add('show');
                document.getElementById('paymentSheet').classList.add('show');
            });
            
            if (selectedPaymentMethod.value === 'mtn' || selectedPaymentMethod.value === 'airtel') {
                    const infoDiv = document.createElement('div');
                    infoDiv.id = 'paymentDepositInfo';
                    infoDiv.style.cssText = 'margin-top: 15px; font-size: 0.9em; color: #555; background-color: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;';
                    const number = '+971562889428';
                    infoDiv.innerHTML = `<strong>Deposit Number:</strong> ${number}<br><small>After deposit, send screenshot proof to your registered contact number in the order details.</small>`;
                    paymentSection.appendChild(infoDiv);
            }

            checkoutContent.appendChild(paymentSection);

            // Courier Tip Section
            const tipSection = document.createElement('div');
            tipSection.className = 'checkout-section';
            tipSection.style.marginTop = '20px';
            tipPercentage = 0;
            const summarySection = document.createElement('div');
            summarySection.className = 'checkout-section';
            summarySection.style.marginTop = '20px';

            const updateSummary = () => {
                const currency = 'UGX';
                const productTotal = grandTotal;
                const deliveryFee = 0.00; 
                const promotion = 0.00;
                const subTotal = productTotal - promotion;
                const tipAmount = subTotal * (tipPercentage / 100);
                const totalToPay = subTotal + deliveryFee + tipAmount;

                let summaryHtml = `<div class="checkout-section-header" style="margin-bottom:15px;"><h4>Delivery Summary</h4></div>`;

                // Product list header
                summaryHtml += `
                    <div class="summary-row" style="font-weight: bold; color: #333; border-bottom: 1px solid #eee; padding-bottom: 8px;">
                    <span style="flex: 4; text-align: left;">Products</span>
                        <span style="flex: 1; text-align: center;">Qty</span>
                    <span style="flex: 2; text-align: center;">Unit Price</span>
                    <span style="flex: 2; text-align: center;">Price</span>
                    </div>
                `;

                // List each product
                cart.forEach(item => {
                    let itemPrice = item.basePrice;
                    if (item.addons) item.addons.forEach(a => itemPrice += a.price);
                    const lineTotal = itemPrice * item.quantity;

                    summaryHtml += `
                        <div class="summary-row">
                        <span style="flex: 4; text-align: left; white-space: normal; word-break: break-word;">${item.title}</span>
                            <span style="flex: 1; text-align: center;">${item.quantity}</span>
                        <span style="flex: 2; text-align: center;">${itemPrice.toFixed(2)}</span>
                        <span style="flex: 2; text-align: center;">${lineTotal.toFixed(2)}</span>
                        </div>
                    `;
                });

                // Rest of the summary
                summaryHtml += `
                    <div class="summary-row" style="border-top: 1px solid #eee; padding-top: 8px;"><span>Promotions</span><span>-${currency} ${promotion.toFixed(2)}</span></div>
                    <div class="summary-row" style="font-weight: 800; color: #333;"><span>Subtotal</span><span>${currency} ${subTotal.toFixed(2)}</span></div>
                    <div class="summary-row"><span>Delivery Fees</span><span>${currency} ${deliveryFee.toFixed(2)}</span></div>
                    <div class="summary-row"><span>Courier Tip (${tipPercentage}%)</span><span>${currency} ${tipAmount.toFixed(2)}</span></div>
                    <div class="summary-row total"><span>Total to Pay</span><span>${currency} ${totalToPay.toFixed(2)}</span></div>
                `;
                
                summarySection.innerHTML = summaryHtml;
            };
            
            const tipHeader = document.createElement('div');
            tipHeader.className = 'checkout-section-header';
            tipHeader.style.marginBottom = '5px';
            tipHeader.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:1.5em;">🤲</span>
                    <h4>Courier tip</h4>
                </div>
            `;
            
            const tipSubtitle = document.createElement('div');
            tipSubtitle.style.cssText = 'font-size: 0.85em; color: #666; margin-bottom: 15px;';
            tipSubtitle.textContent = 'The Courier will get the full amount';

            const tipOptionsContainer = document.createElement('div');
            tipOptionsContainer.style.cssText = 'display: flex; gap: 10px; margin-bottom: 15px;';
            
            [0, 5, 10, 15].forEach(amount => {
                const el = document.createElement('div');
                el.className = 'tip-option';
                if (amount === 0) el.classList.add('selected');
                el.textContent = amount + '%';
                el.addEventListener('click', () => {
                    tipOptionsContainer.querySelectorAll('.tip-option').forEach(opt => opt.classList.remove('selected'));
                    el.classList.add('selected');
                    tipPercentage = amount;
                    updateSummary();
                });
                tipOptionsContainer.appendChild(el);
            });

            const saveTipContainer = document.createElement('label');
            saveTipContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; font-size: 0.9em; cursor: pointer; user-select: none;';
            saveTipContainer.innerHTML = `<input type="checkbox" style="accent-color: #019E81; width: 18px; height: 18px;"><span>Save tip for next order</span>`;

            tipSection.append(tipHeader, tipSubtitle, tipOptionsContainer, saveTipContainer);
            checkoutContent.appendChild(tipSection);

            updateSummary();
            checkoutContent.appendChild(summarySection);

            checkoutScreen.classList.add('active');
        } else {
            showToast("Your cart is empty!");
    }
}
});
if (viewCartBtn) {
    viewCartBtn.addEventListener('click', openCart);
}

if (cartBackBtn) {
    cartBackBtn.addEventListener('click', () => {
        cartScreen.classList.remove('active');
        clearInterval(suggestedScrollInterval);
    });
}

/* Custom Order Confirmation Popup */
async function showCustomOrderConfirmation() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:10001;animation:fadeIn 0.3s ease;';
        
        const modal = document.createElement('div');
        modal.style.cssText = 'background:#fff;border-radius:20px;padding:30px;max-width:400px;width:90%;box-shadow:0 10px 40px rgba(0,0,0,0.3);animation:slideUp 0.3s ease;text-align:center;';
        
        modal.innerHTML = `
            <div style="font-size:3em;margin-bottom:20px;">🛍️</div>
            <h2 style="color:#333;margin-bottom:10px;font-size:1.3em;">Confirm Your Order</h2>
            <p style="color:#666;margin-bottom:25px;line-height:1.5;">Are you sure you want to place this order? You can track it in real-time after confirmation.</p>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button id="confirmOrderCancel" style="flex:1;padding:12px;border:1px solid #ddd;background:#f5f5f5;color:#333;border-radius:10px;font-weight:bold;font-size:1em;cursor:pointer;transition:all 0.2s;">Cancel</button>
                <button id="confirmOrderPlace" style="flex:1;padding:12px;background:#019E81;color:#fff;border:none;border-radius:10px;font-weight:bold;font-size:1em;cursor:pointer;transition:all 0.2s;box-shadow:0 4px 15px rgba(1,158,129,0.3);">Yes, Place Order</button>
            </div>
        `;
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(50px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        `;
        document.head.appendChild(style);
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        const cancelBtn = document.getElementById('confirmOrderCancel');
        const placeBtn = document.getElementById('confirmOrderPlace');
        
        cancelBtn.addEventListener('click', () => {
            overlay.style.animation = 'fadeIn 0.3s ease reverse';
            setTimeout(() => {
                document.body.removeChild(overlay);
                document.head.removeChild(style);
                resolve(false);
            }, 300);
        });
        
        placeBtn.addEventListener('click', () => {
            overlay.style.animation = 'fadeIn 0.3s ease reverse';
            setTimeout(() => {
                document.body.removeChild(overlay);
                document.head.removeChild(style);
                resolve(true);
            }, 300);
        });
    });
}

const placeOrderBtn = document.getElementById('placeOrderBtn');
if (placeOrderBtn) {
    placeOrderBtn.addEventListener('click', async () => {
        // Verification Check
        if (currentUser.isGuest || !currentUser.isApproved) {
            showToast("Your account must be approved to place orders.");
            if (currentUser.isGuest) {
                document.getElementById('loginScreen').classList.add('active');
            } else {
                proceedToHome();
            }
            return;
        }

        if (cart.length > 0) {
            // Check Schedule
            const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value;
            let scheduledTime = null;
            if (deliveryType === 'schedule') {
                const timeInput = document.getElementById('scheduleTimeInput').value;
                if (!timeInput) {
                    showToast("Please select a time for scheduled delivery");
                    return;
                }
                const scheduleDate = new Date(timeInput);
                if (scheduleDate <= new Date()) {
                    showToast("Scheduled time must be in the future");
                    return;
                }
                scheduledTime = timeInput;
            }

            if (!userPhoneNumber && !recipientDetails.phone) {
                showToast("Please provide a contact number and select payment mode");
                const userPhoneSection = document.getElementById('checkoutUserPhoneSection');
                if (userPhoneSection) userPhoneSection.click();
                return;
            }

            if (await showCustomOrderConfirmation()) {
                // Create new order with initial status
                const orderId = 'ORD' + Date.now();
                const itemsTotal = cart.reduce((sum, item) => sum + (item.basePrice * item.quantity), 0);
                const tipAmount = itemsTotal * (tipPercentage / 100);
            const driverNotes = document.getElementById('driverNotesInput') ? document.getElementById('driverNotesInput').value.trim() : '';

                const restaurantObj = window.adminRestaurants.find(r => r.name === document.getElementById('resScreenName').textContent);

                const newOrder = {
                    id: orderId,
                    userId: window.auth.currentUser.uid, // Match Firestore Rules
                    vendorId: restaurantObj?.uid || restaurantObj?.id || null, // Prefer UID for Auth checks
                    status: scheduledTime ? 'scheduled' : 'pending', // Initial status
                    statusText: scheduledTime ? 'Order Scheduled' : 'Order Placed - Waiting for confirmation',
                    statusColor: '#FFBF42',
                    items: [...cart],
                    total: itemsTotal,
                    tip: tipAmount,
                driverNotes: driverNotes,
                    customerName: recipientDetails.name || 'Valued Customer',
                    customerPhone: recipientDetails.phone || userPhoneNumber,
                    deliveryAddress: document.getElementById('selectedAddressText').textContent || 'Not set',
                    restaurant: document.getElementById('resScreenName').textContent || 'Restaurant',
                    timestamp: new Date().toLocaleString(),
                    scheduledTime: scheduledTime,
                    rider: null,
                    estimatedTime: '15-20 mins',
                    distance: '2.5 km',
                    userLat: 24.47, // Default user latitude
                    userLng: 54.40, // Default user longitude
                    restaurantLat: 24.46, // Default restaurant latitude
                    restaurantLng: 54.38 // Default restaurant longitude
                };
                window.lastTrackedOrderId = orderId; // Track this order ID

                // Add to global orders array
                if (!window.allOrders) window.allOrders = [];
                window.allOrders.push(newOrder);
                
                // Add to User Profile Orders
                if (!Array.isArray(currentUser.orders)) currentUser.orders = [];
                currentUser.orders.unshift(newOrder);
                saveUserProfile();

                // Firebase Save
                if(db) {
                    db.collection("orders").doc(newOrder.id).set(newOrder)
                    .then(() => console.log("Order saved to Firebase"))
                    .catch(e => console.error("Order save error", e));
                }

                // Celebration and order acknowledgment
                showToast("🎉 Congratulations! Your order has been placed successfully!");
                triggerConfetti();

                // Immediately set pending status and notify admin
                
                // Add notification to system
                notifications.unshift({
                    type: 'order',
                    title: 'New Order Placed',
                    body: `Order ${newOrder.id} has been placed successfully.`,
                    time: 'Just now',
                    unread: true,
                    role: 'user'
                });
                updateBellDots();
                 saveNotifications();
                
                // Notify Admin
                notifications.unshift({ type: 'order', title: 'New Order', body: `Order ${newOrder.id} received.`, time: 'Just now', unread: true, role: 'admin' });

                syncOrders(); // Save to storage
                if (!scheduledTime) {
                    updateOrderStatus(newOrder.id, 'pending', 'Order received from user and pending confirmation', '#FFBF42');
                }
                window.latestAdminMessage = `Order ${newOrder.id} received from user.`;
                updateAdminDashboard();
                if (document.getElementById('adminScreen').classList.contains('active')) {
                    showToast('Admin: ' + window.latestAdminMessage);
                }

                // Show Active Order Widget
                document.getElementById('activeOrderWidget').classList.add('visible');

                // Navigate to tracking screen immediately
                openTrackOrder(newOrder);

                // Clear cart and close screens
                cart = [];
                saveCart();
                document.getElementById('checkoutActionScreen').classList.remove('active');
                setTimeout(() => {
                    cartScreen.classList.remove('active');
                    clearInterval(suggestedScrollInterval);
                }, 300);
            }
        }
    });
}

const allergyScreen = document.getElementById('allergyScreen');
const allergyBackBtn = document.getElementById('allergyBackBtn');
const saveAllergyBtn = document.getElementById('saveAllergyBtn');
const allergyInput = document.getElementById('allergyInput');

function updateOrderStatus(orderId, status, statusText, statusColor = '#019E81') {
    if (!window.allOrders) return;

    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        order.status = status;
        order.statusText = statusText;
        order.statusColor = statusColor;

        logActivity('Order Status Update', `Order ${orderId} changed to ${status}`, 'System');
        // Notify Riders if order is ready/assigned
        if ((status === 'rider_assigned' || status === 'ready') && document.getElementById('riderScreen').classList.contains('active')) {
            playNotificationSound();
            showToast(`🔔 New Order Update: ${statusText}`);
        }
        
        if (status === 'confirmed') {
            if (!document.getElementById('adminScreen').classList.contains('active')) {
                playNotificationSound();
            }
            notifications.unshift({
                type: 'order',
                title: 'Order Confirmed',
                body: `Your order ${orderId} has been confirmed.`,
                time: 'Just now',
                unread: true,
                role: 'user'
            });
            saveNotifications();
            updateBellDots();
        }

        // Update all relevant screens
        updateTrackOrderScreen(order);
        updateAdminOrderStatus(order.id, status);
        
        // Update vendor orders sync without recursion
        if (typeof vendorOrders !== 'undefined') {
            const vOrder = vendorOrders.find(v => v.id === orderId);
            if (vOrder) { 
                vOrder.status = status; 
                syncVendorOrders();
                // Refresh Vendor UI if active
                if(document.getElementById('shopPortalScreen') && document.getElementById('shopPortalScreen').classList.contains('active')) {
                    const activeTab = document.querySelector('.vendor-tab.active');
                    if(activeTab && typeof renderVendorOrders === 'function') renderVendorOrders(activeTab.dataset.tab);
                    if(typeof updateVendorTabsCounts === 'function') updateVendorTabsCounts();
                }
            }
        }

        // Show notification to user
        syncOrders(); // Persist changes
        
        // Firebase Sync
        if(db) {
            db.collection("orders").doc(orderId).update({ status: status, statusText: statusText, statusColor: statusColor })
            .catch(e => console.error("Firebase update failed", e));
        }
        
        showToast(statusText);
        updateRiderPendingBadge();
    }
}

function updateTrackOrderScreen(order) {
    const trackScreen = document.getElementById('trackOrderScreen');
    if (!trackScreen || !trackScreen.classList.contains('active')) return;

    // Update status text
    const statusTextEl = trackScreen.querySelector('.track-status-text');
    if (statusTextEl) statusTextEl.textContent = order.statusText;

    // Update progress bar based on status
    const progressFill = trackScreen.querySelector('.track-progress-fill');
    const steps = trackScreen.querySelectorAll('.track-step');

    if (progressFill && steps) {
        let progress = 0;
        let activeStep = 0;

        switch(order.status) {
            case 'pending':
                progress = 25;
                activeStep = 0;
                break;
            case 'confirmed':
                progress = 25;
                activeStep = 0;
                break;
            case 'preparing':
                progress = 50;
                activeStep = 1;
                break;
            case 'ready':
                progress = 50;
                activeStep = 1;
                break;
            case 'rider_assigned':
                progress = 75;
                activeStep = 2;
                break;
            case 'rider_accepted':
                progress = 75;
                activeStep = 2;
                break;
            case 'picked':
                progress = 75;
                activeStep = 2;
                break;
            case 'rider_delivering': // Fallback support
                progress = 90;
                activeStep = 3;
                break;
            case 'delivered':
                progress = 100;
                activeStep = 4;
                break;
        }

        progressFill.style.width = progress + '%';

        // Update step states
        steps.forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index < activeStep) {
                step.classList.add('completed');
            } else if (index === activeStep) {
                step.classList.add('active');
            }
        });
        
        // Show Rating UI if Delivered
        if (order.status === 'delivered') {
            const bottomSheet = trackScreen.querySelector('.track-bottom-sheet');
            if (bottomSheet && !document.getElementById('ratingContainer')) {
                // Clear existing content to show rating focus
                bottomSheet.innerHTML = `
                    <div id="ratingContainer" style="text-align:center; padding: 20px 0;">
                        <div style="font-size:3em;">🎉</div>
                        <h3 style="margin:10px 0; color:#333;">Order Delivered!</h3>
                        <p style="color:#666; margin-bottom:20px;">How was your experience with ${order.rider || 'the rider'}?</p>
                        
                        <div class="star-rating">
                            <span onclick="setRating(1)">★</span><span onclick="setRating(2)">★</span><span onclick="setRating(3)">★</span><span onclick="setRating(4)">★</span><span onclick="setRating(5)">★</span>
                        </div>
                        
                        <textarea id="ratingComment" placeholder="Add a comment (optional)" style="width:100%; padding:12px; border:1px solid #ddd; border-radius:12px; margin-bottom:15px; font-family:inherit;"></textarea>
                        
                        <button onclick="submitRating('${order.id}')" style="width:100%; padding:15px; background:#019E81; color:#fff; border:none; border-radius:12px; font-weight:bold; font-size:1.1em; cursor:pointer;">Submit Review</button>
                        <button onclick="document.getElementById('trackOrderScreen').classList.remove('active')" style="margin-top:10px; background:none; border:none; color:#666; cursor:pointer;">Skip</button>
                    </div>
                `;
            }
        }
    }

    // Update ETA and distance
    const etaEl = trackScreen.querySelector('.track-time-big');
    const etaLabel = trackScreen.querySelector('.track-eta-label');

    if (etaEl && etaLabel) {
        if ((order.status === 'rider_delivering' || order.status === 'picked') && order.estimatedTime) {
            etaEl.innerHTML = order.estimatedTime + ' <span style="font-size:0.4em; vertical-align:middle; color:#888;">MINS</span>';
            etaLabel.textContent = 'Estimated Delivery';
        } else if (order.status === 'rider_accepted') {
            etaEl.innerHTML = '5-8 <span style="font-size:0.4em; vertical-align:middle; color:#888;">MINS</span>';
            etaLabel.textContent = 'Rider arriving at restaurant';
        } else {
            etaEl.innerHTML = '15-20 <span style="font-size:0.4em; vertical-align:middle; color:#888;">MINS</span>';
            etaLabel.textContent = 'Estimated Arrival';
        }
    }
}

let currentRating = 0;
function setRating(n) {
    currentRating = n;
    const stars = document.querySelectorAll('.star-rating span');
    stars.forEach((s, i) => {
        if (i < n) s.classList.add('active');
        else s.classList.remove('active');
    });
}

async function submitRating(orderId) {
    if (currentRating === 0) {
        showToast('Please select a star rating');
        return;
    }
    const comment = document.getElementById('ratingComment').value.trim();
    const order = window.allOrders.find(o => o.id === orderId);
    
    if (order) {
        order.rating = currentRating;
        order.ratingComment = comment;

        if (db) {
            try {
                // 1. Update Order in Firestore
                await db.collection('orders').doc(orderId).update({
                    rating: currentRating,
                    ratingComment: comment
                });

                // 2. Store Review in Firestore
                await db.collection('reviews').add({
                    orderId,
                    restaurant: order.restaurant,
                    customer: order.customerName || currentUser.username || currentUser.name,
                    rating: currentRating,
                    comment: comment,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 3. Update Restaurant Average Rating
                const resSnap = await db.collection('restaurants').where('name', '==', order.restaurant).limit(1).get();
                if (!resSnap.empty) {
                    const resDoc = resSnap.docs[0];
                    const resData = resDoc.data();
                    const oldCount = resData.totalRatings || 0;
                    const oldRating = resData.rating || 0;
                    const newCount = oldCount + 1;
                    const newRating = ((oldRating * oldCount) + currentRating) / newCount;
                    
                    await resDoc.ref.update({
                        rating: Number(newRating.toFixed(1)),
                        totalRatings: newCount
                    });
                }
            } catch (e) { console.error("Error saving rating:", e); }
        }

        syncOrders(); 
        showToast('Thank you for your feedback!');
        document.getElementById('trackOrderScreen').classList.remove('active');
        logActivity('Rating Submitted', `Order ${orderId} rated ${currentRating} stars`, 'User');
    }
}

function updateRecipientDisplay() {
    const section = document.getElementById('checkoutRecipientSection');
    if (!section) return;

    if (recipientDetails.name) {
        section.innerHTML = `
            <span class="address-icon">🎁</span>
            <div>
                <h4>Sending to: ${recipientDetails.name}</h4>
                <p>Courier will contact ${recipientDetails.phone}. Tap to edit.</p>
            </div>
        `;
    } else {
        section.innerHTML = `
            <span class="address-icon">🎁</span>
            <div>
                <h4>Sending to someone else?</h4>
                <p>Add their details to help the courier</p>
            </div>
        `;
    }
}

function updateUserPhoneDisplay() {
    const section = document.getElementById('checkoutUserPhoneSection');
    if (!section) return;

    if (userPhoneNumber) {
        section.innerHTML = `
            <span class="address-icon">📱</span>
            <div>
                <h4>Your Phone Number</h4>
                <p>${userPhoneNumber}. Tap to edit.</p>
            </div>
        `;
    } else {
        section.innerHTML = `
            <span class="address-icon">📱</span>
            <div>
                <h4>Add Your Phone Number</h4>
                <p>We will send you massage to validate it</p>
            </div>
        `;
    }
}

const recipientScreen = document.getElementById('recipientScreen');
const recipientCloseBtn = document.getElementById('recipientCloseBtn');
const saveRecipientBtn = document.getElementById('saveRecipientBtn');

if (recipientCloseBtn) {
    recipientCloseBtn.addEventListener('click', () => {
        recipientScreen.classList.remove('active');
    });
}

if (saveRecipientBtn) {
    saveRecipientBtn.addEventListener('click', () => {
        const name = document.getElementById('recipientName').value.trim();
        const prefix = document.getElementById('phonePrefix').value.trim();
        const number = document.getElementById('phoneNumber').value.trim();

        // SECURITY: Validate format
        const phoneRegex = /^[0-9\s-]{7,12}$/;
        if (name.length < 3) { showToast("Please enter a valid name"); return; }
        if (!phoneRegex.test(number)) { showToast("Please enter a valid phone number"); return; }

        if (name && number) {
            recipientDetails.name = name;
            recipientDetails.phone = `${prefix} ${number}`;
            showToast("Recipient details saved!");
            updateRecipientDisplay();
            recipientScreen.classList.remove('active');
            saveUserSettings();
        } else {
            showToast("Please fill in all fields.");
        }
    });
}

const userPhoneScreen = document.getElementById('userPhoneScreen');
const userPhoneCloseBtn = document.getElementById('userPhoneCloseBtn');
const saveUserPhoneBtn = document.getElementById('saveUserPhoneBtn');

if (userPhoneCloseBtn) {
    userPhoneCloseBtn.addEventListener('click', () => {
        userPhoneScreen.classList.remove('active');
    });
}

if (saveUserPhoneBtn) {
    saveUserPhoneBtn.addEventListener('click', () => {
        const prefix = document.getElementById('userPhonePrefix').value.trim();
        const number = document.getElementById('userPhoneNumberInput').value.trim();

        // SECURITY: Validate format
        const phoneRegex = /^[0-9\s-]{7,12}$/;
        if (!phoneRegex.test(number)) { showToast("Please enter a valid phone number"); return; }

        if (number) {
            userPhoneNumber = `${prefix} ${number}`;
            showToast("Phone number saved!");
            updateUserPhoneDisplay();
            userPhoneScreen.classList.remove('active');
            saveUserSettings();
        } else {
            showToast("Please enter a phone number.");
        }
    });
}

if (allergyBackBtn) {
    allergyBackBtn.addEventListener('click', () => {
        allergyScreen.classList.remove('active');
    });
}

if (saveAllergyBtn) {
    saveAllergyBtn.addEventListener('click', () => {
        allergyNotes = allergyInput.value;
        if(allergyNotes) {
            showToast("Allergy information saved!");
        }
        allergyScreen.classList.remove('active');
        updateAllergyDisplay();
        saveUserSettings();
    });
}

function updateAllergyDisplay() {
    const display = document.getElementById('allergyNotesDisplay');
    if (display) {
        if (allergyNotes && allergyNotes.trim() !== '') {
            display.textContent = allergyNotes;
            display.style.display = 'block';
        } else {
            display.style.display = 'none';
        }
    }
}

const checkoutBackBtn = document.getElementById('checkoutBackBtn');
if (checkoutBackBtn) {
    checkoutBackBtn.addEventListener('click', () => {
        document.getElementById('checkoutActionScreen').classList.remove('active');
    });
}

const paymentOverlay = document.getElementById('paymentOverlay');
const paymentSheet = document.getElementById('paymentSheet');

function closePaymentSheet() {
    if(paymentOverlay) paymentOverlay.classList.remove('show');
    if(paymentSheet) paymentSheet.classList.remove('show');
}

if (paymentOverlay) {
    paymentOverlay.addEventListener('click', closePaymentSheet);
}

if (paymentSheet) {
    paymentSheet.addEventListener('change', (e) => {
        if (e.target.name === 'paymentMethod') {
            const radio = e.target;
            selectedPaymentMethod = {
                value: radio.value,
                icon: radio.dataset.icon,
                text: radio.dataset.text
            };
            
            const paymentSection = document.getElementById('paymentSection');
            if (paymentSection) {
                paymentSection.querySelector('.address-icon').innerHTML = selectedPaymentMethod.icon;
                const textSpan = paymentSection.querySelector('.address-details span:last-of-type');
                if (textSpan) textSpan.textContent = selectedPaymentMethod.text;

                // Handle Deposit Info display update
                let infoDiv = document.getElementById('paymentDepositInfo');
                if (!infoDiv) {
                    infoDiv = document.createElement('div');
                    infoDiv.id = 'paymentDepositInfo';
                    infoDiv.style.cssText = 'margin-top: 15px; font-size: 0.9em; color: #555; background-color: #f9f9f9; padding: 10px; border-radius: 8px; border: 1px solid #eee;';
                    paymentSection.appendChild(infoDiv);
                }

                if (selectedPaymentMethod.value === 'mtn' || selectedPaymentMethod.value === 'airtel') {
                    infoDiv.innerHTML = `<strong>Deposit Number:</strong> +971562889428<br><small>After deposit, send screenshot proof to your registered contact number in the order details.</small>`;
                    infoDiv.style.display = 'block';
                } else {
                    infoDiv.style.display = 'none';
                }
            }
            
            setTimeout(closePaymentSheet, 200);
        }
    });
}

/* Favorites Logic */
const favoritesScreen = document.getElementById('favoritesScreen');
const favBackBtn = document.getElementById('favBackBtn');
const profileFavoritesBtn = document.getElementById('profileFavoritesBtn');

function toggleFavorite(resName, btnElement) {
    if (favorites.has(resName)) {
        favorites.delete(resName);
        btnElement.textContent = '♡';
        btnElement.classList.remove('liked');
        showToast('Removed from favorites');
    } else {
        favorites.add(resName);
        btnElement.textContent = '♥';
        btnElement.classList.add('liked');
        showToast('Added to favorites');
    }
    saveUserProfile(); // Persist changes
    // If on favorites screen, refresh list
    if (favoritesScreen.classList.contains('active')) {
        renderFavorites();
    }
}

function renderFavorites() {
    const container = document.getElementById('favoritesContent');
    container.innerHTML = '';
    if (favorites.size === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">No favorites added yet. <br>Tap the ♡ on restaurants to save them!</div>';
        return;
    }
    // In a real app, you would fetch full objects. Here we find matches from the existing list logic or recreate basic cards.
    // For visual consistency, we will clone valid cards from the main list if possible, or recreate dummy cards for the demo.
    // Since cards are dummy generated:
    favorites.forEach((resName) => {
        const card = document.createElement('div');
        card.className = 'res-card animate-entry';
        card.innerHTML = `
          <div class="res-image">
            🍽️
            <button class="heart-btn liked">♥</button>
          </div>
          <div class="res-name">${resName}</div>
          <div class="pref-info">
            <span class="pref-stat"><span>👍</span>(New)</span>
            <span class="pref-stat"><span style="display:inline-block; transform:scaleX(-1);">🚴‍♂️</span>Free</span>
            <span class="pref-stat">20-30 Mins</span>
          </div>
        `;
        card.querySelector('.heart-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(resName, e.target);
        });
        card.addEventListener('click', () => openRestaurant(resName, window.currentCategoryConfig?.menu));
        container.appendChild(card);
    });
}

if(profileFavoritesBtn) {
    profileFavoritesBtn.addEventListener('click', () => {
        renderFavorites();
        favoritesScreen.classList.add('active');
        // Close profile overlay/menu if open, to show favorites cleanly? 
        // Profile is a slide-in, favorites is a generic-screen (slide-in). It stacks on top nicely.
    });
}
if(favBackBtn) {
    favBackBtn.addEventListener('click', () => {
        favoritesScreen.classList.remove('active');
    });
}

/* Active Order Widget & Track Screen */
const activeOrderWidget = document.getElementById('activeOrderWidget');
if (activeOrderWidget) {
    activeOrderWidget.addEventListener('click', () => openTrackOrder());
}
const trackBackBtn = document.getElementById('trackBackBtn');
if (trackBackBtn) {
    trackBackBtn.addEventListener('click', () => {
        document.getElementById('trackOrderScreen').classList.remove('active');
        if (currentOrderUnsub) {
            currentOrderUnsub();
            currentOrderUnsub = null;
        }
    });
}

function openTrackOrder(order = null) {
    document.getElementById('trackOrderScreen').classList.add('active');

    // Clear previous listener to avoid duplicate data streams
    if (currentOrderUnsub) {
        currentOrderUnsub();
        currentOrderUnsub = null;
    }

    setTimeout(() => {
        initTrackMap();
        
        const orderId = order ? order.id : window.lastTrackedOrderId;
        
        if (orderId) {
            // Subscribe to real-time changes using the new listenToOrder function
            currentOrderUnsub = window.listenToOrder(orderId, (updatedOrder) => {
                updateTrackOrderScreen(updatedOrder);
                
                // If a rider is assigned and active, ensure the animation is running
                if (['rider_assigned', 'rider_picking', 'rider_delivering'].includes(updatedOrder.status)) {
                    startDeliveryAnimation(updatedOrder.id, updatedOrder.restaurantLat, updatedOrder.restaurantLng, updatedOrder.userLat, updatedOrder.userLng, 'delivery');
                }
            });

            if (order) updateTrackOrderScreen(order);
            
            // Cancel Order Button Logic
            const trackBottomSheet = document.querySelector('.track-bottom-sheet');
            const existingCancel = document.getElementById('cancelOrderTimerBtn');
            if(existingCancel) existingCancel.remove();

            if(order.status === 'pending') {
                const cancelBtn = document.createElement('button');
                cancelBtn.id = 'cancelOrderTimerBtn';
                cancelBtn.textContent = 'Cancel Order (30s)';
                cancelBtn.style.cssText = 'width:100%; padding:12px; margin-bottom:15px; background:#fff; color:#ff4757; border:1px solid #ff4757; border-radius:12px; font-weight:bold; cursor:pointer; font-size:0.95em;';
                
                const actionsDiv = trackBottomSheet.querySelector('.track-actions');
                trackBottomSheet.insertBefore(cancelBtn, actionsDiv);

                let timeLeft = 30;
                const cancelTimer = setInterval(() => {
                    timeLeft--;
                    cancelBtn.textContent = `Cancel Order (${timeLeft}s)`;
                    if(timeLeft <= 0) {
                        clearInterval(cancelTimer);
                        if(cancelBtn.parentNode) cancelBtn.remove();
                    }
                }, 1000);

                cancelBtn.onclick = () => {
                    clearInterval(cancelTimer);
                    cancelOrder(order.id);
                };
            }
        }
    }, 300);
}

async function initTrackMap() {
    if(!document.getElementById('trackMap')) return;
    if(trackMap) return;

    try { await loadLeaflet(); } catch(e) { return; }
    if(trackMap) return;

    trackMap = window.L.map('trackMap', { zoomControl: false }).setView([24.465, 54.39], 13);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(trackMap);

    // Sample locations
    const shopLoc = [24.46, 54.38];
    const userLoc = [24.47, 54.40];

    // Markers
    const shopIcon = window.L.divIcon({ html: '🍔', className: 'delivery-pin-icon', iconSize: [30,30], iconAnchor: [15,15] });
    const userIcon = window.L.divIcon({ html: '🏠', className: 'delivery-pin-icon', iconSize: [30,30], iconAnchor: [15,15] });
    
    window.L.marker(shopLoc, {icon: shopIcon}).addTo(trackMap);
    window.L.marker(userLoc, {icon: userIcon}).addTo(trackMap);

    // Rider Marker
    const riderIcon = window.L.divIcon({
        html: `<div style="position:relative; width:100%; height:100%;">
            <div class="rider-pulse-ring"></div>
            <div id="trackRiderIcon" style="
            font-size: 36px; 
            display: flex; 
            align-items: flex-end; 
            justify-content: center;
            transition: transform 0.15s linear;
            width: 100%; height: 100%;
            transform-origin: center bottom;
        ">🚴</div></div>`, 
        className: '', 
        iconSize: [60, 60], 
        iconAnchor: [30, 60] 
    });
    trackRiderMarker = window.L.marker(shopLoc, {icon: riderIcon}).addTo(trackMap);
    const routeCoords = [
        [24.46, 54.38], [24.462, 54.385], [24.465, 54.387], [24.468, 54.386],
        [24.47, 54.39], [24.472, 54.395], [24.47, 54.40]
    ];
    
    // Add path line
    window.L.polyline(routeCoords, { color: '#e0e0e0', weight: 6 }).addTo(trackMap); // Background line
    window.L.polyline([], { color: '#019E81', weight: 6 }).addTo(trackMap); // Active progress line placeholder if needed

    trackMap.fitBounds(window.L.polyline(routeCoords).getBounds(), { padding: [50, 50] });

    // Calculate distances for smooth animation
    let totalDist = 0;
    const segmentDists = [];
    for(let i=0; i<routeCoords.length-1; i++) {
        const p1 = window.L.latLng(routeCoords[i]);
        const p2 = window.L.latLng(routeCoords[i+1]);
        const d = p1.distanceTo(p2);
        segmentDists.push(d);
        totalDist += d;
    }

    let startTime = null;
    const duration = 12000; // 12 seconds loop
    
    function animateTrackRider(timestamp) {
        if(!document.getElementById('trackOrderScreen').classList.contains('active')) return;
        
        if (!startTime) startTime = timestamp;
        const elapsed = timestamp - startTime;
        const progress = (elapsed % duration) / duration;
        
        const currentDist = progress * totalDist;
        
        // Find segment
        let distSum = 0;
        let currentPos = L.latLng(routeCoords[0]);
        
        for(let i=0; i<segmentDists.length; i++) {
            if(currentDist <= distSum + segmentDists[i]) {
                // We are in this segment
                const segmentProgress = (currentDist - distSum) / segmentDists[i];
                const p1 = routeCoords[i];
                const p2 = routeCoords[i+1];
                const lat = p1[0] + (p2[0] - p1[0]) * segmentProgress;
                const lng = p1[1] + (p2[1] - p1[1]) * segmentProgress;
                currentPos = [lat, lng];

                const b = getBearing(window.L.latLng(p1), window.L.latLng(p2));
                const icon = document.getElementById('trackRiderIcon');
                if (icon) {
                    // Keep upright, flip for direction (Emoji faces Left by default)
                    if (b > 0 && b < 180) icon.style.transform = `scaleX(-1)`; // Face Right (East)
                    else icon.style.transform = `scaleX(1)`; // Face Left (West)
                }
                break;
            }
            distSum += segmentDists[i];
        }
        
        trackRiderMarker.setLatLng(currentPos);
        
        trackRouteAnimationFrame = requestAnimationFrame(animateTrackRider);
    }
    // trackRouteAnimationFrame = requestAnimationFrame(animateTrackRider); // Disabled to let startDeliveryAnimation control it
}

/* Chat Screen Logic */
const chatScreen = document.getElementById('chatScreen');
const chatBackBtn = document.getElementById('chatBackBtn');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatMessages = document.getElementById('chatMessages');
const trackMsgBtn = document.getElementById('trackMsgBtn');

if(trackMsgBtn) trackMsgBtn.addEventListener('click', () => openChat());
if(chatBackBtn) chatBackBtn.addEventListener('click', () => chatScreen.classList.remove('active'));
if (trackBackBtn) {
    trackBackBtn.addEventListener('click', () => {
        if(trackRouteAnimationFrame) cancelAnimationFrame(trackRouteAnimationFrame);
        if (currentOrderUnsub) { currentOrderUnsub(); currentOrderUnsub = null; }
    });
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if(!text || !db) return;

    const chatScreen = document.getElementById('chatScreen');
    let chatId;

    if (chatScreen.dataset.context === 'support_ticket') {
        chatId = chatScreen.dataset.ticketId;
        // Maintain legacy UI behavior for support
        const ticket = adminSupportTickets.find(t => t.id === chatId);
        if(ticket) { ticket.lastUpdate = 'Just now'; ticket.status = 'in_progress'; }
    } else {
        chatId = window.lastTrackedOrderId || (window.allOrders && window.allOrders.length > 0 ? window.allOrders[window.allOrders.length - 1].id : null);
    }

    if(!chatId) return;

    try {
        await db.collection('chats').doc(chatId).collection('messages').add({
            senderId: window.currentUser.id || 'guest',
            senderRole: getCurrentRole(),
            text: text,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        chatInput.value = '';
    } catch(e) {
        console.error("Chat send error:", e);
        showToast("Failed to send message");
    }
}

function addMessage(type, text, time) {
    const div = document.createElement('div');
    div.className = `message-bubble ${type}`;
    div.innerHTML = `${text}<div class="message-time">${time || ''}</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

if(chatSendBtn) chatSendBtn.addEventListener('click', sendMessage);
if(chatInput) chatInput.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') sendMessage();
});

/* Profile Screen Logic */
const profileScreen = document.getElementById('profileScreen');
const profileBackBtn = document.getElementById('profileBackBtn');

function closeProfile() {
    profileScreen.classList.remove('active');
}

function openProfile() {
    const nameDisplay = document.getElementById('profileNameDisplay');
    const phoneDisplay = document.getElementById('profilePhoneDisplay');
    const walletStat = document.querySelector('#profileScreen .stat-item:nth-child(2) .stat-value');
    const pointsStat = document.querySelector('#profileScreen .stat-item:nth-child(3) .stat-value');
    
    nameDisplay.textContent = recipientDetails.name || 'Guest User';
    phoneDisplay.textContent = userPhoneNumber || recipientDetails.phone || 'No phone set';
    if(pointsStat) pointsStat.textContent = (userPoints || 0).toLocaleString();
    if(walletStat) walletStat.textContent = `UGX ${userWalletBalance.toLocaleString()}`;
    
    profileScreen.classList.add('active');
}

function openRider() {
    // Clear other portal screens to prevent overlap
    document.getElementById('adminScreen').classList.remove('active');
    document.getElementById('shopPortalScreen').classList.remove('active');
    document.getElementById('home').style.display = 'none';
    document.getElementById('riderScreen').classList.add('active');
    updateRiderNearbyOrders();
    renderRiderHistory();
    updateRiderPendingBadge();
    initRiderMap();
    
    // Show GPS enable button if not already enabled
    if (!riderGpsEnabled) {
        document.getElementById('enableGPSBtn').style.display = 'inline-block';
        document.getElementById('gpsStatusIndicator').style.display = 'none';
    } else {
        document.getElementById('enableGPSBtn').style.display = 'none';
        document.getElementById('gpsStatusIndicator').style.display = 'block';
    }
    
    // Request GPS permission and show notification
    requestRiderGPSAccess();
}

function openAdmin() {
    // Clear other portal screens to prevent overlap
    document.getElementById('riderScreen').classList.remove('active');
    document.getElementById('shopPortalScreen').classList.remove('active');
    document.getElementById('home').style.display = 'none';
    document.getElementById('adminScreen').classList.add('active');
    // Initialize admin dashboard
    closeAdminSidebar();
    renderAdminTabContent(getCurrentAdminTab());
    setTimeout(() => {
        switchAdminTab('dashboard');
    }, 100);
}

function openShopPortal() {
    // Clear other portal screens to prevent overlap
    document.getElementById('riderScreen').classList.remove('active');
    document.getElementById('adminScreen').classList.remove('active');
    document.getElementById('home').style.display = 'none';
    document.getElementById('shopPortalScreen').classList.add('active');
    renderVendorOrders('new');
    updateVendorTabsCounts();
    initMerchantCharts();
    setTimeout(initMerchantCharts, 300);
}

// Enhanced Chat Context Logic
function openChat(role = 'user') {
    const chatScreen = document.getElementById('chatScreen');
    const chatTitle = chatScreen.querySelector('.chat-title');
    const callBtn = chatScreen.querySelector('.chat-call-btn');
    
    // Clear specific context
    delete chatScreen.dataset.context;

    // Configure UI based on Role
    if (role === 'rider') {
        // Rider view: Talking to Customer
        const orderId = currentRiderOrderId || window.lastTrackedOrderId;
        const order = window.allOrders.find(o => o.id === orderId);
        chatTitle.innerHTML = `
            <div style="font-weight:800; color:#333;">${order ? order.customerName : 'Customer'}</div>
            <div style="font-size:0.8em; color:#019E81;">Order ${order ? order.id : ''}</div>
        `;
    } else {
        // User view: Talking to Rider
        chatTitle.innerHTML = `
            <div style="font-weight:800; color:#333;">Rider</div>
            <div style="font-size:0.8em; color:#019E81;">On the way</div>
        `;
    }
    
    chatScreen.classList.add('active');
    const chatId = currentRiderOrderId || window.lastTrackedOrderId || (window.allOrders && window.allOrders.length > 0 ? window.allOrders[window.allOrders.length - 1].id : null);
    if (chatId && window.setupChatListener) window.setupChatListener(chatId);
    // Override generic back button for chat to just close it
    const backBtn = chatScreen.querySelector('.chat-back-btn');
    backBtn.onclick = () => chatScreen.classList.remove('active');
}

/* Vendor Order Management Logic */
let vendorOrders = [
    { id: '#9901', time: 'Just now', items: ['2x Cheese Burger', '1x Cola'], total: '30.00', status: 'new' },
    { id: '#9902', time: '5 mins ago', items: ['1x Family Pizza'], total: '45.00', status: 'new' },
    { id: '#9899', time: '15 mins ago', items: ['3x Spicy Wings'], total: '25.00', status: 'processing' }
];
try {
    const savedVendorOrders = localStorage.getItem('kirya_vendor_orders');
    if(savedVendorOrders) vendorOrders = JSON.parse(savedVendorOrders);
    else localStorage.setItem('kirya_vendor_orders', JSON.stringify(vendorOrders));
} catch(e){}

function syncVendorOrders() {
    localStorage.setItem('kirya_vendor_orders', JSON.stringify(vendorOrders));
}

window.switchVendorTab = function(tabName) {
    document.querySelectorAll('.vendor-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.vendor-tab[data-tab="${tabName}"]`).classList.add('active');
    renderVendorOrders(tabName);
}

function renderVendorOrders(tab) {
    const container = document.getElementById('vendorOrdersContainer');
    if(!container) return;
    container.innerHTML = '';
    
    const filtered = vendorOrders.filter(o => o.status === tab);
    
    if(filtered.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px 10px; color:#999; font-style:italic;">No orders in ${tab}</div>`;
        return;
    }

    filtered.forEach(order => {
        const div = document.createElement('div');
        div.className = 'vendor-order-card';
        
        let buttonsHtml = '';
        if(tab === 'new') {
            buttonsHtml = `
                <div class="vendor-btn-row">
                    <button class="vendor-btn" style="background:#fee; color:#ff4757;" onclick="updateVendorOrderStatus('${order.id}', 'rejected')">Reject</button>
                    <button class="vendor-btn" style="background:#019E81; color:#fff;" onclick="updateVendorOrderStatus('${order.id}', 'processing')">Accept</button>
                </div>
            `;
        } else if(tab === 'processing') {
            buttonsHtml = `
                <button class="vendor-btn" style="width:100%; background:#FFBF42; color:#333;" onclick="updateVendorOrderStatus('${order.id}', 'ready')">Mark Ready</button>
            `;
        } else if(tab === 'ready') {
            buttonsHtml = `<div style="text-align:center; color:#019E81; font-weight:bold; padding:10px; background:#e0f2f1; border-radius:8px;">Waiting for Rider</div>`;
        }

        div.innerHTML = `
            <div class="vendor-order-header">
                <span class="vendor-order-id">${order.id}</span>
                <span class="vendor-order-time">${order.time}</span>
            </div>
            <div class="vendor-order-items">
                ${order.items.map(i => `<div>• ${i}</div>`).join('')}
                <div style="margin-top:10px; font-weight:800; color:#333; padding-top:8px; border-top:1px solid #f5f5f5;">Total: UGX ${order.total}</div>
            </div>
            ${buttonsHtml}
        `;
        container.appendChild(div);
    });
}

window.updateVendorOrderStatus = function(id, status) {
    if(status === 'rejected') {
        if(confirm('Reject this order?')) {
            const vOrder = vendorOrders.find(o => o.id === id);
            if(vOrder) {
                vendorOrders = vendorOrders.filter(o => o.id !== id);
                showToast(`Order ${id} rejected`);
                updateOrderStatus(id, 'cancelled', 'Order rejected by restaurant', '#ff4757');
            }
        } else return;
    } else {
        const order = vendorOrders.find(o => o.id === id);
        if(order) {
            order.status = status;
            showToast(`Order ${id} moved to ${status}`);
            
            let statusText = 'Order status updated';
            if(status === 'processing') statusText = 'Restaurant is preparing your order';
            else if(status === 'ready') statusText = 'Order ready for pickup';
            
            updateOrderStatus(id, status, statusText);
        }
    }
    syncVendorOrders();
    
    // Refresh current tab and counts
    const activeTab = document.querySelector('.vendor-tab.active');
    if(activeTab) renderVendorOrders(activeTab.dataset.tab);
    updateVendorTabsCounts();
}

function updateAdminDashboard() {
    // Update admin stats and order list
    const adminContent = document.getElementById('admin-dashboard');
    if (adminContent) {
        const pendingOrders = window.allOrders ? window.allOrders.filter(o => o.status === 'pending').length : 0;
        // Fix: readyCount based on 'ready' status
        const readyOrders = window.allOrders ? window.allOrders.filter(o => o.status === 'ready').length : 0;
        const activeOrders = window.allOrders ? window.allOrders.filter(o => ['rider_assigned', 'rider_picking', 'rider_delivering'].includes(o.status)).length : 0;

        const adminAlertMessage = window.latestAdminMessage ? `<div class="dashboard-card" style="background:#e0f7fa; border:1px solid #4dd0e1; margin-bottom: 15px;">
                <strong style="color:#00796b;">Admin Notice:</strong> ${window.latestAdminMessage}
            </div>` : '';

        adminContent.innerHTML = `${adminAlertMessage}
            <div class="dashboard-card">
                <h3>Platform Stats</h3>
                <div style="display:flex; justify-content:space-between; margin-top:10px;">
                    <div>Pending Orders</div>
                    <div style="font-weight:bold; color:#FFBF42;">${pendingOrders}</div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px;">
                    <div>Ready for Pickup</div>
                    <div style="font-weight:bold; color:#019E81;">${readyOrders}</div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px;">
                    <div>Active Deliveries</div>
                    <div style="font-weight:bold; color:#019E81;">${activeOrders}</div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px;">
                    <div>Online Riders</div>
                    <div style="font-weight:bold;">${isRiderOnline ? 1 : 0}</div>
                </div>
            </div>

            <div class="dashboard-card">
                <h3>Order Management</h3>
                <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Order ID</th>
                            <th>Restaurant & Customer</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                    ${window.allOrders ? window.allOrders.filter(o => ['pending', 'ready', 'rider_assigned', 'rider_picking', 'rider_delivering'].includes(o.status)).slice(-5).reverse().map(order => `
                        <tr>
                            <td><strong>${order.id}</strong><br><span style="font-size:0.8em; color:#666;">${order.timestamp}</span></td>
                            <td>${order.restaurant}<br><span style="font-size:0.8em;">${order.customerName}</span></td>
                            <td><span style="color:${order.statusColor}; font-weight:bold;">${order.status.replace('_', ' ').toUpperCase()}</span></td>
                            <td>
                                ${order.status === 'pending' ? `<button onclick="adminSubmitOrderToVendor('${order.id}')" style="background:#FFBF42; color:#333; border:none; padding:4px 8px; border-radius:6px; font-size:0.8em; cursor:pointer;">Vendor</button>` : ''}
                                ${order.status === 'ready' ? `<button onclick="openAssignRiderModal('${order.id}')" style="background:#019E81; color:#fff; border:none; padding:4px 8px; border-radius:6px; font-size:0.8em; cursor:pointer;">Assign</button>` : ''}
                            </td>
                        </tr>
                    `).join('') : '<tr><td colspan="4" style="text-align:center; padding:20px;">No active orders</td></tr>'}
                    </tbody>
                </table>
                </div>
            </div>
        `;
    }
}

// Admin action functions
window.adminMessageUser = async function(orderId) {
    const msg = await customPopup({ title: 'Message User', message: "Enter message for user:", type: 'prompt' });
    if(msg) {
        const order = window.allOrders.find(o => o.id === orderId);
        if(order) {
            if(!order.chat) order.chat = [];
            order.chat.push({sender:'admin', text:msg, time:new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})});
            showToast('Message sent to user');
            
            // Update chat screen if active
            if(document.getElementById('chatScreen').classList.contains('active')) {
                addMessage('received', msg);
            } else {
                // Notify user if chat is not open
                showToast(`Admin: ${msg}`);
            }
        }
    }
}

function adminSubmitOrderToVendor(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        // Fix: Pass ID and Status, not object
        updateAdminOrderStatus(order.id, 'processing');
        
        // Also update vendor side status
        if (typeof vendorOrders !== 'undefined') {
            let vOrder = vendorOrders.find(v => v.id === orderId);
            
            if (!vOrder) {
                // Create vendor order entry if missing
                vOrder = {
                    id: order.id,
                    time: order.time || 'Just now',
                    items: order.items.map(i => `${i.quantity}x ${i.title}`),
                    total: order.total.toFixed(2),
                    status: 'new' // Explicitly 'new'
                };
                vendorOrders.unshift(vOrder);
            } else {
                // If exists, ensure it is 'new' so it appears in New tab
                vOrder.status = 'new';
            }
            
            syncVendorOrders();
            
            // Broadcast update for same-window instances
            const shopPortal = document.getElementById('shopPortalScreen');
            if(shopPortal && shopPortal.classList.contains('active')) {
                const activeTab = document.querySelector('.vendor-tab.active');
                if(activeTab && activeTab.dataset.tab === 'new') {
                    renderVendorOrders('new');
                }
                updateVendorTabsCounts();
            }
        }
        
        showToast('Order submitted to vendor');
    }
}

function adminAssignRider(orderId) {
    // For testing workflow across tabs, we bypass the local rider check
    // if (!isRiderOnline) {
    //     showToast('No riders available online');
    //     return;
    // }
    
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        // First update global status
        updateOrderStatus(order.id, 'rider_assigned', 'Pending Rider Acceptance');
        
        if (isRiderOnline) {
            triggerRiderOrder(orderId);
            showToast('Request sent to online rider');
        } else {
            // Broadcast mode: Don't simulate acceptance immediately if we want real riders to pick it up.
            // But for this demo, if no "online" rider (current session) is there, we simulate remote acceptance.
            showToast('Order broadcasted to riders');
            // setTimeout(() => {
            //    riderAcceptOrder(orderId);
            // }, 3000);
        }
    }
}

function adminMarkOrderComplete(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        riderDeliverOrder(order.id); // Re-use loyalty logic
    }
}

// Rider action functions
function riderAcceptOrder(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        order.status = 'rider_accepted';
        updateAdminOrderStatus(order.id, 'rider_accepted');
        showToast('Order Accepted');
        
        // Start delivery animation to restaurant
        startDeliveryAnimation(orderId, order.restaurantLat, order.restaurantLng, order.userLat, order.userLng, 'pickup');
        
        // Simulate rider arriving at restaurant after 5 seconds
        setTimeout(() => {
            riderPickupOrder(orderId);
        }, 5000);
    }
}

function riderPickupOrder(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        order.status = 'picked';
        updateAdminOrderStatus(order.id, 'picked');
        showToast('Order on the way');
        
        // Start delivery animation to user location
        startDeliveryAnimation(orderId, order.restaurantLat, order.restaurantLng, order.userLat, order.userLng, 'delivery');
    }
}

function riderDeliverOrder(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if (order) {
        order.status = 'delivered';
        updateAdminOrderStatus(order.id, 'delivered');
        showToast('Order Complete! Points Earned 🎉');
        
        // Add Loyalty Points
        const points = Math.floor(order.total / 100);
        userPoints += points;
        saveUserProfile(); // Persist points
        pointsHistory.unshift({
            title: `Order ${orderId}`,
            date: 'Just now',
            points: points,
            type: 'earned'
        });
        showToast(`You earned ${points} loyalty points!`);
    }
}

// OSRM Routing Service Helper
async function getOSRMRoute(startLat, startLng, endLat, endLng) {
    try {
        // Fetch route from OSRM (Driving profile)
        const url = `${OSRM_SERVER_URL}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            // OSRM returns [lon, lat], Leaflet needs [lat, lon]
            return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
    } catch (error) {
        console.warn('OSRM Route fetch failed, using fallback:', error);
    }
    return null;
}

let deliveryAnimationFrame; // Global to control animation

// Delivery animation with real-time updates
async function startDeliveryAnimation(orderId, fromLat, fromLng, toLat, toLng, type) {
    if (deliveryAnimationFrame) cancelAnimationFrame(deliveryAnimationFrame);
    const order = window.allOrders.find(o => o.id === orderId);
    if (!order) return;
    
    if (!fromLat || !fromLng || !toLat || !toLng) {
        console.warn('Coordinates missing for delivery animation');
        return;
    }
    
    // 1. Get Actual Route from OSRM
    let routePoints = await getOSRMRoute(fromLat, fromLng, toLat, toLng);
    
    // 2. Fallback to straight line if OSRM fails
    if (!routePoints || routePoints.length < 2) {
        routePoints = [[fromLat, fromLng], [(fromLat+toLat)/2, (fromLng+toLng)/2], [toLat, toLng]];
    }

    // Optional: Draw path on track map if open
    if (typeof trackMap !== 'undefined' && trackMap) {
        window.L.polyline(routePoints, { color: '#019E81', weight: 5, opacity: 0.7 }).addTo(trackMap);
    }
    
    let currentPointIndex = 0;
    let progress = 0;
    // Speed: km per frame. ~0.0005 is roughly 60-80 km/h scale
    const speedPerFrame = 0.0005; 
    
    function animateDelivery() {
        if (currentPointIndex >= routePoints.length - 1) {
            if (type === 'delivery') riderDeliverOrder(orderId);
            return;
        }
        
        const p1 = routePoints[currentPointIndex];
        const p2 = routePoints[currentPointIndex + 1];
        
        // Distance of current segment in km
        const segmentDist = calculateDistance(p1, p2);
        
        // Skip very short segments to avoid jitter
        if (segmentDist < 0.00001) {
            currentPointIndex++;
            progress = 0;
            deliveryAnimationFrame = requestAnimationFrame(animateDelivery);
            return;
        }
        
        // Interpolate position
        const lat = p1[0] + (p2[0] - p1[0]) * progress;
        const lng = p1[1] + (p2[1] - p1[1]) * progress;
        
        // Update rider position on all maps
        updateRiderPositionOnAllMaps([lat, lng]);
        
        // Update Bearing for Icon (Reuse rotation logic)
        const bearing = getBearing({lat: p1[0], lng: p1[1]}, {lat: p2[0], lng: p2[1]});
        const trackIcon = document.getElementById('trackRiderIcon');
        if (trackIcon) {
            if (bearing > 0 && bearing < 180) trackIcon.style.transform = `scaleX(-1)`;
            else trackIcon.style.transform = `scaleX(1)`;
        }

        // Calculate remaining distance and time
        // For simplicity, using straight line remaining + segment remainder
        // A proper implementation would sum up remaining routePoints segments
        
        // Calculate distance
        let remainingDist = calculateDistance([lat, lng], p2);
        for(let i = currentPointIndex + 1; i < routePoints.length - 1; i++) {
            remainingDist += calculateDistance(routePoints[i], routePoints[i+1]);
        }
        const remainingTime = Math.ceil(remainingDist * 3); // 3 mins per km roughly
        
        // Update user tracking screen with distance/time
        updateUserTrackingInfo(orderId, remainingDist, remainingTime);
        
        // Advance progress based on constant speed
        const progressStep = speedPerFrame / segmentDist;
        progress += progressStep;

        if (progress >= 1) {
            progress = 0;
            currentPointIndex++;
        }
        
        deliveryAnimationFrame = requestAnimationFrame(animateDelivery);
    }
    
    animateDelivery();
}

function calculateRouteDistance(points) {
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
        totalDistance += calculateDistance(points[i-1], points[i]);
    }
    return totalDistance;
}

function calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in km
    const dLat = (point2[0] - point1[0]) * Math.PI / 180;
    const dLon = (point2[1] - point1[1]) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1[0] * Math.PI / 180) * Math.cos(point2[0] * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function updateRiderPositionOnAllMaps(position) {
    if (!window.L) return;
    if (window.userMap && window.riderMarker) {
        window.riderMarker.setLatLng(position);
    }
    
    // Update rider position on admin map
    if (window.adminMap) {
        if (!window.adminRiderMarker) {
             const riderIcon = window.L.divIcon({
                html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>',
                className: 'delivery-pin-icon',
                iconSize: [60, 60], iconAnchor: [30, 30]
            });
            window.adminRiderMarker = window.L.marker(position, { icon: riderIcon, zIndexOffset: 1000 }).addTo(window.adminMap);
        }
        window.adminRiderMarker.setLatLng(position);
    }
    
    // Update rider position on vendor map
    if (window.vendorMap && window.vendorRiderMarker) {
        window.vendorRiderMarker.setLatLng(position);
    }
    
    // Update rider position on rider map
    if (window.riderMap && window.riderMapMarker) {
        window.riderMapMarker.setLatLng(position);
    }

    // Update track map marker (User Tracking)
    if (typeof trackRiderMarker !== 'undefined' && trackRiderMarker) {
        trackRiderMarker.setLatLng(position);
        // Optional: pan camera to follow
        // if (typeof trackMap !== 'undefined' && trackMap) trackMap.panTo(position);
    }
}

function updateUserTrackingInfo(orderId, distance, time) {
    const infoDiv = document.querySelector('#trackOrderScreen .delivery-info');
    if (infoDiv) {
        const order = window.allOrders.find(o => o.id === orderId);
        if (order && ['rider_picking', 'rider_delivering'].includes(order.status)) {
            const statusText = order.status === 'rider_picking' ? 'Order Accepted' : 'Order on the way';
            infoDiv.innerHTML = `<div style="font-size:1.2em; font-weight:bold; color:#019E81;">
                ${statusText}
            </div>
            <div style="margin-top:10px;">
                <div style="font-size:1.1em; color:#333;">
                    <span style="font-weight:bold;">${time} min</span> remaining
                </div>
                <div style="font-size:0.9em; color:#666; margin-top:5px;">
                    ${distance.toFixed(1)} km away
                </div>
            </div>`;
        
        // Update big time display
        const timeBig = document.querySelector('#trackOrderScreen .track-time-big');
        if (timeBig) {
            timeBig.innerHTML = `${Math.max(1, time)} <span style="font-size:0.4em; vertical-align:middle; color:#888;">MINS</span>`;
        }
        }
    }
}

window.cancelOrder = function(orderId) {
    const order = window.allOrders.find(o => o.id === orderId);
    if(order) {
        order.status = 'cancelled';
        order.statusText = 'Order Cancelled';
        order.statusColor = '#ff4757';
        syncOrders();
        updateOrderStatus(orderId, 'cancelled', 'Order Cancelled', '#ff4757');
        document.getElementById('trackOrderScreen').classList.remove('active');
        document.getElementById('activeOrderWidget').classList.remove('visible');
        showToast('Order cancelled successfully.');
        updateAdminDashboard();
    }
}

function updateVendorTabsCounts() {
    // Update tab counts
    const newCount = vendorOrders.filter(o => o.status === 'new').length;
    const processingCount = vendorOrders.filter(o => o.status === 'processing').length;
    const readyCount = vendorOrders.filter(o => o.status === 'ready').length;
    
    document.querySelector('.vendor-tab[data-tab="new"]').textContent = `New (${newCount})`;
    document.querySelector('.vendor-tab[data-tab="processing"]').textContent = `Processing (${processingCount})`;
    document.querySelector('.vendor-tab[data-tab="ready"]').textContent = `Ready (${readyCount})`;
}

/* Help & Support Logic */
const helpBackBtn = document.getElementById('helpBackBtn');
const profileHelpBtn = document.getElementById('profileHelpBtn');

if(profileHelpBtn) {
    profileHelpBtn.addEventListener('click', () => {
        document.getElementById('helpSupportScreen').classList.add('active');
    });
}
if(helpBackBtn) {
    helpBackBtn.addEventListener('click', () => {
        document.getElementById('helpSupportScreen').classList.remove('active');
    });
}
document.querySelectorAll('.faq-header').forEach(header => {
    header.addEventListener('click', () => {
        header.parentElement.classList.toggle('open');
    });
});

/* Wallet Screen Logic */
const walletScreen = document.getElementById('walletScreen');
const walletBackBtn = document.getElementById('walletBackBtn');
const profileWalletStat = document.getElementById('profileWalletStat');

function renderWallet() {
    const content = document.getElementById('walletContent');
    content.innerHTML = '';

    // Wallet Card
    const card = document.createElement('div');
    card.className = 'wallet-card';
    card.innerHTML = `
        <div class="wallet-balance-label">Total Balance</div>
        <div class="wallet-balance-amount">UGX ${userWalletBalance.toLocaleString()}</div>
        <div class="wallet-btn-row">
            <div class="wallet-action-btn" onclick="showToast('Top Up feature coming soon')"><span>➕</span> Top Up</div>
            <div class="wallet-action-btn" onclick="showToast('Withdraw feature coming soon')"><span>↘️</span> Withdraw</div>
        </div>
    `;
    content.appendChild(card);

    // Transactions
    const title = document.createElement('div');
    title.className = 'transaction-section-title';
    title.innerHTML = '<span>Recent Transactions</span><span style="font-size:0.8em; color:#019E81; cursor:pointer;">See All</span>';
    content.appendChild(title);

    const list = document.createElement('div');
    list.className = 'transaction-list';
    
    walletTransactions.forEach(t => {
        const item = document.createElement('div');
        item.className = 'transaction-item';
        const isCredit = t.type === 'credit';
        item.innerHTML = `
            <div class="t-icon ${t.type}">${isCredit ? '↙️' : '↗️'}</div>
            <div class="t-info">
                <div class="t-title">${t.title}</div>
                <div class="t-date">${t.date}</div>
            </div>
            <div class="t-amount ${t.type}">${isCredit ? '+' : ''}${t.amount.toLocaleString()}</div>
        `;
        list.appendChild(item);
    });
    content.appendChild(list);
}

if(profileWalletStat) {
    // The Stat Item is just a div in the profile, let's attach listener to the container if possible
    // The user asked to link it. In HTML I added ID 'profileWalletStat' to the Points stat by mistake in previous steps?
    // No, I added it to the Points stat in the diff, wait.
    // Correction: In the HTML diff above, I added the ID to the 3rd item (Points). I should add logic for the 2nd item (Wallet).
    // Let's attach to the Wallet stat specifically using nth-child selector since I didn't add ID to it in the HTML diff properly for Wallet specifically, I added to Points.
    // Wait, looking at HTML diff: <div class="stat-item" id="profileWalletStat" ...> is around Points. 
    // I should fix this logic to target Wallet.
    const walletItem = document.querySelector('#profileScreen .stat-item:nth-child(2)');
    if(walletItem) {
        walletItem.style.cursor = 'pointer';
        walletItem.addEventListener('click', () => {
            renderWallet();
            walletScreen.classList.add('active');
        });
    }
}
if(walletBackBtn) walletBackBtn.addEventListener('click', () => walletScreen.classList.remove('active'));

/* Payment Methods & Terms Screens Logic */
/* Referral Screen Logic */
const referralScreen = document.getElementById('referralScreen');
const referralBackBtn = document.getElementById('referralBackBtn');
const profileReferralBtn = document.getElementById('profileReferralBtn');

window.copyReferralCode = function() {
    const code = document.getElementById('referralCodeBox').innerText.split('\n')[0];
    navigator.clipboard.writeText(code).then(() => {
        showToast('Referral code copied!');
    }).catch(() => {
        showToast('Code copied to clipboard!'); // Fallback feedback
    });
}

window.shareReferral = function() {
    showToast('Sharing link...');
    // Implement native share if supported, else just toast
    if (navigator.share) {
        navigator.share({ title: 'Kirya App', text: 'Use my code KIRYA-GIFT-2024 to get UGX 5,000 off!', url: window.location.href });
    }
}

const paymentMethodsScreen = document.getElementById('paymentMethodsScreen');
const termsScreen = document.getElementById('termsScreen');
const profilePaymentBtn = document.getElementById('profilePaymentBtn');
const profileTermsBtn = document.getElementById('profileTermsBtn');
const pmBackBtn = document.getElementById('pmBackBtn');
const termsBackBtn = document.getElementById('termsBackBtn');

if(profilePaymentBtn) {
    profilePaymentBtn.addEventListener('click', () => {
        const list = document.getElementById('pmList');
        list.innerHTML = `
            <div class="pm-card">
                <div class="pm-info"><div class="pm-icon">💵</div><div><div class="pm-text">Cash on Delivery</div><div class="pm-sub">Default</div></div></div>
            </div>
            <div class="pm-card">
                <div class="pm-info"><div class="pm-icon" style="color:#ffcb00;">●</div><div><div class="pm-text">MTN Mobile Money</div><div class="pm-sub">Linked: +971...</div></div></div>
                <div class="pm-delete">Remove</div>
            </div>
        `;
        paymentMethodsScreen.classList.add('active');
    });
}
if(profileTermsBtn) {
    profileTermsBtn.addEventListener('click', () => termsScreen.classList.add('active'));
}
if(profileReferralBtn) profileReferralBtn.addEventListener('click', () => referralScreen.classList.add('active'));
if(referralBackBtn) referralBackBtn.addEventListener('click', () => referralScreen.classList.remove('active'));
if(pmBackBtn) pmBackBtn.addEventListener('click', () => paymentMethodsScreen.classList.remove('active'));
if(termsBackBtn) termsBackBtn.addEventListener('click', () => termsScreen.classList.remove('active'));

/* Notification Data & Logic */
try {
    // Loaded from profile now
} catch (e) { console.error('Error loading notifications', e); }

function saveNotifications() {
    currentUser.notifications = notifications;
    saveUserProfile();
}

function getCurrentRole() {
    if (document.getElementById('adminScreen').classList.contains('active')) return 'admin';
    if (document.getElementById('riderScreen').classList.contains('active')) return 'rider';
    if (document.getElementById('shopPortalScreen').classList.contains('active')) return 'vendor';
    return 'user';
}

function renderNotifications() {
    const role = getCurrentRole();
    const list = document.getElementById('notificationList');
    if(!list) return;
    list.innerHTML = '';
    
    const roleNotifs = notifications.filter(n => n.role === role || n.role === 'all' || !n.role);

    if (roleNotifs.length > 0) {
        const clearContainer = document.createElement('div');
        clearContainer.style.padding = '10px 15px';
        clearContainer.style.textAlign = 'right';
        clearContainer.style.background = '#fff';
        clearContainer.style.borderBottom = '1px solid #f0f0f0';
        
        const clearBtn = document.createElement('button');
        clearBtn.textContent = 'Clear All';
        clearBtn.style.background = 'none';
        clearBtn.style.border = 'none';
        clearBtn.style.color = '#ff4757';
        clearBtn.style.fontWeight = 'bold';
        clearBtn.style.cursor = 'pointer';
        clearBtn.onclick = clearAllNotifications;
        
        clearContainer.appendChild(clearBtn);
        list.appendChild(clearContainer);
    }
    
    roleNotifs.forEach(n => {
        const item = document.createElement('div');
        item.style.cursor = 'pointer';
        item.className = `notification-item ${n.unread ? 'unread' : ''}`;
        const iconSymbol = n.type === 'order' ? '🛍️' : '🏷️';
        item.innerHTML = `
            <div class="notif-icon ${n.type}">${iconSymbol}</div>
            <div class="notif-content">
                <div class="notif-title">${n.title}</div>
                <div class="notif-body">${n.body}</div>
                <div class="notif-time">${n.time}</div>
            </div>
        `;
        item.addEventListener('click', () => {
            if (n.type === 'order') {
                openTrackOrder();
                document.getElementById('notificationsScreen').classList.remove('active');
            } else {
                showToast(n.title);
            }
        });
        list.appendChild(item);
    });
}

async function clearAllNotifications() {
    if (notifications.length === 0) return;
    if (await customPopup({ title: 'Clear All', message: 'Clear all notifications?', type: 'confirm' })) {
        notifications.length = 0;
        saveNotifications();
        renderNotifications();
        updateBellDots();
        showToast('All notifications cleared');
    }
}

const notifScreen = document.getElementById('notificationsScreen');
const notifBackBtn = document.getElementById('notifBackBtn');
const profileNotifBtn = document.getElementById('profileNotifBtn');

if(profileNotifBtn) profileNotifBtn.addEventListener('click', () => {
    renderNotifications();
    notifScreen.classList.add('active');
});

function openNotifications() {
    playNotificationSound();
    profileNotifBtn.click();
}

function updateBellDots() {
    const role = getCurrentRole();
    const unreadCount = notifications.filter(n => n.unread && (n.role === role || n.role === 'all' || !n.role)).length;
    document.querySelectorAll('.header-bell-dot').forEach(dot => {
        if(unreadCount > 0) {
            dot.classList.add('active');
            dot.textContent = unreadCount > 99 ? '99+' : unreadCount;
        } else {
            dot.classList.remove('active');
            dot.textContent = '';
        }
    });
}
setInterval(updateBellDots, 2000); // Check periodically

if(notifBackBtn) notifBackBtn.addEventListener('click', () => notifScreen.classList.remove('active'));

/* Settings Screen Logic */
const settingsScreen = document.getElementById('settingsScreen');
const settingsBackBtn = document.getElementById('settingsBackBtn');
const profileSettingsBtn = document.getElementById('profileSettingsBtn');
if(document.getElementById('profileLogoutBtn')) document.getElementById('profileLogoutBtn').addEventListener('click', handleLogout);

if(profileSettingsBtn) profileSettingsBtn.addEventListener('click', () => settingsScreen.classList.add('active'));
if(settingsBackBtn) settingsBackBtn.addEventListener('click', () => settingsScreen.classList.remove('active'));

document.getElementById('settingPushToggle')?.addEventListener('change', (e) => {
    showToast(e.target.checked ? 'Push Notifications Enabled' : 'Push Notifications Disabled');
    saveUserSettings();
});
document.getElementById('settingLocToggle')?.addEventListener('change', (e) => {
    showToast(e.target.checked ? 'Location Services Enabled' : 'Location Services Disabled');
    saveUserSettings();
});
document.getElementById('settingSoundToggle')?.addEventListener('change', (e) => {
    settingSoundEnabled = e.target.checked;
    localStorage.setItem('kirya_sound_enabled', JSON.stringify(settingSoundEnabled));
    showToast(settingSoundEnabled ? 'Sound Effects Enabled' : 'Sound Effects Disabled');
});
if(document.getElementById('settingSoundToggle')) document.getElementById('settingSoundToggle').checked = settingSoundEnabled;

document.getElementById('settingBiometricToggle')?.addEventListener('change', (e) => {
    if (e.target.checked) {
        // Placeholder for WebAuthn registration
        if (navigator.credentials && navigator.credentials.create) {
            showToast('Setting up biometric login... (demo)');
            // In a real app, you would call navigator.credentials.create() here
            // and send the result to your server to store the public key.
            console.log("WebAuthn supported. Placeholder for registration.");
        } else {
            showToast('Biometric login is not supported on this browser.');
            e.target.checked = false;
        }
    } else {
        showToast('Biometric login disabled.');
    }
    saveUserSettings();
});

/* Rewards Screen Logic */
const rewardsScreen = document.getElementById('rewardsScreen');
const rewardsBackBtn = document.getElementById('rewardsBackBtn');
const profileRewardsBtn = document.getElementById('profileRewardsBtn');

function openRewardsScreen() {
    const screen = document.getElementById('rewardsScreen');
    const content = document.getElementById('rewardsContent');
    content.innerHTML = ''; // Clear previous content

    // 1. Balance Card
    const balanceCard = document.createElement('div');
    balanceCard.className = 'rewards-balance-card';
    balanceCard.innerHTML = `
        <div class="rewards-points-label">Your Points Balance</div>
        <div class="rewards-points-value">${userPoints.toLocaleString()} ⭐</div>
    `;
    content.appendChild(balanceCard);

    // 2. Available Coupons
    const couponsTitle = document.createElement('div');
    couponsTitle.className = 'rewards-section-title';
    couponsTitle.textContent = 'Redeem Your Points';
    content.appendChild(couponsTitle);

    availableCoupons.forEach(coupon => {
        const card = document.createElement('div');
        card.className = 'coupon-card';
        const canAfford = userPoints >= coupon.cost;
        card.innerHTML = `
            <div class="coupon-icon">${coupon.icon}</div>
            <div class="coupon-info">
                <div class="coupon-title">${coupon.title}</div>
                <div class="coupon-desc">${coupon.desc}</div>
                <div class="coupon-cost">${coupon.cost.toLocaleString()} Points</div>
            </div>
            <button class="redeem-btn" data-cost="${coupon.cost}" ${!canAfford ? 'disabled' : ''}>Redeem</button>
        `;
        content.appendChild(card);
    });

    // 3. Points History
    const historyTitle = document.createElement('div');
    historyTitle.className = 'rewards-section-title';
    historyTitle.style.marginTop = '20px';
    historyTitle.textContent = 'Points History';
    content.appendChild(historyTitle);

    const historyContainer = document.createElement('div');
    historyContainer.style.cssText = 'background:#fff; border-radius:16px; margin:0 20px; box-shadow:0 4px 15px rgba(0,0,0,0.06); border:1px solid #f0f0f0;';

    pointsHistory.forEach(item => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        historyItem.innerHTML = `
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-date">${item.date}</div>
            </div>
            <div class="history-points ${item.type}">
                ${item.type === 'earned' ? '+' : ''}${item.points}
            </div>
        `;
        historyContainer.appendChild(historyItem);
    });
    content.appendChild(historyContainer);

    screen.classList.add('active');
}

if(profileRewardsBtn) {
    profileRewardsBtn.addEventListener('click', openRewardsScreen);
}
if(rewardsBackBtn) {
    rewardsBackBtn.addEventListener('click', () => rewardsScreen.classList.remove('active'));
}

document.getElementById('rewardsContent').addEventListener('click', e => {
    if (e.target.classList.contains('redeem-btn')) {
        const cost = parseInt(e.target.dataset.cost, 10);
        if (userPoints >= cost) {
            userPoints -= cost;
            saveUserProfile(); // Persist points
            const couponTitle = e.target.closest('.coupon-card').querySelector('.coupon-title').textContent;
            showToast(`"${couponTitle}" redeemed!`);
            
            pointsHistory.unshift({
                title: `Redeemed: ${couponTitle}`,
                date: 'Just now',
                points: -cost,
                type: 'spent'
            });

            // Refresh the screen to update points and button states
            openRewardsScreen();
        }
    }
});

function setupGlobalNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        const span = item.querySelector('span');
        if (!span) return;
        const text = span.textContent.trim();
        
        if (['Cart', 'Rider', 'Admin', 'Shop', 'Profile', 'Discover'].includes(text)) {
            item.addEventListener('click', () => {
                if (!appReady) return;
                if (text === 'Cart') openCart();
                else if (text === 'Discover') openContentSearch();
                else if (text === 'Rider') openRider();
                else if (text === 'Admin') openAdmin();
                else if (text === 'Shop') openShopPortal();
                else if (text === 'Profile') openProfile();
            });
        }
    });
}
setupGlobalNavigation();

const sideMenuOverlay = document.getElementById('sideMenuOverlay');
if(sideMenuOverlay) sideMenuOverlay.addEventListener('click', closeProfile);

if(profileBackBtn) {
    profileBackBtn.addEventListener('click', () => {
        closeProfile();
    });
}

function renderOrderHistory() {
    const list = document.getElementById('orderHistoryList');
    if (!list) return;
    list.innerHTML = '';
    const orders = window.currentUser.orders || [];
    if (orders.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:40px; color:#999;">No orders found.</div>';
        return;
    }
    orders.forEach(order => {
        const div = document.createElement('div');
        div.className = 'dashboard-card';
        div.style.marginBottom = '15px';
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <span style="font-weight:800; color:#333;">${order.id}</span>
                <span style="font-size:0.85em; color:#666;">${order.timestamp || order.time}</span>
            </div>
            <div style="font-size:0.9em; color:#555; margin-bottom:10px;">
                ${order.items.map(i => `${i.quantity}x ${i.title}`).join(', ')}
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:bold; color:#019E81;">UGX ${order.total.toLocaleString()}</span>
                <div style="display:flex; gap:10px;">
                    <button onclick="window.reorder('${order.id}')" style="padding:6px 12px; background:#FFBF42; color:#333; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:0.85em;">Reorder</button>
                    <button onclick="window.openTrackOrderById('${order.id}')" style="padding:6px 12px; background:#f0f0f0; color:#333; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:0.85em;">View</button>
                </div>
            </div>
        `;
        list.appendChild(div);
    });
}

const profileOrdersHistoryBtn = document.getElementById('profileOrdersHistoryBtn');
if(profileOrdersHistoryBtn) {
    profileOrdersHistoryBtn.addEventListener('click', () => {
        renderOrderHistory();
        document.getElementById('ordersHistoryScreen').classList.add('active');
    });
}

const profileEditPhoneBtn = document.getElementById('profileEditPhoneBtn');
if(profileEditPhoneBtn) {
    profileEditPhoneBtn.addEventListener('click', () => {
        const userPhoneScreen = document.getElementById('userPhoneScreen');
        const phoneParts = userPhoneNumber.split(' ');
        if (phoneParts.length > 1) {
            document.getElementById('userPhonePrefix').value = phoneParts[0];
            document.getElementById('userPhoneNumberInput').value = phoneParts.slice(1).join(' ');
        } else {
            document.getElementById('userPhoneNumberInput').value = userPhoneNumber;
            document.getElementById('userPhonePrefix').value = '+971';
        }
        userPhoneScreen.classList.add('active');
    });
}

/* Rider Dashboard Logic */
let isRiderOnline = false;
let riderMap;
let riderCurrentOrder = null;
let currentRiderOrderId = null;
let riderOrderTimer;
let riderCurrentStep = 0; // 0: Idle, 1: Pickup, 2: Dropoff
let riderLocationMarker;
let riderLocationWatchId;
let riderGpsEnabled = false;
let riderSimulationInterval = null;

function simulateRiderMovements() {
    if (!rtdb) return; // Simulate even if current user isn't a rider, for admin demo

    const riderIdsToSimulate = [2, 3, 4]; // IDs from MOCK_RIDERS

    riderIdsToSimulate.forEach(riderId => {
        const riderRef = rtdb.ref('locations/riders/rider_' + riderId);

        // Get current position or set initial
        riderRef.once('value').then(snapshot => {
            let currentPos = snapshot.val();
            if (!currentPos) {
                currentPos = {
                    lat: 24.4539 + (Math.random() - 0.5) * 0.1,
                    lng: 54.3773 + (Math.random() - 0.5) * 0.1,
                    name: MOCK_RIDERS.find(r => r.id === riderId)?.name || `Rider ${riderId}`
                };
            }

            // Move rider slightly
            const newLat = currentPos.lat + (Math.random() - 0.5) * 0.001;
            const newLng = currentPos.lng + (Math.random() - 0.5) * 0.001;

            riderRef.set({
                lat: newLat,
                lng: newLng,
                status: 'online',
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                name: currentPos.name
            });
        });
    });
}

async function initRiderMap() {
    if(!document.getElementById('riderMap')) return;
    if(riderMap) return;

    try { await loadLeaflet(); } catch(e) { return; }
    if(riderMap) return;

    // Define Layers
    const streetLayer = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' });
    const satelliteLayer = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });

    riderMap = window.L.map('riderMap', { zoomControl: false, layers: [streetLayer] }).setView([24.4539, 54.3773], 14);

    const baseMaps = {
        "Street View": streetLayer,
        "Satellite": satelliteLayer
    };
    window.L.control.layers(baseMaps, null, { position: 'bottomright' }).addTo(riderMap);
}

function updateRiderNearbyOrders() {
    if(!riderMap || !window.L) return;
    if(!window.riderOrderLayer) window.riderOrderLayer = window.L.layerGroup().addTo(riderMap);
    window.riderOrderLayer.clearLayers();

    if(window.allOrders) {
        window.allOrders.forEach(o => {
            // Show ready orders that need assignment
            if(o.status === 'ready') {
                const lat = o.restaurantLat || 24.46;
                const lng = o.restaurantLng || 54.38;
                    const marker = window.L.marker([lat, lng], {
                        icon: window.L.divIcon({html:'<div style="font-size:2em;">📦</div>', className:'delivery-pin-icon', iconSize:[30,30], iconAnchor:[15,15]})
                }).bindPopup(`<b>Order #${o.id}</b><br>Waiting for Assignment<br>${o.restaurant}`);
                window.riderOrderLayer.addLayer(marker);
            }
        });
    }
}
// Call periodically
setInterval(updateRiderNearbyOrders, 5000);

function requestRiderGPSAccess() {
    // Don't show notification if already requested and GPS is enabled
    if (riderGpsEnabled) {
        startRiderLocationTracking();
        return;
    }
    
    // Show notification for GPS access
    showGPSNotification();
    
    // Check if geolocation is supported
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by this browser');
        document.getElementById('enableGPSBtn').style.display = 'inline-block';
        return;
    }
    
    // Request permission and start tracking
    navigator.geolocation.getCurrentPosition(
        (position) => {
            riderGpsEnabled = true;
            startRiderLocationTracking();
            showToast('GPS access granted! Tracking your location...');
            document.getElementById('enableGPSBtn').style.display = 'none';
            document.getElementById('gpsStatusIndicator').style.display = 'block';
        },
        (error) => {
            console.log('GPS access denied or error:', error);
            showToast('GPS access denied. Please enable location services.');
            riderGpsEnabled = false;
            document.getElementById('enableGPSBtn').style.display = 'inline-block';
            document.getElementById('gpsStatusIndicator').style.display = 'none';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000 // 5 minutes
        }
    );
}

function showGPSNotification() {
    // Create a custom notification overlay
    const notification = document.createElement('div');
    notification.id = 'gpsNotification';
    notification.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 10000; display: flex; align-items: center; justify-content: center;">
            <div style="background: #fff; border-radius: 20px; padding: 30px; max-width: 400px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                <div style="font-size: 3em; margin-bottom: 20px;">📍</div>
                <h3 style="color: #333; margin-bottom: 15px; font-size: 1.3em;">Enable GPS Access</h3>
                <p style="color: #666; margin-bottom: 25px; line-height: 1.5;">To show your real-time location on the map and receive delivery requests, please allow GPS access.</p>
                <button id="allowGPSBtn" style="background: #019E81; color: #fff; border: none; padding: 12px 30px; border-radius: 25px; font-weight: bold; cursor: pointer; margin-right: 10px;">Allow Access</button>
                <button id="denyGPSBtn" style="background: #f0f0f0; color: #666; border: none; padding: 12px 30px; border-radius: 25px; font-weight: bold; cursor: pointer;">Not Now</button>
            </div>
        </div>
    `;
    document.body.appendChild(notification);
    
    // Handle button clicks
    document.getElementById('allowGPSBtn').addEventListener('click', () => {
        document.body.removeChild(notification);
        requestRiderGPSAccess();
    });
    
    document.getElementById('denyGPSBtn').addEventListener('click', () => {
        document.body.removeChild(notification);
        showToast('GPS access denied. You can enable it later from settings.');
    });
}

function startRiderLocationTracking() {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Remove existing marker if any
            if (riderLocationMarker) {
                riderMap.removeLayer(riderLocationMarker);
            }
            
            // Add rider marker with bike icon
            riderLocationMarker = window.L.marker([lat, lng], { icon: bikeIcon }).addTo(riderMap);
            
            // Center map on rider location
            riderMap.setView([lat, lng], 16);
            
            // Add accuracy circle
            if (position.coords.accuracy) {
                window.L.circle([lat, lng], {
                    color: '#019E81',
                    fillColor: '#019E81',
                    fillOpacity: 0.1,
                    radius: position.coords.accuracy
                }).addTo(riderMap);
            }
        },
        (error) => {
            console.log('Error getting location:', error);
            showToast('Unable to get your location. Please check GPS settings.');
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 }
    );
    
    // Start watching position for real-time updates
    riderLocationWatchId = navigator.geolocation.watchPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            // Update marker position
            if (riderLocationMarker) {
                riderLocationMarker.setLatLng([lat, lng]);
                // --- RTDB UPDATE START ---
                if (rtdb && isRiderOnline) {
                    // Simulating a unique ID for the current user/rider
                    const myRiderId = 'rider_123'; 
                    rtdb.ref('locations/riders/' + myRiderId).set({
                        lat: lat,
                        lng: lng,
                        heading: position.coords.heading || 0,
                        status: 'online',
                        timestamp: firebase.database.ServerValue.TIMESTAMP,
                        name: 'My Rider' // You can pull this from profile
                    });
                }
                // --- RTDB UPDATE END ---
            } else {
                updateRiderPositionOnAllMaps([lat, lng]);
                
                // Update local rider data
                const myRiderId = 1; // Assuming ID 1 is current user
                const r = adminRiders.find(x => x.id === myRiderId);
                if(r) {
                    r.lastSeen = 'Just now';
                    syncRiders();
                    if(document.getElementById('admin-riders') && document.getElementById('admin-riders').style.display === 'block') renderAdminRiders();
                }
                
                // Create marker if it doesn't exist
                const bikeIcon = window.L.divIcon({
                    html: '<div style="font-size: 3em; color: #019E81;">🚴</div>',
                    className: 'rider-bike-icon',
                    iconSize: [60, 60],
                    iconAnchor: [30, 30]
                });
                riderLocationMarker = window.L.marker([lat, lng], { icon: bikeIcon }).addTo(riderMap);
            }
            
            // Update accuracy circle if accuracy changed significantly
            if (position.coords.accuracy && Math.abs(position.coords.accuracy - (riderLocationMarker.accuracy || 0)) > 10) {
                // Remove old circle and add new one
                riderMap.eachLayer((layer) => {
                    if (layer instanceof window.L.Circle && layer.options.color === '#019E81') {
                        riderMap.removeLayer(layer);
                    }
                });
                
                window.L.circle([lat, lng], {
                    color: '#019E81',
                    fillColor: '#019E81',
                    fillOpacity: 0.1,
                    radius: position.coords.accuracy
                }).addTo(riderMap);
                
                riderLocationMarker.accuracy = position.coords.accuracy;
            }
            
            updateRiderPositionOnAllMaps([lat, lng]);
            
            const myRiderId = 1; 
            const r = adminRiders.find(x => x.id === myRiderId);
            if(r) {
                r.lastSeen = 'Just now';
                syncRiders();
                if(document.getElementById('admin-riders') && document.getElementById('admin-riders').style.display === 'block') renderAdminRiders();
            }
        },
        (error) => {
            console.log('Error watching position:', error);
            if (error.code === 1) {
                showToast('GPS access denied. Please enable location services.');
                riderGpsEnabled = false;
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 15000
        }
    );
}

function stopRiderLocationTracking() {
    if (riderLocationWatchId) {
        navigator.geolocation.clearWatch(riderLocationWatchId);
        riderLocationWatchId = null;
    }
    
    if (riderLocationMarker && riderMap) {
        riderMap.removeLayer(riderLocationMarker);
        riderLocationMarker = null;
    }
    
    // Remove accuracy circles
    if (riderMap) {
        riderMap.eachLayer((layer) => {
            if (layer instanceof window.L.Circle && layer.options.color === '#019E81') {
                riderMap.removeLayer(layer);
            }
        });
    }
}

function toggleRiderStatus() {
    isRiderOnline = !isRiderOnline;
    const btn = document.getElementById('riderStatusToggle');
    const dot = btn.querySelector('.status-dot');
    const text = btn.querySelector('.status-text');
    const msg = document.getElementById('riderIdleMsg');
    
    if(isRiderOnline) {
        // Check GPS before going online
        logActivity('Rider Online', 'Rider (You) went online', 'Rider');
        if (!riderGpsEnabled) {
            showToast('Please enable GPS tracking to receive orders');
            requestRiderGPSAccess();
            // Don't go online yet
            isRiderOnline = false;
            return;
        }
        
        btn.classList.remove('offline');
        btn.classList.add('online');
        dot.style.background = '#fff';
        text.textContent = 'ONLINE';
        text.style.color = '#fff';
        btn.style.background = '#019E81';
        btn.style.color = '#fff';
        btn.style.border = 'none';
        
        msg.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; gap:10px;"><span>🔍</span> Finding orders nearby...</div>';
        msg.style.background = '#e0f2f1';
        msg.style.color = '#019E81';
        msg.style.fontWeight = 'bold';
        
        if (riderSimulationInterval) clearInterval(riderSimulationInterval);
        riderSimulationInterval = setInterval(simulateRiderMovements, 5000); // every 5 seconds
        simulateRiderMovements(); // Run once immediately

        // Simulate an incoming order
        setTimeout(() => {
            if(isRiderOnline && riderCurrentStep === 0) triggerRiderOrder();
        }, 2500);
    } else {
        logActivity('Rider Offline', 'Rider (You) went offline', 'Rider');
        btn.classList.remove('online');
        btn.classList.add('offline');
        dot.style.background = '#ff4757';
        text.textContent = 'GO ONLINE';
        text.style.color = '#ff4757';
        btn.style.background = '#fff';
        btn.style.border = '2px solid #ff4757';

        msg.textContent = 'Go Online to start receiving orders.';
        msg.style.background = '#f0f0f0';
        msg.style.color = '#888';
        msg.style.fontWeight = 'normal';

        if (riderSimulationInterval) clearInterval(riderSimulationInterval);
        // Also remove simulated riders from RTDB when offline
        if (rtdb) {
            rtdb.ref('locations/riders/rider_2').remove();
            rtdb.ref('locations/riders/rider_3').remove();
            rtdb.ref('locations/riders/rider_4').remove();
        }
    }

    // Sync with Admin Data (Simulating Real-time update)
    // Assuming current user corresponds to Rider ID 1 for demo purposes
    const myRiderId = 1; 
    const statusStr = isRiderOnline ? 'online' : 'offline';
    
    // FIREBASE SYNC: Update Rider Status
    if(db) {
        // Using ID 1 as string for demo consistency, usually actual Auth UID
        db.collection('riders').doc(myRiderId.toString()).update({ 
            status: statusStr,
            lastSeen: 'Just now'
        }).catch(err => console.log("Rider status sync local only (mock)"));
    }
}

function triggerRiderOrder(orderId = null) {
    if (orderId) currentRiderOrderId = orderId;
    
    const modal = document.getElementById('riderOrderModal');
    const timerFill = document.getElementById('riderTimerFill');
    const notesContainer = document.getElementById('riderOrderNotes');
    if(notesContainer) notesContainer.style.display = 'none'; // Reset
    
    // Update modal details if we have a real order
    if(currentRiderOrderId && window.allOrders) {
        const order = window.allOrders.find(o => o.id === currentRiderOrderId);
        if(order) {
            modal.querySelector('.order-price').textContent = `UGX ${order.total.toLocaleString()}`;
            const msgDiv = document.createElement('div');
            if(order.rider) modal.querySelector('.order-meta').innerHTML += `<br><span style="color:#019E81; font-weight:bold;">Assigned to: ${order.rider}</span>`;
            
            if(order.driverNotes && notesContainer) {
                notesContainer.innerHTML = `<div style="font-weight:bold; color:#f57c00; font-size:0.8em; margin-bottom:4px;">📝 Customer Notes</div><div style="color:#333; font-size:0.9em; line-height:1.4;">${order.driverNotes}</div>`;
                notesContainer.style.display = 'block';
            }
        }
    }
    
    modal.classList.add('active');
    
    // Play notification sound
    playNotificationSound();

    // Timer Logic
    timerFill.style.width = '100%';
    setTimeout(() => { timerFill.style.width = '0%'; }, 100);
    
    riderOrderTimer = setTimeout(() => {
        modal.classList.remove('active');
        if(currentRiderOrderId) updateOrderStatus(currentRiderOrderId, 'rider_cancelled', 'Rider missed order');
    }, 15000); // 15 seconds to accept
}

document.getElementById('riderDeclineBtn')?.addEventListener('click', () => {
    clearTimeout(riderOrderTimer);
    document.getElementById('riderOrderModal').classList.remove('active');
    if(currentRiderOrderId) {
        updateOrderStatus(currentRiderOrderId, 'rider_cancelled', 'Rider declined');
    }
});

document.getElementById('riderAcceptBtn')?.addEventListener('click', () => {
    clearTimeout(riderOrderTimer);
    document.getElementById('riderOrderModal').classList.remove('active');
    
    if(currentRiderOrderId) {
        const currentRiderName = "Ali (You)"; // Simulating current logged in rider
        const order = window.allOrders.find(o => o.id === currentRiderOrderId);
        if(order) {
             order.rider = currentRiderName; // Claim the order
             document.querySelector('#riderStepPickup div:nth-child(2)').textContent = order.restaurant;
             document.querySelector('#riderStepDropoff div:nth-child(2)').textContent = order.deliveryAddress || order.customerName;
        }
        updateOrderStatus(currentRiderOrderId, 'rider_accepted', 'Rider accepted order');
    }
    startRiderDelivery();
});

function getBearing(start, end) {
    const startLat = start.lat * Math.PI / 180;
    const startLng = start.lng * Math.PI / 180;
    const endLat = end.lat * Math.PI / 180;
    const endLng = end.lng * Math.PI / 180;
    const y = Math.sin(endLng - startLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
    const brng = Math.atan2(y, x);
    return (brng * 180 / Math.PI + 360) % 360;
}

function interpolatePosition(start, end, factor) {
    const lat = start.lat + (end.lat - start.lat) * factor;
    const lng = start.lng + (end.lng - start.lng) * factor;
    return L.latLng(lat, lng);
    return window.L.latLng(lat, lng);
}

function startRouteSimulation() {
    if (!riderMap) return;
    clearRouteSimulation(); // Clear any previous routes

    // Sample route from Restaurant to Customer
    const routeCoords = [
        [24.46, 54.38], [24.462, 54.385], [24.465, 54.387], [24.468, 54.386],
        [24.47, 54.39], [24.472, 54.395], [24.47, 54.40], [24.468, 54.405],
        [24.465, 54.408]
    ];

    // Full route path (dashed grey)
    riderRoutePolyline = window.L.polyline(routeCoords, { color: '#888', weight: 5, opacity: 0.7, dashArray: '10, 10' }).addTo(riderMap);

    // Rider's progress path (solid green)
    riderProgressPolyline = window.L.polyline([], { color: '#019E81', weight: 6, opacity: 0.9 }).addTo(riderMap);

// Rider's marker with realistic animation
    const riderIcon = window.L.divIcon({
        html: `<div style="position:relative; width:100%; height:100%;">
            <div class="rider-pulse-ring"></div>
            <div id="riderBikeIcon" style="
            font-size: 32px;
            transition: transform 0.15s linear;
            width: 100%; height: 100%;
            display: flex;
            align-items: flex-end; 
            justify-content: center;
            transform-origin: center bottom;
        ">🚴‍♂️</div></div>`,
        className: '',
        iconSize: [40, 40],
        iconAnchor: [20, 40]
    });
    riderMarker = window.L.marker(routeCoords[0], { icon: riderIcon }).addTo(riderMap);

    riderMap.fitBounds(riderRoutePolyline.getBounds(), { padding: [50, 50] });

    // Enhanced Animation Logic for realistic riding
    let currentSegment = 0;
    let startTime = null;
    const speed = 0.00008; // Slower, more realistic speed
    let lastBearing = 0;

    function animate(timestamp) {
        if (!startTime) startTime = timestamp;

        if (currentSegment >= routeCoords.length - 1) {
            // Animation complete - rider has arrived
            showToast("Rider has arrived at destination! 🎉");
            return;
        }

        const startPoint = window.L.latLng(routeCoords[currentSegment]);
        const endPoint = window.L.latLng(routeCoords[currentSegment + 1]);
        const dist = riderMap.distance(startPoint, endPoint); // Meters
        const duration = dist * 25; // Slower animation for realism

        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const newPos = interpolatePosition(startPoint, endPoint, progress);
        riderMarker.setLatLng(newPos);

        // Calculate bearing for direction facing
        const bearing = getBearing(startPoint, endPoint);

        const bikeEl = document.getElementById('riderBikeIcon');
        if (bikeEl) {
            // Keep upright, flip for direction
            if (bearing > 0 && bearing < 180) bikeEl.style.transform = `scaleX(-1)`;
            else bikeEl.style.transform = `scaleX(1)`;
        }

        // Update Trail
        const currentPath = routeCoords.slice(0, currentSegment + 1).map(c => window.L.latLng(c));
        currentPath.push(newPos);
        riderProgressPolyline.setLatLngs(currentPath);

        if (progress >= 1) {
            // Move to next segment
            currentSegment++;
            startTime = null;
        }

        routeAnimationFrame = requestAnimationFrame(animate);
    }
    routeAnimationFrame = requestAnimationFrame(animate);
}

function startRiderDelivery() {
    riderCurrentStep = 1; // Pickup phase
    document.getElementById('riderDashboardState').style.display = 'none';
    document.getElementById('riderDeliveryState').style.display = 'block';
    document.getElementById('riderStatusToggle').style.display = 'none'; // Hide toggle during delivery
    
    // Reset Swipe Button
    resetSwipeButton('SWIPE TO PICK UP');
    startRouteSimulation();
}

function clearRouteSimulation() {
    if(routeAnimationFrame) cancelAnimationFrame(routeAnimationFrame);
    if (riderMarker && riderMap) riderMap.removeLayer(riderMarker);
    if (riderRoutePolyline && riderMap) riderMap.removeLayer(riderRoutePolyline);
    if (riderProgressPolyline && riderMap) riderMap.removeLayer(riderProgressPolyline);
    riderMarker = riderRoutePolyline = riderProgressPolyline = null;
}

function resetSwipeButton(text) {
    const container = document.getElementById('riderSwipeBtn');
    const knob = document.getElementById('riderSwipeKnob');
    const textEl = document.getElementById('riderSwipeText');
    
    container.classList.remove('completed');
    knob.style.transform = 'translateX(0)';
    textEl.textContent = text;
    textEl.style.opacity = '1';
    
    // Basic drag logic (simplified for click/drag simulation)
    let isDragging = false;
    let startX = 0;
    
    const onStart = (e) => {
        isDragging = true;
        startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
    };
    
    const onMove = (e) => {
        if(!isDragging) return;
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        let delta = clientX - startX;
        const maxDrag = container.clientWidth - knob.clientWidth - 8;
        if(delta < 0) delta = 0;
        if(delta > maxDrag) delta = maxDrag;
        knob.style.transform = `translateX(${delta}px)`;
        textEl.style.opacity = 1 - (delta / maxDrag);
        
        if(delta >= maxDrag - 5) {
            isDragging = false;
            completeSwipe();
        }
    };
    
    const onEnd = () => {
        if(!isDragging) return;
        isDragging = false;
        knob.style.transform = 'translateX(0)';
        textEl.style.opacity = '1';
    };
    
    knob.onmousedown = onStart;
    knob.ontouchstart = onStart;
    window.onmousemove = onMove;
    window.ontouchmove = onMove;
    window.onmouseup = onEnd;
    window.ontouchend = onEnd;
}

function completeSwipe() {
    const container = document.getElementById('riderSwipeBtn');
    const knob = document.getElementById('riderSwipeKnob');
    container.classList.add('completed');
    knob.style.transform = `translateX(${container.clientWidth - knob.clientWidth - 8}px)`;
    
    setTimeout(() => {
        if(riderCurrentStep === 1) {
            // Transition to Dropoff
            if(currentRiderOrderId) {
                updateOrderStatus(currentRiderOrderId, 'picked', 'Order picked up');
            }
            riderCurrentStep = 2;
            document.getElementById('riderStepPickup').classList.remove('active');
            document.getElementById('riderStepPickup').style.borderLeftColor = '#ddd';
            document.getElementById('riderStepPickup').style.opacity = '0.5';
            document.getElementById('riderStepDropoff').classList.add('active');
            resetSwipeButton('SWIPE TO COMPLETE');
            showToast('Order on the way');
        } else if(riderCurrentStep === 2) {
            // Complete Order
            if(currentRiderOrderId) {
                riderDeliverOrder(currentRiderOrderId);
                updateAdminDashboard(); // Ensure admin dashboard reflects delivery
                renderAdminOrders();
            }
            // showToast('Order Complete! + UGX 4,500'); // Handled in riderDeliverOrder
            document.getElementById('riderEarningsToday').textContent = '4,500.00';
            document.getElementById('riderTripsToday').textContent = '1';
            clearRouteSimulation();
            
            // Reset UI
            setTimeout(() => {
                document.getElementById('riderDeliveryState').style.display = 'none';
                document.getElementById('riderDashboardState').style.display = 'block';
                document.getElementById('riderStatusToggle').style.display = 'flex';
                riderCurrentStep = 0;
                currentRiderOrderId = null;
            }, 1000);
        }
    }, 500);
}

const riderStatusToggle = document.getElementById('riderStatusToggle');
if (riderStatusToggle) {
    riderStatusToggle.addEventListener('click', toggleRiderStatus);
}
const riderBackBtn = document.getElementById('riderBackBtn');
if (riderBackBtn) {
    riderBackBtn.addEventListener('click', () => {
        document.getElementById('riderScreen').classList.remove('active');
        clearRouteSimulation();
        stopRiderLocationTracking();
    });
}

function updateRiderPendingBadge() {
    // Count orders that are ready for pickup (or just 'ready'/'processing' depending on workflow)
    const readyCount = window.allOrders ? window.allOrders.filter(o => o.status === 'ready' || o.status === 'processing').length : 0;
    const badge = document.getElementById('riderPendingBadge');
    if(badge) {
        badge.textContent = readyCount;
        badge.style.display = (readyCount > 0 && !isRiderOnline) ? 'flex' : 'none';
    }
}

function switchRiderTab(tab) {
    document.querySelectorAll('.rider-tab-item').forEach(t => t.classList.remove('active'));
    document.querySelector(`.rider-tab-item[onclick*="${tab}"]`).classList.add('active');
    
    document.querySelectorAll('.rider-tab-content').forEach(c => c.classList.remove('active'));
    if(tab === 'overview') document.getElementById('riderTabOverview').classList.add('active');
    if(tab === 'history') {
        document.getElementById('riderTabHistory').classList.add('active');
        renderRiderHistory();
    }
}

function renderRiderHistory() {
    const list = document.getElementById('riderHistoryList');
    if(!list) return;
    // Filter for delivered orders
    const history = window.allOrders ? window.allOrders.filter(o => o.status === 'delivered').reverse() : [];
    
    if(history.length === 0) { list.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">No completed orders yet</div>'; return; }
    
    list.innerHTML = history.map(o => `<div class="rider-history-card"><div><div style="font-weight:bold; color:#333;">Order #${o.id}</div><div style="font-size:0.85em; color:#666;">${o.restaurant} • ${o.time || o.timestamp}</div></div><div style="text-align:right;"><div style="font-weight:bold; color:#019E81;">UGX ${Math.floor(o.total * 0.15 + 2000).toLocaleString()}</div><div style="font-size:0.7em; background:#e0f2f1; color:#019E81; padding:2px 6px; border-radius:4px; display:inline-block;">Delivered</div></div></div>`).join('');
}

// Initialize map when rider screen opens
document.querySelector('.nav-item:nth-child(5)')?.addEventListener('click', () => {
    setTimeout(initRiderMap, 300);
});

function initMerchantCharts() {
    // Prevent re-initialization
    if (dailySalesChartInstance) dailySalesChartInstance.destroy();
    if (topItemsChartInstance) topItemsChartInstance.destroy();

    const salesCtx = document.getElementById('dailySalesChart')?.getContext('2d');
    const itemsCtx = document.getElementById('topItemsChart')?.getContext('2d');

    if (!salesCtx || !itemsCtx) return;

    // Daily Sales Chart (Line)
    dailySalesChartInstance = new Chart(salesCtx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Sales',
                data: [120000, 190000, 150000, 210000, 180000, 250000, 230000],
                backgroundColor: 'rgba(1, 158, 129, 0.1)',
                borderColor: '#019E81',
                borderWidth: 2,
                tension: 0.4,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value, index, values) {
                            return 'UGX ' + value / 1000 + 'k';
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });

    // Top Selling Items Chart (Doughnut)
    topItemsChartInstance = new Chart(itemsCtx, {
        type: 'doughnut',
        data: {
            labels: ['Burgers', 'Wings', 'Fries', 'Drinks'],
            datasets: [{
                label: 'Top Items',
                data: [300, 150, 100, 200],
                backgroundColor: ['#FFBF42', '#ff4757', '#2ed573', '#1e90ff'],
                hoverOffset: 4
            }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
    });
}


/* Profile Picture Upload Logic */
const profilePic = document.getElementById('profilePic');
const profilePicInput = document.getElementById('profilePicInput');

if(profilePic && profilePicInput) {
    profilePic.addEventListener('click', () => {
        profilePicInput.click();
    });

    profilePicInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(file) {
            const reader = new FileReader();
            reader.onload = function(event) {
                profilePic.style.backgroundImage = `url(${event.target.result})`;
                profilePic.textContent = ''; // Remove the default emoji
            }
            reader.readAsDataURL(file);
        }
    });
}

/* Saved Addresses Screen Logic */
const savedAddressScreen = document.getElementById('savedAddressScreen');
const savedAddressBackBtn = document.getElementById('savedAddressBackBtn');
const profileSavedAddressesBtn = document.getElementById('profileSavedAddressesBtn');

if(profileSavedAddressesBtn && savedAddressScreen) {
    profileSavedAddressesBtn.addEventListener('click', () => {
        renderSavedAddresses();
        savedAddressScreen.classList.add('active');
    });
}
if(savedAddressBackBtn && savedAddressScreen) {
    savedAddressBackBtn.addEventListener('click', () => {
        savedAddressScreen.classList.remove('active');
    });
}

function renderSavedAddresses() {
    const container = document.querySelector('#savedAddressScreen .sa-content');
    if(!container) return;
    container.innerHTML = '';
    
    // Add "Save Current" button at top
    const btn = document.createElement('button');
    btn.textContent = '+ Save Current Location';
    btn.style.cssText = 'width:100%; margin-bottom:15px; padding:12px; background:#f0f0f0; color:#333; border:1px dashed #ccc; border-radius:8px; font-weight:bold; cursor:pointer;';
    btn.onclick = saveCurrentLocationToAddresses;
    container.appendChild(btn);

    if(!currentUser.savedAddresses || currentUser.savedAddresses.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.cssText = 'text-align:center; padding:20px; color:#999;';
        emptyMsg.textContent = 'No saved addresses yet.';
        container.appendChild(emptyMsg);
        return;
    }

    currentUser.savedAddresses.forEach((addr, index) => {
        const card = document.createElement('div');
        card.className = 'saved-addr-card';
        card.innerHTML = `
            <div class="saved-addr-icon">${addr.icon || '📍'}</div>
            <div class="saved-addr-info">
                <div class="saved-addr-type">${addr.label || 'Address'}</div>
                <div class="saved-addr-text">${addr.address}</div>
                <div class="saved-addr-actions">
                    <div class="saved-addr-action" onclick="useSavedAddress(${index})">Select</div>
                    <div class="saved-addr-action" style="color:#ff4757;" onclick="deleteSavedAddress(${index})">Delete</div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

async function saveCurrentLocationToAddresses() {
    const addr = document.getElementById('selectedAddress').textContent;
    if(addr && addr !== 'Select a location on the map') {
        const label = await customPopup({ title: 'Save Address', message: "Label this address (e.g., Home, Work):", type: 'prompt', defaultValue: "Home" });
        if(label) {
            currentUser.savedAddresses.push({
                label: label,
                address: addr,
                icon: label.toLowerCase() === 'home' ? '🏠' : (label.toLowerCase() === 'work' ? '🏢' : '📍')
            });
            saveUserProfile();
            renderSavedAddresses();
            showToast('Address saved!');
        }
    } else {
        showToast('Please select a location on the map first');
    }
}

async function deleteSavedAddress(index) {
    if(await customPopup({ title: 'Remove Address', message: 'Delete this address?', type: 'confirm' })) {
        currentUser.savedAddresses.splice(index, 1);
        saveUserProfile();
        renderSavedAddresses();
    }
}

function useSavedAddress(index) {
    const addr = currentUser.savedAddresses[index];
    document.getElementById('selectedAddressText').textContent = addr.address;
    document.getElementById('selectedAddress').textContent = addr.address;
    // In a real app we would save coords too if stored
    saveUserSettings();
    document.getElementById('savedAddressScreen').classList.remove('active');
    showToast(`Selected ${addr.label}`);
}

/* Auto-scroll function for horizontal lists */
function initAutoScroll() {
    const scrollSelectors = [
        '#shopScroll',
        '.filter-scroll',
        '#prefScroll',
        '.text-filter-scroll',
        '.search-item-scroll',
        '.brands-scroll'
    ];

    scrollSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
            if (el.dataset.autoScrollInitialized) return;
            el.dataset.autoScrollInitialized = 'true';

            let scrollInterval;
            const startScrolling = () => {
                clearInterval(scrollInterval);
                scrollInterval = setInterval(() => {
                    if (el.offsetParent === null) return; // Skip if element is hidden

                    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 10) {
                        el.scrollTo({ left: 0, behavior: 'smooth' });
                    } else {
                        el.scrollBy({ left: 160, behavior: 'smooth' });
                    }
                }, 2500);
            };

            el.addEventListener('touchstart', () => clearInterval(scrollInterval), {passive: true});
            el.addEventListener('touchend', startScrolling, {passive: true});
            el.addEventListener('mouseenter', () => clearInterval(scrollInterval));
            el.addEventListener('mouseleave', startScrolling);

            startScrolling();
        });
    });
}
initAutoScroll();

/* Ad Banner Rotator Logic */
function initAdBanner() {
    const adContainer = document.getElementById('ad-container');
    if (!adContainer) { return; }

    const banners = adContainer.querySelectorAll('.ad-banner');
    if (banners.length <= 1) { return; }

    let currentIndex = 0;

    setInterval(() => {
        if (banners[currentIndex]) {
            banners[currentIndex].classList.remove('active');
        }
        currentIndex = (currentIndex + 1) % banners.length;
        if (banners[currentIndex]) {
            banners[currentIndex].classList.add('active');
        }
    }, 5000);
}
initAdBanner();

/* Admin Sidebar Functions */
function toggleAdminSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('adminSidebarOverlay');
    sidebar.classList.toggle('mobile-visible');
    overlay.classList.toggle('active');
}

function closeAdminSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('adminSidebarOverlay');
    sidebar.classList.remove('mobile-visible');
    overlay.classList.remove('active');
}

function renderAdminTabContent(tabName) {
    switch(tabName) {
        case 'dashboard':
            renderAdminDashboard();
            break;
        case 'orders':
            renderAdminOrders();
            break;
        case 'restaurants':
        case 'vendors':
            renderAdminRestaurants();
            break;
        case 'riders':
            renderAdminRiders();
            break;
        case 'customers':
            renderAdminCustomers();
            break;
        case 'promotions':
            renderAdminPromotions();
            break;
        case 'payments':
            renderAdminPayments();
            break;
        case 'support':
            renderAdminSupport();
            break;
        case 'analytics':
            renderAdminAnalytics();
            break;
        case 'config':
            renderAdminConfig();
            break;
        case 'accounts':
            renderAdminAccounts();
            break;
        case 'livemap':
            renderAdminLiveMap();
            break;
        case 'logs':
            renderAdminLogs();
            break;
        case 'health':
            renderAdminHealth();
            break;
    }
}

function renderAdminDashboard() {
    try {
        const content = document.getElementById('admin-dashboard');
        if(!content) return;
        
        // Ensure data exists or default to empty array to prevent crashes
        const orders = (window.allOrders && window.allOrders.length > 0) ? window.allOrders : (adminOrders || []);
        const riders = adminRiders || [];

        // Sidebar badges are now handled by the auto-updater function    
        const activeRiders = riders.filter(r => r.status === 'online' || r.status === 'busy').length;
        
        // Calculate total stats
        const totalOrders = orders.length;
        const totalRevenue = orders
            .filter(o => o.status !== 'cancelled')
            .reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
        
        content.innerHTML = `
            <div class="dashboard-card">
                <h3 style="font-size:1.2em; font-weight:800; margin-bottom:15px;">📊 Platform Stats</h3>
                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:15px;">
                <div style="padding:15px; background:#e0f2f1; border-radius:12px;">
                    <div style="font-size:0.85em; color:#666; margin-bottom:8px;">Total Orders</div>
                    <div style="font-size:1.8em; font-weight:900; color:#019E81;">${totalOrders}</div>
                </div>
                <div style="padding:15px; background:#fff8e1; border-radius:12px;">
                    <div style="font-size:0.85em; color:#666; margin-bottom:8px;">Active Riders</div>
                    <div style="font-size:1.8em; font-weight:900; color:#FFB800;">${activeRiders}</div>
                </div>
                <div style="padding:15px; background:#f0f0f0; border-radius:12px;">
                    <div style="font-size:0.85em; color:#666; margin-bottom:8px;">Total Revenue</div>
                    <div style="font-size:1.8em; font-weight:900; color:#333;">UGX ${totalRevenue.toLocaleString()}</div>
                </div>
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:25px; margin-bottom:20px;">
            <div class="dashboard-card" style="margin:0;">
                <h4 style="margin-bottom:15px; font-weight:700;">Order Status</h4>
                <div style="height:180px; width:100%; display:flex; justify-content:center;"><canvas id="adminStatusChart"></canvas></div>
            </div>
            <div class="dashboard-card" style="margin:0;">
                <h4 style="margin-bottom:15px; font-weight:700;">Top Categories</h4>
                <div style="height:180px; width:100%;"><canvas id="adminCategoriesChart"></canvas></div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:25px;">
            <div class="dashboard-card" style="margin:0;">
                <h4 style="margin-bottom:15px; font-weight:800; color:#333;">Revenue Trend</h4>
                <div style="height:180px; width:100%;"><canvas id="adminRevenueChart"></canvas></div>
            </div>
            <div class="dashboard-card" style="margin:0;">
                <h4 style="margin-bottom:15px; font-weight:700;">Sales by Location</h4>
                <div style="height:180px; width:100%;"><canvas id="adminLocationChart"></canvas></div>
            </div>
        </div>
        <div class="dashboard-card">
            <h4 style="margin-bottom:15px; font-weight:700;">Loyalty Points (Distributed vs Redeemed)</h4>
            <div style="height:180px; width:100%;"><canvas id="adminLoyaltyChart"></canvas></div>
        </div>
        <div class="dashboard-card">
            <h4 style="margin-bottom:15px; font-weight:700;">Orders by Hour (Peak Times)</h4>
            <div style="height:180px; width:100%;"><canvas id="adminHourlyChart"></canvas></div>
        </div>
    `;
        setTimeout(() => {
            try { initAdminCharts(); } catch(e) { console.warn("Chart Init Error:", e); }
        }, 100);
    } catch(e) {
        console.error("Dashboard Render Error:", e);
    }
}

function renderAdminOrders() {
    const content = document.getElementById('admin-orders');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <h3 style="margin:0;">📦 Orders Management</h3>
                <div style="display:flex; gap:10px;">
                    <button onclick="deleteSelectedAdminOrders()" style="padding:8px 12px; background:#ff4757; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">🗑️ Delete Selected</button>
                    <button onclick="exportAdminData('orders')" style="padding:8px 12px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📥 Export CSV</button>
                </div>
            </div>
            <div style="margin-bottom:15px;">
                <input type="text" placeholder="Search orders (ID, Customer, Restaurant)..." oninput="searchAdminOrders(this.value)" value="${adminOrderSearchTerm}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
            </div>
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="filterAdminOrders('all')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">All (${adminOrders.length})</button>
                <button onclick="filterAdminOrders('pending')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Pending (${adminOrders.filter(o => o.status === 'pending').length})</button>
                <button onclick="filterAdminOrders('confirmed')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Confirmed (${adminOrders.filter(o => o.status === 'confirmed').length})</button>
                <button onclick="filterAdminOrders('preparing')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Preparing (${adminOrders.filter(o => o.status === 'preparing').length})</button>
            </div>
            <div id="adminOrdersList" style="max-height:500px; overflow:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th><input type="checkbox" onchange="toggleSelectAllAdminOrders(this)"></th>
                            <th onclick="sortAdminTable('orders', 'id')">Order ID ↕</th>
                            <th onclick="sortAdminTable('orders', 'time')">Date ↕</th>
                            <th onclick="sortAdminTable('orders', 'customer')">Customer ↕</th>
                            <th onclick="sortAdminTable('orders', 'restaurant')">Restaurant ↕</th>
                            <th>Payment</th>
                            <th>Rider</th>
                            <th onclick="sortAdminTable('orders', 'total')">Total ↕</th>
                            <th onclick="sortAdminTable('orders', 'status')">Status ↕</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${renderAdminOrdersList(adminOrderCurrentStatus)}</tbody>
                </table>
            </div>
        </div>
    `;
}

function searchAdminOrders(query) {
    adminOrderSearchTerm = query.toLowerCase();
    const tbody = document.querySelector('#adminOrdersList tbody');
    if(tbody) tbody.innerHTML = renderAdminOrdersList(adminOrderCurrentStatus);
}

function filterAdminOrders(status) {
    adminOrderCurrentStatus = status;
    const tbody = document.querySelector('#adminOrdersList tbody');
    if (tbody) {
        tbody.innerHTML = renderAdminOrdersList(status);
    }
}

function renderAdminOrdersList(status) {
    const filteredOrders = adminOrders.filter(o => {
        const statusMatch = status === 'all' || o.status === status;
        const searchMatch = adminOrderSearchTerm === '' ||
            (o.id || '').toString().toLowerCase().includes(adminOrderSearchTerm) ||
            (o.customer || '').toLowerCase().includes(adminOrderSearchTerm) ||
            (o.restaurant || '').toLowerCase().includes(adminOrderSearchTerm);
        return statusMatch && searchMatch;
    });
    
    return filteredOrders.map(order => {
        const statusColors = { pending: '#ff9800', confirmed: '#2196f3', preparing: '#ff5722', ready: '#4caf50', delivered: '#009688', cancelled: '#f44336', scheduled: '#9c27b0', rider_assigned: '#ff9800', rider_accepted: '#2196f3', picked: '#ff5722', rider_cancelled: '#f44336' };
        
        let statusDisplay = (order.status || 'unknown').toUpperCase().replace('_', ' ');
        if(order.status === 'rider_assigned') statusDisplay = 'PENDING';
        if(order.status === 'rider_accepted') statusDisplay = 'RIDER ACCEPT';
        if(order.status === 'rider_cancelled') statusDisplay = 'RIDER CANCEL';
        if(order.status === 'picked') statusDisplay = 'PICKED';
        
        return `
            <tr ${order.status === 'delivered' ? `onclick="viewOrderDetails('${order.id}')" style="cursor:pointer;" title="Click to view details"` : ''} >
                <td><input type="checkbox" class="admin-order-checkbox" value="${order.id}"></td>
                <td><strong>${order.id}</strong></td>
                <td style="font-size:0.85em; color:#555;">${order.time || 'N/A'}<br><span style="font-size:0.8em; color:#999;">${order.timestamp || ''}</span></td>
                <td><div>${order.customer || 'N/A'}</div><div style="font-size:0.8em; color:#666;">${order.customerPhone || ''}</div></td>
                <td>${order.restaurant || 'N/A'}<br><div style="font-size:0.8em; color:#666;">${(order.items || []).length} Items</div></td>
                <td style="font-size:0.9em;">${order.payment ? (order.payment === 'cod' ? '💵 COD' : (order.payment === 'card' ? '💳 Card' : '📱 Wallet')) : 'N/A'}</td>
                <td style="font-size:0.9em;">${order.rider || '<span style="color:#999; font-style:italic;">Unassigned</span>'}</td>
                <td style="font-weight:bold;">UGX ${(order.total || 0).toFixed(2)}</td>
                <td><span style="background:${statusColors[order.status] || '#999'}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${statusDisplay}</span></td>
                <td onclick="event.stopPropagation()">
                    ${order.status === 'pending' ? `<button onclick="updateOrderStatus('${order.id}', 'confirmed', 'Order Confirmed', '#2196f3')" class="action-btn-table" style="background:#2196f3; color:#fff;">Confirm</button><button onclick="updateOrderStatus('${order.id}', 'cancelled', 'Order Rejected', '#f44336')" class="action-btn-table" style="background:#f44336; color:#fff;">Reject</button>` : ''}
                    ${order.status === 'confirmed' ? `<button onclick="adminSubmitOrderToVendor('${order.id}')" class="action-btn-table" style="background:#FFBF42; color:#333;">Submit to Vendor</button>` : ''}
                    ${['ready', 'rider_cancelled'].includes(order.status) ? `<button onclick="openAssignRiderModal('${order.id}')" class="action-btn-table" style="background:#019E81; color:#fff;">Assign Rider</button>` : ''}
                    <button onclick="viewOrderPath('${order.id}')" class="action-btn-table" style="background:#607d8b; color:#fff;">Map History</button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateAdminOrderStatus(orderId, newStatus) {
    const order = adminOrders.find(o => o.id === orderId);
    if (order) {
        order.status = newStatus;
        showToast(`Order ${orderId} status updated to ${newStatus}`);
        syncOrders(); // Save change
        renderAdminOrders(); // Re-render the orders list
        updateAdminDashboard(); // Refresh dashboard UI
    }
}

function toggleSelectAllAdminOrders(source) {
    const checkboxes = document.querySelectorAll('.admin-order-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
}

async function deleteSelectedAdminOrders() {
    const selected = Array.from(document.querySelectorAll('.admin-order-checkbox:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        showToast('No orders selected');
        return;
    }
    if (await customPopup({ title: 'Delete Orders', message: `Are you sure you want to delete ${selected.length} selected orders?`, type: 'confirm' })) {
        adminOrders = adminOrders.filter(o => !selected.includes(o.id));
        window.allOrders = adminOrders; // Sync ref
        syncOrders();
        renderAdminOrders();
        showToast(`${selected.length} orders deleted`);
    }
}

function renderAdminRestaurants() {
    const content = document.getElementById('admin-vendors');
    if (!content) return;

    const currentStatus = adminFilters.restaurants.status;
    const currentCat = adminFilters.restaurants.category;

    content.innerHTML = `
        <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                <h3 style="margin:0;">🏪 Vendors Management</h3>
                <div style="display:flex; gap:10px;">
                    <button onclick="openAdminModal('restaurant')" style="padding:8px 12px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">➕ Add Restaurant</button>
                    <button onclick="triggerRestaurantImport()" style="padding:8px 12px; background:#2196f3; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📂 Import CSV</button>
                    <button onclick="exportVendorsPDF()" style="padding:8px 12px; background:#e91e63; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📄 Export PDF</button>
                    <button onclick="exportAdminData('restaurants')" style="padding:8px 12px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📥 Export CSV</button>
                </div>
            </div>
            <div style="margin-bottom:15px;">
                <input type="text" placeholder="Search vendors by name or category..." oninput="adminSearch('restaurants', this.value)" value="${adminFilters.restaurants.search}" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
            </div>
            <div style="margin-bottom:10px; font-weight:bold; font-size:0.9em; color:#666;">Filter by Category:</div>
            <div style="display:flex; gap:8px; margin-bottom:15px; flex-wrap:wrap;">
                ${['all', 'Restaurants', 'Pharmacies', 'Shops', 'Groceries', 'Drinks'].map(cat => `
                    <button onclick="filterAdminRestaurants(null, '${cat}')" style="padding:6px 12px; border:1px solid #ddd; background:${currentCat === cat ? '#019E81' : '#fff'}; color:${currentCat === cat ? '#fff' : '#333'}; border-radius:20px; cursor:pointer; font-size:0.85em; font-weight:600; transition: all 0.2s;">${cat === 'all' ? 'All' : cat}</button>
                `).join('')}
            </div>
            <div style="margin-bottom:10px; font-weight:bold; font-size:0.9em; color:#666;">Filter by Status:</div>
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="filterAdminRestaurants('all', null)" style="padding:8px 16px; border:1px solid #ddd; background:${currentStatus === 'all' ? '#019E81' : '#fff'}; color:${currentStatus === 'all' ? '#fff' : '#333'}; border-radius:6px; cursor:pointer;">All (${adminRestaurants.length})</button>
                <button onclick="filterAdminRestaurants('active', null)" style="padding:8px 16px; border:1px solid #ddd; background:${currentStatus === 'active' ? '#4caf50' : '#fff'}; color:${currentStatus === 'active' ? '#fff' : '#333'}; border-radius:6px; cursor:pointer;">Active (${adminRestaurants.filter(r => r.status === 'active').length})</button>
                <button onclick="filterAdminRestaurants('inactive', null)" style="padding:8px 16px; border:1px solid #ddd; background:${currentStatus === 'inactive' ? '#f44336' : '#fff'}; color:${currentStatus === 'inactive' ? '#fff' : '#333'}; border-radius:6px; cursor:pointer;">Inactive (${adminRestaurants.filter(r => r.status === 'inactive').length})</button>
            </div>
            <div id="adminRestaurantsList" style="max-height:500px; overflow:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Photos</th>
                            <th onclick="sortAdminTable('restaurants', 'name')">Restaurant</th>
                            <th>Contact</th>
                            <th>Stats</th>
                            <th onclick="sortAdminTable('restaurants', 'status')">Status ↕</th>
                            <th>Total Commission</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${renderAdminRestaurantsList()}</tbody>
                </table>
                <button onclick="loadMoreAdminData('restaurants')" style="width:100%; padding:12px; background:#f5f5f5; border:1px solid #eee; border-radius:8px; margin-top:10px; cursor:pointer; font-weight:bold; color:#666;">Load More...</button>
            </div>
        </div>
    `;
}


function adminSearch(type, query) {
    adminFilters[type].search = query.toLowerCase();
    // Refresh list based on type
    if(type === 'restaurants') filterAdminRestaurants(adminFilters.restaurants.status);
    else if(type === 'riders') filterAdminRiders(adminFilters.riders.status);
    else if(type === 'customers') filterAdminCustomers(adminFilters.customers.status);
}

function renderAdminRestaurantsList() {
    const status = adminFilters.restaurants.status;
    const search = adminFilters.restaurants.search;
    const category = adminFilters.restaurants.category;
    
    const filteredRestaurants = adminRestaurants.filter(r => {
        const matchesStatus = status === 'all' || r.status === status;
        const matchesCategory = category === 'all' || r.category === category;
        const matchesSearch = (r.name || '').toLowerCase().includes(search) || (r.category || '').toLowerCase().includes(search) || (r.address || '').toLowerCase().includes(search);
        return matchesStatus && matchesCategory && matchesSearch;
    });
    
    return filteredRestaurants.map(restaurant => `
        ${(() => {
            const commission = (restaurant.revenue * (restaurant.commission || 0) / 100).toFixed(2);
            return `
        <tr>
            <td>
                <div style="display:flex; gap:5px;">
                    <div onclick="triggerAdminPhotoUpload('restaurants', '${restaurant.id}', 'profilePhoto')" style="width:35px; height:35px; background:#f0f0f0; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #eee; cursor:pointer;" title="Click to upload Profile Photo">
                        ${window.getImageHtml(restaurant.profilePhoto, '🏪')}
                    </div>
                    <div onclick="triggerAdminPhotoUpload('restaurants', '${restaurant.id}', 'coverPhoto')" style="width:60px; height:35px; background:#f0f0f0; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #eee; cursor:pointer;" title="Click to upload Cover Photo">
                        ${window.getImageHtml(restaurant.coverPhoto, '🖼️')}
                    </div>
                </div>
            </td>
            <td><div style="font-weight:bold;">${restaurant.name || 'N/A'}</div><div style="font-size:0.8em; color:#666;">${restaurant.category || ''}</div></td>
            <td><div style="font-weight:600;">${restaurant.phone || 'N/A'}</div><div style="font-size:0.8em; color:#666;">${restaurant.owner || 'No owner'}</div></td>
            <td><div style="font-weight:600;">${restaurant.orders || 0} orders</div><div style="font-size:0.8em;">UGX ${(restaurant.revenue || 0).toLocaleString()}</div></td>
            <td><span style="background:${restaurant.status === 'active' ? '#4caf50' : '#f44336'}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${(restaurant.status || 'unknown').toUpperCase()}</span></td>
            <td style="font-weight:bold; color:#019E81;">UGX ${commission}</td>
            <td>
                <button onclick="window.toggleAdminItemStatus('restaurant', '${restaurant.id}')" class="action-btn-table" style="background:#2196f3; color:#fff;">${restaurant.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                <button onclick="window.openAdminMenuManager('${restaurant.id}')" class="action-btn-table" style="background:#9c27b0; color:#fff;">Menu</button>
                <button onclick="window.openAdminModal('vendor', '${restaurant.id}')" class="action-btn-table" style="background:#ff9800; color:#fff;">Edit</button>
                <button onclick="window.deleteAdminItem('restaurant', '${restaurant.id}')" class="action-btn-table" style="background:#f44336; color:#fff;">Delete</button>
            </td>
        </tr>
            `;
        })()}
    `).join('');
}

function toggleRestaurantStatus(restaurantId) {
    const restaurant = adminRestaurants.find(r => r.id === restaurantId);
    if (restaurant) {
        toggleAdminItemStatus('restaurant', restaurantId);
    }
}

async function deleteRestaurant(restaurantId) {
    if(await customPopup({ title: 'Confirm Delete', message: 'Are you sure you want to delete this restaurant? This cannot be undone.', type: 'confirm' })) {
        deleteAdminItem('restaurant', restaurantId);
    }
}

async function deleteAdminItem(type, id) {
    const typeMap = {
        restaurant: { data: adminRestaurants, name: 'Restaurant', render: renderAdminRestaurants, storageKey: 'kirya_restaurants' },
        rider: { data: adminRiders, name: 'Rider', render: renderAdminRiders, storageKey: 'kirya_riders' },
        customer: { data: adminCustomers, name: 'Customer', render: renderAdminCustomers },
        account: { data: adminAccounts, name: 'Admin Account', render: renderAdminAccounts }
    };
    const itemConfig = typeMap[type];
    if (!itemConfig) return;

    const confirmed = await customPopup({ title: `Delete ${itemConfig.name}`, message: `Are you sure you want to delete this ${itemConfig.name}?`, type: 'confirm' });
    if (confirmed) {
        let dataArray = itemConfig.data;
        const initialLength = dataArray.length;
        dataArray = dataArray.filter(item => item.id != id);

        if (dataArray.length < initialLength) {
            if (type === 'restaurant') adminRestaurants = dataArray;
            if (type === 'rider') adminRiders = dataArray;
            if (type === 'customer') adminCustomers = dataArray;
            if (type === 'account') adminAccounts = dataArray;

            if (itemConfig.storageKey) {
                localStorage.setItem(itemConfig.storageKey, JSON.stringify(dataArray));
            }
            showToast(`${itemConfig.name} deleted.`);
            itemConfig.render();
        }
    }
}

function renderAdminRiders() {
    const content = document.getElementById('admin-riders');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                <h3 style="margin:0;">🚴‍♂️ Riders Management</h3>
                <div style="display:flex; gap:10px;">
                    <button onclick="adminBroadcastToRiders()" style="padding:8px 12px; background:#FFBF42; color:#333; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📢 Broadcast</button>
                    <button onclick="openAdminModal('rider')" style="padding:8px 12px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">➕ Add Rider</button>
                    <button onclick="exportAdminData('riders')" style="padding:8px 12px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📥 Export CSV</button>
                </div>
            </div>
            <div style="margin-bottom:15px;">
                <input type="text" placeholder="Search riders (name, phone)..." oninput="adminSearch('riders', this.value)" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
            </div>
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="filterAdminRiders('all')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">All (${adminRiders.length})</button>
                <button onclick="filterAdminRiders('online')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Online (${adminRiders.filter(r => r.status === 'online').length})</button>
                <button onclick="filterAdminRiders('busy')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Busy (${adminRiders.filter(r => r.status === 'busy').length})</button>
                <button onclick="filterAdminRiders('offline')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Offline (${adminRiders.filter(r => r.status === 'offline').length})</button>
            </div>
            <div id="adminRidersList" style="max-height:500px; overflow:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Photo</th>
                            <th onclick="sortAdminTable('riders', 'name')">Name ↕</th>
                            <th onclick="sortAdminTable('riders', 'phone')">Contact ↕</th>
                            <th onclick="sortAdminTable('riders', 'vehicle')">Vehicle ↕</th>
                            <th onclick="sortAdminTable('riders', 'earnings')">Earnings ↕</th>
                            <th onclick="sortAdminTable('riders', 'status')" style="width:100px;">Status ↕</th>
                            <th>Last Seen</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${renderAdminRidersList('all')}</tbody>
                </table>
                <button onclick="loadMoreAdminData('riders')" style="width:100%; padding:12px; background:#f5f5f5; border:1px solid #eee; border-radius:8px; margin-top:10px; cursor:pointer; font-weight:bold; color:#666;">Load More...</button>
            </div>
        </div>
    `;
}

function filterAdminRestaurants(status = null, category = null) {
    if (status !== null) adminFilters.restaurants.status = status;
    if (category !== null) adminFilters.restaurants.category = category;
    
    // Refresh the whole component to update button active highlights
    if (status !== null || category !== null) {
        renderAdminRestaurants();
    } else {
        const tbody = document.querySelector('#adminRestaurantsList tbody');
        if (tbody) {
            tbody.innerHTML = renderAdminRestaurantsList();
        }
    }
}

function renderAdminRidersList() {
    const filterStatus = adminFilters.riders.status;
    const search = adminFilters.riders.search;
    const filteredRiders = adminRiders.filter(r => {
        const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
        const matchesSearch = (r.name || '').toLowerCase().includes(search) || (r.phone || '').includes(search);
        return matchesStatus && matchesSearch;
    });
    
    return filteredRiders.map(rider => {
        const statusColors = { online: '#4caf50', busy: '#ff9800', offline: '#f44336' };
        const accountStatus = rider.accountStatus || 'active';
        const accountStatusColor = accountStatus === 'active' ? '#4caf50' : '#f44336';
        
        return `
            <tr>
                <td>
                    <div onclick="triggerAdminPhotoUpload('riders', '${rider.id}', 'profilePhoto')" style="width:35px; height:35px; background:#f0f0f0; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #eee; cursor:pointer;" title="Upload Photo">
                        ${window.getImageHtml(rider.profilePhoto, '🚴')}
                    </div>
                </td>
                <td><div style="font-weight:bold;">${rider.name || 'N/A'}</div></td>
                <td><div style="font-weight:600;">${rider.phone || 'N/A'}</div></td>
                <td>${rider.vehicle || 'N/A'}<br><span style="font-size:0.8em; color:#888;">${rider.license || ''}</span></td>
                <td><div style="font-weight:600;">${rider.completedOrders || 0} orders</div><div style="font-size:0.8em;">UGX ${(rider.earnings || 0).toLocaleString()}</div></td>
                <td><span style="background:${statusColors[rider.status] || '#ccc'}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${(rider.status || 'unknown').toUpperCase()}</span></td>
                <td style="font-size:0.85em; color:#666;">${rider.lastSeen || 'N/A'}</td>
                <td>
                    <button onclick="verifyCustomerWhatsApp('${rider.phone}')" class="action-btn-table" style="background:#25D366; color:#fff;">Verify WA</button>
                    <button onclick="contactRider('${rider.phone}')" class="action-btn-table" style="background:#2196f3; color:#fff;">Call</button>
                    <button onclick="chatWithRider('${rider.id}', '${rider.name}')" class="action-btn-table" style="background:#019E81; color:#fff;">Chat</button>
                    <button onclick="window.toggleRiderAccountStatus('${rider.id}')" class="action-btn-table" style="background:${accountStatusColor}; color:#fff;">${accountStatus === 'active' ? 'Suspend' : 'Activate'}</button>
                    <button onclick="window.editRider('${rider.id}')" class="action-btn-table" style="background:#ff9800; color:#fff;">Edit</button>
                    <button onclick="window.deleteAdminItem('rider', '${rider.id}')" class="action-btn-table" style="background:#f44336; color:#fff;">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
}

function contactRider(phone) {
    window.open(`tel:${phone}`);
}

function chatWithRider(id, name) {
    const chatScreen = document.getElementById('chatScreen');
    chatScreen.querySelector('.chat-title').innerHTML = `
        <div style="font-weight:800; color:#333;">${name}</div>
        <div style="font-size:0.8em; color:#019E81;">Rider</div>
    `;
    openChat('admin');
}

function adminBroadcastToRiders() {
    document.getElementById('adminBroadcastText').value = '';
    document.getElementById('adminBroadcastModal').style.display = 'flex';
}

function closeAdminBroadcastModal() {
    document.getElementById('adminBroadcastModal').style.display = 'none';
}

function sendAdminBroadcast() {
    const msg = document.getElementById('adminBroadcastText').value.trim();
    if (msg) {
        const notif = {
            type: 'info',
            title: 'Admin Broadcast',
            body: msg,
            time: 'Just now',
            unread: true,
            role: 'rider'
        };
        notifications.unshift(notif);
        saveNotifications();
        showToast('Broadcast sent to riders');
        closeAdminBroadcastModal();
    } else {
        showToast('Please enter a message');
    }
}

function renderAdminCustomers() {
    const content = document.getElementById('admin-customers');
    if (!content) return;

    content.innerHTML = `
        <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:10px;">
                <h3 style="margin:0;">👥 Customer Management</h3>
                <div style="display:flex; gap:10px;">
                    <button onclick="openAdminModal('customer')" style="padding:8px 12px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">➕ Add Customer</button>
                    <button onclick="exportAdminData('customers')" style="padding:8px 12px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em; display:flex; align-items:center; gap:5px;">📥 Export CSV</button>
                </div>
            </div>
            <div style="margin-bottom:15px;">
                <input type="text" placeholder="Search customers (name, phone)..." oninput="adminSearch('customers', this.value)" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
            </div>
            <div style="display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap;">
                <button onclick="filterAdminCustomers('all')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">All (${adminCustomers.length})</button>
                <button onclick="filterAdminCustomers('active')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Active (${adminCustomers.filter(c => c.status === 'active').length})</button>
                <button onclick="filterAdminCustomers('pending_verification')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Pending (${adminCustomers.filter(c => c.status === 'pending_verification').length})</button>
                <button onclick="filterAdminCustomers('inactive')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Inactive (${adminCustomers.filter(c => c.status === 'inactive').length})</button>
                <label style="display:flex; align-items:center; gap:5px; background: #fff3e0; padding: 8px 12px; border-radius: 6px; cursor:pointer;">
                    <input type="checkbox" id="toggleMissingPhotoFilter" onchange="toggleMissingPhotoFilter(this.checked)" ${sortState.customers.missingPhoto ? 'checked' : ''}> Missing Photo
                </label>
            </div>
            <div id="adminCustomersList" style="max-height:500px; overflow:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Photo</th>
                            <th onclick="sortAdminTable('customers', 'name')">Name ↕</th>
                            <th onclick="sortAdminTable('customers', 'phone')">Contact ↕</th>
                            <th onclick="sortAdminTable('customers', 'orders')">Stats ↕</th>
                            <th onclick="sortAdminTable('customers', 'status')">Status ↕</th>
                            <th>Last Order</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${renderAdminCustomersList()}</tbody>
                </table>
                <button onclick="loadMoreAdminData('customers')" style="width:100%; padding:12px; background:#f5f5f5; border:1px solid #eee; border-radius:8px; margin-top:10px; cursor:pointer; font-weight:bold; color:#666;">Load More Users...</button>
            </div>
        </div>
    `;
}

function filterAdminCustomers(status) {
    // Update the filter state
    adminFilters.customers.status = status;
    const listContainer = document.getElementById('adminCustomersList');
    if (listContainer) {
        // Re-render the table body
        const tbody = listContainer.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = renderAdminCustomersList();
        }
    }
}

function renderAdminCustomersList() {
    const status = adminFilters.customers.status;
    const search = adminFilters.customers.search;
    const missingPhoto = sortState.customers.missingPhoto;

    const filteredCustomers = adminCustomers.filter(c => {
        const matchesStatus = status === 'all' || c.status === status;
        const matchesSearch = (c.name || '').toLowerCase().includes(search) || (c.phone || '').includes(search);
        const matchesPhoto = !missingPhoto || !c.profilePhoto;
        return matchesStatus && matchesSearch && matchesPhoto;
    });
    
    return filteredCustomers.map(customer => `
        <tr>
            <td>
                <div onclick="triggerAdminPhotoUpload('customers', '${customer.id}', 'profilePhoto')" style="width:35px; height:35px; background:#f0f0f0; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #eee; cursor:pointer;" title="Upload Photo">
                    ${window.getImageHtml(customer.profilePhoto, '👤')}
                </div>
            </td>
            <td><div style="font-weight:bold;">${customer.name || 'N/A'}</div><div style="font-size:0.8em; color:#666;">Joined: ${customer.joined || ''}</div></td>
            <td><div style="font-weight:600;">${customer.phone || 'N/A'}</div><div style="font-size:0.8em; color:#666;">${customer.email || 'No email'}</div></td>
            <td><div style="font-weight:600;">${customer.orders || 0} orders</div><div style="font-size:0.8em;">UGX ${(customer.totalSpent || 0).toFixed(2)}</div></td>
            <td><span style="background:${customer.status === 'active' ? '#4caf50' : (customer.status === 'pending_verification' ? '#FFBF42' : '#f44336')}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${(customer.status || 'unknown') === 'pending_verification' ? 'PENDING' : (customer.status || 'unknown').toUpperCase()}</span></td>
            <td style="font-size:0.85em; color:#666;">${customer.lastOrder || 'N/A'}</td>
            <td>
                <button onclick="verifyCustomerWhatsApp('${customer.phone}')" class="action-btn-table" style="background:#25D366; color:#fff;">Verify WA</button>
                ${customer.status === 'pending_verification' ? `<button onclick="approveCustomer('${customer.id}')" class="action-btn-table" style="background:#4caf50; color:#fff;">Approve</button>` : `<button onclick="openAdminNotificationModal('${customer.id}', '${customer.name.replace(/'/g, "\\'")}')" class="action-btn-table" style="background:#607d8b; color:#fff;">Notify</button>`}
                <button onclick="contactCustomer('${customer.phone}')" class="action-btn-table" style="background:#2196f3; color:#fff;">Call</button>
                <button onclick="window.toggleAdminItemStatus('customer', '${customer.id}', 'active', 'inactive')" class="action-btn-table" style="background:#9c27b0; color:#fff;">${customer.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                <button onclick="window.openAdminModal('customer', '${customer.id}')" class="action-btn-table" style="background:#ff9800; color:#fff;">Edit</button>
                <button onclick="window.deleteAdminItem('customer', '${customer.id}')" class="action-btn-table" style="background:#f44336; color:#fff;">Delete</button>
            </td>
        </tr>
    `).join('');
}

function verifyCustomerWhatsApp(phone) {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
}

async function approveCustomer(id) {
    const customer = adminCustomers.find(c => c.id == id);
    if (customer) {
        customer.status = 'active';
        showToast(`${customer.name} marked as Active`);
        if(db) {
            try {
                await db.collection('users').doc(customer.id.toString()).update({ isApproved: true });
                
                // Email Notification Trigger
                // This pattern works with the "Trigger Email" Firebase Extension
                if (customer.email) {
                    await db.collection('mail').add({
                        to: customer.email,
                        message: {
                            subject: 'Welcome to Kirya - Account Approved!',
                            html: `<h3>Congratulations ${customer.name}!</h3><p>Your account has been approved by our team. You can now start using the Kirya Delivery app.</p><p>Happy ordering!</p>`
                        }
                    });
                    console.log("Email notification queued for:", customer.email);
                }
            } catch (err) {
                console.error("Database update or email trigger failed:", err);
            }
        }
        renderAdminCustomers();
    }
}

function contactCustomer(phone) {
    window.open(`tel:${phone}`);
}

function renderAdminPromotions() {
    const content = document.getElementById('admin-promotions');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <h3 style="margin-bottom:15px;">🎁 Promotions Management</h3>
            <div style="margin-bottom:20px;">
                <button onclick="addNewPromotion()" style="padding:10px 20px; background:#019E81; color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">+ Add New Promotion</button>
            </div>
            <div id="adminPromotionsList" style="max-height:500px; overflow:auto;">
                ${renderAdminPromotionsList()}
            </div>
        </div>
    `;
}

function renderAdminPromotionsList() {
    return adminPromotions.map(promo => `
        <div style="border:1px solid #eee; border-radius:8px; padding:15px; margin-bottom:10px; background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                <div>
                    <div style="font-weight:800; color:#333; margin-bottom:5px;">${promo.title}</div>
                    <div style="font-size:0.85em; color:#666;">${promo.description}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:600; color:#019E81;">${promo.discount}${promo.type === 'percentage' ? '%' : ' UGX'}</div>
                    <div style="font-size:0.8em; color:#666;">Used: ${promo.usage}</div>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <div style="font-size:0.85em; color:#666;">📅 ${promo.validFrom} to ${promo.validTo}</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="background:${promo.status === 'active' ? '#4caf50' : '#f44336'}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${promo.status.toUpperCase()}</span>
                <div style="display:flex; gap:5px;">
                    <button onclick="togglePromotionStatus(${promo.id})" style="padding:6px 12px; background:#2196f3; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">
                        ${promo.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onclick="editPromotion(${promo.id})" style="padding:6px 12px; background:#ff9800; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">Edit</button>
                </div>
            </div>
        </div>
    `).join('');
}

function togglePromotionStatus(promoId) {
    const promo = adminPromotions.find(p => p.id === promoId);
    if (promo) {
        promo.status = promo.status === 'active' ? 'expired' : 'active';
        showToast(`Promotion ${promo.title} ${promo.status === 'active' ? 'activated' : 'deactivated'}`);
        renderAdminPromotions();
    }
}

function addNewPromotion() {
    openAdminModal('promotion');
}

function toggleAdminItemStatus(type, id, activeStatus = 'active', inactiveStatus = 'inactive') {
    const typeMap = {
        restaurant: { data: adminRestaurants, render: renderAdminRestaurants, storageKey: 'kirya_restaurants' },
        customer: { data: adminCustomers, render: renderAdminCustomers },
        account: { data: adminAccounts, render: renderAdminAccounts }
    };
    const itemConfig = typeMap[type];
    if (!itemConfig) return;

    const item = itemConfig.data.find(i => i.id == id);
    if (item) {
        const newStatus = item.status === activeStatus ? inactiveStatus : activeStatus;
        item.status = newStatus;
        if (itemConfig.storageKey) {
            localStorage.setItem(itemConfig.storageKey, JSON.stringify(itemConfig.data));
        }
        showToast(`Status changed to ${newStatus}.`);
        itemConfig.render();
    }
}

function renderAdminPayments() {
    const content = document.getElementById('admin-payments');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <h3 style="margin-bottom:15px;">💳 Payments Management</h3>
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <button onclick="filterAdminPayments('all')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">All (${adminPayments.length})</button>
                <button onclick="filterAdminPayments('completed')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Completed (${adminPayments.filter(p => p.status === 'completed').length})</button>
                <button onclick="filterAdminPayments('pending')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Pending (${adminPayments.filter(p => p.status === 'pending').length})</button>
                <button onclick="filterAdminPayments('refunded')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Refunded (${adminPayments.filter(p => p.status === 'refunded').length})</button>
            </div>
            <div id="adminPaymentsList" style="max-height:500px; overflow:auto;">
                ${renderAdminPaymentsList('all')}
            </div>
        </div>
    `;
}

function filterAdminPayments(status) {
    const listContainer = document.getElementById('adminPaymentsList');
    if (listContainer) {
        listContainer.innerHTML = renderAdminPaymentsList(status);
    }
}

function renderAdminPaymentsList(status) {
    const filteredPayments = status === 'all' ? adminPayments : adminPayments.filter(p => p.status === status);
    
    return filteredPayments.map(payment => {
        const statusColors = {
            completed: '#4caf50',
            pending: '#ff9800',
            refunded: '#f44336'
        };
        
        const methodIcons = {
            cod: '💵',
            card: '💳',
            wallet: '📱'
        };
        
        return `
            <div style="border:1px solid #eee; border-radius:8px; padding:15px; margin-bottom:10px; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:800; color:#333; margin-bottom:5px;">${payment.id}</div>
                        <div style="font-size:0.85em; color:#666;">${payment.customer} • ${payment.orderId}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:600; color:#019E81;">UGX ${payment.amount.toFixed(2)}</div>
                        <div style="font-size:0.8em; color:#666;">${methodIcons[payment.method]} ${payment.method.toUpperCase()}</div>
                    </div>
                </div>
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.85em; color:#666;">📅 ${new Date(payment.date).toLocaleString()}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="background:${statusColors[payment.status]}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${payment.status.toUpperCase()}</span>
                    <div style="display:flex; gap:5px;">
                        ${payment.status === 'pending' ? `
                            <button onclick="processPayment('${payment.id}')" style="padding:6px 12px; background:#4caf50; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">Process</button>
                        ` : payment.status === 'completed' ? `
                            <button onclick="refundPayment('${payment.id}')" style="padding:6px 12px; background:#f44336; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">Refund</button>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function processPayment(paymentId) {
    const payment = adminPayments.find(p => p.id === paymentId);
    if (payment) {
        payment.status = 'completed';
        showToast(`Payment ${paymentId} processed successfully`);
        renderAdminPayments();
    }
}

function refundPayment(paymentId) {
    const payment = adminPayments.find(p => p.id === paymentId);
    if (payment) {
        payment.status = 'refunded';
        showToast(`Payment ${paymentId} refunded`);
        renderAdminPayments();
    }
}

function renderAdminSupport() {
    const content = document.getElementById('admin-support');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <h3 style="margin-bottom:15px;">🎧 Support Tickets</h3>
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <button onclick="filterAdminSupport('all')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">All (${adminSupportTickets.length})</button>
                <button onclick="filterAdminSupport('open')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Open (${adminSupportTickets.filter(t => t.status === 'open').length})</button>
                <button onclick="filterAdminSupport('in_progress')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">In Progress (${adminSupportTickets.filter(t => t.status === 'in_progress').length})</button>
                <button onclick="filterAdminSupport('closed')" style="padding:8px 16px; border:1px solid #ddd; background:#fff; border-radius:6px; cursor:pointer;">Closed (${adminSupportTickets.filter(t => t.status === 'closed').length})</button>
            </div>
            <div id="adminSupportList" style="max-height:500px; overflow:auto;">
                ${renderAdminSupportList('all')}
            </div>
        </div>
    `;
}

function filterAdminSupport(status) {
    const listContainer = document.getElementById('adminSupportList');
    if (listContainer) {
        listContainer.innerHTML = renderAdminSupportList(status);
    }
}

function renderAdminSupportList(status) {
    const filteredTickets = status === 'all' ? adminSupportTickets : adminSupportTickets.filter(t => t.status === status);
    
    return filteredTickets.map(ticket => {
        const statusColors = {
            open: '#f44336',
            in_progress: '#ff9800',
            closed: '#4caf50'
        };
        
        const priorityColors = {
            low: '#4caf50',
            medium: '#ff9800',
            high: '#f44336'
        };
        
        return `
            <div style="border:1px solid #eee; border-radius:8px; padding:15px; margin-bottom:10px; background:#fff;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:800; color:#333; margin-bottom:5px;">${ticket.id}</div>
                        <div style="font-size:0.85em; color:#666;">${ticket.customer} • ${ticket.subject}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:0.8em; color:${priorityColors[ticket.priority]}; font-weight:600; margin-bottom:5px;">${ticket.priority.toUpperCase()}</div>
                        <div style="font-size:0.8em; color:#666;">${ticket.created}</div>
                    </div>
                </div>
                <div style="margin-bottom:10px;">
                    <div style="font-size:0.85em; color:#666;">Last update: ${ticket.lastUpdate}</div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="background:${statusColors[ticket.status]}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${ticket.status.replace('_', ' ').toUpperCase()}</span>
                    <div style="display:flex; gap:5px;">
                        ${ticket.status === 'open' ? `
                            <button onclick="assignSupportTicket('${ticket.id}')" style="padding:6px 12px; background:#2196f3; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">Assign</button>
                        ` : ticket.status === 'in_progress' ? `
                            <button onclick="closeSupportTicket('${ticket.id}')" style="padding:6px 12px; background:#4caf50; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">Close</button>
                        ` : ''}
                        <button onclick="viewSupportTicket('${ticket.id}')" style="padding:6px 12px; background:#ff9800; color:#fff; border:none; border-radius:4px; font-size:0.8em; cursor:pointer;">View</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function assignSupportTicket(ticketId) {
    const ticket = adminSupportTickets.find(t => t.id === ticketId);
    if (ticket) {
        ticket.status = 'in_progress';
        showToast(`Ticket ${ticketId} assigned to support`);
        renderAdminSupport();
    }
}

function closeSupportTicket(ticketId) {
    const ticket = adminSupportTickets.find(t => t.id === ticketId);
    if (ticket) {
        ticket.status = 'closed';
        showToast(`Ticket ${ticketId} closed`);
        renderAdminSupport();
    }
}

function viewSupportTicket(ticketId) {
    const ticket = adminSupportTickets.find(t => t.id === ticketId);
    if (ticket) {
        const chatScreen = document.getElementById('chatScreen');
        
        // Set Context for Send Button
        chatScreen.dataset.context = 'support_ticket';
        chatScreen.dataset.ticketId = ticketId;
        chatScreen.querySelector('.chat-title').innerHTML = `
            <div style="font-weight:800; color:#333;">${ticket.customer}</div>
            <div style="font-size:0.8em; color:#019E81;">Ticket #${ticketId}</div>
        `;
        chatScreen.classList.add('active');
        if (window.setupChatListener) window.setupChatListener(ticketId);
    }
}

function renderAdminAccounts() {
    const content = document.getElementById('admin-accounts');
    if (!content) return;
    
    const listHtml = adminAccounts.map(acc => `
        <tr>
            <td>
                <div onclick="triggerAdminPhotoUpload('admin_accounts', '${acc.id}', 'profilePhoto')" style="width:35px; height:35px; background:#f0f0f0; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #eee; cursor:pointer;" title="Upload Photo">
                    ${window.getImageHtml(acc.profilePhoto, '🔐')}
                </div>
            </td>
            <td><div style="font-weight:bold;">${acc.name || 'N/A'}</div><div style="font-size:0.8em; color:#666;">${acc.role || 'Admin'}</div></td>
            <td>${acc.phone || '<span style="color:#999; font-style:italic;">No Phone</span>'}</td>
            <td>${acc.email || '<span style="color:#999; font-style:italic;">No Email</span>'}</td>
            <td>${window.formatRelativeTime(acc.lastLogin)}</td>
            <td><span style="background:${acc.status === 'active' ? '#4caf50' : '#f44336'}; color:#fff; padding:4px 8px; border-radius:12px; font-size:0.75em; font-weight:600;">${(acc.status || 'unknown').toUpperCase()}</span></td>
            <td>
                <button onclick="window.toggleAdminItemStatus('account', '${acc.id}')" class="action-btn-table" style="background:#2196f3; color:#fff;">${acc.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                <button onclick="window.openAdminModal('account', '${acc.id}')" class="action-btn-table" style="background:#ff9800; color:#fff;">Edit</button>
                <button onclick="window.deleteAdminItem('account', '${acc.id}')" class="action-btn-table" style="background:#f44336; color:#fff;">Delete</button>
            </td>
        </tr>
    `).join('');

    content.innerHTML = `
        <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0;">🔐 Admin Accounts</h3>
                <button onclick="openAdminModal('account')" style="padding:8px 12px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:0.9em;">+ Add Admin</button>
            </div>
            <div style="overflow-x:auto;">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Photo</th>
                            <th>Name & Role</th>
                            <th>Phone</th>
                            <th>Email</th>
                            <th>Last Login</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${listHtml}</tbody>
                </table>
            </div>
        </div>
    `;
}

function toggleMissingPhotoFilter(checked) {
    sortState.customers.missingPhoto = checked;
    renderAdminCustomers();
}

function setupPreview(inputIds, previewId, fallback = '🖼️') {
    const ids = Array.isArray(inputIds) ? inputIds : [inputIds];
    const preview = document.getElementById(previewId);
    const removeBtn = document.getElementById(previewId + 'Remove');
    if (!preview) return;

    const update = async () => {
        const updateId = (previewLatestUpdateIds[previewId] || 0) + 1;
        previewLatestUpdateIds[previewId] = updateId;
        
        let foundSource = false;

        for (const id of ids) {
            const input = document.getElementById(id);
            if (!input) continue;
            
            // Initial reset of border color
            if (input.type !== 'file') input.style.borderColor = '#ddd';
            
            if (input.type === 'file' && input.files && input.files[0]) {
                const reader = new FileReader();
                reader.onload = (e) => { 
                    if (previewLatestUpdateIds[previewId] === updateId) {
                        preview.innerHTML = window.getImageHtml(e.target.result, fallback); 
                        if (removeBtn) removeBtn.style.display = 'block';
                    }
                };
                reader.readAsDataURL(input.files[0]);
                foundSource = true;
                break;
            }
            
            const val = input.value.trim();
            if (val) {
            const hasExt = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(val);
            const isUrl = val.startsWith('data:image/') || val.includes('://') || (val.includes('assets/') && hasExt);
                if (isUrl) {
                    preview.innerHTML = `<div class="preview-spinner" style="width:20px; height:20px; border:2px solid #f3f3f3; border-top:2px solid #019E81; border-radius:50%; animation:spin 1s linear infinite;"></div>`;
                    const isValid = await window.validateImageUrl(val);
                    if (previewLatestUpdateIds[previewId] === updateId) {
                        // HIGHLIGHT: Green if valid image found, Red if it 404s or is invalid
                        input.style.borderColor = isValid ? '#019E81' : '#ff4757';
                        preview.innerHTML = window.getImageHtml(isValid ? val : '', fallback);
                        if (removeBtn) removeBtn.style.display = isValid ? 'block' : 'none';
                    }
                    foundSource = true;
                    break;
                } else if (val.length < 5) {
                    preview.innerHTML = window.getImageHtml(val, fallback);
                    if (removeBtn) removeBtn.style.display = 'block';
                    foundSource = true;
                    break;
                }
            }
        }
        
        if (!foundSource && previewLatestUpdateIds[previewId] === updateId) {
            preview.innerHTML = window.getImageHtml('', fallback);
            if (removeBtn) removeBtn.style.display = 'none';
        }
    };

    if (removeBtn) {
        removeBtn.onclick = async (e) => {
            e.preventDefault();
            const confirmed = await window.customPopup({ title: 'Clear Image', message: 'Are you sure you want to remove this image selection?', type: 'confirm' });
            if (!confirmed) return;

            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    if (el.type === 'file') el.value = null;
                    else el.value = '';
                }
            });
            update();
        };
    }

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', update);
            el.addEventListener('change', update);
        }
    });
    update();
}

async function triggerAdminPhotoUpload(collection, id, field) {
    const dataMap = { 'restaurants': adminRestaurants, 'riders': adminRiders, 'users': adminCustomers, 'admin_accounts': adminAccounts };
    const list = dataMap[collection];
    const item = list ? list.find(i => i.id == id) : null;
    const hasPhoto = item ? !!item[field] : (id === 'current' && window.currentUser ? !!window.currentUser[field] : false);

    const actions = ['upload', 'link'];
    if (hasPhoto) actions.push('remove');

    const method = await customPopup({
        title: 'Update Photo',
        message: `Select a method: ${actions.join(', ')}`,
        type: 'prompt',
        defaultValue: 'upload',
        placeholder: 'e.g. upload, link or remove'
    });

    if (method === 'upload') {
        const input = document.getElementById('adminUniversalPhotoInput');
        input.onchange = (e) => handleAdminUniversalPhotoUpload(e, collection, id, field);
        input.click();
    } else if (method === 'link') {
        const url = await customPopup({ title: 'Image Path', message: 'Paste the URL or local path (e.g. assets/menu/burger.jpg):', type: 'prompt' });
        if (url && (url.startsWith('http') || url.startsWith('assets/'))) {
            const updateData = { [field]: url };
            if (db && id !== 'current') {
                try { await db.collection(collection).doc(id.toString()).update(updateData); } catch (e) { console.error(e); }
            }

            // Update local mocks
            if (list) {
                const itm = list.find(i => i.id == id);
                if (itm) {
                    itm[field] = url;
                    if (collection === 'restaurants') localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
                    if (collection === 'riders') syncRiders();
                }
            }

            // Update current user if applicable
            if (id === 'current' || (window.currentUser && id == window.currentUser.id)) {
                window.currentUser[field] = url;
                saveUserProfile(false);
                updateProfileUI();
            }

            showToast("Photo updated!");
            renderAdminTabContent(getCurrentAdminTab());
        }
    } else if (method === 'remove') {
        await handlePhotoRemoval(collection, id, field);
    }
}

window.handlePhotoRemoval = async function(collection, id, field) {
    const dataMap = { 'restaurants': adminRestaurants, 'riders': adminRiders, 'users': adminCustomers, 'admin_accounts': adminAccounts };
    const list = dataMap[collection];
    const item = list ? list.find(i => i.id == id) : null;
    const currentUrl = item ? item[field] : (id === 'current' && window.currentUser ? window.currentUser[field] : null);

    if (!currentUrl) {
        showToast("No photo to remove.");
        return;
    }

    const confirmed = await customPopup({ title: 'Remove Photo', message: 'Delete this photo from storage?', type: 'confirm' });
    if (!confirmed) return;

    window.showLoading("Removing Photo...");
    
    // 1. Delete from Storage if it's a Storage URL
    await window.deleteImageFromStorage(currentUrl);

    // 2. Update Firestore/Local Data
    const updateData = { [field]: null };
    
    if (db && id !== 'current') {
        try {
            await db.collection(collection).doc(id.toString()).update(updateData);
        } catch (e) { console.error(e); }
    }

    // Update local mocks
    if (item) {
        item[field] = null;
        if (collection === 'restaurants') localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
        if (collection === 'riders') syncRiders();
    }

    // Update current user if applicable
    if (id === 'current' || (window.currentUser && id == window.currentUser.id)) {
        window.currentUser[field] = null;
        saveUserProfile(true);
        updateProfileUI();
    }

    window.hideLoading();
    showToast("Photo removed successfully!");
    renderAdminTabContent(getCurrentAdminTab());
};

async function handleAdminUniversalPhotoUpload(event, collection, id, field) {
    const file = event.target.files[0];
    if (!file) return;

    window.showLoading("Optimizing Image...");
    try {
        const blob = await compressImage(file);
        
        // Resolve ID and Collection if 'current'
        const isCurrent = id === 'current' || (window.currentUser && id == window.currentUser.id);
        const actualId = isCurrent ? window.currentUser.id : id;
        const isMockId = actualId && (actualId.toString().startsWith('mock_') || !isNaN(actualId));
        
        let actualCollection = collection;
        if (isCurrent && window.currentUser) {
            actualCollection = window.currentUser._collection || 'users';
        }

        let folder = 'others';
        if (actualCollection === 'restaurants') folder = 'vendors';
        else if (actualCollection === 'riders') folder = 'riders';
        else if (actualCollection === 'admin_accounts') folder = 'admins';
        else if (actualCollection === 'users') folder = 'users';

        // Hierarchical Path: folder/UID/filename.jpg (Matches Security Rules)
        const fileName = `${field}_${Date.now()}.jpg`;
        const path = `${folder}/${actualId}/${fileName}`;
        
        window.showLoading("Uploading Photo...", 0);
        
        const url = await uploadImageToStorage(blob, path, (progress) => {
            window.showLoading("Uploading Photo...", progress);
        });

        addToRecentUploads(url);

        if (db && !isMockId) {
            await db.collection(actualCollection).doc(actualId.toString()).update({ [field]: url });
        }
        
        // Update local mock data
        const dataMap = { 'restaurants': adminRestaurants, 'riders': adminRiders, 'users': adminCustomers, 'admin_accounts': adminAccounts };
        const list = dataMap[collection];
        if (list) {
            const item = list.find(i => i.id == id);
            if (item) {
                item[field] = url;
                if (collection === 'restaurants') localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
                if (collection === 'riders') syncRiders();
            }
        }
        
        // If updating current user's own profile
        if (id === 'current' || (window.currentUser && id == window.currentUser.id)) {
            window.currentUser[field] = url;
            saveUserProfile(false);
            updateProfileUI();
        }
        
        window.hideLoading();
        showToast("Photo updated successfully!");
        renderAdminTabContent(getCurrentAdminTab());
    } catch (err) {
        console.error("Upload error", err);
        window.hideLoading();
        showToast("Failed to upload photo.");
    }
}

async function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width, height = img.height;
                if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
                else { if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; } }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality);
            };
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function getCurrentAdminTab() {
    const activeItem = document.querySelector('.sidebar-item.active');
    if (!activeItem) return 'dashboard';
    const onclick = activeItem.getAttribute('onclick');
    return onclick.match(/'([^']+)'/)[1];
}

let targetCustomerForNotif = null;
function openAdminNotificationModal(id, name) {
    targetCustomerForNotif = id;
    document.getElementById('adminNotifModalTitle').textContent = `Notify ${name}`;
    document.getElementById('adminNotifSubject').value = '';
    document.getElementById('adminNotifMessage').value = '';
    document.getElementById('adminNotificationModal').style.display = 'flex';
}

function closeAdminNotificationModal() {
    document.getElementById('adminNotificationModal').style.display = 'none';
}

async function sendAdminNotificationToUser() {
    const subject = document.getElementById('adminNotifSubject').value.trim();
    const msg = document.getElementById('adminNotifMessage').value.trim();
    if(!subject || !msg) { showToast('Please fill all fields'); return; }

    const newNotif = {
        type: 'info',
        title: subject,
        body: msg,
        time: new Date().toLocaleString(),
        unread: true,
        role: 'user'
    };

    if(db) {
        try {
            const docRef = db.collection('customers').doc(targetCustomerForNotif.toString());
            const doc = await docRef.get();
            if(doc.exists) {
                const data = doc.data();
                const userNotifs = data.notifications || [];
                userNotifs.unshift(newNotif);
                await docRef.update({ notifications: userNotifs });
                showToast('Notification sent to user!');
            }
        } catch(e) { console.error(e); showToast('Database sync failed'); }
    } else {
        showToast('Notification sent (local mock)');
}
}

function editRider(id) {
    openAdminModal('rider', id);
}

function editPromotion(id) {
    openAdminModal('promotion', id);
}

function toggleRiderAccountStatus(riderId) {
    const rider = adminRiders.find(r => r.id === riderId);
    if (rider) {
        const newStatus = rider.accountStatus === 'active' ? 'suspended' : 'active';
        rider.accountStatus = newStatus;
        showToast(`Rider ${rider.name} is now ${newStatus}.`);
        renderAdminRiders();
    }
}

function renderAdminConfig() {
    const content = document.getElementById('admin-config');
    if (!content) return;
    
    const isConnected = typeof firebase !== 'undefined' && firebase.apps.length > 0;
    
    content.innerHTML = `
        <div class="dashboard-card">
            <h3 style="margin-bottom:15px;">⚙️ Configuration</h3>
            <div style="background:#f9f9f9; padding:15px; border-radius:8px; border:1px solid #eee; margin-bottom:20px;">
                <h4 style="margin-bottom:10px;">🔥 Firebase Connection</h4>
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="width:10px; height:10px; border-radius:50%; background:${isConnected ? '#4caf50' : '#f44336'};"></div>
                    <div style="font-weight:bold; color:#333;">${isConnected ? 'Connected' : 'Not Connected'}</div>
                </div>
                <div style="font-family:monospace; background:#333; color:#fff; padding:10px; border-radius:6px; font-size:0.8em; margin-bottom:10px;">
                    Project ID: ${firebaseConfig.projectId || 'Unknown'}<br>
                    Auth Domain: ${firebaseConfig.authDomain || 'Unknown'}
                </div>
                <div style="display:flex; gap:10px;">
                    <button onclick="initFirebase()" style="padding:10px 15px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer;">${isConnected ? 'Reconnect' : 'Connect'}</button>
                </div>
            </div>
            <div class="dashboard-card">
                <h4 style="margin-bottom:10px;">📂 Data Migration</h4>
                <p style="font-size:0.9em; color:#666; margin-bottom:10px;">Upload current local sample data (Orders, Riders, Restaurants) to Firebase Firestore.</p>
                <button onclick="seedDatabase()" style="padding:12px 20px; background:#FFBF42; color:#333; border:none; border-radius:6px; font-weight:bold; cursor:pointer;">⬆️ Upload Sample Data to Firebase</button>
            </div>
        </div>
    `;
}

function renderAdminAnalytics() {
    try {
        const content = document.getElementById('admin-analytics');
        if (!content) return;

        // Ensure data exists
        const orders = window.allOrders || adminOrders || [];
        const riders = adminRiders || [];

        // Calculate live stats from all available data
        const totalOrders = orders.length;
        const totalRevenue = orders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0);
        const totalCustomers = [...new Set(orders.map(o => o.customerPhone))].length;
        const totalRiders = riders.length;
        const totalTips = orders.reduce((sum, o) => sum + (o.tip || 0), 0);
        
        content.innerHTML = `
            <div style="overflow-y:auto; height:100%; padding-bottom:80px;">
            <div class="dashboard-card">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <h3 style="margin:0;">📈 Detailed Analytics</h3>
                <div style="display:flex; gap:10px; align-items:center;">
                    <input type="date" id="analyticsStart" style="padding:6px; border:1px solid #ddd; border-radius:6px;">
                    <span style="color:#666;">to</span>
                    <input type="date" id="analyticsEnd" style="padding:6px; border:1px solid #ddd; border-radius:6px;">
                    <button onclick="updateAdminAnalyticsDate()" style="padding:6px 12px; background:#019E81; color:#fff; border:none; border-radius:6px; cursor:pointer;">Filter</button>
                    <button onclick="exportTipReportPDF()" style="padding:6px 12px; background:#FFBF42; color:#333; border:none; border-radius:6px; cursor:pointer;">💰 Tip Report</button>
                    <button onclick="exportAnalyticsPDF()" style="padding:6px 12px; background:#333; color:#fff; border:none; border-radius:6px; cursor:pointer;">📄 Export Report</button>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:15px; margin-bottom:20px;">
                <div style="padding:20px; background:#e0f2f1; border-radius:12px; text-align:center;">
                    <div style="font-size:2em; font-weight:900; color:#019E81; margin-bottom:5px;">${totalOrders.toLocaleString()}</div>
                    <div style="font-size:0.9em; color:#666;">Total Orders</div>
                </div>
                <div style="padding:20px; background:#fff8e1; border-radius:12px; text-align:center;">
                    <div style="font-size:2em; font-weight:900; color:#FFB800; margin-bottom:5px;">UGX ${totalRevenue.toLocaleString()}</div>
                    <div style="font-size:0.9em; color:#666;">Total Revenue</div>
                </div>
                <div style="padding:20px; background:#f0e6ff; border-radius:12px; text-align:center;">
                    <div style="font-size:2em; font-weight:900; color:#9c27b0; margin-bottom:5px;">${totalCustomers.toLocaleString()}</div>
                    <div style="font-size:0.9em; color:#666;">Total Customers</div>
                </div>
                <div style="padding:20px; background:#ffebee; border-radius:12px; text-align:center;">
                    <div style="font-size:2em; font-weight:900; color:#f44336; margin-bottom:5px;">${totalRiders}</div>
                    <div style="font-size:0.9em; color:#666;">Active Riders</div>
                </div>
                <div style="padding:20px; background:#e3f2fd; border-radius:12px; text-align:center;">
                    <div style="font-size:2em; font-weight:900; color:#2196f3; margin-bottom:5px;">UGX ${totalTips.toLocaleString()}</div>
                    <div style="font-size:0.9em; color:#666;">Total Tips</div>
                </div>
            </div>
            
            <!-- Additional Stats Row -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:15px; margin-bottom:25px;">
                <div style="padding:15px; border:1px solid #eee; border-radius:12px; display:flex; align-items:center; gap:15px;">
                    <div style="font-size:1.5em; background:#f5f5f5; width:50px; height:50px; border-radius:50%; display:flex; align-items:center; justify-content:center;">⏱️</div>
                    <div><div style="font-weight:bold; font-size:1.1em;">24m</div><div style="font-size:0.8em; color:#666;">Avg Delivery Time</div></div>
                </div>
                <div style="padding:15px; border:1px solid #eee; border-radius:12px; display:flex; align-items:center; gap:15px;">
                    <div style="font-size:1.5em; background:#f5f5f5; width:50px; height:50px; border-radius:50%; display:flex; align-items:center; justify-content:center;">⭐</div>
                    <div><div style="font-weight:bold; font-size:1.1em;">4.8</div><div style="font-size:0.8em; color:#666;">Avg Customer Rating</div></div>
                </div>
                <div style="padding:15px; border:1px solid #eee; border-radius:12px; display:flex; align-items:center; gap:15px;">
                    <div style="font-size:1.5em; background:#f5f5f5; width:50px; height:50px; border-radius:50%; display:flex; align-items:center; justify-content:center;">🔄</div>
                    <div><div style="font-weight:bold; font-size:1.1em;">85%</div><div style="font-size:0.8em; color:#666;">Retention Rate</div></div>
                </div>
            </div>
            
            <!-- Analytics Charts Grid -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px; margin-bottom:25px;">
                <div class="dashboard-card" style="margin:0;">
                    <h4 style="margin-bottom:15px; font-weight:700;">Revenue Overview</h4>
                    <div style="height:220px; width:100%;"><canvas id="analyticsRevenueChart"></canvas></div>
                </div>
                <div class="dashboard-card" style="margin:0;">
                    <h4 style="margin-bottom:15px; font-weight:700;">Sales by Location</h4>
                    <div style="height:220px; width:100%;"><canvas id="analyticsLocationChart"></canvas></div>
                </div>
            </div>
            
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:20px;">
                <div class="dashboard-card" style="margin:0;">
                    <h4 style="margin-bottom:15px; font-weight:700;">Peak Ordering Hours</h4>
                    <div style="height:220px; width:100%;"><canvas id="analyticsHourlyChart"></canvas></div>
                </div>
                <div class="dashboard-card" style="margin:0;">
                    <h4 style="margin-bottom:15px; font-weight:700;">Loyalty Program</h4>
                    <div style="height:220px; width:100%;"><canvas id="analyticsLoyaltyChart"></canvas></div>
                </div>
                <div class="dashboard-card" style="margin:0;">
                    <h4 style="margin-bottom:15px; font-weight:700;">Commission by Category</h4>
                    <div style="height:220px; width:100%;"><canvas id="analyticsCommissionChart"></canvas></div>
                </div>
            </div>
        </div>
        </div>
    `;
        setTimeout(() => {
            try { initAdminCharts(); } catch(e) { console.warn("Analytics Chart Init Error:", e); }
        }, 100);
    } catch(e) {
        console.error("Analytics Render Error:", e);
    }
}

async function exportTipReportPDF() {
    // Ensure jspdf is loaded
    if (!window.jspdf) { showToast("PDF Library loading..."); return; }
    
    const { jsPDF } = window.jspdf;
    
    // Create a temporary container for the report
    const reportDiv = document.createElement('div');
    reportDiv.style.cssText = 'position:fixed; top:-9999px; left:0; width:800px; padding:40px; background:#fff; font-family:sans-serif; color:#333;';
    
    // Generate Report Data (Aggregated by Rider)
    const tipsByRider = {};
    adminOrders.forEach(o => {
        if (o.rider && o.tip > 0) {
            if (!tipsByRider[o.rider]) tipsByRider[o.rider] = 0;
            tipsByRider[o.rider] += o.tip;
        }
    });
    
    let rows = Object.entries(tipsByRider).map(([rider, amount]) => 
        `<tr style="border-bottom:1px solid #eee;"><td style="padding:10px;">${rider}</td><td style="padding:10px; text-align:right;">UGX ${amount.toLocaleString()}</td></tr>`
    ).join('');

    if(rows === '') rows = '<tr><td colspan="2" style="padding:15px; text-align:center;">No tips recorded for this period.</td></tr>';

    reportDiv.innerHTML = `
        <h1 style="color:#019E81; text-align:center; margin-bottom:10px;">Monthly Tip Report</h1>
        <p style="text-align:center; color:#666; margin-bottom:30px;">Generated on ${new Date().toLocaleDateString()}</p>
        <table style="width:100%; border-collapse:collapse;">
            <thead><tr style="background:#f9f9f9; text-align:left;"><th style="padding:10px;">Rider Name</th><th style="padding:10px; text-align:right;">Total Tips</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:30px; text-align:right; font-weight:bold; font-size:1.2em;">Total Distributed: UGX ${Object.values(tipsByRider).reduce((a,b)=>a+b,0).toLocaleString()}</div>
    `;

    document.body.appendChild(reportDiv);
    
    try {
        const canvas = await html2canvas(reportDiv);
        const pdf = new jsPDF('p', 'mm', 'a4');
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 10, 190, 0); // width 190mm, auto height
        pdf.save(`Tip_Report_${new Date().toISOString().slice(0,7)}.pdf`);
        showToast('Tip Report downloaded');
    } catch(e) {
        console.error(e);
        showToast('Failed to generate report');
    } finally {
        document.body.removeChild(reportDiv);
    }
}

function updateAdminAnalyticsDate() {
    const start = document.getElementById('analyticsStart').value;
    const end = document.getElementById('analyticsEnd').value;
    if(!start || !end) { showToast('Please select start and end dates'); return; }
    
    // Generate dynamic filtered data for visualization
    const diffTime = Math.abs(new Date(end) - new Date(start));
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1; 
    
    // Update stats based on "filtered" range
    adminAnalytics.totalOrders = Math.floor(Math.random() * 20 * diffDays) + 10;
    adminAnalytics.totalRevenue = adminAnalytics.totalOrders * (30 + Math.random() * 50);
    adminAnalytics.ordersToday = Math.floor(adminAnalytics.totalOrders / diffDays);
    adminAnalytics.revenueToday = Math.floor(adminAnalytics.totalRevenue / diffDays);

    // Re-render the charts by clearing and re-initializing
    if(adminChartsInstances['adminRevenueChart']) {
        const chart = adminChartsInstances['adminRevenueChart'];
        // Update data to simulate filter result
        chart.data.labels = Array.from({length: Math.min(diffDays, 7)}, (_, i) => `Day ${i+1}`);
        chart.data.datasets[0].data = Array.from({length: Math.min(diffDays, 7)}, () => Math.floor(Math.random() * 50000) + 5000);
        chart.update();
    }
    
    // Also refresh the stats cards
    renderAdminAnalytics();
    
    // Restore date inputs since re-render clears them
    setTimeout(() => {
        const sInput = document.getElementById('analyticsStart');
        const eInput = document.getElementById('analyticsEnd');
        if(sInput) sInput.value = start;
        if(eInput) eInput.value = end;
    }, 50);
}

window.exportAnalyticsPDF = async function() {
    // Ensure jspdf is loaded
    if (!window.jspdf) {
        showToast("PDF Library loading...");
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const content = document.querySelector('#admin-analytics .dashboard-card'); // Target the main card
    if (!content) return;
    
    showToast('Generating PDF Report...');
    
    try {
        const canvas = await html2canvas(content, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/png');
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.text("Admin Analytics Report", 10, 10);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, 10, 16);
        pdf.addImage(imgData, 'PNG', 0, 20, pdfWidth, pdfHeight);
        
        pdf.save(`Admin_Analytics_${new Date().toISOString().slice(0,10)}.pdf`);
        showToast('PDF Downloaded successfully!');
    } catch (e) {
        console.error("PDF Export Error:", e);
        showToast('Error generating PDF. Please try again.');
    }
};

function sortAdminTable(type, col) {
    if (sortState[type].col === col) {
        sortState[type].asc = !sortState[type].asc;
    } else {
        sortState[type].col = col;
        sortState[type].asc = true;
    }
    
    const dataMap = { orders: adminOrders, restaurants: adminRestaurants, riders: adminRiders, customers: adminCustomers };
    const data = dataMap[type];
    const asc = sortState[type].asc;
    
    const statusPriority = {
        'pending': 1, 'new': 1,
        'confirmed': 2, 'processing': 2,
        'preparing': 3,
        'ready': 4,
        'rider_assigned': 5,
        'rider_picking': 6,
        'rider_delivering': 7,
        'delivered': 8, 'completed': 8,
        'cancelled': 9, 'rejected': 9, 'refunded': 9,
        'online': 1, 'active': 1, 'open': 1,
        'busy': 2, 'in_progress': 2,
        'offline': 3, 'inactive': 3, 'closed': 3, 'expired': 3
    };

    data.sort((a, b) => {
        let valA = a[col];
        let valB = b[col];
        
        if (col === 'status') {
            const pA = statusPriority[valA] || 99;
            const pB = statusPriority[valB] || 99;
            if (pA !== pB) return asc ? pA - pB : pB - pA;
        }

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        
        if (valA < valB) return asc ? -1 : 1;
        if (valA > valB) return asc ? 1 : -1;
        return 0;
    });
    
    // Refresh current view
    if(type === 'orders') renderAdminOrders();
    else if(type === 'restaurants') renderAdminRestaurants();
    else if(type === 'riders') renderAdminRiders();
    else if(type === 'customers') renderAdminCustomers();
    
    // Restore active tab display logic usually handled by switchAdminTab
    document.querySelectorAll('.admin-tab-content').forEach(tab => tab.style.display = 'none');
    document.getElementById(`admin-${type}`).style.display = 'block';
    
    showToast(`Sorted by ${col} ${asc ? 'ascending' : 'descending'}`);
}

async function switchAdminTab(tabName) {
    try {
        // Manage Auto-Update for Dashboard Charts
        if (adminChartUpdateInterval) {
            clearInterval(adminChartUpdateInterval);
            adminChartUpdateInterval = null;
        }
        if (tabName === 'dashboard') {
            adminChartUpdateInterval = setInterval(updateAdminChartsData, 30000);
        }

        // Hide all tabs
        document.querySelectorAll('.admin-tab-content').forEach(tab => {
            tab.style.display = 'none';
        });
        
        // Remove active class from all sidebar items
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Show selected tab
        const selectedTab = document.getElementById(`admin-${tabName}`);
        if (selectedTab) selectedTab.style.display = 'block';
        
        const contentContainer = document.getElementById('adminContent');
        if(contentContainer) contentContainer.scrollTop = 0;
        
        // PERFORMANCE: Load data only when needed (Avoid global snapshots)
        // Skip remote fetch for mock users or if not authenticated to prevent Permission Denied errors
        const isMockUser = currentUser.id && (currentUser.id.toString().startsWith('mock_') || !isNaN(currentUser.id));
        const isAuthenticated = window.auth && window.auth.currentUser;

        if (!isMockUser && isAuthenticated && ['restaurants', 'vendors', 'customers', 'promotions', 'payments', 'support', 'accounts', 'logs'].includes(tabName)) {
            if (window.db) {
                showToast(`Loading ${tabName}...`);
                const collectionName = (tabName === 'customers') ? 'users' : (tabName === 'accounts' ? 'admin_accounts' : (tabName === 'vendors' ? 'restaurants' : tabName));
                const items = (tabName === 'promotions' || tabName === 'payments' || tabName === 'support' || tabName === 'accounts') 
                    ? await window.fetchCollectionOnce(collectionName).catch(err => {
                        console.warn(`Fetch for ${tabName} failed (Likely permissions). Using local data.`);
                        return [];
                    })
                    : await window.fetchPaginatedCollection(collectionName, true).catch(err => {
                        console.warn(`Paginated fetch for ${tabName} failed.`);
                        return [];
                    });
                
                if (items && items.length > 0) {
                    if (tabName === 'restaurants') adminRestaurants = items;
                    else if (tabName === 'customers') adminCustomers = items;
                    else if (tabName === 'promotions') adminPromotions = items;
                    else if (tabName === 'payments') adminPayments = items;
                    else if (tabName === 'support') adminSupportTickets = items;
                    else if (tabName === 'accounts') adminAccounts = items;
                    else if (tabName === 'logs') adminLogs = items;
                } else {
                    console.log(`Firebase collection '${collectionName}' is empty or missing. Retaining local mock data.`);
                }
            }
        }

        // Add active class to sidebar item corresponding to tabName
        const activeItem = document.querySelector(`.sidebar-item[onclick*="${tabName}"]`);
        if(activeItem) activeItem.classList.add('active');
        
        // Update title
        const titles = {
            dashboard: '📊 Overview',
            livemap: '🗺️ Live Map',
            orders: '📦 Orders',
            restaurants: '🏪 Restaurants',
            vendors: '🏪 Vendors',
            riders: '🚴‍♂️ Riders',
            customers: '👥 Customers',
            promotions: '🎁 Promotions',
            payments: '💳 Payments',
            support: '🎧 Support Tickets',
            analytics: '📈 Analytics',
            config: '⚙️ Configuration',
            accounts: '🔐 Admin Accounts',
            logs: '📋 Activity Logs'
        };
        
        const titleEl = document.getElementById('adminTabTitle');
        if(titleEl) titleEl.textContent = titles[tabName] || 'Admin Panel';
        
        // Render content for the selected tab
        renderAdminTabContent(tabName);
        
        // Close sidebar on mobile after selection
        if (window.innerWidth <= 768) {
            closeAdminSidebar();
        }
    } catch(e) {
        console.error("Switch Admin Tab Error:", e);
        showToast("Error switching tab. Check console.");
    }
}


async function initAdminLiveMap() {
    const container = document.getElementById('adminMapContainer');
    if(!container) return;

    if (adminMap) {
        setTimeout(() => adminMap.invalidateSize(), 100);
        adminMap.invalidateSize(); // Immediate call for speed
        return;
    }

    try {
        await loadLeaflet();
    } catch (e) {
        console.error(e.message);
        showToast("⚠️ Map Error: Leaflet library failed to load. Please refresh the page.");
        libStatus.Leaflet = 'failed';
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:15px; padding:20px; text-align:center; background:#f9f9f9;">
                <div style="font-size:3em;">📡</div>
                <div style="font-weight:bold; color:#333;">Map Library Load Failed</div>
                <p style="font-size:0.85em; color:#666; max-width:250px;">This can be caused by slow internet or an ad-blocker blocking map tiles.</p>
                <button onclick="initAdminLiveMap()" style="padding:10px 20px; background:#019E81; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Retry Loading Map</button>
            </div>
        `;
        return;
    }

    if (adminMap) return; // Check again after await
    libStatus.Leaflet = 'ready';

    adminMap = window.L.map('adminMapContainer', { zoomControl: false }).setView([24.4539, 54.3773], 13);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(adminMap);
    window.L.control.zoom({ position: 'bottomright' }).addTo(adminMap);

    // Init Screenshoter
    if (window.L.simpleMapScreenshoter) {
        adminMap.screenshoter = window.L.simpleMapScreenshoter({ hidden: true }).addTo(adminMap);
    }

    adminLayers.riders = window.L.layerGroup().addTo(adminMap);
    adminLayers.vendors = window.L.layerGroup().addTo(adminMap);
    adminLayers.customers = window.L.layerGroup().addTo(adminMap);
    adminLayers.zones = window.L.layerGroup().addTo(adminMap);

    const center = { lat: 24.4539, lng: 54.3773 };
    
    // Mock Zones
    // Using window.adminZones to persist if needed, or just let them re-init for now
    const zones = window.adminZones || [
        { name: 'City Center Zone', color: '#019E81', center: [24.455, 54.382], radius: 1200 },
        { name: 'Beach Zone', color: '#FFBF42', center: [24.468, 54.372], radius: 1000 }
    ];
    
    // Helper to calculate orders in zone
    const getOrdersInZone = (center, radius) => {
        if(!adminOrders) return 0;
        const c = window.L.latLng(center);
        return adminOrders.filter(o => {
            // Use mock coords from adminOrders updated list
            if(o.lat && o.lng) {
                return c.distanceTo([o.lat, o.lng]) <= radius;
            }
            return false;
        }).length;
    };

    const addZoneToMap = (z) => {
        const count = getOrdersInZone(z.center, z.radius);
        const assignedText = z.assignedRiders ? `<br>Riders: <b>${z.assignedRiders}</b>` : '';
        window.L.circle(z.center, { color: z.color, fillOpacity: 0.15, weight: 2, radius: z.radius })
        .bindPopup(`<div style="text-align:center;"><b>${z.name}</b><br>Active Orders: <b>${count}</b>${assignedText}</div>`)
        .addTo(adminLayers.zones);
    };

    zones.forEach(z => addZoneToMap(z));

    // Drawing Logic Listeners
    adminMap.on('click', async (e) => {
        if(!adminDraw.active) return;
        if(!adminDraw.center) {
            adminDraw.center = e.latlng;
            adminDraw.circle = window.L.circle(adminDraw.center, {color: '#ff4757', weight: 2, fillOpacity: 0.1}).addTo(adminMap);
            showToast('Move mouse to set size. Click to finish.');
            adminMap.on('mousemove', onAdminDrawMove);
        } else {
            // Finish drawing
            adminMap.off('mousemove', onAdminDrawMove);
            const radius = adminDraw.circle.getRadius();
            const name = await customPopup({ title: 'New Zone', message: "Enter Zone Name:", type: 'prompt', defaultValue: "New Zone" });
            if(name) {
                const riders = await customPopup({ title: 'Assign Riders', message: "Assign Riders (comma separated Names):", type: 'prompt', defaultValue: "Ahmed, Sarah" });
                const zone = { name, color: '#ff4757', center: [adminDraw.center.lat, adminDraw.center.lng], radius, assignedRiders: riders };
                adminMap.removeLayer(adminDraw.circle); // Remove temp
                addZoneToMap(zone); // Add permanent with popup
                
                // Persist locally for session
                if(!window.adminZones) window.adminZones = zones;
                window.adminZones.push(zone);
                
                showToast(`Zone "${name}" added`);
            } else {
                adminMap.removeLayer(adminDraw.circle);
            }
            // Reset
            adminDraw.center = null;
            adminDraw.circle = null;
            adminDraw.active = false;
            document.getElementById('adminMapContainer').style.cursor = '';
        }
    });

    // Mock Vendors
    adminRestaurants.forEach((r) => {
        const lat = center.lat + (Math.random() - 0.5) * 0.05;
        const lng = center.lng + (Math.random() - 0.5) * 0.05;
        const m = window.L.marker([lat, lng], {
            icon: window.L.divIcon({ 
                html: `<div style="width:40px; height:40px; border-radius:50%; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); overflow:hidden; background:white; display:flex; align-items:center; justify-content:center;">
                        ${window.getImageHtml(r.profilePhoto, '🏪')}
                       </div>`, 
                className: '', 
                iconSize: [40, 40], 
                iconAnchor: [20, 20] 
            })
        }).bindPopup(`<b>${r.name}</b><br>${r.category}<br>${r.status}`);
        adminLayers.vendors.addLayer(m);
    });

    // Mock Riders
    adminRiders.forEach((r) => {
        const lat = center.lat + (Math.random() - 0.5) * 0.06;
        const lng = center.lng + (Math.random() - 0.5) * 0.06;
        const m = window.L.marker([lat, lng], {
            icon: window.L.divIcon({ html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>', className: 'delivery-pin-icon', iconSize: [60, 60], iconAnchor: [30, 30] })
        }).bindPopup(`<b>${r.name}</b><br>${r.vehicle}<br>${r.status}`);
        adminLayers.riders.addLayer(m);
    });
    
    // Mock Customers
    adminCustomers.forEach((c) => {
        const lat = center.lat + (Math.random() - 0.5) * 0.07;
        const lng = center.lng + (Math.random() - 0.5) * 0.07;
        const m = window.L.marker([lat, lng], {
            icon: window.L.divIcon({ html: '👤', className: 'delivery-pin-icon', iconSize: [20, 20], iconAnchor: [10, 10] })
        }).bindPopup(`<b>${c.name}</b><br>Total Spent: ${c.totalSpent}`);
        adminLayers.customers.addLayer(m);
    });
    
    // --- RTDB LISTENER START ---
    if (rtdb) {
        rtdb.ref('locations/riders').on('value', (snapshot) => {
            const riders = snapshot.val();
            if (!riders) return;
            
            // Clear static mock riders if we have live data
            adminLayers.riders.clearLayers();
            
            Object.keys(riders).forEach(key => {
                const r = riders[key];
                // Check if stale (e.g. > 5 mins)
                // const isStale = (Date.now() - r.timestamp) > 300000;
                
                const m = window.L.marker([r.lat, r.lng], {
                    icon: window.L.divIcon({ html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>', className: 'delivery-pin-icon', iconSize: [60, 60], iconAnchor: [30, 30] })
                }).bindPopup(`<b>${r.name || 'Rider'}</b><br>Status: ${r.status}`);
                adminLayers.riders.addLayer(m);
            });
        });
    }
    // --- RTDB LISTENER END ---

    // Default visibility: Customers hidden
    if(adminMap.hasLayer(adminLayers.customers)) adminMap.removeLayer(adminLayers.customers);
}

function renderAdminHealth() {
    const container = document.getElementById('adminHealthContent');
    if(!container) return;

    const firebaseStatus = (window.db && firebase.apps.length > 0) ? 'connected' : 'disconnected';
    const networkStatus = navigator.onLine ? 'online' : 'offline';

    container.innerHTML = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:15px;">
            <div class="dashboard-card" style="border-left: 4px solid ${networkStatus === 'online' ? '#019E81' : '#ff4757'}">
                <div style="font-size:0.85em; color:#666;">Browser Network</div>
                <div style="font-weight:bold; font-size:1.2em;">${networkStatus.toUpperCase()}</div>
            </div>
            <div class="dashboard-card" style="border-left: 4px solid ${firebaseStatus === 'connected' ? '#019E81' : '#ff4757'}">
                <div style="font-size:0.85em; color:#666;">Firebase Firestore</div>
                <div style="font-weight:bold; font-size:1.2em;">${firebaseStatus.toUpperCase()}</div>
            </div>
        </div>

        <h4 style="margin: 20px 0 10px; color: #333;">External Libraries</h4>
        <div class="admin-table-container">
            <table class="admin-table">
                <thead>
                    <tr><th>Library</th><th>Status</th><th>Endpoint</th></tr>
                </thead>
                <tbody>
                    ${Object.entries(libStatus).map(([name, status]) => `
                        <tr>
                            <td><strong>${name}</strong></td>
                            <td><span style="color:${status === 'ready' ? '#019E81' : (status === 'pending' ? '#FFBF42' : '#ff4757')}; font-weight:bold;">${status.toUpperCase()}</span></td>
                            <td style="font-size:0.8em; color:#888;">${name === 'Leaflet' ? 'cdnjs.cloudflare.com' : 'cdn.jsdelivr.net'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div style="margin-top:20px; padding:15px; background:#f0f7f4; border-radius:8px; font-size:0.9em; color:#017a63;">
            <strong>Optimization Tip:</strong> If the Map feels slow, check if your browser is throttling background tabs or if an ad-blocker is delaying the OpenStreetMap tile server.
        </div>
    `;
}

function toggleAdminLayer(layer) {
    if(!adminMap || !adminLayers[layer]) return;
    if(adminMap.hasLayer(adminLayers[layer])) adminMap.removeLayer(adminLayers[layer]);
    else adminMap.addLayer(adminLayers[layer]);
}

function toggleAdminHeatmap(checkbox) {
    if (!adminMap) return;
    
    if (checkbox.checked) {
        if (!adminLayers.heatmap) {
            // Generate mock heatmap points from customers/orders
            const heatData = [];
            // Use customers
            adminCustomers.forEach(c => {
                // Randomize positions near center for demo
                const lat = 24.4539 + (Math.random() - 0.5) * 0.08;
                const lng = 54.3773 + (Math.random() - 0.5) * 0.08;
                heatData.push([lat, lng, 0.8]); // intensity
            });
            // Use orders
            adminOrders.forEach(o => {
                if(o.lat && o.lng) heatData.push([o.lat, o.lng, 1.0]);
            });
            
            adminLayers.heatmap = window.L.heatLayer(heatData, {radius: 25, blur: 15, maxZoom: 17});
        }
        adminLayers.heatmap.addTo(adminMap);
    } else {
        if (adminLayers.heatmap) adminMap.removeLayer(adminLayers.heatmap);
    }
}

function toggleAdminReadyOnly(checkbox) {
    const isReadyOnly = checkbox.checked;
    if(isReadyOnly && document.getElementById('toggleActiveOnly')) document.getElementById('toggleActiveOnly').checked = false;

    // Clear all layers
    adminLayers.riders.clearLayers();
    adminLayers.vendors.clearLayers();
    adminLayers.customers.clearLayers();

    if (isReadyOnly) {
        // Show only Ready orders
        if (window.allOrders) {
            window.allOrders.forEach(order => {
                if (order.status === 'ready') {
                    // Add Restaurant Marker for ready order
                    if(order.restaurantLat && order.restaurantLng) {
                        const m = window.L.marker([order.restaurantLat, order.restaurantLng], {
                            icon: window.L.divIcon({ html: '<div style="font-size: 2.2rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🥡</div>', className: 'delivery-pin-icon', iconSize: [40, 40], iconAnchor: [20, 20] })
                        }).bindPopup(`<b>Ready for Pickup</b><br>Order: ${order.id}<br>${order.restaurant}`);
                        adminLayers.vendors.addLayer(m);
                    }
                }
            });
        }
        if(!adminMap.hasLayer(adminLayers.vendors)) adminMap.addLayer(adminLayers.vendors);
    } else {
        // If turning off and active isn't on, reset to default (random view)
        if(!document.getElementById('toggleActiveOnly').checked) toggleAdminMapActiveOnly({checked: false});
    }
}

function toggleAdminMapActiveOnly(checkbox) {
    const isActiveOnly = checkbox.checked;
    if(isActiveOnly && document.getElementById('toggleReadyOnly')) document.getElementById('toggleReadyOnly').checked = false;
    
    // Clear all layers first
    adminLayers.riders.clearLayers();
    adminLayers.vendors.clearLayers();
    adminLayers.customers.clearLayers();

    if (isActiveOnly) {
        // Show only active orders data
        if (window.allOrders) {
            window.allOrders.forEach(order => {
                if (['rider_assigned', 'rider_picking', 'rider_delivering'].includes(order.status)) {
                    // Add Rider
                    if(order.restaurantLat && order.restaurantLng) { // Simulate/Use last known
                        const m = window.L.marker([order.restaurantLat, order.restaurantLng], { // Start pos
                            icon: window.L.divIcon({ html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>', className: 'delivery-pin-icon', iconSize: [60, 60], iconAnchor: [30, 30] })
                        }).bindPopup(`<b>Rider for ${order.id}</b><br>Status: ${order.status}`);
                        adminLayers.riders.addLayer(m);
                    }
                    // Add Customer
                    const assignBtn = (order.status === 'confirmed' || order.status === 'ready' || order.status === 'processing') 
                        ? `<br><button onclick="openAssignRiderModal('${order.id}')" style="margin-top:5px; background:#019E81; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; width:100%; font-weight:bold;">Assign Rider</button>` 
                        : '';
                    const mc = window.L.marker([order.userLat, order.userLng], {
                        icon: window.L.divIcon({ html: '👤', className: 'delivery-pin-icon', iconSize: [20, 20], iconAnchor: [10, 10] })
                    }).bindPopup(`<b>${order.customerName}</b><br>Order: ${order.id}${assignBtn}`);
                    adminLayers.customers.addLayer(mc);
                }
            });

            // Also show ALL Online Riders (Active Riders on Map)
            adminRiders.forEach(r => {
                if(r.status === 'online' || r.status === 'busy') {
                    // Mock location for online riders not in active order list to ensure they appear
                    const lat = 24.4539 + (Math.random() - 0.5) * 0.06;
                    const lng = 54.3773 + (Math.random() - 0.5) * 0.06;
                    const m = window.L.marker([lat, lng], {icon: window.L.divIcon({html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>', className: 'delivery-pin-icon', iconSize: [60, 60], iconAnchor: [30, 30]})}).bindPopup(`<b>${r.name}</b><br>${r.status.toUpperCase()}`);
                    adminLayers.riders.addLayer(m);
                }
            });
        }
        // Force enable relevant layers
        if(!adminMap.hasLayer(adminLayers.riders)) adminMap.addLayer(adminLayers.riders);
        if(!adminMap.hasLayer(adminLayers.customers)) adminMap.addLayer(adminLayers.customers);
    } else {
        // Restore default random mock data (re-init)
        // Clear again to be safe
        adminLayers.riders.clearLayers();
        adminLayers.vendors.clearLayers();
        adminLayers.customers.clearLayers();
        // Re-populate mock data (simplified re-run of init logic parts)
        const center = { lat: 24.4539, lng: 54.3773 };
        adminRestaurants.forEach((r) => {
            const lat = center.lat + (Math.random() - 0.5) * 0.05;
            const lng = center.lng + (Math.random() - 0.5) * 0.05;
            const m = window.L.marker([lat, lng], {
                icon: window.L.divIcon({ 
                    html: `<div style="width:40px; height:40px; border-radius:50%; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3); overflow:hidden; background:white; display:flex; align-items:center; justify-content:center;">
                            ${window.getImageHtml(r.profilePhoto, '🏪')}
                           </div>`, 
                    className: '', 
                    iconSize: [40, 40], 
                    iconAnchor: [20, 20] 
                })
            }).bindPopup(`<b>${r.name}</b><br>${r.category}<br>${r.status}`);
            adminLayers.vendors.addLayer(m);
        });
        adminRiders.forEach((r) => {
            const lat = center.lat + (Math.random() - 0.5) * 0.06;
            const lng = center.lng + (Math.random() - 0.5) * 0.06;
            const m = window.L.marker([lat, lng], {
                icon: window.L.divIcon({ html: '<div style="font-size: 3rem; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));">🚴</div>', className: 'delivery-pin-icon', iconSize: [60, 60], iconAnchor: [30, 30] })
            }).bindPopup(`<b>${r.name}</b><br>${r.vehicle}<br>${r.status}`);
            adminLayers.riders.addLayer(m);
        });
        // Restore visibility based on checkboxes
        if(document.getElementById('toggleRiders').checked && !adminMap.hasLayer(adminLayers.riders)) adminMap.addLayer(adminLayers.riders);
        if(document.getElementById('toggleVendors').checked && !adminMap.hasLayer(adminLayers.vendors)) adminMap.addLayer(adminLayers.vendors);
    }
}

function onAdminDrawMove(e) {
    if(adminDraw.active && adminDraw.center && adminDraw.circle) {
        const dist = adminDraw.center.distanceTo(e.latlng);
        adminDraw.circle.setRadius(dist);
    }
}

function enableAdminZoneDraw() {
    adminDraw.active = true;
    document.getElementById('adminMapContainer').style.cursor = 'crosshair';
    showToast('Click on map to set zone center');
}

function exportAdminMap() {
    if (adminMap && adminMap.screenshoter) {
        showToast('Generating map image...');
        adminMap.screenshoter.takeScreen('blob', {
            caption: function () {
                return 'Live Map Report - ' + new Date().toLocaleString();
            }
        }).then(blob => {
            const link = document.createElement('a');
            link.download = 'admin_map_view_' + Date.now() + '.png';
            link.href = URL.createObjectURL(blob);
            link.click();
            showToast('Map image downloaded!');
        }).catch(e => {
            console.error('Export failed', e);
            showToast('Export failed. Try moving the map slightly.');
        });
    } else {
        showToast('Export tool not ready');
    }
}

function toggleAdminMapFullscreen() {
    const card = document.querySelector('#admin-livemap .dashboard-card');
    const exitBtn = document.getElementById('exitMapFullscreenBtn');
    card.classList.toggle('admin-map-fullscreen-card');
    if (card.classList.contains('admin-map-fullscreen-card')) {
        exitBtn.style.display = 'block';
    } else {
        exitBtn.style.display = 'none';
    }
    setTimeout(() => adminMap.invalidateSize(), 100);
}

function updateAdminChartsData() {
    // Simulate live data updates for dashboard charts
    if(adminChartsInstances['adminRevenueChart']) {
        const newData = adminChartsInstances['adminRevenueChart'].data.datasets[0].data.map(v => Math.max(0, v + Math.floor((Math.random() - 0.5) * 5000)));
        adminChartsInstances['adminRevenueChart'].data.datasets[0].data = newData;
        adminChartsInstances['adminRevenueChart'].update();
    }
    if(adminChartsInstances['adminStatusChart']) {
        const newData = adminChartsInstances['adminStatusChart'].data.datasets[0].data.map(v => Math.max(0, v + Math.floor((Math.random() - 0.5) * 5)));
        adminChartsInstances['adminStatusChart'].data.datasets[0].data = newData;
        try { adminChartsInstances['adminStatusChart'].update(); } catch(e){}
    }
}

async function initAdminCharts() {
    try { await loadCharts(); } catch(e) { return; }

    setTimeout(() => {
        // Cleanup
        const chartIds = ['adminRevenueChart', 'adminStatusChart', 'adminCategoriesChart', 'adminLocationChart', 'adminHourlyChart', 'adminLoyaltyChart', 
         'analyticsRevenueChart', 'analyticsLocationChart', 'analyticsHourlyChart', 'analyticsLoyaltyChart', 'analyticsCommissionChart'].forEach(id => {
            if (adminChartsInstances[id]) {
                try {
                    adminChartsInstances[id].destroy();
                } catch(e) {}
                delete adminChartsInstances[id];
            }
        });

        // Revenue Chart (Line)
        const revenueCtx = document.getElementById('adminRevenueChart')?.getContext('2d');
        if (revenueCtx && window.Chart) {
            adminChartsInstances['adminRevenueChart'] = new Chart(revenueCtx, {
                type: 'line',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [{
                        label: 'Revenue (UGX)',
                        data: [15000, 22000, 18000, 25000, 30000, 45000, 38000],
                        borderColor: '#019E81',
                        backgroundColor: 'rgba(1, 158, 129, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    onClick: (e, els, chart) => {
                        if (els.length > 0) {
                            const index = els[0].index;
                            const label = chart.data.labels[index];
                            // Map chart label to status value
                            const statusMap = { 'Delivered': 'delivered', 'Pending': 'pending', 'Cancelled': 'cancelled', 'Preparing': 'preparing' };
                            const statusToFilter = statusMap[label] || label.toLowerCase();
                            switchAdminTab('orders');
                            setTimeout(() => filterAdminOrders(statusToFilter), 100);
                        }
                    }
                }
            });
        }

        // Order Status Chart (Doughnut)
        const statusCtx = document.getElementById('adminStatusChart')?.getContext('2d');
        if (statusCtx && window.Chart) {
            const statuses = ['Delivered', 'Pending', 'Cancelled', 'Preparing'];
            const counts = [
                adminOrders.filter(o => o.status === 'delivered').length + 50, // +Mock data
                adminOrders.filter(o => o.status === 'pending').length + 5,
                adminOrders.filter(o => o.status === 'cancelled').length + 2,
                adminOrders.filter(o => o.status === 'preparing').length + 8
            ];
            adminChartsInstances['adminStatusChart'] = new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels: statuses,
                    datasets: [{
                        data: counts,
                        backgroundColor: ['#4caf50', '#ff9800', '#f44336', '#2196f3']
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    onClick: (e, els, chart) => {
                        if (els.length > 0) {
                            const index = els[0].index;
                            const label = chart.data.labels[index].toLowerCase();
                            switchAdminTab('restaurants');
                            setTimeout(() => adminSearch('restaurants', label), 100);
                        }
                    }
                }
            });
        }

        // Categories Chart (Bar)
        const catCtx = document.getElementById('adminCategoriesChart')?.getContext('2d');
        if (catCtx && window.Chart) {
            adminChartsInstances['adminCategoriesChart'] = new Chart(catCtx, {
                type: 'bar',
                data: {
                    labels: (adminAnalytics.topCategories || []).map(c => c.name),
                    datasets: [{
                        label: 'Orders',
                        data: (adminAnalytics.topCategories || []).map(c => c.orders),
                        backgroundColor: '#FFBF42',
                        borderRadius: 4
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    onClick: (e, els, chart) => handleAdminChartClick(e, els, chart)
                }
            });
        }

        // Sales by Location Chart (Pie) - New
        const locCtx = document.getElementById('adminLocationChart')?.getContext('2d');
        if (locCtx && window.Chart) {
            adminChartsInstances['adminLocationChart'] = new Chart(locCtx, {
                type: 'pie',
                data: {
                    labels: ['Downtown', 'Marina', 'Jumeirah', 'Business Bay', 'Deira'],
                    datasets: [{
                        label: 'Sales Vol',
                        data: [35, 25, 20, 15, 5],
                        backgroundColor: ['#019E81', '#FFBF42', '#ff4757', '#2196f3', '#9c27b0'],
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false
                }
            });
        }

        // Orders by Hour Chart (Line) - New
        const hourlyCtx = document.getElementById('adminHourlyChart')?.getContext('2d');
        if (hourlyCtx && window.Chart) {
            adminChartsInstances['adminHourlyChart'] = new Chart(hourlyCtx, {
                type: 'line',
                data: {
                    labels: (adminAnalytics.peakHours || []).map(p => p.hour),
                    datasets: [{
                        label: 'Orders',
                        data: (adminAnalytics.peakHours || []).map(p => p.orders),
                        borderColor: '#2196f3',
                        backgroundColor: 'rgba(33, 150, 243, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // Loyalty Chart (Bar) - New
        const loyaltyCtx = document.getElementById('adminLoyaltyChart')?.getContext('2d');
        if (loyaltyCtx && window.Chart) {
            adminChartsInstances['adminLoyaltyChart'] = new Chart(loyaltyCtx, {
                type: 'bar',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [
                        { label: 'Points Distributed', data: [500, 800, 600, 900, 1200, 1500, 1100], backgroundColor: '#019E81' },
                        { label: 'Points Redeemed', data: [200, 300, 250, 400, 600, 800, 500], backgroundColor: '#ff4757' }
                    ]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // --- ANALYTICS TAB CHARTS (Rich Data) ---

        // 1. Revenue Trend (Comparison)
        const anRevCtx = document.getElementById('analyticsRevenueChart')?.getContext('2d');
        if (anRevCtx && window.Chart) {
            adminChartsInstances['analyticsRevenueChart'] = new Chart(anRevCtx, {
                type: 'line',
                data: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                    datasets: [{
                        label: '2024 Revenue',
                        data: [45000, 52000, 48000, 55000, 60000, 75000, 68000, 80000, 85000, 92000, 105000, 115000],
                        borderColor: '#019E81',
                        backgroundColor: 'rgba(1, 158, 129, 0.1)',
                        tension: 0.4,
                        fill: true,
                        borderWidth: 2
                    }, {
                        label: '2023 Revenue',
                        data: [35000, 40000, 38000, 42000, 45000, 50000, 48000, 55000, 60000, 62000, 68000, 75000],
                        borderColor: '#ccc',
                        borderDash: [5, 5],
                        tension: 0.4,
                        fill: false,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: { legend: { position: 'top' } },
                    scales: { y: { ticks: { callback: v => 'UGX ' + v/1000 + 'k', font: { size: 10 } } } }
                }
            });
        }

        // 2. Sales by Location (Detailed Distribution)
        const anLocCtx = document.getElementById('analyticsLocationChart')?.getContext('2d');
        if (anLocCtx && window.Chart) {
            adminChartsInstances['analyticsLocationChart'] = new Chart(anLocCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Downtown', 'Dubai Marina', 'Jumeirah', 'Business Bay', 'Deira', 'Al Barsha'],
                    datasets: [{
                        data: [35, 25, 15, 12, 8, 5],
                        backgroundColor: ['#019E81', '#FFBF42', '#ff4757', '#2196f3', '#9c27b0', '#607d8b'],
                        borderWidth: 0,
                        hoverOffset: 10
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } }
                }
            });
        }

        // 3. Orders by Hour (Peak Times Analysis)
        const anHourCtx = document.getElementById('analyticsHourlyChart')?.getContext('2d');
        if (anHourCtx && window.Chart) {
            adminChartsInstances['analyticsHourlyChart'] = new Chart(anHourCtx, {
                type: 'bar',
                data: {
                    labels: ['8AM','9AM','10AM','11AM','12PM','1PM','2PM','3PM','4PM','5PM','6PM','7PM','8PM','9PM','10PM'],
                    datasets: [{
                        label: 'Avg Orders',
                        data: [15, 30, 45, 65, 120, 145, 90, 60, 50, 75, 110, 160, 130, 95, 50],
                        backgroundColor: (ctx) => ctx.raw > 100 ? '#FFBF42' : '#019E81',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        // 4. Loyalty Points (Earned vs Redeemed)
        const anLoyCtx = document.getElementById('analyticsLoyaltyChart')?.getContext('2d');
        if (anLoyCtx && window.Chart) {
            adminChartsInstances['analyticsLoyaltyChart'] = new Chart(anLoyCtx, {
                type: 'bar',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [
                        { label: 'Points Earned', data: [5000, 6200, 5800, 7000, 8500, 12000, 10500], backgroundColor: '#019E81', borderRadius: 4 },
                        { label: 'Points Redeemed', data: [2000, 3000, 2500, 3500, 6000, 8500, 7000], backgroundColor: '#ff4757', borderRadius: 4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top' } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        // 5. Commission by Category Chart (Analytics Tab)
        const anCommCtx = document.getElementById('analyticsCommissionChart')?.getContext('2d');
        if (anCommCtx && window.Chart) {
            const commissionsByCategory = {};
            adminRestaurants.forEach(r => {
                const cat = r.category || 'Other';
                const comm = (parseFloat(r.revenue) || 0) * (parseFloat(r.commission) || 0) / 100;
                commissionsByCategory[cat] = (commissionsByCategory[cat] || 0) + comm;
            });

            adminChartsInstances['analyticsCommissionChart'] = new Chart(anCommCtx, {
                type: 'polarArea',
                data: {
                    labels: Object.keys(commissionsByCategory),
                    datasets: [{
                        data: Object.values(commissionsByCategory),
                        backgroundColor: ['#019E81', '#FFBF42', '#ff4757', '#2196f3', '#9c27b0', '#607d8b'],
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'right', labels: { font: { size: 10 } } } }
                }
            });
        }
    }, 100);
}

function handleAdminChartClick(e, activeEls, chart) {
    if (activeEls.length > 0) {
        const index = activeEls[0].index;
        const label = chart.data.labels[index];
        let value = 0;
        let datasetLabel = '';
        
        if (chart.data.datasets.length > 0) {
            value = chart.data.datasets[0].data[index];
            datasetLabel = chart.data.datasets[0].label;
        }

        document.getElementById('chartDetailTitle').textContent = label;
        document.getElementById('chartDetailContent').innerHTML = `<strong>${datasetLabel}:</strong> ${value.toLocaleString()}`;
        document.getElementById('chartDetailModal').style.display = 'flex';
    }
}

function updateAdminSidebarBadges() {
    if (!window.allOrders) return;
    // Count active orders (anything in progress)
    const activeStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'rider_assigned', 'rider_picking', 'rider_delivering'];
    const activeCount = window.allOrders.filter(o => activeStatuses.includes(o.status)).length;
    
    const badge = document.querySelector('.sidebar-item[onclick*="orders"] .sidebar-item-badge');
    if (badge) {
        badge.textContent = activeCount;
        badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }

    // User count (Pending Approvals)
    const pendingUsers = (window.adminCustomers || []).filter(u => u.isApproved === false).length;
    const userBadge = document.querySelector('.sidebar-item[onclick*="customers"] .sidebar-item-badge');
    if (userBadge) {
        userBadge.textContent = pendingUsers;
        userBadge.style.display = pendingUsers > 0 ? 'inline-flex' : 'none';
    }
    
    // Update support badge as well
    const openTickets = typeof adminSupportTickets !== 'undefined' ? adminSupportTickets.filter(t => t.status === 'open').length : 0;
    const supportBadge = document.querySelector('.sidebar-item[onclick*="support"] .sidebar-item-badge');
    if(supportBadge) {
        supportBadge.textContent = openTickets;
        supportBadge.style.display = openTickets > 0 ? 'inline-flex' : 'none';
    }
}

function exportAdminData(type) {
    let data = [];
    let filename = `admin_${type}_${new Date().toISOString().slice(0,10)}.csv`;
    let headers = [];

    if (type === 'orders') {
        headers = ['ID', 'Customer', 'Restaurant', 'Items', 'Total', 'Status', 'Time'];
        data = adminOrders.map(o => [o.id, o.customer, o.restaurant, o.items.join('; '), o.total, o.status, o.time]);
    } else if (type === 'restaurants') {
        headers = ['Name', 'Category', 'Rating', 'Orders', 'Revenue', 'Status', 'Phone'];
        data = adminRestaurants.map(r => [r.name, r.category, r.rating, r.orders, r.revenue, r.status, r.phone]);
    } else if (type === 'riders') {
        headers = ['Name', 'Phone', 'Vehicle', 'Status', 'Completed Orders', 'Earnings', 'License'];
        data = adminRiders.map(r => [r.name, r.phone, r.vehicle, r.status, r.completedOrders, r.earnings, r.license]);
    } else if (type === 'customers') {
        headers = ['Name', 'Phone', 'Orders', 'Total Spent', 'Status', 'Joined', 'Last Order'];
        data = adminCustomers.map(c => [c.name, c.phone, c.orders, c.totalSpent, c.status, c.joined, c.lastOrder]);
    }

    if(data.length === 0) { showToast('No data to export'); return; }

    const csvContent = [headers.join(',')].concat(data.map(e => e.map(item => `"${item}"`).join(','))).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function openAdminModal(type, id = null) {
    const modal = document.getElementById('adminAddModal');
    const title = document.getElementById('adminAddModalTitle');
    const saveBtn = document.getElementById('adminAddModalSaveBtn');
    const form = document.getElementById('adminAddModalForm');
    let formHtml = '';
    editingAdminId = id;

    if (type === 'vendor') {
        const r = id ? adminRestaurants.find(i => i.id === id) : {};
        title.textContent = id ? 'Edit Vendor' : 'Add New Vendor';
        const vendorCategories = ['Restaurant', 'Pharmacy', 'Grocery Shop', 'Electronics', 'Clothing', 'Drinks', 'Other'];
        const categoryOptions = vendorCategories.map(cat => `<option value="${cat}" ${r.category === cat ? 'selected' : ''}>${cat}</option>`).join('');

        formHtml = `
            <label for="addRestaurantName" class="admin-form-label">Name</label>
            <input type="text" id="addRestaurantName" placeholder="Name" class="admin-form-input" value="${r.name || ''}">
            <label for="addRestaurantCategory" class="admin-form-label">Vendor Category</label>
            <select id="addRestaurantCategory" class="admin-form-input">${categoryOptions}</select>
            <label for="addRestaurantRating" class="admin-form-label">Rating</label>
            <input type="number" id="addRestaurantRating" placeholder="Rating (e.g., 4.5)" step="0.1" class="admin-form-input" value="${r.rating ?? ''}">
            <label for="addRestaurantPhone" class="admin-form-label">Phone</label>
            <input type="text" id="addRestaurantPhone" placeholder="Phone" class="admin-form-input" value="${r.phone || ''}">
            <label for="addRestaurantAddress" class="admin-form-label">Address</label>
            <input type="text" id="addRestaurantAddress" placeholder="Address" class="admin-form-input" value="${r.address || ''}">
            <label for="addRestaurantOwner" class="admin-form-label">Owner</label>
            <input type="text" id="addRestaurantOwner" placeholder="Owner" class="admin-form-input" value="${r.owner || ''}">
            <label for="addRestaurantCommission" class="admin-form-label">Commission %</label>
            <input type="number" id="addRestaurantCommission" placeholder="Commission %" class="admin-form-input" value="${r.commission ?? ''}">
            
            <div style="background:#f9f9f9; padding:15px; border-radius:12px; margin-top:15px; border:1px solid #eee;">
                <label class="admin-form-label" style="margin-top:0;">Option 1: Choose from Assets (Recommended)</label>
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                    <input type="text" id="addRestaurantProfileURL" placeholder="Click folder to pick..." class="admin-form-input" style="margin-bottom:0;" value="${r.profilePhoto || ''}">
                    <button onclick="openImagePicker('addRestaurantProfileURL')" style="padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.05);">📂</button>
                    <div id="addRestaurantProfilePreview" style="width:45px; height:45px; background:#fff; border-radius:8px; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; flex-shrink:0;"></div>
                </div>
                <label class="admin-form-label">Option 2: Upload Custom Photo</label>
                <input type="file" id="addRestaurantProfilePhoto" class="admin-form-input" accept="image/*" style="background:#fff;">
            </div>

            <div style="background:#f9f9f9; padding:15px; border-radius:12px; margin-top:15px; border:1px solid #eee;">
                <label class="admin-form-label" style="margin-top:0;">Cover Photo Selection</label>
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                    <input type="text" id="addRestaurantCoverURL" placeholder="Click folder to pick..." class="admin-form-input" style="margin-bottom:0;" value="${r.coverPhoto || ''}">
                    <button onclick="openImagePicker('addRestaurantCoverURL')" style="padding:10px; background:#fff; border:1px solid #ddd; border-radius:8px; cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.05);">📂</button>
                    <div id="addRestaurantCoverPreview" style="width:65px; height:45px; background:#fff; border-radius:8px; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; flex-shrink:0;"></div>
                </div>
                <input type="file" id="addRestaurantCoverPhoto" class="admin-form-input" accept="image/*" style="background:#fff;">
            </div>
        `;
        saveBtn.onclick = () => saveAdminData('restaurant');
        setTimeout(() => {
            setupPreview(['addRestaurantProfileURL', 'addRestaurantProfilePhoto'], 'addRestaurantProfilePreview', '🏪');
            setupPreview(['addRestaurantCoverURL', 'addRestaurantCoverPhoto'], 'addRestaurantCoverPreview', '🖼️');
        }, 0);
    } else if (type === 'rider') {
        const r = id ? adminRiders.find(i => i.id === id) : {};
        title.textContent = id ? 'Edit Rider' : 'Add New Rider';
        formHtml = `
            <label for="addRiderName" class="admin-form-label">Name</label>
            <input type="text" id="addRiderName" placeholder="Name" class="admin-form-input" value="${r.name || ''}">
            <label for="addRiderPhone" class="admin-form-label">Phone</label>
            <input type="tel" id="addRiderPhone" placeholder="Phone" class="admin-form-input" value="${r.phone || ''}">
            <label for="addRiderEmail" class="admin-form-label">Email</label>
            <input type="email" id="addRiderEmail" placeholder="Email" class="admin-form-input" value="${r.email || ''}">
            <label for="addRiderVehicle" class="admin-form-label">Vehicle</label>
            <input type="text" id="addRiderVehicle" placeholder="Vehicle (e.g., Motorcycle)" class="admin-form-input" value="${r.vehicle || ''}">
            <label for="addRiderLicense" class="admin-form-label">License Plate</label>
            <input type="text" id="addRiderLicense" placeholder="License Plate" class="admin-form-input" value="${r.license || ''}">
            <label class="admin-form-label">Profile Photo</label>
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                <input type="text" id="addRiderProfileURL" placeholder="URL or assets/riders/..." class="admin-form-input" style="margin-bottom:0;" value="${r.profilePhoto || ''}">
                <button onclick="openImagePicker('addRiderProfileURL')" style="padding:8px; background:#eee; border:1px solid #ddd; border-radius:8px; cursor:pointer;">📂</button>
                <div id="addRiderProfilePreview" style="width:40px; height:40px; background:#eee; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; flex-shrink:0;"></div>
                <button id="addRiderProfilePreviewRemove" style="padding:4px 8px; background:#f0f0f0; border:1px solid #ddd; border-radius:4px; font-size:0.7em; cursor:pointer; display:none; white-space:nowrap;">Remove</button>
            </div>
            <input type="file" id="addRiderProfilePhoto" class="admin-form-input" accept="image/*">
        `;
        saveBtn.onclick = () => saveAdminData('rider');
        setTimeout(() => {
            setupPreview(['addRiderProfileURL', 'addRiderProfilePhoto'], 'addRiderProfilePreview', '🚴');
        }, 0);
    } else if (type === 'customer') {
        const c = id ? adminCustomers.find(i => i.id === id) : {};
        title.textContent = id ? 'Edit Customer' : 'Add New Customer';
        formHtml = `
            <label for="addCustomerName" class="admin-form-label">Name</label>
            <input type="text" id="addCustomerName" placeholder="Name" class="admin-form-input" value="${c.name || ''}">
            <label for="addCustomerPhone" class="admin-form-label">Phone</label>
            <input type="tel" id="addCustomerPhone" placeholder="Phone" class="admin-form-input" value="${c.phone || ''}">
            <label for="addCustomerEmail" class="admin-form-label">Email</label>
            <input type="email" id="addCustomerEmail" placeholder="Email" class="admin-form-input" value="${c.email || ''}">
            <label for="addCustomerAddress" class="admin-form-label">Address</label>
            <input type="text" id="addCustomerAddress" placeholder="Address" class="admin-form-input" value="${c.address || ''}">
            <label class="admin-form-label">Profile Photo</label>
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                <input type="text" id="addCustomerProfileURL" placeholder="URL or assets/users/..." class="admin-form-input" style="margin-bottom:0;" value="${c.profilePhoto || ''}">
                <button onclick="openImagePicker('addCustomerProfileURL')" style="padding:8px; background:#eee; border:1px solid #ddd; border-radius:8px; cursor:pointer;">📂</button>
                <div id="addCustomerProfilePreview" style="width:40px; height:40px; background:#eee; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; flex-shrink:0;"></div>
                <button id="addCustomerProfilePreviewRemove" style="padding:4px 8px; background:#f0f0f0; border:1px solid #ddd; border-radius:4px; font-size:0.7em; cursor:pointer; display:none; white-space:nowrap;">Remove</button>
            </div>
            <input type="file" id="addCustomerProfilePhoto" class="admin-form-input" accept="image/*">
        `;
        saveBtn.onclick = () => saveAdminData('customer');
        setTimeout(() => {
            setupPreview(['addCustomerProfileURL', 'addCustomerProfilePhoto'], 'addCustomerProfilePreview', '👤');
        }, 0);
    } else if (type === 'promotion') {
        const p = id ? adminPromotions.find(i => i.id == id) : {};
        title.textContent = id ? 'Edit Promotion' : 'Add New Promotion';
        formHtml = `
            <label for="addPromoTitle" class="admin-form-label">Title</label>
            <input type="text" id="addPromoTitle" placeholder="Title" class="admin-form-input" value="${p.title || ''}">
            <label for="addPromoDesc" class="admin-form-label">Description</label>
            <textarea id="addPromoDesc" placeholder="Description" class="admin-form-input">${p.description || ''}</textarea>
            <label for="addPromoDiscount" class="admin-form-label">Discount Value</label>
            <input type="number" id="addPromoDiscount" placeholder="Discount Value" class="admin-form-input" value="${p.discount ?? ''}">
            <label for="addPromoType" class="admin-form-label">Type</label>
            <select id="addPromoType" class="admin-form-input">
                <option value="percentage" ${p.type === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
                <option value="free_delivery" ${p.type === 'free_delivery' ? 'selected' : ''}>Free Delivery</option>
            </select>
            <label for="addPromoValidFrom" class="admin-form-label">Valid From</label>
            <input type="date" id="addPromoValidFrom" placeholder="Valid From" class="admin-form-input" value="${(p.validFrom || '').split(' ')[0]}">
            <label for="addPromoValidTo" class="admin-form-label">Valid To</label>
            <input type="date" id="addPromoValidTo" placeholder="Valid To" class="admin-form-input" value="${(p.validTo || '').split(' ')[0]}">
        `;
        saveBtn.onclick = () => saveAdminData('promotion');
    } else if (type === 'account') {
        const acc = id ? adminAccounts.find(i => i.id == id) : {};
        title.textContent = id ? 'Edit Admin Account' : 'Add New Admin';
        formHtml = `
            <label for="addAccountName" class="admin-form-label">Name</label>
            <input type="text" id="addAccountName" placeholder="Name" class="admin-form-input" value="${acc.name || ''}">
            <label for="addAccountEmail" class="admin-form-label">Email</label>
            <input type="email" id="addAccountEmail" placeholder="Email" class="admin-form-input" value="${acc.email || ''}">
            <label for="addAccountPhone" class="admin-form-label">Phone</label>
            <input type="tel" id="addAccountPhone" placeholder="Phone" class="admin-form-input" value="${acc.phone || ''}">
            <label for="addAccountRole" class="admin-form-label">Role</label>
            <select id="addAccountRole" class="admin-form-input">
                <option value="Manager" ${acc.role === 'Manager' ? 'selected' : ''}>Manager</option>
                <option value="Super Admin" ${acc.role === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
            </select>
            <label class="admin-form-label">Profile Photo</label>
            <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                <input type="text" id="addAccountProfileURL" placeholder="URL or assets/admins/file.jpg" class="admin-form-input" style="margin-bottom:0;" value="${acc.profilePhoto || ''}">
                <div id="addAccountProfilePreview" style="width:40px; height:40px; background:#eee; border-radius:50%; overflow:hidden; display:flex; align-items:center; justify-content:center; border:1px solid #ddd; flex-shrink:0;"></div>
                <button id="addAccountProfilePreviewRemove" style="padding:4px 8px; background:#f0f0f0; border:1px solid #ddd; border-radius:4px; font-size:0.7em; cursor:pointer; display:none; white-space:nowrap;">Remove</button>
            </div>
            <input type="file" id="addAccountProfilePhoto" class="admin-form-input" accept="image/*">
        `;
        saveBtn.onclick = () => saveAdminData('account');
        setTimeout(() => {
            setupPreview(['addAccountProfileURL', 'addAccountProfilePhoto'], 'addAccountProfilePreview', '🔐');
        }, 0);
    }

    form.innerHTML = formHtml;
    modal.style.display = 'flex';
}

function closeAdminAddModal() {
    document.getElementById('adminAddModal').style.display = 'none';
}

async function saveAdminData(type) {
    if (window.showLoading) window.showLoading(`Saving ${type}...`);

    if (type === 'restaurant' || type === 'vendor') {
        const data = {
            id: editingAdminId || Date.now(), // Fix: Ensure ID is preserved for updates
            name: document.getElementById('addRestaurantName').value,
            category: document.getElementById('addRestaurantCategory').value,
            rating: parseFloat(document.getElementById('addRestaurantRating').value) || 0,
            status: 'active',
            orders: 0,
            revenue: 0,
            phone: document.getElementById('addRestaurantPhone').value,
            address: document.getElementById('addRestaurantAddress').value,
            owner: document.getElementById('addRestaurantOwner').value,
            commission: parseInt(document.getElementById('addRestaurantCommission').value) || 0
        };
        const profileURL = document.getElementById('addRestaurantProfileURL').value.trim();
        const coverURL = document.getElementById('addRestaurantCoverURL').value.trim();
        if(profileURL) data.profilePhoto = profileURL;
        if(coverURL) data.coverPhoto = coverURL;
        
        const profilePhotoFile = document.getElementById('addRestaurantProfilePhoto').files[0];
        if (profilePhotoFile) {
            try {
                const blob = await compressImage(profilePhotoFile);
                data.profilePhoto = await window.uploadImageToStorage(blob, `vendors/${Date.now()}_profile.jpg`);
                addToRecentUploads(data.profilePhoto);
            } catch (err) {
                console.error("Upload failed:", err); showToast("Failed to upload profile photo."); return;
            }
        }
        
        const coverPhotoFile = document.getElementById('addRestaurantCoverPhoto').files[0];
        if (coverPhotoFile) {
            try {
                const blob = await compressImage(coverPhotoFile);
                data.coverPhoto = await window.uploadImageToStorage(blob, `vendors/${Date.now()}_cover.jpg`);
                addToRecentUploads(data.coverPhoto);
            } catch (err) {
                console.error("Upload failed:", err); showToast("Failed to upload cover photo."); return;
            }
        }

        // Real-time Sync: Create/Update in Firestore
        if (window.adminCreateVendor) {
            try {
                const vendorData = { ...data, role: 'vendor', isApproved: true };
                await window.adminCreateVendor(vendorData);
            } catch (e) {
                console.error("Firestore Vendor Sync Error", e);
            }
        }

        // SECURITY: Validate Restaurant Input
        if (!data.name || data.name.length < 2) { showToast('Valid restaurant name is required.'); return; }
        if (!data.phone || data.phone.length < 7) { showToast('Valid phone number is required.'); return; }
        if (data.commission < 0 || data.commission > 100) { showToast('Commission must be between 0 and 100%'); return; }
        
        if (editingAdminId) {
            const index = adminRestaurants.findIndex(r => r.id == editingAdminId);
            if (index > -1) adminRestaurants[index] = { ...adminRestaurants[index], ...data };
        } else {
            adminRestaurants.push(data);
        }
        renderAdminRestaurants();
        localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
        if(window.hideLoading) window.hideLoading();

    } else if (type === 'rider') {
        const data = {
            id: editingAdminId || Date.now(), // Fix: Ensure ID is preserved for updates
            name: document.getElementById('addRiderName').value,
            phone: document.getElementById('addRiderPhone').value,
            email: document.getElementById('addRiderEmail').value,
            status: 'offline',
            rating: 0,
            completedOrders: 0,
            earnings: 0,
            vehicle: document.getElementById('addRiderVehicle').value,
            license: document.getElementById('addRiderLicense').value,
            joined: new Date().toISOString().slice(0, 10)
        };
        const profileURL = document.getElementById('addRiderProfileURL').value.trim();
        if(profileURL) data.profilePhoto = profileURL;

        data.isApproved = true; // Admin created riders are pre-approved
        const riderProfilePhoto = document.getElementById('addRiderProfilePhoto').files[0];
        if (riderProfilePhoto) {
            try {
                const blob = await compressImage(riderProfilePhoto);
                data.profilePhoto = await window.uploadImageToStorage(blob, `riders/${Date.now()}_profile.jpg`);
                addToRecentUploads(data.profilePhoto);
            } catch (err) {
                console.error("Upload failed:", err); showToast("Failed to upload rider photo."); return;
            }
        }

        // Real-time Sync: Create/Update in Firestore (Riders collection)
        if (window.adminCreateRider) {
            try {
                await window.adminCreateUserRecord({ ...data, role: 'rider', isApproved: true });
            } catch (e) {
                console.error("Firestore Rider Sync Error", e);
            }
        }

        // SECURITY: Validate Rider Input
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!data.name || data.name.length < 2) { showToast('Valid rider name is required.'); return; }
        if (!emailRegex.test(data.email)) { showToast('Valid email is required.'); return; }

        if (editingAdminId) {
            const index = adminRiders.findIndex(r => r.id == editingAdminId);
            if (index > -1) adminRiders[index] = { ...adminRiders[index], ...data };
        } else {
            adminRiders.push(data);
        }
        renderAdminRiders();
        syncRiders();
    } else if (type === 'customer') {
        const data = {
            id: editingAdminId || Date.now(), // Fix: Ensure ID is preserved
            name: document.getElementById('addCustomerName').value,
            phone: document.getElementById('addCustomerPhone').value,
            email: document.getElementById('addCustomerEmail').value,
            orders: 0,
            totalSpent: 0,
            status: 'active',
            joined: new Date().toISOString().slice(0, 10),
            lastOrder: 'N/A',
            address: document.getElementById('addCustomerAddress').value
        };
        const profileURL = document.getElementById('addCustomerProfileURL').value.trim();
        if(profileURL) data.profilePhoto = profileURL;

        const customerProfilePhoto = document.getElementById('addCustomerProfilePhoto').files[0];
        if (customerProfilePhoto) {
            try {
                const blob = await compressImage(customerProfilePhoto);
                data.profilePhoto = await window.uploadImageToStorage(blob, `users/${Date.now()}_profile.jpg`);
                addToRecentUploads(data.profilePhoto);
            } catch (err) {
                console.error("Upload failed:", err); showToast("Failed to upload photo."); return;
            }
        }

        if (!data.name) { showToast('Customer name is required.'); return; }
        data.isApproved = true; // Admin created customers are pre-approved
        
        // Real-time Sync: Create/Update in Firestore (Users collection)
        if (window.adminCreateUserRecord) {
            try {
                await window.adminCreateUserRecord({ ...data, role: 'user', isApproved: true });
            } catch (e) {
                console.error("Firestore Customer Sync Error", e);
            }
        }

        if (editingAdminId) {
            const index = adminCustomers.findIndex(c => c.id == editingAdminId);
            if (index > -1) adminCustomers[index] = { ...adminCustomers[index], ...data };
        } else {
            adminCustomers.push(data);
        }
        renderAdminCustomers();
    } else if (type === 'promotion') {
        const data = {
            title: document.getElementById('addPromoTitle').value,
            description: document.getElementById('addPromoDesc').value,
            discount: parseFloat(document.getElementById('addPromoDiscount').value) || 0,
            type: document.getElementById('addPromoType').value,
            validFrom: document.getElementById('addPromoValidFrom').value,
            validTo: document.getElementById('addPromoValidTo').value,
            status: 'active',
            usage: 0
        };
        if (!data.title) { showToast('Title is required.'); return; }
        
        if (editingAdminId) {
            const index = adminPromotions.findIndex(p => p.id == editingAdminId);
            if (index > -1) adminPromotions[index] = { ...adminPromotions[index], ...data, id: editingAdminId };
        } else {
            adminPromotions.push({ ...data, id: Date.now() });
        }
        renderAdminPromotions();
    } else if (type === 'account') {
        const data = {
            name: document.getElementById('addAccountName').value,
            email: document.getElementById('addAccountEmail').value,
            phone: document.getElementById('addAccountPhone').value,
            role: document.getElementById('addAccountRole').value,
            status: 'active',
            lastLogin: 'Just now'
        };
        const profileURL = document.getElementById('addAccountProfileURL').value.trim();
        if(profileURL) data.profilePhoto = profileURL;

        const adminProfilePhoto = document.getElementById('addAccountProfilePhoto').files[0];
        if (adminProfilePhoto) {
            try {
                const blob = await compressImage(adminProfilePhoto);
                data.profilePhoto = await window.uploadImageToStorage(blob, `admins/${Date.now()}_profile.jpg`);
                addToRecentUploads(data.profilePhoto);
            } catch (err) {
                console.error("Upload failed:", err); showToast("Failed to upload admin photo."); return;
            }
        }

        if (!data.name || !data.email) { showToast('Name and Email are required.'); return; }

        if (editingAdminId) {
            const index = adminAccounts.findIndex(a => a.id == editingAdminId);
            if (index > -1) {
                adminAccounts[index] = { ...adminAccounts[index], ...data };
            }
        } else {
            adminAccounts.push({ ...data, id: Date.now() });
        }
        renderAdminAccounts();
    }

    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} saved successfully!`);
    closeAdminAddModal();
}

function openAdminMenuManager(resId) {
    // Open the existing merchant menu screen but conceptually for the selected restaurant
    const restaurant = adminRestaurants.find(r => r.id == resId);
    if (!restaurant) {
        showToast('Restaurant not found!');
        return;
    }
    
    const menuItems = restaurant.menu || [];

    const screen = document.getElementById('merchantMenuScreen');
    if(screen) {
        screen.dataset.restaurantId = resId;
        screen.classList.add('active');
        renderMerchantMenuItems(menuItems);
        showToast(`Managing menu for ${restaurant.name}`);
    }
}

function renderAdminLiveMap() { setTimeout(initAdminLiveMap, 100); }

let adminPathMap;
async function viewOrderPath(orderId) {
    const order = adminOrders.find(o => o.id === orderId);
    if(!order) return;
    
    const modal = document.getElementById('adminPathModal');
    modal.style.display = 'flex';
    document.getElementById('adminPathTitle').textContent = `Route for Order ${orderId}`;

    try { await loadLeaflet(); } catch(e) { return; }
    
    if(!document.getElementById('adminPathMap')) return;
    if(!adminPathMap) {
        adminPathMap = window.L.map('adminPathMap', { zoomControl: false }).setView([24.4539, 54.3773], 13);
        window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(adminPathMap);
    }
    
    // Clear previous layers
    adminPathMap.eachLayer((layer) => {
        if (!!layer.toGeoJSON) adminPathMap.removeLayer(layer);
    });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(adminPathMap);

    // Mock Start (Restaurant) and End (Customer)
    // Use actual coordinates if available, otherwise fallback
    const start = [order.restaurantLat || order.lat || 24.46, order.restaurantLng || order.lng || 54.38];
    const end = [order.userLat || 24.47, order.userLng || 54.40]; 
    
    // Create Markers
    window.L.marker(start, {icon: window.L.divIcon({html:'🏪', className:'delivery-pin-icon', iconSize:[30,30], iconAnchor:[15,15]})}).bindPopup(order.restaurant).addTo(adminPathMap);
    window.L.marker(end, {icon: window.L.divIcon({html:'👤', className:'delivery-pin-icon', iconSize:[30,30], iconAnchor:[15,15]})}).bindPopup(order.customer).addTo(adminPathMap);
    
    // Fetch Actual Route from OSRM
    showToast("Fetching route history...");
    let routePoints = await getOSRMRoute(start[0], start[1], end[0], end[1]);

    if (!routePoints || routePoints.length === 0) {
        // Fallback to straight line if API fails
        routePoints = [start, end];
    }

    // Draw Polyline (Actual Route)
    const pathPolyline = window.L.polyline(routePoints, {color: '#019E81', weight: 5, opacity: 0.8}).addTo(adminPathMap);
    
    // Add arrows or dots
    // Only add a few dots along the path to not clutter
    if (routePoints.length > 2) {
        const step = Math.floor(routePoints.length / 5);
        for (let i = step; i < routePoints.length - 1; i += step) {
            window.L.circleMarker(routePoints[i], {radius: 3, color: '#019E81', fillColor:'#fff', fillOpacity:1}).addTo(adminPathMap);
        }
    }

    setTimeout(() => {
        adminPathMap.invalidateSize();
        adminPathMap.fitBounds(polyline.getBounds(), {padding: [50,50]});
    }, 200);
}

function closeAdminPathModal() {
    document.getElementById('adminPathModal').style.display = 'none';
}

function viewOrderDetails(orderId) {
    const order = adminOrders.find(o => o.id === orderId);
    if (!order) return;

    // Get extra details
    const res = adminRestaurants.find(r => r.name === order.restaurant);
    const commissionRate = res ? res.commission : 15; // Default 15% if not found
    const commissionVal = (order.total * commissionRate / 100).toFixed(2);
    const riderName = order.rider || 'Unassigned';
    const paymentMethod = order.payment ? order.payment.toUpperCase() : 'N/A';

    const modal = document.getElementById('adminOrderDetailsModal');
    const content = document.getElementById('adminOrderDetailsContent');
    
    content.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #eee; padding-bottom:10px;">
            <h3 style="margin:0; color:#333;">Order Details</h3>
            <div onclick="document.getElementById('adminOrderDetailsModal').style.display='none'" style="cursor:pointer; font-weight:bold; font-size:1.5em; line-height:1;">✕</div>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:20px;">
            <div>
                <div style="font-size:0.85em; color:#888;">Order ID</div>
                <div style="font-weight:bold;">${order.id}</div>
            </div>
            <div>
                <div style="font-size:0.85em; color:#888;">Time</div>
                <div style="font-weight:bold;">${order.time} (${order.timestamp})</div>
            </div>
            <div>
                <div style="font-size:0.85em; color:#888;">Customer</div>
                <div style="font-weight:bold;">${order.customer}</div>
                <div style="font-size:0.9em; color:#666;">${order.customerPhone}</div>
            </div>
            <div>
                <div style="font-size:0.85em; color:#888;">Restaurant</div>
                <div style="font-weight:bold;">${order.restaurant}</div>
            </div>
            <div>
                <div style="font-size:0.85em; color:#888;">Payment</div>
                <div style="font-weight:bold;">${paymentMethod}</div>
            </div>
            <div>
                <div style="font-size:0.85em; color:#888;">Rider</div>
                <div style="font-weight:bold;">${riderName}</div>
            </div>
        </div>

        ${order.driverNotes ? `<div style="margin-bottom:20px; background:#fff8e1; padding:12px; border-radius:8px; border:1px solid #ffe0b2;">
            <div style="font-size:0.85em; color:#f57c00; font-weight:bold; margin-bottom:5px;">📝 Driver Notes</div>
            <div style="font-size:0.95em; color:#333; line-height:1.4;">${order.driverNotes}</div>
        </div>` : ''}
        
        <div style="margin-bottom:20px;">
            <div style="font-size:0.85em; color:#888; margin-bottom:5px;">Order Items</div>
            <div style="background:#f9f9f9; padding:10px; border-radius:8px; border:1px solid #eee;">
                ${order.items.map(item => `
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:0.9em;">
                        <span>${item.quantity || 1}x ${item.title || item}</span>
                        <span>${item.total ? 'UGX '+item.total : ''}</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:20px;">
            <div style="font-size:0.85em; color:#888; margin-bottom:5px;">Delivery Location</div>
            <div style="font-weight:600;">${order.deliveryAddress || order.address || 'N/A'}</div>
            <div style="margin-top:10px; height:150px; background:#eee; border-radius:8px; overflow:hidden;" id="adminDetailMap"></div>
        </div>

        <div style="border-top:1px solid #eee; padding-top:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span style="color:#666;">Order Total:</span>
                <span style="font-weight:bold;">UGX ${order.total.toLocaleString()}</span>
            </div>
            <div style="display:flex; justify-content:space-between; color:#019E81;">
                <span>Platform Commission (${commissionRate}%):</span>
                <span>UGX ${commissionVal}</span>
            </div>
        </div>
    `;
    
    modal.style.display = 'flex';
    
    // Initialize small map for details
    setTimeout(async () => {
        const mapContainer = document.getElementById('adminDetailMap');
        if (mapContainer && !mapContainer._leaflet_id) {
            try { await loadLeaflet(); } catch(e) { return; }
            const detailMap = window.L.map('adminDetailMap', { zoomControl: false }).setView([order.restaurantLat || 24.46, order.restaurantLng || 54.38], 12);
            window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '' }).addTo(detailMap);
            
            const rLat = order.restaurantLat || 24.46;
            const rLng = order.restaurantLng || 54.38;
            const uLat = order.userLat || 24.47;
            const uLng = order.userLng || 54.40;

            window.L.marker([rLat, rLng], {icon: window.L.divIcon({html:'🏪', className:'delivery-pin-icon', iconSize:[20,20], iconAnchor:[10,10]})}).addTo(detailMap);
            window.L.marker([uLat, uLng], {icon: window.L.divIcon({html:'🏠', className:'delivery-pin-icon', iconSize:[20,20], iconAnchor:[10,10]})}).addTo(detailMap);
            
            const detailBounds = window.L.latLngBounds([[rLat, rLng], [uLat, uLng]]);
            detailMap.fitBounds(detailBounds, { padding: [20, 20] });
        }
    }, 100);
}

async function exportDashboardImage() {
    try { await loadHtml2Canvas(); } catch(e) { showToast("Export library not available."); return; }
    
    const dashboard = document.querySelector('#admin-dashboard');
    if(!dashboard) return;
    showToast('Generating dashboard image...');
    window.html2canvas(dashboard).then(canvas => {
        const link = document.createElement('a');
        link.download = 'admin_dashboard_report.png';
        link.href = canvas.toDataURL();
        link.click();
        showToast('Dashboard exported!');
    });
}

function triggerRestaurantImport() {
    document.getElementById('importCsvInput').click();
}

function handleRestaurantImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n');
        let count = 0;
        for (let i = 1; i < lines.length; i++) { // Skip header
            const cols = lines[i].split(',');
            if (cols.length >= 3) {
                adminRestaurants.push({
                    id: Date.now() + Math.random(),
                    name: cols[0]?.trim() || 'Imported Res',
                    category: cols[1]?.trim() || 'General',
                    rating: parseFloat(cols[2]) || 4.5,
                    status: 'active',
                    orders: 0, revenue: 0, commission: 15,
                    phone: cols[3]?.trim() || '',
                    address: cols[4]?.trim() || ''
                });
                count++;
            }
        }
        localStorage.setItem('kirya_restaurants', JSON.stringify(adminRestaurants));
        renderAdminRestaurants();
        showToast(`${count} restaurants imported!`);
    };
    reader.readAsText(file);
}

function openAssignRiderModal(orderId) {
    window.currentAssignOrderId = orderId;
    const modal = document.getElementById('adminAssignRiderModal');
    const list = document.getElementById('assignRiderList');
    list.innerHTML = adminRiders.map(r => `
        <div onclick="confirmAssignRider('${r.name}')" style="padding:12px; border-bottom:1px solid #eee; cursor:pointer; display:flex; justify-content:space-between;">
            <div><strong>${r.name}</strong><br><small>${r.status.toUpperCase()} • ${r.completedOrders} orders</small></div>
            <div style="background:#019E81; color:#fff; padding:5px 10px; border-radius:4px; height:fit-content; font-size:0.8em;">Select</div>
        </div>
    `).join('');
    modal.style.display = 'flex';
}

function confirmAssignRider(riderName) {
    const order = window.allOrders.find(o => o.id === window.currentAssignOrderId);
    const rider = window.adminRiders.find(r => r.name === riderName);
    if (order && rider) {
        order.rider = riderName;
        order.riderId = rider.id; // Match Firestore Rules for status updates
        // Use timeout to simulate processing
        updateOrderStatus(order.id, 'rider_assigned', `Rider ${riderName} assigned`);
        if (document.getElementById('admin-orders').style.display !== 'none') renderAdminOrders();
        showToast(`Assigned to ${riderName}`);
    }
    document.getElementById('adminAssignRiderModal').style.display = 'none';
}

function renderAdminLogs() {
    const content = document.getElementById('admin-logs');
    if (!content) return;
    content.innerHTML = `
        <div class="dashboard-card">
            <h3>📋 Activity Logs</h3>
            <div style="max-height:600px; overflow:auto; margin-top:15px;">
                <table class="admin-table">
                    <thead><tr><th>Time</th><th>Action</th><th>User</th><th>Details</th></tr></thead>
                    <tbody>
                        ${adminLogs.map(log => `<tr>
                            <td style="color:#666; font-size:0.85em;">${log.time}</td>
                            <td><strong>${log.action}</strong></td>
                            <td>${log.user}</td>
                            <td>${log.details}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

async function loadMoreAdminData(type) {
    const collectionName = (type === 'customers') ? 'users' : type;
    showToast(`Loading more ${type}...`);
    const newItems = await window.fetchPaginatedCollection(collectionName);
    
    if (newItems.length === 0) {
        showToast(`No more ${type} to load`);
        return;
    }

    if (type === 'restaurants') { adminRestaurants = [...adminRestaurants, ...newItems]; renderAdminRestaurants(); }
    else if (type === 'riders') { adminRiders = [...adminRiders, ...newItems]; renderAdminRiders(); }
    else if (type === 'customers') { adminCustomers = [...adminCustomers, ...newItems]; renderAdminCustomers(); }
    else if (type === 'logs') { adminLogs = [...adminLogs, ...newItems]; renderAdminLogs(); }
    
    showToast(`Loaded ${newItems.length} more ${type}`);
}

window.exportVendorsPDF = async function() {
    if (!window.jspdf) {
        showToast("PDF Library loading...");
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const content = document.getElementById('adminRestaurantsList');
    if (!content) return;
    
    showToast('Generating Vendors Report...');
    
    try {
        const canvas = await html2canvas(content, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/png');
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        
        pdf.setFontSize(18);
        pdf.text("Kirya - Vendors Management Report", 10, 15);
        pdf.setFontSize(10);
        pdf.text(`Generated: ${new Date().toLocaleString()} | Filter: ${adminFilters.restaurants.category} / ${adminFilters.restaurants.status}`, 10, 22);
        
        pdf.addImage(imgData, 'PNG', 5, 30, pdfWidth - 10, pdfHeight - 10);
        pdf.save(`Vendors_Report_${new Date().toISOString().slice(0,10)}.pdf`);
        showToast('PDF Report downloaded!');
    } catch (e) {
        console.error("PDF Export Error:", e);
        showToast('Error generating PDF.');
    }
};

function filterAdminRiders(status) {
    adminFilters.riders.status = status;
    const tbody = document.querySelector('#adminRidersList tbody');
    if (tbody) tbody.innerHTML = renderAdminRidersList();
}