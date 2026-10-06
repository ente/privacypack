// Text fitting for the exported card, whose names are set in JetBrains Mono.
// Kept free of imports so it can be unit tested without a build.

// JetBrains Mono advances every glyph by 0.6em. The system monospace fonts
// used when it cannot load are within 1% of that (Menlo and DejaVu Sans Mono
// 0.602em), so plan with a little slack.
const GLYPH_ADVANCE_EM = 0.605;
export const ZERO_WIDTH_SPACE = "\u200B";

const isLowercase = (character?: string) =>
    character !== undefined && character >= "a" && character <= "z";
const isUppercase = (character?: string) =>
    character !== undefined && character >= "A" && character <= "Z";

/** Offers line breaks after "/" and between camelCase parts (TranslateLocally). */
function addBreakOpportunities(word: string) {
    let result = word[0] ?? "";
    for (let index = 1; index < word.length; index++) {
        const afterSlash = word[index - 1] === "/";
        const camelCase =
            isLowercase(word[index - 2]) &&
            isLowercase(word[index - 1]) &&
            isUppercase(word[index]) &&
            isLowercase(word[index + 1]);
        result +=
            (afterSlash || camelCase ? ZERO_WIDTH_SPACE : "") + word[index];
    }
    return result;
}

/**
 * Fits a name to its column without cutting a word in half: overlong words
 * may wrap at "/" or a camelCase boundary, and any part still too wide for
 * one line is set just small enough to fit.
 */
export function fitName(name: string, width: number, fontSize: number) {
    const maxCharacters = Math.floor(width / (GLYPH_ADVANCE_EM * fontSize));
    const words = name
        .split(" ")
        .map((word) =>
            word.length > maxCharacters ? addBreakOpportunities(word) : word,
        );
    const longestPart = Math.max(
        ...words.flatMap((word) =>
            word.split(ZERO_WIDTH_SPACE).map((part) => part.length),
        ),
    );

    return {
        text: words.join(" "),
        fontSize:
            longestPart > maxCharacters
                ? Math.floor((width / (GLYPH_ADVANCE_EM * longestPart)) * 10) /
                  10
                : fontSize,
    };
}
