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

// === Helper functions ===
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

// === Chat with memory + decay ===
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const memory = await readJSON('memory.json', []);
    const recent = memory.slice(-30);

    const today = new Date();
    const decayed = recent.map(m => {
      const daysAgo = Math.floor((today - new Date(m.timestamp)) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 7) return null;
      if (daysAgo >= 3) {
        return { user: `(faded memory from ${daysAgo} days ago) ${m.user}`, bot: m.bot };
      }
      return m;
    }).filter(Boolean);

    const messages = [
      {
        role: "system",
        content: "You are a caring mental health companion. Remember the user’s past feelings and continue conversations naturally."
      },
      ...decayed.flatMap(m => [
        { role: "user", content: m.user },
        { role: "assistant", content: m.bot }
      ]),
      { role: "user", content: message }
    ];

    let reply = "I'm here with you ❤️";

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
    reply = data.choices?.[0]?.message?.content || reply;

    memory.push({ user: message, bot: reply, timestamp: new Date().toISOString() });
    await writeJSON('memory.json', memory);

    return res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ reply: "Error connecting to AI." });
  }
});

// === Log mood ===
app.post('/api/mood', async (req, res) => {
  const { mood, language } = req.body;
  try {
    const moods = await readJSON('moods.json', []);
    moods.push({ mood, language: language || 'manual', timestamp: new Date().toISOString() });
    await writeJSON('moods.json', moods);

    const heartbeats = {
      en: ["Keep shining! 🌟", "You're doing great ❤️", "Step by step 🌱"],
      bg: ["Продължавай да сияеш! 🌟", "Справяш се страхотно ❤️", "Стъпка по стъпка 🌱"]
    };
    const pool = heartbeats[language || 'en'] || heartbeats['en'];
    const heartbeat = pool[Math.floor(Math.random() * pool.length)];

    return res.json({ success: true, heartbeat });
  } catch (error) {
    console.error('Log mood error:', error);
    return res.status(500).json({ success: false });
  }
});

// === View moods ===
app.get('/api/moods', async (req, res) => {
  try {
    const moods = await readJSON('moods.json', []);
    return res.json({ moods });
  } catch (error) {
    console.error('View moods error:', error);
    return res.status(500).json({ moods: [] });
  }
});

// === Echo Journal ===
app.post('/api/mood-voice', async (req, res) => {
  const { transcript } = req.body;
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
            content: `You are a mood detector.
Always select the FIRST clear mood word from this list:
happy, sad, angry, anxious, calm, stressed, grateful, inspired, neutral.`
          },
          { role: 'user', content: transcript }
        ],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Echo Journal OpenAI Error:", errText);
      return res.status(500).json({ success: false, mood: "error" });
    }

    const data = await response.json();
    let detectedMood = (data.choices?.[0]?.message?.content || "neutral").trim().toLowerCase().split(/\s+/)[0];
    const allowed = ["happy","sad","angry","anxious","calm","stressed","grateful","inspired","neutral"];
    if (!allowed.includes(detectedMood)) detectedMood = "neutral";

    const moods = await readJSON('moods.json', []);
    moods.push({ mood: detectedMood, language: 'voice', transcript, timestamp: new Date().toISOString() });
    await writeJSON('moods.json', moods);

    return res.json({ success: true, mood: detectedMood });
  } catch (error) {
    console.error('Echo Journal error:', error);
    return res.status(500).json({ success: false, mood: "error" });
  }
});

// === Daily Oracle ===
app.get('/api/oracle', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const oracleData = await readJSON('oracle.json', {});

    if (oracleData.lastDate === today) {
      const replies = [
        "🔒 The Oracle has spoken for today. Return tomorrow 🌞",
        "✨ You’ve already drawn today’s oracle. Come back tomorrow 🌙",
        "🌸 The Oracle whispers: patience… come back tomorrow 💫",
        "🕊️ Today’s wisdom is enough. A new blessing awaits you tomorrow 🌅"
      ];
      return res.json({ message: replies[Math.floor(Math.random()*replies.length)] });
    }

    const prompts = [
      "Give me a poetic, supportive daily oracle under 40 words with an emoji.",
      "Write an uplifting oracle for today in under 40 words with an emoji."
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60,
        temperature: 1.0
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Oracle OpenAI Error:", errText);
      return res.json({ message: "✨ The Oracle is resting, try again later." });
    }

    const data = await response.json();
    const oracleMsg = data.choices?.[0]?.message?.content.trim() || "✨ Trust yourself today.";

    await writeJSON('oracle.json', { lastDate: today, message: oracleMsg });

    return res.json({ message: oracleMsg });
  } catch (error) {
    console.error('Oracle error:', error);
    return res.json({ message: "✨ The Oracle is resting, try again later." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
