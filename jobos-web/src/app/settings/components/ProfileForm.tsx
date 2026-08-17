"use client";

import { useCallback, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  FIELD_LIMITS,
  profileToMetadata,
  validateProfile,
  type ProfileDetails,
} from "@/lib/account/profile";
import SettingsCard from "./SettingsCard";

/**
 * Profile editor.
 *
 * Writes to Supabase `user_metadata` through `auth.updateUser`, so there is no
 * new table and no new API route: the provider authorizes the write against the
 * caller's own session, which means a user can only ever edit their own profile.
 *
 * Every field is optional. Nothing is pre-filled with a guess — an empty field
 * stays empty and is stored as null.
 */
const FIELDS: ReadonlyArray<{
  key: keyof ProfileDetails;
  label: string;
  placeholder: string;
  hint?: string;
  autoComplete: string;
  type: string;
}> = [
  {
    key: "fullName",
    label: "Full name",
    placeholder: "e.g. Priya Sharma",
    autoComplete: "name",
    type: "text",
  },
  {
    key: "displayName",
    label: "Display name",
    placeholder: "What JobTrackOS should call you",
    hint: "Optional. Defaults to your first name.",
    autoComplete: "nickname",
    type: "text",
  },
  {
    key: "phone",
    label: "Phone number",
    placeholder: "e.g. +91 90000 00000",
    autoComplete: "tel",
    type: "tel",
  },
  {
    key: "location",
    label: "Location",
    placeholder: "e.g. Bengaluru, India",
    autoComplete: "address-level2",
    type: "text",
  },
];

type SaveState = "idle" | "saving" | "saved" | "error";

export default function ProfileForm({ initial }: { initial: ProfileDetails }) {
  const [profile, setProfile] = useState<ProfileDetails>(initial);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<keyof ProfileDetails | null>(null);

  const update = useCallback(
    (key: keyof ProfileDetails, value: string) => {
      setProfile((prev) => ({ ...prev, [key]: value }));
      // Any edit clears the previous outcome, so a stale "Saved" never sits
      // beside unsaved changes.
      setState("idle");
      setError(null);
      setFieldError(null);
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const validation = validateProfile(profile);
      if (!validation.ok) {
        setFieldError(validation.field);
        setError(validation.error);
        setState("error");
        return;
      }

      setState("saving");
      setError(null);
      setFieldError(null);

      try {
        const supabase = createClient();
        const { error: updateError } = await supabase.auth.updateUser({
          data: profileToMetadata(validation.value),
        });

        if (updateError) throw new Error(updateError.message);

        // Show the normalized values, so the user sees exactly what was stored.
        setProfile(validation.value);
        setState("saved");
      } catch (err: unknown) {
        setError(
          err instanceof Error
            ? err.message
            : "Your profile could not be saved. Please try again."
        );
        setState("error");
      }
    },
    [profile]
  );

  return (
    <form onSubmit={handleSubmit}>
      <SettingsCard
        title="Personal details"
        description="Used to personalize JobTrackOS. These details are never added to a tailored resume unless you put them there yourself."
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={state === "saving"}
              className="rounded-md bg-accent px-3.5 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state === "saving" ? "Saving..." : "Save changes"}
            </button>

            {state === "saved" && (
              <span role="status" className="text-sm text-success">
                Profile saved.
              </span>
            )}
            {state === "error" && error && (
              <span role="alert" className="text-sm text-danger">
                {error}
              </span>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => {
            const invalid = fieldError === field.key;
            const describedBy = [
              field.hint ? `${field.key}-hint` : null,
              invalid ? `${field.key}-error` : null,
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={field.key}>
                <label
                  htmlFor={field.key}
                  className="mb-1.5 block text-sm font-medium text-text-secondary"
                >
                  {field.label}
                </label>
                <input
                  id={field.key}
                  name={field.key}
                  type={field.type}
                  value={profile[field.key]}
                  onChange={(e) => update(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  maxLength={FIELD_LIMITS[field.key]}
                  autoComplete={field.autoComplete}
                  aria-invalid={invalid || undefined}
                  aria-describedby={describedBy || undefined}
                  className={`w-full rounded-md border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none ${
                    invalid
                      ? "border-danger focus:border-danger"
                      : "border-border focus:border-accent"
                  }`}
                />
                {field.hint && (
                  <p id={`${field.key}-hint`} className="mt-1 text-xs text-text-muted">
                    {field.hint}
                  </p>
                )}
                {invalid && error && (
                  <p id={`${field.key}-error`} className="mt-1 text-xs text-danger">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SettingsCard>
    </form>
  );
}
