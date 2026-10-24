"use client";
import { useEffect, useState } from "react";
import { netLogos, type Net } from "@/lib/connect";

let cache: Record<number, string> | null = null;

/** A network's logo, or a dot in its colour until (or unless) the logo loads. */
export default function NetIcon({ n, size = 18 }: { n: Net; size?: number }) {
  const [logos, setLogos] = useState(cache);
  const [bad, setBad] = useState(false);
  useEffect(() => { if (!cache) netLogos().then((l) => { cache = l; setLogos(l); }); }, []);
  const src = logos?.[n.id];
  if (src && !bad) return <img className="net-ic" src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBad(true)} />;
  return <i className="net-ic dot" style={{ width: size, height: size, background: n.color }} aria-hidden="true" />;
}
