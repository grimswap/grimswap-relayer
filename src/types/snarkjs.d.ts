declare module "snarkjs" {
  export const groth16: {
    verify: (
      vKey: any,
      publicSignals: string[],
      proof: any
    ) => Promise<boolean>;
    fullProve: (
      input: any,
      wasmPath: string,
      zkeyPath: string
    ) => Promise<{ proof: any; publicSignals: string[] }>;
  };
}
