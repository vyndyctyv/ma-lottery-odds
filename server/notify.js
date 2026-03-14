import fs from "fs";
import { analyzeAll } from "./analyzer.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

// Load Pushover credentials
function loadPushover() {
  const secretsPath = path.join(process.env.HOME || "/Users/ianhandy", ".pushover_secrets");
  if (!fs.existsSync(secretsPath)) return null;
  const content = fs.readFileSync(secretsPath, "utf8");
  const vars = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^(?:export\s+)?(\w+)=["']?([^"'\s]+)/);
    if (match) vars[match[1]] = match[2];
  }
  return vars.PUSHOVER_TOKEN && vars.PUSHOVER_USER ? vars : null;
}

// Send Pushover notification
async function sendPushover(title, message, priority = 0) {
  const creds = loadPushover();
  if (!creds) {
    console.error("[notify] Pushover credentials not found");
    return false;
  }

  const form = new URLSearchParams();
  form.append("token", creds.PUSHOVER_TOKEN);
  form.append("user", creds.PUSHOVER_USER);
  form.append("title", title);
  form.append("message", message);
  form.append("priority", String(priority));

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: form,
  });
  return res.ok;
}

// Send email via Pushover email alias (for longer reports)
async function sendEmail(subject, body) {
  const creds = loadPushover();
  if (!creds) return false;

  // Pushover email gateway: send to the alias, it arrives as a push
  // For longer content, we use the Pushover API with html support
  const form = new URLSearchParams();
  form.append("token", creds.PUSHOVER_TOKEN);
  form.append("user", creds.PUSHOVER_USER);
  form.append("title", subject);
  form.append("message", body);
  form.append("html", "1");
  form.append("priority", "0");

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: form,
  });
  return res.ok;
}

// Build the daily report
export function buildReport(analysis) {
  const { timestamp } = analysis;
  // Filter out ended/ending tickets — they're no longer buyable
  const tickets = analysis.tickets.filter((t) => t.status !== "ending");
  const notable = tickets.filter((t) => t.isNotable);
  const date = new Date(timestamp).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  let report = `<b>MA Lottery Odds Report — ${date}</b>\n`;
  report += `${tickets.length} scratch tickets analyzed\n\n`;

  if (notable.length > 0) {
    report += `<b>Notable Tickets (${notable.length}):</b>\n`;
    for (const t of notable) {
      report += `\n<b>${t.name}</b> ($${t.price})\n`;
      report += `  Adjusted EV: ${t.adjustedEv >= 0 ? "+" : ""}$${t.adjustedEv} (${t.adjustedEvPercent}%)\n`;
      report += `  Sim (3-ticket budget): avg $${t.simAvgNet} over ${t.simAvgPulls} pulls\n`;

      if (t.bigPrizeAlerts.length > 0) {
        for (const alert of t.bigPrizeAlerts) {
          report += `  <b>$${alert.prize.toLocaleString()}</b>: odds improved ${alert.improvement}% (1 in ${alert.currentOdds.toLocaleString()} vs original 1 in ${alert.originalOdds.toLocaleString()}), ${alert.remaining} remaining\n`;
        }
      }
    }
  } else {
    report += `No tickets with notably good odds today.\n`;
  }

  // Top 5 by adjusted EV regardless
  report += `\n<b>Top 5 by Adjusted EV:</b>\n`;
  for (const t of tickets.slice(0, 5)) {
    report += `  ${t.name} ($${t.price}): ${t.adjustedEvPercent}% EV\n`;
  }

  // Bottom 3 — worst value
  report += `\n<b>Worst 3 (avoid):</b>\n`;
  for (const t of tickets.slice(-3).reverse()) {
    report += `  ${t.name} ($${t.price}): ${t.adjustedEvPercent}% EV\n`;
  }

  return report;
}

// Run the daily notification
export async function sendDailyReport() {
  const latestPath = path.join(DATA_DIR, "latest.json");
  if (!fs.existsSync(latestPath)) {
    console.error("[notify] No data — run scraper first");
    return false;
  }

  const scrapeData = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  const analysis = analyzeAll(scrapeData);
  const report = buildReport(analysis);

  // Save report to disk
  const today = new Date().toISOString().slice(0, 10);
  const reportsDir = path.join(DATA_DIR, "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, `${today}.html`), report);

  // Send via Pushover
  const title =
    analysis.notableCount > 0
      ? `Lottery: ${analysis.notableCount} notable ticket${analysis.notableCount > 1 ? "s" : ""}`
      : "Lottery: daily odds update";

  const ok = await sendEmail(title, report);
  console.log(`[notify] Report sent: ${ok ? "success" : "failed"}`);
  return ok;
}

// Run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sendDailyReport().catch(console.error);
}
