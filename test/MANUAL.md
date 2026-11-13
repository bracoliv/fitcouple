# Manual check

Run this after `npm install`.

1. `npm test` — scoring, privacy, the owner page, and the publish build.
2. `npm run dev`
3. Open http://127.0.0.1:8788/play.html on a phone-sized window.
4. Today shows level, an XP bar, a streak, Easy/Normal/Hard, and the quests. Tap Water. XP rises by about half a quest plus a small streak bonus. Tap Water again. XP does not rise a second time.
5. Open Path. Day 1 and today are both there. Open Focus, start the timer, and pause it. The clock moves, then stops.
6. Open Team. Create a team and copy the code. In a private window, open Play again, join with that code, and mark Water on both. “Everyone shows up” completes. On one phone, tap “Confirm the team showed up”. The other player’s XP rises by 15, once.
7. Open Sheet. Google sign-in explains that `config.js` still has the placeholder client id. The button does not call Google until that id is real. Paste a public sheet link if you have one, or tap “Practice on this phone”, add `Workout: walk`, and confirm the Move quest advances.
8. In the browser network panel, the call to the game server has `questId`, `count` or `completed`, and `source`. It may have `hasProof: true`. It does not contain the words you typed, a calorie number, or a photo.
9. Open http://127.0.0.1:8788/admin.html . Use the key in `.dev.vars` (the example is `local-dev-admin-key-change-me`). You see ids, optional names, level, XP, streak, last active day, 7-day and 30-day XP, the program day, attribute changes, and a status. A player who sent too many workouts in one day is marked to check. You do not see the practice text.
10. Open http://127.0.0.1:8788/ and http://127.0.0.1:8788/solo.html . The classic dashboards still load. Preview Demo still works.
11. `npm run build` then `npm run preview`. Open http://127.0.0.1:8790/play.html while `npm run dev` is also running. The preview page is scrambled, and it still talks to the game server on port 8787. Confirm a quest can be marked done.
12. On Today, the hero card shows a generic face next to the name and level until you make an avatar. On More, take a selfie or upload a photo, drag the crop, and tap “Make avatar on this phone”. The portrait updates. The network panel still has no photo sent to the game server. The team board stays on the generic face until you tick the share box. Delete removes it from this phone. “Make it with your own AI” only copies a prompt. Paste that prompt with the selfie into your own ChatGPT or Gemini app, then upload the result.
13. On Today, the assistant explains that requests may go to Google, Alibaba Cloud in Singapore, or OpenAI, and that Fit stores token counts and cost but not the meal. Agree once. Type `two slices of bread and an egg`. The estimate can come from the phone's food list without a model call. A question such as `how much protein from food` is answered on the phone. A photo of food, if you use one, is the request that goes to a provider. The owner page shows today's counts, tokens, USD, RM, and fallback counts, not the meal.
