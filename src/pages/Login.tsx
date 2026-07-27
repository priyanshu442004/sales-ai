import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useUiStore } from '../store/useUiStore';
import { Layers, Mail, Lock, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/core';
import { loginWithBackend } from '../services/sourcingApi';

// Forms validation schema
const loginSchema = z.object({
  email: z.string().email('Please enter a valid work email address'),
  password: z.string().min(4, 'Password must be at least 4 characters long'), // allow 'admin'
});

type LoginFormValues = z.infer<typeof loginSchema>;

export const Login: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { setCurrentUser } = useUiStore();
  const navigate = useNavigate();

  const { register: registerCreds, handleSubmit: handleSubmitCreds, formState: { errors: credsErrors, isValid: credsIsValid } } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
  });

  const handleCredsSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    setLoginError(null);
    try {
      const res = await loginWithBackend(data.email, data.password);
      setCurrentUser(res.user);
      navigate('/');
    } catch (err: any) {
      setLoginError(err.message || 'Incorrect email or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-canvas text-text-primary">
      {/* LEFT SIDE: Brand & Graphic (Abstract network/graph motif in brand colors) */}
      <div className="hidden lg:flex w-1/2 bg-brand-primary p-12 flex-col justify-between text-white relative overflow-hidden">
        {/* Decorative background grids */}
        <div className="absolute inset-0 opacity-15 pointer-events-none bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:32px_32px]" />
        
        {/* Header branding */}
        <div className="flex items-center space-x-2.5 z-10">
          <div className="w-8 h-8 bg-white/10 rounded-btn flex items-center justify-center border border-white/20">
            <Layers className="w-4.5 h-4.5 text-brand-accent" />
          </div>
          <span className="font-heading font-bold text-xl tracking-tight">Sales AI</span>
          <span className="text-[9px] bg-brand-accent text-white px-1.5 py-0.5 rounded font-heading font-medium tracking-wide uppercase">Enterprise</span>
        </div>

        {/* Dynamic Abstract Network Graph SVG */}
        <div className="my-auto max-w-md z-10">
          <svg viewBox="0 0 400 300" className="w-full h-auto text-brand-accent mb-8">
            {/* Draw nodes and paths */}
            <path d="M 50 150 L 150 70 L 250 180 L 350 100" fill="none" stroke="rgba(200, 134, 58, 0.4)" strokeWidth="2" strokeDasharray="5 5" />
            <path d="M 50 150 L 150 200 L 250 180 L 350 220" fill="none" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1.5" />
            
            {/* Main high fidelity trend path */}
            <path d="M 50 150 C 120 70, 180 230, 250 180 C 300 150, 320 110, 350 100" fill="none" stroke="#C8863A" strokeWidth="3.5" />

            <circle cx="50" cy="150" r="6" fill="#1F3D3A" stroke="#C8863A" strokeWidth="2" />
            <circle cx="150" cy="70" r="6" fill="#C8863A" />
            <circle cx="150" cy="200" r="4" fill="#ffffff" opacity="0.8" />
            <circle cx="250" cy="180" r="8" fill="#1F3D3A" stroke="#ffffff" strokeWidth="2.5" />
            <circle cx="350" cy="100" r="7" fill="#C8863A" stroke="#1F3D3A" strokeWidth="1.5" />
            <circle cx="350" cy="220" r="4" fill="#ffffff" opacity="0.6" />

            {/* AI pipeline tag overlays */}
            <rect x="180" y="80" width="100" height="24" rx="6" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
            <text x="230" y="96" fill="#ffffff" fontSize="9" fontFamily="Inter Tight" fontWeight="600" textAnchor="middle">AI Sourcing Target</text>
            
            <rect x="220" y="210" width="70" height="20" rx="4" fill="#C8863A" />
            <text x="255" y="223" fill="#ffffff" fontSize="9" fontFamily="Inter Tight" fontWeight="600" textAnchor="middle">Lead Approved</text>
          </svg>

          <h1 className="text-3xl font-heading font-semibold leading-tight tracking-tight">
            Enterprise outbound, built with total compliance.
          </h1>
          <p className="text-sm text-white/70 mt-3 font-heading font-normal leading-relaxed">
            AI-driven buyer profile discovery, lead enrichment, and scoring with mandatory human-approval workflows.
          </p>
        </div>

        {/* Footer info */}
        <div className="text-xs text-white/50 font-heading z-10">
          Invited users only. To request workspace access, contact your administrator.
        </div>
      </div>

      {/* RIGHT SIDE: Auth Forms */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-bg-surface">
        <div className="max-w-md w-full space-y-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-heading font-semibold text-text-primary">
              Log in to Sales AI
            </h2>
            <p className="text-sm text-text-secondary">
              Welcome back. Enter your corporate credentials below.
            </p>
          </div>

          <form onSubmit={handleSubmitCreds(handleCredsSubmit)} className="space-y-4">
            <div>
              <label className="block text-xs font-heading font-semibold text-text-secondary mb-1">Work Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="email"
                  placeholder="name@company.com"
                  {...registerCreds('email')}
                  className="pl-10 pr-4 py-2.5 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
              </div>
              {credsErrors.email && (
                <p className="text-xs text-status-danger mt-1 font-heading font-medium">{credsErrors.email.message}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-heading font-semibold text-text-secondary">Password</label>
                <a href="#" className="text-xs font-heading font-semibold text-brand-primary hover:text-brand-primary-hover">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                <input
                  type="password"
                  placeholder="••••••••"
                  {...registerCreds('password')}
                  className="pl-10 pr-4 py-2.5 w-full text-sm bg-bg-canvas border border-border-default rounded-input text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                />
              </div>
              {credsErrors.password && (
                <p className="text-xs text-status-danger mt-1 font-heading font-medium">{credsErrors.password.message}</p>
              )}
            </div>

            {loginError && (
              <div className="p-3 text-xs bg-status-danger/10 border border-status-danger/25 text-status-danger rounded font-heading font-medium">
                {loginError}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full py-2.5 mt-2"
              disabled={!credsIsValid}
              loading={isLoading}
            >
              <span className="flex items-center justify-center">
                Log In <ArrowRight className="w-4 h-4 ml-1.5" />
              </span>
            </Button>

            <div className="relative py-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-subtle" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-bg-surface px-2.5 text-text-tertiary font-heading font-medium">Or corporate single sign-on</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="secondary" className="text-xs py-2">
                Google Workspace
              </Button>
              <Button type="button" variant="secondary" className="text-xs py-2">
                Microsoft Azure SSO
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
