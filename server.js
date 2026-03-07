const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {
      case 'create': {
        let code;
        do { code = genCode(); } while (rooms.has(code));
        const room = { code, p1: ws, p2: null, p1Data: msg.playerData, p2Data: null, p1Ready: false, p2Ready: false };
        rooms.set(code, room);
        ws.roomCode = code;
        ws.playerNum = 1;
        ws.send(JSON.stringify({ type: 'created', roomCode: code }));
        console.log(`Room ${code} created`);
        break;
      }

      case 'join': {
        const room = rooms.get(msg.roomCode);
        if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'ROOM NOT FOUND' })); return; }
        if (room.p2) { ws.send(JSON.stringify({ type: 'error', msg: 'ROOM FULL' })); return; }
        room.p2 = ws;
        room.p2Data = msg.playerData;
        ws.roomCode = msg.roomCode;
        ws.playerNum = 2;
        // Tell P2 about P1
        ws.send(JSON.stringify({ type: 'joined', opponentData: room.p1Data, playerNum: 2 }));
        // Tell P1 about P2
        if (room.p1 && room.p1.readyState === 1) {
          room.p1.send(JSON.stringify({ type: 'opponent_joined', opponentData: room.p2Data }));
        }
        console.log(`Room ${msg.roomCode} - opponent joined`);
        break;
      }

      case 'ready': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        if (ws.playerNum === 1) room.p1Ready = true;
        if (ws.playerNum === 2) room.p2Ready = true;
        if (room.p1Ready && room.p2Ready) {
          const startMsg = JSON.stringify({ type: 'start_fight' });
          if (room.p1 && room.p1.readyState === 1) room.p1.send(startMsg);
          if (room.p2 && room.p2.readyState === 1) room.p2.send(startMsg);
          console.log(`Room ${ws.roomCode} - FIGHT!`);
        }
        break;
      }

      case 'input': {
        // P2 sends inputs -> relay to P1 (host)
        const room = rooms.get(ws.roomCode);
        if (!room || ws.playerNum !== 2) return;
        if (room.p1 && room.p1.readyState === 1) {
          room.p1.send(JSON.stringify({ type: 'remote_input', keys: msg.keys }));
        }
        break;
      }

      case 'gs': {
        // P1 sends state -> relay to P2
        const room = rooms.get(ws.roomCode);
        if (!room || ws.playerNum !== 1) return;
        if (room.p2 && room.p2.readyState === 1) {
          room.p2.send(raw.toString());
        }
        break;
      }

      case 'event': {
        // Relay game events (win, special, etc.) to other player
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const other = ws.playerNum === 1 ? room.p2 : room.p1;
        if (other && other.readyState === 1) {
          other.send(raw.toString());
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const [code, room] of rooms) {
      if (room.p1 === ws || room.p2 === ws) {
        const other = room.p1 === ws ? room.p2 : room.p1;
        if (other && other.readyState === 1) {
          other.send(JSON.stringify({ type: 'opponent_left' }));
        }
        rooms.delete(code);
        console.log(`Room ${code} closed`);
        break;
      }
    }
  });
});

// Heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║   BIOLOGICAL AGE DEATH MATCH         ║');
  console.log('  ║   MULTIPLAYER SERVER                  ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║   http://localhost:${PORT}/game.html      ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
