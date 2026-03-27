export type TranslationKey =
  | "nav.today"
  | "nav.journal"
  | "nav.messages"
  | "nav.profile"
  | "nav.more"
  | "nav.account"
  | "nav.permissions"
  | "nav.secure_access"
  | "screen.hub"
  | "screen.account"
  | "screen.sign_in"
  | "screen.create_account"
  | "screen.reset_password"
  | "common.email"
  | "common.password"
  | "common.confirm_password"
  | "common.your_language"
  | "common.loading"
  | "common.refresh"
  | "common.save"
  | "common.error"
  | "common.message"
  | "common.back_to_sign_in"
  | "common.forgot_password"
  | "common.create_new_account"
  | "common.send_reset_email"
  | "common.create_account"
  | "common.sign_in"
  | "login.checking_sign_in"
  | "login.signup_subtitle"
  | "login.reset_subtitle"
  | "login.signin_subtitle"
  | "account.language_title"
  | "account.language_subtitle"
  | "account.language_note"
  | "account.save_language"
  | "account.subtitle"
  | "account.secure_access_title"
  | "account.secure_access_subtitle"
  | "account.secure_access_ready"
  | "account.secure_access_not_ready"
  | "account.secure_access_checking"
  | "account.secure_access_help"
  | "account.secure_access_set_up"
  | "account.secure_access_setting_up"
  | "account.secure_access_ready_short"
  | "account.permissions_title"
  | "account.permissions_subtitle"
  | "account.permissions_help"
  | "account.open_permissions"
  | "account.circles_title"
  | "account.circles_subtitle"
  | "account.no_circles"
  | "account.circle"
  | "account.controller"
  | "account.display_name_label"
  | "account.display_name_placeholder"
  | "account.open_secure_access"
  | "account.display_name_help"
  | "account.invite_title"
  | "account.invite_subtitle"
  | "account.invite_not_controller"
  | "account.invite_tools"
  | "account.invalid_patient_id"
  | "account.invite_member"
  | "account.invitee_email"
  | "account.invitee_nickname"
  | "account.invitee_nickname_placeholder"
  | "account.role"
  | "account.expires_days"
  | "account.max_uses"
  | "account.backup_link"
  | "account.copy_link"
  | "account.backup_link_help"
  | "account.invite_entry_help"
  | "account.sign_out_title"
  | "account.sign_out_subtitle"
  | "account.sign_out_help"
  | "account.sign_out_button"
  | "hub.subtitle"
  | "hub.loading_circles"
  | "hub.no_circles_title"
  | "hub.no_circles_subtitle"
  | "hub.my_circle"
  | "hub.open_circle"
  | "hub.today_button"
  | "hub.summary_button"
  | "hub.controller"
  | "hub.you_label"
  | "permissions.title"
  | "permissions.subtitle"
  | "permissions.circle_access"
  | "permissions.circle_access_subtitle"
  | "permissions.circle"
  | "permissions.seed_defaults"
  | "permissions.seeding"
  | "permissions.circle_members"
  | "permissions.circle_members_subtitle"
  | "permissions.no_members_found"
  | "permissions.unnamed_member"
  | "permissions.controller_cannot_be_revoked"
  | "permissions.cannot_revoke_yourself"
  | "permissions.revoke_access"
  | "permissions.revoking"
  | "permissions.role_permissions"
  | "permissions.role_permissions_subtitle"
  | "permissions.no_features_found"
  | "permissions.no_roles_found"
  | "permissions.member_overrides"
  | "permissions.member_overrides_subtitle"
  | "permissions.nothing_to_show"
  | "permissions.allowed"
  | "permissions.denied"
  | "permissions.allow"
  | "permissions.deny"
  | "permissions.clear"
  | "permissions.role_label"
  | "permissions.controller_label"
  | "permissions.you_label"
  | "summary.title"
  | "summary.updated"
  | "summary.immediate_priorities"
  | "summary.immediate_priorities_subtitle"
  | "summary.safety_notes"
  | "summary.allergies"
  | "summary.diagnoses"
  | "summary.communication_essentials"
  | "summary.communication_essentials_subtitle"
  | "summary.communication_notes"
  | "summary.languages_spoken"
  | "summary.advance_planning"
  | "summary.advance_planning_subtitle"
  | "summary.upcoming_appointments"
  | "summary.no_upcoming_appointments"
  | "summary.appointment"
  | "summary.active_medications"
  | "summary.no_active_medications"
  | "summary.medication_logs_last_4_days"
  | "summary.medication_logs_subtitle"
  | "summary.open"
  | "summary.open_logs"
  | "summary.no_medication_logs"
  | "summary.fast_reading_note"
  | "summary.health_lpa"
  | "summary.respect_form"
  | "summary.nominated_advocate"
  | "summary.yes"
  | "summary.no"
  | "summary.holder"
  | "summary.not_recorded"
  | "summary.patient"
  | "today.title"
  | "today.secure_access_not_ready"
  | "today.secure_access_not_ready_subtitle"
  | "today.messages"
  | "today.open"
  | "today.checking"
  | "today.messages_unavailable"
  | "today.direct_message_threads"
  | "today.tap_to_view_messages"
  | "today.no_message_threads"
  | "today.next_24h_appointments"
  | "today.view"
  | "today.none_next_24h"
  | "today.appointment"
  | "today.journal_today"
  | "today.no_journal_entries"
  | "today.shared"
  | "today.private"
  | "today.medication_reminders"
  | "today.no_medication_reminders"
  | "today.due_now"
  | "today.midnight"
  | "today.no_medications"
  | "today.missed_prefix"
  | "today.missed"
  | "today.due"
  | "today.taken"
  | "today.saving"
  | "today.later_today"
  | "today.completed_today"
  | "today.activity_last_24h"
  | "today.no_activity"
  | "today.done"
  | "today.attention"
  | "today.system_notes"
  | "today.unknown"
  | "today.added_journal_entry"
  | "today.logged_medication_as"
  | "today.created"
  | "today.deleted_appointment"
  | "today.updated";

type Dict = Record<TranslationKey, string>;

const EN: Dict = {
  "nav.today": "Today",
  "nav.journal": "Journal",
  "nav.messages": "Messages",
  "nav.profile": "Profile",
  "nav.more": "More",
  "nav.account": "Account",
  "nav.permissions": "Permissions",
  "nav.secure_access": "Secure access",
  "screen.hub": "Hub",
  "screen.account": "Account",
  "screen.sign_in": "Sign in",
  "screen.create_account": "Create your account",
  "screen.reset_password": "Reset password",
  "common.email": "Email",
  "common.password": "Password",
  "common.confirm_password": "Confirm password",
  "common.your_language": "Your language",
  "common.loading": "Loading...",
  "common.refresh": "Refresh",
  "common.save": "Save",
  "common.error": "Error",
  "common.message": "Message",
  "common.back_to_sign_in": "Back to sign in",
  "common.forgot_password": "Forgot password?",
  "common.create_new_account": "Create a new account",
  "common.send_reset_email": "Send reset email",
  "common.create_account": "Create account",
  "common.sign_in": "Sign in",
  "login.checking_sign_in": "Checking your sign-in...",
  "login.signup_subtitle": "Set up your CareCircle account to continue.",
  "login.reset_subtitle": "We'll send you a password reset email.",
  "login.signin_subtitle": "Shared meds, appointments, and care notes - without confusion.",
  "account.language_title": "Your language",
  "account.language_subtitle": "This is saved only to your account.",
  "account.language_note": "Each person keeps their own language setting. Clinician summaries still stay in English for everyone.",
  "account.save_language": "Save language",
  "account.subtitle": "Your CareCircle account",
  "account.secure_access_title": "Secure access on this device",
  "account.secure_access_subtitle": "This device needs secure access before protected circle content can open here.",
  "account.secure_access_ready": "Secure access: ready",
  "account.secure_access_not_ready": "Secure access: not ready",
  "account.secure_access_checking": "Secure access: checking",
  "account.secure_access_help": "Set this device up once, then reopen Secure access for any circle that still is not opening here.",
  "account.secure_access_set_up": "Set up secure access on this device",
  "account.secure_access_setting_up": "Setting up...",
  "account.secure_access_ready_short": "Ready",
  "account.permissions_title": "Permissions",
  "account.permissions_subtitle": "Manage feature access for a circle from one place.",
  "account.permissions_help": "Use permissions to manage who can view or manage journals, appointments, profile, medication logs, messaging, and more. Controllers should always have full management access.",
  "account.open_permissions": "Open permissions",
  "account.circles_title": "Your circles",
  "account.circles_subtitle": "Manage your display name, secure access, and circle tools.",
  "account.no_circles": "No circles yet.",
  "account.circle": "Circle",
  "account.controller": "Controller",
  "account.display_name_label": "Your display name in this circle",
  "account.display_name_placeholder": "Enter the name others should see",
  "account.open_secure_access": "Secure access",
  "account.display_name_help": "Open Secure access for a circle if its protected content is not visible yet. Your nickname is reflected in member and permissions lists.",
  "account.invite_title": "Invite a circle member",
  "account.invite_subtitle": "Controllers can create an email invite and a backup individual invite link.",
  "account.invite_not_controller": "You're not a controller for any circles, so you can't create invite links.",
  "account.invite_tools": "Controller invite tools",
  "account.invalid_patient_id": "invalid patient id",
  "account.invite_member": "Invite member",
  "account.invitee_email": "Invitee email",
  "account.invitee_nickname": "Invitee nickname",
  "account.invitee_nickname_placeholder": "How they should appear in the circle",
  "account.role": "Role",
  "account.expires_days": "Expires (days)",
  "account.max_uses": "Max uses",
  "account.backup_link": "Individual backup invite link",
  "account.copy_link": "Copy link",
  "account.backup_link_help": "This link is unique to this invite. The email invite is attempted automatically as part of the same action.",
  "account.invite_entry_help": "Enter email and nickname, then invite the member. This creates a unique invite link and attempts to send the email automatically.",
  "account.sign_out_title": "Sign out",
  "account.sign_out_subtitle": "Sign out of this device when you're finished.",
  "account.sign_out_help": "This signs you out of your CareCircle session on this device.",
  "account.sign_out_button": "Sign out",
  "hub.subtitle": "All circles you're a member of",
  "hub.loading_circles": "Loading circles...",
  "hub.no_circles_title": "No circles yet",
  "hub.no_circles_subtitle": "You aren't a member of any patient circles.",
  "hub.my_circle": "My Circle",
  "hub.open_circle": "Open this circle",
  "hub.today_button": "Today",
  "hub.summary_button": "Summary",
  "hub.controller": "Controller",
  "hub.you_label": "You",
  "permissions.title": "Permissions",
  "permissions.subtitle": "Roles, member overrides, and access control",
  "permissions.circle_access": "Circle access",
  "permissions.circle_access_subtitle": "Select a circle and manage who can do what.",
  "permissions.circle": "Circle",
  "permissions.seed_defaults": "Seed defaults",
  "permissions.seeding": "Seeding...",
  "permissions.circle_members": "Circle members",
  "permissions.circle_members_subtitle": "Review members and revoke access where needed.",
  "permissions.no_members_found": "No members found.",
  "permissions.unnamed_member": "Unnamed member",
  "permissions.controller_cannot_be_revoked": "Controller cannot be revoked",
  "permissions.cannot_revoke_yourself": "You cannot revoke yourself",
  "permissions.revoke_access": "Revoke access",
  "permissions.revoking": "Revoking...",
  "permissions.role_permissions": "Role permissions",
  "permissions.role_permissions_subtitle": "Default access for each role in this circle.",
  "permissions.no_features_found": "No features found.",
  "permissions.no_roles_found": "No roles found.",
  "permissions.member_overrides": "Member overrides",
  "permissions.member_overrides_subtitle": "Adjust one member without changing the whole role.",
  "permissions.nothing_to_show": "Nothing to show yet.",
  "permissions.allowed": "Allowed",
  "permissions.denied": "Denied",
  "permissions.allow": "Allow",
  "permissions.deny": "Deny",
  "permissions.clear": "Clear",
  "permissions.role_label": "Role",
  "permissions.controller_label": "Controller",
  "permissions.you_label": "You",
  "summary.title": "Clinician summary",
  "summary.updated": "Updated",
  "summary.immediate_priorities": "Immediate clinical priorities",
  "summary.immediate_priorities_subtitle": "Most important items first.",
  "summary.safety_notes": "Safety notes",
  "summary.allergies": "Allergies",
  "summary.diagnoses": "Diagnoses",
  "summary.communication_essentials": "Communication essentials",
  "summary.communication_essentials_subtitle": "Helpful for direct interaction and handover.",
  "summary.communication_notes": "Communication notes",
  "summary.languages_spoken": "Languages spoken",
  "summary.advance_planning": "Advance planning",
  "summary.advance_planning_subtitle": "Important representation and decision-making details.",
  "summary.upcoming_appointments": "Upcoming appointments",
  "summary.no_upcoming_appointments": "No upcoming appointments.",
  "summary.appointment": "Appointment",
  "summary.active_medications": "Active medications",
  "summary.no_active_medications": "No active medications.",
  "summary.medication_logs_last_4_days": "Medication logs - last 4 days",
  "summary.medication_logs_subtitle": "Recent medication activity for quick review.",
  "summary.open": "Open",
  "summary.open_logs": "Open logs",
  "summary.no_medication_logs": "No medication logs in the last 4 days.",
  "summary.fast_reading_note": "This summary is designed for fast reading by permitted members without vault unlock.",
  "summary.health_lpa": "Health and Wellbeing Power of Attorney",
  "summary.respect_form": "RESPECT form or Emergency Care Plan",
  "summary.nominated_advocate": "Nominated Advocate",
  "summary.yes": "Yes",
  "summary.no": "No",
  "summary.holder": "Holder",
  "summary.not_recorded": "Not recorded",
  "summary.patient": "Patient",
  "today.title": "Today",
  "today.secure_access_not_ready": "Secure access is not ready on this device",
  "today.secure_access_not_ready_subtitle": "You can still browse basic information, but protected details will appear once this device finishes secure setup.",
  "today.messages": "Messages",
  "today.open": "Open",
  "today.checking": "Checking...",
  "today.messages_unavailable": "Messages currently unavailable.",
  "today.direct_message_threads": "direct message threads",
  "today.tap_to_view_messages": "Tap to view recent messages.",
  "today.no_message_threads": "No message threads yet.",
  "today.next_24h_appointments": "Next 24h appointments",
  "today.view": "View",
  "today.none_next_24h": "None in the next 24 hours.",
  "today.appointment": "Appointment",
  "today.journal_today": "Today's journal",
  "today.no_journal_entries": "No journal entries yet today.",
  "today.shared": "shared",
  "today.private": "private",
  "today.medication_reminders": "Medication reminders",
  "today.no_medication_reminders": "No medication reminders set.",
  "today.due_now": "Due now / overdue",
  "today.midnight": "Midnight",
  "today.no_medications": "No medications",
  "today.missed_prefix": "Missed",
  "today.missed": "Missed",
  "today.due": "Due",
  "today.taken": "Taken",
  "today.saving": "Saving...",
  "today.later_today": "Later today",
  "today.completed_today": "Completed today",
  "today.activity_last_24h": "Activity trail - last 24 hours",
  "today.no_activity": "No recorded activity in the last 24 hours.",
  "today.done": "Done",
  "today.attention": "Attention",
  "today.system_notes": "System notes",
  "today.unknown": "Unknown",
  "today.added_journal_entry": "Added a journal entry",
  "today.logged_medication_as": "Logged medication as",
  "today.created": "Created",
  "today.deleted_appointment": "Deleted appointment",
  "today.updated": "Updated",
};

const IT: Partial<Dict> = {
  "nav.today": "Oggi",
  "nav.journal": "Diario",
  "nav.messages": "Messaggi",
  "nav.profile": "Profilo",
  "nav.more": "Altro",
  "nav.account": "Account",
  "nav.permissions": "Permessi",
  "nav.secure_access": "Accesso sicuro",
  "screen.hub": "Hub",
  "screen.account": "Account",
  "screen.sign_in": "Accedi",
  "screen.create_account": "Crea il tuo account",
  "screen.reset_password": "Reimposta password",
  "common.email": "Email",
  "common.password": "Password",
  "common.confirm_password": "Conferma password",
  "common.your_language": "La tua lingua",
  "common.loading": "Caricamento...",
  "common.refresh": "Aggiorna",
  "common.save": "Salva",
  "common.error": "Errore",
  "common.message": "Messaggio",
  "common.back_to_sign_in": "Torna all'accesso",
  "common.forgot_password": "Hai dimenticato la password?",
  "common.create_new_account": "Crea un nuovo account",
  "common.send_reset_email": "Invia email di ripristino",
  "common.create_account": "Crea account",
  "common.sign_in": "Accedi",
  "login.checking_sign_in": "Controllo dell'accesso...",
  "login.signup_subtitle": "Configura il tuo account CareCircle per continuare.",
  "login.reset_subtitle": "Ti invieremo un'email per reimpostare la password.",
  "login.signin_subtitle": "Farmaci, appuntamenti e note di assistenza condivisi - senza confusione.",
  "account.language_title": "La tua lingua",
  "account.language_subtitle": "Questa impostazione viene salvata solo sul tuo account.",
  "account.language_note": "Ogni persona mantiene la propria lingua. Il riepilogo clinico resta sempre in inglese.",
  "account.save_language": "Salva lingua",
  "account.subtitle": "Il tuo account CareCircle",
  "account.secure_access_title": "Accesso sicuro su questo dispositivo",
  "account.secure_access_subtitle": "Questo dispositivo ha bisogno dell'accesso sicuro prima che i contenuti protetti del cerchio possano aprirsi qui.",
  "account.secure_access_ready": "Accesso sicuro: pronto",
  "account.secure_access_not_ready": "Accesso sicuro: non pronto",
  "account.secure_access_checking": "Accesso sicuro: verifica",
  "account.secure_access_help": "Configura questo dispositivo una sola volta, poi riapri Accesso sicuro per qualsiasi cerchio che ancora non si apre qui.",
  "account.secure_access_set_up": "Configura l'accesso sicuro su questo dispositivo",
  "account.secure_access_setting_up": "Configurazione in corso...",
  "account.secure_access_ready_short": "Pronto",
  "account.permissions_title": "Permessi",
  "account.permissions_subtitle": "Gestisci l'accesso alle funzioni di un cerchio da un unico posto.",
  "account.permissions_help": "Usa i permessi per gestire chi puo vedere o gestire diario, appuntamenti, profilo, registri farmaci, messaggi e altro. I controller dovrebbero sempre avere accesso completo.",
  "account.open_permissions": "Apri permessi",
  "account.circles_title": "I tuoi cerchi",
  "account.circles_subtitle": "Gestisci il tuo nome visibile, l'accesso sicuro e gli strumenti del cerchio.",
  "account.no_circles": "Ancora nessun cerchio.",
  "account.circle": "Cerchio",
  "account.controller": "Controller",
  "account.display_name_label": "Il tuo nome visibile in questo cerchio",
  "account.display_name_placeholder": "Inserisci il nome che gli altri devono vedere",
  "account.open_secure_access": "Accesso sicuro",
  "account.display_name_help": "Apri Accesso sicuro per un cerchio se i suoi contenuti protetti non sono ancora visibili. Il tuo soprannome compare negli elenchi membri e permessi.",
  "account.invite_title": "Invita un membro del cerchio",
  "account.invite_subtitle": "I controller possono creare un invito email e un link individuale di riserva.",
  "account.invite_not_controller": "Non sei controller di nessun cerchio, quindi non puoi creare link di invito.",
  "account.invite_tools": "Strumenti invito del controller",
  "account.invalid_patient_id": "id paziente non valido",
  "account.invite_member": "Invita membro",
  "account.invitee_email": "Email dell'invitato",
  "account.invitee_nickname": "Soprannome dell'invitato",
  "account.invitee_nickname_placeholder": "Come dovrebbe apparire nel cerchio",
  "account.role": "Ruolo",
  "account.expires_days": "Scade (giorni)",
  "account.max_uses": "Usi massimi",
  "account.backup_link": "Link di invito individuale di riserva",
  "account.copy_link": "Copia link",
  "account.backup_link_help": "Questo link e unico per questo invito. L'invito email viene tentato automaticamente come parte della stessa azione.",
  "account.invite_entry_help": "Inserisci email e soprannome, poi invita il membro. Questo crea un link di invito unico e prova a inviare l'email automaticamente.",
  "account.sign_out_title": "Esci",
  "account.sign_out_subtitle": "Esci da questo dispositivo quando hai finito.",
  "account.sign_out_help": "Questo ti disconnette dalla tua sessione CareCircle su questo dispositivo.",
  "account.sign_out_button": "Esci",
  "hub.subtitle": "Tutti i cerchi di cui fai parte",
  "hub.loading_circles": "Caricamento cerchi...",
  "hub.no_circles_title": "Nessun cerchio",
  "hub.no_circles_subtitle": "Non fai parte di alcun cerchio paziente.",
  "hub.my_circle": "Il mio cerchio",
  "hub.open_circle": "Apri questo cerchio",
  "hub.today_button": "Oggi",
  "hub.summary_button": "Riepilogo",
  "hub.controller": "Controller",
  "hub.you_label": "Tu",
  "permissions.title": "Permessi",
  "permissions.subtitle": "Ruoli, eccezioni per membri e controllo accessi",
  "permissions.circle_access": "Accesso al cerchio",
  "permissions.circle_access_subtitle": "Seleziona un cerchio e gestisci chi puo fare cosa.",
  "permissions.circle": "Cerchio",
  "permissions.seed_defaults": "Carica predefiniti",
  "permissions.seeding": "Caricamento...",
  "permissions.circle_members": "Membri del cerchio",
  "permissions.circle_members_subtitle": "Controlla i membri e revoca l'accesso quando serve.",
  "permissions.no_members_found": "Nessun membro trovato.",
  "permissions.unnamed_member": "Membro senza nome",
  "permissions.controller_cannot_be_revoked": "Il controller non puo essere revocato",
  "permissions.cannot_revoke_yourself": "Non puoi revocare te stesso",
  "permissions.revoke_access": "Revoca accesso",
  "permissions.revoking": "Revoca in corso...",
  "permissions.role_permissions": "Permessi dei ruoli",
  "permissions.role_permissions_subtitle": "Accesso predefinito per ogni ruolo in questo cerchio.",
  "permissions.no_features_found": "Nessuna funzione trovata.",
  "permissions.no_roles_found": "Nessun ruolo trovato.",
  "permissions.member_overrides": "Eccezioni per membri",
  "permissions.member_overrides_subtitle": "Modifica un membro senza cambiare l'intero ruolo.",
  "permissions.nothing_to_show": "Ancora niente da mostrare.",
  "permissions.allowed": "Consentito",
  "permissions.denied": "Negato",
  "permissions.allow": "Consenti",
  "permissions.deny": "Nega",
  "permissions.clear": "Cancella",
  "permissions.role_label": "Ruolo",
  "permissions.controller_label": "Controller",
  "permissions.you_label": "Tu",
  "summary.title": "Riepilogo clinico",
  "summary.updated": "Aggiornato",
  "summary.immediate_priorities": "Priorita cliniche immediate",
  "summary.immediate_priorities_subtitle": "Gli elementi piu importanti per primi.",
  "summary.safety_notes": "Note di sicurezza",
  "summary.allergies": "Allergie",
  "summary.diagnoses": "Diagnosi",
  "summary.communication_essentials": "Elementi essenziali di comunicazione",
  "summary.communication_essentials_subtitle": "Utili per interazione diretta e consegne.",
  "summary.communication_notes": "Note di comunicazione",
  "summary.languages_spoken": "Lingue parlate",
  "summary.advance_planning": "Pianificazione anticipata",
  "summary.advance_planning_subtitle": "Dettagli importanti su rappresentanza e decisioni.",
  "summary.upcoming_appointments": "Prossimi appuntamenti",
  "summary.no_upcoming_appointments": "Nessun appuntamento in arrivo.",
  "summary.appointment": "Appuntamento",
  "summary.active_medications": "Farmaci attivi",
  "summary.no_active_medications": "Nessun farmaco attivo.",
  "summary.medication_logs_last_4_days": "Registri farmaci - ultimi 4 giorni",
  "summary.medication_logs_subtitle": "Attivita recente dei farmaci per una revisione rapida.",
  "summary.open": "Apri",
  "summary.open_logs": "Apri registri",
  "summary.no_medication_logs": "Nessun registro farmaci negli ultimi 4 giorni.",
  "summary.fast_reading_note": "Questo riepilogo e pensato per una lettura rapida dai membri autorizzati senza sblocco dell'accesso sicuro.",
  "summary.health_lpa": "Procura per salute e benessere",
  "summary.respect_form": "Modulo RESPECT o piano di emergenza",
  "summary.nominated_advocate": "Difensore nominato",
  "summary.yes": "Si",
  "summary.no": "No",
  "summary.holder": "Titolare",
  "summary.not_recorded": "Non registrato",
  "summary.patient": "Paziente",
  "today.title": "Oggi",
  "today.secure_access_not_ready": "L'accesso sicuro non e pronto su questo dispositivo",
  "today.secure_access_not_ready_subtitle": "Puoi comunque vedere le informazioni di base, ma i dettagli protetti compariranno quando questo dispositivo avra completato la configurazione sicura.",
  "today.messages": "Messaggi",
  "today.open": "Apri",
  "today.checking": "Controllo...",
  "today.messages_unavailable": "Messaggi attualmente non disponibili.",
  "today.direct_message_threads": "thread di messaggi diretti",
  "today.tap_to_view_messages": "Tocca per vedere i messaggi recenti.",
  "today.no_message_threads": "Nessun thread di messaggi.",
  "today.next_24h_appointments": "Appuntamenti nelle prossime 24 ore",
  "today.view": "Vedi",
  "today.none_next_24h": "Nessuno nelle prossime 24 ore.",
  "today.appointment": "Appuntamento",
  "today.journal_today": "Diario di oggi",
  "today.no_journal_entries": "Ancora nessuna voce nel diario oggi.",
  "today.shared": "condiviso",
  "today.private": "privato",
  "today.medication_reminders": "Promemoria farmaci",
  "today.no_medication_reminders": "Nessun promemoria farmaci impostato.",
  "today.due_now": "Da fare ora / in ritardo",
  "today.midnight": "Mezzanotte",
  "today.no_medications": "Nessun farmaco",
  "today.missed_prefix": "Mancati",
  "today.missed": "Mancato",
  "today.due": "Da fare",
  "today.taken": "Preso",
  "today.saving": "Salvataggio...",
  "today.later_today": "Più tardi oggi",
  "today.completed_today": "Completato oggi",
  "today.activity_last_24h": "Attivita - ultime 24 ore",
  "today.no_activity": "Nessuna attivita registrata nelle ultime 24 ore.",
  "today.done": "Fatto",
  "today.attention": "Attenzione",
  "today.system_notes": "Note di sistema",
  "today.unknown": "Sconosciuto",
  "today.added_journal_entry": "Ha aggiunto una voce di diario",
  "today.logged_medication_as": "Ha registrato il farmaco come",
  "today.created": "Creato",
  "today.deleted_appointment": "Appuntamento eliminato",
  "today.updated": "Aggiornato",
};

const DICTS: Record<string, Partial<Dict>> = {
  it: IT,
};

export function t(languageCode: string, key: TranslationKey) {
  return DICTS[languageCode]?.[key] ?? EN[key];
}
