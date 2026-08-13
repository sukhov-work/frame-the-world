/**
 * MobileShell — the /m chrome (MOBILE_PLAN §3; M0 = minimal).
 *
 * M0 renders only the safe-area-padded status strip over the full-bleed globe; M1 grows the tab
 * bar + bottom sheets here. Discipline (MOBILE_PLAN §2): this shell consumes stores + `lib/**`
 * ONLY — it never imports desktop panels, and desktop never imports from `components/mobile/**`
 * (the two-shell drift guard). Heavy sky/catalog modules stay dynamic-import-only
 * (lazyContract.test.ts walks all of src/).
 */
export default function MobileShell() {
  return (
    <div className="m-status">
      <span className="m-title">Frame&nbsp;the&nbsp;World</span>
      <a className="m-chip" href="/">
        DESKTOP
      </a>
    </div>
  );
}
