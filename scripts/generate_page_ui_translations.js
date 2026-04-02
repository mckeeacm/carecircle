const fs = require("fs");
const path = require("path");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is missing");

const outPath = path.join(__dirname, "..", "lib", "pageUi.ts");

const languages = [
  { code: "pl", label: "Polish" },
  { code: "ro", label: "Romanian" },
  { code: "pa", label: "Punjabi" },
  { code: "ur", label: "Urdu" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "ar", label: "Arabic (Modern Standard)" },
  { code: "arz", label: "Arabic (Egyptian)" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "it", label: "Italian" },
  { code: "ckb", label: "Kurdish (Sorani)" },
  { code: "fa", label: "Persian (Farsi)" },
  { code: "tr", label: "Turkish" },
  { code: "ta", label: "Tamil" },
  { code: "cy", label: "Welsh" },
  { code: "uk", label: "Ukrainian" },
];

const pages = {
  onboarding: {
    welcome: "Welcome",
    loadingSetup: "Loading your setup...",
    loadingOnboarding: "Loading onboarding...",
    intro: "Let's get this device set up properly for your circle.",
    hub: "Hub",
    message: "Message",
    setupSteps: "Setup steps",
    joinFromInvite: "Join circle from invite",
    chooseCircleStep: "Create or select a circle",
    secureAccessStep: "Set up secure access",
    profileStep: "Set up the circle profile",
    permissionsStep: "Permissions defaults",
    finish: "Finish",
    selectedCircle: "Selected circle",
    role: "Role",
    controller: "controller",
    deviceKey: "Device key",
    ok: "OK",
    needsAttention: "needs attention",
    shareRow: "Share row",
    present: "present",
    missing: "missing",
    cachedVault: "Cached vault",
    controllerLabel: "Controller",
    trueText: "true",
    falseText: "false",
    joiningCircle: "Joining your circle",
    joiningDesc: "We're accepting your invite and linking you to the circle.",
    checkingSignIn: "Checking sign-in...",
    acceptingInvite: "Accepting invite...",
    keepOpen: "Please keep this page open.",
    signInRequired: "Sign in required",
    signInRequiredDesc: "Please sign in first, then reopen your invite link.",
    tryAgain: "Try again",
    alreadyLinked: "You're already linked to this circle.",
    joinedCircle: "You've joined the circle.",
    chooseCircle: "Choose your circle",
    chooseCircleDesc: "Select an existing circle, or create a new one here.",
    yourCircles: "Your circles",
    select: "Select...",
    orCreateBelow: "Or create a new circle below.",
    newCircleName: "New circle name",
    circleNamePlaceholder: "Circle name",
    creating: "Creating...",
    createCircle: "Create circle",
    secureAccessTitle: "Set up secure access",
    secureAccessDesc: "This device needs secure access before protected notes, profile details, and messages work properly.",
    whatHappensHere: "What happens here",
    whatHappensHereDesc: "1. This device gets registered for secure access. 2. Your circle share is matched to this device. 3. The app finishes setup automatically and keeps this device ready.",
    secureSetupAgain: "This device needs secure setup again",
    secureSetupAgainDesc: "This device's local secure setup does not match the one registered for your account. Reset secure access on this device, then continue.",
    secureNeedsRefreshing: "Secure access needs refreshing",
    secureNeedsRefreshingDesc: "This circle share was created for an older device setup. Reset secure access on this device, then ask the circle owner to share access again.",
    deviceReady: "This device is ready",
    settingUp: "Setting up...",
    setUpSecureAccessDevice: "Set up secure access on this device",
    resetting: "Resetting...",
    resetSecureAccessDevice: "Reset secure access on this device",
    setUpSecureAccessCircle: "Set up secure access for this circle",
    sharing: "Sharing...",
    shareSecureAccessMembers: "Share secure access to members",
    nonControllerReshareHelp: "If this device was reset, the circle owner needs to share secure access to you again before protected content can open.",
    finishingSetup: "Finishing setup...",
    finishSecureSetupDevice: "Finish secure setup on this device",
    stayHereUntilReady: "This page stays here until device setup, circle access, and local secure access are all ready.",
    profileTitle: "Set up the circle profile",
    profileDesc: "Now that secure access is ready, add the basic details here.",
    communicationNotes: "Communication notes",
    communicationPlaceholder: "Communication preferences",
    allergies: "Allergies",
    allergiesPlaceholder: "Known allergies",
    diagnoses: "Diagnoses",
    diagnosesPlaceholder: "Relevant diagnoses",
    languagesSpoken: "Languages spoken",
    languagesSpokenPlaceholder: "Languages spoken",
    safetyNotes: "Safety notes",
    safetyPlaceholder: "Important safety information",
    saving: "Saving...",
    saveContinue: "Save and continue",
    permissionsTitle: "Permissions defaults",
    permissionsDesc: "As controller, seed the default permissions now.",
    seeding: "Seeding...",
    seedDefaults: "Seed defaults",
    openPermissionsPage: "Open permissions page",
    onboardingComplete: "Once defaults are seeded, onboarding is complete.",
    readyTitle: "You're ready",
    readyDesc: "This device is set up and your circle is ready to use.",
    goToHub: "Go to Hub",
    permissionsManaged: "Permissions in this circle are managed by the controller."
  },
  appointments: {
    title: "Appointments",
    subtitle: "Plan and track care appointments",
    today: "Today",
    error: "Error",
    secureTitle: "Secure access is not ready on this device",
    secureSubtitle: "Protected appointment notes will become available once this device finishes secure setup.",
    newAppointment: "New appointment",
    newAppointmentSubtitle: "Create an appointment in a clearer, more practical order.",
    loading: "Loading...",
    refresh: "Refresh",
    details: "Appointment details",
    transport: "Transport",
    encryptedNotes: "Encrypted notes",
    createAppointment: "Create appointment",
    saving: "Saving..."
  },
  medicationLogs: {
    title: "Medication logs",
    subtitle: "Track medication activity",
    medicationsSelected: "medications selected",
    today: "Today",
    error: "Error",
    secureTitle: "Secure access is not ready on this device",
    secureSubtitle: "Protected notes will become available once this device finishes secure setup.",
    quickLog: "Quick log",
    quickLogSubtitle: "Tap one or more medications, choose a status, and save.",
    loading: "Loading...",
    refresh: "Refresh",
    noActiveMeds: "No active medications",
    noActiveMedsSubtitle: "There are no active medications to log yet.",
    medication: "Medication",
    status: "Status",
    note: "Note (encrypted, optional)",
    optionalNote: "Optional note...",
    saveLog: "Save log",
    saving: "Saving...",
    remindersTitle: "Medication reminders",
    remindersSubtitle: "Create reminders for one medication or a group, such as Evening meds.",
    remindersAndroid: "On Android app builds, active reminders are also scheduled as device notifications.",
    todaysReminderStatus: "Today's reminder status",
    upcoming: "Upcoming",
    dueNow: "Due now",
    midnight: "Midnight",
    noReminderMeds: "No medications",
    missedLabel: "Missed",
    takenAction: "Taken",
    reminderSaving: "Saving...",
    newReminder: "New reminder",
    reminderName: "Reminder name",
    reminderNamePlaceholder: "e.g. Evening meds",
    time: "Time",
    includedMedications: "Included medications",
    saveReminder: "Save reminder",
    reminderStorage: "This stores reminder schedules and syncs them to Android notifications when available.",
    noReminders: "No reminders yet.",
    active: "Active",
    paused: "Paused",
    pause: "Pause",
    activate: "Activate",
    delete: "Delete",
    recentLogs: "Recent logs",
    recentLogsSubtitle: "Latest medication activity for this circle.",
    noLogs: "No logs yet.",
    loggedBy: "Logged by",
    decrypted: "Decrypted",
    decryptNote: "Decrypt note",
    noNote: "No note"
  },
  vaultInit: {
    title: "Secure access",
    loadingTitle: "Loading secure circle access",
    account: "Account",
    hub: "Hub",
    message: "Message",
    loadingCard: "Checking secure access...",
    signedInAs: "Signed in as",
    secureAccess: "Circle secure access",
    fixAction: "Fix secure access",
    fixingAction: "Fixing secure access...",
    continueToday: "Continue to Today",
    whatThisDoes: "What this does",
    whatThisDoesText: "This page automatically checks your device key, secure share, and vault access for this circle, then completes setup where possible.",
    advanced: "Advanced troubleshooting",
    hide: "Hide",
    show: "Show",
    deviceKey: "Device key",
    shareRow: "Share row",
    cachedVault: "Cached vault",
    controller: "Controller",
    ok: "OK",
    unknown: "unknown",
    missing: "missing",
    present: "present",
    trueLabel: "true",
    falseLabel: "false",
    refreshStatus: "Refresh status",
    resetDevice: "Reset this device",
    resetting: "Resetting...",
    shareReady: "Share to ready members",
    sharing: "Sharing...",
    dangerZone: "Danger zone",
    dangerText: "Creating a NEW circle key can leave older encrypted content tied to the previous key.",
    newKey: "Initialise NEW secure key",
    rekeying: "Rekeying..."
  },
  profile: {
    title: "Profile",
    summary: "Summary",
    message: "Message",
    secureTitle: "Secure access is not ready on this device",
    secureSubtitle: "Detailed profile fields are not available on this device yet.",
    detailsTitle: "Profile details",
    detailsSubtitle: "Keep detailed notes and the clinician summary aligned without double entry. The summary always stays in English.",
    copyAll: "Copy all to English summary",
    copying: "Copying...",
    refresh: "Refresh",
    loading: "Loading...",
    saveProfile: "Save profile",
    saving: "Saving...",
    lastUpdated: "Last updated",
    noProfile: "No profile record yet.",
    advanceTitle: "Advance planning",
    advanceSubtitle: "Record key decision-making and representation details for handover and care.",
    detailedNotes: "Detailed profile notes",
    detailedNotesSubtitle: "Sensitive circle information that opens when secure access is ready.",
    clinicianPreview: "Clinician summary preview",
    clinicianPreviewText: "These summary fields stay in English for permitted members, even if detailed notes are not open here yet.",
    openSummary: "Open summary",
    medications: "Medications",
    medicationsSubtitle: "Used by Medication logs.",
    openLogs: "Open logs",
    addMedication: "Add medication",
    name: "Name",
    dosage: "Dosage",
    scheduleText: "Schedule text",
    addMedicationAction: "Add medication",
    adding: "Adding...",
    optional: "Optional",
    noMedications: "No medications yet.",
    dash: "-"
  },
  dm: {
    defaultThreadTitle: "Direct message",
    threadDecryptError: "This conversation could not be opened on this device.",
    messageDecryptError: "This message could not be opened on this device.",
    rolePatient: "patient",
    roleCarer: "carer",
    roleFamily: "family",
    roleMember: "member",
    controllerSuffix: ", controller",
    you: "You",
    protectedConversation: "Protected conversation",
    protectedPreview: "Protected preview",
    title: "Direct messages",
    subtitle: "Private 1-to-1 messages for this circle",
    today: "Today",
    error: "Error",
    secureTitle: "Secure access is not ready on this device",
    secureSubtitle: "Private messages are not available yet for this person on this device.",
    introTitle: "Private 1-to-1 direct messages",
    introBody: "This page is for private messages between two circle members. Messages stay protected automatically.",
    threads: "Threads",
    loading: "Loading...",
    refresh: "Refresh",
    newThread: "New direct message",
    who: "Who do you want to message?",
    selectMember: "Select a circle member...",
    conversationTitle: "Conversation title",
    openDirectMessage: "Open direct message",
    noThreads: "No direct message threads yet.",
    lastMessage: "Last message",
    created: "Created",
    messages: "Messages",
    noThreadSelected: "No thread selected",
    selectThread: "Select or open a direct message thread.",
    loadingMessages: "Loading messages...",
    noMessages: "No messages yet.",
    helper: "This creates a private thread between you and one other circle member.",
    open: "Open",
    view: "View",
    protectedMessage: "Protected message",
    newMessage: "New message",
    messagePlaceholder: "Write your message here...",
    sending: "Sending...",
    send: "Send"
  },
  journals: {
    moodLabels: {
      Sad: "Sad",
      Low: "Low",
      Okay: "Okay",
      Good: "Good",
      Great: "Great"
    },
    journalTitleOptions: {
      incident_report: "Incident Report",
      general_report: "General Report",
      activity: "Activities"
    },
    incidentTypes: {
      "Behaviour incident": "Behaviour incident",
      Fall: "Fall",
      "Medication issue": "Medication issue",
      Injury: "Injury",
      "Safeguarding concern": "Safeguarding concern",
      "Health deterioration": "Health deterioration",
      "Missing person / absconding": "Missing person / absconding",
      "Property damage": "Property damage",
      "Visitor issue": "Visitor issue",
      Other: "Other"
    },
    activityTypes: {
      Bathing: "Bathing",
      "Bed Rail Check": "Bed Rail Check",
      Behaviour: "Behaviour",
      "Blood Pressure": "Blood Pressure",
      "Blood Glucose": "Blood Glucose",
      "Bowel Movement": "Bowel Movement",
      "Enteral Feeding": "Enteral Feeding",
      Falls: "Falls",
      "Fluid Output": "Fluid Output",
      "Fluids Drink": "Fluids Drink",
      Infection: "Infection",
      "Night Checks": "Night Checks",
      "Nurse Notes": "Nurse Notes",
      "Nutrition (Meal)": "Nutrition (Meal)",
      "Sanitary Change": "Sanitary Change",
      "Medication Given": "Medication Given",
      "Medication Refused": "Medication Refused",
      Mobility: "Mobility",
      Observation: "Observation",
      "Personal Care": "Personal Care",
      "Pressure Area Care": "Pressure Area Care",
      "Sleep Check": "Sleep Check",
      Toileting: "Toileting",
      Vitals: "Vitals",
      "Wound Care": "Wound Care"
    },
    journalTypeLabels: {
      tracker: "Tracker log",
      incident_report: "Incident Report",
      general_report: "General Report",
      activity: "Activity",
      journal: "Journal"
    },
    saveIncidentReport: "Save incident report",
    saveGeneralReport: "Save general report",
    saveActivity: "Save activity",
    title: "Journal",
    today: "Today",
    error: "Error",
    secureTitle: "Secure access is not ready on this device",
    secureSubtitle: "Protected journal details will appear once this device finishes secure setup.",
    allEntries: "All entries",
    circleFeed: "Circle feed",
    loading: "Loading...",
    refresh: "Refresh",
    trackersTitle: "Today's trackers",
    trackersSubtitle: "Mood, pain and sobriety are saved together as one tracker log.",
    mood: "Mood",
    pain: "Pain",
    sobriety: "Sobriety",
    yes: "Yes",
    no: "No",
    shareTracker: "Share tracker log to circle journal",
    saveTrackers: "Save trackers",
    newEntry: "New entry",
    newEntrySubtitle: "Choose a journal title and complete the matching form.",
    editEntry: "Edit entry",
    editEntrySubtitle: "Update this entry and save your changes.",
    cancelEdit: "Cancel edit",
    updateEntry: "Update entry",
    journalTitle: "Journal title",
    shareToCircle: "Share to circle",
    nonPatientShared: "Entries from non-patient members are always shared to the circle.",
    recentEntries: "Recent entries",
    noSharedEntries: "No shared entries yet.",
    noEntries: "No entries yet.",
    date: "Date",
    time: "Time",
    location: "Location",
    locationPlaceholder: "e.g. Bedroom, dining room, garden",
    incidentType: "Type of incident",
    description: "Description",
    descriptionPlaceholder: "Short summary of what happened.",
    personsInvolved: "Full details of the persons involved",
    personsInvolvedPlaceholder: "Names, roles, injuries, actions taken.",
    witnesses: "Witnesses",
    witnessesPlaceholder: "Witnesses, statements, or note none.",
    uploadPhotos: "Upload photos",
    existingPhoto: "existing photo.",
    existingPhotos: "existing photos.",
    photoSelected: "photo selected.",
    photosSelected: "photos selected.",
    generalReport: "General report",
    generalReportPlaceholder: "Write the full report here.",
    activity: "Activity",
    incidentReported: "Incident reported?",
    optionalNote: "Optional note",
    optionalNotePlaceholder: "Add a short note if needed.",
    saving: "Saving...",
    roleLabel: "Role",
    shared: "shared",
    private: "private",
    painTag: "pain",
    you: "you",
    hide: "Hide",
    open: "Open",
    opening: "Opening...",
    comments: "Comments",
    loadingComments: "Loading comments...",
    noComments: "No comments yet.",
    editComment: "Edit comment",
    commentPlaceholder: "Add a comment...",
    savingComment: "Saving comment...",
    updateComment: "Update comment",
    addComment: "Add comment",
    edited: "edited",
    personsInvolvedShort: "Persons involved",
    photos: "Photos",
    noAdditionalNote: "No additional note."
  }
};

function serialize(name, obj) {
  return `export const ${name} = ${JSON.stringify(obj, null, 2)} as const;\n`;
}

function parseJsonObject(text, langLabel) {
  const trimmed = (text || "").trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error(`No JSON for ${langLabel}`);
  return JSON.parse(candidate.slice(first, last + 1));
}

function buildPrompt(base, langLabel) {
  return [
    "Translate the values in this JSON object for a healthcare/caregiving app UI.",
    `Target language: ${langLabel}.`,
    "Keep every key unchanged.",
    "Preserve placeholders, punctuation, and ellipses.",
    "Return one valid JSON object only, with no markdown fences or commentary.",
    "Do not translate CareCircle.",
    JSON.stringify(base),
  ].join("\n\n");
}

function readExistingOutput() {
  const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  const existingObjects = {};
  if (existing) {
    for (const pageName of Object.keys(pages)) {
      const re = new RegExp(`export const ${pageName}PageUi = (\\{[\\s\\S]*?\\}) as const;`);
      const m = existing.match(re);
      if (m) existingObjects[pageName] = JSON.parse(m[1]);
    }
  }
  return existingObjects;
}

function writeOutput(existingObjects) {
  let out = 'import { normaliseLanguageCode } from "@/lib/languages";\n\n';
  out += `export type PageUiName = ${Object.keys(pages).map((p) => JSON.stringify(p)).join(" | ")};\n\n`;
  for (const pageName of Object.keys(pages)) {
    out += serialize(`${pageName}PageUi`, existingObjects[pageName] || { en: pages[pageName] });
    out += "\n";
  }
  out += `const PAGE_UI = {\n${Object.keys(pages).map((p) => `  ${p}: ${p}PageUi,`).join("\n")}\n} as const;\n\n`;
  out += `export function getPageUi(name: PageUiName, languageCode: string | null | undefined) {\n  const code = normaliseLanguageCode(languageCode);\n  const dict = PAGE_UI[name] as Record<string, Record<string, string>>;\n  return dict[code] ?? dict.en;\n}\n`;
  fs.writeFileSync(outPath, out, "utf8");
}

async function translate(base, langLabel) {
  const attempts = [
    buildPrompt(base, langLabel),
    `${buildPrompt(base, langLabel)}\n\nIMPORTANT: Respond with raw JSON only. Start with { and end with }.`,
  ];
  let lastError = null;

  for (const prompt of attempts) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model: "gpt-5-nano", input: prompt }),
    });
    if (!res.ok) throw new Error(`${langLabel} request failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const text = data.output_text || data.output?.flatMap((i) => i.content || []).map((c) => c.text || "").join("") || "";
    try {
      return parseJsonObject(text, langLabel);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`No JSON for ${langLabel}`);
}

async function main() {
  const existingObjects = readExistingOutput();
  const targetPages = (process.env.TARGET_PAGES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const selectedEntries = Object.entries(pages).filter(([pageName]) =>
    targetPages.length === 0 ? true : targetPages.includes(pageName)
  );

  for (const [pageName, base] of selectedEntries) {
    existingObjects[pageName] = existingObjects[pageName] || { en: base };
    for (const lang of languages) {
      if (existingObjects[pageName][lang.code]) {
        console.log(`Skipping ${pageName} -> ${lang.code}`);
        continue;
      }
      console.log(`Translating ${pageName} -> ${lang.code}`);
      existingObjects[pageName][lang.code] = await translate(base, lang.label);
      writeOutput(existingObjects);
    }
  }
  writeOutput(existingObjects);
  console.log(`Updated ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
