/** Rodando dentro do app desktop (Electron), que não tem landing page. */
export const IS_DESKTOP = /\bElectron\//.test(navigator.userAgent);
