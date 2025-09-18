// src/App.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User,
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  DocumentData,
} from 'firebase/firestore'
import { firebaseConfig } from './firebaseConfig'

// ---- Types ----
interface Member { id: string; name: string; initials?: string }
interface Subtask { id: string; title: string; done: boolean }
interface Task {
  id: string
  title: string
  notes?: string
  assignees: string[]
  subtasks: Subtask[]
  createdAt?: any
  dueDate?: Timestamp | null
}

// ---- Firebase init ----
const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)
const PROJECT_ID = 'default' // single project MVP
const ENABLE_RESET = import.meta.env.VITE_ENABLE_RESET === 'true';

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [team, setTeam] = useState<Member[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  // --- Auth state ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u))
    return unsub
  }, [])

  // --- Ensure project, seed team (once), subscribe to changes ---
  useEffect(() => {
    if (!user) return
    let unsubTasks: (() => void) | undefined
    let unsubTeam: (() => void) | undefined

      ; (async () => {
        // Ensure project doc
        await setDoc(
          doc(db, 'projects', PROJECT_ID),
          { name: 'Auric Lanka – Event Planner' },
          { merge: true }
        )

        // Seed team if empty (YOUR team)
        const teamCol = collection(db, 'projects', PROJECT_ID, 'team')
        const snap = await getDocs(teamCol)
        if (snap.empty) {
          const defaultTeam: Member[] = [
            { id: 'rusiru', name: 'Rusiru', initials: 'RK' },
            { id: 'rico', name: 'Rico', initials: 'RI' },
            { id: 'sameera', name: 'Sameera', initials: 'SA' },
            { id: 'bhashitha', name: 'Bhashitha', initials: 'BH' },
            { id: 'lakshi', name: 'Lakshi', initials: 'LA' },
            { id: 'mb', name: 'MB', initials: 'MB' },
          ]
          await Promise.all(defaultTeam.map((m) => setDoc(doc(teamCol, m.id), m, { merge: true })))
        }

        // Subscribe team
        unsubTeam = onSnapshot(collection(db, 'projects', PROJECT_ID, 'team'), (qs) => {
          const members: Member[] = qs.docs.map((d) => d.data() as Member)
          setTeam(members)
        })

        // Subscribe tasks (ordered by createdAt)
        const tasksQ = query(collection(db, 'projects', PROJECT_ID, 'tasks'), orderBy('createdAt', 'asc'))
        unsubTasks = onSnapshot(tasksQ, (qs) => {
          const list: Task[] = qs.docs.map((d) => {
            const data = d.data() as DocumentData
            return {
              id: d.id,
              title: data.title || '',
              notes: data.notes || '',
              assignees: (data.assignees || []) as string[],
              subtasks: (data.subtasks || []) as Subtask[],
              createdAt: data.createdAt,
              dueDate: (data.dueDate ?? null) as Timestamp | null,
            }
          })
          setTasks(list)
          setLoading(false)
        })
      })()

    return () => {
      if (unsubTasks) unsubTasks()
      if (unsubTeam) unsubTeam()
    }
  }, [user])

  // ---- Helpers ----
  const memberById = (id: string) => team.find((m) => m.id === id)

  const computeProgress = (t: Task) => {
    const total = t?.subtasks?.length || 0
    if (!total) return 0
    const done = t.subtasks.filter((s) => s.done).length
    return Math.round((done / total) * 100)
  }

  const taskStatus = (t: Task) => {
    const p = computeProgress(t)
    if (p === 100) return { label: 'Done', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
    if (p > 0) return { label: 'In Progress', tone: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
    return { label: 'Not Started', tone: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
  }

  // YYYY-MM-DD for <input type="date">
  const toInputDate = (ts?: Timestamp | null) =>
    ts ? ts.toDate().toISOString().slice(0, 10) : ''

  const daysLeft = (ts?: Timestamp | null) => {
    if (!ts) return null
    const d = ts.toDate()
    const today = new Date()
    d.setHours(0, 0, 0, 0); today.setHours(0, 0, 0, 0)
    return Math.ceil((d.getTime() - today.getTime()) / 86400000)
  }

  const setDueDate = async (taskId: string, dateStr: string) => {
    const date = dateStr ? new Date(`${dateStr}T00:00:00`) : null
    await updateDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId), {
      dueDate: date ? Timestamp.fromDate(date) : null,
    })
  }

  const inDays = (n: number) => Timestamp.fromDate(new Date(Date.now() + n * 86400000))

  const filteredTasks = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) =>
      [t.title, t.notes, ...(t.subtasks || []).map((s) => s.title)].some((v) => v?.toLowerCase().includes(q))
    )
  }, [tasks, filter])

  // ---- Drag & drop assign ----
  const onDragStartMember = (e: React.DragEvent<HTMLDivElement>, memberId: string) => {
    e.dataTransfer.setData('text/plain', memberId)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const onDropAssign = async (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.preventDefault()
    const memberId = e.dataTransfer.getData('text/plain')
    if (!memberId) return
    const current = tasks.find((x) => x.id === taskId)
    const nextAssignees = Array.from(new Set([...(current?.assignees || []), memberId]))
    await updateDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId), { assignees: nextAssignees })
  }

  // ---- CRUD: tasks & subtasks ----
  const addTask = async (title: string) => {
    if (!title.trim()) return
    await addDoc(collection(db, 'projects', PROJECT_ID, 'tasks'), {
      title: title.trim(),
      notes: '',
      assignees: [],
      subtasks: [],
      createdAt: serverTimestamp(),
      dueDate: null,
    })
  }

  const deleteTask = async (taskId: string) => {
    await deleteDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId))
  }

  const addSubtask = async (taskId: string, title: string) => {
    if (!title.trim()) return
    const t = tasks.find((x) => x.id === taskId)
    const next = [...(t?.subtasks || []), { id: uid(), title: title.trim(), done: false }]
    await updateDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId), { subtasks: next })
  }

  const toggleSubtask = async (taskId: string, subId: string) => {
    const t = tasks.find((x) => x.id === taskId)
    if (!t) return
    const next = (t.subtasks || []).map((s) => (s.id === subId ? { ...s, done: !s.done } : s))
    await updateDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId), { subtasks: next })
  }

  const removeAssignee = async (taskId: string, memberId: string) => {
    const t = tasks.find((x) => x.id === taskId)
    const next = (t?.assignees || []).filter((a) => a !== memberId)
    await updateDoc(doc(db, 'projects', PROJECT_ID, 'tasks', taskId), { assignees: next })
  }

  const resetDemo = async () => {
    if (!ENABLE_RESET) return
    // Clear tasks
    const qs = await getDocs(collection(db, 'projects', PROJECT_ID, 'tasks'))
    await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)))
    // Seed two tasks with due dates
    await addDoc(collection(db, 'projects', PROJECT_ID, 'tasks'), {
      title: 'Marketing',
      notes: 'Content + sponsors outreach',
      assignees: ['rusiru'],
      subtasks: [
        { id: 'fb', title: 'Post promo video on Facebook', done: false },
        { id: 'tiktok', title: 'Post vertical clip on TikTok', done: false },
        { id: 'ig', title: 'Post carousel on Instagram', done: false },
        { id: 'sponsors', title: 'Meeting with Sponsors', done: false },
      ],
      createdAt: serverTimestamp(),
      dueDate: inDays(7),
    })
    await addDoc(collection(db, 'projects', PROJECT_ID, 'tasks'), {
      title: 'Stage & AV',
      notes: 'Lighting, sound check, run sheet',
      assignees: ['sameera'],
      subtasks: [
        { id: 'av', title: 'Confirm AV vendor', done: true },
        { id: 'lights', title: 'Lighting plot draft', done: false },
        { id: 'sound', title: 'Band soundcheck schedule', done: false },
      ],
      createdAt: serverTimestamp(),
      dueDate: inDays(2),
    })
  }

  // ---- UI bits ----
  const Badge: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${className}`}>{children}</span>
  )

  const Avatar: React.FC<{ name?: string; initials?: string }> = ({ name, initials }) => (
    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/15 grid place-items-center text-xs font-semibold">
      {initials || name?.[0]?.toUpperCase() || '?'}
    </div>
  )

  const MemberPill: React.FC<{ member: Member; draggable?: boolean }> = ({ member, draggable = false }) => (
    <div
      className="flex items-center gap-2 px-2.5 py-1 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition cursor-grab select-none"
      draggable={draggable}
      onDragStart={(e) => draggable && onDragStartMember(e, member.id)}
      aria-grabbed={false}
      role={draggable ? 'button' : undefined}
      title={draggable ? 'Drag onto a task to assign' : member.name}
    >
      <Avatar name={member.name} initials={member.initials} />
      <span className="text-sm">{member.name}</span>
    </div>
  )

  const ProgressBar: React.FC<{ value: number }> = ({ value }) => {
    // Turn the bar reddish if overdue & not complete
    const cls = value === 100 ? 'from-emerald-400/90 to-teal-300/90' : 'from-emerald-400/90 to-teal-300/90'
    return (
      <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full bg-gradient-to-r ${cls}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    )
  }

  const SignInControls: React.FC = () => (
    <div className="flex items-center gap-2">
      {user ? (
        <>
          <span className="text-xs text-neutral-400 hidden sm:inline">{user.isAnonymous ? 'Guest' : user.displayName || user.email}</span>
          <button onClick={() => signOut(auth)} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10">Sign out</button>
        </>
      ) : (
        <>
          <button
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}
            className="px-3 py-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-neutral-900 text-sm font-medium"
          >
            Sign in with Google
          </button>
          <button
            onClick={() => signInAnonymously(auth)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10"
          >
            Continue as guest
          </button>
        </>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/10 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-400 to-emerald-400 grid place-items-center font-bold text-neutral-900">ALE</div> */}
            <img
  src={import.meta.env.BASE_URL + 'hadagasma-logo.jpg'}
  alt="HADAGASMA"
  className="w-10 h-10 rounded-xl object-cover border border-white/10 shadow"
  loading="eager"
/>

            <div>
              <h1 className="text-lg font-semibold leading-tight">HADAGASMA UNPLUGGED CONCERT - PLANNER</h1>
              <p className="text-xs text-neutral-400">Drag teammates onto tasks • Progress + Deadlines</p>
            </div>
          </div>
          <SignInControls />
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 md:grid-cols-[280px,1fr] gap-6">
        {/* Team */}
        <aside className="md:sticky md:top-[60px] h-fit">
          <div className="p-4 rounded-2xl border border-white/10 bg-white/5 shadow-inner">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-300">Team</h2>
              <span className="text-xs text-neutral-400">Drag to assign</span>
            </div>
            <div className="space-y-2">
              {team.map((m) => <MemberPill key={m.id} member={m} draggable={!!user} />)}
            </div>
          </div>

          <QuickAddTask onAdd={addTask} disabled={!user} />

          <div className="mt-3 text-xs text-neutral-500">
            {user ? <span>Signed in {user.isAnonymous ? 'as Guest' : ''}. Your changes sync in real time.</span> : <span>Sign in to create and edit tasks.</span>}
          </div>
        </aside>

        {/* Tasks */}
        <section className="space-y-4">
          {/* Search + Reset */}
          <div className="flex items-center gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search tasks or subtasks..."
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
            />
            <button
              onClick={resetDemo}
              className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10 disabled:opacity-50"
              disabled={!user || !ENABLE_RESET}
              title={ENABLE_RESET ? "Reset demo" : "Disabled in production"}
            >
              Reset demo
            </button>
          </div>

          {loading && (
            <div className="p-6 rounded-2xl border border-white/10 bg-white/5 text-neutral-300">Loading…</div>
          )}

          {!loading && filteredTasks.length === 0 && (
            <div className="p-6 rounded-2xl border border-white/10 bg-white/5 text-neutral-300">No tasks yet. Add your first task.</div>
          )}

          {!loading && filteredTasks.map((t) => {
            const status = taskStatus(t)
            const progress = computeProgress(t)
            const dleft = daysLeft(t.dueDate)
            const overdue = dleft !== null && dleft < 0 && progress < 100

            return (
              <div
                key={t.id}
                className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.03] p-4 shadow-lg"
                onDragOver={(e) => user && e.preventDefault()}
                onDrop={(e) => user && onDropAssign(e, t.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">{t.title}</h3>
                      <Badge className={status.tone}>{status.label}</Badge>
                      {t.dueDate && (
                        <Badge className={overdue ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-sky-500/15 text-sky-300 border-sky-500/30'}>
                          {overdue ? `Overdue ${Math.abs(dleft!)}d` : `Due in ${dleft}d`}
                        </Badge>
                      )}
                    </div>
                    {t.notes && <p className="text-sm text-neutral-400 mt-1">{t.notes}</p>}

                    {/* Deadline editor */}
                    <div className="mt-2 flex items-center gap-2">
                      <label className="text-xs text-neutral-400">Deadline:</label>
                      <input
                        type="date"
                        value={toInputDate(t.dueDate)}
                        onChange={(e) => user && setDueDate(t.id, e.target.value)}
                        className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-sm"
                        disabled={!user}
                      />
                      {t.dueDate && (
                        <span className="text-xs text-neutral-400">
                          ({new Date(t.dueDate.toDate()).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    className="text-xs text-neutral-400 hover:text-red-300"
                    title="Delete task"
                    onClick={() => user && deleteTask(t.id)}
                    disabled={!user}
                  >
                    ×
                  </button>
                </div>

                {/* Assignees */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {(!t.assignees || t.assignees.length === 0) && (
                    <span className="text-xs text-neutral-400">Drop teammates here to assign</span>
                  )}
                  {(t.assignees || []).map((id) => {
                    const m = memberById(id)
                    if (!m) return null
                    return (
                      <div key={id} className="flex items-center gap-2 px-2 py-1 rounded-xl bg-white/5 border border-white/10">
                        <Avatar name={m.name} initials={m.initials} />
                        <span className="text-sm">{m.name}</span>
                        <button
                          className="text-xs text-neutral-400 hover:text-red-300"
                          onClick={() => user && removeAssignee(t.id, id)}
                          title="Remove"
                          disabled={!user}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Progress */}
                <div className="mt-4 flex items-center gap-3">
                  <ProgressBar value={progress} />
                  <span className="text-sm tabular-nums w-12 text-right">{progress}%</span>
                </div>

                {/* Subtasks */}
                <div className="mt-4">
                  <h4 className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Subtasks</h4>
                  <div className="space-y-2">
                    {(t.subtasks || []).map((s) => (
                      <label key={s.id} className="flex items-center gap-3 p-2 rounded-xl bg-white/[0.03] border border-white/10">
                        <input
                          type="checkbox"
                          checked={!!s.done}
                          onChange={() => user && toggleSubtask(t.id, s.id)}
                          className="accent-emerald-400 w-4 h-4"
                          disabled={!user}
                        />
                        <span className={`text-sm ${s.done ? 'line-through text-neutral-400' : ''}`}>{s.title}</span>
                      </label>
                    ))}
                    {(!t.subtasks || t.subtasks.length === 0) && (
                      <div className="text-sm text-neutral-400">No subtasks. Add one below.</div>
                    )}
                  </div>
                  <QuickAddSubtask onAdd={(txt) => addSubtask(t.id, txt)} disabled={!user} />
                </div>
              </div>
            )
          })}
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-4 pb-10 text-neutral-500 text-xs">
        <div className="mt-6 border-t border-white/10 pt-4 flex flex-wrap items-center justify-between gap-2">
          <span>Firebase: Auth + Firestore realtime • Drag-and-drop assignees • Deadlines • Auto progress</span>
          <span>Next: Kanban, comments, roles, notifications</span>
        </div>
      </footer>
    </div>
  )
}

function QuickAddTask({ onAdd, disabled }: { onAdd: (v: string) => void; disabled?: boolean }) {
  const [val, setVal] = useState('')
  return (
    <div className="mt-4 p-4 rounded-2xl border border-white/10 bg-white/5">
      <h3 className="text-sm font-semibold mb-2">Add Task</h3>
      <div className="flex items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled) {
              onAdd(val)
              setVal('')
            }
          }}
          placeholder="e.g., Venue booking"
          className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
          disabled={!!disabled}
        />
        <button
          onClick={() => { if (!disabled) { onAdd(val); setVal('') } }}
          className="px-3 py-2 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 text-neutral-900 text-sm font-medium disabled:opacity-50"
          disabled={!!disabled}
        >Add</button>
      </div>
    </div>
  )
}

function QuickAddSubtask({ onAdd, disabled }: { onAdd: (v: string) => void; disabled?: boolean }) {
  const [val, setVal] = useState('')
  return (
    <div className="mt-3 flex items-center gap-2">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !disabled) { onAdd(val); setVal('') } }}
        placeholder="Add a subtask and hit Enter"
        className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
        disabled={!!disabled}
      />
      <button
        onClick={() => { if (!disabled) { onAdd(val); setVal('') } }}
        className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm hover:bg-white/10 disabled:opacity-50"
        disabled={!!disabled}
      >Add</button>
    </div>
  )
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}
