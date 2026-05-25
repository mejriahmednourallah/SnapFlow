import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogIn, UserPlus, Mail, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import snapflowLogo from '@/assets/snapflow-logo.png';
import Footer from '@/components/Footer';

const Auth = () => {
  const [mode, setMode] = useState<'login' | 'signup' | 'confirm'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'login') {
        const identifier = email.trim();
        const looksLikeEmail = identifier.includes('@');

        if (looksLikeEmail) {
          const { error } = await supabase.auth.signInWithPassword({ email: identifier, password });
          if (!error) {
            toast({ title: 'Connecté', description: 'Bienvenue sur Snapflow !' });
            navigate('/app');
            return;
          }
        }

        const { data, error } = await supabase.functions.invoke('redmine-login', {
          body: {
            login: identifier,
            password,
            redirect_to: window.location.origin,
          },
        });

        if (error) throw error;
        if (data?.manual_account_exists) {
          throw new Error(data.error || 'Ce compte doit utiliser la connexion SnapFlow.');
        }
        if (data?.error) throw new Error(data.error);

        if (data?.email && data?.token) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            email: data.email,
            token: data.token,
            type: 'magiclink',
          });
          if (otpError) throw otpError;
        } else if (data?.action_link) {
          window.location.href = data.action_link;
          return;
        } else {
          throw new Error('Connexion Redmine valide, mais session SnapFlow indisponible.');
        }

        toast({ title: 'Connecté', description: 'Bienvenue sur Snapflow !' });
        navigate('/app');
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast({
          title: 'Compte créé',
          description: 'Un email de confirmation vous a été envoyé. Vérifiez votre boîte de réception ou entrez le code ci-dessous.',
        });
        setMode('confirm');
      } else if (mode === 'confirm') {
        const { error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: 'signup',
        });
        if (error) throw error;
        toast({ title: 'Email confirmé', description: 'Vous pouvez maintenant utiliser Snapflow.' });
        navigate('/app');
      }
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="glass-card p-6 sm:p-8 w-full max-w-md">
          <div className="flex items-center justify-center mb-8">
            <img src={snapflowLogo} alt="Snapflow" className="h-10" />
          </div>

          <h2 className="text-xl font-bold text-center mb-6">
            {mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer un compte' : 'Confirmer votre email'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Nom complet</label>
                <Input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Jean Dupont"
                  required
                />
              </div>
            )}

            {mode !== 'confirm' && (
              <>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">
                    {mode === 'login' ? 'Email ou identifiant Redmine' : 'Email'}
                  </label>
                  <Input
                    type={mode === 'login' ? 'text' : 'email'}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder={mode === 'login' ? 'vous@exemple.com ou identifiant Redmine' : 'vous@exemple.com'}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Mot de passe</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                  />
                </div>
              </>
            )}

            {mode === 'confirm' && (
              <>
                <div className="text-center text-sm text-muted-foreground mb-2">
                  <Mail className="w-8 h-8 mx-auto mb-2 text-primary" />
                  <p>Un code de vérification a été envoyé à <strong className="text-foreground">{email}</strong></p>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Code de vérification</label>
                  <Input
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="123456"
                    required
                    className="text-center tracking-widest text-lg"
                  />
                </div>
              </>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Chargement…' : mode === 'login' ? (
                <><LogIn className="w-4 h-4 mr-2" /> Se connecter</>
              ) : mode === 'signup' ? (
                <><UserPlus className="w-4 h-4 mr-2" /> Créer le compte</>
              ) : (
                <><KeyRound className="w-4 h-4 mr-2" /> Confirmer</>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center space-y-2">
            {mode === 'confirm' ? (
              <button
                onClick={() => setMode('login')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Retour à la connexion
              </button>
            ) : (
              <button
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {mode === 'login' ? "Pas de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
              </button>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Auth;
