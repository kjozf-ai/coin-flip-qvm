import type { Express } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Get current round ─────────────────────────────────────────────────
  app.get("/api/rounds/current", async (_req, res) => {
    const round = storage.getCurrentRound();
    res.json(round || null);
  });

  // ── Get recent rounds ─────────────────────────────────────────────────
  app.get("/api/rounds", async (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 10;
    res.json(storage.getRecentRounds(limit));
  });

  // ── Get accumulated pool ──────────────────────────────────────────────
  app.get("/api/pool", async (_req, res) => {
    res.json({ accumulated: storage.getAccumulatedPool() });
  });

  // ── Create a new round (Admin) ────────────────────────────────────────
  app.post("/api/rounds", async (req, res) => {
    const { entryFee, contractType } = req.body;
    const current = storage.getCurrentRound();
    if (current && current.status === "open") {
      return res.status(400).json({ error: "Már van aktív kör" });
    }

    // Get rollover from accumulated pool
    const rollover = storage.getAccumulatedPool();

    const round = storage.createRound({
      status: "open",
      entryFee: entryFee || "0.1",
      pool: "0",
      rolloverPool: rollover,
      totalPool: rollover, // starts with rollover
      contractType: contractType || "js",
      playerCount: 0,
      headsCount: 0,
      tailsCount: 0,
      unclaimedPrize: "0",
      createdAt: Date.now(),
    });

    // Reset accumulated pool since it's now in the round
    storage.setAccumulatedPool("0");

    storage.createEvent({
      type: "GameStarted",
      roundId: round.id,
      data: JSON.stringify({
        entryFee: round.entryFee,
        rolloverPool: rollover,
        contractType: round.contractType
      }),
      timestamp: Date.now(),
    });

    res.json(round);
  });

  // ── Place a bet ───────────────────────────────────────────────────────
  app.post("/api/bets", async (req, res) => {
    const { roundId, playerAddress, guess, txHash } = req.body;
    if (!playerAddress || !guess) {
      return res.status(400).json({ error: "playerAddress és guess szükséges" });
    }
    if (guess !== "heads" && guess !== "tails") {
      return res.status(400).json({ error: "guess: 'heads' vagy 'tails'" });
    }

    const round = storage.getRound(roundId);
    if (!round) return res.status(404).json({ error: "Kör nem található" });
    if (round.status !== "open") {
      return res.status(400).json({ error: "A kör már nem nyitott" });
    }

    // Check if player already bet in this round
    const existing = storage.getBetByAddressAndRound(playerAddress, roundId);
    if (existing) {
      return res.status(400).json({ error: "Már beléptél ebbe a körbe" });
    }

    const bet = storage.createBet({ roundId, playerAddress, guess, txHash: txHash || null });

    // Update round stats
    const newPool = (parseFloat(round.pool) + parseFloat(round.entryFee)).toFixed(4);
    const newTotalPool = (parseFloat(newPool) + parseFloat(round.rolloverPool || "0")).toFixed(4);
    const newHeads = guess === "heads" ? (round.headsCount || 0) + 1 : round.headsCount || 0;
    const newTails = guess === "tails" ? (round.tailsCount || 0) + 1 : round.tailsCount || 0;

    storage.updateRound(roundId, {
      playerCount: (round.playerCount || 0) + 1,
      pool: newPool,
      totalPool: newTotalPool,
      headsCount: newHeads,
      tailsCount: newTails,
    });

    storage.createEvent({
      type: "BetPlaced",
      roundId,
      playerAddress,
      data: JSON.stringify({ guess, pool: newPool, totalPool: newTotalPool, txHash }),
      timestamp: Date.now(),
    });

    res.json(bet);
  });

  // ── Close round (Admin) ───────────────────────────────────────────────
  app.post("/api/rounds/:id/close", async (req, res) => {
    const round = storage.getRound(parseInt(req.params.id));
    if (!round) return res.status(404).json({ error: "Kör nem található" });
    if (round.status !== "open") return res.status(400).json({ error: "A kör nem nyitott" });
    if ((round.playerCount || 0) < 1) return res.status(400).json({ error: "Nincs elég játékos" });

    // Generate deterministic random (simulating QVM getrandom)
    const randBuf = randomBytes(32);
    const randomHex = randBuf.toString("hex").substring(0, 16);
    const randomValue = parseInt(randomHex.substring(0, 8), 16);
    const result = randomValue % 2 === 0 ? "heads" : "tails";

    const allBets = storage.getBetsByRound(round.id);
    const winnerCount = allBets.filter(b => b.guess === result).length;
    const totalPool = parseFloat(round.totalPool || round.pool);
    const prizePerWinner = winnerCount > 0
      ? (totalPool / winnerCount).toFixed(4)
      : "0";

    // If nobody won, all goes to accumulated pool
    const unclaimedPrize = winnerCount === 0 ? totalPool.toFixed(4) : totalPool.toFixed(4);

    storage.updateRound(round.id, {
      status: "closed",
      result,
      winnerCount,
      prizePerWinner,
      randomHex,
      unclaimedPrize: unclaimedPrize,
    });

    // Mark winning bets
    storage.updateBetsWon(round.id, result);

    // Update leaderboard
    for (const bet of allBets) {
      const won = bet.guess === result;
      storage.upsertLeaderboardEntry(bet.playerAddress, won, won ? prizePerWinner : "0");
    }

    // If nobody won, add total pool to accumulated
    if (winnerCount === 0) {
      const currentAccum = parseFloat(storage.getAccumulatedPool());
      storage.setAccumulatedPool((currentAccum + totalPool).toFixed(4));
    }

    storage.createEvent({
      type: "GameFinished",
      roundId: round.id,
      data: JSON.stringify({
        result,
        winnerCount,
        totalPool: totalPool.toFixed(4),
        prizePerWinner,
        randomHex,
        nobodyWon: winnerCount === 0,
      }),
      timestamp: Date.now(),
    });

    res.json({
      ...round,
      status: "closed",
      result,
      winnerCount,
      prizePerWinner,
      randomHex,
      totalPool: totalPool.toFixed(4),
    });
  });

  // ── Claim prize ───────────────────────────────────────────────────────
  app.post("/api/claim", async (req, res) => {
    const { playerAddress, roundId } = req.body;
    if (!playerAddress || !roundId) {
      return res.status(400).json({ error: "playerAddress és roundId szükséges" });
    }

    const round = storage.getRound(roundId);
    if (!round || round.status !== "closed") {
      return res.status(400).json({ error: "A kör nincs lezárva" });
    }

    const bet = storage.getBetByAddressAndRound(playerAddress, roundId);
    if (!bet) return res.status(400).json({ error: "Nem vettél részt ebben a körben" });
    if (!bet.won) return res.status(400).json({ error: "Nem nyertél ebben a körben" });
    if (bet.claimed) return res.status(400).json({ error: "Már igényelted a nyereményt" });

    // Mark as claimed
    storage.updateBet(bet.id, { claimed: 1 });

    // Update unclaimed amount in round
    const unclaimed = parseFloat(round.unclaimedPrize || "0") - parseFloat(round.prizePerWinner || "0");
    storage.updateRound(roundId, { unclaimedPrize: Math.max(0, unclaimed).toFixed(4) });

    storage.createEvent({
      type: "PrizeClaimed",
      roundId,
      playerAddress,
      data: JSON.stringify({ amount: round.prizePerWinner }),
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      amount: round.prizePerWinner,
      message: `${round.prizePerWinner} QANX nyeremény igényelve!`,
    });
  });

  // ── Finalize round (move unclaimed to accumulated) ────────────────────
  app.post("/api/rounds/:id/finalize", async (req, res) => {
    const round = storage.getRound(parseInt(req.params.id));
    if (!round || round.status !== "closed") {
      return res.status(400).json({ error: "A kör nincs lezárva" });
    }

    // Check unclaimed bets
    const allBets = storage.getBetsByRound(round.id);
    const unclaimedWinners = allBets.filter(b => b.won && !b.claimed);
    const unclaimedAmount = unclaimedWinners.length * parseFloat(round.prizePerWinner || "0");

    if (unclaimedAmount > 0) {
      const currentAccum = parseFloat(storage.getAccumulatedPool());
      storage.setAccumulatedPool((currentAccum + unclaimedAmount).toFixed(4));
      storage.updateRound(round.id, { unclaimedPrize: "0" });

      storage.createEvent({
        type: "PoolRollover",
        roundId: round.id,
        data: JSON.stringify({ amount: unclaimedAmount.toFixed(4), reason: "unclaimed prizes" }),
        timestamp: Date.now(),
      });
    }

    res.json({ success: true, rolledOver: unclaimedAmount.toFixed(4) });
  });

  // ── Get bets for round ────────────────────────────────────────────────
  app.get("/api/rounds/:id/bets", async (req, res) => {
    res.json(storage.getBetsByRound(parseInt(req.params.id)));
  });

  // ── Check if player can claim ─────────────────────────────────────────
  app.get("/api/claim/:roundId/:address", async (req, res) => {
    const bet = storage.getBetByAddressAndRound(req.params.address, parseInt(req.params.roundId));
    if (!bet) return res.json({ canClaim: false, reason: "not_participated" });
    if (!bet.won) return res.json({ canClaim: false, reason: "lost" });
    if (bet.claimed) return res.json({ canClaim: false, reason: "already_claimed" });
    const round = storage.getRound(parseInt(req.params.roundId));
    return res.json({ canClaim: true, amount: round?.prizePerWinner || "0" });
  });

  // ── Leaderboard ───────────────────────────────────────────────────────
  app.get("/api/leaderboard", async (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 20;
    res.json(storage.getLeaderboard(limit));
  });

  // ── Events ────────────────────────────────────────────────────────────
  app.get("/api/events", async (_req, res) => {
    const limit = parseInt(_req.query.limit as string) || 50;
    res.json(storage.getRecentEvents(limit));
  });

  return httpServer;
}
