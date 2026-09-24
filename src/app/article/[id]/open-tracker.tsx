"use client";

import { useEffect } from "react";

// Recorded from the client so link prefetching never counts as an open.
export default function OpenTracker({ articleId }: { articleId: number }) {
  useEffect(() => {
    fetch(`/api/articles/${articleId}/open`, { method: "POST" }).catch(() => {});
  }, [articleId]);
  return null;
}
