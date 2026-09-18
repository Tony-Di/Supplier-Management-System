import logo from "./assets/seg-logo-white.svg";

function MicrosoftMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 23 23" aria-hidden="true" className="signInMsMark">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

export function SignIn({ deactivated }: { deactivated: boolean }) {
  return (
    <div className="signInLayout">
      <aside className="signInBrand">
        <div className="signInRail signInRail1"><span></span></div>
        <div className="signInRail signInRail2"><span></span></div>
        <div className="signInRail signInRail3"><span></span></div>
        <svg className="signInGrid" width="520" height="520" viewBox="0 0 520 520">
          <g fill="none" stroke="var(--seg-red)" strokeWidth="2">
            <rect x="60" y="120" width="400" height="280"></rect>
            <path d="M60 190h400M60 260h400M60 330h400"></path>
            <path d="M160 120v280M260 120v280M360 120v280"></path>
          </g>
        </svg>
        <img src={logo} alt="SEG Solar" className="signInLogo" />
        <div>
          <h1 className="signInTitle">Global<br />Sourcing</h1>
          <div className="signInRule" />
          <p className="signInLead">Packaging supplier development, quoting, sample QC and pricing for solar module production.</p>
        </div>
        <div className="signInFoot">Internal system · Authorized users only</div>
      </aside>
      <main className="signInPanel">
        <div className="signInForm">
          <h2 className="signInHeading">Sign in</h2>
          <p className="signInSub">Use the SEG account you sign in to Outlook with.</p>
          <a className="signInButton" href="/api/auth/login">
            <MicrosoftMark />
            <span>Sign in with your SEG account</span>
          </a>
          <p className="signInNote">
            No separate password for this system. Access follows your Microsoft account — if it is disabled, so is this.
          </p>
          {deactivated && (
            <div className="signInDeactivated">
              <div className="signInDeactivatedTitle">Access turned off</div>
              <div className="signInDeactivatedBody">This account has been deactivated. Contact the sourcing system administrator.</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
