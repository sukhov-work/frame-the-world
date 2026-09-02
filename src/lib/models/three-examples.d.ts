/**
 * Ambient types for the three example modules `@types/three` does not cover (MESH SUITE MS4).
 * `meshopt_simplifier.module.js` ships with EMBEDDED wasm (no asset pathing — the reason
 * auto-decimation costs nothing at build time); its surface is transcribed from the installed
 * three@0.185 source, not from memory.
 */
declare module "three/examples/jsm/libs/meshopt_simplifier.module.js" {
  export type MeshoptSimplifyFlag =
    | "LockBorder"
    | "Sparse"
    | "ErrorAbsolute"
    | "Prune"
    | "Regularize"
    | "Permissive"
    | "RegularizeLight";
  export const MeshoptSimplifier: {
    /** Resolves once the embedded wasm is instantiated — await before the first call. */
    ready: Promise<void>;
    supported: boolean;
    useExperimentalFeatures: boolean;
    compactMesh(indices: Uint32Array): [Uint32Array, number];
    /** Returns the simplified index buffer + the resulting relative error. */
    simplify(
      indices: Uint32Array,
      vertexPositions: Float32Array,
      vertexPositionsStride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: MeshoptSimplifyFlag[],
    ): [Uint32Array, number];
    getScale(vertexPositions: Float32Array, vertexPositionsStride: number): number;
  };
}
