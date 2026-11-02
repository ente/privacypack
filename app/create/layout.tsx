import type { Metadata } from "next";

// The builder page is a client component, so its title is set here.
export const metadata: Metadata = { title: "Create your pack" };

export default function CreateLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return children;
}
