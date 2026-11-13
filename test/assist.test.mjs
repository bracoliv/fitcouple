import assert from "node:assert/strict";
import test from "node:test";
import { parseMealText } from "../src/web/foods.js";
import { FAQ, matchFaq } from "../src/web/knowledge.js";

test("local foods and the faq answer before any model call", () => {
  assert.ok(FAQ.length >= 40);
  const meal = parseMealText("two slices of bread and an egg");
  assert.equal(meal.complete, true);
  assert.equal(meal.items.length, 2);
  assert.equal(meal.items[0].kcal, 160);
  assert.equal(meal.items[1].name, "egg");
  const nasi = parseMealText("nasi lemak");
  assert.equal(nasi.complete, true);
  assert.equal(matchFaq("how much protein from food").en.includes("eggs"), true);
  assert.equal(matchFaq("should I buy a fat burner").en.includes("does not recommend"), true);
  assert.equal(matchFaq("hi"), null);
});
