import { useState } from 'react';
import { Flame } from 'lucide-react';

interface BrandLogoProps {
  src: string;
  alt: string;
  className?: string;
  fallbackSize?: 'sm' | 'lg';
}

export function BrandLogo({
  src,
  alt,
  className = '',
  fallbackSize = 'sm',
}: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl bg-gradient-to-br from-[#2a0a0a] via-[#150808] to-[#0b0505] border border-[#ED2525]/40 text-white select-none ${
          fallbackSize === 'lg' ? 'h-32 sm:h-40 px-6 gap-3' : 'h-10 sm:h-12 px-3 gap-2'
        } ${className}`}
        role="img"
        aria-label={alt}
      >
        <Flame
          className={
            fallbackSize === 'lg'
              ? 'w-9 h-9 text-[#ED2525] shrink-0'
              : 'w-5 h-5 text-[#ED2525] shrink-0'
          }
        />
        <span
          className={`font-impact tracking-wider uppercase whitespace-nowrap ${
            fallbackSize === 'lg' ? 'text-4xl sm:text-5xl' : 'text-xl sm:text-2xl'
          }`}
        >
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
