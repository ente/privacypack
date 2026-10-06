import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const validJpeg = fs.readFileSync(
    path.join(repoRoot, "public/app-logos/gmail.jpg"),
);

function createFixture(t) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "privacypack-catalog-test-"),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, "data"));
    fs.mkdirSync(path.join(root, "public/app-logos"), { recursive: true });
    fs.copyFileSync(
        path.join(repoRoot, "scripts/validate-catalog.mjs"),
        path.join(root, "scripts/validate-catalog.mjs"),
    );
    fs.symlinkSync(
        path.join(repoRoot, "node_modules"),
        path.join(root, "node_modules"),
        "dir",
    );
    fs.writeFileSync(
        path.join(root, "data/apps.json"),
        JSON.stringify({
            categories: [
                {
                    name: "Fixture",
                    order: 1,
                    mainstream_apps: [{ id: "mainstream", name: "Mainstream" }],
                    private_alternatives: [
                        { id: "alternative", name: "Alternative" },
                    ],
                },
            ],
        }),
    );
    for (const id of ["mainstream", "alternative"]) {
        fs.writeFileSync(
            path.join(root, `public/app-logos/${id}.jpg`),
            validJpeg,
        );
    }
    return root;
}

function runValidator(root) {
    const result = spawnSync(
        process.execPath,
        [path.join(root, "scripts/validate-catalog.mjs")],
        {
            encoding: "utf8",
            timeout: 15_000,
        },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
}

function endOfSegment(buffer, markers) {
    let offset = 2;
    while (offset < buffer.length) {
        assert.equal(buffer[offset], 0xff);
        while (buffer[offset] === 0xff) offset += 1;
        const marker = buffer[offset++];
        const segmentLength = buffer.readUInt16BE(offset);
        const end = offset + segmentLength;
        if (markers.includes(marker)) return end;
        offset = end;
    }
    throw new Error("Required JPEG segment missing from fixture.");
}

test("catalog validation accepts complete JPEG logos", (t) => {
    const result = runValidator(createFixture(t));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Catalog validation passed\./);
});

test("catalog validation rejects a JPEG truncated after its dimensions header", (t) => {
    const root = createFixture(t);
    const frameEnd = endOfSegment(validJpeg, [0xc0, 0xc1, 0xc2]);
    fs.writeFileSync(
        path.join(root, "public/app-logos/mainstream.jpg"),
        validJpeg.subarray(0, frameEnd),
    );

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /mainstream\.jpg could not be fully decoded as a JPEG/,
    );
    assert.match(result.stderr, /Catalog validation failed with 1 error/);
    assert.doesNotMatch(result.stdout, /Catalog validation passed/);
});

test("catalog validation rejects corrupt scan data despite SOS and EOI markers and reports each logo", (t) => {
    const root = createFixture(t);
    const scanEnd = endOfSegment(validJpeg, [0xda]);
    const corruptJpeg = Buffer.concat([
        validJpeg.subarray(0, scanEnd),
        Buffer.from([0xff, 0x00, 0xff, 0xd9]),
    ]);
    assert.notEqual(corruptJpeg.indexOf(Buffer.from([0xff, 0xda])), -1);
    assert.deepEqual(corruptJpeg.subarray(-2), Buffer.from([0xff, 0xd9]));
    for (const id of ["mainstream", "alternative"]) {
        fs.writeFileSync(
            path.join(root, `public/app-logos/${id}.jpg`),
            corruptJpeg,
        );
    }

    const result = runValidator(root);
    assert.equal(result.status, 1);
    assert.match(
        result.stderr,
        /mainstream\.jpg could not be fully decoded as a JPEG/,
    );
    assert.match(
        result.stderr,
        /alternative\.jpg could not be fully decoded as a JPEG/,
    );
    assert.match(result.stderr, /Catalog validation failed with 2 error/);
    assert.doesNotMatch(result.stdout, /Catalog validation passed/);
});

test("malformed catalogs produce validation errors rather than uncaught exceptions", (t) => {
    for (const catalog of [
        null,
        { categories: null },
        { categories: [null] },
    ]) {
        const root = createFixture(t);
        fs.writeFileSync(
            path.join(root, "data/apps.json"),
            JSON.stringify(catalog),
        );
        const result = runValidator(root);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Catalog validation failed/);
        assert.doesNotMatch(result.stderr, /TypeError|RangeError/);
        assert.doesNotMatch(result.stdout, /Catalog validation passed/);
    }
});

function writeCatalog(root, update) {
    const catalogPath = path.join(root, "data/apps.json");
    const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    update(catalog);
    fs.writeFileSync(catalogPath, JSON.stringify(catalog));
}

function expectRejected(root, message) {
    const result = runValidator(root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /Catalog validation passed/);
}

// Each case breaks one rule in an otherwise valid fixture and expects that
// rule's own error, so deleting or loosening it fails the test.
const ruleCases = [
    {
        rule: "logos must be 200x200",
        message: /mainstream\.jpg is 100x100; expected 200x200/,
        async apply(root) {
            fs.writeFileSync(
                path.join(root, "public/app-logos/mainstream.jpg"),
                await sharp(validJpeg).resize(100, 100).jpeg().toBuffer(),
            );
        },
    },
    {
        rule: "logos must be at most 50KB",
        message: /mainstream\.jpg is \d+ bytes; logos must be <= 51200 bytes/,
        apply(root) {
            fs.writeFileSync(
                path.join(root, "public/app-logos/mainstream.jpg"),
                Buffer.concat([validJpeg, Buffer.alloc(52 * 1024)]),
            );
        },
    },
    {
        rule: "logos must really be JPEGs",
        message: /mainstream\.jpg must be a real JPEG file/,
        async apply(root) {
            fs.writeFileSync(
                path.join(root, "public/app-logos/mainstream.jpg"),
                await sharp(validJpeg).png().toBuffer(),
            );
        },
    },
    {
        rule: "every app needs a logo",
        message: /Missing logo: public\/app-logos\/alternative\.jpg/,
        apply(root) {
            fs.unlinkSync(path.join(root, "public/app-logos/alternative.jpg"));
        },
    },
    {
        rule: "every logo needs an app",
        message: /Unused logo: public\/app-logos\/orphan\.jpg/,
        apply(root) {
            fs.writeFileSync(
                path.join(root, "public/app-logos/orphan.jpg"),
                validJpeg,
            );
        },
    },
    {
        rule: "ids are unique within a bucket",
        message: /repeats id "alternative" within the same category bucket/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                const bucket = catalog.categories[0].private_alternatives;
                bucket.push({ ...bucket[0] });
            });
        },
    },
    {
        rule: "ids are safe file names",
        message: /has an unsafe id: bad id/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].private_alternatives[0].id = "bad id";
            });
        },
    },
    {
        rule: "category orders are contiguous",
        message: /Missing category order 1; orders should be contiguous/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].order = 2;
            });
        },
    },
    {
        rule: "logo files use the .jpg extension",
        message: /public\/app-logos\/extra\.png must use the \.jpg extension/,
        apply(root) {
            fs.writeFileSync(
                path.join(root, "public/app-logos/extra.png"),
                validJpeg,
            );
        },
    },
    {
        rule: "apps have an id",
        message: /mainstream_apps\[0\] is missing a non-empty id/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].mainstream_apps[0].id = " ";
            });
        },
    },
    {
        rule: "apps have a name",
        message: /\(alternative\) is missing a non-empty name/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].private_alternatives[0].name = "";
            });
        },
    },
    {
        rule: "categories have a name",
        message: /categories\[0\] is missing a non-empty name/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].name = "";
            });
        },
    },
    {
        rule: "category orders are positive integers",
        message: /needs a positive integer order/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].order = 1.5;
            });
        },
    },
    {
        rule: "category names and orders are unique",
        message:
            /Duplicate category name: Fixture[\s\S]*Duplicate category order: 1|Duplicate category order: 1[\s\S]*Duplicate category name: Fixture/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories.push({ ...catalog.categories[0] });
            });
        },
    },
    {
        rule: "each bucket has at least one app",
        message: /Fixture must have at least one private alternative/,
        apply(root) {
            writeCatalog(root, (catalog) => {
                catalog.categories[0].private_alternatives = [];
            });
            fs.unlinkSync(path.join(root, "public/app-logos/alternative.jpg"));
        },
    },
];

for (const { rule, message, apply } of ruleCases) {
    test(`catalog validation enforces: ${rule}`, async (t) => {
        const root = createFixture(t);
        await apply(root);
        expectRejected(root, message);
    });
}
