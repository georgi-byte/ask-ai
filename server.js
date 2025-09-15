require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const DB_FILE = 'db.json';

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
  const db = await readJSON(DB_FILE, { users: {}, shop: [], daily: {}, leaderboard: [] });
  if (!db.users[userId]) {
    db.users[userId] = { id: userId, points: 0, level: 1, xp: 0, streak: 0, badges: [], items: [], memoryWindow: 5 };
    await writeJSON(DB_FILE, db);
  }
  return db.users[userId];
}

async function saveUser(user) {
  const db = await readJSON(DB_FILE, { users: {}, shop: [], daily: {}, leaderboard: [] });
  db.users[user.id] = user;
  await writeJSON(DB_FILE, db);
}

async function getShop() {
  const db = await readJSON(DB_FILE, { users: {}, shop: [], daily: {}, leaderboard: [] });
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
    await writeJSON(DB_FILE, db);
  }
  return db.shop;
}

// ------------------- API Endpoints -------------------

app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;
  try {
    const user = await getUser(userId);
    const db = await readJSON(DB_FILE, { users: {}, shop: [], daily: {}, leaderboard: [] });

    // Dummy reply for now (replace with real OpenAI if you want)
    const reply = `You said: "${message}"`;

    // Points + streak
    const now = new Date();
    const lastChatDate = user.lastChat ? new Date(user.lastChat) : null;
    if (lastChatDate) {
      const diffDays = Math.floor((now - lastChatDate) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) user.streak = (user.streak || 0) + 1;
      else if (diffDays > 1) user.streak = 0;
    } else user.streak = 1;
    user.lastChat = now.toISOString();

    let pointsAwarded = 5;
    if (user.streak >= 3) pointsAwarded *= 2;
    if (user.streak >= 7) pointsAwarded *= 5;
    user.points += pointsAwarded;
    user.xp += pointsAwarded;

    while (user.xp >= 100) {
      user.xp -= 100;
      user.level += 1;
    }

    await saveUser(user);

    db.leaderboard = db.leaderboard.filter(l => l.id !== userId);
    db.leaderboard.push({ id: userId, points: user.points, level: user.level });
    db.leaderboard.sort((a, b) => b.points - a.points);
    if (db.leaderboard.length > 10) db.leaderboard = db.leaderboard.slice(0, 10);
    await writeJSON(DB_FILE, db);

    res.json({ reply, pointsAwarded });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

app.get('/api/profile/:userId', async (req, res) => {
  const user = await getUser(req.params.userId);
  res.json({ user });
});

app.get('/api/shop', async (req, res) => {
  const items = await getShop();
  res.json({ items });
});

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

app.get('/api/leaderboard', async (req, res) => {
  const db = await readJSON(DB_FILE, { users: {}, shop: [], daily: {}, leaderboard: [] });
  res.json({ top: db.leaderboard });
});

// ------------------- ADMIN: Add points manually -------------------
app.post('/api/admin/addpoints', async (req, res) => {
  const { userId, amount, secret } = req.body;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const amt = parseInt(amount, 10);
  if (!userId || isNaN(amt)) {
    return res.status(400).json({ ok: false, error: 'Invalid input' });
  }

  const user = await getUser(userId);
  user.points += amt;
  await saveUser(user);

  res.json({ ok: true, points: user.points });
});

// ------------------- Start server -------------------
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
