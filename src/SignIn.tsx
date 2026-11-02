import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CircleAlert, Eye, EyeOff, Lock, MailCheck } from "lucide-react";

import logo from "./assets/seg-logo-white.svg";
import {
  checkPasswordLink,
  fetchSignInOptions,
  passwordSignIn,
  requestPasswordChange,
  requestPasswordLink,
  requestSignUpLink,
  setPasswordFromLink,
  SignInError,
  type PasswordLinkInfo,
  type SignInOptions,
} from "./api";
import { emailDomainList, emailDomainProblem, MAX_SIGN_IN_ATTEMPTS, newPasswordProblem, passwordLinkToken, PASSWORD_MAX_LENGTH } from "./lib/passwordSignIn";

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

/** `signedIn`: the user opened an emailed password link while signed in, to change their password. */
export function SignIn({ deactivated, signedIn = false }: { deactivated: boolean; signedIn?: boolean }) {
  const [options, setOptions] = useState<SignInOptions | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    fetchSignInOptions().then(setOptions).catch(() => setUnreachable(true));
  }, []);

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
        {unreachable ? (
          <div className="signInForm">
            <h2 className="signInHeading">Sign in</h2>
            <Alert title="Cannot reach the server">Reload the page to try again.</Alert>
          </div>
        ) : !options ? (
          <div className="signInForm" aria-busy="true" />
        ) : options.mode === "password" ? (
          <PasswordSignIn domains={options.signUpDomains} signedIn={signedIn} />
        ) : (
          <MicrosoftSignIn deactivated={deactivated} />
        )}
      </main>
    </div>
  );
}

function MicrosoftSignIn({ deactivated }: { deactivated: boolean }) {
  return (
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
        <Alert title="Access turned off">This account has been deactivated. Contact the sourcing system administrator.</Alert>
      )}
    </div>
  );
}

function Alert({ title, children, className = "" }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`signInDeactivated ${className}`.trim()} role="alert">
      <div className="signInDeactivatedTitle">{title}</div>
      {children && <div className="signInDeactivatedBody">{children}</div>}
    </div>
  );
}

type View =
  | { name: "signIn" }
  | { name: "signUp" }
  | { name: "forgot" }
  | { name: "sent"; email: string }
  | { name: "setPassword"; token: string };

function clearLinkFromAddress() {
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Email and password sign-in (AUTH_MODE=password), with sign-up and password reset by emailed link. */
function PasswordSignIn({ domains, signedIn }: { domains: string[]; signedIn: boolean }) {
  const [email, setEmail] = useState("");
  const [view, setView] = useState<View>(() => {
    const token = passwordLinkToken(window.location.hash);
    return token ? { name: "setPassword", token } : { name: "signIn" };
  });

  // A link opened in a tab that already shows this page only changes the hash.
  useEffect(() => {
    function openLink() {
      const token = passwordLinkToken(window.location.hash);
      if (token) setView({ name: "setPassword", token });
    }
    window.addEventListener("hashchange", openLink);
    return () => window.removeEventListener("hashchange", openLink);
  }, []);

  function show(next: View) {
    if (view.name === "setPassword") clearLinkFromAddress();
    setView(next);
  }

  // Signed in, the way back is the app itself, and a new link goes to the user's own address.
  const back = signedIn ? () => window.location.replace("/") : () => show({ name: "signIn" });
  const sent = (address: string) => show({ name: "sent", email: address });
  const newLink = signedIn
    ? async () => sent((await requestPasswordChange()).email)
    : () => show({ name: "forgot" });

  switch (view.name) {
    case "signIn":
      return <PasswordForm email={email} onEmail={setEmail} onSignUp={() => show({ name: "signUp" })} onForgot={() => show({ name: "forgot" })} />;
    case "signUp":
      return <SignUpForm domains={domains} email={email} onEmail={setEmail} onBack={back} onSent={sent} />;
    case "forgot":
      return <ForgotForm domains={domains} email={email} onEmail={setEmail} onBack={back} onSent={sent} />;
    case "sent":
      return <LinkSent email={view.email} onBack={back} backLabel={signedIn ? "Back to Global Sourcing" : undefined} />;
    case "setPassword":
      return <SetPasswordForm token={view.token} onBack={back} backLabel={signedIn ? "Back to Global Sourcing" : undefined} onNewLink={newLink} />;
  }
}

function PasswordForm({ email, onEmail, onSignUp, onForgot }: { email: string; onEmail: (value: string) => void; onSignUp: () => void; onForgot: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState(0);
  const [lockedFor, setLockedFor] = useState(0);
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = window.setTimeout(() => {
      setLockedFor((seconds) => seconds - 1);
      if (lockedFor === 1) { setFailures(0); setError(""); }
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [lockedFor]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || lockedFor > 0) return;
    setBusy(true);
    setError("");
    try {
      await passwordSignIn(email.trim(), password);
      window.location.replace("/");
      return;
    } catch (requestError) {
      if (requestError instanceof SignInError && requestError.status === 429) {
        setLockedFor(requestError.retryAfterSeconds || 60);
      } else {
        if (requestError instanceof SignInError && requestError.status === 401) setFailures((count) => Math.min(count + 1, MAX_SIGN_IN_ATTEMPTS));
        setError(messageOf(requestError));
        setShake((count) => count + 1);
      }
    }
    setBusy(false);
  }

  const attemptsLeft = MAX_SIGN_IN_ATTEMPTS - failures;
  return (
    <div className="signInForm">
      <h2 className="signInHeading">Sign in</h2>
      <p className="signInSub">Use your SEG email address — the one you use in Outlook — and the password you set for this system.</p>
      {lockedFor > 0 ? (
        <Alert title="Too many attempts" className="signInFormAlert">Wait {lockedFor} second{lockedFor === 1 ? "" : "s"}, then try again, or reset your password.</Alert>
      ) : error ? (
        <div className="signInDeactivated signInFormAlert signInShake" role="alert" key={shake}>
          <div className="signInDeactivatedTitle">{error}</div>
          {failures > 0 && (
            <>
              <div className="signInAttempts" aria-hidden="true">
                {Array.from({ length: MAX_SIGN_IN_ATTEMPTS }, (_, index) => <span key={index} className={index < attemptsLeft ? "isLeft" : ""} />)}
              </div>
              <div className="signInDeactivatedBody">{attemptsLeft} attempt{attemptsLeft === 1 ? "" : "s"} left before a one-minute lock.</div>
            </>
          )}
        </div>
      ) : null}
      <form className="signInFields" onSubmit={submit} noValidate>
        <label className="signInLabel">
          <span>Email</span>
          <input className="signInInput" type="email" name="email" autoComplete="username" autoFocus required value={email} onChange={(event) => onEmail(event.target.value)} placeholder="name@segsolar.com" />
        </label>
        <div className="signInLabel">
          <span className="signInLabelRow">
            <label htmlFor="sign-in-password">Password</label>
            <button className="signInLink" type="button" onClick={onForgot}>Forgot password?</button>
          </span>
          <PasswordInput id="sign-in-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <button className="signInSubmit" type="submit" disabled={busy || lockedFor > 0 || !email.trim() || !password}>
          <Lock size={15} aria-hidden="true" />
          <span>{busy ? "Signing in…" : lockedFor > 0 ? `Locked (${lockedFor}s)` : "Sign in"}</span>
        </button>
      </form>
      <p className="signInSwitch">
        New to Global Sourcing? <button className="signInLink" type="button" onClick={onSignUp}>Create an account</button>
      </p>
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="signInPasswordWrap">
      <input id={id} className="signInInput" type={visible ? "text" : "password"} autoComplete={autoComplete} maxLength={PASSWORD_MAX_LENGTH} required value={value} onChange={(event) => onChange(event.target.value)} />
      <button className="signInReveal" type="button" onClick={() => setVisible((shown) => !shown)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>
        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
      </button>
    </span>
  );
}

function BackLink({ onBack, label = "Back to sign in" }: { onBack: () => void; label?: string }) {
  return (
    <button className="signInLink signInBack" type="button" onClick={onBack}>
      <ArrowLeft size={14} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="signInFieldError" role="alert">
      <CircleAlert size={14} aria-hidden="true" />
      <span>{message}</span>
    </p>
  );
}

interface LinkRequestProps {
  domains: string[];
  email: string;
  onEmail: (value: string) => void;
  onBack: () => void;
  onSent: (email: string) => void;
}

function SignUpForm({ domains, email, onEmail, onBack, onSent }: LinkRequestProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = !name.trim() ? "Enter your name." : emailDomainProblem(email, domains);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await requestSignUpLink(name.trim(), email.trim());
      onSent(email.trim());
    } catch (requestError) {
      setError(messageOf(requestError));
      setBusy(false);
    }
  }

  return (
    <div className="signInForm">
      <BackLink onBack={onBack} />
      <h2 className="signInHeading">Create account</h2>
      <p className="signInSub">We will email a link to your SEG mailbox in Outlook. Open it to set your password.</p>
      <form className="signInFields" onSubmit={submit} noValidate>
        <label className="signInLabel">
          <span>Name</span>
          <input className="signInInput" name="name" autoComplete="name" autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="First and last name" />
        </label>
        <label className="signInLabel">
          <span>Work email</span>
          <input className="signInInput" type="email" name="email" autoComplete="email" value={email} onChange={(event) => onEmail(event.target.value)} placeholder={domains[0] ? `name@${domains[0]}` : "name@segsolar.com"} />
          {domains.length > 0 && <small className="signInHint">Only {emailDomainList(domains)} addresses can create an account.</small>}
        </label>
        <FormError message={error} />
        <button className="signInSubmit" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a link"}</button>
      </form>
    </div>
  );
}

function ForgotForm({ domains, email, onEmail, onBack, onSent }: LinkRequestProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = emailDomainProblem(email, domains);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await requestPasswordLink(email.trim());
      onSent(email.trim());
    } catch (requestError) {
      setError(messageOf(requestError));
      setBusy(false);
    }
  }

  return (
    <div className="signInForm">
      <BackLink onBack={onBack} />
      <h2 className="signInHeading">Reset password</h2>
      <p className="signInSub">Enter your SEG email address. We will email you a link to choose a new password.</p>
      <form className="signInFields" onSubmit={submit} noValidate>
        <label className="signInLabel">
          <span>Work email</span>
          <input className="signInInput" type="email" name="email" autoComplete="email" autoFocus value={email} onChange={(event) => onEmail(event.target.value)} placeholder={domains[0] ? `name@${domains[0]}` : "name@segsolar.com"} />
        </label>
        <FormError message={error} />
        <button className="signInSubmit" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a link"}</button>
      </form>
    </div>
  );
}

function LinkSent({ email, onBack, backLabel }: { email: string; onBack: () => void; backLabel?: string }) {
  return (
    <div className="signInForm">
      <MailCheck className="signInSentIcon" size={34} aria-hidden="true" />
      <h2 className="signInHeading">Check your inbox</h2>
      <p className="signInSub">
        If <strong>{email}</strong> can use this system, an email with a link is on its way. The link works once and expires in 60 minutes.
      </p>
      <p className="signInNote">Nothing after a few minutes? Look in Outlook's Junk Email folder, then ask for a new link.</p>
      <p className="signInSwitch"><BackLink onBack={onBack} label={backLabel} /></p>
    </div>
  );
}

function SetPasswordForm({ token, onBack, backLabel, onNewLink }: { token: string; onBack: () => void; backLabel?: string; onNewLink: () => void | Promise<void> }) {
  const [link, setLink] = useState<PasswordLinkInfo | null>(null);
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    checkPasswordLink(token)
      .then((info) => { if (!cancelled) setLink(info); })
      .catch((requestError) => { if (!cancelled) setLinkError(messageOf(requestError)); });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = newPasswordProblem(password, confirmation);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      await setPasswordFromLink(token, password);
      window.location.replace("/");
      return;
    } catch (requestError) {
      setError(messageOf(requestError));
      setBusy(false);
    }
  }

  async function askForNewLink() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onNewLink();
    } catch (requestError) {
      setError(messageOf(requestError));
      setBusy(false);
    }
  }

  if (linkError) {
    return (
      <div className="signInForm">
        <BackLink onBack={onBack} label={backLabel} />
        <h2 className="signInHeading">Link not valid</h2>
        <Alert title={linkError} />
        <button className="signInSubmit signInSpaced" type="button" disabled={busy} onClick={() => void askForNewLink()}>{busy ? "Sending…" : "Email me a new link"}</button>
        <FormError message={error} />
      </div>
    );
  }

  if (!link) return <div className="signInForm" aria-busy="true"><p className="signInSub">Checking your link…</p></div>;

  return (
    <div className="signInForm">
      <BackLink onBack={onBack} label={backLabel} />
      <h2 className="signInHeading">{link.newAccount ? "Set your password" : "Choose a new password"}</h2>
      <p className="signInSub">
        {link.newAccount ? `Welcome${link.name ? `, ${link.name}` : ""}. ` : ""}This password is for Global Sourcing only — it does not change your Outlook password.
      </p>
      <form className="signInFields" onSubmit={submit} noValidate>
        <label className="signInLabel">
          <span>Email</span>
          <input className="signInInput" type="email" name="email" autoComplete="username" value={link.email} readOnly />
        </label>
        <div className="signInLabel">
          <label htmlFor="new-password">New password</label>
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
          <small className="signInHint">At least 8 characters.</small>
        </div>
        <div className="signInLabel">
          <label htmlFor="confirm-password">Confirm password</label>
          <PasswordInput id="confirm-password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" />
        </div>
        <FormError message={error} />
        <button className="signInSubmit" type="submit" disabled={busy}>{busy ? "Saving…" : link.newAccount ? "Create account and sign in" : "Save and sign in"}</button>
      </form>
    </div>
  );
}
