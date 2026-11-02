export const PRIVACY_PACK_FILENAME = "privacypack.png";
const DOWNLOAD_URL_REVOKE_DELAY_MS = 60_000;

export type ShareResult = "shared" | "copied" | "downloaded" | "cancelled";

export function downloadImage(blob: Blob) {
    const url = URL.createObjectURL(blob);

    try {
        const link = document.createElement("a");
        link.href = url;
        link.download = PRIVACY_PACK_FILENAME;
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }

    window.setTimeout(
        () => URL.revokeObjectURL(url),
        DOWNLOAD_URL_REVOKE_DELAY_MS,
    );
}

function canShareFiles(data: ShareData) {
    if (
        typeof navigator.share !== "function" ||
        typeof navigator.canShare !== "function"
    ) {
        return false;
    }

    try {
        return navigator.canShare(data);
    } catch {
        // A capability check that throws means this browser cannot share the
        // file. Use the clipboard and download fallbacks instead.
        return false;
    }
}

async function copyBlobToClipboard(blob: Blob) {
    if (
        typeof navigator.clipboard?.write !== "function" ||
        typeof ClipboardItem === "undefined"
    ) {
        return false;
    }

    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                [blob.type]: blob,
            }),
        ]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Shares a prepared PNG, falling back to the clipboard and then a download.
 * Call it directly from the tap handler: navigator.share and the clipboard
 * need the tap's transient activation, so nothing may be awaited first.
 */
export async function shareImage(blob: Blob): Promise<ShareResult> {
    const file = new File([blob], PRIVACY_PACK_FILENAME, {
        type: "image/png",
    });
    const data = {
        text: "",
        url: "https://privacypack.org",
        files: [file],
    };

    if (canShareFiles(data)) {
        try {
            await navigator.share(data);
            return "shared";
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                return "cancelled";
            }
        }
    }

    if (await copyBlobToClipboard(blob)) {
        return "copied";
    }

    downloadImage(blob);
    return "downloaded";
}
