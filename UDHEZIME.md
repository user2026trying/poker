# POKER — Udhëzime (Faza 1 dhe 2)

Të gjitha komandat shkruhen në **PowerShell** ose në terminalin e VS Code (menu: Terminal → New Terminal).

## Çfarë përmban projekti

| Skedari | Çfarë bën |
|---|---|
| `supabase/schema.sql` | Faza 1: tabelat, rregullat e sigurisë, llogaritë dhe Coins |
| `supabase/faza2.sql` | Faza 2: motori i lojës Texas Hold'em (kartat, bastet, fituesi, rake) |
| `src/supabase.ts` | Lidhja me Supabase |
| `src/App.tsx` | Vendos cilën faqe të shfaqë |
| `src/ui.tsx` | Elementet e përbashkëta (logo, butona, Coins…) |
| `src/pages/Login.tsx` | Faqja e hyrjes |
| `src/pages/Lobby.tsx` | Lobby i lojtarit (kategoritë dhe tavolinat) |
| `src/pages/TablePage.tsx` | Tavolina e Poker-it |
| `src/pages/HeadOffice.tsx` | Paneli i Head Office |
| `src/index.css` | Ngjyrat dhe stili |

## 1. Instalo Node.js (vetëm një herë)

```powershell
winget install OpenJS.NodeJS.LTS
```

Mbyll PowerShell, hape përsëri dhe kontrollo:

```powershell
node -v
```

Duhet të shfaqet një numër versioni (p.sh. `v22...`).

## 2. Nxirr ZIP-in dhe hap projektin

ZIP-i supozohet te folderi Downloads.

```powershell
New-Item -ItemType Directory -Force C:\Projects
```

```powershell
Expand-Archive -Path "$HOME\Downloads\poker-faza1.zip" -DestinationPath C:\Projects -Force
```

```powershell
cd C:\Projects\poker
```

```powershell
npm install
```

```powershell
code .
```

## 3. Supabase

### 3.1 Krijo projektin
1. Hap https://supabase.com/dashboard dhe kyçu.
2. Kliko **New project**.
3. Name: `poker`. Database Password: kliko **Generate a password** dhe ruaje diku. Region: zgjidh një në Europë (p.sh. Frankfurt).
4. Kliko **Create new project** dhe prit 1–2 minuta.

### 3.2 Krijo databazën (ekzekuto SQL)
1. Në menunë majtas kliko **SQL Editor**.
2. Në VS Code hap `supabase/schema.sql`, shtyp `Ctrl+A` pastaj `Ctrl+C`.
3. Ngjite në SQL Editor (`Ctrl+V`) dhe kliko **Run**. Nëse del paralajmërim për "destructive operation", konfirmo.
4. Duhet të shfaqet **Success. No rows returned**.

> Ekzekutoje vetëm NJË herë. Nëse e ekzekuton përsëri del gabimi "already exists" — kjo është normale.

### 3.3 Krijo llogarinë Head Office
Në SQL Editor kliko **+** (New query), ngjit këtë rresht, **ndrysho password-in** dhe kliko **Run**:

```sql
select public.create_head_office('admin', 'VENDOS-NJE-PASSWORD-TE-FORTE');
```

### 3.4 Ndalo regjistrimin publik
1. Majtas: **Authentication** → **Sign In / Providers**.
2. Fike **Allow new users to sign up** dhe kliko **Save**.

(Lojtarët krijohen vetëm nga Head Office. Edhe pa këtë hap, një llogari e krijuar nga jashtë nuk mund të bëjë asgjë, por është më pastër kështu.)

### 3.5 Merr Project URL dhe çelësin publik
1. Majtas poshtë: **Project Settings** → **API Keys** (URL-ja gjendet te **Data API**; ose kliko butonin **Connect** lart).
2. Kopjo **Project URL** (p.sh. `https://abcdxyz.supabase.co`).
3. Kopjo çelësin **anon public** ose **Publishable key** (`sb_publishable_...`).

> KURRË mos përdor çelësin **service_role** / **secret** në këtë projekt. Nuk na duhet.

### 3.6 Lidh projektin me Supabase

```powershell
Copy-Item .env.example .env
```

```powershell
code .env
```

Zëvendëso dy vlerat me ato që kopjove dhe ruaje (`Ctrl+S`):

```
VITE_SUPABASE_URL=https://abcdxyz.supabase.co
VITE_SUPABASE_ANON_KEY=çelësi-yt-publik
```

## 4. Nise projektin lokalisht

```powershell
npm run dev
```

Hap në browser: http://localhost:5173  
Për ta ndalur: `Ctrl+C` në terminal.

## 5. Testimi i Fazës 1

1. Kyçu si `admin` → shfaqet paneli Head Office.
2. **Create Player**: krijo `lojtar1` dhe `lojtar2` me 5000 Coins.
3. **Coins Management**: shto dhe hiq Coins; provo të heqësh më shumë se bilanci (duhet të refuzohet).
4. Hap një dritare **Incognito** (`Ctrl+Shift+N`) dhe kyçu si `lojtar1`. Në një browser tjetër (p.sh. Edge) kyçu si `lojtar2`.
5. Si `lojtar1`: hap Heads Up → Duel I → kliko **Ulu**. Bilanci zbret me 1000.
6. Si `lojtar2`: duhet ta shohësh `lojtar1` në karrige pa rifreskuar faqen. Ulu edhe ti → tavolina bëhet **Full**.
7. Kliko **Largohu** → Stack-u kthehet në bilanc.
8. Si admin: **Deactivate** `lojtar2` → ai del nga llogaria dhe nuk mund të kyçet më.
9. Provo në telefon: shih seksionin më poshtë.

### Testim në telefon (i njëjti Wi-Fi)

```powershell
npm run dev -- --host
```

Në terminal shfaqet një adresë **Network** (p.sh. `http://192.168.1.20:5173`). Hape në telefon.

## 6. Backup ZIP

```powershell
Compress-Archive -Path src, supabase, public, *.json, *.ts, *.html, *.md, .env.example, .gitignore -DestinationPath "..\poker-backup-$(Get-Date -Format yyyy-MM-dd).zip" -Force -ErrorAction SilentlyContinue
```

(Backup-i nuk përfshin `node_modules` dhe as `.env`.)

## Probleme të shpeshta

| Problemi | Zgjidhja |
|---|---|
| "Mungon lidhja me Supabase" | Skedari `.env` mungon ose ka vlera të gabuara. Pas ndryshimit ndale (`Ctrl+C`) dhe nise përsëri `npm run dev`. |
| "Username ose password i gabuar" për admin | Përsërite hapin 3.3 me një username tjetër (p.sh. `admin2`). |
| `npm` nuk njihet si komandë | Mbyll dhe hap përsëri PowerShell pas instalimit të Node.js. |
| Ndryshimet nuk shfaqen live | Kontrollo që SQL u ekzekutua deri në fund pa gabim (pjesa "REALTIME"). |

## 7. Faza 2 — instalimi i lojës

1. Ndale projektin (`Ctrl+C` në terminal).
2. Nxirr ZIP-in e ri mbi projektin ekzistues (skedari `.env` nuk preket):

```powershell
Expand-Archive -Path "$HOME\Downloads\poker-faza2.zip" -DestinationPath C:\Projects -Force
```

3. Në VS Code hap `supabase/faza2.sql`, `Ctrl+A`, `Ctrl+C`.
4. Në Supabase → **SQL Editor** → **+** (New query) → `Ctrl+V` → **Run**. Duhet të shfaqet **Success**. Ekzekutoje vetëm NJË herë.
5. Nise përsëri:

```powershell
npm run dev
```

### Testimi i Fazës 2

Hap tre dritare (Opera private, Firefox, Edge) me `lojtar1`, `lojtar2`, `lojtar3` dhe ulu në të njëjtën tavolinë 6 lojtarësh.

1. Dora fillon vetë sapo ulen 2 lojtarë. Secili sheh vetëm kartat e veta.
2. Provo Fold, Check, Call, Bet, Raise dhe All-in. Butonat shfaqen vetëm kur është radha jote.
3. Mos vepro për 25 sekonda: sistemi bën Check ose Fold vetë dhe të shënon "Larg". Kliko **Jam kthyer**.
4. Luaj një dorë deri në fund (Showdown): hapen kartat, shfaqet fituesi dhe kombinimi.
5. Bëj Fold para Flop-it: te Head Office → Dashboard, Total Rake nuk duhet të rritet (No Flop, No Drop).
6. Luaj një dorë që arrin Flop-in: Total Rake rritet me 1% të pot-it (deri në Maximum Rake).
7. Mbyll një dritare në mes të dorës dhe hape përsëri: kthehesh në të njëjtin vend.

## 8. Faza 3 — GitHub

### 8.1 Instalo Git (vetëm një herë)

```powershell
winget install Git.Git
```

Mbyll VS Code dhe PowerShell, hapi përsëri, pastaj vendos emrin dhe email-in e llogarisë GitHub:

```powershell
git config --global user.name "EMRI-YT"
```

```powershell
git config --global user.email "EMAIL-I-YT-NE-GITHUB"
```

### 8.2 Krijo repository
1. Hap https://github.com/new
2. Repository name: `poker`. Zgjidh **Private**.
3. MOS shëno "Add a README", ".gitignore" ose "license".
4. Kliko **Create repository**. Kopjo adresën që shfaqet (p.sh. `https://github.com/USERNAME/poker.git`).

### 8.3 Lidh projektin lokal dhe bëj push

```powershell
cd C:\Projects\poker
```

```powershell
git init -b main
```

```powershell
git add .
```

```powershell
git commit -m "Poker platform"
```

```powershell
git remote add origin https://github.com/USERNAME/poker.git
```

```powershell
git push -u origin main
```

Herën e parë hapet një dritare e browser-it: kliko **Sign in with your browser** dhe autorizo.
Skedari `.env` dhe `node_modules` nuk ngarkohen (janë te `.gitignore`).

### 8.4 Si ta përditësosh kodin më vonë

```powershell
git add .
```

```powershell
git commit -m "Pershkrim i shkurter i ndryshimit"
```

```powershell
git push
```

## 9. Faza 3 — Vercel

### 9.1 Importo projektin
1. Hap https://vercel.com/new dhe kyçu me **Continue with GitHub**.
2. Te lista e repository-ve gjej `poker` dhe kliko **Import**. (Nëse nuk shfaqet: kliko **Adjust GitHub App Permissions** dhe lejo repository-n `poker`.)
3. Framework Preset duhet të jetë **Vite** (zgjidhet vetë).

### 9.2 Environment Variables
Para se të klikosh Deploy, hap seksionin **Environment Variables** dhe shto dy rreshta, me të njëjtat vlera si te skedari `.env`:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://PROJEKTI-YT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | çelësi `sb_publishable_...` |

### 9.3 Deploy
Kliko **Deploy** dhe prit rreth 1 minutë. Vercel të jep një adresë si `https://poker-xxxx.vercel.app`. Hape, kyçu si admin dhe testo edhe nga telefoni.

Çdo herë që bën `git push`, Vercel e përditëson faqen vetë brenda 1 minute.

Nëse harron Environment Variables: Vercel → projekti → **Settings → Environment Variables** → shtoji → pastaj **Deployments → ... → Redeploy**.

### 9.4 Domain (në të ardhmen)
Vercel → projekti → **Settings → Domains** → shkruaj domain-in → **Add**. Vercel të tregon rreshtat DNS që duhet të vendosësh te kompania ku ke blerë domain-in.

## 10. Backup final

```powershell
cd C:\Projects\poker
```

```powershell
Compress-Archive -Path src, supabase, *.json, *.ts, *.html, *.md, .env.example, .gitignore -DestinationPath "..\poker-backup-$(Get-Date -Format yyyy-MM-dd).zip" -Force
```

ZIP-i krijohet te `C:\Projects`. Databaza ruhet te Supabase; kodi edhe te GitHub.
