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
  | "hub.subtitle"
  | "hub.loading_circles"
  | "hub.no_circles_title"
  | "hub.no_circles_subtitle"
  | "hub.my_circle";

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
  "hub.subtitle": "All circles you're a member of",
  "hub.loading_circles": "Loading circles...",
  "hub.no_circles_title": "No circles yet",
  "hub.no_circles_subtitle": "You aren't a member of any patient circles.",
  "hub.my_circle": "My Circle",
};

const DICTS: Record<string, Partial<Dict>> = {
  it: {
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
    "login.signin_subtitle": "Farmaci, appuntamenti e note di assistenza - senza confusione.",
    "account.language_title": "La tua lingua",
    "account.language_subtitle": "Questa impostazione viene salvata solo sul tuo account.",
    "account.language_note": "Ogni persona mantiene la propria lingua. Il riepilogo clinico resta sempre in inglese.",
    "account.save_language": "Salva lingua",
    "hub.subtitle": "Tutti i cerchi di cui fai parte",
    "hub.loading_circles": "Caricamento cerchi...",
    "hub.no_circles_title": "Nessun cerchio",
    "hub.no_circles_subtitle": "Non fai parte di alcun cerchio paziente.",
    "hub.my_circle": "Il mio cerchio",
  },
  pl: {
    "nav.today": "Dzisiaj",
    "nav.journal": "Dziennik",
    "nav.messages": "Wiadomości",
    "nav.profile": "Profil",
    "nav.more": "Więcej",
    "nav.account": "Konto",
    "nav.permissions": "Uprawnienia",
    "nav.secure_access": "Bezpieczny dostęp",
    "screen.hub": "Panel",
    "screen.account": "Konto",
    "screen.sign_in": "Zaloguj się",
    "screen.create_account": "Utwórz konto",
    "screen.reset_password": "Resetuj hasło",
    "common.email": "E-mail",
    "common.password": "Hasło",
    "common.confirm_password": "Potwierdź hasło",
    "common.your_language": "Twój język",
    "common.loading": "Ładowanie...",
    "common.refresh": "Odśwież",
    "common.save": "Zapisz",
    "common.error": "Błąd",
    "common.message": "Wiadomość",
    "common.back_to_sign_in": "Powrót do logowania",
    "common.forgot_password": "Nie pamiętasz hasła?",
    "common.create_new_account": "Utwórz nowe konto",
    "common.send_reset_email": "Wyślij e-mail resetujący",
    "common.create_account": "Utwórz konto",
    "common.sign_in": "Zaloguj się",
  },
  es: {
    "nav.today": "Hoy",
    "nav.journal": "Diario",
    "nav.messages": "Mensajes",
    "nav.profile": "Perfil",
    "nav.more": "Más",
    "nav.account": "Cuenta",
    "nav.permissions": "Permisos",
    "nav.secure_access": "Acceso seguro",
    "screen.hub": "Centro",
    "screen.account": "Cuenta",
    "screen.sign_in": "Iniciar sesión",
    "screen.create_account": "Crear cuenta",
    "screen.reset_password": "Restablecer contraseña",
    "common.email": "Correo electrónico",
    "common.password": "Contraseña",
    "common.confirm_password": "Confirmar contraseña",
    "common.your_language": "Tu idioma",
    "common.loading": "Cargando...",
    "common.refresh": "Actualizar",
    "common.save": "Guardar",
    "common.error": "Error",
    "common.message": "Mensaje",
  },
};

export function t(languageCode: string, key: TranslationKey) {
  return DICTS[languageCode]?.[key] ?? EN[key];
}
