/**
 * scripts/deploy-gh-pages.ts
 * Script de Publicação Automática do PWA no GitHub Pages
 * Executa o build da aplicação e envia a pasta dist/ para a branch gh-pages.
 */

import { existsSync, writeFileSync, copyFileSync, rmSync } from 'fs';
import { resolve } from 'path';

const distDir = resolve(process.cwd(), 'dist');

if (!existsSync(distDir)) {
  console.error('Diretório dist/ não encontrado. Execute o build primeiro.');
  process.exit(1);
}

// Cria arquivos necessários para o GitHub Pages
writeFileSync(resolve(distDir, '.nojekyll'), '');
copyFileSync(resolve(distDir, 'index.html'), resolve(distDir, '404.html'));

console.log('Arquivos .nojekyll e 404.html configurados em dist/.');

const run = (cmd: string[], cwd = distDir) => {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (proc.exitCode !== 0) {
    throw new Error(`Falha ao executar: ${cmd.join(' ')}`);
  }
};

let token = process.env.GITHUB_TOKEN || '';
if (!token) {
  try {
    const res = Bun.spawnSync(['gh', 'auth', 'token']);
    if (res.exitCode === 0) {
      token = res.stdout.toString().trim();
    }
  } catch {}
}

const remoteUrl = token
  ? `https://${token}@github.com/wallacextreme/catalogo-universal-tucano.git`
  : 'https://github.com/wallacextreme/catalogo-universal-tucano.git';

const gitInDist = resolve(distDir, '.git');
if (existsSync(gitInDist)) {
  rmSync(gitInDist, { recursive: true, force: true });
}

try {
  run(['git', 'init']);
  run(['git', 'checkout', '-B', 'gh-pages']);
  run(['git', 'add', '-A']);
  run(['git', 'commit', '-m', `deploy: PWA release ${new Date().toISOString()}`]);
  run(['git', 'remote', 'add', 'origin', remoteUrl]);
} catch (e) {
  console.warn('Configuração git no dist:', e);
}

try {
  console.log('Enviando branch gh-pages para o GitHub...');
  run(['git', 'push', '-f', 'origin', 'gh-pages']);
  console.log('Publicação no GitHub Pages realizada com sucesso!');
} finally {
  if (existsSync(gitInDist)) {
    rmSync(gitInDist, { recursive: true, force: true });
  }
}
