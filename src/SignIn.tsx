import logo from "./assets/seg-logo-white.svg";

export function SignIn({ deactivated }: { deactivated: boolean }) {
  return (
    <div className="signInLayout">
      <aside className="signInBrand">
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
          {deactivated && (
            <div className="notice errorNotice">
              <strong>Access turned off.</strong> This account has been deactivated. Contact the sourcing system administrator.
            </div>
          )}
          <a className="signInButton" href="/api/auth/login">Sign in with your SEG account</a>
          <p className="signInNote">
            No separate password for this system. Access follows your Microsoft account — if it is disabled, so is this.
          </p>
        </div>
      </main>
    </div>
  );
}
