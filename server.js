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

// Helpers
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

// === AI Chat ===
app.post('/api/chat', async (req, res) => {
  const { message, language } = req.body;
  try {
    const memory = await readJSON('memory.json', []);
    const recent = memory.slice(-30);

    const today = new Date();
    const decayed = recent.map(m => {
      const daysAgo = Math.floor((today - new Date(m.timestamp)) / (1000*60*60*24));
      if (daysAgo >= 7) return null;
      if (daysAgo >= 3) {
        return {
          user: `(faded memory from ${daysAgo} days ago) ${m.user}`,
          bot: m.bot
        };
      }
      return m;
    }).filter(Boolean);

    const languageMap = {
      en: "Respond in English.",
      bg: "Отговаряй на български.",
      de: "Antworte auf Deutsch."
    };

    const languageInstruction = languageMap[language] || languageMap.en;

    const messages = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${languageInstruction} Always format answers clearly using bullet points, numbered steps, or short paragraphs for easy reading.`
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
        max_tokens: 300,
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
