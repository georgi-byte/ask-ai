require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');


const app = express();
const port = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());
app.use(express.static('public'));


const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) console.error('❌ OPENAI_API_KEY is NOT set');
else console.log('✅ OPENAI_API_KEY is set');


const DB_FILE = path.join(__dirname, 'db.json');


async function readDB() {
try {
const raw = await fs.readFile(DB_FILE, 'utf8');
return JSON.parse(raw);
} catch (e) {
return { users: {}, leaderboards: [] };
}
}
async function writeDB(db) {
await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}


// Helpers for users
async function ensureUser(userId) {
const db = await readDB();
if (!db.users[userId]) {
db.users[userId] = {
id: userId,
points: 0,
level: 1,
xp: 0,
streak: 0,
lastLogin: null,
inventory: [],
badges: [],
chatHistory: [],
quests: [],
skillTree: { wit: 0, wisdom: 0 },
createdAt: new Date().toISOString()
};
await writeDB(db);
}
return db.users[userId];
}


function awardPoints(user, amount, reason = 'generic') {
user.points += amount;
user.xp += amount; // simple XP = points
// Level up every 500 xp
while (user.xp >= user.level * 500) {
user.xp -= user.level * 500;
user.level += 1;
// level reward: small points and a free shop credit
user.points += 50;
user.badges.push(`Level ${user.level} Reached`);
}
}


function checkAchievements(user) {
const badges = [];
if ((user.chatHistory || []).length >= 50 && !user.badges.includes('Marathon Talker')) badges.push('Marathon Talker');
// Simplified emotion detection: check if user asked for support keywords
const supportCount = (user.chatHistory || []).filter(m => /sad|depress|help|support|anxious/i.test(m.user)).length;
if (supportCount >= 10 && !user.badges.includes('Empathy Expert')) badges.push('Empathy Expert');
badges.forEach(b => { user.badges.push(b); });
}


// Built-in shop items definition
const SHOP = [
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));