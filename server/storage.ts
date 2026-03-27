import {
  type Round, type InsertRound, rounds,
  type Bet, type InsertBet, bets,
  type LeaderboardEntry, leaderboard,
  type GameEvent, events,
  gameConfig,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, sql, and } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

// ── Schema migrations for existing databases ──────────────────────────────────
// SQLite allows ADD COLUMN safely; throws if already exists — we ignore that.
try { sqlite.exec("ALTER TABLE game_config ADD COLUMN jackpot_pool TEXT NOT NULL DEFAULT '0'"); } catch {}

export const db = drizzle(sqlite);

export interface IStorage {
  createRound(round: InsertRound): Round;
  getRound(id: number): Round | undefined;
  getCurrentRound(): Round | undefined;
  updateRound(id: number, data: Partial<InsertRound>): Round | undefined;
  getRecentRounds(limit: number): Round[];
  createBet(bet: InsertBet): Bet;
  getBetsByRound(roundId: number): Bet[];
  getBetByAddressAndRound(address: string, roundId: number): Bet | undefined;
  updateBet(id: number, data: Partial<InsertBet>): void;
  updateBetsWon(roundId: number, result: string): void;
  /** All unclaimed winning bets for a given wallet address (across all rounds). */
  getUnclaimedBetsForAddress(address: string): Bet[];
  getLeaderboard(limit: number): LeaderboardEntry[];
  upsertLeaderboardEntry(address: string, won: boolean, prize: string): void;
  createEvent(event: { type: string; roundId?: number | null; playerAddress?: string | null; data?: string | null; timestamp: number }): GameEvent;
  getRecentEvents(limit: number): GameEvent[];
  getAccumulatedPool(): string;
  setAccumulatedPool(amount: string): void;
  getJackpotPool(): string;
  addToJackpotPool(amount: string): void;
  flushJackpotToAccumulated(): string; // moves jackpot → accumulated, returns flushed amount
  getClosedRoundCount(): number;
}

export class DatabaseStorage implements IStorage {
  createRound(round: InsertRound): Round {
    return db.insert(rounds).values(round).returning().get();
  }
  getRound(id: number): Round | undefined {
    return db.select().from(rounds).where(eq(rounds.id, id)).get();
  }
  getCurrentRound(): Round | undefined {
    return db.select().from(rounds).orderBy(desc(rounds.id)).limit(1).get();
  }
  updateRound(id: number, data: Partial<InsertRound>): Round | undefined {
    return db.update(rounds).set(data).where(eq(rounds.id, id)).returning().get();
  }
  getRecentRounds(limit: number): Round[] {
    return db.select().from(rounds).orderBy(desc(rounds.id)).limit(limit).all();
  }
  createBet(bet: InsertBet): Bet {
    return db.insert(bets).values(bet).returning().get();
  }
  getBetsByRound(roundId: number): Bet[] {
    return db.select().from(bets).where(eq(bets.roundId, roundId)).all();
  }
  getBetByAddressAndRound(address: string, roundId: number): Bet | undefined {
    return db.select().from(bets)
      .where(and(
        sql`lower(${bets.playerAddress}) = lower(${address})`,
        eq(bets.roundId, roundId)
      )).get();
  }
  updateBet(id: number, data: Partial<InsertBet>): void {
    db.update(bets).set(data).where(eq(bets.id, id)).run();
  }
  updateBetsWon(roundId: number, result: string): void {
    db.update(bets)
      .set({ won: 1 })
      .where(sql`${bets.roundId} = ${roundId} AND ${bets.guess} = ${result}`)
      .run();
  }
  getUnclaimedBetsForAddress(address: string): Bet[] {
    return db.select().from(bets)
      .where(sql`lower(${bets.playerAddress}) = lower(${address}) AND ${bets.won} = 1 AND ${bets.claimed} = 0`)
      .all();
  }
  getLeaderboard(limit: number): LeaderboardEntry[] {
    return db.select().from(leaderboard).orderBy(desc(leaderboard.wins)).limit(limit).all();
  }
  upsertLeaderboardEntry(address: string, won: boolean, prize: string): void {
    const existing = db.select().from(leaderboard)
      .where(sql`lower(${leaderboard.playerAddress}) = lower(${address})`).get();
    if (existing) {
      db.update(leaderboard).set({
        totalGames: existing.totalGames + 1,
        wins: won ? existing.wins + 1 : existing.wins,
        totalWon: won ? (parseFloat(existing.totalWon) + parseFloat(prize)).toFixed(4) : existing.totalWon,
      }).where(eq(leaderboard.id, existing.id)).run();
    } else {
      db.insert(leaderboard).values({
        playerAddress: address,
        totalGames: 1,
        wins: won ? 1 : 0,
        totalWon: won ? prize : "0",
      }).run();
    }
  }
  createEvent(event: { type: string; roundId?: number | null; playerAddress?: string | null; data?: string | null; timestamp: number }): GameEvent {
    return db.insert(events).values(event).returning().get();
  }
  getRecentEvents(limit: number): GameEvent[] {
    return db.select().from(events).orderBy(desc(events.id)).limit(limit).all();
  }
  getAccumulatedPool(): string {
    const config = db.select().from(gameConfig).limit(1).get();
    return config?.accumulatedPool || "0";
  }
  setAccumulatedPool(amount: string): void {
    const config = db.select().from(gameConfig).limit(1).get();
    if (config) {
      db.update(gameConfig).set({ accumulatedPool: amount }).where(eq(gameConfig.id, config.id)).run();
    } else {
      db.insert(gameConfig).values({ accumulatedPool: amount }).run();
    }
  }
  getJackpotPool(): string {
    const config = db.select().from(gameConfig).limit(1).get();
    return config?.jackpotPool || "0";
  }
  addToJackpotPool(amount: string): void {
    const config = db.select().from(gameConfig).limit(1).get();
    const current = parseFloat(config?.jackpotPool || "0");
    const next    = (current + parseFloat(amount)).toFixed(4);
    if (config) {
      db.update(gameConfig).set({ jackpotPool: next }).where(eq(gameConfig.id, config.id)).run();
    } else {
      db.insert(gameConfig).values({ jackpotPool: next }).run();
    }
  }
  flushJackpotToAccumulated(): string {
    const config  = db.select().from(gameConfig).limit(1).get();
    const jackpot = config?.jackpotPool || "0";
    if (parseFloat(jackpot) <= 0) return "0";
    const newAccum = (parseFloat(config?.accumulatedPool || "0") + parseFloat(jackpot)).toFixed(4);
    db.update(gameConfig)
      .set({ accumulatedPool: newAccum, jackpotPool: "0" })
      .where(eq(gameConfig.id, config!.id))
      .run();
    return jackpot;
  }
  getClosedRoundCount(): number {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(rounds)
      .where(sql`${rounds.status} = 'closed'`)
      .get();
    return row?.count ?? 0;
  }
}

export const storage = new DatabaseStorage();
