"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function SaveTools() {
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const shortcutUrl = useRef<HTMLElement>(null);

  useEffect(() => {
    if (shortcutUrl.current) shortcutUrl.current.textContent = `${window.location.origin}/save?url=`;
    // React blocks javascript: URLs in href, so the bookmarklet is set on the DOM node directly.
    bookmarklet.current?.setAttribute(
      "href",
      `javascript:location.href='${window.location.origin}/save?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)`
    );
  }, []);

  return (
    <details className="mt-6 border-y border-white/10 py-4 text-white/75">
      <summary className="metadata-caps cursor-pointer text-white/70">Save links from anywhere</summary>
      <div className="mt-5 space-y-5 text-base leading-relaxed">
        <p>
          <Link href="/save" className="underline underline-offset-4">Paste a link</Link> to save it directly.
        </p>
        <p>
          <span className="font-semibold text-white">Desktop browser:</span> drag this button to your bookmarks bar and click it on any article:{" "}
          <a ref={bookmarklet} href="#" onClick={(e) => e.preventDefault()} className="ml-1 inline-block rounded-full border border-white/30 px-3 py-1 text-sm text-white">
            + The Feed
          </a>
        </p>
        <p>
          <span className="font-semibold text-white">Android:</span> install the app (browser menu → Add to Home screen). The Feed then appears in the share menu.
        </p>
        <p>
          <span className="font-semibold text-white">iPhone/iPad:</span> iOS does not support sharing to web apps. Create a Shortcut instead: enable &quot;Show in Share Sheet&quot; (input: URLs), add &quot;URL Encode&quot; on the Shortcut Input, then &quot;Open URLs&quot; with{" "}
          <code ref={shortcutUrl} className="break-all text-white">/save?url=</code> followed by the encoded text.
        </p>
      </div>
    </details>
  );
}
