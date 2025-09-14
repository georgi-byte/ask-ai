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
if (!OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is NOT set");
} else {
  console.log("✅ OPENAI_API_KEY is set");
}

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

// === Chat ===
app.post('/api/chat', async (req, res) => {
  const { message, language } = req.body;
  try {
    const memory = await readJSON('memory.json', []);
    const recent = memory.slice(-30);
    const today = new Date();

    const decayed = recent.map(m => {
      const daysAgo = Math.floor((today - new Date(m.timestamp)) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 7) return null;
      if (daysAgo >= 3) {
        return {
          user: `(faded memory from ${daysAgo} days ago) ${m.user}`,
          bot: m.bot
        };
      }
      return m;
    }).filter(Boolean);

    const messages = [
      {
        role: "system",
        content: "You are a caring mental health companion. Remember the user’s past feelings and continue conversations naturally. If a memory is marked as '(faded memory)', treat it as something the user mentioned long ago."
      },
      ...decayed.flatMap(m => [
        { role: "user", content: m.user },
        { role: "assistant", content: m.bot }
      ]),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages,
        max_tokens: 150,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", response.status, errorText);
      return res.status(500).json({ error: "OpenAI API call failed" });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I'm here with you ❤️";

    memory.push({ user: message, bot: reply, timestamp: new Date().toISOString() });
    await writeJSON('memory.json', memory);

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

// === Mood logging (user specific) ===
app.post('/api/mood', async (req, res) => {
  const { mood, language, userId } = req.body;
  try {
    const moods = await readJSON('moods.json', []);
    moods.push({
      userId,
      mood,
      language: language || 'manual',
      timestamp: new Date().toISOString()
    });
    await writeJSON('moods.json', moods);

    const heartbeats = {
      en: ["Keep shining! 🌟", "You're doing great ❤️", "Step by step 🌱"],
      bg: ["Продължавай да сияеш! 🌟", "Справяш се страхотно ❤️", "Стъпка по стъпка 🌱"]
    };
    const pool = heartbeats[language || 'en'] || heartbeats['en'];
    const heartbeat = pool[Math.floor(Math.random() * pool.length)];

    res.json({ success: true, heartbeat });
  } catch (error) {
    console.error('Log mood error:', error);
    res.status(500).json({ success: false });
  }
});

// === Mood list (only this user) ===
app.get('/api/moods', async (req, res) => {
  try {
    const userId = req.query.userId;
    const moods = await readJSON('moods.json', []);
    const userMoods = moods.filter(m => m.userId === userId);
    res.json({ moods: userMoods });
  } catch (error) {
    console.error('View moods error:', error);
    res.status(500).json({ moods: [] });
  }
});

// === Voice mood detection ===
app.post('/api/mood-voice', async (req, res) => {
  const { transcript, userId } = req.body;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are a mood detector. Always reply with ONLY ONE word from this list:
happy, sad, angry, anxious, calm, stressed, grateful, inspired, neutral.`
          },
          { role: 'user', content: transcript }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });

    const data = await response.json();
    let detectedMood = (data.choices?.[0]?.message?.content || "neutral").trim().toLowerCase();
    detectedMood = detectedMood.split(/\s+/)[0];

    const allowed = ["happy","sad","angry","anxious","calm","stressed","grateful","inspired","neutral"];
    if (!allowed.includes(detectedMood)) detectedMood = "neutral";

    const moods = await readJSON('moods.json', []);
    moods.push({
      userId,
      mood: detectedMood,
      language: 'voice',
      transcript,
      timestamp: new Date().toISOString()
    });
    await writeJSON('moods.json', moods);

    res.json({ success: true, mood: detectedMood });
  } catch (error) {
    console.error('Echo Journal error:', error);
    res.status(500).json({ success: false, mood: "error" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
