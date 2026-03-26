import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";
import { QAN_TESTNET } from "@/lib/qan-config";
import type { Round, Bet, LeaderboardEntry, GameEvent } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Coins, Wallet, Trophy, Activity, Zap,
  CircleDot, Users, ExternalLink, Shield, ChevronRight,
} from "lucide-react";

function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function formatQANX(value: string | number) {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(num) ? "0" : num.toFixed(4);
}

// ─── Coin Flip Modal ─────────────────────────────────────────────────────────
interface CoinFlipResult {
  result: "heads" | "tails";
  winnerCount: number;
  blockNumber?: number | null;
  randomHex?: string | null;
  blockHash?: string | null;
}

function CoinFlipModal({ data, onClose }: { data: CoinFlipResult; onClose: () => void }) {
  const [phase, setPhase] = useState<"flipping" | "revealing">("flipping");

  useEffect(() => {
    // After 3.5s the CSS animation finishes → show the result overlay
    const t = setTimeout(() => setPhase("revealing"), 3600);
    return () => clearTimeout(t);
  }, []);

  const isHeads = data.result === "heads";

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-lg"
      onClick={phase === "revealing" ? onClose : undefined}
    >
      {/* Ambient glow */}
      <div
        className={`absolute w-[400px] h-[400px] rounded-full blur-[120px] opacity-25 pointer-events-none transition-colors duration-1000 ${
          isHeads ? "bg-amber-400" : "bg-violet-600"
        }`}
      />

      {/* Coin */}
      <div style={{ perspective: "900px" }} className="relative z-10">
        <div className={`coin ${isHeads ? "coin-flip-heads" : "coin-flip-tails"}`}>
          {/* Heads face */}
          <div className="coin-face coin-heads">
            <span>H</span>
          </div>
          {/* Tails face */}
          <div className="coin-face coin-tails">
            <span>T</span>
          </div>
        </div>
      </div>

      {/* Result overlay — shown after animation */}
      {phase === "revealing" && (
        <div className="relative z-10 mt-10 text-center animate-fade-in-up space-y-4 px-6">
          <p className="text-sm font-mono text-muted-foreground tracking-widest uppercase">
            Result
          </p>
          <h2
            className={`text-6xl font-black tracking-tight ${
              isHeads
                ? "text-amber-400 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]"
                : "text-violet-400 drop-shadow-[0_0_20px_rgba(167,139,250,0.6)]"
            }`}
          >
            {isHeads ? "HEADS" : "TAILS"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {data.winnerCount} winner{data.winnerCount !== 1 ? "s" : ""}
          </p>

          {(data.blockNumber || data.randomHex) && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-muted-foreground">
              <Shield className="w-3 h-3 text-cyan-400" />
              {data.blockNumber && <span>Block #{data.blockNumber}</span>}
              {data.randomHex && <span>· {data.randomHex.slice(0, 14)}…</span>}
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-2 inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/8 border border-white/15 text-sm text-white/70 hover:bg-white/12 hover:text-white transition-all"
          >
            Continue <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {phase === "flipping" && (
        <p className="relative z-10 mt-8 text-xs text-muted-foreground tracking-widest animate-pulse uppercase">
          Flipping…
        </p>
      )}
    </div>
  );
}

// ─── Wallet Connect ──────────────────────────────────────────────────────────
function WalletConnect() {
  const { address, balance, isConnected, isCorrectNetwork, isConnecting, connect, switchNetwork, disconnect } = useWallet();

  if (!isConnected) {
    return (
      <Button
        onClick={connect}
        disabled={isConnecting}
        size="sm"
        className="bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 transition-all"
        data-testid="button-connect-wallet"
      >
        <Wallet className="w-4 h-4 mr-2" />
        {isConnecting ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="text-xs">Wrong Network</Badge>
        <Button
          onClick={switchNetwork}
          size="sm"
          variant="outline"
          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          data-testid="button-switch-network"
        >
          Switch to QAN TestNet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right hidden sm:block">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Balance</div>
        <div className="font-mono text-sm font-semibold text-cyan-300" data-testid="text-balance">
          {balance || "0"} QANX
        </div>
      </div>
      <Badge
        variant="secondary"
        className="font-mono border border-white/10 bg-white/5"
        data-testid="text-address"
      >
        {shortenAddress(address!)}
      </Badge>
      <Button
        onClick={disconnect}
        size="sm"
        variant="ghost"
        className="text-xs text-muted-foreground hover:text-foreground"
        data-testid="button-disconnect"
      >
        Disconnect
      </Button>
    </div>
  );
}

// ─── Game Lobby ──────────────────────────────────────────────────────────────
function GameLobby() {
  const { address, isConnected, isCorrectNetwork } = useWallet();
  const [guess, setGuess] = useState<"heads" | "tails" | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: currentRound, isLoading } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 2000,
  });

  const { data: poolData } = useQuery<{ accumulated: string }>({
    queryKey: ["/api/pool"],
    refetchInterval: 5000,
  });

  const { data: gameAddress } = useQuery<{ address: string | null; enabled: boolean }>({
    queryKey: ["/api/game/address"],
  });

  const { data: claimInfo } = useQuery<{ canClaim: boolean; amount?: string; reason?: string }>({
    queryKey: ["/api/claim", currentRound?.id, address],
    enabled: !!currentRound && currentRound.status === "closed" && !!address,
  });

  const placeBet = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;

      if (isConnected && isCorrectNetwork && (window as any).ethereum && gameAddress?.address) {
        setTxStatus("Waiting for MetaMask approval…");
        const toAddr = gameAddress.address;
        const feeParts = (currentRound?.entryFee || "0.1").split(".");
        const whole = feeParts[0] || "0";
        const frac = (feeParts[1] || "").padEnd(18, "0").slice(0, 18);
        const weiClean = (whole + frac).replace(/^0+/, "") || "0";
        const feeWei = "0x" + BigInt(weiClean).toString(16);

        try {
          txHash = await (window as any).ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: address, to: toAddr, value: feeWei }],
          });
          setTxStatus("Transaction sent!");
        } catch (e: any) {
          if (e.code === 4001) {
            setTxStatus(null);
            throw new Error("Transaction rejected");
          }
          setTxStatus(null);
          throw e;
        }
      }

      const res = await apiRequest("POST", "/api/bets", {
        roundId: currentRound?.id,
        playerAddress: address || "0xDemo_" + Math.random().toString(16).slice(2, 8),
        guess,
        txHash,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({
        title: "Bet placed",
        description: `${guess === "heads" ? "Heads" : "Tails"} — ${currentRound?.entryFee} QANX`,
      });
      setGuess(null);
      setTimeout(() => setTxStatus(null), 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setTxStatus(null);
    },
  });

  const claimPrize = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/claim", {
        playerAddress: address,
        roundId: currentRound?.id,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });

      if (data.blockchainTransfer && data.txHash) {
        toast({
          title: "✅ QANX sent to your wallet!",
          description: `${data.amount} QANX · Tx: ${data.txHash.slice(0, 10)}…${data.txHash.slice(-6)}`,
        });
      } else {
        toast({
          title: "Prize recorded",
          description: `${data.amount} QANX — ${data.message}`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canBet = currentRound?.status === "open" && guess !== null;

  return (
    <Card className="border-glow-cyan bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="w-4 h-4 text-cyan-400" />
            Game Lobby
            <span className="text-[10px] font-normal text-muted-foreground">(multiplayer)</span>
          </CardTitle>
          {currentRound && (
            <Badge
              className={
                currentRound.status === "open"
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  : "bg-white/8 text-muted-foreground border border-white/10"
              }
              data-testid="badge-round-status"
            >
              {currentRound.status === "open" ? "● Open" : "Closed"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !currentRound || currentRound.status === "closed" ? (
          <div className="text-center py-6">
            <CircleDot className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">
              No active round. Wait for the admin to start a new one.
            </p>

            {claimInfo?.canClaim && (
              <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                <p className="text-sm font-semibold text-emerald-400 mb-2">
                  🏆 You won! {claimInfo.amount} QANX
                </p>
                <Button
                  onClick={() => claimPrize.mutate()}
                  disabled={claimPrize.isPending}
                  size="sm"
                  className="bg-emerald-600/80 hover:bg-emerald-500/80 border border-emerald-400/30 text-white"
                >
                  {claimPrize.isPending
                    ? "⏳ Processing blockchain transfer…"
                    : `Claim Prize (${claimInfo.amount} QANX)`}
                </Button>
              </div>
            )}

            {parseFloat(poolData?.accumulated || "0") > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                💰 Accumulated pool for next round:{" "}
                <span className="font-semibold text-cyan-400">{poolData?.accumulated} QANX</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Round", value: `#${currentRound.id}`, testId: "text-round-number" },
                { label: "Total Pot", value: `${formatQANX(currentRound.totalPool || currentRound.pool)}`, suffix: "QANX", testId: "text-pool" },
                { label: "Players", value: `${currentRound.playerCount || 0}`, testId: "text-player-count" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="text-center p-2.5 rounded-lg bg-white/4 border border-white/8"
                >
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{s.label}</div>
                  <div className="font-bold text-base mt-0.5" data-testid={s.testId}>
                    {s.value}
                    {s.suffix && <span className="text-[10px] font-normal text-muted-foreground ml-1">{s.suffix}</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>Entry fee: <span className="text-foreground font-medium">{currentRound.entryFee} QANX</span></span>
              <span>Heads: <span className="text-amber-400 font-mono">{currentRound.headsCount || 0}</span> / Tails: <span className="text-violet-400 font-mono">{currentRound.tailsCount || 0}</span></span>
            </div>

            {isConnected && isCorrectNetwork && (
              <div className="space-y-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Pick your side:</div>
                <div className="grid grid-cols-2 gap-3">
                  {/* HEADS button */}
                  <button
                    onClick={() => setGuess("heads")}
                    data-testid="button-guess-heads"
                    className={`group p-5 rounded-2xl border-2 text-center transition-all duration-200 ${
                      guess === "heads"
                        ? "border-amber-400/60 bg-amber-500/12 scale-[1.03] shadow-[0_0_24px_rgba(251,191,36,0.28)]"
                        : "border-white/10 hover:border-amber-400/30 hover:bg-amber-500/6"
                    }`}
                  >
                    <div
                      className={`w-14 h-14 mx-auto mb-2.5 rounded-full flex items-center justify-center text-2xl font-black border-2 transition-all ${
                        guess === "heads"
                          ? "bg-gradient-to-br from-yellow-300 to-amber-600 border-amber-400/70 text-amber-900 shadow-[0_0_18px_rgba(251,191,36,0.55)]"
                          : "bg-gradient-to-br from-amber-900/25 to-yellow-900/25 border-amber-700/30 text-amber-700/60"
                      }`}
                    >
                      H
                    </div>
                    <div className={`font-bold ${guess === "heads" ? "text-amber-300" : "text-muted-foreground"}`}>
                      Heads
                    </div>
                  </button>

                  {/* TAILS button */}
                  <button
                    onClick={() => setGuess("tails")}
                    data-testid="button-guess-tails"
                    className={`group p-5 rounded-2xl border-2 text-center transition-all duration-200 ${
                      guess === "tails"
                        ? "border-violet-400/60 bg-violet-500/12 scale-[1.03] shadow-[0_0_24px_rgba(167,139,250,0.28)]"
                        : "border-white/10 hover:border-violet-400/30 hover:bg-violet-500/6"
                    }`}
                  >
                    <div
                      className={`w-14 h-14 mx-auto mb-2.5 rounded-full flex items-center justify-center text-2xl font-black border-2 transition-all ${
                        guess === "tails"
                          ? "bg-gradient-to-br from-violet-300 to-purple-700 border-violet-400/70 text-violet-100 shadow-[0_0_18px_rgba(167,139,250,0.55)]"
                          : "bg-gradient-to-br from-violet-900/25 to-purple-900/25 border-violet-700/30 text-violet-700/60"
                      }`}
                    >
                      T
                    </div>
                    <div className={`font-bold ${guess === "tails" ? "text-violet-300" : "text-muted-foreground"}`}>
                      Tails
                    </div>
                  </button>
                </div>

                <Button
                  onClick={() => placeBet.mutate()}
                  disabled={!canBet || placeBet.isPending}
                  className="w-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 hover:text-cyan-200 disabled:opacity-40 transition-all"
                  data-testid="button-place-bet"
                >
                  {placeBet.isPending
                    ? txStatus || "Processing…"
                    : isConnected && isCorrectNetwork
                    ? `🔒 Enter via MetaMask — ${currentRound.entryFee} QANX`
                    : `Enter (demo) — ${currentRound.entryFee} QANX`}
                </Button>

                {txStatus && !placeBet.isPending && (
                  <p className="text-xs text-center text-emerald-400">{txStatus}</p>
                )}
                {parseFloat(currentRound.rolloverPool || "0") > 0 && (
                  <p className="text-xs text-center text-muted-foreground">
                    💰 +{currentRound.rolloverPool} QANX rollover from previous round
                  </p>
                )}
              </div>
            )}

            {(!isConnected || !isCorrectNetwork) && (
              <p className="text-xs text-center text-muted-foreground">
                Connect wallet to place bets.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Event Log ───────────────────────────────────────────────────────────────
function EventLog() {
  const { data: events } = useQuery<GameEvent[]>({
    queryKey: ["/api/events"],
    refetchInterval: 3000,
  });

  const eventIcon = (type: string) => {
    switch (type) {
      case "GameStarted":  return <Zap className="w-3.5 h-3.5 text-emerald-400" />;
      case "BetPlaced":    return <Coins className="w-3.5 h-3.5 text-cyan-400" />;
      case "GameFinished": return <Trophy className="w-3.5 h-3.5 text-amber-400" />;
      case "PrizeClaimed": return <Zap className="w-3.5 h-3.5 text-violet-400" />;
      default:             return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Event Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
          {(!events || events.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-6">No events yet</p>
          ) : (
            events.map((evt) => {
              const data = evt.data ? JSON.parse(evt.data) : {};
              return (
                <div
                  key={evt.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-white/3 border border-white/6 text-xs"
                  data-testid={`event-${evt.id}`}
                >
                  <div className="mt-0.5 shrink-0">{eventIcon(evt.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground/80">{evt.type}</span>
                      {evt.roundId && (
                        <Badge variant="outline" className="text-[10px] border-white/10 text-muted-foreground">
                          #{evt.roundId}
                        </Badge>
                      )}
                    </div>
                    {evt.playerAddress && (
                      <div className="text-muted-foreground font-mono truncate">
                        {shortenAddress(evt.playerAddress)}
                      </div>
                    )}
                    {data.guess && (
                      <span className="text-muted-foreground">
                        Guess: {data.guess === "heads" ? "Heads" : "Tails"}
                      </span>
                    )}
                    {data.result && (
                      <span className="text-muted-foreground">
                        {" "}· Result:{" "}
                        <span className={data.result === "heads" ? "text-amber-400" : "text-violet-400"}>
                          {data.result === "heads" ? "Heads" : "Tails"}
                        </span>
                      </span>
                    )}
                    {data.winnerCount !== undefined && (
                      <span className="text-muted-foreground"> ({data.winnerCount} winner{data.winnerCount !== 1 ? "s" : ""})</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                    {new Date(evt.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
function Leaderboard() {
  const { data: entries } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 5000,
  });

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!entries || entries.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-6">No data yet</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 text-[10px] text-muted-foreground uppercase tracking-wider px-2 mb-2">
              <span>#</span>
              <span>Player</span>
              <span className="text-center">W/G</span>
              <span className="text-right">QANX Won</span>
            </div>
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className={`grid grid-cols-4 text-sm p-2.5 rounded-lg transition-colors ${
                  i === 0
                    ? "bg-amber-500/8 border border-amber-500/20"
                    : "bg-white/3 border border-white/6 hover:bg-white/5"
                }`}
                data-testid={`leaderboard-row-${i}`}
              >
                <span className="text-base">{medals[i] || `${i + 1}.`}</span>
                <span className="font-mono text-xs text-muted-foreground truncate">
                  {shortenAddress(entry.playerAddress)}
                </span>
                <span className="text-center font-semibold text-sm">
                  <span className="text-emerald-400">{entry.wins}</span>
                  <span className="text-muted-foreground text-xs">/{entry.totalGames}</span>
                </span>
                <span className="text-right font-mono text-xs text-cyan-400">
                  {formatQANX(entry.totalWon)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ onRoundClosed }: { onRoundClosed: (result: CoinFlipResult) => void }) {
  const { address, isConnected } = useWallet();
  const { toast } = useToast();
  const [entryFee, setEntryFee] = useState("0.1");

  const { data: currentRound } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 3000,
  });

  const { data: adminBalance } = useQuery<{ balance: string; address: string } | null>({
    queryKey: ["/api/admin/balance"],
    refetchInterval: 10000,
    enabled: isConnected,
  });

  const createRound = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rounds", { entryFee });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Round created", description: `Entry fee: ${entryFee} QANX` });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeRound = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/rounds/${currentRound?.id}/close`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });

      // Trigger coin flip animation — NO window.open
      onRoundClosed({
        result: data.result as "heads" | "tails",
        winnerCount: data.winnerCount ?? 0,
        blockNumber: data.blockNumber ?? null,
        randomHex: data.randomHex ?? null,
        blockHash: data.blockHash ?? null,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="border border-white/8 bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-violet-400" />
          Admin Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect your wallet to use admin features.</p>
        ) : (
          <>
            {adminBalance && (
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/4 border border-white/8 text-xs">
                <span className="text-muted-foreground">Game wallet</span>
                <span className="font-mono text-cyan-400">{adminBalance.balance} QANX</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">Entry fee:</label>
              <input
                type="text"
                value={entryFee}
                onChange={(e) => setEntryFee(e.target.value)}
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-white/12 bg-white/5 text-sm font-mono focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/20"
                data-testid="input-entry-fee"
              />
              <span className="text-xs text-muted-foreground shrink-0">QANX</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => createRound.mutate()}
                disabled={createRound.isPending || currentRound?.status === "open"}
                size="sm"
                className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40"
                data-testid="button-create-round"
              >
                {createRound.isPending ? "…" : "+ New Round"}
              </Button>
              <Button
                onClick={() => closeRound.mutate()}
                disabled={closeRound.isPending || !currentRound || currentRound.status !== "open"}
                size="sm"
                className="bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40"
                data-testid="button-close-round"
              >
                {closeRound.isPending ? "Flipping…" : "Close Round"}
              </Button>
            </div>

            {currentRound?.status === "closed" && currentRound.result && (
              <div className="p-3 rounded-xl bg-white/4 border border-white/10 space-y-1.5">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Last result</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    className={
                      currentRound.result === "heads"
                        ? "bg-amber-500/15 border border-amber-500/30 text-amber-300"
                        : "bg-violet-500/15 border border-violet-500/30 text-violet-300"
                    }
                  >
                    {currentRound.result === "heads" ? "Heads" : "Tails"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {currentRound.winnerCount} winner{currentRound.winnerCount !== 1 ? "s" : ""}
                  </span>
                  {currentRound.randomHex && (
                    <span
                      className="text-xs font-mono text-muted-foreground"
                      title="Derived from QAN TestNet block hash"
                    >
                      ⛓ {currentRound.randomHex.slice(0, 12)}…
                    </span>
                  )}
                </div>
                {currentRound.randomHex && (
                  <a
                    href={`${QAN_TESTNET.blockExplorerUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-cyan-400/70 hover:text-cyan-400 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Verify on QAN Explorer
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Round History ────────────────────────────────────────────────────────────
function RoundHistory() {
  const { data: rounds } = useQuery<Round[]>({
    queryKey: ["/api/rounds"],
    refetchInterval: 5000,
  });

  return (
    <Card className="border border-white/8 bg-card/80">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-muted-foreground" />
          Round History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!rounds || rounds.filter(r => r.status === "closed").length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-4">No rounds yet</p>
        ) : (
          <div className="space-y-1.5">
            {rounds.filter(r => r.status === "closed").slice(0, 5).map((round) => (
              <div
                key={round.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-white/3 border border-white/6 text-sm hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground text-xs">#{round.id}</span>
                  <Badge
                    className={
                      round.result === "heads"
                        ? "bg-amber-500/15 border border-amber-500/25 text-amber-300 text-[10px]"
                        : "bg-violet-500/15 border border-violet-500/25 text-violet-300 text-[10px]"
                    }
                  >
                    {round.result === "heads" ? "Heads" : "Tails"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {round.playerCount}
                  </span>
                  <span className="font-mono text-cyan-400/70">{formatQANX(round.pool)} QANX</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [coinFlipResult, setCoinFlipResult] = useState<CoinFlipResult | null>(null);

  return (
    <div className="min-h-screen bg-background space-bg">
      {/* Coin Flip Modal */}
      {coinFlipResult && (
        <CoinFlipModal
          data={coinFlipResult}
          onClose={() => setCoinFlipResult(null)}
        />
      )}

      {/* Header */}
      <header className="border-b border-white/8 bg-card/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/30 to-violet-600/30 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
              <Coins className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="font-bold text-sm leading-none gradient-text">QAN CoinFlip</h1>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                QVM Multi-Language Smart Contract Demo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href={QAN_TESTNET.faucetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors hidden sm:flex items-center gap-1"
              data-testid="link-faucet"
            >
              <ExternalLink className="w-3 h-3" />
              Faucet
            </a>
            <a
              href={QAN_TESTNET.blockExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-cyan-400 transition-colors hidden sm:flex items-center gap-1"
              data-testid="link-explorer"
            >
              <ExternalLink className="w-3 h-3" />
              Explorer
            </a>
            <WalletConnect />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left: Admin */}
          <div className="lg:col-span-4 space-y-4">
            <AdminPanel onRoundClosed={setCoinFlipResult} />
          </div>

          {/* Center: Game */}
          <div className="lg:col-span-4 space-y-4">
            <GameLobby />
            <RoundHistory />
          </div>

          {/* Right: Events + Leaderboard */}
          <div className="lg:col-span-4 space-y-4">
            <Tabs defaultValue="events">
              <TabsList className="w-full bg-white/4 border border-white/8">
                <TabsTrigger value="events" className="flex-1 data-[state=active]:bg-white/10">
                  <Activity className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                  Events
                </TabsTrigger>
                <TabsTrigger value="leaderboard" className="flex-1 data-[state=active]:bg-white/10">
                  <Trophy className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                  Leaderboard
                </TabsTrigger>
              </TabsList>
              <TabsContent value="events" className="mt-3">
                <EventLog />
              </TabsContent>
              <TabsContent value="leaderboard" className="mt-3">
                <Leaderboard />
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Info Banner */}
        <div className="mt-8 p-4 rounded-xl bg-white/3 border border-white/8">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-cyan-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground/90">About QAN TestNet</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                QAN TestNet is a post-quantum secure, EVM-compatible blockchain. Game results are
                always derived from the latest QAN TestNet block hash — making every outcome
                verifiable on the{" "}
                <a
                  href={QAN_TESTNET.blockExplorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                >
                  QAN Block Explorer
                </a>
                . Test QANX tokens are available at the{" "}
                <a
                  href={QAN_TESTNET.faucetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                >
                  faucet
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/8 mt-12 py-5">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span className="gradient-text font-semibold">QAN CoinFlip</span>
            <span className="text-white/20">|</span>
            <span>Chain ID: {QAN_TESTNET.chainId}</span>
            <span className="text-white/20">|</span>
            <span>QVM Multi-Language Demo</span>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground/60">
            <Shield className="w-3 h-3" />
            <span>Post-quantum secure</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
