/** "⌘" on Apple platforms, "Ctrl+" elsewhere, for shortcut labels. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";
