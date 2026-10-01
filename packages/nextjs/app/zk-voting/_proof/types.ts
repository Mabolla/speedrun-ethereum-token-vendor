export type FieldHex = `0x${string}`;
export type PublicInputs = [FieldHex, FieldHex, FieldHex, FieldHex];
export type VotingIdentity = {
  version: 1;
  chainId: 11155111;
  contractAddress: FieldHex;
  registrationAddress: FieldHex;
  commitment: FieldHex;
  nullifier: FieldHex;
  secret: FieldHex;
};
export type ZkProof = {
  proof: FieldHex;
  publicInputs: PublicInputs;
  vote: boolean;
  commitment: FieldHex;
};
export type ProofRequest = {
  identity: VotingIdentity;
  leaves: string[];
  root: string;
  treeDepth: number;
  vote: boolean;
  circuitUrl: string;
};
export type ProofResponse =
  | { type: "status"; message: string }
  | { type: "result"; result: ZkProof }
  | { type: "error"; message: string };
