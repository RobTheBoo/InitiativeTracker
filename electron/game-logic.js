// Logica di gioco centralizzata - estratta da server.js

const crypto = require('crypto');

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// Valore "intero" base di iniziativa, usato per il primo livello di sort.
// Il tiebreaker e' un secondo livello separato (vedi calculateTurnOrder).
function baseInitiative(char) {
  const base = Number(char.initiative);
  if (Number.isNaN(base)) return 0;
  return Math.floor(base);
}

// Valore effettivo continuo: usato solo per UI/etichette (es. "12.2"), NON per sort.
// Convenzione UX: tie 1 = primo a giocare nel gruppo, tie 9 = ultimo.
// Math: base - tie/10 (cosi' 12.1 > 12.2 > 12.9 in valore numerico).
function effectiveInitiative(char) {
  const base = baseInitiative(char);
  const tie = Number(char.initiativeTie);
  if (!Number.isFinite(tie) || tie <= 0) return base;
  return base - (tie / 10);
}

function calculateTurnOrder(gameState) {
  const allChars = [
    ...gameState.heroes.filter(h => h.initiative !== null),
    ...gameState.enemies.filter(e => e.initiative !== null),
    ...gameState.allies.filter(a => a.initiative !== null),
    ...(gameState.summons || []).filter(s => s.initiative !== null)
  ];
  return allChars.sort((a, b) => {
    // Primario: integer iniziativa decrescente (15 prima di 12).
    const baseDiff = baseInitiative(b) - baseInitiative(a);
    if (baseDiff !== 0) return baseDiff;
    // Secondario: tiebreaker crescente, .1 PRIMA di .2 PRIMA di .9.
    // Null/0 = "non assegnato" -> in coda al gruppo (peso 99).
    const aTie = (Number.isInteger(a.initiativeTie) && a.initiativeTie > 0) ? a.initiativeTie : 99;
    const bTie = (Number.isInteger(b.initiativeTie) && b.initiativeTie > 0) ? b.initiativeTie : 99;
    if (aTie !== bTie) return aTie - bTie;
    // Fallback legacy: initiativeOrder esplicito (compat con vecchi save)
    const aOrder = a.initiativeOrder != null ? a.initiativeOrder : 999;
    const bOrder = b.initiativeOrder != null ? b.initiativeOrder : 999;
    return aOrder - bOrder;
  });
}

// Riassegna i tiebreakers di UN solo gruppo intero in base all'ordine fornito.
// Usato dall'evento DnD del master: orderedIds = ordine visivo top-to-bottom.
// Ritorna il numero di char modificati.
function reorderTieGroup(gameState, integerInitiative, orderedIds) {
  const target = Math.floor(Number(integerInitiative));
  if (!Number.isFinite(target)) return 0;
  const allChars = [
    ...gameState.heroes,
    ...gameState.enemies,
    ...gameState.allies,
    ...(gameState.summons || [])
  ];
  // Indice rapido: id -> char (solo char con base == target)
  const groupMap = new Map();
  for (const c of allChars) {
    if (c.initiative === null || c.initiative === undefined) continue;
    if (Math.floor(Number(c.initiative)) === target) groupMap.set(c.id, c);
  }
  let changed = 0;
  let slot = 1;
  for (const id of orderedIds) {
    const c = groupMap.get(id);
    if (!c) continue;
    if (slot > 9) break;
    if (c.initiativeTie !== slot) {
      c.initiativeTie = slot;
      changed++;
    }
    groupMap.delete(id);
    slot++;
  }
  // Eventuali char del gruppo non citati nel nuovo ordine: mettili in coda.
  for (const c of groupMap.values()) {
    if (slot > 9) break;
    if (c.initiativeTie !== slot) {
      c.initiativeTie = slot;
      changed++;
    }
    slot++;
  }
  return changed;
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
  reorderTieGroup,
  effectiveInitiative,
  baseInitiative,
  decrementEffects
};

