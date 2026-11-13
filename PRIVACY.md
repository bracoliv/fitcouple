# What the game server stores

Fit's game server is a Cloudflare Worker. It scores quests. It does not keep a health diary.

The player's Google Sheet, and the practice log on their phone, are the only places food, workouts, weights, and notes exist. The browser counts meals and workouts locally and sends the numbers.

## Never accepted

The Worker rejects a request that contains any of these fields, at any depth:

`food`, `meal`, `meals`, `workout`, `workouts`, `weight`, `weights`, `note`, `notes`, `kcal`, `calorie`, `calories`, `protein`, `carb`, `carbs`, `fat`, `email`, `sheet`, `spreadsheet`, `url`, `link`, `medication`, `meds`, `medicine`, `body`, `photo`, `image`, `password`, `secret`, `token`

It also rejects email addresses, web links, text longer than 80 characters, and request bodies larger than 2,000 characters. Rejected text is not saved and not written to the logs.

Logs record the path and the status code only. Query strings are redacted in Cloudflare's own logs.

Google sign-in stays in the browser. The Worker never receives the Google access token, the email address, or the sheet id.

## Player id

The browser makes a random id and hashes it. That hash is the player id. Brian has said player ids are fine to see. They are not emails and they are not Google account ids.

The browser also keeps a session token. The server stores only the SHA-256 hash of that token. Losing the browser data starts a new id. The old scores remain, still with no health content.

## Tables

### users

| Column | Example | Meaning |
| --- | --- | --- |
| id | 64 hex characters | Anonymous player id |
| token_hash | 64 hex characters | Hash of the session token. The token itself stays on the phone |
| display_name | Aisyah, or empty | Optional name the player types. Max 24 letters or numbers. Shown to their team and on the owner page |
| xp | 120 | Score |
| level | 2 | Level from XP |
| streak | 4 | Current run of days with a finished quest |
| last_active_day | 2026-11-13 | Last day a quest was finished. A date, not a diary |
| strength, discipline, health, mind | 3 | Attribute points. They start at 1 |
| difficulty | normal | easy, normal, or hard |
| program_start | 2026-11-01 | Day 1 of the 66-day plan |
| team_id | AB12CD34, or empty | Team join code |
| rank | 2, or empty | Place in that team by XP. Ties share a rank |
| flagged | 0 or 1 | The owner page should look at this player |
| flag_codes | volume, rapid, duration | Why. These words are not health notes |
| burst_start, burst_count | a clock time and a small number | Used to notice too many updates in a few minutes. Not what was logged |
| program_choice | home, beginner_gym, fat_loss, or muscle | Which shared plan they picked. Not a log of exercises they did |
| duel_wins | 1 | How many friendly duels they won |

### teams

| Column | Meaning |
| --- | --- |
| id | The join code |
| created_day | The day the team was created |

### completions

One row per player, per day, per quest. Quest ids are only:

`log_meals`, `log_workout`, `water`, `sleep`, `focus`, `daily_clear`, `team_show_up`, `team_move`

| Column | Meaning |
| --- | --- |
| user_id | Player id |
| day | YYYY-MM-DD |
| quest_id | One of the ids above |
| count | How many, for meal and workout quests. Not what |
| done | 1 or 0 |
| xp_awarded | Points given for that quest that day |
| source | manual, timer, photo, or wearable. Not a photo and not a description |

### snapshots

Written when scores change, and at most once a day when a player opens the game, so the owner page can see a trend.

| Column | Meaning |
| --- | --- |
| user_id | Player id |
| day | YYYY-MM-DD |
| xp, level, streak | Scores that day |
| strength, discipline, health, mind | Attributes that day |

## Owner page

`admin.html` calls `GET /v1/admin/customers` with the owner key in the `Authorization` header. The key is a Worker secret named `ADMIN_KEY`. It is not in the source code.

For each player the page shows:

- id and optional display name
- level, XP, streak, last active day
- XP gained in the last 7 days and the last 30 days
- day number in the 66-day program
- attribute change over 7 and 30 days, plus the recent XP points used for the little chart
- a status

Status rules, using the viewer's local date:

- **Inactive** — no finished quest yet and they joined more than 3 days ago, or their last finished quest was more than 3 days ago.
- **Improving** — not inactive, and this week's XP gain is ahead of the previous week. A new player with any XP gain counts as improving.
- **Steady** — not inactive, and this week's XP gain matches the previous week. A new player with no XP yet counts as steady.
- **Slipping** — not inactive, and this week's XP gain is behind the previous week.

“This week” is XP now minus XP on the latest snapshot on or before 7 days ago. The previous week is that snapshot minus the one on or before 14 days ago. Attributes use the same dates. Before any older snapshot exists, the comparison starts at 0 XP and attribute level 1.

The team can see a teammate's display name, level, XP, streak, and rank. They cannot see the sheet.

## Anti-cheat (what is sent, and what is not)

Each quest update may include:

| Field | Meaning |
| --- | --- |
| questId | Which quest |
| count or completed | The number, or done / not done |
| source | `manual` (typed or tapped), `timer` (the focus timer finished), `photo` (the phone says a photo exists), `wearable` (reserved) |
| hasProof | true or false. This is only a yes/no. The photo stays on the phone or in the player's Google Drive |
| durationMin | A whole number of minutes, checked and then thrown away. It is not stored |

Typing pays about half. A finished 15, 25, or 45 minute focus timer pays full XP for the focus quest. A photo yes/no pays more than typing for meal and workout counts only. Saying `wearable` does not pay full XP yet. That rate is reserved for a real health-app sync, which is not built.

The server also caps quest XP at 80 a day, pays each quest once a day, and adds a streak bonus (6 XP per streak day, up to 48) that is not part of the daily cap. A teammate can confirm once a day. That adds 15 XP for a teammate who already finished a quest. Confirmation does not include what they did.

Calories, food names, and workout names are still rejected. If a typed calorie is outside 0–4000, or a typed duration is outside 1–180 minutes, the phone does not count that row. The number is not sent. A duration on the event itself that is not believable is ignored, the account is flagged, and the number is not saved.

Flags the owner can see: too many workouts in one day (`volume`), too many updates in ten minutes (`rapid`), a duration that was not believable (`duration`).

### duels

| Column | Meaning |
| --- | --- |
| id, team_id | Duel and team |
| challenger_id, opponent_id, winner_id | Player ids |
| day, status | When, and open or done |
| created_ms | Clock time |

No exercise names and no step route. Step counts used to pick a winner already live on the steps quest row.

## Still never stored

Recipe names and calorie estimates stay in the app and, if you log them, in your sheet. Progress photos, weight or waist numbers, and your avatar stay on the phone. A selfie or uploaded photo is cropped and drawn into an avatar in the browser. IndexedDB on that phone holds the photo, the avatar, and earlier versions. Deleting the avatar removes those copies. An optional backup writes `Fit avatar.png` and `Fit avatar source.jpg` into your own Google Drive with the same `drive.file` permission used for the sheet. Fit's server never receives the photo or the avatar, and they are not stored in D1.

The team board shows a generic face unless you opt in. That opt-in only changes the board on your phone. Teammates are not sent the picture. An optional AI portrait uses your own OpenAI key, once per tick of consent, and the crop goes from the phone to OpenAI. Fit does not see that request.

The weekly coach uses a key you type on the phone. That key is sent only for that one request and is not written down. The coach prompt is level, streak, plan name, and quest ids. The reply is not saved.

Water, sleep, and steps can be typed today. A future phone health app can send the same quest ids with source `wearable`. That source does not earn full XP until that sync exists, so it cannot be faked for extra points.

Rewards shown to players are badge names and titles, including 66-Day Finisher. Restaurant vouchers exist in the server but stay off until `VOUCHERS_ENABLED` is the word `true`. While that is off, players are not offered them.

If you turn vouchers on, the server also stores this table. It is not a meal log.

| Column | Meaning |
| --- | --- |
| id | Voucher id |
| user_id | Player id |
| code_hash | Hash of the single-use code. The code itself is not stored |
| milestone | Which rule created it, such as `streak:7` |
| value | The number from your config |
| status | issued or redeemed |
| issued_day, expires_day, redeemed_day | Dates |

There are no discount codes in the player app while the switch is off.

The shop is off in the released player app until you rebuild with `STORE_ENABLED=true`. While it is off, players are not shown a Shop tab, and the shop address answers Not found. The game payload never includes products.

If you turn the shop on, it is two lists. Pump Up is the evidence shortlist. Slimming is only your SOSM+ products, shown after an 18+ tick, and never chosen from a workout, goal, or quest. Neither list is built from food or fitness data, and they do not recommend each other.

An order is stored apart from the game scores. The buyer must tick a consent box. The record is:

| Column | Meaning |
| --- | --- |
| id, user_id | Order and the player id |
| name, phone, address | Delivery only |
| items, total_cents | What was ordered and the price |
| status, gateway, provider_ref | Paid or not, and the sandbox payment reference |
| created_day | The date |
| consent | 1 when the buyer agreed the delivery details stay apart from health data |

Delete an order from the owner page when someone asks. Product text is rejected if it makes a health claim or a sales pitch. 18+ products are not placed in the recommended list.
