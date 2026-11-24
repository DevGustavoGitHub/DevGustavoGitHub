// Gera dist-apk/mercadinho3d-debug.apk: vite build -> cap sync -> gradle assembleDebug.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/android-sdk';
if (!existsSync(sdk)) { console.error(`Android SDK nao encontrado em ${sdk}. Defina ANDROID_HOME.`); process.exit(1); }
// versionCode crescente: CI = GITHUB_RUN_NUMBER (+1000 p/ ficar acima de builds locais antigos); local = minutos desde 2026-01-01.
const code = process.env.APK_VERSION_CODE
  || String(process.env.GITHUB_RUN_NUMBER ? 1_000_000 + Number(process.env.GITHUB_RUN_NUMBER) : Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000));
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const name = process.env.APK_VERSION_NAME || `0.${code}${sha ? '-' + sha : ''}`;
const env = { APK_VERSION_CODE: code, APK_VERSION_NAME: name, ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const run = (cmd, cwd = root) => { console.log(`\n> ${cmd}`); execSync(cmd, { cwd, env, stdio: 'inherit' }); };

writeFileSync(resolve(root, 'android/local.properties'), `sdk.dir=${sdk}\n`);
run('npx vite build');
run('npx cap sync android');
run('./gradlew assembleDebug --no-daemon -q', resolve(root, 'android'));
mkdirSync(resolve(root, 'dist-apk'), { recursive: true });
copyFileSync(resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), resolve(root, 'dist-apk/mercadinho3d-debug.apk'));
console.log('\nAPK pronto: dist-apk/mercadinho3d-debug.apk');
