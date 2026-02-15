"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { BubbleTour, TourStep } from "@/app/app/_components/BubbleTour";

type JournalEntry = {
  id: string;
  journal_type: "patient" | "carer";
  content: string | null;
  shared_to_circle: boolean;
  include_in_clinician_summary: boolean;
  mood: "very_sad" | "sad" | "neutral" | "happy" | "very_happy" | null;
  pain_level: number | null;
  created_at: string;
  created_by: string | null;
};

type Medication = {
  id: string;
  name: string;
  dosage: string | null;
  active: boolean;
  created_at: string;

  schedule_morning: boolean;
  schedule_midday: boolean;
  schedule_evening: boolean;
  schedule_bedtime: boolean;
  schedule_prn: boolean;
};

type MedLog = {
  medication_id: string;
  status: "taken" | "missed";
  slot: "morning" | "midday" | "evening" | "bedtime" | "prn" | null;
  created_at: string;
};

type Slot = "morning" | "midday" | "evening" | "bedtime" | "prn";

type PatientProfile = {
  patient_id: string;
  guardian_setup: boolean;
  speaks: boolean | null;
  communication_methods: string | null;
  languages_understood: string | null;
  preferred_language: string | null;
  allergies: string | null;
  panic_triggers: string | null;
  calming_strategies: string | null;
  important_notes: string | null;

  has_health_poa: boolean | null;
  has_respect_letter: boolean | null;
  health_poa_held_by: string | null;
  respect_letter_held_by: string | null;

  updated_at: string;
};

type Diagnosis = {
  id: string;
  patient_id: string;
  diagnosis: string;
  diagnosed_on: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

type CircleComment = {
  id: string;
  entry_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

type PinRow = {
  entry_id: string;
  pinned_at: string;
  pinned_by: string;
};

type MemberRow = {
  user_id: string;
  role: string;
};

type Appointment = {
  id: string;
  patient_id: string;
  starts_at: string;
  ends_at: string | null;
  title: string;
  location: string | null;
  provider: string | null;
  notes: string | null;
  status: "scheduled" | "attended" | "cancelled";
  created_by: string;
  created_at: string;
};

type MoodKey = NonNullable<JournalEntry["mood"]>;

type Status =
  | { kind: "idle" }
  | { kind: "loading"; msg: string }
  | { kind: "ok"; msg: string }
  | { kind: "error"; msg: string };

type Perms = Record<string, boolean>;

const SLOTS: Slot[] = ["morning", "midday", "evening", "bedtime", "prn"];

function appBaseFromPathname(pathname: string) {
  if (pathname.startsWith("/app/app/") || pathname === "/app/app") return "/app/app";
  if (pathname.startsWith("/app/") || pathname === "/app") return "/app";
  return "";
}

function humanRole(role: string | null | undefined) {
  const r = (role ?? "").toLowerCase();
  if (!r) return "Circle member";
  if (r === "family") return "Family";
  if (r === "carer") return "Carer / support";
  if (r === "support_worker") return "Carer / support";
  if (r === "professional") return "Professional support";
  if (r === "professional_support") return "Professional support";
  if (r === "clinician") return "Clinician";
  if (r === "owner") return "Patient / Guardian";
  if (r === "guardian") return "Legal guardian";
  if (r === "legal_guardian") return "Legal guardian";
  if (r === "patient") return "Patient";
  return role!;
}

function fmtDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function yesNoUnknown(v: boolean | null | undefined) {
  if (v === null || typeof v === "undefined") return "Not specified";
  return v ? "Yes" : "No";
}

function cleanText(s: string) {
  return s.trim();
}

function dtLocalToIso(dtLocal: string) {
  const d = new Date(dtLocal);
  return d.toISOString();
}

export default function PatientPage() {
  const params = useParams();
  const patientId = String(params?.id ?? "");

  const router = useRouter();
  const searchParams = useSearchParams();

  const base = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return appBaseFromPathname(window.location.pathname);
  }, []);

  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);

  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("…");
  const [perms, setPerms] = useState<Perms | null>(null);

  const moodEmoji: Record<MoodKey, string> = {
    very_sad: "😢",
    sad: "🙁",
    neutral: "😐",
    happy: "🙂",
    very_happy: "😄",
  };

  const slotLabel: Record<Slot, string> = {
    morning: "Morning",
    midday: "Midday",
    evening: "Evening",
    bedtime: "Bedtime",
    prn: "As needed",
  };

  // Tabs (filtered by permission later)
  const [tab, setTab] = useState<"overview" | "meds" | "journals" | "appointments">("overview");

  // Overview: invite creation
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"family" | "carer" | "professional">("family");
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  // Overview: care profile
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // Profile form fields
  const [guardianSetup, setGuardianSetup] = useState(false);
  const [speaks, setSpeaks] = useState<boolean | null>(null);
  const [communicationMethods, setCommunicationMethods] = useState("");
  const [languagesUnderstood, setLanguagesUnderstood] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [allergies, setAllergies] = useState("");
  const [panicTriggers, setPanicTriggers] = useState("");
  const [calmingStrategies, setCalmingStrategies] = useState("");
  const [importantNotes, setImportantNotes] = useState("");

  const [hasHealthPoa, setHasHealthPoa] = useState<boolean | null>(null);
  const [hasRespectLetter, setHasRespectLetter] = useState<boolean | null>(null);
  const [healthPoaHeldBy, setHealthPoaHeldBy] = useState("");
  const [respectLetterHeldBy, setRespectLetterHeldBy] = useState("");

  // Overview: diagnoses
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [dxName, setDxName] = useState("");
  const [dxDate, setDxDate] = useState("");
  const [dxNotes, setDxNotes] = useState("");

  const [editDxId, setEditDxId] = useState<string | null>(null);
  const [editDxName, setEditDxName] = useState("");
  const [editDxDate, setEditDxDate] = useState("");
  const [editDxNotes, setEditDxNotes] = useState("");
  const [editDxActive, setEditDxActive] = useState(true);

  // Journals: patient entry form
  const [content, setContent] = useState("");
  const [shareToCircle, setShareToCircle] = useState(true);
  const [shareToClinician, setShareToClinician] = useState(false);
  const [mood, setMood] = useState<MoodKey | null>(null);
  const [pain, setPain] = useState<number | null>(null);

  // Circle post box
  const [circlePostText, setCirclePostText] = useState("");
  const [circlePostToClinician, setCirclePostToClinician] = useState(true);

  // Journals: data
  const [patientJournal, setPatientJournal] = useState<JournalEntry[]>([]);
  const [circleEntries, setCircleEntries] = useState<JournalEntry[]>([]);
  const [circleComments, setCircleComments] = useState<Record<string, CircleComment[]>>({});
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [pinsById, setPinsById] = useState<Record<string, PinRow>>({});
  const [memberRoleByUserId, setMemberRoleByUserId] = useState<Record<string, string>>({});
  const [commentDraftByEntry, setCommentDraftByEntry] = useState<Record<string, string>>({});
  const [circleFilter, setCircleFilter] = useState<"all" | "patient_shared" | "circle_only">("all");
  const [circleClinicianOnly, setCircleClinicianOnly] = useState(false);

  // Meds: add form
  const [medName, setMedName] = useState("");
  const [medDosage, setMedDosage] = useState("");
  const [schMorning, setSchMorning] = useState(true);
  const [schMidday, setSchMidday] = useState(false);
  const [schEvening, setSchEvening] = useState(true);
  const [schBedtime, setSchBedtime] = useState(false);
  const [schPrn, setSchPrn] = useState(false);

  // Meds: data
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logsByMedSlot, setLogsByMedSlot] = useState<Record<string, Record<string, MedLog>>>({});

  // Meds: edit state
  const [editMedId, setEditMedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDosage, setEditDosage] = useState("");
  const [editMorning, setEditMorning] = useState(false);
  const [editMidday, setEditMidday] = useState(false);
  const [editEvening, setEditEvening] = useState(false);
  const [editBedtime, setEditBedtime] = useState(false);
  const [editPrn, setEditPrn] = useState(false);
  const [editActive, setEditActive] = useState(true);

  // Appointments
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [apptTitle, setApptTitle] = useState("");
  const [apptStartsAt, setApptStartsAt] = useState("");
  const [apptEndsAt, setApptEndsAt] = useState("");
  const [apptLocation, setApptLocation] = useState("");
  const [apptProvider, setApptProvider] = useState("");
  const [apptNotes, setApptNotes] = useState("");

  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [editApptTitle, setEditApptTitle] = useState("");
  const [editApptStartsAt, setEditApptStartsAt] = useState("");
  const [editApptEndsAt, setEditApptEndsAt] = useState("");
  const [editApptLocation, setEditApptLocation] = useState("");
  const [editApptProvider, setEditApptProvider] = useState("");
  const [editApptNotes, setEditApptNotes] = useState("");
  const [editApptStatus, setEditApptStatus] = useState<"scheduled" | "attended" | "cancelled">("scheduled");

  const can = (key: string) => !!perms?.[key];

  const canProfileView = can("profile_view");
  const canProfileEdit = can("profile_edit");
  const canMedsView = can("meds_view");
  const canMedsEdit = can("meds_edit");
  const canJournalsView = can("journals_view");
  const canPostCircle = can("journals_post_circle");
  const canAppointmentsView = can("appointments_view");
  const canAppointmentsEdit = can("appointments_edit");
  const canSummaryView = can("summary_view");
  const canInvites = can("invites_manage");
  const canPermsManage = can("permissions_manage");

  const allowedTabs = useMemo(() => {
    const t: { key: typeof tab; label: string; allowed: boolean }[] = [
      { key: "overview", label: "Overview", allowed: canProfileView || canSummaryView || canInvites || canPermsManage },
      { key: "meds", label: "Meds", allowed: canMedsView },
      { key: "journals", label: "Journals", allowed: canJournalsView },
      { key: "appointments", label: "Appointments", allowed: canAppointmentsView },
    ];
    return t.filter((x) => x.allowed);
  }, [canProfileView, canSummaryView, canInvites, canPermsManage, canMedsView, canJournalsView, canAppointmentsView, tab]);

  function setPageError(msg: string) {
    setError(msg);
    setStatus({ kind: "error", msg });
  }
  function setOk(msg: string) {
    setError(null);
    setStatus({ kind: "ok", msg });
  }
  function setLoading(msg: string) {
    setError(null);
    setStatus({ kind: "loading", msg });
  }

  async function requireAuth() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      window.location.href = "/";
      return null;
    }
    setAuthedUserId(data.user.id);
    return data.user;
  }

  // ✅ FIX: set tab state + URL using Next router, and respond to URL changes
  function setTabAndUrl(next: typeof tab) {
    setTab(next);
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.set("tab", next);
    router.replace(`${base}/patients/${patientId}?${sp.toString()}`);
  }

  // ✅ FIX: if navigation happens via Link, keep local state in sync
  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t === "overview" || t === "meds" || t === "journals" || t === "appointments") {
      setTab(t);
    }
  }, [searchParams]);

  // -----------------------
  // Membership + perms
  // -----------------------
  async function loadPatient() {
    const { data, error } = await supabase.from("patients").select("display_name").eq("id", patientId).single();
    if (error) return setPageError(error.message);
    setPatientName(data.display_name);
  }

  async function loadMyRole() {
    const user = await requireAuth();
    if (!user) return;

    const { data, error } = await supabase
      .from("patient_members")
      .select("role")
      .eq("patient_id", patientId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return setPageError(error.message);
    setMyRole((data as any)?.role ?? null);
  }

  async function loadEffectivePerms() {
    const r = await supabase.rpc("permissions_effective", { pid: patientId });
    if (r.error) return setPageError(r.error.message);
    setPerms((r.data ?? {}) as Perms);
  }

  async function loadMemberRoles() {
    const q = await supabase.from("patient_members").select("user_id,role").eq("patient_id", patientId);
    if (q.error) return setPageError(q.error.message);

    const map: Record<string, string> = {};
    for (const r of (q.data ?? []) as MemberRow[]) map[r.user_id] = r.role;
    setMemberRoleByUserId(map);
  }

  // -----------------------
  // Care profile
  // -----------------------
  function hydrateProfileForm(p: PatientProfile) {
    setGuardianSetup(!!p.guardian_setup);
    setSpeaks(p.speaks === null ? null : !!p.speaks);
    setCommunicationMethods(p.communication_methods ?? "");
    setLanguagesUnderstood(p.languages_understood ?? "");
    setPreferredLanguage(p.preferred_language ?? "");
    setAllergies(p.allergies ?? "");
    setPanicTriggers(p.panic_triggers ?? "");
    setCalmingStrategies(p.calming_strategies ?? "");
    setImportantNotes(p.important_notes ?? "");
    setHasHealthPoa(p.has_health_poa ?? null);
    setHasRespectLetter(p.has_respect_letter ?? null);
    setHealthPoaHeldBy(p.health_poa_held_by ?? "");
    setRespectLetterHeldBy(p.respect_letter_held_by ?? "");
  }

  async function loadProfile() {
    const { data, error } = await supabase
      .from("patient_profiles")
      .select(
        "patient_id,guardian_setup,speaks,communication_methods,languages_understood,preferred_language,allergies,panic_triggers,calming_strategies,important_notes,has_health_poa,has_respect_letter,health_poa_held_by,respect_letter_held_by,updated_at"
      )
      .eq("patient_id", patientId)
      .maybeSingle();

    if (error) return setPageError(error.message);

    const p = (data ?? null) as PatientProfile | null;
    setProfile(p);

    if (p) hydrateProfileForm(p);
    else {
      setGuardianSetup(false);
      setSpeaks(null);
      setCommunicationMethods("");
      setLanguagesUnderstood("");
      setPreferredLanguage("");
      setAllergies("");
      setPanicTriggers("");
      setCalmingStrategies("");
      setImportantNotes("");
      setHasHealthPoa(null);
      setHasRespectLetter(null);
      setHealthPoaHeldBy("");
      setRespectLetterHeldBy("");
    }
  }

  async function saveProfile() {
    const user = await requireAuth();
    if (!user) return;

    if (!canProfileEdit) return setPageError("You don’t have permission to edit the care profile.");

    // If yes, require held-by
    if (hasHealthPoa === true && !cleanText(healthPoaHeldBy)) {
      return setPageError('Health POA is marked "Yes" — please fill in "Held by?".');
    }
    if (hasRespectLetter === true && !cleanText(respectLetterHeldBy)) {
      return setPageError('RESPECT letter is marked "Yes" — please fill in "Held by?".');
    }

    setLoading("Saving care profile…");

    const { error } = await supabase.rpc("upsert_patient_profile", {
      p_patient_id: patientId,
      p_guardian_setup: guardianSetup,
      p_speaks: speaks,
      p_communication_methods: cleanText(communicationMethods) || null,
      p_languages_understood: cleanText(languagesUnderstood) || null,
      p_preferred_language: cleanText(preferredLanguage) || null,
      p_allergies: cleanText(allergies) || null,
      p_panic_triggers: cleanText(panicTriggers) || null,
      p_calming_strategies: cleanText(calmingStrategies) || null,
      p_important_notes: cleanText(importantNotes) || null,
      p_has_health_poa: hasHealthPoa,
      p_has_respect_letter: hasRespectLetter,
      p_health_poa_held_by: hasHealthPoa === true ? cleanText(healthPoaHeldBy) : null,
      p_respect_letter_held_by: hasRespectLetter === true ? cleanText(respectLetterHeldBy) : null,
    });

    if (error) return setPageError(error.message);

    setProfileOpen(false);
    await loadProfile();
    setOk("Profile saved ✅");
  }

  const profileComplete = useMemo(() => {
    if (!profile) return false;
    const any =
      profile.speaks !== null ||
      !!profile.communication_methods ||
      !!profile.languages_understood ||
      !!profile.preferred_language ||
      !!profile.allergies ||
      !!profile.panic_triggers ||
      !!profile.calming_strategies ||
      !!profile.important_notes ||
      profile.has_health_poa !== null ||
      profile.has_respect_letter !== null ||
      !!profile.health_poa_held_by ||
      !!profile.respect_letter_held_by;
    return any;
  }, [profile]);

  // -----------------------
  // Diagnoses (gated under profile_view / profile_edit)
  // -----------------------
  async function loadDiagnoses() {
    const q = await supabase
      .from("patient_diagnoses")
      .select("id,patient_id,diagnosis,diagnosed_on,notes,active,created_at")
      .eq("patient_id", patientId)
      .order("active", { ascending: false })
      .order("diagnosed_on", { ascending: false })
      .order("created_at", { ascending: false });

    if (q.error) return setPageError(q.error.message);
    setDiagnoses((q.data ?? []) as Diagnosis[]);
  }

  async function addDiagnosis() {
    const user = await requireAuth();
    if (!user) return;
    if (!canProfileEdit) return setPageError("You don’t have permission to edit diagnoses.");

    const name = dxName.trim();
    if (!name) return setPageError("Diagnosis name is required.");

    setLoading("Adding diagnosis…");

    const diagnosed_on = dxDate.trim() ? dxDate.trim() : null;

    const { error } = await supabase.rpc("add_diagnosis", {
      p_patient_id: patientId,
      p_diagnosis: name,
      p_diagnosed_on: diagnosed_on,
      p_notes: cleanText(dxNotes) || null,
    });

    if (error) return setPageError(error.message);

    setDxName("");
    setDxDate("");
    setDxNotes("");
    await loadDiagnoses();
    setOk("Diagnosis added ✅");
  }

  function startEditDx(d: Diagnosis) {
    if (!canProfileEdit) return;
    setEditDxId(d.id);
    setEditDxName(d.diagnosis);
    setEditDxDate(d.diagnosed_on ?? "");
    setEditDxNotes(d.notes ?? "");
    setEditDxActive(!!d.active);
  }

  function cancelEditDx() {
    setEditDxId(null);
  }

  async function saveEditDx() {
    const user = await requireAuth();
    if (!user) return;
    if (!canProfileEdit) return setPageError("You don’t have permission to edit diagnoses.");

    if (!editDxId) return setPageError("No diagnosis selected.");
    const name = editDxName.trim();
    if (!name) return setPageError("Diagnosis name is required.");

    setLoading("Saving diagnosis…");

    const diagnosed_on = editDxDate.trim() ? editDxDate.trim() : null;

    const { error } = await supabase.rpc("update_diagnosis", {
      p_patient_id: patientId,
      p_id: editDxId,
      p_diagnosis: name,
      p_diagnosed_on: diagnosed_on,
      p_notes: cleanText(editDxNotes) || null,
      p_active: editDxActive,
    });

    if (error) return setPageError(error.message);

    setEditDxId(null);
    await loadDiagnoses();
    setOk("Diagnosis updated ✅");
  }

  async function toggleDxActive(d: Diagnosis) {
    const user = await requireAuth();
    if (!user) return;
    if (!canProfileEdit) return setPageError("You don’t have permission to edit diagnoses.");

    setLoading("Updating diagnosis…");

    const { error } = await supabase.rpc("update_diagnosis", {
      p_patient_id: patientId,
      p_id: d.id,
      p_diagnosis: d.diagnosis,
      p_diagnosed_on: d.diagnosed_on,
      p_notes: d.notes,
      p_active: !d.active,
    });

    if (error) return setPageError(error.message);
    await loadDiagnoses();
    setOk("Updated ✅");
  }

  async function deleteDx(d: Diagnosis) {
    const user = await requireAuth();
    if (!user) return;
    if (!canProfileEdit) return setPageError("You don’t have permission to edit diagnoses.");

    const ok = window.confirm(`Delete diagnosis "${d.diagnosis}"?`);
    if (!ok) return;

    setLoading("Deleting diagnosis…");

    const { error } = await supabase.rpc("delete_diagnosis", {
      p_patient_id: patientId,
      p_id: d.id,
    });

    if (error) return setPageError(error.message);
    await loadDiagnoses();
    setOk("Deleted ✅");
  }

  // -----------------------
  // Journals
  // -----------------------
  async function loadPatientJournal() {
    const pj = await supabase
      .from("journal_entries")
      .select("id,journal_type,content,shared_to_circle,include_in_clinician_summary,mood,pain_level,created_at,created_by")
      .eq("patient_id", patientId)
      .eq("journal_type", "patient")
      .order("created_at", { ascending: false });

    if (pj.error) return setPageError(pj.error.message);
    setPatientJournal((pj.data ?? []) as JournalEntry[]);
  }

  async function loadCircleFeed() {
    const feed = await supabase
      .from("journal_entries")
      .select("id,journal_type,content,shared_to_circle,include_in_clinician_summary,mood,pain_level,created_at,created_by")
      .eq("patient_id", patientId)
      .or("journal_type.eq.carer,and(journal_type.eq.patient,shared_to_circle.eq.true)")
      .order("created_at", { ascending: false });

    if (feed.error) return setPageError(feed.error.message);

    const entries = (feed.data ?? []) as JournalEntry[];
    setCircleEntries(entries);

    const pins = await supabase.from("journal_pins").select("entry_id,pinned_at,pinned_by").eq("patient_id", patientId);
    if (pins.error) return setPageError(pins.error.message);

    const pinSet = new Set<string>();
    const pinMap: Record<string, PinRow> = {};
    for (const p of (pins.data ?? []) as PinRow[]) {
      pinSet.add(p.entry_id);
      pinMap[p.entry_id] = p;
    }
    setPinnedIds(pinSet);
    setPinsById(pinMap);

    const comments = await supabase
      .from("journal_comments")
      .select("id,entry_id,user_id,content,created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (comments.error) return setPageError(comments.error.message);

    const grouped: Record<string, CircleComment[]> = {};
    for (const c of (comments.data ?? []) as CircleComment[]) {
      if (!grouped[c.entry_id]) grouped[c.entry_id] = [];
      grouped[c.entry_id].push(c);
    }
    setCircleComments(grouped);
  }

  async function addPatientEntry() {
    const user = await requireAuth();
    if (!user) return;

    const text = content.trim();
    const hasSomething = text.length > 0 || mood !== null || pain !== null;
    if (!hasSomething) return setPageError("Add a note, mood, or pain level before saving.");

    setLoading("Saving patient entry…");

    const { error } = await supabase.rpc("add_patient_journal_entry_v3", {
      p_patient_id: patientId,
      p_content: text.length ? text : null,
      p_share: shareToCircle,
      p_mood: mood,
      p_pain: pain,
      p_clinician: shareToClinician,
    });

    if (error) return setPageError(error.message);

    setContent("");
    setMood(null);
    setPain(null);
    setShareToClinician(false);

    await loadPatientJournal();
    await loadCircleFeed();
    setOk("Entry saved ✅");
  }

  const canPostToCircleDirectly = useMemo(() => {
    return (myRole ?? "").toLowerCase() !== "patient" && canPostCircle;
  }, [myRole, canPostCircle]);

  async function addCircleEntry() {
    const user = await requireAuth();
    if (!user) return;

    if (!canPostCircle) return setPageError("You don’t have permission to post to the circle.");
    if ((myRole ?? "").toLowerCase() === "patient") {
      return setPageError("Patients can’t post directly to the circle. Use your patient journal and tick “Share to circle”.");
    }

    const text = circlePostText.trim();
    if (!text) return setPageError("Write a circle update before posting.");

    setLoading("Posting circle update…");

    const { error } = await supabase.rpc("add_circle_entry", {
      p_patient_id: patientId,
      p_content: text,
      p_clinician: circlePostToClinician,
    });

    if (error) return setPageError(error.message);

    setCirclePostText("");
    setCirclePostToClinician(true);
    await loadCircleFeed();
    setOk("Posted ✅");
  }

  async function pinEntry(entryId: string) {
    const user = await requireAuth();
    if (!user) return;
    if (!canPostCircle) return setPageError("You don’t have permission to manage circle items.");

    setLoading("Pinning…");

    const { error } = await supabase.from("journal_pins").insert({
      entry_id: entryId,
      patient_id: patientId,
      pinned_by: user.id,
    });

    if (error) return setPageError(error.message);
    await loadCircleFeed();
    setOk("Pinned ✅");
  }

  async function unpinEntry(entryId: string) {
    const user = await requireAuth();
    if (!user) return;
    if (!canPostCircle) return setPageError("You don’t have permission to manage circle items.");

    setLoading("Unpinning…");

    const { error } = await supabase.from("journal_pins").delete().eq("entry_id", entryId);

    if (error) return setPageError(error.message);
    await loadCircleFeed();
    setOk("Unpinned ✅");
  }

  async function addComment(entryId: string) {
    const user = await requireAuth();
    if (!user) return;
    if (!canPostCircle) return setPageError("You don’t have permission to comment.");

    const text = (commentDraftByEntry[entryId] ?? "").trim();
    if (!text) return;

    setLoading("Sending comment…");

    const { error } = await supabase.from("journal_comments").insert({
      patient_id: patientId,
      entry_id: entryId,
      user_id: user.id,
      content: text,
    });

    if (error) return setPageError(error.message);

    setCommentDraftByEntry((prev) => ({ ...prev, [entryId]: "" }));
    await loadCircleFeed();
    setOk("Comment added ✅");
  }

  async function deleteMyComment(comment: CircleComment) {
    const user = await requireAuth();
    if (!user) return;
    if (!canPostCircle) return setPageError("You don’t have permission to manage comments.");
    if (comment.user_id !== user.id) return;

    const ok = window.confirm("Delete this comment?");
    if (!ok) return;

    setLoading("Deleting comment…");

    const { error } = await supabase.from("journal_comments").delete().eq("id", comment.id);

    if (error) return setPageError(error.message);
    await loadCircleFeed();
    setOk("Deleted ✅");
  }

  // -----------------------
  // Meds
  // -----------------------
  function scheduledSlots(m: Medication): Slot[] {
    const slots: Slot[] = [];
    if (m.schedule_morning) slots.push("morning");
    if (m.schedule_midday) slots.push("midday");
    if (m.schedule_evening) slots.push("evening");
    if (m.schedule_bedtime) slots.push("bedtime");
    if (m.schedule_prn) slots.push("prn");
    return slots;
  }

  async function loadMeds() {
    const m = await supabase
      .from("medications")
      .select("id,name,dosage,active,created_at,schedule_morning,schedule_midday,schedule_evening,schedule_bedtime,schedule_prn")
      .eq("patient_id", patientId)
      .order("active", { ascending: false })
      .order("created_at", { ascending: false });

    if (m.error) return setPageError(m.error.message);
    setMeds((m.data ?? []) as Medication[]);

    const logs = await supabase
      .from("medication_logs")
      .select("medication_id,status,slot,created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (logs.error) return setPageError(logs.error.message);

    const map: Record<string, Record<string, MedLog>> = {};
    for (const row of (logs.data ?? []) as MedLog[]) {
      const slot = row.slot ?? "unslotted";
      if (!map[row.medication_id]) map[row.medication_id] = {};
      if (!map[row.medication_id][slot]) map[row.medication_id][slot] = row;
    }
    setLogsByMedSlot(map);
  }

  async function addMedication() {
    const user = await requireAuth();
    if (!user) return;
    if (!canMedsEdit) return setPageError("You don’t have permission to edit medications.");

    const name = medName.trim();
    if (!name) return setPageError("Medication name is required.");

    setLoading("Adding medication…");

    const dosage = medDosage.trim();

    const { error } = await supabase.rpc("add_medication_v2", {
      p_patient_id: patientId,
      p_name: name,
      p_dosage: dosage || null,
      p_morning: schMorning,
      p_midday: schMidday,
      p_evening: schEvening,
      p_bedtime: schBedtime,
      p_prn: schPrn,
    });

    if (error) return setPageError(error.message);

    setMedName("");
    setMedDosage("");
    setSchMorning(true);
    setSchMidday(false);
    setSchEvening(true);
    setSchBedtime(false);
    setSchPrn(false);
    await loadMeds();
    setOk("Medication added ✅");
  }

  async function logMed(medicationId: string, st: "taken" | "missed", slot: Slot) {
    const user = await requireAuth();
    if (!user) return;
    if (!canMedsEdit) return setPageError("You don’t have permission to log medications.");

    setLoading("Saving…");

    const { error } = await supabase.rpc("log_medication_v2", {
      p_patient_id: patientId,
      p_medication_id: medicationId,
      p_status: st,
      p_slot: slot,
      p_note: null,
    });

    if (error) return setPageError(error.message);
    await loadMeds();
    setOk("Saved ✅");
  }

  function startEditMed(m: Medication) {
    if (!canMedsEdit) return;
    setEditMedId(m.id);
    setEditName(m.name);
    setEditDosage(m.dosage ?? "");
    setEditMorning(!!m.schedule_morning);
    setEditMidday(!!m.schedule_midday);
    setEditEvening(!!m.schedule_evening);
    setEditBedtime(!!m.schedule_bedtime);
    setEditPrn(!!m.schedule_prn);
    setEditActive(!!m.active);
  }

  function cancelEditMed() {
    setEditMedId(null);
  }

  async function saveEditMed() {
    if (!canMedsEdit) return setPageError("You don’t have permission to edit medications.");

    const name = editName.trim();
    if (!name) return setPageError("Medication name is required.");
    if (!editMedId) return setPageError("No medication selected.");

    setLoading("Saving medication…");

    const { error } = await supabase.rpc("update_medication_v2", {
      p_patient_id: patientId,
      p_medication_id: editMedId,
      p_name: name,
      p_dosage: editDosage || null,
      p_morning: editMorning,
      p_midday: editMidday,
      p_evening: editEvening,
      p_bedtime: editBedtime,
      p_prn: editPrn,
      p_active: editActive,
    });

    if (error) return setPageError(error.message);

    setEditMedId(null);
    await loadMeds();
    setOk("Medication updated ✅");
  }

  async function archiveMed(medId: string) {
    if (!canMedsEdit) return setPageError("You don’t have permission to edit medications.");
    const ok = window.confirm("Archive this medication? (Keeps history)");
    if (!ok) return;

    setLoading("Archiving…");

    const { error } = await supabase.rpc("delete_medication_v2", {
      p_patient_id: patientId,
      p_medication_id: medId,
      p_hard: false,
    });

    if (error) return setPageError(error.message);
    await loadMeds();
    setOk("Archived ✅");
  }

  async function hardDeleteMed(medId: string) {
    if (!canMedsEdit) return setPageError("You don’t have permission to edit medications.");
    const ok = window.confirm("Permanently delete this medication AND its logs? This cannot be undone.");
    if (!ok) return;

    setLoading("Deleting…");

    const { error } = await supabase.rpc("delete_medication_v2", {
      p_patient_id: patientId,
      p_medication_id: medId,
      p_hard: true,
    });

    if (error) return setPageError(error.message);
    await loadMeds();
    setOk("Deleted ✅");
  }

  // -----------------------
  // Appointments
  // -----------------------
  async function loadAppointments() {
    const q = await supabase
      .from("appointments")
      .select("id,patient_id,starts_at,ends_at,title,location,provider,notes,status,created_by,created_at")
      .eq("patient_id", patientId)
      .order("starts_at", { ascending: true });

    if (q.error) return setPageError(q.error.message);
    setAppointments((q.data ?? []) as Appointment[]);
  }

  async function addAppointment() {
    const user = await requireAuth();
    if (!user) return;
    if (!canAppointmentsEdit) return setPageError("You don’t have permission to edit appointments.");

    const title = apptTitle.trim();
    if (!title) return setPageError("Appointment title is required.");
    if (!apptStartsAt.trim()) return setPageError("Start date/time is required.");

    setLoading("Adding appointment…");

    const startsIso = dtLocalToIso(apptStartsAt);
    const endsIso = apptEndsAt.trim() ? dtLocalToIso(apptEndsAt) : null;

    const { error } = await supabase.from("appointments").insert({
      patient_id: patientId,
      title,
      starts_at: startsIso,
      ends_at: endsIso,
      location: cleanText(apptLocation) || null,
      provider: cleanText(apptProvider) || null,
      notes: cleanText(apptNotes) || null,
      status: "scheduled",
      created_by: user.id,
    });

    if (error) return setPageError(error.message);

    setApptTitle("");
    setApptStartsAt("");
    setApptEndsAt("");
    setApptLocation("");
    setApptProvider("");
    setApptNotes("");
    await loadAppointments();
    setOk("Appointment added ✅");
  }

  function startEditAppt(a: Appointment) {
    if (!canAppointmentsEdit) return;

    setEditApptId(a.id);
    setEditApptTitle(a.title);
    setEditApptStatus(a.status);
    setEditApptLocation(a.location ?? "");
    setEditApptProvider(a.provider ?? "");
    setEditApptNotes(a.notes ?? "");

    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      const yyyy = d.getFullYear();
      const mm = pad(d.getMonth() + 1);
      const dd = pad(d.getDate());
      const hh = pad(d.getHours());
      const mi = pad(d.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };

    setEditApptStartsAt(toLocal(a.starts_at));
    setEditApptEndsAt(a.ends_at ? toLocal(a.ends_at) : "");
  }

  function cancelEditAppt() {
    setEditApptId(null);
  }

  async function saveEditAppt() {
    const user = await requireAuth();
    if (!user) return;
    if (!canAppointmentsEdit) return setPageError("You don’t have permission to edit appointments.");

    if (!editApptId) return setPageError("No appointment selected.");
    const title = editApptTitle.trim();
    if (!title) return setPageError("Appointment title is required.");
    if (!editApptStartsAt.trim()) return setPageError("Start date/time is required.");

    setLoading("Saving appointment…");

    const startsIso = dtLocalToIso(editApptStartsAt);
    const endsIso = editApptEndsAt.trim() ? dtLocalToIso(editApptEndsAt) : null;

    const { error } = await supabase
      .from("appointments")
      .update({
        title,
        starts_at: startsIso,
        ends_at: endsIso,
        location: cleanText(editApptLocation) || null,
        provider: cleanText(editApptProvider) || null,
        notes: cleanText(editApptNotes) || null,
        status: editApptStatus,
      })
      .eq("id", editApptId)
      .eq("patient_id", patientId);

    if (error) return setPageError(error.message);

    setEditApptId(null);
    await loadAppointments();
    setOk("Appointment updated ✅");
  }

  async function quickStatus(a: Appointment, st: "scheduled" | "attended" | "cancelled") {
    const user = await requireAuth();
    if (!user) return;
    if (!canAppointmentsEdit) return setPageError("You don’t have permission to edit appointments.");

    setLoading("Updating status…");

    const { error } = await supabase.from("appointments").update({ status: st }).eq("id", a.id).eq("patient_id", patientId);

    if (error) return setPageError(error.message);
    await loadAppointments();
    setOk("Updated ✅");
  }

  async function deleteAppointment(a: Appointment) {
    const user = await requireAuth();
    if (!user) return;
    if (!canAppointmentsEdit) return setPageError("You don’t have permission to edit appointments.");

    const ok = window.confirm(`Delete appointment "${a.title}"?`);
    if (!ok) return;

    setLoading("Deleting appointment…");

    const { error } = await supabase.from("appointments").delete().eq("id", a.id).eq("patient_id", patientId);

    if (error) return setPageError(error.message);
    await loadAppointments();
    setOk("Deleted ✅");
  }

  const { upcomingAppointments, pastAppointments } = useMemo(() => {
    const now = Date.now();
    const upcoming: Appointment[] = [];
    const past: Appointment[] = [];

    for (const a of appointments) {
      const t = new Date(a.starts_at).getTime();
      if (t >= now) upcoming.push(a);
      else past.push(a);
    }
    past.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
    return { upcomingAppointments: upcoming, pastAppointments: past };
  }, [appointments]);

  // -----------------------
  // Invites (gated)
  // -----------------------
  async function createInvite() {
    if (!canInvites) return setPageError("You don’t have permission to manage invites.");

    setInviteToken(null);
    const user = await requireAuth();
    if (!user) return;

    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return setPageError("Enter a valid email address.");

    setLoading("Creating invite link…");

    const { data, error } = await supabase.rpc("create_invite", {
      p_patient_id: patientId,
      p_email: email,
      p_role: inviteRole,
    });

    if (error) return setPageError(error.message);

    setInviteEmail("");
    setInviteToken(String(data));
    setOk("Invite created ✅");
  }

  const inviteLink = inviteToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/accept-invite?token=${inviteToken}`
    : null;

  // -----------------------
  // Circle lists
  // -----------------------
  const filteredCircleEntries = useMemo(() => {
    let items = circleEntries.slice();

    if (circleFilter === "patient_shared") items = items.filter((e) => e.journal_type === "patient");
    else if (circleFilter === "circle_only") items = items.filter((e) => e.journal_type === "carer");

    if (circleClinicianOnly) items = items.filter((e) => !!e.include_in_clinician_summary);

    return items;
  }, [circleEntries, circleFilter, circleClinicianOnly]);

  const pinnedEntries = useMemo(() => {
    return filteredCircleEntries
      .filter((e) => pinnedIds.has(e.id))
      .sort((a, b) => {
        const pa = pinsById[a.id]?.pinned_at ?? a.created_at;
        const pb = pinsById[b.id]?.pinned_at ?? b.created_at;
        return new Date(pb).getTime() - new Date(pa).getTime();
      });
  }, [filteredCircleEntries, pinnedIds, pinsById]);

  const unpinnedEntries = useMemo(() => {
    return filteredCircleEntries.filter((e) => !pinnedIds.has(e.id));
  }, [filteredCircleEntries, pinnedIds]);

  // -----------------------
  // BubbleTour steps (full-page treatment)
  // -----------------------
  const tourSteps: TourStep[] = useMemo(() => {
    return [
      {
        id: "header",
        selector: `[data-tour="patient-header"]`,
        title: "Patient hub",
        body: "This header shows your role and quick links like Summary and Permissions (if you’re allowed).",
        placement: "bottom",
      },
      {
        id: "quick-links",
        selector: `[data-tour="patient-quick-links"]`,
        title: "Quick links",
        body: "Use these for the clinician summary and permission management.",
        placement: "bottom",
      },
      {
        id: "top-actions",
        selector: `[data-tour="patient-top-actions"]`,
        title: "Jump between sections",
        body: "These buttons switch tabs instantly (no reload).",
        placement: "left",
      },
      {
        id: "tabs",
        selector: `[data-tour="patient-tabs"]`,
        title: "Tabs",
        body: "Tabs appear or disappear based on permissions. If you can’t view something, it won’t show.",
        placement: "bottom",
      },
      {
        id: "overview",
        selector: `[data-tour="panel-overview"]`,
        title: "Overview",
        body: "Care profile + diagnoses + invite links + summary access all live here.",
        placement: "top",
      },
      {
        id: "meds",
        selector: `[data-tour="panel-meds"]`,
        title: "Medication",
        body: "Track today’s meds and manage the full medication list (if you have edit permissions).",
        placement: "top",
      },
      {
        id: "journals",
        selector: `[data-tour="panel-journals"]`,
        title: "Journals",
        body: "Patient journal is private by default. Circle journal is shared and supports comments + pins.",
        placement: "top",
      },
      {
        id: "appointments",
        selector: `[data-tour="panel-appointments"]`,
        title: "Appointments",
        body: "Add and track appointments. You can also mark attended/cancelled or edit them if allowed.",
        placement: "top",
      },
    ];
  }, []);

  // -----------------------
  // Initial load (permission-aware)
  // -----------------------
  useEffect(() => {
    (async () => {
      if (!patientId || patientId === "undefined") {
        setPageError("Missing patient id.");
        return;
      }

      const user = await requireAuth();
      if (!user) return;

      setLoading("Loading patient…");

      await loadPatient();
      await loadMyRole();
      await loadEffectivePerms();

      setOk("Permissions loaded.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  // Once perms are loaded, clamp tab + fetch only what’s allowed
  useEffect(() => {
    (async () => {
      if (!perms) return;

      // Clamp tab to allowed set
      const firstAllowed = allowedTabs[0]?.key ?? "overview";
      if (!allowedTabs.find((x) => x.key === tab)) {
        setTabAndUrl(firstAllowed);
        return;
      }

      setLoading("Loading data…");

      // Overview components (profile/diagnoses/invites/summary link)
      if (canProfileView) {
        await loadProfile();
        await loadDiagnoses();
      }

      // Journals
      if (canJournalsView) {
        await loadMemberRoles();
        await loadPatientJournal();
        await loadCircleFeed();
      }

      // Meds
      if (canMedsView) {
        await loadMeds();
      }

      // Appointments
      if (canAppointmentsView) {
        await loadAppointments();
      }

      setOk("Up to date.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perms, tab]);

  if (!patientId || patientId === "undefined") {
    return (
      <main className="cc-page">
        <div className="cc-container">Missing patient id.</div>
      </main>
    );
  }

  return (
    <main className="cc-page">
      {/* Bubble tour */}
      <BubbleTour tourId={`patient-${patientId}-v1`} steps={tourSteps} autoStart />

      <div className="cc-container cc-stack">
        {/* Header */}
        <div className="cc-card cc-card-pad" data-tour="patient-header">
          <div className="cc-row-between">
            <div className="cc-row">
              <Link className="cc-btn" href={`${base}/today`}>
                ← Back to Today
              </Link>

              <div>
                <div className="cc-kicker">Patient</div>
                <h1 className="cc-h1">{patientName}</h1>

                <div className="cc-row" style={{ marginTop: 6 } as any} data-tour="patient-quick-links">
                  <span className="cc-pill cc-pill-primary">You: {humanRole(myRole)}</span>

                  {canSummaryView ? (
                    <Link className="cc-pill" href={`${base}/patients/${patientId}/summary`}>
                      📄 Clinician summary
                    </Link>
                  ) : null}

                  {canPermsManage ? (
                    <Link className="cc-pill" href={`${base}/patients/${patientId}/permissions`}>
                      🔐 Permissions
                    </Link>
                  ) : null}

                  <button
                    className="cc-pill"
                    onClick={() => {
                      try {
                        localStorage.removeItem(`cc_tour_done__patient-${patientId}-v1`);
                      } catch {}
                      window.location.reload();
                    }}
                    title="Replay tour"
                  >
                    ✨ Tour
                  </button>
                </div>
              </div>
            </div>

            {/* ✅ FIX: top-right buttons now switch tabs directly */}
            <div className="cc-row" data-tour="patient-top-actions">
              {canJournalsView ? (
                <button className="cc-btn" onClick={() => setTabAndUrl("journals")}>
                  📝 Timeline
                </button>
              ) : null}
              {canMedsView ? (
                <button className="cc-btn" onClick={() => setTabAndUrl("meds")}>
                  💊 Meds
                </button>
              ) : null}
              {canAppointmentsView ? (
                <button className="cc-btn" onClick={() => setTabAndUrl("appointments")}>
                  📅 Appointments
                </button>
              ) : null}
            </div>
          </div>

          {/* Tabs */}
          <nav className="cc-tabbar" data-tour="patient-tabs">
            {allowedTabs.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTabAndUrl(t.key)}
                  className={["cc-tab", active ? "cc-tab-active" : ""].join(" ")}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Status */}
          {status.kind !== "idle" ? (
            <div
              className={[
                "cc-status",
                status.kind === "error"
                  ? "cc-status-error"
                  : status.kind === "ok"
                    ? "cc-status-ok"
                    : status.kind === "loading"
                      ? "cc-status-loading"
                      : "",
              ].join(" ")}
              style={{ marginTop: 12 } as any}
            >
              <div>
                {status.kind === "error" ? (
                  <span className="cc-status-error-title">Something needs attention: </span>
                ) : null}
                {status.msg}
              </div>
              {error ? (
                <div className="cc-small" style={{ color: "crimson", whiteSpace: "pre-wrap" } as any}>
                  {error}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <section className="cc-stack" data-tour="panel-overview">
            {/* Care profile */}
            {canProfileView ? (
              <div className="cc-card cc-card-pad">
                <div className="cc-row-between">
                  <div>
                    <h2 className="cc-h2">Care profile</h2>
                    <p className="cc-subtle">Communication, safety, and key notes — shown in summary.</p>
                  </div>

                  {canProfileEdit ? (
                    <button
                      className="cc-btn"
                      onClick={() => {
                        const p = profile;
                        if (p) hydrateProfileForm(p);
                        setProfileOpen((v) => !v);
                      }}
                    >
                      {profileOpen ? "Close" : profileComplete ? "Edit" : "Complete setup"}
                    </button>
                  ) : (
                    <span className="cc-small">View only</span>
                  )}
                </div>

                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  {!profileComplete ? (
                    <p className="cc-subtle" style={{ margin: 0 } as any}>
                      Not set yet.
                    </p>
                  ) : (
                    <div className="cc-stack" style={{ gap: 8 } as any}>
                      {profile?.guardian_setup ? (
                        <div className="cc-subtle">
                          <b>Set up by guardian:</b> Yes
                        </div>
                      ) : null}

                      <div className="cc-subtle">
                        <b>Health POA in place:</b> {yesNoUnknown(profile?.has_health_poa)}
                        {profile?.has_health_poa ? (
                          <>
                            {" • "} <b>Held by:</b> {profile?.health_poa_held_by || "—"}
                          </>
                        ) : null}
                        {" • "}
                        <b>RESPECT letter in place:</b> {yesNoUnknown(profile?.has_respect_letter)}
                        {profile?.has_respect_letter ? (
                          <>
                            {" • "} <b>Held by:</b> {profile?.respect_letter_held_by || "—"}
                          </>
                        ) : null}
                      </div>

                      {profile?.speaks !== null ? (
                        <div className="cc-subtle">
                          <b>Speaks:</b> {profile?.speaks ? "Yes" : "No / limited"}
                        </div>
                      ) : null}

                      {profile?.communication_methods ? (
                        <div className="cc-subtle">
                          <b>Communication:</b> {profile.communication_methods}
                        </div>
                      ) : null}

                      {profile?.languages_understood ? (
                        <div className="cc-subtle">
                          <b>Languages understood:</b> {profile.languages_understood}
                        </div>
                      ) : null}

                      {profile?.preferred_language ? (
                        <div className="cc-subtle">
                          <b>Preferred language:</b> {profile.preferred_language}
                        </div>
                      ) : null}

                      {profile?.allergies ? (
                        <div className="cc-subtle">
                          <b>Allergies:</b> {profile.allergies}
                        </div>
                      ) : null}

                      {profile?.panic_triggers ? (
                        <div className="cc-subtle">
                          <b>Panic triggers:</b> {profile.panic_triggers}
                        </div>
                      ) : null}

                      {profile?.calming_strategies ? (
                        <div className="cc-subtle">
                          <b>What helps:</b> {profile.calming_strategies}
                        </div>
                      ) : null}

                      {profile?.important_notes ? (
                        <div className="cc-subtle">
                          <b>Important notes:</b> {profile.important_notes}
                        </div>
                      ) : null}

                      {profile?.updated_at ? <div className="cc-small">Updated: {fmtDateTime(profile.updated_at)}</div> : null}
                    </div>
                  )}
                </div>

                {/* Edit form */}
                {profileOpen && canProfileEdit && (
                  <div className="cc-panel-soft" style={{ marginTop: 12 } as any}>
                    <div className="cc-stack">
                      <label className="cc-check">
                        <input type="checkbox" checked={guardianSetup} onChange={(e) => setGuardianSetup(e.target.checked)} />
                        Set up by legal guardian / caregiver?
                      </label>

                      <div className="cc-grid-2">
                        <div className="cc-field">
                          <div className="cc-label">Health POA in place?</div>
                          <select
                            className="cc-select"
                            value={hasHealthPoa === null ? "unknown" : hasHealthPoa ? "yes" : "no"}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "unknown") setHasHealthPoa(null);
                              else setHasHealthPoa(v === "yes");
                              if (v !== "yes") setHealthPoaHeldBy("");
                            }}
                          >
                            <option value="unknown">Not specified</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">RESPECT letter in place?</div>
                          <select
                            className="cc-select"
                            value={hasRespectLetter === null ? "unknown" : hasRespectLetter ? "yes" : "no"}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "unknown") setHasRespectLetter(null);
                              else setHasRespectLetter(v === "yes");
                              if (v !== "yes") setRespectLetterHeldBy("");
                            }}
                          >
                            <option value="unknown">Not specified</option>
                            <option value="yes">Yes</option>
                            <option value="no">No</option>
                          </select>
                        </div>
                      </div>

                      {hasHealthPoa === true && (
                        <div className="cc-field">
                          <div className="cc-label">Held by?</div>
                          <input
                            className="cc-input"
                            value={healthPoaHeldBy}
                            onChange={(e) => setHealthPoaHeldBy(e.target.value)}
                            placeholder="Full name (and relationship if helpful)"
                          />
                        </div>
                      )}

                      {hasRespectLetter === true && (
                        <div className="cc-field">
                          <div className="cc-label">Held by?</div>
                          <input
                            className="cc-input"
                            value={respectLetterHeldBy}
                            onChange={(e) => setRespectLetterHeldBy(e.target.value)}
                            placeholder="Full name (and where it’s stored)"
                          />
                        </div>
                      )}

                      <div className="cc-grid-2">
                        <div className="cc-field">
                          <div className="cc-label">Does the patient speak?</div>
                          <select
                            className="cc-select"
                            value={speaks === null ? "unknown" : speaks ? "yes" : "no"}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "unknown") setSpeaks(null);
                              else setSpeaks(v === "yes");
                            }}
                          >
                            <option value="unknown">Prefer not to say</option>
                            <option value="yes">Yes</option>
                            <option value="no">No / limited</option>
                          </select>
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">If not, how do they communicate?</div>
                          <input
                            className="cc-input"
                            value={communicationMethods}
                            onChange={(e) => setCommunicationMethods(e.target.value)}
                            placeholder="e.g. gestures, communication board, writing, AAC device…"
                          />
                        </div>
                      </div>

                      <div className="cc-grid-2">
                        <div className="cc-field">
                          <div className="cc-label">Languages understood</div>
                          <input
                            className="cc-input"
                            value={languagesUnderstood}
                            onChange={(e) => setLanguagesUnderstood(e.target.value)}
                            placeholder="e.g. English, Urdu, Polish…"
                          />
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">Preferred language</div>
                          <input
                            className="cc-input"
                            value={preferredLanguage}
                            onChange={(e) => setPreferredLanguage(e.target.value)}
                            placeholder="e.g. Urdu"
                          />
                        </div>
                      </div>

                      <div className="cc-field">
                        <div className="cc-label">Allergies</div>
                        <textarea
                          className="cc-textarea"
                          value={allergies}
                          onChange={(e) => setAllergies(e.target.value)}
                          placeholder="e.g. Penicillin, peanuts…"
                        />
                      </div>

                      <div className="cc-grid-2">
                        <div className="cc-field">
                          <div className="cc-label">Panic triggers</div>
                          <textarea
                            className="cc-textarea"
                            value={panicTriggers}
                            onChange={(e) => setPanicTriggers(e.target.value)}
                            placeholder="e.g. loud noises, bright lights…"
                          />
                        </div>

                        <div className="cc-field">
                          <div className="cc-label">What helps / calming strategies</div>
                          <textarea
                            className="cc-textarea"
                            value={calmingStrategies}
                            onChange={(e) => setCalmingStrategies(e.target.value)}
                            placeholder="e.g. quiet room, weighted blanket…"
                          />
                        </div>
                      </div>

                      <div className="cc-field">
                        <div className="cc-label">Important notes</div>
                        <textarea
                          className="cc-textarea"
                          value={importantNotes}
                          onChange={(e) => setImportantNotes(e.target.value)}
                          placeholder="Anything a new carer or clinician should know quickly…"
                        />
                      </div>

                      <div className="cc-row">
                        <button className="cc-btn cc-btn-primary" onClick={saveProfile}>
                          Save profile
                        </button>
                        <button
                          className="cc-btn"
                          onClick={() => {
                            setProfileOpen(false);
                            const p = profile;
                            if (p) hydrateProfileForm(p);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Overview</h2>
                <p className="cc-subtle">You don’t have permission to view the care profile.</p>
              </div>
            )}

            {/* Diagnoses */}
            {canProfileView ? (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Diagnoses</h2>

                {canProfileEdit ? (
                  <div className="cc-panel" style={{ marginTop: 12 } as any}>
                    <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                      <input
                        className="cc-input"
                        value={dxName}
                        onChange={(e) => setDxName(e.target.value)}
                        placeholder="Diagnosis (e.g. Autism, Type 2 diabetes)"
                      />
                      <input className="cc-input" value={dxDate} onChange={(e) => setDxDate(e.target.value)} type="date" />
                    </div>

                    <textarea
                      className="cc-textarea"
                      value={dxNotes}
                      onChange={(e) => setDxNotes(e.target.value)}
                      placeholder="Notes (optional): severity, context, consultant, etc."
                      style={{ marginTop: 10 } as any}
                    />

                    <button
                      className="cc-btn cc-btn-primary"
                      onClick={addDiagnosis}
                      disabled={!dxName.trim()}
                      style={{ marginTop: 10 } as any}
                    >
                      Add diagnosis
                    </button>
                  </div>
                ) : (
                  <div className="cc-panel" style={{ marginTop: 12 } as any}>
                    <div className="cc-small">View only</div>
                  </div>
                )}

                <div className="cc-stack" style={{ marginTop: 12 } as any}>
                  {diagnoses.length === 0 ? (
                    <p className="cc-subtle">No diagnoses yet.</p>
                  ) : (
                    diagnoses.map((d) => {
                      const isEditing = editDxId === d.id;

                      return (
                        <div key={d.id} className="cc-panel-green">
                          {!isEditing ? (
                            <div className="cc-row-between">
                              <div style={{ minWidth: 260 } as any}>
                                <div className="cc-strong">
                                  {d.diagnosis} {!d.active ? <span className="cc-small">(inactive)</span> : null}
                                </div>
                                <div className="cc-subtle">{d.diagnosed_on ? `Diagnosed: ${d.diagnosed_on}` : "Diagnosed: —"}</div>
                                <div className="cc-subtle">{d.notes ? d.notes : "(No notes)"}</div>
                              </div>

                              {canProfileEdit ? (
                                <div className="cc-row">
                                  <button className="cc-btn" onClick={() => startEditDx(d)}>
                                    Edit
                                  </button>
                                  <button className="cc-btn" onClick={() => toggleDxActive(d)}>
                                    {d.active ? "Mark inactive" : "Mark active"}
                                  </button>
                                  <button className="cc-btn cc-btn-danger" onClick={() => deleteDx(d)}>
                                    Delete
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="cc-stack">
                              <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                                <input className="cc-input" value={editDxName} onChange={(e) => setEditDxName(e.target.value)} />
                                <input className="cc-input" value={editDxDate} onChange={(e) => setEditDxDate(e.target.value)} type="date" />
                              </div>

                              <textarea className="cc-textarea" value={editDxNotes} onChange={(e) => setEditDxNotes(e.target.value)} />

                              <label className="cc-check">
                                <input type="checkbox" checked={editDxActive} onChange={(e) => setEditDxActive(e.target.checked)} />
                                Active
                              </label>

                              <div className="cc-row">
                                <button className="cc-btn cc-btn-primary" onClick={saveEditDx}>
                                  Save
                                </button>
                                <button className="cc-btn" onClick={cancelEditDx}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {/* Summary */}
            {canSummaryView ? (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Summary</h2>
                <p className="cc-subtle">Includes care profile, POA/RESPECT, diagnoses, meds, and entries marked for summary.</p>
                <Link className="cc-btn cc-btn-primary" href={`${base}/patients/${patientId}/summary`}>
                  Open patient summary
                </Link>
              </div>
            ) : null}

            {/* Invite */}
            {canInvites ? (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Invite to CareCircle</h2>
                <p className="cc-subtle">Create a link and send it to someone to join this patient’s circle.</p>

                <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                  <input
                    className="cc-input"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@example.com"
                  />
                  <select className="cc-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}>
                    <option value="family">Family</option>
                    <option value="carer">Carer / support</option>
                    <option value="professional">Professional / clinician</option>
                  </select>
                </div>

                <div className="cc-row" style={{ marginTop: 10 } as any}>
                  <button className="cc-btn cc-btn-primary" onClick={createInvite}>
                    Create invite
                  </button>
                </div>

                {inviteLink && (
                  <div className="cc-panel" style={{ marginTop: 12 } as any}>
                    <div className="cc-small">Copy this invite link:</div>
                    <code style={{ wordBreak: "break-all" } as any}>{inviteLink}</code>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        )}

        {/* APPOINTMENTS */}
        {tab === "appointments" && canAppointmentsView && (
          <section className="cc-stack" data-tour="panel-appointments">
            {canAppointmentsEdit ? (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Add appointment</h2>

                <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                  <input
                    className="cc-input"
                    value={apptTitle}
                    onChange={(e) => setApptTitle(e.target.value)}
                    placeholder="Title (e.g. GP review, OT assessment)"
                  />
                  <input className="cc-input" type="datetime-local" value={apptStartsAt} onChange={(e) => setApptStartsAt(e.target.value)} />
                </div>

                <div className="cc-grid-2" style={{ marginTop: 10 } as any}>
                  <input className="cc-input" type="datetime-local" value={apptEndsAt} onChange={(e) => setApptEndsAt(e.target.value)} />
                  <input
                    className="cc-input"
                    value={apptProvider}
                    onChange={(e) => setApptProvider(e.target.value)}
                    placeholder="Clinician / service (optional)"
                  />
                </div>

                <div className="cc-grid-2" style={{ gridTemplateColumns: "1fr 2fr", marginTop: 10 } as any}>
                  <input className="cc-input" value={apptLocation} onChange={(e) => setApptLocation(e.target.value)} placeholder="Location (optional)" />
                  <input className="cc-input" value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} placeholder="Notes (optional)" />
                </div>

                <button
                  className="cc-btn cc-btn-primary"
                  onClick={addAppointment}
                  disabled={!apptTitle.trim() || !apptStartsAt.trim()}
                  style={{ marginTop: 12 } as any}
                >
                  Add appointment
                </button>
              </div>
            ) : null}

            <div className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <h2 className="cc-h2">Upcoming</h2>
                <button className="cc-btn" onClick={loadAppointments}>
                  Refresh
                </button>
              </div>

              {upcomingAppointments.length === 0 ? (
                <p className="cc-subtle" style={{ marginTop: 12 } as any}>
                  No upcoming appointments.
                </p>
              ) : (
                <div className="cc-stack" style={{ marginTop: 12 } as any}>
                  {upcomingAppointments.map((a) => (
                    <AppointmentCard
                      key={a.id}
                      a={a}
                      canEdit={canAppointmentsEdit}
                      onEdit={() => startEditAppt(a)}
                      onAttend={() => quickStatus(a, "attended")}
                      onCancel={() => quickStatus(a, "cancelled")}
                      onDelete={() => deleteAppointment(a)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="cc-card cc-card-pad">
              <h2 className="cc-h2">Past</h2>

              {pastAppointments.length === 0 ? (
                <p className="cc-subtle">No past appointments.</p>
              ) : (
                <div className="cc-stack" style={{ marginTop: 12 } as any}>
                  {pastAppointments.map((a) => (
                    <AppointmentCard
                      key={a.id}
                      a={a}
                      canEdit={canAppointmentsEdit}
                      onEdit={() => startEditAppt(a)}
                      onAttend={() => quickStatus(a, "attended")}
                      onCancel={() => quickStatus(a, "cancelled")}
                      onDelete={() => deleteAppointment(a)}
                    />
                  ))}
                </div>
              )}
            </div>

            {editApptId && canAppointmentsEdit && (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Edit appointment</h2>

                <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                  <input className="cc-input" value={editApptTitle} onChange={(e) => setEditApptTitle(e.target.value)} />
                  <select className="cc-select" value={editApptStatus} onChange={(e) => setEditApptStatus(e.target.value as any)}>
                    <option value="scheduled">Scheduled</option>
                    <option value="attended">Attended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="cc-grid-2" style={{ marginTop: 10 } as any}>
                  <input className="cc-input" type="datetime-local" value={editApptStartsAt} onChange={(e) => setEditApptStartsAt(e.target.value)} />
                  <input className="cc-input" type="datetime-local" value={editApptEndsAt} onChange={(e) => setEditApptEndsAt(e.target.value)} />
                </div>

                <div className="cc-grid-2" style={{ marginTop: 10 } as any}>
                  <input className="cc-input" value={editApptProvider} onChange={(e) => setEditApptProvider(e.target.value)} placeholder="Provider (optional)" />
                  <input className="cc-input" value={editApptLocation} onChange={(e) => setEditApptLocation(e.target.value)} placeholder="Location (optional)" />
                </div>

                <textarea
                  className="cc-textarea"
                  value={editApptNotes}
                  onChange={(e) => setEditApptNotes(e.target.value)}
                  placeholder="Notes (optional)"
                  style={{ marginTop: 10 } as any}
                />

                <div className="cc-row" style={{ marginTop: 12 } as any}>
                  <button className="cc-btn cc-btn-primary" onClick={saveEditAppt}>
                    Save
                  </button>
                  <button className="cc-btn" onClick={cancelEditAppt}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* MEDS */}
        {tab === "meds" && canMedsView && (
          <section className="cc-stack" data-tour="panel-meds">
            <div className="cc-card cc-card-pad">
              <h2 className="cc-h2">Today’s medication checklist</h2>

              {SLOTS.map((slot) => {
                const medsForSlot = meds.filter((m) => scheduledSlots(m).includes(slot) && m.active);
                if (medsForSlot.length === 0) return null;

                return (
                  <div key={slot} style={{ marginTop: 14 } as any}>
                    <h3 className="cc-h2" style={{ fontSize: 16 } as any}>
                      {slotLabel[slot]}
                    </h3>

                    <div className="cc-stack">
                      {medsForSlot.map((m) => {
                        const latest = logsByMedSlot?.[m.id]?.[slot];
                        const statusLabel = latest ? (latest.status === "taken" ? "✅ Taken" : "❌ Missed") : "Not logged";

                        return (
                          <div key={`${slot}-${m.id}`} className="cc-panel-green">
                            <div className="cc-row-between">
                              <div style={{ minWidth: 240 } as any}>
                                <div className="cc-strong">{m.name}</div>
                                <div className="cc-subtle">{m.dosage ? m.dosage : "—"}</div>
                                <div className="cc-small">
                                  Status: <b>{statusLabel}</b>
                                  {latest ? ` • ${fmtDateTime(latest.created_at)}` : ""}
                                </div>
                              </div>

                              {canMedsEdit ? (
                                <div className="cc-row">
                                  <button className="cc-btn" onClick={() => logMed(m.id, "taken", slot)}>
                                    Taken
                                  </button>
                                  <button className="cc-btn" onClick={() => logMed(m.id, "missed", slot)}>
                                    Missed
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {canMedsEdit ? (
              <div className="cc-card cc-card-pad">
                <h2 className="cc-h2">Add medication</h2>

                <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                  <input className="cc-input" value={medName} onChange={(e) => setMedName(e.target.value)} placeholder="Medication name (e.g. Paracetamol)" />
                  <input className="cc-input" value={medDosage} onChange={(e) => setMedDosage(e.target.value)} placeholder="Dosage (optional, e.g. 500mg)" />
                </div>

                <div className="cc-row" style={{ marginTop: 10 } as any}>
                  <button className="cc-btn cc-btn-primary" onClick={addMedication} disabled={!medName.trim()}>
                    Add
                  </button>
                </div>

                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-strong">Schedule</div>
                  <div className="cc-row" style={{ marginTop: 8 } as any}>
                    <label className="cc-check">
                      <input type="checkbox" checked={schMorning} onChange={(e) => setSchMorning(e.target.checked)} />
                      Morning
                    </label>
                    <label className="cc-check">
                      <input type="checkbox" checked={schMidday} onChange={(e) => setSchMidday(e.target.checked)} />
                      Midday
                    </label>
                    <label className="cc-check">
                      <input type="checkbox" checked={schEvening} onChange={(e) => setSchEvening(e.target.checked)} />
                      Evening
                    </label>
                    <label className="cc-check">
                      <input type="checkbox" checked={schBedtime} onChange={(e) => setSchBedtime(e.target.checked)} />
                      Bedtime
                    </label>
                    <label className="cc-check">
                      <input type="checkbox" checked={schPrn} onChange={(e) => setSchPrn(e.target.checked)} />
                      As needed
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="cc-card cc-card-pad">
              <h2 className="cc-h2">All medications</h2>

              {meds.length === 0 ? (
                <p className="cc-subtle">No medications yet.</p>
              ) : (
                <div className="cc-stack">
                  {meds.map((m) => {
                    const slots = scheduledSlots(m);
                    const isEditing = editMedId === m.id;

                    return (
                      <div key={m.id} className="cc-panel-blue">
                        {!isEditing ? (
                          <div className="cc-row-between">
                            <div style={{ minWidth: 240 } as any}>
                              <div className="cc-strong">
                                {m.name} {!m.active ? <span className="cc-small">(archived)</span> : null}
                              </div>
                              <div className="cc-subtle">{m.dosage ? m.dosage : "—"}</div>
                              <div className="cc-small">Schedule: {slots.length ? slots.map((s) => slotLabel[s]).join(", ") : "None"}</div>
                            </div>

                            {canMedsEdit ? (
                              <div className="cc-row">
                                <button className="cc-btn" onClick={() => startEditMed(m)}>
                                  Edit
                                </button>
                                {m.active ? (
                                  <button className="cc-btn" onClick={() => archiveMed(m.id)}>
                                    Archive
                                  </button>
                                ) : null}
                                <button className="cc-btn cc-btn-danger" onClick={() => hardDeleteMed(m.id)}>
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="cc-stack">
                            <div className="cc-grid-2" style={{ gridTemplateColumns: "2fr 1fr" } as any}>
                              <input className="cc-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Medication name" />
                              <input className="cc-input" value={editDosage} onChange={(e) => setEditDosage(e.target.value)} placeholder="Dosage (optional)" />
                            </div>

                            <div className="cc-panel">
                              <div className="cc-strong">Schedule</div>
                              <div className="cc-row" style={{ marginTop: 8 } as any}>
                                <label className="cc-check">
                                  <input type="checkbox" checked={editMorning} onChange={(e) => setEditMorning(e.target.checked)} />
                                  Morning
                                </label>
                                <label className="cc-check">
                                  <input type="checkbox" checked={editMidday} onChange={(e) => setEditMidday(e.target.checked)} />
                                  Midday
                                </label>
                                <label className="cc-check">
                                  <input type="checkbox" checked={editEvening} onChange={(e) => setEditEvening(e.target.checked)} />
                                  Evening
                                </label>
                                <label className="cc-check">
                                  <input type="checkbox" checked={editBedtime} onChange={(e) => setEditBedtime(e.target.checked)} />
                                  Bedtime
                                </label>
                                <label className="cc-check">
                                  <input type="checkbox" checked={editPrn} onChange={(e) => setEditPrn(e.target.checked)} />
                                  As needed
                                </label>
                              </div>

                              <label className="cc-check" style={{ marginTop: 10 } as any}>
                                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                                Active
                              </label>
                            </div>

                            <div className="cc-row">
                              <button className="cc-btn cc-btn-primary" onClick={saveEditMed}>
                                Save
                              </button>
                              <button className="cc-btn" onClick={cancelEditMed}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* JOURNALS */}
        {tab === "journals" && canJournalsView && (
          <section className="cc-grid-2-125" data-tour="panel-journals">
            {/* Patient Journal */}
            <div className="cc-card cc-card-pad">
              <h2 className="cc-h2">Patient journal</h2>
              <p className="cc-subtle">Private to the patient. Tick “Share to circle” to show the entry in the shared timeline.</p>

              <div className="cc-panel" style={{ marginTop: 12 } as any}>
                <div className="cc-strong">How are you feeling?</div>
                <div className="cc-row" style={{ marginTop: 8 } as any}>
                  {Object.entries(moodEmoji).map(([k, e]) => (
                    <button key={k} className="cc-btn" onClick={() => setMood(k as MoodKey)} aria-label={`Mood ${k}`} title={k}>
                      {e}
                    </button>
                  ))}
                  <button className="cc-btn" onClick={() => setMood(null)}>
                    Clear
                  </button>
                </div>

                <div className="cc-strong" style={{ marginTop: 12 } as any}>
                  Pain level (0–10)
                </div>
                <div className="cc-row" style={{ marginTop: 8 } as any}>
                  {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                    <button key={n} className="cc-btn" onClick={() => setPain(n)} title={`Pain ${n}/10`}>
                      {n}
                    </button>
                  ))}
                  <button className="cc-btn" onClick={() => setPain(null)}>
                    Clear
                  </button>
                </div>
              </div>

              <textarea
                className="cc-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write a note (optional)…"
                style={{ marginTop: 12 } as any}
              />

              <div className="cc-stack" style={{ gap: 8, marginTop: 10 } as any}>
                <label className="cc-check">
                  <input type="checkbox" checked={shareToCircle} onChange={(e) => setShareToCircle(e.target.checked)} />
                  Share to circle journal
                </label>

                <label className="cc-check">
                  <input type="checkbox" checked={shareToClinician} onChange={(e) => setShareToClinician(e.target.checked)} />
                  Include in summary
                </label>
              </div>

              <button className="cc-btn cc-btn-primary" onClick={addPatientEntry} style={{ marginTop: 12 } as any}>
                Save entry
              </button>

              <div className="cc-spacer-12" />

              {patientJournal.length === 0 ? (
                <p className="cc-subtle">No entries yet.</p>
              ) : (
                <div className="cc-stack">
                  {patientJournal.map((e) => (
                    <div key={e.id} className="cc-panel">
                      <div className="cc-small">
                        {fmtDateTime(e.created_at)}
                        {e.shared_to_circle ? " • shared to circle" : ""}
                        {e.include_in_clinician_summary ? " • summary" : ""}
                      </div>

                      <div className="cc-row" style={{ marginTop: 6 } as any}>
                        {e.mood ? <span>{moodEmoji[e.mood]}</span> : null}
                        {typeof e.pain_level === "number" ? <span className="cc-subtle">Pain {e.pain_level}/10</span> : null}
                      </div>

                      <div className="cc-subtle" style={{ marginTop: 8 } as any}>
                        {e.content ? e.content : "(No note)"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Circle Journal */}
            <div className="cc-card cc-card-pad">
              <div className="cc-row-between">
                <div>
                  <h2 className="cc-h2">Circle journal</h2>
                  <p className="cc-subtle">Shared timeline for family, clinicians, and professional support. Patient entries appear here only if shared.</p>
                </div>
                <button
                  className="cc-btn"
                  onClick={async () => {
                    setLoading("Refreshing…");
                    await loadMemberRoles();
                    await loadCircleFeed();
                    setOk("Refreshed ✅");
                  }}
                >
                  Refresh
                </button>
              </div>

              <div className="cc-row" style={{ marginTop: 8 } as any}>
                <select className="cc-select" value={circleFilter} onChange={(e) => setCircleFilter(e.target.value as any)} style={{ maxWidth: 240 } as any}>
                  <option value="all">All</option>
                  <option value="patient_shared">Patient shared</option>
                  <option value="circle_only">Circle updates only</option>
                </select>

                <label className="cc-check">
                  <input type="checkbox" checked={circleClinicianOnly} onChange={(e) => setCircleClinicianOnly(e.target.checked)} />
                  Summary-only
                </label>

                <div className="cc-small">
                  You: <b>{humanRole(myRole)}</b>
                </div>
              </div>

              {canPostToCircleDirectly ? (
                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-strong">Post a circle update</div>

                  <textarea
                    className="cc-textarea"
                    value={circlePostText}
                    onChange={(e) => setCirclePostText(e.target.value)}
                    placeholder="Observation, update, plan, question…"
                    style={{ marginTop: 8 } as any}
                  />

                  <label className="cc-check" style={{ marginTop: 10 } as any}>
                    <input type="checkbox" checked={circlePostToClinician} onChange={(e) => setCirclePostToClinician(e.target.checked)} />
                    Include in summary
                  </label>

                  <div className="cc-row" style={{ marginTop: 10 } as any}>
                    <button className="cc-btn cc-btn-secondary" onClick={addCircleEntry} disabled={!circlePostText.trim()}>
                      Post update
                    </button>
                  </div>
                </div>
              ) : (
                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-strong">Circle updates</div>
                  <p className="cc-subtle" style={{ margin: 0 } as any}>
                    You can’t post directly to the circle (or you don’t have permission). Use the patient journal and tick “Share to circle”.
                  </p>
                </div>
              )}

              {pinnedEntries.length > 0 && (
                <div className="cc-panel" style={{ marginTop: 12 } as any}>
                  <div className="cc-strong">Pinned</div>
                  <div className="cc-stack" style={{ marginTop: 10 } as any}>
                    {pinnedEntries.map((e) => (
                      <CircleCard
                        key={e.id}
                        entry={e}
                        authedUserId={authedUserId}
                        roleLabel={humanRole(e.journal_type === "patient" ? "patient" : memberRoleByUserId[e.created_by ?? ""])}
                        pinned
                        pinnedAt={pinsById[e.id]?.pinned_at ?? null}
                        canInteract={canPostCircle}
                        onPin={() => pinEntry(e.id)}
                        onUnpin={() => unpinEntry(e.id)}
                        moodEmoji={moodEmoji}
                        comments={circleComments[e.id] ?? []}
                        commentDraft={commentDraftByEntry[e.id] ?? ""}
                        setCommentDraft={(v) => setCommentDraftByEntry((prev) => ({ ...prev, [e.id]: v }))}
                        onAddComment={() => addComment(e.id)}
                        onDeleteComment={deleteMyComment}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="cc-stack" style={{ marginTop: 12 } as any}>
                {unpinnedEntries.length === 0 ? (
                  <p className="cc-subtle" style={{ margin: 0 } as any}>
                    No circle entries yet.
                  </p>
                ) : (
                  unpinnedEntries.map((e) => (
                    <CircleCard
                      key={e.id}
                      entry={e}
                      authedUserId={authedUserId}
                      roleLabel={humanRole(e.journal_type === "patient" ? "patient" : memberRoleByUserId[e.created_by ?? ""])}
                      pinned={pinnedIds.has(e.id)}
                      pinnedAt={pinsById[e.id]?.pinned_at ?? null}
                      canInteract={canPostCircle}
                      onPin={() => pinEntry(e.id)}
                      onUnpin={() => unpinEntry(e.id)}
                      moodEmoji={moodEmoji}
                      comments={circleComments[e.id] ?? []}
                      commentDraft={commentDraftByEntry[e.id] ?? ""}
                      setCommentDraft={(v) => setCommentDraftByEntry((prev) => ({ ...prev, [e.id]: v }))}
                      onAddComment={() => addComment(e.id)}
                      onDeleteComment={deleteMyComment}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        <div className="cc-spacer-24" />
      </div>
    </main>
  );
}

function CircleCard(props: {
  entry: JournalEntry;
  authedUserId: string | null;
  roleLabel: string;
  pinned: boolean;
  pinnedAt: string | null;
  canInteract: boolean;

  onPin: () => void;
  onUnpin: () => void;

  moodEmoji: Record<MoodKey, string>;

  comments: CircleComment[];
  commentDraft: string;
  setCommentDraft: (v: string) => void;
  onAddComment: () => void;
  onDeleteComment: (c: CircleComment) => void;
}) {
  const { entry } = props;

  const headerTag =
    entry.journal_type === "patient"
      ? entry.shared_to_circle
        ? "Patient shared"
        : "Patient"
      : "Circle update";

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div style={{ minWidth: 260 } as any}>
          <div className="cc-small">
            {fmtDateTime(entry.created_at)} • <b>{headerTag}</b> • Posted by: <b>{props.roleLabel}</b>
            {entry.include_in_clinician_summary ? " • summary" : ""}
            {props.pinnedAt ? ` • pinned ${fmtDateTime(props.pinnedAt)}` : ""}
          </div>

          <div className="cc-row" style={{ marginTop: 6 } as any}>
            {entry.mood ? <span>{props.moodEmoji[entry.mood]}</span> : null}
            {typeof entry.pain_level === "number" ? <span className="cc-subtle">Pain {entry.pain_level}/10</span> : null}
          </div>

          <div className="cc-subtle" style={{ marginTop: 8 } as any}>
            {entry.content ? entry.content : "(No note)"}
          </div>
        </div>

        {props.canInteract ? (
          <div className="cc-row">
            {!props.pinned ? (
              <button className="cc-btn" onClick={props.onPin}>
                Pin
              </button>
            ) : (
              <button className="cc-btn" onClick={props.onUnpin}>
                Unpin
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="cc-panel" style={{ marginTop: 12 } as any}>
        <div className="cc-strong">Comments</div>

        {props.comments.length === 0 ? (
          <p className="cc-subtle" style={{ marginTop: 6 } as any}>
            No comments yet.
          </p>
        ) : (
          <div className="cc-stack" style={{ marginTop: 8 } as any}>
            {props.comments.map((c) => (
              <div key={c.id} className="cc-panel">
                <div className="cc-row-between">
                  <div style={{ minWidth: 220 } as any}>
                    <div className="cc-small">{fmtDateTime(c.created_at)}</div>
                    <div className="cc-subtle" style={{ marginTop: 4 } as any}>
                      {c.content}
                    </div>
                  </div>

                  {props.authedUserId && c.user_id === props.authedUserId ? (
                    <button className="cc-btn cc-btn-danger" onClick={() => props.onDeleteComment(c)}>
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {props.canInteract ? (
          <div className="cc-row" style={{ marginTop: 10 } as any}>
            <input className="cc-input" value={props.commentDraft} onChange={(e) => props.setCommentDraft(e.target.value)} placeholder="Write a comment…" />
            <button className="cc-btn" onClick={props.onAddComment} disabled={!props.commentDraft.trim()}>
              Send
            </button>
          </div>
        ) : (
          <div className="cc-small" style={{ marginTop: 10 } as any}>
            You don’t have permission to comment.
          </div>
        )}
      </div>
    </div>
  );
}

function AppointmentCard(props: {
  a: Appointment;
  canEdit: boolean;
  onEdit: () => void;
  onAttend: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const a = props.a;

  const badgeText = a.status === "attended" ? "Attended" : a.status === "cancelled" ? "Cancelled" : "Scheduled";
  const badgeClass =
    a.status === "attended"
      ? "cc-pill cc-pill-primary"
      : a.status === "cancelled"
        ? "cc-pill cc-pill-danger"
        : "cc-pill cc-pill-primary";

  return (
    <div className="cc-panel-soft">
      <div className="cc-row-between">
        <div style={{ minWidth: 260 } as any}>
          <div className="cc-row">
            <div className="cc-strong">{a.title}</div>
            <span className={badgeClass}>{badgeText}</span>
          </div>

          <div className="cc-subtle" style={{ marginTop: 8 } as any}>
            <b>Starts:</b> {fmtDateTime(a.starts_at)}
            {a.ends_at ? ` • Ends: ${fmtDateTime(a.ends_at)}` : ""}
          </div>

          {a.provider || a.location ? (
            <div className="cc-subtle" style={{ marginTop: 8 } as any}>
              {a.provider ? (
                <>
                  <b>Provider:</b> {a.provider}
                </>
              ) : null}
              {a.provider && a.location ? " • " : null}
              {a.location ? (
                <>
                  <b>Location:</b> {a.location}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="cc-subtle" style={{ marginTop: 10 } as any}>
            {a.notes ? a.notes : "(No notes)"}
          </div>
        </div>

        {props.canEdit ? (
          <div className="cc-row">
            <button className="cc-btn" onClick={props.onEdit}>
              Edit
            </button>
            <button className="cc-btn" onClick={props.onAttend}>
              Attended
            </button>
            <button className="cc-btn" onClick={props.onCancel}>
              Cancel
            </button>
            <button className="cc-btn cc-btn-danger" onClick={props.onDelete}>
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
