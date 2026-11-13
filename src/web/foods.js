// Common Malaysian foods and a few plain staples. Figures are rough per serving, for a personal log.
export const FOODS = [
  { id: "nasi-lemak", names: ["nasi lemak"], portion: "1 plate", kcal: 540, protein: 18, carbs: 65, fat: 24 },
  { id: "roti-canai", names: ["roti canai", "roti prata"], portion: "1 piece", kcal: 300, protein: 7, carbs: 40, fat: 12 },
  { id: "roti-telur", names: ["roti telur"], portion: "1 piece", kcal: 380, protein: 12, carbs: 42, fat: 16 },
  { id: "char-kuey-teow", names: ["char kuey teow", "char kway teow"], portion: "1 plate", kcal: 740, protein: 20, carbs: 90, fat: 32 },
  { id: "teh-tarik", names: ["teh tarik"], portion: "1 cup", kcal: 130, protein: 3, carbs: 20, fat: 4 },
  { id: "teh-o", names: ["teh o", "teh-o"], portion: "1 cup", kcal: 40, protein: 0, carbs: 10, fat: 0 },
  { id: "kopi-o", names: ["kopi o", "kopi-o"], portion: "1 cup", kcal: 40, protein: 0, carbs: 10, fat: 0 },
  { id: "mee-goreng", names: ["mee goreng"], portion: "1 plate", kcal: 550, protein: 15, carbs: 70, fat: 22 },
  { id: "maggi-goreng", names: ["maggi goreng"], portion: "1 plate", kcal: 480, protein: 12, carbs: 60, fat: 20 },
  { id: "laksa", names: ["laksa", "curry laksa", "asam laksa"], portion: "1 bowl", kcal: 560, protein: 22, carbs: 55, fat: 26 },
  { id: "nasi-ayam", names: ["nasi ayam", "chicken rice", "hainanese chicken"], portion: "1 plate", kcal: 600, protein: 30, carbs: 70, fat: 18 },
  { id: "economy-rice", names: ["economy rice", "chap fan", "mixed rice"], portion: "1 plate, 2 dishes", kcal: 650, protein: 25, carbs: 80, fat: 22 },
  { id: "white-rice", names: ["white rice", "plain rice", "rice"], portion: "1 cup", kcal: 260, protein: 4, carbs: 58, fat: 0 },
  { id: "fried-rice", names: ["fried rice", "nasi goreng"], portion: "1 plate", kcal: 620, protein: 18, carbs: 80, fat: 22 },
  { id: "satay", names: ["satay", "chicken satay"], portion: "1 stick", kcal: 50, protein: 5, carbs: 1, fat: 3 },
  { id: "fried-chicken", names: ["fried chicken", "ayam goreng"], portion: "1 piece", kcal: 320, protein: 25, carbs: 10, fat: 20 },
  { id: "ikan-bakar", names: ["ikan bakar", "grilled fish"], portion: "1 piece", kcal: 180, protein: 28, carbs: 0, fat: 8 },
  { id: "egg", names: ["egg", "eggs", "telur"], portion: "1 egg", kcal: 70, protein: 6, carbs: 0, fat: 5 },
  { id: "bread", names: ["bread", "slice of bread", "slices of bread"], portion: "1 slice", kcal: 80, protein: 3, carbs: 15, fat: 1 },
  { id: "oat", names: ["oat", "oatmeal", "oats"], portion: "1 bowl", kcal: 150, protein: 5, carbs: 27, fat: 3 },
  { id: "banana", names: ["banana"], portion: "1 fruit", kcal: 90, protein: 1, carbs: 23, fat: 0 },
  { id: "apple", names: ["apple"], portion: "1 fruit", kcal: 80, protein: 0, carbs: 21, fat: 0 },
  { id: "milk", names: ["milk", "susu"], portion: "1 cup", kcal: 150, protein: 8, carbs: 12, fat: 8 },
  { id: "tofu", names: ["tofu", "tauhu"], portion: "1 piece", kcal: 80, protein: 8, carbs: 2, fat: 5 },
  { id: "kangkung", names: ["kangkung"], portion: "1 side", kcal: 40, protein: 2, carbs: 4, fat: 2 },
  { id: "cucumber", names: ["cucumber"], portion: "1 side", kcal: 10, protein: 0, carbs: 2, fat: 0 },
  { id: "mee-hoon", names: ["mee hoon soup", "bee hoon soup"], portion: "1 bowl", kcal: 380, protein: 16, carbs: 55, fat: 8 },
  { id: "wantan-mee", names: ["wantan mee", "wonton mee"], portion: "1 bowl", kcal: 450, protein: 18, carbs: 60, fat: 14 },
  { id: "popiah", names: ["popiah"], portion: "1 roll", kcal: 180, protein: 6, carbs: 22, fat: 7 },
  { id: "cendol", names: ["cendol"], portion: "1 bowl", kcal: 280, protein: 3, carbs: 50, fat: 8 },
];

const COUNTS = [
  [/^(a|an|one|1|一)\s+/, 1],
  [/^(two|2|两|二)\s+/, 2],
  [/^(three|3|三)\s+/, 3],
  [/^(four|4|四)\s+/, 4],
  [/^half\s+/, 0.5],
];

function round(n) {
  return Math.round(n);
}

function findFood(clause) {
  const text = clause.toLowerCase();
  const ranked = FOODS.slice().sort((a, b) => b.names[0].length - a.names[0].length);
  return ranked.find((food) => food.names.some((name) => text.includes(name))) || null;
}

export function parseMealText(raw) {
  const text = String(raw || "").trim();
  if (!text) return { items: [], complete: false, unmatched: [] };
  const parts = text.split(/\s+and\s+|\s*,\s*|\s+with\s+|和|加/i).map((part) => part.trim()).filter(Boolean);
  const items = [];
  const unmatched = [];
  for (const part of parts) {
    let qty = 1;
    let rest = part;
    for (const [pattern, value] of COUNTS) {
      if (pattern.test(rest.toLowerCase())) {
        qty = value;
        rest = rest.replace(pattern, "");
        break;
      }
    }
    const food = findFood(rest);
    if (!food) {
      unmatched.push(part);
      continue;
    }
    items.push({
      name: food.names[0],
      portion: qty === 1 ? food.portion : `${qty} × ${food.portion}`,
      kcal: round(food.kcal * qty),
      protein: round(food.protein * qty),
      carbs: round(food.carbs * qty),
      fat: round(food.fat * qty),
      source: "local",
    });
  }
  return { items, complete: unmatched.length === 0 && items.length > 0, unmatched };
}
