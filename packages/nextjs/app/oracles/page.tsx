"use client";

import Link from "next/link";
import { Address } from "@scaffold-ui/components";
import { OracleShell } from "~~/components/oracle/OracleShell";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";

const Oracles = () => {
  const { data: whitelist } = useDeployedContractInfo({ contractName: "WhitelistOracle" });
  const { data: staking } = useDeployedContractInfo({ contractName: "StakingOracle" });
  const { data: optimistic } = useDeployedContractInfo({ contractName: "OptimisticOracle" });
  const demos = [
    {
      title: "Whitelist Oracle",
      href: "/whitelist",
      address: whitelist?.address,
      description:
        "Add price reporters, submit a USD price, and aggregate the median of fresh reports. Reports become stale after 24 seconds.",
      action: "Open Whitelist",
    },
    {
      title: "Staking Oracle",
      href: "/staking",
      address: staking?.address,
      description:
        "Stake at least 100 ORA to register a node, report once per 24-block bucket, finalize medians, and claim rewards or slash outliers.",
      action: "Open Staking",
    },
    {
      title: "Optimistic Oracle",
      href: "/optimistic",
      address: optimistic?.address,
      description:
        "Create a yes-or-no assertion with a reward. Propose an outcome, challenge it with a bond, and settle or claim after the deadline.",
      action: "Open Optimistic",
    },
  ];

  return (
    <OracleShell title="Oracles">
      <div className="mx-auto max-w-5xl px-5">
        <p className="mt-0 mb-6">
          Explore three ways to bring data on chain. This educational demo uses manual reports and testnet funds.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {demos.map(demo => (
            <div key={demo.href} className="card bg-base-100 shadow-sm border border-base-300">
              <div className="card-body">
                <h2 className="card-title">{demo.title}</h2>
                <p className="text-sm">{demo.description}</p>
                <div className="my-3">
                  {demo.address ? <Address address={demo.address} size="sm" /> : "Loading contract…"}
                </div>
                <Link href={demo.href} className="btn btn-primary btn-sm">
                  {demo.action}
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </OracleShell>
  );
};

export default Oracles;
