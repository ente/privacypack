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
const { ZERO_WIDTH_SPACE, fitName } = await loadTsModule(
    path.join(repoRoot, "lib", "fit-name.ts"),
);
const catalog = JSON.parse(
    await fs.readFile(path.join(repoRoot, "data", "apps.json"), "utf8"),
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
    const names = catalog.categories.flatMap((category) =>
        [...category.mainstream_apps, ...category.private_alternatives].map(
            (app) => app.name,
        ),
    );
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
