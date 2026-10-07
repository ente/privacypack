import { Download, Loader2, Share2 } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

const ACTIONS: Record<
    "share" | "download",
    {
        Icon: typeof Share2;
        label: string;
        /** Only sharing waits on the browser; downloads start synchronously. */
        busyLabel?: string;
        title: string;
    }
> = {
    share: {
        Icon: Share2,
        label: "SHARE",
        busyLabel: "SHARING...",
        title: "Share PrivacyPack",
    },
    download: {
        Icon: Download,
        label: "DOWNLOAD",
        title: "Download PrivacyPack",
    },
};

const TONES = {
    light: {
        className: "bg-white text-black active:bg-white/80",
        hoverClassName: "hover:bg-white/80",
        iconColor: "black",
    },
    dark: {
        className: "bg-[#525252] text-white active:bg-[#444444]",
        hoverClassName: "hover:bg-[#444444]",
        iconColor: "white",
    },
};

const PLACEMENTS = {
    navbar: {
        className: "hidden h-11 px-5 sm:flex",
        labelClassName: undefined,
        iconSize: 18,
        hover: true,
        // From sm to md the header has no room for the longer PREPARING...
        // label; the spinner alone shows progress there.
        preparingLabel: (label: string) => (
            <>
                <span className="md:hidden">{label}</span>
                <span className="hidden md:inline">PREPARING...</span>
            </>
        ),
        busyLabel: undefined,
    },
    mobile: {
        className: "flex h-12 w-full",
        labelClassName: "text-lg",
        iconSize: 16,
        hover: false,
        // Side by side on a short screen, two PREPARING... labels or a
        // SHARING... label can be wider than the screen, and with a larger
        // font one can be wider than its button. So the buttons keep their
        // own labels and the spinner shows progress; the hidden text keeps
        // it in their names. Only Share is ever busy.
        preparingLabel: (label: string) => (
            <>
                {label}
                <span className="sr-only"> (preparing)</span>
            </>
        ),
        busyLabel: (label: string) => (
            <>
                {label}
                <span className="sr-only"> (sharing)</span>
            </>
        ),
    },
};

type ExportButtonProps = {
    ref?: React.Ref<HTMLButtonElement>;
    action: keyof typeof ACTIONS;
    tone: keyof typeof TONES;
    placement: keyof typeof PLACEMENTS;
    onClick: () => void;
    /** No image is ready for the current selection. */
    disabled: boolean;
    /**
     * Another export is running. This uses aria-disabled rather than
     * disabled, so a button that has focus keeps it.
     */
    blocked: boolean;
    /** The share sheet (or its fallback) is still running. */
    busy?: boolean;
    preparing: boolean;
    /** At least one alternative is picked, so an image can be prepared. */
    canExport: boolean;
};

export default function ExportButton({
    ref,
    action,
    tone,
    placement,
    onClick,
    disabled,
    blocked,
    busy = false,
    preparing,
    canExport,
}: ExportButtonProps) {
    const { Icon, label, busyLabel, title } = ACTIONS[action];
    const toneStyle = TONES[tone];
    const placementStyle = PLACEMENTS[placement];
    const Indicator = busy || preparing ? Loader2 : Icon;

    return (
        <button
            ref={ref}
            type="button"
            onClick={() => {
                if (!blocked) onClick();
            }}
            disabled={disabled}
            aria-disabled={blocked || undefined}
            id={`${action}-${placement}`}
            title={
                canExport
                    ? title
                    : "Pick at least one private alternative before exporting"
            }
            className={cn(
                "cursor-pointer items-center justify-center gap-2 rounded-lg transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                placementStyle.className,
                toneStyle.className,
                placementStyle.hover && toneStyle.hoverClassName,
            )}
        >
            <Indicator
                color={toneStyle.iconColor}
                size={placementStyle.iconSize}
                className={busy || preparing ? "animate-spin" : undefined}
                aria-hidden="true"
            />
            <span className={placementStyle.labelClassName}>
                {preparing
                    ? placementStyle.preparingLabel(label)
                    : busy
                      ? (placementStyle.busyLabel?.(label) ??
                        busyLabel ??
                        label)
                      : label}
            </span>
        </button>
    );
}
