// IndexedDB storage. Same database as v1 so existing files stay readable.
// Stores: pdf (blobs by paper id), thumbs (figure crops by event id), texts (extracted page texts
// by paper id), translations (paragraph translations by paper id).
const DB_NAME = 'paper-reading-files';
const STORE = 'pdf';
const THUMBS = 'thumbs';
const TEXTS = 'texts';
const TRANSLATIONS = 'translations';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      for (const name of [STORE, THUMBS, TEXTS, TRANSLATIONS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
  });
}

async function withStore(mode, fn, name = STORE) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      let result;
      try { result = fn(store); } catch (err) { reject(err); return; }
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
  } finally {
    db.close();
  }
}

export const dbPut = (id, blob) => withStore('readwrite', s => s.put(blob, id));
export const dbGet = id => withStore('readonly', s => s.get(id));
export const dbDelete = id => withStore('readwrite', s => s.delete(id));
export const dbKeys = () => withStore('readonly', s => s.getAllKeys());

// Small JPEG thumbnails of captured figure regions, keyed by event id.
export const dbPutThumb = (id, blob) => withStore('readwrite', s => s.put(blob, id), THUMBS);
export const dbGetThumb = id => withStore('readonly', s => s.get(id), THUMBS);
export const dbDeleteThumb = id => withStore('readwrite', s => s.delete(id), THUMBS);

// Extracted page texts ({ pages: string[], at }) keyed by paper id.
export const dbPutText = (id, obj) => withStore('readwrite', s => s.put(obj, id), TEXTS);
export const dbGetText = id => withStore('readonly', s => s.get(id), TEXTS);
export const dbDeleteText = id => withStore('readwrite', s => s.delete(id), TEXTS);

// Paragraph translations ({ map: { [textKey]: zh }, meta }) keyed by paper id.
export const dbPutTranslation = (id, obj) => withStore('readwrite', s => s.put(obj, id), TRANSLATIONS);
export const dbGetTranslation = id => withStore('readonly', s => s.get(id), TRANSLATIONS);
export const dbDeleteTranslation = id => withStore('readwrite', s => s.delete(id), TRANSLATIONS);

// Everything stored for one paper.
export async function dbDeletePaperFiles(id) {
  for (const fn of [dbDelete, dbDeleteText, dbDeleteTranslation]) await fn(id).catch(() => {});
}
