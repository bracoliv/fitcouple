import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_SCOPE, capWords, isClearlyOffTopic } from "../src/worker/ai.ts";

const ALLOW = [
  "what to eat before an exam",
  "can I exercise during Ramadan",
  "healthy food at a mamak",
  "I have chest pain when I run",
  "I think I binge eat at night",
  "is protein powder useful after training",
  "how much should I sleep",
  "I feel stressed and then I snack",
  "how do I build a habit of walking",
  "what is a reasonable weight goal",
  "how does the streak work in Fit",
  "how to cook a lighter nasi lemak",
  "grocery list for a high protein week",
  "home gym equipment for a small room",
  "how do I stay motivated to train",
  "can I train while fasting",
  "what should I eat before a football match",
  "考试前吃什么",
  "斋月期间可以运动吗",
  "妈嘛档有什么比较健康的吃",
  "跑步时胸口痛怎么办",
  "晚上暴食怎么办",
  "怎么记录今天的饮食",
  "bolehkah saya bersenam semasa Ramadan",
  "makanan sihat di mamak",
  "sakit dada semasa berlari",
  "apa yang patut dimakan sebelum peperiksaan",
  "cara bina tabiat minum air",
];

const BLOCK = [
  "write my essay about the roman empire",
  "write code for a python web scraper",
  "what is the stock price of Apple",
  "generate an image of a castle",
  "role-play as a pirate",
  "帮我写作业",
  "今天的股价怎么样",
  "生成一张图片",
  "tulis esei sejarah saya",
  "harga saham hari ini",
];

test("borderline health questions pass and only clear off-topic requests are blocked", () => {
  assert.ok(ALLOW.length >= 25);
  assert.ok(BLOCK.length >= 8);
  for (const text of ALLOW) assert.equal(isClearlyOffTopic(text), false, text);
  for (const text of BLOCK) assert.equal(isClearlyOffTopic(text), true, text);
  assert.equal(CHAT_SCOPE.includes("Ramadan"), true);
  assert.equal(CHAT_SCOPE.includes("chest pain"), true);
  assert.equal(CHAT_SCOPE.includes("Do not refuse those questions"), true);
  assert.equal(CHAT_SCOPE.includes("supplements or slimming products"), true);
  assert.equal(capWords("one two three four", 2), "one two");
});
