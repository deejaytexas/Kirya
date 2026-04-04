importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBBU2fUlkRf7VqVJmT-Vh7TfNpPgmQrqWU",
    authDomain: "kirya-e2248.firebaseapp.com",
    projectId: "kirya-e2248",
    storageBucket: "kirya-e2248.firebasestorage.app",
    messagingSenderId: "308339449512",
    appId: "1:308339449512:web:d2b1fb44c4ba36a505ac9d"
});

self.addEventListener('activate', event => {
    // Force the service worker to take control of the page immediately
    event.waitUntil(self.clients.claim());
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icon.png' // Ensure you have an icon at this path
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
});