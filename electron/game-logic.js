// Logica di gioco centralizzata - estratta da server.js

const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function calculateTurnOrder(gameState) {
  const allChars = [
    ...gameState.heroes.filter(h => h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  return allChars.sort((a, b) => {
    const aInit = Number(a.initiative);
    const bInit = Number(b.initiative);
    if (aInit !== bInit) return bInit - aInit;
    const aOrder = a.initiativeOrder != null ? a.initiativeOrder : 999;
    const bOrder = b.initiativeOrder != null ? b.initiativeOrder : 999;
    return aOrder - bOrder;
  });
}

function findInitiativeTies(gameState) {
  const allChars = [
    ...gameState.heroes.filter(h => h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  const groups = {};
  allChars.forEach(char => {
    const key = Math.floor(Number(char.initiative));
    if (!groups[key]) groups[key] = [];
    groups[key].push(char);
  });
  const ties = [];
  Object.keys(groups).forEach(base => {
    const chars = groups[base];
    if (chars.length > 1)
      ties.push({ initiative: parseInt(base), characters: chars });
  });
  return ties;
}

function decrementEffects(gameState) {
  [...gameState.heroes, ...gameState.enemies, ...gameState.allies].forEach(char => {
    char.effects = char.effects.filter(eff => {
      eff.remainingRounds--;
      return eff.remainingRounds > 0;
    });
  });
  
  gameState.areaEffects = gameState.areaEffects.filter(eff => {
    eff.remainingRounds--;
    return eff.remainingRounds > 0;
  });
  
  // Decrementa durata evocazioni e rimuovi quelle scadute
  if (gameState.summons) {
    gameState.summons = gameState.summons.filter(summon => {
      summon.remainingRounds--;
      return summon.remainingRounds > 0;
    });
  }
}

module.exports = {
  generateId,
  calculateTurnOrder,
  findInitiativeTies,
  decrementEffects
};

