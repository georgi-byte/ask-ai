require('dotenv').config();
// server code.txt
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));


// Replace with your OpenAI API key
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Paste your key here
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

// === Chat with Memory Arcs + Decay ===
app.post('/api/chat', async (req, res) => {
  const { message, language } = req.body;
  try {
    // Load memory
    const memory = await readJSON('memory.json', []);
    const recent = memory.slice(-30); // keep last 30 entries max

    const today = new Date();

    // Apply memory decay
    const decayed = recent.map(m => {
      const daysAgo = Math.floor((today - new Date(m.timestamp)) / (1000 * 60 * 60 * 24));
      if (daysAgo >= 7) return null; // forget after 7+ days
      if (daysAgo >= 3) {
        return {
          user: `(faded memory from ${daysAgo} days ago) ${m.user}`,
          bot: m.bot
        };
      }
      return m; // fresh memory
    }).filter(Boolean);

    // Build chat messages
    const messages = [
      {
        role: "system",
        content: "You are a caring mental health companion. Remember the user’s past feelings and continue conversations naturally. If a memory is marked as '(faded memory)', treat it as something the user mentioned long ago, not fresh."
      },
      ...decayed.flatMap(m => [
        { role: "user", content: m.user },
        { role: "assistant", content: m.bot }
      ]),
      { role: "user", content: message }
    ];

try {
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
  res.json({ reply });

} catch (err) {
  console.error("Server Error:", err);
  res.status(500).json({ error: "Server crashed" });
}


    // Save memory
    memory.push({ user: message, bot: reply, timestamp: new Date().toISOString() });
    await writeJSON('memory.json', memory);

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

// === Log mood (manual) ===
app.post('/api/mood', async (req, res) => {
  const { mood, language } = req.body;
  try {
    const moods = await readJSON('moods.json', []);
    moods.push({
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

// === View moods (used by Mood Garden) ===
app.get('/api/moods', async (req, res) => {
  try {
    const moods = await readJSON('moods.json', []);
    res.json({ moods });
  } catch (error) {
    console.error('View moods error:', error);
    res.status(500).json({ moods: [] });
  }
});

// === Echo Journal (voice -> mood) ===
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
The user may mention multiple feelings (e.g. "I feel happy but also stressed").
👉 Always select the FIRST clear mood word that appears in the sentence.
Reply with ONLY ONE word from this list:
happy, sad, angry, anxious, calm, stressed, grateful, inspired, neutral.
No sentences, no emojis, just one word.`
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

    const allowedMoods = ["happy","sad","angry","anxious","calm","stressed","grateful","inspired","neutral"];
    if (!allowedMoods.includes(detectedMood)) {
      detectedMood = "neutral";
    }

    const moods = await readJSON('moods.json', []);
    moods.push({
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

// === Daily Oracle (1 per day) ===
app.get('/api/oracle', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const oracleData = await readJSON('oracle.json', {});

    if (oracleData.lastDate === today) {
      const playfulReplies = [
        "🔒 The Oracle has spoken for today. Return tomorrow for fresh wisdom 🌞",
        "✨ You’ve already drawn today’s oracle. Rest with its guidance until sunrise 🌙",
        "🌸 The Oracle whispers: patience… come back tomorrow for more inspiration 💫",
        "🕊️ Today’s wisdom is enough. A new blessing awaits you tomorrow 🌅"
      ];
      const reply = playfulReplies[Math.floor(Math.random() * playfulReplies.length)];
      return res.json({ message: reply });
    }

    const prompts = [
      "Give me a poetic, supportive daily oracle under 40 words with an emoji.",
      "Write an uplifting oracle for today in under 40 words with an emoji.",
      "Imagine you are a wise friend. Share a short daily message with an emoji (max 40 words).",
      "Offer a gentle daily oracle full of encouragement (under 40 words, include an emoji)."
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

    const data = await response.json();
    const oracleMsg = data.choices?.[0]?.message?.content.trim() || "✨ Trust yourself today.";

    await writeJSON('oracle.json', { lastDate: today, message: oracleMsg });

    res.json({ message: oracleMsg });
  } catch (error) {
    console.error('Oracle error:', error);
    res.json({ message: "✨ The Oracle is resting, try again later." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
