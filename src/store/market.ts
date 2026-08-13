import { create } from "zustand";

/**
 * Marketplace-light flow state (Phase 6) — drives the LIST/UNLIST controls on an OWN pin and the
 * BUY control on a FOREIGN public pin in PhotoDetailPanel.
 *
 *  • listForSale / unlist run against the elevated /api/listings endpoint (owner-gated server-side)
 *    and flip `useUploadStore.listing` so the panel updates without a reopen; the globe pins refresh
 *    so buyer-facing surfaces (the PinHoverCard price chip, the MARKETPLACE panel, the detail
 *    panel's BUY) pick the listing up. The globe pin mesh itself draws no for-sale variant.
 *  • buy runs CLIENT-SIDE in the buyer's own member/visitor identity (NOT elevated): create an eCom
 *    checkout for the single digital line item, then a Wix redirect session → the hosted checkout.
 *    The return URL carries ?purchased=1 (the Marketplace island shows the acknowledgment toast);
 *    on payment a preinstalled Stores automation emails the 30-day download link (mem:project/
 *    wip-2026-07-16-phase6-marketplace-research). SDK modules are lazy imports (globe bundle stays clean).
 */

import { STORES_APP_ID } from "../lib/market/listing";
import { postListing, deleteListing } from "../lib/save/uploadMedia";
import { useUploadStore } from "./upload";

export type MarketPhase = "idle" | "listing" | "unlisting" | "buying" | "error";

export interface MarketState {
  phase: MarketPhase;
  error?: string;
  /** List the viewed OWN pin for sale at `priceAmount` (site currency units). */
  listForSale: (priceAmount: number) => Promise<void>;
  /** Unlist the viewed OWN pin (removes its Stores product). */
  unlist: () => Promise<void>;
  /** Buy the viewed FOREIGN pin — redirects the browser to the Wix-hosted checkout. */
  buy: () => Promise<void>;
  reset: () => void;
}

async function refreshPins(): Promise<void> {
  const { usePinsStore } = await import("./pins");
  usePinsStore.getState().refresh();
}

export const useMarketStore = create<MarketState>((set, get) => ({
  phase: "idle",

  listForSale: async (priceAmount) => {
    if (get().phase === "listing") return;
    const u = useUploadStore.getState();
    const photoId = u.ownPhotoId;
    if (!photoId) {
      set({ phase: "error", error: "no own pin in view to list" });
      return;
    }
    if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
      set({ phase: "error", error: "enter a price above 0" });
      return;
    }
    set({ phase: "listing", error: undefined });
    try {
      const res = await postListing(photoId, priceAmount);
      useUploadStore.setState({
        listing: {
          productId: res.productId,
          variantId: res.productVariantId,
          priceAmount: res.priceAmount,
          currency: res.currency,
        },
      });
      set({ phase: "idle" });
      void refreshPins();
    } catch (e) {
      set({ phase: "error", error: e instanceof Error ? e.message : "listing failed" });
    }
  },

  unlist: async () => {
    if (get().phase === "unlisting") return;
    const photoId = useUploadStore.getState().ownPhotoId;
    if (!photoId) {
      set({ phase: "error", error: "no own pin in view to unlist" });
      return;
    }
    set({ phase: "unlisting", error: undefined });
    try {
      await deleteListing(photoId);
      useUploadStore.setState({ listing: null });
      set({ phase: "idle" });
      void refreshPins();
    } catch (e) {
      set({ phase: "error", error: e instanceof Error ? e.message : "unlist failed" });
    }
  },

  buy: async () => {
    if (get().phase === "buying") return;
    const listing = useUploadStore.getState().listing;
    const productId = listing?.productId;
    if (!productId) {
      set({ phase: "error", error: "this pin is not for sale" });
      return;
    }
    set({ phase: "buying", error: undefined });
    try {
      const [{ checkout }, { redirects }] = await Promise.all([
        import("@wix/ecom"),
        import("@wix/redirects"),
      ]);
      // A V3 Stores product resolves to a line item ONLY via options.variantId — productId alone
      // yields an empty checkout (verified against the live gateway 2026-07-16). Guard, never
      // degrade silently (audit B5): a variantId-less listing would check out EMPTY.
      if (!listing?.variantId) {
        set({ phase: "error", error: "listing is missing its variant — relist the pin to fix it" });
        return;
      }
      const catalogReference: { appId: string; catalogItemId: string; options?: { variantId: string } } = {
        appId: STORES_APP_ID,
        catalogItemId: productId,
        options: { variantId: listing.variantId },
      };
      const co = await checkout.createCheckout({
        lineItems: [{ quantity: 1, catalogReference }],
        channelType: "WEB",
      });
      const checkoutId = co?._id;
      if (!checkoutId) throw new Error("checkout not created");
      // COMPLETED checkouts return via thankYouPageUrl with ?purchased=1 (the Marketplace island
      // turns it into the "check your email" toast; URL keeps the query BEFORE the #p= pose hash).
      // postFlowUrl is the catch-all — abandoned/interrupted flows land back WITHOUT the param.
      const thankYouUrl = new URL(window.location.href);
      thankYouUrl.searchParams.set("purchased", "1");
      const { redirectSession } = await redirects.createRedirectSession({
        ecomCheckout: { checkoutId },
        callbacks: {
          postFlowUrl: window.location.href,
          thankYouPageUrl: thankYouUrl.toString(),
        },
      });
      const fullUrl = redirectSession?.fullUrl;
      if (fullUrl && typeof window !== "undefined") {
        window.location.href = fullUrl;
      } else {
        throw new Error("no redirect url from Wix");
      }
    } catch (e) {
      set({ phase: "error", error: e instanceof Error ? e.message : "could not start checkout" });
    }
  },

  reset: () => set({ phase: "idle", error: undefined }),
}));

// DEV convenience (mirrors the other stores).
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  window.__marketStore = useMarketStore;
}
