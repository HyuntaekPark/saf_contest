import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Award, Expand, ImagePlus, LogIn, LogOut, Pin, PinOff, Save, Send, Settings, ThumbsUp, Trash2, UploadCloud, X } from "lucide-react";
import "./styles.css";

type User = {
  name: string;
  batch: string;
  studentID: string;
  role?: "admin" | "user";
};

type Submission = {
  id: string;
  authorName: string;
  authorId: string;
  teamName?: string;
  title: string;
  description: string;
  imageUrl: string;
  imageUrls?: string[];
  imagePathname?: string | null;
  imagePathnames?: string[];
  createdAt: string;
  pinnedAt?: string | null;
  voteCount: number;
  votedByMe: boolean;
};

type ContestSettings = {
  maxVotesPerUser: number;
  maxSubmissionsPerUser: number;
  showRanking: boolean;
  showVoteCounts: boolean;
};

const userKey = "saf-physics-user";
const defaultSettings: ContestSettings = {
  maxVotesPerUser: 3,
  maxSubmissionsPerUser: 1,
  showRanking: true,
  showVoteCounts: true
};
const maxUploadBytes = 5 * 1024 * 1024;

function studentKey(user: User) {
  return user.role === "admin" ? "admin" : `${user.batch}-${user.studentID}`;
}

function displayAuthor(submission: Submission) {
  const author = `${submission.authorName}(${submission.authorId})`;
  return submission.teamName ? `${author} · ${submission.teamName}` : author;
}

function submissionImages(submission: Submission) {
  return submission.imageUrls?.length ? submission.imageUrls : [submission.imageUrl];
}

function hasAdminAccess(user: User) {
  return user.role === "admin" || studentKey(user) === "26-048";
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

async function compressImageFile(file: File) {
  if (file.size > maxUploadBytes) {
    throw new Error("이미지는 5MB 이하만 업로드할 수 있습니다.");
  }

  const image = await loadImageFromFile(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 압축하지 못했습니다.");
  context.drawImage(image, 0, 0, width, height);

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("이미지를 압축하지 못했습니다."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        reader.readAsDataURL(blob);
      },
      "image/webp",
      0.82
    );
  });
}

function App() {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(userKey);
    return raw ? JSON.parse(raw) : null;
  });
  const [deviceType, setDeviceType] = useState<"mobile" | "desktop">("desktop");

  useEffect(() => {
    const detectDevice = () => {
      const touchDevice = window.matchMedia("(pointer: coarse)").matches;
      const narrowScreen = window.matchMedia("(max-width: 760px)").matches;
      setDeviceType(touchDevice || narrowScreen ? "mobile" : "desktop");
    };
    detectDevice();
    window.addEventListener("resize", detectDevice);
    return () => window.removeEventListener("resize", detectDevice);
  }, []);

  useEffect(() => {
    document.body.dataset.device = deviceType;
  }, [deviceType]);

  const handleLogin = (nextUser: User) => {
    localStorage.setItem(userKey, JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const logout = () => {
    localStorage.removeItem(userKey);
    setUser(null);
  };

  return user ? <ContestApp user={user} onLogout={logout} /> : <LoginPage onLogin={handleLogin} />;
}

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password })
      });
      const payload = await response.json();
      if (!response.ok || payload.code !== 200) {
        setMessage(payload.message || "로그인에 실패했습니다.");
        return;
      }
      onLogin(payload.data);
    } catch {
      setMessage("로그인 서버에 연결하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={loading ? "login-page is-loading" : "login-page"}>
      <form className={loading ? "login-panel is-loading" : "login-panel"} onSubmit={submit}>
        <section className="login-copy">
          <img className="login-logo" src="/assets/logo.png" alt="한국과학영재학교" />
          <p className="eyebrow">SAF 2026 Peer Review</p>
          <h1>물리학 유머 콘텐츠 콘테스트</h1>
          <p className="login-description">생성형 AI로 만든 작품을 제출하고, 동료의 작품에 추천을 남겨주세요.</p>
        </section>
        <section className="login-form">
          <strong className="form-title">가온누리 로그인</strong>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="아이디를 입력해주세요"
            required
          />
          <input
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호를 입력해주세요"
            type="password"
            required
          />
          <button className={loading ? "primary-button loading-button" : "primary-button"} disabled={loading} type="submit">
            <LogIn size={20} aria-hidden />
            {loading && <span className="button-spinner" aria-hidden />}
            {loading ? "확인 중" : "LOGIN"}
          </button>
          {message && <p className="login-message">{message}</p>}
          <button className="text-link privacy-link" onClick={() => setShowPrivacy(true)} type="button">
            개인정보처리방침
          </button>
        </section>
      </form>
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </main>
  );
}

function ContestApp({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [settings, setSettings] = useState<ContestSettings>(defaultSettings);
  const [activeTab, setActiveTab] = useState<"vote" | "submit" | "ranking" | "settings">("vote");
  const [previewSubmission, setPreviewSubmission] = useState<Submission | null>(null);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const voterId = studentKey(user);
  const isAdmin = hasAdminAccess(user);
  const [usedVotes, setUsedVotes] = useState(0);
  const remainingVotes = Math.max(0, settings.maxVotesPerUser - usedVotes);
  const userSubmissionCount = submissions.filter((submission) => submission.authorId === voterId).length;
  const remainingSubmissions = isAdmin
    ? Infinity
    : Math.max(0, settings.maxSubmissionsPerUser - userSubmissionCount);
  const canViewRanking = isAdmin || settings.showRanking;
  const canViewVoteCounts = isAdmin || settings.showVoteCounts;

  async function loadSubmissions({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/bootstrap?voterId=${encodeURIComponent(voterId)}`);
      const payload = await response.json();
      setSettings(payload.settings);
      setUsedVotes(payload.usedVotes);
      setSubmissions(payload.submissions);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function refresh({ silent = false } = {}) {
    await loadSubmissions({ silent });
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh({ silent: true });
      }
    }, 8000);

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh({ silent: true });
      }
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [voterId]);

  const ranked = useMemo(
    () => [...submissions].sort((a, b) => b.voteCount - a.voteCount || Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [submissions]
  );

  async function vote(id: string) {
    const target = submissions.find((submission) => submission.id === id);
    if (target?.authorId === voterId) {
      alert("본인은 추천할 수 없습니다.");
      return;
    }

    const alreadyVoted = target?.votedByMe;
    if (!alreadyVoted && remainingVotes <= 0) {
      alert(`투표권은 최대 ${settings.maxVotesPerUser}개까지 사용할 수 있습니다.`);
      return;
    }

    const response = await fetch(`/api/submissions/${id}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voterId })
    });
    const payload = await response.json();
    if (!response.ok) {
      alert(payload.message || "추천 처리에 실패했습니다.");
      return;
    }
    setSubmissions((items) => items.map((item) => (item.id === id ? payload.submission : item)));
    setUsedVotes(settings.maxVotesPerUser - payload.remainingVotes);
  }

  async function deleteSubmission(id: string) {
    const target = submissions.find((submission) => submission.id === id);
    if (!target) return;
    const ok = confirm(`"${target.title}" 작품을 삭제할까요?`);
    if (!ok) return;

    const response = await fetch(`/api/submissions/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterId: voterId })
    });
    const payload = await response.json();
    if (!response.ok) {
      alert(payload.message || "삭제에 실패했습니다.");
      return;
    }
    setSubmissions((items) => items.filter((item) => item.id !== id));
  }

  async function togglePinSubmission(id: string) {
    const target = submissions.find((submission) => submission.id === id);
    if (!target) return;

    const response = await fetch(`/api/submissions/${id}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterId: voterId, pinned: !target.pinnedAt })
    });
    const payload = await response.json();
    if (!response.ok) {
      alert(payload.message || "고정 처리에 실패했습니다.");
      return;
    }
    await refresh();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <img src="/assets/logo.png" alt="KSA" />
        <div className="topbar-user">
          <button className="topbar-link" onClick={() => setShowPrivacy(true)} type="button">
            개인정보처리방침
          </button>
          <span>{user.name} · {isAdmin ? "admin" : `${user.batch}${user.studentID}`}</span>
          <button className="icon-button" onClick={onLogout} title="로그아웃">
            <LogOut size={22} aria-hidden />
          </button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">SAF 물리지구과학부 학부행사</p>
          <h1>Peer Review</h1>
          <p>작품을 올리고, 가장 재치 있는 콘텐츠에 추천을 눌러주세요.</p>
        </div>
        <aside className="hero-stats">
          <div>
            <strong>{submissions.length}</strong>
            <span>제출 작품</span>
          </div>
          {canViewVoteCounts && (
            <div>
              <strong>{submissions.reduce((total, item) => total + (item?.voteCount ?? 0), 0)}</strong>
              <span>누적 추천</span>
            </div>
          )}
          <div>
            <strong>{remainingVotes}</strong>
            <span>남은 투표권</span>
          </div>
        </aside>
      </section>

      <nav className={isAdmin ? "tabs admin-tabs" : canViewRanking ? "tabs" : "tabs compact-tabs"} aria-label="행사 메뉴">
        <button className={activeTab === "vote" ? "active" : ""} onClick={() => setActiveTab("vote")}>
          <ThumbsUp size={17} aria-hidden />
          동료 평가
        </button>
        <button className={activeTab === "submit" ? "active" : ""} onClick={() => setActiveTab("submit")}>
          <ImagePlus size={17} aria-hidden />
          작품 제출
        </button>
        {canViewRanking && (
          <button className={activeTab === "ranking" ? "active" : ""} onClick={() => setActiveTab("ranking")}>
            <Award size={17} aria-hidden />
            순위 보기
          </button>
        )}
        {isAdmin && (
          <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
            <Settings size={17} aria-hidden />
            설정
          </button>
        )}
      </nav>

      <section className="vote-meter" aria-label="투표권과 제출 제한">
        <strong>투표권 {usedVotes}/{settings.maxVotesPerUser}</strong>
        <span>{isAdmin ? "관리자는 모든 작품을 삭제할 수 있습니다." : `남은 제출 ${remainingSubmissions}개`}</span>
      </section>

      {activeTab === "submit" && (
        <SubmitPanel
          user={user}
          settings={settings}
          submissionCount={userSubmissionCount}
          isAdmin={isAdmin}
          onCreated={refresh}
        />
      )}
      {activeTab === "ranking" && canViewRanking && <Ranking submissions={ranked} showVoteCounts={canViewVoteCounts} />}
      {activeTab === "ranking" && !canViewRanking && <p className="empty-state">현재 순위 공개가 꺼져 있습니다.</p>}
      {activeTab === "settings" && isAdmin && (
        <SettingsPanel settings={settings} requesterId={voterId} onSaved={setSettings} />
      )}
      {activeTab === "vote" && (
        <section className="content-grid" aria-live="polite">
          {loading ? (
            <p className="empty-state">작품을 불러오는 중입니다.</p>
          ) : submissions.length === 0 ? (
            <p className="empty-state">아직 제출된 작품이 없습니다.</p>
          ) : (
            submissions.filter(Boolean).map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                voterId={voterId}
                remainingVotes={remainingVotes}
                canDelete={isAdmin || submission.authorId === voterId}
                canPin={isAdmin}
                showVoteCount={canViewVoteCounts}
                onVote={vote}
                onDelete={deleteSubmission}
                onPin={togglePinSubmission}
                onPreview={setPreviewSubmission}
              />
            ))
          )}
        </section>
      )}
      {previewSubmission && <ImagePreview submission={previewSubmission} onClose={() => setPreviewSubmission(null)} />}
      <footer className="app-footer">
        <button className="text-link" onClick={() => setShowPrivacy(true)} type="button">
          개인정보처리방침
        </button>
      </footer>
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
    </main>
  );
}

function SubmitPanel({
  user,
  settings,
  submissionCount,
  isAdmin,
  onCreated
}: {
  user: User;
  settings: ContestSettings;
  submissionCount: number;
  isAdmin: boolean;
  onCreated: () => Promise<void>;
}) {
  const [teamName, setTeamName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [copyrightAgreed, setCopyrightAgreed] = useState(false);
  const [contentAgreed, setContentAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const blocked = !isAdmin && submissionCount >= settings.maxSubmissionsPerUser;
  const canSubmit = !saving && !blocked && teamName.trim().length > 0 && images.length > 0 && copyrightAgreed && contentAgreed;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (images.length === 0 || !canSubmit) return;
    setSaving(true);

    try {
      const imageDataUrls = await Promise.all(images.map((image) => compressImageFile(image)));
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorName: user.name,
          authorId: studentKey(user),
          teamName,
          title,
          description,
          imageDataUrls,
          imageNames: images.map((image) => image.name)
        })
      });

      if (!response.ok) {
        const payload = await response.json();
        alert(payload.message || "제출에 실패했습니다.");
        return;
      }
      setTeamName("");
      setTitle("");
      setDescription("");
      setImages([]);
      setCopyrightAgreed(false);
      setContentAgreed(false);
      await onCreated();
      alert("작품이 제출되었습니다.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "제출에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="submit-panel" onSubmit={submit}>
      <div className="section-heading">
        <p className="eyebrow">Submit</p>
        <h2>작품 제출</h2>
        <p>{isAdmin ? "관리자는 제출 수 제한 없이 테스트할 수 있습니다." : `제출 ${submissionCount}/${settings.maxSubmissionsPerUser}`}</p>
      </div>
      {blocked && <p className="notice">한 사람이 올릴 수 있는 최대 게시물 수에 도달했습니다.</p>}
      <label>
        <span>팀명</span>
        <input value={teamName} onChange={(event) => setTeamName(event.target.value)} maxLength={30} required disabled={blocked} />
      </label>
      <label>
        <span>제목</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={40} required disabled={blocked} />
      </label>
      <label>
        <span>간단한 설명</span>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} required disabled={blocked} />
        <small className="character-counter">{description.length}/300</small>
      </label>
      <label className="file-box">
        <UploadCloud size={28} aria-hidden />
        <span>
          {images.length > 0
            ? images.map((image) => image.name).join(", ")
            : "AI 유머 콘텐츠 이미지 업로드 (최대 2장, 각 5MB 이하)"}
        </span>
        <input
          accept="image/*"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []).slice(0, 2);
            if ((event.target.files?.length ?? 0) > 2) {
              alert("이미지는 한 작품당 최대 2장까지 업로드할 수 있습니다.");
              event.target.value = "";
              setImages([]);
              return;
            }
            if (files.some((file) => file.size > maxUploadBytes)) {
              alert("이미지는 각 5MB 이하만 업로드할 수 있습니다.");
              event.target.value = "";
              setImages([]);
              return;
            }
            setImages(files);
          }}
          type="file"
          multiple
          required
          disabled={blocked}
        />
        {images.length > 0 && <small className="file-counter">{images.length}/2장 선택됨</small>}
      </label>
      <section className="agreement-box" aria-label="제출 동의">
        <label>
          <input
            checked={copyrightAgreed}
            onChange={(event) => setCopyrightAgreed(event.target.checked)}
            type="checkbox"
            disabled={blocked}
            required
          />
          <span>한국과학영재학교는 제출한 이미지와 문구를 행사 평가에 사용할 권리가 있으며, 저작권 관련 책임은 본인이 부담하는데 동의합니다.</span>
        </label>
        <label>
          <input
            checked={contentAgreed}
            onChange={(event) => setContentAgreed(event.target.checked)}
            type="checkbox"
            disabled={blocked}
            required
          />
          <span>본인은 제출물에 욕설, 혐오, 외설적 내용 또는 타인에게 불쾌감을 줄 수 있는 내용이 없음을 보증합니다.</span>
        </label>
      </section>
      <button className="primary-button" disabled={!canSubmit} type="submit">
        <Send size={18} aria-hidden />
        {saving ? "제출 중" : "제출하기"}
      </button>
    </form>
  );
}

function SettingsPanel({
  settings,
  requesterId,
  onSaved
}: {
  settings: ContestSettings;
  requesterId: string;
  onSaved: (settings: ContestSettings) => void;
}) {
  const [maxVotesPerUser, setMaxVotesPerUser] = useState(settings.maxVotesPerUser);
  const [maxSubmissionsPerUser, setMaxSubmissionsPerUser] = useState(settings.maxSubmissionsPerUser);
  const [showRanking, setShowRanking] = useState(settings.showRanking);
  const [showVoteCounts, setShowVoteCounts] = useState(settings.showVoteCounts);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMaxVotesPerUser(settings.maxVotesPerUser);
    setMaxSubmissionsPerUser(settings.maxSubmissionsPerUser);
    setShowRanking(settings.showRanking);
    setShowVoteCounts(settings.showVoteCounts);
  }, [settings]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requesterId, maxVotesPerUser, maxSubmissionsPerUser, showRanking, showVoteCounts })
    });
    const payload = await response.json();
    setSaving(false);
    if (!response.ok) {
      alert(payload.message || "설정 저장에 실패했습니다.");
      return;
    }
    onSaved(payload);
    alert("설정이 저장되었습니다.");
  }

  return (
    <form className="settings-panel" onSubmit={save}>
      <div className="section-heading">
        <p className="eyebrow">Admin</p>
        <h2>콘테스트 설정</h2>
      </div>
      <label>
        <span>한 사람이 투표할 수 있는 표의 수</span>
        <input
          type="number"
          min={1}
          max={99}
          value={maxVotesPerUser}
          onChange={(event) => setMaxVotesPerUser(Number(event.target.value))}
        />
      </label>
      <label>
        <span>한 사람이 올릴 수 있는 최대 게시물 수</span>
        <input
          type="number"
          min={1}
          max={99}
          value={maxSubmissionsPerUser}
          onChange={(event) => setMaxSubmissionsPerUser(Number(event.target.value))}
        />
      </label>
      <label className="settings-checkbox">
        <input checked={showRanking} onChange={(event) => setShowRanking(event.target.checked)} type="checkbox" />
        <span>참가자에게 순위 보기 공개</span>
      </label>
      <label className="settings-checkbox">
        <input checked={showVoteCounts} onChange={(event) => setShowVoteCounts(event.target.checked)} type="checkbox" />
        <span>참가자에게 추천수 공개</span>
      </label>
      <button className="primary-button" disabled={saving} type="submit">
        <Save size={18} aria-hidden />
        {saving ? "저장 중" : "저장하기"}
      </button>
    </form>
  );
}

function SubmissionCard({
  submission,
  voterId,
  remainingVotes,
  canDelete,
  canPin,
  showVoteCount,
  onVote,
  onDelete,
  onPin,
  onPreview
}: {
  submission: Submission;
  voterId: string;
  remainingVotes: number;
  canDelete: boolean;
  canPin: boolean;
  showVoteCount: boolean;
  onVote: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onPreview: (submission: Submission) => void;
}) {
  const voted = submission.votedByMe;
  const mine = submission.authorId === voterId;
  const images = submissionImages(submission);
  const created = new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(submission.createdAt));

  return (
    <article className="submission-card">
      <header>
        <strong>{displayAuthor(submission)}</strong>
        <span>{created}</span>
      </header>
      <figure>
        <div className={images.length > 1 ? "image-stack two-images" : "image-stack"}>
          {images.map((imageUrl, index) => (
            <img key={`${imageUrl}-${index}`} src={imageUrl} alt={`${submission.title} ${index + 1}`} />
          ))}
        </div>
        <button className="expand-button" onClick={() => onPreview(submission)} title="크게 보기" type="button">
          <Expand size={22} aria-hidden />
          <span>크게보기</span>
        </button>
      </figure>
      <section className="description">
        <h2>{submission.title}</h2>
        <p>{submission.description}</p>
      </section>
      <footer>
        {showVoteCount && <span className="vote-count">{submission.voteCount} 추천</span>}
        <div className="card-actions">
          {canPin && (
            <button className="pin-button" onClick={() => onPin(submission.id)} title={submission.pinnedAt ? "고정 해제" : "첫 번째로 고정"} type="button">
              {submission.pinnedAt ? <PinOff size={17} aria-hidden /> : <Pin size={17} aria-hidden />}
            </button>
          )}
          {canDelete && (
            <button className="delete-button" onClick={() => onDelete(submission.id)} title="삭제" type="button">
              <Trash2 size={17} aria-hidden />
            </button>
          )}
          <button
            className={voted ? "vote-button voted" : "vote-button"}
            onClick={() => onVote(submission.id)}
            title={mine ? "본인은 추천할 수 없습니다." : remainingVotes === 0 && !voted ? "남은 투표권이 없습니다." : "추천"}
            type="button"
          >
            <ThumbsUp size={17} aria-hidden />
            {mine ? "본인 작품" : voted ? "추천취소" : "추천"}
          </button>
        </div>
      </footer>
    </article>
  );
}

function ImagePreview({ submission, onClose }: { submission: Submission; onClose: () => void }) {
  const images = submissionImages(submission);
  return (
    <section className="preview-overlay" role="dialog" aria-modal="true" aria-label="이미지 크게 보기" onClick={onClose}>
      <div className="preview-dialog" onClick={(event) => event.stopPropagation()}>
        <button className="preview-close" onClick={onClose} title="닫기" type="button">
          <X size={22} aria-hidden />
        </button>
        <div className={images.length > 1 ? "preview-images multiple" : "preview-images"}>
          {images.map((imageUrl, index) => (
            <img key={`${imageUrl}-${index}`} src={imageUrl} alt={`${submission.title} ${index + 1}`} />
          ))}
        </div>
        <div>
          <strong>{submission.title}</strong>
          <p>{displayAuthor(submission)}</p>
        </div>
      </div>
    </section>
  );
}

function Ranking({ submissions, showVoteCounts }: { submissions: Submission[]; showVoteCounts: boolean }) {
  return (
    <section className="ranking">
      <div className="section-heading">
        <p className="eyebrow">Ranking</p>
        <h2>실시간 추천 순위</h2>
      </div>
      {submissions.map((submission, index) => (
        <article key={submission.id} className="rank-row">
          <span className="rank-number">{index + 1}</span>
          <img src={submission.imageUrl} alt="" />
          <div>
            <strong>{submission.title}</strong>
            <p>{displayAuthor(submission)}{showVoteCounts ? ` · 추천 ${submission.voteCount}` : ""}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

function PrivacyPolicy({ onClose }: { onClose: () => void }) {
  return (
    <section className="policy-overlay" role="dialog" aria-modal="true" aria-label="개인정보처리방침" onClick={onClose}>
      <article className="policy-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="policy-header">
          <div>
            <p className="eyebrow">Privacy Policy</p>
            <h2>개인정보처리방침</h2>
            <p>SAF 2026 물리학 유머 콘텐츠 콘테스트 동료 평가 사이트</p>
          </div>
          <button className="policy-close" onClick={onClose} title="닫기" type="button">
            <X size={22} aria-hidden />
          </button>
        </header>
        <div className="policy-content">
          <section>
            <h3>1. 처리 목적</h3>
            <p>
              본 사이트는 참가자 본인 확인, 작품 제출, 동료 추천, 중복 투표 방지, 순위 집계 및 행사 운영 관리를
              위해 필요한 범위에서만 개인정보를 처리합니다.
            </p>
          </section>
          <section>
            <h3>2. 처리 항목</h3>
            <p>
              로그인 시 가온누리 계정 인증 결과로 제공되는 이름, 기수, 학번을 사용합니다. 비밀번호는 KSAIN 로그인
              확인 요청에만 사용되며 사이트 DB에 저장하지 않습니다. 작품 제출 시 작성자 식별값, 제목, 설명, 이미지
              저장 경로, 추천 기록, 생성 시각이 저장됩니다.
            </p>
          </section>
          <section>
            <h3>3. 보관 및 파기</h3>
            <p>
              수집 정보는 행사 운영 기간 동안 보관하고, 행사 종료 후 운영 확인이 끝나면 지체 없이 삭제하는 것을
              원칙으로 합니다. 별도 요청이 있거나 운영상 보관 필요성이 사라진 경우 관리자가 먼저 삭제할 수 있습니다.
            </p>
          </section>
          <section>
            <h3>4. 위탁 및 외부 서비스</h3>
            <p>
              사이트 운영을 위해 Vercel, Vercel Blob, Neon PostgreSQL을 사용할 수 있습니다. 로그인 확인에는 KSAIN
              로그인 API가 사용됩니다. 운영자는 행사 목적 외 광고, 판매, 마케팅 목적으로 개인정보를 이용하지 않습니다.
            </p>
          </section>
          <section>
            <h3>5. 참가자 책임과 게시물 관리</h3>
            <p>
              참가자는 자신이 제출한 이미지와 문구에 대해 필요한 권리를 보유하고 있음을 보증해야 하며, 저작권 침해,
              욕설, 외설, 혐오 표현 등 부적절한 내용으로 발생하는 책임은 제출자에게 있습니다. 운영자는 행사 진행과
              안전한 평가 환경을 위해 부적절한 게시물을 사전 통지 없이 숨기거나 삭제할 수 있습니다.
            </p>
          </section>
          <section>
            <h3>6. 권리 행사</h3>
            <p>
              참가자는 본인 게시물의 삭제를 직접 요청하거나 사이트 기능으로 삭제할 수 있습니다. 개인정보 열람, 정정,
              삭제 요청은 행사 관리자에게 문의해 처리할 수 있습니다.
            </p>
          </section>
        </div>
      </article>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
