require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fetch = require('node-fetch');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) console.error("❌ OPENAI_API_KEY is NOT set");
else console.log("✅ OPENAI_API_KEY is set");

// ------------------- Utility functions -------------------

async function readJSON(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ------------------- User / Shop / Points -------------------

async function getUser(userId) {
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  if (!db.users[userId]) {
    db.users[userId] = { id: userId, points: 0, level: 1, xp: 0, streak: 0, badges: [], items: [], memoryWindow: 5 };
    await writeJSON('db.json', db);
  }
  return db.users[userId];
}

async function saveUser(user) {
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  db.users[user.id] = user;
  await writeJSON('db.json', db);
}

async function getShop() {
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  if (db.shop.length === 0) {
    db.shop = [
      { id: "bubble_galactic", name: "Galactic Glow", cost: 50, desc: "Stars pulse during responses" },
      { id: "bubble_retro", name: "Retro Typewriter", cost: 50, desc: "Clacking sound effects" },
      { id: "avatar_pirate", name: "Pirate Hat", cost: 75, desc: "Fun pirate outfit" },
      { id: "avatar_superhero", name: "Superhero Cape", cost: 75, desc: "Fly through chats" },
      { id: "bg_aquarium", name: "Virtual Aquarium", cost: 100, desc: "Interactive background" },
      { id: "memory_booster", name: "Memory Booster", cost: 200, desc: "Longer context in chats" },
      { id: "mini_game_unlock", name: "Mini Game Access", cost: 250, desc: "Play chat-triggered games" },
      { id: "souvenir_pack", name: "Souvenir Pack", cost: 300, desc: "Digital keepsakes" }
    ];
    await writeJSON('db.json', db);
  }
  return db.shop;
}

// ------------------- API Endpoints -------------------

// Chat endpoint with points gain
app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;
  try {
    const user = await getUser(userId);
    const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });

    // Prepare chat messages
    const messages = [
      { role: "system", content: `You are a friendly AI companion. User ID: ${userId}` },
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-4o", messages, max_tokens: 400, temperature: 0.7 })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", response.status, errorText);
      return res.status(500).json({ reply: "OpenAI API call failed" });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I'm here with you ❤️";

    // Points logic
    const now = new Date();
    const lastChatDate = user.lastChat ? new Date(user.lastChat) : null;
    if (lastChatDate) {
      const diffDays = Math.floor((now - lastChatDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) user.streak = (user.streak || 0) + 1;
      else if (diffDays > 1) user.streak = 0;
    } else user.streak = 1;
    user.lastChat = now.toISOString();

    // Base points + streak multiplier
    let pointsAwarded = 5;
    if (user.streak >= 3) pointsAwarded *= 2;
    if (user.streak >= 7) pointsAwarded *= 5;
    user.points += pointsAwarded;
    user.xp += pointsAwarded;

    // Level up every 100 XP
    while (user.xp >= 100) {
      user.xp -= 100;
      user.level += 1;
    }

    // Save user
    await saveUser(user);

    // Update leaderboard
    db.leaderboard = db.leaderboard.filter(l => l.id !== userId);
    db.leaderboard.push({ id: userId, points: user.points, level: user.level });
    db.leaderboard.sort((a, b) => b.points - a.points);
    if (db.leaderboard.length > 10) db.leaderboard = db.leaderboard.slice(0, 10);
    await writeJSON('db.json', db);

    res.json({ reply, pointsAwarded });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

// Profile endpoint
app.get('/api/profile/:userId', async (req, res) => {
  const user = await getUser(req.params.userId);
  res.json({ user });
});

// Shop endpoint
app.get('/api/shop', async (req, res) => {
  const items = await getShop();
  res.json({ items });
});

// Preview shop item
app.post('/api/preview', async (req, res) => {
  const { itemId } = req.body;
  res.json({ demo: `Preview for ${itemId}` });
});

// Purchase shop item
app.post('/api/purchase', async (req, res) => {
  const { userId, itemId } = req.body;
  const user = await getUser(userId);
  const shop = await getShop();
  const item = shop.find(i => i.id === itemId);
  if (!item) return res.json({ error: "Item not found" });
  if (user.points < item.cost) return res.json({ error: "Not enough points" });
  if (!user.items.includes(itemId)) user.items.push(itemId);
  user.points -= item.cost;
  await saveUser(user);
  res.json({ ok: true });
});

// Daily question
app.get('/api/daily/:userId', async (req, res) => {
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  const q = db.daily[req.params.userId] || {
    q: "What's 2 + 2?",
    opts: ["3","4","5"],
    answer: 1,
    reward: 10
  };
  db.daily[req.params.userId] = q;
  await writeJSON('db.json', db);
  res.json({ question: q });
});

app.post('/api/daily/answer', async (req, res) => {
  const { userId, answerIndex } = req.body;
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  const q = db.daily[userId];
  if (!q) return res.json({ correct: false });
  const user = await getUser(userId);
  let correct = false;
  if (answerIndex === q.answer) {
    user.points += q.reward;
    user.xp += q.reward;
    correct = true;
  }
  await saveUser(user);
  res.json({ correct, reward: correct ? q.reward : 0 });
});

// Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  const db = await readJSON('db.json', { users: {}, shop: [], daily: {}, leaderboard: [] });
  res.json({ top: db.leaderboard });
});

// Pity point
app.post('/api/pity', async (req, res) => {
  const { userId } = req.body;
  const user = await getUser(userId);
  user.points += 1;
  await saveUser(user);
  res.json({ ok: true });
});

// ------------------- Start server -------------------

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
