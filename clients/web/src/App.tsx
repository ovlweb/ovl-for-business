import { Spinner } from '@ovl/ui';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { ApplicationsPage } from './pages/Applications';
import { LoginPage, RegisterPage } from './pages/Auth';
import { ChatsPage } from './pages/Chats';
import { CompaniesPage, CompanyPage } from './pages/Companies';
import { ContactsPage } from './pages/Contacts';
import { ExchangePage, ListingPage, PortfolioPage } from './pages/Exchange';
import { ProfilePage } from './pages/Profile';
import { RegistryPage } from './pages/Registry';
import { ReviewPage } from './pages/Review';
import { SupportPage } from './pages/Support';
import { UserPage } from './pages/User';
import { WalletPage } from './pages/Wallet';

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner center />;

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/chats" replace />} />
        <Route path="/chats" element={<ChatsPage />} />
        <Route path="/chats/:chatId" element={<ChatsPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/wallet" element={<WalletPage />} />
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
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/u/:username" element={<UserPage />} />
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Route>
    </Routes>
  );
}
