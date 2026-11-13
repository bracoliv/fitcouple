import { rowsFromTable } from "./summary.js";

// drive.file is the narrow scope: only sheets this app creates, or a sheet the person picks.
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";

export function clientIdReady(id) {
  return typeof id === "string"
    && id.endsWith(".apps.googleusercontent.com")
    && !id.includes("YOUR_GOOGLE_CLIENT_ID");
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing && existing.dataset.loaded === "yes") {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load a Google library.")));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "yes";
      resolve();
    };
    script.onerror = () => reject(new Error("Could not load a Google library."));
    document.head.appendChild(script);
  });
}

export function requestGoogleToken(config) {
  if (!clientIdReady(config.googleClientId)) {
    return Promise.reject(new Error("Add your Google client id to config.js. The README has the steps."));
  }
  return new Promise((resolve, reject) => {
    loadScript("https://accounts.google.com/gsi/client").then(() => {
      const oauth = window.google && window.google.accounts && window.google.accounts.oauth2;
      if (!oauth) {
        reject(new Error("Google's sign-in library did not load."));
        return;
      }
      const client = oauth.initTokenClient({
        client_id: config.googleClientId,
        scope: SHEETS_SCOPE,
        callback: (resp) => {
          if (!resp || resp.error || !resp.access_token) reject(new Error("Google sign-in was cancelled."));
          else resolve(resp.access_token);
        },
        error_callback: () => reject(new Error("Google sign-in was blocked. Allow pop-ups and try again.")),
      });
      client.requestAccessToken({ prompt: "" });
    }).catch(reject);
  });
}

const LOG_HEADERS = ["Date", "Time", "Person", "Food/Workout", "Calories (kcal)", "Protein (g)", "Carbs (g)", "Fat (g)", "Notes"];

function headerRow(labels) {
  return {
    values: labels.map((label) => ({ userEnteredValue: { stringValue: label } })),
  };
}

function textRow(text) {
  return { values: [{ userEnteredValue: { stringValue: text } }] };
}

export async function createSheet(token) {
  const res = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: { title: "Fit log" },
      sheets: [
        {
          properties: { title: "Log", gridProperties: { frozenRowCount: 1 } },
          data: [{ startRow: 0, startColumn: 0, rowData: [headerRow(LOG_HEADERS)] }],
        },
        {
          properties: { title: "Dashboard" },
          data: [{ rowData: [headerRow(["person", "calories", "protein", "carbs", "fat"])] }],
        },
        {
          properties: { title: "Profile" },
          data: [{ rowData: [textRow("Name"), textRow("Goal")] }],
        },
        {
          properties: { title: "README" },
          data: [{
            rowData: [
              textRow("Append new rows on the Log tab. Do not edit old rows."),
              textRow("A workout row starts with Workout: and the calories are burned, not eaten."),
              textRow("This file stays in your Google Drive. Fit's game server does not read it."),
            ],
          }],
        },
      ],
    }),
  });
  if (res.status === 401) throw new Error("Google sign-in expired. Sign in again.");
  if (!res.ok) throw new Error("Google did not create the sheet. Check that the Sheets API is enabled.");
  const data = await res.json();
  return { id: data.spreadsheetId, url: data.spreadsheetUrl };
}

export async function readLog(token, spreadsheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("Log")}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error("Google sign-in expired. Sign in again.");
  if (res.status === 403) throw new Error("Google did not allow that sheet. Create a new one, or pick a sheet.");
  if (!res.ok) throw new Error("Could not read the sheet.");
  const data = await res.json();
  return rowsFromTable(data.values || []);
}

export async function appendLog(token, spreadsheetId, row) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent("Log")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      values: [[row.date, row.time, row.person, row.text, row.calories, "", "", "", ""]],
    }),
  });
  if (res.status === 401) throw new Error("Google sign-in expired. Sign in again.");
  if (!res.ok) throw new Error("Could not write to the sheet.");
}

export function pickSheet(config, token) {
  if (!config.googleApiKey || !config.googleAppId) {
    return Promise.reject(new Error("Choosing an existing sheet needs a browser API key and the project number in config.js. Creating a new sheet does not."));
  }
  return new Promise((resolve, reject) => {
    loadScript("https://apis.google.com/js/api.js").then(() => {
      window.gapi.load("picker", () => {
        const view = new window.google.picker.DocsView(window.google.picker.ViewId.SPREADSHEETS);
        view.setMimeTypes("application/vnd.google-apps.spreadsheet");
        const picker = new window.google.picker.PickerBuilder()
          .setOAuthToken(token)
          .setDeveloperKey(config.googleApiKey)
          .setAppId(String(config.googleAppId))
          .addView(view)
          .setCallback((data) => {
            if (data.action === "picked" && data.docs && data.docs[0]) resolve(data.docs[0].id);
            else if (data.action === "cancel") reject(new Error("No sheet picked."));
          })
          .build();
        picker.setVisible(true);
      });
    }).catch(reject);
  });
}
