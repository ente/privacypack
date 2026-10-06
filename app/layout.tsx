import type { Metadata } from "next";
import localFont from "next/font/local";
import { getAssetUrl } from "@/lib/assets";
import "./globals.css";

const jetBrainsMono = localFont({
    src: "./JetBrainsMono.ttf",
    // If the font is blocked and there is no Arial for next/font's fallback
    // (Linux), keep the page monospace rather than the browser default.
    // The same list as SYSTEM_MONO_FAMILY in lib/export-image.ts.
    fallback: [
        "Menlo",
        "Consolas",
        "DejaVu Sans Mono",
        "Liberation Mono",
        "Noto Sans Mono",
        "monospace",
    ],
});

export const metadata: Metadata = {
    title: { default: "PrivacyPack", template: "%s · PrivacyPack" },
    description:
        "Pick the mainstream apps you used before, show the privacy-respecting tools you have switched to, and share your privacy wins!",
    openGraph: {
        title: "PrivacyPack",
        description:
            "Pick the mainstream apps you used before, show the privacy-respecting tools you have switched to, and share your privacy wins!",
        url: "https://privacypack.org",
        siteName: "PrivacyPack",
        images: [
            {
                url: `https://privacypack.org${getAssetUrl("/og-image.png")}`,
                width: 1200,
                height: 630,
                alt: "PrivacyPack Preview",
            },
        ],
        locale: "en_US",
        type: "website",
    },
    twitter: {
        card: "summary_large_image",
        title: "PrivacyPack",
        description:
            "Pick the mainstream apps you used before, show the privacy-respecting tools you have switched to, and share your privacy wins!",
        images: [`https://privacypack.org${getAssetUrl("/og-image.png")}`],
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className={`${jetBrainsMono.className} antialiased`}>
                {children}
            </body>
        </html>
    );
}
