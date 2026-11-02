import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    checkAssetVersions,
    createAssetVersions,
} from "../scripts/asset-versions.mjs";
import { loadTsModule } from "./load-ts-module.mjs";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const publicDir = path.join(repoRoot, "public");
const manifestPath = path.join(repoRoot, "lib", "asset-versions.json");
const versions = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const { getAssetUrl } = await loadTsModule(
    path.join(repoRoot, "lib", "assets.ts"),
    { "./asset-versions.json": versions },
);

test("known public images use their actual content version", async () => {
    for (const pathname of ["/logo.png", "/hero.png", "/app-logos/brave.jpg"]) {
        const bytes = await fs.readFile(
            path.join(publicDir, pathname.slice(1)),
        );
        const expectedVersion = crypto
            .createHash("sha256")
            .update(bytes)
            .digest("hex")
            .slice(0, 16);
        assert.equal(getAssetUrl(pathname), `${pathname}?v=${expectedVersion}`);
    }
});

test("asset URLs replace stale versions while preserving query and fragment", () => {
    const url = new URL(
        getAssetUrl("/logo.png?download=1&v=old#preview"),
        "https://example.test",
    );
    assert.equal(url.pathname, "/logo.png");
    assert.equal(url.searchParams.get("download"), "1");
    assert.deepEqual(url.searchParams.getAll("v"), [versions["/logo.png"]]);
    assert.equal(url.hash, "#preview");
    for (const pathname of [
        "/missing.jpg",
        "https://example.test/logo.png",
        "toString",
    ]) {
        assert.equal(getAssetUrl(pathname), pathname);
    }
});

test("checked-in manifest covers current public images", async () => {
    await checkAssetVersions(publicDir, manifestPath);
});

test("a manifest checked out with CRLF line endings still matches", async () => {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "privacypack-assets-crlf-"),
    );
    try {
        const manifest = path.join(directory, "versions.json");
        const expected = await createAssetVersions(publicDir);
        await fs.writeFile(
            manifest,
            (JSON.stringify(expected, null, 4) + "\n").replace(/\n/g, "\r\n"),
        );
        await checkAssetVersions(publicDir, manifest);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("asset checks detect changed, added, deleted, and missing manifest entries", async () => {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "privacypack-assets-"),
    );
    const fixturePublic = path.join(directory, "public");
    const fixtureManifest = path.join(directory, "versions.json");
    try {
        await fs.mkdir(path.join(fixturePublic, "app-logos"), {
            recursive: true,
        });
        const imagePath = path.join(fixturePublic, "app-logos", "example.jpg");
        await fs.writeFile(imagePath, "initial image bytes");
        await fs.writeFile(
            path.join(fixturePublic, "_headers"),
            "ignored header bytes",
        );
        const initial = await createAssetVersions(fixturePublic);
        assert.deepEqual(Object.keys(initial), ["/app-logos/example.jpg"]);
        await assert.rejects(
            checkAssetVersions(fixturePublic, fixtureManifest),
            /missing or stale/,
        );
        await fs.writeFile(
            fixtureManifest,
            JSON.stringify(initial, null, 4) + "\n",
        );
        await checkAssetVersions(fixturePublic, fixtureManifest);
        await fs.writeFile(imagePath, "corrected image bytes");
        const changed = await createAssetVersions(fixturePublic);
        assert.notEqual(
            changed["/app-logos/example.jpg"],
            initial["/app-logos/example.jpg"],
        );
        await assert.rejects(
            checkAssetVersions(fixturePublic, fixtureManifest),
            /missing or stale/,
        );
        await fs.writeFile(imagePath, "initial image bytes");
        await fs.writeFile(
            path.join(fixturePublic, "new.png"),
            "new image bytes",
        );
        await assert.rejects(
            checkAssetVersions(fixturePublic, fixtureManifest),
            /missing or stale/,
        );
        await fs.unlink(path.join(fixturePublic, "new.png"));
        await fs.unlink(imagePath);
        await assert.rejects(
            checkAssetVersions(fixturePublic, fixtureManifest),
            /missing or stale/,
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
