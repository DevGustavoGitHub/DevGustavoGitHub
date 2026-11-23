# Mercadinho 3D no Android (APK)

App Capacitor em tela cheia imersiva, travado em paisagem (gira para os dois lados), tela sempre ligada.
O APK é de **depuração, para uso pessoal** — assinado com a chave pública de debug versionada em
`android/app/debug.keystore` (alias/senhas `androiddebugkey`/`android`). Não serve para publicar na Play Store.

## Instalar
1. Baixe `mercadinho3d-debug.apk` na Release **apk-latest** do repositório (aba Releases), pelo celular.
2. Abra o arquivo; se pedir, permita "instalar apps de fontes desconhecidas" para o navegador/gerenciador de arquivos.
3. Toque em Instalar e abra "Mercadinho 3D".

## Atualizar
Baixe o APK novo e instale por cima: a assinatura é sempre a mesma, então o app atualiza e o **save é preservado**.
(Não desinstale antes, senão o save local é apagado.)

## Gerar de novo
- CI: todo push em `main`/`master`/`ccr-75f39498-7x28f4` (ou "Run workflow") roda `.github/workflows/android.yml` e atualiza a Release.
- Local (Node 22, JDK 21, Android SDK com `platforms;android-35` e `build-tools;35.0.0`):
  `ANDROID_HOME=/caminho/do/sdk npm run apk` → `dist-apk/mercadinho3d-debug.apk`.
