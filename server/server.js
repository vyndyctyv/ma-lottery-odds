import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeAll } from "./analyzer.js";
import { scrapeAll } from "./scraper.js";
import { notifyPositiveEvCrossings, sendDailyReport } from "./notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");

async function scrapeAndNotify() {
  const data = await scrapeAll();
  await notifyPositiveEvCrossings(analyzeAll(data));
  return data;
}

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── /api/analysis — return latest analyzed data ──────────────────────────────
app.get("/api/analysis", (req, res) => {
  const latestPath = path.join(DATA_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) {
    return res.json({ error: "No data yet. Run a scrape first.", tickets: [] });
  }
  const scrapeData = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const analysis = analyzeAll(scrapeData);
  res.json(analysis);
});

// ── /api/scrape — trigger a fresh scrape ─────────────────────────────────────
let scraping = false;
app.post("/api/scrape", async (req, res) => {
  if (scraping) return res.json({ error: "Scrape already in progress" });
  scraping = true;
  res.json({ status: "started" });
  try {
    await scrapeAndNotify();
    console.log("[server] Scrape complete");
  } catch (err) {
    console.error("[server] Scrape failed:", err.message);
  }
  scraping = false;
});

// ── /api/scrape-status — check if scraping ───────────────────────────────────
app.get("/api/scrape-status", (req, res) => {
  const latestPath = path.join(DATA_DIR, "latest.json");
  let lastScrape = null;
  if (fs.existsSync(latestPath)) {
    const data = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    lastScrape = data.timestamp;
  }
  res.json({ scraping, lastScrape });
});

// ── /api/notify — send the daily report now ──────────────────────────────────
app.post("/api/notify", async (req, res) => {
  try {
    const ok = await sendDailyReport();
    res.json({ ok });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── /api/history — list available data dates ─────────────────────────────────
app.get("/api/history", (req, res) => {
  if (!fs.existsSync(DATA_DIR)) return res.json({ dates: [] });
  const dates = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort()
    .reverse();
  res.json({ dates });
});

// ── Schedule: scrape daily at 6am, notify at 8am ────────────────────────────
function scheduleDailyTasks() {
  const now = new Date();

  // Schedule next scrape at 6am
  const nextScrape = new Date(now);
  nextScrape.setHours(6, 0, 0, 0);
  if (nextScrape <= now) nextScrape.setDate(nextScrape.getDate() + 1);
  const scrapeDelay = nextScrape - now;

  setTimeout(async function runScrape() {
    console.log("[schedule] Starting daily scrape...");
    try {
      await scrapeAndNotify();
    } catch (err) {
      console.error("[schedule] Scrape failed:", err.message);
    }
    // Schedule next day
    setTimeout(runScrape, 24 * 60 * 60 * 1000);
  }, scrapeDelay);

  // Schedule notify at 8am
  const nextNotify = new Date(now);
  nextNotify.setHours(8, 0, 0, 0);
  if (nextNotify <= now) nextNotify.setDate(nextNotify.getDate() + 1);
  const notifyDelay = nextNotify - now;

  setTimeout(async function runNotify() {
    console.log("[schedule] Sending daily report...");
    try {
      await sendDailyReport();
    } catch (err) {
      console.error("[schedule] Notify failed:", err.message);
    }
    setTimeout(runNotify, 24 * 60 * 60 * 1000);
  }, notifyDelay);

  console.log(
    `[schedule] Next scrape: ${nextScrape.toLocaleString()}, next notify: ${nextNotify.toLocaleString()}`
  );
}

app.listen(PORT, async () => {
  console.log(`MA Lottery Odds at http://localhost:${PORT}`);
  scheduleDailyTasks();

  // Catch-up scrape if data is stale (>23h old or missing)
  const latestPath = path.join(DATA_DIR, "latest.json");
  let stale = true;
  if (fs.existsSync(latestPath)) {
    const { timestamp } = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    stale = Date.now() - new Date(timestamp).getTime() > 23 * 60 * 60 * 1000;
  }
  if (stale && !scraping) {
    console.log("[schedule] Data stale on startup — running catch-up scrape...");
    scraping = true;
    try {
      await scrapeAndNotify();
    } catch (err) {
      console.error("[schedule] Catch-up scrape failed:", err.message);
    }
    scraping = false;
  }
});
