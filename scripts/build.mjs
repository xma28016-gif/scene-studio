import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { authConfig } from '../server/auth.js';

await mkdir('dist/vendor', { recursive: true });
await copyFile('node_modules/heic2any/dist/heic2any.min.js', 'dist/vendor/heic2any.min.js');
await copyFile('node_modules/heic2any/LICENSE.md', 'dist/vendor/heic2any.LICENSE.md');
await copyFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'dist/vendor/supabase.js');
await copyFile('node_modules/@supabase/supabase-js/LICENSE', 'dist/vendor/supabase.LICENSE');
await writeFile('dist/auth-config.js', `export default ${JSON.stringify(authConfig())};\n`);
await copyFile('dist/index.html', 'dist/prototype.html');
console.log('Static assets ready; homepage and prototype URL share the live ocean studio.');
