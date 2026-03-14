import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");

// Scrape the games list from the API (no browser needed)
async function fetchGamesList() {
  const res = await fetch("https://www.masslottery.com/api/v1/games");
  const games = await res.json();

  const today = new Date().toISOString().slice(0, 10);

  return games
    .filter((g) => g.gameType === "Scratch")
    .map((g) => {
      const expired =
        g.expirationDate && g.expirationDate < today;
      const endingSoon = g.tileFlag === "Ending Soon";
      return {
        ...g,
        status: expired ? "expired" : endingSoon ? "ending" : "active",
        url: `https://www.masslottery.com/games/draw-and-instants/${g.identifier}`,
      };
    })
    .filter((g) => g.status !== "expired"); // skip already expired games
}

// Scrape prize table from a single ticket page using Playwright
async function scrapePrizeTable(page, identifier) {
  const url = `https://www.masslottery.com/games/draw-and-instants/${identifier}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

    // Wait for the prize table to render
    await page.waitForSelector("table", { timeout: 10000 });

    const data = await page.evaluate(() => {
      const table = document.querySelector("table");
      if (!table) return null;

      // Get ticket name and price
      const titleEl = document.querySelector("title");
      const name = titleEl
        ? titleEl.textContent
            .replace(/ \| Games \| Massachusetts Lottery.*/, "")
            .trim()
        : "Unknown";

      const priceEl = document.querySelector(
        ".scratch-game-detail-card-price-text"
      );
      const price = priceEl
        ? parseInt(priceEl.textContent.replace(/[^0-9]/g, ""), 10)
        : 0;

      // Total tickets
      const totalEl = document.querySelector(
        ".game-prizes-remaining-text-info-container"
      );
      let totalTickets = 0;
      if (totalEl) {
        const match = totalEl.textContent.match(/(\d[\d,]*)/);
        if (match) totalTickets = parseInt(match[1].replace(/,/g, ""), 10);
      }

      // Parse table rows
      const rows = table.querySelectorAll("tr");
      const prizes = [];
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 2) continue;

        const cell0 = cells[0].textContent;
        const cell1 = cells[1].textContent;

        // Check for "for life" prizes — skip them (can't assign a fixed value)
        if (/for\s+life|a\s+week|a\s+year/i.test(cell0)) continue;

        // Prize amount — lookahead stops before the "1 in X" odds text
        const prizeMatch = cell0.match(/\$([\d,]+)(?=\s*1\s+in)/);
        if (!prizeMatch) continue;
        const prizeAmount = parseInt(prizeMatch[1].replace(/,/g, ""), 10);

        // Odds (1 in X)
        const oddsMatch = cell0.match(/(?:in\s+)([\d,]+\.?\d*)\s+odds/i);
        if (!oddsMatch) continue;
        const oddsOneIn = parseFloat(oddsMatch[1].replace(/,/g, ""));

        // Start / Claimed / Remaining
        const startMatch = cell1.match(/([\d,]+)\s+Start/i);
        const claimedMatch = cell1.match(/([\d,]+)\s+Claimed/i);
        const remainingMatch = cell1.match(/([\d,]+)\s+Remaining/i);

        prizes.push({
          prize: prizeAmount,
          oddsOneIn,
          start: startMatch
            ? parseInt(startMatch[1].replace(/,/g, ""), 10)
            : 0,
          claimed: claimedMatch
            ? parseInt(claimedMatch[1].replace(/,/g, ""), 10)
            : 0,
          remaining: remainingMatch
            ? parseInt(remainingMatch[1].replace(/,/g, ""), 10)
            : 0,
        });
      }

      return { name, price, totalTickets, prizes };
    });

    return data;
  } catch (err) {
    console.error(`  Failed: ${identifier} — ${err.message}`);
    return null;
  }
}

// Run the full scrape
export async function scrapeAll() {
  console.log("[scraper] Fetching games list...");
  const games = await fetchGamesList();
  console.log(
    `[scraper] Found ${games.length} scratch games (expired filtered out)`
  );

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];
  let scraped = 0;
  let failed = 0;

  for (const game of games) {
    console.log(
      `[scraper] (${scraped + failed + 1}/${games.length}) ${game.name}...`
    );
    const data = await scrapePrizeTable(page, game.identifier);
    if (data && data.prizes.length > 0) {
      results.push({
        ...data,
        identifier: game.identifier,
        id: game.id,
        icon: game.icon?.url || null,
        topPrize: game.topPrize,
        overallOdds: game.odds,
        status: game.status,
        url: game.url,
        expirationDate: game.expirationDate || null,
      });
      scraped++;
    } else {
      failed++;
    }
  }

  await browser.close();

  const timestamp = new Date().toISOString();
  const output = { timestamp, scraped, failed, tickets: results };
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(DATA_DIR, `${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  // Also write as latest.json for quick access
  fs.writeFileSync(
    path.join(DATA_DIR, "latest.json"),
    JSON.stringify(output, null, 2)
  );

  console.log(
    `[scraper] Done. ${scraped} scraped, ${failed} failed. Saved to ${outPath}`
  );
  return output;
}

// Run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  scrapeAll().catch(console.error);
}
