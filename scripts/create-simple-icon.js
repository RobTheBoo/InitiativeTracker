const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function createSimpleIcon() {
  const outputPng = path.join(__dirname, '../public/icon.png');
  const outputIco = path.join(__dirname, '../public/icon.ico');

  try {
    console.log('🔄 Creando icona semplice...');
    
    // Crea un'icona semplice con un simbolo RPG (dado)
    const svg = `
      <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <rect width="512" height="512" fill="#1a1a2e"/>
        <rect x="50" y="50" width="412" height="412" rx="40" fill="#16213e" stroke="#0f3460" stroke-width="8"/>
        <text x="256" y="320" font-family="Arial, sans-serif" font-size="280" font-weight="bold" fill="#e94560" text-anchor="middle">⚔️</text>
      </svg>
    `;

    // Converti SVG in PNG
    await sharp(Buffer.from(svg))
      .resize(512, 512)
      .png()
      .toFile(outputPng);

    console.log('✅ Icona PNG creata!');
    console.log(`   File: ${outputPng}`);
    console.log('\n💡 Ora esegui: npm run generate-icons');
    console.log('   Oppure usa un tool online per convertire icon.png in icon.ico');
    
  } catch (error) {
    console.error('❌ Errore:', error.message);
    process.exit(1);
  }
}

createSimpleIcon();

