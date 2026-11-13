# Fit

Free food and workout tracker for one person, couples, and families.

You log with any AI. Data stays in **your own Google Sheet**. The classic pages only read the link you paste. They do not store your data.

**Play** adds quests, levels, and streaks. It is explained at the bottom of this file, in the section for Brian. Food still stays in the sheet.

**Not medical advice.** Goals are yours. AI suggestions are for personal tracking only. For health conditions, follow your clinician.

## Start here

Open the site: **https://bracoliv.github.io/fitcouple/**

1. Choose **FitSolo**, **FitCouple**, or **FitFamily**
2. Copy the template: [Open template](https://docs.google.com/spreadsheets/d/1iyAFNzUbGRA8KqoBIUo-hBv-cJ4WhEdCsLgvlXOZ5Kg/edit) → File → Make a copy
3. Share your copy: **Anyone with the link → Viewer**
4. Paste that link into the dashboard
5. Send the same link plus the README tab to your AI (ChatGPT, Grok, Gemini, Claude, etc.)

Each version keeps its own link on this device. Do not mix Solo, Couple, and Family in one sheet.

Play can also sign in with Google and keep the sheet private. That path does not need “anyone with the link”.

## What it does

- Daily calories, protein, carbs, fat, and workouts
- Personal targets from your age, size, activity, and goal (not fixed numbers)
- Optional nutrition-label details when you photograph a label
- Body measurements history
- Optional medication reminder when you open the page
- Short goal badge on each card (build, cut, sugar, BP, and others)
- Optional game: daily quests, XP, a streak, a 66-day plan, and team quests

## Who it is for

- People who already use an AI and want it to log for them
- Couples or families who want to see each other in one view
- Anyone who wants data in their own Sheet, not on someone else’s server

## Who it is not for

- People who need reliable timed push reminders (medicine, workouts) without opening the page
- People who do not want to use Google Sheets or an AI
- Clinical or diagnostic use

## Privacy and safety

- Your food, body, and medication data live only in your Google Sheet (or in a practice log on your phone)
- The classic dashboards still only read a link you paste
- Play signs in to Google inside the browser. The game server stores scores, not the sheet. Details are in [PRIVACY.md](PRIVACY.md)
- Share the sheet as **Viewer** only if you are using the link-based dashboard
- Do not post your sheet link in public
- AI writes by appending rows. It should not edit or delete old rows
- This is not a medical device and does not replace professional care

## For Brian: set up sign-in, the game server, and the owner page

You do this once. A player never sees these steps.

Expected cost if you stay on the free plans: **$0**.

- Cloudflare Workers free plan: 100,000 requests a day, and 10 milliseconds of computer time per request. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- Cloudflare D1 (the small database) on the free plan: 5 million rows read a day, 100,000 rows written a day, 5 GB stored. [D1 pricing](https://developers.cloudflare.com/workers/platform/pricing/#d1)
- Cloudflare Pages: the website files are free. [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- Google Cloud: the sign-in client and normal Sheets use at this size are not billed. You still create a free Google Cloud project. [Google Cloud console](https://console.cloud.google.com/)
- The paid Workers plan is $5 a month, and only matters if the free limits are too small. A household app is far under them.

### 1. Run it on your computer

1. Install Node.js 22 or newer.
2. In this folder, run `npm install`.
3. Run `npm run dev`.
4. Open http://127.0.0.1:8788/play.html
5. The owner page is http://127.0.0.1:8788/admin.html
6. The local owner key is created in a file called `.dev.vars`. The sample value is `local-dev-admin-key-change-me`. That key is only for your computer.

`npm test` checks the scoring rules. `test/MANUAL.md` is a click-through list.

Google sign-in will not complete until step 2 is done. The button is already wired. Until the client id is filled in, it tells you to edit `config.js`.

### 2. Create the Google sign-in client

The app asks Google for one permission: `drive.file`. In plain words, Fit can only open a sheet it created, or a sheet the person picks in Google’s file window. It cannot browse their Drive.

1. Open https://console.cloud.google.com/ and create a project. Name it Fit.
2. APIs & Services → Library. Turn on **Google Sheets API** and **Google Drive API**. If you want “Choose a sheet”, also turn on **Google Picker API**.
3. APIs & Services → OAuth consent screen. Choose External. App name: Fit. Use your email. Add yourself as a test user. While the app is in testing, only test users can sign in.
4. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
5. Under Authorized JavaScript origins, add:
   - `http://127.0.0.1:8788`
   - `http://localhost:8788`
   - `https://bracoliv.github.io`
   - the Pages address you get in step 4, once you have it
6. Leave the client secret empty. This app signs in from the browser, and a secret cannot be hidden in a web page. Do not create one and paste it into the code.
7. Copy the client id (it ends in `.apps.googleusercontent.com`) into `config.js` as `googleClientId`.

Optional, only for “Choose a sheet”:

1. Create an API key.
2. Restrict it to the websites listed above, and to the Picker and Drive APIs.
3. Put that key in `config.js` as `googleApiKey`.
4. Put the **project number** (the digits on the Cloud welcome screen, not the project name) in `googleAppId`.

The client id and the browser API key are visible to anyone who loads the site. That is normal. The restriction list is what stops other websites from using them.

### 3. Put the game server on Cloudflare

1. Create a free Cloudflare account.
2. Run `npx wrangler login`.
3. Run `npx wrangler d1 create fitcouple-game`.
4. Copy the database id it prints into `wrangler.jsonc`, replacing `database_id`.
5. In `wrangler.jsonc`, set `ALLOWED_ORIGINS` to your real website, comma-separated, for example `https://fit.pages.dev,https://bracoliv.github.io`. The local addresses can stay.
6. Run `npx wrangler d1 migrations apply fitcouple-game --remote`.
7. Make a long random owner key (a password manager is fine). Run `npx wrangler secret put ADMIN_KEY`. Wrangler asks you to type the key. Do not put the key in the command, and do not commit it. Do not reuse the local `.dev.vars` key.
8. Run `npx wrangler deploy`.
9. Copy the `workers.dev` address it prints into `config.js` as `workerUrl`.

There is no other secret. The owner key is the gate for `admin.html`.

### 4. Publish the website

The readable code stays in this repository. The command `npm run build` writes a smaller, scrambled copy into a folder called `dist`. Publish **that folder**.

Scrambling the published files makes casual copying harder. It is not a lock. If this GitHub repository is public, anyone can still read `src/`. To hide the scoring rules, make the repository private and publish only `dist`.

GitHub’s free plan publishes sites from public repositories. For a private repository, use Cloudflare Pages, which is free:

1. In the Cloudflare dashboard, create a Pages project.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Add the environment values `WORKER_URL` and, if you want them baked in, `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, and `GOOGLE_APP_ID`. They are public browser settings, not the owner key.
5. Add the Pages address to the Google client’s JavaScript origins, and to `ALLOWED_ORIGINS`, then run `npx wrangler deploy` again.

You can also upload the `dist` folder by hand in the Pages dashboard.

Open `https://your-site/admin.html` and type the owner key. You should see each player’s id, optional name, level, XP, streak, last active day, XP gained over 7 and 30 days, how far they are into the 66 days, attribute changes, and a status: improving, steady, slipping, or inactive. You will not see meals, workouts, weights, or notes. The exact columns are listed in [PRIVACY.md](PRIVACY.md).

### What the server stores

Short version: an anonymous player id, a hash of their session token, an optional display name, XP, level, four attribute numbers, a streak, the last active date, difficulty, the day they started the 66-day plan, a team code, a rank, which quest ids they finished (not what they ate), how that quest was verified (`manual`, `timer`, `photo`, or `wearable`), a yes/no that a photo exists, a daily snapshot of those scores, and a suspicious flag if the pattern looks like farming.

Typing a count earns about half XP. The focus timer earns full XP for that one quest. A photo is never uploaded; the phone may send only “yes, a photo is in my Drive”. There is a daily XP cap, each quest pays once, and a streak bonus pays for showing up again. A partner can confirm the team once a day for a small bonus. The owner page marks a player if workouts pile up, updates arrive too fast, or a duration is not believable. Calorie numbers are not accepted. A claimed wearable source does not earn full XP yet. Phone health sync can use the same step, water, and sleep quests later. Details are in [PRIVACY.md](PRIVACY.md).

### Play, part 2

On the Path tab, pick Home, Beginner gym, Fat loss, or Muscle gain. That plan names today's session for all 66 days. YouTube links open on YouTube. Fit does not host video.

On More:

- Eight Malaysian-style plates with a calorie estimate per serving. Log writes the plate into your sheet or the practice log, and the server only hears that a recipe was used.
- Weight, waist, and Day 1 / Day 66 photos stay on this phone. A 66-Day Finisher certificate can be printed. It is not a medical document.
- A weekly coach uses **your** OpenAI or Groq key, once a week. The server sends your level, streak, and plan name. It does not keep the key or the reply.

On Team, a weekly challenge needs each person to finish the day's session on 3 days. A friendly duel compares step counts after both finish the session. The prize is XP and a title.

Rewards in the player app are badges and titles only. There are no discounts, vouchers, or shop rewards while the restaurant switch below is off.

### Restaurant vouchers (off)

This is for a possible future healthy-meal restaurant. It is separate from SOSM+. It is **off** until you turn it on. Players do not see it, and the app still says badges and titles only.

The switch is `VOUCHERS_ENABLED` in `wrangler.jsonc`. It must be the exact word `true`. Anything else, including empty, means off.

Before you turn it on, edit these settings in the same file. They are not buried in the program:

- `VOUCHER_MILESTONES` — comma-separated rules, `kind:number:value`. Kinds are `streak`, `level`, and `verified`. Example: `streak:7:5,level:10:15,verified:3:8`. A 7-day streak unlocks value 5. A level reward also needs verified days. A verified day is a focus timer, a photo check, or a future health-app sync. Typed entries alone do not unlock level rewards.
- `VOUCHER_VERIFIED_DAYS` — how many verified days a level reward needs. `1` is a start.
- `VOUCHER_EXPIRY_DAYS` — how many days a code lasts.
- `VOUCHER_VALUE_LABEL` — the word shown next to the number, such as `RM`. Letters only.
- `VOUCHER_PREFIX` — letters on the code, such as `FIT`.

Then set a staff key, which is different from the owner key:

`npx wrangler secret put STAFF_KEY`

Deploy again with `npx wrangler deploy`. Staff open `redeem.html`, type the staff key, and scan the QR or type the code. A code works once. The player sees the QR on the phone that earned it.

The server stores the player id, a hash of the code (not the code itself), the milestone, the value number, and whether it was used or when it expires. It does not store the dish. Logging a restaurant meal, if you turn this on, is only a quest id.

### Shop (off in the released app)

Physical goods only. Fit does not use Apple or Google in-app purchase. The released player app has **no Shop tab** until you rebuild it with the flag on. Leaving the server flag off is not enough on its own: the shop pages and the shop code are left out of `dist/` so a player cannot open a hidden shop.

`STORE_ENABLED` must be the exact word `true` in `wrangler.jsonc`, and you must build again with that same word:

`STORE_ENABLED=true npm run build`

Until both are true, `/v1/store/catalog` answers Not found, and `dist/play.js` has no cart and no product list. Leave `STORE_MODE` as `external`. That is link-out. Fit does not take payment inside the app.

When the Shop tab is on, it is visible and it holds two stores that never share a product. It also shows the seller name, address line, and phone (`STORE_SELLER_NAME`, `STORE_SELLER_LINE`, `STORE_SELLER_CONTACT`), plus Terms, Refunds, and Shop privacy. Edit `src/shop-pages/` before you take orders. Those pages are a starting point, not legal advice.

**Pump Up** is a short evidence list only: whey protein, creatine, vitamin D3, omega-3, and magnesium. Examples you can add, each with its own why, evidence, dose, testing, halal, and MAL: ON Gold Standard Whey Double Rich Chocolate, ON Gold Standard Whey Vanilla, Rule 1 Creatine, ON Micronized Creatine, Rule 1 R1 Isolate, Rule 1 Plant Protein, VitaHealth D3 1000 IU, Blackmores Omega-3 Triple Strength, and Swisse Magnesium. Put that list in `STORE_PUMP_CATALOG` as JSON, or add the rows on the owner page. `kind` must be `whey`, `creatine`, `vitamin-d3`, `omega-3`, or `magnesium`. Fat burners and slimming products are rejected. A Pump Up link must be Myprotein, Lazada (use the LazMall listing), or a Shopee Mall link. The page says some of those links are affiliate links.

**Slimming** is only your own SOSM+ products, such as MateBurn and Night Booster. Put them in `STORE_SLIM_CATALOG`, not in the Pump Up list. The store is labelled as yours. It stays behind an 18+ tick and it is never chosen from a workout, a goal, or a quest. Every Slimming card shows: "This should be taken with a balanced diet and regular exercise." The page rejects fat-burning, quick weight loss, blood pressure, and heart disease claims. Links are Shopee or WhatsApp.

A product saved in one store cannot appear in the other. The two lists are not used to recommend each other.

Each product still needs a plain reason, the evidence, the dose, third-party testing (or "Not third-party tested"), halal (`yes`, `no`, or `not-stated`), and a MAL number or `not-stated`. The price in sen cannot be below `listPriceCents`. There is no promo code, points-for-products, or bundle.

In-app checkout is optional and stays in sandbox. `STORE_SANDBOX` must stay `true`. This version refuses a live Stripe key and will not turn on live Billplz or ToyyibPay. Set `STORE_MODE` to `checkout` and `STORE_GATEWAY` to `billplz`, `toyyibpay`, or `stripe` only after you have sandbox keys. One order can hold products from only one store. Put the keys in with `npx wrangler secret put`, not in the source:

- `BILLPLZ_API_KEY` and `BILLPLZ_COLLECTION_ID` for Billplz sandbox
- `TOYYIBPAY_SECRET` and `TOYYIBPAY_CATEGORY` for ToyyibPay sandbox
- `STRIPE_SECRET` must start with `sk_test_`

With no keys, checkout opens a test page that marks the order paid and charges nothing. There is no promo code, no points-for-products, and no bundle price.

An order stores only the name, phone, address, items, total, and that the buyer ticked the delivery consent box. Checkout refuses the order without that tick. The order table is separate from food and workout scores. The shop does not read those scores to recommend or market anything. On the owner page you can delete an order if the buyer asks.

It does not store food, meals, workout names, weights, notes, emails, Google tokens, or sheet links.

## License

All rights reserved. See [LICENSE](LICENSE).

This replaces the old AGPL-3.0 license. Please confirm that change before you publish. A license is a legal choice, and this file is not legal advice.

## Feedback

Issues and ideas: https://github.com/bracoliv/fitcouple/issues
