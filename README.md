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
6. The local owner key is created in a file called `.dev.vars`. The sample value `local-dev-admin-key-change-me` is refused. Replace it with a different random key of at least 32 characters before the owner page will open.

`npm test` checks the scoring rules. `test/MANUAL.md` is a click-through list.

The assistant calls providers in order: Google `gemini-3.5-flash-lite`, then Alibaba Cloud Model Studio in Singapore `qwen3-vl-plus`, then OpenAI `gpt-6-luna`. Fallback happens only when a provider fails: HTTP 429, a 5xx response, a timeout, or a network error. Hitting a player's daily cap does not fall through. The player gets a daily-limit message, with a note that premium removes the cap. A content refusal does not fall through. HTTP 400, 401, 403, and 413 do not fall through; the worker logs an alert and stops. Gemini is meant to run on a paid key. Do not add a "free tier exhausted" branch. A missing key is skipped. The model names, base URLs, and order are in `wrangler.jsonc` (`AI_PROVIDER_ORDER`, `AI_GOOGLE_MODEL`, `AI_GOOGLE_BASE_URL`, `AI_QWEN_MODEL`, `AI_QWEN_BASE_URL`, `AI_OPENAI_MODEL`, `AI_OPENAI_BASE_URL`). Do not point the Google model at an older Gemini model.

Every player has one daily cap per feature. That cap counts calls to all providers together. The counter is incremented before the provider call and removed again if every provider fails. Two requests at the same time cannot both pass a cap of one.

`AI_DAILY_BUDGET_USD` defaults to `5`. Before every provider call the worker adds up today's stored cost. The day is the Malaysia date, `Asia/Kuala_Lumpur`, the same window as the per-user counters, gift dates, and the owner page's today. It resets at 00:00 MYT (UTC+8). When the total reaches the budget, every assistant call gets "The assistant is busy right now. Try again later." The owner page shows today's spend against that budget. `AI_DAILY_BUDGET_WARN` defaults to `0.8` (80%). The page marks a warning at that fraction. Crossing the warning, reaching the budget, a run of provider failures, too many owner sign-in failures, or a failed backup each send one alert that day to `OWNER_ALERT_EMAIL` through the email binding, or to `ALERT_WEBHOOK_URL` if email is not set.

`RATE_SESSION_LIMIT` defaults to 10 and `RATE_AI_LIMIT` defaults to 30, per `RATE_WINDOW_SECONDS` (60). The counter is a hash of `CF-Connecting-IP`, not the address itself. It covers `POST /v1/session` and `POST /v1/ai/*`.

Put the keys on the server, not in the page. Leave a key unset to skip that provider:

`npx wrangler secret put GEMINI_API_KEY`

`npx wrangler secret put QWEN_API_KEY`

`npx wrangler secret put OPENAI_API_KEY`

Prices are US dollars per 1 million tokens. The defaults are Gemini $0.30 in / $2.50 out, Qwen $0.20 / $1.60, and OpenAI $0.10 / $0.50. Override them with `AI_PRICE_TABLE` as JSON if a price changes. `AI_USD_TO_RM` defaults to `4.084`. The owner page shows calls, tokens, USD, RM, and fallback counts for today, 7 days, 30 days, and 66 days. It does not show the meals or photos.

Daily caps live in `wrangler.jsonc` (`AI_LIMIT_FOOD_PHOTO` 10, `AI_LIMIT_TEXT_LOG` 20, `AI_LIMIT_RECOMMEND` 5, `AI_LIMIT_CHAT` 20). The owner page can change them. It stores only the numbers. Premium removes the cap for a player id you grant there. `PREMIUM_PAYMENTS_ENABLED` stays `false`, so the release build has no payment screen. Apply the new database tables with the other migrations:

`npx wrangler d1 migrations apply fitcouple-game --remote`

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

1. Create an API key that is **not** the Gemini key. `GOOGLE_API_KEY` is baked into the public page. Restrict it to the Picker API and to the websites listed above. The build warns if this key matches `GEMINI_API_KEY`, `QWEN_API_KEY`, or `OPENAI_API_KEY`.
2. Put that key in `config.js` as `googleApiKey`.
3. Put the **project number** (the digits on the Cloud welcome screen, not the project name) in `googleAppId`.

The client id and the browser API key are visible to anyone who loads the site. That is normal. The restriction list is what stops other websites from using them.

### 3. Put the game server on Cloudflare

1. Create a free Cloudflare account.
2. Run `npx wrangler login`.
3. Run `npx wrangler d1 create fitcouple-game`.
4. Copy the database id it prints into `wrangler.jsonc`, replacing `database_id`.
5. In `wrangler.jsonc`, set `ALLOWED_ORIGINS` to your real website, comma-separated, for example `https://fit.pages.dev,https://bracoliv.github.io`. The local addresses can stay.
6. Run `npx wrangler d1 migrations apply fitcouple-game --remote`.
7. Make a random owner key of at least 32 characters (a password manager is fine). Run `npx wrangler secret put ADMIN_KEY`. Wrangler asks you to type the key. Do not put the key in the command, and do not commit it. Do not reuse `local-dev-admin-key-change-me`. The worker refuses that sample value, and it refuses a key shorter than 32 characters. Wrong guesses are throttled per IP.
8. Set the same Google web client id the site uses: in `wrangler.jsonc`, set `GOOGLE_CLIENT_ID`. `GOOGLE_SUB_SALT` is optional and only links profiles that were created while the salt was required. After those players sign in once, delete it with `npx wrangler secret delete GOOGLE_SUB_SALT`. Set `SITE_URL` to the public site origin, for example `https://fit.pages.dev`. Checkout return links use that value, not the visitor's Origin header.
9. Run `npx wrangler deploy`.
10. Copy the `workers.dev` address it prints into `config.js` as `workerUrl`.

The owner key is the gate for `admin.html`. Players sign in with Google. The worker checks the ID token and keeps one profile per Google account. It stores the Google account id, the email, and the Google name so you can find the account. Meals, workouts, weights, photos, and chat text are not stored. Profiles created before Google sign-in stay in the database. A phone that still has its old session token keeps working. If `GOOGLE_SUB_SALT` is still set, the next sign-in attaches the email to that old profile. Sheet data on the phone is unchanged.

Gift codes are on unless `GIFT_CODES_ENABLED` is `false`. On the owner page, make single-use codes such as `FC-XXXX-XXXX`. The default gift is 66 days and the code can be redeemed for 30 days. A player redeems it after signing in. Using a code while a gift is still running adds the new days onto the current end date, not onto today. When the end date passes, the account returns to the free limits. You can revoke a gift, change the end date, or grant days without a code. `AUTO_REVOKE_INACTIVE_DAYS` defaults to `0`, which leaves gifts alone. Set it to a number of days to end a gift early when that player has been inactive longer than that. The owner page lists inactive players and gifts that are about to end. A note on the player is for your own reminder. The app does not record purchases, so a decision based on spending is yours. Owner actions are written to an audit log: who (the owner key), when, and what.

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

Short version: the Google account id, email, and Google name, a hash of the session token, an optional name the player types, XP, level, four attribute numbers, a streak, the last active date, difficulty, the day they started the 66-day plan, a team code, a rank, which quest ids they finished (not what they ate), how that quest was verified (`manual`, `timer`, `photo`, or `wearable`), a yes/no that a photo exists, a daily snapshot of those scores, assistant usage counts and cost, gift-code status, and a suspicious flag if the pattern looks like farming. The purpose of the email and name is account support and limiting abuse. Meals, workouts, weights, photos, and chat text are not stored.

Typing a count earns about half XP. The focus timer earns full XP for that one quest. A photo is never uploaded; the phone may send only “yes, a photo is in my Drive”. There is a daily XP cap, each quest pays once, and a streak bonus pays for showing up again. A partner can confirm the team once a day for a small bonus. The owner page marks a player if workouts pile up, updates arrive too fast, or a duration is not believable. Calorie numbers are not accepted. A claimed wearable source does not earn full XP yet. Phone health sync can use the same step, water, and sleep quests later. Details are in [PRIVACY.md](PRIVACY.md).

### Play, part 2

On the Path tab, pick Home, Beginner gym, Fat loss, or Muscle gain. That plan names today's session for all 66 days. YouTube links open on YouTube. Fit does not host video.

On More:

- Eight Malaysian-style plates with a calorie estimate per serving. Log writes the plate into your sheet or the practice log, and the server only hears that a recipe was used.
- Weight, waist, and Day 1 / Day 66 photos stay on this phone. A personal avatar is made from a selfie on the phone and stays there too, with an optional copy in your own Google Drive. A 66-Day Finisher certificate can be printed. It is not a medical document.
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

The shop does not store food, meals, workout names, weights, health notes, Google tokens, or sheet links. The account email and Google name are stored separately so support can find the account.

## License

All rights reserved. See [LICENSE](LICENSE).

This replaces the old AGPL-3.0 license. Please confirm that change before you publish. A license is a legal choice, and this file is not legal advice.

## Feedback

Issues and ideas: https://github.com/bracoliv/fitcouple/issues

## Turn on two-factor sign-in

Do this yourself on each account. The app cannot do it for you.

1. Cloudflare: https://dash.cloudflare.com/profile/authentication then Two-Factor Authentication. Use an authenticator app.
2. Google: https://myaccount.google.com/signinoptions/two-step-verification and turn on 2-Step Verification.
3. GitHub: https://github.com/settings/security then Two-factor authentication. Use an authenticator app, and save the recovery codes somewhere that is not this repository.

## Cloudflare Access for the owner page

The owner page is `admin.html`, and `/admin/` redirects there, so Access can protect that path. The API checks a Cloudflare Access token as well as the owner key when `CF_ACCESS_AUD` is set.

1. In the Cloudflare dashboard, open Zero Trust. The free plan is enough for one user.
2. Settings → Authentication. Add Google as a login method, and add your Google account as the only allowed user. One-time PIN is also available under Authentication if you prefer email codes.
3. Access → Applications → Add an application → Self-hosted.
4. For the website, set the path to `/admin.html` and add another policy path `/admin`. For the Worker, add an application whose path is `/v1/admin`.
5. Session duration can be a day. The policy is Allow, and the include rule is your email.
6. Open the application and copy the Application Audience (AUD) tag.
7. Set `CF_ACCESS_TEAM_DOMAIN` to your team host, such as `fit.cloudflareaccess.com`, and `CF_ACCESS_AUD` to that audience tag. `npx wrangler secret put` is fine for both, or put them in `wrangler.jsonc` vars if you accept them being visible in the dashboard.
8. Leave both unset on your computer. Local `admin.html` still uses only the owner key.
9. When the audience is set, a request without a valid `Cf-Access-Jwt-Assertion` header gets 403 before the owner key is checked.

## Backups

D1 Time Travel keeps the database for 30 days. You can restore it to an earlier moment:

`npx wrangler d1 time-travel info fitcouple-game --remote`

`npx wrangler d1 time-travel restore fitcouple-game --remote --timestamp=2026-11-19T16:00:00Z`

A timestamp is UTC. 00:00 in Malaysia is 16:00 UTC the previous calendar day.

The Worker also runs a daily export at 00:15 Malaysia time (`15 16 * * *` UTC). It writes gzipped JSON and SQL into the R2 bucket `fitcouple-backups` under `d1/YYYY-MM-DD/`, and deletes objects older than 30 days. Create the bucket once:

`npx wrangler r2 bucket create fitcouple-backups`

Restore drill:

1. `npx wrangler r2 object get fitcouple-backups/d1/YYYY-MM-DD/TIMESTAMP.sql.gz --file backup.sql.gz`
2. `gzip -dc backup.sql.gz > backup.sql`
3. Read the file before you run it. It is a full copy of the tables, including emails.
4. Prefer Time Travel when the database still has the moment you want. Use the SQL file only when Time Travel does not cover that day.
5. To rehearse, restore into a second database: `npx wrangler d1 create fitcouple-drill` and `npx wrangler d1 execute fitcouple-drill --remote --file backup.sql`. Delete that database when the drill is done.

## Deploy checklist

1. `npm install`
2. `npm run typecheck` and `npm test`
3. `npm run build` and publish the `dist` folder to Cloudflare Pages. Build command `npm run build`, output `dist`.
4. Pages environment values, if you bake them in: `WORKER_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`. `GOOGLE_API_KEY` is only the Picker key.
5. `npx wrangler login`
6. `npx wrangler d1 create fitcouple-game` and put the id in `wrangler.jsonc`.
7. `npx wrangler r2 bucket create fitcouple-backups`
8. `npx wrangler d1 migrations apply fitcouple-game --remote`
9. Secrets: `ADMIN_KEY` (32+ characters, not the sample), `GEMINI_API_KEY`, and `QWEN_API_KEY` or `OPENAI_API_KEY` if you use those. Optional: `GOOGLE_SUB_SALT` until old profiles have signed in once.
10. Vars in `wrangler.jsonc`: `GOOGLE_CLIENT_ID`, `SITE_URL` (https origin), `ALLOWED_ORIGINS`, `AI_DAILY_BUDGET_USD`, `AI_DAILY_BUDGET_WARN`, `GIFT_CODES_ENABLED`, `AUTO_REVOKE_INACTIVE_DAYS`.
11. Alerts: verify a sending address in Cloudflare Email Routing, set `ALERT_FROM_EMAIL` and `OWNER_ALERT_EMAIL`. The `EMAIL` binding is already in `wrangler.jsonc`. If email is not ready, set `ALERT_WEBHOOK_URL` instead.
12. Access: `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` after the application above exists.
13. `npx wrangler deploy`
14. Turn on two-factor sign-in for Cloudflare, Google, and GitHub.

