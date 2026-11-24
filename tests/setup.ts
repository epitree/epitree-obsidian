// The plugin uses window.setTimeout and window.setInterval, as Obsidian asks
// plugins to (for pop-out windows). In Node, the timers live on globalThis.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
