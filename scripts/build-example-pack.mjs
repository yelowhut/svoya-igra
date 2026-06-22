import AdmZip from 'adm-zip';
import { readFileSync, writeFileSync } from 'node:fs';
const zip = new AdmZip();
zip.addFile('game.json', readFileSync('packs/example/game.json'));
// медиа в демо нет; при добавлении: zip.addLocalFolder('packs/example/media', 'media')
writeFileSync('packs/example.zip', zip.toBuffer());
console.log('packs/example.zip собран');
