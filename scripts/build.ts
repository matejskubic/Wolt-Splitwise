import { context, build, type BuildOptions } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createPublicKey } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const dev = watch || args.has('--dev');

async function readEnvFile(path: string): Promise<Record<string, string>> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    const match = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[1] && !line.trimStart().startsWith('#')) {
      values[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}

// Only non-secret values from .env are baked into dev builds.
async function buildDefaults(): Promise<Record<string, string | number>> {
  if (!dev) return {};
  const env = await readEnvFile(join(root, '.env'));
  const defaults: Record<string, string | number> = {};
  const groupId = Number(env.SplitWiseGroupId);
  if (Number.isInteger(groupId) && groupId > 0) defaults.groupId = groupId;
  return defaults;
}

async function copyStatic(): Promise<void> {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string };
  const manifest = JSON.parse(await readFile(join(root, 'src', 'manifest.json'), 'utf8')) as Record<string, unknown>;
  manifest.version = pkg.version;
  if (dev) manifest.name = `${String(manifest.name)} (dev)`;
  if (dev && !process.env.CI) {
    const keyPath = join(root, 'keys', 'extension-key.pem');
    if (!existsSync(keyPath)) throw new Error('Local dev builds require keys/extension-key.pem. Restore your development key (see DEVELOPMENT.md).');
    manifest.key = createPublicKey(await readFile(keyPath, 'utf8')).export({ type: 'spki', format: 'der' }).toString('base64');
    const now = new Date();
    const revision = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    manifest.version = `${pkg.version.split('.').slice(0, 3).join('.')}.${Number(revision)}`;
    manifest.version_name = `${date} ${revision.slice(0, 2)}:${revision.slice(2)}`;
  }
  await writeFile(join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of ['popup/popup.html', 'options/options.html', 'styles.css']) {
    await cp(join(root, 'src', file), join(outdir, file.split('/').pop()!));
  }
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options: BuildOptions = {
  entryPoints: {
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
    popup: 'src/popup/popup.ts',
    options: 'src/options/options.ts',
  },
  absWorkingDir: root,
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  logLevel: 'info',
  define: { __BUILD_DEFAULTS__: JSON.stringify(await buildDefaults()) },
};

await copyStatic();
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
