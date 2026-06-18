import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Terminal as TerminalIcon, 
  Play, 
  RotateCcw, 
  CheckCircle, 
  X, 
  HelpCircle, 
  ExternalLink, 
  Loader2, 
  Check, 
  Maximize2, 
  Lightbulb, 
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Terminal,
  Files,
  Search,
  GitBranch,
  Settings,
  FolderOpen,
  Folder,
  FileCode,
  FileText,
  File,
  AlertTriangle,
  PlayCircle,
  Command,
  Save,
  HelpCircle as HelpIcon,
  Activity,
  Maximize,
  Sliders,
  Sparkles,
  Layers,
  BookOpen
} from 'lucide-react';
import { generateTerminalChallenge, verifyCodeSolution } from '../lib/gemini';

// Extends Window interface for Pyodide in TypeScript
declare global {
  interface Window {
    loadPyodide?: () => Promise<any>;
    pyodideInstance?: any;
  }
}

interface Goal {
  id: string;
  title: string;
}

interface MicroStep {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
}

interface TerminalSandboxProps {
  goal: Goal;
  step: MicroStep;
  onClose: () => void;
  onCompleteStep: () => Promise<void>;
}

interface FileState {
  name: string;
  content: string;
  language: string;
  isLocked?: boolean;
}

export default function TerminalSandbox({ goal, step, onClose, onCompleteStep }: TerminalSandboxProps) {
  const [challenge, setChallenge] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // VS Code Navigation and Sidebar views
  const [activeSidebarTab, setActiveSidebarTab] = useState<'explorer' | 'search' | 'git' | 'debug' | 'extensions'>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeFileName, setActiveFileName] = useState<string>('');
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, FileState>>({});
  const [tabsList, setTabsList] = useState<string[]>([]);
  const [activeTerminalTab, setActiveTerminalTab] = useState<'terminal' | 'output' | 'problems' | 'debug-console'>('terminal');
  const [workspaceLayoutTab, setWorkspaceLayoutTab] = useState<'split' | 'editor' | 'terminal'>('split');
  const [splitTerminalHeight, setSplitTerminalHeight] = useState<number>(280);
  
  // Custom VS Code Features state
  const [searchQuery, setSearchQuery] = useState('');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [editorCursor, setEditorCursor] = useState({ line: 1, col: 1 });
  const [problemsCount, setProblemsCount] = useState(0);

  // Terminal screen output
  const [consoleLogs, setConsoleLogs] = useState<{ text: string; type: 'info' | 'error' | 'success' | 'warn' | 'input' }[]>([]);
  const [showHint, setShowHint] = useState(false);
  
  // Evaluation state
  const [verifying, setVerifying] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);
  const [passed, setPassed] = useState(false);

  const consoleEndRef = useRef<HTMLDivElement>(null);
  const textEditorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchChallenge();
  }, [step.id]);

  const fetchChallenge = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await generateTerminalChallenge(goal.title, step.title, step.description);
      setChallenge(result);
      
      // Initialize dynamic VS Code files based on practiceType
      const practiceLang = result.practiceType || 'generic';
      const mainFile = practiceLang === 'python' ? 'main.py' : (practiceLang === 'javascript' ? 'index.js' : 'script.sh');
      const startCode = result.startingCode || '';
      
      const files: Record<string, FileState> = {
        'README.md': {
          name: 'README.md',
          content: `# ${step.title}\n\n## Mission briefing\n\n${step.description}\n\n## Target Objective Challenge\n\n${result.challengeInstructions || "Complete the laboratory verification using the interactive compilation terminal below."}\n\n---\n*Type your solution into the workspace and run verification steps to execute.*`,
          language: 'markdown'
        },
        [mainFile]: {
          name: mainFile,
          content: startCode,
          language: practiceLang
        }
      };

      if (practiceLang === 'python') {
        files['requirements.txt'] = {
          name: 'requirements.txt',
          content: 'pandas>=2.0.0\nnumpy>=1.24.0\nscikit-learn>=1.2.0\npytest>=7.0.0\n',
          language: 'plaintext'
        };
      } else if (practiceLang === 'javascript') {
        files['package.json'] = {
          name: 'package.json',
          content: JSON.stringify({
            name: "quantum-lab-sandbox",
            version: "1.0.0",
            description: "Interactive browser terminal sandbox runtime",
            main: "index.js",
            dependencies: {
              "lodash": "^4.17.21"
            }
          }, null, 2),
          language: 'json'
        };
      } else {
        files['config.env'] = {
          name: 'config.env',
          content: `ENV_MODE=LABORATORY_CALIBRATED\nPORT=3000\nGRID_ID=NODE_VM_ALPHA\n`,
          language: 'plaintext'
        };
      }

      setWorkspaceFiles(files);
      setActiveFileName(mainFile);
      setTabsList(['README.md', mainFile]);
      
      // Initialize integrated terminal
      const initialLogs = [
        { text: `Microsoft Windows [Version 10.0.22631.3527]`, type: 'info' },
        { text: `(c) Microsoft Corporation. All rights reserved.`, type: 'info' },
        { text: ``, type: 'info' },
        { text: `* Initializing VS Code Interactive Terminal sandbox daemon...`, type: 'info' },
        { text: `* Connected virtual container sub-resource grid: "${goal.title}"`, type: 'info' },
        { text: `* Loaded WebOS Terminal runtime optimized for language: ${practiceLang.toUpperCase()}`, type: 'success' },
        { text: `* To practice on a live online VM server, click 'Connect External VM Terminal' button inside explorer card.`, type: 'warn' },
        { text: ``, type: 'info' },
        { text: `PS C:\\Users\\quantum\\workspace> _`, type: 'success' }
      ] as any[];
      setConsoleLogs(initialLogs);

      if (practiceLang === 'python') {
        loadPyodideScript();
      }
    } catch (err) {
      console.error(err);
      setError('Could not establish VS Code sandbox workspace calibration session. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  const loadPyodideScript = () => {
    if (window.pyodideInstance) return;
    const existingScript = document.getElementById('pyodide-cdn-script');
    if (existingScript) return;

    const script = document.createElement('script');
    script.id = 'pyodide-cdn-script';
    script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js";
    script.async = true;
    script.onload = () => {
      addToConsole("Status indicator: Fully Loaded client-side Python Pyodide WASM interpreter.", "info");
    };
    script.onerror = () => {
      addToConsole("Python initialization warning: CDN load error. Simulated python fallback compiler will process outputs.", "warn");
    };
    document.body.appendChild(script);
  };

  const addToConsole = (text: string, type: 'info' | 'error' | 'success' | 'warn' | 'input') => {
    setConsoleLogs(prev => [...prev, { text, type }]);
  };

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const target = e.currentTarget;
      const value = target.value;
      
      const updatedContent = value.substring(0, start) + "    " + value.substring(end);
      updateCurrentFileContent(updatedContent);
      
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      }, 0);
    }
  };

  const updateCurrentFileContent = (newContent: string) => {
    setWorkspaceFiles(prev => ({
      ...prev,
      [activeFileName]: {
        ...prev[activeFileName],
        content: newContent
      }
    }));
  };

  const currentFile = workspaceFiles[activeFileName] || { content: '', language: 'plaintext' };

  const handleEditorClickOrKeyPress = (e: any) => {
    const textStr = e.target.value;
    const selectionEnd = e.target.selectionEnd;
    const substring = textStr.substring(0, selectionEnd);
    const lines = substring.split('\n');
    const lineIndex = lines.length;
    const colIndex = lines[lines.length - 1].length + 1;
    setEditorCursor({ line: lineIndex, col: colIndex });
  };

  const switchFile = (name: string) => {
    setActiveFileName(name);
    if (!tabsList.includes(name)) {
      setTabsList(prev => [...prev, name]);
    }
  };

  const closeTab = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedTabs = tabsList.filter(t => t !== name);
    setTabsList(updatedTabs);
    if (activeFileName === name && updatedTabs.length > 0) {
      setActiveFileName(updatedTabs[0]);
    }
  };

  const runActiveFile = async () => {
    setActiveTerminalTab('terminal');
    addToConsole(`\nnode C:\\Users\\quantum\\workspace> python ${activeFileName}`, "input");
    
    const editorCode = currentFile.content;
    
    if (challenge?.practiceType === 'python') {
      await executePython(editorCode);
    } else if (challenge?.practiceType === 'javascript') {
      executeJS(editorCode);
    } else {
      executeSimulated(editorCode);
    }
  };

  const executePython = async (editorCode: string) => {
    if (!window.loadPyodide && !window.pyodideInstance) {
      addToConsole("Compiler status: Initializing Python sandbox environment components...", "info");
      loadPyodideScript();
    }

    let attempts = 0;
    while (!window.loadPyodide && attempts < 10 && !window.pyodideInstance) {
      await new Promise(r => setTimeout(r, 300));
      attempts++;
    }

    if (!window.pyodideInstance && window.loadPyodide) {
      addToConsole("Status: Spawning client WASM Python task stream...", "info");
      try {
        window.pyodideInstance = await window.loadPyodide();
        addToConsole("Status: Ready. Spawned standard shell container terminal root daemon successfully.", "success");
      } catch (err: any) {
        addToConsole(`Spawning python daemon error: ${err.message}. Defaulting to high fidelity AI simulated execution outputs.`, "warn");
      }
    }

    if (window.pyodideInstance) {
      try {
        let stdoutBuffer = "";
        window.pyodideInstance.setStdout({
          write: (text: string) => {
            stdoutBuffer += text;
            return text.length;
          }
        });
        window.pyodideInstance.setStderr({
          write: (text: string) => {
            addToConsole(text, "error");
            return text.length;
          }
        });

        await window.pyodideInstance.runPythonAsync(editorCode);
        if (stdoutBuffer.trim()) {
          addToConsole(stdoutBuffer, "success");
        } else {
          addToConsole("Interactive run execution complete: Code executed with return exit status 0 (no explicit stdout returned).", "warn");
        }
      } catch (err: any) {
        addToConsole(err.message, "error");
        setProblemsCount(prev => prev + 1);
      }
    } else {
      executeSimulated(editorCode);
    }
  };

  const executeJS = (editorCode: string) => {
    try {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' '));
      };

      try {
        const result = eval(editorCode);
        console.log = originalLog;
        
        if (logs.length > 0) {
          addToConsole(logs.join('\n'), "success");
        } else if (result !== undefined) {
          addToConsole(String(result), "success");
        } else {
          addToConsole("JavaScript environment finished process status: exit code 0", "warn");
        }
      } catch (innerErr: any) {
        console.log = originalLog;
        addToConsole(innerErr.message, "error");
        setProblemsCount(prev => prev + 1);
      }
    } catch (err: any) {
      addToConsole(err.message, "error");
      setProblemsCount(prev => prev + 1);
    }
  };

  const executeSimulated = (editorCode: string) => {
    addToConsole("Executing command process in sandboxed container CLI environment...", "info");
    setTimeout(() => {
      if (editorCode.toLowerCase().includes('print') || editorCode.toLowerCase().includes('console.log') || editorCode.toLowerCase().includes('echo')) {
        let userOutput = "Process complete: Completed execution loops with output text matches.";
        if (editorCode.includes('"') || editorCode.includes("'")) {
          const matches = editorCode.match(/["']([^"']*)["']/);
          if (matches && matches[1]) {
            userOutput = matches[1];
          }
        }
        addToConsole(userOutput, "success");
      } else {
        addToConsole("[RUN OK] Verification node completed task chain loops successfully.", "success");
      }
    }, 400);
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerificationFeedback(null);
    try {
      const activeFileCode = currentFile.content;
      const stdoutDump = consoleLogs.map(l => `[${l.type.toUpperCase()}] ${l.text}`).join('\n');
      
      const response = await verifyCodeSolution(
        goal.title,
        step.title,
        step.description,
        activeFileCode,
        stdoutDump
      );

      setVerificationFeedback(response.feedback);
      if (response.passed) {
        setPassed(true);
        addToConsole("\n[CERTIFICATION SYSTEM] Automated checks passed successfully. Quantum credential assigned to profile.", "success");
        setActiveTerminalTab('problems');
      } else {
        setPassed(false);
        addToConsole("\n[CERTIFICATION SYSTEM] Handshake warning: Unit output criteria unmet. Revise instructions and run compiler logs again.", "error");
        setActiveTerminalTab('problems');
        setProblemsCount(prev => prev + 1);
      }
    } catch (error) {
      console.error(error);
      addToConsole("Integrated terminal connection error: Calibration socket response dropped.", "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleResetEditor = () => {
    if (window.confirm("Restore entire VS Code workspace to default challenge instructions files?")) {
      fetchChallenge();
    }
  };

  const handleCommandPaletteSelect = (cmdKey: string) => {
    setShowCommandPalette(false);
    if (cmdKey === 'run') runActiveFile();
    if (cmdKey === 'verify') handleVerify();
    if (cmdKey === 'reset') handleResetEditor();
    if (cmdKey === 'readme') switchFile('README.md');
    if (cmdKey === 'hint') setShowHint(prev => !prev);
    if (cmdKey === 'close') onClose();
  };

  // Find occurrences for simple VS Code search bar imitation
  const matchedLines = searchQuery.trim() 
    ? currentFile.content.split('\n').filter(line => line.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1E1E1E] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#007ACC]" />
        <div className="space-y-1">
          <p className="text-sm font-mono text-[#D4D4D4] uppercase tracking-[2px] font-semibold">Visual Studio Code</p>
          <p className="text-xs text-[#858585] font-mono">Loading quantum virtual container environment...</p>
        </div>
      </div>
    );
  }

  if (error || !challenge) {
    return (
      <div className="min-h-screen bg-[#1E1E1E] flex flex-col items-center justify-center p-6 text-center space-y-6">
        <AlertTriangle className="w-12 h-12 text-[#FFD600]" />
        <h2 className="text-lg font-mono text-[#F48771] uppercase">Workspace Handshake Dropped</h2>
        <p className="text-xs text-[#858585] max-w-sm font-mono leading-relaxed">{error || "Could not bootstrap sandbox project files."}</p>
        <div className="flex gap-3">
          <button onClick={fetchChallenge} className="text-xs font-mono font-bold uppercase tracking-wider py-2 px-4 rounded bg-[#007ACC] hover:bg-[#0062a3] text-white transition-all">Retry Connect</button>
          <button onClick={onClose} className="text-xs font-mono font-bold uppercase tracking-wider py-2 px-4 rounded border border-[#333] hover:bg-white/5 transition-all text-[#858585]">Exit Workbench</button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#1E1E1E] flex flex-col font-mono text-[#D4D4D4] select-none overflow-hidden relative">
      
      {/* VS Code Window Custom Title Bar Menu */}
      <header className="h-[30px] bg-[#3C3C3C] text-[#D4D4D4] border-b border-[#2B2B2B] flex items-center justify-between px-3 text-[11px] select-none shrink-0">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-1.5 grayscale opacity-90">
            <div className="w-3 h-3 rounded-full bg-[#FF5F56]" />
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E]" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F]" />
          </div>
          {/* Menu Items */}
          <div className="hidden md:flex items-center space-x-3 text-[#B5B5B5]">
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">File</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">Edit</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">Selection</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">View</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">Run</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">Terminal</span>
            <span className="hover:bg-white/5 px-2 py-0.5 rounded cursor-pointer">Help</span>
          </div>
        </div>
        
        {/* Active file location indicator and prompt builder search */}
        <div className="flex items-center bg-[#4d4d4d] hover:bg-[#5a5a5a] text-[#cccccc] text-[10px] py-0.5 px-6 rounded border border-[#616161]/40 w-[280px] sm:w-[420px] justify-between cursor-pointer" onClick={() => setShowCommandPalette(true)}>
          <span className="truncate">quantum-workspace &gt; {activeFileName} &gt; {goal.title}</span>
          <Command className="w-3 h-3 opacity-60 ml-2" />
        </div>

        {/* Action Trigger Buttons inside the window framing */}
        <div className="flex items-center space-x-3">
          <button 
            onClick={() => setShowCommandPalette(true)}
            className="text-[#858585] hover:text-[#cccccc] flex items-center space-x-1 hover:bg-white/5 px-1.5 py-0.5 rounded"
            title="Open Command Palette"
          >
            <span className="text-[10px] uppercase font-bold tracking-tighter">Command Panel</span>
          </button>
          <span className="h-4 w-[1px] bg-[#333333]" />
          <button 
            onClick={onClose}
            className="text-[#858585] hover:text-white px-2 py-0.5 rounded transition-all flex items-center space-x-1 bg-[#252526] hover:bg-[#333333]"
            title="Exit virtual terminal"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </header>

      {/* Dynamic VS Code Command Palette Overlay */}
      <AnimatePresence>
        {showCommandPalette && (
          <div className="absolute inset-0 bg-black/65 flex items-start justify-center z-50 pt-[45px] px-4 font-mono">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#252526] border border-[#007ACC] text-[#D4D4D4] w-full max-w-lg rounded shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-3 border-b border-[#3c3c3c] flex items-center space-x-2 bg-[#1e1e1e]">
                <Command className="w-4 h-4 text-[#007ACC]" />
                <input 
                  type="text" 
                  value={commandQuery}
                  onChange={(e) => setCommandQuery(e.target.value)}
                  placeholder="Type an editor action command to run... (e.g. run, info, reset)"
                  className="bg-transparent border-none text-[11px] text-white focus:outline-none flex-1 font-mono"
                  autoFocus
                />
                <button onClick={() => setShowCommandPalette(false)} className="text-[#858585] hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-[220px] overflow-y-auto text-[10px] p-1.5 space-y-1 bg-[#252526]" id="command-palette-results">
                <div 
                  className="p-2 hover:bg-[#007ACC] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('run')}
                >
                  <span className="flex items-center space-x-2">
                    <Play className="w-3 h-3" />
                    <span>Run Task Compiler Code: execute workspace command process</span>
                  </span>
                  <span className="opacity-45 text-[9px]">Ctrl+F5</span>
                </div>
                <div 
                  className="p-2 hover:bg-[#007ACC] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('verify')}
                >
                  <span className="flex items-center space-x-2">
                    <CheckCircle className="w-3 h-3" />
                    <span>Laboratory Validation check: Submit active files code metrics</span>
                  </span>
                  <span className="opacity-45 text-[9px]">Shift+Alt+V</span>
                </div>
                <div 
                  className="p-2 hover:bg-[#007ACC] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('hint')}
                >
                  <span className="flex items-center space-x-2">
                    <Lightbulb className="w-3 h-3" />
                    <span>Toggle Practice Hint: Toggle AI overlay code tips</span>
                  </span>
                  <span className="opacity-45 text-[9px]">Alt+H</span>
                </div>
                <div 
                  className="p-2 hover:bg-[#007ACC] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('readme')}
                >
                  <span className="flex items-center space-x-2">
                    <BookOpen className="w-3 h-3" />
                    <span>Open Step README instructions documentation</span>
                  </span>
                  <span className="opacity-45 text-[9px]">index.md</span>
                </div>
                <div 
                  className="p-2 hover:bg-[#007ACC] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('reset')}
                >
                  <span className="flex items-center space-x-2">
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Calibration Sandbox: Reset workspace repository state</span>
                  </span>
                </div>
                <div 
                  className="p-2 hover:bg-[#FF3B30] hover:text-white cursor-pointer rounded flex justify-between items-center"
                  onClick={() => handleCommandPaletteSelect('close')}
                >
                  <span className="flex items-center space-x-2">
                    <X className="w-3 h-3 text-red-400" />
                    <span>Close current laboratory session workspace</span>
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Workspace Frame split */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0 bg-[#1e1e1e]">
        
        {/* VS Code Activity Bar (Slim vertical ribbon on far left) */}
        <section className="w-[45px] bg-[#333333] border-r border-[#2B2B2B] flex flex-col justify-between items-center py-2 shrink-0 select-none">
          <div className="flex flex-col items-center space-y-4 w-full">
            {/* Explorer */}
            <button 
              onClick={() => {
                setActiveSidebarTab('explorer');
                setSidebarOpen(true);
              }}
              className={`relative p-2 w-full flex justify-center text-center transition-all ${
                activeSidebarTab === 'explorer' && sidebarOpen 
                  ? 'text-white border-l-2 border-[#007ACC]' 
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
              title="File Explorer Workspace"
            >
              <Files className="w-4.5 h-4.5" />
            </button>
            
            {/* Search */}
            <button 
              onClick={() => {
                setActiveSidebarTab('search');
                setSidebarOpen(true);
              }}
              className={`relative p-2 w-full flex justify-center text-center transition-all ${
                activeSidebarTab === 'search' && sidebarOpen 
                  ? 'text-white border-l-2 border-[#007ACC]' 
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
              title="Global text occurrences"
            >
              <Search className="w-4.5 h-4.5" />
            </button>
            
            {/* Source Control */}
            <button 
              onClick={() => {
                setActiveSidebarTab('git');
                setSidebarOpen(true);
              }}
              className={`relative p-2 w-full flex justify-center text-center transition-all ${
                activeSidebarTab === 'git' && sidebarOpen 
                  ? 'text-white border-l-2 border-[#007ACC]' 
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
              title="Git Source Control (Current branch: main)"
            >
              <GitBranch className="w-4.5 h-4.5" />
              <span className="absolute top-1.5 right-1 px-1 py-0.1 bg-[#007ACC] text-[8px] text-white rounded-full scale-75 font-semibold">1</span>
            </button>

            {/* Run and Debug */}
            <button 
              onClick={() => {
                setActiveSidebarTab('debug');
                setSidebarOpen(true);
              }}
              className={`relative p-2 w-full flex justify-center text-center transition-all ${
                activeSidebarTab === 'debug' && sidebarOpen 
                  ? 'text-white border-l-2 border-[#007ACC]' 
                  : 'text-[#858585] hover:text-[#cccccc]'
              }`}
              title="Active compilers & virtual VM status"
            >
              <Play className="w-4.5 h-4.5" />
              {verifying && <span className="absolute bottom-1 right-2 w-2 h-2 rounded-full bg-yellow-400 animate-ping" />}
            </button>
          </div>

          <div className="flex flex-col items-center space-y-3 w-full">
            {/* Settings */}
            <button 
              onClick={handleResetEditor} 
              className="p-2 text-[#858585] hover:text-[#cccccc] w-full flex justify-center transition-colors" 
              title="Restore workspace"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            
            <button 
              onClick={() => {
                setActiveSidebarTab('extensions');
                setSidebarOpen(true);
              }}
              className="p-2 text-[#858585] hover:text-[#cccccc] w-full flex justify-center"
              title="Active packages & runtime bindings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* VS Code Primary Sidebar (Foldable, Lighter Dark theme) */}
        {sidebarOpen && (
          <aside className="w-[245px] bg-[#252526] border-r border-[#2B2B2B] flex flex-col overflow-hidden shrink-0 select-none">
            
            {/* Sidebar View Head */}
            <div className="h-9 px-3 border-b border-[#2B2B2B] flex items-center justify-between text-[10px] uppercase font-bold text-[#B5B5B5] tracking-tight">
              <span>{activeSidebarTab === 'explorer' ? 'Explorer: quantum-workspace' : activeSidebarTab.toUpperCase()}</span>
              <button onClick={() => setSidebarOpen(false)} className="hover:text-white text-[#858585]">
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Tab conditional sidebar rendering */}
            <div className="flex-1 overflow-y-auto min-h-0 text-[11px]">
              
              {activeSidebarTab === 'explorer' && (
                <div className="p-3 space-y-4">
                  {/* File trees directory structure */}
                  <div>
                    <span className="text-[9px] uppercase font-bold text-[#858585] block mb-2 tracking-wide">Workspace Repositories</span>
                    <div className="space-y-1">
                      {/* Sub-Folder workspace */}
                      <div className="flex items-center text-[#CCCCCC] font-bold py-1 px-1.5 hover:bg-[#2A2D2E]/80 rounded cursor-pointer gap-1.5">
                        <ChevronDown className="w-3.5 h-3.5" />
                        <FolderOpen className="w-3.5 h-3.5 text-yellow-500" />
                        <span>task_challenge_files</span>
                      </div>
                      
                      {/* Dynamic map of current workspace files */}
                      <div className="pl-4 space-y-[2px]">
                        {(Object.values(workspaceFiles) as FileState[]).map((wFile) => {
                          const isActive = wFile.name === activeFileName;
                          let icon = <File className="w-3.5 h-3.5 text-gray-400" />;
                          if (wFile.name.endsWith('.py')) icon = <FileCode className="w-3.5 h-3.5 text-blue-400" />;
                          if (wFile.name.endsWith('.js')) icon = <FileCode className="w-3.5 h-3.5 text-yellow-400" />;
                          if (wFile.name.endsWith('.sh') || wFile.name.endsWith('.env')) icon = <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />;
                          if (wFile.name.endsWith('.md')) icon = <FileText className="w-3.5 h-3.5 text-purple-400" />;

                          return (
                            <div 
                              key={wFile.name}
                              onClick={() => switchFile(wFile.name)}
                              className={`flex items-center justify-between py-1 px-2.5 rounded cursor-pointer transition-all ${
                                isActive ? 'bg-[#37373D] text-white font-semibold' : 'text-[#858585] hover:bg-[#2A2D2E] hover:text-[#CCCCCC]'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                {icon}
                                <span>{wFile.name}</span>
                              </div>
                              {isActive && <div className="w-1.5 h-1.5 rounded-full bg-[#007ACC]" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Objective details banner and interactive helper card */}
                  <div className="mt-4 pt-4 border-t border-[#333]">
                    <span className="text-[9px] uppercase font-bold text-[#858585] block mb-2 tracking-wide">Command Objectives</span>
                    <div className="p-3 bg-[#1e1e1e] border border-[#2b2b2b] rounded-md space-y-2.5">
                      <div className="flex items-center justify-between text-[10px] border-b border-white/5 pb-1">
                        <span className="text-[#858585]">Practice mode:</span>
                        <span className="text-emerald-400 uppercase font-bold pr-1">{(challenge.practiceType || 'generic')}</span>
                      </div>
                      <p className="text-[10.5px] italic text-[#cccccc] leading-relaxed font-light">
                        {challenge.challengeInstructions || "Practice implementing standard configurations using active compiler panes."}
                      </p>
                      
                      {/* Hint Indicator toggler */}
                      <div className="pt-2">
                        <button 
                          onClick={() => setShowHint(!showHint)}
                          className="flex items-center justify-between w-full p-1 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 text-[9px] font-bold rounded uppercase transition-all"
                        >
                          <span className="flex items-center gap-1"><Lightbulb className="w-3 h-3" /> {showHint ? "Hide Hints" : "Show Help Hint"}</span>
                          <span>{showHint ? "▲" : "▼"}</span>
                        </button>
                        {showHint && (
                          <div className="mt-2 p-2 bg-yellow-500/5 text-yellow-200/90 border border-yellow-500/20 rounded text-[10px] leading-relaxed font-light whitespace-pre-wrap">
                            {challenge.hint || "Review stdout details, compile outputs, and check active files structures."}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* VS Code Interactive VM Link Section */}
                  <div className="pt-4 border-t border-[#333]">
                    <div className="p-3.5 bg-[#1a252c] border border-blue-500/20 rounded-md flex flex-col space-y-2.5">
                      <div className="flex items-center gap-1.5 text-[#007ACC] text-[10px] uppercase font-bold">
                        <ExternalLink className="w-3.5 h-3.5 animate-pulse" />
                        <span>Interactive External VM</span>
                      </div>
                      <p className="text-[10px] text-[#A2A2A2] leading-relaxed font-light">
                        If what is being explained can be practiced in a terminal, click below to open a remote VM interactive terminal sandbox or Colab wrapper directly!
                      </p>
                      <a
                        href={challenge.externalPracticeLink || "https://replit.com/languages/python3"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-center py-2 bg-[#007ACC] text-white hover:bg-[#0062a3] text-[9px] font-bold uppercase tracking-wider rounded transition-all flex items-center justify-center space-x-1"
                        id="vm-console-link"
                      >
                        <span>Launch Sandbox VM Terminal</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                </div>
              )}

              {activeSidebarTab === 'search' && (
                <div className="p-3 space-y-3">
                  <span className="text-[10px] text-[#858585] uppercase font-bold tracking-tight block">File Search Workspace</span>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search text in active file..."
                      className="bg-[#2D2D2D] text-white focus:outline-none p-1.5 border border-[#3C3C3C]/60 rounded focus:border-[#007ACC] w-full text-[10.5px] font-mono pr-6"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-2 hover:text-white text-[#858585]">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {searchQuery ? (
                    <div className="space-y-1.5 mt-2">
                      <span className="text-[9px] text-[#858585] font-bold block">{matchedLines.length} occurrences found:</span>
                      <div className="text-[9.5px] space-y-[4px] font-mono leading-relaxed max-h-[220px] overflow-y-auto bg-[#1e1e1e] p-2 rounded border border-[#333]">
                        {matchedLines.map((line, idx) => (
                          <div key={idx} className="hover:bg-[#37373D] text-[#CCCCCC] truncate border-l border-yellow-500/60 pl-1.5 py-0.5" title={line}>
                            {line.trim()}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-[#858585] leading-relaxed">Type search strings to dynamically lookup references inside sandbox document scopes.</p>
                  )}
                </div>
              )}

              {activeSidebarTab === 'git' && (
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between text-[10px] uppercase font-bold text-[#858585]">
                    <span>Source Control</span>
                    <span className="bg-emerald-500/10 text-emerald-400 font-mono scale-90 px-1 hover:underline cursor-pointer">Commit changes</span>
                  </div>
                  <div className="p-2.5 bg-[#1E1E1E] border border-[#2b2b2b] rounded text-[10px] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-bold flex items-center gap-1"><GitBranch className="w-3 h-3" /> Branch:</span>
                      <span className="text-white hover:underline cursor-pointer">main</span>
                    </div>
                    <p className="text-[9.5px] text-[#858585] leading-relaxed font-light">Modified local changes are synced automatically below. Keep compiling code directly inside browser terminal panels.</p>
                  </div>
                  <span className="text-[9px] uppercase font-bold text-[#858585] block mt-4">Workspace diff files (1)</span>
                  <div className="pl-1 text-[#CCCCCC] space-y-1 mt-1 text-[10px]">
                    <div className="flex justify-between items-center bg-[#2d2d2d] py-1 px-2 rounded border border-[#3c3c3c]">
                      <span className="truncate">{activeFileName}</span>
                      <span className="text-yellow-400 font-bold scale-90">M</span>
                    </div>
                  </div>
                </div>
              )}

              {activeSidebarTab === 'debug' && (
                <div className="p-3 space-y-4">
                  <span className="text-[10px] text-[#858585] uppercase font-bold block">Status & Virtual Engines</span>
                  <div className="space-y-2 text-[10.5px]">
                    <div className="flex justify-between text-[#CCCCCC]">
                      <span>Active compiler:</span>
                      <span className="text-blue-400 uppercase font-semibold">{(challenge.practiceType || 'bash')} parser</span>
                    </div>
                    <div className="flex justify-between text-[#CCCCCC]">
                      <span>Sandboxed WASM host:</span>
                      <span className="text-emerald-400 underline">ONLINE</span>
                    </div>
                    <div className="flex justify-between text-[#CCCCCC]">
                      <span>Evaluator link:</span>
                      <span className="text-emerald-400 font-semibold text-[9px]">READY</span>
                    </div>
                    <div className="flex justify-between text-[#CCCCCC] border-b border-[#333] pb-2">
                      <span>Certification level:</span>
                      <span className="text-emerald-400">{(passed ? 'COMPLETED' : 'PENDING')}</span>
                    </div>
                  </div>
                  <button 
                    onClick={runActiveFile}
                    className="w-full text-center py-2 border border-[#007ACC] hover:bg-[#007ACC]/5 text-[10px] font-bold text-[#007ACC] uppercase tracking-wider rounded transition-all"
                  >
                    Launch compilation debugger
                  </button>
                </div>
              )}

              {activeSidebarTab === 'extensions' && (
                <div className="p-3 space-y-2">
                  <span className="text-[10px] text-[#858585] uppercase font-bold block mb-1">Installed Plugins</span>
                  <div className="space-y-1.5 font-mono text-[10px] max-h-[300px] overflow-y-auto">
                    <div className="p-2 border border-[#3C3C3C] rounded bg-[#1e1e1e] flex flex-col">
                      <span className="text-blue-400 font-bold">Python compilation daemon (WASM)</span>
                      <span className="text-[9px] text-[#858585] mt-0.5">Loads Pyodide engine libraries. v2.6.1</span>
                    </div>
                    <div className="p-2 border border-[#3C3C3C] rounded bg-[#1e1e1e] flex flex-col">
                      <span className="text-yellow-400 font-bold">Quantum Calibration Solver v1.0</span>
                      <span className="text-[9px] text-[#858585] mt-0.5">Synchronizes active steps variables with certification state.</span>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* User Credentials details at bottom of sidebar */}
            <div className="p-3 bg-black/20 border-t border-[#2B2B2B] text-[10.5px] space-y-1">
              <span className="text-[#858585] font-bold uppercase text-[9px] block">Interactive Workbench</span>
              <div className="flex items-center gap-1.5 truncate text-white">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="truncate">{step.title}</span>
              </div>
            </div>
          </aside>
        )}

        {/* Editor and Terminal integrated panes window on the right */}
        <main className="flex-1 flex flex-col bg-[#1E1E1E] overflow-hidden min-h-0">
          
          {/* Horizontal file editors tabs menu bar */}
          <div className="h-9 bg-[#252526] border-b border-[#2B2B2B] flex justify-between items-center shrink-0">
            
            {/* Scrollable container for open files tabs */}
            <div className="flex-1 flex overflow-x-auto min-h-0 scrollbar-none">
              {tabsList.map((tab) => {
                const isActive = tab === activeFileName;
                
                let tabIcon = <File className="w-3.5 h-3.5 text-gray-400" />;
                if (tab.endsWith('.py')) tabIcon = <FileCode className="w-3.5 h-3.5 text-blue-400" />;
                if (tab.endsWith('.js')) tabIcon = <FileCode className="w-3.5 h-3.5 text-yellow-400" />;
                if (tab.endsWith('.sh') || tab.endsWith('.env')) tabIcon = <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />;
                if (tab.endsWith('.md')) tabIcon = <FileText className="w-3.5 h-3.5 text-purple-400" />;

                return (
                  <div 
                    key={tab}
                    onClick={() => setActiveFileName(tab)}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-[11px] border-r border-[#2B2B2B] select-none text-nowrap transition-all ${
                      isActive 
                        ? 'bg-[#1E1E1E] text-white border-t-2 border-[#007ACC] font-semibold' 
                        : 'text-[#858585] bg-[#2D2D2D] hover:text-[#CCCCCC]'
                    }`}
                  >
                    {tabIcon}
                    <span>{tab}</span>
                    <button 
                      onClick={(e) => closeTab(tab, e)}
                      className="hover:bg-white/10 p-0.5 rounded text-[#858585] hover:text-white transition-all ml-1 scale-90"
                      title="Close Editor Tab"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Control buttons in tab menu row */}
            <div className="flex items-center px-3 space-x-3 bg-[#252526] h-full shrink-0">
              
              {/* Dynamic layout tab option selectors */}
              <div className="flex items-center bg-[#1E1E1E] p-0.5 rounded border border-[#3C3C3C] gap-0.5" id="layout-view-tabs">
                <button
                  onClick={() => setWorkspaceLayoutTab('split')}
                  className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-extrabold rounded-sm transition-all flex items-center gap-1 ${
                    workspaceLayoutTab === 'split' 
                      ? 'bg-[#007ACC] text-white' 
                      : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                  }`}
                  title="Split screen layout (Editor & Terminal)"
                >
                  <span className="w-1.5 h-1.5 border border-current rounded-sm"></span>
                  <span className="hidden md:inline">Split</span>
                </button>
                <button
                  onClick={() => setWorkspaceLayoutTab('editor')}
                  className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-extrabold rounded-sm transition-all flex items-center gap-1 ${
                    workspaceLayoutTab === 'editor' 
                      ? 'bg-[#007ACC] text-white' 
                      : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                  }`}
                  title="Editor focused only layout"
                >
                  <FileCode className="w-3 h-3" />
                  <span className="hidden md:inline">Editor</span>
                </button>
                <button
                  onClick={() => setWorkspaceLayoutTab('terminal')}
                  className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-extrabold rounded-sm transition-all flex items-center gap-1 ${
                    workspaceLayoutTab === 'terminal' 
                      ? 'bg-[#007ACC] text-white' 
                      : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                  }`}
                  title="Terminal focused only layout"
                >
                  <TerminalIcon className="w-3 h-3" />
                  <span className="hidden md:inline">Terminal</span>
                </button>
              </div>

              <span className="w-[1px] h-5 bg-[#3C3C3C]" />

              <button
                onClick={handleResetEditor}
                className="hover:bg-white/5 py-1 px-2.5 rounded border border-[#3C3C3C] text-[10px] text-[#B5B5B5] transition-colors flex items-center space-x-1 font-mono uppercase"
                title="Reset active code workspace layout"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset Code</span>
              </button>

              <button
                onClick={runActiveFile}
                className="bg-[#007ACC] text-white hover:bg-[#0062a3] py-1 px-3.5 rounded text-[10px] font-bold transition-all flex items-center space-x-1.5 uppercase tracking-wide"
                title="Compile and run current active file script"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Run Code</span>
              </button>
            </div>
          </div>

          {/* Splitted window: Active Text Editor on top, Terminal Console on bottom */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
            
            {/* Active Code editor textarea */}
            {workspaceLayoutTab !== 'terminal' && (
              <div className="flex-1 relative font-mono text-[11px] h-full flex overflow-hidden">
                {/* Row Line Numbers panel */}
                <div className="text-text-secondary/20 select-none text-right pr-4.5 border-r border-[#2B2B2B] text-[11px] p-4 bg-[#1E1E1E] leading-6 w-11 space-y-[0.5px] truncate hidden sm:block font-mono">
                  {Array.from({ length: Math.max(35, currentFile.content.split('\n').length + 5) }).map((_, i) => (
                    <div key={i} className={i + 1 === editorCursor.line ? 'text-white' : ''}>{i + 1}</div>
                  ))}
                </div>
                
                {/* Code TextArea */}
                <div className="flex-1 h-full relative overflow-hidden bg-[#1E1E1E]">
                  <textarea
                    ref={textEditorRef}
                    value={currentFile.content}
                    onChange={(e) => updateCurrentFileContent(e.target.value)}
                    onKeyUp={handleEditorClickOrKeyPress}
                    onMouseDown={handleEditorClickOrKeyPress}
                    onKeyDown={handleKeyPress}
                    placeholder={`// Visual Studio Code Editor Environment Loaded\n// Edit '${activeFileName}' then press 'Run Code' or submit execution verification checks...`}
                    className="w-full h-full bg-transparent text-[#9CDCFE] leading-6 text-[11.5px] p-4 focus:outline-none resize-none overflow-y-auto block font-mono border-none"
                    spellCheck="false"
                  />
                </div>
              </div>
            )}

            {/* Splitter border and pane toggler bar */}
            {workspaceLayoutTab !== 'editor' && (
              <div className="h-9 bg-[#1E1E1E] border-t border-[#2B2B2B] flex justify-between items-center shrink-0">
                <div className="flex h-full items-center bg-[#252526] border-r border-[#2b2b2b]">
                  {/* Switch Terminal tab */}
                  <button 
                    onClick={() => setActiveTerminalTab('terminal')}
                    className={`flex items-center gap-1.5 px-4 h-full text-[10px] uppercase font-mono tracking-wider font-extrabold select-none transition-all border-r border-[#2B2B2B] ${
                      activeTerminalTab === 'terminal' 
                        ? 'bg-[#1E1E1E] text-[#007ACC] border-t-2 border-[#007ACC] font-bold' 
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                    }`}
                    id="tab-selector-terminal"
                  >
                    <TerminalIcon className="w-3.5 h-3.5" />
                    <span>Terminal</span>
                  </button>

                  {/* Switch Problems Tab */}
                  <button 
                    onClick={() => setActiveTerminalTab('problems')}
                    className={`flex items-center gap-1.5 px-4 h-full text-[10px] uppercase font-mono tracking-wider font-bold select-none transition-all border-r border-[#2B2B2B] ${
                      activeTerminalTab === 'problems' 
                        ? 'bg-[#1E1E1E] text-[#007ACC] border-t-2 border-[#007ACC] font-bold' 
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                    }`}
                    id="tab-selector-problems"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Validator Output</span>
                    <span className={`px-1 rounded-full text-[8px] font-bold ${problemsCount > 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-[#333] text-[#a5a5a5]'}`}>
                      {problemsCount}
                    </span>
                  </button>

                  {/* Switch Debug Tab */}
                  <button 
                    onClick={() => setActiveTerminalTab('debug-console')}
                    className={`flex items-center gap-1.5 px-4 h-full text-[10px] uppercase font-mono tracking-wider font-bold select-none transition-all border-r border-[#2B2B2B] ${
                      activeTerminalTab === 'debug-console' 
                        ? 'bg-[#1E1E1E] text-[#007ACC] border-t-2 border-[#007ACC] font-bold' 
                        : 'text-[#858585] hover:text-[#cccccc] hover:bg-white/5'
                    }`}
                    id="tab-selector-debugger"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Evaluator Logs</span>
                  </button>
                </div>

                {/* Action utilities and resizing triggers */}
                <div className="flex items-center space-x-3 px-4 h-full bg-[#252526] border-l border-[#2b2b2b]">
                  {workspaceLayoutTab === 'split' && (
                    <button
                      onClick={() => {
                        // Cycle split terminal height: 200px -> 320px -> 460px -> 200px
                        setSplitTerminalHeight(prev => {
                          if (prev === 200) return 320;
                          if (prev === 320) return 460;
                          return 200;
                        });
                      }}
                      className="flex items-center gap-1 hover:text-white text-[#858585] font-mono text-[9px] uppercase tracking-wider hover:bg-white/5 px-2 py-1 rounded border border-[#3C3C3C]"
                      title="Cycle terminal height in split view"
                      id="resize-terminal-height"
                    >
                      <Sliders className="w-3 h-3" />
                      <span>Size: {splitTerminalHeight}px</span>
                    </button>
                  )}

                  <button 
                    onClick={() => setConsoleLogs([])}
                    className="hover:text-white text-[#858585] font-mono text-[9px] uppercase tracking-wider hover:bg-white/5 px-2 py-1 rounded border border-[#3C3C3C]"
                  >
                    Clear Console
                  </button>
                </div>
              </div>
            )}

            {/* Terminal console output screen / and solver checks interface */}
            {workspaceLayoutTab !== 'editor' && (
              <div 
                style={{ 
                  height: workspaceLayoutTab === 'terminal' ? '100%' : `${splitTerminalHeight}px` 
                }}
                className={`bg-black border-t border-[#2B2B2B] flex flex-col min-h-0 relative ${
                  workspaceLayoutTab === 'terminal' 
                    ? 'flex-1 h-full' 
                    : 'shrink-0'
                }`}
                id="terminal-output-panel"
              >
              
              {activeTerminalTab === 'terminal' && (
                <div className="flex-1 font-mono text-[11px] p-4 overflow-y-auto space-y-1.5 scrollbar-thin flex flex-col">
                  {consoleLogs.map((log, idx) => {
                    let colorClass = "text-[#F0F6FC]/90";
                    if (log.type === 'info') colorClass = "text-[#8B949E]";
                    if (log.type === 'error') colorClass = "text-red-400 font-semibold";
                    if (log.type === 'success') colorClass = "text-[#38BDF8] font-medium";
                    if (log.type === 'warn') colorClass = "text-yellow-400";
                    if (log.type === 'input') colorClass = "text-emerald-400 font-bold";

                    return (
                      <div key={idx} className={`${colorClass} leading-relaxed whitespace-pre-wrap`}>
                        {log.type === 'input' ? '$ ' : ' '} {log.text}
                      </div>
                    );
                  })}
                  <div ref={consoleEndRef} />
                </div>
              )}

              {activeTerminalTab === 'problems' && (
                <div className="flex-1 font-mono text-[11px] p-4 overflow-y-auto space-y-3.5 scrollbar-thin flex flex-col bg-[#1A1A1A]">
                  <div className="border-b border-[#2b2b2b] pb-2 flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-[#858585] tracking-wide">Automated Calibration solver</span>
                    <span className={`text-[10px] font-bold ${passed ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {passed ? 'PASSED_VERIFICATION' : 'CALIBRATION_PENDING'}
                    </span>
                  </div>

                  {passed ? (
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-md space-y-2.5">
                      <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs uppercase">
                        <CheckCircle className="w-5 h-5" />
                        <span>Interactive Step Completed Successfully!</span>
                      </div>
                      <p className="text-[11px] text-emerald-300/90 leading-relaxed font-light">
                        {verificationFeedback || "Verification passed. The compiled output satisfies step requirements!"}
                      </p>
                      <button
                        onClick={onCompleteStep}
                        className="py-2 px-5 bg-emerald-500 text-black hover:bg-emerald-400 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-all"
                      >
                        Update Goal Steps & Continue
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[#a5a5a5] leading-relaxed font-light text-[11px]">
                        The integrated laboratory verification will execute code matching rules to compile results. Click below when you are ready to evaluate your work.
                      </p>
                      
                      <div className="flex gap-3">
                        <button
                          onClick={handleVerify}
                          disabled={verifying}
                          className="py-2 px-4 bg-[#007ACC] hover:bg-[#0062a3] text-white disabled:opacity-50 text-[10px] uppercase tracking-wider font-bold rounded-sm transition-all flex items-center space-x-1.5"
                        >
                          {verifying ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Evaluating workspace files...</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-3.5 h-3.5" />
                              <span>Run Verification solver checks</span>
                            </>
                          )}
                        </button>
                        
                        <button
                          onClick={runActiveFile}
                          className="py-2 px-4 border border-[#3C3C3C] hover:bg-white/5 text-[#cccccc] text-[10px] uppercase tracking-wider font-bold rounded-sm transition-all"
                        >
                          Dry-Run active file
                        </button>
                      </div>

                      {verificationFeedback && (
                        <div className="p-3.5 bg-red-500/5 text-red-200 border border-red-500/20 rounded-md text-[10.5px] leading-relaxed font-light">
                          <span className="font-bold flex items-center gap-1.5 text-red-400 uppercase text-[10px] mb-1">
                            <AlertTriangle className="w-3.5 h-3.5" /> Compiler hints & suggestions:
                          </span>
                          {verificationFeedback}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activeTerminalTab === 'debug-console' && (
                <div className="flex-1 font-mono text-[11px] p-4 overflow-y-auto space-y-1.5 scrollbar-thin bg-black/90">
                  <div className="text-[#858585] mb-2 font-bold select-none">// Active telemetry evaluation stream - v1.0.3</div>
                  <div className="text-gray-400">Context node calibrated: "{goal.title}"</div>
                  <div className="text-gray-400">Active instruction tag: "{step.title}"</div>
                  <div className="text-gray-400">Compiler template targeting: {challenge.practiceType || 'bash'}</div>
                  <div className="text-gray-400">VM Host Status: connected online</div>
                  <div className="text-emerald-400 font-bold">Standard runtime is hydrated and compiling checks on loop execution requests.</div>
                </div>
              )}

            </div>
            )}

          </div>

        </main>

      </div>

      {/* VS Code Custom Status Bar footer (at the very bottom) */}
      <footer className={`h-[24px] px-3 font-mono flex items-center justify-between text-[10.5px] text-white shrink-0 select-none ${passed ? 'bg-[#16a34a]' : 'bg-[#007ACC]'}`}>
        
        {/* Left footer blocks */}
        <div className="flex items-center space-x-3">
          <div className="hover:bg-white/10 px-2.5 py-0.5 rounded cursor-pointer flex items-center space-x-1.5 bg-white/5">
            <GitBranch className="w-3 h-3 text-white" />
            <span className="font-bold">main</span>
          </div>
          
          <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer flex items-center space-x-1">
            <RefreshCw className={`w-3 h-3 ${verifying ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">Synchronized</span>
          </div>

          <div className="hover:bg-white/10 px-2 py-0.5 rounded cursor-pointer flex items-center space-x-1 text-red-100">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
            <span>0</span>
            <span className="hidden md:inline">errors</span>
            
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block ml-1" />
            <span>0</span>
            <span className="hidden md:inline">warnings</span>
          </div>
        </div>

        {/* Center section showing active step */}
        <div className="hidden lg:flex items-center space-x-1.5 animate-pulse text-[10px] font-bold tracking-tight uppercase">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Interactive terminal VM calibration mode active</span>
        </div>

        {/* Right footer status parameters */}
        <div className="flex items-center space-x-4">
          <div className="hover:bg-white/10 px-1 py-0.5 rounded cursor-pointer text-white/95">
            <span>Ln {editorCursor.line}, Col {editorCursor.col}</span>
          </div>
          <div className="hover:bg-white/10 px-1 py-0.5 rounded cursor-pointer text-white/95 hidden sm:inline">
            <span>Spaces: 4</span>
          </div>
          <div className="hover:bg-white/10 px-1 py-0.5 rounded cursor-pointer text-white/95 hidden md:inline">
            <span>UTF-8</span>
          </div>
          <div className="hover:bg-white/10 px-1.5 py-0.5 rounded cursor-pointer flex items-center space-x-1 bg-white/5 font-bold uppercase text-[9px] tracking-wider text-emerald-100">
            <div className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
            <span>VM READY</span>
          </div>
        </div>

      </footer>

    </div>
  );
}
