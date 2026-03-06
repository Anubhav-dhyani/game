/**
 * Room Manager – creates, stores, and deletes rooms (in-memory).
 */

class Room {
  /**
   * @param {string} code
   * @param {string} hostId
   * @param {string} hostName
   * @param {'solo'|'team'} mode
   * @param {Array<{name:string, maxPlayers:number}>} [teamConfig] – team definitions (team mode only)
   * @param {string} [hostTeam] – which team the host joins (team mode only)
   */
  constructor(code, hostId, hostName, mode, teamConfig, hostTeam) {
    this.code = code;
    this.hostId = hostId;
    this.mode = mode;               // 'solo' | 'team'
    this.state = 'lobby';           // 'lobby' | 'playing' | 'finished'
    this.players = new Map();       // socketId → { name, team, score, answers[] }
    this.turnOrder = [];            // ordered socketIds
    this.currentTurnIndex = 0;
    this.currentRound = 1;
    this.totalRounds = 5;
    this.categories = [];
    this.currentCategoryIndex = 0;
    this.usedWords = new Set();

    // Team config: Map teamName → { maxPlayers, members: Set<socketId> }
    this.teamConfig = new Map();
    if (mode === 'team' && Array.isArray(teamConfig)) {
      teamConfig.forEach(t => {
        this.teamConfig.set(t.name, { maxPlayers: t.maxPlayers, members: new Set() });
      });
    }

    // Add the host as the first player
    this.addPlayer(hostId, hostName, hostTeam);
  }

  addPlayer(socketId, name, teamName) {
    // Check for duplicate name
    for (const [, p] of this.players) {
      if (p.name.toLowerCase() === name.toLowerCase()) return false;
    }

    // Team mode: validate the team exists and has room
    if (this.mode === 'team') {
      if (!teamName || !this.teamConfig.has(teamName)) return false;
      const team = this.teamConfig.get(teamName);
      if (team.members.size >= team.maxPlayers) return false;
      team.members.add(socketId);
    }

    this.players.set(socketId, {
      name,
      team: this.mode === 'team' ? teamName : null,
      score: 0,
      answers: []
    });
    return true;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player && player.team && this.teamConfig.has(player.team)) {
      this.teamConfig.get(player.team).members.delete(socketId);
    }
    this.players.delete(socketId);
    this.turnOrder = this.turnOrder.filter(id => id !== socketId);
    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
    }
  }

  transferHost() {
    const ids = [...this.players.keys()];
    if (ids.length > 0) this.hostId = ids[0];
  }

  playerCount() {
    return this.players.size;
  }

  getPlayerList() {
    const list = [];
    for (const [id, p] of this.players) {
      list.push({ id, name: p.name, team: p.team, score: p.score, isHost: id === this.hostId });
    }
    return list;
  }

  getTeams() {
    if (this.mode !== 'team') return null;
    const teams = {};
    for (const [teamName, cfg] of this.teamConfig) {
      const members = [];
      for (const [, p] of this.players) {
        if (p.team === teamName) members.push(p.name);
      }
      teams[teamName] = { members, maxPlayers: cfg.maxPlayers, count: members.length };
    }
    return teams;
  }

  /** Returns teams that still have open slots */
  getAvailableTeams() {
    if (this.mode !== 'team') return null;
    const available = [];
    for (const [teamName, cfg] of this.teamConfig) {
      if (cfg.members.size < cfg.maxPlayers) {
        available.push({
          name: teamName,
          maxPlayers: cfg.maxPlayers,
          currentCount: cfg.members.size
        });
      }
    }
    return available;
  }

  startGame(categories, rounds) {
    this.categories = categories;
    this.totalRounds = rounds;
    this.currentRound = 1;
    this.currentTurnIndex = 0;
    this.currentCategoryIndex = 0;
    this.state = 'playing';
    this.usedWords.clear();

    // Shuffle turn order
    this.turnOrder = [...this.players.keys()];
    for (let i = this.turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.turnOrder[i], this.turnOrder[j]] = [this.turnOrder[j], this.turnOrder[i]];
    }
  }

  getCurrentTurnInfo() {
    if (this.turnOrder.length === 0) return null;
    const id = this.turnOrder[this.currentTurnIndex];
    const player = this.players.get(id);
    if (!player) return null;
    const category = this.categories[this.currentCategoryIndex % this.categories.length];
    return {
      playerId: id,
      playerName: player.name,
      teamName: player.team,
      category,
      round: this.currentRound
    };
  }

  isWordUsed(word) {
    return this.usedWords.has(word.toLowerCase());
  }

  recordAnswer(socketId, word, category, valid, points) {
    const player = this.players.get(socketId);
    if (!player) return;
    if (valid) {
      player.score += points;
      this.usedWords.add(word.toLowerCase());
    }
    player.answers.push({ word, category, valid, points });
  }

  advanceTurn() {
    this.currentTurnIndex++;
    // Also advance category for variety
    this.currentCategoryIndex++;

    if (this.currentTurnIndex >= this.turnOrder.length) {
      this.currentTurnIndex = 0;
      this.currentRound++;
      if (this.currentRound > this.totalRounds) {
        this.state = 'finished';
      }
    }
  }

  buildLeaderboard() {
    if (this.mode === 'team') {
      // Aggregate by team
      const teamScores = {};
      for (const [, p] of this.players) {
        const t = p.team || 'No Team';
        if (!teamScores[t]) teamScores[t] = { name: t, score: 0, members: [] };
        teamScores[t].score += p.score;
        teamScores[t].members.push({ name: p.name, score: p.score });
      }
      return Object.values(teamScores)
        .sort((a, b) => b.score - a.score)
        .map((t, i) => ({ rank: i + 1, ...t }));
    } else {
      // Individual
      return [...this.players.values()]
        .sort((a, b) => b.score - a.score)
        .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, answers: p.answers }));
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map(); // code → Room
  }

  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostId, hostName, mode, teamConfig, hostTeam) {
    const code = this._generateCode();
    const room = new Room(code, hostId, hostName, mode || 'solo', teamConfig, hostTeam);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code) {
    return this.rooms.get(code?.toUpperCase()) || null;
  }

  findRoomByPlayer(socketId) {
    for (const [, room] of this.rooms) {
      if (room.players.has(socketId)) return room;
    }
    return null;
  }

  deleteRoom(code) {
    this.rooms.delete(code);
  }
}

module.exports = { Room, RoomManager };
