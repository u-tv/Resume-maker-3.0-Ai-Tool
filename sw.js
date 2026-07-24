// sw.js - Service Worker for Resumemaster AI Tool
// यह फ़ाइल आपके टूल को PWA बनाएगी, ऑफलाइन सपोर्ट और बैकग्राउंड सिंक देगी

const CACHE_NAME = 'resume-master-v5';
const ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800;900&family=Playfair+Display:wght@400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js',
  'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// इंस्टॉल करते समय सारे एसेट्स कैश करें
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching assets...');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting(); // नए SW को तुरंत एक्टिवेट करें
});

// एक्टिवेट होने पर पुराने कैश हटाएँ
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim(); // सभी खुले पेजों पर तुरंत नियंत्रण लें
});

// Fetch इवेंट – कैश से परोसें, अगर नहीं मिला तो नेटवर्क से लाएँ
self.addEventListener('fetch', event => {
  // API कॉल्स को बायपास करें (उन्हें हमेशा नेटवर्क से लेना चाहिए)
  if (event.request.url.includes('/api/')) {
    return; // डिफॉल्ट फेच व्यवहार
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(response => {
        // अगर नेटवर्क से मिला, तो उसे भी कैश कर लें (अगली बार के लिए)
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});

// बैकग्राउंड सिंक – जब ऑनलाइन हो, तब पेंडिंग रिक्वेस्ट भेजें
self.addEventListener('sync', event => {
  if (event.tag === 'resume-sync') {
    event.waitUntil(syncResumeData());
  }
});

async function syncResumeData() {
  const cache = await caches.open('pending-requests');
  const requests = await cache.keys();
  for (const request of requests) {
    try {
      const response = await fetch(request);
      if (response.ok) {
        await cache.delete(request); // सफल होने पर डिलीट करें
        console.log('Synced pending request:', request.url);
      }
    } catch (error) {
      console.error('Sync failed for', request.url, error);
    }
  }
}

// अगर ब्राउज़र में बैकग्राउंड सिंक सपोर्ट नहीं है, तो कोई इश्यू नहीं
console.log('✅ Service Worker registered!');
