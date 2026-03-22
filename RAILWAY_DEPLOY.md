# QAN CoinFlip — Railway Deploy (Multiplayer szerver)

A Railway.app egy ingyenes hosting szolgáltatás ami Node.js szervereket futtat.
Így a CoinFlip app-ot bárki elérheti, és **valódi multiplayer** lesz — mindenki
ugyanazt a kört látja.

## Lépések

### 1. Railway regisztráció

1. Menj ide: **https://railway.app**
2. Kattints: **"Login"** → válaszd a **"GitHub"** opciót
3. Ha nincs GitHub fiókod: először regisztrálj a github.com-on
4. Engedélyezd a Railway hozzáférését a GitHub-odhoz

### 2. Projekt feltöltés GitHub-ra

1. Menj a github.com-ra → **"+"** → **"New repository"**
2. Név: `qan-coinflip`  |  **Public**  |  Create
3. Töltsd fel az összes fájlt a qan-coinflip mappából
   (az egész mappa tartalmát húzd bele)
4. Commit

### 3. Railway deploy

1. A Railway dashboardon kattints: **"New Project"**
2. Válaszd: **"Deploy from GitHub Repo"**
3. Válaszd ki a `qan-coinflip` repódat
4. Railway automatikusan felismeri a Node.js projektet
5. Várj 2-3 percet — a build automatikusan elindul
6. Ha kész, kattints a **"Settings"** → **"Networking"** → **"Generate Domain"**
7. Kapsz egy URL-t, pl: `qan-coinflip-production.up.railway.app`

### 4. Kész!

Ez az URL-t add meg mindenkinek. A szerver 0-24 fut, és bárki csatlakozhat.

## Fontos

- Az ingyenes Railway szint 500 óra/hó futtatást ad (kb. 20 nap nonstop)
- Ha többre van szükséged: $5/hó a Hobby plan
- Az adatbázis (SQLite) a szerveren van — ha újraindul, az adatok megmaradnak

## Netlify alternatíva

Ha a Netlify-on akarod tartani a frontendet, de a backend a Railway-en fut:
1. A Netlify oldalon marad a statikus index.html (a korábbi verzió)
2. A frontend kódban az API URL-t átírod a Railway URL-re

De egyszerűbb ha az egész a Railway-en fut.
