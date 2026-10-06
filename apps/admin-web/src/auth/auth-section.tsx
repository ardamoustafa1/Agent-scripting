import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AuthApiError,
  type AuthSession,
  breakGlassLogin,
  discover,
  fetchSession,
  loginUrl,
  logout,
  takeAuthError,
} from './auth-api.js';

const SESSION_KEY = ['auth-session'];

const errorKey = (error: unknown) => {
  const code = error instanceof AuthApiError ? error.code : '';
  if (code === 'VERBIS_AUTH_TENANT_UNKNOWN') return 'admin.auth.error.unknownDomain';
  if (code === 'VERBIS_AUTH_INVALID_CREDENTIALS') return 'admin.auth.error.invalidCredentials';
  if (code === 'VERBIS_AUTH_ORIGIN_NOT_ALLOWED' || code === 'VERBIS_AUTH_BREAK_GLASS_DISABLED')
    return 'admin.auth.error.breakGlassUnavailable';
  if (code === 'VERBIS_HTTP_RATE_LIMITED') return 'admin.auth.error.rateLimited';
  return 'admin.auth.error.generic';
};

function SignedIn({ session }: { session: AuthSession }) {
  const { t, i18n } = useTranslation();
  const signOut = useMutation({
    mutationFn: () => logout(session.csrfToken),
    onSuccess: (redirectUrl) => {
      window.location.assign(redirectUrl);
    },
  });
  const expires = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(session.session.expiresAt));
  return (
    <div className="vb-stack">
      <p role="status">
        {t(
          session.user.authMethod === 'break_glass'
            ? 'admin.auth.signedInBreakGlass'
            : 'admin.auth.signedIn',
        )}
      </p>
      <p>{t('admin.auth.expires', { time: expires })}</p>
      <button
        className="vb-button"
        data-variant="secondary"
        type="button"
        disabled={signOut.isPending}
        onClick={() => {
          signOut.mutate();
        }}
      >
        {t('admin.auth.signOut')}
      </button>
      {signOut.isError ? (
        <p className="vb-alert" role="alert">
          {t('admin.auth.error.generic')}
        </p>
      ) : null}
    </div>
  );
}

function BreakGlassForm() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const id = useId();
  const [values, setValues] = useState({ tenant: '', email: '', password: '', code: '' });
  const mutation = useMutation({
    mutationFn: () => breakGlassLogin(values),
    onSuccess: () => client.invalidateQueries({ queryKey: SESSION_KEY }),
  });
  const field = (
    name: keyof typeof values,
    type: string,
    autoComplete: string,
    inputMode?: 'numeric',
  ) => (
    <label className="vb-form-field" htmlFor={`${id}-${name}`}>
      {t(`admin.auth.breakGlass.${name}`)}
      <input
        id={`${id}-${name}`}
        className="vb-input"
        type={type}
        required
        autoComplete={autoComplete}
        {...(inputMode === undefined ? {} : { inputMode, pattern: '[0-9]{6}', maxLength: 6 })}
        value={values[name]}
        onChange={(event) => {
          setValues({ ...values, [name]: event.target.value });
        }}
      />
    </label>
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate();
  };
  return (
    <details>
      <summary>{t('admin.auth.breakGlass.toggle')}</summary>
      <form className="vb-stack" onSubmit={submit} aria-describedby={`${id}-hint`}>
        <p id={`${id}-hint`}>{t('admin.auth.breakGlass.hint')}</p>
        {field('tenant', 'text', 'organization')}
        {field('email', 'email', 'username')}
        {field('password', 'password', 'current-password')}
        {field('code', 'text', 'one-time-code', 'numeric')}
        <button className="vb-button" type="submit" disabled={mutation.isPending}>
          {t('admin.auth.breakGlass.submit')}
        </button>
        {mutation.isError ? (
          <p className="vb-alert" role="alert">
            {t(errorKey(mutation.error))}
          </p>
        ) : null}
      </form>
    </details>
  );
}

function SignIn({ initialError }: { initialError: string | null }) {
  const { t } = useTranslation();
  const id = useId();
  const [email, setEmail] = useState('');
  const mutation = useMutation({ mutationFn: discover });
  const discovery = mutation.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mutation.isPending) mutation.mutate(email);
  };
  return (
    <div className="vb-stack">
      {initialError === null ? null : (
        <p className="vb-alert" role="alert">
          {t(`admin.auth.ssoError.${initialError}`)}
        </p>
      )}
      <form className="vb-stack" onSubmit={submit}>
        <label className="vb-form-field" htmlFor={`${id}-email`}>
          {t('admin.auth.email')}
          <input
            id={`${id}-email`}
            className="vb-input"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              mutation.reset();
            }}
          />
        </label>
        <button className="vb-button" type="submit" disabled={mutation.isPending}>
          {t('admin.auth.continue')}
        </button>
        {mutation.isError ? (
          <p className="vb-alert" role="alert">
            {t(errorKey(mutation.error))}
          </p>
        ) : null}
      </form>
      {discovery === undefined ? null : (
        <nav aria-label={t('admin.auth.providers')}>
          <ul className="vb-stack">
            {discovery.providers.map((provider) => (
              <li key={provider.id}>
                <a className="vb-button" href={loginUrl(discovery.tenant, provider.id)}>
                  {t('admin.auth.signInWith', { provider: provider.displayName })}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <BreakGlassForm />
    </div>
  );
}

/** Sign-in state of the admin app (BFF cookie session). */
export function AuthSection({ title }: { readonly title?: string } = {}) {
  const { t } = useTranslation();
  const [initialError] = useState(takeAuthError);
  const session = useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, retry: false });
  return (
    <section className="vb-card" aria-labelledby="auth-title">
      <h2 id="auth-title">{title ?? t('admin.auth.title')}</h2>
      {session.isPending ? (
        <p role="status">{t('admin.auth.checking')}</p>
      ) : session.isError ? (
        <div className="vb-stack">
          <p className="vb-alert" role="alert">
            {t('admin.auth.error.generic')}
          </p>
          <button className="vb-button" type="button" onClick={() => void session.refetch()}>
            {t('adminWorkspace.retry')}
          </button>
        </div>
      ) : session.data ? (
        <SignedIn session={session.data} />
      ) : (
        <SignIn initialError={initialError} />
      )}
    </section>
  );
}
