// Text fitting for names set in JetBrains Mono: on the exported card and
// under the create page's picker logos.
// Kept free of imports so it can be unit tested without a build.

// JetBrains Mono advances every glyph by 0.6em. The system monospace fonts
// used when it cannot load are within 1% of that (Menlo and DejaVu Sans Mono
// 0.602em), so plan with a little slack.
const GLYPH_ADVANCE_EM = 0.605;
// Chrome on Linux rounds each glyph's advance to a whole pixel, so a glyph
// can be up to half a pixel wider than its em width.
const GLYPH_ROUNDING_PX = 0.5;
const glyphWidth = (fontSize: number) =>
    GLYPH_ADVANCE_EM * fontSize + GLYPH_ROUNDING_PX;
export const ZERO_WIDTH_SPACE = "\u200B";

const isLowercase = (character?: string) =>
    character !== undefined && character >= "a" && character <= "z";
const isUppercase = (character?: string) =>
    character !== undefined && character >= "A" && character <= "Z";

/**
 * Offers line breaks after "/" and between camelCase parts (TranslateLocally),
 * and with `afterDots` after "." too (mailbox.org).
 */
function addBreakOpportunities(word: string, afterDots = false) {
    let result = word[0] ?? "";
    for (let index = 1; index < word.length; index++) {
        const afterSeparator =
            word[index - 1] === "/" || (afterDots && word[index - 1] === ".");
        const camelCase =
            isLowercase(word[index - 2]) &&
            isLowercase(word[index - 1]) &&
            isUppercase(word[index]) &&
            isLowercase(word[index + 1]);
        result +=
            (afterSeparator || camelCase ? ZERO_WIDTH_SPACE : "") + word[index];
    }
    return result;
}

const longestPartLength = (words: string[]) =>
    Math.max(
        ...words.flatMap((word) =>
            word.split(ZERO_WIDTH_SPACE).map((part) => part.length),
        ),
    );

/**
 * Fits a name to its column without cutting a word in half: overlong words
 * may wrap at "/" or a camelCase boundary, and any part still too wide for
 * one line is set just small enough to fit.
 */
export function fitName(name: string, width: number, fontSize: number) {
    const maxCharacters = Math.floor(width / glyphWidth(fontSize));
    const words = name
        .split(" ")
        .map((word) =>
            word.length > maxCharacters ? addBreakOpportunities(word) : word,
        );
    const longestPart = longestPartLength(words);

    return {
        text: words.join(" "),
        fontSize:
            longestPart > maxCharacters
                ? Math.floor(
                      ((width / longestPart - GLYPH_ROUNDING_PX) /
                          GLYPH_ADVANCE_EM) *
                          10,
                  ) / 10
                : fontSize,
    };
}

// The page sets picker names in the web font, so plan with its exact 0.6em.
// Chrome on Linux rounds that to a whole pixel: 7px at 12px, but 10px at
// 16px. If a fallback font is wider, break-words still keeps names inside.
const pickerGlyphWidth = (fontSize: number) =>
    Math.max(0.6 * fontSize, Math.round(0.6 * fontSize));

/** A picker name's width and font size at one breakpoint, in px. */
export type PickerNameSlot = { width: number; fontSize: number };

/**
 * Fits a picker name to its slot at every breakpoint, smallest first, without
 * cutting a word in half. The text is the same in each slot, so a word too
 * long for the smallest may wrap after "/" or "." or at a camelCase boundary.
 * A part still too wide for a slot, such as a long word with no break
 * opportunity, is set just small enough to fit in that slot.
 * Returns the name's parts between those break opportunities and the font
 * size for each slot.
 */
export function fitPickerName(name: string, slots: PickerNameSlot[]) {
    const fits = (characters: number, { width, fontSize }: PickerNameSlot) =>
        characters * pickerGlyphWidth(fontSize) <= width;
    // A word that fits stays whole: a hint splits it into runs of text whose
    // rounded widths can tip an exact fit (ten 7.2px glyphs in 72px) over.
    const words = name
        .split(" ")
        .map((word) =>
            fits(word.length, slots[0])
                ? word
                : addBreakOpportunities(word, true),
        );
    const longestPart = longestPartLength(words);

    return {
        parts: words.join(" ").split(ZERO_WIDTH_SPACE),
        fontSizes: slots.map((slot) => {
            let fontSize = slot.fontSize;
            while (!fits(longestPart, { ...slot, fontSize })) {
                fontSize = Math.round(fontSize * 10 - 1) / 10;
            }
            return fontSize;
        }),
    };
}
