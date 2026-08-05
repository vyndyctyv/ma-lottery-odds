import fs from "fs";
import { analyzeAll } from "./analyzer.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const POSITIVE_EV_STATE = path.join(DATA_DIR, "positive-ev-alert-state.json");
const ROUTER_URL = process.env.DISCORD_ROUTER_URL || "http://127.0.0.1:3005";
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/Users/ianhandy/Programming/workspace";
const DISCORD_CONFIG_PATH = process.env.DISCORD_CONFIG_PATH || path.join(WORKSPACE_DIR, "tasks", "discord-config.json");

function loadPositiveEvState() {
  if (!fs.existsSync(POSITIVE_EV_STATE)) return null;
  try {
    return JSON.parse(fs.readFileSync(POSITIVE_EV_STATE, "utf8"));
  } catch {
    return {};
  }
}

function savePositiveEvState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(POSITIVE_EV_STATE, JSON.stringify(state, null, 2) + "\n");
}

function discordAlertsChannelId() {
  if (process.env.DISCORD_ALERTS_CHANNEL_ID) return process.env.DISCORD_ALERTS_CHANNEL_ID;
  if (!fs.existsSync(DISCORD_CONFIG_PATH)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(DISCORD_CONFIG_PATH, "utf8"));
    return config.channels?.[config.alertsChannel || "alerts"] || null;
  } catch {
    return null;
  }
}

async function sendDiscordAlert(message) {
  const channelId = discordAlertsChannelId();
  if (!channelId) {
    console.error("[notify] Discord alerts channel is not configured");
    return false;
  }
  try {
    const res = await fetch(`${ROUTER_URL}/channel/${encodeURIComponent(channelId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      console.error(`[notify] Discord alert failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[notify] Discord alert failed: ${err.message}`);
    return false;
  }
}

// Alert only when an active ticket crosses from non-positive to positive
// adjusted EV. The state file makes this edge-triggered rather than noisy.
export async function notifyPositiveEvCrossings(analysis) {
  const positive = analysis.tickets
    .filter((ticket) => ticket.status === "active" && ticket.adjustedEv > 0)
    .map((ticket) => ({
      id: ticket.identifier,
      name: ticket.name,
      price: ticket.price,
      adjustedEv: ticket.adjustedEv,
      adjustedEvPercent: ticket.adjustedEvPercent,
      url: ticket.url,
    }));
  const current = Object.fromEntries(positive.map((ticket) => [ticket.id, ticket]));
  const previous = loadPositiveEvState();

  // Establish a baseline on first run; existing positive tickets did not
  // cross during this installation.
  if (previous === null) {
    savePositiveEvState(current);
    console.log(`[notify] Positive-EV alert baseline established (${positive.length} active)`);
    return false;
  }

  const crossed = positive.filter((ticket) => !previous[ticket.id]);
  if (crossed.length === 0) {
    savePositiveEvState(current);
    return false;
  }

  let message = "🎟️ **MA Lottery: positive adjusted EV**\n";
  message += "The following active ticket(s) just crossed above zero:\n\n";
  for (const ticket of crossed) {
    message += `**${ticket.name}** — $${ticket.price} ticket; adjusted EV **+$${ticket.adjustedEv} (${ticket.adjustedEvPercent}%)**\n`;
    message += `${ticket.url}\n\n`;
  }
  message += "Verify current availability before buying; the edge is an estimate, not a guarantee.";

  const sent = await sendDiscordAlert(message);
  if (sent) savePositiveEvState(current);
  return sent;
}

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
