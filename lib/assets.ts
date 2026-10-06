import assetVersions from "./asset-versions.json";

const versions: Record<string, string> = assetVersions;

/** Use a content version so corrected public assets bypass older browser caches. */
export function getAssetUrl(src: string): string {
    const fragmentIndex = src.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : src.slice(fragmentIndex);
    const pathAndQuery =
        fragmentIndex === -1 ? src : src.slice(0, fragmentIndex);
    const queryIndex = pathAndQuery.indexOf("?");
    const pathname =
        queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
    const version = versions[pathname];

    if (typeof version !== "string") {
        return src;
    }

    const query = new URLSearchParams(
        queryIndex === -1 ? "" : pathAndQuery.slice(queryIndex + 1),
    );
    query.set("v", version);

    return `${pathname}?${query.toString()}${fragment}`;
}
