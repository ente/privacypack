"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import Image from "next/image";
import React, { useRef } from "react";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { useTapToOpen } from "@/hooks/use-tap-to-open";
import { getAssetUrl } from "@/lib/assets";
import {
    MAX_PRIVATE_ALTERNATIVES,
    getPrivateAlternativeLabel,
    type AppOption,
    type PackItem,
} from "@/lib/pack";

const triggerClassName =
    "flex h-full cursor-pointer touch-pan-y flex-col items-center rounded-2xl bg-[#2B2B2B] p-4 text-[#aeaeae] transition outline-none hover:bg-[#ededed] focus-visible:outline-hidden hover:text-black focus:bg-[#ededed] focus:text-black data-[state=open]:bg-[#ededed] data-[state=open]:text-black md:rounded-3xl";
const triggerNameClassName =
    "mt-5 max-w-18 text-center text-xs leading-tight font-medium break-words lg:max-w-24 lg:text-base picker-xl:max-w-28 picker-2xl:max-w-40";

const logoSrc = (id: string) => getAssetUrl(`/app-logos/${id}.jpg`);

type CategoryPickersProps = {
    item: PackItem;
    /** The category's options, already sorted for display. */
    mainstreamApps: AppOption[];
    privateAlternatives: AppOption[];
    openKey: string | null;
    onOpenChange: (key: string, open: boolean) => void;
    onCloseAutoFocus: (event: Event, key: string) => void;
    getTriggerHandlers: ReturnType<typeof useTapToOpen>;
    onSelectMainstreamApp: (category: string, app: AppOption) => void;
    onTogglePrivateAlternative: (category: string, app: AppOption) => void;
    onClearPrivateAlternatives: (category: string) => void;
    /** Keeps menus clear of the sticky mobile export bar. */
    menuCollisionPadding: { bottom: number };
};

export default function CategoryPickers({
    item,
    mainstreamApps,
    privateAlternatives,
    openKey,
    onOpenChange,
    onCloseAutoFocus,
    getTriggerHandlers,
    onSelectMainstreamApp,
    onTogglePrivateAlternative,
    onClearPrivateAlternatives,
    menuCollisionPadding,
}: CategoryPickersProps) {
    const mainTriggerRef = useRef<HTMLButtonElement>(null);
    const altTriggerRef = useRef<HTMLButtonElement>(null);
    // A menu still animating closed treats a tap on its own trigger as an
    // outside tap and would close the menu that tap just reopened. The
    // trigger toggles its menu itself, so ignore those.
    const ignoreOwnTrigger = (
        event: Event,
        trigger: React.RefObject<HTMLButtonElement | null>,
    ) => {
        if (trigger.current?.contains(event.target as Node)) {
            event.preventDefault();
        }
    };
    const selected = item.private_alternatives;
    const mainKey = `${item.category}-main`;
    const altKey = `${item.category}-alt`;
    // Includes the visible "[Pick]" label, so speech users can say "Pick".
    const selectedNames =
        selected.length > 0
            ? selected.map((alternative) => alternative.name).join(", ")
            : "Pick";

    return (
        <div data-category={item.category} className="flex flex-col gap-2">
            <h2 className="mb-1 text-[#aeaeae]">{item.category}</h2>
            <div className="xs:p-8 flex h-full w-full flex-row items-center justify-between rounded-3xl bg-[#fff]/2 p-3 sm:w-auto sm:justify-normal sm:gap-3 md:rounded-4xl">
                <DropdownMenu
                    modal={false}
                    open={openKey === mainKey}
                    onOpenChange={(open) => onOpenChange(mainKey, open)}
                >
                    <DropdownMenuTrigger asChild>
                        <button
                            ref={mainTriggerRef}
                            type="button"
                            aria-label={`${item.category} mainstream app: ${item.mainstream_app_name}`}
                            {...getTriggerHandlers(mainKey)}
                            className={triggerClassName}
                        >
                            <div className="picker-xl:h-28 picker-xl:w-28 picker-2xl:h-40 picker-2xl:w-40 h-18 w-18 lg:h-24 lg:w-24">
                                <Image
                                    src={logoSrc(item.mainstream_app_id)}
                                    alt=""
                                    width={0}
                                    height={0}
                                    sizes="100vw"
                                    priority={item.order === 1}
                                    className="h-full w-full rounded-xl object-cover md:rounded-2xl"
                                />
                            </div>
                            <div className={triggerNameClassName}>
                                {item.mainstream_app_name}
                            </div>
                            <ChevronDown className="mt-1 h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                        onCloseAutoFocus={(event) =>
                            onCloseAutoFocus(event, mainKey)
                        }
                        onPointerDownOutside={(event) =>
                            ignoreOwnTrigger(event, mainTriggerRef)
                        }
                        align="start"
                        side="bottom"
                        collisionPadding={menuCollisionPadding}
                        className="rounded-2xl"
                    >
                        <DropdownMenuRadioGroup
                            value={item.mainstream_app_id}
                            onValueChange={(id) => {
                                const app = mainstreamApps.find(
                                    (option) => option.id === id,
                                );
                                if (app) {
                                    onSelectMainstreamApp(item.category, app);
                                }
                            }}
                        >
                            {mainstreamApps.map((app) => (
                                <DropdownMenuRadioItem
                                    key={app.id}
                                    value={app.id}
                                    className="cursor-pointer rounded-lg py-2.5"
                                >
                                    <div className="h-5 w-5 shrink-0">
                                        <Image
                                            src={logoSrc(app.id)}
                                            alt=""
                                            width={0}
                                            height={0}
                                            sizes="100vw"
                                            className="h-auto w-full rounded-sm"
                                        />
                                    </div>
                                    <span className="text-xs break-words sm:text-sm">
                                        {app.name}
                                    </span>
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>

                <ArrowRight
                    data-picker-arrow
                    className="shrink-0 text-[#aeaeae] transition"
                    aria-hidden="true"
                />

                <DropdownMenu
                    modal={false}
                    open={openKey === altKey}
                    onOpenChange={(open) => onOpenChange(altKey, open)}
                >
                    <DropdownMenuTrigger asChild>
                        <button
                            ref={altTriggerRef}
                            type="button"
                            aria-label={`${item.category} private alternatives: ${selectedNames}; ${selected.length} of ${MAX_PRIVATE_ALTERNATIVES} selected`}
                            {...getTriggerHandlers(altKey)}
                            className={triggerClassName}
                        >
                            <div
                                className={`picker-xl:h-28 picker-xl:w-28 picker-2xl:h-40 picker-2xl:w-40 h-18 w-18 rounded-xl md:rounded-2xl lg:h-24 lg:w-24 ${
                                    selected.length === 0 ? "bg-[#383838]" : ""
                                } ${
                                    selected.length > 1
                                        ? "grid grid-cols-2 place-items-center gap-1 p-1"
                                        : ""
                                } relative overflow-hidden`}
                            >
                                {selected.map((alternative) => (
                                    <div
                                        key={alternative.id}
                                        className={`overflow-hidden rounded-xl md:rounded-2xl ${
                                            selected.length > 1
                                                ? "aspect-square w-full bg-white/5"
                                                : "h-full w-full"
                                        }`}
                                    >
                                        <Image
                                            src={logoSrc(alternative.id)}
                                            alt=""
                                            width={0}
                                            height={0}
                                            sizes={
                                                selected.length > 1
                                                    ? "56px"
                                                    : "160px"
                                            }
                                            className={`h-full w-full ${
                                                selected.length > 1
                                                    ? "object-contain"
                                                    : "object-cover"
                                            }`}
                                        />
                                    </div>
                                ))}
                                <span className="absolute top-1 right-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
                                    {selected.length}/{MAX_PRIVATE_ALTERNATIVES}
                                </span>
                            </div>
                            <div className={triggerNameClassName}>
                                {getPrivateAlternativeLabel(selected)}
                            </div>
                            <ChevronDown className="mt-1 h-4 w-4" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        onCloseAutoFocus={(event) =>
                            onCloseAutoFocus(event, altKey)
                        }
                        onPointerDownOutside={(event) =>
                            ignoreOwnTrigger(event, altTriggerRef)
                        }
                        align="end"
                        side="bottom"
                        collisionPadding={menuCollisionPadding}
                        className="rounded-2xl"
                    >
                        <DropdownMenuLabel className="flex items-center justify-between gap-4 text-xs text-[#6b6b6b]">
                            <span>Private alternatives</span>
                            <span>
                                {selected.length}/{MAX_PRIVATE_ALTERNATIVES}
                            </span>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {privateAlternatives.map((alternative) => {
                            const isSelected = selected.some(
                                ({ id }) => id === alternative.id,
                            );

                            return (
                                <DropdownMenuCheckboxItem
                                    key={alternative.id}
                                    checked={isSelected}
                                    disabled={
                                        !isSelected &&
                                        selected.length >=
                                            MAX_PRIVATE_ALTERNATIVES
                                    }
                                    onSelect={(event) => {
                                        event.preventDefault();
                                        onTogglePrivateAlternative(
                                            item.category,
                                            alternative,
                                        );
                                    }}
                                    className={`cursor-pointer rounded-lg ${
                                        isSelected
                                            ? "bg-accent text-accent-foreground"
                                            : ""
                                    }`}
                                >
                                    <div className="flex w-full flex-row items-center gap-2 pl-1">
                                        <div className="h-5 w-5 shrink-0">
                                            <Image
                                                src={logoSrc(alternative.id)}
                                                alt=""
                                                width={0}
                                                height={0}
                                                sizes="100vw"
                                                className="h-auto w-full rounded-sm"
                                            />
                                        </div>
                                        <span className="text-xs break-words sm:text-sm">
                                            {alternative.name}
                                        </span>
                                    </div>
                                </DropdownMenuCheckboxItem>
                            );
                        })}
                        {/* Set apart: at the cap, ArrowDown from the last
                            pick skips the disabled options straight to it. */}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            aria-label={`Remove all ${item.category} alternatives`}
                            disabled={selected.length === 0}
                            onSelect={() =>
                                onClearPrivateAlternatives(item.category)
                            }
                            className="cursor-pointer rounded-lg data-[disabled]:opacity-100"
                        >
                            <div
                                className={`flex flex-row items-center gap-2 ${
                                    selected.length > 0
                                        ? "text-red-700"
                                        : "text-[#aeaeae]"
                                }`}
                            >
                                <div
                                    aria-hidden="true"
                                    className="h-5 w-5 pl-1"
                                >
                                    —
                                </div>
                                <span className="text-xs sm:text-sm">
                                    Remove
                                </span>
                            </div>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
