import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useWallet } from "@/hooks/use-wallet";
import { CONTRACTS, QAN_TESTNET, type ContractType } from "@/lib/qan-config";
import type { Round, Bet, LeaderboardEntry, GameEvent } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import {
  Coins, Wallet, Trophy, Activity, Shield, Terminal,
  CircleDot, ArrowUpCircle, ArrowDownCircle, Users,
  ExternalLink, Zap, Code2, Globe, Lock
} from "lucide-react";

function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";
}

function formatQANX(value: string | number) {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(num) ? "0" : num.toFixed(4);
}

// ─── Wallet Connect ─────────────────────────────────────────────────────────
function WalletConnect() {
  const { address, balance, isConnected, isCorrectNetwork, isConnecting, connect, switchNetwork, disconnect } = useWallet();

  if (!isConnected) {
    return (
      <Button onClick={connect} disabled={isConnecting} size="sm" data-testid="button-connect-wallet">
        <Wallet className="w-4 h-4 mr-2" />
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </Button>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="destructive">Wrong Network</Badge>
        <Button onClick={switchNetwork} size="sm" variant="outline" data-testid="button-switch-network">
          Switch to QAN TestNet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <div className="text-xs text-muted-foreground">QANX Balance</div>
        <div className="font-mono text-sm font-semibold" data-testid="text-balance">{balance || "0"} QANX</div>
      </div>
      <Badge variant="secondary" className="font-mono" data-testid="text-address">
        {shortenAddress(address!)}
      </Badge>
      <Button onClick={disconnect} size="sm" variant="ghost" className="text-xs" data-testid="button-disconnect">
        Disconnect
      </Button>
    </div>
  );
}

// ─── Contract Selector / QVM Showcase ───────────────────────────────────────
function QVMShowcase({ selected, onSelect }: { selected: ContractType; onSelect: (t: ContractType) => void }) {
  const contract = CONTRACTS[selected];
  return (
    <Card className="border-2 border-dashed border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            QVM Showcase
          </CardTitle>
          <Badge variant="outline" className="text-xs">Post-Quantum VM</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          A QVM egy többnyelvű, biztonságos, EVM-kompatibilis virtuális gép. Válassz contractot:
        </p>

        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(CONTRACTS) as ContractType[]).map((key) => (
            <button
              key={key}
              onClick={() => onSelect(key)}
              data-testid={`button-select-contract-${key}`}
              className={`p-3 rounded-lg border text-left transition-all ${
                selected === key
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Code2 className="w-3.5 h-3.5" />
                <span className="font-medium text-sm">{CONTRACTS[key].label}</span>
              </div>
              <span className="text-xs text-muted-foreground">{CONTRACTS[key].language}</span>
            </button>
          ))}
        </div>

        <div className="bg-card rounded-lg p-3 border space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Terminal className="w-3 h-3" />
            QVM Technical Details — {contract.label}
          </div>
          <div className="space-y-1.5 text-xs font-mono">
            <div>
              <span className="text-muted-foreground">Syscalls: </span>
              <span className="text-primary">{contract.syscalls.join(", ")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Storage Read: </span>
              <span className="text-foreground">{contract.storageRead}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Storage Write: </span>
              <span className="text-foreground">{contract.storageWrite}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Random: </span>
              <span className="text-foreground">{contract.randomImpl}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Compile: </span>
              <span className="text-foreground">{contract.compileCmd}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs"><Lock className="w-3 h-3 mr-1" />Post-Quantum</Badge>
          <Badge variant="secondary" className="text-xs"><Globe className="w-3 h-3 mr-1" />EVM-Compatible</Badge>
          <Badge variant="secondary" className="text-xs"><Zap className="w-3 h-3 mr-1" />Deterministic</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Game Lobby ─────────────────────────────────────────────────────────────
function GameLobby({ selectedContract }: { selectedContract: ContractType }) {
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

  const { data: claimInfo } = useQuery<{ canClaim: boolean; amount?: string; reason?: string }>({
    queryKey: ["/api/claim", currentRound?.id, address],
    enabled: !!currentRound && currentRound.status === "closed" && !!address,
  });

  const placeBet = useMutation({
    mutationFn: async () => {
      let txHash: string | undefined;

      // Ha van wallet, külj valódi tranzakciót
      if (isConnected && isCorrectNetwork && (window as any).ethereum) {
        setTxStatus("MetaMask jóváhagyásra vár...");
        const contractAddr = CONTRACTS[selectedContract].address;
        const feeParts = (currentRound?.entryFee || "0.1").split(".");
        const whole = feeParts[0] || "0";
        const frac = (feeParts[1] || "").padEnd(18, "0").slice(0, 18);
        const weiClean = (whole + frac).replace(/^0+/, "") || "0";
        const feeWei = "0x" + BigInt(weiClean).toString(16);

        try {
          txHash = await (window as any).ethereum.request({
            method: "eth_sendTransaction",
            params: [{ from: address, to: contractAddr, value: feeWei }],
          });
          setTxStatus("Tranzakció elküldve!");
        } catch (e: any) {
          if (e.code === 4001) {
            setTxStatus(null);
            throw new Error("Tranzakció elutasítva");
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
      toast({ title: "Tét leadva", description: `${guess === "heads" ? "Fej" : "Írás"} — ${currentRound?.entryFee} QANX` });
      setGuess(null);
      setTimeout(() => setTxStatus(null), 3000);
    },
    onError: (err: Error) => {
      toast({ title: "Hiba", description: err.message, variant: "destructive" });
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
      toast({ title: "Nyeremény igényelve", description: `${data.amount} QANX` });
    },
    onError: (err: Error) => {
      toast({ title: "Hiba", description: err.message, variant: "destructive" });
    },
  });

  const canBet = currentRound?.status === "open" && guess !== null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" />
            Game Lobby
            <span className="text-[10px] font-normal text-muted-foreground">(multiplayer)</span>
          </CardTitle>
          {currentRound && (
            <Badge
              variant={currentRound.status === "open" ? "default" : "secondary"}
              data-testid="badge-round-status"
            >
              {currentRound.status === "open" ? "Nyitva" : "Lezárva"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Betöltés...</div>
        ) : !currentRound || currentRound.status === "closed" ? (
          <div className="text-center py-6">
            <CircleDot className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">
              Nincs aktív kör. Várd meg az admin által indított új kört.
            </p>
            {claimInfo?.canClaim && (
              <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">Nyertél! {claimInfo.amount} QANX</p>
                <Button
                  onClick={() => claimPrize.mutate()}
                  disabled={claimPrize.isPending}
                  size="sm"
                  className="mt-2 bg-green-600 hover:bg-green-700"
                >
                  {claimPrize.isPending ? "Feldolgozás..." : `🏆 Nyeremény igénylése (${claimInfo.amount} QANX)`}
                </Button>
              </div>
            )}
            {parseFloat(poolData?.accumulated || "0") > 0 && (
              <div className="mt-3 text-xs text-muted-foreground">
                💰 Gyűjtött pool a következő körhöz: <span className="font-semibold text-primary">{poolData?.accumulated} QANX</span>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-2 rounded-lg bg-card border">
                <div className="text-xs text-muted-foreground">Kör</div>
                <div className="font-semibold text-lg" data-testid="text-round-number">#{currentRound.id}</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-card border">
                <div className="text-xs text-muted-foreground">Total Pot</div>
                <div className="font-semibold text-lg" data-testid="text-pool">{formatQANX(currentRound.totalPool || currentRound.pool)} QANX</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-card border">
                <div className="text-xs text-muted-foreground">Játékosok</div>
                <div className="font-semibold text-lg" data-testid="text-player-count">{currentRound.playerCount || 0}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center justify-between p-2 rounded bg-card border">
                <span className="text-muted-foreground">Belépési díj:</span>
                <span className="font-medium">{currentRound.entryFee} QANX</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-card border">
                <span className="text-muted-foreground">Contract:</span>
                <Badge variant="outline" className="text-xs">{CONTRACTS[selectedContract].label}</Badge>
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded bg-card border text-sm">
              <span className="text-muted-foreground">Fej / Írás:</span>
              <span className="font-mono">
                {currentRound.headsCount || 0} / {currentRound.tailsCount || 0}
              </span>
            </div>

            {isConnected && isCorrectNetwork && (
              <div className="space-y-3">
                <div className="text-sm font-medium">Válassz tippet:</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setGuess("heads")}
                    data-testid="button-guess-heads"
                    className={`p-4 rounded-lg border-2 text-center transition-all ${
                      guess === "heads"
                        ? "border-primary bg-primary/10 scale-[1.02]"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <ArrowUpCircle className={`w-8 h-8 mx-auto mb-2 ${guess === "heads" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="font-semibold">Fej</div>
                    <div className="text-xs text-muted-foreground">Heads</div>
                  </button>
                  <button
                    onClick={() => setGuess("tails")}
                    data-testid="button-guess-tails"
                    className={`p-4 rounded-lg border-2 text-center transition-all ${
                      guess === "tails"
                        ? "border-primary bg-primary/10 scale-[1.02]"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <ArrowDownCircle className={`w-8 h-8 mx-auto mb-2 ${guess === "tails" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="font-semibold">Írás</div>
                    <div className="text-xs text-muted-foreground">Tails</div>
                  </button>
                </div>

                <Button
                  onClick={() => placeBet.mutate()}
                  disabled={!canBet || placeBet.isPending}
                  className="w-full"
                  data-testid="button-place-bet"
                >
                  {placeBet.isPending ? (txStatus || "Feldolgozás...") : (
                    isConnected && isCorrectNetwork
                      ? `🔒 Belépés (MetaMask) — ${currentRound.entryFee} QANX`
                      : `Belépés (demo) — ${currentRound.entryFee} QANX`
                  )}
                </Button>
                {txStatus && !placeBet.isPending && (
                  <p className="text-xs text-center text-green-600 mt-2">{txStatus}</p>
                )}
                {parseFloat(currentRound.rolloverPool || "0") > 0 && (
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    💰 +{currentRound.rolloverPool} QANX rollover az előző körből
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Event Log ──────────────────────────────────────────────────────────────
function EventLog() {
  const { data: events } = useQuery<GameEvent[]>({
    queryKey: ["/api/events"],
    refetchInterval: 3000,
  });

  const eventIcon = (type: string) => {
    switch (type) {
      case "GameStarted": return <Zap className="w-3.5 h-3.5 text-green-500" />;
      case "BetPlaced": return <Coins className="w-3.5 h-3.5 text-blue-500" />;
      case "GameFinished": return <Trophy className="w-3.5 h-3.5 text-yellow-500" />;
      case "PrizeClaimed": return <ArrowUpCircle className="w-3.5 h-3.5 text-purple-500" />;
      default: return <Activity className="w-3.5 h-3.5" />;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Event Log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {(!events || events.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-4">Még nincsenek események</p>
          ) : (
            events.map((evt) => {
              const data = evt.data ? JSON.parse(evt.data) : {};
              return (
                <div key={evt.id} className="flex items-start gap-2 p-2 rounded bg-card border text-xs" data-testid={`event-${evt.id}`}>
                  <div className="mt-0.5">{eventIcon(evt.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{evt.type}</span>
                      {evt.roundId && <Badge variant="outline" className="text-[10px]">#{evt.roundId}</Badge>}
                    </div>
                    {evt.playerAddress && (
                      <div className="text-muted-foreground font-mono truncate">{shortenAddress(evt.playerAddress)}</div>
                    )}
                    {data.guess && <span className="text-muted-foreground">Tipp: {data.guess === "heads" ? "Fej" : "Írás"}</span>}
                    {data.result && <span className="text-muted-foreground"> Eredmény: {data.result === "heads" ? "Fej" : "Írás"}</span>}
                    {data.winnerCount !== undefined && <span className="text-muted-foreground"> ({data.winnerCount} nyertes)</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {new Date(evt.timestamp).toLocaleTimeString("hu-HU")}
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

// ─── Leaderboard ────────────────────────────────────────────────────────────
function Leaderboard() {
  const { data: entries } = useQuery<LeaderboardEntry[]>({
    queryKey: ["/api/leaderboard"],
    refetchInterval: 5000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-primary" />
          Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!entries || entries.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-4">Még nincs adat</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-4 text-xs text-muted-foreground font-medium px-2">
              <span>#</span>
              <span>Játékos</span>
              <span className="text-center">Győzelmek</span>
              <span className="text-right">QANX</span>
            </div>
            {entries.map((entry, i) => (
              <div
                key={entry.id}
                className={`grid grid-cols-4 text-sm p-2 rounded ${i === 0 ? "bg-primary/5 border border-primary/20" : "bg-card border"}`}
                data-testid={`leaderboard-row-${i}`}
              >
                <span className="font-medium">{i + 1}.</span>
                <span className="font-mono text-xs truncate">{shortenAddress(entry.playerAddress)}</span>
                <span className="text-center font-semibold">{entry.wins}/{entry.totalGames}</span>
                <span className="text-right font-mono text-xs">{formatQANX(entry.totalWon)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Admin Panel ────────────────────────────────────────────────────────────
function AdminPanel({ selectedContract }: { selectedContract: ContractType }) {
  const { address, isConnected } = useWallet();
  const { toast } = useToast();
  const [entryFee, setEntryFee] = useState("0.1");

  const { data: currentRound } = useQuery<Round | null>({
    queryKey: ["/api/rounds/current"],
    refetchInterval: 3000,
  });

  const createRound = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/rounds", {
        entryFee,
        contractType: selectedContract,
        contractAddress: CONTRACTS[selectedContract].address,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rounds/current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/events"] });
      toast({ title: "Kör létrehozva", description: `Belépési díj: ${entryFee} QANX` });
    },
    onError: (err: Error) => {
      toast({ title: "Hiba", description: err.message, variant: "destructive" });
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
      toast({
        title: "Kör lezárva",
        description: `Eredmény: ${data.result === "heads" ? "Fej" : "Írás"} — ${data.winnerCount} nyertes`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Hiba", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          Admin Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Csatlakozz a wallettel az admin funkciókhoz.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Belépési díj:</label>
              <input
                type="text"
                value={entryFee}
                onChange={(e) => setEntryFee(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded border bg-background text-sm font-mono"
                data-testid="input-entry-fee"
              />
              <span className="text-sm text-muted-foreground">QANX</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => createRound.mutate()}
                disabled={createRound.isPending || (currentRound?.status === "open")}
                variant="default"
                size="sm"
                data-testid="button-create-round"
              >
                {createRound.isPending ? "..." : "Új Kör"}
              </Button>
              <Button
                onClick={() => closeRound.mutate()}
                disabled={closeRound.isPending || !currentRound || currentRound.status !== "open"}
                variant="secondary"
                size="sm"
                data-testid="button-close-round"
              >
                {closeRound.isPending ? "..." : "Kör Lezárás"}
              </Button>
            </div>

            {currentRound?.status === "closed" && currentRound.result && (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-1">
                <div className="text-sm font-medium">Utolsó eredmény</div>
                <div className="flex items-center gap-2">
                  <Badge>{currentRound.result === "heads" ? "Fej" : "Írás"}</Badge>
                  <span className="text-xs text-muted-foreground">{currentRound.winnerCount} nyertes</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    Random: {currentRound.randomHex?.substring(0, 12)}...
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Round History ──────────────────────────────────────────────────────────
function RoundHistory() {
  const { data: rounds } = useQuery<Round[]>({
    queryKey: ["/api/rounds"],
    refetchInterval: 5000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CircleDot className="w-4 h-4 text-primary" />
          Korábbi Körök
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(!rounds || rounds.length === 0) ? (
          <p className="text-sm text-muted-foreground text-center py-4">Még nincsenek körök</p>
        ) : (
          <div className="space-y-2">
            {rounds.filter(r => r.status === "closed").slice(0, 5).map((round) => (
              <div key={round.id} className="flex items-center justify-between p-2 rounded bg-card border text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">#{round.id}</span>
                  <Badge variant={round.result === "heads" ? "default" : "secondary"} className="text-xs">
                    {round.result === "heads" ? "Fej" : "Írás"}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span><Users className="w-3 h-3 inline mr-1" />{round.playerCount}</span>
                  <span>{formatQANX(round.pool)} QANX</span>
                  <Badge variant="outline" className="text-[10px]">{round.contractType?.toUpperCase()}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function Home() {
  const [selectedContract, setSelectedContract] = useState<ContractType>("js");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Coins className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold text-sm leading-none">QAN CoinFlip</h1>
              <p className="text-[11px] text-muted-foreground hidden sm:block">QVM Multi-Language Demo</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href={QAN_TESTNET.faucetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:flex items-center gap-1"
              data-testid="link-faucet"
            >
              <ExternalLink className="w-3 h-3" />
              Faucet
            </a>
            <a
              href={QAN_TESTNET.blockExplorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:flex items-center gap-1"
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: QVM Showcase + Admin */}
          <div className="lg:col-span-4 space-y-4">
            <QVMShowcase selected={selectedContract} onSelect={setSelectedContract} />
            <AdminPanel selectedContract={selectedContract} />
          </div>

          {/* Center Column: Game Lobby */}
          <div className="lg:col-span-4 space-y-4">
            <GameLobby selectedContract={selectedContract} />
            <RoundHistory />
          </div>

          {/* Right Column: Events + Leaderboard */}
          <div className="lg:col-span-4 space-y-4">
            <Tabs defaultValue="events">
              <TabsList className="w-full">
                <TabsTrigger value="events" className="flex-1">
                  <Activity className="w-3.5 h-3.5 mr-1.5" />Events
                </TabsTrigger>
                <TabsTrigger value="leaderboard" className="flex-1">
                  <Trophy className="w-3.5 h-3.5 mr-1.5" />Leaderboard
                </TabsTrigger>
              </TabsList>
              <TabsContent value="events"><EventLog /></TabsContent>
              <TabsContent value="leaderboard"><Leaderboard /></TabsContent>
            </Tabs>
          </div>
        </div>

        {/* QVM Info Banner */}
        <div className="mt-8 p-4 rounded-lg bg-card border">
          <div className="flex items-start gap-3">
            <Shield className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">A QVM-ről</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                A QAN Virtual Machine (QVM) a világ első auditált virtuális gépe, amely lehetővé teszi
                smart contractok fejlesztését bármely programozási nyelven a blokkláncon.
                A QVM a Linux ELF binárisokat hajtja végre determinisztikus módon, hardverszintű sandbox-ban.
                A <code className="text-primary">getrandom()</code> syscall az előző blokk hash-éből származtatott determinisztikus byte-sorozatot ad vissza.
                A <code className="text-primary">time()</code> syscall az előző blokk timestamp-jét adja.
                Ez a demo két különböző nyelven (JavaScript és Go) mutatja be ugyanazt a CoinFlip logikát.
              </p>
              <div className="flex gap-2 pt-1">
                <a
                  href="https://learn.qanplatform.com/developers/qvm-multi-language-smart-contracts"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />QVM Docs
                </a>
                <a
                  href="https://docs.qanplatform.com/testnet/smart-contract/writing/javascript"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />JS Contract
                </a>
                <a
                  href="https://docs.qanplatform.com/testnet/smart-contract/writing/go"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3 h-3" />Go Contract
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>QAN CoinFlip MVP — QVM Multi-Language Demo</span>
            <span>Chain ID: {QAN_TESTNET.chainId}</span>
          </div>
          <PerplexityAttribution />
        </div>
      </footer>
    </div>
  );
}
