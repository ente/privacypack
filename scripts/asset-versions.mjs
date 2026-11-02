import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const imageExtensions = /\.(?:avif|gif|ico|jpe?g|png|svg|webp)$/i;

export async function createAssetVersions(publicDir) {
    const assetPaths = [];

    async function walk(directory) {
        for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
        })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(entryPath);
            } else if (entry.isFile() && imageExtensions.test(entry.name)) {
                assetPaths.push(entryPath);
            }
        }
    }

    await walk(publicDir);

    const versions = {};
    for (const assetPath of assetPaths.sort()) {
        const source = await fs.readFile(assetPath);
        const pathname = `/${path.relative(publicDir, assetPath).split(path.sep).join("/")}`;
        versions[pathname] = crypto
            .createHash("sha256")
            .update(source)
            .digest("hex")
            .slice(0, 16);
    }

    return versions;
}

export async function checkAssetVersions(publicDir, manifestPath) {
    const expected =
        JSON.stringify(await createAssetVersions(publicDir), null, 4) + "\n";
    let actual;
    try {
        actual = await fs.readFile(manifestPath, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    // Compare line endings loosely: Git may check the manifest out with CRLF.
    if (actual?.replace(/\r\n/g, "\n") !== expected) {
        throw new Error(
            "Asset versions are missing or stale. Run npm run assets:generate and include lib/asset-versions.json with the asset changes.",
        );
    }
}

async function main() {
    const arguments_ = process.argv.slice(2);
    if (arguments_.some((argument) => argument !== "--check")) {
        throw new Error("Usage: node scripts/asset-versions.mjs [--check]");
    }

    const publicDir = path.join(repoRoot, "public");
    const manifestPath = path.join(repoRoot, "lib", "asset-versions.json");
    if (arguments_.includes("--check")) {
        await checkAssetVersions(publicDir, manifestPath);
        console.log("Asset versions are current.");
    } else {
        const versions = await createAssetVersions(publicDir);
        await fs.writeFile(
            manifestPath,
            JSON.stringify(versions, null, 4) + "\n",
        );
        console.log(
            `Generated versions for ${Object.keys(versions).length} public images.`,
        );
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
