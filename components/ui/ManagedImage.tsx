"use client";

import { useEffect, useState, type ImgHTMLAttributes } from "react";

import { resolveImageReference } from "@/lib/image-store";

type ManagedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  source: string;
};

export function ManagedImage({ source, alt, ...props }: ManagedImageProps) {
  const [resolvedSource, setResolvedSource] = useState(source);

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;

    resolveImageReference(source).then((nextSource) => {
      if (!cancelled) {
        objectUrl = nextSource.startsWith("blob:") ? nextSource : "";
        setResolvedSource(nextSource);
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [source]);

  return <img {...props} src={resolvedSource} alt={alt} />;
}
