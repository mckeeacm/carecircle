# CareCircle Capacitor shell

## Install
npm install

## Generate native projects
npm run cap:add:android
npm run cap:add:ios

## Sync config/plugins into native projects
npm run cap:sync

## Open native projects
npm run cap:open:android
npm run cap:open:ios

## Notes
- This shell currently loads the deployed CareCircle URL from `capacitor.config.ts`.
- Replace the placeholder URL with the real deployed app URL.
- This is suitable for internal app-shell testing now.
- Later, move to bundled web assets for a more release-ready setup.