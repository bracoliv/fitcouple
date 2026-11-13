// Recipes and video links stay in the browser. Logging sends only a quest id.

export const RECIPES = [
  { id: "nasi-lemak-light", name: "Lighter nasi lemak", kcal: 520, note: "Rice, egg, cucumber, a little sambal, grilled chicken. Estimate for one plate." },
  { id: "chicken-rice", name: "Home chicken rice", kcal: 610, note: "Skinless chicken, rice, cucumber, clear soup. Estimate for one plate." },
  { id: "ikan-bakar", name: "Ikan bakar and rice", kcal: 540, note: "Grilled fish, rice, kangkung. Estimate for one plate." },
  { id: "mee-hoon-soup", name: "Mee hoon soup", kcal: 380, note: "Rice noodles, chicken, greens, clear broth. Estimate for one bowl." },
  { id: "tauhu-telur", name: "Tauhu telur", kcal: 360, note: "Egg tofu, a small portion of sauce, cucumber. Estimate for one plate." },
  { id: "satay-chicken", name: "Chicken satay plate", kcal: 490, note: "Grilled chicken skewers, cucumber, a spoon of peanut sauce, rice. Estimate." },
  { id: "chapati-dhal", name: "Chapati and dhal", kcal: 450, note: "Two chapati and a bowl of dhal. Estimate." },
  { id: "yong-tau-foo", name: "Yong tau foo soup", kcal: 340, note: "Tofu, veg, fish balls, clear soup, little noodles. Estimate for one bowl." },
];

export const VIDEOS = {
  squat: { title: "Bodyweight squat", url: "https://www.youtube.com/watch?v=8uoaYwS6iFM" },
  barbell_squat: { title: "Barbell squat form", url: "https://www.youtube.com/watch?v=Dy28eq2PjcM" },
  beginner_squat: { title: "Squat for beginners", url: "https://www.youtube.com/watch?v=aclHkVaku9U" },
  pushup: { title: "Push-up", url: "https://www.youtube.com/watch?v=IODxDxX7oi4" },
  plank: { title: "Plank", url: "https://www.youtube.com/watch?v=pSHjTRCQxIw" },
};

export function guidedLogEvent() {
  return { questId: "guided_log", completed: true, source: "manual" };
}

export function videoFor(key) {
  if (!key || !VIDEOS[key]) return null;
  return VIDEOS[key];
}
