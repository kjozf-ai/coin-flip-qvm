# QAN CoinFlip MVP — Dokumentáció

## Áttekintés

A QAN CoinFlip egy multiplayer coin flip (fej-írás) játék, amely a QAN TestNet-en fut,
és a QVM (QAN Virtual Machine) többnyelvű smart contract képességét demonstrálja.

A projekt két különböző programozási nyelven implementálja ugyanazt a játéklogikát:
- **CoinFlip-JS** — QVM JavaScript smart contract
- **CoinFlip-Go** — QVM Golang smart contract

## Technológiai Stack

| Komponens | Technológia |
|-----------|-------------|
| Blokklánc | QAN TestNet (Chain ID: 1121) |
| VM | QVM — QAN Virtual Machine |
| Smart Contract 1 | JavaScript (QVM-JS) |
| Smart Contract 2 | Go / Golang (QVM-Go) |
| Frontend | React + Vite + Tailwind CSS + shadcn/ui |
| Backend | Express.js + SQLite (Drizzle ORM) |
| Wallet | MetaMask / EVM-kompatibilis wallet |
| Token | QANX (teszt token) |

## QAN TestNet Konfiguráció

| Paraméter | Érték |
|-----------|-------|
| Network Name | QAN TestNet |
| RPC URL | https://rpc-testnet.qanplatform.com |
| Chain ID | 1121 |
| Currency Symbol | QANX |
| Block Explorer | https://testnet.qanscan.com |
| Faucet | https://faucet.qanplatform.com |

## Projektstruktúra

```
qan-coinflip/
├── contracts/
│   ├── js/
│   │   └── main.js              # CoinFlip-JS QVM JavaScript contract
│   └── go/
│       └── main.go              # CoinFlip-Go QVM Golang contract
├── scripts/
│   └── deploy/
│       ├── deploy-js.sh         # JS contract compile & deploy script
│       ├── deploy-go.sh         # Go contract compile & deploy script
│       └── interact.sh          # Contract interaction script (qvmctl)
├── client/
│   └── src/
│       ├── App.tsx              # React app entry
│       ├── pages/
│       │   └── home.tsx         # Main game page (Lobby, Events, Leaderboard, Admin)
│       ├── hooks/
│       │   └── use-wallet.ts    # MetaMask wallet hook
│       └── lib/
│           └── qan-config.ts    # QAN TestNet config & contract addresses
├── server/
│   ├── routes.ts                # Express API routes
│   └── storage.ts               # SQLite database layer
├── shared/
│   └── schema.ts                # Database schema (rounds, bets, leaderboard, events)
└── docs/
    └── mvp.md                   # Ez a dokumentum
```

## Smart Contract Specifikáció

### Közös interfész (mindkét nyelven)

| Függvény | Paraméterek | Leírás |
|----------|-------------|--------|
| `construct` | — | Konstruktor, egyszer hívódik deploy-kor |
| `createRound` | `entryFee` | Admin: új kör létrehozása |
| `joinGame` | `playerAddress`, `guess` | Játékos belépés + tipp (heads/tails) |
| `closeRound` | — | Admin: kör lezárása, eredmény számítás |
| `claimPrize` | `playerAddress`, `[roundId]` | Nyeremény igénylés |
| `getStatus` | — | Aktuális játék állapot lekérdezés |

### QVM Storage minta

**Írás (DBW=):**
```
// JavaScript
process.stdout.write("DBW=ROUND_1_STATUS=open\n");

// Go
os.Stdout.WriteString("DBW=ROUND_1_STATUS=open\n")
```

**Olvasás (DB_ env var):**
```
// JavaScript
const status = process.env.DB_ROUND_1_STATUS;

// Go
status := os.Getenv("DB_ROUND_1_STATUS")
```

### QVM Syscall-ok

#### getrandom()
A QVM `getrandom()` syscall-ja az előző blokk hash-éből származtatott determinisztikus
byte-sorozatot ad vissza. Ez nem valódi véletlenszám, de determinisztikus és verifikálható
minden QVM executor node-on.

```javascript
// JavaScript — crypto.randomBytes() → QVM getrandom() syscall
const randomBytes = crypto.randomBytes(32);
const result = parseInt(randomBytes.toString('hex').substring(0, 8), 16) % 2;
// 0 = heads, 1 = tails
```

```go
// Go — crypto/rand.Read() → QVM getrandom() syscall
randomBytes := make([]byte, 32)
rand.Read(randomBytes)
randomValue := binary.BigEndian.Uint32(randomBytes[:4])
// even = heads, odd = tails
```

#### time()
A QVM `time()` syscall-ja az előző blokk timestamp-jét adja vissza.
Determinisztikus az összes executor node-on.

### Események (Events)

A contractok `OUT=event: <EventName>` formátumban adnak vissza eseményeket:

| Event | Mikor | Adatok |
|-------|-------|--------|
| `ContractInitialized` | Deploy | maxPlayers, minEntryFee, contractType |
| `GameStarted` | Kör létrehozás | roundId, entryFee, status |
| `BetPlaced` | Belépés | roundId, player, guess, pool, playerCount |
| `GameFinished` | Kör lezárás | roundId, result, winnerCount, pool, prizePerWinner, randomHex |
| `PrizeClaimed` | Nyeremény igénylés | roundId, player, amount |

## Deploy Lépésrend

### Előfeltételek

1. **Docker telepítése**
   ```bash
   # Ubuntu/Debian
   sudo apt update && sudo apt install docker.io
   ```

2. **QAN XLINK telepítése**
   ```bash
   docker run -d --name=xlink --restart=always \
     --volume=xlink:/xlink qanplatform/xlink 0 \
     https://rpc-testnet.qanplatform.com
   ```

3. **Private key exportálása**
   A QAN XLINK által generált private key-t mentsd a `privkey` fájlba a projekt gyökerében.

4. **QANX teszt tokenek igénylése**
   Nyisd meg a https://faucet.qanplatform.com oldalt és add meg a wallet címedet.

### JavaScript contract deploy

```bash
# 1. qvmctl image letöltése
docker pull qanplatform/qvmctl

# 2. JS compiler letöltése
docker pull qanplatform/qvm-compiler-js

# 3. Kompilálás
cd contracts/js
docker run --rm -v $(pwd):/ws qanplatform/qvm-compiler-js
# Eredmény: "contract" binary

# 4. Deploy
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd):/ws \
  qanplatform/qvmctl deploy \
  -language javascript \
  -privkey /ws/../../privkey \
  -rpc https://rpc-testnet.qanplatform.com \
  /ws/contract
```

### Go contract deploy

```bash
# 1. Go compiler letöltése
docker pull qanplatform/qvm-compiler-go

# 2. Kompilálás
cd contracts/go
docker run --rm -v $(pwd):/ws qanplatform/qvm-compiler-go

# 3. Deploy
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd):/ws \
  qanplatform/qvmctl deploy \
  -language golang \
  -privkey /ws/../../privkey \
  -rpc https://rpc-testnet.qanplatform.com \
  /ws/contract
```

### Contract interakció

```bash
# Contract address beállítása
export CONTRACT_ADDR=0x...

# Státusz lekérdezés
./scripts/deploy/interact.sh getStatus

# Új kör indítása
./scripts/deploy/interact.sh createRound 100000000000000000

# Belépés
./scripts/deploy/interact.sh joinGame 0xPlayerAddr heads

# Kör lezárás
./scripts/deploy/interact.sh closeRound

# Storage olvasás
./scripts/deploy/interact.sh readStorage "ROUND_COUNTER,TOTAL_GAMES_PLAYED"
```

## Frontend

### Komponensek

| Komponens | Funkció |
|-----------|---------|
| `WalletConnect` | MetaMask csatlakozás, QAN TestNet hálózat, QANX egyenleg |
| `QVMShowcase` | Contract típus választó (JS/Go), QVM technikai részletek |
| `GameLobby` | Aktuális kör, tippelés (fej/írás), belépés |
| `EventLog` | Élő eseménynapló |
| `Leaderboard` | Ranglista (győzelmek, QANX kifizetések) |
| `AdminPanel` | Kör indítás, lezárás, belépési díj beállítás |
| `RoundHistory` | Korábbi körök eredményei |

### Wallet csatlakozás

A frontend MetaMask-on keresztül csatlakozik a QAN TestNet-hez:
- Automatikus hálózat felismerés (Chain ID: 1121)
- "Switch Network" gomb ha rossz hálózaton van
- "Add Network" ha a QAN TestNet még nincs hozzáadva
- QANX egyenleg kijelzés

## QVM JS vs. Go összehasonlítás

| Szempont | CoinFlip-JS | CoinFlip-Go |
|----------|------------|------------|
| Nyelv | JavaScript | Go (Golang) |
| Entry point | `contract(process.argv.slice(2))` | `func main() { args := os.Args[1:] }` |
| DB olvasás | `process.env.DB_KEY` | `os.Getenv("DB_KEY")` |
| DB írás | `process.stdout.write("DBW=K=V\n")` | `os.Stdout.WriteString("DBW=K=V\n")` |
| Output | `process.stdout.write("OUT=k: v\n")` | `os.Stdout.WriteString("OUT=k: v\n")` |
| Error | `process.stderr.write()` + `exit(1)` | `os.Stderr.WriteString()` + `os.Exit(1)` |
| Random | `crypto.randomBytes(32)` | `crypto/rand.Read(buf)` |
| BigInt | Native `BigInt` | `math/big` package |
| Típusozás | Dinamikus | Statikus (struct, int, string) |
| Kompilálás | `qvm-compiler-js` | `qvm-compiler-go` |
| Binary méret | Általában kisebb | Általában nagyobb |

A QVM mindkét esetben ugyanazokat a syscall-okat biztosítja (`getrandom`, `time`),
ugyanazt a storage interfészt (`DBW=`, `DB_` env vars), és ugyanazt a bemeneti/kimeneti
formátumot (`OUT=`, `ERR=`). A különbség kizárólag a programozási nyelv szintaxisában van.

## Hivatkozások

- [QVM Multi-Language Smart Contracts](https://learn.qanplatform.com/developers/qvm-multi-language-smart-contracts)
- [JS Smart Contract](https://docs.qanplatform.com/testnet/smart-contract/writing/javascript)
- [Go Smart Contract](https://docs.qanplatform.com/testnet/smart-contract/writing/go)
- [Deploy](https://docs.qanplatform.com/testnet/smart-contract/deploying)
- [QAN TestNet Setup](https://docs.qanplatform.com/testnet/setup/wallet/metamask)
- [QANX Faucet](https://faucet.qanplatform.com)
- [QAN Block Explorer](https://testnet.qanscan.com)
