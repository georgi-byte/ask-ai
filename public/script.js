async function send() {
  const username = document.getElementById('username').value;
  const msg = document.getElementById('msg').value;

  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg })
  });
  const data = await r.json();
  document.getElementById('reply').textContent = data.reply;

  await fetch('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, score: 10 })
  });

  loadBoard();
}

async function loadBoard() {
  const r = await fetch('/api/leaderboard');
  const data = await r.json();
  const list = document.getElementById('board');
  list.innerHTML = data.map(u => `<li>${u.username}: ${u.score}</li>`).join('');
}
loadBoard();
