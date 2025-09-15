app.post('/api/chat', async (req, res) => {
  const { message, language, city, timezone } = req.body;
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

    const currentDate = new Date().toLocaleString("en-US", { timeZone: timezone || "UTC" });

    let webResults = "";
    if (/\b(who|what|when|where|why|how|latest|news|time|date)\b/i.test(message)) {
      webResults = await webSearch(message);
    }

    const languageMap = {
      en: "Respond in English.",
      bg: "Отговаряй на български.",
      de: "Antworte auf Deutsch."
    };

    const messages = [
      {
        role: "system",
        content: `You are a helpful and up-to-date AI assistant.
User is in ${city || "an unknown location"} (timezone: ${timezone || "UTC"}).
Local date/time: ${currentDate}.
Here are recent search results (if any):\n${webResults}
${languageMap[language] || languageMap.en}`
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
        model: "gpt-4o",
        messages,
        max_tokens: 400,
        temperature: 0.7
      })
    });

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
