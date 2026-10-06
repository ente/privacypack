import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy" };

const Privacy = () => {
    return (
        <div className="flex min-h-screen w-full flex-col items-center">
            <div className="flex w-full flex-col gap-5 p-8 text-gray-400 lg:w-[56rem] lg:p-16">
                <h1 className="mb-8 text-3xl text-white uppercase">
                    Privacy Policy
                </h1>
                <p>Last Updated: April 25, 2026</p>
                <p>
                    We respect the privacy of our Users (&quot;User&quot;,
                    &quot;your&quot;, &quot;you&quot;). This Privacy Policy
                    (&quot;Policy&quot;) explains how we handle information when
                    you use our website, <strong>privacypack.org</strong> (the
                    &quot;Site&quot;).
                </p>
                <p>
                    By accessing or using the Site, you agree to the terms of
                    this Policy. If you do not agree with the terms of this
                    Policy, please do not access or use the Site.
                </p>

                <h2 className="text-xl text-white">1. Introduction</h2>
                <p>
                    <strong>privacypack.org</strong> allows users to create and
                    share cards showing the mainstream apps they previously used
                    and the privacy-respecting alternatives they have switched
                    to. The card is generated in your browser.
                </p>

                <h2 className="text-xl text-white">
                    2. Data Collection and Usage
                </h2>
                <p>
                    The Site does not require an account, does not ask you to
                    enter personal information, and does not upload or store the
                    app choices you make while building a card.
                </p>
                <p>
                    Like most websites, the hosting provider may process basic
                    request information needed to serve the Site, such as IP
                    address, browser information, and request timestamps.
                </p>

                <h2 className="text-xl text-white">3. Data Sharing</h2>
                <p>
                    We do not publish, host, or index your cards. If you
                    download or share a card, that happens through your browser,
                    device, or the third-party app or service you choose.
                </p>

                <h2 className="text-xl text-white">4. User Rights</h2>
                <p>
                    Users have the right to stop using the Site at any time. If
                    you download or share a card elsewhere, you control that
                    copy through the place where you saved or shared it.
                </p>

                <h2 className="text-xl text-white">5. Data Retention</h2>
                <p>
                    The Site does not retain your generated cards or app
                    selections.
                </p>

                <h2 className="text-xl text-white">
                    6. Children&apos;s Privacy
                </h2>
                <p>
                    The Site is not intended for children under the age of 13,
                    and we do not knowingly collect personal data from children
                    under 13. If you are under 13, please do not use the Site.
                </p>

                <h2 className="text-xl text-white">7. Cookies</h2>
                <p>
                    We do not place cookies on your device for tracking
                    purposes.
                </p>

                <h2 className="text-xl text-white">
                    8. Changes to this Privacy Policy
                </h2>
                <p>
                    We may update this Privacy Policy to reflect changes in our
                    practices or for other operational, legal, or regulatory
                    reasons. Updates will be posted on this page.
                </p>

                <h2 className="text-xl text-white">9. Contact Us</h2>
                <p>
                    You can reach us by email at:{" "}
                    <a
                        href="mailto:privacy@ente.io"
                        className="underline underline-offset-2"
                    >
                        privacy@ente.io
                    </a>
                </p>
                <p>
                    Mailing address: EnteIO Technologies Private Limited, 72/12,
                    Whitefield, Bengaluru, India.
                </p>

                <Link href="/" className="mt-8 underline underline-offset-2">
                    Go back to homepage
                </Link>
            </div>
        </div>
    );
};

export default Privacy;
