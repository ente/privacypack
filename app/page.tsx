"use client";

import Image from "next/image";
import Link from "next/link";
import React from "react";
import { getAssetUrl } from "@/lib/assets";

export default function Home() {
    return (
        <div className="flex h-auto w-full flex-col items-center justify-normal py-16 lg:py-32 xl:py-16 2xl:py-20">
            <div className="flex flex-col items-center">
                <div className="flex flex-col items-center">
                    <div className="h-[50px] w-[90px] md:h-[90px] md:w-[135px]">
                        <Image
                            src={getAssetUrl("/logo.png")}
                            alt="Privacy Pack logo"
                            width={0}
                            height={0}
                            sizes="100vw"
                            className="h-auto w-full"
                            priority
                        />
                    </div>
                    <h1 className="green-text xs:text-5xl mt-6 text-center text-4xl font-bold md:mt-4 md:text-8xl">
                        PrivacyPack
                    </h1>
                    <p className="xs:text-lg mt-4 flex flex-col text-center text-base font-semibold text-white/50 uppercase md:text-2xl">
                        Your privacy wins, in one card
                    </p>
                    <Link
                        href="/create"
                        id="create-pack"
                        className="mt-12 items-center justify-center rounded-2xl bg-white px-10 py-4 text-base font-semibold text-black uppercase transition-all duration-150 hover:bg-white/80"
                    >
                        Create your Pack
                    </Link>
                </div>
            </div>
            <div className="my-20 flex flex-col items-center gap-2">
                <span className="text-xs text-[#aeaeae]">Toy by</span>
                <div className="w-16">
                    <a href="https://ente.com/" target="_blank" rel="noopener">
                        <Image
                            src={getAssetUrl("/ente.svg")}
                            alt="Ente logo"
                            width={0}
                            height={0}
                            sizes="100vw"
                            className="h-auto w-full"
                            priority
                        />
                    </a>
                </div>
            </div>
            <div className="flex w-[80%] flex-col items-center gap-3 md:w-[640px] xl:w-[740px]">
                <div className="w-full">
                    <Image
                        src={getAssetUrl("/hero.png")}
                        alt="Hero illustration"
                        width={0}
                        height={0}
                        sizes="100vw"
                        className="h-auto w-full"
                        priority
                    />
                </div>
            </div>
            <div className="mt-24 flex flex-row gap-5 text-sm">
                <Link
                    href="/privacy"
                    className="text-[#8a8a8a] underline underline-offset-4 hover:text-[#a8a8a8]"
                >
                    Privacy
                </Link>
                <Link
                    href="/terms"
                    className="text-[#8a8a8a] underline underline-offset-4 hover:text-[#a8a8a8]"
                >
                    Terms
                </Link>
            </div>
        </div>
    );
}
