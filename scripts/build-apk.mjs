// Gera dist-apk/mercadinho3d-debug.apk: vite build -> cap sync -> gradle assembleDebug.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '/opt/android-sdk';
if (!existsSync(sdk)) { console.error(`Android SDK nao encontrado em ${sdk}. Defina ANDROID_HOME.`); process.exit(1); }
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };
const run = (cmd, cwd = root) => { console.log(`\n> ${cmd}`); execSync(cmd, { cwd, env, stdio: 'inherit' }); };

writeFileSync(resolve(root, 'android/local.properties'), `sdk.dir=${sdk}\n`);
run('npx vite build');
run('npx cap sync android');
run('./gradlew assembleDebug --no-daemon -q', resolve(root, 'android'));
mkdirSync(resolve(root, 'dist-apk'), { recursive: true });
copyFileSync(resolve(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), resolve(root, 'dist-apk/mercadinho3d-debug.apk'));
console.log('\nAPK pronto: dist-apk/mercadinho3d-debug.apk');
