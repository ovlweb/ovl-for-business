import { Logo } from '@ovl/ui';
import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MeProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { AccountLinkPage } from './pages/AccountLinks';
import { ApplicationsPage } from './pages/Applications';
import { LoginPage } from './pages/Auth';
import { ChatsPage } from './pages/Chats';
import { CompaniesPage, CompanyPage } from './pages/Companies';
import { ContactsPage } from './pages/Contacts';
import { ExchangePage, ListingPage, PortfolioPage } from './pages/Exchange';
import { HomePage } from './pages/Home';
import { InvoicesPage } from './pages/Invoices';
import { OnboardingPage } from './pages/Onboarding';
import { RegistryPage } from './pages/Registry';
import { ReviewPage } from './pages/Review';
import { SettingsPage } from './pages/Settings';
import { SupportPage } from './pages/Support';
import { UserPage } from './pages/User';
import { VerifyPage } from './pages/Verify';
import { WalletPage } from './pages/Wallet';

function Splash() {
  return (
    <motion.div className="splash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <Logo size={72} animated />
      <motion.div
        className="splash-bar"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity }}
      />
    </motion.div>
  );
}

export function App() {
  const { me, loading, addingAccount } = useAuth();
  const { pathname } = useLocation();

  let content;
  // Links from emails work whether or not someone is signed in on this device.
  if (pathname === '/verify-email' || pathname === '/reset-password')
    content = (
      <AccountLinkPage key={pathname} kind={pathname.slice(1) as 'verify-email' | 'reset-password'} />
    );
  // Certificate QR codes: anyone can check an entry, signed in or not.
  else if (pathname.startsWith('/verify/'))
    content = (
      <Routes key="verify">
        <Route path="/verify/:number" element={<VerifyPage />} />
      </Routes>
    );
  else if (loading && !me) content = <Splash key="splash" />;
  else if (!me || addingAccount) content = <LoginPage key="login" />;
  else if (!me.preferences.onboardingCompleted)
    content = (
      <MeProvider key={`welcome-${me.id}`} me={me}>
        <OnboardingPage />
      </MeProvider>
    );
  else
    content = (
      <MeProvider key={`app-${me.id}`} me={me}>
        <Routes>
          {/* Shown by AccountLinkPage; listed so the catch-all below does not redirect them away. */}
          <Route path="/verify-email" element={null} />
          <Route path="/verify/:number" element={null} />
          <Route path="/reset-password" element={null} />
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/chats" element={<ChatsPage />} />
            <Route path="/chats/:chatId" element={<ChatsPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/invoices/:id" element={<InvoicesPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:slug" element={<CompanyPage />} />
            <Route path="/exchange" element={<ExchangePage />} />
            <Route path="/exchange/portfolio" element={<PortfolioPage />} />
            <Route path="/exchange/:ticker" element={<ListingPage />} />
            <Route path="/registry" element={<RegistryPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/support" element={<SupportPage />} />
            <Route path="/support/:chatId" element={<SupportPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:id" element={<ReviewPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<Navigate to="/settings" replace />} />
            <Route path="/u/:username" element={<UserPage />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Route>
        </Routes>
      </MeProvider>
    );

  return <AnimatePresence mode="wait">{content}</AnimatePresence>;
}
