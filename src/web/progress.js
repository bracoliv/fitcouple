const KEY = "fitMeasurements";

export function loadMeasurements() {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function saveMeasurement(entry) {
  const rows = loadMeasurements().filter((row) => row.day !== entry.day);
  rows.push({
    day: entry.day,
    weight: entry.weight,
    waist: entry.waist,
  });
  rows.sort((a, b) => (a.day < b.day ? -1 : 1));
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-80)));
  return rows.slice(-80);
}

function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("fit-progress", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("photos")) open.result.createObjectStore("photos");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

export async function savePhoto(slot, blob) {
  const database = await db();
  await new Promise((resolve, reject) => {
    const tx = database.transaction("photos", "readwrite");
    tx.objectStore("photos").put(blob, slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  database.close();
}

export async function loadPhoto(slot) {
  const database = await db();
  const blob = await new Promise((resolve, reject) => {
    const tx = database.transaction("photos", "readonly");
    const req = tx.objectStore("photos").get(slot);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  database.close();
  return blob;
}

export async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  bitmap.close();
  return blob;
}
