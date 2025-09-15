// server.js
// Express server with /api/chat (calls OpenAI if API key present) and
// simple leaderboard endpoints using db.json to store top scores.

require('dotenv').config();
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- simple DB helpers ----------
async function readDB() {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { leaderboard: [] };
  }
}
async function writeDB(data) {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- /api/chat ----------
// Calls OpenAI if OPENAI_API_KEY is set, otherwise returns an echo mock.
app.post('/api/chat', async (req, res) => {
  const message = (req.body && req.body.message) || '';
  const language = (req.body && req.body.language) || 'en';
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // If no API key, return a safe mock reply to keep the UI functional.
  if (!OPENAI_API_KEY) {
    return res.json({ reply: `AI (mock): I heard: "${message}"` });
  }

  try {
    // Use the Chat Completions endpoint
    const payload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: `You are a friendly, concise AI companion. Language: ${language}` },
        { role: "user", content: message }
      ],
      max_tokens: 400,
      temperature: 0.7
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error("OpenAI error:", response.status, txt);
      return res.status(500).json({ reply: "AI error (upstream)." });
    }
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I'm here with you ❤️";
    return res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    return res.status(500).json({ reply: "AI internal error." });
  }
});

// ---------- Leaderboard endpoints ----------
// Save a score: expects { username: string, score: number }
app.post('/api/score', async (req, res) => {
  try {
    const { username, score } = req.body;
    if (!username || typeof score !== 'number') {
      return res.status(400).json({ error: "username and numeric score required" });
    }

    const db = await readDB();
    // Add or update user entry (keep highest score)
    const existing = db.leaderboard.find(e => e.username === username);
    if (existing) {
      if (score > existing.score) existing.score = score;
    } else {
      db.leaderboard.push({ username, score, date: new Date().toISOString() });
    }

    // Sort desc and keep top 10
    db.leaderboard.sort((a, b) => b.score - a.score || new Date(a.date) - new Date(b.date));
    db.leaderboard = db.leaderboard.slice(0, 10);
    await writeDB(db);
    return res.json({ ok: true, top: db.leaderboard });
  } catch (err) {
    console.error("Save score error:", err);
    return res.status(500).json({ error: "save failed" });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const db = await readDB();
    return res.json({ top: db.leaderboard || [] });
  } catch (err) {
    console.error("Get leaderboard error:", err);
    return res.status(500).json({ error: "read failed" });
  }
});

// Health check
app.get('/ping', (req, res) => res.send('pong'));

// Serve index.html from /public automatically via express.static

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
