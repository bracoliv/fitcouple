const DB_NAME = "fit-avatar";
const VERSIONS = 4;

export function tierFor(level?: any) : any {
  const n = Number(level) || 1;
  if (n >= 20) return "flame";
  if (n >= 10) return "gold";
  if (n >= 5) return "bronze";
  return "stone";
}

function emptyAvatar() : any {
  return { url: "", share: false, versions: [], source: false };
}

function openDb() : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () : any => {
      const db = open.result;
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    };
    open.onsuccess = () : any => resolve(open.result);
    open.onerror = () : any => reject(open.error);
  });
}

function putBlob(db?: any, key?: any, blob?: any) : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put(blob, key);
    tx.oncomplete = () : any => resolve();
    tx.onerror = () : any => reject(tx.error);
  });
}

function getBlob(db?: any, key?: any) : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const tx = db.transaction("blobs", "readonly");
    const req = tx.objectStore("blobs").get(key);
    req.onsuccess = () : any => resolve(req.result || null);
    req.onerror = () : any => reject(req.error);
  });
}

function getMeta(db?: any) : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get("settings");
    req.onsuccess = () : any => resolve(req.result || { share: false, order: [] });
    req.onerror = () : any => reject(req.error);
  });
}

function putMeta(db?: any, meta?: any) : any {
  return new Promise((resolve?: any, reject?: any) : any => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(meta, "settings");
    tx.oncomplete = () : any => resolve();
    tx.onerror = () : any => reject(tx.error);
  });
}

function blobUrl(blob?: any) : any {
  return blob ? URL.createObjectURL(blob) : "";
}

export async function loadAvatar() : Promise<any> {
  try {
    const db = await openDb();
    const meta = await getMeta(db);
    const current = await getBlob(db, "current");
    const source = await getBlob(db, "source");
    const order = Array.isArray(meta.order) ? meta.order.slice(0, VERSIONS) : [];
    const versions: any = [];
    for (const id of order) {
      const blob = await getBlob(db, id);
      if (blob) versions.push({ id, url: blobUrl(blob) });
    }
    db.close();
    return {
      url: blobUrl(current),
      share: meta.share === true,
      versions,
      source: Boolean(source),
    };
  } catch {
    return emptyAvatar();
  }
}

export async function saveShare(share?: any) : Promise<any> {
  const db = await openDb();
  const meta = await getMeta(db);
  meta.share = share === true;
  await putMeta(db, meta);
  db.close();
}

async function remember(blob?: any, sourceBlob?: any) : Promise<any> {
  const db = await openDb();
  const meta = await getMeta(db);
  const order = Array.isArray(meta.order) ? meta.order.slice() : [];
  const id = "v" + Date.now().toString(36);
  order.unshift(id);
  const keep = order.slice(0, VERSIONS);
  for (const old of order.slice(VERSIONS)) {
    await new Promise((resolve?: any, reject?: any) : any => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").delete(old);
      tx.oncomplete = () : any => resolve();
      tx.onerror = () : any => reject(tx.error);
    });
  }
  await putBlob(db, id, blob);
  await putBlob(db, "current", blob);
  if (sourceBlob) await putBlob(db, "source", sourceBlob);
  meta.order = keep;
  await putMeta(db, meta);
  db.close();
  return loadAvatar();
}

export async function useVersion(id?: any) : Promise<any> {
  const db = await openDb();
  const blob = await getBlob(db, id);
  if (!blob) {
    db.close();
    return loadAvatar();
  }
  await putBlob(db, "current", blob);
  db.close();
  return loadAvatar();
}

export async function deleteAvatar() : Promise<any> {
  const db = await openDb();
  await new Promise((resolve?: any, reject?: any) : any => {
    const tx = db.transaction(["blobs", "meta"], "readwrite");
    tx.objectStore("blobs").clear();
    tx.objectStore("meta").clear();
    tx.oncomplete = () : any => resolve();
    tx.onerror = () : any => reject(tx.error);
  });
  db.close();
  return emptyAvatar();
}

export function portraitHtml(avatar?: any, level?: any, alt?: any) : any {
  const tier = tierFor(level);
  const url = avatar && typeof avatar.url === "string" && avatar.url.startsWith("blob:") ? avatar.url : "";
  const face = url
    ? `<img class="portrait" alt="${alt}" src="${url}">`
    : `<span class="portrait generic" role="img" aria-label="${alt}"></span>`;
  return `<div class="frame ${tier}">${face}</div>`;
}

export function miniHtml(avatar?: any, optedIn?: any) : any {
  const url = optedIn && avatar && typeof avatar.url === "string" && avatar.url.startsWith("blob:") ? avatar.url : "";
  if (!url) return `<span class="mini generic" role="img" aria-label="Generic avatar"></span>`;
  return `<img class="mini" alt="" src="${url}">`;
}

function cropOf(img?: any, zoom?: any, panX?: any, panY?: any, side?: any) : any {
  const z = Math.min(3, Math.max(1, zoom || 1));
  const cover = Math.max(side / img.width, side / img.height) * z;
  const sw = side / cover;
  const sh = side / cover;
  const sx = (img.width - sw) * Math.min(1, Math.max(0, panX));
  const sy = (img.height - sh) * Math.min(1, Math.max(0, panY));
  return { sx, sy, sw, sh };
}

function stylise(image?: any) : any {
  const d = image.data;
  const w = image.width;
  const h = image.height;
  const step = 255 / 4;
  const gray = new Float32Array(w * h);
  for (let p = 0, i = 0; i < d.length; i += 4, p += 1) {
    d[i] = Math.round(d[i] / step) * step;
    d[i + 1] = Math.round(d[i + 1] / step) * step;
    d[i + 2] = Math.round(d[i + 2] / step) * step;
    gray[p] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  }
  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      if (Math.hypot(gx, gy) > 90) edges[i] = 1;
    }
  }
  for (let i = 0; i < edges.length; i += 1) {
    if (!edges[i]) continue;
    const o = i * 4;
    d[o] = 18;
    d[o + 1] = 16;
    d[o + 2] = 22;
  }
  return image;
}

async function blobFrom(canvas?: any, type?: any) : Promise<any> {
  const blob = await new Promise((resolve?: any) : any => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("Could not save the picture on this phone.");
  return blob;
}

export async function drawPreview(canvas?: any, img?: any, zoom?: any, panX?: any, panY?: any) : Promise<any> {
  const ctx = canvas.getContext("2d");
  const side = canvas.width;
  const crop = cropOf(img, zoom, panX, panY, side);
  ctx.clearRect(0, 0, side, side);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, side, side);
}

export async function makeLocalAvatar(img?: any, zoom?: any, panX?: any, panY?: any) : Promise<any> {
  const face = document.createElement("canvas");
  face.width = 192;
  face.height = 192;
  const ctx: any = face.getContext("2d", { willReadFrequently: true });
  const crop = cropOf(img, zoom, panX, panY, 192);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 192, 192);
  const pixels = ctx.getImageData(0, 0, 192, 192);
  ctx.putImageData(stylise(pixels), 0, 0);
  const png = await blobFrom(face, "image/png");
  const source = document.createElement("canvas");
  source.width = 192;
  source.height = 192;
  (source.getContext("2d") as any).drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 192, 192);
  const sourceBlob = await blobFrom(source, "image/jpeg");
  return remember(png, sourceBlob);
}

export function ownAiPrompt(preset?: any, level?: any) : any {
  const look = PRESETS[preset] || PRESETS.anime;
  const tier = tierFor(level);
  return `${look} Use a ${tier} portrait frame (stone, bronze, gold, or flame) that matches level ${level || 1}. The person should still look like the attached selfie. No text in the image.`;
}

const PRESETS: Record<string, string> = {
  anime: "Anime portrait, head and shoulders, clean line art, flat colours, plain background, no text.",
  cartoon: "3D cartoon portrait, head and shoulders, soft light, simple background, no text.",
  chibi: "Chibi portrait, large head, small shoulders, plain background, no text.",
};

export async function makeAiAvatar(img?: any, zoom?: any, panX?: any, panY?: any, key?: any, preset?: any) : Promise<any> {
  const crop = document.createElement("canvas");
  crop.width = 512;
  crop.height = 512;
  const box = cropOf(img, zoom, panX, panY, 512);
  (crop.getContext("2d") as any).drawImage(img, box.sx, box.sy, box.sw, box.sh, 0, 0, 512, 512);
  const png = await blobFrom(crop, "image/png");
  const body = new FormData();
  body.append("model", "gpt-image-1");
  body.append("image", png, "photo.png");
  body.append("prompt", PRESETS[preset] || PRESETS.anime);
  body.append("size", "1024x1024");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + key },
    body,
  });
  const data = await res.json().catch(() : any => ({}));
  if (!res.ok) throw new Error(data.error && data.error.message ? data.error.message : "The AI provider did not return a picture.");
  const b64 = data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error("The AI provider did not return a picture.");
  const bytes = Uint8Array.from(atob(b64), (ch?: any) : any => ch.charCodeAt(0));
  const face = new Blob([bytes], { type: "image/png" });
  const framed = await frameAi(face);
  return remember(framed, png);
}

async function frameAi(blob?: any) : Promise<any> {
  const img = await createImageBitmap(blob);
  const face = document.createElement("canvas");
  face.width = 192;
  face.height = 192;
  (face.getContext("2d") as any).drawImage(img, 0, 0, 192, 192);
  img.close();
  return blobFrom(face, "image/png");
}

async function driveFileId(token?: any, name?: any) : Promise<any> {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("Google Drive did not list the backup.");
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : "";
}

async function uploadDrive(token?: any, name?: any, blob?: any) : Promise<any> {
  const id = await driveFileId(token, name);
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name, mimeType: blob.type || "image/png" })], { type: "application/json" }));
  form.append("file", blob, name);
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const res = await fetch(url, { method: id ? "PATCH" : "POST", headers: { Authorization: "Bearer " + token }, body: form });
  if (!res.ok) throw new Error("Google Drive did not store the backup.");
}

export async function backupAvatar(token?: any) : Promise<any> {
  const db = await openDb();
  const current = await getBlob(db, "current");
  const source = await getBlob(db, "source");
  db.close();
  if (!current) throw new Error("Make an avatar on this phone first.");
  await uploadDrive(token, "Fit avatar.png", current);
  if (source) await uploadDrive(token, "Fit avatar source.jpg", source);
}

async function downloadDrive(token?: any, name?: any) : Promise<any> {
  const id = await driveFileId(token, name);
  if (!id) return null;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("Google Drive did not return the backup.");
  return res.blob();
}

export async function restoreAvatar(token?: any) : Promise<any> {
  const current = await downloadDrive(token, "Fit avatar.png");
  if (!current) throw new Error("No avatar backup was found in your Drive.");
  const source = await downloadDrive(token, "Fit avatar source.jpg");
  return remember(current, source);
}

export function editorHtml(avatar?: any) : any {
  const versions = (avatar.versions || []).map((item?: any) : any => `<button type="button" class="ghost" data-avatar-version="${item.id}"><img alt="" src="${item.url}"></button>`).join("");
  const stage = avatar.draft ? `<canvas id="avatarStage" width="240" height="240" class="avatar-stage"></canvas><label>Zoom<input id="avatarZoom" type="range" min="1" max="3" step="0.05" value="${avatar.draft.zoom}"></label><p class="hint">Drag the picture so the face fills the square. No face model is downloaded.</p><button type="button" id="avatarMake">Make avatar on this phone</button>` : "";
  return `<section class="card"><h2>Avatar</h2>
    <p class="hint">The photo and the avatar stay on this phone. Fit's server never receives them. You can also keep a copy in your own Google Drive.</p>
    <div class="actions"><label class="ghost">Take a selfie<input id="avatarCamera" type="file" accept="image/*" capture="user"></label><label class="ghost">Upload a photo<input id="avatarFile" type="file" accept="image/*"></label></div>
    ${stage}
    ${versions ? `<div class="versions">${versions}</div>` : ""}
    <label class="hint"><input id="avatarShare" type="checkbox" ${avatar.share ? "checked" : ""}> Show my avatar on this phone's team board. Teammates do not receive it.</label>
    <h3>Optional AI style</h3>
    <p class="hint">Uses the same OpenAI key as the weekly coach. The photo goes from this phone straight to OpenAI. FitCouple does not receive it. Tick the box each time.</p>
    <label>Style<select id="avatarStyle"><option value="anime">Anime</option><option value="cartoon">3D cartoon</option><option value="chibi">Chibi</option></select></label>
    <label class="hint"><input id="avatarConsent" type="checkbox"> I agree to send this crop to OpenAI for one portrait.</label>
    <button type="button" id="avatarAi">Make with my AI key</button>
    <button type="button" id="avatarCopy">Make it with your own AI</button>
    ${avatar.prompt ? `<textarea id="avatarPrompt" readonly rows="5">${avatar.prompt}</textarea><p class="hint">Paste this with your selfie into your own ChatGPT or Gemini app, then upload the picture here. Fit does not send that selfie.</p>` : ""}
    <div class="actions"><button type="button" id="avatarBackup">Back up to my Drive</button><button type="button" id="avatarRestore">Restore from my Drive</button><button type="button" id="avatarDelete">Delete photo and avatar</button></div>
    </section>`;
}

let draftImage: any = null;

async function readFile(file?: any) : Promise<any> {
  if (!file) return;
  if (draftImage && draftImage.close) draftImage.close();
  draftImage = await createImageBitmap(file);
}

export function bindAvatar(ctx?: any) : any {
  const { state, render, run } = ctx;
  const avatar = state.avatar || emptyAvatar();
  const stage = document.getElementById("avatarStage");
  if (stage && draftImage) {
    const draft = avatar.draft || { zoom: 1, panX: 0.5, panY: 0.5 };
    drawPreview(stage, draftImage, draft.zoom, draft.panX, draft.panY);
    const zoom = document.getElementById("avatarZoom");
    if (zoom) zoom.addEventListener("input", () : any => {
      state.avatar.draft.zoom = Number(zoom.value);
      drawPreview(stage, draftImage, state.avatar.draft.zoom, state.avatar.draft.panX, state.avatar.draft.panY);
    });
    let drag: any = null;
    stage.addEventListener("pointerdown", (event?: any) : any => {
      drag = { x: event.clientX, y: event.clientY, panX: state.avatar.draft.panX, panY: state.avatar.draft.panY };
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener("pointermove", (event?: any) : any => {
      if (!drag) return;
      state.avatar.draft.panX = Math.min(1, Math.max(0, drag.panX - (event.clientX - drag.x) / 240));
      state.avatar.draft.panY = Math.min(1, Math.max(0, drag.panY - (event.clientY - drag.y) / 240));
      drawPreview(stage, draftImage, state.avatar.draft.zoom, state.avatar.draft.panX, state.avatar.draft.panY);
    });
    stage.addEventListener("pointerup", () : any => { drag = null; });
  }
  async function choose(file?: any) : Promise<any> {
    await readFile(file);
    state.avatar.draft = { zoom: 1, panX: 0.5, panY: 0.5 };
    render();
  }
  const camera = document.getElementById("avatarCamera");
  if (camera) camera.addEventListener("change", () : any => run(() : any => choose(camera.files && camera.files[0])));
  const file = document.getElementById("avatarFile");
  if (file) file.addEventListener("change", () : any => run(() : any => choose(file.files && file.files[0])));
  const make = document.getElementById("avatarMake");
  if (make) make.addEventListener("click", () : any => run(async () : Promise<any> => {
    if (!draftImage) throw new Error("Choose a photo first.");
    const draft = state.avatar.draft || { zoom: 1, panX: 0.5, panY: 0.5 };
    const next = await makeLocalAvatar(draftImage, draft.zoom, draft.panX, draft.panY);
    revokeAvatar(state.avatar);
    state.avatar = { ...next, draft: state.avatar.draft };
    return "Avatar saved on this phone.";
  }));
  document.querySelectorAll("[data-avatar-version]").forEach((button?: any) : any => {
    button.addEventListener("click", () : any => run(async () : Promise<any> => {
      const next = await useVersion(button.getAttribute("data-avatar-version"));
      revokeAvatar(state.avatar);
      state.avatar = { ...next, draft: state.avatar.draft };
    }));
  });
  const share = document.getElementById("avatarShare");
  if (share) share.addEventListener("change", () : any => run(async () : Promise<any> => {
    await saveShare(share.checked);
    state.avatar.share = share.checked;
  }));
  const copyPrompt = document.getElementById("avatarCopy");
  if (copyPrompt) copyPrompt.addEventListener("click", () : any => {
    const preset = (document.getElementById("avatarStyle") || {}).value || "anime";
    state.avatar.prompt = ownAiPrompt(preset, state.profile ? state.profile.level : 1);
    render();
  });
  const ai = document.getElementById("avatarAi");
  if (ai) ai.addEventListener("click", () : any => run(async () : Promise<any> => {
    const consent = document.getElementById("avatarConsent");
    if (!consent || !consent.checked) throw new Error("Tick the box to send this crop to OpenAI.");
    consent.checked = false;
    const key = localStorage.getItem("fitAiKey") || "";
    if (!key) throw new Error("Add your OpenAI key in the weekly coach section first. It stays on this phone.");
    if (!draftImage) throw new Error("Choose a photo first.");
    const draft = state.avatar.draft || { zoom: 1, panX: 0.5, panY: 0.5 };
    const preset = document.getElementById("avatarStyle").value;
    const next = await makeAiAvatar(draftImage, draft.zoom, draft.panX, draft.panY, key, preset);
    revokeAvatar(state.avatar);
    state.avatar = { ...next, draft: state.avatar.draft };
    return "Avatar saved on this phone. OpenAI received the crop. Fit did not.";
  }));
  const backup = document.getElementById("avatarBackup");
  if (backup) backup.addEventListener("click", () : any => run(async () : Promise<any> => {
    if (!state.googleToken) throw new Error("Sign in with Google on the sheet section first. The backup uses drive.file.");
    await backupAvatar(state.googleToken);
    return "Backed up to your Google Drive.";
  }));
  const restore = document.getElementById("avatarRestore");
  if (restore) restore.addEventListener("click", () : any => run(async () : Promise<any> => {
    if (!state.googleToken) throw new Error("Sign in with Google on the sheet section first.");
    const next = await restoreAvatar(state.googleToken);
    revokeAvatar(state.avatar);
    state.avatar = next;
    return "Restored from your Google Drive onto this phone.";
  }));
  const wipe = document.getElementById("avatarDelete");
  if (wipe) wipe.addEventListener("click", () : any => run(async () : Promise<any> => {
    revokeAvatar(state.avatar);
    if (draftImage && draftImage.close) draftImage.close();
    draftImage = null;
    state.avatar = await deleteAvatar();
    return "Photo and avatar deleted from this phone.";
  }));
}

function revokeAvatar(avatar?: any) : any {
  if (!avatar) return;
  if (avatar.url && avatar.url.startsWith("blob:")) URL.revokeObjectURL(avatar.url);
  for (const item of avatar.versions || []) {
    if (item.url && item.url.startsWith("blob:")) URL.revokeObjectURL(item.url);
  }
}
