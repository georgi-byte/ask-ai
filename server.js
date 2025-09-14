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

// === General Chat ===
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  try {
    const history = await readJSON('memory.json', []);
    const recent = history.slice(-10);

    const messages = [
      {
        role: "system",
        content: "You are a helpful and knowledgeable AI assistant. Answer questions clearly and helpfully on any topic the user asks about."
      },
      ...recent.flatMap(m => [
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
    const reply = data.choices?.[0]?.message?.content || "I'm here to help!";

    history.push({ user: message, bot: reply, timestamp: new Date().toISOString() });
    await writeJSON('memory.json', history);

    res.json({ reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ reply: "Error connecting to AI." });
  }
});

// === Voice to AI ===
app.post('/api/voice', async (req, res) => {
  const { transcript } = req.body;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful AI assistant." },
          { role: "user", content: transcript }
        ],
        max_tokens: 250
      })
    });
    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "I’m here to help.";
    res.json({ reply });
  } catch (error) {
    console.error("Voice error:", error);
    res.status(500).json({ reply: "Error" });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
