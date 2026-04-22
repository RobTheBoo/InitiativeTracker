const toIco = require('to-ico');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const iconPath = path.join(__dirname, '../public/icon.png');
  const outputIco = path.join(__dirname, '../public/icon.ico');

  if (!fs.existsSync(iconPath)) {
    console.error('❌ icon.png non trovato in public/');
    process.exit(1);
  }

  try {
    console.log('🔄 Generando icona .ico per Windows...');
    
    // Genera multiple dimensioni per l'icona Windows (16, 32, 48, 64, 128, 256)
    const sizes = [16, 32, 48, 64, 128, 256];
    const buffers = await Promise.all(
      sizes.map(size => 
        sharp(iconPath)
          .resize(size, size)
          .png()
          .toBuffer()
      )
    );

    // Converti in ICO
    const icoBuffer = await toIco(buffers);
    
    // Salva il file
    fs.writeFileSync(outputIco, icoBuffer);
    
    console.log('✅ Icona .ico generata con successo!');
    console.log(`   File: ${outputIco}`);
    
  } catch (error) {
    console.error('❌ Errore nella generazione dell\'icona:', error.message);
    console.error('\n💡 Soluzione alternativa:');
    console.error('   1. Usa un tool online come https://convertio.co/png-ico/');
    console.error('   2. Oppure usa ImageMagick: magick convert icon.png -define icon:auto-resize icon.ico');
    process.exit(1);
  }
}

generateIcons();
