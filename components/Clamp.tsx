"use client";
/** Shows only the first few items (3 by default) with a "More" button that opens the rest, and "Show less". */
import { Children, useState, type ReactNode } from "react";

export default function Clamp({ children, n = 3 }: { children: ReactNode; n?: number }) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);
  return (
    <>
      {all ? items : items.slice(0, n)}
      {items.length > n && (
        <button type="button" className="ct-morebtn" onClick={() => setAll(!all)}>{all ? "Show less" : `More (${items.length - n})`}</button>
      )}
    </>
  );
}
