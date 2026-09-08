import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, isMockSupabase } from '../lib/supabaseClient';
import { setStoredAuthenticatedProfile } from '../lib/salonStore';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
  /** Customer auth uses the same flow without asking for salon-owner fields. */
  purpose?: 'owner' | 'customer';
  onSuccess: (user: any) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
  purpose = 'owner',
  onSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCustomer = purpose === 'customer';

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(null);
    }
  }, [isOpen, initialMode]);

  // Form Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [salonName, setSalonName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [city, setCity] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Mock Mode Handling
    if (isMockSupabase) {
      setTimeout(() => {
        const mockUser = {
          id: 'mock-user-123',
          email: email,
          user_metadata: {
            full_name: fullName || (isCustomer ? 'Mock Customer' : 'Mock Owner'),
            ...(isCustomer ? {} : { salon_name: salonName || 'Arts By Uma' }),
            ...(isCustomer ? {} : { phone_number: phoneNumber || '+91 98450 77654' }),
            ...(isCustomer ? {} : { city: city || 'Bengaluru, Karnataka' }),
          }
        };
        if (!isCustomer) {
          setStoredAuthenticatedProfile({
            salonName: salonName || 'Arts By Uma',
            phone: phoneNumber || '+91 98450 77654',
            city: city || 'Bengaluru, Karnataka',
            ownerName: fullName || 'Uma',
            email: email,
          });
        }
        onSuccess(mockUser);
        onClose();
        setLoading(false);
      }, 1000);
      return;
    }

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              salon_name: salonName,
              phone_number: phoneNumber,
              city: city,
              account_type: purpose,
            },
          },
        });

        if (signUpError) throw signUpError;
        
        if (data.user) {
          if (!isCustomer) {
            setStoredAuthenticatedProfile({
              salonName: salonName || (data.user.user_metadata?.salon_name as string),
              phone: phoneNumber || (data.user.user_metadata?.phone_number as string),
              city: city || (data.user.user_metadata?.city as string),
              ownerName: fullName || (data.user.user_metadata?.full_name as string),
              email: email,
            });

            const { error: profileError } = await supabase
              .from('profiles')
              .upsert({
                id: data.user.id,
                full_name: fullName,
                salon_name: salonName,
                phone_number: phoneNumber,
                email: email,
                city: city,
                updated_at: new Date().toISOString(),
              });

            if (profileError) console.error('Profile creation error:', profileError);
          }

          // Supabase may require email confirmation. A user object without a
          // session is not enough to authorize a booking, so keep the dialog
          // open and ask the customer to verify before trying again.
          if (!data.session) {
            setError('Account created. Please verify your email, then log in to continue booking.');
            return;
          }

          onSuccess(data.user);
          onClose();
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
        if (data.user) {
          const uMeta = data.user.user_metadata || {};
          if (!isCustomer && (uMeta.salon_name || uMeta.phone_number || uMeta.city)) {
            setStoredAuthenticatedProfile({
              salonName: uMeta.salon_name,
              phone: uMeta.phone_number,
              city: uMeta.city,
              ownerName: uMeta.full_name,
              email: data.user.email,
            });
          }
          onSuccess(data.user);
          onClose();
        }
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/60 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative border border-gray-100 max-h-[90vh] flex flex-col overflow-hidden"
            >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors z-10 bg-white/80 rounded-full p-1"
            >
              <span className="material-symbols-outlined">close</span>
            </button>

            <div className="p-6 sm:p-10 overflow-y-auto flex-1 custom-scrollbar">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#C20E5A]/10 text-[#C20E5A] mb-4">
                  <span className="material-symbols-outlined text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>spa</span>
                </div>
                <h2 className="text-3xl font-display font-bold text-gray-900 tracking-tight">
                  {mode === 'login' ? 'Welcome Back' : isCustomer ? 'Create your booking account' : 'Join Nexora'}
                </h2>
                <p className="text-gray-500 mt-2 text-sm">
                  {mode === 'login'
                    ? (isCustomer ? 'Sign in to continue your appointment booking' : 'Manage your salon with luxury and ease')
                    : (isCustomer ? 'Sign up once to book appointments with this salon' : 'The ultimate platform for luxury salon owners')}
                </p>
              </div>

              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl flex items-start gap-3"
                >
                  <span className="material-symbols-outlined text-sm mt-0.5">error</span>
                  <p className="font-medium">{error}</p>
                </motion.div>
              )}

              <form onSubmit={handleAuth} className="space-y-5">
                {mode === 'signup' && (
                  <div className="space-y-5">
                    <div className={isCustomer ? '' : 'grid grid-cols-2 gap-4'}>
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">Full Name</label>
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                          placeholder="John Doe"
                        />
                      </div>
                      {!isCustomer && (
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">Salon Name</label>
                          <input
                            type="text"
                            required
                            value={salonName}
                            onChange={(e) => setSalonName(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                            placeholder="Glow Studio"
                          />
                        </div>
                      )}
                    </div>
                    {!isCustomer && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">Phone</label>
                          <input
                            type="tel"
                            required
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                            placeholder="+91..."
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">City</label>
                          <input
                            type="text"
                            required
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                            placeholder="Mumbai"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                    placeholder="john@example.com"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-widest">Password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#C20E5A]/5 focus:border-[#C20E5A] transition-all text-sm"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-[#C20E5A] text-white rounded-xl font-bold shadow-xl shadow-[#C20E5A]/20 hover:bg-[#A30B4A] hover:-translate-y-0.5 transition-all disabled:opacity-50 mt-6 flex items-center justify-center gap-3 active:scale-95"
                >
                  {loading ? (
                    <span className="material-symbols-outlined animate-spin text-xl">progress_activity</span>
                  ) : (
                    <>
                      <span>{mode === 'login' ? (isCustomer ? 'Continue to booking' : 'Enter Dashboard') : (isCustomer ? 'Create booking account' : 'Create My Salon')}</span>
                      <span className="material-symbols-outlined text-xl">arrow_forward</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                <p className="text-sm text-gray-500">
                  {mode === 'login' ? "Don't have an account?" : "Already have an account?"}
                  <button
                    onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                    className="ml-2 font-bold text-[#C20E5A] hover:underline"
                  >
                    {mode === 'login' ? 'Create one' : 'Log in here'}
                  </button>
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    )}
  </AnimatePresence>
  );
};
