// ============================================================================
// blockchain.ts — Szerver oldali QANX átutalás modul
// QAN TestNet | ethers v6
//
// Feladat: amikor egy nyertes igényli a díját (/api/claim), ez a modul
// az admin tárca segítségével valódi QANX tranzakciót küld a nyertes
// tárcájára a QAN TestNet hálózaton.
//
// Szükséges env változó:
//   ADMIN_PRIVATE_KEY  — az admin tárca private key-je (0x prefix nélkül is OK)
//
// Ha ADMIN_PRIVATE_KEY nincs beállítva, a claim csak DB-ben jelölődik,
// blokklánc-tranzakció nem történik (fallback mód).
// ============================================================================

import { ethers } from "ethers";

const QAN_TESTNET_RPC = "https://rpc-testnet.qanplatform.com";
const CHAIN_ID = 1121;

// Singleton provider és wallet
let provider: ethers.JsonRpcProvider | null = null;
let adminWallet: ethers.Wallet | null = null;

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

  provider = new ethers.JsonRpcProvider(QAN_TESTNET_RPC, {
    chainId: CHAIN_ID,
    name: "QAN TestNet",
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
