export declare const WINDOWS_FONT_TELLS: string[];
export declare const OFFICE_FONT_TELLS: string[];
/**
 * Count how many tell-tale fonts are installed, via fc-list.
 *
 * Returns the number present (0..tells.length), or null if it can't be
 * determined (fc-list missing or errored). Callers must NOT treat null as
 * zero — null means "unknown", 0 means "genuinely none installed".
 */
export declare function countFontsPresent(tells: string[]): number | null;
/**
 * True if ALL Windows OS fonts are installed, false if any are missing, null
 * if unknown. Strict: a partial set is treated as incomplete, since the font
 * install is atomic and a missing font degrades the Windows persona.
 */
export declare function windowsFontsPresent(): boolean | null;
/**
 * Warn once when spoofing Windows on a Linux host without the full Windows
 * font set.
 *
 * Best-effort and silent on error — never throws. Gated by an in-process flag
 * plus a cache-dir marker so it fires at most once per environment. Suppress
 * entirely with CLOAKBROWSER_SUPPRESS_FONT_WARNING.
 */
export declare function maybeWarnWindowsFonts(chromeArgs: string[]): void;
//# sourceMappingURL=fonts.d.ts.map