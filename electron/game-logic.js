// Logica di gioco centralizzata - estratta da server.js

const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Valore effettivo di iniziativa per il sort: initiative (intero) + tiebreaker/10.
// Esempio: init=12, tie=2 -> 12.2 ; init=12, tie=null -> 12.0
function effectiveInitiative(char) {
  const base = Number(char.initiative);
  if (Number.isNaN(base)) return 0;
  const tie = Number(char.initiativeTie);
  if (!Number.isFinite(tie) || tie <= 0) return base;
  return base + (tie / 10);
}

function calculateTurnOrder(gameState) {
  const allChars = [
    ...gameState.heroes.filter(h => h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  return allChars.sort((a, b) => {
    const diff = effectiveInitiative(b) - effectiveInitiative(a);
    if (diff !== 0) return diff;
    // Fallback legacy: initiativeOrder esplicito (compat con vecchi save)
    const aOrder = a.initiativeOrder != null ? a.initiativeOrder : 999;
    const bOrder = b.initiativeOrder != null ? b.initiativeOrder : 999;
    return aOrder - bOrder;
  });
}

// Assegna automaticamente i tiebreakers (.1, .2, .3 ...) ai personaggi che
// condividono la stessa iniziativa intera. Rispetta i tiebreakers gia' assegnati
// dal master (modificati manualmente). Restituisce true se ha modificato qualcosa.
//
// Algoritmo:
//   1. Raggruppa per Math.floor(initiative).
//   2. Se un gruppo ha 1 solo char: tiebreaker = null (non serve).
//   3. Se ha 2+ char:
//      - Mantieni i tiebreakers gia' impostati dal master se compatibili (1..9, unici).
//      - I primi entrati senza tiebreaker prendono il primo slot libero (1, 2, 3, ...).
//      - Cap a 9: oltre il nono lasciamo null e contano come pari (caso limite).
function assignTiebreakers(gameState) {
  const allChars = [
    ...gameState.heroes.filter(h => h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  const groups = new Map();
  for (const c of allChars) {
    const key = Math.floor(Number(c.initiative));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  let changed = false;
  for (const chars of groups.values()) {
    if (chars.length <= 1) {
      // gruppo singolo: nessun tiebreaker necessario
      for (const c of chars) {
        if (c.initiativeTie != null) { c.initiativeTie = null; changed = true; }
      }
      continue;
    }
    const used = new Set();
    // Pass 1: tiene i valori gia' validi (1..9, unici)
    for (const c of chars) {
      const t = Number(c.initiativeTie);
      if (Number.isInteger(t) && t >= 1 && t <= 9 && !used.has(t)) {
        used.add(t);
      } else if (c.initiativeTie != null) {
        c.initiativeTie = null; changed = true;
      }
    }
    // Pass 2: assegna ai char senza tiebreaker il primo slot libero
    let nextSlot = 1;
    for (const c of chars) {
      if (c.initiativeTie != null) continue;
      while (used.has(nextSlot) && nextSlot <= 9) nextSlot++;
      if (nextSlot > 9) break; // edge case oltre 9 char con stessa init
      c.initiativeTie = nextSlot;
      used.add(nextSlot);
      changed = true;
    }
  }
  return changed;
}

// Lascio findInitiativeTies per compat ma ora ritorna sempre [] perche' i ties
// vengono risolti automaticamente da assignTiebreakers. Mantiene contratto API
// senza emettere il modal (chiamanti ricevono nessun tie da risolvere).
function findInitiativeTies(_gameState) {
  return [];
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
  assignTiebreakers,
  effectiveInitiative,
  decrementEffects
};

