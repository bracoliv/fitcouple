const KEY = "fitMeasurements";

export function loadMeasurements() : any {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function saveMeasurement(entry?: any) : any {
  const rows = loadMeasurements().filter((row?: any) : any => row.day !== entry.day);
  rows.push({
    day: entry.day,
    weight: entry.weight,
    waist: entry.waist,
  });
  rows.sort((a?: any, b?: any) : any => (a.day < b.day ? -1 : 1));
  localStorage.setItem(KEY, JSON.stringify(rows.slice(-80)));
  return rows.slice(-80);
}

function db() : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const open = indexedDB.open("fit-progress", 1);
    open.onupgradeneeded = () : any => {
      if (!open.result.objectStoreNames.contains("photos")) open.result.createObjectStore("photos");
    };
    open.onsuccess = () : any => resolve(open.result);
    open.onerror = () : any => reject(open.error);
  });
}

export async function savePhoto(slot?: any, blob?: any) : Promise<any> {
  const database = await db();
  await new Promise((resolve?: any, reject?: any) : any => {
    const tx = database.transaction("photos", "readwrite");
    tx.objectStore("photos").put(blob, slot);
    tx.oncomplete = () : any => resolve();
    tx.onerror = () : any => reject(tx.error);
  });
  database.close();
}

export async function loadPhoto(slot?: any) : Promise<any> {
  const database = await db();
  const blob = await new Promise((resolve?: any, reject?: any) : any => {
    const tx = database.transaction("photos", "readonly");
    const req = tx.objectStore("photos").get(slot);
    req.onsuccess = () : any => resolve(req.result || null);
    req.onerror = () : any => reject(req.error);
  });
  database.close();
  return blob;
}

export async function shrinkPhoto(file?: any) : Promise<any> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx: any = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve?: any) : any => canvas.toBlob(resolve, "image/jpeg", 0.8));
  bitmap.close();
  return blob;
}
