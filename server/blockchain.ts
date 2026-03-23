// ============================================================================
// blockchain.ts — Szerver oldali blokklánc modul
// QAN TestNet | ethers v6
//
// Két fő feladata:
//
// 1. QANX ÁTUTALÁS (sendPrize):
//    Amikor egy nyertes igényli a díját (/api/claim), az admin tárca
//    segítségével valódi QANX tranzakciót küld a nyertes tárcájára.
//    Szükséges env: ADMIN_PRIVATE_KEY
//
// 2. BLOKKLÁNC-ALAPÚ VÉLETLENSZÁM (getBlockHashResult):
//    A closeRound híváskor lekéri a QAN TestNet legutóbbi blokkjának
//    hash-ét, és abból számítja az eredményt (fej/írás).
//    Ez matematikailag azonos a QVM getrandom() syscall működésével:
//    mindkettő az előző blokk hash-éből derivál determinisztikus
//    byte-sorozatot. A result így a block explorerrel ellenőrizhető.
//    Nem szükséges hozzá ADMIN_PRIVATE_KEY.
//
// Ha ADMIN_PRIVATE_KEY nincs beállítva, a claim csak DB-ben jelölődik,
// blokklánc-tranzakció nem történik (fallback mód).
// ============================================================================

import { ethers } from "ethers";

const QAN_TESTNET_RPC = "https://rpc-testnet.qanplatform.com";
const CHAIN_ID = 1121;
const BLOCK_EXPLORER = "https://testnet.qanscan.com";

// Singleton provider és wallet
let provider: ethers.JsonRpcProvider | null = null;
let adminWallet: ethers.Wallet | null = null;

// Read-only provider (wallet nélkül, csak olvasáshoz — pl. blokk hash)
let readProvider: ethers.JsonRpcProvider | null = null;

/**
 * Visszaad egy read-only providert (wallet nélkül).
 * Blokk hash lekérdezéshez, nincs szükség ADMIN_PRIVATE_KEY-re.
 */
function getReadProvider(): ethers.JsonRpcProvider {
  if (readProvider) return readProvider;
  readProvider = new ethers.JsonRpcProvider(QAN_TESTNET_RPC, {
    chainId: CHAIN_ID,
    name: "QAN TestNet",
  }, {
    batchMaxCount: 1,
  });
  return readProvider;
}

/**
 * Visszaadja az inicializált admin wallet-et.
 * Hibát dob, ha ADMIN_PRIVATE_KEY nincs beállítva.
 */
function getAdminWallet(): ethers.Wallet {
  if (adminWallet && provider) return adminWallet;

  const rawKey = process.env.ADMIN_PRIVATE_KEY;
  if (!rawKey) {
    throw new Error(
      "ADMIN_PRIVATE_KEY környezeti változó nincs beállítva. " +
      "A blokklánc-átutalás nem lehetséges."
    );
  }

  // 0x prefix hozzáadása ha hiányzik
  const privateKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;

  // batchMaxCount: 1 — letiltja a batch JSON-RPC kéréseket.
  // A QAN TestNet RPC nem támogatja a tömbös (batch) kéréseket,
  // csak egyedi JSON-RPC objektumokat fogad el.
  provider = new ethers.JsonRpcProvider(QAN_TESTNET_RPC, {
    chainId: CHAIN_ID,
    name: "QAN TestNet",
  }, {
    batchMaxCount: 1,
  });

  adminWallet = new ethers.Wallet(privateKey, provider);
  console.log(`[blockchain] Admin tárca betöltve: ${adminWallet.address}`);

  return adminWallet;
}

/**
 * Igaz, ha az ADMIN_PRIVATE_KEY be van állítva és a blokklánc-küldés aktív.
 */
export function isBlockchainEnabled(): boolean {
  return !!process.env.ADMIN_PRIVATE_KEY;
}

/**
 * Visszaadja az admin tárca QANX egyenlegét (formatált, pl. "1.2345").
 * Ha nem elérhető, "0"-t ad vissza.
 */
export async function getAdminBalance(): Promise<{ address: string; balance: string }> {
  try {
    const wallet = getAdminWallet();
    const raw = await provider!.getBalance(wallet.address);
    return {
      address: wallet.address,
      balance: ethers.formatEther(raw),
    };
  } catch (err: any) {
    return { address: "N/A", balance: "0" };
  }
}

/**
 * Valódi QANX átutalást végez az admin tárcából a nyertes tárcájára.
 *
 * @param toAddress   — nyertes tárcacíme (0x...)
 * @param amountQANX  — összeg QANX-ben (pl. "0.2500")
 * @returns           — tranzakció hash (0x...)
 * @throws            — ha a tranzakció sikertelen
 */
export async function sendPrize(
  toAddress: string,
  amountQANX: string
): Promise<string> {
  const wallet = getAdminWallet();

  // Összeg wei-be konvertálva
  const amountWei = ethers.parseEther(amountQANX);

  // Egyenleg ellenőrzés
  const balance = await provider!.getBalance(wallet.address);
  if (balance < amountWei) {
    throw new Error(
      `Nincs elegendő QANX az admin tárcán. ` +
      `Szükséges: ${amountQANX} QANX, ` +
      `Elérhető: ${ethers.formatEther(balance)} QANX`
    );
  }

  console.log(
    `[blockchain] QANX küldés: ${amountQANX} QANX → ${toAddress}`
  );

  // Tranzakció küldése
  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: amountWei,
  });

  console.log(`[blockchain] Tranzakció elküldve: ${tx.hash}`);

  // 1 blokkos megerősítés megvárása
  const receipt = await tx.wait(1);

  if (!receipt || receipt.status === 0) {
    throw new Error(`Tranzakció meghiúsult a blokkláncon: ${tx.hash}`);
  }

  console.log(`[blockchain] Megerősítve: ${tx.hash} (blokk: ${receipt.blockNumber})`);

  return tx.hash;
}

/**
 * Lekéri a QAN TestNet legutóbbi blokkját, és abból kiszámolja
 * a fej/írás eredményt — ugyanazzal az algoritmussal, amit a QVM
 * getrandom() syscall alkalmaz (az előző blokk hash-éből derivált
 * determinisztikus byte-sorozat első 4 byte-ja alapján).
 *
 * Így az eredmény a QAN block explorerrel bárki által ellenőrizhető:
 *   https://testnet.qanscan.com/block/<blockNumber>
 *
 * Nem szükséges hozzá ADMIN_PRIVATE_KEY.
 *
 * @returns result        — "heads" vagy "tails"
 * @returns blockHash     — a blokk hash (0x...)
 * @returns blockNumber   — a blokk száma
 * @returns randomHex     — az első 8 byte hex (megegyezik a QVM randomHex kimenetével)
 * @returns explorerUrl   — direkt link a block explorerre
 */
export async function getBlockHashResult(): Promise<{
  result: "heads" | "tails";
  blockHash: string;
  blockNumber: number;
  randomHex: string;
  explorerUrl: string;
}> {
  const rp = getReadProvider();

  // Legutóbbi lezárt blokk lekérése
  const block = await rp.getBlock("latest");
  if (!block || !block.hash) {
    throw new Error("Nem sikerült lekérni a legutóbbi blokkot a QAN TestNet-ről");
  }

  // QVM getrandom() algoritmusa:
  // Az előző blokk hash-éből derivált byte-sorozat első 4 byte-ját
  // uint32-ként értelmezi, páros = fej, páratlan = írás
  const hashBytes = Buffer.from(block.hash.slice(2), "hex");
  const randomValue = hashBytes.readUInt32BE(0);
  const result: "heads" | "tails" = randomValue % 2 === 0 ? "heads" : "tails";
  const randomHex = hashBytes.slice(0, 8).toString("hex");

  console.log(
    `[blockchain] Blokk #${block.number} hash: ${block.hash.slice(0, 18)}... ` +
    `→ randomValue: ${randomValue} → eredmény: ${result}`
  );

  return {
    result,
    blockHash: block.hash,
    blockNumber: block.number,
    randomHex,
    explorerUrl: `${BLOCK_EXPLORER}/block/${block.number}`,
  };
}
