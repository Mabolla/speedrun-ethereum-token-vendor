"use client";

import { ReactNode, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBlock } from "wagmi";
import { useSelectedNetwork } from "~~/hooks/scaffold-eth";
import { useChallengeState } from "~~/services/store/oracleStore";

const oracleLinks = [
  { href: "/oracles", label: "Overview" },
  { href: "/whitelist", label: "Whitelist" },
  { href: "/staking", label: "Staking" },
  { href: "/optimistic", label: "Optimistic" },
];

export const OracleShell = ({ title, children }: { title: string; children: ReactNode }) => {
  const pathname = usePathname();
  const network = useSelectedNetwork();
  const setTimestamp = useChallengeState(state => state.setTimestamp);
  const { data: block } = useBlock({ chainId: network.id, watch: true });

  useEffect(() => {
    setTimestamp(block?.timestamp ?? null);
  }, [block?.timestamp, setTimestamp]);

  return (
    <div className="w-full py-6">
      <div className="mx-auto max-w-5xl px-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">{title}</h1>
          <span className="badge badge-outline">{network.name} demo</span>
        </div>
        <nav className="flex flex-wrap gap-2 mt-4" aria-label="Oracle demos">
          {oracleLinks.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`btn btn-sm ${pathname === link.href ? "btn-primary" : "btn-ghost"}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
};
