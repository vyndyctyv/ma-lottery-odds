// Analyze scraped lottery ticket data
// Mirrors the original Python logic: weighted average EV, simulation, and "amazing odds" detection

// Calculate the expected value of a ticket after accounting for ticket cost
export function analyzeTicket(ticket) {
  const { price, prizes, totalTickets } = ticket;
  if (!prizes.length || !price) return null;

  // Calculate odds as probability (1/oddsOneIn)
  const prizeRows = prizes.map((p) => ({
    ...p,
    netPrize: p.prize - price,
    probability: 1 / p.oddsOneIn,
  }));

  // Losing ticket probability
  const winProb = prizeRows.reduce((s, p) => s + p.probability, 0);
  const loseProb = Math.max(0, 1 - winProb);

  // Weighted average EV per ticket (net of ticket cost)
  const ev =
    prizeRows.reduce((s, p) => s + p.netPrize * p.probability, 0) +
    -price * loseProb;

  // EV as percentage of ticket price
  const evPercent = (ev / price) * 100;

  // --- Remaining-adjusted odds ---
  // The original odds assume all tickets are in play.
  // As tickets are claimed, the remaining pool changes.
  // Recalculate based on remaining prizes vs estimated remaining total tickets.
  const totalPrizeTicketsStart = prizeRows.reduce((s, p) => s + p.start, 0);
  const totalPrizeTicketsRemaining = prizeRows.reduce(
    (s, p) => s + p.remaining,
    0
  );
  const totalPrizeTicketsClaimed = prizeRows.reduce(
    (s, p) => s + p.claimed,
    0
  );

  // Estimate total remaining tickets
  // Use original Python formula: losing_remaining = winning_remaining * lose_prob / win_prob
  // This preserves the original win/lose ratio in the remaining pool
  const losingRemaining =
    winProb > 0
      ? Math.max(0, Math.round(totalPrizeTicketsRemaining * loseProb / winProb))
      : 0;
  const totalRemaining = totalPrizeTicketsRemaining + losingRemaining;

  // Remaining-adjusted EV
  let adjustedEv = -price; // default: all losing
  if (totalRemaining > 0) {
    adjustedEv =
      prizeRows.reduce(
        (s, p) => s + (p.netPrize * p.remaining) / totalRemaining,
        0
      ) +
      (-price * losingRemaining) / totalRemaining;
  }
  const adjustedEvPercent = (adjustedEv / price) * 100;

  // --- Simulation: "break or broke" ---
  // Budget: 3x ticket price. Buy tickets until you're either up or broke.
  // Run 1000 times, take the average.
  const simResult = simulate(prizeRows, loseProb, price, 3, 1000);

  // --- "Amazing odds" detection ---
  // A ticket is flagged as notable if:
  // 1. Adjusted EV is better than -20% (most tickets are -30% to -50%)
  // 2. OR a big prize (>= $1000) has significantly better remaining odds than original
  const bigPrizeAlerts = [];
  for (const p of prizeRows) {
    if (p.prize < 1000 || p.start === 0) continue;
    const originalRate = p.start / totalTickets;
    const remainingRate = totalRemaining > 0 ? p.remaining / totalRemaining : 0;
    const improvement = originalRate > 0 ? remainingRate / originalRate : 0;
    if (improvement > 1.3 && p.remaining > 0) {
      bigPrizeAlerts.push({
        prize: p.prize,
        originalOdds: p.oddsOneIn,
        currentOdds:
          totalRemaining > 0
            ? Math.round(totalRemaining / p.remaining)
            : Infinity,
        improvement: Math.round((improvement - 1) * 100),
        remaining: p.remaining,
      });
    }
  }

  const isNotable = adjustedEvPercent > -20 || bigPrizeAlerts.length > 0;

  return {
    name: ticket.name,
    identifier: ticket.identifier,
    url: ticket.url || null,
    status: ticket.status || "active",
    expirationDate: ticket.expirationDate || null,
    price,
    ev: Math.round(ev * 100) / 100,
    evPercent: Math.round(evPercent * 10) / 10,
    adjustedEv: Math.round(adjustedEv * 100) / 100,
    adjustedEvPercent: Math.round(adjustedEvPercent * 10) / 10,
    simAvgNet: simResult.avgNet,
    simAvgPulls: simResult.avgPulls,
    totalRemaining,
    isNotable,
    bigPrizeAlerts,
    prizes: prizeRows.map((p) => ({
      prize: p.prize,
      netPrize: p.netPrize,
      oddsOneIn: p.oddsOneIn,
      start: p.start,
      claimed: p.claimed,
      remaining: p.remaining,
    })),
  };
}

// Simulate the "break or broke" strategy from the original code
// Budget = numTickets * ticketPrice. Keep buying until net > 0 or budget exhausted.
function simulate(prizeRows, loseProb, ticketPrice, numTickets, attempts) {
  const results = [];
  const pulls = [];

  // Build cumulative probability array for sampling
  const cumProbs = [];
  const netPrizes = [];
  let cumSum = 0;
  for (const p of prizeRows) {
    cumSum += p.probability;
    cumProbs.push(cumSum);
    netPrizes.push(p.netPrize);
  }
  // Losing ticket
  cumProbs.push(cumSum + loseProb);
  netPrizes.push(-ticketPrice);

  for (let i = 0; i < attempts; i++) {
    let net = 0;
    let count = 0;
    const budget = numTickets * ticketPrice;

    while (net + ticketPrice >= -budget && net <= 0) {
      const r = Math.random();
      let prize = netPrizes[netPrizes.length - 1]; // default: lose
      for (let j = 0; j < cumProbs.length; j++) {
        if (r <= cumProbs[j]) {
          prize = netPrizes[j];
          break;
        }
      }
      net += prize;
      count++;
    }
    results.push(net);
    pulls.push(count);
  }

  return {
    avgNet: Math.round((results.reduce((a, b) => a + b, 0) / results.length) * 100) / 100,
    avgPulls: Math.round((pulls.reduce((a, b) => a + b, 0) / pulls.length) * 10) / 10,
  };
}

// Analyze all tickets from a scrape result
export function analyzeAll(scrapeData) {
  const analyzed = [];
  for (const ticket of scrapeData.tickets) {
    const result = analyzeTicket(ticket);
    if (result) analyzed.push(result);
  }

  // Sort by adjusted EV (best first)
  analyzed.sort((a, b) => b.adjustedEvPercent - a.adjustedEvPercent);

  const notable = analyzed.filter((t) => t.isNotable);

  return {
    timestamp: scrapeData.timestamp,
    totalAnalyzed: analyzed.length,
    notableCount: notable.length,
    tickets: analyzed,
    notable,
  };
}
