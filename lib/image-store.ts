const DATABASE_NAME = "dcl-site-images";
const STORE_NAME = "images";
const DATABASE_VERSION = 1;

function openImageDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function isStoredImageReference(source: string) {
  return source.startsWith("idb:");
}

export async function saveImageFile(key: string, file: File) {
  const database = await openImageDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
  return `idb:${key}`;
}

export async function getImageFile(key: string): Promise<Blob | undefined> {
  const database = await openImageDatabase();

  const file = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });

  database.close();
  return file;
}

export async function deleteImageFile(reference: string) {
  if (!isStoredImageReference(reference)) {
    return;
  }

  const database = await openImageDatabase();
  const key = reference.slice(4);

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  database.close();
}

export async function resolveImageReference(source: string) {
  if (typeof window === "undefined" || !isStoredImageReference(source)) {
    return source;
  }

  const file = await getImageFile(source.slice(4));
  return file ? URL.createObjectURL(file) : "";
}
