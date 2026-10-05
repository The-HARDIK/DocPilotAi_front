import { useState, useEffect, useRef } from 'react';
import {
  Upload, Send, FileText, BookOpen, Layers,
  CheckCircle2, Loader2, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Eye, EyeOff, ZoomIn, ZoomOut,
  Moon, Sun, Trash2, Files, MessageSquare, Plus, LogIn, LogOut, Clock, Sparkles,
  Home, AlertCircle, X, BarChart3, Database, Search, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { GoogleLogin, googleLogout } from '@react-oauth/google';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
const MAX_DOCS = 5;

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function preprocessMarkdown(text) {
  if (!text || typeof text !== "string") return "";

  // 1. Convert tab-separated lines into standard markdown pipe tables
  const lines = text.split("\n");
  const processed = [];
  let tabBlock = [];

  const flushTabBlock = () => {
    if (tabBlock.length === 0) return;
    if (tabBlock.length === 1) {
      processed.push(tabBlock[0]);
    } else {
      const headerCols = tabBlock[0].split("\t").map(c => c.trim()).filter(Boolean);
      if (headerCols.length > 1) {
        processed.push("| " + headerCols.join(" | ") + " |");
        processed.push("| " + headerCols.map(() => "---").join(" | ") + " |");
        for (let i = 1; i < tabBlock.length; i++) {
          const rowCols = tabBlock[i].split("\t").map(c => c.trim());
          while (rowCols.length < headerCols.length) rowCols.push("");
          processed.push("| " + rowCols.slice(0, headerCols.length).join(" | ") + " |");
        }
      } else {
        processed.push(...tabBlock);
      }
    }
    tabBlock = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("\t") && line.split("\t").length > 1) {
      tabBlock.push(line);
    } else {
      flushTabBlock();
      processed.push(line);
    }
  }
  flushTabBlock();

  let result = processed.join("\n");

  // 2. Wrap ASCII diagrams / Gantt charts (+---+ or |...|) into code blocks if unfenced
  result = result.replace(
    /(?:^|\n)(\+[+-]+\+\n(?:\|[^\n]+\|\n)+\+[+-]+\+(?:\n[ \d]+)?)/g,
    (match, block) => `\n\`\`\`text\n${block.trim()}\n\`\`\`\n`
  );

  return result;
}

export default function App() {
  const [currentView, setCurrentView] = useState("landing"); // "landing" | "workspace"
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  const dismissToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const [documents, setDocuments] = useState([]);
  const [dbDocuments, setDbDocuments] = useState([]);
  const [defaultDocuments, setDefaultDocuments] = useState([]);
  const [libSubTab, setLibSubTab] = useState("workspace"); // "workspace" | "database" | "builtins"
  const [activeDocName, setActiveDocName] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");

  // Auth & Chat History States
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("docpilot-user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [sidebarMode, setSidebarMode] = useState("docs"); // "docs" | "history"

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);

  const [studyGuide, setStudyGuide] = useState("");
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);
  const [expandedSources, setExpandedSources] = useState({});

  // Step-by-Step Explain feature state
  const [stepExplainData, setStepExplainData] = useState({}); // { [msgIdx]: { steps: [], totalSteps: N } }
  const [stepExplainLoading, setStepExplainLoading] = useState({}); // { [msgIdx]: true/false }
  const [stepExplainVisible, setStepExplainVisible] = useState({}); // { [msgIdx]: numberOfStepsRevealed }

  // Control panel hide/show state — collapses to options icon rail on mobile/desktop
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024;
    }
    return true;
  });
  const [mobileTab, setMobileTab] = useState("chat"); // "chat" | "pdf" on mobile viewports

  // PDF Viewer state — Closed and empty by default until user uploads or selects a PDF!
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [hasBuiltinKnowledge, setHasBuiltinKnowledge] = useState(true);
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfScale, setPdfScale] = useState(1.0);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pageInputVal, setPageInputVal] = useState("1");

  const [theme, setTheme] = useState(() => {
    try {
      const savedTheme = localStorage.getItem("docpilot-theme");
      if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    } catch {
      // localStorage may be disabled or blocked
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Apply theme class to document — uses both "dark" class on <html>, body, and data-theme attribute
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
      if (document.body) document.body.classList.add("dark");
    } else {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
      if (document.body) document.body.classList.remove("dark");
    }
    try {
      localStorage.setItem("docpilot-theme", theme);
    } catch {}
  }, [theme]);

  // Listen to OS system theme changes if user hasn't explicitly set a preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = (e) => {
      try {
        if (!localStorage.getItem("docpilot-theme")) {
          setTheme(e.matches ? "dark" : "light");
        }
      } catch {}
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleSystemThemeChange);
      return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleSystemThemeChange);
      return () => mediaQuery.removeListener(handleSystemThemeChange);
    }
  }, []);

  // Fetch all documents across ChromaDB, Neon DB, and Builtin folder
  const fetchAllDocuments = async () => {
    try {
      const [statusRes, allDocsRes] = await Promise.all([
        fetch(`${API_BASE}/status`),
        fetch(`${API_BASE}/documents/all`).catch(() => null)
      ]);
      const statusData = await statusRes.json();
      if (statusData.has_builtin_knowledge !== undefined) {
        setHasBuiltinKnowledge(statusData.has_builtin_knowledge);
      }

      if (allDocsRes && allDocsRes.ok) {
        const allData = await allDocsRes.json();
        if (allData.db_documents) setDbDocuments(allData.db_documents);
        if (allData.default_documents) setDefaultDocuments(allData.default_documents);
      }

      // ONLY set active document if user has uploaded documents (keep viewer closed until user chooses to view or uploads)
      if (statusData.documents && statusData.documents.length > 0) {
        setDocuments(statusData.documents);
        if (!activeDocName) {
          const firstUserDoc = statusData.documents[0].filename;
          setActiveDocName(firstUserDoc);
          setPdfUrl(`${API_BASE}/document?filename=${encodeURIComponent(firstUserDoc)}&t=${Date.now()}`);
          // Closed by default until user uploads or clicks View PDF
        }
      } else {
        setDocuments([]);
        // Do NOT auto-load any PDF when no documents are uploaded by user!
        if (!activeDocName) {
          setActiveDocName(null);
          setPdfUrl(null);
          setShowPdfViewer(false);
        }
      }
    } catch {}
  };

  const closeMobileDrawerIfSmall = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  useEffect(() => {
    fetchAllDocuments();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isQuerying]);

  useEffect(() => {
    setPageInputVal(String(currentPage));
  }, [currentPage]);

  const switchActiveDoc = async (filename, targetPage = 1) => {
    setActiveDocName(filename);
    setPdfUrl(`${API_BASE}/document?filename=${encodeURIComponent(filename)}&t=${Date.now()}`);
    setCurrentPage(targetPage);
    setShowPdfViewer(true);
    setMobileTab("pdf");
    closeMobileDrawerIfSmall();
    try {
      await fetch(`${API_BASE}/document/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename })
      });
      // Refresh documents list to reflect any new active state
      fetchAllDocuments();
    } catch {}
  };

  const indexDocIntoWorkspace = async (filename) => {
    try {
      showToast(`Loading "${filename}" into active workspace...`, "info");
      const res = await fetch(`${API_BASE}/document/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`"${filename}" is now loaded in workspace!`, "success");
        await fetchAllDocuments();
        switchActiveDoc(filename);
      } else {
        showToast(data.detail || "Could not load document.", "error");
      }
    } catch {
      showToast("Connection error while loading document.", "error");
    }
  };

  // Fetch user chats when logged in
  const fetchUserChats = async (userId) => {
    if (!userId) return;
    try {
      const res = await fetch(`${API_BASE}/chats/${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (res.ok) {
        setChats(data);
      }
    } catch {}
  };

  useEffect(() => {
    if (user?.id) {
      fetchUserChats(user.id);
    }
  }, [user]);

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const res = await fetch(`${API_BASE}/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: credentialResponse.credential })
      });
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        try {
          localStorage.setItem("docpilot-user", JSON.stringify(data.user));
        } catch {}
        fetchUserChats(data.user.id);
        setActiveChatId(null);
        setMessages([]);
        setActiveTab("chat");
        setCurrentView("workspace");
      } else {
        showToast(data.detail || "Authentication failed. Please check your clock and try again.", "error");
      }
    } catch (err) {
      showToast("Google sign-in error: " + err.message, "error");
    }
  };

  const handleLogout = () => {
    googleLogout();
    setUser(null);
    setChats([]);
    setActiveChatId(null);
    try {
      localStorage.removeItem("docpilot-user");
    } catch {}
    showToast("Signed out successfully.", "info");
  };

  const handleNewChat = async () => {
    closeMobileDrawerIfSmall();
    setMobileTab("chat");
    if (!user) {
      setActiveChatId(null);
      setMessages([]);
      setActiveTab("chat");
      showToast("Started fresh guest study session.", "info");
      return;
    }
    try {
      const sessionNum = chats.length + 1;
      const currentDocNames = documents.map(d => d.filename);
      const res = await fetch(`${API_BASE}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          title: `Study Session ${sessionNum}`,
          documents: currentDocNames
        })
      });
      const data = await res.json();
      if (res.ok) {
        const newChat = { 
          id: data.id, 
          title: data.title, 
          documents: data.documents || currentDocNames,
          created_at: new Date().toISOString() 
        };
        setChats(prev => [newChat, ...prev]);
        setActiveChatId(data.id);
        setMessages([]);
        setActiveTab("chat");
        showToast(`Created "${data.title}".`, "success");
      }
    } catch {
      showToast("Failed to start new chat session.", "error");
    }
  };

  const handleSelectChat = async (chatId) => {
    setActiveChatId(chatId);
    setActiveTab("chat");
    setMobileTab("chat");
    closeMobileDrawerIfSmall();
    try {
      const res = await fetch(`${API_BASE}/chats/messages/${chatId}`);
      const data = await res.json();
      if (res.ok) {
        setMessages(data.messages || []);
        
        // Restore session documents in backend vector store so this chat uses the right PDF context!
        try {
          const restoreRes = await fetch(`${API_BASE}/chats/${chatId}/restore`, { method: "POST" });
          const restoreData = await restoreRes.json();
          if (restoreData.documents) {
            setDocuments(restoreData.documents);
            if (restoreData.active_document) {
              setActiveDocName(restoreData.active_document);
              setPdfUrl(`${API_BASE}/document?filename=${encodeURIComponent(restoreData.active_document)}&t=${Date.now()}`);
            }
            if (restoreData.restored && restoreData.restored_documents?.length > 0) {
              showToast(`Restored ${restoreData.restored_documents.length} document(s) for "${data.title}".`, "info");
            }
          }
        } catch (restoreErr) {
          console.error("Document restoration error:", restoreErr);
        }
      }
    } catch {
      showToast("Failed to load session messages.", "error");
    }
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    if (!confirm("Delete this saved study session?")) return;
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`, { method: "DELETE" });
      if (res.ok) {
        setChats(prev => prev.filter(c => c.id !== chatId));
        if (activeChatId === chatId) {
          setActiveChatId(null);
          setMessages([]);
        }
        showToast("Deleted study session.", "info");
      }
    } catch {
      showToast("Failed to delete chat.", "error");
    }
  };

  const handleFileUpload = async (e) => {
    const rawFiles = Array.from(e.target.files || []);
    if (rawFiles.length === 0) return;

    const remainingSlots = MAX_DOCS - documents.length;
    if (remainingSlots <= 0) {
      alert(`Maximum ${MAX_DOCS} documents already loaded. Please delete a document to add another.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const filesToUpload = rawFiles.slice(0, remainingSlots);
    if (rawFiles.length > remainingSlots) {
      alert(`Only ${remainingSlots} more document(s) could be added (max ${MAX_DOCS}). Uploading the first ${remainingSlots}.`);
    }

    setIsUploading(true);
    const formData = new FormData();
    for (const f of filesToUpload) {
      formData.append("files", f);
    }
    if (user?.id) {
      formData.append("user_id", user.id);
    }

    try {
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setDocuments(data.documents || []);
        if (data.active_document) {
          setActiveDocName(data.active_document);
          setPdfUrl(`${API_BASE}/document?filename=${encodeURIComponent(data.active_document)}&t=${Date.now()}`);
          setCurrentPage(1);
        }
        await fetchAllDocuments();
        showToast("Documents uploaded and indexed successfully.", "success");
      } else {
        alert(data.detail || "Upload failed");
      }
    } catch {
      alert("Failed to connect to backend server.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteDoc = async (e, filename) => {
    e.stopPropagation();
    if (!confirm(`Remove "${filename}" from workspace?`)) return;

    try {
      const res = await fetch(`${API_BASE}/document/${encodeURIComponent(filename)}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (res.ok) {
        setDocuments(data.documents || []);
        if (data.active_document) {
          setActiveDocName(data.active_document);
          setPdfUrl(`${API_BASE}/document?filename=${encodeURIComponent(data.active_document)}&t=${Date.now()}`);
          setCurrentPage(1);
        } else {
          setActiveDocName(null);
          setPdfUrl(null);
        }
        await fetchAllDocuments();
        showToast(`Removed "${filename}".`, "info");
      } else {
        alert(data.detail || "Failed to delete document.");
      }
    } catch {
      alert("Error removing document.");
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Clear all documents from the assistant?")) return;
    try {
      const res = await fetch(`${API_BASE}/documents/clear`, { method: "DELETE" });
      if (res.ok) {
        setDocuments([]);
        setActiveDocName(null);
        setPdfUrl(null);
        setMessages([]);
        setStudyGuide("");
        await fetchAllDocuments();
        showToast("Workspace cleared.", "info");
      }
    } catch {
      alert("Error clearing documents.");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || isQuerying) return;

    let currentSessionId = activeChatId;
    const promptSnippet = input.trim().slice(0, 30) + (input.trim().length > 30 ? "..." : "");

    // Auto-create a brand new chat session whenever user prompts from zero
    if (!currentSessionId) {
      if (user) {
        try {
          const currentDocNames = documents.map(d => d.filename);
          const res = await fetch(`${API_BASE}/chats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: user.id,
              title: promptSnippet,
              documents: currentDocNames
            })
          });
          const data = await res.json();
          if (res.ok) {
            currentSessionId = data.id;
            setActiveChatId(data.id);
            setChats(prev => [{
              id: data.id,
              title: data.title || promptSnippet,
              documents: data.documents || currentDocNames,
              created_at: new Date().toISOString()
            }, ...prev]);
          }
        } catch (err) {
          console.error("Auto chat creation error:", err);
        }
      } else {
        // Guest mode session
        const guestId = "guest-" + Date.now();
        currentSessionId = guestId;
        setActiveChatId(guestId);
        setChats(prev => [{
          id: guestId,
          title: promptSnippet,
          created_at: new Date().toISOString()
        }, ...prev]);
      }
    }

    const userMessage = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsQuerying(true);

    try {
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMessage.content,
          chat_history: messages.map(m => ({ role: m.role, content: m.content })),
          conversation_id: currentSessionId
        })
      });
      const data = await res.json();
      setMessages([...newMessages, {
        role: "assistant",
        content: data.answer,
        sources: data.sources || []
      }]);
    } catch {
      setMessages([...newMessages, {
        role: "assistant",
        content: "Error communicating with the assistant.",
        sources: []
      }]);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleGenerateGuide = async () => {
    closeMobileDrawerIfSmall();
    if (isGeneratingGuide) return;
    setIsGeneratingGuide(true);
    setActiveTab("guide");

    try {
      const res = await fetch(`${API_BASE}/study-guide`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setStudyGuide(data.study_guide);
      } else {
        alert(data.detail || "Failed to generate study guide.");
      }
    } catch {
      alert("Error generating study guide.");
    } finally {
      setIsGeneratingGuide(false);
    }
  };

  const jumpToCitation = (docName, pageNum) => {
    const targetDoc = docName || activeDocName;
    if (targetDoc && targetDoc !== activeDocName) {
      switchActiveDoc(targetDoc, pageNum);
    } else {
      setCurrentPage(pageNum);
      if (!showPdfViewer) setShowPdfViewer(true);
      setMobileTab("pdf");
    }
  };

  const toggleSource = (idx) => {
    setExpandedSources(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  // ---- Step-by-Step Explain Handlers ----
  const handleStepExplain = async (msgIdx) => {
    const msg = messages[msgIdx];
    if (!msg || msg.role !== "assistant") return;

    // Find the user question that preceded this answer
    let questionText = "";
    for (let j = msgIdx - 1; j >= 0; j--) {
      if (messages[j].role === "user") {
        questionText = messages[j].content;
        break;
      }
    }
    if (!questionText) questionText = "Explain this answer step by step.";

    setStepExplainLoading(prev => ({ ...prev, [msgIdx]: true }));

    try {
      const res = await fetch(`${API_BASE}/step-explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: questionText, answer: msg.content })
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      setStepExplainData(prev => ({ ...prev, [msgIdx]: data }));
      setStepExplainVisible(prev => ({ ...prev, [msgIdx]: 1 })); // reveal first step
    } catch (err) {
      showToast(`Step-by-step explain failed: ${err.message}`, "error");
    } finally {
      setStepExplainLoading(prev => ({ ...prev, [msgIdx]: false }));
    }
  };

  const revealNextStep = (msgIdx) => {
    setStepExplainVisible(prev => {
      const current = prev[msgIdx] || 0;
      const total = stepExplainData[msgIdx]?.steps?.length || 0;
      return { ...prev, [msgIdx]: Math.min(current + 1, total) };
    });
  };

  const revealAllSteps = (msgIdx) => {
    const total = stepExplainData[msgIdx]?.steps?.length || 0;
    setStepExplainVisible(prev => ({ ...prev, [msgIdx]: total }));
  };

  const toggleTheme = () => {
    // Add temporary transition class for smooth theme interpolation across all elements
    document.documentElement.classList.add("theme-transitioning");
    setTheme(current => (current === "dark" ? "light" : "dark"));
    setTimeout(() => {
      document.documentElement.classList.remove("theme-transitioning");
    }, 380);
  };

  const totalChunks = documents.reduce((acc, d) => acc + (d.chunks || 0), 0);

  return (
    <>
      {currentView === "landing" ? (
        <div className="landing-root flex flex-col justify-between">
          {/* Landing Top Navigation */}
          <header className="landing-nav px-6 py-3.5 flex items-center justify-between max-w-7xl mx-auto w-full">
            <div className="flex items-center gap-3">
              <div className="landing-brand-mark">
                <Layers size={20} />
              </div>
              <div>
                <div className="text-base font-bold text-ink leading-tight flex items-center gap-2">
                  DocPilot AI
                  <span className="text-[0.65rem] px-2 py-0.5 rounded-full bg-surface-2 border border-border text-accent font-semibold">
                    v2.0 Academic Desk
                  </span>
                </div>
                <div className="text-xs text-muted leading-tight">Multi-Document Research Workspace</div>
              </div>
            </div>
            {/* Theme toggle on landing page */}
            <button
              onClick={toggleTheme}
              className="theme-toggle-pill"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label="Toggle Theme"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </header>

          {/* Hero Section */}
          <main className="max-w-7xl mx-auto px-6 pt-10 pb-16 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              {/* Left Column: Hero Copy & Capabilities */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                <div className="landing-hero-badge">
                  <span className="pulse-dot" />
                  <span>Multi-Document Intelligent Research Desk</span>
                </div>

                <h1 className="landing-headline">
                  Turn Stacks of Research PDFs into{' '}
                  <span className="landing-headline-gradient">Connected Knowledge</span>
                </h1>

                <p className="text-base sm:text-lg text-muted leading-relaxed max-w-2xl">
                  Simultaneously ingest up to 5 academic documents. Ask complex cross-paper questions, 
                  receive grounded answers with clickable in-line page citations, and jump straight to the source in an interactive split-screen viewer.
                </p>

                {/* Key Feature Highlights */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2">
                  <div className="hero-feature-card">
                    <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center text-accent mb-2">
                      <Files size={17} />
                    </div>
                    <h2 className="text-xs font-bold text-ink mb-1">5 Concurrent PDFs</h2>
                    <p className="text-[0.75rem] text-muted leading-snug">
                      Cross-index up to five papers simultaneously without context bleed.
                    </p>
                  </div>

                  <div className="hero-feature-card">
                    <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center text-accent mb-2">
                      <BookOpen size={17} />
                    </div>
                    <h2 className="text-xs font-bold text-ink mb-1">Exact Page Citations</h2>
                    <p className="text-[0.75rem] text-muted leading-snug">
                      Click any citation badge to immediately switch documents and jump to the page.
                    </p>
                  </div>

                  <div className="hero-feature-card">
                    <div className="w-8 h-8 rounded-lg bg-accent-soft flex items-center justify-center text-accent mb-2">
                      <Sparkles size={17} />
                    </div>
                    <h2 className="text-xs font-bold text-ink mb-1">Automated Synthesis</h2>
                    <p className="text-[0.75rem] text-muted leading-snug">
                      Generate structured study guides and cross-document concept maps in seconds.
                    </p>
                  </div>
                </div>

                {/* Live Trust Metrics */}
                <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-faint pt-1">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-success" />
                    <span>ChromaDB Vector Store</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-success" />
                    <span>Groq LLaMA 3.3 70B</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-success" />
                    <span>SQLite Session Memory</span>
                  </span>
                </div>
              </div>

              {/* Right Column: Elevated Glassmorphic Login Card */}
              <div className="lg:col-span-5 flex justify-center">
                <div className="landing-login-card">
                  {user ? (
                    /* Authenticated Card View */
                    <div className="flex flex-col items-center text-center gap-4">
                      <div className="relative">
                        {user.avatar ? (
                          <img 
                            src={user.avatar} 
                            alt={user.name} 
                            className="w-16 h-16 rounded-full object-cover border-2 border-accent shadow-md" 
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xl shadow-md">
                            {user.name?.[0] || 'U'}
                          </div>
                        )}
                        <div className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-success border-2 border-surface flex items-center justify-center">
                          <CheckCircle2 size={12} className="text-white" />
                        </div>
                      </div>

                      <div>
                        <div className="text-[0.7rem] font-bold uppercase tracking-wider text-accent mb-0.5">
                          Google Account Connected
                        </div>
                        <div className="text-lg font-bold text-ink leading-tight">{user.name}</div>
                        <div className="text-xs text-muted mt-0.5">{user.email}</div>
                      </div>

                      <div className="w-full py-2 px-3 rounded-lg bg-surface-2 border border-border flex items-center justify-between text-xs">
                        <span className="text-muted flex items-center gap-1.5">
                          <Clock size={13} className="text-accent" />
                          <span>Saved Study Sessions</span>
                        </span>
                        <span className="font-bold text-ink px-2 py-0.5 rounded bg-surface border border-border">
                          {chats.length} Available
                        </span>
                      </div>

                      <button
                        onClick={() => {
                          setCurrentView("workspace");
                          // Always start from zero clean on entering workspace!
                          setActiveChatId(null);
                          setMessages([]);
                          setActiveTab("chat");
                        }}
                        className="launch-workspace-btn"
                      >
                        <span>Enter Workspace</span>
                        <ChevronRight size={16} />
                      </button>

                      <button
                        onClick={handleLogout}
                        className="text-xs text-muted hover:text-danger transition-colors cursor-pointer flex items-center gap-1.5 mt-1"
                      >
                        <LogOut size={13} />
                        <span>Sign out / Switch account</span>
                      </button>
                    </div>
                  ) : (
                    /* Unauthenticated Login Card */
                    <div className="flex flex-col gap-4">
                      <div className="text-center">
                        <div className="w-11 h-11 rounded-xl bg-accent-soft text-accent flex items-center justify-center mx-auto mb-2.5">
                          <Layers size={22} />
                        </div>
                        <h2 className="text-lg font-bold text-ink">Sign In to DocPilot</h2>
                        <p className="text-xs text-muted mt-1 leading-relaxed">
                          Sign in with Google to sync your study history, save research notes across sessions, and restore document context instantly.
                        </p>
                      </div>

                      <div className="flex justify-center py-2">
                        <GoogleLogin
                          onSuccess={handleGoogleSuccess}
                          onError={() => showToast("Google Sign-In failed or was cancelled. Please retry.", "error")}
                          theme={theme === 'dark' ? 'filled_black' : 'outline'}
                          size="large"
                          shape="rectangular"
                          text="signin_with"
                          width="280"
                        />
                      </div>

                      <div className="relative flex items-center justify-center">
                        <div className="border-t border-border w-full"></div>
                        <span className="bg-surface px-3 text-[0.7rem] text-faint uppercase tracking-wider font-semibold absolute">
                          or
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView("workspace");
                          // Always start from zero clean on entering workspace!
                          setActiveChatId(null);
                          setMessages([]);
                          setActiveTab("chat");
                          showToast("Browsing workspace in guest mode.", "info");
                        }}
                        className="guest-btn"
                      >
                        <span>Continue as Guest</span>
                        <ChevronRight size={14} />
                      </button>

                      <p className="text-[0.66rem] text-center text-faint leading-relaxed mt-1">
                        By signing in, your chat transcripts and document indices are safely persisted for your account.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Feature Pillars Section */}
            <div className="mt-20 pt-10 border-t border-border">
              <div className="text-center max-w-xl mx-auto mb-8">
                <div className="text-xs font-bold uppercase tracking-wider text-accent mb-1">Engine Architecture</div>
                <h2 className="text-2xl font-bold text-ink">Engineered for Literature Reviews</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="p-5 rounded-xl border border-border bg-surface-2/60 backdrop-blur-sm">
                  <div className="text-xs font-bold text-accent mb-1.5">01 / MULTI-INDEXING</div>
                  <h3 className="text-sm font-bold text-ink mb-1.5">Concurrent Vector Corpora</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    Upload up to 5 research papers simultaneously. Every text chunk is tagged with its parent document and page coordinates in ChromaDB.
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-border bg-surface-2/60 backdrop-blur-sm">
                  <div className="text-xs font-bold text-accent mb-1.5">02 / INTERACTIVE SPLIT SCREEN</div>
                  <h3 className="text-sm font-bold text-ink mb-1.5">Live Verification Reader</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    Click any citation chip to instantly load that document in the integrated side-by-side PDF viewer and navigate right to the cited paragraph.
                  </p>
                </div>

                <div className="p-5 rounded-xl border border-border bg-surface-2/60 backdrop-blur-sm">
                  <div className="text-xs font-bold text-accent mb-1.5">03 / SESSION ALIGNMENT</div>
                  <h3 className="text-sm font-bold text-ink mb-1.5">Database Chat History</h3>
                  <p className="text-xs text-muted leading-relaxed">
                    Every chat session retains its respective messages and active document context in SQLite, restoring exact vector memory when revisiting past research threads.
                  </p>
                </div>
              </div>
            </div>
          </main>

          {/* Minimal Footer */}
          <footer className="border-t border-border py-5 px-6 text-center text-xs text-faint">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-accent" />
                <span className="font-semibold text-ink">DocPilot AI</span>
                <span>• Academic Research Desk</span>
              </div>
              <div>
                Powered by FastAPI, ChromaDB, Groq LLaMA 3.3, and SQLite.
              </div>
            </div>
          </footer>
        </div>
      ) : (
        <div className="app-shell flex h-screen w-screen overflow-hidden relative">
          {/* Backdrop for mobile drawer when sidebar is open on screens < 1024px */}
          {isSidebarOpen && (
            <div
              className="mobile-drawer-backdrop lg:hidden"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close sidebar menu"
            />
          )}

          {/* ============================================================
              LEFT SLIM RAIL — Option icons panel (displayed when full sidebar is collapsed)
              ============================================================ */}
          {!isSidebarOpen && (
            <aside className="scholar-sidebar-rail shrink-0 h-full flex flex-col justify-between items-center py-2.5 px-1 z-30 select-none">
              <div className="flex flex-col items-center gap-1.5 w-full">
                {/* Website Logo at the very top */}
                <button
                  onClick={() => setCurrentView("landing")}
                  className="rail-icon-btn brand"
                  aria-label="DocPilot AI"
                >
                  <Layers size={17} />
                  <span className="rail-tooltip">DocPilot AI</span>
                </button>

                {/* Expand Control Panel button */}
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="rail-icon-btn"
                  aria-label="Expand Control Panel"
                >
                  <PanelLeftOpen size={16} />
                  <span className="rail-tooltip">Expand Panel</span>
                </button>

                <button
                  onClick={() => setCurrentView("landing")}
                  className="rail-icon-btn"
                  aria-label="Return to Landing Page"
                >
                  <Home size={15} />
                  <span className="rail-tooltip">Landing Page</span>
                </button>

                <div className="w-5 h-[1px] bg-border my-0.5 opacity-60" />

                {/* Quick New Chat */}
                <button
                  onClick={() => { setActiveTab("chat"); handleNewChat(); }}
                  className="rail-icon-btn"
                  aria-label="New Study Session"
                >
                  <Plus size={16} />
                  <span className="rail-tooltip">New Chat</span>
                </button>

                {/* Tab: Study Q&A */}
                <button
                  onClick={() => { setActiveTab("chat"); setMobileTab("chat"); }}
                  className={`rail-icon-btn ${activeTab === 'chat' ? 'active' : ''}`}
                  aria-label="Study Q&A Chat"
                >
                  <MessageSquare size={15} />
                  <span className="rail-tooltip">Study Q&A</span>
                </button>

                {/* Tab: Study Guide */}
                <button
                  onClick={() => {
                    setActiveTab("guide");
                    if (!studyGuide) handleGenerateGuide();
                  }}
                  className={`rail-icon-btn ${activeTab === 'guide' ? 'active' : ''}`}
                  aria-label="Study Guide"
                >
                  <BookOpen size={15} />
                  <span className="rail-tooltip">Study Guide</span>
                </button>

                {/* Toggle PDF Viewer */}
                <button
                  onClick={() => {
                    if (!pdfUrl && !showPdfViewer) {
                      showToast("Upload a PDF document first to view it side-by-side.", "info");
                      setIsSidebarOpen(true);
                      setSidebarMode("docs");
                      setLibSubTab("workspace");
                    } else {
                      setShowPdfViewer(prev => {
                        const next = !prev;
                        if (next) setMobileTab("pdf");
                        return next;
                      });
                    }
                  }}
                  className={`rail-icon-btn ${showPdfViewer && pdfUrl ? 'active' : ''}`}
                  aria-label="Toggle PDF Viewer"
                >
                  {showPdfViewer && pdfUrl ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span className="rail-tooltip">{showPdfViewer && pdfUrl ? "Hide PDF" : "View PDF"}</span>
                </button>

                <div className="w-5 h-[1px] bg-border my-0.5 opacity-60" />

                {/* Workspace Library */}
                <button
                  onClick={() => {
                    setIsSidebarOpen(true);
                    setSidebarMode("docs");
                    setLibSubTab("workspace");
                  }}
                  className={`rail-icon-btn ${sidebarMode === 'docs' && libSubTab === 'workspace' ? 'active' : ''}`}
                  aria-label="Document Library"
                >
                  <Files size={15} />
                  <span className="rail-tooltip">Workspace Docs</span>
                </button>

                {/* Cloud Database */}
                <button
                  onClick={() => {
                    setIsSidebarOpen(true);
                    setSidebarMode("docs");
                    setLibSubTab("database");
                  }}
                  className={`rail-icon-btn ${sidebarMode === 'docs' && libSubTab === 'database' ? 'active' : ''}`}
                  aria-label="Cloud Database Archive"
                >
                  <Database size={15} />
                  <span className="rail-tooltip">Cloud DB Archive</span>
                </button>

                {/* Chat History */}
                <button
                  onClick={() => {
                    setIsSidebarOpen(true);
                    setSidebarMode("history");
                  }}
                  className={`rail-icon-btn ${sidebarMode === 'history' ? 'active' : ''}`}
                  aria-label="Chat History"
                >
                  <Clock size={15} />
                  <span className="rail-tooltip">Chat History</span>
                </button>

                {/* Quick Upload trigger */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rail-icon-btn"
                  aria-label="Upload PDF Document"
                >
                  <Upload size={15} />
                  <span className="rail-tooltip">Upload PDF</span>
                </button>
              </div>

              {/* Bottom Dock in Rail */}
              <div className="flex flex-col items-center gap-1.5 w-full pt-1">
                <div className="w-5 h-[1px] bg-border my-0.5 opacity-60" />

                {/* Theme Switcher */}
                <button
                  onClick={toggleTheme}
                  className="rail-icon-btn"
                  aria-label="Toggle Theme"
                >
                  {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                  <span className="rail-tooltip">{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                </button>

                {/* User avatar or sign-in */}
                {user ? (
                  <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="rail-user-avatar p-0.5"
                    aria-label={`Signed in as ${user.name}`}
                  >
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name} className="w-7 h-7 rounded-full border border-accent object-cover" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center font-bold text-xs">
                        {user.name?.[0] || 'U'}
                      </div>
                    )}
                    <span className="rail-tooltip">{user.name || "Account"}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentView("landing")}
                    className="rail-icon-btn"
                    aria-label="Sign In with Google"
                  >
                    <LogIn size={15} className="text-accent" />
                    <span className="rail-tooltip">Sign In</span>
                  </button>
                )}
              </div>
            </aside>
          )}

          {/* ============================================================
              SIDEBAR — Redesigned with organized sections
              ============================================================ */}
          <aside className={`scholar-sidebar flex flex-col p-3 overflow-hidden h-full shrink-0 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-[19.5rem] opacity-100 mobile-drawer' : 'w-0 !p-0 !border-0 opacity-0 pointer-events-none'}`}>
            {/* Brand Lockup + Home + Collapse Panel */}
            <div className="brand-lockup shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="brand-mark shrink-0">
                  <Layers size={18} />
                </div>
                <div className="min-w-0">
                  <div className="brand-title truncate">DocPilot AI</div>
                  <div className="brand-subtitle truncate">Research Workspace</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setCurrentView("landing")}
                  className="sidebar-icon-btn"
                  title="Return to Landing Page"
                  aria-label="Return to Landing Page"
                >
                  <Home size={13} />
                </button>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="sidebar-icon-btn"
                  title="Hide Control Panel"
                  aria-label="Hide Control Panel"
                >
                  <PanelLeftClose size={13} />
                </button>
              </div>
            </div>

            {/* Quick Options Grid — Panel actions */}
            <div className="sidebar-section shrink-0">
              <div className="sidebar-section-header">
                <div className="sidebar-section-title">
                  <Sparkles size={12} />
                  <span>Quick Actions</span>
                </div>
              </div>
              <div className="quick-options-grid">
                <button
                  onClick={() => { setActiveTab("chat"); handleNewChat(); }}
                  className="quick-option-btn"
                  title="Start a fresh chat session"
                >
                  <Plus size={15} />
                  <span>New Chat</span>
                </button>
                <button
                  onClick={() => {
                    if (!pdfUrl && !showPdfViewer) {
                      showToast("Upload a PDF document first to view it side-by-side.", "info");
                      setLibSubTab("workspace");
                    } else {
                      setShowPdfViewer(prev => !prev);
                    }
                  }}
                  className={`quick-option-btn ${showPdfViewer && pdfUrl ? 'active' : ''}`}
                  title={showPdfViewer && pdfUrl ? "Hide PDF Viewer" : "Show PDF Viewer"}
                >
                  {showPdfViewer && pdfUrl ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span>{showPdfViewer && pdfUrl ? "Hide PDF" : "Show PDF"}</span>
                </button>
                <button
                  onClick={handleGenerateGuide}
                  disabled={isGeneratingGuide}
                  className={`quick-option-btn ${activeTab === 'guide' ? 'active' : ''}`}
                  title="Generate Study Guide"
                >
                  {isGeneratingGuide ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}
                  <span>Study Guide</span>
                </button>
                <button
                  onClick={() => { setSidebarMode("history"); }}
                  className={`quick-option-btn ${sidebarMode === 'history' ? 'active' : ''}`}
                  title="View chat history"
                >
                  <Clock size={15} />
                  <span>History</span>
                </button>
              </div>
            </div>

            {/* Sidebar Mode Tabs: Documents vs History */}
            <div className="sidebar-mode-toggle shrink-0 grid grid-cols-2 gap-1 p-1 rounded-md bg-surface-2 border border-border mb-2">
              <button
                type="button"
                onClick={() => setSidebarMode("docs")}
                className={`mode-tab-btn ${sidebarMode === "docs" ? "active" : ""}`}
              >
                <Files size={12} />
                <span>Docs ({documents.length}/{MAX_DOCS})</span>
              </button>
              <button
                type="button"
                onClick={() => setSidebarMode("history")}
                className={`mode-tab-btn ${sidebarMode === "history" ? "active" : ""}`}
              >
                <MessageSquare size={12} />
                <span>History ({chats.length})</span>
              </button>
            </div>

            {/* --- TAB 1: DOCUMENTS (MODULAR) --- */}
            {sidebarMode === "docs" && (
              <>
                {/* Modular Subtabs: Workspace (Active), Neon DB Archive, Standard Guides */}
                <div className="lib-subtabs shrink-0">
                  <button
                    type="button"
                    onClick={() => setLibSubTab("workspace")}
                    className={`lib-subtab ${libSubTab === "workspace" ? "active" : ""}`}
                    title="Active workspace documents loaded in vector index"
                  >
                    <Layers size={11} />
                    <span>Workspace ({documents.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibSubTab("database")}
                    className={`lib-subtab ${libSubTab === "database" ? "active" : ""}`}
                    title="All documents stored in Neon PostgreSQL cloud database"
                  >
                    <Database size={11} />
                    <span>Cloud DB ({dbDocuments.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibSubTab("builtins")}
                    className={`lib-subtab ${libSubTab === "builtins" ? "active" : ""}`}
                    title="Standard academic guides & reference textbooks"
                  >
                    <BookOpen size={11} />
                    <span>Guides ({defaultDocuments.length || 2})</span>
                  </button>
                </div>

                {/* Subtab 1: Workspace Active Docs & Upload Dropzone */}
                {libSubTab === "workspace" && (
                  <>
                    {/* Upload area or compact capacity badge when 5/5 reached */}
                    {documents.length >= MAX_DOCS ? (
                      <div className="capacity-full-badge shrink-0 flex items-center justify-between px-3 py-2 mb-2">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 size={14} className="text-success shrink-0" />
                          <span className="font-semibold text-xs text-ink">Capacity Full ({MAX_DOCS}/{MAX_DOCS})</span>
                        </div>
                        <span className="text-[0.68rem] text-faint">Delete doc to add</span>
                      </div>
                    ) : (
                      <div className="upload-panel relative shrink-0 mb-2 py-2.5 px-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf"
                          multiple
                          onChange={handleFileUpload}
                          disabled={isUploading}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          style={{ zIndex: 2 }}
                          aria-label="Upload PDF documents"
                        />
                        {isUploading ? (
                          <div className="flex items-center justify-center gap-2 py-1 relative" style={{ zIndex: 1 }}>
                            <Loader2 className="animate-spin text-accent" size={16} />
                            <span className="small-label text-xs">Indexing into corpus...</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2.5 py-0.5 relative" style={{ zIndex: 1 }}>
                            <Upload size={16} className="muted-icon shrink-0" />
                            <div className="text-left">
                              <div className="upload-title text-xs leading-tight">Upload Custom PDFs</div>
                              <div className="upload-hint text-[0.65rem] leading-tight">
                                {MAX_DOCS - documents.length} slot{MAX_DOCS - documents.length !== 1 ? 's' : ''} remaining
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Document Library */}
                    <div className="status-panel flex-1 min-h-0 flex flex-col mb-2 p-2.5">
                      <div className="flex items-center justify-between mb-2 shrink-0">
                        <div className="sidebar-section-title">
                          <Files size={12} />
                          <span>Active Library ({documents.length}/{MAX_DOCS})</span>
                        </div>
                        {documents.length > 0 && (
                          <button
                            onClick={handleClearAll}
                            className="sidebar-section-action text-danger"
                            title="Remove all documents"
                            style={{ color: 'var(--danger)' }}
                          >
                            <Trash2 size={10} />
                            Clear all
                          </button>
                        )}
                      </div>

                      {/* Stats Row */}
                      {documents.length > 0 && (
                        <div className="stats-row shrink-0 mb-1.5">
                          <div className="stat-chip">
                            <FileText size={10} />
                            <span className="stat-value">{documents.length}</span> docs
                          </div>
                          <div className="stat-chip">
                            <Database size={10} />
                            <span className="stat-value">{totalChunks}</span> chunks
                          </div>
                          {activeDocName && (
                            <div className="stat-chip">
                              <Eye size={10} />
                              <span className="stat-value" title={activeDocName}>viewing</span>
                            </div>
                          )}
                        </div>
                      )}

                      {documents.length > 0 ? (
                        <div className="doc-library-list flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                          {documents.map((doc) => {
                            const isActive = doc.filename === activeDocName;
                            return (
                              <div
                                key={doc.filename}
                                className={`doc-card-modular ${isActive ? 'active' : ''}`}
                              >
                                <div className="doc-card-header">
                                  <div className="doc-card-title-wrap">
                                    <FileText size={14} className={isActive ? "text-accent shrink-0" : "muted-icon shrink-0"} />
                                    <div className="min-w-0 flex-1">
                                      <div className="doc-card-title" title={doc.filename}>{doc.filename}</div>
                                      <div className="doc-card-meta">
                                        <span>{doc.chunks} chunks</span>
                                        {isActive && <span className="badge-source active-badge">Viewing</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <button
                                    onClick={(e) => handleDeleteDoc(e, doc.filename)}
                                    className="btn-doc-action danger"
                                    title={`Remove ${doc.filename}`}
                                    aria-label={`Remove ${doc.filename}`}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                                <div className="doc-card-actions">
                                  <button
                                    onClick={() => switchActiveDoc(doc.filename)}
                                    className={`btn-doc-action ${isActive ? 'primary' : ''}`}
                                  >
                                    <Eye size={11} />
                                    <span>{isActive ? 'In Viewer' : 'View PDF'}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-4 text-center text-muted px-2 flex-1 flex flex-col items-center justify-center">
                          <div className="w-9 h-9 rounded-xl bg-accent-soft flex items-center justify-center text-accent mb-2">
                            <Search size={18} />
                          </div>
                          <p className="text-xs font-semibold text-ink">Workspace Ready</p>
                          <p className="text-[0.66rem] text-faint mt-1 leading-relaxed">
                            Upload PDFs above, or pick from Cloud DB and Guides tabs.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Subtab 2: Neon PostgreSQL DB Stored Documents */}
                {libSubTab === "database" && (
                  <div className="status-panel flex-1 min-h-0 flex flex-col mb-2 p-2.5">
                    <div className="flex items-center justify-between mb-2 shrink-0">
                      <div className="sidebar-section-title">
                        <Database size={12} />
                        <span>Cloud Database Archive</span>
                      </div>
                      <button
                        onClick={fetchAllDocuments}
                        className="sidebar-section-action"
                        title="Refresh database records"
                      >
                        <Sparkles size={10} />
                        Refresh
                      </button>
                    </div>

                    {dbDocuments.length > 0 ? (
                      <div className="doc-library-list flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                        {dbDocuments.map((doc) => {
                          const isActive = doc.filename === activeDocName;
                          const isLoaded = documents.some(d => d.filename === doc.filename);
                          return (
                            <div
                              key={doc.filename}
                              className={`doc-card-modular ${isActive ? 'active' : ''}`}
                            >
                              <div className="doc-card-header">
                                <div className="doc-card-title-wrap">
                                  <Database size={14} className="text-accent shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className="doc-card-title" title={doc.filename}>{doc.filename}</div>
                                    <div className="doc-card-meta">
                                      <span>{formatBytes(doc.file_size)}</span>
                                      <span>•</span>
                                      <span className="badge-source db">Neon DB</span>
                                      {isLoaded && <span className="badge-source active-badge">In Chat</span>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="doc-card-actions">
                                <button
                                  onClick={() => switchActiveDoc(doc.filename)}
                                  className={`btn-doc-action ${isActive ? 'primary' : ''}`}
                                  title="Open in split-screen PDF viewer"
                                >
                                  <Eye size={11} />
                                  <span>{isActive ? 'In Viewer' : 'View PDF'}</span>
                                </button>
                                {!isLoaded && (
                                  <button
                                    onClick={() => indexDocIntoWorkspace(doc.filename)}
                                    className="btn-doc-action primary"
                                    title="Load into active workspace so you can ask questions"
                                  >
                                    <Plus size={11} />
                                    <span>Index to Chat</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="py-6 text-center text-muted px-3 flex-1 flex flex-col items-center justify-center">
                        <div className="w-10 h-10 rounded-xl bg-accent-soft flex items-center justify-center text-accent mb-2">
                          <Database size={20} />
                        </div>
                        <p className="text-xs font-bold text-ink">Cloud DB Ready</p>
                        <p className="text-[0.68rem] text-faint mt-1 leading-relaxed">
                          PDFs you upload are automatically saved into Neon PostgreSQL cloud database and will appear here permanently.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Subtab 3: Built-in Academic Guides & Textbooks */}
                {libSubTab === "builtins" && (
                  <div className="status-panel flex-1 min-h-0 flex flex-col mb-2 p-2.5">
                    <div className="flex items-center justify-between mb-2 shrink-0">
                      <div className="sidebar-section-title">
                        <BookOpen size={12} />
                        <span>Academic Guides & Texts</span>
                      </div>
                    </div>

                    <div className="doc-library-list flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
                      {defaultDocuments.map((doc) => {
                        const isActive = doc.filename === activeDocName || (doc.actual_filename && doc.actual_filename === activeDocName);
                        const isLoaded = documents.some(d => d.filename === doc.filename || d.filename === doc.actual_filename);
                        return (
                          <div
                            key={doc.filename}
                            className={`doc-card-modular ${isActive ? 'active' : ''}`}
                          >
                            <div className="doc-card-header">
                              <div className="doc-card-title-wrap">
                                <BookOpen size={14} className="text-accent shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="doc-card-title" title={doc.filename}>{doc.filename}</div>
                                  <div className="doc-card-meta">
                                    <span>{formatBytes(doc.file_size)}</span>
                                    <span>•</span>
                                    <span className="badge-source builtin">Standard Guide</span>
                                    {isLoaded && <span className="badge-source active-badge">In Chat</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="doc-card-actions">
                              <button
                                onClick={() => switchActiveDoc(doc.actual_filename || doc.filename)}
                                className={`btn-doc-action ${isActive ? 'primary' : ''}`}
                                title="Open this guide in split-screen PDF viewer"
                              >
                                <Eye size={11} />
                                <span>{isActive ? 'In Viewer' : 'View PDF'}</span>
                              </button>
                              {!isLoaded && (
                                <button
                                  onClick={() => indexDocIntoWorkspace(doc.actual_filename || doc.filename)}
                                  className="btn-doc-action primary"
                                  title="Load into workspace vector index for Q&A"
                                >
                                  <Plus size={11} />
                                  <span>Index to Chat</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* --- TAB 2: CHAT HISTORY --- */}
            {sidebarMode === "history" && (
              <div className="history-panel flex-1 min-h-0 flex flex-col mb-2 p-2.5">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <div className="sidebar-section-title">
                    <Clock size={12} />
                    <span>Past Sessions</span>
                  </div>
                  <button
                    onClick={handleNewChat}
                    className="sidebar-section-action"
                    title="Start a new study session"
                  >
                    <Plus size={11} />
                    New Chat
                  </button>
                </div>

                {user ? (
                  chats.length > 0 ? (
                    <div className="chat-history-list flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
                      {chats.map((c) => {
                        const isChatActive = c.id === activeChatId;
                        const dateStr = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : "";
                        return (
                          <div
                            key={c.id}
                            onClick={() => handleSelectChat(c.id)}
                            className={`chat-history-item ${isChatActive ? 'active' : ''}`}
                            title={c.title}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <MessageSquare size={13} className={isChatActive ? "text-accent shrink-0" : "muted-icon shrink-0"} />
                              <div className="min-w-0 flex-1">
                                <div className="chat-item-title truncate font-semibold text-xs">{c.title}</div>
                                {dateStr && <div className="chat-item-date text-[0.62rem] text-muted">{dateStr}</div>}
                              </div>
                            </div>
                            <button
                              onClick={(e) => handleDeleteChat(e, c.id)}
                              className="doc-delete-btn"
                              title="Delete session"
                              aria-label="Delete session"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-muted">
                      <MessageSquare size={22} className="muted-icon mb-1.5 opacity-60" />
                      <p className="text-xs">No saved sessions yet.</p>
                      <p className="text-[0.68rem] text-faint mt-1">Start chatting or click '+ New Chat' to record sessions.</p>
                    </div>
                  )
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-muted">
                    <Sparkles size={22} className="text-accent mb-1.5" />
                    <p className="text-xs font-bold text-ink">Sign In to Save History</p>
                    <p className="text-[0.7rem] text-muted mt-1 leading-relaxed">
                      Sign in with Google above to preserve and resume your study sessions across tabs & devices.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* --- BOTTOM DOCK --- */}
            <div className="sidebar-footer-dock shrink-0 pt-2 mt-auto border-t border-border space-y-2">
              {/* User Account & Theme Controls */}
              <div className="sidebar-controls-row">
                {user ? (
                  <div className="user-info-chip">
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name} className="user-avatar" />
                    ) : (
                      <div className="user-avatar-placeholder">
                        {user.name?.[0] || 'U'}
                      </div>
                    )}
                    <span className="user-name-text" title={user.email}>{user.name}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setCurrentView("landing")}
                    className="sidebar-signin-btn"
                  >
                    <LogIn size={13} className="text-accent" />
                    <span>Sign In</span>
                  </button>
                )}

                {user && (
                  <button
                    onClick={handleLogout}
                    className="sidebar-icon-btn danger"
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <LogOut size={13} />
                  </button>
                )}

                {/* Theme Switcher */}
                <button
                  onClick={toggleTheme}
                  className="theme-toggle-pill"
                  title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                  aria-label="Toggle Theme"
                >
                  {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              </div>
            </div>
          </aside>

          {/* ============================================================
              MAIN CONTENT AREA
              ============================================================ */}
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <main className={`workspace-pane flex h-full flex-col transition-all duration-300 ${showPdfViewer && pdfUrl ? (mobileTab === 'pdf' ? 'hidden lg:flex lg:w-1/2' : 'w-full lg:w-1/2') : 'w-full'}`}>
              <header className="topbar">
                <div className="flex items-center gap-2">
                  <div className="tab-list">
                    <button
                      onClick={() => { setActiveTab("chat"); setMobileTab("chat"); }}
                      className={activeTab === "chat" ? "tab-button active" : "tab-button"}
                    >
                      <MessageSquare size={13} className="mr-1.5" />
                      Study Q&A
                    </button>
                    <button
                      onClick={() => setActiveTab("guide")}
                      className={activeTab === "guide" ? "tab-button active" : "tab-button"}
                    >
                      <BookOpen size={13} className="mr-1.5" />
                      Study Guide
                    </button>
                  </div>

                  {/* Mobile Tab Switcher when PDF is active */}
                  {showPdfViewer && pdfUrl && (
                    <div className="mobile-view-tabs lg:hidden ml-1">
                      <button
                        onClick={() => setMobileTab("chat")}
                        className={`mobile-view-tab ${mobileTab === 'chat' ? 'active' : ''}`}
                      >
                        <MessageSquare size={12} />
                        <span>Chat</span>
                      </button>
                      <button
                        onClick={() => setMobileTab("pdf")}
                        className={`mobile-view-tab ${mobileTab === 'pdf' ? 'active' : ''}`}
                      >
                        <Eye size={12} />
                        <span>PDF</span>
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {activeChatId && (
                    <span className="chunk-badge truncate max-w-[170px] hidden sm:inline-flex" title="Active session">
                      💬 {chats.find(c => c.id === activeChatId)?.title || "Session"}
                    </span>
                  )}
                  <span className="chunk-badge">
                    {documents.length > 0
                      ? `${documents.length} PDF${documents.length > 1 ? 's' : ''} • ${totalChunks} chunks`
                      : '📚 OS Knowledge Base Active'}
                  </span>
                </div>
              </header>

              {activeTab === "chat" && (
                <div className="flex h-[calc(100vh-3.25rem)] flex-1 flex-col overflow-hidden">
                  <div className="conversation-scroll flex-1 space-y-4 overflow-y-auto p-5">
                    {messages.length === 0 ? (
                      <div className="empty-state py-8 text-center max-w-xl mx-auto">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-accent/10 text-accent mb-3 border border-accent/20 shadow-sm">
                          <Sparkles size={24} />
                        </div>
                        <h1 className="text-xl font-bold text-ink">Operating Systems AI Tutor</h1>
                        <p className="text-xs text-muted mt-1 max-w-md mx-auto leading-relaxed">
                          Ask questions directly from the built-in Operating Systems knowledge base, or upload your own PDFs for multi-doc synthesis.
                        </p>
                        <div className="mt-6 flex flex-col gap-2 text-left w-full">
                          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-faint px-1">Quick Start Questions</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                              "Explain Round Robin vs SJF CPU scheduling with trade-offs",
                              "How does Banker's Algorithm prevent Deadlocks?",
                              "Explain Paging, TLB, and Effective Access Time (EAT)",
                              "Difference between Mutex and Binary Semaphore"
                            ].map((pill, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setInput(pill)}
                                className="quick-start-pill group"
                              >
                                <span className="pill-icon">💡</span>
                                <span className="pill-text group-hover:text-accent">{pill}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      messages.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                          <div className={msg.role === "user" ? "message-bubble user" : "message-bubble assistant"}>
                            <div className="markdown-body leading-relaxed">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm, remarkMath]}
                                rehypePlugins={[rehypeKatex]}
                              >
                                {preprocessMarkdown(msg.content)}
                              </ReactMarkdown>
                            </div>

                            {msg.sources && msg.sources.length > 0 && (
                              <div className="citation-block">
                                <button onClick={() => toggleSource(i)} className="citation-toggle">
                                  <span>{msg.sources.length} document citations</span>
                                  {expandedSources[i] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>

                                {/* Quick Page Jump Pills */}
                                <div className="citation-pages flex flex-wrap gap-1.5 mt-2">
                                  {msg.sources.map((s, sIdx) => (
                                    <button
                                      key={sIdx}
                                      onClick={() => jumpToCitation(s.doc_name, s.page)}
                                      className="page-jump"
                                      title={`Open ${s.doc_name || 'Doc'} at page ${s.page}`}
                                    >
                                      <FileText size={11} className="inline mr-1 opacity-70" />
                                      <span className="max-w-[120px] truncate inline-block align-bottom">{s.doc_name || 'Doc'}</span>
                                      <span className="ml-1 font-bold">p.{s.page}</span>
                                    </button>
                                  ))}
                                </div>

                                {expandedSources[i] && (
                                  <div className="space-y-2 mt-2">
                                    {msg.sources.map((s, sIdx) => (
                                      <button
                                        key={sIdx}
                                        onClick={() => jumpToCitation(s.doc_name, s.page)}
                                        className="source-card text-left w-full"
                                      >
                                        <span className="source-heading flex items-center justify-between">
                                          <span className="font-semibold text-accent truncate max-w-[200px]">
                                            {s.doc_name || "Document"} • Page {s.page}
                                          </span>
                                          <span>Relevance {s.relevance_score}</span>
                                        </span>
                                        <span className="source-snippet block text-xs mt-1">"{s.snippet}..."</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Step-by-Step Explain Button — appears on assistant messages */}
                            {msg.role === "assistant" && !stepExplainData[i] && (
                              <div className="step-explain-trigger">
                                <button
                                  onClick={() => handleStepExplain(i)}
                                  disabled={stepExplainLoading[i]}
                                  className="step-explain-btn"
                                >
                                  {stepExplainLoading[i] ? (
                                    <>
                                      <Loader2 size={13} className="animate-spin" />
                                      <span>Generating step-by-step walkthrough...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles size={13} />
                                      <span>Step-by-Step Explain</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            )}

                            {/* Step-by-Step Reveal Panel */}
                            {stepExplainData[i] && stepExplainData[i].steps && (
                              <div className="step-explain-panel">
                                <div className="step-explain-header">
                                  <Sparkles size={13} className="text-accent" />
                                  <span className="step-explain-title">
                                    Step-by-Step Walkthrough
                                  </span>
                                  <span className="step-explain-counter">
                                    {stepExplainVisible[i] || 0} / {stepExplainData[i].steps.length} steps
                                  </span>
                                </div>

                                <div className="step-cards">
                                  {stepExplainData[i].steps.slice(0, stepExplainVisible[i] || 0).map((step, sIdx) => (
                                    <div
                                      key={sIdx}
                                      className="step-card"
                                      style={{ animationDelay: `${sIdx * 0.08}s` }}
                                    >
                                      <div className="step-card-indicator">
                                        <div className="step-dot" />
                                        {sIdx < (stepExplainVisible[i] || 0) - 1 && <div className="step-line" />}
                                      </div>
                                      <div className="step-card-body markdown-body">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm, remarkMath]}
                                          rehypePlugins={[rehypeKatex]}
                                        >
                                          {preprocessMarkdown(step)}
                                        </ReactMarkdown>
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* Step Controls */}
                                {(stepExplainVisible[i] || 0) < stepExplainData[i].steps.length && (
                                  <div className="step-controls">
                                    <button onClick={() => revealNextStep(i)} className="step-next-btn">
                                      <ChevronRight size={13} />
                                      Next Step
                                    </button>
                                    <button onClick={() => revealAllSteps(i)} className="step-showall-btn">
                                      Show All ({stepExplainData[i].steps.length - (stepExplainVisible[i] || 0)} remaining)
                                    </button>
                                  </div>
                                )}

                                {(stepExplainVisible[i] || 0) >= stepExplainData[i].steps.length && (
                                  <div className="step-complete">
                                    <CheckCircle2 size={14} />
                                    <span>All {stepExplainData[i].steps.length} steps revealed</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                    {isQuerying && (
                      <div className="query-status">
                        <Loader2 size={14} className="animate-spin text-accent" />
                        <span>Searching multi-doc context and synthesizing answer...</span>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="composer-wrap">
                    <form onSubmit={handleSendMessage} className="composer">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={documents.length > 0 ? "Ask across your documents & OS guide..." : "Ask any question on Operating Systems..."}
                        disabled={isQuerying}
                        className="composer-input"
                      />
                      <button type="submit" disabled={!input.trim() || isQuerying} className="send-button" aria-label="Send question">
                        <Send size={15} />
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {activeTab === "guide" && (
                <div className="guide-scroll flex-1 overflow-y-auto p-6">
                  {isGeneratingGuide ? (
                    <div className="empty-state h-64">
                      <Loader2 size={26} className="animate-spin text-accent" />
                      <p>Synthesizing comprehensive master study guide...</p>
                    </div>
                  ) : studyGuide ? (
                    <article className="study-paper markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                      >
                        {preprocessMarkdown(studyGuide)}
                      </ReactMarkdown>
                    </article>
                  ) : (
                    <div className="empty-state h-64">
                      <BookOpen size={34} />
                      <p>Click 'Study Guide' in the sidebar Quick Actions to generate an in-depth exam review & concept synthesis.</p>
                    </div>
                  )}
                </div>
              )}
            </main>

            {/* ============================================================
                PDF VIEWER PANE
                ============================================================ */}
            {showPdfViewer && pdfUrl && (
              <section className={`pdf-pane flex h-full flex-col border-l border-border ${mobileTab === 'chat' ? 'hidden lg:flex lg:w-1/2' : 'w-full lg:w-1/2 mobile-full'}`}>
                {/* Unified Multi-Doc Selector Tab Strip across Workspace, DB, and Standard Guides */}
                <div className="pdf-doc-tabs-bar flex items-center justify-between">
                  <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 pr-2">
                    <span className="text-[0.65rem] uppercase tracking-wider text-faint font-bold mr-1 shrink-0 flex items-center gap-1">
                      <Eye size={12} className="text-accent" />
                      <span>Viewing:</span>
                    </span>
                    {(() => {
                      const seen = new Set();
                      const allList = [];
                      documents.forEach(d => {
                        if (!seen.has(d.filename)) {
                          seen.add(d.filename);
                          allList.push({ filename: d.filename, label: d.filename, type: "workspace" });
                        }
                      });
                      dbDocuments.forEach(d => {
                        if (!seen.has(d.filename)) {
                          seen.add(d.filename);
                          allList.push({ filename: d.filename, label: d.filename, type: "database" });
                        }
                      });
                      defaultDocuments.forEach(d => {
                        const fname = d.actual_filename || d.filename;
                        if (!seen.has(fname)) {
                          seen.add(fname);
                          allList.push({ filename: fname, label: d.filename, type: "builtin" });
                        }
                      });

                      return allList.map((d) => {
                        const isSelected = d.filename === activeDocName || (activeDocName && activeDocName.toLowerCase() === d.filename.toLowerCase());
                        return (
                          <button
                            key={d.filename}
                            onClick={() => switchActiveDoc(d.filename)}
                            className={`pdf-tab-pill ${isSelected ? 'active' : ''}`}
                            title={`Switch viewer to ${d.label} (${d.type})`}
                          >
                            {d.type === 'database' && <Database size={11} className="shrink-0 text-accent" />}
                            {d.type === 'builtin' && <BookOpen size={11} className="shrink-0 text-accent-2" />}
                            {d.type === 'workspace' && <FileText size={11} className="shrink-0" />}
                            <span className="pill-text">{d.label}</span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button
                      onClick={() => setMobileTab("chat")}
                      className="mobile-view-tab lg:hidden"
                      title="Return to Chat"
                    >
                      <MessageSquare size={12} />
                      <span>Chat</span>
                    </button>
                    <button
                      onClick={() => setShowPdfViewer(false)}
                      className="icon-button shrink-0"
                      title="Close PDF Viewer"
                      aria-label="Close PDF Viewer"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                <div className="viewer-toolbar">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setCurrentPage(p => Math.max(p - 1, 1))} disabled={currentPage <= 1} className="icon-button" aria-label="Previous page">
                      <ChevronLeft size={14} />
                    </button>
                    
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const p = parseInt(pageInputVal, 10);
                      if (!isNaN(p) && p >= 1 && p <= (numPages || 1)) {
                        setCurrentPage(p);
                      } else {
                        setPageInputVal(String(currentPage));
                      }
                    }} className="flex items-center gap-1">
                      <span className="text-xs text-muted">Page</span>
                      <input
                        type="number"
                        min={1}
                        max={numPages || 1}
                        value={pageInputVal}
                        onChange={(e) => setPageInputVal(e.target.value)}
                        className="page-jump-input"
                        aria-label="Direct page jump"
                      />
                      <span className="page-count">of {numPages || "--"}</span>
                    </form>

                    <button onClick={() => setCurrentPage(p => Math.min(p + 1, numPages || p + 1))} disabled={currentPage >= (numPages || 1)} className="icon-button" aria-label="Next page">
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink truncate max-w-[150px]" title={activeDocName}>
                      {activeDocName}
                    </span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPdfScale(s => Math.max(s - 0.15, 0.5))} className="icon-button" title="Zoom out">
                        <ZoomOut size={14} />
                      </button>
                      <button onClick={() => setPdfScale(1.0)} className="zoom-readout cursor-pointer hover:text-accent" title="Reset to 100%">
                        {Math.round(pdfScale * 100)}%
                      </button>
                      <button onClick={() => setPdfScale(s => Math.min(s + 0.15, 2.5))} className="icon-button" title="Zoom in">
                        <ZoomIn size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pdf-canvas">
                  <Document
                    file={pdfUrl}
                    onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                    loading={
                      <div className="query-status h-64 justify-center">
                        <Loader2 size={16} className="animate-spin text-accent" />
                        <span>Loading PDF pages...</span>
                      </div>
                    }
                    error={<div className="error-note">Failed to render PDF preview.</div>}
                  >
                    <Page
                      pageNumber={currentPage}
                      scale={pdfScale}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="pdf-page"
                    />
                  </Document>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* Global In-App Toast Notifications */}
      {toasts.length > 0 && (
        <div className="docpilot-toast-container" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`docpilot-toast toast-${t.type}`}>
              {t.type === 'error' && <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />}
              {t.type === 'success' && <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />}
              {t.type === 'info' && <Sparkles size={16} className="text-accent shrink-0 mt-0.5" />}
              <div className="flex-1 text-xs leading-relaxed text-ink">{t.message}</div>
              <button 
                onClick={() => dismissToast(t.id)} 
                className="text-muted hover:text-ink cursor-pointer p-0.5"
                aria-label="Dismiss toast"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
