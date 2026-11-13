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

Typing a count earns about half XP. The focus timer earns full XP for that one quest. A photo is never uploaded; the phone may send only “yes, a photo is in my Drive”. There is a daily XP cap, each quest pays once, and a streak bonus pays for showing up again. A partner can confirm the team once a day for a small bonus. The owner page marks a player if workouts pile up, updates arrive too fast, or a duration is not believable. Calorie numbers are not accepted. A claimed wearable source does not earn full XP yet. That is phase 2, when a real health-app sync exists. Details are in [PRIVACY.md](PRIVACY.md).

It does not store food, meals, workout names, weights, notes, emails, Google tokens, or sheet links.

## License

All rights reserved. See [LICENSE](LICENSE).

This replaces the old AGPL-3.0 license. Please confirm that change before you publish. A license is a legal choice, and this file is not legal advice.

## Feedback

Issues and ideas: https://github.com/bracoliv/fitcouple/issues
