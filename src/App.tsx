import React, { useState, useEffect, createContext, useContext } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  addDoc,
  getDoc,
  setDoc,
  serverTimestamp,
  updateDoc,
  doc,
  deleteDoc,
  increment
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Target, 
  Zap, 
  Calendar, 
  Settings, 
  LogOut, 
  Plus, 
  CheckCircle2, 
  Clock, 
  ChevronRight,
  MessageSquare,
  BarChart3,
  Loader2,
  Trash2,
  Check,
  Info,
  ExternalLink,
  ShieldAlert,
  Star,
  Terminal
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { interrogateGoal, generateMicroSteps, generateNextPhaseSteps, generatePhaseQuiz, generateTerminalChallenge } from './lib/gemini';
import TerminalSandbox from './components/TerminalSandbox';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Contexts ---

const AuthContext = createContext<{
  user: FirebaseUser | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}>({ user: null, loading: true, login: async () => {}, logout: async () => {} });

// --- Types ---

interface Goal {
  id: string;
  userId: string;
  title: string;
  description?: string;
  status: 'analyzing' | 'active' | 'completed' | 'archived';
  createdAt: any;
  currentPhase?: number;
  quizPassedForPhase?: number;
  deadline?: string;
  weeklyMinutes?: number;
  pace?: 'steady' | 'aggressive' | 'maintenance';
  skillLevel?: 'beginner' | 'intermediate' | 'advanced';
  motivation?: string;
  constraints?: string;
  preferredWindow?: string;
  energyWindow?: string;
  learningStyle?: string;
}

interface MicroStep {
  id: string;
  goalId: string;
  title: string;
  description: string;
  durationMinutes: number;
  difficulty: number;
  status: 'pending' | 'in-progress' | 'completed' | 'skipped';
  orderIndex: number;
  completedAt?: any;
  evidenceNotes?: string;
  evidenceUrl?: string;
  confidence?: number;
  feedback?: 'too-hard' | 'too-easy' | 'irrelevant' | 'on-track';
  attemptCount?: number;
  completionProof?: string;
}

interface ChatMessage {
  id: string;
  goalId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: any;
}

const paceLabels: Record<string, string> = {
  steady: 'Steady',
  aggressive: 'Aggressive',
  maintenance: 'Maintenance'
};

function formatMinutes(totalMinutes: number) {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '0m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function coerceDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(dateString?: string) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T23:59:59`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function buildScheduleSlots(goal: Goal, steps: MicroStep[]) {
  const pendingSteps = steps.filter(step => step.status !== 'completed');
  const nextStep = pendingSteps[0];
  const windowLabel = goal.preferredWindow || goal.energyWindow || '12:45';
  const weeklyBudget = goal.weeklyMinutes || 150;
  const stepLength = nextStep?.durationMinutes || 20;
  const sessions = Math.max(1, Math.floor(weeklyBudget / stepLength));

  return [
    { label: windowLabel, detail: nextStep ? nextStep.title : 'Review progress', active: true },
    { label: 'Weekly load', detail: `${sessions} focused sessions`, active: false },
    { label: 'Recovery slot', detail: goal.pace === 'aggressive' ? 'Add buffer' : 'Optional review', active: false },
    { label: 'Energy mode', detail: goal.energyWindow || 'Not calibrated', active: false }
  ];
}

function buildStepChecklist(step: MicroStep) {
  return [
    `Define the smallest useful output for "${step.title}".`,
    `Work for ${step.durationMinutes || 20} minutes without expanding scope.`,
    'Capture proof before marking the step complete.'
  ];
}

function buildSuccessCriteria(step: MicroStep) {
  return [
    'There is a visible artifact, note, code output, link, or decision.',
    `The artifact directly supports: ${step.description}`,
    'You can explain the result in one sentence.'
  ];
}

function buildAdaptiveSignals(goal: Goal, steps: MicroStep[]) {
  const completed = steps.filter(step => step.status === 'completed');
  const skipped = steps.filter(step => step.status === 'skipped');
  const confidenceAverage = completed.length
    ? Math.round(completed.reduce((sum, step) => sum + (step.confidence || 3), 0) / completed.length)
    : 0;
  const hardFeedbackCount = steps.filter(step => step.feedback === 'too-hard').length;
  const deadlineDays = daysUntil(goal.deadline);

  const signals = [];
  if (hardFeedbackCount >= 2 || confidenceAverage === 1) {
    signals.push('Reduce next phase difficulty and add more practice reps.');
  }
  if (skipped.length > 0) {
    signals.push('Rebuild skipped work into smaller recovery steps.');
  }
  if (deadlineDays !== null && deadlineDays < 14 && (goal.weeklyMinutes || 0) < 180) {
    signals.push('Deadline pressure is high; increase weekly capacity or narrow scope.');
  }
  if (completed.length >= 8 && hardFeedbackCount === 0 && confidenceAverage >= 4) {
    signals.push('User is ready for denser, more ambitious next-phase work.');
  }

  return signals.length ? signals : ['Current plan is stable. Keep the next phase at this difficulty.'];
}

// --- Components ---

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-brand-blue flex items-center justify-center p-6 text-center">
          <div className="glass-panel p-8 max-w-md">
            <h2 className="text-xl font-mono text-red-400 mb-4 uppercase">System Error</h2>
            <p className="text-brand-slate text-sm mb-6 leading-relaxed">
              {this.state.error instanceof Error ? this.state.error.message : "An unexpected error occurred in the quantum processing unit."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Reboot System
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Main App Component ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      // Ensure user profile exists in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-blue">
        <Loader2 className="w-8 h-8 animate-spin text-brand-light" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, loading, login, logout }}>
        {user ? <Dashboard /> : <LandingPage />}
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}

// --- Landing Page ---

function LandingPage() {
  const { login } = useContext(AuthContext);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg-darkest p-6 relative overflow-hidden font-sans">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-accent-blue/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-accent-blue/3 blur-[100px] rounded-full" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center z-10 max-w-2xl"
      >
        <div className="logo text-center mb-8">Quantum Leaps</div>
        
        <h1 className="text-5xl font-light text-text-primary tracking-tight mb-6 leading-tight">
          Professional Goal <span className="text-accent-blue">Decomposition</span>
        </h1>
        
        <p className="text-text-secondary text-lg mb-12 font-light leading-relaxed max-w-xl mx-auto">
          Break the most ambitious objectives into mathematically precise, microscopic steps aligned with your real-world schedule.
        </p>
        
        <button 
          onClick={login}
          className="btn-primary py-4 px-10 group flex items-center space-x-4 mx-auto"
        >
          <span>Initiate Access</span>
          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </button>

        <div className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8">
          <FeatureCard 
            title="AI Analysis"
            desc="Quantum Coach probes your capacity constraints to find hidden efficiency gaps."
          />
          <FeatureCard 
            title="Micro Sizing"
            desc="Every leap begins with a tiny movement. We decompose goals into 15-minute intervals."
          />
          <FeatureCard 
            title="Sync Engine"
            desc="Aligned with your professional rhythm to ensure high-end execution."
          />
        </div>
      </motion.div>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="text-left">
      <h3 className="card-label mb-2">{title}</h3>
      <p className="text-text-secondary text-xs leading-relaxed">{desc}</p>
    </div>
  );
}

// --- Dashboard ---

function Dashboard() {
  const { user, logout } = useContext(AuthContext);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');
  const [newGoalWeeklyMinutes, setNewGoalWeeklyMinutes] = useState(150);
  const [newGoalSkillLevel, setNewGoalSkillLevel] = useState<Goal['skillLevel']>('beginner');
  const [newGoalPace, setNewGoalPace] = useState<Goal['pace']>('steady');
  const [newGoalPreferredWindow, setNewGoalPreferredWindow] = useState('12:45');
  const [newGoalMotivation, setNewGoalMotivation] = useState('');
  const [newGoalConstraints, setNewGoalConstraints] = useState('');

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'goals'), where('userId', '==', user.uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setGoals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'goals'));
  }, [user]);

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim() || !user) return;

    try {
      const docRef = await addDoc(collection(db, 'goals'), {
        userId: user.uid,
        title: newGoalTitle,
        deadline: newGoalDeadline || null,
        weeklyMinutes: newGoalWeeklyMinutes,
        skillLevel: newGoalSkillLevel,
        pace: newGoalPace,
        preferredWindow: newGoalPreferredWindow,
        energyWindow: newGoalPreferredWindow,
        motivation: newGoalMotivation,
        constraints: newGoalConstraints,
        status: 'analyzing',
        createdAt: serverTimestamp(),
        currentPhase: 1,
        quizPassedForPhase: 0
      });
      setNewGoalTitle('');
      setNewGoalDeadline('');
      setNewGoalWeeklyMinutes(150);
      setNewGoalSkillLevel('beginner');
      setNewGoalPace('steady');
      setNewGoalPreferredWindow('12:45');
      setNewGoalMotivation('');
      setNewGoalConstraints('');
      setIsCreating(false);
      setSelectedGoalId(docRef.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'goals');
    }
  };

  const selectedGoal = goals.find(g => g.id === selectedGoalId);
  const activeGoalCount = goals.filter(goal => goal.status === 'active' || goal.status === 'analyzing').length;
  const completedGoalCount = goals.filter(goal => goal.status === 'completed').length;
  const dueSoonCount = goals.filter(goal => {
    const remaining = daysUntil(goal.deadline);
    return remaining !== null && remaining >= 0 && remaining <= 14;
  }).length;
  const totalWeeklyCapacity = goals.reduce((sum, goal) => sum + (goal.weeklyMinutes || 0), 0);

  return (
    <div className="app-container-grid bg-bg-darkest overflow-hidden">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo mb-12">Quantum Leaps</div>

        <nav className="flex-1">
          <button 
            onClick={() => setSelectedGoalId(null)}
            className={cn("nav-item text-left w-full", !selectedGoalId && "nav-item-active")}
          >
            {!selectedGoalId && <span className="nav-dot" />}
            <span>Active Goals</span>
          </button>
          
          <div className="mt-8 mb-4">
            <span className="text-[10px] text-text-secondary uppercase tracking-[2px] opacity-50">Operational Pipeline</span>
          </div>

          {goals.map(goal => (
            <button 
              key={goal.id}
              onClick={() => setSelectedGoalId(goal.id)}
              className={cn("nav-item text-left w-full pl-2 lowercase", selectedGoalId === goal.id && "nav-item-active")}
            >
              {selectedGoalId === goal.id && <span className="nav-dot" />}
              <span className="truncate">{goal.title}</span>
            </button>
          ))}

          <button 
            onClick={() => setIsCreating(true)}
            className="nav-item text-left w-full pl-2 opacity-60 hover:opacity-100"
          >
            <Plus className="w-3 h-3 mr-2" />
            <span>Add Initiative</span>
          </button>
        </nav>

        <div className="mt-auto pt-6 border-t border-border-color">
          <div className="stat-row">
            <div>
              <div className="stat-desc">System Efficiency</div>
              <div className="stat-value text-accent-blue tracking-tighter">94.2%</div>
            </div>
          </div>
          <div className="h-[2px] w-full bg-white/10 mt-2">
            <div className="h-full bg-accent-blue shadow-[0_0_8px_var(--color-accent-blue)] w-[94.2%]" />
          </div>
          
          <div className="mt-8 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img src={user?.photoURL || ''} className="w-6 h-6 rounded-full border border-border-color" referrerPolicy="no-referrer" />
              <div className="flex-1 min-w-0">
                <p className="text-text-primary text-[10px] font-medium truncate">{user?.displayName?.split(' ')[0]}</p>
              </div>
            </div>
            <button onClick={logout} className="text-text-secondary hover:text-red-400 transition-colors">
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        </div>
      </aside>

      {/* Dynamic Content Columns */}
      <AnimatePresence mode="wait">
        {!selectedGoalId ? (
          <React.Fragment key="dashboard-empty">
            <main className="main-content">
              <header className="mb-12">
                <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-2">Strategy Dashboard • Level 01</p>
                <h1 className="text-4xl font-light text-text-primary">Operational <span className="text-accent-blue italic">Overview</span></h1>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card">
                  <span className="card-label">Active Initiatives</span>
                  <div className="text-4xl font-light text-text-primary mb-2 tracking-tight">{activeGoalCount}</div>
                  <div className="progress-bar w-full bg-white/5 h-[1px]">
                     <div className="bg-accent-blue h-full shadow-[0_0_5px_var(--color-accent-blue)]" style={{ width: `${Math.min(100, activeGoalCount * 20)}%` }} />
                  </div>
                </div>
                <div className="card">
                  <span className="card-label">Weekly Capacity</span>
                  <div className="text-4xl font-light text-text-primary mb-2 tracking-tight">{formatMinutes(totalWeeklyCapacity)}</div>
                  <div className="progress-bar w-full bg-white/5 h-[1px]">
                     <div className="bg-accent-blue h-full shadow-[0_0_5px_var(--color-accent-blue)]" style={{ width: `${Math.min(100, (totalWeeklyCapacity / 600) * 100)}%` }} />
                  </div>
                </div>
                <div className="card">
                  <span className="card-label">Deadline Pressure</span>
                  <div className="text-4xl font-light text-text-primary mb-2 tracking-tight">{dueSoonCount}</div>
                  <p className="text-[11px] text-text-secondary">Goals due in the next 14 days.</p>
                </div>
                <div className="card">
                  <span className="card-label">Closed Loops</span>
                  <div className="text-4xl font-light text-text-primary mb-2 tracking-tight">{completedGoalCount}</div>
                  <p className="text-[11px] text-text-secondary">Completed strategic initiatives.</p>
                </div>
              </div>

              <div className="mt-12">
                <span className="card-label">Recent Pipeline Events</span>
                <div className="space-y-2">
                  {goals.slice(0, 5).map(g => (
                    <div key={g.id} className="flex justify-between items-center py-3 border-b border-border-color text-sm">
                      <span className="text-text-primary">{g.title}</span>
                      <span className="font-mono text-[10px] text-text-secondary opacity-60 uppercase">{g.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </main>
            <aside className="ai-panel">
               <div className="ai-status-box font-mono">Quantum Engine Standby</div>
               <div className="ai-bubble">
                  Welcome to Quantum Leaps. Select an existing goal or initiate a new strategic breakdown to begin microscopic interval generation.
               </div>
               <div className="mt-8">
                  <span className="card-label">System Integrity</span>
                  <div className="space-y-4">
                     <div className="flex justify-between text-[10px] uppercase font-mono tracking-widest text-text-secondary">
                        <span>Database Sync</span>
                        <span className="text-accent-blue">Active</span>
                     </div>
                     <div className="flex justify-between text-[10px] uppercase font-mono tracking-widest text-text-secondary">
                        <span>AI Inference</span>
                        <span className="text-accent-blue">Online</span>
                     </div>
                  </div>
               </div>
            </aside>
          </React.Fragment>
        ) : (
          <div key={selectedGoalId} className="contents">
            <GoalDetailsLayout goal={selectedGoal!} onClose={() => setSelectedGoalId(null)} />
          </div>
        )}
      </AnimatePresence>

      {/* Modal for new goal */}
      {isCreating && (
        <div className="fixed inset-0 bg-bg-darkest/90 backdrop-blur-md z-50 flex items-center justify-center p-6">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="card max-w-lg w-full p-10"
          >
            <h3 className="text-xl font-light text-text-primary uppercase mb-8 tracking-widest flex items-center space-x-3">
              <Plus className="w-5 h-5 text-accent-blue" />
              <span>New Strategic Initiative</span>
            </h3>
            <form onSubmit={handleCreateGoal} className="space-y-5">
              <input 
                autoFocus
                value={newGoalTitle}
                onChange={(e) => setNewGoalTitle(e.target.value)}
                placeholder="Ex. Financial Sovereignty"
                className="w-full bg-transparent border-b border-border-color py-4 text-white placeholder:text-text-secondary/50 focus:outline-none focus:border-accent-blue transition-colors text-lg"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="card-label mb-0">Target Date</span>
                  <input
                    type="date"
                    value={newGoalDeadline}
                    onChange={(e) => setNewGoalDeadline(e.target.value)}
                    className="w-full bg-white/5 border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </label>
                <label className="space-y-2">
                  <span className="card-label mb-0">Weekly Capacity</span>
                  <input
                    type="number"
                    min={30}
                    step={15}
                    value={newGoalWeeklyMinutes}
                    onChange={(e) => setNewGoalWeeklyMinutes(Number(e.target.value))}
                    className="w-full bg-white/5 border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                  />
                </label>
                <label className="space-y-2">
                  <span className="card-label mb-0">Skill Level</span>
                  <select
                    value={newGoalSkillLevel}
                    onChange={(e) => setNewGoalSkillLevel(e.target.value as Goal['skillLevel'])}
                    className="w-full bg-bg-card border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="card-label mb-0">Pace</span>
                  <select
                    value={newGoalPace}
                    onChange={(e) => setNewGoalPace(e.target.value as Goal['pace'])}
                    className="w-full bg-bg-card border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                  >
                    <option value="steady">Steady</option>
                    <option value="aggressive">Aggressive</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </label>
              </div>
              <label className="space-y-2 block">
                <span className="card-label mb-0">Preferred Work Window</span>
                <input
                  value={newGoalPreferredWindow}
                  onChange={(e) => setNewGoalPreferredWindow(e.target.value)}
                  placeholder="Ex. 07:30, lunch, evenings"
                  className="w-full bg-white/5 border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
                />
              </label>
              <label className="space-y-2 block">
                <span className="card-label mb-0">Motivation</span>
                <textarea
                  value={newGoalMotivation}
                  onChange={(e) => setNewGoalMotivation(e.target.value)}
                  placeholder="Why this matters now"
                  className="w-full bg-white/5 border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue min-h-20 resize-none"
                />
              </label>
              <label className="space-y-2 block">
                <span className="card-label mb-0">Constraints</span>
                <textarea
                  value={newGoalConstraints}
                  onChange={(e) => setNewGoalConstraints(e.target.value)}
                  placeholder="Tools, budget, schedule, environment, blockers"
                  className="w-full bg-white/5 border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue min-h-20 resize-none"
                />
              </label>
              <div className="flex justify-end space-x-6 items-center pt-3">
                <button type="button" onClick={() => setIsCreating(false)} className="btn-ghost">Close</button>
                <button type="submit" className="btn-primary">Initialize</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}// --- Goal Details Layout (3-Column when selected) ---

function GoalDetailsLayout({ goal, onClose }: { goal: Goal, onClose: () => void }) {
  const { user } = useContext(AuthContext);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [steps, setSteps] = useState<MicroStep[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStep, setSelectedStep] = useState<MicroStep | null>(null);
  const [terminalStep, setTerminalStep] = useState<MicroStep | null>(null);
  const [evidenceNotes, setEvidenceNotes] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [confidence, setConfidence] = useState(3);
  const [stepFeedback, setStepFeedback] = useState<MicroStep['feedback']>('on-track');

  // Quiz/Exam States
  const [examQuestions, setExamQuestions] = useState<any[] | null>(null);
  const [examLoading, setExamLoading] = useState(false);
  const [isTakingExam, setIsTakingExam] = useState(false);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [examFinished, setExamFinished] = useState(false);
  const [examError, setExamError] = useState<string | null>(null);

  useEffect(() => {
    if (!goal.id || !user) return;
    
    const qHistory = query(
      collection(db, 'goals', goal.id, 'history'), 
      where('userId', '==', user?.uid),
      orderBy('timestamp', 'asc')
    );
    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
      setMessages(msgs);
      if (msgs.length === 0 && goal.status === 'analyzing' && !isTyping) {
        triggerAI(goal.title, []);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'history'));

    const qSteps = query(
      collection(db, 'goals', goal.id, 'steps'), 
      where('userId', '==', user?.uid),
      orderBy('orderIndex', 'asc')
    );
    const unsubSteps = onSnapshot(qSteps, (snapshot) => {
      setSteps(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MicroStep)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'steps'));

    return () => {
      unsubHistory();
      unsubSteps();
    };
  }, [goal.id, user, goal.status]);

  useEffect(() => {
    if (!selectedStep) return;
    setEvidenceNotes(selectedStep.evidenceNotes || selectedStep.completionProof || '');
    setEvidenceUrl(selectedStep.evidenceUrl || '');
    setConfidence(selectedStep.confidence || 3);
    setStepFeedback(selectedStep.feedback || 'on-track');
  }, [selectedStep]);

  const triggerAI = async (goalTitle: string, history: ChatMessage[]) => {
    setIsTyping(true);
    try {
      const response = await interrogateGoal(goalTitle, history);
      await addDoc(collection(db, 'goals', goal.id, 'history'), {
        goalId: goal.id,
        userId: user?.uid,
        role: 'assistant',
        content: response,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('AI Error:', error);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user || isTyping) return;
    const userMsg = input;
    setInput('');
    try {
      await addDoc(collection(db, 'goals', goal.id, 'history'), {
        goalId: goal.id,
        userId: user.uid,
        role: 'user',
        content: userMsg,
        timestamp: serverTimestamp()
      });
      await triggerAI(goal.title, [...messages, { role: 'user', content: userMsg } as ChatMessage]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'history');
    }
  };

  const handleDecompose = async () => {
    setIsGenerating(true);
    try {
      const goalProfile = [
        `Deadline: ${goal.deadline || 'unset'}`,
        `Weekly capacity: ${goal.weeklyMinutes || 150} minutes`,
        `Skill level: ${goal.skillLevel || 'beginner'}`,
        `Pace: ${goal.pace || 'steady'}`,
        `Preferred work window: ${goal.preferredWindow || 'unset'}`,
        `Motivation: ${goal.motivation || 'unset'}`,
        `Constraints: ${goal.constraints || 'none'}`
      ].join('\n');
      const historyText = `${goalProfile}\n\nConversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      const result = await generateMicroSteps(goal.title, historyText);
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        await addDoc(collection(db, 'goals', goal.id, 'steps'), {
          goalId: goal.id,
          userId: user?.uid,
          title: step.title,
          description: step.description,
          durationMinutes: step.durationMinutes,
          difficulty: step.difficulty,
          status: 'pending',
          orderIndex: i
        });
      }
      await updateDoc(doc(db, 'goals', goal.id), { 
        status: 'active',
        currentPhase: 1,
        quizPassedForPhase: 0
      });
    } catch (error) {
      console.error('Decomposition error:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDecomposeNextPhase = async () => {
    setIsGenerating(true);
    try {
      const adaptiveContext = [
        `Deadline: ${goal.deadline || 'unset'}`,
        `Weekly capacity: ${goal.weeklyMinutes || 150} minutes`,
        `Skill level: ${goal.skillLevel || 'beginner'}`,
        `Pace: ${goal.pace || 'steady'}`,
        `Constraints: ${goal.constraints || 'none'}`,
        `Adaptive signals: ${buildAdaptiveSignals(goal, steps).join(' ')}`,
        `Completed proof coverage: ${proofCoverage}%`,
        `Average confidence: ${confidenceAverage || 'N/A'}`
      ].join('\n');
      const historyText = `${adaptiveContext}\n\nConversation:\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      const currentCount = steps.length;
      const currentPhaseIndex = goal.currentPhase || 1;
      const nextPhaseIndex = currentPhaseIndex + 1;
      
      const result = await generateNextPhaseSteps(goal.title, historyText, currentCount, nextPhaseIndex);
      
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        await addDoc(collection(db, 'goals', goal.id, 'steps'), {
          goalId: goal.id,
          userId: user?.uid,
          title: step.title,
          description: step.description,
          durationMinutes: step.durationMinutes,
          difficulty: step.difficulty,
          status: 'pending',
          orderIndex: currentCount + i
        });
      }
      
      // Update goal path phase
      await updateDoc(doc(db, 'goals', goal.id), {
        currentPhase: nextPhaseIndex
      });

      await addDoc(collection(db, 'goals', goal.id, 'history'), {
        goalId: goal.id,
        userId: user?.uid,
        role: 'assistant',
        content: `Quantum Coach Protocol: Phase ${nextPhaseIndex} calibrated successfully. Generated 10 sequential, microscopic steps beginning from step ${currentCount + 1}. Review the Micro-Allocations Log for your advanced deployment instructions.`,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error('Next phase generation error:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartExam = async () => {
    setExamLoading(true);
    setIsTakingExam(true);
    setExamQuestions(null);
    setExamFinished(false);
    setCurrentQuestionIdx(0);
    setSelectedAnswers({});
    setExamError(null);
    try {
      const currentPhaseIndex = goal.currentPhase || 1;
      const activeStepsOfCurrentPhase = steps.filter(
        s => s.orderIndex >= (currentPhaseIndex - 1) * 10 && s.orderIndex < currentPhaseIndex * 10
      );
      const stepsText = activeStepsOfCurrentPhase.map((s, idx) => `Step ${idx + 1}: ${s.title} - Description: ${s.description}`).join('\n');
      
      const response = await generatePhaseQuiz(goal.title, currentPhaseIndex, stepsText);
      if (response && response.questions && response.questions.length > 0) {
        setExamQuestions(response.questions);
      } else {
        throw new Error("Questions payload returned empty.");
      }
    } catch (error) {
      console.error("Exam generation error:", error);
      setExamError("Could not connect to evaluator interface. Please secure your calibration status and retry.");
    } finally {
      setExamLoading(false);
    }
  };

  const handlePassProgression = async (examScore: number) => {
    setIsGenerating(true);
    try {
      const currentPhaseIndex = goal.currentPhase || 1;
      
      // Set passed quiz field of the goal
      await updateDoc(doc(db, 'goals', goal.id), {
        quizPassedForPhase: currentPhaseIndex
      });

      // Add feedback history
      await addDoc(collection(db, 'goals', goal.id, 'history'), {
        goalId: goal.id,
        userId: user?.uid,
        role: 'assistant',
        content: `PROMPTED COMPETENCY CLEARANCE: Passed academic evaluator checkpoint for Phase ${currentPhaseIndex} with score of ${examScore}/25 (${Math.round((examScore / 25) * 100)}%). Credentials successfully logged. Tap 'Calibrate Phase ${currentPhaseIndex + 1} Protocols' below to advance.`,
        timestamp: serverTimestamp()
      });

      // Close modal
      setIsTakingExam(false);
      setExamQuestions(null);
    } catch (error) {
      console.error("Progression pass storing failed:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleStep = async (stepId: string, currentStatus: string) => {
    try {
      await updateDoc(doc(db, 'goals', goal.id, 'steps', stepId), {
        status: currentStatus === 'completed' ? 'pending' : 'completed',
        completedAt: currentStatus === 'completed' ? null : serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'steps');
    }
  };

  const saveStepEvidence = async (markComplete = false) => {
    if (!selectedStep) return;
    try {
      await updateDoc(doc(db, 'goals', goal.id, 'steps', selectedStep.id), {
        evidenceNotes,
        evidenceUrl,
        completionProof: evidenceNotes,
        confidence,
        feedback: stepFeedback,
        status: markComplete ? 'completed' : selectedStep.status,
        completedAt: markComplete ? serverTimestamp() : (selectedStep.completedAt || null)
      });
      setSelectedStep(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'steps');
    }
  };

  const selectAnswer = (questionIdx: number, optionIdx: number) => {
    if (selectedAnswers[questionIdx] !== undefined) return;
    setSelectedAnswers(prev => ({
      ...prev,
      [questionIdx]: optionIdx
    }));
  };

  const nextQuestion = () => {
    if (currentQuestionIdx < 24) {
      setCurrentQuestionIdx(prev => prev + 1);
    } else {
      setExamFinished(true);
    }
  };

  const currentPhaseIndex = goal.currentPhase || 1;
  const quizPassedForPhase = goal.quizPassedForPhase || 0;

  // Active Phase statistics
  const activeStepsOfCurrentPhase = steps.filter(
    s => s.orderIndex >= (currentPhaseIndex - 1) * 10 && s.orderIndex < currentPhaseIndex * 10
  );
  const activeStepsCount = activeStepsOfCurrentPhase.length;
  const activeCompletedCount = activeStepsOfCurrentPhase.filter(s => s.status === 'completed').length;
  
  // Progress calculations: 20 phases, each contributes exactly 5% of overall master progression!
  const isPhaseFinished = activeStepsCount === 10 && activeCompletedCount === 10;
  const overallProgressionPercent = Math.min(
    100,
    Math.round(((currentPhaseIndex - 1) * 5) + ((activeCompletedCount / (activeStepsCount || 10)) * 5))
  );
  const completedSteps = steps.filter(step => step.status === 'completed');
  const pendingSteps = steps.filter(step => step.status !== 'completed');
  const completedMinutes = completedSteps.reduce((sum, step) => sum + (step.durationMinutes || 0), 0);
  const remainingMinutes = pendingSteps.reduce((sum, step) => sum + (step.durationMinutes || 0), 0);
  const proofCount = completedSteps.filter(step => step.evidenceNotes || step.evidenceUrl || step.completionProof).length;
  const proofCoverage = completedSteps.length ? Math.round((proofCount / completedSteps.length) * 100) : 0;
  const confidenceAverage = completedSteps.length
    ? Math.round(completedSteps.reduce((sum, step) => sum + (step.confidence || 3), 0) / completedSteps.length)
    : 0;
  const deadlineRemaining = daysUntil(goal.deadline);
  const adaptiveSignals = buildAdaptiveSignals(goal, steps);
  const scheduleSlots = buildScheduleSlots(goal, steps);
  const weeklyCapacity = goal.weeklyMinutes || 150;
  const weeksToFinishVisiblePlan = weeklyCapacity ? Math.ceil(remainingMinutes / weeklyCapacity) : null;

  // Show immersive sandbox terminal if terminal practice is active
  if (terminalStep) {
    return (
      <TerminalSandbox
        goal={goal}
        step={terminalStep}
        onClose={() => setTerminalStep(null)}
        onVerificationAttempt={async (passed, feedback) => {
          await updateDoc(doc(db, 'goals', goal.id, 'steps', terminalStep.id), {
            attemptCount: increment(1),
            feedback: passed ? 'on-track' : 'too-hard',
            completionProof: feedback
          });
        }}
        onCompleteStep={async (proof) => {
          await updateDoc(doc(db, 'goals', goal.id, 'steps', terminalStep.id), {
            status: 'completed',
            completedAt: serverTimestamp(),
            completionProof: proof?.feedback || 'Sandbox verification passed.',
            evidenceNotes: proof?.feedback || 'Sandbox verification passed.',
            confidence: 5,
            feedback: 'on-track'
          });
          setTerminalStep(null);
        }}
      />
    );
  }

  // Show immersive exam center screen if quiz is active
  if (isTakingExam) {
    const examScore = examQuestions 
      ? examQuestions.filter((q, idx) => selectedAnswers[idx] === q.correctIndex).length 
      : 0;
    const examPassed = examScore >= 20;

    return (
      <ExamCenter 
        goal={goal}
        examQuestions={examQuestions}
        examLoading={examLoading}
        examError={examError}
        currentQuestionIdx={currentQuestionIdx}
        selectedAnswers={selectedAnswers}
        selectAnswer={selectAnswer}
        nextQuestion={nextQuestion}
        examFinished={examFinished}
        examScore={examScore}
        examPassed={examPassed}
        onProgressProgression={() => handlePassProgression(examScore)}
        onClose={() => {
          setIsTakingExam(false);
          setExamQuestions(null);
        }}
        onRetry={handleStartExam}
      />
    );
  }

  return (
    <React.Fragment>
      <main className="main-content">
        <header className="mb-12 flex justify-between items-start">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-text-secondary mb-2">Goal Tracking Profile: High Sophistication Mode</p>
            <h1 className="text-4xl font-light text-text-primary tracking-tight">{goal.title}</h1>
            <div className="font-mono text-[11px] text-text-secondary opacity-60 uppercase mt-2 tracking-widest">
              ID: {goal.id.slice(0, 8)} • PHASE {currentPhaseIndex} of 20 • {steps.length} TOTAL STEPS • {paceLabels[goal.pace || 'steady']} PACE
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-text-secondary hover:text-accent-blue transition-colors">
            <Trash2 className="w-5 h-5 opacity-40 hover:opacity-100" onClick={(e) => {
              e.stopPropagation();
              if (window.confirm("Terminate diagnostic and all associated intervals?")) {
                deleteDoc(doc(db, 'goals', goal.id)).then(() => onClose());
              }
            }} />
          </button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
          <section className="card flex flex-col h-full">
            <span className="card-label">Micro-Allocations Log</span>
            <div className="flex-1 overflow-y-auto pr-4 mt-2">
              {steps.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-20 italic space-y-4">
                  <div className="w-8 h-8 rounded-full border border-accent-blue animate-pulse" />
                  <p className="text-xs">Interval decomposition awaiting authorization...</p>
                </div>
              ) : (
                <div className="py-2">
                  {steps.map((step, idx) => {
                    const showPhaseHeader = idx % 10 === 0;
                    const phaseNum = Math.floor(idx / 10) + 1;
                    const isPhaseCurrent = phaseNum === currentPhaseIndex;
                    const isPhaseComplete = phaseNum < currentPhaseIndex;

                    return (
                      <React.Fragment key={step.id}>
                        {showPhaseHeader && (
                          <div className="py-4 flex items-center space-x-3 mt-4 mb-2">
                            <div className={cn(
                              "text-[10px] font-mono uppercase tracking-widest border px-2.5 py-1 rounded",
                              isPhaseCurrent && "text-accent-blue bg-accent-blue/10 border-accent-blue/30",
                              isPhaseComplete && "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
                              !isPhaseCurrent && !isPhaseComplete && "text-text-secondary bg-white/5 border-white/10 opacity-40"
                            )}>
                              Phase {phaseNum} Calibrations
                            </div>
                            <div className="h-[1px] flex-1 bg-border-color/30" />
                            <span className="text-[9px] font-mono uppercase tracking-wider opacity-40">
                              {isPhaseCurrent ? "ACTIVE TARGET" : (isPhaseComplete ? "COMPLETED" : "LOCKED")}
                            </span>
                          </div>
                        )}
                        <div className="flex group">
                          <div className="flex flex-col items-center mr-6">
                            <div className={cn(
                              "w-[1px] h-4 bg-border-color", 
                              idx === 0 && "invisible"
                            )} />
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleStep(step.id, step.status);
                              }}
                              className={cn(
                                "w-4 h-4 rounded-full border-2 flex-shrink-0 transition-all duration-300 flex items-center justify-center cursor-pointer z-10",
                                step.status === 'completed' 
                                  ? "border-accent-blue bg-accent-blue shadow-[0_0_12px_rgba(56,189,248,0.5)]" 
                                  : "border-border-color bg-bg-sidebar hover:border-accent-blue/50"
                              )}
                            >
                              {step.status === 'completed' && <Check className="w-2 h-2 text-bg-darkest stroke-[4]" />}
                            </div>
                            <div className={cn(
                              "w-[1px] flex-1 bg-border-color", 
                              idx === steps.length - 1 && "invisible"
                            )} />
                          </div>
                          <div 
                            onClick={() => setSelectedStep(step)}
                            className={cn(
                              "flex-1 pb-8 transition-all cursor-pointer group/content",
                              step.status === 'completed' ? "opacity-30" : "opacity-100"
                            )}
                            title="Click for detailed instructions"
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 mr-4">
                                 <div className="flex items-center space-x-2 mb-1">
                                   <h4 className={cn(
                                      "text-sm font-medium tracking-tight transition-colors",
                                      step.status === 'completed' ? "line-through" : "text-text-primary group-hover/content:text-accent-blue"
                                   )}>
                                      {step.title}
                                   </h4>
                                   <div className="flex space-x-0.5 opacity-40 group-hover/content:opacity-80 transition-opacity">
                                     {[...Array(5)].map((_, i) => (
                                       <div 
                                         key={i} 
                                         className={cn(
                                           "w-1 h-1 rounded-full",
                                           i < step.difficulty ? "bg-accent-blue" : "bg-white/20"
                                         )} 
                                       />
                                     ))}
                                   </div>
                                   <Info className="w-3 h-3 text-accent-blue opacity-0 group-hover/content:opacity-100 transition-opacity" />
                                 </div>
                                 <p className="text-[10px] text-text-secondary/60 leading-relaxed line-clamp-1 italic">
                                    {step.description}
                                 </p>
                              </div>
                              <div className="text-right">
                                 <div className="font-mono text-[10px] text-accent-blue tracking-tighter">{step.durationMinutes}m</div>
                                 <div className="text-[9px] text-text-secondary/40 font-mono uppercase tracking-tighter">step {idx + 1}</div>
                              </div>
                            </div>
                            
                            <div className="h-[1px] bg-white/5 w-full relative">
                               <motion.div 
                                 initial={false}
                                 animate={{ 
                                   width: step.status === 'completed' ? "100%" : "0%",
                                   opacity: step.status === 'completed' ? 1 : 0
                                 }}
                                 className="absolute top-0 left-0 h-full bg-accent-blue shadow-[0_0_8px_var(--color-accent-blue)]"
                                />
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="card flex flex-col items-center justify-center p-12 text-center h-full max-h-[450px]">
            <span className="card-label absolute top-6 left-6">Goal Decomposition Engine</span>
            <div className="text-7xl font-extralight text-accent-blue tracking-tighter mb-4">
              {steps.length > 0 ? overallProgressionPercent : 0}<span className="text-2xl font-light opacity-60 ml-1">%</span>
            </div>
            <div className="text-[10px] uppercase tracking-[3px] text-text-secondary font-mono">Calculated Progress</div>
            
            <div className="w-full mt-12 pt-8 border-t border-border-color space-y-4">
              <div className="flex justify-between items-center text-[10px] font-mono text-text-secondary uppercase">
                <span>Phase Progress</span>
                <span className="text-text-primary">{currentPhaseIndex} / 20 ({overallProgressionPercent}%)</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-text-secondary uppercase">
                <span>Evidence Coverage</span>
                <span className={proofCoverage >= 70 ? "text-emerald-400" : "text-yellow-400"}>{proofCoverage}%</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-text-secondary uppercase">
                <span>Completed Work</span>
                <span className="text-text-primary">{formatMinutes(completedMinutes)}</span>
              </div>
              <div className="flex justify-between items-center text-[10px] font-mono text-text-secondary uppercase">
                <span>Visible Plan ETA</span>
                <span className="text-text-primary">{weeksToFinishVisiblePlan ? `${weeksToFinishVisiblePlan} week${weeksToFinishVisiblePlan === 1 ? '' : 's'}` : 'Set capacity'}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
          <section className="card">
            <span className="card-label">Adaptive Roadmap</span>
            <div className="space-y-3">
              {adaptiveSignals.map((signal, idx) => (
                <div key={idx} className="text-xs text-text-secondary leading-relaxed border-l border-accent-blue/40 pl-3">
                  {signal}
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <span className="card-label">Mastery Analytics</span>
            <div className="space-y-3 text-[11px] font-mono uppercase text-text-secondary">
              <div className="flex justify-between"><span>Confidence Avg</span><span className="text-text-primary">{confidenceAverage || 'N/A'} / 5</span></div>
              <div className="flex justify-between"><span>Remaining Load</span><span className="text-text-primary">{formatMinutes(remainingMinutes)}</span></div>
              <div className="flex justify-between"><span>Attempt Count</span><span className="text-text-primary">{steps.reduce((sum, step) => sum + (step.attemptCount || 0), 0)}</span></div>
              <div className="flex justify-between"><span>Deadline</span><span className={deadlineRemaining !== null && deadlineRemaining < 14 ? "text-yellow-400" : "text-text-primary"}>{deadlineRemaining === null ? 'Unset' : `${deadlineRemaining} days`}</span></div>
            </div>
          </section>
          <section className="card">
            <span className="card-label">User Constraints</span>
            <p className="text-xs text-text-secondary leading-relaxed mb-3">{goal.constraints || 'No constraints captured yet.'}</p>
            <div className="text-[10px] font-mono uppercase text-text-secondary">
              Skill: <span className="text-text-primary">{goal.skillLevel || 'Uncalibrated'}</span>
            </div>
          </section>
        </div>
      </main>

      <aside className="ai-panel">
        <div className="ai-status-box font-mono">
           {isGenerating ? "Synthesizing intervals..." : (goal.status === 'analyzing' ? "AI Agent: Interrogating Pathway" : "AI Agent: Active Communication Mode")}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 mb-6 min-h-[250px]">
          {messages.map(msg => (
            <div key={msg.id} className={cn("ai-bubble", msg.role === 'assistant' && "ai-bubble-highlight")}>
              {msg.content}
            </div>
          ))}
          {isTyping && (
             <div className="ai-bubble animate-pulse">Scanning goal requirements...</div>
          )}
          {isGenerating && (
             <div className="ai-bubble animate-pulse">Generating steps via Quantum Leaps...</div>
          )}
        </div>

        <div className="space-y-4">
          <form onSubmit={handleSendMessage} className="space-y-3">
            <input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={goal.status === 'analyzing' ? "Response to diagnostic..." : "Message Quantum Coach..."}
              className="w-full bg-transparent border border-border-color rounded p-3 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
              disabled={isGenerating || isTyping}
            />
            {goal.status === 'analyzing' && messages.length > 3 && (
               <button 
                 type="button" 
                 onClick={handleDecompose}
                 className="w-full py-3 border border-accent-blue text-accent-blue rounded text-[11px] uppercase tracking-widest hover:bg-accent-glow transition-all"
                 disabled={isGenerating}
               >
                 Authorize Decomposition
               </button>
            )}
            {goal.status === 'active' && (() => {
              const hasPassedQuiz = quizPassedForPhase >= currentPhaseIndex;
              
              if (!isPhaseFinished) {
                return (
                  <div className="p-3 bg-white/5 border border-white/10 rounded text-center">
                    <div className="text-[10px] uppercase font-mono tracking-widest text-text-secondary opacity-60 mb-1">
                      Current Phase {currentPhaseIndex} Status
                    </div>
                    <div className="text-xs text-text-primary">
                      {activeCompletedCount} of {activeStepsCount || 10} Intervals Completed
                    </div>
                    <div className="h-1 bg-white/10 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-accent-blue h-full shadow-[0_0_8px_var(--color-accent-blue)] transition-all duration-500" 
                        style={{ width: `${(activeCompletedCount / (activeStepsCount || 10)) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              }
              
              if (isPhaseFinished && !hasPassedQuiz) {
                return (
                  <button 
                    type="button" 
                    onClick={handleStartExam}
                    className="w-full py-3 bg-accent-blue border border-accent-blue text-bg-darkest font-semibold rounded text-[11px] uppercase tracking-widest hover:shadow-[0_0_15px_rgba(56,189,248,0.4)] transition-all flex items-center justify-center space-x-2 animate-bounce"
                    disabled={isGenerating || examLoading}
                  >
                    <span>Initiate Phase {currentPhaseIndex} Exam</span>
                  </button>
                );
              }
              
              return (
                <button 
                  type="button" 
                  onClick={handleDecomposeNextPhase}
                  className="w-full py-3 bg-accent-blue/10 border border-accent-blue text-accent-blue rounded text-[11px] uppercase tracking-widest hover:bg-accent-blue/20 transition-all flex items-center justify-center space-x-2"
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Calibrate Phase {currentPhaseIndex + 1} Protocols</span>
                </button>
              );
            })()}
          </form>

          {goal.status === 'active' && (
            <div className="pt-4 border-t border-border-color">
              <span className="card-label mb-2">Schedule Intelligence</span>
              <div className="grid grid-cols-2 gap-2">
                {scheduleSlots.map(slot => (
                  <div key={`${slot.label}-${slot.detail}`} className={cn("cal-slot hover:bg-white/5 transition-colors", slot.active && "cal-slot-active text-white")}>
                    {slot.label} — {slot.detail}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-text-secondary/60 leading-relaxed mt-3">
                Based on {formatMinutes(weeklyCapacity)} weekly capacity and the next visible step.
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Step Detail Modal */}
      <AnimatePresence>
        {selectedStep && (
          <div className="fixed inset-0 bg-bg-darkest/95 backdrop-blur-md z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="card max-w-4xl w-full p-8 border-accent-blue/30 shadow-[0_0_40px_rgba(56,189,248,0.1)] relative max-h-[90vh] overflow-y-auto"
            >
              <button 
                onClick={() => setSelectedStep(null)}
                className="absolute top-6 right-6 text-text-secondary hover:text-white transition-colors"
                id="close-step-detail"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>

              <div className="flex items-center space-x-3 mb-6">
                <span className="card-label mb-0">Quantum Execution Protocol</span>
                <span className="text-[10px] text-text-secondary font-mono opacity-50 uppercase tracking-tighter">
                  Step {steps.indexOf(selectedStep) + 1} of {steps.length}
                </span>
              </div>

              <h2 className="text-3xl font-light text-text-primary tracking-tight mb-4">
                {selectedStep.title}
              </h2>

              <div className="flex items-center space-x-8 mb-8 pb-8 border-b border-border-color">
                <div className="flex flex-col">
                  <span className="text-[9px] text-text-secondary uppercase tracking-widest mb-1">Time Profile</span>
                  <div className="flex items-center space-x-2 text-accent-blue font-mono">
                    <Clock className="w-3 h-3" />
                    <span>{selectedStep.durationMinutes} Minutes</span>
                  </div>
                </div>

                <div className="flex flex-col">
                  <span className="text-[9px] text-text-secondary uppercase tracking-widest mb-1">Complexity Delta</span>
                  <div className="flex space-x-1">
                    {[...Array(5)].map((_, i) => (
                      <div 
                        key={i} 
                        className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          i < selectedStep.difficulty ? "bg-accent-blue shadow-[0_0_5px_var(--color-accent-blue)]" : "bg-white/10"
                        )} 
                      />
                    ))}
                  </div>
                </div>

                <div className="flex flex-col">
                   <span className="text-[9px] text-text-secondary uppercase tracking-widest mb-1">Current Status</span>
                   <span className={cn(
                     "text-[10px] font-mono uppercase tracking-wider",
                     selectedStep.status === 'completed' ? "text-accent-blue" : "text-text-secondary opacity-60"
                   )}>
                     {selectedStep.status === 'completed' ? 'Executed' : 'Pending Deployment'}
                   </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 mb-10">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-mono uppercase text-text-primary tracking-widest mb-3 flex items-center space-x-2">
                      <Info className="w-3 h-3 text-accent-blue" />
                      <span>Operational Briefing</span>
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed font-light">
                      {selectedStep.description}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xs font-mono uppercase text-text-primary tracking-widest mb-3 flex items-center space-x-2">
                      <CheckCircle2 className="w-3 h-3 text-accent-blue" />
                      <span>Action Checklist</span>
                    </h3>
                    <div className="space-y-2">
                      {buildStepChecklist(selectedStep).map(item => (
                        <div key={item} className="flex items-start gap-3 text-xs text-text-secondary leading-relaxed">
                          <Check className="w-3 h-3 text-accent-blue mt-0.5 shrink-0" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-mono uppercase text-text-primary tracking-widest mb-3 flex items-center space-x-2">
                      <Target className="w-3 h-3 text-accent-blue" />
                      <span>Success Criteria</span>
                    </h3>
                    <div className="space-y-2">
                      {buildSuccessCriteria(selectedStep).map(item => (
                        <div key={item} className="text-xs text-text-secondary leading-relaxed border-l border-accent-blue/30 pl-3">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-accent-glow border border-accent-blue/20 rounded-lg">
                    <h3 className="text-[10px] font-mono uppercase text-accent-blue tracking-widest mb-2 flex items-center space-x-2">
                      <ShieldAlert className="w-3 h-3" />
                      <span>Common Failure Modes</span>
                    </h3>
                    <div className="space-y-1 text-[11px] text-accent-blue/80 font-light leading-relaxed">
                      <p>Expanding the task beyond the allotted interval.</p>
                      <p>Marking completion without proof or a visible artifact.</p>
                      <p>Confusing research activity with a concrete next output.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-accent-blue/5 border border-accent-blue/20 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex-1 text-left">
                      <h3 className="text-[10px] font-mono uppercase text-accent-blue tracking-widest mb-1 flex items-center space-x-1.5 font-semibold">
                        <Terminal className="w-3.5 h-3.5 animate-pulse" />
                        <span>Practice Sandbox & Cloud VM</span>
                      </h3>
                      <p className="text-[11px] text-text-secondary leading-relaxed font-light">
                        Practice the step in the browser lab, save attempts, and use verification as completion evidence.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setTerminalStep(selectedStep);
                        setSelectedStep(null);
                      }}
                      className="btn-primary py-2 px-4 text-[10px] whitespace-nowrap uppercase tracking-wider flex items-center space-x-1.5"
                      id="launch-practice-sandbox"
                    >
                      <span>Launch Sandbox</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-white/5 border border-border-color rounded-lg">
                    <span className="card-label mb-3">Completion Evidence</span>
                    <textarea
                      value={evidenceNotes}
                      onChange={(e) => setEvidenceNotes(e.target.value)}
                      placeholder="What did you produce, decide, run, submit, or learn?"
                      className="w-full bg-bg-darkest border border-border-color rounded p-3 text-xs text-text-primary focus:outline-none focus:border-accent-blue min-h-28 resize-none"
                    />
                    <input
                      value={evidenceUrl}
                      onChange={(e) => setEvidenceUrl(e.target.value)}
                      placeholder="Optional proof link"
                      className="w-full bg-bg-darkest border border-border-color rounded p-3 text-xs text-text-primary focus:outline-none focus:border-accent-blue mt-3"
                    />
                  </div>

                  <div className="p-4 bg-white/5 border border-border-color rounded-lg">
                    <span className="card-label mb-3">Mastery Signal</span>
                    <label className="text-[10px] uppercase font-mono text-text-secondary tracking-widest">Confidence: {confidence}/5</label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={confidence}
                      onChange={(e) => setConfidence(Number(e.target.value))}
                      className="w-full accent-sky-400 mt-2"
                    />
                    <select
                      value={stepFeedback}
                      onChange={(e) => setStepFeedback(e.target.value as MicroStep['feedback'])}
                      className="w-full bg-bg-darkest border border-border-color rounded p-3 text-xs text-text-primary focus:outline-none focus:border-accent-blue mt-4"
                    >
                      <option value="on-track">On track</option>
                      <option value="too-hard">Too hard</option>
                      <option value="too-easy">Too easy</option>
                      <option value="irrelevant">Irrelevant</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex gap-3">
                  <button 
                    onClick={() => saveStepEvidence(selectedStep.status !== 'completed')}
                    className={cn(
                      "btn-primary px-8 py-3",
                      selectedStep.status === 'completed' ? "border-text-secondary text-text-secondary hover:bg-white/5" : ""
                    )}
                    id="complete-step-btn"
                  >
                    {selectedStep.status === 'completed' ? 'Save Evidence' : 'Save Proof & Complete'}
                  </button>
                  <button
                    onClick={() => saveStepEvidence(false)}
                    className="btn-ghost"
                  >
                    Save Draft
                  </button>
                </div>
                <div className="flex items-center space-x-4 text-text-secondary text-[10px] uppercase font-mono tracking-tighter opacity-40">
                  <span>Path Level: Phase {currentPhaseIndex}</span>
                  <ExternalLink className="w-3 h-3" />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </React.Fragment>
  );
}

// --- IMMERSIVE COGNITIVE EVALUATOR SCREEN (Examcenter) ---

function ExamCenter({
  goal,
  examQuestions,
  examLoading,
  examError,
  currentQuestionIdx,
  selectedAnswers,
  selectAnswer,
  nextQuestion,
  examFinished,
  examScore,
  examPassed,
  onProgressProgression,
  onClose,
  onRetry
}: {
  goal: Goal;
  examQuestions: any[] | null;
  examLoading: boolean;
  examError: string | null;
  currentQuestionIdx: number;
  selectedAnswers: Record<number, number>;
  selectAnswer: (qIdx: number, oIdx: number) => void;
  nextQuestion: () => void;
  examFinished: boolean;
  examScore: number;
  examPassed: boolean;
  onProgressProgression: () => Promise<void>;
  onClose: () => void;
  onRetry: () => void;
}) {
  const currentPhaseIndex = goal.currentPhase || 1;
  const currentQuestion = examQuestions?.[currentQuestionIdx];
  const totalQuestions = examQuestions?.length || 25;
  const isAnswered = selectedAnswers[currentQuestionIdx] !== undefined;
  const selectedOption = selectedAnswers[currentQuestionIdx];

  return (
    <div className="min-h-screen bg-bg-darkest flex flex-col font-sans relative text-text-primary overflow-y-auto">
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20 z-0">
        <div className="absolute top-1/4 left-1/3 w-[600px] h-[600px] bg-accent-blue/5 blur-[150px] rounded-full" />
      </div>

      <header className="border-b border-border-color/60 py-6 px-12 flex justify-between items-center z-10 bg-bg-darkest/80 backdrop-blur-md sticky top-0">
        <div>
          <span className="text-[9px] uppercase tracking-widest text-accent-blue font-mono">Quantum Coach Compete Protocol</span>
          <h2 className="text-xl font-light tracking-tight">{goal.title}</h2>
        </div>
        <button 
          onClick={onClose}
          className="text-text-secondary hover:text-white uppercase text-[10px] tracking-wider font-mono border border-border-color py-1.5 px-4 rounded hover:bg-white/5 transition-colors"
        >
          Abort Exam
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 z-10">
        {examLoading ? (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center space-y-4 max-w-sm"
          >
            <Loader2 className="w-10 h-10 animate-spin text-accent-blue mx-auto" />
            <p className="text-xs uppercase tracking-widest font-mono text-text-secondary">Synthesizing {totalQuestions} Competency Evaluation Inferences...</p>
            <p className="text-[10px] text-text-secondary/50 font-mono">Compiling steps of completed Phase {currentPhaseIndex}. This might take up to 10 seconds.</p>
          </motion.div>
        ) : examError ? (
          <div className="text-center space-y-4 max-w-md">
            <h3 className="text-lg font-light text-red-400 font-mono uppercase">Calibration Matrix Offline</h3>
            <p className="text-xs text-text-secondary">{examError}</p>
            <button onClick={onRetry} className="btn-primary w-full py-2.5">Retry Evaluation Build</button>
          </div>
        ) : !examQuestions || examQuestions.length === 0 ? (
          <div className="text-center space-y-4 max-w-sm">
            <h3 className="text-lg font-light text-red-300 font-mono uppercase">Empty Matrix</h3>
            <p className="text-xs text-text-secondary">Unable to initiate connection with cognitive synthesis endpoint.</p>
            <button onClick={onRetry} className="btn-primary w-full py-2.5">Re-Attempt Calibration</button>
          </div>
        ) : !examFinished ? (
          <motion.div 
            key={currentQuestionIdx}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="w-full max-w-3xl card p-8 border-border-color/80 relative"
          >
            <div className="absolute top-0 left-0 w-full h-[2px] bg-white/5">
              <div 
                className="bg-accent-blue h-full shadow-[0_0_8px_var(--color-accent-blue)] transition-all duration-300"
                style={{ width: `${((currentQuestionIdx) / totalQuestions) * 100}%` }}
              />
            </div>

            <div className="flex justify-between items-center mb-8">
              <span className="card-label mb-0 uppercase text-[10px] tracking-widest font-mono text-accent-blue">
                Phase {currentPhaseIndex} Evaluator
              </span>
              <span className="font-mono text-[10px] text-text-secondary">
                Question {currentQuestionIdx + 1} of {totalQuestions}
              </span>
            </div>

            <h3 className="text-lg md:text-xl font-light text-text-primary tracking-tight leading-relaxed mb-8">
              {currentQuestion?.question}
            </h3>

            <div className="grid grid-cols-1 gap-3 mb-8">
              {currentQuestion?.options ? currentQuestion.options.map((option: string, idx: number) => {
                const isSelected = selectedOption === idx;
                const isCorrect = idx === currentQuestion.correctIndex;
                const isWrongSelection = isSelected && !isCorrect;

                let btnStyles = "border border-border-color/80 hover:bg-white/5 hover:border-text-secondary/50 text-text-primary";
                if (isAnswered) {
                  if (isCorrect) {
                     btnStyles = "border-emerald-500 bg-emerald-500/10 text-emerald-300 pointer-events-none font-medium";
                  } else if (isWrongSelection) {
                     btnStyles = "border-red-500 bg-red-500/10 text-red-300 pointer-events-none font-medium";
                  } else {
                     btnStyles = "border-border-color/30 text-text-secondary/40 pointer-events-none";
                  }
                }

                return (
                  <button
                    key={idx}
                    onClick={() => selectAnswer(currentQuestionIdx, idx)}
                    className={cn(
                      "w-full text-left p-4 rounded text-sm transition-all flex items-center justify-between",
                      btnStyles
                    )}
                  >
                    <span>{idx + 1}. {option}</span>
                    {isAnswered && isCorrect && <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-emerald-400">CORRECT</span>}
                    {isAnswered && isWrongSelection && <span className="text-[10px] uppercase font-mono font-bold tracking-widest text-red-400">INCORRECT</span>}
                  </button>
                );
              }) : null}
            </div>

            <AnimatePresence>
              {isAnswered && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 bg-white/5 border border-white/10 rounded-lg mb-8 text-xs font-light leading-relaxed text-text-secondary/90"
                >
                  <p className="font-semibold text-text-primary mb-1 text-[10px] uppercase tracking-wider font-mono">Explanation Detail</p>
                  {currentQuestion?.explanation}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex justify-between items-center pt-4 border-t border-border-color/40">
              <div className="text-[9px] uppercase font-mono text-text-secondary/50 tracking-widest">
                Score: {Object.keys(selectedAnswers).filter(k => selectedAnswers[Number(k)] === examQuestions[Number(k)].correctIndex).length} / {totalQuestions}
              </div>
              <button
                onClick={nextQuestion}
                disabled={!isAnswered}
                className={cn(
                  "btn-primary py-2.5 px-8 text-xs font-mono uppercase tracking-widest",
                  !isAnswered && "opacity-40 pointer-events-none"
                )}
              >
                {currentQuestionIdx === totalQuestions - 1 ? 'Finish Exam' : 'Next Question'}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-xl card p-10 text-center border-border-color/80 relative"
          >
            <div className="absolute top-0 left-0 w-full h-[3px] bg-white/5">
              <div className={cn("h-full", examPassed ? "bg-emerald-500 shadow-[0_0_10px_#10b981]" : "bg-red-500 shadow-[0_0_10px_#ef4444]")} style={{ width: '100%' }} />
            </div>

            <div className="mb-6 mx-auto w-16 h-16 rounded-full flex items-center justify-center border-2 border-dashed border-accent-blue/30 bg-accent-blue/5">
              {examPassed ? (
                <Check className="w-8 h-8 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-8 h-8 text-red-400" />
              )}
            </div>

            <span className="text-[9px] uppercase tracking-widest font-mono text-accent-blue">Competency Report</span>
            <h3 className="text-3xl font-light text-text-primary tracking-tight mt-2 mb-6">
              {examPassed ? 'Exam Protocols Approved' : 'Accuracy Index Sub-optimal'}
            </h3>

            <div className="bg-white/5 border border-white/10 rounded-lg p-6 mb-8 grid grid-cols-2 gap-4">
              <div>
                <div className="text-3xl font-light tracking-tight text-text-primary font-mono">{examScore} <span className="text-xs text-text-secondary">/ 25</span></div>
                <div className="text-[9px] text-text-secondary uppercase tracking-widest font-mono mt-1">Correct Answers</div>
              </div>
              <div>
                <div className="text-3xl font-light tracking-tight text-text-primary font-mono">{Math.round((examScore / 25) * 100)}%</div>
                <div className="text-[9px] text-text-secondary uppercase tracking-widest font-mono mt-1">Accuracy Score</div>
              </div>
            </div>

            <p className="text-xs font-light text-text-secondary leading-relaxed mb-8 max-w-sm mx-auto">
              {examPassed 
                ? `Incredible. You reached an accuracy of ${Math.round((examScore / 25) * 100)}%, exceeding the 80% passing threshold (20/25 questions) for Phase ${currentPhaseIndex}. You are authorized for progress.`
                : `Precision is authority. You reached an accuracy of ${Math.round((examScore / 25) * 100)}%, which is below the 80% requirement (20 correct). Re-read Phase ${currentPhaseIndex} briefs and try again.`
              }
            </p>

            <div className="space-y-3">
              {examPassed ? (
                <button 
                  onClick={onProgressProgression}
                  className="btn-primary w-full py-3 text-xs uppercase tracking-widest font-semibold"
                >
                  Lock Competency & Secure Phase Progression
                </button>
              ) : (
                <React.Fragment>
                  <button 
                    onClick={onRetry}
                    className="btn-primary w-full py-3 text-xs uppercase tracking-widest font-semibold bg-white/10 hover:bg-white/15 text-text-primary border-border-color"
                  >
                    Re-Attempt Evaluator Matrix
                  </button>
                  <button 
                    onClick={onClose}
                    className="w-full text-[10px] text-text-secondary hover:text-white uppercase tracking-widest font-mono py-2 transition-colors"
                  >
                    Return to Micro-Allocations Log
                  </button>
                </React.Fragment>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
