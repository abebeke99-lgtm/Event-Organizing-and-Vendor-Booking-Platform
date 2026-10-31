const DATABASE_NAME = 'eventflow-demo-profile-storage';
const DATABASE_VERSION = 1;
const PHOTO_STORE = 'profile-photos';

function openDatabase(factory = globalThis.indexedDB) {
  if (!factory) return Promise.reject(new Error('Browser photo storage is unavailable.'));

  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PHOTO_STORE)) {
        request.result.createObjectStore(PHOTO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Browser photo storage could not be opened.'));
    request.onblocked = () => reject(new Error('Browser photo storage is blocked by another tab.'));
  });
}

function runPhotoRequest(email, mode, operation, factory) {
  const key = email.trim().toLowerCase();
  if (!key) return Promise.reject(new Error('A signed-in demo account is required.'));

  return openDatabase(factory).then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, mode);
    const request = operation(transaction.objectStore(PHOTO_STORE), key);
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('Browser photo storage request failed.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Browser photo storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Browser photo storage transaction was aborted.'));
  }));
}

export function readDemoProfilePhoto(email, factory) {
  return runPhotoRequest(email, 'readonly', (store, key) => store.get(key), factory).then((photo) => photo || null);
}

export function saveDemoProfilePhoto(email, photo, factory) {
  return runPhotoRequest(email, 'readwrite', (store, key) => store.put(photo, key), factory);
}

export function removeDemoProfilePhoto(email, factory) {
  return runPhotoRequest(email, 'readwrite', (store, key) => store.delete(key), factory);
}
