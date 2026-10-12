// Registration is relative to this module, including when hosted under a Pages subpath.
const status = document.getElementById('offline-status');
if ('serviceWorker' in navigator && window.isSecureContext) {
  try {
    status.textContent = 'Downloading game for offline play…';
    const registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url));
    if (!registration.active) {
      await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) { reject(new Error('No installing worker')); return; }
        const check = () => {
          if (worker.state === 'activated') resolve();
          if (worker.state === 'redundant') reject(new Error('Offline installation failed'));
        };
        worker.addEventListener('statechange', check);
        check();
      });
    }
    status.textContent = 'Ready to play offline';
    setTimeout(() => { status.textContent = ''; }, 5000);
  } catch (error) {
    status.textContent = 'Offline cache unavailable. Reopen online to try again.';
    console.warn('Squarez offline setup failed:', error);
  }
}
