import { GOALS, type Preferences } from '@ovl/shared';
import {
  applyTheme,
  Avatar,
  ErrorAlert,
  Field,
  getThemePreference,
  Icon,
  Logo,
  ThemeGallery,
  type IconName,
} from '@ovl/ui';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useMe } from '../auth';
import { enableNotifications, notificationsSupported } from '../notifications';

type Goal = (typeof GOALS)[number];

const GOAL_INFO: Record<Goal, { icon: IconName; title: string; text: string; to: string; cta: string }> = {
  company: {
    icon: 'building',
    title: 'Register a company',
    text: 'Business account, license and an optional stock listing.',
    to: '/applications?new=company',
    cta: 'Start a company application',
  },
  invest: {
    icon: 'chart',
    title: 'Invest in companies',
    text: 'Buy shares on the exchange and follow your portfolio.',
    to: '/exchange',
    cta: 'Open the exchange',
  },
  license: {
    icon: 'award',
    title: 'Get a license',
    text: 'Projects, channels, websites, virtual countries…',
    to: '/applications?new=license',
    cta: 'Request a license',
  },
  chat: {
    icon: 'chat',
    title: 'Talk to partners',
    text: 'Direct chats and groups with your contacts.',
    to: '/contacts',
    cta: 'Find people',
  },
  channel: {
    icon: 'channel',
    title: 'Run a news channel',
    text: 'Publish updates to your subscribers.',
    to: '/applications?new=news_channel',
    cta: 'Apply for a channel',
  },
  staff: {
    icon: 'shield',
    title: 'Join the staff',
    text: 'Moderation team or the council.',
    to: '/applications',
    cta: 'See staff applications',
  },
};

const STEPS = ['welcome', 'theme', 'profile', 'goals', 'notifications', 'done'] as const;
type Step = (typeof STEPS)[number];

const ease = [0.22, 1, 0.36, 1] as const;

export function OnboardingPage() {
  const me = useMe();
  const { updatePreferences } = useAuth();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [theme, setTheme] = useState(me.preferences.theme ?? getThemePreference());
  const [profile, setProfile] = useState({
    displayName: me.displayName,
    bio: me.bio,
    avatarUrl: me.avatarUrl ?? '',
  });
  const [goals, setGoals] = useState<Goal[]>(me.preferences.goals ?? []);
  const [notify, setNotify] = useState<'idle' | 'on' | 'blocked'>('idle');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const step: Step = STEPS[index]!;

  const go = (delta: number) => {
    setDirection(delta);
    setIndex((i) => Math.max(0, Math.min(STEPS.length - 1, i + delta)));
  };

  const saveProfileAndContinue = async () => {
    setError(null);
    try {
      await api.me.update({
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl.trim() || null,
      });
      go(1);
    } catch (e) {
      setError(e);
    }
  };

  const finish = async (target = '/home') => {
    setSaving(true);
    const patch: Preferences = { onboardingCompleted: true, goals, theme };
    try {
      // Navigate first: saving swaps this page for the app, and a navigate() from an
      // unmounted page is ignored. The tour stays on screen until the save lands.
      navigate(target);
      await updatePreferences(patch);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  return (
    <div className="oobe">
      <div className="mesh soft">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
      </div>
      <div className="oobe-top">
        <div className="row">
          <Logo size={30} />
          <b className="display">OVL For Business</b>
        </div>
        {step !== 'done' && (
          <button className="btn ghost sm" onClick={() => finish()} disabled={saving}>
            Skip setup
          </button>
        )}
      </div>
      <div className="oobe-progress" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
        <motion.span
          animate={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.5, ease }}
        />
      </div>

      <div className="oobe-stage">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.section
            key={step}
            className="oobe-card"
            custom={direction}
            initial={{ opacity: 0, x: direction * 60, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: direction * -60, scale: 0.98 }}
            transition={{ duration: 0.4, ease }}
          >
            <ErrorAlert error={error} />

            {step === 'welcome' && (
              <div className="stack-lg center-text">
                <motion.div
                  className="oobe-hero-logo"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 14 }}
                >
                  <Logo size={88} animated />
                </motion.div>
                <div className="stack-sm">
                  <h1>Welcome, {me.displayName.split(' ')[0]}!</h1>
                  <p className="muted">Let’s set up your workspace. It takes less than a minute.</p>
                </div>
                <div className="grid-3 oobe-highlights">
                  {[
                    { icon: 'wallet' as const, title: 'Balances', text: 'Any currency, one place' },
                    { icon: 'building' as const, title: 'Companies', text: 'Register and grow' },
                    { icon: 'chat' as const, title: 'Chats', text: 'Partners, groups, channels' },
                  ].map((f, i) => (
                    <motion.div
                      key={f.title}
                      className="card flat stack-sm"
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
                    >
                      <span className="kpi-icon" style={{ alignSelf: 'center' }}>
                        <Icon name={f.icon} size={18} />
                      </span>
                      <b>{f.title}</b>
                      <span className="small muted">{f.text}</span>
                    </motion.div>
                  ))}
                </div>
                <button className="btn gradient lg" style={{ alignSelf: 'center' }} onClick={() => go(1)}>
                  Get started <Icon name="arrowRight" size={18} />
                </button>
              </div>
            )}

            {step === 'theme' && (
              <div className="stack-lg">
                <div className="stack-sm">
                  <span className="section-title">
                    <Icon name="palette" size={14} /> Appearance
                  </span>
                  <h2>Pick your look</h2>
                  <p className="muted">
                    Themes follow your account to every device. You can change it any time in Settings.
                  </p>
                </div>
                <ThemeGallery
                  value={theme}
                  onChange={(id, origin) => {
                    setTheme(id);
                    applyTheme(id, { origin });
                  }}
                />
                <StepButtons onBack={() => go(-1)} onNext={() => go(1)} />
              </div>
            )}

            {step === 'profile' && (
              <div className="stack-lg">
                <div className="stack-sm">
                  <span className="section-title">
                    <Icon name="user" size={14} /> Profile
                  </span>
                  <h2>How others see you</h2>
                  <p className="muted">Your name and badges appear in chats, contacts and the registry.</p>
                </div>
                <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
                  <motion.div
                    key={profile.displayName + profile.avatarUrl}
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                  >
                    <Avatar
                      name={profile.displayName || me.username}
                      url={profile.avatarUrl || null}
                      size={84}
                    />
                  </motion.div>
                  <div className="grow stack">
                    <Field label="Display name">
                      <input
                        className="input"
                        value={profile.displayName}
                        maxLength={64}
                        onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
                      />
                    </Field>
                    <Field label="About you (optional)">
                      <textarea
                        className="textarea"
                        maxLength={500}
                        placeholder="Founder of…, investor in…, moderator of…"
                        value={profile.bio}
                        onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                      />
                    </Field>
                    <Field label="Avatar image URL (optional)">
                      <input
                        className="input"
                        type="url"
                        value={profile.avatarUrl}
                        onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
                <StepButtons
                  onBack={() => go(-1)}
                  onNext={saveProfileAndContinue}
                  nextDisabled={!profile.displayName.trim()}
                />
              </div>
            )}

            {step === 'goals' && (
              <div className="stack-lg">
                <div className="stack-sm">
                  <span className="section-title">
                    <Icon name="sparkles" size={14} /> Goals
                  </span>
                  <h2>What brings you here?</h2>
                  <p className="muted">
                    Pick as many as you like — we will put the right shortcuts on your home screen.
                  </p>
                </div>
                <div className="grid-3">
                  {GOALS.map((g, i) => {
                    const info = GOAL_INFO[g];
                    const selected = goals.includes(g);
                    return (
                      <motion.button
                        key={g}
                        type="button"
                        className={`goal-card${selected ? ' selected' : ''}`}
                        aria-pressed={selected}
                        onClick={() => setGoals(selected ? goals.filter((x) => x !== g) : [...goals, g])}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        whileTap={{ scale: 0.97 }}
                      >
                        <span className="goal-icon">
                          <Icon name={info.icon} size={20} />
                        </span>
                        <b>{info.title}</b>
                        <span className="small muted">{info.text}</span>
                        <AnimatePresence>
                          {selected && (
                            <motion.span
                              className="goal-check"
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              exit={{ scale: 0 }}
                            >
                              <Icon name="check" size={13} />
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.button>
                    );
                  })}
                </div>
                <StepButtons onBack={() => go(-1)} onNext={() => go(1)} />
              </div>
            )}

            {step === 'notifications' && (
              <div className="stack-lg center-text">
                <motion.div
                  className="bell-illustration"
                  animate={{ rotate: [0, -14, 12, -8, 6, 0] }}
                  transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.8 }}
                >
                  <Icon name="bell" size={40} />
                </motion.div>
                <div className="stack-sm">
                  <h2>Stay in the loop</h2>
                  <p className="muted">
                    Get a notification for new messages, support answers and application decisions while the
                    app is in the background.
                  </p>
                </div>
                {notificationsSupported() ? (
                  <button
                    className={`btn lg ${notify === 'on' ? 'success' : 'primary'}`}
                    style={{ alignSelf: 'center' }}
                    disabled={notify === 'on'}
                    onClick={async () => setNotify((await enableNotifications()) ? 'on' : 'blocked')}
                  >
                    <Icon name={notify === 'on' ? 'check' : 'bell'} size={18} />
                    {notify === 'on' ? 'Notifications are on' : 'Turn on notifications'}
                  </button>
                ) : (
                  <p className="small muted">This browser does not support notifications.</p>
                )}
                {notify === 'blocked' && (
                  <div className="alert warning small">
                    Notifications are blocked for this site. You can allow them later in the browser settings.
                  </div>
                )}
                <StepButtons
                  onBack={() => go(-1)}
                  onNext={() => go(1)}
                  nextLabel={notify === 'on' ? 'Continue' : 'Maybe later'}
                />
              </div>
            )}

            {step === 'done' && (
              <div className="stack-lg center-text">
                <div className="done-burst">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="burst-ring"
                      initial={{ scale: 0.4, opacity: 0.8 }}
                      animate={{ scale: 2.4, opacity: 0 }}
                      transition={{ duration: 1.6, delay: i * 0.35, repeat: Infinity, repeatDelay: 0.6 }}
                    />
                  ))}
                  <motion.span
                    className="done-ring"
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                  >
                    <Icon name="check" size={38} />
                  </motion.span>
                </div>
                <div className="stack-sm">
                  <h1>You’re all set</h1>
                  <p className="muted">Your workspace is ready. Here is where you might start:</p>
                </div>
                <div className="stack-sm" style={{ textAlign: 'left' }}>
                  {(goals.length ? goals : (['invest', 'chat'] as Goal[])).map((g, i) => (
                    <motion.button
                      key={g}
                      className="list-item card"
                      style={{ padding: 14 }}
                      onClick={() => finish(GOAL_INFO[g].to)}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + i * 0.08 }}
                    >
                      <span className="goal-icon">
                        <Icon name={GOAL_INFO[g].icon} size={18} />
                      </span>
                      <span className="grow bold">{GOAL_INFO[g].cta}</span>
                      <Icon name="chevronRight" size={18} />
                    </motion.button>
                  ))}
                </div>
                <button
                  className="btn gradient lg"
                  style={{ alignSelf: 'center' }}
                  onClick={() => finish()}
                  disabled={saving}
                >
                  Enter my workspace <Icon name="arrowRight" size={18} />
                </button>
              </div>
            )}
          </motion.section>
        </AnimatePresence>
      </div>
    </div>
  );
}

function StepButtons({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <div className="spread">
      <button className="btn ghost" onClick={onBack}>
        <Icon name="back" size={16} /> Back
      </button>
      <button className="btn primary" onClick={onNext} disabled={nextDisabled}>
        {nextLabel} <Icon name="arrowRight" size={16} />
      </button>
    </div>
  );
}
