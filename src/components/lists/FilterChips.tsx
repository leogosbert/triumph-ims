"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTr } from "@/lib/tr-client";

export type Chip = { key: string; label: string; href: string };

const storeKey = (list: string) => `lemosp.chip.${list}`;

function remembered(list: string): string | null {
  try {
    return window.localStorage.getItem(storeKey(list));
  } catch {
    return null;
  }
}

function remember(list: string, key: string) {
  try {
    window.localStorage.setItem(storeKey(list), key);
  } catch {
    /* Private window or storage blocked: the chips still work, they just aren't remembered. */
  }
}

/**
 * Quick filters above a list ("Overdue", "This week", "Mine", "Open"…), shown as chips.
 * The last chip a person chose is remembered on this device for this list: opening the list
 * without a filter in the address brings it back. `explicit` says the address already names one
 * (a link from the home screen, say), and then that one wins and becomes the remembered one.
 */
export function FilterChips({
  list,
  chips,
  current,
  explicit,
  label = "Filter",
}: {
  list: string;
  chips: Chip[];
  current: string;
  explicit: boolean;
  label?: string;
}) {
  const t = useTr();
  const router = useRouter();

  useEffect(() => {
    if (explicit) {
      remember(list, current);
      return;
    }
    const want = remembered(list);
    if (!want || want === current) return;
    const chip = chips.find((c) => c.key === want);
    if (chip) router.replace(chip.href, { scroll: false });
    // Only on arrival: later changes come from taps, which remember themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, current, explicit]);

  return (
    <nav className="tabs-row chip-row" aria-label={t(label)}>
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          scroll={false}
          aria-current={c.key === current ? "page" : undefined}
          onClick={() => remember(list, c.key)}
        >
          {t(c.label)}
        </Link>
      ))}
    </nav>
  );
}
