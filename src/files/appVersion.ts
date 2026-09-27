/** The app's version (src-tauri/tauri.conf.json), defined by vite.config.ts. */
declare const __APP_VERSION__: string | undefined;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
