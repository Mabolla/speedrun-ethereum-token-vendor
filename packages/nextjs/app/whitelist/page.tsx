"use client";

import type { NextPage } from "next";
import { OracleShell } from "~~/components/oracle/OracleShell";
import { PriceWidget } from "~~/components/oracle/PriceWidget";
import { WhitelistTable } from "~~/components/oracle/whitelist/WhitelistTable";

const Home: NextPage = () => {
  return (
    <OracleShell title="Whitelist Oracle">
      <div className="flex items-center flex-col flex-grow pt-10">
        <div className="px-5 w-full max-w-5xl mx-auto">
          <div className="flex flex-col gap-8">
            <p className="m-0">
              Submit demo prices manually with a connected wallet. The median uses reports from the last 24 seconds;
              stale reports remain visible below.
            </p>
            <div className="w-full">
              <PriceWidget contractName="WhitelistOracle" />
            </div>
            <div className="w-full">
              <WhitelistTable />
            </div>
          </div>
        </div>
      </div>
    </OracleShell>
  );
};

export default Home;
