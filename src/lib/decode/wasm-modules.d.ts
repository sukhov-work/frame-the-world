/**
 * Ambient types for the WASM decode modules.
 *
 * `libraw-wasm` is pinned to 1.0.5 — the last SINGLE-THREADED build. Every later version (1.1.2+)
 * is compiled with pthreads + SharedArrayBuffer and hard-requires COOP/COEP cross-origin isolation,
 * which Wix managed hosting is not confirmed to allow, and would force CORP requirements onto the globe's
 * tile/font subresources. Phases 2–5 shipped this single-threaded path in a disposable Worker, so the pin
 * stays (resolves IMPLEMENTATION_PLAN TODO-VERIFY #2 by sidestep — threads never needed). 1.0.5 ships no .d.ts, so the surface
 * below is the empirically-probed shape of that exact version (see DECISIONS 2026-07-10): no GPS
 * block, no thumbnailData()/dispose(), metadata DOES include width/height + camera_make/camera_model.
 */

declare module "libraw-wasm" {
  /** dcraw-style processing settings (subset we use; full list in the package readme). */
  export interface LibRawSettings {
    /** Use the camera's recorded white balance (`-w`). */
    useCameraWb?: boolean;
    /** Output at half size — skips demosaic via 2×2 binning; ~2.5× faster, kinder to mobile heaps (`-h`). */
    halfSize?: boolean;
    /** Bits per sample, 8 or 16 (`-4`). */
    outputBps?: number;
    /** Interpolation quality 0..12 (`-q`), only relevant when not halfSize. */
    userQual?: number;
  }

  /** metadata() as returned by the 1.0.5 wasm (probed; no GPS in this version). */
  export interface LibRawFileMetadata {
    width: number;
    height: number;
    raw_width: number;
    raw_height: number;
    top_margin: number;
    left_margin: number;
    camera_make: string;
    camera_model: string;
    iso_speed: number;
    /** Exposure time in seconds. */
    shutter: number;
    aperture: number;
    focal_len: number;
    /** Capture time, unix seconds (NOT converted to Date in 1.0.5). */
    timestamp: number;
    shot_order: number;
    desc: string;
    artist: string;
    thumb_width: number;
    thumb_height: number;
    thumb_format: string;
  }

  export interface LibRawProcessedImage {
    width: number;
    height: number;
    colors: number;
    bits: number;
    dataSize: number;
    data: Uint8Array | Uint16Array;
  }

  export default class LibRaw {
    /** Opens AND unpacks the RAW buffer (the long pole — ~3.4 s for a 26 MP compressed ARW). */
    open(bytes: Uint8Array, settings?: LibRawSettings): Promise<void>;
    metadata(fullOutput?: boolean): Promise<LibRawFileMetadata | undefined>;
    /** Runs dcraw processing and returns interleaved pixels. */
    imageData(): Promise<LibRawProcessedImage | undefined>;
  }
}

declare module "libraw-wasm/dist/libraw.wasm?url" {
  const url: string;
  export default url;
}

declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    /** Fills `target.data` with RGBA and calls back with it (null on failure). */
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (filled: unknown) => void,
    ): void;
    free?(): void;
  }
  export interface LibHeif {
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
  }
  /** Emscripten module factory — the wasm binary is inlined in the bundle (no asset pathing). */
  const factory: () => Promise<LibHeif>;
  export default factory;
}
