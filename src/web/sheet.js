import { parseCsv, rowsFromTable } from "./summary.js";

export function sheetIdFromUrl(url) {
  const match = String(url || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : "";
}

export async function fetchLinkLog(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent("Log")}&t=${Date.now()}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("Cannot read that sheet. Share it as anyone with the link can view, or sign in with Google for a private sheet.");
  }
  if (!res.ok) throw new Error("Cannot read that sheet. Share it as anyone with the link can view.");
  return rowsFromTable(parseCsv(await res.text()));
}

const PRACTICE_KEY = "fitPracticeRows";

export function loadPractice() {
  try {
    const rows = JSON.parse(localStorage.getItem(PRACTICE_KEY) || "[]");
    return Array.isArray(rows) ? rows.slice(-200) : [];
  } catch {
    return [];
  }
}

export function savePractice(rows) {
  localStorage.setItem(PRACTICE_KEY, JSON.stringify(rows.slice(-200)));
}
