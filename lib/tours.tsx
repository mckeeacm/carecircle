import React from "react";
import type { TourStep } from "@/app/components/BubbleTour";

export const hubMemberSteps: TourStep[] = [
  {
    id: "hub-title",
    selector: "#hub-title",
    title: "Your Care Circles",
    body: "Each circle represents one person receiving care. Access is permission-based.",
    placement: "bottom",
  },
  {
    id: "hub-circle-card",
    selector: ".circle-card",
    title: "Open a Circle",
    body: "Enter a circle to view journals, medications, appointments, and messages (if permitted).",
    placement: "bottom",
  },
  {
    id: "hub-account",
    selector: "#account-link",
    title: "Account & Encryption",
    body: "Your device encryption keys and security controls live here.",
    placement: "left",
  },
];

export const hubControllerSteps: TourStep[] = [
  {
    id: "hub-title",
    selector: "#hub-title",
    title: "Your Care Circles",
    body: "As a controller, you can manage roles and permissions for a circle.",
    placement: "bottom",
  },
  {
    id: "hub-create",
    selector: "#create-circle-btn",
    title: "Create a Circle",
    body: "Create a new circle for a person receiving care. You’ll be the controller by default.",
    placement: "right",
  },
  {
    id: "hub-circle-card",
    selector: ".circle-card",
    title: "Circle Tools",
    body: "Open a circle to manage encrypted journals, medications, appointments, and permissions.",
    placement: "bottom",
  },
  {
    id: "hub-account",
    selector: "#account-link",
    title: "Account & Encryption",
    body: "Manage device keys, vault access, and local decrypt cache.",
    placement: "left",
  },
];

export const patientMemberSteps: TourStep[] = [
  {
    id: "pd-name",
    selector: "#patient-name",
    title: "Circle Overview",
    body: "This is the central workspace for this care circle.",
    placement: "bottom",
  },
  {
    id: "pd-journals",
    selector: "#nav-journals",
    title: "Journals",
    body: "Journal content and mood are encrypted on your device. Entries can be shared to the circle or kept private.",
    placement: "bottom",
  },
  {
    id: "pd-meds",
    selector: "#nav-meds",
    title: "Medications",
    body: "Track due and overdue doses and keep secure medication notes.",
    placement: "bottom",
  },
  {
    id: "pd-appts",
    selector: "#nav-appointments",
    title: "Appointments",
    body: "Record appointments and encrypted notes where applicable.",
    placement: "bottom",
  },
  {
    id: "pd-dm",
    selector: "#nav-dm",
    title: "Direct Messages",
    body: "1-to-1 encrypted messages within this circle.",
    placement: "bottom",
  },
  {
    id: "pd-summary",
    selector: "#nav-summary",
    title: "Clinician Summary",
    body: "A structured overview designed for professional review.",
    placement: "bottom",
  },
];

export const patientControllerSteps: TourStep[] = [
  ...patientMemberSteps,
  {
    id: "pd-perms",
    selector: "#nav-permissions",
    title: "Permissions",
    body: "Controllers can manage roles and per-member overrides for this circle.",
    placement: "bottom",
  },
];

export const accountEncryptionSteps: TourStep[] = [
  {
    id: "acc-public",
    selector: "#public-key-status",
    title: "Public Key",
    body: "Your public key enables secure vault sharing to this account. Private keys never leave your device.",
    placement: "bottom",
  },
  {
    id: "acc-devices",
    selector: "#device-keys-section",
    title: "This Device",
    body: "Each device registers its own encryption keys. This helps keep access scoped and auditable.",
    placement: "bottom",
  },
  {
    id: "acc-vault",
    selector: "#vault-share-count",
    title: "Vault Access",
    body: "Vault shares determine which circles you can decrypt on this device/account.",
    placement: "bottom",
  },
  {
    id: "acc-cache",
    selector: "#clear-cache-btn",
    title: "Local Decrypt Cache",
    body: "Clearing this removes decrypted data stored in this browser only. Encrypted data remains intact.",
    placement: "top",
  },
];