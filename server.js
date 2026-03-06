const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { RoomManager } = require('./game/roomManager');
const { GameManager } = require('./game/gameManager');
const { WordValidator } = require('./game/wordValidator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

const roomManager = new RoomManager();
const wordValidator = new WordValidator();

// ── REST: expose available categories to the frontend ───────────────
app.get('/api/categories', (req, res) => {
  res.json(wordValidator.getCategoryInfo());
});

// ── Socket.IO events ────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ── HOST a new room ───────────────────────────────────────────────
  socket.on('host-game', ({ hostName, mode, teamName }) => {
    const room = roomManager.createRoom(socket.id, hostName, mode, teamName);
    socket.join(room.code);
    socket.emit('room-created', {
      code: room.code,
      players: room.getPlayerList(),
      mode: room.mode,
      teams: room.getTeams()
    });
  });

  // ── JOIN an existing room ─────────────────────────────────────────
  socket.on('join-game', ({ code, playerName, teamName }) => {
    const room = roomManager.getRoom(code);
    if (!room) return socket.emit('error-msg', 'Room not found.');
    if (room.state !== 'lobby') return socket.emit('error-msg', 'Game already in progress.');

    // In team mode a team name is required
    if (room.mode === 'team' && !teamName) {
      return socket.emit('error-msg', 'Please enter a team name.');
    }

    const added = room.addPlayer(socket.id, playerName, teamName);
    if (!added) return socket.emit('error-msg', 'Name already taken in this room.');

    socket.join(code);
    socket.emit('joined-room', {
      code,
      players: room.getPlayerList(),
      mode: room.mode,
      teams: room.getTeams()
    });
    socket.to(code).emit('player-joined', {
      players: room.getPlayerList(),
      teams: room.getTeams()
    });
  });

  // ── HOST selects categories & starts game ─────────────────────────
  socket.on('start-game', ({ code, categories, rounds }) => {
    const room = roomManager.getRoom(code);
    if (!room) return socket.emit('error-msg', 'Room not found.');
    if (room.hostId !== socket.id) return socket.emit('error-msg', 'Only host can start.');
    if (room.playerCount() < 2) return socket.emit('error-msg', 'Need at least 2 players.');

    room.startGame(categories, rounds || 5);
    const turnInfo = room.getCurrentTurnInfo();

    io.to(code).emit('game-started', {
      categories: room.categories,
      rounds: room.totalRounds,
      currentRound: room.currentRound,
      turn: turnInfo
    });
  });

  // ── Player submits a word ─────────────────────────────────────────
  socket.on('submit-word', ({ code, word, category }) => {
    const room = roomManager.getRoom(code);
    if (!room) return socket.emit('error-msg', 'Room not found.');
    if (room.state !== 'playing') return socket.emit('error-msg', 'Game not in progress.');

    const turn = room.getCurrentTurnInfo();
    if (turn.playerId !== socket.id) {
      return socket.emit('error-msg', 'Not your turn.');
    }

    const trimmed = word.trim().toLowerCase();
    let valid = false;
    let reason = '';

    if (!trimmed) {
      reason = 'Empty word.';
    } else if (room.isWordUsed(trimmed)) {
      reason = `"${word}" was already used!`;
    } else if (!wordValidator.isValid(trimmed, category)) {
      reason = `"${word}" is not a valid ${category}.`;
    } else {
      valid = true;
    }

    const points = valid ? 10 : 0;
    room.recordAnswer(socket.id, trimmed, category, valid, points);

    io.to(code).emit('word-result', {
      player: turn.playerName,
      team: turn.teamName,
      word: trimmed,
      category,
      valid,
      reason,
      points
    });

    // Advance turn
    room.advanceTurn();

    if (room.state === 'finished') {
      const leaderboard = room.buildLeaderboard();
      io.to(code).emit('game-over', { leaderboard, mode: room.mode });

      // Auto-delete room after 60 seconds
      setTimeout(() => {
        roomManager.deleteRoom(code);
        io.to(code).emit('room-closed');
        console.log(`Room ${code} deleted.`);
      }, 60000);
    } else {
      const nextTurn = room.getCurrentTurnInfo();
      io.to(code).emit('next-turn', {
        currentRound: room.currentRound,
        turn: nextTurn
      });
    }
  });

  // ── Skip turn (timeout / pass) ───────────────────────────────────
  socket.on('skip-turn', ({ code }) => {
    const room = roomManager.getRoom(code);
    if (!room) return;
    const turn = room.getCurrentTurnInfo();
    if (turn.playerId !== socket.id) return;

    room.advanceTurn();

    if (room.state === 'finished') {
      const leaderboard = room.buildLeaderboard();
      io.to(code).emit('game-over', { leaderboard, mode: room.mode });
      setTimeout(() => {
        roomManager.deleteRoom(code);
        io.to(code).emit('room-closed');
      }, 60000);
    } else {
      const nextTurn = room.getCurrentTurnInfo();
      io.to(code).emit('next-turn', {
        currentRound: room.currentRound,
        turn: nextTurn
      });
    }
  });

  // ── Chat in lobby / game ──────────────────────────────────────────
  socket.on('chat-message', ({ code, message }) => {
    const room = roomManager.getRoom(code);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    io.to(code).emit('chat-message', {
      sender: player.name,
      message
    });
  });

  // ── Disconnect ────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    const room = roomManager.findRoomByPlayer(socket.id);
    if (!room) return;

    const wasHost = room.hostId === socket.id;
    room.removePlayer(socket.id);

    if (room.playerCount() === 0) {
      roomManager.deleteRoom(room.code);
      console.log(`Room ${room.code} deleted (empty).`);
      return;
    }

    if (wasHost) {
      // Transfer host
      room.transferHost();
      io.to(room.code).emit('host-changed', { newHostId: room.hostId });
    }

    io.to(room.code).emit('player-left', {
      players: room.getPlayerList(),
      teams: room.getTeams()
    });

    // If mid-game and it was their turn, skip
    if (room.state === 'playing') {
      const turn = room.getCurrentTurnInfo();
      if (!turn) {
        room.advanceTurn();
        if (room.state === 'finished') {
          const leaderboard = room.buildLeaderboard();
          io.to(room.code).emit('game-over', { leaderboard, mode: room.mode });
        } else {
          io.to(room.code).emit('next-turn', {
            currentRound: room.currentRound,
            turn: room.getCurrentTurnInfo()
          });
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Word Party Game running on http://localhost:${PORT}`);
});
