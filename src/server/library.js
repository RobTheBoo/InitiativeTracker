// Carica e ricarica la libreria Pathfinder 1E (conditions, bonusTypes, spells).

const fs = require('fs');
const path = require('path');

function safeReadJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Errore lettura ${path.basename(filePath)}:`, e.message);
  }
  return fallback;
}

function loadLibrary(libraryDir) {
  return {
    conditions: safeReadJson(path.join(libraryDir, 'conditions.json'), { conditions: [] }).conditions || [],
    bonusTypes: safeReadJson(path.join(libraryDir, 'bonusTypes.json'), { bonusTypes: [] }).bonusTypes || [],
    spells: safeReadJson(path.join(libraryDir, 'spells.json'), { spells: [] }).spells || []
  };
}

module.exports = { loadLibrary };
