"use client";

import type { ImgHTMLAttributes } from "react";

type ManagedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  source: string;
};

// Las imágenes siempre provienen de URLs públicas permanentes (Supabase Storage o Unsplash).
// Nunca se resuelven referencias locales (IndexedDB/localStorage/blob), ya que no son accesibles
// desde otros navegadores o dispositivos.
export function ManagedImage({ source, alt, ...props }: ManagedImageProps) {
  const isPublicUrl = Boolean(source) && !/^(idb:|blob:|data:)/.test(source);

  if (!isPublicUrl) {
    return <img {...props} alt={alt} />;
  }

  return <img {...props} src={source} alt={alt} />;
}
