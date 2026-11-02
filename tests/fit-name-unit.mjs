import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsModule } from "./load-ts-module.mjs";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const { ZERO_WIDTH_SPACE, fitName, fitPickerName } = await loadTsModule(
    path.join(repoRoot, "lib", "fit-name.ts"),
);
const catalog = JSON.parse(
    await fs.readFile(path.join(repoRoot, "data", "apps.json"), "utf8"),
);
const names = catalog.categories.flatMap((category) =>
    [...category.mainstream_apps, ...category.private_alternatives].map(
        (app) => app.name,
    ),
);
// Matches lib/fit-name.ts, which leaves room for system monospace fonts and
// for Chrome on Linux rounding each glyph to a whole pixel.
const GLYPH_ADVANCE_EM = 0.605;
const GLYPH_ROUNDING_PX = 0.5;
const glyphWidth = (fontSize) =>
    GLYPH_ADVANCE_EM * fontSize + GLYPH_ROUNDING_PX;

test("names whose words fit are left alone", () => {
    assert.deepEqual(fitName("Proton Mail", 140, 18), {
        text: "Proton Mail",
        fontSize: 18,
    });
    // A camelCase word that fits must not gain a break (Apple Home / Kit).
    assert.deepEqual(fitName("Apple HomeKit", 120, 18), {
        text: "Apple HomeKit",
        fontSize: 18,
    });
});

test("overlong words wrap after a slash or between camelCase parts", () => {
    assert.deepEqual(fitName("TranslateLocally", 140, 18), {
        text: `Translate${ZERO_WIDTH_SPACE}Locally`,
        fontSize: 18,
    });
    assert.deepEqual(fitName("Fileverse dDocs/dSheets", 140, 18), {
        text: `Fileverse dDocs/${ZERO_WIDTH_SPACE}dSheets`,
        fontSize: 18,
    });
});

test("a word with no break opportunity is set small enough to fit", () => {
    const { text, fontSize } = fitName("Yubico Authenticator", 140, 18);

    assert.equal(text, "Yubico Authenticator");
    assert.ok(fontSize < 18);
    assert.ok("Authenticator".length * glyphWidth(fontSize) <= 140);
    assert.ok("Authenticator".length * glyphWidth(fontSize + 0.1) > 140);
});

test("every catalog name fits every export column without a mid-word cut", () => {
    // Name widths and font sizes used by components/PrivacyPackResult.tsx.
    const slots = [
        [150, 22],
        [180, 22],
        [134, 16],
        [120, 18],
        [140, 18],
        [104, 13],
        [100, 15],
        [170.5, 15],
        [136.5, 14],
    ];

    for (const [width, size] of slots) {
        for (const name of names) {
            const fitted = fitName(name, width, size);
            assert.equal(fitted.text.replaceAll(ZERO_WIDTH_SPACE, ""), name);
            for (const part of fitted.text.split(/[ ​]/)) {
                assert.ok(
                    part.length * glyphWidth(fitted.fontSize) <= width,
                    `${name} at ${width}px`,
                );
            }
        }
    }
});

// Name widths and font sizes used by components/CategoryPickers.tsx.
const pickerSlots = [
    { width: 72, fontSize: 12 },
    { width: 96, fontSize: 16 },
    { width: 112, fontSize: 16 },
    { width: 160, fontSize: 16 },
];

test("picker names whose words fit are left whole and at full size", () => {
    assert.deepEqual(fitPickerName("Proton Mail", pickerSlots), {
        parts: ["Proton Mail"],
        fontSizes: [12, 16, 16, 16],
    });
    // Ten glyphs fill the smallest slot exactly; a hint could tip them over.
    assert.deepEqual(fitPickerName("DuckDuckGo", pickerSlots).parts, [
        "DuckDuckGo",
    ]);
});

test("overlong picker words wrap after a slash or a dot or between camelCase parts", () => {
    assert.deepEqual(fitPickerName("mailbox.org +1", pickerSlots), {
        parts: ["mailbox.", "org +1"],
        fontSizes: [12, 16, 16, 16],
    });
    assert.deepEqual(fitPickerName("Samsung SmartThings", pickerSlots).parts, [
        "Samsung Smart",
        "Things",
    ]);
    assert.deepEqual(
        fitPickerName("Fileverse dDocs/dSheets", pickerSlots).parts,
        ["Fileverse dDocs/", "dSheets"],
    );
});

test("a picker word with no break opportunity is set smaller only where it cannot fit", () => {
    assert.deepEqual(fitPickerName("Yubico Authenticator", pickerSlots), {
        parts: ["Yubico Authenticator"],
        fontSizes: [9.1, 12.3, 14.1, 16],
    });
    // Ten 16px glyphs fill 96px, so Chrome on Linux, which rounds each glyph
    // to 10px, needs them a little smaller.
    assert.deepEqual(
        fitPickerName("ExpressVPN", pickerSlots).fontSizes,
        [12, 15.8, 16, 16],
    );
});

test("every catalog picker label fits every picker slot without a mid-word cut", () => {
    // Glyph widths with subpixel positioning, and in Chrome on Linux.
    const glyphWidths = [
        (fontSize) => 0.6 * fontSize,
        (fontSize) => Math.round(0.6 * fontSize),
    ];
    const labels = ["[Pick]", ...names.flatMap((name) => [name, `${name} +2`])];

    for (const label of labels) {
        const { parts, fontSizes } = fitPickerName(label, pickerSlots);
        assert.equal(parts.join(""), label);
        // Hints sit after "/" or "." or between camelCase parts only.
        for (let index = 1; index < parts.length; index++) {
            const before = parts.slice(0, index).join("");
            assert.ok(
                /[/.]$/.test(before) ||
                    (/[a-z]{2}$/.test(before) &&
                        /^[A-Z][a-z]/.test(parts[index])),
                `${label} breaks at ${before}|`,
            );
        }
        for (const [index, { width }] of pickerSlots.entries()) {
            for (const glyphWidth of glyphWidths) {
                for (const part of parts.flatMap((part) => part.split(" "))) {
                    assert.ok(
                        part.length * glyphWidth(fontSizes[index]) <= width,
                        `${label} at ${width}px`,
                    );
                }
            }
        }
    }
});
